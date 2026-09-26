export const fontStacks = {
  display: 'ui-rounded, "SF Pro Rounded", "Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  body: '"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
} as const;

export const companionArtwork = { heart: "#f4698e", spark: "#eabb60" } as const;

export const text = {
  xs: "0.75rem",
  sm: "0.875rem",
  base: "1rem",
  md: "1.125rem",
  lg: "1.25rem",
  xl: "1.5rem",
  "2xl": "2rem",
  "3xl": "2.5rem",
  "4xl": "3rem",
} as const;

export const weight = {
  base: "400",
  md: "500",
  lg: "600",
  xl: "600",
  "2xl": "700",
} as const;

export const leading = {
  base: "1.6",
  lg: "1.4",
  xl: "1.3",
  "2xl": "1.2",
} as const;

export const tracking = {
  xl: "-0.01em",
  "2xl": "-0.015em",
} as const;

export const spacing = {
  1: "4px",
  2: "8px",
  3: "12px",
  4: "16px",
  5: "24px",
  6: "32px",
  7: "48px",
  8: "64px",
} as const;

export const radii = {
  input: "12px",
  card: "18px",
  panel: "24px",
  chip: "8px",
  pill: "9999px",
} as const;

export const borderWidth = {
  hairline: "1px",
  thin: "1px",
  thick: "2px",
  heavy: "4px",
} as const;

export const size = {
  xs: "12px",
  sm: "16px",
  md: "20px",
  lg: "24px",
  xl: "32px",
  "2xl": "40px",
} as const;

export const elevation = {
  card: "0 2px 8px rgb(36 52 83 / 0.04)",
  modal: "0 12px 32px rgb(24 28 36 / 0.16)",
  tooltip: "0 4px 12px rgb(24 28 36 / 0.1)",
} as const;

export const brand = {
  color: "#c8334a",
  fg: "#ffffff",
} as const;

export const accent = {
  color: "#354154",
  hover: "#253145",
  fg: "#ffffff",
  destructive: "#b32d3f",
  destructiveFg: "#ffffff",
} as const;

export const status = {
  error: "#ef4444",
  errorFg: "#fca5a5",
  success: "#22c55e",
  successFg: "#4ade80",
  warning: "#eab308",
  warningFg: "#facc15",
  info: "#38bdf8",
  infoFg: "#7dd3fc",
} as const;

export const link = {
  dark: {
    color: "#ccd3de",
    hover: "#f3f2ef",
  },
  light: {
    color: "#46556b",
    hover: "#243453",
  }
} as const;

export const focusRing = {
  width: "2px",
  offset: "2px",
  color: "var(--accent)",
  expr: "var(--focus-ring-width) solid var(--focus-ring-color)",
} as const;

export const layout = {
  sidebarWidth: "200px",
  contentMax: "640px",
  contentMaxWide: "1152px",
} as const;

export const themes = {
  dark: {
    surfaceBase: "#1b1d20",
    surfaceCard: "#24262a",
    surfaceControl: "#303236",
    surfaceCompanionPreview: "#30343b",
    textStrong: "#f3f2ef",
    textBaseColor: "#d3d4d6",
    textMuted: "#a1a6af",
    borderSubtle: "#3c3f45",
    borderStrong: "#7e8590",
    accent: "#d0d4dc",
    accentHover: "#e8eaee",
    accentFg: "#20242c",
    accentDestructive: "#f29a9e",
    accentDestructiveForeground: "#32191d",
    link: link.dark.color,
    linkHover: link.dark.hover,
  },
  light: {
    surfaceBase: "#faf9f6",
    surfaceCard: "#ffffff",
    surfaceControl: "#efeeeb",
    surfaceCompanionPreview: "#eeede9",
    textStrong: "#29364a",
    textBaseColor: "#414753",
    textMuted: "#626a76",
    borderSubtle: "#e4e3df",
    borderStrong: "#858994",
    accent: accent.color,
    accentHover: accent.hover,
    accentFg: accent.fg,
    accentDestructive: accent.destructive,
    accentDestructiveForeground: accent.destructiveFg,
    statusError: "#b43e48",
    statusErrorFg: "#b43e48",
    statusSuccess: "#32705a",
    statusSuccessFg: "#32705a",
    statusWarning: "#906322",
    statusWarningFg: "#906322",
    statusInfo: "#40628f",
    statusInfoFg: "#40628f",
    link: link.light.color,
    linkHover: link.light.hover,
  }
} as const;
