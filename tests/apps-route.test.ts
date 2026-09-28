/**
 * /settings/api/apps — route-level coverage.
 *
 * Config comes from the REAL `~/lib/config/config`, which the global preload
 * (tests/test-setup.ts) has already redirected to a throwaway
 * COPILOT_API_HOME temp dir — so getConfig/writeConfig round-trip through a
 * temp `config.json`, never the user's real config.
 *
 * Path isolation without leak-prone module mocks:
 *   - claude-code settings.json → we point `process.env.CLAUDE_CONFIG_DIR`
 *     at a tmp dir (saved+restored around the file). The REAL
 *     `applyProxyBaseUrl()` / `isProxyBaseUrlConfigured()` etc. resolve their
 *     default path via `getClaudeCodeSettingsPath()`, which honors that env
 *     var — so no `mock.module("~/apps/claude-code/config")` is needed. That
 *     mock used to default the path arg to a tmp file, and on CI it LEAKED
 *     forward (even with an awaited restore): a later file's arg-less
 *     `applyProxyBaseUrl()` got the leaked tmp path, breaking
 *     claude-code-cli-enable-persist.test.ts (#229).
 *
 * Two mocks remain because their targets have NO env/injection seam that the
 * route path reaches (the route calls them with no args). They spread the real
 * module and are restored in an awaited afterAll; their forward-leak is proven
 * harmless by the sequential-import repro (see the #229 investigation):
 *   - `~/apps/claude-code/detect`: `detectClaudeInstalls()` (no args) returns a
 *     controllable install fixture. No env seam feeds a fixture in.
 *   - `~/apps/claude-desktop/config`: `home` defaults to `os.homedir()` (no env
 *     override), so without the mock the route would touch the developer's REAL
 *     Claude-3p userData dir. The mock redirects it to a tmp home.
 */

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test"
import { Hono } from "hono"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import type { ClaudeInstall } from "~/apps/claude-code/detect"

const ROUTE_3P_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apps-route-3p-"))
const ROUTE_CC_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "apps-route-ccdir-"))
const ROUTE_CC_SETTINGS = path.join(ROUTE_CC_DIR, "settings.json")

// Redirect the REAL claude-code settings path into our tmp dir via the env var
// that getClaudeCodeSettingsPath() honors. Saved + restored in afterAll so we
// don't leak the override to sibling files.
const savedClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR
process.env.CLAUDE_CONFIG_DIR = ROUTE_CC_DIR

let installsFixture: Array<ClaudeInstall> = []

const actualDetect = await import("~/apps/claude-code/detect")
const realDetect = actualDetect.detectClaudeInstalls
await mock.module("~/apps/claude-code/detect", () => ({
  ...actualDetect,
  detectClaudeInstalls: (options?: Record<string, unknown>) =>
    options && Object.keys(options).length > 0 ?
      realDetect(options)
    : installsFixture,
}))

const actualDesktop = await import("~/apps/claude-desktop/config")
const realApply = actualDesktop.applyConfigLibraryProfile
const realRevert = actualDesktop.revertConfigLibraryProfile
const realIsApplied = actualDesktop.isConfigLibraryApplied
const realGetDir = actualDesktop.getClaude3pDir
// Wrappers forward ALL args (only defaulting the first `home` to the tmp
// home) so this mock stays behaviorally identical to the real module.
await mock.module("~/apps/claude-desktop/config", () => ({
  ...actualDesktop,
  applyConfigLibraryProfile: (
    home: string = ROUTE_3P_HOME,
    ...rest: Array<unknown>
  ) => (realApply as (...a: Array<unknown>) => unknown)(home, ...rest),
  revertConfigLibraryProfile: (
    home: string = ROUTE_3P_HOME,
    ...rest: Array<unknown>
  ) => (realRevert as (...a: Array<unknown>) => unknown)(home, ...rest),
  isConfigLibraryApplied: (
    home: string = ROUTE_3P_HOME,
    ...rest: Array<unknown>
  ) => (realIsApplied as (...a: Array<unknown>) => unknown)(home, ...rest),
  getClaude3pDir: (home: string = ROUTE_3P_HOME, ...rest: Array<unknown>) =>
    (realGetDir as (...a: Array<unknown>) => unknown)(home, ...rest),
}))

const { ApiErrorBody, AppEntry, AppsListResponse } =
  await import("~/lib/config/settings-types")
const { appsRoutes } = await import("~/routes/settings/apps")
const { getConfig, writeConfig } = await import("~/lib/config/config")
const { isProxyBaseUrlConfigured } = await import("~/apps/claude-code/config")
const { claudeDesktopApp } = await import("~/apps/claude-desktop")
const { claudeCodeInstallHint } = await import("~/lib/config/app-install-hints")

function buildApp() {
  const app = new Hono()
  app.route("/apps", appsRoutes)
  return app
}

function fakeInstall(p: string): ClaudeInstall {
  return { path: p, resolvedPath: p, version: "1.2.3", source: "homebrew" }
}

function cleanTmp() {
  fs.rmSync(ROUTE_3P_HOME, { recursive: true, force: true })
  fs.mkdirSync(ROUTE_3P_HOME, { recursive: true })
  fs.rmSync(ROUTE_CC_DIR, { recursive: true, force: true })
  fs.mkdirSync(ROUTE_CC_DIR, { recursive: true })
}

beforeEach(() => {
  writeConfig({ auth: { apiKeys: ["test-api-key"] } })
  installsFixture = []
  cleanTmp()
})

afterAll(async () => {
  // Leave a clean slate so later files in the shared worker start empty, and
  // restore the mocked app modules + the env override so nothing leaks forward.
  writeConfig({})
  if (savedClaudeConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = savedClaudeConfigDir
  }
  await mock.module("~/apps/claude-code/detect", () => actualDetect)
  await mock.module("~/apps/claude-desktop/config", () => actualDesktop)
  fs.rmSync(ROUTE_3P_HOME, { recursive: true, force: true })
  fs.rmSync(ROUTE_CC_DIR, { recursive: true, force: true })
})

describe("GET /apps", () => {
  test("returns all registered apps with the right kinds", async () => {
    const res = await buildApp().request("/apps")
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      apps: Array<{ id: string; name: string; kind: string; status: string }>
    }
    expect(body.apps.map((a) => a.id)).toEqual([
      "claude-code",
      "claude-desktop",
      "codex",
      "copilot-cli",
    ])
    expect(body.apps[0].kind).toBe("config")
    expect(body.apps[1].kind).toBe("config")
    expect(body.apps[2].kind).toBe("config")
    expect(body.apps[3].kind).toBe("coming-soon")
    expect(body.apps[3].status).toBe("coming-soon")
  })

  test("claude-code offers an install command when no install is detected", async () => {
    installsFixture = []
    const res = await buildApp().request("/apps")
    const body = (await res.json()) as {
      apps: Array<{
        id: string
        status: string
        install: { method: string; command: string } | null
      }>
    }
    const cc = body.apps.find((a) => a.id === "claude-code")
    expect(cc?.status).toBe("not-installed")
    expect(cc?.install?.command).toBe(
      claudeCodeInstallHint(process.platform === "win32").command,
    )
  })

  test("claude-code lists detected installs with no install hint", async () => {
    installsFixture = [fakeInstall("/opt/homebrew/bin/claude")]
    const res = await buildApp().request("/apps")
    const body = (await res.json()) as {
      apps: Array<{
        id: string
        status: string
        installs: Array<{ path: string; source: string }>
        install: unknown
      }>
    }
    const cc = body.apps.find((a) => a.id === "claude-code")
    expect(cc?.status).toBe("ready")
    expect(cc?.installs[0].path).toBe("/opt/homebrew/bin/claude")
    expect(cc?.install).toBeNull()
  })
})

describe("POST /apps/claude-code/toggle", () => {
  test("enable writes ANTHROPIC_BASE_URL and persists enabled=true", async () => {
    installsFixture = [fakeInstall("/opt/homebrew/bin/claude")]
    const res = await buildApp().request("/apps/claude-code/toggle", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { enabled: boolean; conflict: unknown }
    expect(body.enabled).toBe(true)
    expect(body.conflict).toBeNull()
    expect(getConfig().apps?.claudeCode).toEqual({ enabled: true })
    // The settings.json base URL was actually written.
    expect(isProxyBaseUrlConfigured(ROUTE_CC_SETTINGS)).toBe(true)
  })

  test("enable with no install returns 409", async () => {
    installsFixture = []
    const res = await buildApp().request("/apps/claude-code/toggle", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    })
    expect(res.status).toBe(409)
    expect(ApiErrorBody.parse(await res.json()).error.type).toBe(
      "claude-code-not-installed",
    )
    expect(fs.existsSync(ROUTE_CC_SETTINGS)).toBe(false)
    expect(getConfig().apps?.claudeCode?.enabled).not.toBe(true)
  })

  test("configure detects an app installed after the initial list was loaded", async () => {
    const app = buildApp()
    const initial = AppsListResponse.parse(
      await (await app.request("/apps")).json(),
    )
    expect(
      initial.apps.find((entry) => entry.id === "claude-code")?.status,
    ).toBe("not-installed")
    installsFixture = [fakeInstall("/opt/homebrew/bin/claude")]
    const res = await app.request("/apps/claude-code/toggle", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    })
    expect(res.status).toBe(200)
    expect(AppEntry.parse(await res.json()).enabled).toBe(true)
  })

  test("key provisioning refusal returns an actionable failure", async () => {
    installsFixture = [fakeInstall("/opt/homebrew/bin/claude")]
    const { claudeCodeApp } = await import("~/apps/claude-code")
    const enable = spyOn(claudeCodeApp, "enable").mockResolvedValue({
      success: false,
      error: "missing-api-key",
    })
    try {
      const res = await buildApp().request("/apps/claude-code/toggle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      })
      expect(res.status).toBe(409)
      expect(ApiErrorBody.parse(await res.json()).error.type).toBe(
        "claude-code-missing-api-key",
      )
      expect(getConfig().apps?.claudeCode?.enabled).not.toBe(true)
    } finally {
      enable.mockRestore()
    }
  })

  test("enable surfaces a conflict when a foreign base URL is present", async () => {
    installsFixture = [fakeInstall("/opt/homebrew/bin/claude")]
    // Pre-seed a non-proxy ANTHROPIC_BASE_URL the user owns.
    fs.writeFileSync(
      ROUTE_CC_SETTINGS,
      JSON.stringify({ env: { ANTHROPIC_BASE_URL: "https://other.example" } }),
    )
    const res = await buildApp().request("/apps/claude-code/toggle", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    })
    expect(res.status).toBe(409)
    expect(ApiErrorBody.parse(await res.json()).error.type).toBe(
      "claude-code-foreign-base-url",
    )
    // We did NOT overwrite the user's base URL.
    expect(isProxyBaseUrlConfigured(ROUTE_CC_SETTINGS)).toBe(false)
    expect(getConfig().apps?.claudeCode?.enabled).not.toBe(true)
    const list = AppsListResponse.parse(
      await (await buildApp().request("/apps")).json(),
    )
    expect(
      list.apps.find((entry: { id: string }) => entry.id === "claude-code"),
    ).toMatchObject({ enabled: false, conflict: "foreign-base-url" })
  })

  test("another local gateway and its owned helper are preserved on refusal", async () => {
    installsFixture = [fakeInstall("/opt/homebrew/bin/claude")]
    const { mergeBaseUrl } = await import("~/apps/claude-code/config")
    const settings = mergeBaseUrl({}, "echo 'other-gateway-key'")
    settings.env = {
      ...(settings.env as object),
      ANTHROPIC_BASE_URL: "http://127.0.0.1:4142",
    }
    const original = JSON.stringify(settings)
    fs.writeFileSync(ROUTE_CC_SETTINGS, original)
    const res = await buildApp().request("/apps/claude-code/toggle", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    })
    expect(res.status).toBe(409)
    expect(ApiErrorBody.parse(await res.json()).error.type).toBe(
      "claude-code-foreign-base-url",
    )
    expect(fs.readFileSync(ROUTE_CC_SETTINGS, "utf8")).toBe(original)
  })

  test("a custom helper refusal stays visible after refreshing apps", async () => {
    installsFixture = [fakeInstall("/opt/homebrew/bin/claude")]
    const original = JSON.stringify({ apiKeyHelper: "my-custom-helper secret" })
    fs.writeFileSync(ROUTE_CC_SETTINGS, original)
    const app = buildApp()
    const res = await app.request("/apps/claude-code/toggle", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    })
    expect(res.status).toBe(409)
    const body = ApiErrorBody.parse(await res.json())
    expect(body.error.type).toBe("claude-code-foreign-api-key-helper")
    expect(JSON.stringify(body)).not.toContain("secret")
    expect(fs.readFileSync(ROUTE_CC_SETTINGS, "utf8")).toBe(original)
    const list = AppsListResponse.parse(
      await (await app.request("/apps")).json(),
    )
    expect(
      list.apps.find((entry: { id: string }) => entry.id === "claude-code"),
    ).toMatchObject({ enabled: false, conflict: "foreign-api-key-helper" })
  })

  test("disable reverts the base URL and persists enabled=false", async () => {
    installsFixture = [fakeInstall("/opt/homebrew/bin/claude")]
    const app = buildApp()
    await app.request("/apps/claude-code/toggle", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    })
    const res = await app.request("/apps/claude-code/toggle", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { enabled: boolean }
    expect(body.enabled).toBe(false)
    expect(getConfig().apps?.claudeCode?.enabled).toBe(false)
    expect(isProxyBaseUrlConfigured(ROUTE_CC_SETTINGS)).toBe(false)
  })

  test("bad body returns 400", async () => {
    const res = await buildApp().request("/apps/claude-code/toggle", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: "yes" }),
    })
    expect(res.status).toBe(400)
  })
})

describe("POST /apps/claude-desktop/toggle", () => {
  let detect: ReturnType<typeof spyOn<typeof claudeDesktopApp, "detect">>

  beforeEach(() => {
    detect = spyOn(claudeDesktopApp, "detect").mockResolvedValue(true)
  })

  afterEach(() => detect.mockRestore())

  test("a missing app returns installation help without writing configuration", async () => {
    detect.mockResolvedValue(false)
    const res = await buildApp().request("/apps/claude-desktop/toggle", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    })
    expect(res.status).toBe(409)
    expect(ApiErrorBody.parse(await res.json()).error.type).toBe(
      "claude-desktop-not-installed",
    )
    expect(getConfig().apps?.claudeDesktop?.enabled).not.toBe(true)
    expect(actualDesktop.isConfigLibraryApplied(ROUTE_3P_HOME)).toBe(false)
    expect(fs.readdirSync(ROUTE_3P_HOME)).toEqual([])
  })

  test("configuration failure is not reported as a missing installation", async () => {
    const enable = spyOn(claudeDesktopApp, "enable").mockRejectedValue(
      new Error("Permission denied"),
    )
    try {
      const res = await buildApp().request("/apps/claude-desktop/toggle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      })
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(ApiErrorBody.parse(await res.json()).error.type).not.toBe(
        "claude-desktop-not-installed",
      )
      expect(getConfig().apps?.claudeDesktop?.enabled).not.toBe(true)
    } finally {
      enable.mockRestore()
    }
  })

  test("enable applies proxy config and persists enabled=true", async () => {
    const res = await buildApp().request("/apps/claude-desktop/toggle", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string; enabled: boolean }
    expect(body.id).toBe("claude-desktop")
    expect(body.enabled).toBe(true)
    expect(getConfig().apps?.claudeDesktop?.enabled).toBe(true)
    expect(actualDesktop.isConfigLibraryApplied(ROUTE_3P_HOME)).toBe(true)
  })

  test("disable reverts proxy config and persists enabled=false", async () => {
    const app = buildApp()
    await app.request("/apps/claude-desktop/toggle", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    })
    // Disconnect must still remove saved configuration after uninstallation.
    detect.mockResolvedValue(false)
    const res = await app.request("/apps/claude-desktop/toggle", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    })
    expect(res.status).toBe(200)
    expect(getConfig().apps?.claudeDesktop?.enabled).toBe(false)
    expect(actualDesktop.isConfigLibraryApplied(ROUTE_3P_HOME)).toBe(false)
  })
})

test("missing Codex returns installation help before applying any settings", async () => {
  const { codexApp } = await import("~/apps/codex")
  const detect = spyOn(codexApp, "detect").mockResolvedValue(false)
  const enable = spyOn(codexApp, "enable").mockResolvedValue({ success: true })
  try {
    const res = await buildApp().request("/apps/codex/toggle", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    })
    expect(res.status).toBe(409)
    expect(ApiErrorBody.parse(await res.json()).error.type).toBe(
      "codex-not-installed",
    )
    expect(enable).not.toHaveBeenCalled()
  } finally {
    detect.mockRestore()
    enable.mockRestore()
  }
})

test.each([undefined, true, false])(
  "Codex connect configures native reviews regardless of legacy flag %s",
  async (automaticReview) => {
    const { codexApp } = await import("~/apps/codex")
    const detect = spyOn(codexApp, "detect").mockResolvedValue(true)
    const enable = spyOn(codexApp, "enable").mockResolvedValue({
      success: true,
      restartRequired: true,
    })
    const details = spyOn(codexApp, "getDetails").mockResolvedValue({
      id: "codex",
      name: "Codex CLI and Desktop",
      kind: "config",
      enabled: true,
      status: "ready",
      installs: [],
      install: null,
      conflict: null,
      routing: {
        model: "gpt-6-luna",
        available_models: [],
        managed: true,
        automatic_review: true,
      },
    })
    try {
      const response = await buildApp().request("/apps/codex/toggle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: true, automaticReview }),
      })
      expect(response.status).toBe(200)
      expect(enable).toHaveBeenCalledWith({ model: undefined })
      expect(await response.json()).toMatchObject({
        routing: { restart_required: true },
      })
    } finally {
      detect.mockRestore()
      enable.mockRestore()
      details.mockRestore()
    }
  },
)
