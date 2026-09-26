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

export function hasTaskHooks(
  settings: Record<string, unknown>,
  current = false,
): boolean {
  const owned = object(settings[MARKER])
  const hooks = object(settings.hooks)
  const expected = command()
  return EVENTS.every(
    (name) =>
      typeof owned[name] === "object"
      && (!current
        || JSON.stringify(owned[name]).includes(JSON.stringify(expected)))
      && Array.isArray(hooks[name])
      && hooks[name].some(
        (entry: unknown) =>
          JSON.stringify(entry) === JSON.stringify(owned[name]),
      ),
  )
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
    if (!Array.isArray(hooks[name]) || !owned[name]) continue
    const remaining = hooks[name].filter(
      (entry: unknown) => JSON.stringify(entry) !== JSON.stringify(owned[name]),
    )
    if (remaining.length > 0 || object(owned.hadEvents)[name] === true)
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
  const owned: Record<string, unknown> = {
    hadHooks: next.hooks !== undefined,
    hadEvents: Object.fromEntries(EVENTS.map((name) => [name, name in hooks])),
  }
  const observer = command()
  for (const name of EVENTS) {
    const entry = {
      hooks: [{ type: "command", command: observer, timeout: 2 }],
    }
    hooks[name] = [
      ...((hooks[name] as Array<unknown> | undefined) ?? []),
      entry,
    ]
    owned[name] = entry
  }
  return { ...next, hooks, [MARKER]: owned }
}
