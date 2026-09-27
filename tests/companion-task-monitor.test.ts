import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { TaskMonitor, type TaskSource } from "~/lib/companion/task-monitor"
import { TaskTracker } from "~/lib/companion/task-tracker"

const directories: Array<string> = []
afterEach(() => {
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true })
})
const header = {
  type: "session_meta",
  payload: { id: "thread", model_provider: "copo-app", source: "vscode" },
}
const line = (value: unknown) => `${JSON.stringify(value)}\n`
const event = (type: string, timestamp: number, turn = "turn") => ({
  type: "event_msg",
  timestamp: new Date(timestamp).toISOString(),
  payload: { type, turn_id: turn },
})

function fixture(sessionProvider = "copo-app") {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "copo-task-monitor-"))
  directories.push(directory)
  const file = path.join(directory, "session.jsonl")
  fs.writeFileSync(
    file,
    line({
      ...header,
      payload: { ...header.payload, model_provider: sessionProvider },
    }),
  )
  const sourceSnapshots: Array<Array<string>> = []
  const tracker = new TaskTracker("g", 0, {
    snapshot: (snapshot) => {
      sourceSnapshots.push(snapshot.sources)
    },
  })
  let sources: Array<TaskSource> = [
    { connectionId: "codex", directory, provider: "copo-app" },
  ]
  const monitor = new TaskMonitor(tracker, () => sources)
  return {
    file,
    directory,
    tracker,
    monitor,
    sourceSnapshots,
    disable: () => {
      sources = []
    },
  }
}

describe("read-only task monitor", () => {
  test("a chat using CoPo's former provider still reports its completed turn", async () => {
    const { file, tracker, monitor, sourceSnapshots, disable } =
      fixture("maximal-app")
    await monitor.poll(10)
    expect(sourceSnapshots).toEqual([["codex"]])
    fs.appendFileSync(file, line(event("task_started", 20)))
    await monitor.poll(30)
    expect(tracker.snapshot().tasks[0].status).toBe("running")
    fs.appendFileSync(file, line(event("task_complete", 40)))
    await monitor.poll(50)
    expect(tracker.snapshot().tasks[0].status).toBe("completed")
    disable()
    await monitor.poll(60)
    expect(sourceSnapshots).toEqual([["codex"], []])
  })

  test("retained history is a baseline; newly appended task events survive request gaps and split writes", async () => {
    const { file, tracker, monitor } = fixture()
    fs.appendFileSync(
      file,
      line(event("task_started", 10, "old"))
        + line(event("task_complete", 20, "old")),
    )
    await monitor.poll(30)
    expect(tracker.snapshot().tasks).toEqual([])
    fs.appendFileSync(file, line(event("task_started", 40)))
    await monitor.poll(50)
    expect(tracker.snapshot().tasks[0].status).toBe("running")
    await monitor.poll(60000)
    expect(tracker.snapshot().tasks[0].status).toBe("running")
    const finish = line(event("task_complete", 70000))
    fs.appendFileSync(file, finish.slice(0, 30))
    await monitor.poll(70001)
    expect(tracker.snapshot().tasks[0].status).toBe("running")
    fs.appendFileSync(file, finish.slice(30))
    await monitor.poll(70002)
    expect(tracker.snapshot().tasks[0].status).toBe("completed")
    const watermark = tracker.snapshot().eventId
    await monitor.poll(70003)
    expect(tracker.snapshot().eventId).toBe(watermark)
  })

  test("generation resets and disabling a route cannot replay a completion", async () => {
    const { file, tracker, monitor, disable } = fixture()
    await monitor.poll(10)
    fs.appendFileSync(file, line(event("task_started", 20)))
    await monitor.poll(30)
    tracker.reset("new", 40)
    await monitor.poll(50)
    fs.appendFileSync(file, line(event("task_complete", 60)))
    await monitor.poll(70)
    expect(tracker.snapshot().tasks).toEqual([])
    fs.appendFileSync(file, line(event("task_started", 80, "next")))
    await monitor.poll(90)
    disable()
    await monitor.poll(100)
    expect(tracker.snapshot().tasks[0].status).toBe("unavailable")
    expect(tracker.snapshot().sources).toEqual([])
  })

  test("file replacement loses evidence instead of inventing completion", async () => {
    const { file, tracker, monitor } = fixture()
    await monitor.poll(10)
    fs.appendFileSync(file, line(event("task_started", 20)))
    await monitor.poll(30)
    fs.unlinkSync(file)
    fs.writeFileSync(file, line(header) + line(event("task_complete", 40)))
    await monitor.poll(50)
    expect(tracker.snapshot().tasks[0].status).toBe("unavailable")
  })

  test("several turns appended in one scan preserve their terminal outcomes", async () => {
    const { file, tracker, monitor } = fixture()
    await monitor.poll(10)
    fs.appendFileSync(
      file,
      line(event("task_started", 20, "first"))
        + line(event("task_complete", 30, "first"))
        + line(event("task_started", 40, "second"))
        + line(event("task_complete", 50, "second")),
    )
    await monitor.poll(60)
    expect(tracker.snapshot().tasks.map((task) => task.status)).toEqual([
      "completed",
      "completed",
    ])
  })

  test("lost records between a start and finish cannot certify success in the same scan", async () => {
    const { file, tracker, monitor } = fixture()
    await monitor.poll(10)
    fs.appendFileSync(
      file,
      line(event("task_started", 20))
        + "{broken\n"
        + line(event("task_complete", 30)),
    )
    await monitor.poll(40)
    expect(tracker.snapshot().tasks[0].status).toBe("unavailable")
  })

  test("Claude's real turn-boundary shape completes a locally observed prompt", async () => {
    const { directory, tracker } = fixture()
    const monitor = new TaskMonitor(tracker, () => [
      { connectionId: "claude-code", directory },
    ])
    await monitor.poll(10)
    const file = path.join(directory, "claude.jsonl")
    const common = {
      sessionId: "session",
      isSidechain: false,
      version: "2.1.273",
    }
    fs.writeFileSync(
      file,
      line({
        ...common,
        type: "user",
        promptId: "prompt",
        timestamp: new Date(20).toISOString(),
        message: { content: "private prompt" },
      }),
    )
    await monitor.poll(30)
    expect(tracker.snapshot().tasks[0].status).toBe("running")
    fs.appendFileSync(
      file,
      line({
        ...common,
        type: "system",
        subtype: "turn_duration",
        durationMs: 1000,
        timestamp: new Date(40).toISOString(),
      }),
    )
    await monitor.poll(50)
    expect(tracker.snapshot().tasks[0].status).toBe("completed")
    expect(JSON.stringify(tracker.snapshot())).not.toContain("private")
    expect(JSON.stringify(tracker.snapshot())).not.toContain(directory)
  })
})
