import { defineCommand } from "citty"
import { z } from "zod"

import { readClaudeCodeSettings } from "~/apps/claude-code/config"
import { resolveApiKey } from "~/lib/auth/api-key-helper"
import { sendProviderRequest } from "~/lib/http/send-request"

import { identifier, record } from "./task-records"

export const ClaudeHook = z
  .object({
    event: z.enum([
      "UserPromptSubmit",
      "PreToolUse",
      "PostToolUse",
      "PermissionRequest",
      "StopFailure",
      "SessionEnd",
    ]),
    sessionId: z.string().regex(/^[\w.-]{1,160}$/u),
    promptId: z
      .string()
      .regex(/^[\w.-]{1,160}$/u)
      .nullable(),
    waiting: z.boolean(),
    timestamp: z.number(),
  })
  .strict()

/** Whitelist metadata before transport. Prompt, tool input and response text
 * are deliberately discarded in this helper process. */
export function sanitizeClaudeHook(
  value: unknown,
  now = Date.now(),
): z.infer<typeof ClaudeHook> | null {
  const input = record(value)
  if (input.agent_id !== undefined) return null
  const parsed = ClaudeHook.safeParse({
    event: input.hook_event_name,
    sessionId: identifier(input.session_id),
    promptId: identifier(input.prompt_id),
    waiting: ["AskUserQuestion", "ExitPlanMode"].includes(
      String(input.tool_name),
    ),
    timestamp: now,
  })
  return parsed.success ? parsed.data : null
}

async function runHook(): Promise<void> {
  let text = ""
  for await (const chunk of process.stdin) {
    text += String(chunk)
    if (text.length > 2 * 1024 * 1024) return
  }
  const payload = sanitizeClaudeHook(JSON.parse(text))
  if (!payload) return
  const key = resolveApiKey("claude-code")
  if (!key.ok) return
  const env = record(readClaudeCodeSettings().env)
  const base = new URL(String(env.ANTHROPIC_BASE_URL))
  if (
    base.protocol !== "http:"
    || !["[::1]", "127.0.0.1", "localhost"].includes(base.hostname)
    || base.username
    || base.password
  )
    return
  await sendProviderRequest(
    { baseUrl: base.origin, apiKey: key.key, authType: "x-api-key" },
    new URL("/settings/api/companion/claude-hook", base).href,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(750),
      redirect: "error",
    },
  )
}

export const taskHookCommand = defineCommand({
  meta: {
    name: "task-hook",
    description: "Report Claude Code task lifecycle metadata to CoPo.",
  },
  async run() {
    // Observation must never block/veto the client's task or print its input.
    try {
      await runHook()
    } catch {
      /* gateway unavailable: keep the client usable */
    }
  },
})
