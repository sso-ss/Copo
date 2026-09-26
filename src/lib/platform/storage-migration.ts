import fs from "node:fs"
import path from "node:path"

import { type AppDirEnv, resolveAppDir } from "./app-dir"

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // Permission errors are not evidence that a process has exited.
    return (error as NodeJS.ErrnoException).code !== "ESRCH"
  }
}

function legacyPids(dir: string): Array<number> {
  const pids: Array<number> = []
  for (const name of ["maximal.pid", "session-running"]) {
    try {
      const raw = fs.readFileSync(path.join(dir, name), "utf8")
      const value: unknown =
        name === "session-running" ?
          (JSON.parse(raw) as { pid?: unknown }).pid
        : Number(raw.trim())
      if (
        typeof value === "number"
        && Number.isSafeInteger(value)
        && value > 0
      ) {
        pids.push(value)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
  }
  return pids
}

/** Run before importing config, logging, or databases. A same-parent rename
 * preserves credentials, permissions, and SQLite side files together. Never
 * merge two stores, migrate an explicit override, or move a running store. */
export function prepareAppStorage(
  env: AppDirEnv,
  isRunning: (pid: number) => boolean = processIsRunning,
): string {
  const destination = resolveAppDir(env)
  if (env.copilotApiHome?.trim() || fs.existsSync(destination))
    return destination
  const parent = path.dirname(destination)
  const legacy = path.join(parent, "maximal")
  if (!fs.existsSync(legacy)) return destination

  const lock = path.join(parent, ".copo-storage-migration.lock")
  // Exclusive creation prevents concurrent CLI/native startup migrations.
  fs.mkdirSync(lock, { mode: 0o700 })
  try {
    if (fs.existsSync(destination) || !fs.existsSync(legacy)) return destination
    if (!fs.lstatSync(legacy).isDirectory()) {
      throw new Error(
        "Copo cannot migrate a linked data folder. Set COPILOT_API_HOME to use it explicitly.",
      )
    }
    if (legacyPids(legacy).some((pid) => isRunning(pid))) {
      throw new Error(
        "Quit the running Copo or Maximal instance, then reopen Copo to move its saved data safely.",
      )
    }
    fs.renameSync(legacy, destination)
    return destination
  } finally {
    fs.rmdirSync(lock)
  }
}
