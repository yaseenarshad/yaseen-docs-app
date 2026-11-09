/**
 * Columns flow down (YAZ-4713 C2): a folder page shows its own columns and the columns of every folder above it. A
 * column's DEFINITION lives in the `.folder.md` of the folder that declares it (its OWNER); when two folders on the
 * chain declare the same key, the nearest one wins. A note's VALUE is one field of the note (C1), whatever page shows it.
 */
import { basename } from '../lib/paths'
import { inFolder, type FolderPagesSettings, type IndexRecord } from '@shared/types'
import { folderSettings, type ColumnDecl } from './folderSettings'

/** One column of a folder page: its definition, and the folder that declares it (root-relative, '' is the vault root). */
export interface PageColumn {
  decl: ColumnDecl
  owner: string
  /** This folder's own column over a parent folder's (C6 "Change on this folder only"): the nearest parent that declares the key too. */
  over?: string
}

/** `folder` and each folder above it, nearest first: `a/b` → `a/b`, `a`, ''. */
export function selfAndAncestors(folder: string): string[] {
  const out = [folder]
  for (let at = folder; at !== ''; out.push(at)) at = at.includes('/') ? at.slice(0, at.lastIndexOf('/')) : ''
  return out
}

/**
 * The columns of the page of `folder`: `own` (the page's live declarations) first, then, with `inherit`, each parent
 * folder's from the index, nearest first. "Separate value on this page" (C3) is each page's own switch, so an inherited
 * definition never carries it. Pure; the page memoizes it per index snapshot.
 */
export function pageColumns(own: Readonly<Record<string, ColumnDecl>>, folder: string, folders: readonly IndexRecord[], ids: boolean, inherit: boolean): Record<string, PageColumn> {
  const out: Record<string, PageColumn> = {}
  for (const [key, decl] of Object.entries(own)) out[key] = { decl, owner: folder }
  if (!inherit) return out
  for (const dir of selfAndAncestors(folder).slice(1)) {
    const record = folders.find((r) => r.folder === dir)
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
export function takesFrom(folders: readonly IndexRecord[], ids: boolean, dir: string, owner: string, key: string, cache = new Map<string, boolean>()): boolean {
  if (dir === owner || !inFolder(dir, owner)) return true
  const known = cache.get(dir)
  if (known !== undefined) return known
  const record = folders.find((r) => r.folder === dir)
  const parent = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : ''
  const answer = !(record !== undefined && key in folderSettings(record, ids).columns) && takesFrom(folders, ids, parent, owner, key, cache)
  cache.set(dir, answer)
  return answer
}

/** What a column's owner is called (its folder's title; the vault's name at the root): "From Schema". */
export function ownerName(folders: readonly IndexRecord[], owner: string, vaultName: string): string {
  if (owner === '') return vaultName
  return folders.find((r) => r.folder === owner)?.title ?? basename(owner)
}

/** Where one column of a page comes from, in the names the UI says (C6, C11). Neither field: this folder's own column. */
export interface ColumnSource {
  /** A parent folder defines it: that folder's name ("From Schema"). */
  from?: string
  /** This folder's own column over a parent's ("Change on this folder only"): the parent's name ("Use Schema's"). */
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
  /** "Change on this folder only": the column as the page shows it, declared on this folder. */
  here: (key: string) => Promise<unknown>
  /** "Use <parent>'s": this folder's own declaration goes, and the parent's shows again. A toast offers Undo. */
  useParent: (key: string) => Promise<unknown>
}
