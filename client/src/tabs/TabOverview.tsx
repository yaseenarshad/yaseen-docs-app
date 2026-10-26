import { lazy, memo, Suspense, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { rootOfPath, type CanvasCard, type TabAction, type CanvasLayout, type TabCanvasPatch, type DiagramDarkColors, type StoredTab, type TabRef, type WindowEntry } from '@shared/types'
import { api } from '../api'
import { ContextMenuSurface } from '../components/ContextMenuSurface'
import { isFolderPath, pageLabel, useLatestTrees, type PathTitles } from '../lib/pageLabel'
import { storage } from '../lib/storage'
import type { Tab } from '../workspace/useWorkspace'
import type { ListState } from '../lists/useVaultListsHere'
import { arrivalIn, BOARD, buildBoard, cellKey, copiesOf, dropOutcome, fieldOf, frameDrop, layoutCanvas, nearest, placeCard, refsOf, storedAt, tidyFrame, tidyGroup, withoutTitle, type BoardPage, type BoardTab, type CanvasPlan, type Field, type FrameInput, type Island, type Rect, type Way } from './board'
import { setBoardHighlight } from './boardHighlight'
import { TabMenu, type MoveTarget, type TabMenuAt } from './TabMenu'
import { TabNameField } from './TabNameField'
import { useTabHeads } from './useTabHeads'
import { useCamera } from './useCamera'
import { CardPreviewHost, useCardPreview, type PreviewScope } from './cardPreview'
import { useHiddenWindows, useMinimizedWindows } from './hiddenWindows'
import { TabSearchPanel } from './TabSearchPanel'
import { autoWindowLabel, windowLabel } from './windowLabel'
import './tabs.css'

export { SETTLE_MS, TOOLBAR_INSET } from './useCamera'

/** A drawing's picture on its card (YAZ-3343 D6): its own chunk, which brings the picture code and the engines. */
const CardPicture = lazy(() => import('./CardPicture'))

/** How long the board's zoom takes, in ms. The board hands it to the tab stack as `--tab-zoom-ms`, for its own animation and for the page layer's (tabs.css). */
export const ZOOM_MS = 250
/** The zoom buttons' step (D7). */
const ZOOM_STEP = 1.25
/** A window that shows no vault of the page refuses it (D13): one short line, so the toast never cuts it (D38). */
export const MOVE_REFUSED = "Can't move here — that window doesn't have this tab's vault."
export const ADD_REFUSED = "Can't add here — that window doesn't have this file's vault."
/** The search panel's width (tabs.css). */
const SEARCH_W = 360

/** Another window's tabs, all of them, for "Kill all tabs" with "Show all windows" on (YAZ-3343 D10). */
export interface WindowTabs {
  win: string
  refs: TabRef[]
}

export interface TabOverviewProps {
  /** The vaults of the window, and the name the app gives each: pages stand on islands by vault, then by folder (D7). */
  roots: readonly string[]
  vaultNames: readonly string[]
  /** Open tabs, left→right: one page each — two copies of a file are two pages (YAZ-2940 D1). Keys, the highlight and the pick use the id; labels and file calls the path. */
  tabs: readonly Tab[]
  /** The active tab's id: its page is marked, the highlight starts on it, and the zoom goes out of it and into it. */
  active: string | null
  /** The preview tab's id (D1): its page's title is italic, as its tab's label is. */
  preview: string | null
  /** The window's titles (YAZ-2420 🔒 D14): a page is named as its tab is. */
  titles: PathTitles
  /** This window's id (`WindowEntry.id`, YAZ-3343 D1): the stored places of its cards are keyed by it. */
  windowId: string
  /** The diagrams' dark-mode colours, for a drawing's picture (YAZ-3343 D6). */
  darkColors?: DiagramDarkColors
  /** App is on its way to the active tab's page: the board zooms into that page, and says so `ZOOM_MS` later. */
  leaving?: boolean
  onLeft?: () => void
  /** A click on a page, Enter on the highlighted one: App goes to that tab (by id). */
  onOpen: (id: string) => void
  /** A page's ✕, an island's ✕: the tabs (by id) close and the board stays. */
  onCloseTabs: (ids: string[]) => void
  /** Esc: back to the page. */
  onDismiss: () => void
  /** "Kill all tabs" (YAZ-2739): App asks first, then closes every tab of the window — and with "Show all windows" on, `others` too (YAZ-3343 D10). Absent, the board has no such button. */
  onKillAll?: (others: readonly WindowTabs[]) => void
  /** A frame's "Close all tabs" / "Close window", clicked twice in its menu (D21): App closes — this window by its own doors, another by main's. */
  onCloseWindow?: (req: { win: string; mine: boolean; refs: TabRef[]; whole: boolean }) => void
  /** "New window" from the empty canvas (D22): App opens one on this window's vaults, BEHIND, and answers its id. */
  onNewWindow?: () => Promise<string>
  /** A pick of "Open tabs here…" for THIS window (D22): a background tab of the page; the board stays. */
  onOpenTabHere?: (path: string) => void
  /** A page's menu is a tab's menu (`TabMenu`): these are the strip's own doors. */
  onMoveToRight?: (path: string) => void
  /** The other windows that can take a tab of `path` (YAZ-3091 D2): asked only while a tab menu is open, for its "Move to ▸". */
  onMoveTargets?: (path: string) => readonly MoveTarget[]
  /** "Move to new window" on a card (YAZ-3343 D37): QUIET — a hidden window, and the board keeps the focus. */
  onMoveToNewWindowQuietly: (path: string, id: string) => void
  /** This window's card dropped in another window's frame, or sent there by "Move to ▸" (YAZ-3343 D13, D20): QUIET — no raise, a background tab there; only this tab (by id) closes here. */
  onDropToWindow: (to: string, path: string, id: string) => void
  /** Another window's card dropped in a third window's frame, or in this one's, or sent by "Move to ▸" (YAZ-3343 D13, D20): main asks its window to send it, quietly. */
  onMoveTab: (from: string, to: string, ref: TabRef) => void
  /** "Move to ▸": the window a row points at glows (YAZ-3091 D8). */
  onHighlightWindow?: (to: string | null) => void
  /** "Duplicate tab" (YAZ-2940 D5): a copy of the tab, by id. */
  onDuplicate?: (id: string) => void
  /** "Set display name" / "Reset to page name" (YAZ-2949): a name for the tab, by id, or null for its page name. */
  onSetName?: (id: string, name: string | null) => void
  onShowInSidebar?: (path: string) => void
  onNotice?: (message: string) => void
  reviewState?: (path: string) => boolean | null
  onSetReview?: (path: string, on: boolean) => void
  /**
   * Focus and Favorites on a card (YAZ-3264 D4): where a page stands in this window's lists — null
   * for a vault this window does not show, which hides both items — and the two toggles. A vault's
   * lists are the vault's, not the window's (YAZ-2702), so a card of another window on a vault this
   * window shows toggles here, and the other window hears the change.
   */
  listState?: (path: string) => ListState | null
  onToggleFocus?: (paths: string[], isOn: boolean) => void
  onToggleFavorite?: (paths: string[], isOn: boolean) => void
  /** Settings › Preview on hover (D18): resting on a card opens the sidebar's own preview panel beside it. Space opens it whatever this says. */
  hoverPreview?: boolean
  /** What the preview panel needs of a page's vault (its links, text formatting, watch feed): App's. Absent, no panel. */
  previewScope?: (path: string) => PreviewScope
}

/** The sizes of `board.ts`, handed to the stylesheet: the layout and the cards read the same numbers. */
const SIZES = {
  '--tab-page-w': `${BOARD.pageW}px`,
  '--tab-page-h': `${BOARD.pageH}px`,
  '--tab-island-pad': `${BOARD.islandPad}px`,
  '--tab-label-h': `${BOARD.labelH}px`,
  '--tab-vault-h': `${BOARD.vaultH}px`,
  '--tab-frame-label-h': `${BOARD.frameLabelH}px`,
} as CSSProperties

/** Where the zoom aims, as custom properties on the tab stack: gone when there is no page to aim at. */
const ZOOM_POINT = ['--tab-zoom-scale', '--tab-zoom-x', '--tab-zoom-y', '--tab-layer-x', '--tab-layer-y']
/** No page: the empty set the pick starts from. */
const NONE: ReadonlySet<string> = new Set()
const NO_WINDOWS: readonly WindowEntry[] = []
const WAYS: Record<string, Way> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }
const tabCount = (n: number): string => (n === 1 ? '1 tab' : `${n} tabs`)
const noSubscribe = (): (() => void) => () => undefined
const noWindows = (): readonly WindowEntry[] => NO_WINDOWS

/**
 * The other windows as a snapshot (YAZ-3343 D2): a `useSyncExternalStore` snapshot must stay the same object while
 * nothing the board reads of them changed — a window's bounds or sidebar change no card. `getOtherWindows` holds its
 * array while the windows hold, so the compare runs once per change of the state, not on each render.
 */
let othersHeld: readonly WindowEntry[] = NO_WINDOWS
let othersFrom: readonly WindowEntry[] | null = null
let othersKey = ''
function otherWindows(): readonly WindowEntry[] {
  const next = storage.getOtherWindows()
  if (next === othersFrom) return othersHeld
  othersFrom = next
  const key = JSON.stringify(next.map((w) => [w.id, w.roots, w.file, w.tabs, w.tabStrip, w.name]))
  if (key !== othersKey) {
    othersKey = key
    othersHeld = next
  }
  return othersHeld
}

/** One window of the board (YAZ-3343 D8): this one, or another read off the state (D2). */
interface BoardWindow {
  win: string
  mine: boolean
  roots: readonly string[]
  tabs: readonly BoardTab[]
  /** The card id of its active tab. */
  active: string | null
  /** Its frame's label: its name, else the automatic label (D14). */
  label: string
  auto: string
  named: boolean
}

/** What the board knows of a card, by card id. */
interface CardInfo {
  win: string
  mine: boolean
  page: BoardPage
  ref: TabRef
  /** The vault of the page in its own window: a drawing's picture is drawn there (D6). */
  root: string | null
  /** Its folder as a window frame's card says it (D17): the island's label, the vault's name first where its window has two or more. */
  folder: string
}

/** The other windows' tabs (D2): a window's strip, else its `tabs` with `file` the active one. Their card ids cannot be a tab id: they hold newlines. */
function stripOf(w: WindowEntry): { tabs: BoardTab[]; active: string | null; strip: StoredTab[] } {
  const strip: StoredTab[] = w.tabStrip ?? w.tabs.map((path) => (path === w.file ? { path, active: true } : { path }))
  const { copy } = copiesOf(strip)
  let active: string | null = null
  const tabs = strip.map((t, i) => {
    const id = `${w.id}\n${t.path}\n${copy[i]}`
    if (t.path === w.file && (t.active === true || active === null)) active = id
    return { id, path: t.path, ...(t.name === undefined ? {} : { name: t.name }) }
  })
  return { tabs, active, strip }
}

/** What a card's handlers do: one object for the whole board, so a card re-renders only when what it SHOWS changes. */
interface CardActions {
  click: (id: string, e: MouseEvent) => void
  menu: (id: string, e: MouseEvent) => void
  hover: (id: string) => void
  leave: (id: string) => void
  close: (id: string) => void
  press: (id: string, e: ReactPointerEvent<HTMLElement>) => void
  rename: (id: string, name: string | null) => void
  renamed: () => void
}

interface CardProps {
  id: string
  path: string
  win: string
  stopId: string | undefined
  label: string
  /** The page's own name: the "Page: …" line under a display name (D11), and the name field's placeholder. */
  page: string
  named: boolean
  /** A window frame's card says its folder, grey, under its title (D17); null in the folder layout, where its group says it. */
  folder: string | null
  lines: string
  /** "1 of 2" on each copy of a path the window has twice or more (D11). */
  copyText: string | null
  /** The card's place inside its group's box. */
  x: number
  y: number
  active: boolean
  previewing: boolean
  current: boolean
  picked: boolean
  renaming: boolean
  /** Its ✕ was clicked once: it shows a red "Close", and the next click closes (D27). */
  armed: boolean
  /** Its drawing's picture shows (D6): it is on screen and the zoom shows detail. */
  picture: boolean
  root: string | null
  darkColors: DiagramDarkColors
  actions: CardActions
}

/**
 * One card of the canvas (YAZ-2648 D9, YAZ-3343 D11): a page's name and first lines — a display name with the
 * page's own name under it, a copy's "1 of 2", a drawing's picture. Memoised on what it shows, so the highlight
 * moving renders two cards, and a pan, a zoom or a drag renders none (D4).
 */
const Card = memo(function Card(p: CardProps) {
  const cls = ['taboverview__page']
  if (p.active) cls.push('taboverview__page--active')
  if (p.previewing) cls.push('taboverview__page--preview')
  if (p.current) cls.push('taboverview__page--current')
  if (p.picked) cls.push('taboverview__page--picked')
  if (p.renaming) cls.push('taboverview__page--renaming')
  if (p.copyText !== null) cls.push('taboverview__page--copy')
  if (p.folder !== null) cls.push('taboverview__page--framed')
  return (
    <div
      className={cls.join(' ')}
      id={p.stopId}
      role="option"
      aria-selected={p.current}
      aria-current={p.active ? 'page' : undefined}
      // The stops are found by card id; the page's file stays readable for the e2e specs.
      data-tab={p.id}
      data-path={p.path}
      data-win={p.win}
      title={p.named ? `${p.page}\n${p.path}` : p.path}
      style={{ left: p.x, top: p.y }}
      onClick={(e) => p.actions.click(p.id, e)}
      onContextMenu={(e) => p.actions.menu(p.id, e)}
      onMouseMove={() => p.actions.hover(p.id)}
      onMouseLeave={() => p.actions.leave(p.id)}
      onPointerDown={(e) => p.actions.press(p.id, e)}
    >
      {p.renaming ? (
        // The page's name as a field (YAZ-2949 D4, S2): it keeps its own presses, clicks and keys from the board.
        <span onMouseDown={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
          <TabNameField className="taboverview__rename" label={p.label} pageName={p.page} onCommit={(next) => p.actions.rename(p.id, next)} onDone={p.actions.renamed} />
        </span>
      ) : (
        <span className="taboverview__title">{p.label}</span>
      )}
      {p.folder !== null && <span className="taboverview__folder">{p.folder}</span>}
      {p.named && <span className="taboverview__pagename">Page: {p.page}</span>}
      {p.picture && p.root !== null ? (
        <span className="taboverview__shot">
          <Suspense fallback={<span className="taboverview__lines">{p.lines}</span>}>
            <CardPicture root={p.root} path={p.path} kind={p.lines} darkColors={p.darkColors} />
          </Suspense>
        </span>
      ) : (
        p.lines !== '' && <span className="taboverview__lines">{p.lines}</span>
      )}
      {p.copyText !== null && <span className="taboverview__copy">{p.copyText}</span>}
      {/* Two clicks (D27): the first turns the ✕ into a red Close, the second closes. */}
      <button
        type="button"
        className={`taboverview__close${p.armed ? ' taboverview__close--armed' : ''}`}
        aria-label={`Close ${p.label}`}
        title={p.armed ? `Click again to close ${p.label}` : `Close ${p.label}`}
        onClick={(e) => {
          e.stopPropagation()
          p.actions.close(p.id)
        }}
      >
        {p.armed ? 'Close' : '✕'}
      </button>
    </div>
  )
})

/** A pan, or a card held by the pointer (D7, D12). Refs only: neither renders anything while it moves. */
type Gesture =
  | { kind: 'pan'; pointer: number; startX: number; startY: number; camX: number; camY: number }
  | { kind: 'card'; pointer: number; id: string; el: HTMLElement; startX: number; startY: number; dragging: boolean; dx: number; dy: number }
  /** A folder group, or with "Show all windows" a whole window frame, held as one (D16): `els` are the boxes that move, `cards` every card they carry. */
  | { kind: 'group'; pointer: number; win: string; cards: string[]; els: HTMLElement[]; startX: number; startY: number; dragging: boolean; dx: number; dy: number; lead?: string }

/**
 * The tab board (YAZ-2648 D5, YAZ-3343): every open tab as a card on a CANVAS, in the editor's place while it
 * shows — App hides the tab stack under it and unmounts nothing, so each page is as it was when the board
 * closes. A card shows its title and, for a note, its first lines (D6, `useTabHeads`); a drawing's card its
 * picture. With "Show all windows" off, cards stand in GROUPS, one per folder that directly holds them, under
 * their vault (D7, D8); on, every open window is a FRAME that holds its cards directly, in folder order (D17).
 * `layoutCanvas` (board.ts) computes every place with no DOM; a card, a group or a frame the user dragged stands
 * where it was put, and that place is stored (D1, D12, D16). A card dropped in another window's frame moves its
 * tab there (D13). The placement rules — snap, no overlap, arrivals — are board.ts's too (D26, D28, D30).
 *
 * THE CAMERA (YAZ-3343 D4, D7): one world layer in the board's viewport, moved by ONE CSS transform written
 * straight onto it from a ref — a pan, a pinch, ⌘-scroll and the zoom buttons render nothing. A drag moves the
 * card's own element the same way, and renders once, on the drop. Only when the camera rests does the board
 * look again at which drawings are on screen, to draw their pictures (D6).
 *
 * The board zooms out of the page it opened from and into the page that is chosen: App's transform on that
 * page's layer and the board's own, aimed at the card's place on screen (world place × zoom + pan).
 *
 * The keyboard stays in the filter box: typing narrows the cards by title and path, the arrows move the
 * highlight to the nearest card that way (and pan to it), Enter opens it, Esc goes back to the page. SPACE,
 * held, opens the preview panel for the highlighted card (D18). ⌘-click or Shift-click PICKS cards (D25), and a
 * small bar closes the picked ones, or the others, with two clicks (D27). "Kill all tabs" (YAZ-2739), at the
 * end of the top row, is about every tab the board is about, whatever the filter shows; the board only asks:
 * App owns the sheet and the close.
 */
export function TabOverview({ roots, vaultNames, tabs, active, preview, titles, windowId, darkColors = 'adapt', leaving = false, onLeft, onOpen, onCloseTabs, onDismiss, onKillAll, onMoveToRight, onMoveTargets, onDropToWindow, onMoveToNewWindowQuietly, onMoveTab, onHighlightWindow, onDuplicate, onSetName, onShowInSidebar, onNotice, reviewState, onSetReview, listState, onToggleFocus, onToggleFavorite, hoverPreview = false, previewScope, onCloseWindow, onNewWindow, onOpenTabHere }: TabOverviewProps) {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState<string | null>(active)
  const [pageMenu, setPageMenu] = useState<TabMenuAt | null>(null)
  /** The frame a "Move to ▸" row points at, lit on the board while the row is under the pointer (D31). */
  const [ringed, setRinged] = useState<string | null>(null)
  /** The card whose name is a field (YAZ-2949 D4), by tab id, or null. */
  const [renaming, setRenaming] = useState<string | null>(null)
  const [islandMenu, setIslandMenu] = useState<{ x: number; y: number; key: string } | null>(null)
  /** A window frame's menu (D14), and the frame whose label is a name field. */
  const [frameMenu, setFrameMenuState] = useState<{ x: number; y: number; win: string } | null>(null)
  /** The frame menu's close item clicked once (D21): its next click closes. Gone with the menu. */
  const [frameArm, setFrameArm] = useState<'tabs' | 'window' | null>(null)
  const setFrameMenu = (next: { x: number; y: number; win: string } | null): void => {
    setFrameArm(null)
    setFrameMenuState(next)
  }
  /** The empty canvas's menu ("New window"), with the world point it was asked at (D22). */
  const [canvasMenu, setCanvasMenu] = useState<{ x: number; y: number; world: { x: number; y: number } } | null>(null)
  /** An empty frame's vault chip, open on its list of recent vaults (D22). */
  const [chipMenu, setChipMenu] = useState<{ x: number; y: number; win: string } | null>(null)
  /** "Open tabs here…": the window the search panel opens tabs in, or null (D22). */
  const [searchFor, setSearchFor] = useState<string | null>(null)
  /** The one close clicked once (D27): `card:<id>`, `group:<key>`, or the pick bar's `pick:them` / `pick:others`; its next click closes. */
  const [armed, setArmed] = useState<string | null>(null)
  /** Windows opened from the canvas, standing where they were asked for while this board shows (one-shot, never stored). */
  const [anchors, setAnchors] = useState<ReadonlyMap<string, { x: number; y: number }>>(new Map())
  const [naming, setNaming] = useState<string | null>(null)
  /** The menu of the picked cards, opened on one of them. */
  const [pickMenu, setPickMenu] = useState<{ x: number; y: number } | null>(null)
  /** The cards picked with shift-click. The board's own, for as long as it is open. */
  const [picked, setPicked] = useState<ReadonlySet<string>>(NONE)
  /** Space is held on a highlighted card: the preview panel shows it (D18). */
  const [spaceHeld, setSpaceHeld] = useState(false)
  /** Cards dropped in another window's frame, held where they were dropped until their tab leaves (D13). Not stored. */
  const [ghosts, setGhosts] = useState<ReadonlyMap<string, { x: number; y: number }>>(new Map())
  /** The filter box was the last thing used: Space then types a space (see `onKeyDown`). */
  const typed = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const gesture = useRef<Gesture | null>(null)
  /** The card a "Duplicate tab" copied, until its copy shows up (D30): the copy lands by it. */
  const dupSource = useRef<{ id: string; win: string; path: string } | null>(null)
  /** The cards seen so far: one that appears later is placed in its frame's grid (D30). */
  const seenCards = useRef<Set<string> | null>(null)
  /** The other window glowing because the pointer is on its frame (D33), sent once per change. */
  const onHighlightWindowRef = useRef(onHighlightWindow)
  onHighlightWindowRef.current = onHighlightWindow
  const glowing = useRef<string | null>(null)
  /** A card popped out to a new window from this board, and the windows known before (D37): its frame's placement. */
  const popping = useRef<{ from: string; path: string } | null>(null)
  const known = useRef<ReadonlySet<string>>(new Set())
  /** A card just snapped into its cell: where it was let go, relative to the cell, for the settle after the render. */
  const flip = useRef<{ el: HTMLElement; x: number; y: number }[] | null>(null)
  /** A drag ended on this press: the click that follows it is no click. */
  const dropped = useRef(false)
  /** The next highlight move came from the keyboard or the filter: the camera goes to it (D7). */
  const wantReveal = useRef(false)
  /** The listbox of cards, and the stem of each stop's id: what the filter box points a reader at. */
  const listId = useId()
  /** The preview beside a card (D18): the sidebar's panel, its dwell in a tiny store — no board render. */
  const cardPreview = useCardPreview(hoverPreview, (id) => Array.from(worldRef.current?.querySelectorAll<HTMLElement>('[data-tab]') ?? []).find((el) => el.dataset.tab === id) ?? null)
  /** The camera (D4, D7, D24): one transform on the world, never stored, never state. */
  const camera = useCamera({ rootRef, bodyRef, worldRef, read: () => ({ plan: live.current.plan, active, where: posOf }), onMove: cardPreview.close })
  const { view, pictured, cam, percentRef, apply: applyCamera, settle, toWorld } = camera

  // THE DATA. The canvas — the switch and the moved cards — is the state file's (D1); the other windows
  // are read off the state only while the switch is on (D2).
  const canvas = useSyncExternalStore(storage.subscribe, storage.getTabCanvas)
  const allWindows = canvas.allWindows
  /** "Snap to grid" (D26). */
  const snapOn = canvas.snap
  const layout: CanvasLayout = allWindows ? 'window' : 'folder'
  const others = useSyncExternalStore(allWindows ? storage.subscribe : noSubscribe, allWindows ? otherWindows : noWindows)
  const myName = storage.windowName()
  /** The windows the board made that are still hidden (D23): tagged, and "Show window" in their menu. */
  const hidden = useHiddenWindows()
  /** The windows minimized in the Dock (D23): tagged. */
  const minimized = useMinimizedWindows()
  // A page is a folder by the Files tree of the vault that holds it; one of a vault this window does not show falls back to the first vault's tree, so to its file name.
  const trees = useLatestTrees(roots)
  const labelOf = (path: string): string => pageLabel(path, isFolderPath(rootOfPath(roots, path) ?? roots[0] ?? null, path), titles)
  const terms = query.toLowerCase().split(/\s+/).filter((term) => term !== '')
  const termsKey = terms.join(' ')

  // The windows and their groups, built once per change of what they are made of (plain arithmetic, a few hundred cards at most).
  const model = useMemo(() => {
    const strip: StoredTab[] = tabs.map((t) => ({ path: t.path, ...(t.name === undefined ? {} : { name: t.name }), ...(t.id === active ? { active: true as const } : {}) }))
    const mineAuto = autoWindowLabel({ file: tabs.find((t) => t.id === active)?.path ?? null, tabs: tabs.map((t) => t.path), tabStrip: strip, roots }, titles)
    const windows: BoardWindow[] = [{ win: windowId, mine: true, roots, tabs, active, label: myName ?? mineAuto, auto: mineAuto, named: myName !== undefined }]
    for (const w of others) {
      const { tabs: wTabs, active: wActive } = stripOf(w)
      const auto = autoWindowLabel(w, titles)
      windows.push({ win: w.id, mine: false, roots: w.roots, tabs: wTabs, active: wActive, label: windowLabel(w, titles), auto, named: w.name !== undefined })
    }
    const info = new Map<string, CardInfo>()
    const frames: FrameInput[] = windows.map((w) => {
      const names = w.mine ? vaultNames : w.roots.map((root) => storage.vaultName(root))
      const vaults = buildBoard(w.tabs, w.roots, names, labelOf, terms).map((vault) => ({ ...vault, named: w.roots.length > 1 && vault.at < w.roots.length }))
      // The copies are counted on the whole strip, filtered or not (D1): `buildBoard` did; the ref of every tab is kept here.
      for (const vault of vaults)
        for (const island of vault.islands) {
          const folder = vault.named && !island.top ? `${vault.name} / ${island.label}` : island.label
          for (const page of island.pages) info.set(page.id, { win: w.win, mine: w.mine, page, ref: { path: page.path, copy: page.copy }, root: rootOfPath(w.roots, page.path), folder })
        }
      return { win: w.win, vaults }
    })
    return { windows, frames, info, byWin: new Map(windows.map((w) => [w.win, w])) }
    // `labelOf` reads `roots`, `titles` and the trees, all of them deps.
  }, [tabs, active, others, roots, vaultNames, titles, termsKey, windowId, myName, trees])
  const wrapW = view !== null && view.w > 0 ? view.w - 2 * BOARD.padX : Infinity
  /** Where frames stand (D16: an empty frame drags freely too): the stored ones, and the board's own until they are stored. */
  const frameAnchors = useMemo(() => {
    const at = new Map<string, { x: number; y: number }>(canvas.frames.map((f) => [f.win, { x: f.x, y: f.y }]))
    for (const [win, p] of anchors) if (!at.has(win)) at.set(win, p)
    return at
  }, [canvas, anchors])
  /** The viewport's shape: the auto layout packs to it (D29). None until measured. */
  const aspect = view !== null && view.w > 0 && view.h > 0 ? view.w / view.h : undefined
  const plan: CanvasPlan = useMemo(() => layoutCanvas(allWindows ? model.frames : model.frames.slice(0, 1), { by: layout, wrapW, stored: canvas.cards, anchors: frameAnchors, aspect }), [model, allWindows, layout, wrapW, canvas, frameAnchors, aspect])
  const { windows, info, byWin } = model
  const shownWindows = useMemo(() => (allWindows ? windows : windows.slice(0, 1)), [windows, allWindows])
  const posOf = (id: string): { x: number; y: number } | undefined => ghosts.get(id) ?? plan.cards.get(id)
  const groupsByKey = new Map(plan.groups.map((group) => [group.key, group]))

  // The heads are a file's, read once for all its copies — of every window on the board (D2).
  const heads = useMemo(() => [...new Set(shownWindows.flatMap((w) => w.tabs.map((t) => t.path)))], [shownWindows])
  const linesOf = useTabHeads(heads)

  /** The cards of the board, in reading order: frame by frame, group by group. */
  const shown = plan.order
  const allCards = shownWindows.flatMap((w) => w.tabs.map((t) => t.id))
  const totalTabs = allCards.length
  // The highlight is a card id. When its card goes — closed, or filtered out — the card that took its place has it.
  const at = cursor === null ? -1 : shown.indexOf(cursor)
  const lastAt = useRef(0)
  if (at !== -1) lastAt.current = at
  const current = at !== -1 ? cursor : (shown[Math.min(lastAt.current, shown.length - 1)] ?? null)
  const stopIds = new Map(shown.map((id, i) => [id, `${listId}-p${i}`]))
  const currentStop = current === null ? undefined : stopIds.get(current)
  const pick = allCards.filter((id) => picked.has(id))
  /** What "Close the others" closes, said on its armed button (D27): with all windows on, in how many windows too (D10). */
  const othersText = (() => {
    const rest = allCards.filter((id) => !picked.has(id))
    const wins = new Set(shownWindows.filter((w) => w.tabs.some((t) => !picked.has(t.id))).map((w) => w.win)).size
    return `Click again to close ${tabCount(rest.length)}${allWindows ? ` in ${wins === 1 ? '1 window' : `${wins} windows`}` : ''}`
  })()
  const anyMenu = pageMenu !== null || islandMenu !== null || pickMenu !== null || frameMenu !== null

  // What the doors below read when they run: a ref, so the handlers of the cards and of the window keep one identity.
  const live = useRef({ plan, info, byWin, current, picked, pick, allCards, renaming, layout, allWindows, view, armed })
  live.current = { plan, info, byWin, current, picked, pick, allCards, renaming, layout, allWindows, view, armed }

  // The doors of a card. Each closes over `live`, so `actions` is ONE object for the board's life.
  const openCard = (id: string): void => {
    const card = live.current.info.get(id)
    if (card === undefined) return
    if (card.mine) return onOpen(id)
    // Another window's tab (D3): that window shows it — and this board STAYS open (D32), its highlight on the card.
    api.window.focusTab(card.win, card.ref).catch(() => onNotice?.("Can't go to that tab: its window is closed"))
  }
  /** Move a card's tab to the window `to`, QUIETLY (D13, D20): this window's by App's door, another's through main. */
  const sendCard = (card: CardInfo, to: string): void => {
    if (card.mine) onDropToWindow(to, card.page.path, card.page.id)
    else onMoveTab(card.win, to, card.ref)
  }
  /** Close cards of any window (D3, D10): this window's by its own door, another's by asking it, grouped per window. */
  const closeCards = (ids: readonly string[]): void => {
    const { info: cards } = live.current
    const mine = ids.filter((id) => cards.get(id)?.mine === true)
    if (mine.length > 0) onCloseTabs(mine)
    const per = new Map<string, TabRef[]>()
    for (const id of ids) {
      const card = cards.get(id)
      if (card === undefined || card.mine) continue
      per.set(card.win, [...(per.get(card.win) ?? []), card.ref])
    }
    for (const [win, refs] of per) api.window.closeTabs(win, refs).catch(() => onNotice?.("Can't close those tabs: their window is closed"))
  }
  const togglePick = (id: string): void => setPicked((now) => new Set(now.has(id) ? [...now].filter((one) => one !== id) : [...now, id]))
  const closePick = (otherCards: boolean): void => {
    const { pick: now, allCards: every, picked: set } = live.current
    closeCards(otherCards ? every.filter((id) => !set.has(id)) : now)
    setPicked(NONE)
  }
  const menuOn = (e: MouseEvent, open: () => void): void => {
    e.preventDefault()
    e.stopPropagation()
    cardPreview.close()
    setPageMenu(null)
    setIslandMenu(null)
    setPickMenu(null)
    setFrameMenu(null)
    open()
  }

  /** THE DROP (D12, D13): where the card was let go, by the drop rule; one write to the state, one render. */
  const drop = (g: Extract<Gesture, { kind: 'card' }>, clientX: number, clientY: number): void => {
    const { plan: now, info: cards, byWin: wins, layout: by, allWindows: framed } = live.current
    const card = cards.get(g.id)
    const from = posOf(g.id)
    const placed = now.cards.get(g.id)
    if (card === undefined || from === undefined || placed === undefined) return
    const outcome = dropOutcome({ from: card.win, path: card.page.path, at: toWorld(clientX, clientY), frames: now.frames, framed, rootsOf: (win) => wins.get(win)?.roots })
    if (outcome.kind === 'refuse') {
      // The card slides back to its place (tabs.css: `data-sliding`), and the board says why (D38).
      delete g.el.dataset.lifted
      g.el.dataset.sliding = ''
      g.el.style.transform = ''
      window.setTimeout(() => delete g.el.dataset.sliding, 240)
      onNotice?.(MOVE_REFUSED)
      return
    }
    settleCard(g.el)
    if (outcome.kind === 'move') {
      // The tab arrives as the next copy of its path there, INSIDE that frame (D28, S41): see `arrivalIn`.
      const copy = wins.get(outcome.to)?.tabs.filter((t) => t.path === card.page.path).length ?? 0
      const set = arrivalIn(now, outcome.to, { path: card.page.path, copy }, { where: posOf })
      const arrive = set[set.length - 1]
      storage.setTabCanvas({ set })
      setGhosts((held) => new Map(held).set(g.id, { x: arrive.x, y: arrive.y }))
      sendCard(card, outcome.to)
      return
    }
    // Placed (D12): the nearest free cell of its frame's grid with Snap on, else where it was let go (D26) — and
    // never where its frame (or group) would reach another (D28). Snapped, it settles into its cell (~120 ms).
    const zoom = cam.current.zoom
    const free = { x: Math.round(from.x + g.dx / zoom), y: Math.round(from.y + g.dy / zoom) }
    const { x, y } = placeCard(fieldOf(now, by, placed.owner, new Set([g.id]), posOf), free, snapOn)
    if (x !== free.x || y !== free.y) flip.current = [{ el: g.el, x: from.x + g.dx / zoom - x, y: from.y + g.dy / zoom - y }]
    storage.setTabCanvas({ set: [storedAt(placed, by, { x, y })] })
    if (ghosts.has(g.id)) setGhosts((held) => new Map([...held].filter(([id]) => id !== g.id)))
  }
  /** The card lets go of the pointer's transform at its new place, with no slide back (its `left`/`top` render next). */
  const settleCard = (el: HTMLElement): void => {
    el.style.transform = ''
    void el.offsetWidth
    delete el.dataset.lifted
  }

  // The window's pointer while a gesture runs: a pan moves the camera, a held card follows the pointer (D7, D12).
  const onMove = (e: PointerEvent): void => {
    const g = gesture.current
    if (g === null || e.pointerId !== g.pointer) return
    const dx = e.clientX - g.startX
    const dy = e.clientY - g.startY
    if (g.kind === 'pan') {
      cam.current.x = g.camX + dx
      cam.current.y = g.camY + dy
      applyCamera()
      return
    }
    if (g.kind === 'group') {
      if (!g.dragging) {
        if (Math.hypot(dx, dy) <= BOARD.dragSlop) return
        g.dragging = true
        try {
          bodyRef.current?.setPointerCapture?.(g.pointer)
        } catch {
          // A synthetic pointer: the window still hears it.
        }
        for (const el of g.els) el.dataset.lifted = ''
      }
      g.dx = dx
      g.dy = dy
      // The frame, its groups and its vault names: one transform each, the cards ride inside their groups.
      const move = `translate(${dx / cam.current.zoom}px, ${dy / cam.current.zoom}px)`
      for (const el of g.els) el.style.transform = move
      return
    }
    if (!g.dragging) {
      if (Math.hypot(dx, dy) <= BOARD.dragSlop) return
      g.dragging = true
      try {
        g.el.setPointerCapture?.(g.pointer)
      } catch {
        // A pointer the browser does not know (a synthetic one): the window still hears it.
      }
      g.el.dataset.lifted = ''
    }
    g.dx = dx
    g.dy = dy
    g.el.style.transform = `translate(${dx / cam.current.zoom}px, ${dy / cam.current.zoom}px)`
  }
  const onUp = (e: PointerEvent): void => {
    const g = gesture.current
    if (g === null || e.pointerId !== g.pointer) return
    endGesture()
    if (g.kind === 'pan') return settle()
    if (!g.dragging) return
    dropped.current = true
    window.setTimeout(() => (dropped.current = false), 0)
    if (g.kind === 'group') return dropGroup(g)
    drop(g, e.clientX, e.clientY)
  }
  /**
   * A group or a frame let go: every card it carries is stored at its place + the move, in ONE write, and the
   * board renders once. A drop on another window's frame moves no tab — only a single card's drop does (D13).
   */
  const dropGroup = (g: Extract<Gesture, { kind: 'group' }>): void => {
    const { plan: now, layout: by } = live.current
    const zoom = cam.current.zoom
    let ddx = Math.round(g.dx / zoom)
    let ddy = Math.round(g.dy / zoom)
    for (const el of g.els) settleCard(el)
    // A FRAME or a GROUP gives way (D28): dropped on another, it takes the nearest free spot, and settles there from
    // where it was let go. The others stay.
    const owner = g.lead === undefined ? now.cards.get(g.cards[0])?.owner ?? g.win : undefined
    if (owner !== undefined) {
      const to = frameDrop(now, by, owner, ddx, ddy)
      if (to.dx !== ddx || to.dy !== ddy) flip.current = g.els.map((el) => ({ el, x: ddx - to.dx, y: ddy - to.dy }))
      ddx = to.dx
      ddy = to.dy
    }
    // "Snap to grid" is the CARDS' (D26): a frame or a group moves freely, its cards with it. A pick's cards each snap
    // on their own frame's grid, and never two in one cell.
    const moving = new Set(g.cards)
    const fields = new Map<string, Field>()
    const set = g.cards.flatMap((id) => {
      const card = now.cards.get(id)
      const pos = posOf(id)
      if (card === undefined || pos === undefined) return []
      const free = { x: pos.x + ddx, y: pos.y + ddy }
      if (!snapOn || g.lead === undefined) return [storedAt(card, by, free)]
      const field = fields.get(card.owner) ?? fieldOf(now, by, card.owner, moving, posOf)
      fields.set(card.owner, field)
      const at = placeCard(field, free, true)
      field.taken.add(cellKey(at, field.origin))
      return [storedAt(card, by, at)]
    })
    // A frame drag also stores the FRAME's place (D16): an empty one has no card to store, and the first cards that
    // arrive take its first cells there.
    const frame = g.lead === undefined && by === 'window' ? now.frames.find((f) => f.win === g.win) : undefined
    const setFrames = frame === undefined ? [] : [{ win: g.win, x: frame.x + ddx, y: frame.y - BOARD.frameLabelH + ddy }]
    if (set.length > 0 || setFrames.length > 0) storage.setTabCanvas({ ...(set.length > 0 ? { set } : {}), ...(setFrames.length > 0 ? { setFrames } : {}) })
  }
  const onCancel = (e: PointerEvent): void => {
    const g = gesture.current
    if (g === null || e.pointerId !== g.pointer) return
    endGesture()
    if (g.kind === 'card') settleCard(g.el)
    if (g.kind === 'group') for (const el of g.els) settleCard(el)
  }
  const handlers = useRef({ onMove, onUp, onCancel })
  handlers.current = { onMove, onUp, onCancel }
  const listeners = useRef({
    move: (e: PointerEvent) => handlers.current.onMove(e),
    up: (e: PointerEvent) => handlers.current.onUp(e),
    cancel: (e: PointerEvent) => handlers.current.onCancel(e),
  })
  const startGesture = (g: Gesture): void => {
    // A drag or a pan ends a glance: the preview goes, an armed Close is put back, and no window glows.
    cardPreview.close()
    glowWindow(null)
    if (live.current.armed !== null) setArmed(null)
    gesture.current = g
    window.addEventListener('pointermove', listeners.current.move)
    window.addEventListener('pointerup', listeners.current.up)
    window.addEventListener('pointercancel', listeners.current.cancel)
  }
  const endGesture = (): void => {
    gesture.current = null
    window.removeEventListener('pointermove', listeners.current.move)
    window.removeEventListener('pointerup', listeners.current.up)
    window.removeEventListener('pointercancel', listeners.current.cancel)
  }
  useEffect(() => endGesture, [])

  const doors = {
    click: (id: string, e: MouseEvent) => {
      if (dropped.current) return
      // Shift is the selection gesture and nothing else, as on a sidebar row — and ⌘, as on Excalidraw's canvas: it picks, and never opens.
      if (e.shiftKey || e.metaKey) togglePick(id)
      else openCard(id)
    },
    menu: (id: string, e: MouseEvent) => {
      const card = live.current.info.get(id)
      if (card === undefined) return
      // On one of two or more picked cards the menu is the pick's; on any other card — this window's or another's — the
      // tab's own menu, with "Go to tab" before it and "Close tab" after (D31: one menu for every card).
      menuOn(e, () =>
        live.current.picked.has(id) && live.current.pick.length > 1
          ? setPickMenu({ x: e.clientX, y: e.clientY })
          : setPageMenu({ x: e.clientX, y: e.clientY, id, path: card.page.path, review: reviewState?.(card.page.path) ?? null, named: card.page.named, lists: listState?.(card.page.path) ?? null }),
      )
    },
    hover: (id: string) => {
      // A move of the pointer, never a card that was panned or dragged under it.
      if (gesture.current !== null) return
      // The preview's dwell is the tiny store's: no render of the board (D18).
      const card = live.current.info.get(id)
      if (card !== undefined) cardPreview.hoverCard(id, card.page.path)
      if (id === live.current.current) return
      typed.current = false
      setCursor(id)
    },
    leave: (id: string) => {
      cardPreview.leaveCard(id)
      // The pointer off the card puts its armed Close back to ✕.
      setArmed((now) => (now === `card:${id}` ? null : now))
    },
    // The ✕'s two clicks: the first arms it, the second (on the armed one) closes.
    close: (id: string) => {
      if (live.current.armed === `card:${id}`) {
        setArmed(null)
        closeCards([id])
      } else setArmed(`card:${id}`)
    },
    press: (id: string, e: ReactPointerEvent<HTMLElement>) => {
      // The card's own press: never the camera's. A ✕ and a name field keep theirs.
      e.stopPropagation()
      if (e.button !== 0 || live.current.renaming === id || (e.target instanceof Element && e.target.closest('button, input') !== null)) return
      // A PICKED card carries the whole pick, of any windows and groups (D25): every picked card follows by
      // transform and the drop stores them all — it never moves a tab to another window; only a single unpicked card's drop does (D13).
      if (live.current.picked.has(id)) {
        const picks = live.current.pick
        const els = Array.from(worldRef.current?.querySelectorAll<HTMLElement>('[data-tab]') ?? []).filter((el) => picks.includes(el.dataset.tab ?? ''))
        return startGesture({ kind: 'group', win: '', cards: picks, els, lead: id, pointer: e.pointerId, startX: e.clientX, startY: e.clientY, dragging: false, dx: 0, dy: 0 })
      }
      startGesture({ kind: 'card', pointer: e.pointerId, id, el: e.currentTarget, startX: e.clientX, startY: e.clientY, dragging: false, dx: 0, dy: 0 })
    },
    rename: (id: string, name: string | null) => setCardName(id, name),
    // The board reads its keys from the filter box: the field gives the focus back to it, or Esc and the arrows would do nothing.
    renamed: () => {
      setRenaming(null)
      inputRef.current?.focus()
    },
  }
  const doorsRef = useRef(doors)
  doorsRef.current = doors
  const [actions] = useState<CardActions>(() => ({
    click: (id, e) => doorsRef.current.click(id, e),
    menu: (id, e) => doorsRef.current.menu(id, e),
    hover: (id) => doorsRef.current.hover(id),
    leave: (id) => doorsRef.current.leave(id),
    close: (id) => doorsRef.current.close(id),
    press: (id, e) => doorsRef.current.press(id, e),
    rename: (id, name) => doorsRef.current.rename(id, name),
    renamed: () => doorsRef.current.renamed(),
  }))

  // THE SETTLE (D15): a card snapped into its cell starts where it was let go and eases in. After the
  // render that moved it, before the paint; transform only, and none under reduced motion.
  useLayoutEffect(() => {
    const all = flip.current
    if (all === null) return
    flip.current = null
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches !== false) return
    for (const f of all) {
      if (f.x === 0 && f.y === 0) continue
      f.el.style.transition = 'none'
      f.el.style.transform = `translate(${f.x}px, ${f.y}px)`
      void f.el.offsetWidth
      f.el.style.transition = 'transform 120ms ease'
      f.el.style.transform = ''
      window.setTimeout(() => (f.el.style.transition = ''), 160)
    }
  })
  // The strip lights the tab of the highlighted card (`boardHighlight.ts`), and a board that goes lets go.
  useEffect(() => {
    setBoardHighlight(current)
  }, [current])
  useEffect(() => () => setBoardHighlight(null), [])
  // The highlight on ANOTHER window's card lights that tab in ITS strip too (D33): sent when the highlighted
  // card changes, and put out in the window lit before — when the highlight leaves its cards, and when the board goes.
  const litTab = useRef<{ win: string; key: string } | null>(null)
  useEffect(() => {
    const card = current === null ? undefined : info.get(current)
    const next = card === undefined || card.mine ? null : { win: card.win, key: `${card.ref.path}\n${card.ref.copy}` }
    const was = litTab.current
    if (was?.win === next?.win && was?.key === next?.key) return
    if (was !== null && was.win !== next?.win) api.window.highlightTab(was.win, null).catch(() => undefined)
    if (next !== null && card !== undefined) api.window.highlightTab(next.win, card.ref).catch(() => undefined)
    litTab.current = next
  }, [current, info])
  useEffect(
    () => () => {
      if (litTab.current !== null) api.window.highlightTab(litTab.current.win, null).catch(() => undefined)
    },
    [],
  )
  // SPACE, held, opens the sidebar's own preview panel for the highlighted card (D18: one preview look), and
  // follows the highlight while it is held; let go, it closes. Whatever Settings › Preview on hover says: it is a key.
  useEffect(() => {
    const card = current === null ? undefined : info.get(current)
    if (spaceHeld && current !== null && card !== undefined) cardPreview.showNow(current, card.page.path)
    else cardPreview.endSpace()
  }, [spaceHeld, current])

  // The pictures follow the plan too: a card that moved, or a filter that brought a drawing on screen.
  useEffect(() => camera.recountIfPlaced(), [plan])

  // THE ZOOM. Opening, App shrinks the active tab's layer onto that tab's card while the board settles in
  // around it; leaving, both run back, onto the chosen card. The card's centre on screen is its world place ×
  // the zoom + the pan (D7), and three things go to the tab stack as custom properties: that centre (the board
  // turns about it), how much smaller than the layer the card is, and the point the layer shrinks about — the
  // centre of the similarity that lays the layer's box on the card. `data-zoom` starts the board's animation.
  useLayoutEffect(() => {
    const el = rootRef.current
    const stack = el?.parentElement ?? null
    if (el === null || stack === null) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    const pos = active === null ? undefined : posOf(active)
    const { x, y, zoom } = cam.current
    stack.style.setProperty('--tab-zoom-ms', `${ZOOM_MS}ms`)
    if (w > BOARD.pageW * zoom && pos !== undefined) {
      const scale = w / (BOARD.pageW * zoom)
      const body = bodyRef.current
      const page = { x: (body?.offsetLeft ?? 0) + x + (pos.x + BOARD.pageW / 2) * zoom, y: (body?.offsetTop ?? 0) + y + (pos.y + BOARD.pageH / 2) * zoom }
      stack.style.setProperty('--tab-zoom-scale', String(scale))
      stack.style.setProperty('--tab-zoom-x', `${page.x}px`)
      stack.style.setProperty('--tab-zoom-y', `${page.y}px`)
      stack.style.setProperty('--tab-layer-x', `${(scale * page.x - w / 2) / (scale - 1)}px`)
      stack.style.setProperty('--tab-layer-y', `${(scale * page.y - h / 2) / (scale - 1)}px`)
    } else for (const name of ZOOM_POINT) stack.style.removeProperty(name)
    el.dataset.zoom = leaving ? 'out' : 'in'
  }, [leaving, active, view, plan])
  useEffect(() => {
    const stack = rootRef.current?.parentElement
    return () => {
      for (const name of [...ZOOM_POINT, '--tab-zoom-ms']) stack?.style.removeProperty(name)
    }
  }, [])
  // The way out takes as long as the animation: a timer, so it ends where no animation runs too.
  const left = useRef(onLeft)
  left.current = onLeft
  useEffect(() => {
    if (!leaving) return
    const timer = setTimeout(() => left.current?.(), ZOOM_MS)
    return () => clearTimeout(timer)
  }, [leaving])

  useEffect(() => inputRef.current?.focus(), [])
  // A tab closed from the strip takes the focus with it, and so does a menu that closes: the keys stay with the board.
  useEffect(() => {
    if (!anyMenu && document.activeElement === document.body) inputRef.current?.focus()
  }, [tabs, anyMenu])
  // Space let go closes the preview, wherever the focus is by then; so does the window losing it.
  useEffect(() => {
    if (!spaceHeld) return
    const end = (e: Event): void => {
      if (e.type === 'blur' || (e as globalThis.KeyboardEvent).key === ' ') setSpaceHeld(false)
    }
    window.addEventListener('keyup', end)
    window.addEventListener('blur', end)
    return () => {
      window.removeEventListener('keyup', end)
      window.removeEventListener('blur', end)
    }
  }, [spaceHeld])
  // A window a card was popped out to (D37): when it shows up, its frame stands beside its source's — right of
  // it, or below when the row has no room. One shot, for this board.
  useEffect(() => {
    const pop = popping.current
    if (pop === null) return
    const fresh = others.find((w) => !known.current.has(w.id) && w.tabs.includes(pop.path))
    if (fresh === undefined) return
    popping.current = null
    const source = plan.frames.find((f) => f.win === pop.from)
    if (source === undefined) return
    const wide = BOARD.pageW + 2 * BOARD.framePad
    const right = source.x + source.w + BOARD.frameGap
    const at = right + wide <= wrapW ? { x: right, y: source.y - BOARD.frameLabelH } : { x: source.x, y: source.y + source.h + BOARD.frameGap }
    setAnchors((held) => new Map(held).set(fresh.id, at))
  }, [others])
  // A card that APPEARS while the board shows (D30, S36, S51) in a window the board already showed — a copy, a tab
  // moved in, a tab opened there — arrives as every arrival does (`arrivalIn`): a copy by its source, any other in the
  // frame's first free cell, each in a cell of its own. Stored at once; one write for all of them. A card the filter
  // brings back is no new card: the cards seen are every tab of the windows shown, filtered or not.
  const seenWins = useRef<ReadonlySet<string>>(new Set())
  useEffect(() => {
    const ids = new Set(allCards)
    const wins = new Set(plan.frames.map((f) => f.win))
    const knewWins = seenWins.current
    seenWins.current = wins
    const seen = seenCards.current
    seenCards.current = ids
    if (seen === null || layout !== 'window') return
    const fresh = allCards.filter((id) => !seen.has(id) && plan.cards.get(id)?.moved === false && knewWins.has(plan.cards.get(id)!.win))
    const set: CanvasCard[] = []
    const except = new Set(fresh)
    const arrived = new Map<string, { x: number; y: number }>()
    const where = (id: string) => arrived.get(id) ?? posOf(id)
    for (const id of fresh) {
      const card = plan.cards.get(id)!
      const dup = dupSource.current
      const source = dup !== null && dup.win === card.win && dup.path === card.path ? plan.cards.get(dup.id) : undefined
      if (source !== undefined) dupSource.current = null
      const out = arrivalIn(plan, card.win, card, { where, near: source, except })
      // An arrival stands where it was put: the next one keeps out of its cell. The frame is frozen once.
      const arrival = out[out.length - 1]
      arrived.set(id, arrival)
      except.delete(id)
      set.push(...out.filter((c) => !set.some((d) => d.win === c.win && d.path === c.path && d.copy === c.copy)))
    }
    if (set.length === 0) return
    storage.setTabCanvas({ set })
  }, [plan])
  // THE LAYOUT'S REPAIR (D28, S56): a frame or group the layout moved clear of another is stored where it stands, so
  // the state says what the board shows; the next layout then moves nothing and stores nothing. Never while a filter
  // is typed: that layout is the filter's. The same repair is never sent twice.
  const repaired = useRef('')
  useEffect(() => {
    if (plan.repair === null || terms.length > 0) return
    const key = JSON.stringify(plan.repair)
    if (key === repaired.current) return
    repaired.current = key
    storage.setTabCanvas(plan.repair)
  }, [plan])
  // The board going puts out the glow it lit.
  useEffect(
    () => () => {
      if (glowing.current !== null) onHighlightWindowRef.current?.(null)
    },
    [],
  )
  // The board's own placements (a new window at the click point, a popped-out tab's beside its source) are STORED as
  // frame places as soon as that window is in the state, so they outlive the board (D16).
  useEffect(() => {
    const known = new Set(others.map((w) => w.id))
    const due = [...anchors].filter(([win]) => known.has(win))
    if (due.length === 0) return
    storage.setTabCanvas({ setFrames: due.map(([win, p]) => ({ win, x: p.x, y: p.y })) })
    setAnchors((held) => new Map([...held].filter(([win]) => !known.has(win))))
  }, [others, anchors])
  // A card held where it was dropped in another window's frame lets go once its window's tabs change: it left, or it stays where it stood.
  useEffect(() => {
    setGhosts((held) => (held.size === 0 ? held : new Map()))
  }, [tabs, others])
  // The arrows and the filter move the camera to the highlight (D7); the pointer never does.
  useEffect(() => {
    if (!wantReveal.current || current === null) return
    wantReveal.current = false
    camera.reveal(current)
  }, [current, plan])

  const changeQuery = (next: string): void => {
    typed.current = true
    wantReveal.current = true
    setQuery(next)
    // New text starts on its first match; no text, on the page that is open.
    lastAt.current = 0
    setCursor(next.trim() === '' ? active : null)
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    // A menu that is open has the keys: its Esc closes it, not the board. The board's own menus, and
    // a menu of the strip that left the focus here: the grid button's (YAZ-2739).
    if (anyMenu || document.querySelector('.ctx-menu') !== null) return
    if (e.key === 'Escape') {
      e.preventDefault()
      // The first Esc puts an armed Close back, then drops the pick; the board goes on the next.
      if (armed !== null) setArmed(null)
      else if (pick.length > 0) setPicked(NONE)
      else onDismiss()
      return
    }
    // SPACE PREVIEWS the highlighted card (D18) — except while a query is being typed, where it is a
    // space. "Being typed" is: the box holds text, and the last thing done was typing in it. A
    // move of the highlight, by an arrow or by the pointer going onto another card, hands Space
    // back to the preview; the next character typed takes it again. An empty box never needs a space.
    if (e.key === ' ' && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLInputElement && e.target.type === 'checkbox') && current !== null && (query === '' || !typed.current)) {
      e.preventDefault()
      if (!spaceHeld) setSpaceHeld(true)
      return
    }
    // Enter on a ✕ is that button's own.
    if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault()
      if (current !== null) openCard(current)
      return
    }
    const way = WAYS[e.key]
    if (current === null || way === undefined) return
    // The arrows are the cards': the caret in the filter box does not move.
    e.preventDefault()
    const els = Array.from(bodyRef.current?.querySelectorAll<HTMLElement>('[data-tab]') ?? [])
    const from = els.findIndex((el) => el.dataset.tab === current)
    if (from === -1) return
    // `getBoundingClientRect` reads the camera's transform too: the arrows go by what is on screen.
    const boxes = els.map((el) => el.getBoundingClientRect())
    // With no layout (jsdom) there is no geometry, and the stops are one line.
    const to = els[boxes[from].width === 0 ? from + (way === 'left' || way === 'up' ? -1 : 1) : nearest(boxes, from, way)]
    if (to?.dataset.tab === undefined) return
    typed.current = false
    wantReveal.current = true
    setCursor(to.dataset.tab)
  }

  // A press on the board's body (D7): a folder group's label row or background holds that group, a window frame's
  // label or background that whole window (D16); empty canvas outside them pans. A card, a
  // button and a field keep their own presses.
  const onBodyPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0 || gesture.current !== null || !(e.target instanceof Element)) return
    if (e.target.closest('.taboverview__page, button, input, label, .taboverview__zoom') !== null) return
    // The pointer is captured only once a drag or a pan really starts: captured at the press, the clicks that follow
    // would go to the body, and a double click on a frame's label would never rename it (D14).
    const start = { pointer: e.pointerId, startX: e.clientX, startY: e.clientY, dragging: false, dx: 0, dy: 0 }
    const islandEl = e.target.closest<HTMLElement>('.taboverview__island')
    const group = islandEl === null ? undefined : groupsByKey.get(islandEl.dataset.key ?? '')
    if (islandEl !== null && group !== undefined) return startGesture({ kind: 'group', win: group.win, cards: group.island.pages.map((page) => page.id), els: [islandEl], ...start })
    const frameEl = allWindows ? e.target.closest<HTMLElement>('.taboverview__frame') : null
    const win = frameEl?.dataset.win
    if (frameEl !== null && win !== undefined && naming !== win) {
      const world = worldRef.current
      const mine = (el: HTMLElement): boolean => el.dataset.win === win
      // The frame holds its cards directly (D17): the frame and every card of it move.
      const els = [frameEl, ...Array.from(world?.querySelectorAll<HTMLElement>('[data-tab]') ?? []).filter(mine)]
      return startGesture({ kind: 'group', win, cards: plan.order.filter((id) => info.get(id)?.win === win), els, ...start })
    }
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId)
    } catch {
      // A synthetic pointer: the window still hears it.
    }
    startGesture({ kind: 'pan', pointer: e.pointerId, startX: e.clientX, startY: e.clientY, camX: cam.current.x, camY: cam.current.y })
  }

  /** "Show all windows" (D8): one switch, stored. The camera goes back to the top-left of the new layout. */
  const toggleAllWindows = (): void => {
    storage.setTabCanvas({ allWindows: !allWindows })
    cam.current = { ...cam.current, x: BOARD.padX, y: BOARD.padTop }
    applyCamera()
  }
  /** "Tidy up" (D9): every place stored in this layout for the windows it shows — moved cards, groups and frames — goes; all stand in their groups again. */
  const shownWins = new Set(shownWindows.map((w) => w.win))
  const movedShown = canvas.cards.filter((card) => card.by === layout && shownWins.has(card.win))
  /** The frames placed in this layout ('window' only): Tidy up forgets them too. */
  const placedFrames = layout === 'window' ? canvas.frames.filter((f) => shownWins.has(f.win)) : []
  const tidyUp = (): void => {
    const forget = movedShown.map(({ win, path, copy, by }) => ({ win, path, copy, by }))
    const forgetFrames = placedFrames.map((f) => f.win)
    if (forget.length > 0 || forgetFrames.length > 0) storage.setTabCanvas({ ...(forget.length > 0 ? { forget } : {}), ...(forgetFrames.length > 0 ? { forgetFrames } : {}) })
    setAnchors(new Map())
    setGhosts(new Map())
  }
  /** "Tidy up this window" (D21, D29) and "Tidy up this group": one write. */
  const tidy = (patch: TabCanvasPatch | null): void => {
    if (patch === null) return
    storage.setTabCanvas(patch)
  }
  /** A frame's "Close all tabs" / "Close window", on its second click (D21: two clicks, no sheet). */
  const closeWindow = (win: string, whole: boolean): void => {
    const w = byWin.get(win)
    if (w === undefined) return
    onCloseWindow?.({ win, mine: w.mine, refs: refsOf(w.tabs), whole })
  }
  /**
   * "New window" (D22): one on this window's vaults, behind; its frame stands at the asked point while the
   * board shows, and the search opens for it. The switch turns on: a window is a frame of "Show all windows".
   */
  const newWindowAt = (world: { x: number; y: number }): void => {
    setCanvasMenu(null)
    if (onNewWindow === undefined) return
    if (!allWindows) toggleAllWindows()
    onNewWindow().then(
      (win) => {
        setAnchors((held) => new Map(held).set(win, world))
        setSearchFor(win)
      },
      () => onNotice?.("Can't open a new window"),
    )
  }
  /**
   * A pick of "Open tabs here…" (D22): the page as a background tab of the window. This window adds it
   * itself; another gets it as a quiet move of a path (nothing closes here). A frame the board placed (`anchors`)
   * keeps the arriving card in its grid there.
   */
  const openTabIn = (win: string, path: string): void => {
    const w = byWin.get(win)
    // A window opened a moment ago may not be in the state yet: it shows this window's vaults.
    if (rootOfPath(w?.roots ?? roots, path) === null) return void onNotice?.(ADD_REFUSED)
    // It arrives inside its frame (D28), as every arrival; a window not in the state yet stands at its anchor.
    const anchor = frameAnchors.get(win)
    if (w !== undefined && plan.frames.some((f) => f.win === win)) {
      storage.setTabCanvas({ set: arrivalIn(plan, win, { path, copy: w.tabs.filter((t) => t.path === path).length }, { where: posOf }) })
    } else if (anchor !== undefined) {
      storage.setTabCanvas({ set: [{ win, path, copy: 0, by: 'window', x: anchor.x + BOARD.framePad, y: anchor.y + BOARD.frameLabelH + BOARD.framePad }] })
    }
    if (w?.mine === true || win === windowId) onOpenTabHere?.(path)
    else api.window.moveTo(win, path, { background: true }).catch(() => onNotice?.(ADD_REFUSED))
  }
  /**
   * "Move to new window" on a card (D37): QUIET from the board. This window's card by its own door, another
   * window's by asking that window (its text saved first). The new window's frame then stands beside its source's.
   */
  const popOutCard = (path: string, id: string): void => {
    const card = info.get(id)
    if (card === undefined) return
    known.current = new Set([windowId, ...others.map((w) => w.id)])
    popping.current = { from: card.win, path }
    if (card.mine) onMoveToNewWindowQuietly(path, id)
    else api.window.popOutTab(card.win, card.ref).catch(() => onNotice?.("Can't move that tab: its window is closed"))
  }
  /** This window's watch feed of a vault it shows, for the search panel; none for another vault. One identity per `previewScope`: the panel's vaults are memoised on it. */
  const watchOf = useCallback(
    (root: string) => {
      const scope = previewScope?.(root)
      return scope !== undefined && scope.root === root ? scope.watch : undefined
    },
    [previewScope],
  )
  /** Where the search panel stands (D22): beside its frame on screen, inside the board; the canvas's point for a frame not there yet. */
  const searchAt = (win: string): { left: number; top: number } => {
    const frame = plan.frames.find((f) => f.win === win)
    const anchor = anchors.get(win)
    const c = cam.current
    const body = bodyRef.current
    const ox = body?.offsetLeft ?? 0
    const oy = body?.offsetTop ?? 0
    const w = rootRef.current?.clientWidth ?? 0
    const h = rootRef.current?.clientHeight ?? 0
    const right = frame === undefined ? (anchor?.x ?? 0) : frame.x + frame.w
    const top = frame === undefined ? (anchor?.y ?? 0) : frame.y - BOARD.frameLabelH
    let left = ox + c.x + right * c.zoom + 12
    if (w > 0 && left + SEARCH_W > w - 12) left = Math.max(12, ox + c.x + (frame?.x ?? anchor?.x ?? 0) * c.zoom - SEARCH_W - 12)
    return { left, top: Math.max(12, Math.min(oy + c.y + top * c.zoom, h > 0 ? h - 200 : Infinity)) }
  }
  /**
   * A right-click on the board's body (D21): a folder group's — label row or background — opens its menu, a
   * window frame's its own; empty canvas opens nothing, and never the app's text-edit menu. A card's own menu and a
   * name field's text menu stop it before it gets here.
   */
  const onBodyContextMenu = (e: MouseEvent): void => {
    e.preventDefault()
    if (!(e.target instanceof Element)) return
    const islandEl = e.target.closest<HTMLElement>('.taboverview__island')
    const key = islandEl?.dataset.key
    if (key !== undefined && groupsByKey.has(key)) return menuOn(e, () => setIslandMenu({ x: e.clientX, y: e.clientY, key }))
    const win = allWindows ? e.target.closest<HTMLElement>('.taboverview__frame')?.dataset.win : undefined
    if (win !== undefined && byWin.has(win)) return menuOn(e, () => setFrameMenu({ x: e.clientX, y: e.clientY, win }))
    // Empty canvas: "New window" there (D21), and never the text-edit menu.
    if (onNewWindow !== undefined && e.target.closest('.taboverview__page, .taboverview__island, .taboverview__frame, .taboverview__zoom') === null) {
      const world = toWorld(e.clientX, e.clientY)
      menuOn(e, () => setCanvasMenu({ x: e.clientX, y: e.clientY, world }))
    }
  }

  /** "Kill all tabs": this window's tabs — and with the switch on every other window's (D10). App asks first. */
  const killAll = (): void => {
    const rest = allWindows ? windows.filter((w) => !w.mine && w.tabs.length > 0).map((w) => ({ win: w.win, refs: refsOf(w.tabs) })) : []
    onKillAll?.(rest)
  }
  /** A frame's name (D14): stored for every window to read; empty, or the automatic label, is no name. */
  const nameWindow = (win: string, next: string | null): void => {
    const w = byWin.get(win)
    if (w === undefined) return
    storage.setWindowName(win, next === null || next === w.auto ? null : next)
  }

  /** One card, at its place: inside its group's box (the folder layout), or straight on the world (a window frame). */
  const cardOf = (id: string, group?: { x: number; y: number }) => {
    const card = info.get(id)
    if (card === undefined) return null
    const { page } = card
    const pos = posOf(id) ?? { x: 0, y: 0 }
    const w = byWin.get(card.win)
    return (
      <Card
        key={id}
        id={id}
        path={page.path}
        win={card.win}
        stopId={stopIds.get(id)}
        label={page.label}
        page={page.page}
        named={page.named}
        folder={group === undefined ? card.folder : null}
        lines={withoutTitle(linesOf(page.path), page.page)}
        copyText={page.copies > 1 ? `${page.copy + 1} of ${page.copies}` : null}
        x={pos.x - (group?.x ?? 0)}
        y={pos.y - (group?.y ?? 0)}
        active={w?.active === id}
        previewing={w?.mine === true && id === preview}
        current={id === current}
        picked={picked.has(id)}
        renaming={id === renaming}
        armed={armed === `card:${id}`}
        picture={pictured.has(id)}
        root={card.root}
        darkColors={darkColors}
        actions={actions}
      />
    )
  }
  const previewCard = (id: string): { root: string | null; name: string } | null => {
    const card = info.get(id)
    return card === undefined ? null : { root: card.root, name: card.page.label }
  }
  const menuGroup = islandMenu === null ? undefined : groupsByKey.get(islandMenu.key)
  const menuGroupMine = menuGroup !== undefined && byWin.get(menuGroup.win)?.mine === true
  /** The row of the sidebar that stands for an island: its folder, or — with two or more vaults — its vault's row. A page in no vault has none. */
  const sidebarRowOf = (island: Island): string | null => {
    const vault = rootOfPath(roots, island.dir)
    if (vault === null) return null
    return island.top ? (roots.length > 1 ? vault : null) : island.dir
  }
  const menuRow = menuGroup === undefined || !menuGroupMine ? null : sidebarRowOf(menuGroup.island)
  const menuCard = pageMenu === null ? undefined : info.get(pageMenu.id)
  /** Light the real window `win` (the "Move to ▸" rows' glow), or none: only when it changes. */
  const glowWindow = (win: string | null): void => {
    if (glowing.current === win) return
    glowing.current = win
    onHighlightWindow?.(win)
  }
  /**
   * The pointer over ANOTHER window's frame — its label, its background or a card (D33): that window glows.
   * This window's own frame and empty canvas put it out. A menu that is open has the glow ("Move to ▸" rows).
   */
  const onBodyHover = (e: MouseEvent): void => {
    if (pageMenu !== null || gesture.current !== null || !(e.target instanceof Element)) return
    const win = allWindows ? (e.target.closest<HTMLElement>('.taboverview__page, .taboverview__frame')?.dataset.win ?? null) : null
    glowWindow(win === null || win === windowId || byWin.get(win)?.mine === true ? null : win)
  }
  /** A window's vaults as its frame says them (D34): one vault's name, a saved workspace's, else the first +N. */
  const vaultsLabel = (list: readonly string[]): string => {
    const set = storage.getVaultSets().find((one) => one.roots.length === list.length && one.roots.every((r, i) => r === list[i]))
    if (set !== undefined) return set.name
    return list.length === 1 ? storage.vaultName(list[0]) : `${storage.vaultName(list[0])} +${list.length - 1}`
  }
  /**
   * A double click on a frame's EMPTY AREA (D32): another window comes
   * to the front on its active tab — shown if hidden, restored if minimized — and this board stays; an empty one just
   * shows. This window's frame leaves the board onto its active tab, as a click on its card. Its label renames.
   */
  const goToFrame = (win: string, e: MouseEvent): void => {
    if (!(e.target instanceof Element) || e.target.closest('.taboverview__page, .taboverview__frame-label, button, input') !== null) return
    const w = byWin.get(win)
    if (w === undefined) return
    if (w.mine) {
      if (active !== null) onOpen(active)
      return
    }
    const card = w.active === null ? undefined : info.get(w.active)
    if (card !== undefined) api.window.focusTab(win, card.ref).catch(() => onNotice?.("Can't go to that window: it is closed"))
    else api.window.showWindow(win).catch(() => onNotice?.("Can't show that window: it is closed"))
  }
  /** A tab action of another window's card (D31): that window runs it on its own tab. */
  const askTab = (id: string, action: TabAction): void => {
    const card = info.get(id)
    if (card === undefined || card.mine) return
    api.window.tabAction(card.win, card.ref, action).catch(() => onNotice?.("Can't reach that tab: its window is closed"))
  }
  /** A card's display name (YAZ-2949): this window's by its own door; another window's by asking it. */
  const setCardName = (id: string, name: string | null): void => {
    const card = info.get(id)
    if (card === undefined) return
    if (card.mine) onSetName?.(id, name)
    else askTab(id, { kind: 'set-name', name })
  }
  /** "Move to ▸" rows of a card (D31): every OTHER window than its own that shows a vault of its page, by its frame's label. */
  const moveTargetsOf = (id: string): MoveTarget[] => {
    const card = info.get(id)
    if (card === undefined) return []
    // With the switch off the board knows no other window: App's own rows, as the strip's.
    if (!allWindows) return card.mine ? [...(onMoveTargets?.(card.page.path) ?? [])] : []
    return windows.filter((w) => w.win !== card.win && rootOfPath(w.roots, card.page.path) !== null).map((w) => ({ id: w.win, label: w.label }))
  }
  /**
   * "Move to ▸ <window>" from the board (D20): QUIET, as a card dropped in that window's frame — no raise, a
   * background tab there — and the card arrives in that frame's nearest free cell.
   */
  const moveCardTo = (id: string, to: string): void => {
    const card = info.get(id)
    const target = byWin.get(to)
    if (card === undefined) return
    if (target !== undefined && plan.frames.some((f) => f.win === to)) storage.setTabCanvas({ set: arrivalIn(plan, to, { path: card.page.path, copy: target.tabs.filter((t) => t.path === card.page.path).length }, { where: posOf }) })
    setRinged(null)
    sendCard(card, to)
  }
  const frameOfMenu = frameMenu === null ? undefined : byWin.get(frameMenu.win)

  return (
    // A click anywhere but a text field leaves the focus in the filter box, so the keys keep working.
    <div
      ref={rootRef}
      className="taboverview"
      style={SIZES}
      onKeyDown={onKeyDown}
      onMouseDown={(e) => {
        if (e.target === inputRef.current) return
        // The board keeps the focus where it is, so a press away from a card's name field would not end it:
        // that press saves it, as a click away does on the strip (YAZ-2949 S3).
        if ((renaming !== null || naming !== null) && document.activeElement instanceof HTMLElement) document.activeElement.blur()
        // A press anywhere but the armed Close itself puts it back.
        if (armed !== null && !(e.target instanceof Element && e.target.closest('.taboverview__close--armed, .taboverview__pick .taboverview__armed') !== null)) setArmed(null)
        e.preventDefault()
      }}
    >
      {/* The board's top row: the filter box, and at the right end "Kill all tabs" (D24: the switch and "Tidy up" are in the toolbar). */}
      <div className="taboverview__top">
        <input
          ref={inputRef}
          className="taboverview__filter"
          type="text"
          value={query}
          placeholder="Filter open tabs"
          aria-label="Filter open tabs"
          // The focus stays here while the arrows move the highlight: a reader is told which card has it.
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={currentStop}
          spellCheck={false}
          onChange={(e) => changeQuery(e.target.value)}
        />
        <div className="taboverview__actions">
          {/* Every tab the board is about, whatever the filter shows. App asks first: no tab comes back. */}
          {onKillAll !== undefined && totalTabs > 0 && (
            <button type="button" className="taboverview__kill confirm__btn confirm__btn--danger" onClick={killAll}>
              Kill all tabs
            </button>
          )}
        </div>
      </div>
      <div className="taboverview__body" ref={bodyRef} id={listId} role="listbox" aria-label="Open tabs" onPointerDown={onBodyPointerDown} onContextMenu={onBodyContextMenu} onMouseMove={onBodyHover} onMouseLeave={() => glowWindow(null)}>
        {shown.length === 0 && <p className="taboverview__msg">{totalTabs === 0 ? 'No open tabs.' : 'No open tab matches.'}</p>}
        <div className="taboverview__world" ref={worldRef}>
          {allWindows &&
            plan.frames.map((frame) => {
              const w = byWin.get(frame.win)
              if (w === undefined) return null
              return (
                <div key={`f:${frame.win}`} className={`taboverview__frame${w.mine ? ' taboverview__frame--mine' : ''}${ringed === frame.win ? ' taboverview__frame--ringed' : ''}`} style={{ left: frame.x, top: frame.y, width: frame.w, height: frame.h }} data-win={frame.win} onDoubleClick={(e) => goToFrame(frame.win, e)}>
                  <div
                    className="taboverview__frame-label"
                    title={`${w.label}${w.roots.length > 0 ? `\n${w.roots.map((r) => storage.vaultName(r)).join(', ')}` : ''}`}
                    // The WHOLE label row renames, as a strip tab's double click does (D14) — never the go-to-window.
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      setNaming(frame.win)
                    }}
                  >
                    {naming === frame.win ? (
                      <span onMouseDown={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
                        <TabNameField
                          className="taboverview__rename"
                          label={w.label}
                          pageName={w.auto}
                          onCommit={(next) => nameWindow(frame.win, next)}
                          onDone={() => {
                            setNaming(null)
                            inputRef.current?.focus()
                          }}
                        />
                      </span>
                    ) : (
                      <>
                        <span className="taboverview__frame-name">{w.label}</span>
                        {/* Its vault or workspace, muted (D34); an empty frame's chip says it instead. */}
                        {w.tabs.length > 0 && w.roots.length > 0 && <span className="taboverview__frame-vault">· {vaultsLabel(w.roots)}</span>}
                        {w.mine && <span className="taboverview__frame-here">This window</span>}
                        {hidden.has(frame.win) && <span className="taboverview__frame-hidden">Hidden</span>}
                        {minimized.has(frame.win) && <span className="taboverview__frame-hidden">Minimized</span>}
                        {/* An EMPTY window can still switch its vaults (D22): the chip goes once it has a tab. */}
                        {w.tabs.length === 0 && (
                          <button
                            type="button"
                            className="taboverview__vault-chip"
                            aria-label="Choose the vault of this window"
                            onDoubleClick={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              const box = e.currentTarget.getBoundingClientRect()
                              setChipMenu({ x: box.left, y: box.bottom + 4, win: frame.win })
                            }}
                          >
                            {w.roots.length === 0 ? 'Choose vault' : `${storage.vaultName(w.roots[0])}${w.roots.length > 1 ? ` +${w.roots.length - 1}` : ''}`} ▾
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          {plan.vaults.map((vault) => (
            // The vault is named only where the window has two or more (D7).
            <div key={`v:${vault.key}`} className="taboverview__vault-name" style={{ left: vault.x, top: vault.y, width: vault.w }}>
              {vault.name}
            </div>
          ))}
          {plan.groups.map((group) => {
            const { island } = group
            const count = island.pages.length
            const cut = island.label.lastIndexOf(' / ')
            return (
              <div key={group.key} className="taboverview__island" role="group" aria-label={island.label} data-key={group.key} data-win={group.win} style={{ left: group.x, top: group.y, width: group.w, height: group.h }}>
                <div className="taboverview__island-head">
                  {/* The folder's own name is the last to give way: a long path loses its start first. */}
                  <span className="taboverview__island-label" title={island.dir}>
                    {cut !== -1 && <span className="taboverview__island-path">{island.label.slice(0, cut + 3)}</span>}
                    <span className="taboverview__island-leaf">{island.label.slice(cut === -1 ? 0 : cut + 3)}</span>
                  </span>
                  <span className="taboverview__island-count">{count}</span>
                  {/* Two clicks, as a card's ✕ (D27): "Close N", then the group's tabs close. */}
                  <button
                    type="button"
                    className={`taboverview__island-close${armed === `group:${group.key}` ? ' taboverview__close--armed' : ''}`}
                    aria-label={`Close ${tabCount(count)}: ${island.label}`}
                    title={armed === `group:${group.key}` ? `Click again to close ${tabCount(count)}` : `Close ${tabCount(count)}`}
                    onClick={() => {
                      if (armed !== `group:${group.key}`) return setArmed(`group:${group.key}`)
                      setArmed(null)
                      closeCards(island.pages.map((page) => page.id))
                    }}
                  >
                    {armed === `group:${group.key}` ? `Close ${count}` : '✕'}
                  </button>
                </div>
                {island.pages.map((page) => cardOf(page.id, group))}
              </div>
            )
          })}
          {/* A window frame holds its cards directly, in folder order, each saying its folder (D17). */}
          {allWindows && plan.order.map((id) => cardOf(id))}
        </div>
      </div>
      {/* ONE toolbar, bottom left (D24): the switch, Tidy up, then the camera's controls — a pill "− 100% +" (the percent resets to 100%), "Fit all tabs" and "Snap to grid". */}
      {/* A pointer click here leaves the keys with the filter box, as everywhere on the board (a click on a label focuses its box). */}
      <div className="taboverview__zoom" role="toolbar" aria-label="Board" onClick={(e) => e.detail > 0 && inputRef.current?.focus()}>
        <label className="taboverview__switch" title="Show all windows">
          <input type="checkbox" role="switch" aria-label="Show all windows" aria-checked={allWindows} checked={allWindows} onChange={toggleAllWindows} />
          <span className="taboverview__switch-track" aria-hidden />
          <span className="taboverview__switch-text">Show all windows</span>
        </label>
        <button type="button" className="taboverview__tidy" disabled={movedShown.length === 0 && placedFrames.length === 0} onClick={tidyUp}>
          Tidy up
        </button>
        <span className="taboverview__toolbar-divider" aria-hidden />
        <div className="taboverview__zoom-pill">
          <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => camera.zoomBy(1 / ZOOM_STEP)}>
            −
          </button>
          <button type="button" ref={percentRef} className="taboverview__zoom-percent" aria-label="Reset zoom" title="Reset zoom" onClick={() => camera.zoomBy(1 / cam.current.zoom)}>
            100%
          </button>
          <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => camera.zoomBy(ZOOM_STEP)}>
            +
          </button>
        </div>
        <button type="button" className="taboverview__zoom-fit" aria-label="Fit all tabs" title="Fit all tabs" onClick={camera.fitAll}>
          ⤢
        </button>
        {/* "Snap to grid" (D26): on by default, remembered; lit while on. */}
        <button
          type="button"
          className={`taboverview__zoom-fit taboverview__snap${snapOn ? ' taboverview__snap--on' : ''}`}
          aria-label="Snap to grid"
          aria-pressed={snapOn}
          title={snapOn ? 'Snap to grid: on' : 'Snap to grid: off'}
          onClick={() => {
            storage.setTabCanvas({ snap: !snapOn })
          }}
        >
          #
        </button>
      </div>
      {/* The preview panel beside a card (D18): a rest of the pointer, or Space. Portalled, never clicked. */}
      <CardPreviewHost store={cardPreview.store} cardOf={previewCard} scopeOf={previewScope} diagramDarkColors={darkColors} />
      {/* The pick's bar: only while cards are picked. Each close takes two clicks (D27), drops the pick and leaves the board open. */}
      {pick.length > 0 && (
        <div className="taboverview__pick" role="toolbar" aria-label="Picked tabs">
          <span className="taboverview__pick-count">{pick.length} picked</span>
          <PickClose arm="pick:them" armed={armed} setArmed={setArmed} label="Close them" armedLabel={`Click again to close ${tabCount(pick.length)}`} onClose={() => closePick(false)} />
          <PickClose arm="pick:others" armed={armed} setArmed={setArmed} label="Close the others" armedLabel={othersText} onClose={() => closePick(true)} />
          <button type="button" onClick={() => setPicked(NONE)}>
            Clear
          </button>
        </div>
      )}
      {/* The menu of two or more picked cards leads with what they have in common, as the sidebar's does, and has nothing else. */}
      {pickMenu !== null && (
        <ContextMenuSurface x={pickMenu.x} y={pickMenu.y} onClose={() => setPickMenu(null)}>
          <MenuItem
            label={`Close ${tabCount(pick.length)}`}
            onSelect={() => {
              closePick(false)
              setPickMenu(null)
            }}
          />
          <MenuItem
            label="Close the others"
            onSelect={() => {
              closePick(true)
              setPickMenu(null)
            }}
          />
        </ContextMenuSurface>
      )}
      {/* EVERY card's menu is the tab's (`TabMenu`, D31): "Go to tab", the strip's own items, "Close tab". A card of
          another window asks its window for what only that window can do (`askTab`); the path's items run here. */}
      {pageMenu !== null && menuCard !== undefined && (
        <TabMenu
          menu={pageMenu}
          label={menuCard.page.label}
          onClose={() => {
            setPageMenu(null)
            setRinged(null)
            // The rows lit their own window; the frame under the pointer takes the glow back on the next move.
            glowing.current = null
          }}
          leading={[{ id: 'go-to-tab', label: 'Go to tab', onSelect: () => openCard(pageMenu.id) }]}
          trailing={[{ id: 'close-tab', label: 'Close tab', onSelect: () => closeCards([pageMenu.id]) }]}
          onMoveToRight={menuCard.mine ? onMoveToRight : undefined}
          onMoveToNewWindow={popOutCard}
          moveTargets={moveTargetsOf(pageMenu.id)}
          onMoveToWindow={(to, _path, id) => moveCardTo(id, to)}
          onHighlightWindow={(to) => {
            onHighlightWindow?.(to)
            setRinged(to)
          }}
          onDuplicate={
            menuCard.mine && onDuplicate === undefined
              ? undefined
              : (id) => {
                  // The copy lands by its source (D30): remembered until it shows up.
                  dupSource.current = { id, win: menuCard.win, path: menuCard.page.path }
                  if (menuCard.mine) onDuplicate?.(id)
                  else askTab(id, { kind: 'duplicate' })
                }
          }
          onRename={menuCard.mine && onSetName === undefined ? undefined : setRenaming}
          onResetName={(id) => setCardName(id, null)}
          onShowInSidebar={menuCard.mine ? onShowInSidebar : () => askTab(pageMenu.id, { kind: 'show-in-sidebar' })}
          onSetReview={menuCard.mine ? onSetReview : (_path, on) => askTab(pageMenu.id, { kind: 'set-review', on })}
          // The tab row's two items, in its places and with its glyphs (YAZ-3264 D2, D4, D6): this window writes them for any card of a vault it shows.
          onToggleFocus={onToggleFocus}
          onToggleFavorite={onToggleFavorite}
          onNotice={onNotice}
        />
      )}
      {/* An island is a folder: its row in the sidebar (this window's only), its path, and its tabs as one. */}
      {islandMenu !== null && menuGroup !== undefined && (
        <ContextMenuSurface x={islandMenu.x} y={islandMenu.y} onClose={() => setIslandMenu(null)}>
          {onShowInSidebar !== undefined && menuRow !== null && (
            <MenuItem
              label="Show in sidebar"
              onSelect={() => {
                onShowInSidebar(menuRow)
                setIslandMenu(null)
              }}
            />
          )}
          <MenuItem
            label="Copy path"
            onSelect={() => {
              void navigator.clipboard.writeText(menuGroup.island.dir)
              setIslandMenu(null)
            }}
          />
          <MenuItem
            label="Tidy up this group"
            onSelect={() => {
              tidy(tidyGroup(plan, menuGroup.key, wrapW))
              setIslandMenu(null)
            }}
          />
          <MenuItem
            label={`Close ${tabCount(menuGroup.island.pages.length)}`}
            onSelect={() => {
              closeCards(menuGroup.island.pages.map((page) => page.id))
              setIslandMenu(null)
            }}
          />
        </ContextMenuSurface>
      )}
      {/* A window's frame (D14): its name, and the way back to its automatic label. */}
      {frameMenu !== null && frameOfMenu !== undefined && (
        <ContextMenuSurface x={frameMenu.x} y={frameMenu.y} onClose={() => setFrameMenu(null)}>
          {hidden.has(frameMenu.win) && (
            <MenuItem
              onHover={() => setFrameArm(null)}
              label="Show window"
              onSelect={() => {
                const win = frameMenu.win
                setFrameMenu(null)
                api.window.showWindow(win).catch(() => onNotice?.("Can't show that window: it is closed"))
              }}
            />
          )}
          <MenuItem
            onHover={() => setFrameArm(null)}
            label="Open tabs here…"
            onSelect={() => {
              setSearchFor(frameMenu.win)
              setFrameMenu(null)
            }}
          />
          <MenuItem
            onHover={() => setFrameArm(null)}
            label="Tidy up this window"
            onSelect={() => {
              tidy(tidyFrame(plan, frameMenu.win))
              setFrameMenu(null)
            }}
          />
          <MenuItem
            onHover={() => setFrameArm(null)}
            label="Name window"
            onSelect={() => {
              setNaming(frameMenu.win)
              setFrameMenu(null)
            }}
          />
          {frameOfMenu.named && (
            <MenuItem
              onHover={() => setFrameArm(null)}
              label="Reset name"
              onSelect={() => {
                nameWindow(frameMenu.win, null)
                setFrameMenu(null)
              }}
            />
          )}
          {/* Two clicks IN PLACE (D21): the first turns the item red, the second does it; another item puts it back. */}
          {onCloseWindow !== undefined && frameOfMenu.tabs.length > 0 && (
            <MenuItem
              label={frameArm === 'tabs' ? `Click again to close ${tabCount(frameOfMenu.tabs.length)}` : 'Close all tabs'}
              danger={frameArm === 'tabs'}
              onHover={() => setFrameArm((now) => (now === 'tabs' ? now : null))}
              onSelect={() => {
                if (frameArm !== 'tabs') return setFrameArm('tabs')
                closeWindow(frameMenu.win, false)
                setFrameMenu(null)
              }}
            />
          )}
          {onCloseWindow !== undefined && (
            <MenuItem
              label={frameArm === 'window' ? 'Click again to close' : 'Close window'}
              danger={frameArm === 'window'}
              onHover={() => setFrameArm((now) => (now === 'window' ? now : null))}
              onSelect={() => {
                if (frameArm !== 'window') return setFrameArm('window')
                closeWindow(frameMenu.win, true)
                setFrameMenu(null)
              }}
            />
          )}
        </ContextMenuSurface>
      )}
      {/* The empty canvas (D21): a new window, there. */}
      {canvasMenu !== null && (
        <ContextMenuSurface x={canvasMenu.x} y={canvasMenu.y} onClose={() => setCanvasMenu(null)}>
          <MenuItem label="New window" onSelect={() => newWindowAt(canvasMenu.world)} />
        </ContextMenuSurface>
      )}
      {/* An empty frame's vault chip (D22): the recent vaults; a pick switches that window to it. */}
      {chipMenu !== null && (
        <ContextMenuSurface x={chipMenu.x} y={chipMenu.y} onClose={() => setChipMenu(null)}>
          {storage.getRecentRoots().map((recent) => (
            <MenuItem
              key={recent.path}
              label={storage.vaultName(recent.path)}
              onSelect={() => {
                const win = chipMenu.win
                setChipMenu(null)
                api.window.setRoots(win, [recent.path]).catch(() => onNotice?.("Can't switch that window's vault: it has tabs now"))
              }}
            />
          ))}
        </ContextMenuSurface>
      )}
      {/* "Open tabs here…" (D22): the app's search, for one window. */}
      {searchFor !== null && (
        <TabSearchPanel
          key={searchFor}
          roots={byWin.get(searchFor)?.roots ?? roots}
          label={byWin.get(searchFor)?.label ?? 'the new window'}
          at={searchAt(searchFor)}
          watchOf={watchOf}
          onPick={(path) => openTabIn(searchFor, path)}
          onClose={() => {
            setSearchFor(null)
            inputRef.current?.focus()
          }}
        />
      )}
    </div>
  )
}

/**
 * A close of the pick bar (D27): the first click arms it — red, IN PLACE: it keeps its own label, so no button of the
 * bar moves (YAZ-3374), and "Click again to close N" stands in a hint above it — and the second closes. The pointer
 * leaving it puts it back.
 */
function PickClose({ arm, armed, setArmed, label, armedLabel, onClose }: { arm: string; armed: string | null; setArmed: (next: string | null) => void; label: string; armedLabel: string; onClose: () => void }) {
  const on = armed === arm
  return (
    <button
      type="button"
      className={on ? 'taboverview__armed' : undefined}
      aria-label={on ? armedLabel : undefined}
      onMouseLeave={() => on && setArmed(null)}
      onClick={() => {
        if (!on) return setArmed(arm)
        setArmed(null)
        onClose()
      }}
    >
      <span className="taboverview__pick-label">{label}</span>
      {on && (
        <span className="taboverview__pick-hint" aria-hidden>
          {armedLabel}
        </span>
      )}
    </button>
  )
}

function MenuItem({ label, onSelect, danger = false, onHover }: { label: string; onSelect: () => void; danger?: boolean; onHover?: () => void }) {
  return (
    <button type="button" className={`ctx-menu__item${danger ? ' taboverview__armed' : ''}`} role="menuitem" onClick={onSelect} onMouseEnter={onHover}>
      {label}
    </button>
  )
}
