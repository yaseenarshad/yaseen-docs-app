/**
 * Shortcuts (YAZ-2290 D2): a note lives in exactly ONE folder and may also APPEAR in others.
 * The shortcut is stored on the note — `also_in`, a list of FOLDER IDS, a folder's id being the
 * `id` of its `.folder.md` (YAZ-2293) — so it is the same file wherever it shows, and nothing is
 * rewritten when a folder or a note is renamed or moved. This module is the one door to that key.
 *
 * WHAT A FOLDER SHOWS (D4): the notes under it at any depth, plus those whose `also_in` holds its
 * id or the id of a folder under it — each once, in the index's order (`foldersShowing` is the
 * rule from the note's side). The vault root's entry is the notes directly in it. An `also_in`
 * entry no folder has is ignored.
 */
import { ALSO_IN_KEY, alsoIn, alsoInEntries } from '@shared/alsoIn'
import { parseFrontmatter, setFrontmatterProperty, splitFrontmatter } from '@shared/frontmatter'
import { NOTE_ID_KEY, canonicalNoteId, isNoteId } from '@shared/noteId'
import { FOLDER_SETTINGS_FILE, folderSettingsPath, inFolder, isFolderSettingsPath, type IndexRecord } from '@shared/types'
import { absFrom, basename, dirname, relTo } from '../lib/paths'
import { takeNoteId } from '../views/scaffold'
import { transformFile } from '../views/writeProperty'

/** The settings record of the folder at `dir`; undefined while it has no `.folder.md`. */
export function folderRecord(folders: readonly IndexRecord[], dir: string): IndexRecord | undefined {
  const path = folderSettingsPath(dir)
  return folders.find((r) => r.path === path)
}

/** A folder's title (YAZ-2420 🔒 D14): its settings record's, else, while it has no `.folder.md`, its directory's name. */
export const folderTitle = (folders: readonly IndexRecord[], dir: string): string => folderRecord(folders, dir)?.title ?? basename(dir)

/** The settings records by the directory each is the folder of. */
export const foldersByDir = (folders: readonly IndexRecord[]): Map<string, IndexRecord> => new Map(folders.map((r) => [dirname(r.path), r]))

/** How a folder's name reads where a note's could stand: the `[[` picker's row, an id link's menu. */
export const folderLabel = (name: string): string => `${name} (folder)`

/** The settings records by folder id. Of two folders still sharing an id the first in path order is the one it names — the id sweep's own choice. */
export function foldersById(folders: readonly IndexRecord[]): Map<string, IndexRecord> {
  const byId = new Map<string, IndexRecord>()
  for (const folder of folders) if (folder.id !== undefined && !byId.has(folder.id)) byId.set(folder.id, folder)
  return byId
}

const rowsCache = new WeakMap<readonly IndexRecord[], WeakMap<readonly IndexRecord[], Map<string, IndexRecord[]>>>()

/**
 * Every folder's rows in ONE pass over the snapshot, by the folder as the index names it
 * (root-relative, '' at the root). Built once per snapshot — keyed by the identity of its two
 * arrays, as `resolverFor` is — because the sidebar, every mounted folder tab, each link column
 * and the shortcut picker all ask on every index poke. Read-only: the Map is shared.
 */
export function rowsByFolder(records: readonly IndexRecord[], folders: readonly IndexRecord[]): Map<string, IndexRecord[]> {
  let bySettings = rowsCache.get(records)
  if (bySettings === undefined) rowsCache.set(records, (bySettings = new WeakMap()))
  let rows = bySettings.get(folders)
  if (rows === undefined) bySettings.set(folders, (rows = buildRows(records, folders)))
  return rows
}

/** `folder` and every folder above it, short of the root. */
function addWithParents(shown: Set<string>, folder: string): void {
  shown.add(folder)
  for (let cut = folder.lastIndexOf('/'); cut > 0; cut = folder.lastIndexOf('/', cut - 1)) shown.add(folder.slice(0, cut))
}

/**
 * The folders that SHOW a note, in order: the folder it lives in (`folder`, as the index names it)
 * and each folder above it, nearest first, then each folder its `also_in` names with the folders
 * above that one. A note directly in the root is shown by the root ('').
 */
export function foldersShowing(folder: string, properties: Record<string, unknown>, byId: ReadonlyMap<string, IndexRecord>): string[] {
  // A Set: under a folder and naming it or one under it, or naming it twice, is still one row.
  const shown = new Set<string>()
  addWithParents(shown, folder)
  for (const id of alsoIn(properties)) {
    const named = byId.get(id)?.folder
    if (named !== undefined) addWithParents(shown, named)
  }
  return [...shown]
}

function buildRows(records: readonly IndexRecord[], folders: readonly IndexRecord[]): Map<string, IndexRecord[]> {
  const byId = foldersById(folders)
  const rows = new Map<string, IndexRecord[]>()
  for (const record of records) {
    for (const folder of foldersShowing(record.folder, record.properties, byId)) {
      const held = rows.get(folder)
      if (held === undefined) rows.set(folder, [record])
      else held.push(record)
    }
  }
  return rows
}

/** What ONE folder shows (D4). */
export const folderRows = (records: readonly IndexRecord[], folders: readonly IndexRecord[], folder: string): IndexRecord[] =>
  rowsByFolder(records, folders).get(folder) ?? []

/** Whether a row `folder` shows is there by a shortcut: it does not live under it. */
export const isShortcut = (record: IndexRecord, folder: string): boolean => !inFolder(record.folder, folder)

/** Whether a row `folder` shows is directly in it or there by a shortcut, not in a subfolder: what "Subfolders: As rows / Hide" keeps (YAZ-4579 D30, YAZ-4564 D25). */
export const directlyIn = (record: IndexRecord, folder: string): boolean => record.folder === folder || isShortcut(record, folder)

/**
 * Whether a row is a SUBFOLDER's (YAZ-4579 D31): its record is the folder's `.folder.md`, which the
 * index never hands out as a note (D8), so the file name is the kind marker. By the name, never the
 * path: the engine asks it of every row.
 */
export const isFolderRow = (record: Pick<IndexRecord, 'name'>): boolean => record.name === FOLDER_SETTINGS_FILE

/** The page a row opens (YAZ-4579 D32): a folder row's is its folder, by the directory path a folder tab holds (D3); a note's is the note. */
export const rowPage = (path: string): string => (isFolderSettingsPath(path) ? dirname(path) : path)

/** The parent of a folder as the index names it ('' for one in the root). */
const parentOf = (folder: string): string => folder.slice(0, Math.max(0, folder.lastIndexOf('/')))

/**
 * The DIRECT subfolders of `folder` (as the index names it) as rows, in path order (YAZ-4579 D31):
 * each the subfolder's own `.folder.md` record, or, while it has none, an empty stand-in at the path
 * its first write creates (`readForWrite`). Its `folder` is the PARENT, so it sits among the
 * page's own notes; its properties are the file's own, for the host to read its values from.
 * `dirs` are the Files tree's (absolute, `vaultDirs`): a folder with no `.folder.md` is known only there.
 */
export function subfolderRows(root: string, folder: string, dirs: readonly string[], folders: readonly IndexRecord[]): IndexRecord[] {
  const held = new Map(folders.map((record) => [record.folder, record]))
  const children = new Set<string>()
  const add = (rel: string): void => {
    if (rel !== '' && rel !== folder && parentOf(rel) === folder) children.add(rel)
  }
  for (const dir of dirs) add(relTo(root, dir))
  for (const record of folders) add(record.folder)
  return [...children].sort().map((rel) => {
    const own = held.get(rel) ?? {
      path: folderSettingsPath(absFrom(root, rel)),
      name: FOLDER_SETTINGS_FILE,
      basename: '.folder',
      title: basename(rel),
      folder: rel,
      ext: 'md',
      size: 0,
      ctime: 0,
      mtime: 0,
      properties: {},
      aliases: [],
      tags: [],
      links: [],
      embeds: [],
    }
    return { ...own, folder }
  })
}

const propertiesOf = (content: string): Record<string, unknown> => parseFrontmatter(splitFrontmatter(content).frontmatter).properties

/**
 * The id of the folder at `dir`, for its first shortcut or the first value written for it (D19): a
 * folder with no `.folder.md` gets one holding just its id (that write creates the file,
 * `readForWrite`), and a file with no id, or another tool's (YAZ-2420 🔒 D30), is given a fresh one.
 * Asked of the file's own bytes, never the index: a snapshot one write behind would give a second
 * id over the first, and every shortcut and value naming the first would be lost.
 *
 * The fresh id is the vault's next number, from the door (YAZ-2677 D4), taken only when the file
 * is seen to hold none: a folder that has its id costs no number. Returned as the index holds it (R2).
 */
export async function folderId(dir: string): Promise<string> {
  const file = folderSettingsPath(dir)
  const held = (bytes: string): string | undefined => {
    const id = propertiesOf(bytes)[NOTE_ID_KEY]
    return isNoteId(id) ? canonicalNoteId(id) : undefined
  }
  // A transform that changes nothing is a read: it writes nothing, and makes no file where there is none.
  const there = held((await transformFile(file, (bytes) => bytes)).content)
  if (there !== undefined) return there
  const fresh = await takeNoteId(dir)
  // Written against the file's bytes as they are now: an id that arrived since the read above stays.
  // Quiet (YAZ-3235 D1): a folder's id is the app's bookkeeping, not an edit the user made.
  const { content } = await transformFile(file, (bytes) => (held(bytes) === undefined ? setFrontmatterProperty(bytes, NOTE_ID_KEY, fresh) : bytes), true)
  return held(content) ?? fresh
}

/**
 * Make the note at `path` also appear in the folder at `dir` (D2): the folder's id joins the
 * note's `also_in` — once, and beside every entry already there, understood or not. Answers the id
 * it added, or null when the note held it already (checker 8E: an Undo then has nothing to take back).
 */
export async function addShortcut(dir: string, path: string): Promise<string | null> {
  const id = await folderId(dir)
  let added: string | null = null
  await transformFile(path, (content) => {
    const list = alsoInEntries(propertiesOf(content))
    if (list.some((entry) => asId(entry) === id)) return content
    added = id
    return setFrontmatterProperty(content, ALSO_IN_KEY, [...list, id])
  })
  return added
}

/**
 * The exact Undo of one add or one remove (checker 8E): `drop` leaves the note's `also_in`, `restore` joins it again
 * (each once, beside what is there), and nothing else changes — never the folders under one, as `removeShortcut` does.
 */
export function setShortcutEntries(path: string, change: { drop?: readonly unknown[]; restore?: readonly unknown[] }): Promise<unknown> {
  const drop = new Set((change.drop ?? []).map(asId))
  return transformFile(path, (content) => {
    const list = alsoInEntries(propertiesOf(content))
    const kept = list.filter((entry) => !drop.has(asId(entry)))
    const back = (change.restore ?? []).filter((entry) => !kept.some((k) => asId(k) === asId(entry)))
    const next = [...kept, ...back]
    if (next.length === list.length && next.every((entry, i) => entry === list[i])) return content
    return setFrontmatterProperty(content, ALSO_IN_KEY, next.length === 0 ? undefined : next)
  })
}

/** An `also_in` entry as the id it names (`alsoIn`'s reading, YAZ-2677 R2: `yaz-12` names `YAZ-12`); any other entry as it is. */
const asId = (entry: unknown): unknown => (isNoteId(entry) ? canonicalNoteId(entry) : entry)

/** The ids of the folder at `dir` and of every folder under it. */
const idsUnder = (folders: readonly IndexRecord[], dir: string): Set<unknown> => new Set(folders.filter((folder) => inFolder(dirname(folder.path), dir)).map((folder) => folder.id))

/**
 * Take the note at `path` out of the folder at `dir` (E5): the ids of that folder and of every
 * folder under it leave its `also_in`, and the key goes with its last entry — an emptied list is
 * no list, the comments store's rule (`shared/comments.ts`). The note itself stays where it lives,
 * and keeps every value (YAZ-4713 C9): a value that folder kept for it is listed in its properties, with Clear.
 */
export async function removeShortcut(dir: string, path: string, folders: readonly IndexRecord[]): Promise<unknown[]> {
  const ids = idsUnder(folders, dir)
  // The entries it took out, as written (checker 8E): its Undo puts back exactly these.
  let removed: unknown[] = []
  await transformFile(path, (content) => {
    const list = alsoInEntries(propertiesOf(content))
    const kept = list.filter((entry) => !ids.has(asId(entry)))
    removed = list.filter((entry) => ids.has(asId(entry)))
    return kept.length === list.length ? content : setFrontmatterProperty(content, ALSO_IN_KEY, kept.length === 0 ? undefined : kept)
  })
  return removed
}

/** One in-app move or rename of a note or a folder, as the rename door and a pasted Cut name it. */
export interface Move {
  oldPath: string
  newPath: string
  kind: 'file' | 'dir'
}

