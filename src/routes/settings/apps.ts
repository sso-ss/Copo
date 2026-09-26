/**
 * /settings/api/apps — wire downstream tools to talk to the proxy.
 *
 * Auth-gated by the parent `/settings/api` middleware. Persistence is
 * `config.apps`, round-tripped through `writeConfig()`.
 */

import type { Context } from "hono"

import { Hono } from "hono"

import { getAllApps, getApp } from "~/apps/registry"
import { getConfig, writeConfig, type AppConfig } from "~/lib/config/config"
import { settingsEventBus } from "~/lib/config/settings-events"
import {
  AppEntry,
  AppsListResponse,
  ClaudeCodeToggleRequest,
  ClaudeDesktopToggleRequest,
  CodexToggleRequest,
  type AppEntry as AppEntryT,
} from "~/lib/config/settings-types"
import { forwardError, HTTPError } from "~/lib/errors/error"

import { respondValidated } from "./respond-validated"

/** Build an HTTPError whose body is a plain message, so `forwardError`
 *  surfaces a clean `{ error: { message } }` at the given status. */
function httpError(message: string, status: number): HTTPError {
  return new HTTPError(message, new Response(message, { status }))
}

/** Validate a single app object against the contract before returning
 *  it, so drift fails loudly in tests rather than silently in the UI. */
function jsonApp(c: Context, app: AppEntryT) {
  return respondValidated(c, { schema: AppEntry, label: "App" }, app)
}

const CLAUDE_CODE_ERRORS = {
  "not-installed": "Install Claude Code, then try connecting again.",
  "foreign-base-url":
    "Claude Code is configured for another gateway. Remove ANTHROPIC_BASE_URL from its settings, then try connecting again.",
  "foreign-api-key-helper":
    "Claude Code uses a custom API key helper. Remove apiKeyHelper from its settings, then try connecting again.",
  "missing-api-key":
    "Create an enabled API key in CoPo Settings, then try connecting again.",
  "connection-change-failed": "Could not change Claude Code routing.",
} as const

function claudeCodeError(c: Context, reason: keyof typeof CLAUDE_CODE_ERRORS) {
  return c.json(
    {
      error: {
        type: `claude-code-${reason}`,
        message: CLAUDE_CODE_ERRORS[reason],
      },
    },
    409,
  )
}

/** Merge an `apps.claudeDesktop` patch into config and persist. */
function persistClaudeDesktop(enabled: boolean): void {
  const config: AppConfig = getConfig()
  writeConfig({
    ...config,
    apps: {
      ...config.apps,
      claudeDesktop: {
        ...config.apps?.claudeDesktop,
        enabled,
      },
    },
  })
}

export const appsRoutes = new Hono()

appsRoutes.use("*", async (c, next) => {
  try {
    await next()
  } finally {
    if (c.req.method !== "GET")
      settingsEventBus.publish("connections.changed", {})
  }
})

for (const id of ["codex", "codex-desktop"] as const) {
  appsRoutes.post(`/${id}/toggle`, async (c) => {
    try {
      const parsed = CodexToggleRequest.safeParse(
        await c.req.json().catch(() => null),
      )
      if (!parsed.success)
        throw httpError("Expected { enabled: boolean, model?: string }", 400)
      const app = getApp(id)
      if (!app) throw httpError("App not found", 404)
      if (parsed.data.enabled && !(await app.detect())) {
        return c.json(
          {
            error: {
              type: `${id}-not-installed`,
              message: `Install ${app.name}, then try configuring it again.`,
            },
          },
          409,
        )
      }
      try {
        await (parsed.data.enabled ?
          app.enable({ model: parsed.data.model })
        : app.disable())
      } catch (error) {
        throw httpError(
          error instanceof Error ?
            error.message
          : "Could not change Codex routing.",
          409,
        )
      }
      return jsonApp(c, await app.getDetails())
    } catch (error) {
      return forwardError(c, error)
    }
  })
}

appsRoutes.get("/", async (c) => {
  try {
    const appsPayloads = await Promise.all(
      getAllApps().map((app) => app.getDetails()),
    )
    const payload = {
      apps: appsPayloads,
    }
    return respondValidated(
      c,
      { schema: AppsListResponse, label: "Apps" },
      payload,
    )
  } catch (error) {
    return forwardError(c, error)
  }
})

appsRoutes.post("/claude-code/toggle", async (c) => {
  try {
    const body: unknown = await c.req.json().catch(() => null)
    const parsed = ClaudeCodeToggleRequest.safeParse(body)
    if (!parsed.success) {
      throw httpError("Expected { enabled: boolean }", 400)
    }

    const app = getApp("claude-code")
    if (!app) throw httpError("App not found", 404)

    if (parsed.data.enabled) {
      const isInstalled = await app.detect()
      if (!isInstalled) {
        return claudeCodeError(c, "not-installed")
      }
      const result = await app.enable()
      if (!result.success) {
        return claudeCodeError(
          c,
          result.conflict ?? result.error ?? "connection-change-failed",
        )
      }
      // `app.enable()` is the single owner of the claude-code routing intent
      // (persists config.apps.claudeCode.enabled itself) — no separate persist.
      return jsonApp(c, await app.getDetails())
    }

    await app.disable()
    return jsonApp(c, await app.getDetails())
  } catch (error) {
    return forwardError(c, error)
  }
})

appsRoutes.post("/claude-desktop/toggle", async (c) => {
  try {
    const body: unknown = await c.req.json().catch(() => null)
    const parsed = ClaudeDesktopToggleRequest.safeParse(body)
    if (!parsed.success) {
      throw httpError("Expected { enabled: boolean }", 400)
    }

    const app = getApp("claude-desktop")
    if (!app) throw httpError("App not found", 404)

    if (parsed.data.enabled && !(await app.detect())) {
      return c.json(
        {
          error: {
            type: "claude-desktop-not-installed",
            message: "Install Claude Desktop, then try configuring it again.",
          },
        },
        409,
      )
    }

    await (parsed.data.enabled ? app.enable() : app.disable())
    persistClaudeDesktop(parsed.data.enabled)

    return jsonApp(c, await app.getDetails())
  } catch (error) {
    return forwardError(c, error)
  }
})
