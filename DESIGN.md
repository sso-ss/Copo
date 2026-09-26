# CoPo design style

**Status: official, user-approved project standard.**

Follow this guide for every CoPo interface change: Settings, Dashboard, the
desktop companion, menus, dialogs, empty states, and new product surfaces.
The reference is the Companion-inspired design adopted in this project:
warm neutrals, ink-colored text, soft rounded corners, and calm spacing.

This is the authoritative design guide. It supersedes conflicting historical
guidance about teal controls, crimson branding, serif headings, or sharp
corners. A later explicit user instruction can change the direction; otherwise,
extend this style rather than introducing a new visual language per feature.
This standard belongs to CoPo, not to unrelated projects.

## Character

CoPo should feel like a quiet, friendly desktop companion. Use warm paper-like
surfaces in light mode and soft charcoal surfaces in dark mode. Keep controls
neutral, text readable, borders subtle, and artwork crisp. Let layout and
typography establish hierarchy; use decoration sparingly.

## Source of truth

- [theme.ts](shell/src/ui/styles/theme.ts) owns exact colors, font stacks,
  radii, spacing, typography, and elevation values.
- [generate-css-tokens.ts](scripts/generate-css-tokens.ts) generates the shared
  [Settings/Companion tokens](shell/src/ui/styles/tokens.css) and synchronizes
  the independent [Dashboard stylesheet](shell/ui/dashboard/style.css).
- [Token vocabulary](docs/design/tokens.md) describes each token's purpose.
- [Shared controls](shell/src/ui/styles/controls.css) owns the matching menu
  rows and switches used by Settings and the companion. Keep their typography,
  spacing, corners, selection, hover, focus, and disabled states consistent.
- [Design context](.design-context.md) links to topic-specific guidance.

Reference tokens in components and design documents. Do not duplicate literal
colors or dimensions. Add a genuinely missing token in the theme source,
document its role, regenerate both stylesheets, and review every affected
surface. Do not hand-edit generated values as the permanent fix.

## Color and surfaces

| Role | Tokens | Direction |
|---|---|---|
| Window background | `--surface-base` | Warm off-white / soft charcoal |
| Cards and menus | `--surface-card` | Quiet separation from the window |
| Controls and selection tracks | `--surface-control` | Gentle neutral fill |
| Buddy preview | `--surface-companion-preview` | Muted neutral backdrop |
| Headings and important text | `--text-strong` | Deep ink / warm light text |
| Body and supporting text | `--text-base-color`, `--text-muted` | Clear, readable hierarchy |
| Primary controls | `--accent`, `--accent-hover`, `--accent-fg` | Neutral, theme-aware contrast |
| Links | `--link`, `--link-hover` | Understated ink tones |
| Boundaries | `--border-subtle`, `--border-strong` | Quiet dividers; stronger control edges where needed |
| Destructive actions | `--accent-destructive`, `--accent-destructive-foreground` | Clear caution with readable labels |
| Status | `--status-*` and their foreground tokens | Reserved for meaningful state |

Keep System, Light, and Dark appearance consistent across windows. Theme
changes must update backgrounds, labels, controls, links, and status text
together. Avoid bright decorative accents, saturated page fills, and heavy
gradients. Preserve the supplied cat and cheese artwork's original colors;
artwork colors are not the UI control palette. Legacy `--brand` tokens are
not a reason to reintroduce the old crimson identity.

## Shape and spacing

| Element | Corner token |
|---|---|
| Buttons, inputs, navigation items | `--radius-input` |
| Cards, menus, dialogs, code blocks | `--radius-card` |
| Companion panel and buddy preview | `--radius-panel` |
| Small chips and segmented options | `--radius-chip` |
| Switches, avatars, dots, progress tracks | `--radius-pill` |

Use the spacing scale for padding and gaps. Leave comfortable space between
sections, align labels and controls, and keep related controls together.
Use typography and whitespace for page sections. Cards represent distinct
entities; never nest cards. The buddy preview is an intentional artwork stage,
not a pattern to repeat around every section. Use restrained elevation and
subtle borders instead of heavy outlines or large shadows.

## Typography and words

- Use `--font-display` for rounded section headings and companion headings;
  keep the existing system-rounded face and Pretendard fallback.
- Use `--font-body` for body text, controls, and labels. Bundle fonts locally.
- Use `--font-mono` for code, identifiers, and measurements that benefit from it.
- Default section headings to `--text-xl`, `--weight-xl`, `--leading-xl`,
  and `--tracking-xl`. Avoid oversized headings in utility windows.
- Use `--text-base` for prose and `--text-sm` for compact labels and helpers.
  Reserve `--text-xs` for glyph-only contexts such as keycaps.
- Write in sentence case, using short, helpful, human language. Keep technical
  details in the places where users need them to make a decision.
- Put user-facing strings in the existing localization catalogs, including
  accessible names and image alternatives.

Keep the personalization introduction: “Make yourself at home.” and
“A little companion, on your terms.” Do not duplicate a native window title
as a large in-content heading.

## Controls and companion preview

Primary actions use neutral accent fills with contrasting labels. Secondary
actions use quiet control surfaces. Selected segmented options use the card
surface, strong text, and restrained elevation; hover and focus remain clear.
Retain native control semantics and established keyboard behavior.

Settings → Apps uses Configure and Disconnect buttons. Configure checks for
the app before applying CoPo settings. Show installation help in a dialog only
when detection cannot find the app: a copyable terminal command for Claude Code
or an official download link for Claude Desktop, followed by Check again.
Configuration conflicts and other failures keep their own actionable messages.
Show Configured only after configuration succeeds; this is not a claim that a
live model request has been verified. Keep Disconnect available for saved
configuration even if the app is subsequently uninstalled.

Dashboard summaries use neutral text with clear labels, rather than a different
color and card for every metric. Use rounded surfaces for quota entities and
detailed tables, readable compact text, and the shared focus ring. Wide tables
scroll within their panels. Reserve status color for actual warnings or errors.

The companion's happy reaction holds for ten seconds so it can be noticed.
New work and gateway problems take priority; polling must not restart the
timer. Preserve truthful triggers: a verified connection is not evidence that
an entire task finished. Reduced Motion shows the same pose without animation.

Personalization keeps the cat preview above its controls. Use the bundled idle
artwork, preserve its proportions and pixel edges, and reflect the saved buddy
size and appearance. Keep the full cat visible at each size with a stable
preview area. A failed save must leave the preview consistent with the saved
preferences. Do not replace the cat with an emoji or recolor the artwork.

“Try motions” expands a local playground below the preview. Reuse the live
companion renderer for poses and small gestures, with individual selection,
Play all, and Pause controls. Keep playback separate from real tool activity.
Stop it when the section closes; Reduce Motion allows static pose selection.

## Accessibility and finishing checks

Preserve visible keyboard focus with `:focus-visible`, accessible labels,
and meaningful status text. Do not communicate state through color alone.
Text and button labels must meet WCAG AA; check base, card, control, and preview
surfaces in both themes. Maintain adequate contrast for control boundaries and
focus indicators. Honor reduced motion literally, disabling decorative motion.

Before calling a UI change complete:

1. Check that it follows this guide and uses existing tokens and components.
2. Regenerate stylesheets if theme values changed; ensure generation is stable.
3. Run the relevant build, type, and design-token checks from
   [the command guide](docs/commands.md).
4. Review the changed screen in light and dark mode, at the minimum supported
   window size, and with keyboard focus. Check relevant disabled, error,
   loading, localized, and reduced-motion states.
5. Report any verification that could not run. Distinguish source/web-bundle
   changes from an installed desktop app update; do not claim visual review
   or deployment based only on a successful build.
