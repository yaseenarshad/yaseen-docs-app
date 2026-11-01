import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { titleWithKey, type HotkeyOverrides } from '@shared/hotkeyBindings'
import { rootOfPath, type DiagramDarkColors, type ScreenPoint, type TabRef } from '@shared/types'
import { ContextMenuSurface } from '../components/ContextMenuSurface'
import { dropIndex, slotAt, slotUnder } from '../lib/dragSlot'
import { edgeScroller } from '../lib/edgeScroll'
import { pageLabel, useFolderPaths, type PathTitles } from '../lib/pageLabel'
import { FileIcon, NameEnding } from '../sidebar/FileIcon'
import { AsleepIcon, GridIcon, PlusIcon, SidebarPanelIcon } from '../views/view/icons'
import { dragWidth, foreignDrag, readPageDrag, windowTabOf, writePageDrag, type PageDrag } from '../workspace/pageDrag'
import type { Tab } from '../workspace/useWorkspace'
import type { ListState } from '../lists/useVaultListsHere'
import { TabMenu, type MoveTarget, type TabMenuAt } from './TabMenu'
import { TabNameField } from './TabNameField'
import { useBoardHighlight } from './boardHighlight'
import { CardPreviewHost, useCardPreview, type PreviewScope } from './cardPreview'
import { setStripTarget } from './stripDrop'
import './tabs.css'

export interface TabBarProps {
  /** The vaults of the window (YAZ-2602): the Files tree of the vault that holds a tab says whether it is a folder (YAZ-2290). */
  roots: readonly string[]
  /** This window's id (YAZ-3637 D1): a drag names the window it left, so another window's strip knows it is not its own. */
  windowId: string
  /** Open tabs, left→right. Two tabs may show one path (YAZ-2940 D1): keys and lookups use the id, labels and file calls the path. */
  tabs: readonly Tab[]
  /** The active tab's id (its path is the window's `file`); null with no tabs open. */
  active: string | null
  /** The preview tab's id (YAZ-2648 D1), or null: its label is italic until the tab is kept. */
  preview?: string | null
  /**
   * The blank tab shows (YAZ-2655 D10): "New tab", after the last tab, and the active one — no tab
   * of `tabs` is, whatever `active` says. It is no file: it does not drag and has no menu.
   */
  blank?: boolean
  /** ⌘T's button, the "+" after the tabs: App shows the blank tab and puts the caret in the search bar. Absent on a mount with no blank tab. */
  onNewTab?: () => void
  /** The blank tab's ✕ and a middle click on it: it closes alone. */
  onCloseBlank?: () => void
  /** The right panel is closed, and its "Show right panel" button floats over the row's end: the row keeps that room free (YAZ-2656 S93). */
  reserveEnd?: boolean
  /** A tab, by id. */
  onActivate: (id: string) => void
  /** A double click on a tab (YAZ-2648 D2), by id: the preview tab becomes a kept tab; any other tab is one already. The same double click opens the name's field (YAZ-3059). */
  onKeep?: (id: string) => void
  /** A tab's ✕ or middle click, by id: that tab alone, a copy too. */
  onClose: (id: string) => void
  /** Drag-to-reorder (I3, GRO-2235): the tab at `from` lands at final index `to`. */
  onMove: (from: number, to: number) => void
  /** A validated page dropped from the right panel at a tab insertion slot. */
  onDropPage?: (page: PageDrag, at: number) => void
  /**
   * Whether this window takes the drag passing over it (YAZ-3637 D4, D6): a tab of ANOTHER window's strip, read off the
   * type names alone. True also for a page of a vault this window does not show: the drop then asks to add that vault.
   * False: no gap, the drop is not taken.
   */
  takesDrag?: (data: DataTransfer) => boolean
  /** Another window's tab dropped here (YAZ-3637 D4): the window `from`, its tab by ref, and the slot it lands in. */
  onDropFromWindow?: (from: string, ref: TabRef, at: number) => void
  /** A tab of another window reached this strip (YAZ-3808 6A6): bring this window to the front, once for each drag. */
  onRaise?: () => void
  /** A tab let go where no surface took it (YAZ-3637 D1, D3): off every window, or on one that refused it; `point` is on the screen. */
  onTearOff?: (path: string, id: string, point: ScreenPoint) => void
  /** Context-menu equivalent of dragging this tab into the right panel. */
  onMoveToRight?: (path: string) => void
  /** The menu's "Move to new window" (YAZ-2933): this tab, alone in a window of its own — its page, and its id to close it here. */
  onMoveToNewWindow?: (path: string, id: string) => void
  /** The other windows that can take a tab of `path` (YAZ-3091 D2): asked only while a tab menu is open, for its "Move to ▸". */
  onMoveTargets?: (path: string) => readonly MoveTarget[]
  /** "Move to ▸ <window>" (YAZ-3091 D1): the page by path to the open window `to`; only this tab (by id) closes here. */
  onMoveToWindow?: (to: string, path: string, id: string) => void
  /** "Move to ▸": the window a row points at glows (YAZ-3091 D8). */
  onHighlightWindow?: (to: string | null) => void
  /** "Duplicate tab" (YAZ-2940 D5): a copy of the tab, by id. */
  onDuplicate?: (id: string) => void
  /** "Set display name" / "Reset to page name" (YAZ-2949): a name for the tab, by id, or null for its page name. */
  onSetName?: (id: string, name: string | null) => void
  /** History (YAZ-721): the active tab's own back/forward stack has somewhere to go. */
  canBack: boolean
  canForward: boolean
  onBack: () => void
  onForward: () => void
  /** The steps behind and ahead of the page in front, the nearest first (YAZ-3647 E3): the rows of the menu of ‹ and ›. */
  backSteps?: readonly NavStep[]
  forwardSteps?: readonly NavStep[]
  /** A row of that menu: straight to the step with this id (YAZ-3678 F4); a step that is gone by then: nothing. */
  onGoToStep?: (id: number) => void
  /** Each bullet's crumb text by zoom key (YAZ-3647 E3, E4): a row's " › bullet" and a zoomed tab's tooltip. A key not in it shows the page name alone. */
  zoomLabels?: ReadonlyMap<string, string>
  /**
   * Collapsed sidebar (YAZ-1759): the reopen control sits HERE, left of ◀, instead of floating
   * over it. Absent while the sidebar is open.
   */
  onShowSidebar?: () => void
  /** Reveal this exact tab in the sidebar without activating it. */
  onShowInSidebar?: (path: string) => void
  /**
   * The tab overview's button (YAZ-2648 D8), right of ▶: it opens the overview, and closes it again.
   * Absent on a mount with no overview.
   */
  onToggleOverview?: () => void
  /** Whether the overview shows: the button's one state. */
  overviewOpen?: boolean
  /** The grid button's right-click menu (YAZ-2739): "Kill all tabs". App asks first. Absent, the button has no menu. */
  onKillAll?: () => void
  /** The same menu's two saves (YAZ-3147 D5): "Save tabs as session" (`false`) and "Save and close all tabs" (`true`). App saves, then closes all tabs for `true`. */
  onSaveSession?: (closeAll: boolean) => void
  /**
   * Where a failed OS action says so (YAZ-963) — App's passive notice. Optional: a mount with
   * nowhere to show one loses the message, never the gesture.
   */
  onNotice?: (message: string) => void
  /** The window's titles (YAZ-2420 🔒 D14): a tab is labelled with its page's title. */
  titles: PathTitles
  /**
   * The review toggle (YAZ-2322), the sidebar row's item on a tab: whether a path is in review —
   * null for anything that is not a note in the index — and the write. App's, like the row's.
   */
  reviewState?: (path: string) => boolean | null
  onSetReview?: (path: string, on: boolean) => void
  /**
   * Focus and Favorites on a tab (YAZ-3264 D2), the sidebar row's items: where a path stands in the
   * two lists — null hides both items — and the two toggles. App's lists (D1), so they work with the
   * sidebar hidden; a toggle only toasts (D3).
   */
  listState?: (path: string) => ListState | null
  onToggleFocus?: (paths: string[], isOn: boolean) => void
  onToggleFavorite?: (paths: string[], isOn: boolean) => void
  /** Settings › Preview on hover › Tabs (YAZ-3403): resting on a tab that is not on show opens the sidebar's panel below it. */
  hoverPreview?: boolean
  /** What the hover panel needs of a tab's vault: App's `boardPreviewScope`. No scope, no hover panel. */
  previewScope?: (path: string) => PreviewScope
  diagramDarkColors?: DiagramDarkColors
  /** `settings.hotkeys` (YAZ-3397 D2): the "+" and the grid button name their keys as they are now (YAZ-3410). Absent = the defaults. */
  hotkeys?: HotkeyOverrides
  /** The tabs asleep to save memory (YAZ-3737 D11): each wears the zzz mark before its name (D18). */
  asleep?: ReadonlySet<string>
  /** A sleeping tab hovered `WAKE_HOVER_MS` (YAZ-3737 S7): App mounts its editor behind the page on show, so the click feels instant. */
  onWake?: (id: string) => void
}

/** How long a sleeping tab is hovered before it wakes (YAZ-3737 S7): a pointer that only crosses it wakes nothing. */
export const WAKE_HOVER_MS = 150
const NONE_ASLEEP: ReadonlySet<string> = new Set()

/** How long a tab slides open or shut, in ms (YAZ-2656 D12). The row hands it to the stylesheet as `--tab-slide-ms`, so the slide and the ghost's timer take the same time. */
const SLIDE_MS = 150
/** How long the tabs take to slide aside for the live gap of a drag, in ms (YAZ-3808 6A; tuned in the demo). The row hands it to the stylesheet as `--tab-part-ms`. */
const PART_MS = 150
const SLIDE = { '--tab-slide-ms': `${SLIDE_MS}ms`, '--tab-part-ms': `${PART_MS}ms` } as CSSProperties
/** The room the tabs open for a tab from elsewhere, in px (YAZ-3808 6A): about one tab, whose width is not known until it lands. */
const ARRIVAL_ROOM = 124
/** How long the gap waits for a tab of another window that was let go here, in ms (YAZ-3808 6A1): a take refused, or one that asks first, never lands. */
const LANDING_MS = 1500
/** How long a tab glides to its new place after a reorder, in ms (YAZ-3808 D6; tuned in the demo). */
const GLIDE_MS = 200

/** A tab that closed, for as long as it slides shut: its label, and the id of the tab it stood before (null: the end). */
interface Ghost {
  key: number
  label: string
  before: string | null
}

/** In-flight drag state: the grabbed tab's index + the hovered insertion slot (0…tabs.length). */
interface DragState {
  from: number
  over: number | null
  /** The room the grabbed tab leaves (YAZ-3808 6A): its width and the strip's gap, in px. */
  room: number
  /** The tab has left the strip, one frame after the drag starts: the Mac takes its picture first (YAZ-3637 D7). */
  lifted: boolean
}

/** The room a tab of the strip takes: its width and the strip's gap between tabs, in px (YAZ-3808 6A). */
const roomOf = (tab: HTMLElement, strip: HTMLElement | null): number =>
  tab.offsetWidth + (strip === null ? 0 : parseFloat(getComputedStyle(strip).columnGap) || 0)

/** A tab's slide in the live gap (6A), and the width a close holds for it (6A5). */
const tabStyle = (shift: number, width: number | undefined): CSSProperties | undefined =>
  shift === 0 && width === undefined
    ? undefined
    : { ...(shift === 0 ? {} : { transform: `translateX(${shift}px)` }), ...(width === undefined ? {} : { minWidth: width, maxWidth: width }) }

/**
 * A tab's width as the tab on show (YAZ-3808 6A4): as wide as its whole name, in its least and most. A full strip
 * squeezes the others. The name is measured in the look of the tab on show, which sets it heavier (6A9): the tab lands
 * as that one. Its own look is back before anything paints.
 */
const shownWidth = (tab: HTMLElement): number | undefined => {
  const label = tab.querySelector<HTMLElement>('.tabbar__label')
  const btn = tab.querySelector<HTMLElement>('.tabbar__btn')
  if (label === null || btn === null) return undefined
  const selected = btn.getAttribute('aria-selected')
  btn.setAttribute('aria-selected', 'true')
  try {
    const style = getComputedStyle(tab)
    const width = tab.getBoundingClientRect().width - label.getBoundingClientRect().width + label.scrollWidth
    return Math.min(parseFloat(style.maxWidth) || Infinity, Math.max(parseFloat(style.minWidth) || 0, width))
  } finally {
    if (selected === null) btn.removeAttribute('aria-selected')
    else btn.setAttribute('aria-selected', selected)
  }
}

const Chevron = ({ d }: { d: string }) => (
  <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
)

/**
 * The window tab strip (Tabs I2/I3, GRO-2234/2235): each tab keyed by its own id, since two tabs
 * may show one file (YAZ-2940 D1) — ViewTabs' tablist
 * semantics (role=tab, aria-selected). The tabs are pills (YAZ-2656 R40, R41): each has a fill of
 * its own, the active one the brightest, and none joins the page. Labels hide the extension of a note,
 * a drawing and a diagram (YAZ-3536 D1); other files keep theirs, a folder's is its whole name (YAZ-2290) and
 * every full path lives in the title tooltip. Tabs reorder by HTML5 drag (the
 * groupDrag idiom: `dataTransfer` guarded — jsdom's synthetic drags have none), the other tabs
 * moving apart at the drop slot; the strip scrolls when full and keeps the ACTIVE tab in view. A
 * tab that joins or leaves the strip slides open or shut. Left of
 * the strip sit the ◀ ▶ history buttons (YAZ-721), disabled when the active tab's stack has
 * nowhere to go — buttons only, per LOCKED ruling D2: no shortcut, no menu item. Right of them
 * the grid button shows every open tab at once (YAZ-2648 D8), and its right-click menu has one
 * item, "Kill all tabs" (YAZ-2739), which App answers with a sheet. The ONE preview tab (YAZ-2648 D1)
 * wears an italic label; a double click on it keeps it. A double click on any tab also turns its
 * name into the "Set display name" field (YAZ-3059). After the tabs a "+" shows the blank tab
 * (YAZ-2655): it stands outside the scroller, so it is on show however far the strip scrolled.
 * Presentational only — all durable state changes go through workspace callbacks.
 */
/** A step of the window's Back list, as the menu of ‹ or › lists it (YAZ-3647 E3), by its id (YAZ-3678 F4): never its place, which a close can move. */
export interface NavStep {
  id: number
  path: string
  zoom: string | null
}

/** How long a press on ‹ or › is held before its menu opens instead of a step (YAZ-3647 E3), as in Chrome. */
export const NAV_HOLD_MS = 500

export function TabBar({ roots, windowId, tabs, active, preview = null, blank = false, onNewTab, onCloseBlank, reserveEnd = false, onActivate, onKeep, onClose, onMove, onDropPage, takesDrag, onDropFromWindow, onRaise, onTearOff, onMoveToRight, onMoveToNewWindow, onMoveTargets, onMoveToWindow, onHighlightWindow, onDuplicate, onSetName, canBack, canForward, onBack, onForward, backSteps = [], forwardSteps = [], onGoToStep, zoomLabels, onShowSidebar, onShowInSidebar, onToggleOverview, overviewOpen = false, onKillAll, onSaveSession, onNotice, titles, reviewState, onSetReview, listState, onToggleFocus, onToggleFavorite, hotkeys = {}, hoverPreview = false, previewScope, diagramDarkColors = 'adapt', asleep = NONE_ASLEEP, onWake }: TabBarProps) {
  const [drag, setDrag] = useState<DragState | null>(null)
  const [externalOver, setExternalOver] = useState<number | null>(null)
  // Right-click menu (YAZ-922): the tab IS the file, so it offers the sidebar row's Copy path —
  // and since YAZ-963 that row's OS actions too (Reveal in Finder, Open in VS Code). The items are
  // `TabMenu`'s, which the board's pages open too (YAZ-2648). The note's review state (YAZ-2322)
  // is read when the menu opens, so the review item is about the tab that was right-clicked; a
  // null state hides it. Focus and Favorites (YAZ-3264 D2) are read the same way.
  const [menu, setMenu] = useState<TabMenuAt | null>(null)
  /** The tab whose name is a field (YAZ-2949 D4), by id, or null. */
  const [renaming, setRenaming] = useState<string | null>(null)
  /** The grid button's own menu (YAZ-2739), and where it stands. */
  const [gridMenu, setGridMenu] = useState<{ x: number; y: number } | null>(null)
  /** The menu of ‹ or › (YAZ-3647 E3): its rows, and where it stands. */
  const [navMenu, setNavMenu] = useState<{ x: number; y: number; steps: readonly NavStep[] } | null>(null)
  /** A held press on ‹ or ›: its timer, and whether the menu opened, so the click that ends the press takes no step. */
  const hold = useRef<{ timer: number | undefined; opened: boolean }>({ timer: undefined, opened: false })
  useEffect(() => () => window.clearTimeout(hold.current.timer), [])
  const activeRef = useRef<HTMLDivElement | null>(null)
  // The page the tab board highlights (YAZ-2648): its tab is lit, and brought into view like the active one.
  const lit = useBoardHighlight()
  const litRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (lit !== null) litRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [lit])
  const isFolder = useFolderPaths(roots)
  const labelOf = (path: string): string => pageLabel(path, isFolder(path), titles)
  /** A page at a bullet (YAZ-3647 E3, E4): "Trip plan › Day 1: Lisbon"; the page name alone at the whole page, or when the bullet's text is not known. */
  const atBullet = (path: string, zoom: string | null | undefined): string => {
    const bullet = zoom === null || zoom === undefined ? undefined : zoomLabels?.get(zoom)
    return bullet === undefined ? labelOf(path) : `${labelOf(path)} › ${bullet}`
  }
  /**
   * ‹ and › (YAZ-3647 E3): a click takes one step; a right-click, or a press held NAV_HOLD_MS, opens the menu of the
   * steps that way instead, under the button for a held press. A right press leaves the keyboard focus where it is.
   */
  const navProps = (steps: readonly NavStep[], step: () => void) => ({
    onMouseDown: (e: ReactMouseEvent<HTMLButtonElement>) => {
      if (e.button === 2) e.preventDefault()
      if (e.button !== 0 || steps.length === 0 || onGoToStep === undefined) return
      const { left, bottom } = e.currentTarget.getBoundingClientRect()
      window.clearTimeout(hold.current.timer)
      hold.current = {
        opened: false,
        timer: window.setTimeout(() => {
          hold.current.opened = true
          setNavMenu({ x: left, y: bottom, steps })
        }, NAV_HOLD_MS),
      }
    },
    onMouseUp: () => window.clearTimeout(hold.current.timer),
    onMouseLeave: () => window.clearTimeout(hold.current.timer),
    onClick: () => {
      if (hold.current.opened) hold.current.opened = false
      else step()
    },
    onContextMenu: (e: ReactMouseEvent<HTMLButtonElement>) => {
      e.preventDefault()
      if (steps.length > 0 && onGoToStep !== undefined) setNavMenu({ x: e.clientX, y: e.clientY, steps })
    },
  })
  // The hover panel (YAZ-3403): the sidebar's own panel below a tab that is not on show, after the sidebar's dwell. Its
  // dwell lives in a tiny store, so a pointer crossing tabs draws no strip. A click, a right-click, a drag, a key, the
  // wheel and a scroll close it in the hook (each drag and menu starts with a press). Here: a new tab on show, a rename
  // (one that a command starts has no press), and the hovered tab gone (another window closed it: no `mouseleave`).
  const stripRef = useRef<HTMLDivElement | null>(null)
  // A tab board card over the strip (YAZ-3808 D1): the board holds it here on each pointer move, and the strip opens the
  // same gap as a drag. The strip scrolls at its ends while any drag is held there (D5); a held card's slot is read
  // again as the strip moves under a pointer that stays still (an HTML5 drag's `dragover` repeats by itself).
  const [boardOver, setBoardOver] = useState<number | null>(null)
  const boardPoint = useRef<{ x: number; y: number } | null>(null)
  /** The held card's own tab (this window's card), by id: a slot either side of it moves nothing, so no gap opens there. */
  const [boardOwn, setBoardOwn] = useState<string | null>(null)
  /** The room the held card's own tab leaves in the strip (YAZ-3808 6A), read when the hold starts. */
  const boardRoom = useRef(0)
  /** The held card's name, for its tab in the gap (YAZ-3808 6D). */
  const [boardLabel, setBoardLabel] = useState<string | null>(null)
  /** A drag went over the strip, and the mouse has not moved since: the page's hover is stale (YAZ-3808 6F). */
  const [staleHover, setStaleHover] = useState(false)
  /**
   * A tab from elsewhere let go here (YAZ-3808 6A1): its gap stays open until it lands — a tab of another window comes
   * through main, a moment after the drop — and it lands in the gap with no slide-open. `count`: the tabs before it lands.
   */
  const [arrival, setArrival] = useState<{ at: number; count: number; room: number; yields: boolean } | null>(null)
  /** The room a tab of another window takes here (6A4), from its drag: as wide as it will be as the tab on show. */
  const externalRoom = useRef<{ width: number; room: number } | null>(null)
  /** This window came to the front for the drag over its strip now (6A6). */
  const raised = useRef(false)
  const waiting = arrival !== null && tabs.length === arrival.count ? arrival : null
  const arrived = arrival !== null && tabs.length === arrival.count + 1
  /** The held card's own tab, and the tabs there are, for `release` (the strip target is set once). */
  const boardOwnRef = useRef<string | null>(null)
  const tabCount = useRef(tabs.length)
  tabCount.current = tabs.length
  const [scroller] = useState(() =>
    edgeScroller(
      () => stripRef.current,
      () => {
        const p = boardPoint.current
        if (p !== null) setBoardOver(slotUnder(stripRef.current, p.x, p.y))
      },
    ),
  )
  useEffect(() => {
    setStripTarget({
      hold: (x, y, own, label) => {
        const slot = slotUnder(stripRef.current, x, y)
        const tab = own === undefined ? null : (stripRef.current?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(own)}"]`) ?? null)
        if (tab !== null) boardRoom.current = roomOf(tab, stripRef.current)
        boardOwnRef.current = own ?? null
        setBoardOwn(own ?? null)
        setBoardLabel(label ?? null)
        boardPoint.current = slot === null ? null : { x, y }
        setBoardOver(slot)
        if (slot === null) scroller.stop()
        else scroller.at(x)
        return slot !== null
      },
      release: (x, y) => {
        boardPoint.current = null
        scroller.stop()
        setBoardOver(null)
        setBoardLabel(null)
        const slot = x === undefined || y === undefined ? null : slotUnder(stripRef.current, x, y)
        // Another window's card lands through main: its gap waits for it (6A1). This window's own card only moves.
        if (slot !== null && boardOwnRef.current === null) setArrival({ at: slot, count: tabCount.current, room: ARRIVAL_ROOM, yields: false })
        return slot
      },
    })
    return () => {
      scroller.stop()
      setStripTarget(null)
    }
  }, [scroller])
  const tabPreview = useCardPreview(hoverPreview, (id) => stripRef.current?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(id)}"]`) ?? null)
  const closeTabPreview = tabPreview.close
  useEffect(() => closeTabPreview(), [active, blank, renaming, closeTabPreview])
  const tabStore = tabPreview.store
  useEffect(() => {
    const { id } = tabStore.getState()
    if (id !== null && !tabs.some((t) => t.id === id)) closeTabPreview()
  }, [tabs, tabStore, closeTabPreview])
  // The hover wake (YAZ-3737 S7): one timer, for the tab under the pointer; leaving it, or the strip going, stops it.
  const wakeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stopWake = (): void => {
    if (wakeTimer.current !== null) clearTimeout(wakeTimer.current)
    wakeTimer.current = null
  }
  useEffect(() => stopWake, [])
  const hoverWake = (id: string): void => {
    stopWake()
    if (onWake === undefined || !asleep.has(id)) return
    wakeTimer.current = setTimeout(() => {
      wakeTimer.current = null
      onWake(id)
    }, WAKE_HOVER_MS)
  }
  const previewTab = (id: string): { root: string | null; name: string } | null => {
    const tab = tabs.find((t) => t.id === id)
    return tab === undefined ? null : { root: rootOfPath(roots, tab.path), name: tab.name ?? labelOf(tab.path) }
  }

  // Overflow polish (I3): tabs shrink to a floor and the strip scrolls, so scroll the active
  // tab fully into view on every activation. jsdom has no scrollIntoView — hence the `?.()`.
  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [active, blank])

  // THE SLIDE (YAZ-2656 D12, S88). A tab that JOINS the strip slides open: the count grew, and the
  // tab is not the page that filled the blank tab, which stood there already. A page that takes a
  // tab's place — the preview tab's next page, a rename — keeps that tab's id and its room, and
  // does not slide. The class stays on the tab until the slide ends, so no render in the middle
  // of the slide cuts it; then it goes, since a tab that moves is put back in the strip, and a
  // class still on it would run the slide again: a flash (YAZ-3808 6C). A tab that LEAVES is gone from `tabs` at once,
  // so a ghost of it — a label, nothing to act on — slides shut where it stood and is dropped
  // after. All of it is this component's own: no editor renders for a slide.
  const last = useRef({ tabs, blank })
  const slidIn = useRef(new Set<string>())
  const [ghosts, setGhosts] = useState<Ghost[]>([])
  const ghostKey = useRef(0)
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  // A tab from elsewhere let go in the live gap lands in the room open for it, and does not slide open (6A1).
  if (tabs.length > last.current.tabs.length && !(last.current.blank && !blank) && !arrived) {
    for (const tab of tabs) if (!last.current.tabs.some((t) => t.id === tab.id)) slidIn.current.add(tab.id)
  }
  useEffect(() => {
    const was = last.current
    last.current = { tabs, blank }
    const open = new Set(tabs.map((t) => t.id))
    for (const id of slidIn.current) if (!open.has(id)) slidIn.current.delete(id)
    // With no motion asked for — and where there is no `matchMedia` to ask — nothing slides shut.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches !== false) return
    const gone: Ghost[] = []
    if (tabs.length < was.tabs.length) {
      was.tabs.forEach((tab, i) => {
        if (!open.has(tab.id)) gone.push({ key: ++ghostKey.current, label: labelOf(tab.path), before: was.tabs.slice(i + 1).find((next) => open.has(next.id))?.id ?? null })
      })
    }
    // The blank tab that went unused; one that a page filled is that page's tab now.
    if (was.blank && !blank && tabs.length === was.tabs.length) gone.push({ key: ++ghostKey.current, label: 'New tab', before: null })
    if (gone.length === 0) return
    setGhosts((now) => [...now, ...gone])
    const timer = setTimeout(() => {
      timers.current.delete(timer)
      setGhosts((now) => now.filter((ghost) => !gone.includes(ghost)))
    }, SLIDE_MS)
    timers.current.add(timer)
    // `labelOf` reads the newest titles; the tabs and the blank tab are what a slide follows.
  }, [tabs, blank])
  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach(clearTimeout)
  }, [])
  // THE GLIDE (YAZ-3808 D6). A reorder — the same tabs in a new order: a drag, a tab board card, a move from anywhere —
  // slides each tab that changed place from where it stood to where it stands now, so the eye can follow it. Only a
  // new ORDER glides: a tab that joins or leaves slides as above, and a new name or zoom moves nothing. The places
  // before are read in the render that brings the new order, while the strip still shows the old one; the places
  // after, as it commits. No reads on any other render, never on a keystroke; the animation is the compositor's.
  // The places before are where the tabs are DRAWN: a drop into the live gap (6A) commits the order the strip already
  // shows, so nothing glides; the tab let go stood nowhere (it had left the strip), so it does not glide either.
  const order = useRef<readonly string[]>([])
  const glideFrom = useRef<Map<string, number> | null>(null)
  const ids = tabs.map((t) => t.id)
  const drawnPlaces = (): Map<string, number> => {
    const strip = stripRef.current
    const origin = strip === null ? 0 : strip.getBoundingClientRect().left + strip.clientLeft - strip.scrollLeft
    const drawn = [...(strip?.querySelectorAll<HTMLElement>('[data-tab]:not(.tabbar__tab--dragging)') ?? [])]
    return new Map(drawn.map((el) => [el.dataset.tab!, el.getBoundingClientRect().left - origin]))
  }
  // A tab that lands in the live gap (6A1) does not glide; the tabs after it glide the rest of the way, from the room
  // the gap held to the room the tab takes.
  if (arrived || (ids.length === order.current.length && ids.some((id, i) => id !== order.current[i]) && ids.every((id) => order.current.includes(id)))) {
    glideFrom.current = drawnPlaces()
  }
  // THE HOLD (YAZ-3808 6A5, as Chrome does it). A tab closed with the mouse — its ✕, a middle click — leaves each other
  // tab its width, and the tab that takes its place takes its width too: the next ✕ comes under the mouse, and a click
  // there closes the next tab. The widths stay until the mouse leaves the strip, or the strip changes another way; then
  // the tabs glide to their own widths.
  const [held, setHeld] = useState<{ widths: ReadonlyMap<string, number>; ids: string } | null>(null)
  const holding = held !== null && held.ids === ids.join('\n') ? held : null
  const closeByMouse = (id: string) => {
    const i = tabs.findIndex((t) => t.id === id)
    const drawn = [...(stripRef.current?.querySelectorAll<HTMLElement>('[data-tab]') ?? [])]
    const widths = new Map(drawn.map((el) => [el.dataset.tab!, el.getBoundingClientRect().width]))
    const next = tabs[i + 1]
    if (next !== undefined && widths.has(id)) widths.set(next.id, widths.get(id)!)
    widths.delete(id)
    setHeld({ widths, ids: ids.filter((t) => t !== id).join('\n') })
    onClose(id)
  }
  useEffect(() => {
    if (held === null) return
    if (holding === null) return setHeld(null)
    const row = stripRef.current?.parentElement
    const letGo = () => {
      glideFrom.current = drawnPlaces()
      setHeld(null)
    }
    const moved = (event: MouseEvent) => {
      if (!(event.target instanceof Node && row?.contains(event.target) === true)) letGo()
    }
    window.addEventListener('mousemove', moved)
    document.addEventListener('mouseleave', letGo)
    return () => {
      window.removeEventListener('mousemove', moved)
      document.removeEventListener('mouseleave', letGo)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `drawnPlaces` reads the strip as it is drawn when the hold ends
  }, [held, holding])
  useLayoutEffect(() => {
    order.current = tabs.map((t) => t.id)
    const from = glideFrom.current
    glideFrom.current = null
    if (from === null || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches !== false) return
    for (const el of stripRef.current?.querySelectorAll<HTMLElement>('[data-tab]') ?? []) {
      const dx = (from.get(el.dataset.tab!) ?? el.offsetLeft) - el.offsetLeft
      // Under a pixel is rounding, not a move.
      if (Math.abs(dx) >= 1) el.animate?.([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], { duration: GLIDE_MS, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' })
    }
  }, [tabs, held])
  const ghostsBefore = (id: string | null) =>
    ghosts
      .filter((ghost) => ghost.before === id)
      .map((ghost) => (
        <div key={`ghost:${ghost.key}`} className="tabbar__tab tabbar__tab--out" aria-hidden>
          <span className="tabbar__btn">
            <span className="tabbar__label">{ghost.label}</span>
          </span>
        </div>
      ))
  useEffect(() => {
    if (externalOver === null) return
    const clear = () => {
      setExternalOver(null)
      scroller.stop()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') clear()
    }
    // The drop on the way down: App stops another window's tab dropped off the strip before it bubbles (YAZ-3637 D4),
    // and that drag's `dragend` fires in ITS window, not here. A drop on the row is the row's (6A3): cleared here, the
    // gap closed before the strip read the drop's slot, and in a full strip the tabs widened under it.
    const dropped = (event: Event) => {
      if (!(event.target instanceof Node && stripRef.current?.parentElement?.contains(event.target) === true)) clear()
    }
    window.addEventListener('dragend', clear)
    window.addEventListener('drop', dropped, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('dragend', clear)
      window.removeEventListener('drop', dropped, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [externalOver, scroller])

  const drop = (insertion: number): void => {
    scroller.stop()
    if (drag === null) return
    setDrag(null)
    const to = dropIndex(drag.from, insertion)
    if (to !== drag.from) onMove(drag.from, to)
  }

  const externalPage = (event: DragEvent): PageDrag | null => {
    if (drag !== null || onDropPage === undefined || event.dataTransfer === null) return null
    // Another window's drag (YAZ-3637 D1) is `foreignTab`'s, never a right-panel page of this one. Another window's
    // right-panel page names no vault, so only its data on the drop tells it apart (D8: it lands nowhere here).
    if (foreignDrag(event.dataTransfer, windowId) !== null) return null
    const page = readPageDrag(event.dataTransfer)
    return page?.owner === 'right' && page.from === windowId && !tabs.some((t) => t.path === page.path) ? page : null
  }

  // A tab of ANOTHER window passing over (YAZ-3637 D1, D6), as App reads it (`takesDrag`). No door, no take.
  const foreignTab = (event: DragEvent): boolean =>
    drag === null && onDropFromWindow !== undefined && event.dataTransfer !== null && takesDrag?.(event.dataTransfer) === true

  const dropExternal = (event: DragEvent, insertion: number): void => {
    setExternalOver(null)
    setStaleHover(true)
    scroller.stop()
    if (foreignTab(event)) {
      const tab = event.dataTransfer === null ? null : windowTabOf(event.dataTransfer)
      if (tab === null) return
      event.preventDefault()
      setArrival({ at: insertion, count: tabs.length, room, yields: true })
      onDropFromWindow?.(tab.from, tab.ref, insertion)
      return
    }
    const page = externalPage(event)
    if (page === null) return
    event.preventDefault()
    setArrival({ at: insertion, count: tabs.length, room, yields: true })
    onDropPage?.(page, insertion)
  }

  /** The slot at a client x of the strip (6A): by the layout, which the live gap does not move. */
  const pointSlot = (x: number): number => (stripRef.current === null ? tabs.length : slotAt(stripRef.current, x))

  // A slot that is no tab's, for room around the tabs. The END slot: the row's tail after the "+" — the room a drag
  // reaches when it goes past the last tab; direct hits only, since a tab marks its own hover. The tablist's own room
  // (its padding, the live gap) is the slot at the pointer (6A). The "+" and ‹ › too (YAZ-3808 D5, YAZ-3984): the
  // strip scrolls while a drag rests on them, so a drop there lands at the end, or at the first tab on show, never off
  // every surface (a tear-off).
  // A place that takes a drag takes it on `dragenter` as on `dragover` (6A10): when the element under the pointer
  // changes, Chromium sends `dragenter` to the new one and `dragleave` to the old one, and no `dragover` until the next
  // update. A place that did not cancel its `dragenter` refuses the drop. No place shuts the gap when it is left: the
  // next place sets its own slot, a drag that leaves the row shuts it there, and one over a part of the row that takes
  // no drag shuts it in the row's `dragover`. The slot is set each time, never from what the last render read (6A7).
  const slotZone = (slotOf: (e: DragEvent<HTMLElement>) => number, direct: boolean) => {
    const over = (e: DragEvent<HTMLElement>) => {
      if (direct && e.target !== e.currentTarget) return
      const at = slotOf(e)
      if (drag !== null) {
        e.preventDefault()
        if (drag.over !== at) setDrag({ ...drag, over: at })
        return
      }
      if (externalPage(e) === null && !foreignTab(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
      setExternalOver(at)
    }
    return {
      onDragEnter: over,
      onDragOver: over,
      onDrop: (e: DragEvent<HTMLElement>) => {
        if (direct && e.target !== e.currentTarget) return
        if (drag !== null) {
          e.preventDefault()
          drop(slotOf(e))
        } else dropExternal(e, slotOf(e))
      },
    }
  }
  /** A drag over a tab: its half says the slot (6A). On `dragenter` too, as for each place above (6A10). */
  const overTab = (e: DragEvent<HTMLElement>) => {
    const over = pointSlot(e.clientX)
    if (drag !== null) {
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
      if (drag.over !== over) setDrag({ ...drag, over })
      return
    }
    if (externalPage(e) === null && !foreignTab(e)) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    setExternalOver(over)
  }
  const endSlot = slotZone(() => tabs.length, true)
  // The tablist's own room is the gap's too (6A): the empty place between the parted tabs is the strip's, not its end.
  const stripSlot = slotZone((e) => pointSlot(e.clientX), true)
  const plusSlot = slotZone(() => tabs.length, false)
  const firstShownSlot = slotZone(() => {
    const r = stripRef.current?.getBoundingClientRect()
    return r === undefined ? 0 : (slotUnder(stripRef.current, r.left, r.top + r.height / 2) ?? 0)
  }, false)
  // Where the tabs part (YAZ-2656 S89): the slot a drop would land in — and none where a drop
  // would leave the grabbed tab in its place, on either side of it.
  // A tab board card over the strip (YAZ-3808 D1) opens the same gap.
  const over = drag?.over ?? externalOver ?? boardOver ?? waiting?.at ?? null
  const from = drag?.from ?? (boardOver === null || boardOwn === null ? -1 : tabs.findIndex((t) => t.id === boardOwn))
  const gap = over === null || (from !== -1 && (over === from || over === from + 1)) ? null : over
  // THE LIVE GAP (YAZ-3808 6A): the grabbed tab's room moves to the slot. The tabs between the two slide toward the
  // grab point by one room; a tab from elsewhere has no room in the strip, so the tabs after the slot slide into room
  // opened at the strip's end.
  const room = drag?.room ?? (from !== -1 ? boardRoom.current : externalOver !== null ? (externalRoom.current?.room ?? ARRIVAL_ROOM) : (waiting?.room ?? ARRIVAL_ROOM))
  const shiftOf = (i: number): number => {
    if (gap === null) return 0
    if (from === -1) return i >= gap ? room : 0
    return from < i && i < gap ? -room : gap <= i && i < from ? room : 0
  }
  const parting = drag !== null || externalOver !== null || boardOver !== null || waiting !== null
  // A tab let go here from elsewhere opens as the tab on show (YAZ-3637 D4), and the tab on show now goes back to its own
  // width. In a full strip that width is less, so the tabs after it moved under the drop (6A4). It goes back while the
  // tabs part instead, in the same motion, and the gap is as wide as the tab that comes: the drop moves nothing.
  const yielding = (externalOver !== null && gap !== null) || waiting?.yields === true
  useEffect(() => {
    if (arrival === null) return
    if (tabs.length !== arrival.count) return setArrival(null)
    // A take refused, or one that asks first, never lands: the gap gives way.
    const timer = setTimeout(() => setArrival(null), LANDING_MS)
    return () => clearTimeout(timer)
  }, [arrival, tabs.length])
  // No hover look on the tabs while they part, nor after a drag until the mouse moves (YAZ-3808 6F): the page hears no
  // mouse move during a drag, so its hover stays where the drag began, on the tab that slid into that place.
  const hoverless = parting || staleHover
  // The drag's slides end with it (YAZ-3808 6G): a slide still running when the drag ends — the tab on show grabbed,
  // most often — kept the tab drawn one room off its new place, and it slid back (a jump, in the demo). The glide
  // starts each tab from where it was drawn, so the new place shows at once and moves nothing more.
  const wasParting = useRef(false)
  useLayoutEffect(() => {
    if (wasParting.current && !parting) {
      for (const el of stripRef.current?.querySelectorAll<HTMLElement>('[data-tab]') ?? []) {
        for (const slide of el.getAnimations?.() ?? []) if ('transitionProperty' in slide) slide.cancel()
      }
    }
    wasParting.current = parting
  }, [parting])
  // A tab board card's tab, where it will land (6D): the board clips the card at its own edge, right under the strip,
  // so the gap would be empty. Its place is read from the layout, as the slot is, and only while a card is held here.
  const landingAt = (): { left: number; width: number } | null => {
    const strip = stripRef.current
    if (strip === null) return null
    const els = [...strip.querySelectorAll<HTMLElement>('[data-tab]')]
    if (from !== -1) {
      const own = els[from]
      if (own === undefined) return null
      const left = gap === null ? own.offsetLeft : gap > from ? els[gap - 1].offsetLeft + els[gap - 1].offsetWidth - own.offsetWidth : els[gap].offsetLeft
      return { left, width: own.offsetWidth }
    }
    if (gap === null) return null
    const style = getComputedStyle(strip)
    const between = parseFloat(style.columnGap) || 0
    const last = els[els.length - 1]
    const left = gap < els.length ? els[gap].offsetLeft : last !== undefined ? last.offsetLeft + last.offsetWidth + between : parseFloat(style.paddingLeft) || 0
    return { left, width: room - between }
  }
  const landing = boardOver === null || boardLabel === null ? null : landingAt()

  return (
    <div
      className={`tabbar-row${reserveEnd ? ' tabbar-row--end' : ''}${drag !== null || externalOver !== null ? ' tabbar-row--drag' : ''}`}
      style={SLIDE}
      // Each drag the strip takes scrolls it at its ends (YAZ-3808 D5): over a tab, the tail, ‹ › and the "+" alike.
      onDragOver={(e) => {
        const foreign = foreignTab(e)
        if (drag !== null || externalPage(e) !== null || foreign) scroller.at(e.clientX)
        // The window under the drag comes to the front (6A6): the gap opens where it shows, and the drop has nothing to wait for.
        if (foreign && !raised.current) {
          raised.current = true
          onRaise?.()
        }
        const width = foreign && e.dataTransfer !== null ? dragWidth(e.dataTransfer) : null
        const strip = stripRef.current
        if (width === null || strip === null) externalRoom.current = null
        else if (externalRoom.current?.width !== width) externalRoom.current = { width, room: width + (parseFloat(getComputedStyle(strip).columnGap) || 0) }
        // A part of the row that takes no drag (the blank tab, the row's own room): no slot, so no gap (6A10).
        if (drag === null && !e.isDefaultPrevented()) setExternalOver(null)
      }}
      onDropCapture={() => {
        raised.current = false
      }}
      onMouseMove={staleHover ? () => setStaleHover(false) : undefined}
      // A drag that leaves the row closes the gap (YAZ-3637 D4): another window's tab may go on to the page below, or
      // out of the window, and nothing else here hears of it. This strip's own tab goes back to its own place (6A): a
      // drop off the strip lands it in no slot.
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
        // The next drag over the row raises the window again (6A6), also after one that opened no gap (6A8).
        raised.current = false
        setExternalOver(null)
        if (drag !== null && drag.over !== null) setDrag({ ...drag, over: null })
        scroller.stop()
      }}
    >
      <div className="tabbar-nav" {...firstShownSlot}>
        {onShowSidebar && (
          <button type="button" className="tabbar-nav__btn" aria-label="Show sidebar" title="Show sidebar" onClick={onShowSidebar}>
            <SidebarPanelIcon />
          </button>
        )}
        <button type="button" className="tabbar-nav__btn" aria-label="Back" title={titleWithKey('Back', 'back', hotkeys)} disabled={!canBack} {...navProps(backSteps, onBack)}>
          <Chevron d="m10 4-4 4 4 4" />
        </button>
        <button type="button" className="tabbar-nav__btn" aria-label="Forward" title={titleWithKey('Forward', 'forward', hotkeys)} disabled={!canForward} {...navProps(forwardSteps, onForward)}>
          <Chevron d="m6 4 4 4-4 4" />
        </button>
        {onToggleOverview && (
          <button
            type="button"
            className="tabbar-nav__btn"
            aria-label="Show all open tabs"
            title={titleWithKey('Show all open tabs', 'tabOverview', hotkeys)}
            aria-pressed={overviewOpen}
            onClick={onToggleOverview}
            // The right press that opens the menu leaves the keyboard focus where it is — under the board, in its filter box.
            onMouseDown={(e) => {
              if (e.button === 2 && onKillAll !== undefined) e.preventDefault()
            }}
            onContextMenu={(e) => {
              if (onKillAll === undefined) return
              e.preventDefault()
              setGridMenu({ x: e.clientX, y: e.clientY })
            }}
          >
            <GridIcon />
          </button>
        )}
      </div>
      <div
        ref={stripRef}
        className={`tabbar scroll-strip${parting ? ' tabbar--parting' : ''}${hoverless ? ' tabbar--hoverless' : ''}${externalOver === 0 && tabs.length === 0 ? ' tabbar--drop-empty' : ''}`}
        role="tablist"
        aria-label="Open files"
        {...stripSlot}
      >
        {/* ONE keyed list, ghosts and tabs: a tab that closes or moves builds no other tab again. */}
        {tabs.flatMap(({ id, path, name, zoom }, i) => {
          // Under the blank tab no tab of the strip is the active one (YAZ-2655).
          const isActive = !blank && id === active
          // A display name stands in for the page name (YAZ-2949 D5); every file call still takes the path.
          const label = name ?? labelOf(path)
          // The tooltip's first line: the page, and " › bullet" when the tab is zoomed (YAZ-3647 E4).
          const shownAt = atBullet(path, zoom)
          const cls = ['tabbar__tab']
          if (isActive) cls.push('tabbar__tab--active')
          if (isActive && yielding) cls.push('tabbar__tab--yield')
          if (id === preview) cls.push('tabbar__tab--preview')
          if (id === renaming) cls.push('tabbar__tab--renaming')
          if (id === lit) cls.push('tabbar__tab--lit')
          if (slidIn.current.has(id)) cls.push('tabbar__tab--in')
          // The grabbed tab has left the strip (6A): a strip drag's once the Mac has its picture, a held card's own tab at once.
          if ((drag !== null && drag.lifted && drag.from === i) || (boardOver !== null && id === boardOwn)) cls.push('tabbar__tab--dragging')
          // The drop slot: the tab the gap opens before — or the LAST tab, for the end slot.
          if (gap === i) cls.push('tabbar__tab--gap-before')
          if (gap === tabs.length && i === tabs.length - 1) cls.push('tabbar__tab--gap-after')
          return [
            ...ghostsBefore(id),
            <div
              key={id}
              data-tab={id}
              ref={(node) => {
                if (isActive) activeRef.current = node
                if (id === lit) litRef.current = node
              }}
              className={cls.join(' ')}
              style={tabStyle(shiftOf(i), holding?.widths.get(id))}
              // A tab whose name is a field does not drag (YAZ-2949 S9): a press in the field places the caret.
              draggable={id !== renaming}
              onAnimationEnd={(e) => {
                if (e.target !== e.currentTarget || !slidIn.current.delete(id)) return
                e.currentTarget.classList.remove('tabbar__tab--in')
              }}
              onMouseEnter={
                isActive || id === renaming
                  ? undefined
                  : () => {
                      tabPreview.hoverCard(id, path)
                      hoverWake(id)
                    }
              }
              onMouseLeave={() => {
                tabPreview.leaveCard(id)
                stopWake()
              }}
              onDragStart={(e) => {
                if (e.dataTransfer) {
                  // Which copy of the page this tab is (YAZ-3637 D1): the ref another window sends back for it, and the
                  // index of its vault here, for `canTake` there. A page in no vault (-1) no other window takes.
                  const root = rootOfPath(roots, path)
                  writePageDrag(e.dataTransfer, { path, owner: 'main', from: windowId, copy: tabs.slice(0, i).filter((t) => t.path === path).length }, root === null ? -1 : roots.indexOf(root), shownWidth(e.currentTarget))
                }
                setExternalOver(null)
                setStaleHover(true)
                setDrag({ from: i, over: null, room: roomOf(e.currentTarget, stripRef.current), lifted: false })
                requestAnimationFrame(() => setDrag((now) => (now === null || now.from !== i ? now : { ...now, lifted: true })))
              }}
              onDragEnd={(e) => {
                // No surface took the drop (YAZ-3637 D1, D3): the tab was let go off every window, or on one that refused
                // it. Main tells the two apart by the point; the Mac drew the tab's picture (D7).
                if (e.dataTransfer?.dropEffect === 'none') onTearOff?.(path, id, { x: e.screenX, y: e.screenY })
                scroller.stop()
                setDrag(null)
                setExternalOver(null)
              }}
              onDragEnter={overTab}
              onDragOver={overTab}
              onDrop={(e) => {
                const at = pointSlot(e.clientX)
                if (drag !== null) {
                  e.preventDefault()
                  drop(at)
                } else dropExternal(e, at)
              }}
              onContextMenu={(e) => {
                // A right-click in the name's field is the field's own (YAZ-2949): no tab menu over it.
                if (id === renaming) return
                e.preventDefault()
                setMenu({ x: e.clientX, y: e.clientY, id, path, review: reviewState?.(path) ?? null, named: name !== undefined, lists: listState?.(path) ?? null })
              }}
            >
              {id === renaming ? (
                <TabNameField className="tabbar__rename" label={label} pageName={labelOf(path)} onCommit={(next) => onSetName?.(id, next)} onDone={() => setRenaming(null)} />
              ) : (
              <button
                type="button"
                role="tab"
                className="tabbar__btn"
                aria-selected={isActive}
                // A display name hides the page's own name, so the tooltip gives it back (YAZ-2949 D5, S11). A zoomed tab's
                // label stays the page name (YAZ-3646 D12); its tooltip names the bullet too (YAZ-3647 E4).
                title={name === undefined && shownAt === labelOf(path) ? path : `${shownAt}\n${path}`}
                onClick={() => onActivate(id)}
                // A double click keeps the preview tab (YAZ-2648 S20) and opens the name's field, as "Set display name" does (YAZ-3059 D1).
                onDoubleClick={() => {
                  onKeep?.(id)
                  if (onSetName !== undefined) setRenaming(id)
                }}
                onAuxClick={(e) => {
                  // Middle-click closes — the browser-tab convention.
                  if (e.button === 1) closeByMouse(id)
                }}
              >
                {/* The file's icon, as its tree row has it (YAZ-3440 D11): a folder page's is the folder's, and a display name keeps the file's. */}
                <span className="tabbar__label">
                  <FileIcon path={path} folder={isFolder(path)} />
                  {/* Asleep to save memory (YAZ-3737 D11): quiet, before the name, so no name hides it (YAZ-4003, D18). */}
                  {asleep.has(id) && <AsleepIcon className="tabbar__asleep" />}
                  <span className="tabbar__name">
                    {label}
                    {/* A display name is the user's own words, and a folder page is named whole (YAZ-3536 D4). */}
                    {name === undefined && !isFolder(path) && <NameEnding path={path} />}
                  </span>
                </span>
              </button>
              )}
              <button type="button" className="tabbar__close" aria-label={`Close ${label}`} title={`Close ${label}`} onClick={() => closeByMouse(id)}>
                ✕
              </button>
            </div>,
          ]
        })}
        {ghostsBefore(null)}
        {/* The blank tab (YAZ-2655 D10): no file, so no drag, no menu and no tooltip. Its ✕ and a middle click close it alone. */}
        {blank && (
          <div ref={activeRef} className="tabbar__tab tabbar__tab--active tabbar__tab--in" style={shiftOf(tabs.length) === 0 ? undefined : { transform: `translateX(${shiftOf(tabs.length)}px)` }}>
            <button
              type="button"
              role="tab"
              className="tabbar__btn"
              aria-selected
              onAuxClick={(e) => {
                if (e.button === 1) onCloseBlank?.()
              }}
            >
              <span className="tabbar__label">New tab</span>
            </button>
            <button type="button" className="tabbar__close" aria-label="Close New tab" title="Close New tab" onClick={onCloseBlank}>
              ✕
            </button>
          </div>
        )}
        {from === -1 && gap !== null && <div className="tabbar__room" style={{ width: room }} aria-hidden />}
        {landing !== null && (
          <div className="tabbar__tab tabbar__tab--landing" style={landing} aria-hidden>
            <span className="tabbar__btn">
              <span className="tabbar__label">{boardLabel}</span>
            </span>
          </div>
        )}
      </div>
      {onNewTab && (
        <button type="button" className="tabbar__new" aria-label="New tab" title={titleWithKey('New tab', 'newTab', hotkeys)} onClick={onNewTab} {...plusSlot}>
          <PlusIcon />
        </button>
      )}
      <div className="tabbar-tail" {...endSlot} />
      <CardPreviewHost store={tabPreview.store} cardOf={previewTab} scopeOf={previewScope} diagramDarkColors={diagramDarkColors} side="below" />
      {menu !== null && <TabMenu menu={menu} label={labelOf(menu.path)} onClose={() => setMenu(null)} onMoveToRight={onMoveToRight} onMoveToNewWindow={onMoveToNewWindow} moveTargets={onMoveTargets?.(menu.path)} onMoveToWindow={onMoveToWindow} onHighlightWindow={onHighlightWindow} onDuplicate={onDuplicate} onRename={onSetName === undefined ? undefined : setRenaming} onResetName={(id) => onSetName?.(id, null)} onShowInSidebar={onShowInSidebar} onSetReview={onSetReview} onToggleFocus={onToggleFocus} onToggleFavorite={onToggleFavorite} onNotice={onNotice} />}
      {/* The menu of ‹ or › (YAZ-3647 E3): the steps that way, the nearest first, as the tab menu draws its rows. */}
      {navMenu !== null && (
        <ContextMenuSurface x={navMenu.x} y={navMenu.y} onClose={() => setNavMenu(null)}>
          <div className="ctx-menu__group" role="group">
            {navMenu.steps.map((step) => (
              <button
                key={step.id}
                type="button"
                className="ctx-menu__item"
                role="menuitem"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setNavMenu(null)
                  onGoToStep?.(step.id)
                }}
              >
                {atBullet(step.path, step.zoom)}
              </button>
            ))}
          </div>
        </ContextMenuSurface>
      )}
      {/* The grid button's menu: the two saves of a session (YAZ-3147 D5), a line, then "Kill all tabs". With no tab
          there is nothing to save or close, and each item is grey like any item that cannot be used (S4). */}
      {gridMenu !== null && (
        <ContextMenuSurface x={gridMenu.x} y={gridMenu.y} onClose={() => setGridMenu(null)}>
          {onSaveSession !== undefined && (
            <div className="ctx-menu__group" role="group">
              {([['Save tabs as session', false], ['Save and close all tabs', true]] as const).map(([label, closeAll]) => (
                <button
                  key={label}
                  type="button"
                  className="ctx-menu__item"
                  role="menuitem"
                  disabled={tabs.length === 0}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setGridMenu(null)
                    onSaveSession(closeAll)
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <div className="ctx-menu__group" role="group">
            <button
              type="button"
              className={tabs.length === 0 ? 'ctx-menu__item' : 'ctx-menu__item ctx-menu__item--danger'}
              role="menuitem"
              disabled={tabs.length === 0}
              // So does the press on the item: a sheet that is cancelled then gives the keys back to the board, or to the note.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setGridMenu(null)
                onKillAll?.()
              }}
            >
              Kill all tabs
            </button>
          </div>
        </ContextMenuSurface>
      )}
    </div>
  )
}
