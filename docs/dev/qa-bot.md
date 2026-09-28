# CoPo QA bot

The QA runner checks backend tests, lint, types, proxy/UI builds, design tokens,
and browser flows. It can send a bounded source sample and fixture screenshots
to a model through **local CoPo**, then create GitHub issues for reproduced
check failures. AI suggestions remain in the report until independently verified.

## Local review

Use the Bun version in `.bun-version`, install project dependencies with
`bun install`, and install the QA browser once:

```sh
bunx playwright install chromium
```

Start CoPo normally. Choose a model exposed by its `/v1/models` endpoint that
supports image inputs, then run:

```sh
QA_MODEL=<your-model-id> bun run qa
```

The default API base is `http://127.0.0.1:4141/v1/`. Override it with
`QA_API_BASE_URL` for another local CoPo port. If CoPo requires an API key,
provide it through `QA_API_KEY`; never put a key in source control. The runner
accepts loopback hosts only. CoPo forwards the supplied source and screenshots
to the chosen upstream model using its existing connection. It does not scan
credentials or real user conversation logs.

The review sends up to 14 source files / 65,000 source characters, project
architecture and design rules, check summaries, and up to six screenshots.
Recent committed changes and core routing/streaming/auth files receive priority.
The report lists the reviewed files; this is a bounded review, not an exhaustive
audit. Use `QA_REVIEW_IMAGES=0` for a text-only model. One model request is made
per run, with a four-minute timeout and no automatic inference retries.

Outputs are saved beneath `reports/qa/<timestamp>/`:

- `report.md`: human-readable checks, suggestions, and GitHub links.
- `report.json`: validated machine-readable report.
- `logs/`: redacted command diagnostics and browser traces.
- `screenshots/`: fixture-only screenshots in light and dark themes.

For checks without AI: `bun run qa --no-ai`. For backend/code checks without a
browser: add `--no-ui`. Neither option is presented as full coverage.

## GitHub issues

Authenticate the GitHub CLI with access to the target repository. Run against a
clean committed checkout so each ticket identifies the exact reviewed source:

```sh
QA_MODEL=<your-model-id> bun run qa --publish --repo sso-ss/Copo
```

Or inspect a report first, then publish its confirmed failures:

```sh
bun run qa --publish-only --repo sso-ss/Copo --out reports/qa/<run>
```

Publishing is explicitly enabled by `--publish` or `--publish-only`. The default
is a report. At most three issue/comment writes happen per run; `--limit 1` to
`--limit 10` changes this limit. Each issue includes the failing check, commit,
runtime, reproduction instructions, expected/actual result, and diagnostics.
Local screenshots stay local; GitHub Actions issues link to the run artifact.

The runner retries failed checks once in fresh test state. Only two matching,
nonempty error signatures qualify for an issue. Timeouts, flaky results,
missing mock endpoints, and browser locator failures stay in the report.
A failing test may itself be wrong: repeated failure establishes the check
result, not root cause. Severity is left for triage.

A stable marker matches the check and diagnostic across runs. The publisher
searches all bot issues (including closed issues), adds new evidence to matching
issues, and skips evidence already recorded for that commit. Recurrences on
closed issues receive a comment; the bot does not reopen them. Existing human
issues without a bot marker are not semantically deduplicated in this version.
AI findings cannot qualify for issue creation through model output.

If inference fails after the checks, resume with the same clean checkout:

```sh
QA_MODEL=<your-model-id> bun run qa --review-only --out reports/qa/<run>
```

Exit codes: `0` completed with no failing checks; `1` reproduced check failures;
`2` incomplete, flaky, infrastructure, AI, or publishing error. Successfully
publishing findings does not turn a failing review green.

## GitHub Actions

The manually triggered **CoPo QA** workflow runs deterministic checks and browser
QA on the default branch. Its **publish** checkbox defaults off. The collecting
job has read-only GitHub permissions; a separate job receives issue-write
permission only when publishing is requested. No pull request trigger or nightly
schedule is enabled in this first version.

GitHub-hosted runners cannot reach CoPo on your Mac, so CI explicitly skips AI.
Use the local command for the combined review. No hosted AI credential is needed.
Artifacts are retained for 14 days; issue bodies preserve diagnostic excerpts.
After merging this workflow, run it from GitHub's Actions page.

## Coverage and limits

Backend coverage comes from the project's real test suite, including routing,
protocol translation, streaming, authentication, and configuration tests. The
browser uses `scripts/ui-harness.ts` with in-memory fixtures on an OS-assigned
loopback port; it never mutates the real CoPo server. It navigates Account, Apps,
Models, Usage, and Personalization, checks authentication/error states, starts
the fixture device-code flow, and opens Dashboard in light/dark at 900×700.
Screenshots, traces, overflow assertions, and uncaught browser exceptions provide
evidence. Missing harness routes are infrastructure gaps, not product issues.

This version does not verify native tray/window behavior, installers, or live
upstream inference correctness. The local CoPo call exercises inference for the
review itself, but is not a backend contract canary. Browser screenshot review
is AI-assisted, not pixel-baseline regression testing or a complete accessibility
audit. Logs are redacted for common credentials; all browser data is synthetic.

The tooling has its own type check (`bun run qa:typecheck`) and targeted tests
in `tests/qa-bot.test.ts` for reproduction, redaction, and issue deduplication.
