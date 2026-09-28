import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  issueBody,
  matchIssue,
  publish,
  type GitHubClient,
} from "../scripts/qa/publish"
import {
  classify,
  fingerprint,
  loadReport,
  publishable,
  redact,
  saveReport,
  signature,
  type Attempt,
  type Check,
  type Report,
} from "../scripts/qa/report"
import { parseReviewOutput } from "../scripts/qa/review"
import { usageFixture } from "../scripts/ui-harness-usage"

const failed: Attempt = {
  exitCode: 1,
  timedOut: false,
  signature: signature("error: request stream ended early"),
  evidence: "error: request stream ended early",
  artifact: "logs/backend-1.txt",
}
const check: Check = {
  id: "backend",
  title: "Backend tests",
  area: "backend",
  status: "failed",
  reproduction: "Run bun test in isolated test state",
  attempts: [failed, { ...failed, artifact: "logs/backend-2.txt" }],
}
function report(): Report {
  return {
    version: 1,
    commit: "a".repeat(40),
    dirty: false,
    createdAt: "2026-09-28T00:00:00Z",
    runtime: "Bun 1.3.14; test",
    runUrl: "",
    checks: [check],
    screenshots: [],
    ai: {
      status: "complete",
      model: "fixture",
      note: "",
      files: [],
      findings: [],
    },
    publications: [],
  }
}

describe("QA reproduction policy", () => {
  test("requires two matching diagnostic signatures", () => {
    expect(classify(check.attempts)).toBe("failed")
    expect(publishable(check)).toBe(true)
    expect(publishable({ ...check, attempts: [failed] })).toBe(false)
    expect(classify([failed, { ...failed, signature: "another-error" }])).toBe(
      "error",
    )
    expect(classify([{ ...failed, signature: "" }, failed])).toBe("error")
  })

  test("passing retry and timeout never become issues", () => {
    expect(classify([failed, { ...failed, exitCode: 0 }])).toBe("flaky")
    expect(classify([failed, { ...failed, timedOut: true }])).toBe("error")
    expect(
      publishable({
        ...check,
        attempts: [failed, { ...failed, timedOut: true }],
      }),
    ).toBe(false)
  })

  test("normalizes variable timings without merging distinct failures", () => {
    expect(signature("(fail) stream recovery [1.12ms]")).toBe(
      signature("(fail) stream recovery [29.43ms]"),
    )
    expect(signature("(fail) stream recovery")).not.toBe(
      signature("(fail) auth recovery"),
    )
  })
})

describe("QA issue tracking", () => {
  test("matches a closed bot issue and ignores pull requests", () => {
    const closed = {
      number: 1,
      title: "old title",
      body: issueBody(check, report()),
      html_url: "https://github.com/example/repo/issues/1",
      state: "closed",
    }
    expect(matchIssue(check, [closed])).toBe(closed)
    expect(matchIssue(check, [{ ...closed, pull_request: {} }])).toBeUndefined()
    expect(
      matchIssue({ ...check, id: "other-check" }, [closed]),
    ).toBeUndefined()
  })

  test("fingerprints follow diagnostics, not timestamps or commit", () => {
    const next = { ...check, title: "Renamed check" }
    expect(fingerprint(next)).toBe(fingerprint(check))
    expect(
      fingerprint({
        ...check,
        attempts: [{ ...failed, signature: "new-failure" }, failed],
      }),
    ).not.toBe(fingerprint(check))
  })

  test("tickets contain both attempts and reproducible source identity", () => {
    const body = issueBody(check, report())
    expect(body).toContain("Attempt 1: exit 1")
    expect(body).toContain("Attempt 2: exit 1")
    expect(body).toContain("a".repeat(40))
    expect(body).toContain("Run bun test in isolated test state")
  })
})

describe("QA artifact redaction", () => {
  test("removes credential formats and authorization values", () => {
    const secret = "ghp_1234567890abcdefghijklmnop"
    const clean = redact(`Authorization: Bearer ${secret}\napi_key=private-key`)
    expect(clean).not.toContain(secret)
    expect(clean).not.toContain("private-key")
  })

  test("round trips quoted diagnostics and temporary paths safely", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qa-report-test-"))
    try {
      const data = report()
      data.ai.note =
        'Error in /tmp/example/file.ts: "quoted"\napi_key=private-key'
      await saveReport(dir, data)
      const saved = await loadReport(dir)
      expect(saved.ai.note).toContain('"quoted"')
      expect(saved.ai.note).not.toContain("private-key")
      expect(saved.ai.note).not.toContain("/tmp/example")
      expect(saved.checks).toHaveLength(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// Exercise publishing decisions with an injected GitHub client, never real issues.
describe("QA publication workflow", () => {
  test("caps writes, skips repeated commits, and comments on recurrence", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qa-publish-test-"))
    const issues: Awaited<ReturnType<GitHubClient["listIssues"]>> = []
    const comments = new Map<number, Array<string>>()
    const client: GitHubClient = {
      listIssues: () => Promise.resolve([...issues]),
      listComments: (_repo, number) =>
        Promise.resolve(comments.get(number) ?? []),
      createIssue: (_repo, title, body) => {
        const issue = {
          number: issues.length + 1,
          title,
          body,
          state: "open",
          html_url: `https://github.com/example/repo/issues/${issues.length + 1}`,
        }
        issues.push(issue)
        return Promise.resolve(issue)
      },
      addComment: (_repo, number, body) => {
        comments.set(number, [...(comments.get(number) ?? []), body])
        return Promise.resolve()
      },
    }
    try {
      const first = report()
      first.checks = [check, { ...check, id: "second" }]
      await publish(dir, first, "example/repo", 1, client)
      expect(issues).toHaveLength(1)
      expect(first.publications.at(-1)?.action).toContain("limit")
      await publish(dir, report(), "example/repo", 1, client)
      expect(comments.size).toBe(0)
      Object.assign(issues[0], { state: "closed" })
      const recurrence = report()
      recurrence.commit = "b".repeat(40)
      await publish(dir, recurrence, "example/repo", 1, client)
      expect(issues).toHaveLength(1)
      expect(comments.get(1)).toHaveLength(1)
      expect(recurrence.publications[0].action).toBe(
        "recurrence noted on closed issue",
      )
      const repeated = report()
      repeated.commit = recurrence.commit
      await publish(dir, repeated, "example/repo", 1, client)
      expect(comments.get(1)).toHaveLength(1)
      expect((await loadReport(dir)).publications[0].action).toBe(
        "already recorded",
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("refuses publishing a dirty checkout before contacting GitHub", async () => {
    const data = report()
    data.dirty = true
    const error = await publish("unused", data, "example/repo").then(
      () => null,
      (reason: unknown) => reason,
    )
    expect(error).toBeInstanceOf(Error)
    expect(String(error)).toContain("clean reviewed checkout")
  })
})

describe("QA model responses and usage fixtures", () => {
  test("parses Responses text while ignoring reasoning items", () => {
    expect(
      parseReviewOutput({
        output: [
          { type: "reasoning" },
          {
            type: "message",
            content: [
              { type: "output_text", text: '```json\n{"findings":[]}\n```' },
            ],
          },
        ],
      }),
    ).toEqual({ findings: [] })
    expect(() => parseReviewOutput({ output: [] })).toThrow("no review text")
    expect(() =>
      parseReviewOutput({
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: '{"findings":[{}]}' }],
          },
        ],
      }),
    ).toThrow()
  })

  test("usage fixtures provide populated, empty and paginated wire shapes", () => {
    expect(
      usageFixture(
        new URL("http://localhost/token-usage?period=week"),
        "signed-in",
      ),
    ).toMatchObject({ period: "week", totals: { request_count: 3 } })
    expect(
      usageFixture(new URL("http://localhost/token-usage"), "signed-out"),
    ).toMatchObject({ totals: { request_count: 0 }, byModel: [] })
    expect(
      usageFixture(new URL("http://localhost/token-usage/events"), "signed-in"),
    ).toMatchObject({ items: [], total: 0 })
    expect(
      usageFixture(new URL("http://localhost/other"), "signed-in"),
    ).toBeNull()
  })
})
