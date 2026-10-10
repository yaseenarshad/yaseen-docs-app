import { randomBytes } from 'node:crypto'
import { mkdir, readFile, readdir, stat } from 'node:fs/promises'
import { homedir, hostname } from 'node:os'
import path from 'node:path'
import { IDS_FILE, idLettersOf, idsAnswer, noteIdNumber, numberId, vaultNoteId } from '@shared/noteId'
import { VAULT_CONFIG_DIR } from '@shared/types'
import { isRecord } from '@shared/guards'
import { BridgeFailure, atomicWrite, createDurable, toBridgeFailure } from '../fs/fsUtils'
import { userDataDir } from '../userData'
import { scanAll } from './reconcile'
import { walk } from './scan'

/**
 * THE DOOR (YAZ-2677 🔒 D4, R13 to R21): the one place that makes an ID. Every new ID is the next
 * number of its vault — 1 plus the highest of each number ID in the vault and `last` of each Mac's
 * count file (R16) — so a number a deleted note had is never given again.
 *
 * Each Mac keeps its own count file in the vault, `.yaseendocs/ids/<mac id>.json`, and only that
 * Mac writes it (R15): two Macs that sync the vault never change one file, so the sync cannot
 * conflict on a count. Two Macs CAN give one number before they sync; the clash rule settles that
 * (`clash.ts`).
 *
 * One request at a time for a vault (R17), and the count is on disk BEFORE the ID is returned (R18):
 * a crash, or a create that fails, leaves a gap and never a number given two times.
 *
 * Plain Node, no Electron and no watcher: the `yaseendocs` command uses this door too, with the
 * same Mac ID and so the same count file (R20).
 */

/** The folder of the count files, in the vault's config folder. The config watcher reports only files directly in that one, so a new number wakes nothing. */
export const COUNT_DIR = 'ids'
/** `made` keeps this many days (R21). */
export const MADE_DAYS = 30
/** And this many runs at most, oldest dropped first: a script that makes notes one by one must not grow the file with no end. */
export const MADE_MAX = 5000
/** Count files read in one vault: one for each Mac that ever wrote to it. */
const COUNT_FILES_MAX = 64
/** Two processes of this Mac (the app, the command) wrote at the same moment: read again, this many times at most. */
const RETRIES = 3
const MAC_FILE = 'mac.json'
const MAC_ID_RE = /^[0-9a-z]{12}$/

/** Numbers `from` to `to`, given together at `at` (ISO time): one new note is a run of one, a sweep of many notes is one run. */
export interface Run {
  from: number
  to: number
  at: string
}

/** One Mac's count file (R14). */
export interface CountFile {
  /** The host name, for people. Nothing reads it. */
  name: string
  /** When the file was made (ISO time): the Mac with the oldest is the vault's first Mac. */
  since: string
  /** The highest number this Mac gave. */
  last: number
  /** Each number this Mac gave in the last `MADE_DAYS` days, oldest first. */
  made: Run[]
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value < 1e15
const isTime = (value: unknown): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value))

/** A count file's bytes as a count; null when they are not one (S38: read as empty). A run that is not one is dropped. */
function parseCount(raw: string): CountFile | null {
  let doc: unknown
  try {
    doc = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return null
  const { name, since, last, made } = doc as Record<string, unknown>
  // `last: 0` is a Mac that has a count file and gave no number yet. The door never writes one; it is read like any other.
  if (!(last === 0 || isNumber(last)) || !isTime(since)) return null
  const runs = (Array.isArray(made) ? made : []).filter((run: unknown): run is Run => {
    const { from, to, at } = (run ?? {}) as Record<string, unknown>
    return isNumber(from) && isNumber(to) && from <= to && isTime(at)
  })
  return { name: typeof name === 'string' ? name : '', since, last: last as number, made: runs.slice(-MADE_MAX).map(({ from, to, at }) => ({ from, to, at })) }
}

/** One run on each line: a sync tool that shows the file's changes shows one line for one new note. */
const serialise = ({ name, since, last, made }: CountFile): string =>
  `{\n  "name": ${JSON.stringify(name)},\n  "since": ${JSON.stringify(since)},\n  "last": ${last},\n  "made": [${made.map((run) => `\n    ${JSON.stringify(run)}`).join(',')}${made.length === 0 ? '' : '\n  '}]\n}\n`

// ---------- this Mac ----------

let appData: string | undefined
/** Test hook (`_actAs`): the app data folder of the Mac that a vault folder stands for. */
const appDataOf = new Map<string, string>()
/** The Mac ID of each app data folder asked, read or made one time. */
const macs = new Map<string, Promise<string>>()

/**
 * Where this Mac's ID is kept: the app's data folder (`app.getPath('userData')`). The command never
 * calls this and finds the same folder by `userDataDir`, so both use one Mac ID (R20).
 */
export function initMint(userData: string): void {
  appData = userData
}

/** This Mac's app data folder: its ID is kept there, and so is its diary of each vault (`diary.ts`). `root` only tells Macs apart in a test. */
export const appDataDir = (root?: string): string => (root === undefined ? undefined : appDataOf.get(root)) ?? appData ?? userDataDir(process.env, process.platform, homedir())

/**
 * This Mac's ID (R13): a random name made one time and kept in the app data, never the host name —
 * two Macs can share a host name, and a Mac can change its own. Created and never written over: of
 * the app and the command starting together, the second reads what the first made.
 */
export function macId(root?: string): Promise<string> {
  const dir = appDataDir(root)
  let id = macs.get(dir)
  if (id === undefined) {
    id = readOrMakeMacId(dir)
    macs.set(dir, id)
    id.catch(() => macs.delete(dir))
  }
  return id
}

async function readOrMakeMacId(dir: string): Promise<string> {
  const file = path.join(dir, MAC_FILE)
  const held = (): Promise<string | undefined> =>
    readFile(file, 'utf8').then(
      (raw) => {
        try {
          const id = (JSON.parse(raw) as { id?: unknown } | null)?.id
          return typeof id === 'string' && MAC_ID_RE.test(id) ? id : undefined
        } catch {
          return undefined
        }
      },
      () => undefined,
    )
  const found = await held()
  if (found !== undefined) return found
  // 12 characters of 0-9 a-v: 60 random bits.
  const fresh = Array.from(randomBytes(12), (byte) => (byte & 31).toString(32)).join('')
  const bytes = `${JSON.stringify({ id: fresh }, null, 2)}\n`
  await mkdir(dir, { recursive: true })
  try {
    // Durable (YAZ-2677 R15): a crash here must not leave a cut file, and so a second Mac ID for this Mac.
    await createDurable(file, bytes)
    return fresh
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
  }
  // Another process made it first, or it is there and holds no ID: a damaged one is written over.
  const theirs = await held()
  if (theirs !== undefined) return theirs
  await atomicWrite(file, bytes)
  return fresh
}

// ---------- the vault ----------

/** A vault's `ids.json`, read straight off the disk. */
export interface VaultIds {
  /** Its answer to "do your notes get IDs?" (YAZ-2523 🔒 V1); undefined when it has not answered. */
  answer: boolean | undefined
  /** Its ID letters, the current ones first and then each it had before (`idLettersOf`, R9). */
  letters: string[]
  /** False while the letters are the default of the folder's name and not yet in the file (R11). */
  saved: boolean
}

const idsFile = (root: string): string => path.join(root, VAULT_CONFIG_DIR, IDS_FILE)

/** The ONE read of `ids.json`: its parsed bytes; undefined for a file that is not there, and `malformed` for one that is not valid JSON. */
async function readIds(root: string): Promise<{ config?: unknown; malformed?: true }> {
  let raw: string
  try {
    raw = await readFile(idsFile(root), 'utf8')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return {}
    throw toBridgeFailure(err, idsFile(root))
  }
  try {
    return { config: JSON.parse(raw) as unknown }
  } catch {
    return { malformed: true }
  }
}

/** What a parsed `ids.json` says, for the vault at `root`. */
const idsIn = (config: unknown, root: string): VaultIds => ({ answer: idsAnswer(config), ...idLettersOf(isRecord(config) ? config : undefined, path.basename(root)) })

/** `root`'s answer and letters. A file that is missing, unreadable or not JSON has not answered, and holds no letters. */
export async function vaultIds(root: string): Promise<VaultIds> {
  return idsIn((await readIds(root).catch(() => ({ config: undefined }))).config, root)
}

/** One change of a vault's `ids.json` at a time in this process. */
const changes = new Map<string, Promise<unknown>>()

/**
 * THE ONE WRITE OF `ids.json` (YAZ-2677 R10): the file of `root` is read, changed by `change` and
 * written as ONE step, behind each change before it. So a save keeps each key it does not change,
 * two saves at one moment each keep the other's, and `change` always sees the answer that is on
 * disk NOW: a no that arrived a moment before is never written over. Undefined from `change`
 * writes nothing. A file that is not valid JSON is never written over (`INVALID_CONFIG`).
 *
 * `write` is how the app writes a vault's config (`writeConfig`: its windows hear of it at once).
 * The door, which the command uses too, writes the file itself.
 */
export function changeIds(
  root: string,
  change: (config: Record<string, unknown>) => Record<string, unknown> | undefined,
  write: (config: Record<string, unknown>) => Promise<unknown> = async (config) => {
    await mkdir(path.dirname(idsFile(root)), { recursive: true })
    await atomicWrite(idsFile(root), `${JSON.stringify(config, null, 2)}\n`)
  },
): Promise<void> {
  const step = async (): Promise<void> => {
    const held = await readIds(root)
    if (held.malformed === true) throw new BridgeFailure('INVALID_CONFIG', `${IDS_FILE} is not valid JSON`, { path: idsFile(root) })
    const next = change(isRecord(held.config) ? held.config : {})
    if (next !== undefined) await write(next)
  }
  const mine = (changes.get(root) ?? Promise.resolve()).then(step)
  const tail = mine.catch(() => undefined)
  changes.set(root, tail)
  void tail.then(() => {
    if (changes.get(root) === tail) changes.delete(root)
  })
  return mine
}

/**
 * The default letters are saved when the first number is given (R11), each other key kept (R10).
 * Resolves to what the file says after the step: a no, or letters, that arrived since the door read
 * it stand as they are. Undefined when the file could not be read or written.
 */
async function saveDefaultLetters(root: string): Promise<VaultIds | undefined> {
  let now: VaultIds | undefined
  await changeIds(root, (config) => {
    now = idsIn(config, root)
    if (now.answer !== true || now.saved) return undefined
    now.saved = true
    return { ...config, letters: now.letters[0] }
  }).catch(() => (now = undefined))
  return now
}

/** The highest number among `notes`' IDs that are IDs of the vault with `letters` (R5); 0 when none is. An old ID has no number (S20). */
export function highestNumber(notes: Iterable<{ id?: string }>, letters: readonly string[]): number {
  let top = 0
  for (const { id } of notes) {
    const number = id === undefined ? undefined : noteIdNumber(vaultNoteId(id, letters))
    if (number !== undefined && number > top) top = number
  }
  return top
}

/** The highest number ID in the vault at `root`, for the door. */
type Highest = (root: string, letters: readonly string[]) => number | Promise<number>

/** With no index to ask — the command — the vault is walked and scanned as the index would scan it. */
const scanned: Highest = async (root, letters) => {
  const files: string[] = []
  await walk(root, files).catch(() => undefined)
  return highestNumber((await scanAll(root, files)).values(), letters)
}

let highest: Highest = scanned

/** Who answers "what is the highest number in this vault?": the app's live index does, from memory (`live.ts`), so no file is read for a new number. */
export function highestFrom(ask: Highest): void {
  highest = ask
}

// ---------- the count files ----------

interface Held {
  mtimeMs: number
  size: number
  count: CountFile | null
}

interface Door {
  /** The end of the queue: one request at a time for a vault (R17). */
  turn: Promise<unknown>
  /** Each count file by its name, as last read: read again only when its size or time changed. */
  files: Map<string, Held>
}

const doors = new Map<string, Door>()

const countDir = (root: string): string => path.join(root, VAULT_CONFIG_DIR, COUNT_DIR)

/** `door.files` brought up to date with the folder: a stat for each count file, a read for each that changed. `own` is always among them. */
async function refresh(door: Door, dir: string, own: string): Promise<void> {
  const listed = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const names = listed.filter((e) => e.isFile() && e.name.endsWith('.json') && e.name !== own).map((e) => e.name).sort().slice(0, COUNT_FILES_MAX - 1)
  names.push(own)
  const seen = await Promise.all(
    names.map(async (name): Promise<[string, Held] | null> => {
      const file = path.join(dir, name)
      const st = await stat(file).catch(() => null)
      if (st === null || !st.isFile()) return null
      const held = door.files.get(name)
      if (held !== undefined && held.mtimeMs === st.mtimeMs && held.size === st.size) return [name, held]
      const count = await readFile(file, 'utf8').then(parseCount, () => null)
      return [name, { mtimeMs: st.mtimeMs, size: st.size, count }]
    }),
  )
  door.files = new Map(seen.filter((entry) => entry !== null))
}

/** `made` with the new run, without each run older than `MADE_DAYS` days and never over `MADE_MAX` runs (R21). */
function madeWith(made: readonly Run[], run: Run, now: number): Run[] {
  const oldest = now - MADE_DAYS * 24 * 60 * 60 * 1000
  return [...made.filter((r) => Date.parse(r.at) >= oldest), run].slice(-MADE_MAX)
}

async function take(root: string, door: Door, count: number, floor: number | undefined): Promise<string[] | null> {
  let ids = await vaultIds(root)
  if (ids.answer !== true) return null
  const dir = countDir(root)
  const own = `${await macId(root)}.json`
  const file = path.join(dir, own)
  for (let attempt = 0; ; attempt++) {
    await refresh(door, dir, own)
    const mine = door.files.get(own)
    const top = floor ?? (await highest(root, ids.letters))
    const first = 1 + Math.max(top, ...[...door.files.values()].map((held) => held.count?.last ?? 0))
    const last = first + count - 1
    if (!isNumber(last)) throw new Error('this vault has no number left to give')
    const now = new Date()
    const at = now.toISOString()
    const next: CountFile = { name: hostname(), since: mine?.count?.since ?? at, last, made: madeWith(mine?.count?.made ?? [], { from: first, to: last, at }, now.getTime()) }
    // The app and the command are two processes of this Mac with one count file (R20): what the
    // other wrote since the read above is read again before anything is written over it.
    const st = await stat(file).catch(() => null)
    if (attempt < RETRIES && (st?.mtimeMs !== mine?.mtimeMs || st?.size !== mine?.size)) continue
    if (!ids.saved) {
      const now = await saveDefaultLetters(root)
      // The vault said no since the read above (the user clicked Off): no number, and nothing more is written.
      if (now?.answer !== true) return null
      const same = now.letters[0] === ids.letters[0]
      ids = now
      // Other letters were saved meanwhile: the number is counted again, with them.
      if (!same) continue
    }
    await mkdir(dir, { recursive: true })
    const written = await atomicWrite(file, serialise(next))
    door.files.set(own, { mtimeMs: written.mtime, size: written.size, count: next })
    return Array.from({ length: count }, (_, i) => numberId(ids.letters[0], first + i))
  }
}

/**
 * The next `count` IDs of the vault at `root`, in order — null, and nothing written, where the
 * vault does not use IDs. All of them are saved with ONE write of this Mac's count file (R19)
 * before they are returned (R18). `floor` is the highest number among the vault's notes when the
 * caller already holds them (the sweep); else the index is asked (`highestFrom`).
 */
export function mintIds(root: string, count: number, floor?: number): Promise<string[] | null> {
  return inTurn(root, (door) => take(root, door, count, floor))
}

/** `ask` behind every request already made of the door of `root`: one at a time for a vault (R17). */
function inTurn<T>(root: string, ask: (door: Door) => Promise<T>): Promise<T> {
  let door = doors.get(root)
  if (door === undefined) doors.set(root, (door = { turn: Promise.resolve(), files: new Map() }))
  const held = door
  const mine = held.turn.then(() => ask(held))
  held.turn = mine.catch(() => undefined)
  return mine
}

/** A vault that gives IDs, as a create or a copy holds it for one request. */
export interface IdDoor {
  /** The vault's next `count` IDs (`mintIds`). Refused when the vault stopped giving IDs after this door was asked for. */
  mint(count: number): Promise<string[]>
  /** The vault's ID letters, the current ones first (`VaultIds.letters`). */
  letters: readonly string[]
}

/** The door of the vault at `root`; null where it does not give its notes IDs (YAZ-2523 🔒 V1): nothing there is given one. */
export async function doorOf(root: string): Promise<IdDoor | null> {
  const { answer, letters } = await vaultIds(root)
  if (answer !== true) return null
  return {
    letters,
    mint: async (count) => {
      const ids = await mintIds(root, count)
      if (ids === null) throw new BridgeFailure('BAD_REQUEST', 'this vault does not use IDs', { path: root })
      return ids
    },
  }
}

/** The count files of a vault as the door holds them, and which of them is this Mac's. */
export interface Counts {
  /** This Mac's ID. It has no count file in the vault until it gives its first number there. */
  me: string
  /** Each Mac's count by its Mac ID. A file that is not a count is left out. */
  files: ReadonlyMap<string, CountFile>
}

/**
 * Each Mac's count file in the vault at `root`, in the door's turn and from what the door already
 * holds: a stat for each count file, and a read only for one whose size or time changed. The
 * sweep asks only when two notes hold one ID or a file needs a number, never for each index event.
 */
export function countsOf(root: string): Promise<Counts> {
  return inTurn(root, async (door) => {
    const me = await macId(root)
    await refresh(door, countDir(root), `${me}.json`)
    return { me, files: new Map([...door.files].flatMap(([name, { count }]) => (count === null ? [] : [[name.slice(0, -'.json'.length), count] as const]))) }
  })
}

/**
 * The vault's FIRST Mac (YAZ-2677 R33): the one whose count file is oldest (`since`), and of two
 * made at one moment the Mac ID that is first in order. Undefined for a vault with no count file:
 * it has no first Mac until some Mac gives the first number.
 */
export function firstMac(files: ReadonlyMap<string, CountFile>): string | undefined {
  let first: { mac: string; since: number } | undefined
  for (const [mac, count] of files) {
    const since = Date.parse(count.since)
    if (first === undefined || since < first.since || (since === first.since && mac < first.mac)) first = { mac, since }
  }
  return first?.mac
}

/** A Mac that gave a number, and when. */
export interface Maker {
  mac: string
  /** The time of the run in its `made` that holds the number (ms). */
  at: number
}

/**
 * The Macs whose count file holds `number` in `made` (R22), the one that gave it first in front,
 * and of two that gave it at one moment the Mac ID that is first in order (R23). Two or more: the
 * notes that hold the number are a CLASH. A run older than `MADE_DAYS` days is not counted, whether
 * or not its Mac has dropped it yet (S49).
 */
export function makersOf(files: ReadonlyMap<string, CountFile>, number: number, now: number): Maker[] {
  const oldest = now - MADE_DAYS * 24 * 60 * 60 * 1000
  const makers: Maker[] = []
  for (const [mac, { made }] of files) {
    let at: number | undefined
    for (const run of made) {
      if (number < run.from || number > run.to) continue
      const time = Date.parse(run.at)
      if (time >= oldest && (at === undefined || time < at)) at = time
    }
    if (at !== undefined) makers.push({ mac, at })
  }
  return makers.sort((a, b) => a.at - b.at || (a.mac < b.mac ? -1 : 1))
}

/** Did the Mac with this count give `number` in the last `MADE_DAYS` days? What the diary keeps a link for (R27, R21). */
export const madeBy = (count: CountFile | undefined, number: number, now: number): boolean => count !== undefined && makersOf(new Map([['', count]]), number, now).length > 0

/** Test hook: the vault folder at `root` stands for the Mac whose app data folder is `dir`, so two Macs can run in one test. */
export function _actAs(root: string, dir: string): void {
  appDataOf.set(root, dir)
}

/** Test hook: forgets each vault's door, this Mac, and who answers for the notes. */
export function _resetMint(): void {
  doors.clear()
  macs.clear()
  appDataOf.clear()
  appData = undefined
  highest = scanned
}
