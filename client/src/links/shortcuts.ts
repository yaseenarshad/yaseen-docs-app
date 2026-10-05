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
import { FOLDER_VALUES_KEY, withoutStaleFolderValues } from '@shared/folderValues'
import { parseFrontmatter, setFrontmatterIn, setFrontmatterProperty, splitFrontmatter } from '@shared/frontmatter'
import { NOTE_ID_KEY, isNoteId, mintNoteId } from '@shared/noteId'
import { folderSettingsPath, inFolder, type IndexRecord } from '@shared/types'
import { dirname, relTo } from '../lib/paths'
import { transformFile, type ContentTransform } from '../views/writeProperty'

/** The settings record of the folder at `dir`; undefined while it has no `.folder.md`. */
export function folderRecord(folders: readonly IndexRecord[], dir: string): IndexRecord | undefined {
  const path = folderSettingsPath(dir)
  return folders.find((r) => r.path === path)
}

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

const propertiesOf = (content: string): Record<string, unknown> => parseFrontmatter(splitFrontmatter(content).frontmatter).properties

/**
 * The id of the folder at `dir`, for its first shortcut or the first value written for it (D19): a
 * folder with no `.folder.md` gets one holding just its id (that write creates the file,
 * `readForWrite`), and a file with no id, or another tool's (YAZ-2420 🔒 D30), is given a fresh one.
 * Asked of the file's own bytes, never the index: a snapshot one write behind would mint a second
 * id over the first, and every shortcut and value naming the first would be lost.
 */
export async function folderId(dir: string): Promise<string> {
  const fresh = mintNoteId()
  const { content } = await transformFile(folderSettingsPath(dir), (bytes) =>
    isNoteId(propertiesOf(bytes)[NOTE_ID_KEY]) ? bytes : setFrontmatterProperty(bytes, NOTE_ID_KEY, fresh),
  )
  return propertiesOf(content)[NOTE_ID_KEY] as string
}

/**
 * Make the note at `path` also appear in the folder at `dir` (D2): the folder's id joins the
 * note's `also_in` — once, and beside every entry already there, understood or not.
 */
export async function addShortcut(dir: string, path: string): Promise<void> {
  const id = await folderId(dir)
  await transformFile(path, (content) => {
    const list = alsoInEntries(propertiesOf(content))
    return list.includes(id) ? content : setFrontmatterProperty(content, ALSO_IN_KEY, [...list, id])
  })
}

/** The ids of the folder at `dir` and of every folder under it. */
const idsUnder = (folders: readonly IndexRecord[], dir: string): Set<unknown> => new Set(folders.filter((folder) => inFolder(dirname(folder.path), dir)).map((folder) => folder.id))

/**
 * Take the note at `path` out of the folder at `dir` (E5): the ids of that folder and of every
 * folder under it leave its `also_in`, and the key goes with its last entry — an emptied list is
 * no list, the comments store's rule (`shared/comments.ts`). The note itself stays where it lives,
 * and in the same write drops the values of the folders that no longer show it (D20).
 */
export function removeShortcut(dir: string, path: string, folders: readonly IndexRecord[], root: string): Promise<unknown> {
  const ids = idsUnder(folders, dir)
  const tidy = dropStaleFolderValues(root, path, folders)
  return transformFile(path, (content) => {
    const list = alsoInEntries(propertiesOf(content))
    const kept = list.filter((entry) => !ids.has(entry))
    return kept.length === list.length ? content : tidy(setFrontmatterProperty(content, ALSO_IN_KEY, kept.length === 0 ? undefined : kept))
  })
}

/** The properties of a note living in `folder` without its stale blocks (D20): what shows it is asked of these properties' own `also_in`. */
function withoutLeftFolders(properties: Record<string, unknown>, folder: string, folders: readonly IndexRecord[]): Record<string, unknown> {
  if (properties[FOLDER_VALUES_KEY] === undefined) return properties
  const byId = foldersById(folders)
  const showing = new Set(foldersShowing(folder, properties, byId))
  // By the folder, never back through `byId`: of two folders still sharing an id, either may be the one showing it.
  const ids = folders.flatMap((record) => (record.id !== undefined && showing.has(record.folder) ? [record.id] : []))
  return withoutStaleFolderValues(properties, new Set(ids), new Set(byId.keys()))
}

/**
 * A folder's values leave the note when the note leaves the folder (D20), as a change to the bytes
 * about to be written: the note at `path` without the blocks of the folders that exist (`folders`,
 * the index's settings records) and do not show it. Only ever part of a write the user caused —
 * a move, "Remove shortcut", a value — never a pass of its own. A note outside the vault, which
 * the index cannot speak for, and one that will not parse are left as they are.
 */
export function dropStaleFolderValues(root: string, path: string, folders: readonly IndexRecord[]): ContentTransform {
  const rel = relTo(root, path)
  return (content) => {
    if (rel === path) return content
    const properties = propertiesOf(content)
    const kept = withoutLeftFolders(properties, dirname(rel), folders)
    if (kept === properties) return content
    // Each stale block goes where it stands, so the blocks that stay are not laid out again.
    const stay = Object.keys((kept[FOLDER_VALUES_KEY] as object | undefined) ?? {})
    if (stay.length === 0) return setFrontmatterProperty(content, FOLDER_VALUES_KEY, undefined)
    return Object.keys(properties[FOLDER_VALUES_KEY] as object).reduce((next, id) => (stay.includes(id) ? next : setFrontmatterIn(next, [FOLDER_VALUES_KEY, id], undefined)), content)
  }
}

/** One in-app move or rename of a note or a folder, as the rename door and a pasted Cut name it. */
export interface Move {
  oldPath: string
  newPath: string
  kind: 'file' | 'dir'
}

/** The PRE-move index snapshot a move is judged on. */
interface Snapshot {
  root: string
  records: readonly IndexRecord[]
  folders: readonly IndexRecord[]
}

/**
 * The notes a move leaves holding a stale block (D20), decided on the snapshot: each with its new
 * path and the properties it keeps, and the folders as they stand `after` — those that moved keep
 * their ids, so they are asked at their new place.
 */
function staleAfterMove({ root, oldPath, newPath, kind, records, folders }: Move & Snapshot): { after: IndexRecord[]; stale: { record: IndexRecord; path: string; kept: Record<string, unknown> }[] } {
  const moved = (path: string): string => (path === oldPath || (kind === 'dir' && path.startsWith(`${oldPath}/`)) ? newPath + path.slice(oldPath.length) : path)
  const after = folders.map((folder) => {
    const path = moved(folder.path)
    return path === folder.path ? folder : { ...folder, path, folder: dirname(relTo(root, path)) }
  })
  const stale = records.flatMap((record) => {
    const path = moved(record.path)
    if (path === record.path) return []
    const kept = withoutLeftFolders(record.properties, dirname(relTo(root, path)), after)
    return kept === record.properties ? [] : [{ record, path, kept }]
  })
  return { after, stale }
}

/**
 * After an in-app move or rename of a note or a folder (D20): each note that moved drops the
 * values of the folders it left. `records` and `folders` are the PRE-move snapshot. Which notes
 * hold a stale block is decided on the snapshot — a rename, or a move under the same folders,
 * reads and writes nothing. A note that cannot be written keeps its blocks until a value of it is
 * next written.
 */
export async function dropFolderValuesAfterMove(move: Move & Snapshot): Promise<void> {
  const { after, stale } = staleAfterMove(move)
  for (const { path } of stale) await transformFile(path, dropStaleFolderValues(move.root, path, after)).catch(() => undefined)
}

/** What a gesture would clear (D21): how many notes, and the folders whose values go — their directories, nearest to the note first. */
export interface LeftBehind {
  notes: number
  folders: string[]
}

/** The directories of the folders whose blocks leave `record` when its properties become `kept`, nearest to the note first (`foldersShowing`). */
function clearedFolders(record: IndexRecord, kept: Record<string, unknown>, folders: readonly IndexRecord[]): string[] {
  const stay = (kept[FOLDER_VALUES_KEY] ?? {}) as object
  const byId = foldersById(folders)
  const near = foldersShowing(record.folder, record.properties, byId)
  // A folder that did not show the note comes last.
  const rank = (folder: IndexRecord): number => (near.includes(folder.folder) ? near.indexOf(folder.folder) : near.length)
  // Only a block whose folder is known ever goes, so each id has its record.
  const gone = Object.keys((record.properties[FOLDER_VALUES_KEY] ?? {}) as object).flatMap((id) => (Object.hasOwn(stay, id) ? [] : [byId.get(id)!]))
  return gone.sort((a, b) => rank(a) - rank(b)).map((folder) => dirname(folder.path))
}

/**
 * What `moves` would clear (D21), for the sheet that asks first: D20's own answer, from a
 * snapshot, each move judged alone as its clearing is. Across notes the folders are the union, in
 * the order first met. Advice only: what a move clears is decided again when it runs.
 */
export function valuesLeftBehind({ moves, ...snapshot }: Snapshot & { moves: readonly Move[] }): LeftBehind {
  const notes = new Set<string>()
  const dirs = new Set<string>()
  for (const move of moves) {
    for (const { record, kept } of staleAfterMove({ ...move, ...snapshot }).stale) {
      notes.add(record.path)
      for (const dir of clearedFolders(record, kept, snapshot.folders)) dirs.add(dir)
    }
  }
  return { notes: notes.size, folders: [...dirs] }
}

/** What "Remove shortcut" would clear (D21), from a snapshot: the note at `path` without its `also_in` entries for `dir` and the folders under it. */
export function valuesLeftByShortcut(dir: string, path: string, records: readonly IndexRecord[], folders: readonly IndexRecord[]): LeftBehind {
  const record = records.find((r) => r.path === path)
  if (record === undefined) return { notes: 0, folders: [] }
  const ids = idsUnder(folders, dir)
  const without = { ...record.properties, [ALSO_IN_KEY]: alsoInEntries(record.properties).filter((entry) => !ids.has(entry)) }
  const cleared = clearedFolders(record, withoutLeftFolders(without, record.folder, folders), folders)
  return { notes: cleared.length === 0 ? 0 : 1, folders: cleared }
}
