import path from "node:path"

/** Inputs to {@link resolveAppDir}, injected so the resolver is pure/testable. */
export interface AppDirEnv {
  platform: NodeJS.Platform
  homedir: string
  /** `COPILOT_API_HOME` override (highest precedence on every platform). */
  copilotApiHome?: string
  /** `%APPDATA%` (win32 only); falls back to `<home>\AppData\Roaming`. */
  appData?: string
}

/**
 * Resolve the single app-data root, per the cross-platform convention:
 *   - `COPILOT_API_HOME` overrides everywhere (highest precedence).
 *   - win32:  `%APPDATA%\copo`  (fallback `<home>\AppData\Roaming\copo`).
 *   - else:   `<home>/.local/share/copo`  (macOS + Linux).
 *
 * Logs live at `<root>/logs` on every platform — the caller derives that from
 * this single root, so there is exactly one place the convention is encoded.
 */
export function resolveAppDir(env: AppDirEnv): string {
  const override = env.copilotApiHome?.trim()
  if (override) {
    return override
  }
  if (env.platform === "win32") {
    const roaming =
      env.appData?.trim() || path.join(env.homedir, "AppData", "Roaming")
    return path.join(roaming, "copo")
  }
  return path.join(env.homedir, ".local", "share", "copo")
}
