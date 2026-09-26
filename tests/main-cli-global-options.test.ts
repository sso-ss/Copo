import { afterAll, describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

interface DebugInfo {
  paths: {
    APP_DIR: string
    GITHUB_TOKEN_PATH: string
  }
}

const cwd = fileURLToPath(new URL("../", import.meta.url))
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "copo-cli-options-"))

afterAll(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true })
})
const decoder = new TextDecoder()
const baseEnv = {
  ...process.env,
  COPILOT_API_HOME: path.join(tmpHome, "default"),
  COPILOT_API_OAUTH_APP: "",
  COPILOT_API_ENTERPRISE_URL: "",
}

const runDebugJson = (...args: Array<string>): DebugInfo => {
  const result = Bun.spawnSync({
    cmd: [process.execPath, "run", "./src/main.ts", ...args, "debug", "--json"],
    cwd,
    env: baseEnv,
  })
  const stdout = decoder.decode(result.stdout)
  const stderr = decoder.decode(result.stderr)

  if (result.exitCode !== 0) {
    throw new Error(
      `CLI command failed with exit code ${result.exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    )
  }

  return JSON.parse(stdout) as DebugInfo
}

describe("root-level global CLI options", () => {
  test("storage-path returns only the JSON path consumed by the desktop shell", () => {
    const result = Bun.spawnSync({
      cmd: [
        process.execPath,
        "run",
        "./src/main.ts",
        `--api-home=${tmpHome}`,
        "storage-path",
      ],
      cwd,
      env: baseEnv,
    })
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(decoder.decode(result.stdout))).toBe(tmpHome)
  })
  test("supports --api-home=value before the subcommand", () => {
    const info = runDebugJson(`--api-home=${tmpHome}`)

    expect(info.paths.APP_DIR).toBe(tmpHome)
    expect(info.paths.GITHUB_TOKEN_PATH).toBe(
      path.join(tmpHome, "github_token"),
    )
  })

  test("supports --oauth-app=value before the subcommand", () => {
    const info = runDebugJson("--oauth-app=opencode")

    expect(path.basename(path.dirname(info.paths.GITHUB_TOKEN_PATH))).toBe(
      "opencode",
    )
    expect(path.basename(info.paths.GITHUB_TOKEN_PATH)).toBe("github_token")
  })

  test("supports --enterprise-url=value before the subcommand", () => {
    const info = runDebugJson("--enterprise-url=ghe.example.com")

    expect(path.basename(info.paths.GITHUB_TOKEN_PATH)).toBe("ent_github_token")
  })

  test("supports combining root-level global CLI options", () => {
    const info = runDebugJson(
      `--api-home=${tmpHome}`,
      "--oauth-app=myapp",
      "--enterprise-url=ghe.example.com",
    )

    expect(info.paths.APP_DIR).toBe(tmpHome)
    expect(info.paths.GITHUB_TOKEN_PATH).toBe(
      path.join(tmpHome, "myapp", "ent_github_token"),
    )
  })
})
