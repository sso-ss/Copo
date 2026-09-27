import { describe, expect, test } from "bun:test"

import { sanitizeClaudeHook } from "~/lib/companion/claude-hook"
import {
  ClaudeTaskRecords,
  CodexTaskRecords,
} from "~/lib/companion/task-records"
import { TaskTracker } from "~/lib/companion/task-tracker"

const codex = (type: string, timestamp: number, fields = {}) => ({
  type: "event_msg",
  timestamp: new Date(timestamp).toISOString(),
  payload: { type, turn_id: "turn", ...fields },
})

describe("installed-client lifecycle record adapters", () => {
  test("Codex ignores inference responses and ends on task_complete", () => {
    const parser = new CodexTaskRecords("copo-app")
    parser.consume(
      {
        type: "session_meta",
        payload: {
          id: "thread",
          model_provider: "copo-app",
          cli_version: "0.157.1",
          source: "vscode",
        },
      },
      "meta",
    )
    expect(parser.consume(codex("task_started", 10), "start")[0].status).toBe(
      "started",
    )
    expect(
      parser.consume(
        {
          type: "response_item",
          timestamp: new Date(20).toISOString(),
          payload: {
            type: "message",
            role: "assistant",
            content: "private response",
          },
        },
        "response",
      ),
    ).toEqual([])
    const completed = parser.consume(
      codex("task_complete", 30, { last_agent_message: "private response" }),
      "finish",
    )
    expect(completed[0].status).toBe("completed")
    expect(JSON.stringify(completed)).not.toContain("private")
  })

  test("Codex checks provider attribution and suppresses child-only celebrations", () => {
    const parser = new CodexTaskRecords("copo-app")
    parser.consume(
      {
        type: "session_meta",
        payload: { id: "thread", model_provider: "openai" },
      },
      "foreign",
    )
    expect(parser.consume(codex("task_started", 10), "start")).toEqual([])
    parser.consume(
      {
        type: "session_meta",
        payload: {
          id: "thread",
          model_provider: "copo-app",
          source: { subagent: { other: "guardian" } },
        },
      },
      "child",
    )
    expect(
      parser.consume(
        codex("task_started", 20, { root_turn_id: "parent" }),
        "start-child",
      )[0].parentTaskId,
    ).toBe("codex:parent")
    expect(parser.consume(codex("turn_aborted", 30), "cancel")[0].status).toBe(
      "cancelled",
    )
  })

  test("Codex does not treat a different provider as CoPo's former route", () => {
    const parser = new CodexTaskRecords("copo-app")
    parser.consume(
      {
        type: "session_meta",
        payload: { id: "thread", model_provider: "maximal" },
      },
      "foreign",
    )
    expect(parser.consume(codex("task_started", 10), "start")).toEqual([])
  })

  test("Claude waits for the turn boundary and outstanding background work", () => {
    const parser = new ClaudeTaskRecords()
    const common = {
      sessionId: "session",
      isSidechain: false,
      version: "2.1.280",
      timestamp: new Date(10).toISOString(),
    }
    expect(
      parser.consume(
        {
          ...common,
          type: "user",
          promptId: "turn",
          message: { content: "private prompt" },
        },
        "start",
      )[0].status,
    ).toBe("started")
    expect(
      parser.consume(
        {
          ...common,
          type: "assistant",
          message: { content: [{ type: "text", text: "not finished yet" }] },
        },
        "response",
      ),
    ).toEqual([])
    expect(
      parser.consume(
        {
          ...common,
          type: "system",
          subtype: "stop_hook_summary",
          preventedContinuation: true,
        },
        "stop-veto",
      ),
    ).toEqual([])
    const finish = {
      ...common,
      type: "system",
      subtype: "turn_duration",
      durationMs: 100,
    }
    expect(
      parser.consume({ ...finish, pendingBackgroundAgentCount: 1 }, "children"),
    ).toEqual([])
    expect(
      parser.consume({ ...finish, pendingWorkflowCount: 1 }, "workflow"),
    ).toEqual([])
    expect(parser.consume(finish, "finish")[0].status).toBe("completed")
  })

  test("Claude explicit cancellation and API errors cannot become success", () => {
    const parser = new ClaudeTaskRecords()
    const tracker = new TaskTracker("g", 0)
    const common = { sessionId: "session", isSidechain: false }
    const rows = [
      {
        ...common,
        type: "user",
        promptId: "turn",
        message: { content: "hello" },
      },
      { ...common, type: "assistant", isApiErrorMessage: true },
      { ...common, type: "system", subtype: "turn_duration", durationMs: 100 },
    ]
    for (const [i, row] of rows.entries())
      for (const event of parser.consume(
        { ...row, timestamp: new Date(i + 10).toISOString() },
        String(i),
      ))
        tracker.observe(event, "g")
    expect(tracker.snapshot().tasks[0].status).toBe("failed")
    expect(
      parser.consume(
        {
          ...common,
          type: "user",
          timestamp: new Date(30).toISOString(),
          interruptedMessageId: "msg_cancelled",
        },
        "cancel",
      )[0].status,
    ).toBe("cancelled")
  })

  test("the hook helper rejects children and sends only whitelisted metadata", () => {
    const input = {
      hook_event_name: "UserPromptSubmit",
      session_id: "session",
      prompt_id: "turn",
      prompt: "private prompt",
      last_assistant_message: "private answer",
      transcript_path: "/private/path",
    }
    expect(sanitizeClaudeHook(input, 10)).toEqual({
      event: "UserPromptSubmit",
      sessionId: "session",
      promptId: "turn",
      waiting: false,
      timestamp: 10,
    })
    expect(sanitizeClaudeHook({ ...input, agent_id: "child" })).toBeNull()
    expect(sanitizeClaudeHook({ ...input, hook_event_name: "Stop" })).toBeNull()
  })
})
