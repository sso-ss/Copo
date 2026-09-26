import type { CompanionData, CompanionConnection } from "../../../src/lib/config/companion-types";
import type { ClientActivitySnapshot, ClientRequestEvent } from "../../../src/lib/http/client-activity-types";

export type Pose = "sleep" | "idle" | "focus" | "success" | "failure" | "hover";

const SUCCESS_REACTION_MS = 5000;

/** Shared display rules for both local windows. Only live verification can
 * celebrate here; successful inference never means a whole task completed. */
export class CompanionState {
  data: CompanionData | null = null;
  activity: ClientActivitySnapshot | null = null;
  available = false;
  starting = true;
  verified = new Set<string>();
  reaction: { pose: Pose; until: number; key: string } | null = null;

  snapshot(snapshot: ClientActivitySnapshot): void {
    const previous = this.activity;
    if (previous?.generation === snapshot.generation && previous.eventId > snapshot.eventId) return;
    if (previous?.generation !== snapshot.generation) {
      this.verified.clear();
      this.reaction = null;
    }
    this.activity = snapshot;
    this.available = true;
    this.starting = false;
    for (const event of snapshot.recentEvents) {
      if (event.status === "finished") this.verified.add(event.apiKeyId);
    }
    // The bounded event history may have dropped a tool's last success while
    // its current aggregate still retains that outcome. Reopening the panel
    // must not lose this evidence or replay the success reaction.
    for (const activity of snapshot.activity) {
      if (activity.status === "finished") this.verified.add(activity.apiKeyId);
    }
  }

  update(data: CompanionData, now = Date.now()): void {
    const previousHealth = this.data?.gateway;
    this.data = data;
    this.snapshot(data.activity);
    if (data.gateway === "upstream-error" && previousHealth !== data.gateway) {
      this.reaction = { pose: "failure", until: now + 4000, key: "companion-upstream-error" };
    }
    if (data.gateway === "sign-in-required") this.reaction = null;
  }

  request(event: ClientRequestEvent, now: number): boolean {
    this.display(now);
    const snapshot = this.activity;
    if (!snapshot || event.generation !== snapshot.generation) {
      this.available = false;
      return false;
    }
    if (event.eventId <= snapshot.eventId) return true;
    if (event.eventId !== snapshot.eventId + 1) {
      this.available = false;
      return false;
    }
    snapshot.eventId = event.eventId;
    snapshot.activity = snapshot.activity.filter((entry) => entry.apiKeyId !== event.apiKeyId && entry.apiKeyId !== event.removedApiKeyId);
    snapshot.activity.push(event.activity);
    snapshot.activeRequests = snapshot.activeRequests.filter((request) => request.requestId !== event.requestId);
    if (event.status === "started") {
      snapshot.activeRequests.push(event);
      this.reaction = null;
    } else {
      snapshot.recentEvents = [...snapshot.recentEvents, event].slice(-256);
      const newlyVerified = event.status === "finished" && !this.verified.has(event.apiKeyId);
      if (event.status === "finished") this.verified.add(event.apiKeyId);
      if (this.running === 0) {
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
    return this.activity?.activity.reduce((sum, entry) => sum + entry.activeRequests, 0) ?? 0;
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
    if (this.running > 0) return { pose: "focus", key: "companion-working" };
    if (this.reaction) return this.reaction;
    if (this.data?.gateway === "upstream-error") return { pose: "sleep", key: "companion-upstream-error" };
    if (this.ready > 0) return { pose: "idle", key: "companion-ready" };
    return { pose: "sleep", key: this.configured > 0 ? "companion-waiting" : "companion-no-tools" };
  }
}
