import { describe, expect, test } from "bun:test"

import {
  claudeAppCandidates,
  claudeAppInstalled,
} from "~/apps/claude-desktop/detect"
import { claudeCodeInstallHint } from "~/lib/config/app-install-hints"

import { isMissingAppError } from "../shell/src/ui/features/apps/configuration"

describe("app setup help", () => {
  test("only an explicit missing-app code opens installation help", () => {
    expect(
      isMissingAppError(
        JSON.stringify({
          error: {
            type: "claude-desktop-not-installed",
            message: "Install Claude Desktop",
          },
        }),
        "claude-desktop",
      ),
    ).toBe(true)
    for (const error of [
      undefined,
      "Gateway unavailable",
      "null",
      "{}",
      "<html>Error</html>",
      JSON.stringify({ error: { type: "claude-code-not-installed" } }),
      JSON.stringify({
        error: { type: "permission-denied", message: "not-installed" },
      }),
      JSON.stringify({ error: { type: "claude-desktop-missing-api-key" } }),
    ]) {
      expect(isMissingAppError(error, "claude-desktop")).toBe(false)
    }
  })

  test("Claude Code installation commands use the appropriate shell", () => {
    expect(claudeCodeInstallHint(false)).toEqual({
      method: "bash",
      command: "curl -fsSL https://claude.ai/install.sh | bash",
    })
    expect(claudeCodeInstallHint(true)).toEqual({
      method: "powershell",
      command: "irm https://claude.ai/install.ps1 | iex",
    })
  })

  test("Desktop discovery includes the user's Applications folder", () => {
    expect(claudeAppCandidates("darwin", "/test-user")).toEqual([
      "/Applications/Claude.app",
      "/test-user/Applications/Claude.app",
    ])
  })

  test("unsupported platforms do not claim that Desktop is installed", () => {
    expect(claudeAppInstalled("linux", "/test-user")).toBe(false)
  })
})
