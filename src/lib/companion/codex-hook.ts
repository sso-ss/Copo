import { defineCommand } from "citty"
import fs from "node:fs/promises"
import path from "node:path"
import { z } from "zod"

import { codexConfigPath } from "~/apps/codex/config"
import { resolveApiKey } from "~/lib/auth/api-key-helper"
import { sendProviderRequest } from "~/lib/http/send-request"

import { identifier, record } from "./task-records"

export const CodexHook = z
  .object({
    event: z.enum([
      "UserPromptSubmit",
      "PermissionRequest",
      "PostToolUse",
      "Interrupt",
    ]),
    sessionId: z.string().regex(/^[\w.-]{1,160}$/u),
    turnId: z.string().regex(/^[\w.-]{1,160}$/u),
    provider: z.string().regex(/^[\w.-]{1,160}$/u),
    timestamp: z.number(),
  })
  .strict()

/** Keep only event identity. Commands, prompts and results never leave the helper. */
export function sanitizeCodexHook(
  value: unknown,
  metadata: unknown,
  now = Date.now(),
): z.infer<typeof CodexHook> | null {
  const input = record(value)
  const header = record(metadata)
  const session = record(header.payload)
  if (
    header.type !== "session_meta"
    || session.id !== input.session_id
    || typeof session.source !== "string"
  )
    return null
  const parsed = CodexHook.safeParse({
    event: input.hook_event_name,
    sessionId: identifier(input.session_id),
    turnId: identifier(input.turn_id),
    provider: identifier(session.model_provider),
    timestamp: now,
  })
  return parsed.success ? parsed.data : null
}

async function sessionMetadata(value: unknown): Promise<unknown> {
  if (typeof value !== "string") return null
  const root = await fs.realpath(
    path.join(path.dirname(codexConfigPath()), "sessions"),
  )
  const filePath = await fs.realpath(value)
  const relative = path.relative(root, filePath)
  if (
    relative.startsWith("..")
    || path.isAbsolute(relative)
    || !relative.endsWith(".jsonl")
  )
    return null
  const file = await fs.open(filePath, "r")
  try {
    if (!(await file.stat()).isFile()) return null
    const buffer = Buffer.alloc(1024 * 1024)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    const end = buffer.subarray(0, bytesRead).indexOf(10)
    return end === -1 ? null : (
        JSON.parse(buffer.subarray(0, end).toString("utf8"))
      )
  } finally {
    await file.close()
  }
}

async function runHook(): Promise<void> {
  let text = ""
  for await (const chunk of process.stdin) {
    text += String(chunk)
    if (text.length > 2 * 1024 * 1024) return
  }
  const input = record(JSON.parse(text))
  const payload = sanitizeCodexHook(
    input,
    await sessionMetadata(input.transcript_path),
  )
  const key = resolveApiKey("codex")
  if (!payload || !key.ok) return
  const baseUrl = "http://127.0.0.1:4141"
  await sendProviderRequest(
    { baseUrl, apiKey: key.key, authType: "x-api-key" },
    `${baseUrl}/settings/api/companion/codex-hook`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(750),
      redirect: "error",
    },
  )
}

export const codexTaskHookCommand = defineCommand({
  meta: {
    name: "codex-task-hook",
    description: "Report Codex permission waits to CoPo.",
  },
  async run() {
    // No output or decision: observations never grant, deny or veto permission.
    try {
      await runHook()
    } catch {
      /* Keep Codex usable if CoPo is unavailable. */
    }
  },
})
