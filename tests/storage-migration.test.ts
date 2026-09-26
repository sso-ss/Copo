import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { prepareAppStorage } from "~/lib/platform/storage-migration"

let home: string
let legacy: string
let destination: string

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "copo-storage-"))
  legacy = path.join(home, ".local", "share", "maximal")
  destination = path.join(home, ".local", "share", "copo")
  fs.mkdirSync(legacy, { recursive: true })
})

afterEach(() => fs.rmSync(home, { recursive: true, force: true }))

const migrate = (isRunning: (pid: number) => boolean = () => false) =>
  prepareAppStorage({ platform: "darwin", homedir: home }, isRunning)

describe("Copo storage upgrade", () => {
  test("moves the complete store and retains private file permissions", () => {
    const files = [
      "accounts.json",
      "config.json",
      "copilot-api.sqlite",
      "copilot-api.sqlite-wal",
      "locale",
      "personalization.json",
    ]
    for (const name of files) {
      fs.writeFileSync(path.join(legacy, name), `saved ${name}`, {
        mode: 0o600,
      })
    }
    fs.mkdirSync(path.join(legacy, "secrets"), { mode: 0o700 })
    fs.writeFileSync(
      path.join(legacy, "secrets", "provider"),
      "saved provider",
      { mode: 0o600 },
    )
    expect(migrate()).toBe(destination)
    expect(fs.existsSync(legacy)).toBe(false)
    for (const name of files) {
      expect(fs.readFileSync(path.join(destination, name), "utf8")).toBe(
        `saved ${name}`,
      )
      if (process.platform !== "win32") {
        expect(fs.statSync(path.join(destination, name)).mode & 0o777).toBe(
          0o600,
        )
      }
    }
    expect(
      fs.readFileSync(path.join(destination, "secrets", "provider"), "utf8"),
    ).toBe("saved provider")
    expect(migrate()).toBe(destination)
  })

  test("does not merge or overwrite an existing Copo store", () => {
    fs.mkdirSync(destination)
    fs.writeFileSync(path.join(destination, "config.json"), "new settings")
    fs.writeFileSync(path.join(legacy, "config.json"), "old settings")
    expect(migrate()).toBe(destination)
    expect(fs.readFileSync(path.join(destination, "config.json"), "utf8")).toBe(
      "new settings",
    )
    expect(fs.readFileSync(path.join(legacy, "config.json"), "utf8")).toBe(
      "old settings",
    )
  })

  test("leaves explicit custom locations and the legacy folder untouched", () => {
    const custom = path.join(home, "custom")
    expect(
      prepareAppStorage({
        platform: "darwin",
        homedir: home,
        copilotApiHome: custom,
      }),
    ).toBe(custom)
    expect(fs.existsSync(legacy)).toBe(true)
    expect(fs.existsSync(destination)).toBe(false)
  })

  test.each(["maximal.pid", "session-running"])(
    "refuses to move a store while %s identifies a live process",
    (name) => {
      fs.writeFileSync(
        path.join(legacy, name),
        name === "maximal.pid" ? "123" : JSON.stringify({ pid: 123 }),
      )
      expect(() => migrate((pid) => pid === 123)).toThrow("Quit the running")
      expect(fs.existsSync(legacy)).toBe(true)
      expect(fs.existsSync(destination)).toBe(false)
      expect(migrate(() => false)).toBe(destination)
    },
  )

  test("does not enter a migration already in progress", () => {
    fs.mkdirSync(
      path.join(path.dirname(destination), ".copo-storage-migration.lock"),
    )
    expect(() => migrate()).toThrow()
    expect(fs.existsSync(legacy)).toBe(true)
    expect(fs.existsSync(destination)).toBe(false)
  })

  test("moves the Windows roaming store using the same rule", () => {
    const roaming = path.join(home, "Roaming")
    fs.mkdirSync(path.join(roaming, "maximal"), { recursive: true })
    fs.writeFileSync(path.join(roaming, "maximal", "accounts.json"), "accounts")
    const target = prepareAppStorage({
      platform: "win32",
      homedir: home,
      appData: roaming,
    })
    expect(target).toBe(path.join(roaming, "copo"))
    expect(fs.readFileSync(path.join(target, "accounts.json"), "utf8")).toBe(
      "accounts",
    )
  })
})
