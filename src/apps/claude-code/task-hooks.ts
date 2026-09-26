import { createHash } from "node:crypto"
import path from "node:path"

const MARKER = "_copoTaskHooks"
const EVENTS = [
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PermissionRequest",
  "StopFailure",
  "SessionEnd",
] as const

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ?
      (value as Record<string, unknown>)
    : {}
}

function command(): string {
  const quote = (value: string): string =>
    process.platform === "win32" ?
      `"${value.replaceAll('"', "")}"`
    : `'${value.replaceAll("'", `'"'"'`)}'`
  const runtime = /^(?:bun|node)(?:\.exe)?$/iu.test(
    path.basename(process.execPath),
  )
  return [
    process.execPath,
    ...(runtime ? [path.resolve(Bun.main)] : []),
    "task-hook",
  ]
    .map((part) => quote(part))
    .join(" ")
}

function observerEntry(observer: string) {
  return { hooks: [{ type: "command", command: observer, timeout: 2 }] }
}

function fingerprint(entry: unknown): string | undefined {
  if (entry === undefined) return undefined
  const serialized = JSON.stringify(entry)
  return createHash("sha256").update(serialized).digest("hex")
}

function ownedEvent(owned: Record<string, unknown>, name: string) {
  if (owned.version === 2) {
    const entries = Array.isArray(owned.entries) ? owned.entries : []
    return object(entries.find((entry) => object(entry).event === name))
  }
  // Read the original marker so reconnect and disconnect can migrate it without
  // removing hooks the user edited after CoPo installed them.
  return {
    fingerprint: fingerprint(owned[name]),
    hadEvent: object(owned.hadEvents)[name] === true,
  }
}

export function hasTaskHooks(
  settings: Record<string, unknown>,
  current = false,
): boolean {
  const owned = object(settings[MARKER])
  const hooks = object(settings.hooks)
  // Force a rewrite of legacy markers even when their observer command is
  // current: Claude Code 2.1.283 rejects the whole settings file for their
  // misplaced PreToolUse/PermissionRequest keys (including hadEvents).
  if (current && owned.version !== 2) return false
  const expected = fingerprint(observerEntry(command()))
  return EVENTS.every((name) => {
    const record = ownedEvent(owned, name)
    return (
      typeof record.fingerprint === "string"
      && (!current || record.fingerprint === expected)
      && Array.isArray(hooks[name])
      && hooks[name].some(
        (entry: unknown) => fingerprint(entry) === record.fingerprint,
      )
    )
  })
}

export function withoutTaskHooks(
  settings: Record<string, unknown>,
): Record<string, unknown> {
  if (!(MARKER in settings)) return settings
  const { [MARKER]: ownedValue, ...next } = settings
  const owned = object(ownedValue)
  if (
    settings.hooks !== undefined
    && (typeof settings.hooks !== "object"
      || settings.hooks === null
      || Array.isArray(settings.hooks))
  )
    return next
  let hooks = { ...object(settings.hooks) }
  for (const name of EVENTS) {
    const record = ownedEvent(owned, name)
    if (!Array.isArray(hooks[name]) || typeof record.fingerprint !== "string")
      continue
    const remaining = hooks[name].filter(
      (entry: unknown) => fingerprint(entry) !== record.fingerprint,
    )
    if (remaining.length > 0 || record.hadEvent === true)
      hooks[name] = remaining
    else {
      const { [name]: _removed, ...rest } = hooks
      hooks = rest
    }
  }
  if (Object.keys(hooks).length > 0 || owned.hadHooks === true)
    next.hooks = hooks
  else delete next.hooks
  return next
}

/** Append only owned observers. Existing user hooks and Stop vetoes remain intact. */
export function withTaskHooks(
  settings: Record<string, unknown>,
): Record<string, unknown> {
  const next = withoutTaskHooks(settings)
  const hooks = { ...object(next.hooks) }
  // Fail closed on a shape we cannot merge without losing user configuration.
  if (
    next.hooks !== undefined
    && (typeof next.hooks !== "object"
      || next.hooks === null
      || Array.isArray(next.hooks))
  )
    return settings
  if (
    EVENTS.some(
      (name) => hooks[name] !== undefined && !Array.isArray(hooks[name]),
    )
  )
    return settings
  // Metadata must not look like executable hooks outside settings.hooks.
  // Store event names as values and fingerprints instead of hook copies.
  const observer = command()
  const observerFingerprint = fingerprint(observerEntry(observer))
  const owned = {
    version: 2,
    hadHooks: next.hooks !== undefined,
    entries: EVENTS.map((name) => ({
      event: name,
      hadEvent: name in hooks,
      fingerprint: observerFingerprint,
    })),
  }
  for (const name of EVENTS) {
    const entry = observerEntry(observer)
    hooks[name] = [
      ...((hooks[name] as Array<unknown> | undefined) ?? []),
      entry,
    ]
  }
  return { ...next, hooks, [MARKER]: owned }
}
