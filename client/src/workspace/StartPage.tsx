/**
 * The new tab page (YAZ-2663 D3): what a new tab (⌘T) and a window with no tabs show in the page
 * area. Three columns of rows: the pages last on show, the favorites, and the notes you closed last
 * (YAZ-3487 D8; it was "Used a lot, not a favorite yet"). App mounts it only while it shows (R1), so
 * everything here is read when the page shows and followed while it does:
 *   - the open history, the closed notes, the other windows' tabs and the order of the favorites
 *     across vaults, off the app state the window already holds (`storage`);
 *   - each vault's favorites, read one time and again on `favorites.onChanged`;
 *   - what is on the disk, and whether it is a file or a folder, off the window's one tree feed.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import { rootOfPath, stripSlash, type DiagramDarkColors, type OpenStat, type TreeNode } from '@shared/types'
import { api } from '../api'
import { focusOpenDocument } from '../lib/focusHandoff'
import type { NoticeKind } from '../lib/notice'
import { pageLabel, useLatestTrees, type PathTitles } from '../lib/pageLabel'
import { dirname, relTo } from '../lib/paths'
import { shortRelativeTime } from '../lib/relativeTime'
import { storage } from '../lib/storage'
import { fetchTree } from '../lib/treeFeed'
import { favoriteOrder, findNode } from '../lib/treeState'
import { PREVIEW_FOLLOW_MS } from '../sidebar/hooks/useSidebarSearch'
import { CardPreviewHost, useCardPreview, type PreviewScope } from '../tabs/cardPreview'
import { recentlyClosed } from './recentlyClosed'
import './startPage.css'

/** At this width of the page area, and under it, the columns stand one below the other: the `@container` rule of startPage.css. Keep the two the same. */
const STACK_AT = 640

/** Each column shows this many rows at most (YAZ-2663 D3, YAZ-3487 D8). */
const START_ROWS = 8

/** The columns in their order, each with the one grey line it shows when it has no rows (S19). */
const COLUMNS = [
  { col: 'recent', label: 'Recent', empty: 'Pages you open show here.' },
  { col: 'favorites', label: 'Favorites', empty: 'No favorites yet. Right-click a file or folder → Add to favorites.' },
  { col: 'closed', label: 'Recently closed', empty: 'Notes you close show here.' },
] as const

/** What the page reads of the app state for one vault of the window (R1): what the app calls the vault, its open history, and its closed notes (YAZ-3487 D9). */
interface VaultRecord {
  root: string
  name: string
  opens: Readonly<Record<string, OpenStat>>
  closed: Readonly<Record<string, number>>
}

/** `a` and `b` read the same. Each broadcast of the app state is a new copy of it all, so only what a record HOLDS says that it changed. */
function sameRecord(a: VaultRecord, b: VaultRecord): boolean {
  const paths = Object.keys(a.opens)
  const closed = Object.keys(a.closed)
  return (
    a.root === b.root &&
    a.name === b.name &&
    paths.length === Object.keys(b.opens).length &&
    // "Recent" reads `last` alone: a new `score` with the same `last` changes no row (the suggestions that read it left, YAZ-3487 D8).
    paths.every((path) => path in b.opens && b.opens[path].last === a.opens[path].last) &&
    closed.length === Object.keys(b.closed).length &&
    closed.every((path) => b.closed[path] === a.closed[path])
  )
}

/** A row: a path the Files tree holds, as its node there, and the vault that holds it. `last` is when it was last on show ("Recent") or closed ("Recently closed", YAZ-3487). */
interface Row {
  path: string
  node: TreeNode
  vault: VaultRecord
  last?: number
  /** How many folders of the page it stands inside (YAZ-2663 D13): 0 for a row of a column's own list. */
  depth: number
}

/** No tab is open. */
const NO_TABS: readonly string[] = []

/** No folder of the page is open. */
const NO_DIRS: ReadonlySet<string> = new Set()

export interface StartPageProps {
  /** The window's vaults, in the window's order (YAZ-2602 D1). */
  roots: readonly string[]
  /** The notes this window's tabs show (YAZ-3487 D10): no row of "Recently closed". One array while the tabs stay the same. */
  openTabs?: readonly string[]
  titles: PathTitles
  /** A click on a file (S21): App opens it as a sidebar click does, so it fills the blank tab. */
  onOpen: (path: string) => void
  /** ⌘-click and ⌘Enter (S21, S38): a background tab — of a folder's page too, as on a search row (YAZ-2662 S3) — and the page stays. */
  onOpenBackground: (path: string) => void
  /** A click or Enter on a folder (S22), and Shift+Enter on any row (S38): App shows the row in Files — a folder open — with the keyboard focus on it. */
  onShowInFiles: (path: string) => void
  /** A right-click on a row (YAZ-2663 D6): App asks the sidebar for its own row menu of that path, at the mouse. The page has no menu. */
  onRowMenu: (path: string, x: number, y: number) => void
  /** ← on the first column that has rows, and Esc (S37, D8): the keyboard goes back to where it came from — a row of a sidebar tree, else the search bar. */
  onBack: () => void
  /** A typed letter (S41): App puts the caret in the search bar. */
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
  /** Settings › Preview on hover (YAZ-3403): resting on a note or board row opens the sidebar's own panel beside the row. Space opens the big panel whatever this says. */
  hoverPreview?: boolean
  /** What the hover panel needs of a row's vault: its links, its text formatting, its watch feed. No scope, no hover panel. */
  previewScope?: (path: string) => PreviewScope
  diagramDarkColors?: DiagramDarkColors
}

export function StartPage({ roots, openTabs = NO_TABS, titles, onOpen, onOpenBackground, onShowInFiles, onRowMenu, onBack, onBackToSearch, focusRef, previewPath = null, onPreview, onNotice, hoverPreview = false, previewScope, diagramDarkColors = 'adapt' }: StartPageProps) {
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
  // the app state (R1): a use that the main process adds, in any window, draws the page again. A
  // broadcast that changes nothing the page reads does not: the records are the same list until one
  // of them holds a different use or name (`useLatestTrees`' idiom), and `storage` keeps the order.
  const held = useRef<readonly VaultRecord[]>([])
  const records = useSyncExternalStore(storage.subscribe, () => {
    const next = roots.map((vault) => ({ root: vault, name: storage.vaultName(vault), opens: storage.getOpens(vault), closed: storage.getClosed(vault) }))
    if (next.length !== held.current.length || next.some((record, at) => !sameRecord(record, held.current[at]))) held.current = next
    return held.current
  })
  const favoritesOrder = useSyncExternalStore(storage.subscribe, storage.getFavoritesOrder)
  // YAZ-3487 D10: a note a tab shows now — here, or in another window — is no closed note. Each broadcast is a new copy of
  // the app state, so only the paths say that the other windows' tabs changed (the `held` idiom above, R5).
  const heldTabs = useRef<readonly string[]>([])
  const otherTabs = useSyncExternalStore(storage.subscribe, () => {
    const next = storage.getOtherWindows().flatMap((w) => w.tabs)
    if (next.length !== heldTabs.current.length || next.some((path, at) => path !== heldTabs.current[at])) heldTabs.current = next
    return heldTabs.current
  })
  const openNow = useMemo(() => new Set([...openTabs, ...otherTabs]), [openTabs, otherTabs])
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

  // The columns are cut when what they read changes (R5), not on each render: App renders on each
  // broadcast of the app state, on each resize of the window and through a drag of the sidebar edge.
  const lists = useMemo((): Record<(typeof COLUMNS)[number]['col'], { rows: Row[]; read: boolean }> => {
    /** `path` as the tree of its vault holds it; no row when that tree has not landed, or does not hold it. */
    const rowsOf = (list: readonly { path: string; last?: number }[]): Row[] =>
      list.flatMap(({ path, last }) => {
        const at = roots.indexOf(rootOfPath(roots, path) ?? '')
        const node = trees[at] == null ? null : findNode(trees[at].tree, path)
        return node === null ? [] : [{ path, node, vault: records[at], last, depth: 0 }]
      })
    // A column says it is empty only when what it reads has answered: no line for a list nobody has read yet.
    const treesLanded = trees.every((tree) => tree !== null)
    const favoritesRead = treesLanded && roots.every((vault) => favoritesByRoot[vault] !== undefined)
    const favoritePaths = favoriteOrder(roots, favoritesByRoot, favoritesOrder)
    return {
      // S12: the pages last on show, the newest first, of every vault.
      recent: {
        rows: rowsOf(records.flatMap(({ opens }) => Object.entries(opens).map(([path, stat]) => ({ path, last: stat.last }))).sort((a, b) => b.last - a.last)).slice(0, START_ROWS),
        read: treesLanded,
      },
      // S13: the order of the Favorites tab; a favorite with no file on this machine draws no row there either (YAZ-1766 D14).
      favorites: { rows: rowsOf(favoritePaths.map((path) => ({ path }))).slice(0, START_ROWS), read: favoritesRead },
      // YAZ-3487 D8: the notes you closed, the newest first, of every vault; a note on the disk no more draws no row (S38).
      closed: { rows: rowsOf(recentlyClosed(records, openNow)).slice(0, START_ROWS), read: treesLanded },
    }
  }, [roots, trees, records, favoritesByRoot, favoritesOrder, openNow])

  // A folder row opens IN its column (YAZ-2663 D13): Space, or a click on its chevron, puts each
  // row that the folder holds below it, one step in, as the Files tree holds them — and a folder
  // inside opens the same way. The page's own: Files keeps its folds, and a folder that stands in
  // two columns is open in the one where it was opened (`<col> <path>`). It lasts as long as the page.
  const [openDirs, setOpenDirs] = useState(NO_DIRS)
  const toggleDir = (col: string, path: string): void =>
    setOpenDirs((held) => {
      const next = new Set(held)
      if (!next.delete(`${col} ${path}`)) next.add(`${col} ${path}`)
      return next
    })
  // What each column draws: its own rows, and below each open folder the rows inside it. The keys walk these.
  const columns = useMemo(() => {
    const inside = (col: string, rows: readonly Row[]): Row[] =>
      rows.flatMap((row) => {
        if (row.node.type !== 'dir' || !openDirs.has(`${col} ${row.path}`)) return [row]
        return [row, ...inside(col, row.node.children.map((node) => ({ path: node.path, node, vault: row.vault, depth: row.depth + 1 })))]
      })
    return {
      recent: { rows: inside('recent', lists.recent.rows), read: lists.recent.read },
      favorites: { rows: inside('favorites', lists.favorites.rows), read: lists.favorites.read },
      closed: { rows: inside('closed', lists.closed.rows), read: lists.closed.read },
    }
  }, [lists, openDirs])

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
  // In the tab stack alone: with no text on show there (a PDF), a note of the right panel does not get the caret.
  useLayoutEffect(() => {
    const el = page.current
    return () => {
      const stack = el?.closest('.tabstack') ?? undefined
      if (el?.contains(document.activeElement) === true) queueMicrotask(() => focusOpenDocument(stack))
    }
  }, [])

  // The hover panel (YAZ-3403): the sidebar's own panel beside a row, as the tab board shows it beside a card
  // (YAZ-3343 D18). A row is `<col> <row number>`; its dwell lives in a tiny store, so a pointer that crosses
  // rows draws no page. Off while the Space panel shows: one panel at a time.
  const rowPreview = useCardPreview(hoverPreview && !previewing, (id) => {
    const [col, at] = id.split(' ')
    return page.current?.querySelector<HTMLElement>(`button.start__row[data-col="${col}"][data-row="${at}"]`) ?? null
  })
  const previewRow = (id: string): { root: string | null; name: string } | null => {
    const [col, at] = id.split(' ')
    const row = COLUMNS.some((column) => column.col === col) ? columns[col as (typeof COLUMNS)[number]['col']].rows[Number(at)] : undefined
    return row === undefined ? null : { root: row.vault.root, name: pageLabel(row.path, false, titles) }
  }
  // New rows (a use, a favorite, a folder opened) can move a row under the panel: the panel goes.
  const closeRowPreview = rowPreview.close
  useEffect(() => closeRowPreview(), [columns, closeRowPreview])

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
      onBack()
    }
    // The columns stand one below the other in a narrow page area (S23; `STACK_AT` is the width of
    // startPage.css). With no layout (a test) the width reads 0: three columns.
    const width = page.current?.clientWidth ?? 0
    const stacked = width > 0 && width <= STACK_AT
    // The columns that have rows, in their order: ← and → go over a column with none (S36).
    const shown = COLUMNS.map((column) => column.col).filter((column) => columns[column].rows.length > 0)
    // A held Enter or Space acts ONE time, as on a search row (YAZ-2669): a repeat of the press is
    // taken and does nothing, so no panel shows and closes, and no default app opens, at the rate of the key.
    if (e.repeat && (e.key === 'Enter' || e.key === ' ')) return e.preventDefault()
    if (e.key === 'Enter') {
      // The keys of a search row (YAZ-2662 D8): Shift+Enter shows the row in Files, and ⌘ is read before Shift (S7).
      if (e.shiftKey && !e.metaKey) {
        stopPreview()
        onShowInFiles(row.path)
      } else activate(row, e.metaKey)
    }
    // A key with ⌘, Ctrl or Alt is a shortcut of the window, not a key of the page.
    else if (e.metaKey || e.ctrlKey || e.altKey) return
    // ↑ and ↓ walk the column and stop at both ends (S35). In ONE column (D12) they go on into the
    // next column that has rows, and into the one before: the page is one list from top to bottom then.
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const down = e.key === 'ArrowDown'
      const to = n + (down ? 1 : -1)
      const next = stacked ? shown[shown.indexOf(col) + (down ? 1 : -1)] : undefined
      if (to >= 0 && to < columns[col].rows.length) go(col, to)
      else if (next !== undefined) go(next, down ? 0 : columns[next].rows.length - 1)
    }
    // → and ← go to the neighbour column that has rows, at the same row number or at its last row.
    // → on the last one does nothing (S36); ← on the first one goes back to where the keyboard came from (S37, D8).
    // In one column nothing is to the right or to the left of a row: → does nothing, and ← goes back.
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const next = stacked ? undefined : shown[shown.indexOf(col) + (e.key === 'ArrowRight' ? 1 : -1)]
      if (next !== undefined) go(next, n)
      else if (e.key === 'ArrowLeft') back()
    }
    // Esc with a panel on show closes the panel only. With none — the keyboard on a folder too — it goes back, as ← does (S37, S39).
    else if (e.key === 'Escape') {
      // The row menu of the sidebar is open over the page: the key is the menu's, which closes on an Escape that reaches the window.
      if (document.querySelector('.ctx-menu') !== null) return
      e.stopPropagation()
      if (onPreview !== undefined && previewPath !== null) stopPreview()
      else back()
    }
    // Space on a file shows the preview panel on it, at once, and Space again closes it (S39). On a
    // folder it opens the folder in its column, and Space again closes it (D13); the preview stays on.
    else if (e.key === ' ') {
      if (row.node.type === 'dir') toggleDir(col, row.path)
      else if (onPreview !== undefined) {
        if (previewing) stopPreview()
        else onPreview(row.path)
      }
    }
    // A typed letter is the search's (S41): the caret goes to the search bar, and the key is NOT
    // taken, so the browser types it there. React commits what a key asks before the key's text arrives.
    else if (e.key.length === 1) {
      stopPreview()
      return onBackToSearch()
    }
    else return
    // Taken from the browser: no scroll under an arrow, and no click of the button under Enter or Space.
    e.preventDefault()
  }

  // "How long ago" is from this draw: the page has no timer.
  const now = Date.now()
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
                  const vault = row.vault.root
                  const folder = row.node.type === 'dir'
                  const dir = dirname(row.path)
                  const open = folder && openDirs.has(`${col} ${row.path}`)
                  // A row inside an open folder (D13) stands one step in for each folder above it, and says no more than its name: where it is shows.
                  const top = row.depth === 0
                  return (
                    <li key={`${row.depth} ${row.path}`}>
                      {/* `data-col` and `data-row` say where the row stands: the arrow keys walk by them (YAZ-2674). */}
                      <button type="button" className={`start__row${folder ? ' start__row--dir' : ''}`} style={top ? undefined : { paddingLeft: (folder ? 8 : 26) + row.depth * 14 }} aria-expanded={folder ? open : undefined} data-path={row.path} data-col={col} data-row={at} title={row.path} onMouseEnter={folder ? undefined : () => rowPreview.hoverCard(`${col} ${at}`, row.path)} onMouseLeave={() => rowPreview.leaveCard(`${col} ${at}`)} onClick={(e) => activate(row, e.metaKey)} onContextMenu={(e) => (e.preventDefault(), onRowMenu(row.path, e.clientX, e.clientY))}>
                        {/* The chevron is the mouse's Space (D13): it opens and closes the folder here, and the row's own click — the folder in Files — does not follow. */}
                        {folder && <span className={`tree__chevron${open ? ' tree__chevron--open' : ''}`} onClick={(e) => (e.stopPropagation(), toggleDir(col, row.path))} />}
                        <span className="start__name">{pageLabel(row.path, folder, titles)}</span>
                        {/* The folder the row is in, as the tab board names it; a row at the top of its vault names none. */}
                        {top && dir !== stripSlash(vault) && <span className="start__where">{relTo(vault, dir).split('/').join(' / ')}</span>}
                        {/* S20: the tag of a top row of the Favorites tab (YAZ-2631 D4), by what the app calls the vault. */}
                        {top && roots.length > 1 && <span className="tree__vault">{row.vault.name}</span>}
                        {row.last !== undefined && <span className="start__when">{shortRelativeTime(row.last, now)}</span>}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        ))}
      </div>
      <CardPreviewHost store={rowPreview.store} cardOf={previewRow} scopeOf={previewScope} diagramDarkColors={diagramDarkColors} />
    </div>
  )
}
