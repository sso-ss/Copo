# Companion implementation

Implementation tracking for the [Companion PRD](../companion-integration-prd.md).
The branch now includes an internal desktop preview: local companion and
connections windows, bundled artwork, and ordered request activity. This is
not release acceptance or whole-task monitoring; the remaining gates are below.

## Source capability audit — September 25, 2026

This is a local source audit, not verification of external client lifecycle
APIs. No current integration emits authoritative whole-task events.

| Integration | Current setup and verification | Activity attribution | Whole-task monitoring |
|---|---|---|---|
| Claude Code | Writes the owned base URL and key helper; success means configuration was applied, without an inference verification step | Named helper key; see `src/apps/claude-code/config.ts` | Not implemented; client hook semantics need validation |
| Claude Desktop | Applies a configuration-library profile; no inference verification in `enable()` | Named `claude-desktop` key | Not implemented; supported client API needs investigation |
| Codex CLI and Desktop | Combined registry entry; verifies a Responses request before writing changed routing; an unchanged enable skips verification | Shared `codex` key; cannot distinguish CLI from Desktop traffic | Not implemented; lifecycle capability remains unverified |
| Copilot CLI | Coming-soon placeholder; cannot enable | No supported integration key | Unavailable |
| Custom API client | Named API keys; creating a key does not verify routing | Key ID only; tools sharing a key cannot be distinguished | Request activity only |

Source: `src/apps/registry.ts`, `src/apps/index.ts`, each integration's
`index.ts`, `src/apps/coming-soon.ts`, and
[Codex routing documentation](codex-integration.md).
The legacy `codex-desktop` endpoint is an alias, not an independent connection.
Existing `status: ready` app metadata describes installation, not a verified
connection. The companion must not reinterpret it as “Connected.”

## Implemented: ordered request events and reconciliation

`GET /settings/api/clients/activity` retains its existing `activity` array
and adds `generation`, `eventId`, `activeRequests`, and `recentEvents`.
The authenticated `/settings/api/events` channel now sends:

- `activity.snapshot` on every connection and authentication-session reset.
- `activity.request` for each request start and terminal outcome.
- Existing `auth.changed` and keepalive events.

Request events contain a unique request ID, key ID, generation, monotonic event
ID within that generation, timestamp, status code, and a copy of the per-key
summary. An idle-summary eviction is identified by `removedApiKeyId` so an
incremental consumer can remove it. No prompts, responses, or credentials are
added to activity metadata. API-key ID is attribution, not a connection ID.

The snapshot keeps all active requests and the latest 256 terminal events.
Concurrent success cannot erase the separate record of an earlier failure.
The original summary's latest-outcome behavior remains compatible with Settings.
History is in memory only; no detailed request logging is added.

The generation changes on gateway restart, authentication-session change, or
sign-out. Finishing an old request cannot decrement new counters or publish
into the new session. A cancelled sign-in retains its previous session.
Subscriptions are installed before the first awaited write so fast requests
cannot be lost between snapshot capture and listener registration. Writes are
serialized; a subscriber with 256 pending frames is disconnected to bound
memory and must reconcile on reconnect.

## Implemented: request-only display controller

1. Accept an initial snapshot as the baseline. Display its retained outcomes,
   but do not generate reactions from historical entries.
2. Within the accepted generation, apply live events in increasing order.
   Initial/recovery snapshots establish the stream baseline. Ordinary status
   polls may advance displayed activity, but keep a separate live watermark
   and verification baseline so a poll cannot swallow an in-flight connection
   celebration. Late events never overwrite newer activity or replay outcomes
   superseded by that activity.
3. On a gap or unknown generation, mark activity unavailable and obtain a fresh
   snapshot. Do not turn missing evidence into completed work.
4. On stream loss or heartbeat expiry, clear visible working claims until
   reconciliation. The transport does not infer client liveness from silence.
5. A request `finished` event only ends that inference request. Only a separately
   validated tool lifecycle adapter can report whole-task completion.

The stream deliberately reconciles with a fresh snapshot on reconnect; it does
not replay from `Last-Event-ID`. Outcome history is bounded and is not an audit
log. The native subscriber remains active when Settings and companion windows are
hidden. Both local windows use the same TypeScript display rules. Each webview
currently owns its reaction timer; a newly opened panel reconciles a snapshot
without replaying earlier reactions.

## Implemented: desktop shell and connections panel

- Tauri launches a local transparent companion before the sidecar responds.
  The connections panel also uses bundled assets and offers startup recovery.
  Reopening the application restores the companion panel; Settings stays a
  secondary surface. Tray Show/Hide never stops the gateway.
- The Canvas renderer ports the sibling Swift reference's prepared cat layers,
  pose coordinates, tail/arm/face motion, hover hearts, and static Reduce Motion
  states. All artwork is bundled under `shell/ui/companion/artwork`; packaging
  does not depend on the sibling checkout.
- Pet placement is restored and clamped to a current display. Click and drag are
  separate gestures. The onboarding hint appears only without ready tools or
  active requests and dismisses on interaction.
- A single authenticated native SSE subscriber broadcasts ordered request
  events to both windows and reconnects with snapshots. Companion IPC returns
  display metadata only; it does not grant access to the shell API key.
- `/settings/api/companion` reports the active account and live registry-backed
  connections. Planned integrations are excluded; Codex CLI/Desktop and shared
  keys are labelled as shared. Configuration alone never implies verification.
- Each connection has an on/off switch backed by the existing integration
  routing or named-key enablement endpoint. Disabled supported integrations
  remain listed. Native code consumes mutation responses without forwarding
  key values; failures preserve saved state and show the localized action error.
- The compact panel includes connection details, recent request outcomes,
  and an account avatar/fallback. Its profile menu follows the supplied
  reference: account name and Gateway, Settings with its keyboard shortcut,
  Language, View changelog, Learn more, and Sign out. Model configuration is
  available through Settings; the duplicate Inference configuration shortcut
  was removed at the user's request.
  Language and Learn more open compact menu pages within the window; arrow
  keys, Home/End, type-to-focus, Escape, outside click, and focus restoration
  are supported. Learn more includes Documentation, Diagnostics, and Logs.
  Sign out uses the existing auth endpoint and sidecar restart lifecycle,
  with confirmation and a fresh native check for observed active requests.
  Native locale changes update open windows, and new gateway-origin windows
  are seeded from the native preference before their picker initializes.
- CoPo branding uses the supplied cheese artwork on the dark card surface
  for the app icon, tray, splash, and panel logo. Legacy storage, CLI, bundle
  identifiers, and real upstream URLs remain compatible.
- Retry probes the gateway before restarting an unavailable sidecar. A reachable
  gateway is left running while the native stream reconnects automatically.

### Local preview

Build with `bun run build:ui`, then run `bun scripts/companion-preview.ts`.
Open `http://127.0.0.1:4748/?panel` for the panel or
`http://127.0.0.1:4748/?scenario=working` for the pet. The harness provides
welcome, configured, ready, working, unavailable, and theme controls. It uses
mock display metadata and a mock native bridge; it does not read credentials,
configure tools, or contact the production gateway.

Earlier browser checks cover panel/menu rendering, Korean locale switching, recovery
and Retry wiring, cat rendering, hover, static Reduce Motion frames, and click
to open the panel. These do not validate native dragging, display attachment,
macOS window composition, or packaged startup. The latest profile-menu redesign
could not receive a browser pass because automatic approval review failed
before browser access could execute.

### Validation — September 25, 2026, before the branding/menu update

- `bun run check:deep`: 1,563 passed, 1 skipped, 0 failed; lint, root types,
  and knip passed (existing warnings/configuration hints remain).
- `bun run build:ui` and the separate shell TypeScript check passed.
- `cargo check --offline --manifest-path shell/src-tauri/Cargo.toml` passed.
- The isolated browser checks above passed after the final UI fixes.
- `git diff --check` passed. No packaged native app acceptance run was performed.

### Branding and profile-menu validation — September 25, 2026

- `check:fast`, the separate shell TypeScript check, and knip passed.
- 76 focused companion, authentication, and locale tests passed.
- Both native companion tests passed, including the sign-out activity guard.
- The full suite reached 1,547 passed and 1 skipped, with 11 failures in tests
  requiring local servers under the sandbox. The attempt to rerun with local
  networking was blocked before execution by automatic approval review:
  “This model does not support the responses endpoint.” This is an incomplete
  full-suite validation, not a passing result.
- Browser access was blocked by the same approval-service configuration error.
  The menu still needs its final visual and interactive browser acceptance pass.
- The CoPo release app built successfully and was copied to `~/Desktop/CoPo.app`.
  Its ad-hoc signature passed strict verification and its Info.plist passed
  validation. Packaged startup has not been acceptance-tested.

## Remaining release gates

### Follow-up: synchronization, personalization, and gateway status

- App and API-key mutations now emit a payload-free `connections.changed`
  event. Both companion windows refresh through their native subscription;
  Settings refreshes its app/key lists over SSE, on focus, and with periodic
  reconciliation for external file edits. Older GET responses cannot overwrite
  newer routing state in Settings.
- Settings → Personalization provides System/Light/Dark appearance and the
  requested Small/Just right/Big buddy segmented control. A native, atomically
  written preference file is shared by all windows. Resizing preserves the
  pet's proportions and anchors its feet; placement is clamped afterward.
- Personalization includes a rounded cat preview above the controls, with
  localized introductory text and image alternative text. It follows saved
  buddy sizes and appearance changes using the same size ratios as the desktop
  pet. The idle artwork is bundled with Settings for offline access. UI build,
  shell TypeScript, `check:fast`, and 49 locale checks passed. Browser acceptance
  remains unverified: the sandbox disallowed the local mock server and automatic
  approval review failed because its model does not support the Responses API.
- The shared UI now follows the original Companion's warm neutral surfaces,
  ink text, rounded headings, and softer control/card/panel corners. Settings,
  Dashboard, and companion windows share the palette. Dashboard generation now
  includes both light and dark selectors. Text and links clear AA across all
  surfaces (including the preview), as do normal, hover, and destructive button
  labels. Browser review remains blocked by the same approval-service error;
  this updates source and web bundles, not the installed desktop executable.
- The companion now distinguishes reachable/authorized, signed-out, and known
  upstream-error states. Native gateway startup/failure transitions update it
  immediately. “Gateway ready” names idle gateway health, not agent completion.
- Accepted inference requests without a matching named key now contribute to
  aggregate activity as `gateway:unattributed`. No tool identity is guessed.
  Discovery, settings requests, and rejected client authentication remain
  outside inference activity. Local tool execution is still not observable.
- Read-only inspection found the user's live listener on port 4141 was
  `/Users/sso/Desktop/ModelRelay.app/Contents/MacOS/maximal`, the older bundle.
  The CoPo icon and updated UI take effect when the rebuilt CoPo app is launched.
- Follow-up verification: focused activity/auth/routing/locale suites, root
  `check:fast`, shell TypeScript, knip, and all 14 native tests passed. The
  prepared mock browser check (`/tmp/copo-ui-verify.cjs`) was blocked before
  execution by the same automatic approval-service configuration error.
- The updated Desktop CoPo bundle built and passed strict ad-hoc signature
  verification. A prepared relaunch that first checks for no active requests
  (`/tmp/copo-relaunch.cjs`) was also blocked before execution. The older
  ModelRelay instance therefore remains running until the user relaunches.

### Claude Code connection refusal follow-up

- The current listener on 4141 is now `Desktop/CoPo.app`. Claude Code's
  settings still target the development gateway on 4142, and its fingerprinted
  helper matches a development key rather than an enabled key in the app's
  store. Merely changing the port would leave authentication broken.
- Refused Claude Code enables return HTTP 409 with fixed error codes for a
  conflicting address/helper, missing key, or missing installation. Settings
  reports failure and refreshes; subsequent app-list requests retain conflict
  metadata. Existing foreign settings, including other local gateways, remain
  untouched.
- Native companion IPC permits only known error codes; neither key mutation
  bodies nor arbitrary gateway errors cross into the panel. Older sidecars'
  HTTP-200 conflict responses are handled too. The panel and Settings share
  localized recovery messages in all ten full catalogs.
- A guarded local repair was prepared to verify both gateways are idle, back up
  the affected settings/configs, disable development routing through its API,
  enable CoPo routing, and validate the resulting key with model discovery.
  Its execution was blocked before mutation by automatic approval review:
  `This model does not support the responses endpoint`. Live routing therefore
  still needs the repair; code tests do not establish a working Claude session.
- Verification: 152 focused tests, 16 native tests, root `check:fast`, shell
  TypeScript, and knip passed. The release build is staged separately from the
  running Desktop app; live UI and connection checks remain blocked.

### Menu and Settings style consistency

- Settings navigation and the companion profile/language menus now share
  `shell/src/ui/styles/controls.css`: label typography, row spacing, rounded
  corners, neutral hover/selection, and inset keyboard focus. Both connection
  switches use the same control rules, including disabled states. Companion
  font loading now declares the same variable weight range as Settings.
- `DESIGN.md` and the component guide require these shared controls; the
  design-token check now scans the companion and shared control styles too.
- UI build, shell TypeScript, root `check:fast`, and whitespace checks passed.
  The sidecar and native app were rebuilt together. Native compilation passed
  with a local missing-LLVM debug-stripping warning. The ad-hoc signed bundle
  passed strict signature verification and replaced `Desktop/CoPo.app`; both
  executable hashes match the build. The previous app was preserved at
  `~/Library/Application Support/CoPo/Build Backups/20260925-233200/CoPo.app`.
- The running app was not restarted; quit and reopen CoPo to load the updated
  interfaces. Rendered light/dark and keyboard verification remains pending
  after this session's earlier automatic approval-service configuration error.

### Longer happy pose and CoPo Dashboard

- The existing verification celebration now holds for five seconds, up from
  two. Refreshes, duplicate events, and historical snapshots do not restart
  it. New work and gateway loss still take priority. This does not add a
  whole-task completion adapter.
- Dashboard summaries now use neutral label/value groups, rounded quota and
  table surfaces, readable compact text, shared focus-ring tokens, and the CoPo
  cheese favicon. Removed the rainbow metric colors, legacy color aliases,
  undersized labels, and broad card-radius overrides. Tables have labelled
  keyboard-scroll regions; theme preference and reduced motion remain shared.
- All 12 focused state/build tests passed, alongside shell TypeScript,
  `check:fast`, whitespace checks, complete Dashboard asset/token references,
  and stable token generation. Dashboard text contrast is at least 4.71:1 in
  light mode and 5.25:1 in dark mode across base/card/control surfaces.
- Rebuilt the UI, embedded sidecar, and native app together. The local build
  retains the known missing-LLVM debug-stripping warning; compilation and
  strict ad-hoc signature verification passed. Updated `~/Desktop/CoPo.app`
  with both verified executables and preserved the previous bundle under
  `~/Library/Application Support/CoPo/Build Backups/20260925-233753/CoPo.app`.
  Quit and reopen the app to load the changes; no running process was stopped.
- Live visual review was attempted again, but automatic approval review failed
  before browser access: `This model does not support the responses endpoint`.
  Rendered light/dark, minimum-size, keyboard, and animation review is pending.

### Happy verification reliability

The happy/verification hold is now ten seconds. Status polling no longer
consumes a live verification event before the stream delivers it. Initial and
recovery snapshots still restore readiness without celebrating history, and
new work cancels happiness even when observed by polling first. This remains
a connection-verification reaction; it does not add whole-task detection.

Validation: all 32 focused state/route/event tests, shell TypeScript,
`check:fast`, and the bundled desktop build passed. The signed app replaced
`~/Desktop/CoPo.app`, with the previous bundle backed up under
`~/.local/share/copo-update-20260925/backups/CoPo-before-happy-1790405855213025000.app`.
The running app was not restarted; native visual verification is pending.

### Outstanding PRD acceptance

The companion now separates configured-but-unverified routes from an empty
configuration: the former says **Waiting for requests**, while only an empty
configuration says **No tools configured**. Configured routes suppress the
first-run connection hint. A retained `finished` activity aggregate can restore
verification when the shorter recent-event history has already evicted its
event; restoration does not replay a success reaction. Gateway restart still
requires fresh verification, and configured routes alone never trigger a
connection-success celebration.

- Persist verification separately from API-key traffic and routing configuration.
  Today a successful request proves that key worked in the current generation;
  it can trigger one connection-verification reaction, never task completion.
  After restart, only retained runtime evidence establishes readiness. A shared
  key cannot prove which of its configured tools sent the request.
- Validate and implement at least one authoritative whole-task adapter, including
  request gaps, local child work, waiting, cancellation, failure, duplicate
  rejection, and account generation. No current integration has this adapter;
  every row therefore says **Request activity only**.
- Share transient reaction state centrally if the panel must mirror a reaction
  that began before the panel was opened.
- Enforce account-switch protection in the existing account mutation path. The
  companion currently prevents opening account management during observed
  requests, but existing Settings can still switch and request gaps are unknown.
- Complete local diagnostics for sidecar-down recovery. Logs and Retry are local;
  the full Diagnostics page still needs the gateway to serve it.
- Exercise all PRD acceptance scenarios in the packaged macOS app, especially
  native focus/drag/placement, display changes, sleep/wake, real multi-request
  tasks, cancellation, account switching, and idle resource use.
- Obtain i18n wording review before landing per `CONTRIBUTORS.md`.

Task-completion marketing remains gated on a demonstrated end-to-end named
integration. Request-level preview behavior does not satisfy AC-06, AC-07, or
the task-aware portion of AC-09. AC-13 and the packaged acceptance pass also
remain open.
