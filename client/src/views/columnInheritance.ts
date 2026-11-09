/**
 * Columns flow down (YAZ-4713 C2): a folder page shows its own columns and the columns of every folder above it. A
 * column's DEFINITION lives in the `.folder.md` of the folder that declares it (its OWNER); when two folders on the
 * chain declare the same key, the nearest one wins. A note's VALUE is one field of the note (C1), whatever page shows it.
 */
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
 */
export function pageColumns(own: Readonly<Record<string, ColumnDecl>>, folder: string, folders: FolderMap, ids: boolean, inherit: boolean): Record<string, PageColumn> {
  const out: Record<string, PageColumn> = {}
  for (const [key, decl] of Object.entries(own)) out[key] = { decl, owner: folder }
  if (!inherit) return out
  for (const dir of selfAndAncestors(folder).slice(1)) {
    const record = folders.get(dir)
    if (record === undefined) continue
    for (const [key, { separate: _own, ...decl }] of Object.entries(folderSettings(record, ids).columns)) {
      if (!(key in out)) out[key] = { decl, owner: dir }
      else if (out[key].owner === folder && out[key].over === undefined) out[key] = { ...out[key], over: dir }
    }
  }
  return out
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
  const answer = !(record !== undefined && key in folderSettings(record, ids).columns) && takesFrom(folders, ids, dirname(dir), owner, key, cache)
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
}
