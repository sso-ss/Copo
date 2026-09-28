import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { chromium, type Page } from "playwright"
import { classify, redact, signature, type Check, type Report } from "./report"

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`QA_ASSERT: ${message}`)
}

const sections = ["account", "apps", "models", "usage", "personalization"]
const scenarios = ["signed-in", "signed-out", "auth-error", "upstream-rejection"]

async function waitForState(page: Page, scenario: string): Promise<void> {
  const state = scenario === "signed-out" ? "unauthenticated" : scenario === "auth-error" ? "error" : "authenticated"
  await page.locator(`[data-state-account="${state}"]`).waitFor({ state: "visible" })
  if (scenario === "upstream-rejection") {
    await page.getByText("You have exceeded your Copilot usage limit.", { exact: false }).first().waitFor({ state: "visible" })
  }
}

export async function reviewUi(dir: string, report: Report): Promise<void> {
  // Port 0 asks the OS for a free port. Read the child's actual listener from its
  // startup message; never probe or send mutations to another local service.
  const harness = Bun.spawn([process.execPath, "scripts/ui-harness.ts", "--port", "0"], { stdout: "ignore", stderr: "pipe" })
  let startup = ""
  let origin = ""
  const readStartup = (async () => {
    for await (const chunk of harness.stderr) {
      startup = (startup + new TextDecoder().decode(chunk)).slice(-16000)
      const match = startup.match(/on (http:\/\/127\.0\.0\.1:\d+)/)
      if (match) origin = match[1]
    }
  })()
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    for (let i = 0; i < 100 && !origin && harness.exitCode === null; i++) await Bun.sleep(100)
    if (!origin || origin.endsWith(":0")) throw new Error(`UI harness did not report a usable port: ${startup}`)
    browser = await chromium.launch()
    await mkdir(resolve(dir, "screenshots"), { recursive: true })
    await mkdir(resolve(dir, "logs"), { recursive: true })
    for (const scenario of scenarios) {
      for (const theme of ["light", "dark"] as const) {
        const id = `ui-${scenario}-${theme}`
        const check: Check = { id, title: `Settings and dashboard: ${scenario}, ${theme}`, area: "ui", status: "error",
          reproduction: `Run bun run ui:harness, select ${scenario} and ${theme}; open each Settings tab and the dashboard at 900×700. For the signed-out scenario, start sign-in and verify the pending code screen.`, attempts: [] }
        console.log(`QA: ${check.title}`)
        for (let attempt = 1; attempt <= 2; attempt++) {
          const response = await fetch(`${origin}/__harness/scenario`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: scenario }) })
          assert(response.ok, "Could not select fixture scenario")
          const context = await browser.newContext({ viewport: { width: 900, height: 700 }, colorScheme: theme, reducedMotion: "reduce", locale: "en-US" })
          // External avatars are cosmetic; no QA browser request reaches a real account.
          await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.fulfill({ status: 204, body: "" }))
          const page = await context.newPage()
          page.setDefaultTimeout(7000)
          const errors: string[] = []
          const unavailable: string[] = []
          page.on("pageerror", error => errors.push(error.message))
          page.on("response", res => { if (res.url().startsWith(origin) && res.status() >= 400) unavailable.push(`${res.status()} ${new URL(res.url()).pathname}`) })
          await context.tracing.start({ screenshots: true, snapshots: true })
          let failure = ""
          let harnessGap = false
          try {
            await page.goto(`${origin}/ui/settings/`, { waitUntil: "domcontentloaded" })
            await waitForState(page, scenario)
            await page.locator("#__harness-theme").selectOption(theme)
            await page.addStyleTag({ content: "#__harness { display: none !important; }" })
            for (const section of sections) {
              await page.locator(`[data-nav="${section}"]`).click()
              await page.locator(`[data-section="${section}"]`).waitFor({ state: "visible" })
              await page.waitForTimeout(200)
              const shot = `screenshots/${id}-${section}.png`
              await page.screenshot({ path: resolve(dir, shot) })
              if (!report.screenshots.includes(shot)) report.screenshots.push(shot)
              const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2)
              assert(fits, `Settings ${section} causes horizontal window overflow`)
            }
            if (scenario === "signed-out") {
              await page.locator('[data-nav="account"]').click()
              await page.locator('[data-state-account="unauthenticated"] [data-action="auth-start"]').click()
              await page.locator('[data-state-account="pending"]').waitFor({ state: "visible" })
              await page.getByText("WXYZ-1234", { exact: false }).first().waitFor({ state: "visible" })
            }
            await page.goto(`${origin}/ui/dashboard/`, { waitUntil: "domcontentloaded" })
            await page.locator("#__harness-theme").selectOption(theme)
            await page.addStyleTag({ content: "#__harness { display: none !important; }" })
            await page.waitForTimeout(500)
            assert((await page.locator("body").innerText()).trim().length > 100, "Dashboard renders no useful content")
            const shot = `screenshots/${id}-dashboard.png`
            await page.screenshot({ path: resolve(dir, shot) })
            if (!report.screenshots.includes(shot)) report.screenshots.push(shot)
            // Missing mock endpoints indicate harness coverage, not product bugs.
            harnessGap = unavailable.length > 0
            assert(!harnessGap, `Harness HTTP coverage is incomplete: ${unavailable.join(", ")}`)
            assert(errors.length === 0, `Uncaught browser errors: ${errors.join("; ")}`)
          } catch (error) {
            failure = redact(error instanceof Error ? error.message : String(error))
            harnessGap ||= unavailable.length > 0
            const shot = `screenshots/${id}-failure-${attempt}.png`
            await page.screenshot({ path: resolve(dir, shot) }).then(() => report.screenshots.push(shot)).catch(() => {})
          } finally {
            await context.tracing.stop({ path: resolve(dir, `logs/${id}-${attempt}.zip`) })
            await context.close()
          }
          const artifact = `logs/${id}-${attempt}.txt`
          const evidence = redact([failure || "All UI assertions passed.", ...errors, ...unavailable].join("\n"))
          await writeFile(resolve(dir, artifact), evidence)
          check.attempts.push({ exitCode: failure ? 1 : 0, timedOut: false, signature: signature(evidence), evidence, artifact })
          // Playwright locator failures can be an outdated test or harness gap.
          // Only explicit product assertions are eligible for tickets.
          if (!failure || harnessGap || !failure.startsWith("QA_ASSERT:")) break
        }
        check.status = classify(check.attempts)
        report.checks.push(check)
      }
    }
  } finally {
    await browser?.close()
    harness.kill()
    await harness.exited
    await readStartup
  }
}
