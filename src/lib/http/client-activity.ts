/** Request activity per named API key. No prompts, responses, or secrets retained. */
export interface ClientActivity {
  apiKeyId: string
  status: "working" | "finished" | "stopped"
  activeRequests: number
  lastStartedAt: number
  lastFinishedAt: number | null
  lastStatusCode: number | null
}

const activity = new Map<string, ClientActivity>()
const MAX_IDLE_ENTRIES = 1024

export function beginClientRequest(
  apiKeyId: string,
): (status: "finished" | "stopped", statusCode: number | null) => void {
  // Bound idle history without evicting a request that is still running.
  if (activity.size >= MAX_IDLE_ENTRIES && !activity.has(apiKeyId)) {
    for (const [id, entry] of activity) {
      if (entry.activeRequests === 0) {
        activity.delete(id)
        break
      }
    }
  }
  const entry = activity.get(apiKeyId) ?? {
    apiKeyId,
    status: "working",
    activeRequests: 0,
    lastStartedAt: 0,
    lastFinishedAt: null,
    lastStatusCode: null,
  }
  entry.activeRequests++
  entry.status = "working"
  entry.lastStartedAt = Date.now()
  activity.set(apiKeyId, entry)
  let done = false
  return (status, statusCode) => {
    if (done) return
    done = true
    entry.activeRequests--
    entry.status = entry.activeRequests > 0 ? "working" : status
    entry.lastFinishedAt = Date.now()
    entry.lastStatusCode = statusCode
  }
}

export function listClientActivity(): Array<ClientActivity> {
  return [...activity.values()].map((entry) => ({ ...entry }))
}

export function __resetClientActivityForTests(): void {
  activity.clear()
}
