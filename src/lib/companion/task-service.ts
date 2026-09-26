import path from "node:path"

import {
  getClaudeCodeSettingsPath,
  isProxyBaseUrlConfigured,
} from "~/apps/claude-code/config"
import {
  codexConfigPath,
  isCodexEnabled,
  readCodexConfig,
  selectedProvider,
} from "~/apps/codex/config"
import { getCompanionAccount } from "~/lib/auth/auth-controller"

import { TaskMonitor, type TaskSource } from "./task-monitor"
import { getTaskSnapshot, taskTracker } from "./task-runtime"

function taskSources(): Array<TaskSource> {
  if (!getCompanionAccount()) return []
  const sources: Array<TaskSource> = []
  if (isProxyBaseUrlConfigured())
    sources.push({
      connectionId: "claude-code",
      directory: path.join(
        path.dirname(getClaudeCodeSettingsPath()),
        "projects",
      ),
    })
  try {
    const codex = readCodexConfig()
    if (isCodexEnabled(codex))
      sources.push({
        connectionId: "codex",
        directory: path.join(path.dirname(codexConfigPath()), "sessions"),
        provider: selectedProvider(codex),
      })
  } catch {
    // A broken Codex config must not disable Claude's independent observer.
  }
  return sources
}

let stop: (() => void) | null = null

/** Start only in the server process, never in key helpers or module imports. */
export function startTaskMonitoring(): void {
  if (stop || process.env.NODE_ENV === "test") return
  const monitor = new TaskMonitor(taskTracker, taskSources)
  const poll = async (): Promise<void> => {
    try {
      getTaskSnapshot()
      await monitor.poll()
    } catch {
      taskTracker.setSources([], Date.now())
    }
  }
  const timer = setInterval(() => {
    void poll()
  }, 1000)
  timer.unref()
  stop = () => {
    clearInterval(timer)
    stop = null
  }
  void poll()
}

export function stopTaskMonitoring(): void {
  stop?.()
}
