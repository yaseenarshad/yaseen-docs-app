/**
 * THE BOARD WINDOW (YAZ-4824; D2, D9, D10, D11, D12, D13, items 4, 6, 7, 10, 12, 13, 17, 20, 22, 24): a window into a
 * drawing or a diagram, in a page. A host (`types.ts`) gives it a board, the options its text holds and its doors; the
 * window shows the board's ONE picture (`boardPictures.ts`) and handles every gesture. It knows nothing of ProseMirror.
 * This module is the lazy chunk `loadBoardWindow()` imports; nothing loads it at startup.
 *
 * THE PICTURE: an `<img>` of the board's SVG at its board size, moved by `transform: translate() scale()` — one write
 * per animation frame, and `will-change: transform` only while a gesture runs, so it redraws sharp after.
 * `view` is the board point at the window's top-left and the zoom: `screen = (board − view) × zoom`. No view → fit,
 * with 10 px around. Zoom 0.1 to 30, the tab's.
 *
 * GESTURES (D10, as the tab's view mode): the wheel pans (`delta / zoom`); ⌘ or ctrl + wheel, and a pinch, zoom at the
 * pointer by `exp(−deltaY × 0.01)` (the engine's `getWheelZoom`); a drag pans. While selected: ⌘+ ⌘− (× 1.1, the
 * engine's step), ⌘0 (100%), Shift+1 (fit), Escape (deselect, item 20). Only those keys stop; ⌘+ elsewhere stays the
 * page's zoom.
 *
 * STATES (D9): Live — the wheel moves it, except for 300 ms after a page scroll (the scroll guard); Resting — after
 * `embedRestSeconds` with no gesture (read live; 0 = never) the wheel scrolls the page, a hover says "Click to move",
 * a click wakes it, and nothing is written; Locked — nothing moves it, the lock button or the menu unlocks it, saved
 * as `locked`. A new embed is written `|locked` (YAZ-2571 round 7); an embed with no options is an old one, unlocked.
 * In a read-only host (a Read only page or vault, Explore's reading layer) every window starts locked, whatever the
 * text saved; an unlock there is this view's only and is never written, and an editable host again gets the saved lock.
 * View full size is never locked so: it is there to look around in.
 *
 * WRITES (D4, item 18): 800 ms after the last wheel or drag, the rounded view goes to `onOptions` — only when it moved
 * enough (`movedEnough`) and the host is editable. A view moved in a read-only host is never written, not even when the
 * page turns editable before that write (YAZ-4942). A resize, a lock, a page and a fit write at once. While a gesture
 * runs or a write waits, `update({ options })` is kept, not applied (item 17); it applies once nothing was written,
 * and a write supersedes it (the host's echo of that write follows).
 *
 * SHARED, BOUNDED: one IntersectionObserver per scroll root (a picture only within about a screen of view, D5), one
 * capture `scroll` listener (the guard), one theme observer and one settings subscription; all go with the last
 * window. Each window holds one rest timer, one refresh timer and one write timer at most, and `destroy()` ends them.
 */
import { formatEmbedOptions, movedEnough, roundView, type EmbedOptions, type EmbedView } from '@shared/embedOptions'
import type { WatchEvent } from '@shared/types'
import { holdFrames } from '../../lib/colResize'
import { storage } from '../../lib/storage'
import { setEmbedPictureSweep } from './pictureStats'
import { currentKey, dropPicturesExcept, loadPicture, peekPicture, watchBoard, type BoardBounds, type BoardPicture } from './boardPictures'
import { spotAt, type BoardLinkSpot } from './boardLinks'
import { firstWindowSize, MIN_WIDTH } from './hostWindow'
import type { BoardWindowHandle, BoardWindowHost, WindowMenuRow } from './types'
import './boardWindow.css'

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 30
/** The fit's margin, in screen px. */
export const FIT_PADDING = 10
/** The engine's wheel rate and its delta clamp (`getWheelZoom`). */
const WHEEL_ZOOM_RATE = 0.01
const WHEEL_ZOOM_MAX_DELTA = 10
/** ⌘+ / ⌘−: the engine's button step. */
const ZOOM_STEP = 1.1
export const WRITE_DELAY_MS = 800
export const SCROLL_GUARD_MS = 300
export const REFRESH_DELAY_MS = 300
/** A gesture's `will-change` stays this long after its last event. */
const MOVING_MS = 200
/** A mousedown that moves less than this is a click. */
const CLICK_SLOP_PX = 3
export const MIN_HEIGHT = 80
/** One screen above and below: a window this near gets its picture (D5). */
const NEAR_MARGIN = '100% 0px'

// ── The math ────────────────────────────────────────────────────────────────────────────────────────────────────

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

/** The view that shows all of `bounds` in a `width` × `height` window, centred, with `FIT_PADDING` around. */
export function fitView(bounds: BoardBounds, width: number, height: number): EmbedView {
  const zoom = clampZoom(Math.min((width - 2 * FIT_PADDING) / Math.max(1, bounds.width), (height - 2 * FIT_PADDING) / Math.max(1, bounds.height)))
  return { x: bounds.x + bounds.width / 2 - width / zoom / 2, y: bounds.y + bounds.height / 2 - height / zoom / 2, zoom }
}

/** `view` zoomed by `factor` at the window point (`px`, `py`): the board point under it stays under it. */
export function zoomAt(view: EmbedView, px: number, py: number, factor: number): EmbedView {
  const zoom = clampZoom(view.zoom * factor)
  const bx = view.x + px / view.zoom
  const by = view.y + py / view.zoom
  return { x: bx - px / zoom, y: by - py / zoom, zoom }
}

/** `view` panned by a screen distance: the board moves the other way. */
export function panBy(view: EmbedView, dx: number, dy: number): EmbedView {
  return { x: view.x + dx / view.zoom, y: view.y + dy / view.zoom, zoom: view.zoom }
}

/** A resize step (D11, item 10): free width and height; Shift on a corner keeps the start shape. */
export function resizeBy(start: { width: number; height: number }, dir: HandleDirection, dx: number, dy: number, keepShape: boolean, maxWidth: number): { width: number; height: number } {
  const sx = dir.includes('e') ? 1 : dir.includes('w') ? -1 : 0
  const sy = dir.includes('s') ? 1 : dir.includes('n') ? -1 : 0
  let width = start.width + sx * dx
  let height = start.height + sy * dy
  if (keepShape && sx !== 0 && sy !== 0) {
    const fw = width / start.width
    const fh = height / start.height
    const f = Math.abs(fw - 1) >= Math.abs(fh - 1) ? fw : fh
    const min = Math.max(MIN_WIDTH / start.width, MIN_HEIGHT / start.height)
    const g = Math.min(Math.max(f, min), Math.max(min, maxWidth / start.width))
    return { width: Math.round(start.width * g), height: Math.round(start.height * g) }
  }
  width = Math.min(Math.max(MIN_WIDTH, maxWidth), Math.max(MIN_WIDTH, width))
  height = Math.max(MIN_HEIGHT, height)
  return { width: Math.round(width), height: Math.round(height) }
}

export const HANDLE_DIRECTIONS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
export type HandleDirection = (typeof HANDLE_DIRECTIONS)[number]

// ── What every window shares ────────────────────────────────────────────────────────────────────────────────────

const mounted = new Set<BoardWindow>()
/** Each mounted window by its root element: the observers' lookup (A22). */
const byDom = new WeakMap<Element, BoardWindow>()
/**
 * One IntersectionObserver per scroll root (YAZ-4862; null = the viewport), with how many windows it watches: made
 * with its first window, ended with its last.
 */
const nearByRoot = new Map<Element | null, { io: IntersectionObserver; count: number }>()

/** `win` is watched by its root's observer (made now if it is the first). */
function observeNear(win: BoardWindow, root: Element | null): void {
  if (typeof IntersectionObserver === 'undefined') return
  let held = nearByRoot.get(root)
  if (held === undefined) {
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) byDom.get(entry.target)?.setNear(entry.isIntersecting)
    }, { root, rootMargin: NEAR_MARGIN })
    held = { io, count: 0 }
    nearByRoot.set(root, held)
  }
  held.count++
  held.io.observe(win.dom)
}

function unobserveNear(win: BoardWindow, root: Element | null): void {
  const held = nearByRoot.get(root)
  if (held === undefined) return
  held.io.unobserve(win.dom)
  if (--held.count > 0) return
  held.io.disconnect()
  nearByRoot.delete(root)
}
let lastScroll: { at: number; target: EventTarget | null } | null = null
let themeObserver: MutationObserver | null = null
let offSettings: (() => void) | null = null

const onScroll = (ev: Event): void => {
  lastScroll = { at: performance.now(), target: ev.target }
}

function share(win: BoardWindow): void {
  mounted.add(win)
  byDom.set(win.dom, win)
  if (mounted.size > 1) return
  document.addEventListener('scroll', onScroll, { capture: true, passive: true })
  if (typeof MutationObserver !== 'undefined') {
    themeObserver = new MutationObserver(() => mounted.forEach((w) => w.lookChanged()))
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  }
  offSettings = storage.subscribe(() => mounted.forEach((w) => w.lookChanged()))
}

function unshare(win: BoardWindow): void {
  byDom.delete(win.dom)
  if (!mounted.delete(win) || mounted.size > 0) return
  document.removeEventListener('scroll', onScroll, { capture: true })
  themeObserver?.disconnect()
  themeObserver = null
  offSettings?.()
  offSettings = null
  lastScroll = null
}

/**
 * A tab went to sleep (item 27, A5): its windows are destroyed, so each picture that no mounted window shows leaves
 * the cache now, not when 24 newer ones push it out. `useWorkspace`'s sleep asks for it (`sweepEmbedPicturesSoon`).
 */
export function sweepPictures(): void {
  const shown = new Set<string>()
  for (const w of mounted) {
    const key = w.pictureKey()
    if (key !== null) shown.add(key)
  }
  dropPicturesExcept(shown)
}
setEmbedPictureSweep(sweepPictures)

/** How many windows and shared listeners live now (a test of the bounds). */
export function sharedCounts(): { windows: number; observer: boolean } {
  return { windows: mounted.size, observer: nearByRoot.size > 0 }
}

// ── The icons ───────────────────────────────────────────────────────────────────────────────────────────────────

const SVG_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
const MOVE_ICON = `${SVG_OPEN}<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/></svg>`
const LOCK_ICON = `${SVG_OPEN}<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`
const FOLD_UP = `${SVG_OPEN}<path d="M6 15l6-6 6 6"/></svg>`
const FOLD_DOWN = `${SVG_OPEN}<path d="M6 9l6 6 6-6"/></svg>`
const DRAWING_ICON = `${SVG_OPEN}<path d="M3 21l3.5-1 11-11a2.1 2.1 0 0 0-3-3l-11 11z"/><path d="M14 6l3 3"/></svg>`
const DIAGRAM_ICON = `${SVG_OPEN}<rect x="3" y="3" width="7" height="6" rx="1"/><rect x="14" y="15" width="7" height="6" rx="1"/><path d="M6.5 9v4.5a1.5 1.5 0 0 0 1.5 1.5h6"/></svg>`

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, html?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = cls
  if (html !== undefined) node.innerHTML = html
  return node
}

function button(cls: string, label: string, html: string): HTMLButtonElement {
  const b = el('button', cls, html)
  b.type = 'button'
  b.tabIndex = -1
  b.setAttribute('aria-label', label)
  b.title = label
  return b
}

const sameOptions = (a: EmbedOptions | null, b: EmbedOptions | null): boolean => (a === null || b === null ? a === b : formatEmbedOptions(a) === formatEmbedOptions(b))

type Status = 'loading' | 'ready' | 'empty' | 'missing' | 'broken'

// ── The window ──────────────────────────────────────────────────────────────────────────────────────────────────

class BoardWindow implements BoardWindowHandle {
  readonly dom: HTMLDivElement
  private host: BoardWindowHost
  private readonly stage: HTMLDivElement
  private readonly img: HTMLImageElement
  private readonly message: HTMLDivElement
  private readonly lockButton: HTMLButtonElement
  private readonly foldButton: HTMLButtonElement
  private readonly pill: HTMLButtonElement
  private readonly zoomButton: HTMLButtonElement
  private readonly line: HTMLDivElement
  private readonly restPage: HTMLDivElement
  private readonly handles: HTMLSpanElement[]

  private status: Status = 'loading'
  private picture: BoardPicture | null = null
  private loading = false
  private stale = false
  private lastChange = 0
  private isNear = typeof IntersectionObserver === 'undefined'
  private folded = false
  private selected = false
  private destroyed = false

  /** The size shown; from the options, else the new-window size. */
  private width: number
  private height: number
  private view: EmbedView | null = null
  /** True while the view is the fit (written as no view). */
  private fitted = true
  private locked: boolean
  private page: string | null
  private resting = false

  /** What the text holds as last known: written by us, or brought by `update`. */
  private lastWritten: EmbedOptions | null
  /** An `update({ options })` that came while a gesture ran or a write waited (item 17). */
  private pendingOptions: { value: EmbedOptions | null } | null = null
  private gesture = false
  /** The view was last moved in a read-only host (YAZ-4942): it is this view's only and is never written, also when the page turns editable before its write. */
  private viewReadOnly = false

  private restTimer: ReturnType<typeof setTimeout> | undefined
  private writeTimer: ReturnType<typeof setTimeout> | undefined
  private refreshTimer: ReturnType<typeof setTimeout> | undefined
  private movingTimer: ReturnType<typeof setTimeout> | undefined
  private frame = 0
  private unwatch: (() => void) | null = null
  private endDrag: (() => void) | null = null
  private overlay: { close: () => void } | null = null
  /** Fill (YAZ-4943/4944): the layer's box changed size (a resize, a Tile); a view still fitted fits again. */
  private resized: ResizeObserver | null = null
  /** The scroll root whose observer watches this window (YAZ-4862), fixed at the mount. */
  private readonly nearRoot: Element | null
  /** The zoom label's percent as written (A23): a pan frame writes it only when it changes. */
  private zoomLabel = -1

  /** `full`: the window of View full size, which has the focus itself (A3); a page's window never takes it. */
  constructor(
    host: BoardWindowHost,
    private readonly full = false,
  ) {
    this.host = host
    this.nearRoot = host.scrollRoot ?? null
    const o = host.options
    // No page jump (item 12, A6): a board another window already drew gives its shape at once.
    const size = firstWindowSize(o, o !== null && o.height !== null ? null : (this.cachedPicture(o?.page ?? null)?.bounds ?? null), host.columnWidth())
    this.width = size.width
    this.height = size.height
    this.locked = (o?.locked ?? false) || this.readOnlyLock()
    this.page = o?.page ?? null
    this.lastWritten = o
    if (o?.view != null) {
      this.view = o.view
      this.fitted = false
    }

    this.dom = el('div', `board-window board-window--loading${full ? ' board-window--full' : ''}${host.fill === true ? ' board-window--fill' : ''}`)
    this.dom.setAttribute('contenteditable', 'false')
    this.dom.tabIndex = -1
    this.dom.dataset.kind = host.ref.kind
    this.stage = el('div', 'board-window__stage')
    this.img = el('img', 'board-window__img')
    this.img.alt = ''
    this.img.draggable = false
    this.img.decoding = 'async'
    this.message = el('div', 'board-window__message')
    this.stage.append(this.img, this.message)
    this.lockButton = button('board-window__lock', 'Lock view', MOVE_ICON)
    this.foldButton = button('board-window__fold', 'Collapse embed', FOLD_UP)
    this.pill = button('board-window__pill', 'Open', '')
    this.zoomButton = button('board-window__zoom', 'Fit', '')
    this.restPage = el('div', 'board-window__rest')
    this.restPage.textContent = 'Click to move'
    this.line = el('div', 'board-window__line')
    this.handles = HANDLE_DIRECTIONS.map((dir) => {
      const handle = el('span', `board-window__handle board-window__handle--${dir}`)
      handle.dataset.handle = dir
      handle.addEventListener('mousedown', (e) => this.startResize(e, dir))
      return handle
    })
    this.dom.append(...this.parts())

    this.dom.addEventListener('wheel', this.onWheel, { passive: false })
    this.dom.addEventListener('mousedown', this.onMouseDown)
    this.dom.addEventListener('dblclick', this.onDoubleClick)
    this.dom.addEventListener('keydown', this.onKey)
    this.dom.addEventListener('contextmenu', this.onContextMenu)
    this.dom.addEventListener('pointerenter', this.onPointerEnter)
    if (host.fill === true) {
      this.dom.addEventListener('mousemove', this.onHover)
      if (typeof ResizeObserver !== 'undefined') {
        this.resized = new ResizeObserver(() => {
          if (!this.fitted || this.picture?.bounds == null) return
          this.view = this.fitNow()
          this.paint()
        })
        this.resized.observe(this.dom)
      }
    }
    this.lockButton.addEventListener('click', (e) => {
      e.stopPropagation()
      this.setLocked(!this.locked)
    })
    this.foldButton.addEventListener('click', (e) => {
      e.stopPropagation()
      this.host.onFold?.()
    })
    this.pill.addEventListener('click', (e) => {
      e.stopPropagation()
      this.host.onOpen?.(e.metaKey || e.ctrlKey ? 'backgroundTab' : 'thisTab')
    })
    this.zoomButton.addEventListener('click', (e) => {
      e.stopPropagation()
      this.wake()
      this.fit()
    })
    for (const b of [this.lockButton, this.foldButton, this.pill, this.zoomButton]) b.addEventListener('mousedown', (e) => e.stopPropagation())

    this.renderRef()
    this.renderSize()
    this.renderLock()
    this.renderEditable()
    share(this)
    observeNear(this, this.nearRoot)
    this.watch()
    this.armRest()
    this.ensurePicture()
  }

  /** The settled picture of this board in the cache now, with no request; undefined before its first ask. */
  private cachedPicture(page: string | null): BoardPicture | undefined {
    const { root, path } = this.host.ref
    const key = root === null || path === null ? null : currentKey({ root, path }, page)
    return key === null ? undefined : peekPicture(key)
  }

  /** The key of the picture this window shows, or null (the sweep keeps it, A5). */
  pictureKey(): string | null {
    return this.picture !== null && this.picture.url !== '' ? this.picture.key : null
  }

  /** The open window's children, in order. */
  private parts(): HTMLElement[] {
    return [this.stage, this.restPage, this.lockButton, this.foldButton, this.pill, this.zoomButton, ...this.handles]
  }

  // ── Picture ──

  private watch(): void {
    this.unwatch?.()
    this.unwatch = null
    const { root, path, kind, name } = this.host.ref
    if (root === null) return
    this.unwatch = watchBoard(root, path, `${name}.${kind === 'diagram' ? 'drawio' : 'excalidraw'}`, this.onBoardEvent)
  }

  private readonly onBoardEvent = (ev: WatchEvent): void => {
    if (this.host.ref.path === null && ev.type === 'add') {
      // A missing board's file came back under its name: show it (the host's next `update({ ref })` confirms it).
      this.host = { ...this.host, ref: { ...this.host.ref, path: ev.path } }
      this.watch()
    }
    this.markStale()
  }

  /** The file changed: redraw 300 ms after the last change if near the screen, else when it comes near (D5). */
  private markStale(): void {
    this.stale = true
    this.lastChange = performance.now()
    if (this.isNear) this.scheduleRefresh(REFRESH_DELAY_MS)
  }

  private scheduleRefresh(delay: number): void {
    clearTimeout(this.refreshTimer)
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined
      this.ensurePicture()
    }, Math.max(0, delay))
  }

  setNear(on: boolean): void {
    if (this.isNear === on) return
    this.isNear = on
    if (!on) return
    if (this.stale) this.scheduleRefresh(this.lastChange + REFRESH_DELAY_MS - performance.now())
    // The picture left the cache while off screen (its blob URL is revoked): ask again.
    else if (this.picture === null || (this.picture.url !== '' && peekPicture(this.picture.key) === undefined)) this.ensurePicture()
  }

  /** The theme or a setting changed (item 13): a new key draws a new picture; an off-screen window waits. */
  lookChanged(): void {
    if (this.picture === null || this.folded) return
    const ref = this.host.ref
    if (ref.root === null || ref.path === null) return
    if (currentKey({ root: ref.root, path: ref.path }, this.page) === this.picture.key) return
    if (this.isNear) this.ensurePicture()
    else this.stale = true
  }

  private readonly onPointerEnter = (): void => {
    // The settings of THIS window wake no listener (`storage.setSettings`): a hover checks the key, a string compare.
    this.lookChanged()
  }

  private ensurePicture(): void {
    if (this.destroyed || this.folded || !this.isNear || this.loading) return
    const { root, path } = this.host.ref
    if (root === null || path === null) {
      this.setStatus('missing')
      return
    }
    const key = currentKey({ root, path }, this.page)
    if (!this.stale && key !== null && this.picture?.key === key && peekPicture(key) !== undefined) return
    this.stale = false
    this.loading = true
    const ref = { root, path }
    const page = this.page
    void loadPicture(ref, page).then((picture) => {
      this.loading = false
      if (this.destroyed || this.folded) return
      const now = this.host.ref
      // The board or the page changed while it drew: draw again for the new one.
      if (now.root !== ref.root || now.path !== ref.path || this.page !== page || this.stale) {
        this.ensurePicture()
        return
      }
      // A4: a file that is not there is "Missing"; one that would not read or draw is "Can't show".
      if (picture === 'missing' || picture === 'broken') {
        this.picture = null
        this.setStatus(picture)
        return
      }
      this.show(picture)
    })
  }

  private show(picture: BoardPicture): void {
    const first = this.picture === null
    this.picture = picture
    this.host.onPages?.(picture.pages, picture.page)
    if (picture.url === '' || picture.bounds === null) {
      this.img.removeAttribute('src')
      this.setStatus('empty')
      return
    }
    if (this.img.getAttribute('src') !== picture.url) this.img.src = picture.url
    this.img.style.width = `${picture.bounds.width}px`
    this.img.style.height = `${picture.bounds.height}px`
    // A window with no height of its own takes the board's shape (D11, A6, A7), once, before anything moved.
    if (first && (this.host.options?.height ?? null) === null && this.fitted && this.host.fill !== true) {
      const size = firstWindowSize(this.host.options, picture.bounds, this.host.columnWidth())
      this.width = size.width
      this.height = size.height
      this.renderSize()
    }
    if (this.fitted || this.view === null) this.view = this.fitNow()
    this.setStatus('ready')
    this.paint()
  }

  private releasePicture(): void {
    this.picture = null
    this.img.removeAttribute('src')
  }

  private setStatus(status: Status): void {
    this.dom.classList.remove(`board-window--${this.status}`)
    this.status = status
    this.dom.classList.add(`board-window--${status}`)
    const word = this.host.ref.kind === 'diagram' ? 'diagram' : 'drawing'
    const name = this.host.ref.name
    this.message.textContent = status === 'missing' ? `Missing ${word}: ${name}` : status === 'broken' ? `Can't show ${word}: ${name}` : status === 'empty' ? `Empty ${word}` : ''
  }

  // ── View ──

  private boxSize(): { width: number; height: number } {
    return { width: this.dom.clientWidth || this.width, height: this.dom.clientHeight || this.height }
  }

  private fitNow(): EmbedView | null {
    const bounds = this.picture?.bounds
    if (bounds == null) return null
    const { width, height } = this.boxSize()
    return fitView(bounds, width, height)
  }

  /** One transform write per frame. */
  private paint(): void {
    if (this.frame !== 0) return
    const run = () => {
      this.frame = 0
      const view = this.view
      if (view === null || this.picture?.bounds == null) return
      const b = this.picture.bounds
      this.img.style.transform = `translate(${(b.x - view.x) * view.zoom}px, ${(b.y - view.y) * view.zoom}px) scale(${view.zoom})`
      const percent = Math.round(view.zoom * 100)
      if (percent !== this.zoomLabel) {
        this.zoomLabel = percent
        this.zoomButton.textContent = `${percent}%`
      }
    }
    if (typeof requestAnimationFrame === 'function') this.frame = requestAnimationFrame(run)
    else run()
  }

  private moved(next: EmbedView): void {
    this.view = next
    this.fitted = false
    this.viewReadOnly = !this.host.editable
    this.paint()
  }

  /** A gesture's mark: `will-change` on, the rest clock restarts, the write waits. */
  private touch(): void {
    this.gesture = true
    this.dom.classList.add('board-window--moving')
    clearTimeout(this.movingTimer)
    this.movingTimer = setTimeout(() => this.dom.classList.remove('board-window--moving'), MOVING_MS)
    this.armRest()
  }

  fit(): void {
    const view = this.fitNow()
    if (view === null) return
    this.view = view
    this.fitted = true
    this.viewReadOnly = !this.host.editable
    this.paint()
    this.writeNow()
  }

  private fitRect(rect: BoardBounds): void {
    const { width, height } = this.boxSize()
    this.moved(fitView(rect, width, height))
    this.writeNow()
  }

  private zoomAtCenter(factor: number | 'one'): void {
    if (this.view === null) return
    const { width, height } = this.boxSize()
    const f = factor === 'one' ? 1 / this.view.zoom : factor
    this.moved(zoomAt(this.view, width / 2, height / 2, f))
    this.scheduleWrite()
  }

  // ── States ──

  /** May a wheel or a drag move it now? */
  private live(): boolean {
    return this.status === 'ready' && !this.folded && !this.locked && !this.resting && this.view !== null
  }

  private armRest(): void {
    clearTimeout(this.restTimer)
    this.restTimer = undefined
    const seconds = storage.getSettings().embedRestSeconds
    if (!seconds || this.destroyed || this.host.fill === true) return
    this.restTimer = setTimeout(() => {
      this.restTimer = undefined
      this.resting = true
      this.dom.classList.add('board-window--resting')
    }, seconds * 1000)
  }

  private wake(): void {
    if (this.resting) {
      this.resting = false
      this.dom.classList.remove('board-window--resting')
    }
    this.armRest()
  }

  private setLocked(on: boolean): void {
    this.locked = on
    this.renderLock()
    this.writeNow()
  }

  showPage(id: string): void {
    this.setPage(id)
  }

  private setPage(page: string): void {
    if (page === this.page) return
    this.page = page
    this.fitted = true
    this.view = null
    this.picture = null
    this.writeNow()
    this.ensurePicture()
  }

  // ── Writes ──

  private nextOptions(): EmbedOptions {
    const base = this.lastWritten ?? this.host.options
    // A view moved in a read-only host stays out of the text (YAZ-4942): a later write (a lock, a resize) keeps the saved one.
    const view = this.viewReadOnly ? (base?.view ?? null) : this.fitted || this.view === null ? null : roundView(this.view)
    return { width: this.width, height: this.height, view, locked: this.locked, page: this.page, rest: base?.rest ?? [] }
  }

  private scheduleWrite(): void {
    clearTimeout(this.writeTimer)
    this.writeTimer = setTimeout(() => {
      this.writeTimer = undefined
      this.writeNow(true)
    }, WRITE_DELAY_MS)
  }

  /**
   * The write (D4): only an editable host, only a change worth it; then any update kept meanwhile settles. `waited`: the
   * write of a view move (after its 800 ms, or flushed), which a move made in a read-only host never makes (YAZ-4942).
   */
  private writeNow(waited = false): void {
    clearTimeout(this.writeTimer)
    this.writeTimer = undefined
    this.gesture = false
    const next = this.nextOptions()
    let wrote = false
    if (this.host.editable && !(waited && this.viewReadOnly) && this.host.onOptions !== undefined && movedEnough(this.lastWritten, next)) {
      this.lastWritten = next
      this.host.onOptions(next)
      wrote = true
    }
    const pending = this.pendingOptions
    this.pendingOptions = null
    // Our write supersedes what came meanwhile: the host's echo of it follows.
    if (pending !== null && !wrote) this.applyOptions(pending.value)
  }

  private busy(): boolean {
    return this.gesture || this.writeTimer !== undefined || this.endDrag !== null
  }

  private applyOptions(options: EmbedOptions | null): void {
    if (sameOptions(options, this.lastWritten)) return
    this.lastWritten = options
    const size = firstWindowSize(options, this.picture?.bounds ?? null, this.host.columnWidth())
    this.width = size.width
    this.height = size.height
    this.renderSize()
    // A read-only host keeps the view's own lock (YAZ-2571 round 7): the text's lock is for an editable page.
    if (!this.readOnlyLock() && this.locked !== (options?.locked ?? false)) {
      this.locked = options?.locked ?? false
      this.renderLock()
    }
    const page = options?.page ?? null
    if (options?.view != null) {
      this.view = options.view
      this.fitted = false
    } else {
      this.fitted = true
      this.view = this.fitNow()
    }
    this.viewReadOnly = false
    if (page !== this.page) {
      this.page = page
      this.picture = null
      this.ensurePicture()
    }
    this.paint()
  }

  // ── Events ──

  private readonly onWheel = (e: WheelEvent): void => {
    if (!this.live()) return // resting, locked, folded or not drawn: the page scrolls
    const s = lastScroll
    if (s !== null && performance.now() - s.at < SCROLL_GUARD_MS && (s.target === document || (s.target instanceof Node && s.target.contains(this.dom)))) return
    e.preventDefault()
    e.stopPropagation()
    const view = this.view!
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.boxSize().height : 1
    if (e.ctrlKey || e.metaKey) {
      const rect = this.dom.getBoundingClientRect()
      const dy = Math.min(WHEEL_ZOOM_MAX_DELTA, Math.max(-WHEEL_ZOOM_MAX_DELTA, e.deltaY * unit))
      this.moved(zoomAt(view, e.clientX - rect.left, e.clientY - rect.top, Math.exp(-WHEEL_ZOOM_RATE * dy)))
    } else {
      this.moved(panBy(view, e.deltaX * unit, e.deltaY * unit))
    }
    this.touch()
    this.scheduleWrite()
  }

  private readonly onMouseDown = (e: MouseEvent): void => {
    if (e.button !== 0 || this.folded) return
    if (e.target instanceof Element && e.target.closest('.board-window__handle') !== null) return
    e.preventDefault()
    // In a page the EDITOR keeps the focus (A3): a pan must leave the caret and the keys where they were.
    if (this.full || this.host.fill === true) this.dom.focus({ preventScroll: true })
    const startX = e.clientX
    const startY = e.clientY
    const from = this.view
    let panning = false
    const wasResting = this.resting
    const onMove = (m: MouseEvent): void => {
      if (!panning) {
        if (Math.abs(m.clientX - startX) < CLICK_SLOP_PX && Math.abs(m.clientY - startY) < CLICK_SLOP_PX) return
        if (wasResting || !this.live() || from === null) return
        panning = true
        holdFrames(true)
        this.dom.classList.add('board-window--panning')
      }
      this.moved(panBy(from!, startX - m.clientX, startY - m.clientY))
      this.touch()
    }
    const end = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      window.removeEventListener('blur', onUp)
      this.endDrag = null
      if (panning) {
        holdFrames(false)
        this.dom.classList.remove('board-window--panning')
      }
    }
    const onUp = (): void => {
      end()
      if (panning) {
        this.scheduleWrite()
        return
      }
      // A click on a link (Explore's board layer, YAZ-4943): it opens.
      const spot = this.host.onLink === undefined ? null : this.spotUnder(startX, startY)
      if (spot !== null) {
        this.host.onLink!(spot, { metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey })
        return
      }
      // A click (D12): it wakes a resting window and selects the embed.
      this.wake()
      this.setSelected(true)
      this.host.onSelect?.()
    }
    this.endDrag = end
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    window.addEventListener('blur', onUp)
  }

  /** The link spot under a window point (client px), or null. */
  private spotUnder(clientX: number, clientY: number): BoardLinkSpot | null {
    const spots = this.picture?.links
    const view = this.view
    if (spots === undefined || spots.length === 0 || view === null || this.status !== 'ready') return null
    const rect = this.dom.getBoundingClientRect()
    return spotAt(spots, view.x + (clientX - rect.left) / view.zoom, view.y + (clientY - rect.top) / view.zoom)
  }

  /** The hand over a link (fill): one hit test per move, over this board's spots only. */
  private readonly onHover = (e: MouseEvent): void => {
    if (this.endDrag !== null) return
    this.dom.classList.toggle('board-window--on-link', this.spotUnder(e.clientX, e.clientY) !== null)
  }

  private readonly onDoubleClick = (e: MouseEvent): void => {
    if (e.target instanceof Element && e.target.closest('button, .board-window__handle') !== null) return
    e.preventDefault()
    this.host.onOpen?.(e.metaKey || e.ctrlKey ? 'backgroundTab' : 'thisTab')
  }

  /** A28: a right-click selects this window first (the host puts the selection on its embed), so the menu is its. */
  private readonly onContextMenu = (e: MouseEvent): void => {
    if (this.host.onContextMenu === undefined) return
    e.preventDefault()
    if (!this.selected) {
      this.setSelected(true)
      this.host.onSelect?.()
    }
    this.host.onContextMenu(e)
  }

  /**
   * The window's own keys (D10): ⌘+ ⌘− ⌘0 and Shift+1. In a page the EDITOR keeps the focus (typing over a selected
   * embed replaces it, item 21), so the host hands each key here while the embed is selected; the full-size overlay's
   * window, which has the focus, reaches it through `onKey`. True when the key was the window's.
   */
  handleKey(e: KeyboardEvent): boolean {
    if (this.locked || this.status !== 'ready' || this.folded) return false
    const mod = e.metaKey || e.ctrlKey
    if (mod && (e.key === '=' || e.key === '+')) this.zoomAtCenter(ZOOM_STEP)
    else if (mod && (e.key === '-' || e.key === '_')) this.zoomAtCenter(1 / ZOOM_STEP)
    else if (mod && e.key === '0') this.zoomAtCenter('one')
    else if (e.shiftKey && !mod && (e.code === 'Digit1' || e.key === '!')) this.fit()
    else return false
    e.preventDefault()
    e.stopPropagation()
    this.wake()
    return true
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (!this.selected || e.key === 'Escape') return
    this.handleKey(e)
  }

  // ── Resize ──

  private startResize(e: MouseEvent, dir: HandleDirection): void {
    if (e.button !== 0 || !this.host.editable || this.folded) return
    e.preventDefault()
    e.stopPropagation()
    const start = { width: this.width, height: this.height }
    const startX = e.clientX
    const startY = e.clientY
    const max = Math.max(MIN_WIDTH, this.host.columnWidth())
    this.dom.classList.add('board-window--resizing')
    const end = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', onUp)
      holdFrames(false)
      this.dom.classList.remove('board-window--resizing')
      this.endDrag = null
    }
    const onMove = (m: MouseEvent): void => {
      const size = resizeBy(start, dir, m.clientX - startX, m.clientY - startY, m.shiftKey, max)
      this.width = size.width
      this.height = size.height
      this.renderSize()
    }
    const onUp = (): void => {
      end()
      if (this.width === start.width && this.height === start.height) return
      // D11: the view's top-left and zoom stay; the box only shows more or less of the board.
      if (this.fitted && this.view !== null) this.fitted = false
      this.writeNow()
    }
    const onKey = (k: KeyboardEvent): void => {
      if (k.key !== 'Escape') return
      k.preventDefault()
      k.stopPropagation()
      end()
      this.width = start.width
      this.height = start.height
      this.renderSize()
    }
    this.endDrag = end
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', onUp)
    holdFrames(true)
  }

  // ── Render ──

  private renderSize(): void {
    if (this.folded || this.host.fill === true) {
      this.dom.style.removeProperty('width')
      this.dom.style.removeProperty('height')
      return
    }
    this.dom.style.width = `${this.width}px`
    this.dom.style.height = `${this.height}px`
  }

  private renderLock(): void {
    this.dom.classList.toggle('board-window--locked', this.locked)
    this.lockButton.innerHTML = this.locked ? LOCK_ICON : MOVE_ICON
    const label = this.locked ? 'Unlock view' : 'Lock view'
    this.lockButton.setAttribute('aria-label', label)
    this.lockButton.title = label
    this.lockButton.setAttribute('aria-pressed', String(this.locked))
  }

  /** A read-only host's window starts locked (YAZ-2571 round 7); View full size never does. */
  private readOnlyLock(): boolean {
    return !this.host.editable && !this.full && this.host.fill !== true
  }

  private renderEditable(): void {
    this.dom.classList.toggle('board-window--readonly', !this.host.editable)
  }

  /** The name pill (item 6) and the folded line (D13): the icon, the name, the vault in grey. */
  private nameParts(): Node[] {
    const { ref } = this.host
    const icon = el('span', 'board-window__icon')
    if (ref.icon === undefined) icon.innerHTML = ref.kind === 'diagram' ? DIAGRAM_ICON : DRAWING_ICON
    else {
      for (const [name, value] of Object.entries(ref.icon)) icon.setAttribute(name, value)
      icon.className = `board-window__icon ${ref.icon.class ?? ''}`.trim()
    }
    const name = el('span', 'board-window__name')
    name.textContent = ref.name
    const parts: Node[] = [icon, name]
    if (ref.vault !== null) {
      const vault = el('span', 'board-window__vault')
      vault.textContent = `(${ref.vault})`
      parts.push(vault)
    }
    return parts
  }

  private renderRef(): void {
    this.dom.dataset.kind = this.host.ref.kind
    this.pill.replaceChildren(...this.nameParts())
    this.pill.title = `Open ${this.host.ref.name} (⌘-click: new tab)`
    if (this.folded) this.renderLine()
  }

  private renderLine(): void {
    const arrow = button('board-window__unfold', 'Expand embed', FOLD_DOWN)
    arrow.addEventListener('mousedown', (e) => e.stopPropagation())
    arrow.addEventListener('click', (e) => {
      e.stopPropagation()
      this.host.onFold?.()
    })
    this.line.replaceChildren(arrow, ...this.nameParts())
  }

  // ── The handle ──

  update(next: Partial<Omit<BoardWindowHost, 'columnWidth'>>): void {
    if (this.destroyed) return
    const prev = this.host
    const { options, ...rest } = next
    this.host = { ...this.host, ...rest }
    const r = next.ref
    if (r !== undefined && (r.root !== prev.ref.root || r.path !== prev.ref.path || r.kind !== prev.ref.kind)) {
      this.picture = null
      this.stale = true
      this.watch()
      this.setStatus('loading')
      this.ensurePicture()
    }
    if (r !== undefined) this.renderRef()
    if (next.editable !== undefined) this.renderEditable()
    if (next.editable !== undefined && next.editable !== prev.editable && !this.full) {
      // Read only: locked; editable again: the saved lock (YAZ-2571 round 7). Nothing is written.
      const locked = this.readOnlyLock() || (this.lastWritten?.locked ?? false)
      if (locked !== this.locked) {
        this.locked = locked
        this.renderLock()
      }
    }
    if (options !== undefined) {
      this.host = { ...this.host, options }
      if (this.busy()) this.pendingOptions = { value: options }
      else this.applyOptions(options)
    }
  }

  setSelected(on: boolean): void {
    this.selected = on
    this.dom.classList.toggle('is-selected', on)
  }

  setFolded(on: boolean): void {
    if (this.folded === on) return
    this.folded = on
    this.dom.classList.toggle('board-window--folded', on)
    if (on) {
      this.endDrag?.()
      this.releasePicture()
      this.renderLine()
      this.dom.replaceChildren(this.line)
    } else {
      this.dom.replaceChildren(...this.parts())
      this.setStatus('loading')
      this.ensurePicture()
    }
    this.renderSize()
  }

  setFoldable(on: boolean): void {
    this.dom.classList.toggle('board-window--foldable', on && this.host.onFold !== undefined)
  }

  menuRows(): WindowMenuRow[] {
    const word = this.host.ref.kind === 'diagram' ? 'diagram' : 'drawing'
    const rows: WindowMenuRow[] = [
      { label: `Fit whole ${word}`, run: () => this.fit(), disabled: this.status !== 'ready' },
      { label: this.locked ? 'Unlock view' : 'Lock view', run: () => this.setLocked(!this.locked) },
    ]
    const pages = this.picture?.pages ?? []
    if (this.host.ref.kind === 'diagram' && pages.length >= 2) {
      const current = this.picture?.page ?? pages[0].id
      rows.push({ label: 'Page', run: () => undefined, children: pages.map((p) => ({ label: p.name, checked: p.id === current, run: () => this.setPage(p.id) })) })
    }
    const frames = this.picture?.frames ?? []
    if (this.host.ref.kind === 'drawing' && frames.length > 0) {
      rows.push({ label: 'Frame', run: () => undefined, children: frames.map((f) => ({ label: f.name, run: () => this.fitRect(f) })) })
    }
    rows.push({ label: 'View full size', run: () => this.openFullSize(), disabled: this.status !== 'ready' })
    return rows
  }

  /** The board rectangle the window shows now. */
  private shownRect(): BoardBounds | null {
    const view = this.view
    if (view === null) return null
    const { width, height } = this.boxSize()
    return { x: view.x, y: view.y, width: width / view.zoom, height: height / view.zoom }
  }

  /** View full size (item 4): a second window of the same board over the whole page; Esc, the backdrop or ✕ close it. */
  private openFullSize(): void {
    if (this.overlay !== null) return
    const opener = document.activeElement
    const backdrop = el('div', 'board-window-overlay')
    backdrop.tabIndex = -1
    backdrop.setAttribute('role', 'dialog')
    backdrop.setAttribute('aria-modal', 'true')
    backdrop.setAttribute('aria-label', this.host.ref.name)
    const close = button('board-window-overlay__close', 'Close', '✕')
    close.tabIndex = 0
    const width = Math.max(MIN_WIDTH, Math.round(window.innerWidth * 0.92))
    const height = Math.max(MIN_HEIGHT, Math.round(window.innerHeight * 0.88))
    const rect = this.shownRect()
    const inner = new BoardWindow(
      {
        ref: this.host.ref,
        options: { width, height, view: rect === null ? null : fitView(rect, width, height), locked: false, page: this.page, rest: [] },
        editable: false,
        columnWidth: () => width,
        onOpen: this.host.onOpen,
      },
      true,
    )
    backdrop.append(inner.dom, close)
    const done = (): void => {
      if (this.overlay === null) return
      this.overlay = null
      inner.destroy()
      backdrop.remove()
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true })
    }
    backdrop.addEventListener('mousedown', (e) => {
      if (e.target === backdrop) done()
    })
    close.addEventListener('click', done)
    // Captured: the inner window's own Escape (deselect) must not take the key that closes the overlay.
    backdrop.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Escape') return
        e.preventDefault()
        e.stopPropagation()
        done()
      },
      true,
    )
    this.overlay = { close: done }
    document.body.appendChild(backdrop)
    inner.setNear(true)
    inner.setSelected(true)
    // The overlay's window has the focus itself (no editor around it): its keys reach `onKey`.
    inner.dom.focus({ preventScroll: true })
  }

  /** A8: a view still waiting for its 800 ms write is written now (the page is about to save, or to go). */
  flush(): void {
    if (this.writeTimer !== undefined) this.writeNow(true)
  }

  destroy(): void {
    if (this.destroyed) return
    this.overlay?.close()
    this.endDrag?.()
    this.resized?.disconnect()
    this.resized = null
    this.destroyed = true
    clearTimeout(this.restTimer)
    clearTimeout(this.writeTimer)
    clearTimeout(this.refreshTimer)
    clearTimeout(this.movingTimer)
    if (this.frame !== 0 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.frame)
    this.frame = 0
    unobserveNear(this, this.nearRoot)
    this.unwatch?.()
    this.unwatch = null
    this.releasePicture()
    unshare(this)
  }
}

export function mountBoardWindow(host: BoardWindowHost): BoardWindowHandle {
  return new BoardWindow(host)
}
