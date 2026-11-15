import { openOverlay } from '../app/browserHistory'
import { edgeBackOn, swipeIsOurs } from '../app/edgeSwipe'
import { browserFacts, whereAmI } from '../pwa/homeScreen'
import { pinchZoom, type ZoomRange } from '../drawing/pinchZoom'

/**
 * A TABLE, FULL SCREEN (YAZ-5471): the ⤢ under a wide table opens it here, in a chunk of its own. The whole table, every
 * column at its widest (`tables.css`), first fitted to the screen's width (not smaller than `READ_MIN`, so its words
 * stay readable; pinch out to see it all); pinch (or double-tap) to zoom, drag to move. It turns with the phone: the
 * fit is counted again. ✕, Escape or a swipe down from the top closes it. It shows a copy of the table: nothing is saved.
 *
 * YAZ-5480: the frozen rows (the file's, else the header row) stay at the top of the view and the frozen columns at its
 * left, as in the page. The table is scaled, so `position: sticky` would put them at the wrong place: each frozen cell
 * moves by the pane's own scroll, on a scroll-driven animation (`tables.css`), whose ranges this file sets for the scale
 * (`pinRanges`), when the scale changes, never on a scroll. Without scroll-driven animations, a scroll listener moves
 * them, once a frame, with `transform` and `translate` only.
 */

/** The table's frozen block in the view, at scale 1 (px of the table): where it starts, the table's size, the block's. */
export interface PinBox {
  top: number
  left: number
  width: number
  height: number
  rows: number
  cols: number
  /** The sizer's place in the pane. */
  padTop: number
  padLeft: number
}

/** A frozen block taller (or wider) than this share of the view scrolls with the table. */
const PIN_MAX = 0.45

/**
 * The ranges and runs of the frozen cells' animations at `scale`, in the view of `view` px (`tables.css`): rows move
 * from the scroll where the table's top reaches the pane's top, by the scroll over the scale, until they reach the
 * table's end; the columns the same, sideways. A block too big for the view does not move.
 */
export function pinRanges(box: PinBox, scale: number, view: { width: number; height: number }): Record<string, string> {
  const axis = (pad: number, at: number, size: number, block: number, room: number) => {
    const from = pad + at * scale
    const run = block > 0 && block * scale <= room * PIN_MAX ? Math.max(0, size - block) : 0
    return { from: `${Math.round(from * 100) / 100}px`, to: `${Math.round((from + run * scale) * 100) / 100}px`, run: `${Math.round(run * 100) / 100}px` }
  }
  const y = axis(box.padTop, box.top, box.height, box.rows, view.height)
  const x = axis(box.padLeft, box.left, box.width, box.cols, view.width)
  return { '--tv-y-from': y.from, '--tv-y-to': y.to, '--tv-y-run': y.run, '--tv-x-from': x.from, '--tv-x-to': x.to, '--tv-x-run': x.run }
}

/** The frozen block of the view's table, measured once when it opens (and when the phone turns), at scale 1. */
function measurePins(pane: HTMLElement, sizer: HTMLElement, content: HTMLElement, table: HTMLTableElement): PinBox {
  const c = content.getBoundingClientRect()
  const t = table.getBoundingClientRect()
  const p = pane.getBoundingClientRect()
  const s = sizer.getBoundingClientRect()
  const rows = Number(table.getAttribute('data-pin-rows') ?? 0)
  const cols = Number(table.getAttribute('data-pin-cols') ?? 0)
  const first = table.rows[0]
  const last = rows > 0 ? table.rows[rows - 1] : undefined
  const lastCol = [...table.querySelectorAll<HTMLElement>('tr:first-child > [data-pin-col-end]')][0]
  return {
    top: t.top - c.top,
    left: t.left - c.left,
    width: t.width,
    height: t.height,
    rows: first && last ? last.getBoundingClientRect().bottom - first.getBoundingClientRect().top : 0,
    cols: cols > 0 && first && lastCol ? lastCol.getBoundingClientRect().right - first.cells[0]!.getBoundingClientRect().left : 0,
    padTop: s.top - p.top + pane.scrollTop,
    padLeft: s.left - p.left + pane.scrollLeft,
  }
}

/** The smallest scale it opens at: the text is still readable. Pinching goes down to the whole width. */
export const READ_MIN = 0.55
/** The largest zoom. */
const MAX = 3
/** A swipe down this far (px), mostly down, from the top of the table, closes the view. */
export const SWIPE_CLOSE = 90

export interface TableView {
  el: HTMLElement
  close(): void
}

let open: TableView | null = null

/** The open view, if any (the page closes it when it closes). */
export const openTableView = (): TableView | null => open

function rowsAndColumns(table: HTMLTableElement): string {
  const rows = table.tBodies[0]?.rows.length ?? Math.max(0, table.rows.length - 1)
  const cols = Math.max(0, ...[...table.rows].map((r) => r.cells.length))
  return `${rows} ${rows === 1 ? 'row' : 'rows'} · ${cols} ${cols === 1 ? 'column' : 'columns'}`
}

/** Opens `box` (a `.page-table-box`) full screen; `back` gets the focus when it closes. */
export function showTable(box: HTMLElement, back?: HTMLElement | null): TableView {
  open?.close()
  const table = box.querySelector('table')!
  const view = document.createElement('div')
  view.className = 'table-view'
  view.setAttribute('role', 'dialog')
  view.setAttribute('aria-modal', 'true')
  view.setAttribute('aria-label', 'Table, full screen')
  const bar = document.createElement('div')
  bar.className = 'table-view__bar'
  const name = document.createElement('span')
  name.className = 'table-view__name'
  name.textContent = rowsAndColumns(table)
  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'table-view__close'
  close.setAttribute('aria-label', 'Close')
  close.textContent = '✕'
  bar.append(name, close)
  const pane = document.createElement('div')
  pane.className = 'table-view__pane'
  const sizer = document.createElement('div')
  sizer.className = 'table-view__sizer'
  const content = document.createElement('div')
  content.className = 'table-view__content reader__body'
  const copy = box.cloneNode(true) as HTMLElement
  copy.removeAttribute('data-wide')
  copy.querySelector('.page-table-frame')?.removeAttribute('data-more-left')
  copy.querySelector('.page-table-frame')?.removeAttribute('data-more-right')
  content.append(copy)
  sizer.append(content)
  pane.append(sizer)
  view.append(bar, pane)
  document.body.append(view)

  // The table's own size at scale 1 (jsdom has none: then the screen's).
  const width = Math.max(1, content.offsetWidth || copy.scrollWidth || 1)
  const height = Math.max(1, content.offsetHeight || copy.scrollHeight || 1)
  // YAZ-5480: the frozen rows and columns, measured at scale 1; their ranges follow the scale.
  const copied = copy.querySelector('table')!
  copied.removeAttribute('data-pin-rows-off')
  copied.removeAttribute('data-pin-cols-off')
  let pins = measurePins(pane, sizer, content, copied)
  let scaleNow = 1
  const room = () => ({ width: pane.clientWidth || window.innerWidth, height: pane.clientHeight || window.innerHeight })
  const pinned = { rows: [...copied.querySelectorAll<HTMLElement>('[data-pin-row]')], cols: [...copied.querySelectorAll<HTMLElement>('[data-pin-col]')] }
  const script = typeof CSS === 'undefined' || typeof CSS.supports !== 'function' || !CSS.supports('animation-timeline: scroll()')
  let ranges: Record<string, string> = {}
  let frame = 0
  // Without scroll-driven animations: the same moves, from the pane's scroll, once a frame.
  const sync = () => {
    frame = 0
    const move = (from: string, run: string, scroll: number) => Math.min(parseFloat(run) || 0, Math.max(0, (scroll - parseFloat(from)) / scaleNow))
    const y = move(ranges['--tv-y-from']!, ranges['--tv-y-run']!, pane.scrollTop)
    const x = move(ranges['--tv-x-from']!, ranges['--tv-x-run']!, pane.scrollLeft)
    for (const cell of pinned.rows) cell.style.transform = y === 0 ? '' : `translateY(${y}px)`
    for (const cell of pinned.cols) cell.style.translate = x === 0 ? '' : `${x}px 0`
  }
  const schedule = () => {
    if (script && frame === 0) frame = requestAnimationFrame(sync)
  }
  pane.addEventListener('scroll', schedule, { passive: true })
  const placePins = () => {
    ranges = pinRanges(pins, scaleNow, room())
    for (const [name, value] of Object.entries(ranges)) content.style.setProperty(name, value)
    schedule()
  }
  const rangeNow = (): ZoomRange => {
    const room = Math.max(1, (pane.clientWidth || window.innerWidth) - 24)
    const fit = Math.min(1, room / width)
    return { min: fit, max: MAX, start: Math.min(1, Math.max(fit, READ_MIN)), doubleIn: Math.max(1, fit * 2) }
  }
  const zoom = pinchZoom(view, pane, (scale) => {
    view.setAttribute('data-scale', String(Math.round(scale * 100) / 100))
    content.style.transform = `scale(${scale})`
    sizer.style.width = `${Math.ceil(width * scale)}px`
    sizer.style.height = `${Math.ceil(height * scale)}px`
    scaleNow = scale
    placePins()
  }, rangeNow())
  // The phone turned (or the window changed): the fit again, and the frozen block's place.
  const turn = () => {
    const before = scaleNow
    content.style.transform = ''
    pins = measurePins(pane, sizer, content, copied)
    content.style.transform = `scale(${before})`
    zoom.range(rangeNow())
    placePins()
  }
  window.addEventListener('resize', turn)
  window.addEventListener('orientationchange', turn)

  // A swipe down from the top (one finger, the table not scrolled down) closes it, as a sheet does.
  let swipe: { x: number; y: number } | null = null
  const point = (e: Event) => (e as TouchEvent).changedTouches?.[0] ?? (e as TouchEvent).touches?.[0]
  view.addEventListener('touchstart', (e) => {
    const t = point(e)
    swipe = (e as TouchEvent).touches?.length === 1 && t !== undefined && pane.scrollTop <= 0 ? { x: t.clientX, y: t.clientY } : null
  }, { passive: true })
  view.addEventListener('touchmove', (e) => {
    if ((e as TouchEvent).touches?.length !== 1) swipe = null
  }, { passive: true })
  view.addEventListener('touchend', (e) => {
    const t = point(e)
    if (swipe === null || t === undefined) return
    const dx = t.clientX - swipe.x
    const dy = t.clientY - swipe.y
    swipe = null
    if (dy >= SWIPE_CLOSE && Math.abs(dx) < dy * 0.6 && pane.scrollTop <= 0) done()
  })

  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape') done()
  }
  let closed = false
  const done = () => {
    if (closed) return
    closed = true
    // YAZ-5518: its history entry goes with it (nothing when a Back closed it).
    leave()
    view.remove()
    pane.removeEventListener('scroll', schedule)
    if (frame !== 0) cancelAnimationFrame(frame)
    document.removeEventListener('keydown', key)
    window.removeEventListener('resize', turn)
    window.removeEventListener('orientationchange', turn)
    if (open === self) open = null
    if (back?.isConnected) back.focus()
  }
  close.addEventListener('click', done)
  document.addEventListener('keydown', key)
  // YAZ-5518: an overlay of the app's one stack: a Back (Safari's swipe, the app's) closes the table, and the page stays.
  const leave = openOverlay(done)
  // The left-edge Back (the Home Screen app) closes it too: the view is over the frame, out of its swipe.
  edgeBackOn(view, done, swipeIsOurs(whereAmI(browserFacts())))
  const self: TableView = { el: view, close: done }
  open = self
  close.focus()
  return self
}
