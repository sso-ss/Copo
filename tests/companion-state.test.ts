import { describe, expect, test } from "bun:test"

import type {
  ClientActivitySnapshot,
  ClientRequestEvent,
} from "~/lib/http/client-activity-types"

import { CompanionState } from "../shell/src/companion/state"

function snapshot(): ClientActivitySnapshot {
  return {
    generation: "session",
    eventId: 0,
    activity: [],
    activeRequests: [],
    recentEvents: [],
  }
}

function event(
  id: number,
  status: ClientRequestEvent["status"],
  count = 0,
): ClientRequestEvent {
  return {
    generation: "session",
    eventId: id,
    requestId: String(Math.ceil(id / 2)),
    apiKeyId: "tool",
    timestamp: 100,
    status,
    statusCode: status === "stopped" ? 502 : 200,
    removedApiKeyId: null,
    activity: {
      apiKeyId: "tool",
      status: count || status === "started" ? "working" : status,
      activeRequests: count,
      lastStartedAt: 100,
      lastFinishedAt: count ? null : 100,
      lastStatusCode: 200,
    },
  }
}

function ready(): CompanionState {
  const state = new CompanionState()
  state.update({
    gateway: "ready",
    account: { login: "user", host: "github.com", avatarUrl: null },
    availableToolIds: ["connection"],
    connections: [
      {
        id: "connection",
        name: "Tool",
        apiKeyId: "tool",
        shared: false,
        configured: true,
        section: "apps",
      },
    ],
    activity: snapshot(),
  })
  return state
}

test("Add a tool follows list membership rather than routing or activity", () => {
  const state = ready()
  const data = state.data
  if (!data) throw new Error("missing fixture")
  expect(state.canAddTool).toBe(false)

  const disabled = {
    ...data,
    connections: data.connections.map((connection) => ({
      ...connection,
      configured: false,
    })),
  }
  state.update(disabled)
  expect(state.canAddTool).toBe(false)

  const missing = { ...disabled, availableToolIds: ["connection", "new-tool"] }
  state.update(missing)
  expect(state.canAddTool).toBe(true)
  state.update({ ...missing, account: null })
  expect(state.canAddTool).toBe(false)
  state.update(missing)
  state.disconnect(10)
  expect(state.canAddTool).toBe(false)
  state.update({ ...missing, availableToolIds: [] })
  expect(state.canAddTool).toBe(false)
})

describe("companion request-only state", () => {
  test("a reachable gateway with lost authorization or an upstream rejection is not ready", () => {
    const state = ready()
    const data = state.data
    if (!data) throw new Error("missing fixture")
    state.snapshot({
      ...snapshot(),
      eventId: 2,
      recentEvents: [event(2, "finished")],
    })
    expect(state.ready).toBe(1)
    state.update(
      {
        ...data,
        activity: state.activity ?? snapshot(),
        gateway: "upstream-error",
      },
      100,
    )
    expect(state.ready).toBe(0)
    expect(state.display(100)).toMatchObject({
      pose: "failure",
      key: "companion-upstream-error",
    })
    expect(state.reaction?.until).toBe(4100)
    expect(state.display(4101)).toEqual({
      pose: "sleep",
      key: "companion-upstream-error",
    })
    state.update(
      {
        ...data,
        activity: state.activity ?? snapshot(),
        account: null,
        gateway: "sign-in-required",
      },
      5000,
    )
    expect(state.display(5000)).toEqual({
      pose: "sleep",
      key: "companion-sign-in-required",
    })
    expect(state.ready).toBe(0)
  })

  test("a request on an unnamed route still drives working without verifying a named tool", () => {
    const state = ready()
    const request = event(1, "started", 1)
    request.apiKeyId = "gateway:unattributed"
    request.activity.apiKeyId = request.apiKeyId
    state.request(request, 100)
    expect(state.display(100).pose).toBe("focus")
    expect(state.ready).toBe(0)
    state.request(
      {
        ...request,
        eventId: 2,
        status: "finished",
        activity: {
          ...request.activity,
          status: "finished",
          activeRequests: 0,
        },
      },
      200,
    )
    expect(state.display(200).pose).toBe("sleep")
    expect(state.reaction).toBeNull()
  })

  test("a configured tool waits for requests instead of claiming no tools exist", () => {
    const state = ready()
    expect(state.configured).toBe(1)
    expect(state.ready).toBe(0)
    expect(state.display(0)).toEqual({
      pose: "sleep",
      key: "companion-waiting",
    })
    expect(state.reaction).toBeNull()
    state.request(event(1, "started", 1), 0)
    expect(state.display(0).pose).toBe("focus")
    state.request(event(2, "finished"), 10)
    expect(state.display(10).key).toBe("companion-verified")
    expect(state.display(5009).pose).toBe("success")
    expect(state.display(5010).pose).toBe("idle")
    state.request(event(3, "started", 1), 6000)
    state.request(event(4, "finished"), 7000)
    expect(state.display(7000).pose).toBe("idle")
  })

  test("the happy pose lasts five seconds without being restarted by refreshes", () => {
    const state = ready()
    state.request(event(1, "started", 1), 0)
    state.request(event(2, "finished"), 100)
    const data = state.data
    const activity = state.activity
    if (!data || !activity) throw new Error("missing fixture")
    state.update({ ...data, activity }, 4000)
    state.request(event(2, "finished"), 4500)
    expect(state.display(5099).pose).toBe("success")
    expect(state.display(5100)).toEqual({
      pose: "idle",
      key: "companion-ready",
    })
    state.update({ ...data, activity }, 6000)
    expect(state.display(6000).pose).toBe("idle")
  })

  test("disabling the last configured tool restores the empty status", () => {
    const state = ready()
    const data = state.data
    if (!data) throw new Error("missing fixture")
    state.update({
      ...data,
      connections: data.connections.map((connection) => ({
        ...connection,
        configured: false,
      })),
    })
    expect(state.configured).toBe(0)
    expect(state.ready).toBe(0)
    expect(state.display(0)).toEqual({
      pose: "sleep",
      key: "companion-no-tools",
    })
  })

  test("snapshots never replay historical reactions", () => {
    const state = ready()
    state.snapshot({
      ...snapshot(),
      eventId: 2,
      recentEvents: [event(2, "finished")],
    })
    expect(state.display(0).pose).toBe("idle")
    expect(state.reaction).toBeNull()
  })

  test("a retained successful outcome survives recent-event history eviction", () => {
    const state = ready()
    state.snapshot({
      ...snapshot(),
      eventId: 300,
      activity: [event(2, "finished").activity],
      recentEvents: [],
    })
    expect(state.ready).toBe(1)
    expect(state.display(0)).toEqual({ pose: "idle", key: "companion-ready" })
    expect(state.reaction).toBeNull()
  })

  test("duplicates cannot restart reaction timers and gaps invalidate working claims", () => {
    const state = ready()
    state.request(event(1, "started", 1), 0)
    state.request(event(2, "stopped"), 10)
    state.request(event(2, "stopped"), 2000)
    expect(state.reaction?.until).toBe(4010)
    expect(state.request(event(4, "started", 1), 5000)).toBe(false)
    expect(state.display(5000).pose).toBe("sleep")
  })

  test("one request stopping cannot hide another tool's running work", () => {
    const state = ready()
    state.request(event(1, "started", 1), 0)
    const other = event(2, "started", 1)
    other.apiKeyId = "other"
    other.activity.apiKeyId = "other"
    state.request(other, 0)
    state.request(event(3, "stopped"), 10)
    expect(state.display(10).pose).toBe("focus")
    expect(state.activity?.recentEvents[0].status).toBe("stopped")
  })

  test("hover does not reset the underlying reaction deadline", () => {
    const state = ready()
    state.request(event(1, "started", 1), 0)
    state.request(event(2, "stopped"), 10)
    // The renderer overlays hover without changing state.
    expect(state.display(3000).pose).toBe("failure")
    expect(state.display(4011).pose).toBe("sleep")
  })

  test("new work interrupts verification; gateway loss overrides running state", () => {
    const state = ready()
    state.request(event(1, "started", 1), 0)
    state.request(event(2, "finished"), 10)
    state.request(event(3, "started", 1), 20)
    expect(state.display(20).pose).toBe("focus")
    state.disconnect(30)
    expect(state.display(30).pose).toBe("failure")
    expect(state.display(4031).pose).toBe("sleep")
    state.snapshot({ ...snapshot(), generation: "new-session" })
    expect(state.verified.size).toBe(0)
    expect(state.configured).toBe(1)
    expect(state.ready).toBe(0)
    expect(state.display(5000)).toEqual({
      pose: "sleep",
      key: "companion-waiting",
    })
  })
})
