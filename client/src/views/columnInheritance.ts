/**
 * Columns flow down (YAZ-4713 C2): a folder page shows its own columns and the columns of every folder above it. A
 * column's DEFINITION lives in the `.folder.md` of the folder that declares it (its OWNER); when two folders on the
 * chain declare the same key, the nearest one wins. A note's VALUE is one field of the note (C1), whatever page shows it.
 */
import { basename } from '../lib/paths'
import type { IndexRecord } from '@shared/types'
import { folderSettings, type ColumnDecl } from './folderSettings'

/** One column of a folder page: its definition, and the folder that declares it (root-relative, '' is the vault root). */
export interface PageColumn {
  decl: ColumnDecl
  owner: string
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
    for (const [key, { separate: _own, ...decl }] of Object.entries(folderSettings(record, ids).columns)) if (!(key in out)) out[key] = { decl, owner: dir }
  }
  return out
}

/** What a column's owner is called (its folder's title; the vault's name at the root): "From Schema". */
export function ownerName(folders: readonly IndexRecord[], owner: string, vaultName: string): string {
  if (owner === '') return vaultName
  return folders.find((r) => r.folder === owner)?.title ?? basename(owner)
}
