/** Public lifecycle metadata. Never include prompts, responses, paths or keys. */
export type TaskStatus =
  | "running"
  | "waiting"
  | "completed"
  | "cancelled"
  | "failed"
  | "unavailable"

export interface CompanionTask {
  taskId: string
  connectionId: string
  status: TaskStatus
  parentTaskId: string | null
  startedAt: number
  updatedAt: number
}

export interface TaskEvent {
  generation: string
  eventId: number
  task: CompanionTask
}

export interface TaskSnapshot {
  generation: string
  eventId: number
  tasks: Array<CompanionTask>
  /** Sources actively observed on this machine; other clients remain request-only. */
  sources: Array<string>
}

export interface TaskObservation {
  sourceEventId: string
  taskId: string
  connectionId: string
  status: TaskStatus | "started"
  parentTaskId?: string | null
  timestamp: number
}
