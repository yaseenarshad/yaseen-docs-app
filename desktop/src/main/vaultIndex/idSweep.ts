import { createHash } from 'node:crypto'
import { readFile as fsReadFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { moveFolderValues } from '@shared/folderValues'
import { parseFrontmatter, setFrontmatterProperty, splitFrontmatter } from '@shared/frontmatter'
import { IDS_FILE, NOTE_ID_KEY, idsAnswer, isNoteId, noteIdFrom } from '@shared/noteId'
import { FOLDER_SETTINGS_FILE, VAULT_CONFIG_DIR, isFolderSettingsPath, type IndexRecord } from '@shared/types'
import { readFile, writeFile } from '../fs/file'
import { BridgeFailure, createDurable } from '../fs/fsUtils'
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
 * is not one of this app's is none: the app's is written over it (YAZ-2420 🔒 D30). Of the indexed
 * notes sharing an id only the KEEPER keeps it — the one the index knew to hold it (`knew`), else
 * the first in path order, the same on every device — and any other in `among` is given a fresh
 * one. Each folder in `dirs` (never the vault root) with no `.folder.md` is given one holding only
 * its id (D13). A folder's settings file given a fresh id is a COPIED folder's: the notes under it
 * carry their values for it to that id first (`carryFolderValues`), then the folder takes it.
 *
 * 🔒 Only in a vault that said yes (`givesIds`, YAZ-2523 V1): the app writes nothing into any other.
 *
 * The id is DERIVED from the note's place and bytes (a folder's from its settings file's place),
 * so two devices that meet the same note before syncing make the same edit, which merges; a
 * different id on each would be a conflict the built-in sync stops on (`git/sync.ts`).
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
  const holders = new Map<string, IndexRecord[]>()
  for (const r of records.values()) if (r.id !== undefined) holders.set(r.id, [...(holders.get(r.id) ?? []), r])
  const stale: IndexRecord[] = []
  for (const r of among) {
    if (r.id !== undefined) {
      const sharing = [r, ...(await otherFiles(r, holders.get(r.id) ?? []))].sort((a, b) => (a.path < b.path ? -1 : 1))
      if ((sharing.find((o) => knew(o.path) === r.id) ?? sharing[0]).path === r.path) continue
    }
    stale.push(r)
  }
  // A settings file the index holds is a record like any note, swept above.
  const bare = dirs.map((dir) => path.join(dir, FOLDER_SETTINGS_FILE)).filter((file) => !records.has(file))
  // An id some indexed note holds is never written (YAZ-2378): the same next one on every device.
  const taken = (id: string): boolean => holders.has(id)
  for (const r of stale) {
    // Asked before every write, so a no stops a pass that is running (YAZ-2523 🔒 V4).
    if (!(await givesIds(root))) return
    const from = r.id
    if (isFolderSettingsPath(r.path) && from !== undefined) {
      // A copied folder takes its id LAST, after its notes hold their values under it: a carry cut
      // short (the app quit) leaves the folder still stale, so the next sweep finds and finishes it.
      await giveId(root, r.path, from, taken, (to) => carryFolderValues(path.dirname(r.path), from, to)).catch(() => undefined)
      continue
    }
    await inTurn(() => giveId(root, r.path, from, taken)).catch(() => undefined)
    for (const copy of carried) if (r.path.startsWith(copy.dir + path.sep)) await carryNote(r.path, copy.from, copy.to)
  }
  for (const file of bare) if (await givesIds(root)) await giveId(root, file, undefined, taken).catch(() => undefined)
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
 * disk: the `yaseendocs` command asks too, and must not carry the app's config watcher with it.
 */
export const idsOf = (root: string): Promise<boolean | undefined> =>
  fsReadFile(path.join(root, VAULT_CONFIG_DIR, IDS_FILE), 'utf8').then(
    (raw) => idsAnswer(JSON.parse(raw)),
    () => undefined,
  )

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
 * The file's id becomes a fresh one, but only while it still is `held` (undefined: it has none,
 * or another tool's, YAZ-2420 🔒 D30), and never one that is `taken`. Resolves to the id written,
 * undefined when nothing was. The `yaseendocs id` command calls this too, so the command and the
 * sweep give a note the same id — it has no index to ask what is taken, and the sweep's keeper
 * rule covers that.
 *
 * A folder's settings file that is not there reads as empty and is CREATED, never written over:
 * one that appears before the write stays as it is (D13).
 *
 * `first` is what must hold under the new id before the file takes it; the file is read again
 * after it, and takes the id only if it still holds `held`.
 */
export async function giveId(root: string, file: string, held: string | undefined, taken?: (id: string) => boolean, first?: (id: string) => Promise<void>): Promise<string | undefined> {
  const holds = (content: string): boolean => {
    const { properties, error } = parseFrontmatter(splitFrontmatter(content).frontmatter)
    const id = properties[NOTE_ID_KEY]
    return error === undefined && (isNoteId(id) ? id : undefined) === held
  }
  let { content, mtime } = await readPage(file)
  if (!holds(content)) return
  const place = path.relative(root, file).split(path.sep).join('/')
  const id = noteIdFrom((bytes) => createHash('sha256').update(bytes ?? `${place}\0${content}`).digest(), taken)
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
