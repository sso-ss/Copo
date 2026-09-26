import type {
  AppEntry,
  AppInstall,
  AppInstallHint,
} from "~/lib/config/settings-types"

import { state } from "~/lib/runtime-state/state"

import type { ClientApp } from "../index"

import {
  codexConfigPath,
  chooseProviderId,
  configuredModel,
  hasCodexRouting,
  hasUnmanagedProvider,
  isCodexEnabled,
  prepareCodexConfig,
  readCodexConfig,
  revertCodexConfig,
  writeCodexConfig,
} from "./config"
import { detectCodexDesktop } from "./desktop-detect"
import { detectCodex } from "./detect"
import { codexProvider, verifyCodexProvider } from "./provider"

const routingLock = new Set<string>()
const EXISTING_SETUP_NOTICE =
  "Your existing Codex setup already routes through CoPo. Configure uses separate managed settings; Disconnect restores your existing setup."

async function mutateRouting<Result>(
  operation: () => Promise<Result>,
): Promise<Result> {
  if (routingLock.has("codex"))
    throw new Error(
      "Codex routing is already being changed. Wait for it to finish.",
    )
  routingLock.add("codex")
  try {
    return await operation()
  } finally {
    routingLock.delete("codex")
  }
}

function availableModels(): Array<string> {
  return (state.models?.data ?? [])
    .filter(
      (model) =>
        model.supported_endpoints?.includes("/responses")
        && model.policy?.state !== "disabled",
    )
    .map((model) => model.id)
    .sort()
}

function disableRouting(): boolean {
  const before = readCodexConfig()
  const after = revertCodexConfig(before)
  writeCodexConfig(before, after)
  return before !== after
}

interface CodexAppOptions {
  detectInstalls: () => Promise<Array<AppInstall>>
  installHint: AppInstallHint | null
}

function createCodexApp(
  id: "codex" | "codex-desktop",
  name: string,
  options: CodexAppOptions,
): ClientApp {
  const { detectInstalls, installHint } = options
  return {
    id,
    name,
    kind: "config",
    apiKeyLabel: "codex",

    async detect() {
      return (await detectInstalls()).length > 0
    },

    async getDetails(): Promise<AppEntry> {
      const installs = await detectInstalls()
      let enabled = false
      let managed = false
      let model: string | null = null
      let notice: string | undefined
      try {
        const text = readCodexConfig()
        managed = hasCodexRouting(text)
        enabled = isCodexEnabled(text)
        model = configuredModel(text)
        if (hasUnmanagedProvider(text)) {
          notice = EXISTING_SETUP_NOTICE
        }
      } catch (error) {
        notice =
          error instanceof Error ?
            error.message
          : "Could not read Codex settings."
      }
      return {
        id,
        name,
        kind: "config",
        enabled,
        status: installs.length > 0 ? "ready" : "not-installed",
        installs,
        install: installs.length > 0 ? null : installHint,
        conflict: null,
        routing: {
          model,
          available_models: availableModels(),
          managed,
          notice,
          uses_existing_setup: notice === EXISTING_SETUP_NOTICE,
        },
      }
    },

    enable(options) {
      return mutateRouting(async () => {
        if (!(await this.detect()))
          throw new Error(
            "Install Codex CLI or Desktop first, then enable routing.",
          )
        const before = readCodexConfig()
        const model = options?.model ?? configuredModel(before)
        if (!model)
          throw new Error(
            "Set a model in your Codex configuration before enabling routing.",
          )
        const models = availableModels()
        if (models.length > 0 && !models.includes(model)) {
          throw new Error(
            "Your configured Codex model is not available through CoPo's Responses API. Set a supported model in your Codex configuration, then try again.",
          )
        }
        const after = prepareCodexConfig(
          before,
          codexProvider(chooseProviderId(before)),
          model,
        )
        if (after === before) return { success: true }
        await verifyCodexProvider(after, model)
        writeCodexConfig(before, after)
        return { success: true }
      })
    },

    disable() {
      return mutateRouting(() => Promise.resolve({ success: disableRouting() }))
    },

    uninstall() {
      return mutateRouting(() =>
        Promise.resolve({
          reverted: disableRouting() ? [`reverted ${codexConfigPath()}`] : [],
        }),
      )
    },

    isEnabled() {
      try {
        return isCodexEnabled(readCodexConfig())
      } catch {
        return false
      }
    },
  }
}

export const codexApp = createCodexApp("codex", "Codex CLI and Desktop", {
  detectInstalls: async () =>
    (await Promise.all([detectCodex(), detectCodexDesktop()])).flat(),
  installHint: { method: "npm", command: "npm install -g @openai/codex" },
})

export const codexDesktopApp = createCodexApp(
  "codex-desktop",
  "Codex Desktop",
  { detectInstalls: detectCodexDesktop, installHint: null },
)
