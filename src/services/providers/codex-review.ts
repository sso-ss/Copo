import type { Context } from "hono"

import { getConfiguredApiKeys } from "~/lib/auth/request-auth"
import { sendProviderRequest } from "~/lib/http/send-request"

const CODEX_BACKEND = "https://chatgpt.com/backend-api/codex"
const REQUEST_HEADERS = [
  "chatgpt-account-id",
  "user-agent",
  "originator",
  "openai-beta",
  "x-openai-internal-codex-residency",
  "x-codex-turn-metadata",
  "x-codex-session-id",
  "session_id",
  "conversation_id",
]
const RESPONSE_HEADERS = [
  "content-type",
  "cache-control",
  "retry-after",
  "x-request-id",
  "x-codex-turn-state",
  "x-codex-turn-id",
]

/** Transparent, fixed-destination transport for the genuine reviewer. No model
 * aliases, prompt edits, retry with another model, or approval interpretation. */
export async function forwardCodexReview(
  c: Context,
  endpoint: "models" | "responses",
): Promise<Response> {
  const token = /^Bearer\s+(\S+)$/iu.exec(
    c.req.header("authorization") ?? "",
  )?.[1]
  if (
    !token
    || token === c.req.header("x-api-key")
    || getConfiguredApiKeys().includes(token)
  ) {
    return c.json(
      {
        error: {
          code: "codex_login_required",
          message:
            "Sign in to Codex with ChatGPT to use automatic reviews through CoPo.",
        },
      },
      401,
    )
  }
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: endpoint === "models" ? "application/json" : "text/event-stream",
  }
  for (const name of REQUEST_HEADERS) {
    const value = c.req.header(name)
    if (value) headers[name] = value
  }
  // Only the documented catalog version query is forwarded; never a caller URL.
  const url = new URL(`${CODEX_BACKEND}/${endpoint}`)
  const version = c.req.query("client_version")
  if (endpoint === "models" && version)
    url.searchParams.set("client_version", version)
  try {
    const response = await sendProviderRequest(
      { baseUrl: CODEX_BACKEND, apiKey: token, authType: "authorization" },
      url.toString(),
      {
        method: endpoint === "models" ? "GET" : "POST",
        headers,
        body: endpoint === "responses" ? await c.req.text() : undefined,
        signal: AbortSignal.any([
          c.req.raw.signal,
          AbortSignal.timeout(120000),
        ]),
        redirect: "error",
      },
    )
    const outgoing = new Headers()
    for (const name of RESPONSE_HEADERS) {
      const value = response.headers.get(name)
      if (value) outgoing.set(name, value)
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: outgoing,
    })
  } catch {
    // Never log credentials, review prompts, or upstream error bodies.
    return c.json(
      {
        error: {
          code: "codex_review_unavailable",
          message:
            "The Codex review service could not be reached or timed out. No approval was granted.",
        },
      },
      502,
    )
  }
}
