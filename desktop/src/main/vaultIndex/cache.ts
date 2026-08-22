import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import type { IndexRecord } from '@shared/types'
import { atomicWrite } from '../fs/fsUtils'

/**
 * Persistent vault-index cache (GRO-2223 D1-D4, write side GRO-2228, load side GRO-2229):
 * one JSON per vault under an app-storage dir (never the vault), so a relaunch can skip the
 * cold full scan. Electron-free like `store.ts` — `main/index.ts` injects the dir
 * (`userData/index-cache`) via `initIndexCache`; without it every function is inert.
 *
 * THE INVARIANT: the cache is only an accelerator. Loading NEVER throws — a missing, corrupt,
 * wrong-version or wrong-root file degrades to `{ records: null, status }`, which the caller
 * (`reconcile`) treats as "do today's full rescan". A cached record is only ever trusted after
 * its path + mtime + size match a fresh stat (D2), so a stale cache cannot produce wrong data.
 */

const CACHE_VERSION = 1
/** Trailing debounce per root; bursts (a big paste, a sync tool landing) coalesce into one write. */
const PERSIST_DEBOUNCE_MS = 5000

export type IndexCacheStatus = 'hit' | 'miss' | 'corrupt' | 'version-mismatch'

export interface IndexCacheLoad {
  /** Non-null exactly when `status` is `'hit'`. */
  records: Map<string, IndexRecord> | null
  status: IndexCacheStatus
}

let cacheDir: string | null = null
let debounceMs = PERSIST_DEBOUNCE_MS
/** Roots with a debounce timer running; `records` is the LIVE map, serialised at write time. */
const pending = new Map<string, { timer: NodeJS.Timeout; records: Map<string, IndexRecord> }>()
/** Per-root write chains so two atomic writes for one root can never land out of order. */
const chains = new Map<string, Promise<void>>()

/** Remembers the cache dir (created lazily on first write). Call once at startup, before any persist. */
export function initIndexCache(dir: string): void {
  cacheDir = dir
}

function cacheFile(dir: string, root: string): string {
  return path.join(dir, `${createHash('sha256').update(root).digest('hex').slice(0, 16)}.json`)
}

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')
const isFinite_ = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * Full structural check of one cached record — the D2 validation key (path/mtime/size) plus every
 * field the renderer consumes, so a hand-mangled but parseable file can never smuggle a partial
 * record into the index (the invariant again). One bad element marks the whole file corrupt.
 */
function isCachedRecord(v: unknown): v is IndexRecord {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const r = v as Record<string, unknown>
  return (
    typeof r.path === 'string' &&
    typeof r.name === 'string' &&
    typeof r.basename === 'string' &&
    typeof r.folder === 'string' &&
    typeof r.ext === 'string' &&
    isFinite_(r.size) &&
    isFinite_(r.ctime) &&
    isFinite_(r.mtime) &&
    typeof r.properties === 'object' &&
    r.properties !== null &&
    !Array.isArray(r.properties) &&
    (r.frontmatterError === undefined || typeof r.frontmatterError === 'string') &&
    isStringArray(r.tags) &&
    isStringArray(r.links) &&
    isStringArray(r.embeds)
  )
}

/**
 * Loads the persisted records for `root`. NEVER throws: any failure is a status —
 * `miss` (no dir/file, or the file holds another root's payload — a hash-prefix collision or a
 * copied cache dir is simply not this vault's cache), `corrupt` (unparsable / wrong shape /
 * a malformed record), `version-mismatch` (a numeric `version` ≠ CACHE_VERSION).
 */
export async function loadIndexCache(root: string): Promise<IndexCacheLoad> {
  if (cacheDir === null) return { records: null, status: 'miss' }
  let raw: string
  try {
    raw = await readFile(cacheFile(cacheDir, root), 'utf8')
  } catch {
    return { records: null, status: 'miss' }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { records: null, status: 'corrupt' }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { records: null, status: 'corrupt' }
  const doc = parsed as { version?: unknown; root?: unknown; records?: unknown }
  if (!isFinite_(doc.version)) return { records: null, status: 'corrupt' }
  if (doc.version !== CACHE_VERSION) return { records: null, status: 'version-mismatch' }
  if (doc.root !== root) return { records: null, status: 'miss' }
  if (!Array.isArray(doc.records)) return { records: null, status: 'corrupt' }
  const records = new Map<string, IndexRecord>()
  for (const r of doc.records) {
    if (!isCachedRecord(r)) return { records: null, status: 'corrupt' }
    records.set(r.path, r)
  }
  return { records, status: 'hit' }
}

/** True when `v` holds a non-finite number anywhere — YAML `.inf`/`.nan` frontmatter, which JSON cannot round-trip. */
function hasNonFinite(v: unknown): boolean {
  if (typeof v === 'number') return !Number.isFinite(v)
  if (Array.isArray(v)) return v.some(hasNonFinite)
  if (typeof v === 'object' && v !== null) return Object.values(v).some(hasNonFinite)
  return false
}

/** Serialises + atomically writes `records` for `root` NOW, appended to the root's write chain. Errors log, never throw. */
function write(root: string, records: Map<string, IndexRecord>): Promise<void> {
  const dir = cacheDir
  if (dir === null) return Promise.resolve()
  const chain = (chains.get(root) ?? Promise.resolve())
    .then(async () => {
      // Serialise inside the chain: the map is live, so the freshest state wins. Records whose
      // frontmatter carries non-finite numbers are left out — they just rescan on the next start.
      const body = JSON.stringify({ version: CACHE_VERSION, root, records: [...records.values()].filter((r) => !hasNonFinite(r.properties)) })
      await mkdir(dir, { recursive: true })
      await atomicWrite(cacheFile(dir, root), body)
    })
    .catch((err: unknown) => console.error(`[index-cache] failed to write cache for ${root}: ${String(err)}`))
  chains.set(root, chain)
  return chain
}

/**
 * Schedules a debounced (~5 s per root) persist of `records` — the registry calls this from the
 * watcher-incremental mutations, build success and eviction. Bursts coalesce (trailing edge, the
 * latest map ref wins); the timer is unref'd, so `flushIndexCache` (quit) is what guarantees the
 * last write lands. No-op until `initIndexCache` ran.
 */
export function schedulePersist(root: string, records: Map<string, IndexRecord>): void {
  if (cacheDir === null) return
  const prev = pending.get(root)
  if (prev !== undefined) clearTimeout(prev.timer)
  const timer = setTimeout(() => {
    pending.delete(root)
    void write(root, records)
  }, debounceMs)
  timer.unref()
  pending.set(root, { timer, records })
}

/** Writes every pending root now and waits for all in-flight writes — the quit path, next to `store.flush()`. */
export async function flushIndexCache(): Promise<void> {
  for (const [root, p] of [...pending.entries()]) {
    clearTimeout(p.timer)
    pending.delete(root)
    void write(root, p.records)
  }
  await Promise.all([...chains.values()])
}

/** Test hook: drops the injected dir and every pending timer (pending writes are discarded, not flushed). */
export function _resetIndexCache(): void {
  for (const p of pending.values()) clearTimeout(p.timer)
  pending.clear()
  chains.clear()
  cacheDir = null
}

/** Test hook: the per-root persist debounce (omit to restore the 5 s default). */
export function _setPersistDebounceMs(ms: number = PERSIST_DEBOUNCE_MS): void {
  debounceMs = ms
}
