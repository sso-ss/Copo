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

test("ownership metadata contains no hook definitions or event keys", () => {
  const { hooks: _hooks, ...metadata } = withTaskHooks({})
  const forbidden = new Set(["hooks", "PreToolUse", "PermissionRequest"])
  function check(value: unknown): void {
    if (Array.isArray(value)) {
      for (const entry of value) check(entry)
    } else if (value && typeof value === "object") {
      for (const [key, nested] of Object.entries(value)) {
        expect(forbidden.has(key)).toBe(false)
        check(nested)
      }
    }
  }
  check(metadata)
})

function legacySettings(): Record<string, unknown> {
  const settings = withTaskHooks({
    hooks: {
      PreToolUse: [{ hooks: [{ type: "command", command: "user-guard" }] }],
      PermissionRequest: [],
    },
  })
  const hooks = settings.hooks as Record<string, Array<unknown>>
  const entries = Object.entries(hooks)
  return {
    ...settings,
    _copoTaskHooks: {
      hadHooks: true,
      hadEvents: Object.fromEntries(
        entries.map(([name]) => [
          name,
          name === "PreToolUse" || name === "PermissionRequest",
        ]),
      ),
      ...Object.fromEntries(
        entries.map(([name, matchers]) => [
          name,
          structuredClone(matchers.at(-1)),
        ]),
      ),
    },
  }
}

test("legacy bookkeeping migrates even when its observer command is current", () => {
  const legacy = legacySettings()
  expect(hasTaskHooks(legacy)).toBe(true)
  expect(hasTaskHooks(legacy, true)).toBe(false)
  const migrated = withTaskHooks(legacy)
  expect(hasTaskHooks(migrated, true)).toBe(true)
  expect(withTaskHooks(migrated)).toEqual(migrated)
  expect(migrated.hooks).toEqual(legacy.hooks)
  expect(withoutTaskHooks(migrated)).toEqual(withoutTaskHooks(legacy))
  expect(withoutTaskHooks(migrated)).toEqual({
    hooks: {
      PreToolUse: [{ hooks: [{ type: "command", command: "user-guard" }] }],
      PermissionRequest: [],
    },
  })
})

test("migrating a legacy marker preserves a user-edited permission hook", () => {
  const legacy = legacySettings()
  const hooks = legacy.hooks as Record<
    string,
    Array<{ hooks: Array<{ command: string }> }>
  >
  hooks.PermissionRequest[0].hooks[0].command = "edited-permission-guard"
  const migrated = withTaskHooks(legacy)
  expect(JSON.stringify(withoutTaskHooks(migrated))).toContain(
    "edited-permission-guard",
  )
  expect(JSON.stringify(withoutTaskHooks(migrated))).toContain("user-guard")
  expect(JSON.stringify(withoutTaskHooks(migrated))).not.toContain("task-hook")
})
