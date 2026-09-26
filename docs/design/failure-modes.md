# Failure modes — check these first

Follow [DESIGN.md](../../DESIGN.md) as the authoritative standard. The older
drift table below is historical evidence, not a current palette specification.

If your output exhibits any of these patterns, **stop and re-read the
linked doc before continuing**. These are the things that keep
regressing across design iterations.

## Visual / structural

- **Page reads as a grid of similar rectangles ("AI dashboard").**
  Cards are being used as sectioning chrome. → [`aesthetic.md`](aesthetic.md)
  *When to use a card*. Squint test: if blurring reveals an even grid of
  rectangles, drop the cards.
- **Cards nested inside cards.** Forbidden. Collapse one level into a
  list-row or a typographic section.
- **Window has a visible H1 that duplicates the macOS titlebar text.**
  The H1 inside the content area is the *section* name, never the
  *window* name.
- **Serif headings or oversized display text in utility screens.** Use the
  shared rounded heading tokens and calm hierarchy. → [`type.md`](type.md).
- **Old teal controls or crimson identity returning.** Use the neutral,
  theme-aware `--accent`; preserve the cheese and cat artwork. → [`color.md`](color.md).

## Tokens & drift

- **Inline raw `px`, `rem`, or `#hex` in a component file *or in a
  design doc.*** Reference a token. If no suitable token exists, add
  one to `shell/src/ui/styles/theme.ts` and document it in
  [`tokens.md`](tokens.md) before using it. The one allowed exception
  is the drift table below, where the conflict is the point.
- **Editing generated tokens without their source.** Regenerate the shared
  tokens and Dashboard stylesheet from the theme source. See
  [`change-checklists.md`](change-checklists.md) → *Changing a token
  value* for the full touchpoint list. This is the highest-risk class
  of design bug in the repo today.
- **Adding a token to one CSS file and assuming the other has it.**
  `tokens.css` and the dashboard `style.css` are independent declarations,
  not imports. Anything missing from one is silently `inherit`-ed or
  `initial` in that window.

## Historical drift audit — June 2026

These old values document an earlier failure. The shared generator now emits
the current neutral palette and both theme selectors for all three surfaces.

| Concern | `shell/src/tokens.css` | `shell/ui/dashboard/style.css` |
|---|---|---|
| `--accent` | `#5198a6` | `#14b8a6` ← **different teal** |
| `--text-muted` (dark) | `#8a8a8a` | `#a1a1a1` |
| `--border-subtle` (dark) | `#2a2a2a` | `rgb(255 255 255 / 0.08)` |
| `--border-strong` (dark) | `#666666` | `rgb(255 255 255 / 0.18)` |
| `--accent-destructive` | present | absent |
| `--accent-hover` | absent | present |
| `--status-*` (error/success/warning/info) | absent | present |
| `--color-bg-*` legacy aliases | absent | present |
| `--font-display` (Fraunces) | present | absent |
| Light theme block | present | absent |

The historical Dashboard used a different teal from Settings; do not restore it.

## Accessibility

- **`:focus` instead of `:focus-visible`.** Focus rings should appear
  on keyboard navigation, not on mouse click. → [`components.md`](components.md) →
  *Focus rings*.
- **Motion that ignores `prefers-reduced-motion: reduce`.** Reduced
  motion is a contract, not a hint. → [`motion.md`](motion.md).
- **Blocking the user on a contrast warning.** Warn, never block. The
  user is in charge of their color. → [`color.md`](color.md).
- **Body text below `--text-base` (16px) for multi-line prose.** Never
  smaller. Settings descriptions can use `--text-sm`; body prose cannot.

## Keyboard / behavior

- **Re-binding `Cmd-K`.** It's reserved for the future command palette.
  Don't wire it to something else.
- **Implementing a binding that's already wired.** The keyboard table
  marks shipped vs. planned. → [`keyboard.md`](keyboard.md). Check
  before adding listeners.
- **Tooltips that scream the keybind** in all-caps or with heavy
  styling. Quiet parens: `Settings (⌘,)`.

## Process

- **Editing `.design-context.md` instead of `docs/design/*.md`.** The
  front-door file is intentionally slim and is a pointer doc. Long
  content goes in the topic files.
- **Adding a new token without a justification.** A token is a
  permanent commitment to a concept. Add the row in [`tokens.md`](tokens.md)
  *first*, then declare in `tokens.css`.
