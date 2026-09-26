import type {
  CompanionTask,
  TaskEvent,
  TaskObservation,
  TaskSnapshot,
} from "./task-types"

const MAX_TASKS = 512
const MAX_EVENTS = 4096
const isActive = (task: CompanionTask): boolean =>
  task.status === "running" || task.status === "waiting"

/** Ordered, generation-bound tasks. A terminal event requires an observed start. */
export class TaskTracker {
  private tasks = new Map<string, CompanionTask>()
  private seen = new Set<string>()
  private pending = new Map<string, number>()
  private sources: Array<string> = []
  private eventId = 0

  public generation: string
  public since: number
  private publish: (event: TaskEvent) => void

  constructor(
    generation: string,
    since: number,
    publish: (event: TaskEvent) => void = () => {},
  ) {
    this.generation = generation
    this.since = since
    this.publish = publish
  }

  reset(generation: string, since: number): void {
    this.generation = generation
    this.since = since
    this.eventId = 0
    this.tasks.clear()
    this.seen.clear()
    this.pending.clear()
    this.sources = []
  }

  snapshot(): TaskSnapshot {
    return {
      generation: this.generation,
      eventId: this.eventId,
      tasks: [...this.tasks.values()].map((task) => ({ ...task })),
      sources: [...this.sources],
    }
  }

  setSources(sources: Array<string>, now: number): boolean {
    const next = [...new Set(sources)].sort()
    if (next.join(",") === this.sources.join(",")) return false
    this.sources = next
    for (const task of this.tasks.values()) {
      if (!next.includes(task.connectionId) && isActive(task)) {
        this.unavailable(task.taskId, now)
      }
    }
    return true
  }

  observe(observation: TaskObservation, generation: string): boolean {
    if (!this.accept(observation, generation)) return false
    const previous = this.tasks.get(observation.taskId)
    const task: CompanionTask = {
      taskId: observation.taskId,
      connectionId: observation.connectionId,
      parentTaskId: previous?.parentTaskId ?? observation.parentTaskId ?? null,
      startedAt: previous?.startedAt ?? observation.timestamp,
      updatedAt: observation.timestamp,
      status: observation.status === "started" ? "running" : observation.status,
    }
    if (task.status === "completed" && this.hasChildren(task.taskId)) {
      this.pending.set(task.taskId, task.updatedAt)
      return true
    }
    if (task.status !== "completed") this.pending.delete(task.taskId)
    this.emit(task)
    if (task.status === "unavailable" && task.parentTaskId)
      this.unavailable(task.parentTaskId, task.updatedAt)
    this.finishParents()
    return true
  }

  private accept(observation: TaskObservation, generation: string): boolean {
    if (
      generation !== this.generation
      || observation.timestamp < this.since
      || !Number.isFinite(observation.timestamp)
      || this.seen.has(observation.sourceEventId)
    )
      return false
    this.seen.add(observation.sourceEventId)
    const first = this.seen.values().next().value
    if (this.seen.size > MAX_EVENTS && first) this.seen.delete(first)
    const previous = this.tasks.get(observation.taskId)
    if (!previous) return observation.status === "started" && this.makeRoom()
    return (
      isActive(previous)
      && observation.timestamp >= previous.updatedAt
      && observation.status !== "started"
    )
  }

  unavailable(taskId: string, now: number): void {
    const task = this.tasks.get(taskId)
    if (!task || !isActive(task)) return
    this.pending.delete(taskId)
    this.emit({ ...task, status: "unavailable", updatedAt: now })
    // Lost child evidence cannot certify that its parent finished.
    if (task.parentTaskId) this.unavailable(task.parentTaskId, now)
  }

  private hasChildren(taskId: string): boolean {
    return [...this.tasks.values()].some(
      (task) => task.parentTaskId === taskId && isActive(task),
    )
  }

  private finishParents(): void {
    for (const [taskId, timestamp] of this.pending) {
      if (this.hasChildren(taskId)) continue
      this.pending.delete(taskId)
      const task = this.tasks.get(taskId)
      if (task && isActive(task)) {
        const children = [...this.tasks.values()].filter(
          (child) => child.parentTaskId === taskId,
        )
        this.emit({
          ...task,
          status:
            children.some((child) => child.status === "unavailable") ?
              "unavailable"
            : "completed",
          updatedAt: Math.max(
            timestamp,
            ...children.map((child) => child.updatedAt),
          ),
        })
      }
    }
  }

  private makeRoom(): boolean {
    if (this.tasks.size < MAX_TASKS) return true
    for (const [id, task] of this.tasks) {
      if (!isActive(task) && !this.pending.has(task.parentTaskId ?? "")) {
        this.tasks.delete(id)
        return true
      }
    }
    return false
  }

  private emit(task: CompanionTask): void {
    this.tasks.set(task.taskId, task)
    this.publish({
      generation: this.generation,
      eventId: ++this.eventId,
      task: { ...task },
    })
  }
}
