import { stat } from 'node:fs/promises'
import path from 'node:path'
import { cardIdOf, pageCards, rewritePageCards, settleCardCopy, withCardId, type CardLine } from '@shared/cardLine'
import { moveFolderValues } from '@shared/folderValues'
import { parseFrontmatter, setFrontmatterProperty, splitFrontmatter } from '@shared/frontmatter'
import { NOTE_ID_KEY, noteIdNumber, vaultNoteId } from '@shared/noteId'
import { FOLDER_SETTINGS_FILE, MAX_FILE_BYTES, isFolderSettingsPath, type IndexRecord } from '@shared/types'
import { readFile, writeFile } from '../fs/file'
import { BridgeFailure, createDurable } from '../fs/fsUtils'
import { myNote, settleClash, type ClashFix, type Pair } from './clash'
import { openDiary, saveDiarySoon } from './diary'
import { countsOf, firstMac, highestNumber, makersOf, mintIds, vaultIds, type Counts } from './mint'
import { idsOwnedBy, ownOnly, walk } from './scan'

/**
 * One sweep write at a time. One pass runs at a time for a vault, and an index event joins a pass
 * that waits (`sweepIds`). But a folder's carry (`carryNote`) writes notes too, and the app's own
 * copy calls it outside any pass, for any vault: without this queue, two compare-and-sets could
 * meet on one file, and the loser would be a copy left holding its original's id, or its values.
 */
let turn: Promise<unknown> = Promise.resolve()
function inTurn<T>(write: () => Promise<T>): Promise<T> {
  const mine = turn.then(write)
  turn = mine.catch(() => undefined)
  return mine
}

/** A Mac that is not the vault's first waits this long before the sweep gives a number there (YAZ-2677 🔒 D8, R31). */
export const ID_WAIT_MS = 10 * 60 * 1000

export interface SweepOptions {
  /**
   * WHERE A MAC THAT IS NOT FIRST WAITS (YAZ-2677 R31): each file this Mac leaves for the vault's
   * first Mac, with the time it first left it. A file that still needs its number `ID_WAIT_MS`
   * later is given it. The live index holds one for each open vault, and one timer (R34).
   * With NO map the caller is the user (R32): every number comes at once, on this Mac.
   */
  waits?: Map<string, number>
  /**
   * Resolves when the index has read every file its watcher already reported. A clash is settled
   * only after it: the notes and links that arrived in one sync with the second note are then in
   * the index and in the diary, so the notice can list each link it leaves (S44, S45).
   */
  indexed?: () => Promise<unknown>
  /**
   * WHERE A CARD ID ON TWO PAGES WAITS (YAZ-4960): each page that took a card ID another page still holds, keyed
   * `<path>\n<id>`, with the time the sweep first saw it. A cut from one page and a paste into another hold the ID on
   * both for a moment; only after `CARD_MOVE_WAIT_MS` is the second page's card a copy. With NO map the caller is
   * the user: a copy is settled at once.
   */
  cardWaits?: Map<string, number>
  /** The keys of `cardWaits` whose wait is over (the live index's timer took them out of the map): settled in this pass. */
  cardOver?: ReadonlySet<string>
}

/** How long one card ID on two pages waits before the newer page's card counts as a copy (YAZ-4960): a cut and paste is done by then. */
export const CARD_MOVE_WAIT_MS = 60 * 1000

/**
 * One note card the sweep gives a new number: its place among its page's cards, the ID it must still hold (null: none),
 * and whether its history stays. A COPY names the card that keeps its ID: `copyOf`, the first card of the page that
 * holds it, or `keeper`, the page that keeps it (one ID on two pages after the wait). A copy with that card's text
 * gives its reviews to it, then empties its own history; a copy with another text keeps its history (YAZ-4993: the
 * sweep never drops a review).
 */
export interface CardFix {
  index: number
  held: string | null
  history: boolean
  copyOf?: number
  keeper?: string
}

/** What one sweep did about notes that share an ID. A note that only needed an ID is not reported. */
export interface SweepResult {
  /** Each note this Mac gave a new number in a clash (S45). */
  fixes: ClashFix[]
  /** Each ID two notes hold that ANOTHER Mac must fix (S57): this one wrote nothing. `other` is the note that will change, when known. */
  theirs: { id: string; other?: string }[]
  /** Each copy that was given its own number (R30). */
  copies: { title: string; id: string }[]
  /** Each ID two notes still hold because a file changed under this pass: the next one settles it. */
  later: string[]
  /** For each clash that still stands after this pass: the ID, and the path of the note that keeps it, when this Mac knows it (S46). */
  kept: Map<string, string>
}

/** One file the sweep means to give a number. */
interface Wanted {
  file: string
  /** The id it must still hold when it is written: undefined for none (or another tool's). */
  held: string | undefined
  /** Its record, when the index holds one: a folder with no settings file has none. */
  record?: IndexRecord
  /** A copy this Mac must renumber at once, whichever Mac is first (`ClashOutcome` `copy`). */
  now?: boolean
}

/**
 * Does a number the sweep gives WAIT on this Mac (R31, R33)? Not on the vault's first Mac. On every
 * other, and on each Mac of a vault that has no count file yet: there no Mac is first, and a Mac
 * that took "no count file" for "I am first" would number every note at the moment a yes arrives
 * by the sync ahead of the first Mac's count file (S65) — two numbers in each file.
 */
const sweepWaits = ({ me, files }: Counts): boolean => firstMac(files) !== me

type Knew = (path: string) => string | undefined

/** One pass of the sweep over a vault: what one index event asked for, and what each event that arrived while it waited added. */
interface Pass {
  records: ReadonlyMap<string, IndexRecord>
  among: IndexRecord[]
  /** `knew` of each event in the pass, with the paths that event swept: a path is asked of the first event that swept it, else of the first event. */
  knews: { paths: ReadonlySet<string>; knew: Knew }[]
  dirs: string[]
  opts: SweepOptions
  result: SweepResult
}

/** One sweep at a time for a vault: the end of its queue, and the pass in it that has not started yet. */
const queues = new Map<string, { tail: Promise<unknown>; waiting?: Pass }>()

/** Test hook: resolves when every sweep of `root` that was started has ended. */
export async function _swept(root: string): Promise<void> {
  for (let queue = queues.get(root); queue !== undefined; queue = queues.get(root)) await queue.tail
}

const noResult = (): SweepResult => ({ fixes: [], theirs: [], copies: [], later: [], kept: new Map() })

/**
 * Files a sweep could not write, with the time they had: no number is taken for one again until it
 * changes. Without this an unwritable note would cost one number on every pass. Only while the app runs.
 */
const refused = new Map<string, number | undefined>()
const REFUSED_MAX = 1000

/** Files read at one time while a pass checks what still needs a number. */
const READS = 16

/**
 * The id sweep (YAZ-2293 D3, D4). Each note in `among` with no id is given one, and an `id` that
 * is not an ID of THIS vault is none: the app's is written over it (YAZ-2420 🔒 D30, YAZ-2677 R7 —
 * another tool's `id`, and a number ID whose letters the vault never had). Each folder in `dirs`
 * (never the vault root) with no `.folder.md` is given one holding only its id (D13).
 *
 * TWO NOTES, ONE ID (YAZ-2677 🔒 D7). The notes on disk that share an id with a note in `among` are
 * either a CLASH — two Macs each gave that number, by their count files (R22) — and then the clash
 * rule decides (`clash.ts`): one Mac fixes its own note, and every other writes nothing. Or they
 * are a COPY (R30, YAZ-2293 D4): only the KEEPER keeps the id — the one the index knew to hold it
 * (`knew`), else the first in path order — and any other in `among` is given a fresh one. A folder's
 * settings file given a fresh id is a COPIED folder's: the notes under it carry their values for it
 * to that id first (`carryFolderValues`), then the folder takes it.
 *
 * WHICH MAC GIVES A NUMBER (🔒 D8, R31 to R33). A number the sweep gives — to a note with no id, to
 * a copy, to a folder's settings file — comes at once only on the vault's FIRST Mac (`firstMac`).
 * Any other Mac leaves the file, notes when in `opts.waits`, and gives the number `ID_WAIT_MS`
 * later if the file still needs one: two Macs must not write two numbers into one file. A vault
 * with no count file has no first Mac yet, and every Mac waits. A clash fix never waits: the rule
 * already names its one Mac.
 *
 * 🔒 Only in a vault that said yes (`givesIds`, YAZ-2523 V1): the app writes nothing into any other.
 *
 * 🔒 Each fresh id is the vault's next NUMBER, from the door (YAZ-2677 D4, `mint.ts`), and one pass
 * takes all its numbers with ONE write of the count file (R19). A number is taken only for a file
 * whose BYTES still need one: sweeps of one vault run one at a time, and each reads a file before
 * it counts it, so a file two index events both name takes one number. A note the index could not
 * read is not counted, so a note that can never take an id costs no number on each pass. An OLD
 * id is an id like any other here: it is kept, and never written over (R3).
 *
 * 🔒 ONE PASS AT A TIME FOR A VAULT, and a sync that brings many files is few passes: an index event
 * that arrives while a pass of the index waits its turn joins that pass (same index, same `waits`),
 * so everything that arrived meanwhile is numbered with one write of the count file. The joined
 * event resolves to an empty result: what the pass did is reported one time, to the event that
 * started it. A pass the user asked for (no `waits`) is never joined.
 *
 * Safe to run any number of times and never throws: each write is a compare-and-set against the
 * file's bytes and mtime, a settings file is created only where there is none, and a file that
 * cannot take an id or changed under the sweep is left for its next index event.
 */
export function sweepIds(
  root: string,
  records: ReadonlyMap<string, IndexRecord>,
  among: readonly IndexRecord[],
  knew: Knew,
  dirs: readonly string[] = [],
  opts: SweepOptions = {},
): Promise<SweepResult> {
  if (among.length === 0 && dirs.length === 0) return Promise.resolve(noResult())
  let queue = queues.get(root)
  if (queue === undefined) queues.set(root, (queue = { tail: Promise.resolve() }))
  const held = queue
  const asked = { paths: new Set(among.map((r) => r.path)), knew }
  const waiting = held.waiting
  if (waiting !== undefined && opts.waits !== undefined && opts.cardOver === undefined && waiting.opts.waits === opts.waits && waiting.records === records) {
    waiting.among.push(...among)
    waiting.dirs.push(...dirs)
    waiting.knews.push(asked)
    return held.tail.then(noResult)
  }
  const pass: Pass = { records, among: [...among], knews: [asked], dirs: [...dirs], opts, result: noResult() }
  const mine = held.tail.then(() => {
    // From here on the pass reads its lists: an event that arrives now starts the next pass.
    if (held.waiting === pass) held.waiting = undefined
    return sweep(root, pass).catch(() => undefined)
  })
  held.waiting = pass
  held.tail = mine
  void mine.then(() => {
    if (held.tail === mine && queues.get(root) === held) queues.delete(root)
  })
  return mine.then(() => pass.result)
}

async function sweep(root: string, { records, among: events, knews, dirs: asked, opts: { waits, indexed, cardWaits, cardOver }, result }: Pass): Promise<void> {
  const { answer, letters } = await vaultIds(root)
  if (answer !== true) return
  const now = Date.now()
  /**
   * ONE VAULT PER NOTE (YAZ-4922 🔒 D1): a note under a folder that answers for itself — a vault inside this one —
   * is that vault's. This pass gives it nothing, changes nothing of it and settles nothing with it, nor with a
   * folder there; the vault still lists it.
   */
  const mine = idsOwnedBy(root)
  const dirs = await ownOnly([...new Set(asked)], (dir) => mine(path.join(dir, FOLDER_SETTINGS_FILE)))
  /** The id the index held for `path` before the event that swept it. */
  const knew: Knew = (path) => (knews.find((k) => k.paths.has(path)) ?? knews[0]).knew(path)
  /** `id` as an ID of this vault (R5): the letters it had before read as the current ones, any other letters as none. */
  const own = (id: string | undefined): string | undefined => vaultNoteId(id, letters)
  // This sweep waited for the ones before it: what the index holds for a path NOW is what is swept.
  const among = await ownOnly([...new Map(events.map((r) => [r.path, records.get(r.path) ?? r])).values()], (r) => mine(r.path))
  /** A note the index could not read (its YAML is invalid, or it is over the size limit) takes no id. */
  const takes = (r: IndexRecord): boolean => r.frontmatterError === undefined && r.size <= MAX_FILE_BYTES
  /**
   * The sweep's one write of an id: `file` takes `to` while it still holds `held` (`giveId`). False
   * when it took none: it changed under the sweep, or cannot be written — and one that cannot be
   * written is remembered (`refused`), so the next pass takes no number for it.
   */
  const give = (file: string, held: string | undefined, to: string, first?: (id: string) => Promise<void>): Promise<boolean> => {
    const write = (): Promise<string | undefined> => giveId(file, held, letters, () => to, first)
    // A folder's carry takes the write turn itself, once for each note it writes.
    return (first === undefined ? inTurn(write) : write()).then(
      (id) => id !== undefined,
      async (err: unknown) => {
        if (err instanceof BridgeFailure && err.code === 'CONFLICT') return false
        if (refused.size >= REFUSED_MAX) refused.clear()
        refused.set(file, (await stat(file).catch(() => null))?.mtimeMs)
        return false
      },
    )
  }
  /** Do the BYTES of `file` still hold `held` (undefined: no id of this vault), and was it not refused as it is now? Only then is a number taken for it. */
  const needs = (file: string, held: string | undefined): Promise<boolean> =>
    readPage(file).then(
      ({ content, mtime }) => idHeld(content, letters) === held && !(refused.has(file) && refused.get(file) === mtime),
      () => false,
    )
  // Every indexed holder of an id some note in `among` holds. With no letters of before, two
  // records hold one id exactly when their `id` is one string: nothing is parsed for the others.
  const groups = new Map<string, IndexRecord[]>()
  const wanted: Wanted[] = []
  for (const r of among) {
    const id = own(r.id)
    if (id !== undefined) groups.set(id, [...(groups.get(id) ?? []), r])
    else if (takes(r)) wanted.push({ file: r.path, held: undefined, record: r })
  }
  if (groups.size > 0) {
    for (const r of records.values()) {
      const id = r.id === undefined || letters.length === 1 ? r.id : own(r.id)
      const group = id === undefined ? undefined : groups.get(id)
      if (group !== undefined && !group.some((o) => o.path === r.path)) group.push(r)
    }
    // A note of a vault inside this one that holds the same ID is no copy of this vault's note (D1).
    for (const [id, holders] of groups) if (holders.length > 1) groups.set(id, await ownOnly(holders, (r) => mine(r.path)))
  }
  let counts: Counts | undefined
  const countFiles = async (): Promise<Counts> => (counts ??= await countsOf(root))
  for (const [id, holders] of groups) {
    if (holders.length < 2) continue
    const swept = holders.filter((r) => among.includes(r))
    const sharing = await onDisk(holders, swept)
    if (sharing.length < 2) continue
    const pair: Pair = { root, letters, id, sharing, knew, records }
    // Two notes, one ID. The count files say whether two Macs each gave that number (R22): a clash.
    const held = await countFiles()
    const number = noteIdNumber(id)
    const makers = number === undefined ? [] : makersOf(held.files, number, now)
    if (makers.length >= 2) await indexed?.()
    const book = await openDiary(root, held, letters, now)
    let atOnce = false
    if (makers.length >= 2) {
      const outcome = await settleClash(pair, held, makers, book, now, { gives: () => givesIds(root), needs, give, carry: carryFolderValues })
      if (outcome.kind === 'fixed') result.fixes.push(...outcome.fixes)
      if (outcome.kind === 'theirs') result.theirs.push({ id, ...(outcome.other !== undefined && { other: outcome.other }) })
      if (outcome.kind === 'later') result.later.push(id)
      if ((outcome.kind === 'later' || outcome.kind === 'theirs') && outcome.keeper !== undefined) result.kept.set(id, outcome.keeper)
      atOnce = outcome.kind === 'copy'
    }
    // A copy (R30): the note the index knew first keeps the id — said at the first sight of the pair
    // and kept in the diary (`myNote`), for the index holds both from then on — else the first in
    // path order, the same on every Mac. Each other note of this sweep gets its own.
    const keeper = makers.length >= 2 && !atOnce ? undefined : (myNote(book, pair, now) ?? sharing.find((o) => own(knew(o.path)) === id) ?? sharing[0])
    if (book.dirty) saveDiarySoon(root)
    if (keeper === undefined) continue
    for (const r of swept) if (r.path !== keeper.path && sharing.includes(r) && takes(r)) wanted.push({ file: r.path, held: id, record: r, ...(atOnce && { now: true }) })
  }
  // A settings file the index holds is a record like any note, swept above. One it does not hold
  // yet is read below: a folder that arrives WITH its file (a copy made in Finder) takes no number.
  for (const dir of dirs) {
    const file = path.join(dir, FOLDER_SETTINGS_FILE)
    if (!records.has(file)) wanted.push({ file, held: undefined })
  }
  // Only a file whose BYTES still need a number is counted: the index can be a moment behind.
  const needy: Wanted[] = []
  for (let i = 0; i < wanted.length; i += READS) {
    const batch = wanted.slice(i, i + READS)
    const needing = await Promise.all(batch.map(({ file, held }) => needs(file, held)))
    needy.push(...batch.filter((_, j) => needing[j]))
  }
  // The note cards of the pass that need a number (YAZ-4960); each write checks the bytes again.
  const cardWork = (await cardsToFix(records, among.filter(takes), own, mine, now, cardWaits, cardOver)).filter((w) => !(refused.has(w.record.path) && refused.get(w.record.path) === w.record.mtime))
  // R31: a Mac that is not first leaves each of them for the first Mac, for `ID_WAIT_MS` — a page whose cards need numbers too.
  let going = needy
  let cardsGoing = cardWork
  if (waits !== undefined) {
    const waiting = (needy.some((w) => w.now !== true) || cardWork.length > 0) && sweepWaits(await countFiles())
    const goes = (file: string): boolean => {
      if (!waiting) return true
      const since = waits.get(file)
      if (since === undefined) waits.set(file, now)
      return since !== undefined && now - since >= ID_WAIT_MS
    }
    going = needy.filter((w) => w.now === true || goes(w.file))
    cardsGoing = cardWork.filter((w) => goes(w.record.path))
    // Whatever this pass saw and does not leave waits no more: it has its number, or is given it now.
    const left = new Set([...needy.filter((w) => !going.includes(w)).map((w) => w.file), ...cardWork.filter((w) => !cardsGoing.includes(w)).map((w) => w.record.path)])
    for (const file of [...among.map((r) => r.path), ...dirs.map((dir) => path.join(dir, FOLDER_SETTINGS_FILE))]) if (!left.has(file)) waits.delete(file)
  }
  const cardCount = cardsGoing.reduce((n, w) => n + w.fixes.length, 0)
  if (going.length === 0 && cardCount === 0) return
  // The numbers of the whole pass — notes, folders and cards — saved with one write before any file is written (R18, R19).
  // Higher than each number in the vault, so none is an id some indexed note or card holds (YAZ-2378).
  const numbers = await mintIds(root, going.length + cardCount, highestNumber(records.values(), letters)).catch(() => null)
  if (numbers === null) return
  let next = going.length
  for (const { record, fixes } of cardsGoing) {
    if (!(await givesIds(root))) return
    const ids = numbers.slice(next, (next += fixes.length))
    const given = await inTurn(() => giveCardIds(record.path, fixes, ids)).catch(async (err: unknown): Promise<false> => {
      if (!(err instanceof BridgeFailure && err.code === 'CONFLICT')) {
        if (refused.size >= REFUSED_MAX) refused.clear()
        refused.set(record.path, (await stat(record.path).catch(() => null))?.mtimeMs)
      }
      return false
    })
    if (given !== false) given.forEach((fix, i) => fix.held !== null && !fix.history && result.copies.push({ title: `a note card on "${record.title}"`, id: ids[i] }))
  }
  for (const [i, { file, held, record }] of going.entries()) {
    // Asked before every write, so a no stops a pass that is running (YAZ-2523 🔒 V4).
    if (!(await givesIds(root))) return
    const to = numbers[i]
    // A copied folder takes its id LAST, after its notes hold their values under it: a carry cut
    // short (the app quit) leaves the folder still stale, so the next sweep finds and finishes it.
    const given = await give(file, held, to, held !== undefined && isFolderSettingsPath(file) ? (id) => carryFolderValues(path.dirname(file), held, id) : undefined)
    if (given && held !== undefined && record !== undefined) result.copies.push({ title: record.title, id: to })
    if (!given && held !== undefined) result.later.push(held)
    if (record !== undefined) for (const copy of carried) if (file.startsWith(copy.dir + path.sep)) await carryNote(file, copy.from, copy.to)
  }
}

/** A page whose note cards the sweep gives new numbers (YAZ-4960). */
interface CardWork {
  record: IndexRecord
  fixes: CardFix[]
}

/**
 * THE CARD RULES OF THE SWEEP (YAZ-4960 D2). For each card of the pages in `among`, in page order:
 * - no ID: the next number;
 * - an ID that is no ID of this vault (another vault's letters, `BUS-12` in a `WIKI` vault): a new number, history kept;
 * - an ID the first card before it on the same page holds: a COPY — a new number. With that card's text, it gives that
 *   card the reviews it lacks and its own history empties; with another text its history stays (YAZ-4993: no review is
 *   ever dropped; the sweep cannot tell the original of two texts, so both keep theirs. The editor settles a user's
 *   paste at paste time, YAZ-4972);
 * - an ID a note holds: a new number, history kept (links point at the note);
 * - an ID a card on ANOTHER page holds on disk: a cut and paste, or a copy. The page that took it last — the one this
 *   pass sweeps, or of two it sweeps the second in path order — waits `CARD_MOVE_WAIT_MS` (`cardWaits`), so a cut
 *   from the other page lands first. Still on both after the wait: a copy, settled once per ID in a pass, by the same
 *   text rule as on one page (`giveCardIds`): the keeper page takes the union first.
 */
async function cardsToFix(
  records: ReadonlyMap<string, IndexRecord>,
  among: readonly IndexRecord[],
  own: (id: string | undefined) => string | undefined,
  mine: (p: string) => Promise<boolean>,
  now: number,
  cardWaits: Map<string, number> | undefined,
  cardOver: ReadonlySet<string> | undefined,
): Promise<CardWork[]> {
  const pages = among.filter((r) => r.cards !== undefined && r.cards.length > 0 && !isFolderSettingsPath(r.path)).sort((a, b) => (a.path < b.path ? -1 : 1))
  if (pages.length === 0) return []
  const swept = new Set(pages.map((r) => r.path))
  // Who holds each ID, by the index: the notes, and the pages of the cards. Read once, and only for a pass with cards.
  const notes = new Set<string>()
  const holders = new Map<string, string[]>()
  for (const r of records.values()) {
    const id = own(r.id)
    if (id !== undefined && !isFolderSettingsPath(r.path)) notes.add(id)
    for (const card of r.cards ?? []) {
      const cardId = own(card.id ?? undefined)
      if (cardId !== undefined) holders.set(cardId, [...(holders.get(cardId) ?? []), r.path])
    }
  }
  /** Does the page at `p` hold a card with `id` on disk now? The index can be a moment behind (a cut just saved). */
  const holds = async (p: string, id: string): Promise<boolean> =>
    (await mine(p)) && (await readPage(p).then(({ content }) => pageCards(content).some((card) => own(cardIdOf(card.line) ?? undefined) === id), () => false))
  const settled = new Set<string>()
  const work: CardWork[] = []
  for (const record of pages) {
    const fixes: CardFix[] = []
    const seen = new Map<string, number>()
    for (const [index, card] of record.cards!.entries()) {
      const id = own(card.id ?? undefined)
      if (card.id === null || id === undefined) {
        fixes.push({ index, held: card.id, history: true })
        continue
      }
      const first = seen.get(id)
      if (first !== undefined) {
        fixes.push({ index, held: card.id, history: false, copyOf: first })
        continue
      }
      seen.set(id, index)
      if (notes.has(id)) {
        fixes.push({ index, held: card.id, history: true })
        continue
      }
      const key = `${record.path}\n${id}`
      const others = (holders.get(id) ?? []).filter((p) => p !== record.path)
      const onDisk: string[] = []
      for (const p of new Set(others)) if (await holds(p, id)) onDisk.push(p)
      // The page keeps the card when no other page holds it now, or when a page this pass sweeps comes first.
      const keeps = onDisk.length === 0 || (onDisk.some((p) => swept.has(p)) && !onDisk.some((p) => swept.has(p) && p < record.path))
      if (keeps || settled.has(id)) {
        cardWaits?.delete(key)
        continue
      }
      if (cardWaits !== undefined && cardOver?.has(key) !== true) {
        const since = cardWaits.get(key)
        if (since === undefined) cardWaits.set(key, now)
        if (since === undefined || now - since < CARD_MOVE_WAIT_MS) continue
        cardWaits.delete(key)
      }
      settled.add(id)
      // The page that keeps the card: of the pages this pass sweeps, the first in path order; else the first on disk.
      const keeper = [...onDisk].sort().find((p) => swept.has(p) && p < record.path) ?? [...onDisk].sort()[0]
      fixes.push({ index, held: card.id, history: false, keeper })
    }
    if (fixes.length > 0) work.push({ record, fixes })
  }
  return work
}

/**
 * The note cards of the page at `file` take the IDs `ids` (one for each of `fixes`, in order), but only while each
 * still holds what it held: a compare-and-set on the page's bytes and mtime, as `giveId`. False when nothing was written.
 *
 * NO REVIEW IS DROPPED (YAZ-4993, YAZ-4998). Each copy is settled by the one no-drop rule (`settleCardCopy`, the
 * editor's rule too). A copy with the text of the card that keeps its ID (`copyOf`, `keeper`) gives that card each
 * review it lacks (the union: each review one time, in time order), then loses its own (`history: false`). A copy with
 * another text keeps its history (`history: true`): the sweep cannot tell which card is the original, and both
 * histories stay. A copy's other parts (`off`, unknown parts) stay on it. The keeper on ANOTHER page is written FIRST,
 * with its own compare-and-set; this page only after it. A write that fails between the two leaves a review on two
 * cards, never on none, and the next pass settles it (the union of a review it holds adds nothing).
 */
export async function giveCardIds(file: string, fixes: readonly CardFix[], ids: readonly string[]): Promise<CardFix[] | false> {
  const { content, mtime } = await readFile(file)
  const cards = pageCards(content)
  if (fixes.some((fix) => cards[fix.index] === undefined || cardIdOf(cards[fix.index].line) !== fix.held)) return false
  /** Each card's line as this page will be written: the copies on the page settled first, in page order. */
  const lines: CardLine[] = cards.map((card) => card.line)
  const settled = fixes.map((fix): CardFix => {
    if (fix.copyOf === undefined || cards[fix.copyOf] === undefined) return fix
    const done = settleCardCopy({ line: lines[fix.copyOf], text: cards[fix.copyOf].text }, { line: lines[fix.index], text: cards[fix.index].text })
    lines[fix.copyOf] = done.keeper ?? lines[fix.copyOf]
    lines[fix.index] = done.copy
    return done.emptied ? fix : { ...fix, history: true }
  })
  for (const [i, fix] of settled.entries()) {
    if (fix.keeper === undefined || fix.history) continue
    const there = await readFile(fix.keeper)
    const theirs = pageCards(there.content)
    const at = theirs.findIndex((card) => cardIdOf(card.line) === fix.held)
    // The keeper no longer holds the ID (it was cut): no copy now. Nothing is written; the next pass sees again.
    if (at === -1) return false
    const done = settleCardCopy({ line: theirs[at].line, text: theirs[at].text }, { line: lines[fix.index], text: cards[fix.index].text })
    if (!done.emptied) {
      settled[i] = { ...fix, history: true }
      continue
    }
    if (done.keeper !== null && done.keeper !== theirs[at].line)
      await writeFile({ path: fix.keeper, content: rewritePageCards(there.content, (_card, n) => (n === at ? (done.keeper ?? undefined) : undefined)), expectedMtime: there.mtime })
    lines[fix.index] = done.copy
  }
  const given = new Map(settled.map((fix, i) => [fix.index, ids[i]]))
  const next = rewritePageCards(content, (_card, n) => {
    const id = given.get(n)
    if (id !== undefined) return withCardId(lines[n], id)
    return lines[n] === cards[n].line ? undefined : lines[n]
  })
  await writeFile({ path: file, content: next, expectedMtime: mtime })
  return settled
}

/**
 * The notes of `holders` that are each ANOTHER file on disk right now, in path order. The index is
 * not asked, because it lags: a note moved or renamed outside the app is seen at its new path
 * before its old path is seen gone, and until then the index lists the one note twice. Counted as
 * a copy there, every moved note would lose its id — and every link to it. A case-only rename is
 * the same note under both spellings, which the inode tells: the spelling this sweep was started
 * for (`swept`) is the one kept.
 */
async function onDisk(holders: readonly IndexRecord[], swept: readonly IndexRecord[]): Promise<IndexRecord[]> {
  const stats = await Promise.all(holders.map((r) => stat(r.path).catch(() => null)))
  const files = new Map<string, IndexRecord>()
  holders.forEach((r, i) => {
    const st = stats[i]
    if (st === null) return
    const inode = `${st.dev}:${st.ino}`
    const seen = files.get(inode)
    if (seen === undefined || (swept.includes(r) && !swept.includes(seen))) files.set(inode, r)
  })
  return [...files.values()].sort((a, b) => (a.path < b.path ? -1 : 1))
}

/**
 * Does this vault give its notes IDs (YAZ-2523 🔒 V1, V10)? Only when its `ids.json` says yes: that
 * `.yaseendocs/` exists means nothing, and a file that is missing, unreadable or not JSON has not
 * answered. Read straight off the disk (`vaultIds`). The ONE gate for every id the app writes on its own.
 */
export const givesIds = async (root: string): Promise<boolean> => (await vaultIds(root)).answer === true

/**
 * A settings file deleted from a folder that is still there is created again holding the `id` it
 * had, so links and shortcuts to the folder still reach it. On the sweep's terms: a vault
 * that said yes, never written over, never throws. A folder deleted whole has no directory to create it in.
 */
export const restoreFolderId = async (root: string, file: string, id: string): Promise<void> => {
  if (await givesIds(root)) await createDurable(file, setFrontmatterProperty('', NOTE_ID_KEY, id)).catch(() => undefined)
}

/** A page's bytes. A folder's settings file that is not there reads as empty, with no `mtime`, while its folder is. */
export const readPage = (file: string): Promise<{ content: string; mtime?: number }> =>
  readFile(file).catch(async (err: unknown) => {
    if (!isFolderSettingsPath(file) || !(err instanceof BridgeFailure) || err.code !== 'NOT_FOUND') throw err
    if (!(await stat(path.dirname(file)).catch(() => null))?.isDirectory()) throw err
    return { content: '' }
  })

/**
 * The file's id becomes `fresh`'s, but only while it still is `held` (undefined: it has none, or
 * one that is no ID of the vault with `letters` — another tool's, YAZ-2420 🔒 D30, YAZ-2677 R7).
 * Resolves to the id written, undefined when nothing was. `fresh` is the door's next number
 * (`mintIds`), asked only once the file is seen to need one, so a file that needs none costs no
 * number. The `yaseendocs id` command and a title edit call this too.
 *
 * A folder's settings file that is not there reads as empty and is CREATED, never written over:
 * one that appears before the write stays as it is (D13).
 *
 * `first` is what must hold under the new id before the file takes it; the file is read again
 * after it, and takes the id only if it still holds `held`.
 */
export async function giveId(
  file: string,
  held: string | undefined,
  letters: readonly string[],
  fresh: () => string | undefined | Promise<string | undefined>,
  first?: (id: string) => Promise<void>,
): Promise<string | undefined> {
  const holds = (content: string): boolean => idHeld(content, letters) === held
  let { content, mtime } = await readPage(file)
  if (!holds(content)) return
  const id = await fresh()
  if (id === undefined) return
  if (first !== undefined) {
    await first(id)
    ;({ content, mtime } = await readPage(file))
    if (!holds(content)) return
  }
  const given = setFrontmatterProperty(content, NOTE_ID_KEY, id)
  if (mtime === undefined) await createDurable(file, given)
  else await writeFile({ path: file, content: given, expectedMtime: mtime })
  return id
}

/** The id `content` holds as an ID of the vault with `letters` (R5); undefined when it holds none, and null when its properties do not parse. */
function idHeld(content: string, letters: readonly string[]): string | undefined | null {
  const { properties, error } = parseFrontmatter(splitFrontmatter(content).frontmatter)
  return error === undefined ? vaultNoteId(properties[NOTE_ID_KEY], letters) : null
}

/** The door's next number for the vault at `root`, as `giveId` asks for it; none where the vault does not use IDs. */
export const nextId = (root: string) => async (): Promise<string | undefined> => (await mintIds(root, 1))?.[0]

/**
 * A copied folder's notes carry their values to the copy (D19): in every note under `dir`, at any
 * depth, the block of the folder id `from` — the original's, which the copy's notes still hold
 * their values under — becomes the block of `to`, the copy's own (`moveFolderValues`). The
 * directory is walked as the index walks it; the index itself is not asked. On the sweep's terms:
 * each write a compare-and-set, never throws, and a second run writes nothing — a note that will
 * not parse or already holds a block for `to` is left as it is, and one that changed under the
 * write is read again, once.
 *
 * The copy is remembered while the app runs: a long copy is still arriving when its folder is given
 * its id, and the sweep carries each note that reaches `dir` afterwards.
 *
 * The app's own copy calls this too, once the folder it made holds its fresh id (`fs/copy.ts`,
 * YAZ-2420 🔒 D21): its notes were written holding their values under the original's.
 */
export async function carryFolderValues(dir: string, from: string, to: string): Promise<void> {
  if (!carried.some((copy) => copy.dir === dir && copy.from === from && copy.to === to)) carried.push({ dir, from, to })
  const files: string[] = []
  await walk(dir, files).catch(() => undefined)
  for (const file of files) await carryNote(file, from, to)
}

const carried: { dir: string; from: string; to: string }[] = []

function carryNote(file: string, from: string, to: string): Promise<void> {
  const carry = async (): Promise<void> => {
    const { content, mtime } = await readFile(file)
    const moved = moveFolderValues(content, from, to)
    if (moved !== content) await writeFile({ path: file, content: moved, expectedMtime: mtime })
  }
  return inTurn(() => carry().catch(carry)).catch(() => undefined)
}
