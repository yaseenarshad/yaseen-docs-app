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
import { useEffect, useLayoutEffect, useReducer, useRef, useState, type KeyboardEvent } from 'react'
import { rootOfPath, stripSlash, type TreeNode } from '@shared/types'
import { api } from '../api'
import { focusOpenDocument } from '../lib/focusHandoff'
import type { NoticeKind } from '../lib/notice'
import { pageLabel, useLatestTrees, type PathTitles } from '../lib/pageLabel'
import { dirname, relTo } from '../lib/paths'
import { relativeTime } from '../lib/relativeTime'
import { storage } from '../lib/storage'
import { fetchTree } from '../lib/treeFeed'
import { favoriteOrder, findNode } from '../lib/treeState'
import { PREVIEW_FOLLOW_MS } from '../sidebar/hooks/useSidebarSearch'
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
  /** A click or Enter on a folder (S22), and Shift+Enter on any row (S38): App shows the row in Files — a folder open — with the keyboard focus on it. */
  onShowInFiles: (path: string) => void
  /** A right-click on a row (YAZ-2663 D6): App asks the sidebar for its own row menu of that path, at the mouse. The page has no menu. */
  onRowMenu: (path: string, x: number, y: number) => void
  /** ← on the first column that has rows, Esc, and a typed letter (S37, S41): App puts the caret in the search bar. */
  onBackToSearch: () => void
  /**
   * The way in from the empty search bar (S33): the page fills this box with its door — the
   * keyboard focus goes to the first row of the first column that has rows, and the door says
   * whether there was one — and empties it when it goes. A box and not state: App asks on a key.
   */
  focusRef: { current: (() => boolean) | null }
  /**
   * The preview panel of the search (YAZ-2662 D5) is App's: `previewPath` is the file that it draws
   * for this page, or null with no panel on show, and `onPreview` is its door. Space on a file
   * asks, and the panel then follows the keyboard focus (S39). With no door Space does nothing.
   */
  previewPath?: string | null
  onPreview?: (path: string | null) => void
  onNotice: (message: string, kind?: NoticeKind) => void
}

export function StartPage({ roots, titles, onOpen, onOpenBackground, onShowInFiles, onRowMenu, onBackToSearch, focusRef, previewPath = null, onPreview, onNotice }: StartPageProps) {
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

  // The preview panel (S39), as the search drives it (YAZ-2662 D5): "a panel is on show" is
  // `previewPath`, App's alone, so the keys here and the ✕ there cannot disagree. `parked` is what
  // App cannot hold: the preview is on and the keyboard is on a folder, so no panel is drawn.
  const [parked, setParked] = useState(false)
  const previewing = onPreview !== undefined && (previewPath !== null || parked)
  const follow = useRef<ReturnType<typeof setTimeout>>(undefined)
  const live = useRef({ previewing, onPreview })
  live.current = { previewing, onPreview }
  const stopPreview = (): void => {
    clearTimeout(follow.current)
    if (!previewing) return
    setParked(false)
    onPreview(null)
  }
  // The page goes with the preview on: the row that drives the panel is gone, and the panel with it.
  useEffect(
    () => () => {
      clearTimeout(follow.current)
      if (live.current.previewing) live.current.onPreview?.(null)
    },
    [],
  )

  const activate = ({ path, node }: Row, background: boolean): void => {
    stopPreview() // a row that opens does its own work and closes the preview panel (YAZ-2662 S36)
    // A folder shows in Files (S22); with ⌘ its page opens in a background tab, as ⌘Enter on a folder of the search tree does (D7; YAZ-2662 S3).
    if (node.type === 'dir') return background ? onOpenBackground(path) : onShowInFiles(path)
    // No viewer in the app (YAZ-1577 D2): the OS default app is the viewer, as on its row of the sidebar. No tab.
    if (node.kind === null) return void api.shell.openDefault({ path }).catch((err: unknown) => onNotice(`Can't open "${pageLabel(path, false, titles)}": ${err instanceof Error ? err.message : String(err)}`, 'error'))
    if (background) onOpenBackground(path)
    else onOpen(path)
  }

  // ---- The keys (YAZ-2663 D7): one handler, on the page ----

  const page = useRef<HTMLDivElement>(null)
  // The way in (S33). The first row in the page is the first row of the first column that has rows.
  useEffect(() => {
    focusRef.current = () => {
      const first = page.current?.querySelector<HTMLElement>('button.start__row') ?? null
      first?.focus()
      return first !== null
    }
    return () => {
      focusRef.current = null
    }
  }, [focusRef])
  // The page goes while the keyboard is on one of its rows — Enter opened the row, or a different
  // tab shows. The focus would be on nothing, so the caret goes into the page on show, as off the
  // tab board (YAZ-2648). A page that mounts for the first time takes the caret by itself.
  useLayoutEffect(() => {
    const el = page.current
    return () => {
      if (el?.contains(document.activeElement) === true) queueMicrotask(focusOpenDocument)
    }
  }, [])

  const onKeys = (e: KeyboardEvent<HTMLDivElement>): void => {
    const on = e.target instanceof Element ? e.target.closest<HTMLElement>('button.start__row') : null
    const col = COLUMNS.find((column) => column.col === on?.dataset.col)?.col
    const n = Number(on?.dataset.row)
    const row = col === undefined ? undefined : columns[col].rows[n]
    if (col === undefined || row === undefined) return
    /** The keyboard focus goes to row `to` of `column`, or to its last row; with the preview on, the panel follows (S39). */
    const go = (column: typeof col, to: number): void => {
      const rows = columns[column].rows
      const next = Math.min(to, rows.length - 1)
      page.current?.querySelector<HTMLElement>(`button.start__row[data-col="${column}"][data-row="${next}"]`)?.focus()
      if (!previewing) return
      clearTimeout(follow.current)
      const { path, node } = rows[next]
      // On a folder no panel is drawn, at once (YAZ-2662 S38). A file shows after the wait, and the earlier file stays until then (S32).
      if (node.type === 'dir') {
        setParked(true)
        onPreview(null)
      } else
        follow.current = setTimeout(() => {
          if (!live.current.previewing) return // the panel's ✕ closed the preview in the wait
          setParked(false)
          onPreview(path)
        }, PREVIEW_FOLLOW_MS)
    }
    const back = (): void => {
      stopPreview()
      onBackToSearch()
    }
    // The columns that have rows, in their order: ← and → go over a column with none (S36).
    const shown = COLUMNS.map((column) => column.col).filter((column) => columns[column].rows.length > 0)
    if (e.key === 'Enter') {
      // The keys of a search row (YAZ-2662 D8): Shift+Enter shows the row in Files, and ⌘ is read before Shift (S7).
      if (e.shiftKey && !e.metaKey) {
        stopPreview()
        onShowInFiles(row.path)
      } else activate(row, e.metaKey)
    }
    // A key with ⌘, Ctrl or Alt is a shortcut of the window, not a key of the page.
    else if (e.metaKey || e.ctrlKey || e.altKey) return
    // ↑ and ↓ walk the column and stop at both ends (S35).
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const to = n + (e.key === 'ArrowDown' ? 1 : -1)
      if (to >= 0 && to < columns[col].rows.length) go(col, to)
    }
    // → and ← go to the neighbour column that has rows, at the same row number or at its last row.
    // → on the last one does nothing (S36); ← on the first one goes back to the search bar (S37).
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const next = shown[shown.indexOf(col) + (e.key === 'ArrowRight' ? 1 : -1)]
      if (next !== undefined) go(next, n)
      else if (e.key === 'ArrowLeft') back()
    }
    // Esc with a panel on show closes the panel only. With none — the keyboard on a folder too — it goes back to the search bar (S37, S39).
    else if (e.key === 'Escape') {
      e.stopPropagation()
      if (onPreview !== undefined && previewPath !== null) stopPreview()
      else back()
    }
    // Space on a file shows the preview panel on it, at once, and Space again closes it (S39). On a folder it does nothing (S40).
    else if (e.key === ' ') {
      if (row.node.type === 'file' && onPreview !== undefined) {
        if (previewing) stopPreview()
        else onPreview(row.path)
      }
    }
    // A typed letter is the search's (S41): the caret goes to the search bar, and the key is NOT
    // taken, so the browser types it there. React commits what a key asks before the key's text arrives.
    else if (e.key.length === 1) return back()
    else return
    // Taken from the browser: no scroll under an arrow, and no click of the button under Enter or Space.
    e.preventDefault()
  }

  return (
    <div ref={page} className="start" onKeyDown={onKeys}>
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
                      <button type="button" className={`start__row${folder ? ' start__row--dir' : ''}`} data-path={row.path} data-col={col} data-row={at} data-kind={row.node.type} title={row.path} onClick={(e) => activate(row, e.metaKey)} onContextMenu={(e) => (e.preventDefault(), onRowMenu(row.path, e.clientX, e.clientY))}>
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
