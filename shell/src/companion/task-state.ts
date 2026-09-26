import type { CompanionTask, TaskEvent, TaskSnapshot } from "../../../src/lib/companion/task-types";

/** Polls may update rows before the ordered event reaches the animation. */
export class CompanionTasks {
  data: TaskSnapshot | null = null;
  private eventId = 0;

  snapshot(snapshot: TaskSnapshot, preserveLiveEvents = false): void {
    const previous = this.data;
    if (previous?.generation === snapshot.generation && previous.eventId > snapshot.eventId) return;
    this.data = snapshot;
    if (!preserveLiveEvents || previous?.generation !== snapshot.generation) this.eventId = snapshot.eventId;
  }

  event(event: TaskEvent): "current" | "old" | "gap" {
    const data = this.data;
    if (!data || data.generation !== event.generation) return "gap";
    if (event.eventId <= this.eventId) return "old";
    if (event.eventId !== this.eventId + 1) return "gap";
    this.eventId = event.eventId;
    if (event.eventId > data.eventId) {
      data.eventId = event.eventId;
      data.tasks = [...data.tasks.filter((task) => task.taskId !== event.task.taskId), event.task].slice(-512);
    }
    return event.eventId === data.eventId ? "current" : "old";
  }

  forConnection(connectionId?: string): CompanionTask[] {
    return this.data?.tasks.filter((task) => !task.parentTaskId && (!connectionId || task.connectionId === connectionId)) ?? [];
  }

  get running(): number { return this.forConnection().filter((task) => task.status === "running").length; }
  get waiting(): number { return this.forConnection().filter((task) => task.status === "waiting").length; }
}
