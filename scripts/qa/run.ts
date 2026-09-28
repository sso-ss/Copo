#!/usr/bin/env bun
import { appendFile, mkdir, readFile, readdir } from "node:fs/promises"
import { resolve } from "node:path"
import { parseArgs } from "node:util"
import { command, runCheck } from "./process"
import { loadReport, markdown, redact, saveReport, type Report } from "./report"
import { reviewWithAi } from "./review"
import { reviewUi } from "./ui"
import { publish } from "./publish"

const { values } = parseArgs({ args: process.argv.slice(2), strict: true, options: {
  "no-ai": { type: "boolean", default: false }, "no-ui": { type: "boolean", default: false },
  publish: { type: "boolean", default: false }, "publish-only": { type: "boolean", default: false },
  "review-only": { type: "boolean", default: false }, repo: { type: "string" }, out: { type: "string" },
  limit: { type: "string", default: "3" }, help: { type: "boolean" },
} })
if (values.help) {
  console.log("CoPo QA: bun run qa [--no-ai] [--no-ui] [--out reports/qa/run] [--publish --repo owner/repo] [--limit 3]\nResume an existing report: --review-only or --publish-only --out <directory>.\nAI: QA_MODEL=<CoPo model> QA_API_BASE_URL=http://127.0.0.1:4141/v1/ QA_API_KEY=<optional>")
  process.exit(0)
}
if ([values["review-only"], values["publish-only"]].filter(Boolean).length > 1) throw new Error("Choose one resume mode")
if ((values["review-only"] || values["publish-only"]) && !values.out) throw new Error("Resume requires --out with an existing report directory")
if ((values.publish || values["publish-only"]) && !values.repo) throw new Error("Publishing requires --repo owner/repo")
const dir = resolve(values.out || `reports/qa/${new Date().toISOString().replace(/[:.]/g, "-")}`)
const resuming = values["review-only"] || values["publish-only"]
if (!resuming && (await readdir(dir).catch(() => [])).length) throw new Error("Choose a new --out directory; an existing run must be resumed explicitly")
await mkdir(dir, { recursive: true })
const report: Report = resuming ? await loadReport(dir) : {
  version: 1, commit: await command(["git", "rev-parse", "HEAD"]),
  dirty: Boolean(await command(["git", "status", "--porcelain", "--untracked-files=normal"])),
  createdAt: new Date().toISOString(), runtime: `Bun ${Bun.version}; ${process.platform}/${process.arch}`,
  runUrl: process.env.GITHUB_ACTIONS ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : "",
  checks: [], screenshots: [], ai: { status: "pending", model: "", note: "", files: [], findings: [] }, publications: [],
}
let incomplete = false
try {
  if (!resuming) {
    const pinned = (await readFile(".bun-version", "utf8")).trim()
    if (Bun.version !== pinned) throw new Error(`QA requires Bun ${pinned}; found ${Bun.version}. Use the project pin before reviewing.`)
    for (const [id, title, area, args] of [
      ["lint", "Code lint", "code", ["run", "lint:all"]],
      ["types", "Type checks", "code", ["run", "typecheck"]],
      ["qa-types", "QA tooling type checks", "code", ["run", "qa:typecheck"]],
      ["backend", "Backend and contract tests", "backend", ["test"]],
      ["build", "Proxy build", "backend", ["run", "build"]],
      ["design", "Design tokens", "ui", ["run", "check:tokens"]],
    ] as const) {
      report.checks.push(await runCheck({ id, title, area }, [process.execPath, ...args], dir))
      await saveReport(dir, report)
    }
    if (!values["no-ui"]) {
      const build = await runCheck({ id: "ui-build", title: "UI build", area: "ui" }, [process.execPath, "run", "build:ui"], dir)
      report.checks.push(build)
      if (build.status === "passed") {
        try { await reviewUi(dir, report) }
        catch (error) {
          report.checks.push({ id: "ui-runner", title: "Browser QA infrastructure", area: "ui", status: "error", attempts: [], reproduction: redact(String(error)) })
        }
      }
    } else report.checks.push({ id: "ui", title: "Browser checks", area: "ui", status: "skipped", reproduction: "Disabled by --no-ui", attempts: [] })
    await saveReport(dir, report)
    if (report.commit !== await command(["git", "rev-parse", "HEAD"])) {
      report.dirty = true
      throw new Error("Source commit changed during review; rerun against a stable checkout")
    }
    report.dirty ||= Boolean(await command(["git", "status", "--porcelain", "--untracked-files=normal"]))
  }
  if (!values["publish-only"]) {
    if (values["no-ai"]) report.ai = { status: "skipped", model: "", note: "Disabled by --no-ai. Local CoPo is required for AI review.", files: [], findings: [] }
    else {
      if (resuming && (report.commit !== await command(["git", "rev-parse", "HEAD"]) || report.dirty || await command(["git", "status", "--porcelain"]))) throw new Error("AI resume requires the same clean checkout as the report")
      report.ai.files = []
      try { await reviewWithAi(dir, report) }
      catch (error) { report.ai.status = "error"; report.ai.note = redact(String(error)); incomplete = true }
    }
  }
  await saveReport(dir, report)
  if (values.publish || values["publish-only"]) await publish(dir, report, values.repo!, Number(values.limit))
} catch (error) {
  incomplete = true
  report.ai.note += `\nRun error: ${redact(String(error))}`
  console.error(redact(String(error)))
} finally {
  await saveReport(dir, report)
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown(report))
  console.log(`QA report: ${dir}/report.md`)
}
process.exitCode = incomplete || report.checks.some(c => c.status === "error" || c.status === "flaky") ? 2
  : report.checks.some(c => c.status === "failed") ? 1 : 0
