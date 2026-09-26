import type { Stats } from "node:fs"

import { createHash } from "node:crypto"
import { constants } from "node:fs"
import fs, { type FileHandle } from "node:fs/promises"
import path from "node:path"

import type { TaskTracker } from "./task-tracker"
import type { TaskObservation } from "./task-types"

import {
  ClaudeTaskRecords,
  CodexTaskRecords,
  type TaskRecordParser,
} from "./task-records"

export interface TaskSource {
  connectionId: "codex" | "claude-code"
  directory: string
  provider?: string
}

interface FileCursor {
  offset: number
  inode: number
  tail: Buffer
  skipping: boolean
  parser: TaskRecordParser
  source: string
  id: string
}

const MAX_LINE_BYTES = 1024 * 1024
const MAX_READ_BYTES = 4 * MAX_LINE_BYTES
const MAX_FILES = 4096

async function listFiles(
  directory: string,
  depth = 0,
  found: Array<string> = [],
): Promise<Array<string>> {
  if (depth > 4 || found.length >= MAX_FILES) return found
  const entries = await fs.readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    if (found.length >= MAX_FILES) break
    const name = path.join(directory, entry.name)
    if (entry.isDirectory() && entry.name !== "subagents")
      await listFiles(name, depth + 1, found)
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) found.push(name)
  }
  return found
}

/** Read-only, bounded observer. Existing files establish a baseline; only newly
 * appended lifecycle records animate the pet. Raw lines never leave this class. */
export class TaskMonitor {
  private files = new Map<string, FileCursor>()
  private initialized = new Set<string>()
  private generation: string
  private busy = false
  private lost = new Set<string>()

  private tracker: TaskTracker
  private sources: () => Array<TaskSource>

  constructor(tracker: TaskTracker, sources: () => Array<TaskSource>) {
    this.tracker = tracker
    this.sources = sources
    this.generation = tracker.generation
  }

  async poll(now = Date.now()): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      await this.scan(now)
    } finally {
      this.busy = false
    }
  }

  private async scan(now: number): Promise<void> {
    if (this.generation !== this.tracker.generation) {
      this.files.clear()
      this.initialized.clear()
      this.generation = this.tracker.generation
    }
    const generation = this.generation
    this.lost.clear()
    const observations: Array<TaskObservation> = []
    const present = new Set<string>()
    const healthy: Array<string> = []
    const sources = this.sources()
    const signatures = new Set(
      sources.map(
        (source) =>
          `${source.connectionId}:${source.directory}:${source.provider ?? ""}`,
      ),
    )
    for (const signature of this.initialized)
      if (!signatures.has(signature)) this.initialized.delete(signature)
    for (const source of sources) {
      const signature = `${source.connectionId}:${source.directory}:${source.provider ?? ""}`
      try {
        const files = await listFiles(source.directory)
        if (files.length >= MAX_FILES)
          throw new Error("Task observation capacity reached")
        for (const name of files) {
          present.add(name)
          observations.push(
            ...(await this.readSafely(
              name,
              source,
              !this.initialized.has(signature),
            )),
          )
        }
        healthy.push(source.connectionId)
        this.initialized.add(signature)
      } catch {
        this.initialized.delete(signature)
      }
    }
    // Account switches during filesystem I/O discard the entire batch.
    if (generation !== this.tracker.generation) return
    this.tracker.setSources(healthy, now)
    for (const [name, cursor] of this.files) {
      if (!present.has(name)) {
        if (cursor.parser.taskId)
          this.tracker.unavailable(cursor.parser.taskId, now)
        this.files.delete(name)
      }
    }
    this.apply(observations, now)
  }

  private apply(observations: Array<TaskObservation>, now: number): void {
    // Observe all starts before completion in this scan, including child files.
    observations.sort(
      (a, b) =>
        Number(b.status === "started") - Number(a.status === "started")
        || a.timestamp - b.timestamp,
    )
    for (const observation of observations) {
      if (observation.status !== "started") {
        for (const taskId of this.lost) this.tracker.unavailable(taskId, now)
        this.lost.clear()
      }
      this.tracker.observe(observation, this.generation)
    }
    for (const taskId of this.lost) this.tracker.unavailable(taskId, now)
  }

  private lose(name: string): void {
    const cursor = this.files.get(name)
    if (cursor?.parser.taskId) this.lost.add(cursor.parser.taskId)
    this.files.delete(name)
  }

  private async readSafely(
    name: string,
    source: TaskSource,
    baseline: boolean,
  ): Promise<Array<TaskObservation>> {
    try {
      return await this.read(name, source, baseline)
    } catch {
      this.lose(name)
      return []
    }
  }

  private async read(
    name: string,
    source: TaskSource,
    baseline: boolean,
  ): Promise<Array<TaskObservation>> {
    const signature = `${source.connectionId}:${source.directory}:${source.provider ?? ""}`
    const before = await fs.lstat(name)
    let cursor = this.files.get(name)
    if (!before.isFile()) {
      this.lose(name)
      return []
    }
    if (
      cursor?.inode === before.ino
      && cursor.offset === before.size
      && cursor.source === signature
    )
      return []
    const file = await fs.open(name, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const stat = await file.stat()
      const replaced =
        cursor !== undefined
        && (cursor.inode !== stat.ino
          || cursor.offset > stat.size
          || cursor.source !== signature)
      if (replaced) {
        this.lose(name)
        cursor = undefined
      }
      if (!cursor) {
        if (this.files.size >= MAX_FILES) return []
        cursor = this.newCursor(name, source, stat.ino)
        this.files.set(name, cursor)
        if (baseline || replaced) {
          await this.seed(file, cursor, stat)
          return []
        }
      }
      return await this.append(file, cursor, stat.size)
    } finally {
      await file.close()
    }
  }

  private newCursor(
    name: string,
    source: TaskSource,
    inode: number,
  ): FileCursor {
    return {
      offset: 0,
      inode,
      tail: Buffer.alloc(0),
      skipping: false,
      parser:
        source.connectionId === "codex" ?
          new CodexTaskRecords(source.provider ?? "")
        : new ClaudeTaskRecords(),
      source: `${source.connectionId}:${source.directory}:${source.provider ?? ""}`,
      id: createHash("sha256").update(name).digest("hex"),
    }
  }

  private async seed(
    file: FileHandle,
    cursor: FileCursor,
    stat: Stats,
  ): Promise<void> {
    // Metadata identifies Codex's provider. A bounded tail seeds the current turn
    // identity, but its historical observations are never submitted to the tracker.
    if (cursor.parser instanceof CodexTaskRecords) {
      const header = Buffer.alloc(Math.min(stat.size, MAX_LINE_BYTES))
      const { bytesRead } = await file.read(header, 0, header.length, 0)
      const end = header.subarray(0, bytesRead).indexOf(10)
      if (end !== -1) this.decode(cursor, header.subarray(0, end), 0)
    }
    // poll() serializes cursor ownership across all awaited reads.
    // eslint-disable-next-line require-atomic-updates
    cursor.offset = Math.max(0, stat.size - MAX_READ_BYTES)
    if (cursor.offset > 0) {
      const previous = Buffer.alloc(1)
      await file.read(previous, 0, 1, cursor.offset - 1)
      // eslint-disable-next-line require-atomic-updates -- exclusive cursor ownership in poll()
      cursor.skipping = previous[0] !== 10
    }
    await this.append(file, cursor, stat.size)
    // An incomplete pre-baseline record is history too, not a new live event.
    if (cursor.tail.length > 0) {
      cursor.tail = Buffer.alloc(0)
      cursor.skipping = true
    }
  }

  private async append(
    file: FileHandle,
    cursor: FileCursor,
    size: number,
  ): Promise<Array<TaskObservation>> {
    const buffer = Buffer.alloc(Math.min(MAX_READ_BYTES, size - cursor.offset))
    const { bytesRead } = await file.read(
      buffer,
      0,
      buffer.length,
      cursor.offset,
    )
    const start = cursor.offset - cursor.tail.length
    const data = Buffer.concat([cursor.tail, buffer.subarray(0, bytesRead)])
    cursor.offset += bytesRead
    const observations: Array<TaskObservation> = []
    let from = 0
    for (let end = data.indexOf(10); end !== -1; end = data.indexOf(10, from)) {
      if (!cursor.skipping && end - from <= MAX_LINE_BYTES)
        observations.push(
          ...this.decode(cursor, data.subarray(from, end), start + from),
        )
      else if (cursor.parser.taskId) this.lost.add(cursor.parser.taskId)
      cursor.skipping = false
      from = end + 1
    }
    cursor.tail = Buffer.from(data.subarray(from))
    if (cursor.tail.length > MAX_LINE_BYTES) {
      cursor.tail = Buffer.alloc(0)
      cursor.skipping = true
      if (cursor.parser.taskId) this.lost.add(cursor.parser.taskId)
    }
    return observations
  }

  private decode(
    cursor: FileCursor,
    line: Buffer,
    offset: number,
  ): Array<TaskObservation> {
    try {
      return cursor.parser.consume(
        JSON.parse(line.toString("utf8")),
        `${cursor.id}:${offset}`,
      )
    } catch {
      if (cursor.parser.taskId) this.lost.add(cursor.parser.taskId)
      return []
    }
  }
}
