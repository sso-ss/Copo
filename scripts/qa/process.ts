import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve, join } from "node:path"
import { classify, redact, signature, type Attempt, type Check } from "./report"

export async function command(args: string[], env = process.env): Promise<string> {
  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe", env })
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  if (code !== 0) throw new Error(redact(`${args[0]} failed (${code}): ${stderr}`).slice(-3000))
  return stdout.trim()
}

export async function runAttempt(args: string[], dir: string, id: string, index: number, timeoutMs: number): Promise<Attempt> {
  const home = await mkdtemp(join(tmpdir(), "copo-qa-"))
  const artifact = `logs/${id}-${index}.txt`
  await mkdir(resolve(dir, "logs"), { recursive: true })
  let log = ""
  let timedOut = false
  const env: Record<string, string | undefined> = { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0",
    COPILOT_API_HOME: join(home, "copo"), CLAUDE_CONFIG_DIR: join(home, "claude") }
  for (const key of Object.keys(env)) if (/TOKEN|SECRET|API_KEY|PASSWORD/.test(key)) delete env[key]
  try {
    const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe", env, detached: process.platform !== "win32" })
    const drain = async (stream: ReadableStream<Uint8Array>) => {
      const decoder = new TextDecoder()
      for await (const chunk of stream) log = (log + decoder.decode(chunk, { stream: true })).slice(-500_000)
    }
    const timer = setTimeout(() => {
      timedOut = true
      try {
        if (process.platform === "win32") proc.kill("SIGKILL")
        else process.kill(-proc.pid, "SIGKILL")
      } catch { /* The process may have exited just before the deadline. */ }
    }, timeoutMs)
    let code: number
    try {
      const results = await Promise.all([proc.exited, drain(proc.stdout), drain(proc.stderr)])
      code = results[0]
    } finally { clearTimeout(timer) }
    const safe = redact(log)
    await writeFile(resolve(dir, artifact), safe)
    return { exitCode: code, timedOut, signature: signature(safe), evidence: safe.slice(-12000), artifact }
  } finally { await rm(home, { recursive: true, force: true }) }
}

export async function runCheck(meta: Pick<Check, "id" | "title" | "area">, args: string[], dir: string, timeoutMs = 600_000): Promise<Check> {
  console.log(`QA: ${meta.title}`)
  const attempts = [await runAttempt(args, dir, meta.id, 1, timeoutMs)]
  if (attempts[0].exitCode !== 0 && !attempts[0].timedOut) attempts.push(await runAttempt(args, dir, meta.id, 2, timeoutMs))
  return { ...meta, attempts, status: classify(attempts), reproduction: `Run from the repository with its pinned Bun version: ${args.map(a => a === process.execPath ? "bun" : a).join(" ")}. The QA runner gives each attempt isolated CoPo and Claude state directories; individual backend tests isolate other integrations.` }
}
