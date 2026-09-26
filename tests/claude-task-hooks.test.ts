import { expect, test } from "bun:test"

import {
  hasTaskHooks,
  withTaskHooks,
  withoutTaskHooks,
} from "~/apps/claude-code/task-hooks"

test("task observers merge idempotently and restore user hooks exactly", () => {
  const original = {
    theme: "dark",
    hooks: {
      Stop: [{ hooks: [{ type: "command", command: "check-my-work" }] }],
      PreToolUse: [],
    },
  }
  const managed = withTaskHooks(original)
  expect(hasTaskHooks(managed)).toBe(true)
  expect(withTaskHooks(managed)).toEqual(managed)
  expect(withoutTaskHooks(managed)).toEqual(original)
  expect(withoutTaskHooks(withTaskHooks({ hooks: {} }))).toEqual({ hooks: {} })
  expect(withoutTaskHooks(withTaskHooks({}))).toEqual({})
})

test("edited observer commands and malformed hook settings are preserved", () => {
  const managed = withTaskHooks({}) as {
    hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>
  }
  // Settings are persisted with independent hook and ownership values.
  managed.hooks = structuredClone(managed.hooks)
  managed.hooks.PreToolUse[0].hooks[0].command = "user-edited-command"
  const cleaned = withoutTaskHooks(managed)
  expect(JSON.stringify(cleaned)).toContain("user-edited-command")
  expect(JSON.stringify(cleaned)).not.toContain("task-hook")
  expect(withTaskHooks({ hooks: "invalid" })).toEqual({ hooks: "invalid" })
})
