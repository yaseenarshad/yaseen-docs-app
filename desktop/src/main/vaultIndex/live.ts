import path from 'node:path'
import { IDS_FILE, NOTE_ID_KEY, idsAnswer, isIdLetters, vaultNoteId } from '@shared/noteId'
import { FOLDER_SETTINGS_FILE, isFolderSettingsPath, type IdsState, type IndexRecord, type IndexResponse, type WatchEvent } from '@shared/types'
import { BridgeFailure, fsCall, isMarkdown, requireAbsPath } from '../fs/fsUtils'
import { subscribe } from '../fs/watchers'
import { writeConfig } from '../vaultConfig'
import { checkLine, fixNotice, type ClashFix } from './clash'
import { see } from './diary'
import { ID_WAIT_MS, restoreFolderId, sweepIds, type SweepResult } from './idSweep'
import { loadIndexCache, schedulePersist } from './cache'
import { changeIds, highestFrom, highestNumber, vaultIds } from './mint'
import { reconcile, type ColdStartDiff } from './reconcile'
import { backfill, configWithLetters, idsStateOf, planLeft, reletter, type Pass, type Renamed } from './reletter'
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
  /** Each file this Mac left for the vault's first Mac to number, with the time it first left it (YAZ-2677 R31). Gone with the entry: a restart starts the wait again (S66). */
  waits: Map<string, number>
  /** The ONE timer of this vault that sweeps the files in `waits` again when their wait is over (R34). */
  wait?: NodeJS.Timeout
  /** Each ID two Macs gave that two notes still hold, and the path of the note that keeps it (YAZ-2677 S46): the index hands the ID out for that note only. */
  kept: Map<string, string>
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
            // The diary notes each link to an ID this Mac made, with the time (YAZ-2677 R27).
            if (entry.ids) see(root, record, Date.now())
            // Every other indexed note is known to hold what it holds; this one, what it held before.
            void sweep(root, entry, [record], (p) => (p === ev.path ? held : entry.records.get(p)?.id))
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
      entry.dirs.push(ev.path)
      // A folder that appears is given its settings file, and so its id (D13).
      void sweep(root, entry, [], (p) => entry.records.get(p)?.id, [ev.path])
      return
    case 'unlink': {
      const id = isFolderSettingsPath(ev.path) ? entry.records.get(ev.path)?.id : undefined
      entry.records.delete(ev.path)
      entry.waits.delete(ev.path)
      schedulePersist(root, entry.records)
      if (id !== undefined) void restoreFolderId(root, ev.path, id)
      return
    }
    case 'unlinkDir': {
      const prefix = ev.path + path.sep
      for (const p of entry.records.keys()) if (p.startsWith(prefix)) entry.records.delete(p)
      for (const p of entry.waits.keys()) if (p.startsWith(prefix)) entry.waits.delete(p)
      entry.dirs = entry.dirs.filter((dir) => dir !== ev.path && !dir.startsWith(prefix))
      schedulePersist(root, entry.records)
      return
    }
    default:
      return
  }
}

/** Hears each clash this Mac fixed (YAZ-2677 S45): the bridge shows `notice` in the vault's windows, and a file that took a new name is repaired like any rename. */
type FixListener = (root: string, fixes: readonly ClashFix[], notice: string | null) => void
let fixed: FixListener | undefined

/** One listener, set by the bridge at startup. `notice` is null when the caller tells the result itself ("Check for duplicates"). */
export function onIdFixes(listener: FixListener | undefined): void {
  fixed = listener
}

/**
 * A sweep the INDEX starts — a file arrived, the index was built, a yes arrived by the sync — and
 * so one whose numbers wait on a Mac that is not the vault's first (YAZ-2677 🔒 D8, R31). What the
 * USER asks for sweeps with no `waits` (`giveIdsNow`, `checkDuplicates`, R32).
 */
function sweep(root: string, entry: Entry, among: readonly IndexRecord[], knew: (path: string) => string | undefined, dirs: readonly string[] = [], over: readonly string[] = []): Promise<void> {
  return sweepIds(root, entry.records, among, knew, dirs, { waits: entry.waits, indexed: () => Promise.all([...entry.inFlight]) }).then((result) => {
    // `over` are the files whose wait was over when this sweep started: whatever it did, they wait no more, so the timer never runs for one file two times.
    for (const file of over) entry.waits.delete(file)
    armWait(root, entry)
    report(root, entry, result, true)
  })
}

/** What a sweep found about two notes with one ID goes to the index (which note the ID opens meanwhile, S46) and to the bridge (S45). */
function report(root: string, entry: Entry, { fixes, kept }: SweepResult, notice: boolean): void {
  for (const [id, keeper] of kept) entry.kept.set(id, keeper)
  for (const { id } of fixes) entry.kept.delete(id)
  if (fixes.length > 0) fixed?.(root, fixes, notice ? fixNotice(fixes) : null)
}

/**
 * The vault's one timer (R34): set for the file that has waited longest, and only while a file
 * waits and the index of the vault is held. It sweeps the files whose wait is over — each is given
 * its number if it still needs one — and is set again for the next. There is no timer for a file.
 */
function armWait(root: string, entry: Entry): void {
  if (entry.wait !== undefined || entry.waits.size === 0 || entries.get(root) !== entry) return
  let first = Infinity
  for (const since of entry.waits.values()) first = Math.min(first, since)
  entry.wait = setTimeout(() => {
    entry.wait = undefined
    const due = [...entry.waits].filter(([, since]) => Date.now() - since >= ID_WAIT_MS).map(([file]) => file)
    const among = due.flatMap((file) => entry.records.get(file) ?? [])
    const dirs = due.filter((file) => isFolderSettingsPath(file) && !entry.records.has(file)).map((file) => path.dirname(file))
    void sweep(root, entry, among, (p) => entry.records.get(p)?.id, dirs, due)
  }, Math.max(0, first + ID_WAIT_MS - Date.now()))
  entry.wait.unref()
}

// TOMBSTONE (⚡ YAZ-815, ruled by Yasin): `readTypes(root)` stood here — a per-`getIndex` read of
// `.obsidian/types.json`, whose assignments rode `IndexResponse.types` to a typing rung nothing
// ever fed. A foreign app's file is not our schema: `.yaseendocs/properties.json` is the vault's
// own, and this index no longer reads anything out of `.obsidian` at all. (It was never cached
// either — the payload is `{version, root, records}` — so there is nothing to invalidate and no
// CACHE_VERSION bump here.)

/**
 * What a yes would write (`IndexResponse.ask`, YAZ-2523 🔒 V2): a note with no id that can take
 * one, and a folder with no settings file or no id in the one it has. An id is one of the vault
 * with `letters` (YAZ-2677 R5): any other is another tool's, and a yes writes over it (R7).
 */
function wouldWrite(records: ReadonlyMap<string, IndexRecord>, dirs: readonly string[], letters: readonly string[]): NonNullable<IndexResponse['ask']> {
  const notes = [...records.values()].filter((r) => !isFolderSettingsPath(r.path) && vaultNoteId(r.id, letters) === undefined && r.frontmatterError === undefined)
  return {
    notes: notes.length,
    folders: dirs.filter((dir) => vaultNoteId(records.get(path.join(dir, FOLDER_SETTINGS_FILE))?.id, letters) === undefined).length,
    foreign: notes.filter((r) => r.properties[NOTE_ID_KEY] !== undefined).length,
  }
}

async function build(root: string): Promise<Entry> {
  const dirs: string[] = []
  const entry: Entry = { records: new Map(), unsubscribe: () => undefined, inFlight: new Set(), dirs, ids: false, waits: new Map(), kept: new Map() }
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
    const { letters, ...held } = await vaultIds(root)
    let answer = held.answer
    // A vault that already uses IDs carries over with no question (YAZ-2523 🔒 V11): some note holds
    // an id and a yes would write nothing, so yes is saved. One that cannot be written to stays
    // unanswered, and so does one whose `ids.json` is not valid JSON: it is not written over. Each
    // other key of the file stays (YAZ-2677 R10), and an answer that arrived meanwhile stands.
    const ask = wouldWrite(records, dirs, letters)
    if (answer === undefined && ask.notes === 0 && ask.folders === 0 && [...records.values()].some((r) => !isFolderSettingsPath(r.path) && vaultNoteId(r.id, letters) !== undefined)) {
      let now: boolean | undefined
      answer = await saveIds(root, (config) => ((now = idsAnswer(config)) === undefined ? { ...config, enabled: true } : undefined)).then(
        () => now ?? true,
        () => undefined,
      )
    }
    entry.ids = answer === true
    // The diary sees each link the index holds (YAZ-2677 R27): one it saw before keeps its time.
    const now = Date.now()
    if (entry.ids) for (const r of records.values()) see(root, r, now)
  } catch (err) {
    entry.unsubscribe()
    throw err
  }
  entries.set(root, entry)
  // Not awaited: a vault of id-less notes must not hold up its first index (YAZ-2293 D3).
  void sweep(root, entry, [...entry.records.values()], (p) => cached.records?.get(p)?.id, dirs)
  schedulePersist(root, entry.records)
  return entry
}

function evict(root: string): void {
  const entry = entries.get(root)
  if (entry === undefined) return
  clearTimeout(entry.idle)
  // The wait goes with the index (YAZ-2677 R34): the next index of the vault starts it again (S66).
  clearTimeout(entry.wait)
  entry.wait = undefined
  entry.waits.clear()
  // Flush-ish: one last persist so an evicted index leaves a fresh cache behind (GRO-2223).
  schedulePersist(root, entry.records)
  entry.unsubscribe()
  entries.delete(root)
}

function touch(root: string, entry: Entry): void {
  clearTimeout(entry.idle)
  // An index with a file that waits for its number is kept until the wait is over (YAZ-2677 R34): evicted, the wait would start again and never end.
  entry.idle = setTimeout(() => (entry.wait === undefined ? evict(root) : touch(root, entry)), idleMs)
  entry.idle.unref()
}

/**
 * Index of every markdown note under `root` (GRO-2128). The first call walks the tree and
 * subscribes to the root's watcher; later calls return the live map (sorted by path) with a
 * fresh `generatedAt`. Transport-agnostic: no HTTP here — the Desktop bridge calls this directly.
 */
export async function getIndex(root: string): Promise<IndexResponse> {
  const entry = await liveEntry(root)
  // The vault's kind is applied HERE, where the index is handed out (YAZ-2523 🔒 V5): the live
  // records hold what is in the files, whatever the answer was when they were read. So are its
  // letters (YAZ-2677 R5): they, too, can change after a record was read.
  const { answer, letters, saved } = await vaultIds(root)
  const ids = answer === true
  if (ids && !entry.ids) sweepIndexed(root)
  entry.ids = ids
  const sorted = [...entry.records.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  // One map holds notes and folder settings files alike; the file name tells them apart (YAZ-2290 D8).
  const records: IndexRecord[] = []
  const folders: IndexRecord[] = []
  const current = `${letters[0]}-`
  const kept = keptIds(entry, letters)
  for (const r of sorted) (isFolderSettingsPath(r.path) ? folders : records).push(ids ? owned(r, letters, current, kept) : plain(r))
  // `ask` goes out while the answer is not yes (YAZ-2677 🔒 D2): the box in Settings shows the counts for a vault that said no too,
  // and asks for the letters the vault's file already holds (S9).
  if (!ids) return { root, records, folders, generatedAt: Date.now(), ids, ask: { ...wouldWrite(entry.records, entry.dirs, letters), ...(saved && { letters: letters[0] }) } }
  return { root, records, folders, generatedAt: Date.now(), ids, letters, ...((await planLeft(root)) && { unfinished: true as const }) }
}

/** The live index of `root`: built on the first call, with each scan the watcher has started already in it. */
async function liveEntry(root: string): Promise<Entry> {
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
  return entry
}

// The door's answer to "what is the highest number in this vault?" (YAZ-2677 R16) comes from the
// live records, in memory: a new note reads no file for it. Also a number a note held by hand (S37).
highestFrom(async (root, letters) => highestNumber((await liveEntry(root)).records.values(), letters))

/** A record as a vault that does not use IDs hands it out (YAZ-2523 🔒 V12): no id, its file name as its title. `id` and `title` stay among its properties. */
function plain({ id: _id, ...r }: IndexRecord): IndexRecord {
  r.title = fileTitle(r)
  return r
}

/**
 * A record as the vault with `letters` hands it out (YAZ-2677 R5): its id as an ID of THIS vault.
 * One with the letters the vault had before goes out with the `current` ones, so every link and
 * lookup finds it by one spelling; one with any other letters is another tool's `id` and goes out
 * as none (R7). The record itself, untouched, in every other case — almost all of them.
 *
 * An ID two Macs gave, while two notes still hold it (`kept`, YAZ-2677 S46): only the note that
 * keeps it goes out with it, so a link by that ID opens the keeper on every Mac until the one Mac
 * that must fix it has run. The other note goes out as a note that has no id yet.
 */
function owned(r: IndexRecord, letters: readonly string[], current: string, kept: ReadonlyMap<string, string>): IndexRecord {
  if (r.id === undefined) return r
  const id = r.id.startsWith(current) ? r.id : vaultNoteId(r.id, letters)
  if (id === r.id && kept.size === 0) return r
  const keeper = id === undefined ? undefined : kept.get(id)
  if (id === r.id && (keeper === undefined || keeper === r.path)) return r
  const { id: _id, ...rest } = r
  return id === undefined || (keeper !== undefined && keeper !== r.path) ? rest : { ...rest, id }
}

/** `entry.kept` without each ID whose keeper holds it no more: that clash is over, or its keeper moved, and the ID goes out as the files hold it. */
function keptIds(entry: Entry, letters: readonly string[]): ReadonlyMap<string, string> {
  for (const [id, keeper] of entry.kept) if (vaultNoteId(entry.records.get(keeper)?.id, letters) !== id) entry.kept.delete(id)
  return entry.kept
}

/**
 * Sweeps every note the live index holds for `root`, and every folder there now — for a vault that
 * said yes after its index was built (YAZ-2523 🔒 V4). A yes that arrived by the sync, or from
 * another window: the numbers wait where this Mac is not the vault's first (YAZ-2677 S65).
 */
function sweepIndexed(root: string): void {
  const entry = entries.get(root)
  if (entry === undefined) return
  const now = Date.now()
  for (const r of entry.records.values()) see(root, r, now)
  const dirs: string[] = []
  const all = (): Promise<void> => sweep(root, entry, [...entry.records.values()], (p) => entry.records.get(p)?.id, dirs)
  void walk(root, [], dirs).then(all, all)
}

/**
 * The switch in Settings (YAZ-2677 🔒 D2, R10, R12): the vault's answer goes into its `ids.json`,
 * and with a yes its ID letters, in capitals. Every key the save does not change stays — `letters`
 * and `was` most of all. A file that is not valid JSON is not written over (`INVALID_CONFIG`).
 * The index refetches off the write, as off any change of the file.
 */
export async function saveIdsAnswer(root: unknown, enabled: unknown, letters?: unknown): Promise<void> {
  const r = requireAbsPath(root, 'root')
  if (typeof enabled !== 'boolean') throw new BridgeFailure('BAD_REQUEST', "'enabled' must be true or false")
  if (letters !== undefined && (typeof letters !== 'string' || !isIdLetters(letters))) throw new BridgeFailure('BAD_REQUEST', "'letters' must be 2 to 5 letters")
  await saveIds(r, (config) => ({ ...config, enabled, ...(letters !== undefined && { letters: letters.toUpperCase() }) }))
}

/** A change of `ids.json` by the app (`changeIds`, the ONE write of that file), written as the app writes a vault's config: each window of the vault hears of it at once. */
const saveIds = (r: string, change: (config: Record<string, unknown>) => Record<string, unknown> | undefined): Promise<void> => changeIds(r, change, (config) => writeConfig(r, IDS_FILE, config))

/** The live index of a vault that uses IDs, and its letters; refused for any other. */
async function idsVault(root: unknown): Promise<{ r: string; entry: Entry; letters: string[]; saved: boolean }> {
  const r = requireAbsPath(root, 'root')
  const entry = await liveEntry(r)
  const { answer, letters, saved } = await vaultIds(r)
  if (answer !== true) throw new BridgeFailure('BAD_REQUEST', 'this vault does not use IDs', { path: r })
  return { r, entry, letters, saved }
}

/**
 * The state of `root` after a pass. The index takes what the pass did at once: the watcher tells it
 * the same a moment later, and Settings must not show the counts of before meanwhile.
 */
async function stateAfter(root: string, entry: Entry, { changed, gone }: Pass): Promise<IdsState> {
  for (const file of gone) entry.records.delete(file)
  for (const file of changed) await scanFile(root, file).then((record) => entry.records.set(file, record), () => undefined)
  if (changed.length > 0 || gone.length > 0) schedulePersist(root, entry.records)
  return idsStateOf(entry.records.values(), (await vaultIds(root)).letters, await planLeft(root))
}

/** What the rows "ID letters" and "Old IDs" of Settings show (YAZ-2677 🔒 D5, D6, `IdsState`). */
export async function idsState(root: unknown): Promise<IdsState> {
  const { r, entry, letters } = await idsVault(root)
  return idsStateOf(entry.records.values(), letters, await planLeft(r))
}

/**
 * "Change letters" (YAZ-2677 🔒 D5, S79 to S87), at once on this Mac (R32). FIRST `ids.json` takes
 * the new letters and keeps the letters of before in `was` (S81): from then on each note opens,
 * whatever happens next, because the index reads an ID with letters of before as an ID of the
 * vault (S82, S83). THEN each file follows (`reletter`). The letters the vault already has write
 * nothing into `ids.json` and finish a change that stopped (S83, S85). The same change on two Macs
 * writes the same bytes (S84): no number is taken, and nothing depends on the time.
 */
export async function changeLetters(root: unknown, letters: unknown, renamed?: Renamed): Promise<IdsState> {
  if (typeof letters !== 'string' || !isIdLetters(letters)) throw new BridgeFailure('BAD_REQUEST', "'letters' must be 2 to 5 letters")
  const { r, entry, letters: held, saved } = await idsVault(root)
  const to = letters.toUpperCase()
  // A vault with no letters in its file saves them here, and keeps its default in `was` (R11): a note that carries the default follows.
  if (to !== held[0] || !saved) await saveIds(r, (config) => configWithLetters(config, held, to))
  return stateAfter(r, entry, await reletter(r, (await vaultIds(r)).letters, renamed))
}

/**
 * "Give old IDs numbers" (YAZ-2677 🔒 D6, S88 to S90), at once on this Mac (R32): `backfill` over
 * the notes the index holds. Never throws for a file it could not write: the state says what is left.
 */
export async function giveOldIdsNumbers(root: unknown, renamed?: Renamed): Promise<IdsState> {
  const { r, entry, letters } = await idsVault(root)
  return stateAfter(r, entry, await backfill(r, entry.records.values(), letters, renamed))
}

/**
 * "Give IDs" (YAZ-2677 R32, S64): the user asked on THIS Mac, so every note and folder of `root`
 * is given its number now, whichever Mac is the vault's first. A Mac that only sees the yes
 * arrive sweeps by `sweepIndexed`, and waits. Resolves when the pass is done; never throws.
 */
export async function giveIdsNow(root: string): Promise<void> {
  const entry = await liveEntry(root).catch(() => undefined)
  if (entry === undefined) return
  // This Mac said the yes: `getIndex` need not start the pass that waits.
  entry.ids = true
  const now = Date.now()
  for (const r of entry.records.values()) see(root, r, now)
  const dirs: string[] = []
  await walk(root, [], dirs).catch(() => undefined)
  report(root, entry, await sweepIds(root, entry.records, [...entry.records.values()], (p) => entry.records.get(p)?.id, dirs), true)
}

/**
 * "Check for duplicates" (YAZ-2677 🔒 D7, S55 to S57): the notes of `root` that share an ID are
 * swept now, on this Mac (R32), and what happened is told in one line. A clash that another Mac
 * must fix is told and not touched. A note with no ID is not given one here.
 */
export async function checkDuplicates(root: unknown): Promise<string> {
  const r = requireAbsPath(root, 'root')
  const entry = await liveEntry(r)
  const { answer, letters } = await vaultIds(r)
  if (answer !== true) throw new BridgeFailure('BAD_REQUEST', 'this vault does not use IDs', { path: r })
  const holders = new Map<string, IndexRecord[]>()
  for (const record of entry.records.values()) {
    const id = vaultNoteId(record.id, letters)
    if (id !== undefined) holders.set(id, [...(holders.get(id) ?? []), record])
  }
  const among = [...holders.values()].filter((group) => group.length > 1).flat()
  const result = await sweepIds(r, entry.records, among, (p) => entry.records.get(p)?.id)
  // The line below tells the result: no notice beside it.
  report(r, entry, result, false)
  return checkLine(result)
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

/** Test hook: drops the cached index of one vault and its watcher subscription — the app of that Mac quits. */
export function _evict(root: string): void {
  evict(root)
}

/** Test hook: drops every cached index and its watcher subscription. */
export function _evictAll(): void {
  for (const root of [...entries.keys()]) evict(root)
}

/** Test hook: idle period before an unused index is evicted (omit to restore the 10-minute default). */
export function _setIdleMs(ms: number = DEFAULT_IDLE_MS): void {
  idleMs = ms
}
