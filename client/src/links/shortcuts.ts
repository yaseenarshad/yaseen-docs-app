/**
 * Shortcuts (YAZ-2290 D2): a notecard lives in exactly ONE folder and may also APPEAR in others.
 * The shortcut is stored on the notecard — `also_in`, a list of FOLDER IDS, a folder's id being the
 * `id` of its `.folder.md` (YAZ-2293) — so it is the same file wherever it shows, and nothing is
 * rewritten when a folder or a notecard is renamed or moved. This module is the one door to that key.
 *
 * WHAT A FOLDER SHOWS (D4): the notecards directly in it, plus the notecards whose `also_in` holds
 * its id — each once, in the index's own order. An entry no folder has (a deleted folder, a typo)
 * is ignored quietly, and a folder with no `.folder.md` has no id, so nothing is a shortcut in it.
 */
import { ALSO_IN_KEY, alsoIn, alsoInEntries } from '@shared/alsoIn'
import { parseFrontmatter, setFrontmatterProperty, splitFrontmatter } from '@shared/frontmatter'
import { NOTE_ID_KEY, isNoteId, mintNoteId } from '@shared/noteId'
import { folderSettingsPath, type IndexRecord } from '@shared/types'
import { transformFile } from '../views/writeProperty'

/** The settings record of the folder at `dir`; undefined while it has no `.folder.md`. */
export function folderRecord(folders: readonly IndexRecord[], dir: string): IndexRecord | undefined {
  const path = folderSettingsPath(dir)
  return folders.find((r) => r.path === path)
}

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

function buildRows(records: readonly IndexRecord[], folders: readonly IndexRecord[]): Map<string, IndexRecord[]> {
  const byId = foldersById(folders)
  const rows = new Map<string, IndexRecord[]>()
  for (const record of records) {
    // A Set: living in a folder and naming it, or naming it twice, is still one row.
    const shown = new Set([record.folder])
    for (const id of alsoIn(record.properties)) {
      const folder = byId.get(id)?.folder
      if (folder !== undefined) shown.add(folder)
    }
    for (const folder of shown) {
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

/** Whether a row `folder` shows is there by a shortcut: it lives somewhere else. */
export const isShortcut = (record: IndexRecord, folder: string): boolean => record.folder !== folder

const propertiesOf = (content: string): Record<string, unknown> => parseFrontmatter(splitFrontmatter(content).frontmatter).properties

/**
 * The id of the folder at `dir`, for its first shortcut: a folder with no `.folder.md` gets one
 * holding just its id (that write creates the file, `readForWrite`), and a file with no id is
 * given a fresh one. Asked of the file's own bytes, never the index: a snapshot one write behind
 * would mint a second id over the first, and every shortcut naming the first would be lost.
 */
async function folderId(dir: string): Promise<string> {
  const fresh = mintNoteId()
  const { content } = await transformFile(folderSettingsPath(dir), (bytes) =>
    propertiesOf(bytes)[NOTE_ID_KEY] == null ? setFrontmatterProperty(bytes, NOTE_ID_KEY, fresh) : bytes,
  )
  const id = propertiesOf(content)[NOTE_ID_KEY]
  // Someone else's value (`shared/noteId.ts`): never an id, never overwritten.
  if (!isNoteId(id)) throw new Error(`the id in ${folderSettingsPath(dir)} is not a page id`)
  return id
}

/**
 * Make the notecard at `path` also appear in the folder at `dir` (D2): the folder's id joins the
 * notecard's `also_in` — once, and beside every entry already there, understood or not.
 */
export async function addShortcut(dir: string, path: string): Promise<void> {
  const id = await folderId(dir)
  await transformFile(path, (content) => {
    const list = alsoInEntries(propertiesOf(content))
    return list.includes(id) ? content : setFrontmatterProperty(content, ALSO_IN_KEY, [...list, id])
  })
}

/**
 * Take the notecard at `path` out of the folder at `dir` (E5): the folder's id leaves its
 * `also_in`, and the key goes with its last entry — an emptied list is no list, the comments
 * store's rule (`shared/comments.ts`). The notecard itself stays where it lives.
 */
export function removeShortcut(dir: string, path: string, folders: readonly IndexRecord[]): Promise<unknown> {
  const id = folderRecord(folders, dir)?.id
  return transformFile(path, (content) => {
    const list = alsoInEntries(propertiesOf(content))
    const kept = list.filter((entry) => entry !== id)
    return kept.length === list.length ? content : setFrontmatterProperty(content, ALSO_IN_KEY, kept.length === 0 ? undefined : kept)
  })
}
