import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Hono } from "hono"

import { readCodexGatewayModels } from "~/apps/codex/provider"
import { createAuthMiddleware } from "~/lib/auth/request-auth"
import { getConfig, writeConfig } from "~/lib/config/config"
import { sendCodexGatewayRequest } from "~/lib/http/send-request"
import { state } from "~/lib/runtime-state/state"
import { closeUsageStore } from "~/lib/token-usage"
import { createCodexRoutes } from "~/routes/codex/route"
import { responsesRoutes } from "~/routes/responses/route"

const originalFetch = globalThis.fetch
const originalState = { ...state }
const originalConfig = getConfig()
const calls: Array<{ url: string; init: RequestInit }> = []
let upstream: () => Response

beforeEach(() => {
  calls.length = 0
  writeConfig({
    ...originalConfig,
    auth: { enforce: false, apiKeys: ["local-key", "other-local-key"] },
  })
  Object.assign(state, {
    githubToken: undefined,
    copilotToken: "copilot-token",
    accountType: "individual",
    copilotApiUrl: undefined,
    models: undefined,
    rateLimitSeconds: undefined,
    manualApprove: false,
  })
  upstream = () =>
    new Response(
      'data: {"type":"response.completed","response":{"status":"completed"}}\n\n',
      {
        headers: { "content-type": "text/event-stream" },
      },
    )
  globalThis.fetch = ((url: string, init: RequestInit) => {
    calls.push({ url, init })
    return Promise.resolve(upstream())
  }) as typeof fetch
})
afterEach(async () => {
  globalThis.fetch = originalFetch
  Object.assign(state, originalState)
  writeConfig(originalConfig)
  await closeUsageStore()
})

function app(): Hono {
  const routes = new Hono()
  routes.use(createAuthMiddleware())
  routes.route("/codex/v1", createCodexRoutes())
  routes.route("/v1/responses", responsesRoutes)
  return routes
}

function request(
  model = "codex-auto-review",
  headers: Record<string, string> = {},
) {
  return app().request("/codex/v1/responses", {
    method: "POST",
    headers: {
      "x-api-key": "local-key",
      authorization: "Bearer chatgpt-token",
      ...headers,
    },
    body: JSON.stringify({ model, input: "hello", stream: true }),
  })
}

describe("Codex review transport", () => {
  test.each(["", "wrong-key"])(
    "rejects invalid local key %s even with generic enforcement off",
    async (key) => {
      expect((await request(undefined, { "x-api-key": key })).status).toBe(401)
      expect(calls).toHaveLength(0)
    },
  )
  test.each(["", "Basic token", "Bearer local-key", "Bearer other-local-key"])(
    "rejects missing or local upstream credential %s",
    async (authorization) => {
      expect((await request(undefined, { authorization })).status).toBe(401)
      expect(calls).toHaveLength(0)
    },
  )
  test("forwards exact review bytes and policy fields without Copilot transformations", async () => {
    const body =
      '{ "model": "codex-auto-review", "instructions": "review policy", "input": [], "stream": true, "store": false, "tools": [{"type":"custom","name":"apply_patch"}], "service_tier":"priority", "unknown_policy_field": {"a":1} }'
    const result = await app().request("/codex/v1/responses", {
      method: "POST",
      body,
      headers: {
        "x-api-key": "local-key",
        authorization: "Bearer chatgpt-token",
        "chatgpt-account-id": "test-account",
        cookie: "private-cookie",
        "x-github-token": "must-not-forward",
        "x-forwarded-host": "evil.example",
      },
    })
    expect(result.status).toBe(200)
    expect(await result.text()).toContain("response.completed")
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe("https://chatgpt.com/backend-api/codex/responses")
    expect(calls[0].init.body).toBe(body)
    const headers = new Headers(calls[0].init.headers)
    expect(headers.get("authorization")).toBe("Bearer chatgpt-token")
    expect(headers.get("chatgpt-account-id")).toBe("test-account")
    for (const name of [
      "x-api-key",
      "cookie",
      "x-github-token",
      "x-forwarded-host",
    ])
      expect(headers.has(name)).toBe(false)
    expect(calls[0].init.redirect).toBe("error")
  })
  test.each([
    "codex-auto-review-other",
    "CODEX-AUTO-REVIEW",
    "codex-auto-review ",
  ])("does not forward lookalike %s to OpenAI", async (model) => {
    expect((await request(model)).status).toBe(401) // ordinary GitHub auth gate
    expect(calls).toHaveLength(0)
  })
  test("the ordinary endpoint never interprets a bearer as a review credential", async () => {
    const result = await app().request("/v1/responses", {
      method: "POST",
      headers: { authorization: "Bearer chatgpt-token" },
      body: JSON.stringify({ model: "codex-auto-review", input: [] }),
    })
    expect(result.status).toBe(503)
    expect(calls).toHaveLength(0)
  })
  test("catalog preserves genuine approval metadata without requiring GitHub login", async () => {
    const catalog = JSON.stringify({
      models: [{ slug: "codex-auto-review", visibility: "hide" }],
      policy: "preserve",
    })
    upstream = () =>
      new Response(catalog, {
        headers: { "content-type": "application/json", "set-cookie": "secret" },
      })
    const result = await app().request(
      "/codex/v1/models?client_version=0.157.1&url=https://evil.example",
      {
        headers: {
          "x-api-key": "local-key",
          authorization: "Bearer chatgpt-token",
        },
      },
    )
    expect(await result.text()).toBe(catalog)
    expect(result.headers.has("set-cookie")).toBe(false)
    expect(calls[0].url).toBe(
      "https://chatgpt.com/backend-api/codex/models?client_version=0.157.1",
    )
  })
  test.each([401, 403, 429, 500])(
    "keeps HTTP %s as a failure with no fallback",
    async (status) => {
      upstream = () =>
        new Response('{"error":"upstream failure"}', {
          status,
          headers: { "retry-after": "30" },
        })
      const result = await request()
      expect(result.status).toBe(status)
      expect(await result.text()).toBe('{"error":"upstream failure"}')
      expect(result.headers.get("retry-after")).toBe("30")
      expect(calls).toHaveLength(1)
    },
  )
  test.each(["response.failed", "response.incomplete", "error"])(
    "preserves %s event verbatim",
    async (type) => {
      const body = `data: {"type":"${type}"}\n\n`
      upstream = () =>
        new Response(body, { headers: { "content-type": "text/event-stream" } })
      expect(await (await request()).text()).toBe(body)
      expect(calls).toHaveLength(1)
    },
  )
  test("does not convert a denial into approval", async () => {
    const body =
      'data: {"type":"response.completed","response":{"output":[{"decision":"deny"}]}}\n\n'
    upstream = () =>
      new Response(body, { headers: { "content-type": "text/event-stream" } })
    expect(await (await request()).text()).toBe(body)
  })
  test("transport errors fail closed without exposing exception text", async () => {
    upstream = () => {
      throw new Error("secret-token")
    }
    const result = await request()
    expect(result.status).toBe(502)
    expect(await result.text()).not.toContain("secret-token")
    expect(calls).toHaveLength(1)
  })
})

describe("Codex routing isolation and cancellation", () => {
  test("standalone connect discovers supported task models with only its local key", async () => {
    upstream = () =>
      Response.json({
        apps: [
          {
            id: "codex",
            routing: { available_models: ["gpt-6-luna", "gpt-6-astra"] },
          },
        ],
      })
    expect(await readCodexGatewayModels()).toEqual([
      "gpt-6-luna",
      "gpt-6-astra",
    ])
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe("http://127.0.0.1:4141/settings/api/apps")
    expect(new Headers(calls[0].init.headers).get("authorization")).toBe(
      "Bearer local-key",
    )
    expect(calls[0].init.redirect).toBe("error")
  })
  test("client cancellation aborts upstream and stream cancellation propagates", async () => {
    let cancelled = false
    upstream = () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      )
    const controller = new AbortController()
    const result = await app().request("/codex/v1/responses", {
      method: "POST",
      headers: {
        "x-api-key": "local-key",
        authorization: "Bearer chatgpt-token",
      },
      body: JSON.stringify({ model: "codex-auto-review" }),
      signal: controller.signal,
    })
    controller.abort()
    expect(calls[0].init.signal?.aborted).toBe(true)
    await result.body?.cancel()
    expect(cancelled).toBe(true)
  })
  test("regular tasks use only the Copilot credential", async () => {
    state.githubToken = "github-token"
    state.models = {
      object: "list",
      data: [
        {
          id: "gpt-test",
          supported_endpoints: ["/responses"],
          capabilities: { limits: {} },
        },
      ],
    } as typeof state.models
    upstream = () =>
      new Response(
        JSON.stringify({
          object: "response",
          status: "completed",
          output: [],
          usage: {},
        }),
        { headers: { "content-type": "application/json" } },
      )
    const result = await request("gpt-test")
    expect(result.status).toBe(200)
    await result.text()
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe("https://api.githubcopilot.com/responses")
    const headers = new Headers(calls[0].init.headers)
    expect(headers.get("authorization")).toBe("Bearer copilot-token")
    expect(headers.has("x-api-key")).toBe(false)
    expect(JSON.stringify([...headers])).not.toContain("chatgpt-token")
  })
  test("setup probe sends both credentials only to the fixed loopback endpoint", async () => {
    await sendCodexGatewayRequest(
      { localKey: "local-key", chatgptToken: "chatgpt-token" },
      "models",
      { clientVersion: "0.157.1" },
    )
    expect(calls[0].url).toBe(
      "http://127.0.0.1:4141/codex/v1/models?client_version=0.157.1",
    )
    const headers = new Headers(calls[0].init.headers)
    expect(headers.get("authorization")).toBe("Bearer chatgpt-token")
    expect(headers.get("x-api-key")).toBe("local-key")
    expect(calls[0].init.redirect).toBe("error")
  })
})

describe("native automatic reviewer through the normal Copilot endpoint", () => {
  const payload = {
    model: "gpt-6-astra",
    instructions: "Native Codex approval policy fixture",
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: "Review this fixture action" }],
      },
    ],
    tools: [],
    stream: true,
    store: false,
    text: {
      format: {
        type: "json_schema",
        name: "codex_output_schema",
        strict: true,
        schema: {
          type: "object",
          properties: { outcome: { type: "string", enum: ["allow", "deny"] } },
          required: ["outcome"],
          additionalProperties: false,
        },
      },
    },
  }
  function nativeRequest() {
    state.githubToken = "github-token"
    state.models = {
      object: "list",
      data: [
        {
          id: "gpt-6-astra",
          supported_endpoints: ["/responses"],
          capabilities: { limits: {} },
        },
      ],
    } as typeof state.models
    return app().request("/v1/responses", {
      method: "POST",
      headers: {
        authorization: "Bearer local-key",
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    })
  }
  test.each(["allow", "deny"])(
    "preserves native %s decisions and the native policy/schema",
    async (outcome) => {
      const body = `data: ${JSON.stringify({ type: "response.completed", response: { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ outcome }) }] }] } })}\n\n`
      upstream = () =>
        new Response(body, { headers: { "content-type": "text/event-stream" } })
      const response = await nativeRequest()
      expect(response.status).toBe(200)
      expect(await response.text()).toBe(body)
      expect(calls).toHaveLength(1)
      expect(calls[0].url).toBe("https://api.githubcopilot.com/responses")
      const sent: unknown = JSON.parse(calls[0].init.body as string)
      expect(sent).toMatchObject({
        model: payload.model,
        instructions: payload.instructions,
        input: payload.input,
        text: payload.text,
        store: false,
      })
      expect(new Headers(calls[0].init.headers).get("authorization")).toBe(
        "Bearer copilot-token",
      )
    },
  )
  test.each(["response.failed", "response.incomplete", "error"])(
    "keeps native reviewer %s events as failures",
    async (type) => {
      const body = `data: ${JSON.stringify({ type, response: { status: "failed" }, error: { message: "review failure" } })}\n\n`
      upstream = () =>
        new Response(body, { headers: { "content-type": "text/event-stream" } })
      expect(await (await nativeRequest()).text()).toBe(body)
      expect(calls).toHaveLength(1)
    },
  )
  test.each([401, 403, 429, 503])(
    "keeps HTTP %s review failures without fallback",
    async (status) => {
      upstream = () =>
        new Response('{"error":{"message":"Review failed"}}', { status })
      const response = await nativeRequest()
      expect(response.ok).toBe(false)
      expect(await response.text()).not.toContain('"outcome":"allow"')
      expect(calls).toHaveLength(1)
    },
  )
})
