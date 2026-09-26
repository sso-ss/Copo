/** Requests without a named key are visible without guessing which tool sent them. */
export const UNATTRIBUTED_CLIENT_ID = "gateway:unattributed"

/** Public activity metadata. Never include credentials or inference contents. */
export interface ClientActivity {
  apiKeyId: string
  status: "working" | "finished" | "stopped"
  activeRequests: number
  lastStartedAt: number
  lastFinishedAt: number | null
  lastStatusCode: number | null
}

/** A request outcome is not a tool's whole-task outcome. */
export interface ClientRequestEvent {
  generation: string
  eventId: number
  requestId: string
  apiKeyId: string
  status: "started" | "finished" | "stopped"
  timestamp: number
  statusCode: number | null
  activity: ClientActivity
  /** An idle summary evicted when this request started. */
  removedApiKeyId: string | null
}

export interface ClientActivitySnapshot {
  /** Changes on process restart or an upstream authentication session change. */
  generation: string
  /** Last event represented here; only apply subsequent live events. */
  eventId: number
  activity: Array<ClientActivity>
  activeRequests: Array<ClientRequestEvent>
  /** Bounded outcome history, for display only; never replay as celebrations. */
  recentEvents: Array<ClientRequestEvent>
}
