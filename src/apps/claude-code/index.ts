import type { AppEntry } from "~/lib/config/settings-types"

import { claudeCodeInstallHint } from "~/lib/config/app-install-hints"

import type { AppUninstallResult, ClientApp } from "../index"

import {
  isProxyBaseUrlConfigured,
  applyProxyBaseUrl,
  revertProxyBaseUrl,
  getClaudeCodeSettingsPath,
  HELPER_LABEL,
  readClaudeCodeSettings,
  getBaseUrlOwnership,
  getApiKeyHelperOwnership,
} from "./config"
import { detectClaudeInstalls } from "./detect"
import {
  reconcileClaudeCodeOnBoot,
  reconcileClaudeCodeOnShutdown,
  setClaudeCodeRoutingIntent,
} from "./reconcile"

export const claudeCodeApp: ClientApp = {
  id: "claude-code",
  name: "Claude Code",
  kind: "config",
  apiKeyLabel: HELPER_LABEL,

  detect() {
    const installs = detectClaudeInstalls()
    return Promise.resolve(installs.length > 0)
  },

  getDetails(conflict: AppEntry["conflict"] = null): Promise<AppEntry> {
    const installs = detectClaudeInstalls()
    const settings = readClaudeCodeSettings()
    const baseUrlOwnership = getBaseUrlOwnership(settings)
    const helperOwnership = getApiKeyHelperOwnership(settings)
    let currentConflict: AppEntry["conflict"] = null
    if (baseUrlOwnership === "foreign") currentConflict = "foreign-base-url"
    else if (helperOwnership === "foreign") {
      currentConflict = "foreign-api-key-helper"
    }
    return Promise.resolve({
      id: "claude-code",
      name: "Claude Code",
      kind: "config",
      enabled: baseUrlOwnership === "ours" && helperOwnership === "ours",
      status: installs.length > 0 ? "ready" : "not-installed",
      installs: installs.map((i) => ({
        path: i.path,
        version: i.version,
        source: i.source,
      })),
      install:
        installs.length === 0 ?
          claudeCodeInstallHint(process.platform === "win32")
        : null,
      conflict: conflict ?? currentConflict,
    })
  },

  enable() {
    const result = applyProxyBaseUrl()
    const conflict =
      (
        result.skippedReason === "foreign-base-url"
        || result.skippedReason === "foreign-api-key-helper"
      ) ?
        result.skippedReason
      : null
    const success = result.wrote || result.skippedReason === "already-ours"
    // Persist intent only after settings are usable. In particular, a missing
    // API key must not leave boot reconciliation enabled for a route we could
    // not configure.
    if (success) setClaudeCodeRoutingIntent(true)
    return Promise.resolve({
      success,
      conflict,
      ...(result.skippedReason === "missing-api-key" ?
        { error: result.skippedReason }
      : {}),
    })
  },

  disable() {
    const result = revertProxyBaseUrl()
    setClaudeCodeRoutingIntent(false)
    return Promise.resolve({ success: result.wrote })
  },

  uninstall(): Promise<AppUninstallResult> {
    // Ownership-guarded: removes only the ANTHROPIC_BASE_URL block we wrote,
    // no-op when absent or foreign. The installer PATH block is maximal's own
    // artifact (not an app integration), so the uninstaller handles that.
    const reverted: Array<string> = []
    const result = revertProxyBaseUrl()
    if (result.wrote) {
      reverted.push(`reverted ${getClaudeCodeSettingsPath()}`)
    }
    return Promise.resolve({ reverted })
  },

  isEnabled() {
    return isProxyBaseUrlConfigured()
  },

  onBoot() {
    reconcileClaudeCodeOnBoot()
    return Promise.resolve()
  },

  onShutdown() {
    reconcileClaudeCodeOnShutdown()
    return Promise.resolve()
  },
}
