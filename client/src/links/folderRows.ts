/**
 * WHAT A FOLDER SHOWS, pure (YAZ-5460: the phone's folder page builds its rows with the Mac's rule and no bridge;
 * `shortcuts.ts` re-exports all of it beside the writes).
 *
 * Shortcuts (YAZ-2290 D2): a page lives in exactly ONE folder and may also APPEAR in others.
 * The shortcut is stored on the page — `also_in`, a list of FOLDER IDS, a folder's id being the
 * `id` of its `.folder.md` (YAZ-2293) — so it is the same file wherever it shows, and nothing is
 * rewritten when a folder or a page is renamed or moved. This module is the one door to that key.
 *
 * WHAT A FOLDER SHOWS (D4): the pages under it at any depth, plus those whose `also_in` holds its
 * id or the id of a folder under it — each once, in the index's order (`foldersShowing` is the
 * rule from the page's side). The vault root's entry is the pages directly in it. An `also_in`
 * entry no folder has is ignored.
 */
import { alsoIn } from '@shared/alsoIn'
import { FOLDER_SETTINGS_FILE, folderSettingsPath, inFolder, isFolderSettingsPath, type IndexRecord } from '@shared/types'
import { absFrom, basename, dirname, relTo } from '../lib/paths'
import { folderRecord, folderTitle, foldersByDir } from './folderTitle'
// A folder's title moved to its own file (YAZ-5161), so the review hook loads with no bridge; its names stay here too.
// `foldersByDir` moved there too (YAZ-5079), so the phone's search builds its rows with no bridge.
export { folderRecord, folderTitle, foldersByDir }

/** How a folder's name reads where a page's could stand: the `[[` picker's row, an id link's menu. */
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
 * The folders that SHOW a page, in order: the folder it lives in (`folder`, as the index names it)
 * and each folder above it, nearest first, then each folder its `also_in` names with the folders
 * above that one — and last the vault root (''), whose own page lists every page (YAZ-4921). A page
 * directly in the root is shown by the root alone.
 */
export function foldersShowing(folder: string, properties: Record<string, unknown>, byId: ReadonlyMap<string, IndexRecord>): string[] {
  // A Set: under a folder and naming it or one under it, or naming it twice, is still one row.
  const shown = new Set<string>()
  addWithParents(shown, folder)
  for (const id of alsoIn(properties)) {
    const named = byId.get(id)?.folder
    if (named !== undefined) addWithParents(shown, named)
  }
  shown.add('')
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
 * index never hands out as a page (D8), so the file name is the kind marker. By the name, never the
 * path: the engine asks it of every row.
 */
export const isFolderRow = (record: Pick<IndexRecord, 'name'>): boolean => record.name === FOLDER_SETTINGS_FILE

/** The page a row opens (YAZ-4579 D32): a folder row's is its folder, by the directory path a folder tab holds (D3); a page's is the page. */
export const rowPage = (path: string): string => (isFolderSettingsPath(path) ? dirname(path) : path)

/** The parent of a folder as the index names it ('' for one in the root). */
const parentOf = (folder: string): string => folder.slice(0, Math.max(0, folder.lastIndexOf('/')))

/**
 * The DIRECT subfolders of `folder` (as the index names it) as rows, in path order (YAZ-4579 D31):
 * each the subfolder's own `.folder.md` record, or, while it has none, an empty stand-in at the path
 * its first write creates (`readForWrite`). Its `folder` is the PARENT, so it sits among the
 * page's own pages; its properties are the file's own, for the host to read its values from.
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

