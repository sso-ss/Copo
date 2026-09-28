import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { timingSafeEqual } from "node:crypto"

import {
  isCodexEnabled,
  readCodexConfig,
  selectedProvider,
} from "~/apps/codex/config"
import { resolveApiKey } from "~/lib/auth/api-key-helper"
import { getCompanionAccount } from "~/lib/auth/auth-controller"
import { extractRequestApiKey } from "~/lib/auth/request-auth"
import { CodexHook } from "~/lib/companion/codex-hook"
import { getTaskSnapshot, taskTracker } from "~/lib/companion/task-runtime"

const STATUS = {
  UserPromptSubmit: "started",
  PermissionRequest: "waiting",
  PostToolUse: "running",
  Interrupt: "cancelled",
} as const

export const codexTaskHookRoutes = new Hono()
codexTaskHookRoutes.use("*", bodyLimit({ maxSize: 4096 }))
codexTaskHookRoutes.post("/", async (c) => {
  const expected = resolveApiKey("codex")
  const received = Buffer.from(extractRequestApiKey(c) ?? "")
  const secret = Buffer.from(expected.ok ? expected.key : "")
  if (
    !expected.ok
    || received.length !== secret.length
    || !timingSafeEqual(received, secret)
  )
    return c.json({ error: "unauthorized" }, 401)
  const parsed = CodexHook.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success || Math.abs(Date.now() - parsed.data.timestamp) > 10000)
    return c.json({ error: "invalid_event" }, 400)
  const hook = parsed.data
  try {
    const config = readCodexConfig()
    if (!getCompanionAccount() || !isCodexEnabled(config))
      return c.json({ error: "unavailable" }, 409)
    const provider = selectedProvider(config)
    if (
      hook.provider !== provider
      && (!/^copo-app(?:-\d+)?$/u.test(provider)
        || !/^maximal-app(?:-\d+)?$/u.test(hook.provider))
    )
      return c.json({ accepted: false })
  } catch {
    return c.json({ error: "unavailable" }, 409)
  }
  const snapshot = getTaskSnapshot()
  const status = STATUS[hook.event]
  return c.json({
    accepted: taskTracker.observe(
      {
        sourceEventId: `hook:${hook.sessionId}:${hook.turnId}:${hook.event}:${hook.timestamp}`,
        taskId: `codex:${hook.turnId}`,
        connectionId: "codex",
        status,
        timestamp: hook.timestamp,
      },
      snapshot.generation,
    ),
  })
})
