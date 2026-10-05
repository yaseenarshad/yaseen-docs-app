import path from 'node:path'
import { IDS_FILE, NOTE_ID_KEY } from '@shared/noteId'
import { FOLDER_SETTINGS_FILE, isFolderSettingsPath, type IndexRecord, type IndexResponse, type WatchEvent } from '@shared/types'
import { fsCall, isMarkdown } from '../fs/fsUtils'
import { subscribe } from '../fs/watchers'
import { writeConfig } from '../vaultConfig'
import { idsOf, restoreFolderId, sweepIds } from './idSweep'
import { loadIndexCache, schedulePersist } from './cache'
import { reconcile, type ColdStartDiff } from './reconcile'
import { fileTitle, scanFile, walk } from './scan'

interface Entry {
  records: Map<string, IndexRecord>
  unsubscribe: () => void
  idle?: NodeJS.Timeout
  /** Live scans the watcher has started but not finished — `getIndex` drains these before it answers (YAZ-986). */
  inFlight: Set<Promise<unknown>>
  /** What the cold-start reconcile found (GRO-2223); dropped with the entry on idle eviction. */
  coldDiff?: ColdStartDiff
  /** Every folder the build walked into: the ones a yes would write to (`wouldWrite`). */
  dirs: string[]
  /** Whether the vault said yes to IDs when last asked (YAZ-2523 🔒 V4): a yes that arrives later starts the pass. */
  ids: boolean
}

const DEFAULT_IDLE_MS = 10 * 60 * 1000

/** One live index per root, kept fresh by the shared watcher; dropped after `idleMs` without a `getIndex`. */
const entries = new Map<string, Entry>()
/** First-call scans in flight, so concurrent callers share one walk. */
const pending = new Map<string, Promise<Entry>>()
let idleMs = DEFAULT_IDLE_MS

function onEvent(root: string, entry: Entry, ev: WatchEvent): void {
  switch (ev.type) {
    case 'add':
    case 'change': {
      if (!isMarkdown(ev.path)) return
      const held = entry.records.get(ev.path)?.id
      const scan = scanFile(root, ev.path)
        .then(
          (record) => {
            entry.records.set(ev.path, record)
            // Every other indexed note is known to hold what it holds; this one, what it held before.
            void sweepIds(root, entry.records, [record], (p) => (p === ev.path ? held : entry.records.get(p)?.id))
          },
          () => entry.records.delete(ev.path),
        )
        .finally(() => {
          entry.inFlight.delete(scan)
          schedulePersist(root, entry.records)
        })
      entry.inFlight.add(scan)
      return
    }
    case 'addDir':
      // A folder that appears is given its settings file, and so its id (D13).
      void sweepIds(root, entry.records, [], (p) => entry.records.get(p)?.id, [ev.path])
      return
    case 'unlink': {
      const id = isFolderSettingsPath(ev.path) ? entry.records.get(ev.path)?.id : undefined
      entry.records.delete(ev.path)
      schedulePersist(root, entry.records)
      if (id !== undefined) void restoreFolderId(root, ev.path, id)
      return
    }
    case 'unlinkDir': {
      const prefix = ev.path + path.sep
      for (const p of entry.records.keys()) if (p.startsWith(prefix)) entry.records.delete(p)
      schedulePersist(root, entry.records)
      return
    }
    default:
      return
  }
}

// TOMBSTONE (⚡ YAZ-815, ruled by Yasin): `readTypes(root)` stood here — a per-`getIndex` read of
// `.obsidian/types.json`, whose assignments rode `IndexResponse.types` to a typing rung nothing
// ever fed. A foreign app's file is not our schema: `.yaseendocs/properties.json` is the vault's
// own, and this index no longer reads anything out of `.obsidian` at all. (It was never cached
// either — the payload is `{version, root, records}` — so there is nothing to invalidate and no
// CACHE_VERSION bump here.)

/**
 * What a yes would write (`IndexResponse.ask`, YAZ-2523 🔒 V2): a note with no id that can take
 * one, and a folder with no settings file or no id in the one it has.
 */
function wouldWrite(records: ReadonlyMap<string, IndexRecord>, dirs: readonly string[]): NonNullable<IndexResponse['ask']> {
  const notes = [...records.values()].filter((r) => !isFolderSettingsPath(r.path) && r.id === undefined && r.frontmatterError === undefined)
  return {
    notes: notes.length,
    folders: dirs.filter((dir) => records.get(path.join(dir, FOLDER_SETTINGS_FILE))?.id === undefined).length,
    foreign: notes.filter((r) => r.properties[NOTE_ID_KEY] !== undefined).length,
  }
}

async function build(root: string): Promise<Entry> {
  const dirs: string[] = []
  const entry: Entry = { records: new Map(), unsubscribe: () => undefined, inFlight: new Set(), dirs, ids: false }
  const files: string[] = []
  // Persistent cache (GRO-2223): loaded BEFORE subscribing, overlapped with the walk — the cache
  // lives in userData, never the vault, so the watcher ordering below does not apply to it, and
  // reading it early keeps the multi-MB read ahead of the watcher's initial walk that floods the
  // fs threadpool on subscribe.
  const [cached] = await Promise.all([loadIndexCache(root), fsCall(root, () => walk(root, files, dirs))])
  // A corrupt cache is an anomaly worth one line (vaultConfig idiom); `miss` and
  // `version-mismatch` are expected states (first open / semantics bump) and stay silent.
  if (cached.status === 'corrupt') console.warn(`[index-cache] cache for ${root} is corrupt; ignoring it and rescanning`)
  // Subscribe before reading so a write that lands mid-scan is re-scanned rather than lost.
  entry.unsubscribe = subscribe(root, (ev) => onEvent(root, entry, ev))
  try {
    // Reuse records the D2 stat sweep validates, rescan the rest. Any cache failure comes back
    // as a non-hit load and reconcile degrades to today's full scan.
    const { records, diff } = await reconcile(root, files, cached)
    entry.records = records
    entry.coldDiff = diff
    let answer = await idsOf(root)
    // A vault that already uses IDs carries over with no question (YAZ-2523 🔒 V11): some note holds
    // an id and none is waiting for one, so yes is saved. One that cannot be written to stays unanswered.
    if (answer === undefined && [...records.values()].some((r) => !isFolderSettingsPath(r.path) && r.id !== undefined) && wouldWrite(records, dirs).notes === 0) {
      answer = await writeConfig(root, IDS_FILE, { enabled: true }).then(
        () => true,
        () => undefined,
      )
    }
    entry.ids = answer === true
    // Not awaited: a vault of id-less notes must not hold up its first index (YAZ-2293 D3).
    void sweepIds(root, records, [...records.values()], (p) => cached.records?.get(p)?.id, dirs)
  } catch (err) {
    entry.unsubscribe()
    throw err
  }
  entries.set(root, entry)
  schedulePersist(root, entry.records)
  return entry
}

function evict(root: string): void {
  const entry = entries.get(root)
  if (entry === undefined) return
  clearTimeout(entry.idle)
  // Flush-ish: one last persist so an evicted index leaves a fresh cache behind (GRO-2223).
  schedulePersist(root, entry.records)
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
  // Drain scans the watcher has already started: a create that beat this call is in this snapshot,
  // never invisible until the next fs event (YAZ-986) — the live twin of awaiting the first build.
  if (entry.inFlight.size > 0) await Promise.all([...entry.inFlight])
  // The vault's kind is applied HERE, where the index is handed out (YAZ-2523 🔒 V5): the live
  // records hold what is in the files, whatever the answer was when they were read.
  const answer = await idsOf(root)
  const ids = answer === true
  if (ids && !entry.ids) sweepIndexed(root)
  entry.ids = ids
  const sorted = [...entry.records.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  // One map holds notes and folder settings files alike; the file name tells them apart (YAZ-2290 D8).
  const records: IndexRecord[] = []
  const folders: IndexRecord[] = []
  for (const r of sorted) (isFolderSettingsPath(r.path) ? folders : records).push(ids ? r : plain(r))
  return { root, records, folders, generatedAt: Date.now(), ids, ...(answer === undefined && { ask: wouldWrite(entry.records, entry.dirs) }) }
}

/** A record as a vault that does not use IDs hands it out (YAZ-2523 🔒 V12): no id, its file name as its title. `id` and `title` stay among its properties. */
function plain({ id: _id, ...r }: IndexRecord): IndexRecord {
  return { ...r, title: fileTitle(r) }
}

/** Sweeps every note the live index holds for `root`, and every folder there now — for a vault that said yes after its index was built (YAZ-2523 🔒 V4). */
function sweepIndexed(root: string): void {
  const records = entries.get(root)?.records
  if (records === undefined) return
  const dirs: string[] = []
  const sweep = (): Promise<void> => sweepIds(root, records, [...records.values()], (p) => records.get(p)?.id, dirs)
  void walk(root, [], dirs).then(sweep, sweep)
}

/**
 * The cold-start reconcile diff for `root` (GRO-2223) — the E1c rename-detection consumer
 * (GRO-2242) reads it after the first `getIndex`. Undefined before the first build and again
 * once idle eviction drops the entry. Trust `added`/`removed`/`changed` only when
 * `cacheStatus === 'hit'`: on any other status there was no before-snapshot and they are empty.
 */
export function getColdStartDiff(root: string): ColdStartDiff | undefined {
  return entries.get(root)?.coldDiff
}

/** Test hook: drops every cached index and its watcher subscription. */
export function _evictAll(): void {
  for (const root of [...entries.keys()]) evict(root)
}

/** Test hook: idle period before an unused index is evicted (omit to restore the 10-minute default). */
export function _setIdleMs(ms: number = DEFAULT_IDLE_MS): void {
  idleMs = ms
}
