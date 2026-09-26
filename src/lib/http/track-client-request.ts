import type { Context, Next } from "hono"

import { beginClientRequest } from "./client-activity"

/** Only inference requests count; settings polls and model discovery do not. */
export function isInferenceRequest(method: string, path: string): boolean {
  return (
    method === "POST"
    && /\/(?:chat\/completions|responses|messages|embeddings)\/?$/u.test(path)
  )
}

/** Protocol markers only; application text is never retained in history. */
function lineOutcome(line: string): "finished" | "stopped" | null {
  if (/^event:\s*(?:error|response\.(?:failed|incomplete))\s*$/u.test(line))
    return "stopped"
  if (/^event:\s*(?:message_stop|response\.completed)\s*$/u.test(line))
    return "finished"
  if (!line.startsWith("data:")) return null
  const data = line.slice(5).trim()
  if (data === "[DONE]") return "finished"
  try {
    const value = JSON.parse(data) as { type?: string; error?: unknown } | null
    if (
      value?.error
      || ["error", "response.failed", "response.incomplete"].includes(
        value?.type ?? "",
      )
    )
      return "stopped"
    if (["message_stop", "response.completed"].includes(value?.type ?? ""))
      return "finished"
  } catch {
    // Non-JSON SSE data is allowed, but is not a completion marker.
  }
  return null
}

function streamObserver() {
  const decoder = new TextDecoder()
  let pending = ""
  let terminal = false
  let failed = false
  return {
    completed: () => terminal && !failed,
    push(chunk: Uint8Array): void {
      const lines = (pending + decoder.decode(chunk, { stream: true })).split(
        /\r?\n/u,
      )
      pending = (lines.pop() ?? "").slice(-65536)
      for (const line of lines) {
        const outcome = lineOutcome(line)
        if (outcome === "finished") terminal = true
        if (outcome === "stopped") failed = true
      }
    },
  }
}

/** Observe a response with backpressure; never tee or buffer the whole stream. */
export async function trackClientRequest(
  c: Context,
  next: Next,
  apiKeyId: string,
): Promise<void> {
  const end = beginClientRequest(apiKeyId)
  const signal = c.req.raw.signal
  let ended = false
  const finish = (
    status: "finished" | "stopped",
    code: number | null,
  ): void => {
    if (ended) return
    ended = true
    signal.removeEventListener("abort", abort)
    end(status, code)
  }
  const abort = (): void => finish("stopped", null)
  signal.addEventListener("abort", abort, { once: true })
  if (signal.aborted) abort()

  try {
    await next()
    const response = c.res
    const status = response.status
    if (!response.ok || !response.body) {
      finish(response.ok ? "finished" : "stopped", status)
      return
    }
    const isSse =
      response.headers.get("content-type")?.includes("text/event-stream")
      ?? false
    const reader =
      response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>
    const observer = streamObserver()
    const body = new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          try {
            const chunk = await reader.read()
            if (chunk.done) {
              finish(
                isSse && !observer.completed() ? "stopped" : "finished",
                status,
              )
              controller.close()
              reader.releaseLock()
            } else {
              if (isSse) observer.push(chunk.value)
              controller.enqueue(chunk.value)
            }
          } catch (error) {
            finish("stopped", status)
            controller.error(error)
          }
        },
        async cancel(reason) {
          finish("stopped", status)
          await reader.cancel(reason)
        },
      },
      { highWaterMark: 0 },
    )
    c.res = new Response(body, {
      status,
      statusText: response.statusText,
      headers: response.headers,
    })
  } catch (error) {
    finish("stopped", null)
    throw error
  }
}
