import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import type { IndexRecord, IndexResponse, WatchEvent } from '@shared/types'
import { fsCall, isMarkdown, isSkipped } from '../fs/fsUtils'
import { subscribe } from '../fs/watchers'
import { scanFile } from './scan'

interface Entry {
  records: Map<string, IndexRecord>
  unsubscribe: () => void
  idle?: NodeJS.Timeout
}

const DEFAULT_IDLE_MS = 10 * 60 * 1000
const SCAN_CONCURRENCY = 32

/** One live index per root, kept fresh by the shared watcher; dropped after `idleMs` without a `getIndex`. */
const entries = new Map<string, Entry>()
/** First-call scans in flight, so concurrent callers share one walk. */
const pending = new Map<string, Promise<Entry>>()
let idleMs = DEFAULT_IDLE_MS

/** Markdown files under `dir`, skipping dot-entries / node_modules; unreadable subdirs are skipped like `buildTree`. */
async function walk(dir: string, out: string[]): Promise<void> {
  const dirents = await readdir(dir, { withFileTypes: true })
  await Promise.all(
    dirents.map(async (e) => {
      if (isSkipped(e.name)) return
      const full = path.join(dir, e.name)
      if (e.isDirectory()) await walk(full, out).catch(() => undefined)
      else if (e.isFile() && isMarkdown(e.name)) out.push(full)
    }),
  )
}

/** Scans `files` with at most SCAN_CONCURRENCY reads in flight; files that fail to scan are left out. */
async function scanAll(root: string, files: string[]): Promise<Map<string, IndexRecord>> {
  const records = new Map<string, IndexRecord>()
  let next = 0
  const worker = async () => {
    while (next < files.length) {
      const file = files[next++]
      const record = await scanFile(root, file).catch(() => null)
      if (record !== null) records.set(file, record)
    }
  }
  await Promise.all(Array.from({ length: Math.min(SCAN_CONCURRENCY, files.length) }, worker))
  return records
}

function onEvent(root: string, entry: Entry, ev: WatchEvent): void {
  switch (ev.type) {
    case 'add':
    case 'change':
      if (!isMarkdown(ev.path)) return
      void scanFile(root, ev.path).then(
        (record) => entry.records.set(ev.path, record),
        () => entry.records.delete(ev.path),
      )
      return
    case 'unlink':
      entry.records.delete(ev.path)
      return
    case 'unlinkDir': {
      const prefix = ev.path + path.sep
      for (const p of entry.records.keys()) if (p.startsWith(prefix)) entry.records.delete(p)
      return
    }
    default:
      return
  }
}

/**
 * Assigned property types from `.obsidian/types.json` (5B, GRO-2142), read fresh per call —
 * the file is tiny and the watcher skips dot-dirs. Missing/malformed file → undefined;
 * non-string assignments are dropped.
 */
async function readTypes(root: string): Promise<Record<string, string> | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path.join(root, '.obsidian', 'types.json'), 'utf8'))
    const types = (parsed as { types?: unknown } | null)?.types
    if (types === null || typeof types !== 'object' || Array.isArray(types)) return undefined
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(types as Record<string, unknown>)) if (typeof v === 'string') out[k] = v
    return out
  } catch {
    return undefined
  }
}

async function build(root: string): Promise<Entry> {
  const entry: Entry = { records: new Map(), unsubscribe: () => undefined }
  const files: string[] = []
  await fsCall(root, () => walk(root, files))
  // Subscribe before reading so a write that lands mid-scan is re-scanned rather than lost.
  entry.unsubscribe = subscribe(root, (ev) => onEvent(root, entry, ev))
  try {
    entry.records = await scanAll(root, files)
  } catch (err) {
    entry.unsubscribe()
    throw err
  }
  entries.set(root, entry)
  return entry
}

function evict(root: string): void {
  const entry = entries.get(root)
  if (entry === undefined) return
  clearTimeout(entry.idle)
  entry.unsubscribe()
  entries.delete(root)
}

function touch(root: string, entry: Entry): void {
  clearTimeout(entry.idle)
  entry.idle = setTimeout(() => evict(root), idleMs)
  entry.idle.unref()
}

/**
 * Index of every markdown note under `root` (GRO-2128). The first call walks the tree and
 * subscribes to the root's watcher; later calls return the live map (sorted by path) with a
 * fresh `generatedAt`. Transport-agnostic: no HTTP here — the Desktop bridge calls this directly.
 */
export async function getIndex(root: string): Promise<IndexResponse> {
  let entry = entries.get(root)
  if (entry === undefined) {
    let scan = pending.get(root)
    if (scan === undefined) {
      scan = build(root).finally(() => pending.delete(root))
      pending.set(root, scan)
    }
    entry = await scan
  }
  touch(root, entry)
  const records = [...entry.records.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  const types = await readTypes(root)
  return { root, records, generatedAt: Date.now(), ...(types !== undefined && { types }) }
}

/** Test hook: drops every cached index and its watcher subscription. */
export function _evictAll(): void {
  for (const root of [...entries.keys()]) evict(root)
}

/** Test hook: idle period before an unused index is evicted (omit to restore the 10-minute default). */
export function _setIdleMs(ms: number = DEFAULT_IDLE_MS): void {
  idleMs = ms
}
