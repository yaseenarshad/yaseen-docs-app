/**
 * Shortcuts (YAZ-2290 D2): the pure half of `client/src/links/shortcuts.ts`, shared so the sidebar and the
 * CLI's shortcut commands (YAZ-4518) make the same change. A note lives in exactly ONE folder and may also
 * APPEAR in others: its `also_in` holds the ids of those folders, a folder's id being its `.folder.md`'s.
 */
import { ALSO_IN_KEY, alsoIn, alsoInEntries } from './alsoIn'
import { foldersById } from './folderRecords'
import { FOLDER_VALUES_KEY, withoutStaleFolderValues } from './folderValues'
import { parseFrontmatter, setFrontmatterIn, setFrontmatterProperty, splitFrontmatter } from './frontmatter'
import { NOTE_ID_KEY, canonicalNoteId, isNoteId } from './noteId'
import { dirname, relTo } from './paths'
import { inFolder, type IndexRecord } from './types'

/** One pure change of a file's bytes, applied against what is on disk now. */
export type ContentTransform = (content: string) => string

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

/** Whether a row `folder` shows is there by a shortcut: it does not live under it. */
export const isShortcut = (record: IndexRecord, folder: string): boolean => !inFolder(record.folder, folder)

export const propertiesOf = (content: string): Record<string, unknown> => parseFrontmatter(splitFrontmatter(content).frontmatter).properties


/** The folder id `bytes` (a `.folder.md`) holds, as the index holds it; undefined for none, or another tool's (YAZ-2420 🔒 D30). */
export function heldFolderId(bytes: string): string | undefined {
  const id = propertiesOf(bytes)[NOTE_ID_KEY]
  return isNoteId(id) ? canonicalNoteId(id) : undefined
}

/** A note that also appears in the folder with `id`: the id joins its `also_in` — once, and beside every entry already there, understood or not. */
export function withShortcut(content: string, id: string): string {
  const list = alsoInEntries(propertiesOf(content))
  return list.some((entry) => asId(entry) === id) ? content : setFrontmatterProperty(content, ALSO_IN_KEY, [...list, id])
}

/** A note out of the folders with `ids` (E5): they leave its `also_in`, the key goes with its last entry, and `tidy` drops the values of the folders that no longer show it (D20). */
export function withoutShortcut(content: string, ids: ReadonlySet<unknown>, tidy: ContentTransform): string {
  const list = alsoInEntries(propertiesOf(content))
  const kept = list.filter((entry) => !ids.has(asId(entry)))
  return kept.length === list.length ? content : tidy(setFrontmatterProperty(content, ALSO_IN_KEY, kept.length === 0 ? undefined : kept))
}

/** An `also_in` entry as the id it names (`alsoIn`'s reading, YAZ-2677 R2: `yaz-12` names `YAZ-12`); any other entry as it is. */
export const asId = (entry: unknown): unknown => (isNoteId(entry) ? canonicalNoteId(entry) : entry)

/** The ids of the folder at `dir` and of every folder under it. */
export const idsUnder = (folders: readonly IndexRecord[], dir: string): Set<unknown> => new Set(folders.filter((folder) => inFolder(dirname(folder.path), dir)).map((folder) => folder.id))

/** The properties of a note living in `folder` without its stale blocks (D20): what shows it is asked of these properties' own `also_in`. */
export function withoutLeftFolders(properties: Record<string, unknown>, folder: string, folders: readonly IndexRecord[]): Record<string, unknown> {
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

/** What a gesture would clear (D21): how many notes, and the folders whose values go — their directories, nearest to the note first. */
export interface LeftBehind {
  notes: number
  folders: string[]
}

/** The directories of the folders whose blocks leave `record` when its properties become `kept`, nearest to the note first (`foldersShowing`). */
export function clearedFolders(record: IndexRecord, kept: Record<string, unknown>, folders: readonly IndexRecord[]): string[] {
  const stay = (kept[FOLDER_VALUES_KEY] ?? {}) as object
  const byId = foldersById(folders)
  const near = foldersShowing(record.folder, record.properties, byId)
  // A folder that did not show the note comes last.
  const rank = (folder: IndexRecord): number => (near.includes(folder.folder) ? near.indexOf(folder.folder) : near.length)
  // Only a block whose folder is known ever goes, so each id has its record.
  const gone = Object.keys((record.properties[FOLDER_VALUES_KEY] ?? {}) as object).flatMap((id) => (Object.hasOwn(stay, id) ? [] : [byId.get(id)!]))
  return gone.sort((a, b) => rank(a) - rank(b)).map((folder) => dirname(folder.path))
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
