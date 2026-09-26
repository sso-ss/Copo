import { beforeEach, describe, expect, test } from "bun:test"
import { Hono } from "hono"

import type { ClientRequestEvent } from "~/lib/http/client-activity-types"

import { createAuthMiddleware } from "~/lib/auth/request-auth"
import { writeConfig } from "~/lib/config/config"
import { settingsEventBus } from "~/lib/config/settings-events"
import {
  __resetClientActivityForTests,
  beginClientRequest,
  getClientActivitySnapshot,
  listClientActivity,
  resetClientActivity,
} from "~/lib/http/client-activity"
import { UNATTRIBUTED_CLIENT_ID } from "~/lib/http/client-activity-types"
import {
  isInferenceRequest,
  trackClientRequest,
} from "~/lib/http/track-client-request"
import { clientsRoutes } from "~/routes/settings/clients"

beforeEach(() => __resetClientActivityForTests())

function streamingApp() {
  let controller: ReadableStreamDefaultController<Uint8Array>
  let cancelled = false
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value
    },
    cancel() {
      cancelled = true
    },
  })
  const app = new Hono()
  app.use((c, next) => trackClientRequest(c, next, "test-key"))
  app.post(
    "/v1/messages",
    () =>
      new Response(body, {
        headers: { "content-type": "text/event-stream", "x-test": "preserved" },
      }),
  )
  return {
    app,
    send: (text: string) => controller.enqueue(new TextEncoder().encode(text)),
    close: () => controller.close(),
    fail: () => controller.error(new Error("upstream disconnected")),
    cancelled: () => cancelled,
  }
}

function status() {
  return listClientActivity()[0]
}

describe("ordered request events", () => {
  test("retains a concurrent failure even when the last request succeeds", () => {
    const failed = beginClientRequest("test-key")
    const succeeded = beginClientRequest("test-key")
    failed("stopped", 502)
    succeeded("finished", 200)
    const snapshot = getClientActivitySnapshot()
    expect(snapshot.activity[0].status).toBe("finished")
    expect(snapshot.activeRequests).toEqual([])
    expect(snapshot.recentEvents.map((event) => event.status)).toEqual([
      "stopped",
      "finished",
    ])
    expect(snapshot.recentEvents.map((event) => event.eventId)).toEqual([3, 4])
    expect(snapshot.recentEvents[0].activity.activeRequests).toBe(1)
    expect(snapshot.recentEvents[1].activity.activeRequests).toBe(0)
  })

  test("publishes ordered starts and outcomes once, including fast requests", () => {
    const events: Array<ClientRequestEvent> = []
    const stop = settingsEventBus.subscribe("activity.request", (event) => {
      events.push(event)
    })
    try {
      const end = beginClientRequest("test-key")
      expect(getClientActivitySnapshot().activeRequests).toHaveLength(1)
      end("finished", 200)
      end("stopped", 500)
      expect(events.map((event) => event.status)).toEqual([
        "started",
        "finished",
      ])
      expect(events.map((event) => event.eventId)).toEqual([1, 2])
      expect(events[0].requestId).toBe(events[1].requestId)
      expect(events[0].generation).toBe(events[1].generation)
      expect(events[0].activity.activeRequests).toBe(1)
      expect(events[1].activity.activeRequests).toBe(0)
    } finally {
      stop()
    }
  })

  test("a session reset rejects late outcomes and replaces active counters", () => {
    const oldEnd = beginClientRequest("test-key")
    const previous = getClientActivitySnapshot()
    resetClientActivity()
    const end = beginClientRequest("test-key")
    oldEnd("finished", 200)
    const current = getClientActivitySnapshot()
    expect(current.generation).not.toBe(previous.generation)
    expect(current.eventId).toBe(1)
    expect(current.activity[0].activeRequests).toBe(1)
    expect(current.recentEvents).toEqual([])
    end("stopped", null)
    expect(getClientActivitySnapshot().recentEvents).toHaveLength(1)
  })

  test("snapshot and published objects cannot mutate retained history", () => {
    const stop = settingsEventBus.subscribe("activity.request", (event) => {
      event.activity.activeRequests = 99
    })
    try {
      const end = beginClientRequest("test-key")
      const active = getClientActivitySnapshot()
      active.activity[0].activeRequests = 100
      active.activeRequests[0].activity.activeRequests = 100
      expect(
        getClientActivitySnapshot().activeRequests[0].activity.activeRequests,
      ).toBe(1)
      end("finished", 200)
      const finished = getClientActivitySnapshot()
      finished.recentEvents[0].activity.activeRequests = 100
      expect(
        getClientActivitySnapshot().recentEvents[0].activity.activeRequests,
      ).toBe(0)
    } finally {
      stop()
    }
  })

  test("terminal history is bounded without evicting running requests", () => {
    const end = beginClientRequest("long-running")
    for (let i = 0; i < 300; i++) beginClientRequest("fast")("finished", 200)
    const snapshot = getClientActivitySnapshot()
    expect(snapshot.recentEvents).toHaveLength(256)
    expect(snapshot.recentEvents.at(-1)?.eventId).toBe(snapshot.eventId)
    expect(snapshot.activeRequests).toHaveLength(1)
    expect(snapshot.activeRequests[0].apiKeyId).toBe("long-running")
    end("finished", 200)
  })

  test("idle summary eviction is reported to incremental consumers", () => {
    for (let i = 0; i < 1024; i++)
      beginClientRequest(`key-${i}`)("finished", 200)
    const end = beginClientRequest("new-key")
    const snapshot = getClientActivitySnapshot()
    expect(snapshot.activity).toHaveLength(1024)
    expect(snapshot.activeRequests[0].removedApiKeyId).toBe("key-0")
    end("finished", 200)
  })
})

test("accepted legacy and unnamed requests drive gateway activity without inventing tool attribution", async () => {
  for (const key of ["", "legacy-key"]) {
    __resetClientActivityForTests()
    writeConfig({
      auth: { enforce: Boolean(key), apiKeys: key ? [key] : [] },
    })
    try {
      let finish: () => void = () => {
        throw new Error("stream not started")
      }
      const app = new Hono()
      app.use(createAuthMiddleware())
      app.post(
        "/v1/responses",
        () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                finish = () => {
                  controller.enqueue(
                    new TextEncoder().encode("data: [DONE]\n\n"),
                  )
                  controller.close()
                }
              },
            }),
            { headers: { "content-type": "text/event-stream" } },
          ),
      )
      const response = await app.request("/v1/responses", {
        method: "POST",
        headers: key ? { Authorization: `Bearer ${key}` } : {},
      })
      expect(getClientActivitySnapshot().activeRequests).toHaveLength(1)
      expect(status().apiKeyId).toBe(UNATTRIBUTED_CLIENT_ID)
      finish()
      await response.text()
      expect(status().activeRequests).toBe(0)
      expect(status().status).toBe("finished")
      expect(JSON.stringify(getClientActivitySnapshot())).not.toContain(
        "legacy-key",
      )
    } finally {
      writeConfig({})
    }
  }
})

describe("request activity", () => {
  test("concurrent requests stay working until the last ends, with idempotent cleanup", () => {
    const first = beginClientRequest("test-key")
    const second = beginClientRequest("test-key")
    expect(status().activeRequests).toBe(2)
    first("finished", 200)
    first("finished", 200)
    expect(status().status).toBe("working")
    expect(status().activeRequests).toBe(1)
    second("stopped", 502)
    expect(status().status).toBe("stopped")
    expect(status().activeRequests).toBe(0)
    expect(status().lastStatusCode).toBe(502)
    expect(status().lastFinishedAt).not.toBeNull()
  })

  test("stream stays working after headers and ends only after terminal data is consumed", async () => {
    const fixture = streamingApp()
    const response = await fixture.app.request("/v1/messages", {
      method: "POST",
    })
    expect(response.headers.get("x-test")).toBe("preserved")
    expect(status().status).toBe("working")
    const text = response.text()
    fixture.send('data: {"type":"message_')
    fixture.send('stop"}\n\n')
    expect(status().status).toBe("working")
    fixture.close()
    expect(await text).toBe('data: {"type":"message_stop"}\n\n')
    expect(status().status).toBe("finished")
  })

  test.each([
    "data: [DONE]\n\n",
    "event: response.completed\ndata: {}\n\n",
    'data: {"type":"response.completed"}\n\n',
  ])("recognizes completion protocol: %s", async (terminal) => {
    const fixture = streamingApp()
    const response = await fixture.app.request("/v1/messages", {
      method: "POST",
    })
    fixture.send(terminal)
    fixture.close()
    expect(await response.text()).toBe(terminal)
    expect(status().status).toBe("finished")
  })

  test.each([
    'data: {"delta":"partial"}\n\n',
    'event: error\ndata: {"error":"failed"}\n\ndata: [DONE]\n\n',
    'data: {"type":"response.incomplete"}\n\ndata: [DONE]\n\n',
  ])(
    "does not call an interrupted or error stream finished: %s",
    async (payload) => {
      const fixture = streamingApp()
      const response = await fixture.app.request("/v1/messages", {
        method: "POST",
      })
      fixture.send(payload)
      fixture.close()
      await response.text()
      expect(status().status).toBe("stopped")
    },
  )

  test("consumer cancellation propagates upstream and stops exactly once", async () => {
    const fixture = streamingApp()
    const response = await fixture.app.request("/v1/messages", {
      method: "POST",
    })
    await response.body?.cancel()
    expect(fixture.cancelled()).toBe(true)
    expect(status().status).toBe("stopped")
    expect(status().activeRequests).toBe(0)
  })

  test("request abort marks stopped even while waiting for a stream", async () => {
    const fixture = streamingApp()
    const controller = new AbortController()
    const response = await fixture.app.request("/v1/messages", {
      method: "POST",
      signal: controller.signal,
    })
    controller.abort()
    expect(status().status).toBe("stopped")
    await response.body?.cancel()
    expect(status().activeRequests).toBe(0)
  })

  test("upstream read errors stop the request and still reach the caller", async () => {
    const fixture = streamingApp()
    const response = await fixture.app.request("/v1/messages", {
      method: "POST",
    })
    fixture.fail()
    const error = await response.text().then(
      () => null,
      (failure: unknown) => failure,
    )
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe("upstream disconnected")
    expect(status().status).toBe("stopped")
  })

  test("normal JSON completion and HTTP errors are distinguished", async () => {
    const app = new Hono()
    app.use((c, next) => trackClientRequest(c, next, "test-key"))
    app.post("/ok", (c) => c.json({ result: "ok" }))
    app.post("/fail", (c) => c.json({ error: "unavailable" }, 503))
    const ok = await app.request("/ok", { method: "POST" })
    expect(await ok.json()).toEqual({ result: "ok" })
    expect(status().status).toBe("finished")
    const fail = await app.request("/fail", { method: "POST" })
    expect(fail.status).toBe(503)
    expect(status().status).toBe("stopped")
  })

  test("only inference routes count", () => {
    for (const path of [
      "/responses",
      "/v1/responses",
      "/v1/messages",
      "/provider/v1/messages",
      "/v1/chat/completions",
      "/embeddings/",
    ]) {
      expect(isInferenceRequest("POST", path)).toBe(true)
    }
    for (const path of [
      "/settings/api/clients/activity",
      "/v1/models",
      "/v1/messages/count_tokens",
      "/status",
    ]) {
      expect(isInferenceRequest("POST", path)).toBe(false)
    }
    expect(isInferenceRequest("GET", "/responses")).toBe(false)
  })

  test("auth attributes requests to their key; activity polls neither expose secrets nor count as work", async () => {
    writeConfig({
      auth: {
        apiKeyEntries: [
          {
            id: "auth-key",
            label: "Test app",
            key: "secret-test-key",
            enabled: true,
            created_at: new Date().toISOString(),
          },
        ],
      },
    })
    try {
      const app = new Hono()
      app.use(createAuthMiddleware())
      app.post("/responses", (c) => c.json({ ok: true }))
      app.route("/settings/api/clients", clientsRoutes)
      const headers = { Authorization: "Bearer secret-test-key" }
      const response = await app.request("/responses", {
        method: "POST",
        headers,
      })
      await response.text()
      const activity = await app.request("/settings/api/clients/activity", {
        headers,
      })
      const text = await activity.text()
      expect(text).not.toContain("secret-test-key")
      expect(status().apiKeyId).toBe("auth-key")
      expect(status().status).toBe("finished")
      expect(status().activeRequests).toBe(0)
    } finally {
      writeConfig({})
    }
  })
})
