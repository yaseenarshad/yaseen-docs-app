import type { CSSProperties } from 'react'
import { favoriteRoots } from '@client/lib/treeState'
import { copyFoldKey } from '@shared/foldKey'
import type { TreeNode } from '@shared/types'
import { useApp } from '../app/AppState'
import { vaultNodes, type VaultNodes } from './foundTree'
import type { ListFolder, ListKind, Scope } from './lists'
import type { RecentEntry } from './recent'
import { bumpFolds, useFolds } from './folds'
import { ICON_KIND, RowIcon } from './rowIcon'
import { ShowMore, TreeId, kindWord, treeRoute } from './SearchTree'
import { rowId, useIdsForm } from './showIds'
import type { VaultData } from './vaultData'
import { fileKind, fileLabel, type TreeKind } from './vaultTree'
import { openFile } from '../explore/openFile'
import { fileRecord } from '../drawing/boardFiles'
import { TreeLook } from './treeLook'

/** What a list is called, and its line when it holds nothing the phone can show. */
const WORDS: Record<ListKind, { title: string; none: string }> = {
  favorites: { title: 'Favorites', none: 'No favorites in this vault yet. Add them on the Mac.' },
  focus: { title: 'Focus', none: 'Nothing in focus in this vault yet. Add it on the Mac.' },
  recent: { title: 'Recent', none: 'Nothing opened on this phone yet.' },
}

/** One drawn row of a list. */
export interface ListRow {
  /** `group`: a folder of the tab (YAZ-4460), the Mac's stack glyph, never a folder on disk. */
  kind: TreeKind | 'group'
  path: string
  label: string
  depth: number
  /** The fold key (a folder's): `copyFoldKey(top, path)`, as the Mac's Favorites tab folds a copy. */
  key: string
  open?: boolean
  id?: string
  /** A card in a page (Recent): it opens alone, as a search row of it does. */
  inPage?: true
}

/** The fold key of a folder of the tab: a NUL never stands in a path, so it is no path's. */
export const groupKey = (id: string): string => `\0${id}`

/** The stack glyph of a folder of the tab (the Mac's `StackIcon`, `FocusFolderList.tsx`, drawn the same). */
const StackIcon = () => (
  <svg className="file-icon focus-folder__icon" data-kind="group" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden>
    <path d="M8 2 2 5l6 3 6-3-6-3Z" />
    <path d="m2 8 6 3 6-3" />
    <path d="m2 11 6 3 6-3" />
  </svg>
)

/** The folds of each list of each vault, kept while the app runs (the Mac keeps its folds for the session). */
const folds = new Map<string, Set<string>>()
export const foldsOf = (vault: string | null, kind: ListKind): Set<string> => {
  const key = `${vault}\n${kind}`
  let set = folds.get(key)
  if (set === undefined) folds.set(key, (set = new Set()))
  return set
}

/**
 * The rows of a list (YAZ-5452), as the Mac's Favorites tab draws them (`Sidebar.tsx`, YAZ-1766 D4): the Mac's own
 * `favoriteRoots` gives the top rows, every listed path the tree still holds in the list's STORED order (the user's,
 * never the tree's), files and folders alike; a path that is gone simply has no row (D14: the Mac drops it at its
 * next write; the phone, read only, hides it). A listed folder opens in place like a folder of the tree, its rows in
 * the tree's order; a file listed beside its listed folder shows at the top AND inside it, each copy folded on its
 * own (`copyFoldKey`). A card file shows only while Review is on, as in the tree.
 *
 * Above the top rows, the tab's folders (YAZ-4460 F3, `FocusFolderList.tsx`): a row with the stack glyph and the
 * name, open at first (the Mac opens every one at launch), its items under it, one step in. `open` holds the fold
 * keys of the open tree folders, and of the tab's folders that were SHUT.
 */
export function listRows(vault: VaultNodes, folders: readonly ListFolder[], top: readonly string[], open: ReadonlySet<string>, cards: boolean): ListRow[] {
  const rows: ListRow[] = []
  const walk = (node: TreeNode, depth: number, from: string) => {
    if (node.type === 'dir') {
      const key = copyFoldKey(from, node.path)
      const isOpen = open.has(key)
      rows.push({ kind: 'folder', path: node.path, label: node.name, depth, key, open: isOpen })
      if (isOpen) for (const child of node.children) walk(child, depth + 1, from)
      return
    }
    const record = vault.records.get(node.path)
    if (record === undefined) return
    const kind = fileKind(record)
    if (kind === 'card' && !cards) return
    const id = kind === 'card' ? (record.cards?.find((c) => c.id !== null)?.id ?? undefined) : undefined
    rows.push({ kind, path: node.path, label: node.name, depth, key: copyFoldKey(from, node.path), ...(id != null && { id }) })
  }
  for (const folder of folders) {
    const key = groupKey(folder.id)
    const isOpen = !open.has(key)
    rows.push({ kind: 'group', path: key, label: folder.name, depth: 0, key, open: isOpen })
    if (isOpen) for (const node of favoriteRoots(vault.nodes, folder.paths)) walk(node, 1, `${key}\0${node.path}`)
  }
  for (const node of favoriteRoots(vault.nodes, top)) walk(node, 0, node.path)
  return rows
}

/**
 * Recent (YAZ-5457), newest first, one flat row each, as the Mac's Recents list: a page; a card file; a card in a page
 * (its title, else its ID, as search names it). One that is gone from the vault has no row. No IDs at the end: the
 * Mac's Recents rows have none either.
 */
export function recentRows(data: VaultData, recent: readonly RecentEntry[], cards: boolean): ListRow[] {
  return recent.flatMap((e): ListRow[] => {
    const record = fileRecord(data, e.path)
    if (record === undefined) return []
    const key = `${e.path}\0${e.id ?? ''}`
    if (e.id === undefined || record.kind === 'card') {
      const kind = fileKind(record)
      return kind === 'card' && !cards ? [] : [{ kind, path: e.path, label: fileLabel(record), depth: 0, key, ...(e.id !== undefined && { id: e.id }) }]
    }
    const card = record.cards?.find((c) => c.id === e.id)
    return card === undefined || !cards ? [] : [{ kind: 'card', path: e.path, label: card.title ?? e.id, depth: 0, key, id: e.id, inPage: true }]
  })
}

/** A list filter on with an empty box (YAZ-5452): the list under its name, or its plain line when it holds nothing. */
export function ListTree({ data, cards, shown, onMore, scope }: { data: VaultData; cards: boolean; shown: number; onMore: () => void; scope: Scope }) {
  const app = useApp()
  // YAZ-5474: a fold here, or Collapse all / Expand all in the box, draws the list again.
  useFolds()
  // YAZ-5454: the vault's "Show IDs in the files list": the Mac's Favorites and Focus rows show it too.
  const ids = useIdsForm(data)
  if (scope.loading === true) return null
  const words = WORDS[scope.kind]
  const open = foldsOf(app.vaultKey, scope.kind)
  const rows = scope.recent !== undefined ? recentRows(data, scope.recent, cards) : listRows(vaultNodes(data), scope.folders, scope.top, open, cards)
  if (rows.length === 0) return <p className="muted search__none">{words.none}</p>
  // YAZ-5506: the list's open folders (and the tab's own folders) stick, as on the Mac's Favorites and Focus tabs.
  const drawn = rows.slice(0, shown)
  const toggle = (key: string) => {
    if (open.has(key)) open.delete(key)
    else open.add(key)
    bumpFolds()
  }
  return (
    <>
      <h2 className="section">{words.title}</h2>
      <TreeLook rows={drawn} />
      <ul className="tree" role="tree" aria-label={words.title}>
        {drawn.map((row) => (
          <li key={row.key} role="treeitem" aria-expanded={row.kind === 'folder' || row.kind === 'group' ? row.open : undefined}>
            <button
              type="button"
              className={`tree__row tree__row--${row.kind === 'folder' || row.kind === 'group' ? 'dir' : 'file'}`}
              data-kind={row.kind === 'group' ? 'group' : ICON_KIND[row.kind]}
              style={{ '--tree-depth': row.depth } as CSSProperties}
              aria-label={`${row.label}, ${row.kind === 'group' ? `${words.title.toLowerCase()} folder` : kindWord(row.kind, app.unit('page'))}`}
              onClick={() => (row.kind === 'folder' || row.kind === 'group' ? toggle(row.key) : openFile(app, treeRoute({ ...row, kind: row.kind })))}
            >
              <span className={row.kind === 'folder' || row.kind === 'group' ? `tree__chevron${row.open === true ? ' tree__chevron--open' : ''}` : 'tree__chevron tree__chevron--none'} aria-hidden />
              {row.kind === 'group' ? <StackIcon /> : <RowIcon kind={row.kind} open={row.open === true} />}
              <span className="tree__label">{row.label}</span>
              <TreeId id={row.kind === 'folder' || row.kind === 'group' || scope.recent !== undefined ? null : rowId(data, row.path, ids)} />
            </button>
          </li>
        ))}
      </ul>
      {rows.length > shown && <ShowMore onMore={onMore} />}
    </>
  )
}

/** Forgets the folds (a test starts clean). */
export const forgetListFolds = (): void => folds.clear()
