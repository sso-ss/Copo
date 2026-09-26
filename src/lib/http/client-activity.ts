import { settingsEventBus } from "~/lib/config/settings-events"

import type {
  ClientActivity,
  ClientActivitySnapshot,
  ClientRequestEvent,
} from "./client-activity-types"

export type { ClientActivity } from "./client-activity-types"

const activity = new Map<string, ClientActivity>()
const MAX_IDLE_ENTRIES = 1024
const MAX_RECENT_EVENTS = 256
const activeRequests = new Map<string, ClientRequestEvent>()
const recentEvents: Array<ClientRequestEvent> = []
let generation = crypto.randomUUID()
let eventId = 0

function copyEvent(event: ClientRequestEvent): ClientRequestEvent {
  return { ...event, activity: { ...event.activity } }
}

export function beginClientRequest(
  apiKeyId: string,
): (status: "finished" | "stopped", statusCode: number | null) => void {
  const requestId = crypto.randomUUID()
  const requestGeneration = generation
  let removedApiKeyId: string | null = null
  // Bound idle history without evicting a request that is still running.
  if (activity.size >= MAX_IDLE_ENTRIES && !activity.has(apiKeyId)) {
    for (const [id, entry] of activity) {
      if (entry.activeRequests === 0) {
        activity.delete(id)
        removedApiKeyId = id
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
  const publish = (
    status: ClientRequestEvent["status"],
    statusCode: number | null,
  ): void => {
    const event: ClientRequestEvent = {
      generation,
      eventId: ++eventId,
      requestId,
      apiKeyId,
      status,
      timestamp: Date.now(),
      statusCode,
      activity: { ...entry },
      removedApiKeyId: status === "started" ? removedApiKeyId : null,
    }
    if (status === "started") activeRequests.set(requestId, event)
    else {
      activeRequests.delete(requestId)
      recentEvents.push(event)
      if (recentEvents.length > MAX_RECENT_EVENTS) recentEvents.shift()
    }
    settingsEventBus.publish("activity.request", copyEvent(event))
  }
  publish("started", null)
  let done = false
  return (status, statusCode) => {
    // An old response can finish after switching account. It cannot revive
    // that session's counters or emit an outcome in the new generation.
    if (done || requestGeneration !== generation) return
    done = true
    entry.activeRequests--
    entry.status = entry.activeRequests > 0 ? "working" : status
    entry.lastFinishedAt = Date.now()
    entry.lastStatusCode = statusCode
    publish(status, statusCode)
  }
}

export function listClientActivity(): Array<ClientActivity> {
  return [...activity.values()].map((entry) => ({ ...entry }))
}

export function getClientActivitySnapshot(): ClientActivitySnapshot {
  return {
    generation,
    eventId,
    activity: listClientActivity(),
    activeRequests: [...activeRequests.values()].map((event) =>
      copyEvent(event),
    ),
    recentEvents: recentEvents.map((event) => copyEvent(event)),
  }
}

function clearActivity(): void {
  generation = crypto.randomUUID()
  eventId = 0
  activity.clear()
  activeRequests.clear()
  recentEvents.length = 0
}

/** Invalidate observations when the upstream authentication session changes. */
export function resetClientActivity(): void {
  clearActivity()
  settingsEventBus.publish("activity.snapshot", getClientActivitySnapshot())
}

export function __resetClientActivityForTests(): void {
  clearActivity()
}
