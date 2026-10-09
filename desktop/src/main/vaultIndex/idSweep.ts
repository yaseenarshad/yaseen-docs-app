import { stat } from 'node:fs/promises'
import path from 'node:path'
import { moveFolderValues } from '@shared/folderValues'
import { parseFrontmatter, setFrontmatterProperty, splitFrontmatter } from '@shared/frontmatter'
import { NOTE_ID_KEY, vaultNoteId } from '@shared/noteId'
import { FOLDER_SETTINGS_FILE, isFolderSettingsPath, type IndexRecord } from '@shared/types'
import { readFile, writeFile } from '../fs/file'
import { BridgeFailure, createDurable } from '../fs/fsUtils'
import { highestNumber, mintIds, vaultIds } from './mint'
import { walk } from './scan'

/**
 * One sweep write at a time. Every watch event sweeps on its own, so a copied folder's notes are
 * each being given their id while the folder carries its values to them: two compare-and-sets on
 * one file, and the loser would be a copy left holding its original's id, or its values.
 */
let turn: Promise<unknown> = Promise.resolve()
function inTurn<T>(write: () => Promise<T>): Promise<T> {
  const mine = turn.then(write)
  turn = mine.catch(() => undefined)
  return mine
}

/**
 * The id sweep (YAZ-2293 D3, D4). Each note in `among` with no id is given one, and an `id` that
 * is not an ID of THIS vault is none: the app's is written over it (YAZ-2420 🔒 D30, YAZ-2677 R7 —
 * another tool's `id`, and a number ID whose letters the vault never had). Of the indexed
 * notes sharing an id only the KEEPER keeps it — the one the index knew to hold it (`knew`), else
 * the first in path order, the same on every device — and any other in `among` is given a fresh
 * one. Each folder in `dirs` (never the vault root) with no `.folder.md` is given one holding only
 * its id (D13). A folder's settings file given a fresh id is a COPIED folder's: the notes under it
 * carry their values for it to that id first (`carryFolderValues`), then the folder takes it.
 *
 * 🔒 Only in a vault that said yes (`givesIds`, YAZ-2523 V1): the app writes nothing into any other.
 *
 * 🔒 Each fresh id is the vault's next NUMBER, from the door (YAZ-2677 D4, `mint.ts`), and one pass
 * takes all its numbers with ONE write of the count file (R19). Only a note the index could read
 * is counted, so a note that can never take an id costs no number on each pass. An OLD id is an id
 * like any other here: it is kept, and never written over (R3).
 *
 * Safe to run any number of times and never throws: each write is a compare-and-set against the
 * file's bytes and mtime, a settings file is created only where there is none, and a file that
 * cannot take an id or changed under the sweep is left for its next index event.
 */
export async function sweepIds(
  root: string,
  records: ReadonlyMap<string, IndexRecord>,
  among: readonly IndexRecord[],
  knew: (path: string) => string | undefined,
  dirs: readonly string[] = [],
): Promise<void> {
  if (among.length === 0 && dirs.length === 0) return
  const { answer, letters } = await vaultIds(root)
  if (answer !== true) return
  /** `id` as an ID of this vault (R5): the letters it had before read as the current ones, any other letters as none. */
  const own = (id: string | undefined): string | undefined => vaultNoteId(id, letters)
  // Every indexed holder of an id some note in `among` holds. With no letters of before, two
  // records hold one id exactly when their `id` is one string: nothing is parsed for the others.
  const holders = new Map<string, IndexRecord[]>()
  for (const r of among) {
    const id = own(r.id)
    if (id !== undefined) holders.set(id, [])
  }
  if (holders.size > 0) {
    for (const r of records.values()) {
      const id = r.id === undefined || letters.length === 1 ? r.id : own(r.id)
      if (id !== undefined) holders.get(id)?.push(r)
    }
  }
  const stale: IndexRecord[] = []
  for (const r of among) {
    const id = own(r.id)
    if (id !== undefined) {
      const sharing = [r, ...(await otherFiles(r, holders.get(id) ?? []))].sort((a, b) => (a.path < b.path ? -1 : 1))
      if ((sharing.find((o) => own(knew(o.path)) === id) ?? sharing[0]).path === r.path) continue
    }
    // A note the index could not read (its YAML is invalid, or it is over the size limit) takes no id: it is given no number.
    if (r.frontmatterError === undefined && r.text !== undefined) stale.push(r)
  }
  // A settings file the index holds is a record like any note, swept above. One it does not hold
  // yet is read here: a folder that arrives WITH its file (a copy made in Finder) takes no number.
  const unseen = dirs.map((dir) => path.join(dir, FOLDER_SETTINGS_FILE)).filter((file) => !records.has(file))
  const needs = await Promise.all(unseen.map((file) => readPage(file).then(({ content }) => holdsNone(content, letters), () => false)))
  const bare = unseen.filter((_, i) => needs[i])
  if (stale.length === 0 && bare.length === 0) return
  // The numbers of the whole pass, saved with one write before any note is written (R18, R19).
  // Higher than each number in the vault, so none is an id some indexed note holds (YAZ-2378).
  const numbers = await mintIds(root, stale.length + bare.length, highestNumber(records.values(), letters)).catch(() => null)
  if (numbers === null) return
  const fresh = (): string | undefined => numbers.shift()
  for (const r of stale) {
    // Asked before every write, so a no stops a pass that is running (YAZ-2523 🔒 V4).
    if (!(await givesIds(root))) return
    const from = r.id
    if (isFolderSettingsPath(r.path) && from !== undefined) {
      // A copied folder takes its id LAST, after its notes hold their values under it: a carry cut
      // short (the app quit) leaves the folder still stale, so the next sweep finds and finishes it.
      await giveId(r.path, own(from), letters, fresh, (to) => carryFolderValues(path.dirname(r.path), from, to)).catch(() => undefined)
      continue
    }
    await inTurn(() => giveId(r.path, own(from), letters, fresh)).catch(() => undefined)
    for (const copy of carried) if (r.path.startsWith(copy.dir + path.sep)) await carryNote(r.path, copy.from, copy.to)
  }
  for (const file of bare) if (await givesIds(root)) await giveId(file, undefined, letters, fresh).catch(() => undefined)
}

/**
 * The `holders` of `r`'s id that are ANOTHER file on disk right now. The index is not asked,
 * because it lags: a note moved or renamed outside the app is seen at its new path before its
 * old path is seen gone, and until then the index lists the one note twice. Counted as a copy
 * there, every moved note would lose its id — and every link to it. A case-only rename is the
 * same note under both spellings, which the inode tells.
 */
async function otherFiles(r: IndexRecord, holders: readonly IndexRecord[]): Promise<IndexRecord[]> {
  const self = await stat(r.path).catch(() => null)
  const others = await Promise.all(
    holders.map(async (o) => {
      const st = o.path === r.path ? null : await stat(o.path).catch(() => null)
      return st === null || (st.ino === self?.ino && st.dev === self?.dev) ? null : o
    }),
  )
  return others.filter((o) => o !== null)
}

/**
 * The vault's answer to "do your notes get IDs?" (YAZ-2523 🔒 V1): its `ids.json`. Undefined when it
 * has not answered; a file that is missing, unreadable or not JSON has not. Read straight off the
 * disk (`vaultIds`): the `yaseendocs` command asks too, and must not carry the app's config watcher with it.
 */
export const idsOf = async (root: string): Promise<boolean | undefined> => (await vaultIds(root)).answer

/**
 * Does this vault give its notes IDs (🔒 V1, V10)? Only when it said yes: that `.yaseendocs/`
 * exists means nothing. The ONE gate for every id the app writes on its own.
 */
export const givesIds = async (root: string): Promise<boolean> => (await idsOf(root)) === true

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

/** Can a page with this `content` be given an id, and does it need one? */
const holdsNone = (content: string, letters: readonly string[]): boolean => idHeld(content, letters) === undefined

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
