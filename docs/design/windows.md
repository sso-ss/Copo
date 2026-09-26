# Settings, Usage, and companion windows

Follow [DESIGN.md](../../DESIGN.md) for the shared warm neutral surfaces,
rounded controls, typography, appearance, and accessibility requirements.

## Usage belongs in Settings

Settings → Usage replaces the standalone Dashboard entry. The native tray and
`open_dashboard` command open the existing Settings window at `#usage`.
Bookmarks to `/ui/dashboard`, `/ui/dashboard/`, and `/ui/dashboard/index.html`
redirect to `/ui/settings/#usage`, preserving a valid `period` query parameter.
Legacy Dashboard assets remain available for compatibility.

Account and Usage are sibling destinations in the Settings sidebar. Account
also has a View usage link. Ordinary Settings sections use `--content-max`;
Usage uses `--content-max-wide` so the available window width serves its data.
The window remains resizable; dimensions are defined by the native window
builder in `shell/src-tauri/src/lib.rs`.

The Usage layout preserves the full Dashboard information:

- Total, input, output, cache-read, and cache-write tokens, request count,
  and reported AIU cost.
- Current Copilot quotas, used/remaining amounts, limits, and unlimited states.
- Every model breakdown column and every paginated event-record column.
- The full usage API response, available in an expandable section.

The date selector reflects the backend's calendar windows: Today, This week
(starting Monday), and This month. Quotas describe the provider's current
allowances and are labeled independently of that selector. Recorded activity
covers CoPo's usage store, not just the currently signed-in account.

Metrics use neutral text and spacing. Quotas are individual cards. Wide tables
scroll inside named, keyboard-focusable regions; the overall pane must not
expand to the width of the table. Keep full identifiers accessible without
truncation. Shared tokens and native controls supply both themes and focus.

Usage summaries and the selected event page refresh every five seconds while
Usage and the document are visible. Provider quotas refresh every minute.
Leaving the section aborts in-flight requests. A changed period or page cannot
receive a late response from the previous selection; a failed refresh retains
successful data and shows a retry action. Missing data is never rendered as zero.

## Shared runtime and appearance

Settings and Usage are bundled together from `shell/ui/settings/index.html` and
served by the sidecar at `/ui/settings/`, using the same localization runtime
and generated CSS tokens. The native appearance preference updates both.
The old Dashboard bundle remains independently generated for compatibility;
its token values continue to come from the shared theme generator.

The Companion and Connections windows are local Bun-bundled Tauri assets.
They load before the sidecar and import the generated shared CSS tokens.
Companion is a transparent desktop button; Connections is a compact vertical
list with secondary account controls. Both reuse existing Settings actions.
One native event subscription continues when either window is hidden.

Settings → Personalization owns the buddy size and appearance controls.
The native preference store broadcasts changes across the windows, including
across their different origins. Appearance follows the system by default,
with explicit Light and Dark choices. Preferences persist across launch.
