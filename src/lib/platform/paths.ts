import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { resolveAppDir } from "./app-dir"

export { resolveAppDir } from "./app-dir"

const AUTH_APP = process.env.COPILOT_API_OAUTH_APP?.trim() || ""
const ENTERPRISE_PREFIX = process.env.COPILOT_API_ENTERPRISE_URL ? "ent_" : ""

const APP_DIR = resolveAppDir({
  platform: process.platform,
  homedir: os.homedir(),
  copilotApiHome: process.env.COPILOT_API_HOME,
  appData: process.env.APPDATA,
})

const GITHUB_TOKEN_PATH = path.join(
  APP_DIR,
  AUTH_APP,
  ENTERPRISE_PREFIX + "github_token",
)
// Multi-account registry (schema v2). Co-located with the legacy single-record
// token file so it inherits the same oauth-app + enterprise-prefix namespacing.
const ACCOUNTS_PATH = path.join(
  APP_DIR,
  AUTH_APP,
  ENTERPRISE_PREFIX + "accounts.json",
)
const CONFIG_PATH = path.join(APP_DIR, "config.json")

export const PATHS = {
  APP_DIR,
  GITHUB_TOKEN_PATH,
  ACCOUNTS_PATH,
  CONFIG_PATH,
}

export async function ensurePaths(): Promise<void> {
  await fs.mkdir(path.join(PATHS.APP_DIR, AUTH_APP), { recursive: true })
  await ensureFile(PATHS.GITHUB_TOKEN_PATH)
  await ensureFile(PATHS.CONFIG_PATH)
}

async function ensureFile(filePath: string): Promise<void> {
  try {
    await fs.access(filePath, fs.constants.W_OK)
  } catch {
    await fs.writeFile(filePath, "")
    await fs.chmod(filePath, 0o600)
  }
}
