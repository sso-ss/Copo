import type { CompanionData, CompanionConnection } from "../../../src/lib/config/companion-types";
import type { ClientActivitySnapshot, ClientRequestEvent } from "../../../src/lib/http/client-activity-types";
import type { TaskEvent, TaskSnapshot } from "../../../src/lib/companion/task-types";
import { CompanionTasks } from "./task-state";

export type Pose = "sleep" | "idle" | "focus" | "success" | "failure" | "hover";

const SUCCESS_REACTION_MS = 10000;

/** Task completion requires a client lifecycle event. Successful inference
 * alone only verifies a connection. Both local windows share these rules. */
export class CompanionState {
  data: CompanionData | null = null;
  activity: ClientActivitySnapshot | null = null;
  available = false;
  starting = true;
  verified = new Set<string>();
  reaction: { pose: Pose; until: number; key: string } | null = null;
  private requestEventId = 0;
  private requestVerified = new Set<string>();
  tasks = new CompanionTasks();

  snapshot(snapshot: ClientActivitySnapshot, preserveLiveEvents = false): void {
    const previous = this.activity;
    if (previous?.generation === snapshot.generation && previous.eventId > snapshot.eventId) return;
    if (previous?.generation !== snapshot.generation) {
      this.verified.clear();
      this.reaction = null;
      this.tasks = new CompanionTasks();
    }
    this.activity = snapshot;
    this.available = true;
    this.starting = false;
    if (this.running > 0) this.reaction = null;
    for (const event of snapshot.recentEvents) {
      if (event.status === "finished") this.verified.add(event.apiKeyId);
    }
    // The bounded event history may have dropped a tool's last success while
    // its current aggregate still retains that outcome. Reopening the panel
    // must not lose this evidence or replay the success reaction.
    for (const activity of snapshot.activity) {
      if (activity.status === "finished") this.verified.add(activity.apiKeyId);
    }
    // A poll can overtake an in-flight stream event. Only initial/recovery
    // snapshots establish the live baseline; ordinary polls must not consume
    // the verification event before it reaches the companion.
    if (!preserveLiveEvents || previous?.generation !== snapshot.generation) {
      this.requestEventId = snapshot.eventId;
      this.requestVerified = new Set(this.verified);
    }
  }

  update(data: CompanionData, now = Date.now()): void {
    const previousHealth = this.data?.gateway;
    const available = this.available;
    this.data = data;
    this.snapshot(data.activity, this.available);
    if (data.tasks) this.taskSnapshot(data.tasks, available);
    else this.tasks = new CompanionTasks();
    if (data.gateway === "upstream-error" && previousHealth !== data.gateway) {
      this.reaction = { pose: "failure", until: now + 4000, key: "companion-upstream-error" };
    }
    if (data.gateway === "sign-in-required") this.reaction = null;
  }

  taskSnapshot(snapshot: TaskSnapshot, preserveLiveEvents = false): void {
    if (snapshot.generation !== this.activity?.generation) return;
    this.tasks.snapshot(snapshot, preserveLiveEvents);
    if (this.running > 0 || this.tasks.waiting > 0) this.reaction = null;
  }

  task(event: TaskEvent, now: number): boolean {
    this.display(now);
    if (event.generation !== this.activity?.generation) return false;
    const outcome = this.tasks.event(event);
    if (outcome === "gap") { this.available = false; return false; }
    if (outcome === "old" || event.task.parentTaskId) return true;
    const status = event.task.status;
    if (status === "running" || status === "waiting" || status === "unavailable") this.reaction = null;
    if (!this.available) return true;
    if (status === "failed" || status === "cancelled") this.reaction = { pose: "failure", until: now + 4000, key: `companion-task-${status}` };
    else if (this.running === 0 && this.tasks.waiting === 0 && status === "completed" && this.data?.gateway === "ready" && this.data.account
      && this.data.connections.some((connection) => connection.id === event.task.connectionId && connection.configured)
      && this.reaction?.pose !== "failure") this.reaction = { pose: "success", until: now + SUCCESS_REACTION_MS, key: "companion-task-completed" };
    return true;
  }

  request(event: ClientRequestEvent, now: number): boolean {
    this.display(now);
    const snapshot = this.activity;
    if (!snapshot || event.generation !== snapshot.generation) {
      this.available = false;
      return false;
    }
    if (event.eventId <= this.requestEventId) return true;
    if (event.eventId !== this.requestEventId + 1) {
      this.available = false;
      return false;
    }
    this.requestEventId = event.eventId;
    if (event.eventId > snapshot.eventId) {
      snapshot.eventId = event.eventId;
      snapshot.activity = snapshot.activity.filter((entry) => entry.apiKeyId !== event.apiKeyId && entry.apiKeyId !== event.removedApiKeyId);
      snapshot.activity.push(event.activity);
      snapshot.activeRequests = snapshot.activeRequests.filter((request) => request.requestId !== event.requestId);
      if (event.status === "started") snapshot.activeRequests.push(event);
      else snapshot.recentEvents = [...snapshot.recentEvents, event].slice(-256);
    }
    if (event.status === "started") {
      this.reaction = null;
    } else {
      const newlyVerified = event.status === "finished" && !this.requestVerified.has(event.apiKeyId);
      if (event.status === "finished") {
        this.verified.add(event.apiKeyId);
        this.requestVerified.add(event.apiKeyId);
      }
      // Never replay an outcome superseded by work already observed in a poll.
      if (event.eventId === snapshot.eventId && this.running === 0 && this.tasks.waiting === 0) {
        if (event.status === "stopped") this.reaction = { pose: "failure", until: now + 4000, key: "companion-interrupted" };
        else if (newlyVerified && this.data?.gateway === "ready" && this.data.account && this.data.connections.some((c) => c.configured && c.apiKeyId === event.apiKeyId)
          && this.reaction?.pose !== "failure")
          this.reaction = { pose: "success", until: now + SUCCESS_REACTION_MS, key: "companion-verified" };
      }
    }
    return true;
  }

  disconnect(now: number): void {
    if (this.available) this.reaction = { pose: "failure", until: now + 4000, key: "companion-lost" };
    this.available = false;
  }

  get running(): number {
    return (this.activity?.activity.reduce((sum, entry) => sum + entry.activeRequests, 0) ?? 0) + this.tasks.running;
  }

  connected(connection: CompanionConnection): boolean {
    return this.available && this.data?.gateway === "ready" && !!this.data.account && connection.configured
      && connection.apiKeyId !== null && this.verified.has(connection.apiKeyId);
  }

  get ready(): number { return this.data?.connections.filter((c) => this.connected(c)).length ?? 0; }

  get configured(): number { return this.data?.connections.filter((c) => c.configured).length ?? 0; }

  get canAddTool(): boolean {
    if (!this.available || !this.data?.account) return false;
    const added = new Set(this.data.connections.filter((connection) => connection.section === "apps").map((connection) => connection.id));
    // Older gateways already list every supported app and have no catalog field.
    return this.data.availableToolIds?.some((id) => !added.has(id)) ?? false;
  }

  display(now: number): { pose: Pose; key: string } {
    if (this.reaction && this.reaction.until <= now) this.reaction = null;
    if (!this.available) return {
      pose: this.reaction?.pose ?? "sleep",
      key: this.starting ? "companion-starting" : "companion-unavailable",
    };
    if (this.data?.gateway === "sign-in-required") return { pose: "sleep", key: "companion-sign-in-required" };
    if (this.data?.gateway === "upstream-error") return this.reaction?.pose === "failure" ? this.reaction : { pose: "sleep", key: "companion-upstream-error" };
    if (this.running > 0) return { pose: "focus", key: "companion-working" };
    if (this.tasks.waiting > 0) return { pose: "idle", key: "companion-task-waiting" };
    if (this.reaction) return this.reaction;
    if (this.ready > 0) return { pose: "idle", key: "companion-ready" };
    return { pose: "sleep", key: this.configured > 0 ? "companion-waiting" : "companion-no-tools" };
  }
}
