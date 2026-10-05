import { createHash } from 'node:crypto'
import { mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { moveFolderValues } from '@shared/folderValues'
import { parseFrontmatter, setFrontmatterProperty, splitFrontmatter } from '@shared/frontmatter'
import { NOTE_ID_KEY, noteIdFrom } from '@shared/noteId'
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
 * The id sweep (YAZ-2293 D3, D4). Each note in `among` with no id is given one. Of the indexed
 * notes sharing an id only the KEEPER keeps it — the one the index knew to hold it (`knew`), else
 * the first in path order, the same on every device — and any other in `among` is given a fresh
 * one. Each folder in `dirs` (never the vault root) with no `.folder.md` is given one holding only
 * its id (D13). A folder's settings file given a fresh id is a COPIED folder's: the notes under it
 * carry their values for it to that id (`carryFolderValues`).
 *
 * 🔒 Only in an ADOPTED vault (`.yaseendocs/` exists, YAZ-797): the app writes nothing into a
 * folder it was only pointed at. Creating a note or a folder there adopts it (`adoptVault`).
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
  if ((stale.length === 0 && bare.length === 0) || !(await isAdopted(root))) return
  // An id some indexed note holds is never written (YAZ-2378): the same next one on every device.
  const taken = (id: string): boolean => holders.has(id)
  for (const r of stale) {
    const id = await inTurn(() => giveId(root, r.path, r.id, taken)).catch(() => undefined)
    if (isFolderSettingsPath(r.path)) {
      if (id !== undefined && r.id !== undefined) await carryFolderValues(path.dirname(r.path), r.id, id)
    } else for (const copy of carried) if (r.path.startsWith(copy.dir + path.sep)) await carryNote(r.path, copy.from, copy.to)
  }
  for (const file of bare) await giveId(root, file, undefined, taken).catch(() => undefined)
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
 * Makes `root` an adopted vault — the user created a note or a folder in it, which is what says
 * the folder is theirs to manage (🔒 YAZ-2293). True when this call is what adopted it. A folder
 * that cannot be written to simply stays as it is.
 */
export const adoptVault = (root: string): Promise<boolean> =>
  mkdir(path.join(root, VAULT_CONFIG_DIR), { recursive: true }).then(
    (made) => made !== undefined,
    () => false,
  )

export const isAdopted = (root: string): Promise<boolean> =>
  stat(path.join(root, VAULT_CONFIG_DIR)).then(
    (st) => st.isDirectory(),
    () => false,
  )

/**
 * A settings file deleted from a folder that is still there is created again holding the `id` it
 * had, so links and shortcuts to the folder still reach it. On the sweep's terms: an adopted
 * vault, never written over, never throws. A folder deleted whole has no directory to create it in.
 */
export const restoreFolderId = async (root: string, file: string, id: string): Promise<void> => {
  if (await isAdopted(root)) await createDurable(file, setFrontmatterProperty('', NOTE_ID_KEY, id)).catch(() => undefined)
}

/** A page's bytes. A folder's settings file that is not there reads as empty, with no `mtime`, while its folder is. */
export const readPage = (file: string): Promise<{ content: string; mtime?: number }> =>
  readFile(file).catch(async (err: unknown) => {
    if (!isFolderSettingsPath(file) || !(err instanceof BridgeFailure) || err.code !== 'NOT_FOUND') throw err
    if (!(await stat(path.dirname(file)).catch(() => null))?.isDirectory()) throw err
    return { content: '' }
  })

/**
 * The file's id becomes a fresh one, but only while it still is `held` (undefined: it has none),
 * and never one that is `taken`. Resolves to the id written, undefined when nothing was. The
 * `yaseendocs id` command calls this too, so the command and the sweep give a note the same
 * id — it has no index to ask what is taken, and the sweep's keeper rule covers that.
 *
 * A folder's settings file that is not there reads as empty and is CREATED, never written over:
 * one that appears before the write stays as it is (D13).
 */
export async function giveId(root: string, file: string, held: string | undefined, taken?: (id: string) => boolean): Promise<string | undefined> {
  const { content, mtime } = await readPage(file)
  const { properties, error } = parseFrontmatter(splitFrontmatter(content).frontmatter)
  if (error !== undefined || properties[NOTE_ID_KEY] !== held) return
  const place = path.relative(root, file).split(path.sep).join('/')
  const id = noteIdFrom((bytes) => createHash('sha256').update(bytes ?? `${place}\0${content}`).digest(), taken)
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
 * not parse, already holds a block for `to`, or changed under the write is left as it is.
 *
 * The copy is remembered while the app runs: a long copy is still arriving when its folder is given
 * its id, and the sweep carries each note that reaches `dir` afterwards.
 */
export async function carryFolderValues(dir: string, from: string, to: string): Promise<void> {
  if (!carried.some((copy) => copy.dir === dir && copy.from === from && copy.to === to)) carried.push({ dir, from, to })
  const files: string[] = []
  await walk(dir, files).catch(() => undefined)
  for (const file of files) await carryNote(file, from, to)
}

const carried: { dir: string; from: string; to: string }[] = []

function carryNote(file: string, from: string, to: string): Promise<void> {
  return inTurn(async () => {
    const { content, mtime } = await readFile(file)
    const moved = moveFolderValues(content, from, to)
    if (moved !== content) await writeFile({ path: file, content: moved, expectedMtime: mtime })
  }).catch(() => undefined)
}
