import { describe, expect, test } from "bun:test"

import type { TaskEvent, TaskObservation } from "~/lib/companion/task-types"

import { TaskTracker } from "~/lib/companion/task-tracker"

import { CompanionState } from "../shell/src/companion/state"

function fixture() {
  const state = new CompanionState()
  const events: Array<TaskEvent> = []
  const tracker = new TaskTracker("generation", 0, (event) => {
    events.push(event)
    state.task(event, event.task.updatedAt)
  })
  state.update(
    {
      gateway: "ready",
      account: { login: "test", host: "github.com", avatarUrl: null },
      availableToolIds: ["codex", "claude-code"],
      connections: ["codex", "claude-code"].map((id) => ({
        id,
        name: id,
        apiKeyId: id,
        configured: true,
        shared: false,
        section: "apps" as const,
      })),
      activity: {
        generation: "generation",
        eventId: 0,
        activeRequests: [],
        recentEvents: [],
        activity: [],
      },
      tasks: tracker.snapshot(),
    },
    0,
  )
  const send = (
    status: TaskObservation["status"],
    timestamp: number,
    options: Partial<TaskObservation> = {},
  ) =>
    tracker.observe(
      {
        sourceEventId: `${status}:${timestamp}`,
        taskId: "codex:turn",
        connectionId: "codex",
        status,
        timestamp,
        ...options,
      },
      "generation",
    )
  return { state, tracker, send, events }
}

describe("whole-task companion state", () => {
  test("request gaps stay focused and an authoritative finish holds happiness for ten seconds", () => {
    const { state, send } = fixture()
    send("started", 10)
    expect(state.display(50000)).toEqual({
      pose: "focus",
      key: "companion-working",
    })
    send("completed", 60000)
    expect(state.display(60000).key).toBe("companion-task-completed")
    expect(state.display(69999).pose).toBe("success")
    expect(state.display(70000).pose).not.toBe("success")
  })

  test("waiting and resumed are separate from completed or failed", () => {
    const { state, send } = fixture()
    send("started", 10)
    send("waiting", 20)
    expect(state.display(20)).toEqual({
      pose: "approval",
      key: "companion-task-waiting",
    })
    send("running", 30)
    expect(state.display(30).pose).toBe("focus")
    send("completed", 40)
    expect(state.display(40).pose).toBe("success")
  })

  test.each(["cancelled", "failed"] as const)("%s is never happy", (status) => {
    const { state, send } = fixture()
    send("started", 10)
    send(status, 20)
    expect(state.display(20).key).toBe(`companion-task-${status}`)
    send("completed", 30)
    expect(state.display(30).pose).toBe("failure")
  })

  test("new work interrupts happiness and another running tool retains focus", () => {
    const { state, send } = fixture()
    send("started", 10)
    send("started", 20, {
      taskId: "claude-code:other",
      connectionId: "claude-code",
    })
    send("completed", 30)
    expect(state.display(30).pose).toBe("focus")
    send("completed", 40, {
      taskId: "claude-code:other",
      connectionId: "claude-code",
    })
    expect(state.display(40).pose).toBe("success")
    send("started", 50, { taskId: "codex:next" })
    expect(state.display(50).pose).toBe("focus")
  })

  test("a parent finish waits for explicit completion of observed child work", () => {
    const { state, send, tracker } = fixture()
    send("started", 10)
    send("started", 20, { taskId: "codex:child", parentTaskId: "codex:turn" })
    send("completed", 30)
    expect(state.display(30).pose).toBe("focus")
    send("completed", 40, { taskId: "codex:child" })
    expect(state.display(40).pose).toBe("success")
    expect(
      tracker.snapshot().tasks.find((task) => task.taskId === "codex:turn")
        ?.updatedAt,
    ).toBe(40)
  })

  test("simultaneous outcomes retain failure while other work takes pose priority", () => {
    const { state, send } = fixture()
    send("started", 10)
    send("started", 20, { taskId: "codex:other" })
    send("failed", 30)
    expect(state.display(30).pose).toBe("focus")
    send("completed", 40, { taskId: "codex:other" })
    expect(state.display(40).pose).toBe("failure")
  })

  test("lost child evidence cannot complete its parent", () => {
    const { state, send, tracker } = fixture()
    send("started", 10)
    send("started", 20, { taskId: "codex:child", parentTaskId: "codex:turn" })
    send("completed", 30)
    tracker.unavailable("codex:child", 40)
    expect(state.display(40).pose).not.toBe("success")
    expect(
      tracker.snapshot().tasks.every((task) => task.status === "unavailable"),
    ).toBe(true)
  })
})

describe("task event reconciliation", () => {
  test("polls and duplicate deliveries cannot swallow or extend happiness", () => {
    const { state, tracker } = fixture()
    const separate = new TaskTracker("generation", 0)
    separate.observe(
      {
        sourceEventId: "start",
        taskId: "codex:turn",
        connectionId: "codex",
        status: "started",
        timestamp: 10,
      },
      "generation",
    )
    separate.observe(
      {
        sourceEventId: "finish",
        taskId: "codex:turn",
        connectionId: "codex",
        status: "completed",
        timestamp: 20,
      },
      "generation",
    )
    state.taskSnapshot(separate.snapshot(), true)
    const task = separate.snapshot().tasks[0]
    state.task(
      {
        generation: tracker.generation,
        eventId: 1,
        task: { ...task, status: "running", updatedAt: 10 },
      },
      30,
    )
    const event = { generation: tracker.generation, eventId: 2, task }
    state.task(event, 40)
    expect(state.display(40).pose).toBe("success")
    state.taskSnapshot(separate.snapshot(), true)
    state.task(event, 5000)
    expect(state.display(10039).pose).toBe("success")
    expect(state.display(10040).pose).not.toBe("success")
  })

  test("historical snapshots, unknown completions and prior generations do not celebrate", () => {
    const { state, tracker, send } = fixture()
    expect(send("completed", 10)).toBe(false)
    send("started", 20)
    send("completed", 30)
    const historical = tracker.snapshot()
    state.reaction = null
    state.taskSnapshot(historical)
    expect(state.display(100).pose).not.toBe("success")
    tracker.reset("new-generation", 100)
    expect(send("completed", 200)).toBe(false)
    expect(tracker.snapshot().tasks).toEqual([])
  })

  test("missing task events invalidate focus until a fresh snapshot", () => {
    const { state, send, events } = fixture()
    send("started", 10)
    expect(state.task({ ...events[0], eventId: 3 }, 20)).toBe(false)
    expect(state.display(20).pose).not.toBe("focus")
  })
})
