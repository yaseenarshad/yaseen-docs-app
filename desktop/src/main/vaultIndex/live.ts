import path from 'node:path'
import { canonicalNoteId, IDS_FILE, NOTE_ID_KEY, idLettersOf, idsAnswer, isIdLetters, isNumberId, numberId, vaultNoteId } from '@shared/noteId'
import { FOLDER_SETTINGS_FILE, isFolderSettingsPath, type IdGroup, type IdsState, type IndexRecord, type IndexResponse, type WatchEvent } from '@shared/types'
import { boardIdOf, formerBoardIdsOf } from '@shared/drawingAssets'
import { isFiniteNumber, isRecord } from '@shared/guards'
import { isDrawing } from '@shared/fileKind'
import { readBoardHead } from '../fs/boardHead'
import { BridgeFailure, fsCall, isMarkdown, requireAbsPath } from '../fs/fsUtils'
import { subscribe } from '../fs/watchers'
import { writeConfig } from '../vaultConfig'
import { checkLine, fixNotice, type ClashFix } from './clash'
import { see } from './diary'
import { CARD_MOVE_WAIT_MS, ID_WAIT_MS, restoreFolderId, sweepIds, type SweepResult } from './idSweep'
import { loadIndexCache, schedulePersist } from './cache'
import { changeIds, highestFrom, highestNumber, seenFrom, vaultIds } from './mint'
import { reconcile, SCAN_CONCURRENCY, type ColdStartDiff } from './reconcile'
import { backfill, configWithLetters, idsStateOf, isKept, planLeft, reletter, type Pass, type Renamed } from './reletter'
import { fileTitle, idsOwnedBy, ownOnly, scanFile, walk } from './scan'

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
  /** Each page that took a card ID another page still holds, keyed `<path>\n<id>`, with the time first seen (YAZ-4960 `SweepOptions.cardWaits`). Gone with the entry. */
  cardWaits: Map<string, number>
  /** The ONE timer of this vault that sweeps the files in `waits` and `cardWaits` again when their wait is over (R34). */
  wait?: NodeJS.Timeout
  /** Each ID two Macs gave that two notes still hold, and the path of the note that keeps it (YAZ-2677 S46): the index hands the ID out for that note only. */
  kept: Map<string, string>
  /** Each board's ID as its head holds it (YAZ-3943 4C), by path; a board with no ID is not here. Never cached: the build reads the heads again. */
  boards: Map<string, string>
  /** Each ID a board held before a two-Mac merge (YAZ-4071 7I, `formerIds`), to the ID it holds now; read with `boards`. */
  formerIds: Map<string, string>
  /**
   * Which folders answer for their own IDs (YAZ-4922 🔒 D1, `idsOwnedBy`), as read for what the index SHOWS: the counts
   * of the box and of Settings. Cleared when a folder comes or goes and when the app writes an `ids.json`. A write
   * (the sweep, a change of letters) never reads it: each of its passes reads the folders again.
   */
  answers: Map<string, Promise<boolean>>
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
      if (isDrawing(ev.path)) {
        const read = readBoard(root, entry, ev.path).finally(() => entry.inFlight.delete(read))
        entry.inFlight.add(read)
        return
      }
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
      entry.answers.clear()
      // A folder that appears is given its settings file, and so its id (D13).
      void sweep(root, entry, [], (p) => entry.records.get(p)?.id, [ev.path])
      return
    case 'unlink': {
      if (entry.boards.delete(ev.path)) boardsChanged?.(root)
      const id = isFolderSettingsPath(ev.path) ? entry.records.get(ev.path)?.id : undefined
      entry.records.delete(ev.path)
      entry.waits.delete(ev.path)
      for (const key of entry.cardWaits.keys()) if (key.startsWith(`${ev.path}\n`)) entry.cardWaits.delete(key)
      schedulePersist(root, entry.records)
      if (id !== undefined) void restoreFolderId(root, ev.path, id)
      return
    }
    case 'unlinkDir': {
      entry.answers.clear()
      const prefix = ev.path + path.sep
      for (const p of entry.records.keys()) if (p.startsWith(prefix)) entry.records.delete(p)
      for (const p of entry.waits.keys()) if (p.startsWith(prefix)) entry.waits.delete(p)
      for (const key of entry.cardWaits.keys()) if (key.startsWith(prefix)) entry.cardWaits.delete(key)
      // The windows read the index again for a folder that went (`useIndex`): its boards go with it, with no word.
      for (const p of entry.boards.keys()) if (p.startsWith(prefix)) entry.boards.delete(p)
      entry.dirs = entry.dirs.filter((dir) => dir !== ev.path && !dir.startsWith(prefix))
      schedulePersist(root, entry.records)
      return
    }
    default:
      return
  }
}

/** A board's ID off its head (YAZ-3943 4C): only the first 1 KB is read. Undefined for none, and for a file that is gone. `was`: its `formerIds` (YAZ-4071 7I). */
type BoardIds = { id: string | undefined; was: string[] }
const boardIdAt = (file: string): Promise<BoardIds> =>
  readBoardHead(file).then(
    (head) => ({ id: boardIdOf(head?.block), was: formerBoardIdsOf(head?.block) }),
    () => ({ id: undefined, was: [] }),
  )

/** Takes the IDs a board held before (YAZ-4071 7I); true when one is new to the index. */
function learnFormer(entry: Entry, { id, was }: BoardIds): boolean {
  let learned = false
  if (id !== undefined)
    for (const w of was.map(canonicalNoteId)) {
      if (entry.formerIds.get(w) === id) continue
      entry.formerIds.set(w, id)
      learned = true
    }
  return learned
}

/** The IDs of `boards`, in order, with at most SCAN_CONCURRENCY heads open (YAZ-4074 6A item 19: all at once hit EMFILE, read as "no ID"). */
async function boardIdsAt(boards: readonly string[]): Promise<BoardIds[]> {
  const ids: BoardIds[] = []
  let next = 0
  const worker = async () => {
    while (next < boards.length) {
      const i = next++
      ids[i] = await boardIdAt(boards[i]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(SCAN_CONCURRENCY, boards.length) }, worker))
  return ids
}

/** The board at `file` as its head says now; the windows hear of a change of its ID (`onBoardIds`). */
async function readBoard(root: string, entry: Entry, file: string): Promise<void> {
  const ids = await boardIdAt(file)
  const { id } = ids
  if (!learnFormer(entry, ids) && entry.boards.get(file) === id) return
  if (id === undefined) entry.boards.delete(file)
  else entry.boards.set(file, id)
  boardsChanged?.(root)
}

/**
 * Hears that the boards with an ID changed in the vault at `root` (YAZ-3943 4C): a board took one, or one with an ID came,
 * went or moved. A board is no note, so the windows do not read the index again for its events: the bridge tells them.
 */
let boardsChanged: ((root: string) => void) | undefined

/** One listener, set by the bridge at startup. */
export function onBoardIds(listener: ((root: string) => void) | undefined): void {
  boardsChanged = listener
}

/**
 * TWO BOARDS WITH ONE ID (YAZ-4129 6B3): a Finder copy of a board keeps the board's ID. The board that keeps it is the one
 * with the oldest `createdAt`; between equal ones (a copy has its original's block), the one the index knew first: at a
 * cold start, the first in path order, as for notes (`idSweep.ts`). The other one gets a new ID on its next save
 * (`fs/drawing.ts`), never on an open (4C). Only boards that share an ID cost a head read here.
 */
async function boardKeepers(entry: Entry): Promise<Map<string, string>> {
  const holders = new Map<string, string[]>()
  for (const [p, id] of entry.boards) {
    const paths = holders.get(id)
    if (paths === undefined) holders.set(id, [p])
    else paths.push(p)
  }
  const keepers = new Map<string, string>()
  for (const [id, paths] of holders) keepers.set(id, paths.length === 1 ? paths[0]! : await oldestBoard(paths))
  return keepers
}

/** Of `paths` in the order the index knew them, the board with the oldest `createdAt`; the first one when they are equal. */
async function oldestBoard(paths: readonly string[]): Promise<string> {
  const born = await Promise.all(paths.map((p) => readBoardHead(p).then((head) => (isRecord(head?.block) && isFiniteNumber(head.block.createdAt) ? head.block.createdAt : Infinity), () => Infinity)))
  let best = 0
  for (let i = 1; i < paths.length; i++) if (born[i]! < born[best]!) best = i
  return paths[best]!
}

/** The board of the live index at `root` that keeps `id` (YAZ-4129 6B3), or undefined when no index of `root` knows it. */
export async function boardIdKeeper(root: string, id: string): Promise<string | undefined> {
  const entry = entries.get(root)
  if (entry === undefined) return undefined
  const paths = [...entry.boards].flatMap(([p, held]) => (held === id ? [p] : []))
  return paths.length <= 1 ? paths[0] : oldestBoard(paths)
}

/** The ID a save just gave the board at `file` (YAZ-3943 4C), taken by each live index AT ONCE: the watcher's echo comes later. */
export function indexBoard(file: string, id: string): void {
  for (const [root, entry] of entries) {
    if (!inside(root, file) || entry.boards.get(file) === id) continue
    entry.boards.set(file, id)
    boardsChanged?.(root)
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
function sweep(
  root: string,
  entry: Entry,
  among: readonly IndexRecord[],
  knew: (path: string) => string | undefined,
  dirs: readonly string[] = [],
  over: readonly string[] = [],
  cardOver?: ReadonlySet<string>,
): Promise<void> {
  return sweepIds(root, entry.records, among, knew, dirs, { waits: entry.waits, indexed: () => Promise.all([...entry.inFlight]), cardWaits: entry.cardWaits, ...(cardOver !== undefined && { cardOver }) }).then((result) => {
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
  if (entry.wait !== undefined || (entry.waits.size === 0 && entry.cardWaits.size === 0) || entries.get(root) !== entry) return
  let first = Infinity
  for (const since of entry.waits.values()) first = Math.min(first, since + ID_WAIT_MS)
  for (const since of entry.cardWaits.values()) first = Math.min(first, since + CARD_MOVE_WAIT_MS)
  entry.wait = setTimeout(() => {
    entry.wait = undefined
    const due = [...entry.waits].filter(([, since]) => Date.now() - since >= ID_WAIT_MS).map(([file]) => file)
    // A card ID on two pages whose wait is over (YAZ-4960): out of the map before the pass, so it never fires again for one key.
    const cardOver = new Set([...entry.cardWaits].filter(([, since]) => Date.now() - since >= CARD_MOVE_WAIT_MS).map(([key]) => key))
    for (const key of cardOver) entry.cardWaits.delete(key)
    const files = new Set([...due, ...[...cardOver].map((key) => key.slice(0, key.indexOf('\n')))])
    const among = [...files].flatMap((file) => entry.records.get(file) ?? [])
    const dirs = due.filter((file) => isFolderSettingsPath(file) && !entry.records.has(file)).map((file) => path.dirname(file))
    void sweep(root, entry, among, (p) => entry.records.get(p)?.id, dirs, due, cardOver)
  }, Math.max(0, first - Date.now()))
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
  const groups = idGroups(records.values())
  // The box offers to keep them (YAZ-4922 🔒 D2) when some group is not an ID of the vault yet: then a folder whose settings file holds a number ID keeps it too.
  const keeps = groups.some((group) => vaultNoteId(numberId(group.letters, 1), letters) === undefined)
  return {
    notes: notes.length,
    folders: dirs.filter((dir) => {
      const id = records.get(path.join(dir, FOLDER_SETTINGS_FILE))?.id
      return vaultNoteId(id, letters) === undefined && !(keeps && isNumberId(id))
    }).length,
    foreign: notes.filter((r) => r.properties[NOTE_ID_KEY] !== undefined).length,
    ...(keeps && { groups, bare: notes.filter((r) => r.id === undefined).length }),
  }
}

/** The number IDs `records` hold, by their letters as written (YAZ-4922 D2): the biggest group first, then by letters. */
function idGroups(records: Iterable<IndexRecord>): IdGroup[] {
  const counts = new Map<string, number>()
  for (const { id } of records) if (isNumberId(id)) counts.set(id.slice(0, id.indexOf('-')), (counts.get(id.slice(0, id.indexOf('-'))) ?? 0) + 1)
  return [...counts].map(([letters, count]) => ({ letters, count })).sort((a, b) => b.count - a.count || (a.letters < b.letters ? -1 : 1))
}

/**
 * The records and folders of `entry` whose IDs are the vault's own (YAZ-4922 🔒 D1): a vault inside it keeps its
 * notes' IDs, so a yes of this vault would write nothing there. For what the index shows; the reads are kept in `answers`.
 */
async function ownPart(root: string, entry: Entry): Promise<{ records: Map<string, IndexRecord>; dirs: string[] }> {
  const mine = idsOwnedBy(root, entry.answers)
  const records = await ownOnly([...entry.records], ([p]) => mine(p))
  return { records: new Map(records), dirs: await ownOnly(entry.dirs, (dir) => mine(path.join(dir, FOLDER_SETTINGS_FILE))) }
}

async function build(root: string): Promise<Entry> {
  const dirs: string[] = []
  const entry: Entry = { records: new Map(), unsubscribe: () => undefined, inFlight: new Set(), dirs, ids: false, waits: new Map(), cardWaits: new Map(), kept: new Map(), boards: new Map(), formerIds: new Map(), answers: new Map() }
  const files: string[] = []
  const boards: string[] = []
  // Persistent cache (GRO-2223): loaded BEFORE subscribing, overlapped with the walk — the cache
  // lives in userData, never the vault, so the watcher ordering below does not apply to it, and
  // reading it early keeps the multi-MB read ahead of the watcher's initial walk that floods the
  // fs threadpool on subscribe.
  const [cached] = await Promise.all([loadIndexCache(root), fsCall(root, () => walk(root, files, dirs, boards))])
  // A corrupt cache is an anomaly worth one line (vaultConfig idiom); `miss` and
  // `version-mismatch` are expected states (first open / semantics bump) and stay silent.
  if (cached.status === 'corrupt') console.warn(`[index-cache] cache for ${root} is corrupt; ignoring it and rescanning`)
  // Subscribe before reading so a write that lands mid-scan is re-scanned rather than lost.
  entry.unsubscribe = subscribe(root, (ev) => onEvent(root, entry, ev))
  try {
    // Reuse records the D2 stat sweep validates, rescan the rest. Any cache failure comes back
    // as a non-hit load and reconcile degrades to today's full scan.
    // In path order: between two boards with one ID and one `createdAt`, the first one keeps it (6B3).
    boards.sort()
    const [{ records, diff }, ids] = await Promise.all([reconcile(root, files, cached), boardIdsAt(boards)])
    boards.forEach((file, i) => {
      if (ids[i]!.id !== undefined) entry.boards.set(file, ids[i]!.id!)
      learnFormer(entry, ids[i]!)
    })
    entry.records = records
    entry.coldDiff = diff
    const { letters, ...held } = await vaultIds(root)
    let answer = held.answer
    const own = await ownPart(root, entry)
    // A vault that already uses IDs carries over with no question (YAZ-2523 🔒 V11): some note holds
    // an id and a yes would write nothing, so yes is saved. One that cannot be written to stays
    // unanswered, and so does one whose `ids.json` is not valid JSON: it is not written over. Each
    // other key of the file stays (YAZ-2677 R10), and an answer that arrived meanwhile stands.
    const ask = wouldWrite(own.records, own.dirs, letters)
    if (answer === undefined && ask.notes === 0 && ask.folders === 0 && [...own.records.values()].some((r) => !isFolderSettingsPath(r.path) && vaultNoteId(r.id, letters) !== undefined)) {
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
  entry.cardWaits.clear()
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
  if (!ids) {
    const own = await ownPart(root, entry)
    return { root, records, folders, generatedAt: Date.now(), ids, ask: { ...wouldWrite(own.records, own.dirs, letters), ...(saved && { letters: letters[0] }) } }
  }
  // A board's ID goes out as a note's does (R5): with the current letters, and not at all when it is another vault's.
  // An ID two boards hold goes out for its keeper alone (YAZ-4129 6B3), so `[[ID]]` opens that board.
  // The IDs it held before a two-Mac merge go out with it (YAZ-4071 7I): a link to one still opens it.
  const keepers = await boardKeepers(entry)
  const boards = [...entry.boards]
    .flatMap(([p, held]) => {
      const id = vaultNoteId(held, letters)
      if (id === undefined || keepers.get(held) !== p) return []
      const was = [...new Set([...entry.formerIds].flatMap(([w, now]) => (now === held ? (vaultNoteId(w, letters) ?? []) : [])))].sort()
      return [{ path: p, id, ...(was.length > 0 && { was }) }]
    })
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return { root, records, folders, generatedAt: Date.now(), ids, letters, boards, ...((await planLeft(root)) && { unfinished: true as const }) }
}

/** `p` is under `root` (a vault is never its own record). */
const inside = (root: string, p: string): boolean => p.startsWith(root + path.sep)

/**
 * An in-app move (`fs:rename`, and the `moveEntry` of a paste and an import), taken by each live
 * index AT ONCE (YAZ-3258): the next `getIndex` holds the new paths, so the next move of a gesture
 * and a quick ⌘Z read them (S3, S33). The watcher's echo comes later (0.3–4 s on NFS,
 * docs/DEVELOPMENT.md) and scans the same files again, which changes nothing; only the echo runs the
 * ID sweep and the diary, and keeps the list of folders, as for any add.
 * A note is scanned at its new path: a rename can change its name, and so its title. A folder's notes
 * keep their records with the new path and folder, as a move changes no byte of them; a folder's
 * settings file is scanned, because the folder's name is its title. A folder that comes from outside
 * every live index is walked. Never throws.
 */
export async function indexMoved(oldPath: string, newPath: string, kind: 'file' | 'dir'): Promise<void> {
  const live = [...entries].filter(([root]) => inside(root, oldPath) || inside(root, newPath))
  // A scan the watcher started lands first, so it cannot put back a path this takes away.
  await Promise.all(live.map(([, entry]) => Promise.all([...entry.inFlight])))
  const moved = new Map<string, IndexRecord>()
  // A board keeps its ID in a move (YAZ-3943 4C): the bytes are the same. One from outside every live index is read by the echo.
  const boards = new Map<string, string>()
  for (const [, entry] of live) {
    for (const [p, r] of entry.records) {
      if (p !== oldPath && !p.startsWith(oldPath + path.sep)) continue
      moved.set(p, r)
      entry.records.delete(p)
    }
    for (const [p, id] of entry.boards) {
      if (p !== oldPath && !p.startsWith(oldPath + path.sep)) continue
      boards.set(p, id)
      entry.boards.delete(p)
    }
  }
  for (const [root, entry] of live) {
    if (boards.size > 0) {
      if (inside(root, newPath)) for (const [p, id] of boards) entry.boards.set(newPath + p.slice(oldPath.length), id)
      boardsChanged?.(root)
    }
    if (inside(root, newPath)) {
      const scan = (p: string): Promise<void> => scanFile(root, p).then((r) => void entry.records.set(p, r), () => undefined)
      if (kind === 'file') {
        if (isMarkdown(newPath)) await scan(newPath)
      } else if (moved.size === 0) {
        const files: string[] = []
        await walk(newPath, files).catch(() => undefined)
        await Promise.all(files.map(scan))
      } else {
        for (const [p, r] of moved) {
          const to = newPath + p.slice(oldPath.length)
          if (r.name === FOLDER_SETTINGS_FILE) await scan(to)
          else entry.records.set(to, { ...r, path: to, folder: path.relative(root, path.dirname(to)).split(path.sep).join('/') })
        }
      }
    }
    schedulePersist(root, entry.records)
  }
}

/**
 * A tidy-up write the app made itself (`FileWriteRequest.quiet`: a link rewrite, a folder's values),
 * taken by each live index AT ONCE, as a move is (`indexMoved`): a quick ⌘Z finds the note whose link
 * the move rewrote (S33). An edit the user made waits for the watcher: its echo tells the ID sweep the
 * ID the note held before the edit (YAZ-2293 D4), and a scan here would hide it. Never throws.
 */
export async function indexWrote(p: string): Promise<void> {
  if (!isMarkdown(p)) return
  for (const [root, entry] of entries) {
    if (!inside(root, p)) continue
    await Promise.all([...entry.inFlight])
    await scanFile(root, p).then((r) => void entry.records.set(p, r), () => undefined)
    schedulePersist(root, entry.records)
  }
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
// A vault inside this one counts above this one's notes (YAZ-4922 D1, gap 3): only an index already held is asked.
seenFrom((root, letters) => {
  const entry = entries.get(root)
  return entry === undefined ? undefined : highestNumber(entry.records.values(), letters)
})

/**
 * A record as a vault that does not use IDs hands it out (YAZ-2523 🔒 V12): no id, its file name as its title. `id` and `title` stay among its properties.
 * No note cards either (YAZ-4946 D8: only a vault that gives IDs has cards): a ```` ```card ```` block there is a code block.
 */
function plain({ id: _id, cards: _cards, ...r }: IndexRecord): IndexRecord {
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
export async function saveIdsAnswer(root: unknown, enabled: unknown, letters?: unknown): Promise<boolean> {
  const r = requireAbsPath(root, 'root')
  if (typeof enabled !== 'boolean') throw new BridgeFailure('BAD_REQUEST', "'enabled' must be true or false")
  if (letters !== undefined && (typeof letters !== 'string' || !isIdLetters(letters))) throw new BridgeFailure('BAD_REQUEST', "'letters' must be 2 to 5 letters")
  // A yes with letters keeps the IDs the notes already hold (YAZ-4922 🔒 D2): their groups, counted where it is asked.
  const groups = enabled && letters !== undefined ? idGroups((await ownPart(r, await liveEntry(r))).records.values()) : []
  let moved = false
  await saveIds(r, (config) => {
    if (letters === undefined || !enabled) return { ...config, enabled, ...(letters !== undefined && { letters: letters.toUpperCase() }) }
    const next = keepGroups(config, path.basename(r), groups, letters.toUpperCase())
    moved = next.moved
    return { ...config, enabled, ...next.config }
  })
  return moved
}

/**
 * GIVE IDS, KEEPING THE IDS THAT ARE THERE (YAZ-4922 🔒 D2, gap 1): the keys of `ids.json` for a yes with the letters
 * `to`, where the notes hold number IDs in `groups` (`idGroups`, the biggest first). Where no group is new to the
 * vault, only `letters` changes: the box as it always was.
 *  - `to` are the letters of a group: that group is the vault's, as it is. 0 notes change.
 *  - Other letters: the biggest group MOVES to them (`moved`): its letters go into `was`, and "Change letters"
 *    (`reletter`) then moves its numbers, links and file names. The number of each note stays.
 *  - Each other group is KEPT (`kept`, `KEPT_MARK`): its IDs stay as they are, and none gets a fresh number.
 * A note with no ID is the only one the sweep gives a number.
 */
function keepGroups(config: Record<string, unknown>, vaultName: string, groups: readonly IdGroup[], to: string): { config: Record<string, unknown>; moved: boolean } {
  const held = idLettersOf(config, vaultName).letters
  const fresh = groups.filter((group) => vaultNoteId(numberId(group.letters, 1), held) === undefined)
  if (fresh.length === 0) return { config: { letters: to }, moved: false }
  const main = groups.some((group) => group.letters === to) ? to : groups[0].letters
  const moved = main !== to
  const was = [...new Set([...(Array.isArray(config.was) ? config.was.filter((entry): entry is string => isIdLetters(entry)).map((entry) => entry.toUpperCase()) : []), ...(moved ? [main] : [])])].filter((entry) => entry !== to)
  const kept = [...new Set([...(Array.isArray(config.kept) ? config.kept.filter((entry): entry is string => isIdLetters(entry)).map((entry) => entry.toUpperCase()) : []), ...groups.map((group) => group.letters)])].filter((entry) => entry !== main && entry !== to && !was.includes(entry))
  return { config: { letters: to, ...(was.length > 0 && { was }), ...(kept.length > 0 && { kept }) }, moved }
}

/**
 * "Give IDs" from the box in Settings (YAZ-2677 R32, S64; YAZ-4922 🔒 D2): the answer and the letters are saved,
 * keeping the IDs the notes hold (`keepGroups`). Where the biggest group takes other letters, its numbers, links and
 * file names follow first (`changeLetters` with the letters the vault has now). Then every note with no ID is given
 * its number on this Mac (`giveIdsNow`). `renamed` hears each file that took a new name, as "Change letters" does.
 */
export async function turnIdsOn(root: string, letters: string, renamed?: Renamed): Promise<void> {
  if (await saveIdsAnswer(root, true, letters)) await changeLetters(root, letters, renamed).catch(() => undefined)
  await giveIdsNow(root)
}

/**
 * A change of `ids.json` by the app (`changeIds`, the ONE write of that file), written as the app writes a vault's config: each window of the vault hears of it at once.
 * A folder that answers now is a vault inside each vault around it (YAZ-4922 D1): what their indexes show is read again.
 */
const saveIds = (r: string, change: (config: Record<string, unknown>) => Record<string, unknown> | undefined): Promise<void> =>
  changeIds(r, change, async (config) => {
    await writeConfig(r, IDS_FILE, config)
    for (const entry of entries.values()) entry.answers.clear()
  })

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
  return idsStateOf((await ownPart(root, entry)).records.values(), (await vaultIds(root)).letters, await planLeft(root))
}

/** What the rows "ID letters" and "Old IDs" of Settings show (YAZ-2677 🔒 D5, D6, `IdsState`): of the vault's own notes, none of a vault inside it (YAZ-4922 D1). */
export async function idsState(root: unknown): Promise<IdsState> {
  const { r, entry, letters } = await idsVault(root)
  return idsStateOf((await ownPart(r, entry)).records.values(), letters, await planLeft(r))
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
  if (isKept(held, to)) throw new BridgeFailure('BAD_REQUEST', `${to} are the letters of a group this vault keeps as it is`)
  // A vault with no letters in its file saves them here, and keeps its default in `was` (R11): a note that carries the default follows.
  if (to !== held[0] || !saved) await saveIds(r, (config) => configWithLetters(config, held, to))
  // The boards' IDs come from the index (their heads), the vault's own only (D1); the notes' are read off the disk by the pass itself.
  const mine = idsOwnedBy(r, entry.answers)
  const boards = (await ownOnly([...entry.boards], ([p]) => mine(p))).map(([, id]) => id)
  return stateAfter(r, entry, await reletter(r, (await vaultIds(r)).letters, renamed, boards))
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
