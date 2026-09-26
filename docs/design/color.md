# CoPo color

Follow [DESIGN.md](../../DESIGN.md). The official style uses warm paper surfaces
in light mode, soft charcoal in dark mode, ink text, and neutral controls.
The earlier teal and crimson direction is superseded.

## Source and synchronization

[theme.ts](../../shell/src/ui/styles/theme.ts) owns exact values.
[generate-css-tokens.ts](../../scripts/generate-css-tokens.ts) emits both theme
selectors into the shared Settings/Companion tokens and the independent Dashboard
stylesheet. Regenerate both when values change; do not maintain separate palettes.

## Roles

| Role | Tokens | Use |
|---|---|---|
| Surfaces | `--surface-base`, `--surface-card`, `--surface-control` | Warm neutral layers with quiet separation |
| Preview | `--surface-companion-preview` | Neutral stage for the cat |
| Text | `--text-strong`, `--text-base-color`, `--text-muted` | Readable hierarchy |
| Controls | `--accent`, `--accent-hover`, `--accent-fg` | Neutral primary actions and active controls |
| Links | `--link`, `--link-hover` | Understated ink tones |
| Boundaries | `--border-subtle`, `--border-strong` | Dividers and necessary control edges |
| Destructive actions | `--accent-destructive`, `--accent-destructive-foreground` | Caution and contrasting labels |
| Status | `--status-*` and foreground pairs | Meaningful error, warning, success, and information states |

Preserve the cat and cheese artwork's colors. Do not apply artwork colors to
buttons or derive an app-wide accent from the cheese. Existing legacy `--brand`
values must not reintroduce the old crimson identity.

## Contrast and themes

- Support System, Light, and Dark. The root `data-theme` selects the full palette.
- Change surface, text, accent/foreground, link, and status pairs together.
  Shape and spacing stay consistent between themes.
- Text and button labels must meet WCAG AA. Check base, card, control, and preview
  surfaces, including hover and destructive controls.
- Use adequate contrast for focus rings and control boundaries. Do not communicate
  status through color alone.
- If user-selected custom colors are supported, explain insufficient contrast
  without silently replacing the user's choice.
- Avoid bright decorative fills, heavy gradients, and low-contrast helper text.

## Artwork

The supplied pixel-art cheese is CoPo's identity asset; the cat is its companion.
Keep their proportions and crisp edges. The source cheese is
[the existing SVG](../../shell/assets/copo-cheese.svg); theme changes do not call
for new artwork or recoloring it.
