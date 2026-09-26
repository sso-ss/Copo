import { Hono } from "hono"

import type { ClientApp } from "~/apps"
import type {
  CompanionConnection,
  CompanionData,
} from "~/lib/config/companion-types"

import { getAllApps } from "~/apps/registry"
import { resolveApiKey } from "~/lib/auth/api-key-helper"
import { getCompanionAccount } from "~/lib/auth/auth-controller"
import { currentGitHubHost } from "~/lib/auth/github-host"
import { getConfig, type AppConfig } from "~/lib/config/config"
import { forwardError } from "~/lib/errors/error"
import { getClientActivitySnapshot } from "~/lib/http/client-activity"
import { state } from "~/lib/runtime-state/state"

function appConnection(
  app: ClientApp,
  config: AppConfig,
): {
  connection: CompanionConnection
  dedicatedKeyId: string | null
} {
  const keys = config.auth?.apiKeyEntries ?? []
  const resolved = resolveApiKey(app.apiKeyLabel, config)
  const matching =
    resolved.ok ?
      keys.filter((key) => key.enabled && key.key.trim() === resolved.key)
    : []
  const key = matching.length === 1 ? matching[0] : null
  const dedicated = resolved.ok && resolved.source === "app"
  return {
    dedicatedKeyId: dedicated ? (key?.id ?? null) : null,
    connection: {
      id: app.id,
      name: app.name,
      apiKeyId: key?.id ?? null,
      configured: app.isEnabled(),
      shared: !dedicated || matching.length !== 1 || app.id === "codex",
      section: "apps",
    },
  }
}

function connectionsFor(
  config: AppConfig,
  apps: Array<ClientApp>,
): Array<CompanionConnection> {
  const keys = config.auth?.apiKeyEntries ?? []
  const connections: Array<CompanionConnection> = []
  const usedKeys = new Set<string>()
  for (const app of apps) {
    const { connection, dedicatedKeyId } = appConnection(app, config)
    if (dedicatedKeyId) usedKeys.add(dedicatedKeyId)
    connections.push(connection)
  }
  for (const key of keys) {
    if (usedKeys.has(key.id)) continue
    connections.push({
      id: `key:${key.id}`,
      name: key.label,
      apiKeyId: key.id,
      configured: key.enabled,
      shared: true,
      section: "api-clients",
    })
  }
  for (const connection of connections) {
    if (
      connections.filter((other) => other.apiKeyId === connection.apiKeyId)
        .length > 1
    )
      connection.shared = true
  }
  return connections
}

export const companionRoutes = new Hono()

companionRoutes.get("/", (c) => {
  try {
    const config = getConfig()
    const apps = getAllApps().filter((app) => app.kind !== "coming-soon")
    const connections = connectionsFor(config, apps)
    const account = getCompanionAccount()
    let gateway: CompanionData["gateway"] = "sign-in-required"
    if (account)
      gateway = state.lastUpstreamRejection ? "upstream-error" : "ready"
    return c.json({
      gateway,
      account:
        account ?
          {
            login: account.login,
            host: currentGitHubHost(),
            avatarUrl: account.avatarUrl ?? null,
          }
        : null,
      connections,
      availableToolIds: apps.map((app) => app.id),
      activity: getClientActivitySnapshot(),
    } satisfies CompanionData)
  } catch (error) {
    return forwardError(c, error)
  }
})
