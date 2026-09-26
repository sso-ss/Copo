import { afterEach, expect, test } from "bun:test"

import type { CompanionData } from "~/lib/config/companion-types"

import {
  markSignedIn,
  __resetAuthControllerForTests,
} from "~/lib/auth/auth-controller"
import { writeConfig } from "~/lib/config/config"
import {
  clearLastUpstreamRejection,
  setLastUpstreamRejection,
} from "~/lib/runtime-state/state"
import { companionRoutes } from "~/routes/settings/companion"

import { CompanionState } from "../shell/src/companion/state"

afterEach(() => {
  writeConfig({})
  __resetAuthControllerForTests()
  clearLastUpstreamRejection()
})

const read = async () =>
  (await (await companionRoutes.request("/")).json()) as CompanionData

test("gateway health distinguishes signed out, authorized, and upstream rejection without exposing error details", async () => {
  __resetAuthControllerForTests()
  expect((await read()).gateway).toBe("sign-in-required")
  markSignedIn("octocat")
  clearLastUpstreamRejection()
  expect((await read()).gateway).toBe("ready")
  setLastUpstreamRejection({
    message: "private upstream detail",
    remediationUrl: null,
    status: 429,
  })
  const data = await read()
  expect(data.gateway).toBe("upstream-error")
  expect(JSON.stringify(data)).not.toContain("private upstream detail")
})

test("companion exposes identity and named connections without credentials or planned integrations", async () => {
  writeConfig({
    auth: {
      apiKeyEntries: [
        {
          id: "custom",
          key: "private-key-never-display",
          label: "My tool",
          enabled: true,
          created_at: "2026-09-25",
        },
      ],
    },
  })
  markSignedIn("octocat", "https://example.com/avatar.png")
  const response = await companionRoutes.request("/")
  const text = await response.text()
  expect(response.status).toBe(200)
  expect(text).toContain("octocat")
  expect(text).toContain("My tool")
  expect(text).not.toContain("private-key-never-display")
  expect(text).not.toContain("copilot-cli")
  expect(text).toContain('"generation"')
})

test("disabled connections remain listed so their switches can enable them again", async () => {
  writeConfig({
    apps: { claudeCode: { enabled: false } },
    auth: {
      apiKeyEntries: [
        {
          id: "custom",
          key: "private-key-never-display",
          label: "My tool",
          enabled: false,
          created_at: "2026-09-25",
        },
      ],
    },
  })
  const response = await companionRoutes.request("/")
  const data = (await response.json()) as CompanionData
  expect(
    data.connections.find((connection) => connection.id === "claude-code")
      ?.configured,
  ).toBe(false)
  expect(
    data.connections.find((connection) => connection.id === "key:custom")
      ?.configured,
  ).toBe(false)
})

test("all three supported tools exhaust Add a tool even while their switches are off", async () => {
  markSignedIn("octocat")
  const data = await read()
  expect(data.availableToolIds).toEqual([
    "claude-code",
    "claude-desktop",
    "codex",
  ])
  const state = new CompanionState()
  state.update({
    ...data,
    connections: data.connections.map((connection) => ({
      ...connection,
      configured: false,
    })),
  })
  expect(state.canAddTool).toBe(false)
})
