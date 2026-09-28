import { afterEach, beforeEach, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { prepareCodexConfig, revertCodexConfig } from "~/apps/codex/config"
import {
  withCodexTaskHooks,
  withoutCodexTaskHooks,
} from "~/apps/codex/task-hooks"
import {
  __resetAuthControllerForTests,
  markSignedIn,
} from "~/lib/auth/auth-controller"
import { sanitizeCodexHook } from "~/lib/companion/codex-hook"
import { getTaskSnapshot } from "~/lib/companion/task-runtime"
import { writeConfig } from "~/lib/config/config"
import {
  getClientActivitySnapshot,
  resetClientActivity,
} from "~/lib/http/client-activity"
import { codexTaskHookRoutes } from "~/routes/settings/codex-task-hook"

import { CompanionState } from "../shell/src/companion/state"

const key = "codex-observer-test-key"
const originalHome = process.env.CODEX_HOME
const provider =
  '[model_providers."copo-app"]\nname = "CoPo"\nbase_url = "http://127.0.0.1:4141/v1"\nwire_api = "responses"\n'
let directory: string

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "copo-codex-hook-"))
  process.env.CODEX_HOME = directory
  fs.writeFileSync(
    path.join(directory, "config.toml"),
    prepareCodexConfig('model = "test"\n', provider, "test"),
  )
  writeConfig({ auth: { apiKeys: [key] } })
  markSignedIn("hook-test")
  resetClientActivity()
})

afterEach(() => {
  if (originalHome === undefined) delete process.env.CODEX_HOME
  else process.env.CODEX_HOME = originalHome
  fs.rmSync(directory, { recursive: true, force: true })
  writeConfig({})
  __resetAuthControllerForTests()
  resetClientActivity()
})

function send(
  event: string,
  overrides: Record<string, unknown> = {},
  credential: string | null = key,
) {
  return codexTaskHookRoutes.request("/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(credential ? { "x-api-key": credential } : {}),
    },
    body: JSON.stringify({
      event,
      sessionId: "session",
      turnId: "turn",
      provider: "copo-app",
      timestamp: Date.now(),
      ...overrides,
    }),
  })
}

function pose(): string {
  const state = new CompanionState()
  state.update({
    gateway: "ready",
    account: { login: "test", host: "github.com", avatarUrl: null },
    connections: [],
    availableToolIds: ["codex"],
    activity: getClientActivitySnapshot(),
    tasks: getTaskSnapshot(),
  })
  return state.display(Date.now()).pose
}

test("real permission hook selects Puff's laptop sleep and tool completion resumes focus", async () => {
  await send("UserPromptSubmit")
  expect(pose()).toBe("focus")
  expect(await (await send("PermissionRequest")).json()).toEqual({
    accepted: true,
  })
  expect(pose()).toBe("approval")
  await send("PostToolUse")
  expect(pose()).toBe("focus")
  await send("PermissionRequest", { timestamp: Date.now() + 1 })
  await send("Interrupt", { timestamp: Date.now() + 2 })
  expect(getTaskSnapshot().tasks[0].status).toBe("cancelled")
  expect(pose()).not.toBe("approval")
})

test("approval observations require the key, a current managed provider and a known turn", async () => {
  expect((await send("UserPromptSubmit", {}, null)).status).toBe(401)
  expect((await send("UserPromptSubmit", {}, "wrong")).status).toBe(401)
  expect(await (await send("PermissionRequest")).json()).toEqual({
    accepted: false,
  })
  expect(
    await (await send("UserPromptSubmit", { provider: "openai" })).json(),
  ).toEqual({ accepted: false })
  expect(getTaskSnapshot().tasks).toEqual([])
  await send("UserPromptSubmit")
  fs.writeFileSync(path.join(directory, "config.toml"), 'model = "test"\n')
  expect((await send("PermissionRequest")).status).toBe(409)
})

test("hook transport rejects content and stale events", async () => {
  expect((await send("UserPromptSubmit", { prompt: "private" })).status).toBe(
    400,
  )
  expect(
    (await send("UserPromptSubmit", { timestamp: Date.now() - 20000 })).status,
  ).toBe(400)
  expect((await send("Stop")).status).toBe(400)
})

test("sanitizer removes prompt, command and output and checks session attribution", () => {
  const input = {
    hook_event_name: "PermissionRequest",
    session_id: "session",
    turn_id: "turn",
    tool_input: { command: "private" },
    prompt: "private",
    tool_response: "private",
  }
  const metadata = {
    type: "session_meta",
    payload: { id: "session", source: "cli", model_provider: "copo-app" },
  }
  expect(sanitizeCodexHook(input, metadata, 42)).toEqual({
    event: "PermissionRequest",
    sessionId: "session",
    turnId: "turn",
    provider: "copo-app",
    timestamp: 42,
  })
  expect(
    sanitizeCodexHook({ ...input, session_id: "different" }, metadata),
  ).toBeNull()
  expect(
    sanitizeCodexHook(input, {
      ...metadata,
      payload: { ...metadata.payload, source: { subagent: {} } },
    }),
  ).toBeNull()
})

test("owned hooks append to user hooks, update idempotently and disconnect cleanly", () => {
  const original =
    'model = "test"\n[[hooks.PermissionRequest]]\n[[hooks.PermissionRequest.hooks]]\ntype = "command"\ncommand = "user-guard"\n'
  const routed = prepareCodexConfig(original, provider, "test")
  const result = withCodexTaskHooks(routed, "observer")
  expect(withCodexTaskHooks(result, "observer")).toBe(result)
  const hooks = (Bun.TOML.parse(result) as Record<string, unknown>)
    .hooks as Record<string, Array<unknown>>
  expect(hooks.PermissionRequest).toHaveLength(2)
  expect(hooks.PostToolUse).toHaveLength(1)
  expect(result).not.toContain("dangerously-bypass")
  expect(result).not.toContain(key)
  expect(withoutCodexTaskHooks(revertCodexConfig(result))).toBe(original)
  const edited = result.replace('command = "observer"', 'command = "edited"')
  expect(withoutCodexTaskHooks(edited)).toBe(edited)
  expect(() => withCodexTaskHooks(edited, "observer")).toThrow("were edited")
})
