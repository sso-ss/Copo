# CoPo design principles

[DESIGN.md](../../DESIGN.md) is authoritative. These principles support the
user-approved Companion-inspired style and replace the earlier visual decisions.

## Principles

1. **Speak to the person.** Labels describe what an action does. Use short,
   useful language and keep implementation details in appropriate advanced views.
2. **Make the surface calm.** Use warm neutrals, readable ink text, rounded
   corners, quiet borders, and comfortable spacing. Let the artwork add character.
3. **Keep capability easy to find.** Common controls are clear and close to
   their context. Advanced options can sit one level deeper. Avoid dense pages
   made from identical cards.
4. **Keep every window related.** Settings, Dashboard, menus, dialogs, and the
   companion use the same theme tokens, rounded headings, and control language.
5. **Preserve accessibility.** Maintain contrast, keyboard focus, labels,
   localization, and literal reduced-motion behavior. State must not rely on
   color alone.

## Established decisions

- The exact palette, spacing, typography, radii, and elevation live in
  [theme.ts](../../shell/src/ui/styles/theme.ts).
- `--accent` is neutral and theme-aware. The cat and cheese retain their own
  artwork colors; legacy crimson tokens do not define the current identity.
- `--link` is an understated ink tone. Semantic status and destructive colors
  remain distinct from normal controls.
- Headings use `--font-display`; body text and controls use `--font-body`.
- Corners use the shared radius tokens. Do not invent a different style for
  each feature.
- The native titlebar identifies the window. Content headings identify sections.
- Cards group actionable entities, not every section. Card nesting is forbidden.
- The personalization preview stays above its controls and follows saved size
  and appearance preferences without stretching or clipping the cat.
- Desktop minimum window sizes and established keyboard behavior still apply.
  `Cmd-K` remains reserved.
- The original Companion is the visual reference; CoPo's adopted neutral
  palette and current shared tokens are the implementation standard.
