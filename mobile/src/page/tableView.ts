import { pinchZoom, type ZoomRange } from '../drawing/pinchZoom'

/**
 * A TABLE, FULL SCREEN (YAZ-5471): the ⤢ under a wide table opens it here, in a chunk of its own. The whole table, every
 * column at its widest (`tables.css`), first fitted to the screen's width (not smaller than `READ_MIN`, so its words
 * stay readable; pinch out to see it all); pinch (or double-tap) to zoom, drag to move. It turns with the phone: the
 * fit is counted again. ✕, Escape or a swipe down from the top closes it. It shows a copy of the table: nothing is saved.
 */

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
  }, rangeNow())
  // The phone turned (or the window changed): the fit again.
  const turn = () => zoom.range(rangeNow())
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
    view.remove()
    document.removeEventListener('keydown', key)
    window.removeEventListener('resize', turn)
    window.removeEventListener('orientationchange', turn)
    if (open === self) open = null
    if (back?.isConnected) back.focus()
  }
  close.addEventListener('click', done)
  document.addEventListener('keydown', key)
  const self: TableView = { el: view, close: done }
  open = self
  close.focus()
  return self
}
