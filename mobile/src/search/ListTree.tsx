import { useState, type CSSProperties } from 'react'
import { favoriteRoots } from '@client/lib/treeState'
import { copyFoldKey } from '@shared/foldKey'
import type { TreeNode } from '@shared/types'
import { useApp } from '../app/AppState'
import { vaultNodes, type VaultNodes } from './foundTree'
import type { ListKind, Scope } from './lists'
import { ICON_KIND, RowIcon } from './rowIcon'
import { ShowMore, treeRoute } from './SearchTree'
import type { VaultData } from './vaultData'
import { fileKind, type TreeKind } from './vaultTree'

/** What a list is called, and its line when it holds nothing the phone can show. */
const WORDS: Record<ListKind, { title: string; none: string }> = {
  favorites: { title: 'Favorites', none: 'No favorites in this vault yet. Add them on the Mac.' },
}

/** One drawn row of a list. */
export interface ListRow {
  kind: TreeKind
  path: string
  label: string
  depth: number
  /** The fold key (a folder's): `copyFoldKey(top, path)`, as the Mac's Favorites tab folds a copy. */
  key: string
  open?: boolean
  id?: string
}

/** The folds of each list of each vault, kept while the app runs (the Mac keeps its folds for the session). */
const folds = new Map<string, Set<string>>()
const foldsOf = (vault: string | null, kind: ListKind): Set<string> => {
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
 */
export function listRows(vault: VaultNodes, top: readonly string[], open: ReadonlySet<string>, cards: boolean): ListRow[] {
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
  for (const node of favoriteRoots(vault.nodes, top)) walk(node, 0, node.path)
  return rows
}

/** A list filter on with an empty box (YAZ-5452): the list under its name, or its plain line when it holds nothing. */
export function ListTree({ data, cards, shown, onMore, scope }: { data: VaultData; cards: boolean; shown: number; onMore: () => void; scope: Scope }) {
  const app = useApp()
  const [, setTurn] = useState(0)
  if (scope.loading === true) return null
  const words = WORDS[scope.kind]
  const open = foldsOf(app.vaultKey, scope.kind)
  const rows = listRows(vaultNodes(data), scope.top, open, cards)
  if (rows.length === 0) return <p className="muted search__none">{words.none}</p>
  const toggle = (key: string) => {
    if (open.has(key)) open.delete(key)
    else open.add(key)
    setTurn((n) => n + 1)
  }
  return (
    <>
      <h2 className="section">{words.title}</h2>
      <ul className="tree" role="tree" aria-label={words.title}>
        {rows.slice(0, shown).map((row) => (
          <li key={row.key} role="treeitem" aria-expanded={row.kind === 'folder' ? row.open : undefined}>
            <button
              type="button"
              className={`tree__row tree__row--${row.kind === 'folder' ? 'dir' : 'file'}`}
              data-kind={ICON_KIND[row.kind]}
              style={{ '--tree-depth': row.depth } as CSSProperties}
              aria-label={`${row.label}, ${row.kind === 'folder' ? 'folder' : row.kind === 'card' ? 'card' : app.unit('page')}`}
              onClick={() => (row.kind === 'folder' ? toggle(row.key) : app.go({ type: 'open', route: treeRoute(row) }))}
            >
              <span className={row.kind === 'folder' ? `tree__chevron${row.open === true ? ' tree__chevron--open' : ''}` : 'tree__chevron tree__chevron--none'} aria-hidden />
              <RowIcon kind={row.kind} open={row.open === true} />
              <span className="tree__label">{row.label}</span>
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
