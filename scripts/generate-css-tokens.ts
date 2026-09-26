import { writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  fontStacks, text, weight, leading, tracking, spacing, radii, borderWidth, size,
  elevation, brand, accent, status, link, focusRing, layout, themes
} from "../shell/src/ui/styles/theme";

const REPO = resolve(import.meta.dir, "..");

function toKebabCase(str: string): string {
  return str.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

function processGroup(prefix: string, group: Record<string, string>): string[] {
  return Object.entries(group).map(([k, v]) => {
    // If the group is flat like 'brand.color' we might map it to --brand, 
    // or --brand-fg.
    const key = k === "color" 
      ? `--${prefix}` 
      : `--${prefix}-${toKebabCase(k)}`;
    return `  ${key}: ${v};`;
  });
}

function generateThemeRules(): string {
  return Object.entries(themes).map(([name, values]) => {
    const declarations = Object.entries(values).map(([key, value]) => `  --${toKebabCase(key)}: ${value};`).join("\n");
    return `[data-theme="${name}"] {\n  color-scheme: ${name};\n${declarations}\n}`;
  }).join("\n\n");
}

function generateTokensCSS(): string {
  const rootLines: string[] = [
    "/* AUTO-GENERATED FROM shell/src/ui/styles/theme.ts */",
    "/* Design tokens — declared values for the shell (Settings window). */",
    "",
    ":root {"
  ];

  rootLines.push("  /* ---- Font stacks ---- */");
  Object.entries(fontStacks).forEach(([k, v]) => rootLines.push(`  --font-${k}: ${v};`));

  rootLines.push("\n  /* ---- Type ramp ---- */");
  Object.entries(text).forEach(([k, v]) => rootLines.push(`  --text-${k}: ${v};`));
  Object.entries(weight).forEach(([k, v]) => rootLines.push(`  --weight-${k}: ${v};`));
  Object.entries(leading).forEach(([k, v]) => rootLines.push(`  --leading-${k}: ${v};`));
  if (Object.keys(tracking).length > 0) {
    Object.entries(tracking).forEach(([k, v]) => rootLines.push(`  --tracking-${k}: ${v};`));
  }

  rootLines.push("\n  /* ---- Spacing ---- */");
  Object.entries(spacing).forEach(([k, v]) => rootLines.push(`  --space-${k}: ${v};`));

  rootLines.push("\n  /* ---- Radii ---- */");
  Object.entries(radii).forEach(([k, v]) => rootLines.push(`  --radius-${k}: ${v};`));

  rootLines.push("\n  /* ---- Border widths ---- */");
  Object.entries(borderWidth).forEach(([k, v]) => rootLines.push(`  --border-width-${k}: ${v};`));

  rootLines.push("\n  /* ---- Sizing ---- */");
  Object.entries(size).forEach(([k, v]) => rootLines.push(`  --size-${k}: ${v};`));

  rootLines.push("\n  /* ---- Elevation ---- */");
  Object.entries(elevation).forEach(([k, v]) => rootLines.push(`  --elevation-${k}: ${v};`));

  rootLines.push("\n  /* ---- Colors ---- */");
  rootLines.push(...processGroup("brand", brand as any));
  const { hover, destructive, destructiveFg, ...accentBase } = accent;
  rootLines.push(...processGroup("accent", accentBase as any));
  rootLines.push(`  --accent-hover: ${hover};`);
  rootLines.push(`  --accent-destructive: ${destructive};`);
  rootLines.push(`  --accent-destructive-foreground: ${destructiveFg};`);
  
  rootLines.push("\n  /* ---- Semantic status ---- */");
  rootLines.push(...processGroup("status", status as any));

  rootLines.push("\n  /* ---- Link colors (defaults to dark theme) ---- */");
  rootLines.push(`  --link: ${link.dark.color};`);
  rootLines.push(`  --link-hover: ${link.dark.hover};`);

  rootLines.push("\n  /* ---- Focus ring ---- */");
  rootLines.push(`  --focus-ring-width: ${focusRing.width};`);
  rootLines.push(`  --focus-ring-offset: ${focusRing.offset};`);
  rootLines.push(`  --focus-ring-color: ${focusRing.color};`);
  rootLines.push(`  --focus-ring: ${focusRing.expr};`);

  rootLines.push("\n  /* ---- Layout constants ---- */");
  Object.entries(layout).forEach(([k, v]) => rootLines.push(`  --${toKebabCase(k)}: ${v};`));

  rootLines.push("}\n");

  rootLines.push(`${generateThemeRules()}\n`);

  return rootLines.join("\n");
}

function updateUsageViewerCss() {
  const cssPath = resolve(REPO, "shell/ui/dashboard/style.css");
  let cssSrc = readFileSync(cssPath, "utf8");

  // Keep the dashboard's independent stylesheet on the same theme palette.
  const rootLines: string[] = [
    ":root {"
  ];
  
  rootLines.push("  /* Font stacks */");
  rootLines.push(`  --font-display: ${fontStacks.display};`);
  rootLines.push(`  --font-body: ${fontStacks.body};`);
  rootLines.push(`  --font-mono: ${fontStacks.mono};`);
  
  rootLines.push("");
  rootLines.push("  /* Auto-injected tokens */");
  Object.entries(text).forEach(([k, v]) => rootLines.push(`  --text-${k}: ${v};`));
  Object.entries(weight).forEach(([k, v]) => rootLines.push(`  --weight-${k}: ${v};`));
  Object.entries(leading).forEach(([k, v]) => rootLines.push(`  --leading-${k}: ${v};`));
  Object.entries(tracking).forEach(([k, v]) => rootLines.push(`  --tracking-${k}: ${v};`));
  Object.entries(spacing).forEach(([k, v]) => rootLines.push(`  --space-${k}: ${v};`));
  Object.entries(radii).forEach(([k, v]) => rootLines.push(`  --radius-${k}: ${v};`));
  Object.entries(borderWidth).forEach(([k, v]) => rootLines.push(`  --border-width-${k}: ${v};`));
  Object.entries(size).forEach(([k, v]) => rootLines.push(`  --size-${k}: ${v};`));
  Object.entries(elevation).forEach(([k, v]) => rootLines.push(`  --elevation-${k}: ${v};`));
  
  rootLines.push(...processGroup("brand", brand as any));
  const { hover, destructive, destructiveFg, ...accentBase } = accent;
  rootLines.push(...processGroup("accent", accentBase as any));
  rootLines.push(`  --accent-hover: ${hover};`);
  rootLines.push(...processGroup("status", status as any));
  rootLines.push(`  --link: var(--accent);`);
  rootLines.push(`  --link-hover: var(--accent-hover);`);
  rootLines.push(`  --focus-ring-width: ${focusRing.width};`);
  rootLines.push(`  --focus-ring-offset: ${focusRing.offset};`);
  rootLines.push(`  --focus-ring-color: ${focusRing.color};`);
  rootLines.push(`  --focus-ring: ${focusRing.expr};`);
  Object.entries(layout).forEach(([k, v]) => rootLines.push(`  --${toKebabCase(k)}: ${v};`));
  
  const darkThemeLines = Object.entries(themes.dark).map(([k, v]) => {
     // Dashboard uses --surface-base for textMuted sometimes? We just provide the vars.
     return `  --${toKebabCase(k)}: ${v};`;
  });
  rootLines.push(...darkThemeLines);
  
  rootLines.push("");
  rootLines.push("}");
  
  // replace from `:root {` down to `}`
  const regex = /:root\s*\{[^}]+\}\s*/m;
  const themeBlock = `/* Shared theme overrides: generated */\n${generateThemeRules()}\n/* End shared theme overrides */`;
  const withoutThemes = cssSrc.replace(/\n\/\* Shared theme overrides: generated \*\/[\s\S]*?\/\* End shared theme overrides \*\/\n?/m, "");
  const nextSrc = withoutThemes.replace(regex, `${rootLines.join("\n")}\n\n${themeBlock}\n\n`);
  writeFileSync(cssPath, nextSrc, "utf8");
}

const tokensContent = generateTokensCSS();
writeFileSync(resolve(REPO, "shell/src/ui/styles/tokens.css"), tokensContent, "utf8");
updateUsageViewerCss();
console.log("Tokens synchronized strictly from typescript source.");
