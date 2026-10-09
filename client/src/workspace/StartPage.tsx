/**
 * The new tab page (YAZ-2663 D3): what a new tab (⌘T) and a window with no tabs show in the page
 * area. Three columns of rows: the pages last on show, the favorites, and what is used a lot and is
 * no favorite yet (D4). App mounts it only while it shows (R1), so everything here is read when the
 * page shows and followed while it does:
 *   - the open history and the order of the favorites across vaults, off the app state the window
 *     already holds (`storage`);
 *   - each vault's favorites, read one time and again on `favorites.onChanged`;
 *   - what is on the disk, and whether it is a file or a folder, off the window's one tree feed.
 */
import { useEffect, useReducer, useState, type MouseEvent } from 'react'
import { rootOfPath, stripSlash, type TreeNode } from '@shared/types'
import { api } from '../api'
import type { NoticeKind } from '../lib/notice'
import { pageLabel, useLatestTrees, type PathTitles } from '../lib/pageLabel'
import { dirname, relTo } from '../lib/paths'
import { relativeTime } from '../lib/relativeTime'
import { storage } from '../lib/storage'
import { fetchTree } from '../lib/treeFeed'
import { favoriteOrder, findNode } from '../lib/treeState'
import { suggestFavorites } from './suggestFavorites'
import './startPage.css'

/** "Recent" and "Favorites" show this many rows at most (YAZ-2663 D3). */
export const START_ROWS = 8

/** The columns in their order, each with the one grey line it shows when it has no rows (S19). */
const COLUMNS = [
  { col: 'recent', label: 'Recent', empty: 'Pages you open show here.' },
  { col: 'favorites', label: 'Favorites', empty: 'No favorites yet. Right-click a file or folder → Add to favorites.' },
  { col: 'suggested', label: 'Used a lot, not a favorite yet', empty: 'Nothing to suggest now.' },
] as const

/** A row: a path the Files tree holds, as its node there. `last` is when it was last on show ("Recent" alone says it). */
interface Row {
  path: string
  node: TreeNode
  last?: number
}

export interface StartPageProps {
  /** The window's vaults, in the window's order (YAZ-2602 D1). */
  roots: readonly string[]
  titles: PathTitles
  /** A click on a file (S21): App opens it as a sidebar click does, so it fills the blank tab. */
  onOpen: (path: string) => void
  /** ⌘-click on a file (S21): a background tab, and the page stays. */
  onOpenBackground: (path: string) => void
  /** A click on a folder (S22): App shows it in Files, open, with the keyboard focus on its row. */
  onShowFolder: (path: string) => void
  onNotice: (message: string, kind?: NoticeKind) => void
}

export function StartPage({ roots, titles, onOpen, onOpenBackground, onShowFolder, onNotice }: StartPageProps) {
  // What is on the disk (S18) is the Files tree's to say: it alone knows a folder from a file, and
  // holds the pages that are no notes. The window's one feed keeps the newest tree of each vault
  // with the sidebar hidden too, but then nothing reads a new one when a note goes. So the page
  // asks for ONE tree of each vault when it shows — the same request the sidebar makes, where both
  // mount in one commit (YAZ-2191) — and no row asks anything.
  const trees = useLatestTrees(roots)
  useEffect(() => {
    for (const vault of roots) fetchTree(vault).catch(() => undefined) // a vault whose folder is gone is App's to drop
  }, [roots])
  // The record, the Favorites order across vaults (YAZ-2631 D1) and the names of the vaults are in
  // the app state (R1): a use that the main process adds, in any window, draws the page again.
  const [, redraw] = useReducer((n: number) => n + 1, 0)
  useEffect(() => storage.subscribe(redraw), [])
  // Each vault's favorites (R1), as the sidebar reads them (`useVaultTree`): one read when the page
  // shows, and one more on each `favorites:changed` for a vault of the window.
  const [favoritesByRoot, setFavoritesByRoot] = useState<Readonly<Record<string, readonly string[]>>>({})
  useEffect(() => {
    let shown = true
    const read = (vault: string): void =>
      void api.favorites.get(vault).then(
        (list) => {
          if (shown) setFavoritesByRoot((held) => ({ ...held, [vault]: list }))
        },
        () => undefined, // a list that cannot be read stays unread: its rows do not show, and nothing is suggested
      )
    roots.forEach(read)
    const off = api.favorites.onChanged((change) => {
      if (roots.includes(change.root)) read(change.root)
    })
    return () => {
      shown = false
      off()
    }
  }, [roots])

  const now = Date.now()
  const many = roots.length > 1
  /** `path` as the tree of its vault holds it; null when that tree has not landed, or does not hold it. */
  const nodeOf = (path: string): TreeNode | null => {
    const tree = trees[roots.indexOf(rootOfPath(roots, path) ?? '')]
    return tree == null ? null : findNode(tree.tree, path)
  }
  const rowsOf = (list: readonly { path: string; last?: number }[]): Row[] =>
    list.flatMap(({ path, last }) => {
      const node = nodeOf(path)
      return node === null ? [] : [{ path, node, last }]
    })
  // A column says it is empty only when what it reads has answered: no line for a list nobody has read yet.
  const treesLanded = trees.every((tree) => tree !== null)
  const favoritesRead = treesLanded && roots.every((vault) => favoritesByRoot[vault] !== undefined)
  const records = roots.map((vault) => ({ root: vault, opens: storage.getOpens(vault) }))
  const favoritePaths = favoriteOrder(roots, favoritesByRoot, storage.getFavoritesOrder())
  const columns: Record<(typeof COLUMNS)[number]['col'], { rows: Row[]; read: boolean }> = {
    // S12: the pages last on show, the newest first, of every vault.
    recent: {
      rows: rowsOf(records.flatMap(({ opens }) => Object.entries(opens).map(([path, stat]) => ({ path, last: stat.last }))).sort((a, b) => b.last - a.last)).slice(0, START_ROWS),
      read: treesLanded,
    },
    // S13: the order of the Favorites tab; a favorite with no file on this machine draws no row there either (YAZ-1766 D14).
    favorites: { rows: rowsOf(favoritePaths.map((path) => ({ path }))).slice(0, START_ROWS), read: favoritesRead },
    // S14 to S17. Until every list of favorites is read, a favorite would show here as a suggestion.
    suggested: { rows: favoritesRead ? rowsOf(suggestFavorites(records, favoritePaths, now, (path) => nodeOf(path)?.type ?? null)) : [], read: favoritesRead },
  }

  const activate = (e: MouseEvent, { path, node }: Row): void => {
    if (node.type === 'dir') return onShowFolder(path)
    // No viewer in the app (YAZ-1577 D2): the OS default app is the viewer, as on its row of the sidebar. No tab.
    if (node.kind === null) return void api.shell.openDefault({ path }).catch((err: unknown) => onNotice(`Can't open "${pageLabel(path, false, titles)}": ${err instanceof Error ? err.message : String(err)}`, 'error'))
    if (e.metaKey) onOpenBackground(path)
    else onOpen(path)
  }

  return (
    <div className="start">
      <div className="start__columns">
        {COLUMNS.map(({ col, label, empty }) => (
          <section key={col} className="start__column" data-col={col} aria-label={label}>
            <h2 className="start__heading">{label}</h2>
            {columns[col].rows.length === 0 ? (
              columns[col].read && <p className="start__empty">{empty}</p>
            ) : (
              <ul className="start__rows">
                {columns[col].rows.map((row, at) => {
                  const vault = rootOfPath(roots, row.path) ?? roots[0]
                  const folder = row.node.type === 'dir'
                  const dir = dirname(row.path)
                  return (
                    <li key={row.path}>
                      {/* `data-col` and `data-row` say where the row stands: the arrow keys walk by them (YAZ-2674). */}
                      <button type="button" className={`start__row${folder ? ' start__row--dir' : ''}`} data-path={row.path} data-col={col} data-row={at} data-kind={row.node.type} title={row.path} onClick={(e) => activate(e, row)}>
                        {folder && <span className="tree__chevron" />}
                        <span className="start__name">{pageLabel(row.path, folder, titles)}</span>
                        {/* The folder the row is in, as the tab board names it; a row at the top of its vault names none. */}
                        {dir !== stripSlash(vault) && <span className="start__where">{relTo(vault, dir).split('/').join(' / ')}</span>}
                        {/* S20: the tag of a top row of the Favorites tab (YAZ-2631 D4), by what the app calls the vault. */}
                        {many && <span className="tree__vault">{storage.vaultName(vault)}</span>}
                        {row.last !== undefined && <span className="start__when">{relativeTime(row.last, now)}</span>}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  )
}
