import { createHash } from "node:crypto"
import path from "node:path"

import { PATHS } from "~/lib/platform/paths"

import { parseConfig } from "./toml"

const START = "# >>> copo task hooks >>>"
const END = "# <<< copo task hooks <<<"
const HASH = "# copo-task-hooks-sha256: "
const EVENTS = [
  "UserPromptSubmit",
  "PermissionRequest",
  "PostToolUse",
  "Interrupt",
]
const hash = (text: string): string =>
  createHash("sha256").update(text).digest("hex")

function hookCommand(): string {
  const runtime = /^(?:bun|node)(?:\.exe)?$/iu.test(
    path.basename(process.execPath),
  )
  const parts = [
    process.execPath,
    ...(runtime ? [path.resolve(Bun.main)] : []),
    "codex-task-hook",
    "--api-home",
    path.resolve(PATHS.APP_DIR),
  ]
  return parts
    .map((part) =>
      process.platform === "win32" ?
        `"${part.replaceAll('"', "")}"`
      : `'${part.replaceAll("'", `'"'"'`)}'`,
    )
    .join(" ")
}

/** Only an unchanged owned block is removed. User hooks and edits survive. */
export function withoutCodexTaskHooks(text: string): string {
  const start = text.indexOf(`\n${START}\n`)
  if (start === -1) return text
  const end = text.indexOf(`${END}\n`, start)
  if (end === -1) return text
  const block = text.slice(start, end + END.length + 1)
  const lines = block.split("\n")
  const body = lines.slice(3, -2).join("\n") + "\n"
  if (lines[2] !== HASH + hash(body)) return text
  return text.replace(block, "")
}

/** Codex requires users to trust these observer hooks; never bypass that gate. */
export function withCodexTaskHooks(
  text: string,
  command = hookCommand(),
): string {
  const base = withoutCodexTaskHooks(text)
  if (base.includes(START) || base.includes(END))
    throw new Error(
      "CoPo's Codex task hooks were edited. Preserve or remove that block before configuring again.",
    )
  const body = EVENTS.map((event) =>
    [
      `[[hooks.${event}]]`,
      `[[hooks.${event}.hooks]]`,
      'type = "command"',
      `command = ${JSON.stringify(command)}`,
      "timeout = 2",
      "",
    ].join("\n"),
  ).join("\n")
  const next = `${base}\n${START}\n${HASH}${hash(body)}\n${body}${END}\n`
  parseConfig(next)
  return next
}
