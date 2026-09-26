import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { timingSafeEqual } from "node:crypto"

import { isProxyBaseUrlConfigured } from "~/apps/claude-code/config"
import { resolveApiKey } from "~/lib/auth/api-key-helper"
import { getCompanionAccount } from "~/lib/auth/auth-controller"
import { extractRequestApiKey } from "~/lib/auth/request-auth"
import { ClaudeHook } from "~/lib/companion/claude-hook"
import { getTaskSnapshot, taskTracker } from "~/lib/companion/task-runtime"

const sessions = new Map<string, string>()
let generation = ""

export const claudeTaskHookRoutes = new Hono()
claudeTaskHookRoutes.use("*", bodyLimit({ maxSize: 4096 }))
claudeTaskHookRoutes.post("/", async (c) => {
  const expected = resolveApiKey("claude-code")
  const received = Buffer.from(extractRequestApiKey(c) ?? "")
  const secret = Buffer.from(expected.ok ? expected.key : "")
  if (
    !expected.ok
    || received.length !== secret.length
    || !timingSafeEqual(received, secret)
  )
    return c.json({ error: "unauthorized" }, 401)
  if (!isProxyBaseUrlConfigured() || !getCompanionAccount())
    return c.json({ error: "unavailable" }, 409)
  const parsed = ClaudeHook.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success || Math.abs(Date.now() - parsed.data.timestamp) > 10000)
    return c.json({ error: "invalid_event" }, 400)
  const snapshot = getTaskSnapshot()
  if (generation !== snapshot.generation) {
    sessions.clear()
    generation = snapshot.generation
  }
  const hook = parsed.data
  const taskId =
    hook.promptId ?
      `claude-code:${hook.promptId}`
    : sessions.get(hook.sessionId)
  if (!taskId) return c.json({ accepted: false })
  if (hook.event === "UserPromptSubmit") {
    sessions.set(hook.sessionId, taskId)
    const oldest = sessions.keys().next().value
    if (sessions.size > 512 && oldest) sessions.delete(oldest)
  }
  const status = hookStatus(hook)
  return c.json({
    accepted: taskTracker.observe(
      {
        sourceEventId: `hook:${hook.sessionId}:${taskId}:${hook.event}:${hook.timestamp}`,
        taskId,
        connectionId: "claude-code",
        status,
        timestamp: hook.timestamp,
      },
      generation,
    ),
  })
})

function hookStatus(hook: {
  event: string
  waiting: boolean
}): "started" | "running" | "waiting" | "cancelled" | "failed" {
  if (hook.event === "UserPromptSubmit") return "started"
  if (hook.event === "SessionEnd") return "cancelled"
  if (hook.event === "StopFailure") return "failed"
  if (
    hook.event === "PermissionRequest"
    || (hook.waiting && hook.event === "PreToolUse")
  )
    return "waiting"
  return "running"
}
