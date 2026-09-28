import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { stripVTControlCharacters } from "node:util"
import { z } from "zod"

const attemptSchema = z.object({
  exitCode: z.number(), timedOut: z.boolean(), signature: z.string(),
  evidence: z.string().max(16000), artifact: z.string(),
})
export const checkSchema = z.object({
  id: z.string(), title: z.string(), area: z.enum(["backend", "code", "ui"]),
  status: z.enum(["passed", "failed", "flaky", "error", "skipped"]),
  reproduction: z.string(), attempts: z.array(attemptSchema),
})
export const suggestionSchema = z.object({
  title: z.string().max(200), severity: z.enum(["high", "medium", "low"]),
  location: z.string().max(500), evidence: z.string().max(3000),
  explanation: z.string().max(3000), verification: z.string().max(2000),
})
export const reportSchema = z.object({
  version: z.literal(1), commit: z.string().regex(/^[a-f0-9]{40}$/), dirty: z.boolean(),
  createdAt: z.string(), runUrl: z.string(), runtime: z.string(),
  checks: z.array(checkSchema), screenshots: z.array(z.string()),
  ai: z.object({ status: z.enum(["pending", "complete", "skipped", "error"]),
    model: z.string(), note: z.string(), files: z.array(z.string()),
    findings: z.array(suggestionSchema).max(20) }),
  publications: z.array(z.object({ check: z.string(), action: z.string(), url: z.string() })),
})
export type Check = z.infer<typeof checkSchema>
export type Attempt = z.infer<typeof attemptSchema>
export type Report = z.infer<typeof reportSchema>

export function redact(value: string): string {
  let text = stripVTControlCharacters(value)
  for (const name of ["QA_API_KEY", "GH_TOKEN", "GITHUB_TOKEN", "OPENAI_API_KEY"]) {
    const secret = process.env[name]
    if (secret) text = text.replaceAll(secret, "[REDACTED]")
  }
  return text
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{12,})\b/g, "[REDACTED]")
    .replace(/(Bearer\s+)\S+/gi, "$1[REDACTED]")
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password)\s*["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, "$1[REDACTED]")
    .replaceAll(process.cwd(), "<repo>")
    .replace(/\/private\/var\/folders\/[^\s:)]+|\/tmp\/[^\s:)]+/g, "<temp>")
}

export function signature(log: string): string {
  const lines = redact(log).split("\n").filter(line => /\(fail\)|error TS\d+|\berror\b|Error:|QA_ASSERT:/i.test(line))
  // Duration, PID, address, and timestamp changes must not defeat reproduction.
  const normalized = lines.join("\n").replace(/\b\d+(?:\.\d+)?(?:ms|s)\b/g, "<duration>")
    .replace(/\b\d{4}-\d\d-\d\dT\S+/g, "<time>")
    .replace(/0x[0-9a-f]+/gi, "<address>")
  return normalized ? createHash("sha256").update(normalized).digest("hex").slice(0, 20) : ""
}

export function classify(attempts: Attempt[]): Check["status"] {
  if (attempts.some(a => a.timedOut)) return "error"
  if (attempts[0]?.exitCode === 0) return "passed"
  if (attempts.some(a => a.exitCode === 0)) return "flaky"
  if (attempts.length >= 2 && attempts[0].signature && attempts.every(a => a.signature === attempts[0].signature)) return "failed"
  return "error"
}

export function publishable(check: Check): boolean {
  return check.status === "failed" && classify(check.attempts) === "failed"
}

export function fingerprint(check: Check): string {
  return createHash("sha256").update(`${check.id}:${check.attempts[0]?.signature}`).digest("hex").slice(0, 24)
}

export async function loadReport(dir: string): Promise<Report> {
  return reportSchema.parse(JSON.parse(await readFile(resolve(dir, "report.json"), "utf8")))
}

export function markdown(report: Report): string {
  const lines = ["# CoPo QA report", "", `Commit: ${report.commit}${report.dirty ? " (uncommitted changes present)" : ""}`,
    `Created: ${report.createdAt}`, `Runtime: ${report.runtime}`, "",
    "| Area | Check | Result |", "| --- | --- | --- |",
    ...report.checks.map(c => `| ${c.area} | ${c.title} | ${c.status} |`), "",
    "Failed means the same diagnostic occurred twice. Flaky or incomplete checks need investigation.", "",
    "## Findings", ""]
  for (const check of report.checks.filter(c => c.status !== "passed")) {
    lines.push(`### ${check.title} — ${check.status}`, "", check.reproduction, "")
    for (const [index, attempt] of check.attempts.entries()) {
      lines.push(`Attempt ${index + 1}: exit ${attempt.exitCode}${attempt.timedOut ? " (timeout)" : ""}. [Evidence](${attempt.artifact})`,
        "", "~~~~text", attempt.evidence.slice(-6000), "~~~~", "")
    }
  }
  lines.push("## AI review", "", `Status: ${report.ai.status}. ${report.ai.note}`, "", `Model: ${report.ai.model || "not selected"}`, "",
    "AI suggestions are unverified and are not automatically published as bugs.", "")
  for (const f of report.ai.findings) lines.push(`### ${f.title} (${f.severity})`, "", f.location, "", f.explanation, "", f.evidence, "", `Verify: ${f.verification}`, "")
  if (report.ai.files.length) lines.push("Reviewed source files:", ...report.ai.files.map(f => `- ${f}`), "")
  lines.push("## Screenshots", "", ...report.screenshots.map(s => `- [${s}](${s})`), "", "## GitHub", "",
    ...report.publications.map(p => `- ${p.check}: ${p.action}${p.url ? ` — ${p.url}` : ""}`), "",
    "Coverage: backend test suite, code checks, and browser UI against fixtures. Native desktop behavior and live upstream inference correctness are outside this run.", "")
  return lines.join("\n")
}

export async function saveReport(dir: string, report: Report): Promise<void> {
  await mkdir(dir, { recursive: true })
  // Sanitize all text, including model output, before writing publishable artifacts.
  const safe = reportSchema.parse(JSON.parse(JSON.stringify(report, (_key, value: unknown) =>
    typeof value === "string" ? redact(value) : value)))
  await writeFile(resolve(dir, "report.json"), JSON.stringify(safe, null, 2) + "\n")
  await writeFile(resolve(dir, "report.md"), markdown(safe))
}
