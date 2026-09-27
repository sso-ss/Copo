import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import { resolveApiKey } from "~/lib/auth/api-key-helper"
import { sendCodexGatewayRequest } from "~/lib/http/send-request"

import { readCodexConfig } from "./config"
import { detectCodexDesktop } from "./desktop-detect"
import { detectCodex } from "./detect"
import { parseConfig } from "./toml"

function runCodex(executable: string, args: Array<string>): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      args,
      { timeout: 60000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        // Never put command output (which could contain credentials) in errors.
        if (error)
          reject(
            new Error(
              "Could not verify Codex. Update Codex and sign in with ChatGPT, then try again.",
            ),
          )
        else resolve(stdout + stderr)
      },
    )
  })
}

async function codexExecutable(): Promise<string> {
  const cli = (await detectCodex())[0]?.path
  if (cli) return cli
  const app = (await detectCodexDesktop())[0]?.path
  const executable = app && path.join(app, "Contents", "Resources", "codex")
  if (executable && fs.existsSync(executable)) return executable
  throw new Error(
    "Install or update Codex before setting up automatic reviews.",
  )
}

const PROBE_BODY = JSON.stringify({
  model: "codex-auto-review",
  instructions:
    "This is a model connectivity test. Reply with OK. Do not use tools or evaluate any real action.",
  input: [
    { role: "user", content: [{ type: "input_text", text: "Reply with OK." }] },
  ],
  tools: [],
  stream: true,
  store: false,
  reasoning: { effort: "low" },
})

async function checkReviewer(
  credentials: { localKey: string; chatgptToken: string },
  headers: Record<string, string>,
): Promise<boolean> {
  const response = await sendCodexGatewayRequest(credentials, "responses", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: PROBE_BODY,
    timeoutMs: 30000,
  })
  if (!response.ok) {
    await response.body?.cancel()
    return false
  }
  const body = await response.text()
  let completed = false
  let failed = false
  for (const line of body.split("\n")) {
    if (!line.startsWith("data:")) continue
    try {
      const event = JSON.parse(line.slice(5)) as {
        type?: string
        response?: { status?: string }
        error?: unknown
      }
      if (
        event.type === "response.completed"
        && event.response?.status === "completed"
      )
        completed = true
      if (
        event.error
        || ["error", "response.failed", "response.incomplete"].includes(
          event.type ?? "",
        )
      )
        failed = true
    } catch {
      /* Non-JSON SSE fields are not completion evidence. */
    }
  }
  return completed && !failed
}

function createReviewProbe(localKey: string) {
  const secretPath = `/${randomUUID()}/models`
  const verification: { catalog: boolean; review?: Promise<boolean> } = {
    catalog: false,
  }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 60,
    async fetch(request) {
      if (
        request.method !== "GET"
        || new URL(request.url).pathname !== secretPath
      )
        return new Response(null, { status: 404 })
      const token = /^Bearer\s+(\S+)$/iu.exec(
        request.headers.get("authorization") ?? "",
      )?.[1]
      if (!token) return new Response(null, { status: 401 })
      const headers: Record<string, string> = {}
      for (const name of [
        "chatgpt-account-id",
        "user-agent",
        "originator",
        "openai-beta",
        "x-openai-internal-codex-residency",
      ]) {
        const value = request.headers.get(name)
        if (value) headers[name] = value
      }
      try {
        const credentials = { localKey, chatgptToken: token }
        const response = await sendCodexGatewayRequest(credentials, "models", {
          headers,
          timeoutMs: 20000,
          clientVersion:
            new URL(request.url).searchParams.get("client_version")
            ?? undefined,
        })
        const body = await response.text()
        if (response.ok) {
          const catalog = JSON.parse(body) as {
            models?: Array<{ slug?: string }>
          }
          verification.catalog =
            catalog.models?.some((model) => model.slug === "codex-auto-review")
            === true
          if (verification.catalog)
            verification.review ??= checkReviewer(credentials, headers).catch(
              () => false,
            )
        }
        return new Response(body, {
          status: response.status,
          headers: { "content-type": "application/json" },
        })
      } catch {
        return new Response(null, { status: 502 })
      }
    },
  })
  return { server, verification, secretPath }
}

/** Ask Codex to supply its login using its documented proxy auth flow. The
 * temporary callback is loopback-only with an unguessable path. No login-file
 * reads, saved provider changes, or secrets in command arguments/output. */
export async function verifyCodexAutomaticReview(): Promise<void> {
  const executable = await codexExecutable()
  if (
    !(await runCodex(executable, ["login", "status"])).includes(
      "Logged in using ChatGPT",
    )
  ) {
    throw new Error(
      "Sign in to Codex with ChatGPT first. Automatic reviews through CoPo currently require a ChatGPT login.",
    )
  }
  const key = resolveApiKey("codex")
  if (!key.ok) throw new Error("Add an enabled CoPo API client key first.")
  const provider = `copo-check-${randomUUID()}`
  const profile = parseConfig(readCodexConfig()).profile
  const profileArgs =
    typeof profile === "string" ?
      [
        "-c",
        `profiles.${JSON.stringify(profile)}.model_provider=${JSON.stringify(provider)}`,
      ]
    : []
  const { server, verification, secretPath } = createReviewProbe(key.key)
  const url = `http://127.0.0.1:${server.port}${secretPath}`
  try {
    await runCodex(executable, [
      "debug",
      "models",
      "-c",
      `model_provider=${JSON.stringify(provider)}`,
      "-c",
      `model_providers.${provider}.name="CoPo connection check"`,
      "-c",
      `model_providers.${provider}.base_url=${JSON.stringify(url.replace(/\/models$/u, ""))}`,
      "-c",
      `model_providers.${provider}.model_catalog_url=${JSON.stringify(url)}`,
      "-c",
      `model_providers.${provider}.wire_api="responses"`,
      "-c",
      `model_providers.${provider}.requires_openai_auth=true`,
      ...profileArgs,
    ])
    if (!verification.catalog || !(await verification.review))
      throw new Error(
        "The Codex reviewer did not complete its connection check. Make sure the updated CoPo is running and Codex is signed in with ChatGPT. Your configuration was not changed.",
      )
  } finally {
    await server.stop(true)
    await verification.review
  }
}
