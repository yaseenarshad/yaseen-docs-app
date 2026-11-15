/**
 * Columns flow down (YAZ-4713 C2): a folder page shows its own columns and the columns of every folder above it. A
 * column's DEFINITION lives in the `.folder.md` of the folder that declares it (its OWNER); when two folders on the
 * chain declare the same key, the nearest one wins. A note's VALUE is one field of the note (C1), whatever page shows it.
 */
import { findKey, keyFold } from '@shared/propertyKeys'
import { isReadOnlyProperties } from '@shared/readOnly'
import { basename, dirname } from '../lib/paths'
import { inFolder, type FolderPagesSettings, type IndexRecord } from '@shared/types'
import { folderSettings, type ColumnDecl } from './folderSettings'

/** The settings records by the folder each configures (root-relative, '' is the vault root). Build it once per index snapshot. */
export type FolderMap = ReadonlyMap<string, IndexRecord>

export const byFolder = (folders: readonly IndexRecord[]): FolderMap => new Map(folders.map((r) => [r.folder, r]))

/** One column of a folder page: its definition, and the folder that declares it (root-relative, '' is the vault root). */
export interface PageColumn {
  decl: ColumnDecl
  owner: string
  /** This folder's own column over a parent folder's (C6 "Change on <folder> only"): the nearest parent that declares the key too. */
  over?: string
}

/** `folder` and each folder above it, nearest first: `a/b` → `a/b`, `a`, ''. */
export function selfAndAncestors(folder: string): string[] {
  const out = [folder]
  for (let at = folder; at !== ''; out.push(at)) at = dirname(at)
  return out
}

/**
 * The columns of the page of `folder`: `own` (the page's live declarations) first, then, with `inherit`, each parent
 * folder's from the index, nearest first. "Separate value for <folder>" (C3) is each page's own switch, so an inherited
 * definition never carries it. Pure; the page memoizes it per index snapshot.
 *
 * YAZ-4769 (one key, capitals ignored): keys are compared by `keyFold`, so Desserts' `dessert column` under Recipes'
 * `Dessert Column` is ONE column — Desserts' own copy over Recipes' (`over`), never a second column. The page spells a
 * column as the declaration it uses spells it: its own copy's, else the nearest parent's. A folder that declares two
 * spellings of one key keeps the first.
 */
export function pageColumns(own: Readonly<Record<string, ColumnDecl>>, folder: string, folders: FolderMap, ids: boolean, inherit: boolean): Record<string, PageColumn> {
  const out: Record<string, PageColumn> = {}
  /** The page's spelling of each key, by fold. */
  const spelled = new Map<string, string>()
  for (const [key, decl] of Object.entries(own)) {
    const fold = keyFold(key)
    if (spelled.has(fold)) continue
    spelled.set(fold, key)
    out[key] = { decl, owner: folder }
  }
  if (!inherit) return out
  for (const dir of selfAndAncestors(folder).slice(1)) {
    const record = folders.get(dir)
    if (record === undefined) continue
    for (const [key, { separate: _own, ...decl }] of Object.entries(folderSettings(record, ids).columns)) {
      const fold = keyFold(key)
      const at = spelled.get(fold)
      if (at === undefined) {
        spelled.set(fold, key)
        out[key] = { decl, owner: dir }
      } else if (out[at].owner === folder && out[at].over === undefined) out[at] = { ...out[at], over: dir }
    }
  }
  return out
}

/** `folder`'s own declaration of `key` (YAZ-4769: under whichever spelling it uses), and that spelling; undefined when it declares none. */
export function declarationOf(folders: FolderMap, ids: boolean, folder: string, key: string): { key: string; decl: ColumnDecl } | undefined {
  const columns = folderSettings(folders.get(folder), ids).columns
  const held = Object.hasOwn(columns, key) ? key : findKey(Object.keys(columns), key)
  return held === undefined ? undefined : { key: held, decl: columns[held] }
}

/**
 * Does the page of `dir` take `key`'s definition from `owner` (YAZ-4713 C6, C7)? True when no folder from `dir` up to
 * `owner` (not `owner` itself) declares the key. A `dir` outside `owner` is a shortcut's home: its note is on `owner`'s
 * page, so it counts too. `cache` keeps one answer per folder for one walk over many notes.
 */
export function takesFrom(folders: FolderMap, ids: boolean, dir: string, owner: string, key: string, cache = new Map<string, boolean>()): boolean {
  if (dir === owner || !inFolder(dir, owner)) return true
  const known = cache.get(dir)
  if (known !== undefined) return known
  const record = folders.get(dir)
  // YAZ-4769: a subfolder that declares `key` in any capitals declares it.
  const answer = !(record !== undefined && findKey(Object.keys(folderSettings(record, ids).columns), key) !== undefined) && takesFrom(folders, ids, dirname(dir), owner, key, cache)
  cache.set(dir, answer)
  return answer
}

/**
 * The `.folder.md`s below `owner` whose page takes `key` from it (C6, C7), less read-only pages (D36): the pages whose
 * views follow an option rename or lose a deleted column.
 */
export function foldersTaking(folders: FolderMap, ids: boolean, owner: string, key: string): IndexRecord[] {
  const cache = new Map<string, boolean>()
  return [...folders.values()].filter((r) => r.folder !== owner && inFolder(r.folder, owner) && !isReadOnlyProperties(r.properties) && takesFrom(folders, ids, r.folder, owner, key, cache))
}

/** What the column UI calls a folder (C6, C11): its title, else its directory's name; the vault's name at the root. "From Schema". */
export function folderName(folders: FolderMap, dir: string, vaultName: string): string {
  if (dir === '') return vaultName
  return folders.get(dir)?.title ?? basename(dir)
}

/**
 * The ask's words for a column move (YAZ-4769), in a note's Edit property and a folder page's Edit column alike: what
 * each folder gains or loses. `from` or `to` null: making a column, or removing one. The notes keep their values.
 */
export function moveColumnText(key: string, from: string | null, to: string | null, down = false): string {
  // A move down (YAZ-4769 demo): the folder it leaves and its other subfolders lose it, so the ask says so.
  if (from !== null && to !== null && down) return `Move the "${key}" column from ${from} down to ${to}? ${to} and every folder below it show it. ${from} and its other folders stop showing it. The notes keep their values.`
  if (from !== null && to !== null) return `Move the "${key}" column from ${from} to ${to}? ${to} and every folder below it show it. ${from} no longer defines it. The notes keep their values.`
  if (from !== null) return `Remove the "${key}" column from ${from}? No folder page shows it as a column. The notes keep their values.`
  return `Make "${key}" a column on ${to}? ${to} and every folder below it show it. The notes keep their values.`
}

/**
 * D36: a read-only folder page's `.folder.md` takes no column write, from its own page or from any other door (a page
 * below it, the note's properties panel). The refusal's words, or null when `dir`'s page is not read only.
 */
export function readOnlyRefusal(folders: FolderMap, dir: string, vaultName: string): string | null {
  const record = folders.get(dir)
  return record !== undefined && isReadOnlyProperties(record.properties) ? `${folderName(folders, dir, vaultName)}'s folder page is read only` : null
}

/**
 * An inherited definition as its owner stores it: `decl` (the page's copy, which never carries the switch) with the
 * owner's own "Separate value for <owner>" (C3) back on. An edit from below compares with and writes this, so the
 * owner keeps its switch.
 */
export function withOwnerSwitch(decl: ColumnDecl, stored: ColumnDecl | undefined): ColumnDecl {
  return stored?.separate === true ? { ...decl, separate: true } : decl
}

/** Where one column of a page comes from, in the names the UI says (C6, C11). Neither field: this folder's own column. */
export interface ColumnSource {
  /** A parent folder defines it: that folder's name ("From Schema"). */
  from?: string
  /** This folder's own column over a parent's ("Change on Orders only"): the parent's name ("Use Schema's"). */
  over?: string
  /** C11: a column shown here through "Other properties" whose definition lives on a subfolder: the subfolders' names ("From Desserts", "From Desserts, Pies"). */
  below?: string
  /** No column on this page or below: a field only in the notes, shown through "Other properties" (YAZ-4713 C11B): the ◌ mark. */
  loose?: true
}

/**
 * The page's doors for where its columns come from (YAZ-4713 C6, C11): the folder's name ("Separate value for
 * Desserts"), whether the headers show the source icons, each column's source, and the two moves of Edit column.
 */
export interface ColumnSources {
  /** This folder's name: its title, else its directory's name; the vault's name at the root. */
  folderName: string
  /** C11: the header's mark — the icon (↳ parent, ↑ subfolder, lock separate), the icon and the folder's name, or none. The folder's ⚙, else Settings › Folder pages. */
  marks: FolderPagesSettings['columnMarks']
  of: (key: string) => ColumnSource
  /** "Change on <folder> only": the column as the page shows it, declared on this folder. */
  here: (key: string) => Promise<unknown>
  /** "Use <parent>'s": this folder's own declaration goes, and the parent's shows again. A toast offers Undo. */
  useParent: (key: string) => Promise<unknown>
  /**
   * "Column on" (YAZ-4769, the note's Edit property's picker): the folder that defines the column now and the folders
   * that may: this one, each above it (nearest first), then each below it (the YAZ-4769 demo: "I want to move it down
   * to desserts"), each with its name and its place. Null where the column does not move from here: none of this
   * folder's, one "Desserts only" copy, a separate value, a Linked mentions column, a read-only page, or nowhere to go.
   */
  columnOn: (key: string) => { at: string; choices: { dir: string; name: string; place: 'here' | 'above' | 'below' }[] } | null
  /** Move the column's definition to folder `to`, one of `columnOn`'s choices. The notes keep their values; a toast offers Undo. */
  moveTo: (key: string, to: string) => Promise<unknown>
}
