import { afterEach, beforeEach, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { applyProxyBaseUrl } from "~/apps/claude-code/config"
import {
  __resetAuthControllerForTests,
  markSignedIn,
} from "~/lib/auth/auth-controller"
import { getTaskSnapshot } from "~/lib/companion/task-runtime"
import { writeConfig } from "~/lib/config/config"
import { resetClientActivity } from "~/lib/http/client-activity"
import { claudeTaskHookRoutes } from "~/routes/settings/claude-task-hook"

const key = "task-observer-test-key"
const savedDirectory = process.env.CLAUDE_CONFIG_DIR
let directory: string

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "copo-hook-route-"))
  process.env.CLAUDE_CONFIG_DIR = directory
  writeConfig({ auth: { apiKeys: [key] } })
  applyProxyBaseUrl()
  markSignedIn("hook-test")
  resetClientActivity()
})

afterEach(() => {
  if (savedDirectory === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = savedDirectory
  fs.rmSync(directory, { recursive: true, force: true })
  writeConfig({})
  __resetAuthControllerForTests()
  resetClientActivity()
})

function send(
  event: string,
  options: Record<string, unknown> = {},
  credential: string | null = key,
) {
  return claudeTaskHookRoutes.request("/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(credential ? { "x-api-key": credential } : {}),
    },
    body: JSON.stringify({
      event,
      sessionId: "session",
      promptId: "prompt",
      waiting: false,
      timestamp: Date.now(),
      ...options,
    }),
  })
}

test("hook transport requires the configured key even without gateway key enforcement", async () => {
  expect((await send("UserPromptSubmit", {}, null)).status).toBe(401)
  expect((await send("UserPromptSubmit", {}, "wrong")).status).toBe(401)
  expect(getTaskSnapshot().tasks).toEqual([])
  expect((await send("UserPromptSubmit")).status).toBe(200)
})

test("hook transport rejects content, stale messages and unvalidated Stop completion", async () => {
  expect((await send("UserPromptSubmit", { prompt: "private" })).status).toBe(
    400,
  )
  expect(
    (await send("UserPromptSubmit", { timestamp: Date.now() - 20000 })).status,
  ).toBe(400)
  expect((await send("Stop")).status).toBe(400)
  expect((await send("completed")).status).toBe(400)
  expect(getTaskSnapshot().tasks).toEqual([])
})

test("authenticated hooks report input waits, resume and failure without completing tasks", async () => {
  await send("UserPromptSubmit")
  expect(getTaskSnapshot().tasks[0].status).toBe("running")
  await send("PermissionRequest")
  expect(getTaskSnapshot().tasks[0].status).toBe("waiting")
  await send("PostToolUse")
  expect(getTaskSnapshot().tasks[0].status).toBe("running")
  await send("StopFailure")
  expect(getTaskSnapshot().tasks[0].status).toBe("failed")
})

test("session end cancels known work, while an account reset discards session identity", async () => {
  await send("UserPromptSubmit")
  await send("SessionEnd", { promptId: null })
  expect(getTaskSnapshot().tasks[0].status).toBe("cancelled")
  resetClientActivity()
  expect(await (await send("SessionEnd", { promptId: null })).json()).toEqual({
    accepted: false,
  })
  expect(getTaskSnapshot().tasks).toEqual([])
})
