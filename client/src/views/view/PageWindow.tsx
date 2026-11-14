import { type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Group, Row } from '../engine'
import { PropertiesOpenMemory } from '../../editor/FrontmatterPanel'
import { cellNotePinnedAtStart } from '../../editor/table/cellNoteCard'
import { isPageKey } from '../../editor/pageKeys'
import { cssZoom } from '../../lib/cssZoom'
import { storage } from '../../lib/storage'
import { TOP_SPOT, type GroupSpot, childSpot, spotKey } from './groupDrag'
import { legacyPageWindowKey, movedStorageItem } from '@shared/legacyNames'

/**
 * The table's side of the card (YAZ-4547 D16): one mutable object per folder page, so a step renders the card and
 * nothing in the table. TableView writes `rows` and `show` at each render; the card writes `current` and calls `show`.
 */
export interface PageWindowLink {
  /** The table's visible data rows in display order (TableView's `flat`): after filters, sort and groups, collapsed groups left out. */
  rows: readonly Row[]
  /** The page the card shows: its row is marked. Null with no card. */
  current: string | null
  /** Mark the row of `current` (none when null) and scroll it into view. */
  show: () => void
}

export const pageWindowLink = (): PageWindowLink => ({ rows: [], current: null, show: () => {} })

/** The class of the item the card shows in Board, List, Cards and Calendar (YAZ-4547 D24); the table has its own row class. */
export const CURRENT_ITEM = 'view-item--current'

/**
 * The rows Board, List and Cards show, in their order (D24): the groups depth first — each group's direct rows, then
 * its subgroups, as a Board column reads top to bottom — and a collapsed group's rows left out. No groups: the rows.
 */
export function shownRows(groups: readonly Group[] | null, rows: readonly Row[], collapsed: readonly string[]): readonly Row[] {
  if (groups === null) return rows
  const shut = new Set(collapsed)
  const out: Row[] = []
  const walk = (list: readonly Group[], at: GroupSpot) => {
    for (const g of list) {
      if (shut.has(spotKey(g, at))) continue
      out.push(...(g.children === undefined ? g.rows : (g.direct ?? [])))
      if (g.children !== undefined) walk(g.children, childSpot(g, at))
    }
  }
  walk(groups, TOP_SPOT)
  return out
}

/**
 * Board, List, Cards and Calendar's side of the card (D24), as TableView's: each render writes the view's order to
 * the link, and `show` marks the items of `current` under `root` (every `data-hover-item` of that page) and scrolls the
 * first into view. A step writes the mark on the DOM, so the view does not render for it; the view's own render draws
 * the same mark from `link.current` (`CURRENT_ITEM`). On a switch of view tab the next view writes the link in its
 * render, before this one's cleanup runs, so the cleanup clears only what this view wrote.
 */
export function usePageWindowItems(link: PageWindowLink | undefined, order: readonly Row[], root: RefObject<HTMLElement | null>, onShow?: (current: string | null) => void): void {
  const wrote = useRef(order)
  wrote.current = order
  if (link !== undefined) {
    link.rows = order
    link.show = () => {
      const el = root.current
      if (el === null) return
      let shown: HTMLElement | null = null
      for (const item of el.querySelectorAll<HTMLElement>('[data-hover-item]')) {
        const on = item.dataset.hoverItem === link.current
        item.classList.toggle(CURRENT_ITEM, on)
        if (on) shown ??= item
      }
      shown?.scrollIntoView?.({ block: 'nearest' })
      // A view whose items can hide (the calendar's "+N more", YAZ-3746 13J) hears each step, to reveal the card's item.
      onShow?.(link.current)
    }
  }
  useEffect(
    () => () => {
      if (link === undefined || link.rows !== wrote.current) return
      link.rows = []
      link.show = () => {}
    },
    [link],
  )
}

/** ` view-item--current` on the item of the page the card shows, for a view's className. */
export const currentItemClass = (link: PageWindowLink | undefined, path: string): string => (link !== undefined && link.current === path ? ` ${CURRENT_ITEM}` : '')

/** An open card: the page it shows now, and its place, size and pin, kept while the app runs (D17): in memory only. */
export interface PageWindowMemory {
  /** The page the card shows now: its start, then each step. */
  path: string
  /** The top-left corner after a drag or a resize, in layout px of the folder page; null for the default place. */
  placed: { x: number; y: number } | null
  width: number | null
  height: number | null
  pinned: boolean
}

/**
 * A new memory on `path`: the pin starts as Settings › Folder pages › "Keep the mini window pinned" says (YAZ-4585, D34);
 * null there, as Settings › "Keep cell notes open (pinned)" says (5E).
 */
export const pageWindowMemory = (path: string, pinned: boolean | null = null): PageWindowMemory => ({ path, placed: null, width: null, height: null, pinned: pinned ?? cellNotePinnedAtStart() })

/**
 * The open cards, by app tab, folder page and view tab (YAZ-4547 D17, YAZ-4544). A tab that sleeps unmounts its
 * folder page; when it mounts again, its card shows again on the same page, at the same place. Two tabs on one folder
 * each have their own card; a folder page with no tab (the right panel) is its own place. Bounded: a card that closes
 * drops its entry, and at most `MAX_OPEN_WINDOWS` stay, the oldest open out.
 */
const openWindows = new Map<string, PageWindowMemory>()
export const MAX_OPEN_WINDOWS = 50

export const pageWindowKey = (tabId: string | undefined, folderPath: string, viewName: string): string => JSON.stringify([tabId ?? null, folderPath, viewName])
export const openPageWindow = (key: string): PageWindowMemory | undefined => openWindows.get(key)
export function keepPageWindow(key: string, memory: PageWindowMemory): void {
  openWindows.delete(key)
  openWindows.set(key, memory)
  if (openWindows.size > MAX_OPEN_WINDOWS) openWindows.delete(openWindows.keys().next().value!)
}
export const dropPageWindow = (key: string): void => void openWindows.delete(key)
/** For tests: no card open anywhere. */
export const dropAllPageWindows = (): void => openWindows.clear()

/** A card's place and size, apart from its page and pin. */
export type PageWindowBox = Pick<PageWindowMemory, 'placed' | 'width' | 'height'>
/**
 * The place and size of a folder page's last mini window (YAZ-3746 13H), kept across restarts in this window's
 * localStorage by folder path: every drag, resize and reset writes it, and the next card of that page (in any app tab
 * or view tab) opens there. Before any: the default, 480 × 440 at the right of the page.
 */
const boxKey = (folderPath: string): string => `pageWindow:${folderPath}`
const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
export function savedPageWindowBox(folderPath: string): PageWindowBox | null {
  try {
    // YAZ-5036: a box saved before the rename (`noteWindow:<folder>`) moves to the new key once.
    const raw = movedStorageItem(localStorage, boxKey(folderPath), legacyPageWindowKey(folderPath))
    if (raw === null) return null
    const v: unknown = JSON.parse(raw)
    if (typeof v !== 'object' || v === null) return null
    const { placed, width, height } = v as Record<string, unknown>
    const p = typeof placed === 'object' && placed !== null ? (placed as Record<string, unknown>) : null
    const x = finite(p?.x)
    const y = finite(p?.y)
    return { placed: x !== null && y !== null ? { x, y } : null, width: finite(width), height: finite(height) }
  } catch {
    return null
  }
}
export function savePageWindowBox(folderPath: string, { placed, width, height }: PageWindowBox): void {
  try {
    localStorage.setItem(boxKey(folderPath), JSON.stringify({ placed, width, height }))
  } catch {
    // No storage (a private window, a full quota): the size lasts the session, as before.
  }
}

/** `path` is `at` or a file under the folder `at`. */
const isAtOrUnder = (path: string, at: string): boolean => path === at || path.startsWith(`${at}/`)

/** The mounted cards, told of a rename (`to` its new path) or a delete (`to` null) of a page or a folder (YAZ-4544). */
const windowListeners = new Set<(from: string, to: string | null) => void>()

/** A key's parts (`pageWindowKey`). */
const keyParts = (key: string): [string | null, string, string] => JSON.parse(key) as [string | null, string, string]

/** The entries whose key `moves` picks get the key it names (YAZ-4635 P5): the card stays open across a rename of its place. */
function rekeyPageWindows(moves: (tabId: string | null, folderPath: string, viewName: string) => string | null): void {
  for (const [key, memory] of [...openWindows]) {
    const to = moves(...keyParts(key))
    if (to === null || to === key) continue
    openWindows.delete(key)
    openWindows.set(to, memory)
  }
}

/**
 * A rename of a page or a folder (YAZ-4544): App's `file:renamed`, after `carryEditorAcrossRename` retired the
 * editors at the old path. Each card on it, mounted or not, moves to the new path; a mounted card mounts its editor there.
 * A folder's rename also moves the cards of the folder pages at or under it to their new folder path (YAZ-4635 P5),
 * so the page that mounts again on the new path finds its card.
 */
export function renamePageWindows(oldPath: string, newPath: string): void {
  for (const memory of openWindows.values()) if (isAtOrUnder(memory.path, oldPath)) memory.path = newPath + memory.path.slice(oldPath.length)
  rekeyPageWindows((tabId, folderPath, viewName) => (isAtOrUnder(folderPath, oldPath) ? pageWindowKey(tabId ?? undefined, newPath + folderPath.slice(oldPath.length), viewName) : null))
  for (const tell of [...windowListeners]) tell(oldPath, newPath)
}

/** A view tab of `folderPath` renamed `from` → `to` (YAZ-4635 P5): the cards on it, in every app tab, keep their place under the new name. */
export const renamePageWindowView = (folderPath: string, from: string, to: string): void =>
  rekeyPageWindows((tabId, folder, viewName) => (folder === folderPath && viewName === from ? pageWindowKey(tabId ?? undefined, folderPath, to) : null))

/** A delete of a page or a folder (YAZ-4544): App's `file:deleted`, after `retireDeletedPath`. Each card on it closes. */
export function dropPageWindowsAt(path: string): void {
  // The mounted cards close first, so their folder page keeps the place and size for its next card.
  for (const tell of [...windowListeners]) tell(path, null)
  for (const [key, memory] of openWindows) if (isAtOrUnder(memory.path, path)) openWindows.delete(key)
}

interface PageWindowProps {
  /** A full `Editor` on a page (App's `renderPageEditor`): the tab itself, in the card. */
  renderEditor: (path: string) => ReactNode
  link: PageWindowLink
  titleOf: (path: string) => string
  /** The card's page, place, size and pin: the card opens on `memory.path` and writes each step there. */
  memory: PageWindowMemory
  /** ↗: the page in a new app tab (YAZ-3746 13I); the folder page's tab stays, and this window open on it (13AJ). */
  onOpenInTab: (path: string) => void
  onClose: () => void
  /** After a drag, a resize or a reset of the card: the memory as it stands, for the folder page to keep (13H). */
  onPlaced?: (memory: PageWindowMemory) => void
}

/** The default size (480 × 440 since YAZ-3746 13H; the height fit the page before), the gap to the folder page's edges, and the least size a resize leaves (the cell-note card's). */
const DEFAULT_WIDTH = 480
const DEFAULT_HEIGHT = 440
const GAP = 12
const MIN_WIDTH = 240
const MIN_HEIGHT = 120

/** The eight resize grips: an edge or a corner, and its sides (-1 left or top, 1 right or bottom). */
const GRIPS: ReadonlyArray<{ name: string; x: -1 | 0 | 1; y: -1 | 0 | 1; cursor: string }> = [
  { name: 'n', x: 0, y: -1, cursor: 'ns-resize' },
  { name: 's', x: 0, y: 1, cursor: 'ns-resize' },
  { name: 'e', x: 1, y: 0, cursor: 'ew-resize' },
  { name: 'w', x: -1, y: 0, cursor: 'ew-resize' },
  { name: 'nw', x: -1, y: -1, cursor: 'nwse-resize' },
  { name: 'se', x: 1, y: 1, cursor: 'nwse-resize' },
  { name: 'ne', x: 1, y: -1, cursor: 'nesw-resize' },
  { name: 'sw', x: -1, y: 1, cursor: 'nesw-resize' },
]

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max))

/**
 * Where the card goes in `order` from the page at `found` (-1: the page left the list), one step `dir`: a page that
 * left keeps its last place `last`, so › goes to the row now at that place and ‹ to the one before it.
 */
const stepIndex = (found: number, last: number, dir: -1 | 1): number => (found === -1 ? (dir === 1 ? last : last - 1) : found + dir)

/**
 * Open a row in the mini window (YAZ-4547, 5E D14-D17; the name is YAZ-4605 D57): a card over the tab's folder page with a full editor on one page,
 * and ‹ › through the table's rows. The cell-note card's look and gestures (`editor/table/cellNoteCard.ts`), in React:
 * drag the head, 8 grips, a double click on the head resets, and the pin. It is rendered by the folder page
 * (`ViewsPane`), so it belongs to that tab; its DOM goes beside the page's scroller (`section.editor`), out of the
 * views' document zoom. One editor is mounted at a time, keyed by the path: a step saves the page and mounts the next.
 * A drag or a resize writes the card's style only: nothing renders and no layout is read while the pointer moves.
 */
export function PageWindow({ renderEditor, link, titleOf, memory, onOpenInTab, onClose, onPlaced }: PageWindowProps) {
  const [path, setPath] = useState(memory.path)
  const [pinned, setPinned] = useState(memory.pinned)
  const [host, setHost] = useState<HTMLElement | null>(null)
  const anchorRef = useRef<HTMLSpanElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  /** The page's last place in the order: where it stays when it shows twice, and where ‹ › go from when it leaves. */
  const at = useRef(-1)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  /** The Properties panel's open state across the card's steps (YAZ-3746 13Q): each page starts as the last one left it. */
  const propertiesOpen = useRef<boolean | null>(null)

  useLayoutEffect(() => {
    const anchor = anchorRef.current
    setHost(anchor?.closest<HTMLElement>('section.editor') ?? anchor?.parentElement ?? null)
  }, [])

  /** The page's place in `order`: its last place while the order still has it there (a page in two groups), else found again. */
  const placeIn = (order: readonly string[]): number => (order[at.current] === path ? at.current : order.indexOf(path))
  const order = link.rows.map((r) => r.record.path)
  const found = placeIn(order)
  if (found !== -1) at.current = found
  const previous = order[stepIndex(found, at.current, -1)]
  const next = order[stepIndex(found, at.current, 1)]

  /** Step through the rows; the order is read now, so a sort or a filter change while the card is open counts. */
  const step = (dir: -1 | 1): boolean => {
    const now = link.rows.map((r) => r.record.path)
    const here = placeIn(now)
    const to = stepIndex(here, here === -1 ? at.current : here, dir)
    const target = now[to]
    if (target === undefined) return false
    at.current = to
    setPath(target)
    return true
  }

  // The table marks the card's row and scrolls it into view; the mark goes with the card.
  useLayoutEffect(() => {
    memory.path = path
    link.current = path
    link.show()
  }, [memory, link, path])
  // A layout cleanup (YAZ-4544): "Open in mini window" (or ⇧Enter, YAZ-4605 D56) on the open row remounts the card (a new key). React runs the old
  // card's layout cleanup before the new card's layout effect, so the new card marks the row after this clears it. A
  // passive cleanup ran after the new card's mark and took it off.
  useLayoutEffect(
    () => () => {
      link.current = null
      link.show()
    },
    [link],
  )

  // A rename of the page moves the card to the new path, and the editor mounts there; a delete closes it (YAZ-4544).
  useEffect(() => {
    const follow = (from: string, to: string | null) => {
      if (!isAtOrUnder(path, from)) return
      if (to === null) closeRef.current()
      else setPath(to + path.slice(from.length))
    }
    windowListeners.add(follow)
    return () => void windowListeners.delete(follow)
  }, [path])

  /** The folder page's size: read once for a drag or a resize, so a mouse move reads no layout (YAZ-4544). */
  const hostSize = (): { W: number; H: number } => ({ W: host?.clientWidth ?? 0, H: host?.clientHeight ?? 0 })

  /** The card at its remembered place and size, inside the folder page of size `W` × `H`; returns what shows. */
  const place = ({ W, H } = hostSize()): { left: number; top: number; width: number; height: number } | null => {
    const card = cardRef.current
    if (card === null || host === null) return null
    const width = clamp(memory.width ?? DEFAULT_WIDTH, Math.min(MIN_WIDTH, W), Math.max(MIN_WIDTH, W - 2 * GAP))
    const left = memory.placed === null ? Math.max(0, W - width - GAP) : clamp(memory.placed.x, 0, Math.max(0, W - width))
    const top = memory.placed === null ? GAP : clamp(memory.placed.y, 0, Math.max(0, H - MIN_HEIGHT))
    const height = clamp(memory.height ?? Math.min(DEFAULT_HEIGHT, H - top - GAP), MIN_HEIGHT, Math.max(MIN_HEIGHT, H - top))
    card.style.left = `${left}px`
    card.style.top = `${top}px`
    card.style.width = `${width}px`
    card.style.height = `${height}px`
    return { left, top, width, height }
  }

  useLayoutEffect(() => {
    if (host === null) return
    place()
    const observer = new ResizeObserver(() => place())
    observer.observe(host)
    return () => observer.disconnect()
    // `place` reads only refs, the memory and `host`.
  }, [host])

  // Unpinned, a mousedown outside the card closes it (D17). A hidden tab's card hears none: that click is in another tab.
  // A menu or a popover on `document.body` is the card's own (YAZ-4635 P1): the Properties panel portals its row menu
  // and its property popover there, and only a surface opened from the card can be open while the card is — a
  // mousedown anywhere else closed it first. So a click in one is a click in the card.
  useEffect(() => {
    if (pinned) return
    const onDown = (event: MouseEvent) => {
      const card = cardRef.current
      if (card === null || (event.target instanceof Node && card.contains(event.target))) return
      if (event.target instanceof Element && event.target.closest('.ctx-menu, .view-popover') !== null) return
      if (card.closest('.tabstack__layer--hidden') !== null) return
      closeRef.current()
    }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [pinned])

  /** A pointer drag: `move` on each move, the cursor on the whole page until the drop, then the page keeps the memory (13H). */
  const track = (cursor: string, start: MouseEvent | ReactMouseEvent, move: (dx: number, dy: number) => void) => {
    const zoom = host === null ? 1 : cssZoom(host)
    host?.style.setProperty('--page-window-cursor', cursor)
    host?.classList.add('page-window-tracking')
    const onMove = (event: MouseEvent) => move((event.clientX - start.clientX) / zoom, (event.clientY - start.clientY) / zoom)
    const onUp = () => {
      window.removeEventListener('mousemove', onMove, true)
      window.removeEventListener('mouseup', onUp, true)
      host?.classList.remove('page-window-tracking')
      onPlaced?.(memory)
    }
    window.addEventListener('mousemove', onMove, true)
    window.addEventListener('mouseup', onUp, true)
  }

  const onHeadDown = (event: ReactMouseEvent) => {
    if (event.button !== 0 || (event.target instanceof Element && event.target.closest('button') !== null)) return
    event.preventDefault()
    const size = hostSize()
    const from = place(size)
    if (from === null) return
    track('grabbing', event, (dx, dy) => {
      memory.placed = { x: from.left + dx, y: from.top + dy }
      place(size)
    })
  }

  const onGripDown = (grip: (typeof GRIPS)[number]) => (event: ReactMouseEvent) => {
    if (event.button !== 0 || host === null) return
    event.preventDefault()
    event.stopPropagation()
    const size = hostSize()
    const from = place(size)
    if (from === null) return
    const { W, H } = size
    const right = from.left + from.width
    const bottom = from.top + from.height
    track(grip.cursor, event, (dx, dy) => {
      let { left, top, width, height } = from
      if (grip.x === 1) width = clamp(from.width + dx, MIN_WIDTH, Math.max(MIN_WIDTH, W - left))
      if (grip.x === -1) {
        width = clamp(from.width - dx, MIN_WIDTH, Math.max(MIN_WIDTH, right))
        left = right - width
      }
      if (grip.y === 1) height = clamp(from.height + dy, MIN_HEIGHT, Math.max(MIN_HEIGHT, H - top))
      if (grip.y === -1) {
        height = clamp(from.height - dy, MIN_HEIGHT, Math.max(MIN_HEIGHT, bottom))
        top = bottom - height
      }
      memory.placed = { x: left, y: top }
      memory.width = width
      memory.height = height
      place(size)
    })
  }

  /** The double click on the head: back to the default place and size. */
  const reset = (event: ReactMouseEvent) => {
    if (event.target instanceof Element && event.target.closest('button') !== null) return
    memory.placed = null
    memory.width = null
    memory.height = null
    place()
    onPlaced?.(memory)
  }

  const onKeyDown = (event: ReactKeyboardEvent) => {
    // The page's own keys first: an open cell note in the card steps its own pages by the same keys.
    if (event.defaultPrevented && event.key !== 'Escape') return
    const overrides = storage.getSettings()?.hotkeys
    const dir = isPageKey(event, 'page.nextCellNote', overrides) ? 1 : isPageKey(event, 'page.previousCellNote', overrides) ? -1 : 0
    if (dir !== 0) {
      if (step(dir)) event.preventDefault()
      return
    }
    if (event.key !== 'Escape' || pinned) return
    // A pop-up of the editor (the `[[` picker, a menu) took this Esc when the caret is still in the card. The editor's
    // own Esc goes back to the sidebar (`escapeToSidebar`): the card closes then too.
    if (event.defaultPrevented && cardRef.current?.contains(document.activeElement)) return
    event.preventDefault()
    event.stopPropagation()
    onClose()
  }

  const title = titleOf(path)
  const keep = (event: ReactMouseEvent) => event.preventDefault()
  const card = (
    <div ref={cardRef} className="page-window" role="dialog" aria-label={`Mini window: ${title}`} onKeyDown={onKeyDown}>
      <div className="page-window__head" onMouseDown={onHeadDown} onDoubleClick={reset}>
        <span className="cell-note-card__title" title={title}>
          {title}
        </span>
        <button type="button" className="cell-note-card__pin" title={pinned ? 'Unpin mini window' : 'Pin mini window'} aria-label={pinned ? 'Unpin mini window' : 'Pin mini window'} aria-pressed={pinned} onMouseDown={keep} onClick={() => setPinned((memory.pinned = !pinned))}>
          <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M6 2h4l-.6 4.2L12 9H4l2.6-2.8z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            <path d="M8 9v5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </button>
        <button type="button" className="cell-note-card__step" title="Previous row" aria-label="Previous row" disabled={previous === undefined} onMouseDown={keep} onClick={() => step(-1)}>
          ‹
        </button>
        <span className="cell-note-card__count">{found === -1 ? '' : `${found + 1} of ${order.length}`}</span>
        <button type="button" className="cell-note-card__step" title="Next row" aria-label="Next row" disabled={next === undefined} onMouseDown={keep} onClick={() => step(1)}>
          ›
        </button>
        <button
          type="button"
          className="cell-note-card__step page-window__open"
          title="Open in new tab"
          aria-label="Open in new tab"
          onMouseDown={keep}
          // The window stays (YAZ-3746 13AJ): the page opens in a new tab, and back on this tab the window is where it was.
          onClick={() => onOpenInTab(path)}
        >
          ↗
        </button>
        <button type="button" className="cell-note-card__close" title="Close mini window" aria-label="Close mini window" onMouseDown={keep} onClick={onClose}>
          ×
        </button>
      </div>
      <div key={path} className="page-window__body">
        <PropertiesOpenMemory.Provider value={propertiesOpen}>{renderEditor(path)}</PropertiesOpenMemory.Provider>
      </div>
      {GRIPS.map((grip) => (
        <span key={grip.name} className="page-window__grip" data-grip={grip.name} onMouseDown={onGripDown(grip)} />
      ))}
    </div>
  )
  return (
    <>
      <span ref={anchorRef} hidden />
      {host !== null && createPortal(card, host)}
    </>
  )
}
