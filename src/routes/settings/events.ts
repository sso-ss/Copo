/**
 * GET /settings/api/events — the SSE channel the Tauri shell subscribes to
 * for live state pushes (ADR-0007). Replaces the shell's per-section poll
 * loops: the sidecar emits a typed event the instant observable state
 * changes, so sign-in flips to "authenticated" the moment the device-code
 * poller resolves rather than on the next 2s tick.
 *
 * This route is a thin adapter over `settingsEventBus`: on connect it sends
 * the current snapshot, then writes every published event out as a named
 * SSE event whose `data` is the same JSON shape the matching GET returns
 * (e.g. `auth.changed` === GET /settings/api/auth/github/status). The shell
 * keeps those GETs for initial render + as a fallback when the stream drops.
 *
 * AUTH: gated like the rest of /settings/api/* — NOT in the unauth
 * allowlist. The browser/Tauri `EventSource` cannot send custom headers, so
 * the shell passes the key as `?key=<api_key>`. `extractRequestApiKey`
 * honours the query-string key ONLY for this exact path (see request-auth.ts);
 * never for any other endpoint, so keys don't broadly leak into URLs/logs.
 */

import { Hono } from "hono"
import { streamSSE, type SSEMessage } from "hono/streaming"

import { getAuthStatus } from "~/lib/auth/auth-controller"
import { settingsEventBus } from "~/lib/config/settings-events"
import { getClientActivitySnapshot } from "~/lib/http/client-activity"

/** Keep-alive cadence. Proxies and idle-connection reapers close silent
 *  streams; a periodic comment line keeps the channel warm at negligible
 *  cost. 15s is well under common 30–60s idle timeouts. */
const HEARTBEAT_MS = 15_000
const MAX_PENDING_FRAMES = 256

export const eventsRoutes = new Hono()

eventsRoutes.get("/", (c) =>
  streamSSE(c, async (stream) => {
    const pending: Array<SSEMessage> = []
    let wake: (() => void) | null = null
    const enqueue = (frame: SSEMessage): void => {
      if (stream.aborted) return
      // A stalled reader must not retain unlimited request history. Close
      // and let EventSource reconnect for a fresh authoritative snapshot.
      if (pending.length >= MAX_PENDING_FRAMES) {
        stream.abort()
        return
      }
      pending.push(frame)
      wake?.()
    }
    stream.onAbort(() => wake?.())
    const abort = (): void => stream.abort()
    c.req.raw.signal.addEventListener("abort", abort, { once: true })

    // Subscribe and capture snapshots synchronously BEFORE the first write
    // awaits backpressure. No request can fall into a snapshot/listener gap.
    const unsubscribers = [
      settingsEventBus.subscribe("connections.changed", () => {
        enqueue({ event: "connections.changed", data: "{}" })
      }),
      settingsEventBus.subscribe("auth.changed", (status) => {
        enqueue({ event: "auth.changed", data: JSON.stringify(status) })
      }),
      settingsEventBus.subscribe("activity.snapshot", (snapshot) => {
        enqueue({ event: "activity.snapshot", data: JSON.stringify(snapshot) })
      }),
      settingsEventBus.subscribe("activity.request", (event) => {
        enqueue({ event: "activity.request", data: JSON.stringify(event) })
      }),
    ]
    enqueue({ event: "auth.changed", data: JSON.stringify(getAuthStatus()) })
    enqueue({
      event: "activity.snapshot",
      data: JSON.stringify(getClientActivitySnapshot()),
    })
    const heartbeat = setInterval(() => {
      enqueue({ data: "", event: "ping" })
    }, HEARTBEAT_MS)

    if (c.req.raw.signal.aborted) stream.abort()
    try {
      while (!stream.aborted) {
        const frame = pending.shift()
        await (frame ?
          stream.writeSSE(frame)
        : new Promise<void>((resolve) => {
            wake = resolve
          }))
        wake = null
      }
    } finally {
      clearInterval(heartbeat)
      for (const unsubscribe of unsubscribers) unsubscribe()
      c.req.raw.signal.removeEventListener("abort", abort)
    }
  }),
)
