import type { TaskObservation } from "./task-types"

const CODEX_TERMINAL: Record<string, TaskObservation["status"] | undefined> = {
  task_complete: "completed",
  turn_aborted: "cancelled",
  turn_failed: "failed",
}

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ?
      (value as Record<string, unknown>)
    : {}
}

export function identifier(value: unknown): string | null {
  return typeof value === "string" && /^[\w.-]{1,160}$/u.test(value) ?
      value
    : null
}

export interface TaskRecordParser {
  taskId: string | null
  consume(value: unknown, sourceEventId: string): Array<TaskObservation>
}

/** Reads only lifecycle fields from Codex's locally persisted protocol events. */
export class CodexTaskRecords implements TaskRecordParser {
  taskId: string | null = null
  private eligible = false
  private parent = false
  private inputCall: string | null = null

  private provider: string

  constructor(provider: string) {
    this.provider = provider
  }

  consume(value: unknown, sourceEventId: string): Array<TaskObservation> {
    const row = record(value)
    const payload = record(row.payload)
    if (row.type === "session_meta") {
      const sessionProvider = payload.model_provider
      this.eligible =
        (sessionProvider === this.provider
          // Existing Codex chats retain the provider recorded when the chat
          // began, even after CoPo migrates its route to copo-app.
          || (/^copo-app(?:-\d+)?$/u.test(this.provider)
            && typeof sessionProvider === "string"
            && /^maximal-app(?:-\d+)?$/u.test(sessionProvider)))
        && Boolean(identifier(payload.id))
      this.parent =
        typeof payload.source === "object" && payload.source !== null
      return []
    }
    if (!this.eligible) return []
    const timestamp =
      typeof row.timestamp === "string" ? Date.parse(row.timestamp) : Number.NaN
    const observations: Array<TaskObservation> = []
    const emit = (
      status: TaskObservation["status"],
      taskId = this.taskId,
      parentTaskId?: string,
    ): void => {
      if (taskId)
        observations.push({
          sourceEventId: `${sourceEventId}:${status}`,
          taskId,
          connectionId: "codex",
          status,
          timestamp,
          parentTaskId,
        })
    }
    if (row.type === "event_msg") this.event(payload, emit)
    else if (row.type === "response_item") this.response(payload, emit)

    return observations
  }
  private event(
    payload: Record<string, unknown>,
    emit: (
      status: TaskObservation["status"],
      taskId?: string | null,
      parentTaskId?: string,
    ) => void,
  ): void {
    const turn = identifier(payload.turn_id)
    if (payload.type === "task_started" && turn) {
      if (this.taskId && this.taskId !== `codex:${turn}`) emit("unavailable")
      this.taskId = `codex:${turn}`
      const root = identifier(payload.root_turn_id)
      const parent =
        this.parent ?
          `codex:${root && root !== turn ? root : "unattributed-child"}`
        : undefined
      emit("started", this.taskId, parent)
      return
    }
    if (payload.type === "error" && payload.will_retry !== true) emit("failed")
    if (!turn || this.taskId !== `codex:${turn}`) return
    const status = CODEX_TERMINAL[String(payload.type)]
    if (status) emit(status)
  }

  private response(
    payload: Record<string, unknown>,
    emit: (status: TaskObservation["status"]) => void,
  ): void {
    if (
      payload.type === "function_call"
      && ["functions.request_user_input", "request_user_input"].includes(
        String(payload.name),
      )
    ) {
      this.inputCall = identifier(payload.call_id)
      emit("waiting")
    } else if (
      payload.type === "function_call_output"
      && this.inputCall
      && payload.call_id === this.inputCall
    ) {
      this.inputCall = null
      emit("running")
    }
  }
}

/** Claude's turn_duration is emitted after the turn loop/Stop hooks, not on
 * each model response. Nonzero child counts explicitly withhold completion. */
export class ClaudeTaskRecords implements TaskRecordParser {
  taskId: string | null = null
  private inputCall: string | null = null

  consume(value: unknown, sourceEventId: string): Array<TaskObservation> {
    const row = record(value)
    if (row.isSidechain !== false || !identifier(row.sessionId)) return []
    const timestamp =
      typeof row.timestamp === "string" ? Date.parse(row.timestamp) : Number.NaN
    const observations: Array<TaskObservation> = []
    const emit = (status: TaskObservation["status"]): void => {
      if (this.taskId)
        observations.push({
          sourceEventId: `${sourceEventId}:${status}`,
          taskId: this.taskId,
          connectionId: "claude-code",
          status,
          timestamp,
        })
    }
    const message = record(row.message)
    const content =
      Array.isArray(message.content) ?
        message.content.map((part) => record(part))
      : []
    if (row.type === "user") this.user(row, content, emit)
    else if (row.type === "assistant") this.assistant(row, content, emit)
    else if (completedClaudeTurn(row)) emit("completed")

    return observations
  }
  private user(
    row: Record<string, unknown>,
    content: Array<Record<string, unknown>>,
    emit: (status: TaskObservation["status"]) => void,
  ): void {
    if (
      this.inputCall
      && content.some(
        (part) =>
          part.type === "tool_result" && part.tool_use_id === this.inputCall,
      )
    ) {
      this.inputCall = null
      emit("running")
    }
    if (
      identifier(row.interruptedMessageId)
      || row.interruptedByShutdown === true
    ) {
      emit("cancelled")
      return
    }
    const prompt = identifier(row.promptId)
    if (
      prompt
      && row.isMeta !== true
      && !content.some((part) => part.type === "tool_result")
      && this.taskId !== `claude-code:${prompt}`
    ) {
      emit("unavailable")
      this.taskId = `claude-code:${prompt}`
      emit("started")
    }
  }

  private assistant(
    row: Record<string, unknown>,
    content: Array<Record<string, unknown>>,
    emit: (status: TaskObservation["status"]) => void,
  ): void {
    if (row.isApiErrorMessage === true) emit("failed")
    const question = content.find(
      (part) =>
        part.type === "tool_use"
        && ["AskUserQuestion", "ExitPlanMode"].includes(String(part.name)),
    )
    if (question) {
      this.inputCall = identifier(question.id)
      emit("waiting")
    }
  }
}

function completedClaudeTurn(row: Record<string, unknown>): boolean {
  return (
    row.type === "system"
    && row.subtype === "turn_duration"
    && typeof row.durationMs === "number"
    && row.durationMs >= 0
    && (row.pendingBackgroundAgentCount === undefined
      || row.pendingBackgroundAgentCount === 0)
    && (row.pendingWorkflowCount === undefined
      || row.pendingWorkflowCount === 0)
  )
}
