/** Build CoPo logo variants from the user-supplied pixel artwork. */
import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, readFile, copyFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { themes, status } from "../shell/src/ui/styles/theme"

const root = resolve(import.meta.dir, "..")
const source = await readFile(join(root, "shell/assets/copo-cheese.svg"), "utf8")
const paths = source.match(/<path\b[^>]*\/>/g)?.join("\n")
if (!paths) throw new Error("Cheese artwork has no paths")

function icon(backgroundOnly = false, dot?: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img" aria-label="CoPo">
  <rect x="81" y="81" width="862" height="862" rx="194" fill="${themes.dark.surfaceCard}"/>
  <g transform="translate(164 195) scale(3)" shape-rendering="crispEdges"${backgroundOnly ? ' opacity="0.5"' : ""}>${paths}</g>
${dot ? `  <circle cx="842" cy="842" r="112" fill="${dot}" stroke="${themes.dark.surfaceCard}" stroke-width="40"/>` : ""}
</svg>\n`
}

await mkdir(join(root, "shell/assets"), { recursive: true })
const normal = icon()
await writeFile(join(root, "build/macos/app-icon.svg"), normal)
await writeFile(join(root, "shell/assets/copo-icon.svg"), normal)

const tray = join(root, "shell/src-tauri/icons/tray")
const output = await mkdtemp(join(tmpdir(), "copo-tray-"))
for (const [name, svg] of [
  ["icon", normal],
  ["icon-starting", icon(true)],
  ["icon-attention", icon(false, status.warning)],
]) {
  const input = join(tray, `${name}.svg`)
  await writeFile(input, svg)
  const result = spawnSync(process.execPath, [
    join(root, "shell/node_modules/@tauri-apps/cli/tauri.js"),
    "icon", input, "--png", "22", "--png", "44", "--output", output,
  ], { stdio: "inherit" })
  if (result.status !== 0) throw new Error(`Tray icon build failed: ${name}`)
  await copyFile(join(output, "22x22.png"), join(tray, `${name}.png`))
  await copyFile(join(output, "44x44.png"), join(tray, `${name}@2x.png`))
}
