import { beforeEach, describe, expect, test } from "bun:test"
import { Hono } from "hono"

import { createAuthMiddleware } from "~/lib/auth/request-auth"
import { writeConfig } from "~/lib/config/config"
import {
  __resetClientActivityForTests,
  beginClientRequest,
  listClientActivity,
} from "~/lib/http/client-activity"
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
