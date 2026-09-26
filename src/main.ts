#!/usr/bin/env node

import { defineCommand, runMain, parseArgs } from "citty"
import os from "node:os"
import path from "node:path"

import { HELPER_SUBCOMMAND } from "./lib/auth/api-key-helper-tokens"
import { bindElectronFetch } from "./lib/http/electron-fetch"
import { resolveAppDir } from "./lib/platform/app-dir"
import { prepareAppStorage } from "./lib/platform/storage-migration"
import { BUILD_VERSION } from "./lib/update/build-info"

const cliArgs = {
  apiKeyHelper: {
    type: "string",
    description:
      "Legacy alias for `maximal api <client>`; the command written into"
      + " client configs. Prints the API key for an integrated client.",
  },
  "api-home": {
    type: "string",
    description: "Path to the API home directory.",
  },
  "oauth-app": {
    type: "string",
    description: "OAuth app identifier.",
  },
  "enterprise-url": {
    type: "string",
    description: "Enterprise URL for GitHub.",
  },
} as const

const args = parseArgs(process.argv, cliArgs)

// Set environment variables before loading other modules
if (typeof args["api-home"] === "string") {
  process.env.COPILOT_API_HOME = args["api-home"]
}
if (typeof args["oauth-app"] === "string") {
  process.env.COPILOT_API_OAUTH_APP = args["oauth-app"]
}
if (typeof args["enterprise-url"] === "string") {
  process.env.COPILOT_API_ENTERPRISE_URL = args["enterprise-url"]
}

// Migrate before any lazy command imports config, logs, or SQLite. Native
// startup uses storage-path too, so it shares exactly the same convention.
const storageEnv = {
  platform: process.platform,
  homedir: os.homedir(),
  copilotApiHome: process.env.COPILOT_API_HOME,
  appData: process.env.APPDATA,
}
const informational =
  process.argv.length <= 2
  || process.argv.some((arg) =>
    ["--help", "--version", "-h", "-v"].includes(arg),
  )
const appDir =
  informational ? resolveAppDir(storageEnv) : prepareAppStorage(storageEnv)

if (typeof args.apiKeyHelper === "string") {
  const { runApiKeyHelper } = await import("./lib/auth/api-key-helper")
  process.exit(runApiKeyHelper(args.apiKeyHelper))
}

bindElectronFetch()

// Subcommands are LAZY thunks: citty resolves `meta` for `--help`/usage but
// only invokes the matched command's loader. This keeps each invocation from
// paying the import cost of the others — e.g. `maximal api <client>` (invoked by
// clients via `sh -c` on every key fetch) must not load the proxy server,
// usage client, or auth stack it never touches.
const main = defineCommand({
  meta: {
    name: "copo",
    version: BUILD_VERSION,
    description:
      "Local proxy that exposes GitHub Copilot as OpenAI- and Anthropic-compatible HTTP endpoints.",
  },
  subCommands: {
    "storage-path": () =>
      Promise.resolve(
        defineCommand({
          meta: {
            name: "storage-path",
            description: "Resolve Copo’s saved-data folder.",
          },
          run: () => {
            process.stdout.write(JSON.stringify(path.resolve(appDir)))
          },
        }),
      ),
    auth: () => import("./auth").then((m) => m.auth),
    start: () => import("./start").then((m) => m.start),
    setup: () => import("./setup").then((m) => m.setup),
    app: () => import("./apps/cli").then((m) => m.appCommand),
    "task-hook": () =>
      import("./lib/companion/claude-hook").then((m) => m.taskHookCommand),
    // Keyed by HELPER_SUBCOMMAND so the on-disk `<bin> api <client>` token and
    // the command citty dispatches share one source of truth (no drift).
    [HELPER_SUBCOMMAND]: () => import("./apps/cli").then((m) => m.apiCommand),
    uninstall: () => import("./uninstall").then((m) => m.uninstall),
    "check-usage": () => import("./check-usage").then((m) => m.checkUsage),
    debug: () => import("./debug").then((m) => m.debug),
  },
  args: cliArgs,
})

await runMain(main)
