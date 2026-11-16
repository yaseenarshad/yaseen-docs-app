import { useEffect, type RefObject } from 'react'
import { placeSlotRooms, watchCalendars, type CalendarOptions } from './tableCalendar'
import { layoutTables } from './tableLayout'
import { tableCalendarLook, type PhoneTableLook } from './tableLook'
import { bandLookOf, DEFAULT_BAND, watchBand, type BandLook } from './rowBand'

/**
 * The tables of an open page or card, for as long as it shows:
 *  - a table wider than its box is marked `data-wide` (its ⤢ shows), measured when it comes, when the screen changes
 *    size (the phone turns) and when its box does;
 *  - its frame says which side has more to see (`data-more-left`, `data-more-right`): the soft shadows;
 *  - a tap on ⤢ opens the table full screen (`tableView.ts`, a chunk of its own, loaded on the first tap);
 *  - a table that comes later (an embedded card, filled after the page) gets its widths and frame (`layoutTables`);
 *  - its frozen rows and columns are measured (`measureFreeze`) with it, never on a scroll;
 *  - a calendar table shows now (`tableCalendar.ts`): its now line, its past rows dimmed, each minute;
 *  - a finger on a row bands it (`rowBand.ts`), in the vault's band look; the full-screen copy too.
 * The full-screen view closes with the page.
 */
export interface TableWatch {
  /** Measures every table again. */
  measure(): void
  stop(): void
}

/** Marks one table's box: wide or not, and the sides with more. */
export function markTable(box: HTMLElement): void {
  const scroll = box.querySelector<HTMLElement>('.page-table')
  const frame = box.querySelector<HTMLElement>('.page-table-frame')
  if (scroll === null || frame === null) return
  const over = scroll.scrollWidth - scroll.clientWidth
  const wide = over > 1
  box.toggleAttribute('data-wide', wide)
  frame.toggleAttribute('data-more-left', wide && scroll.scrollLeft > 1)
  frame.toggleAttribute('data-more-right', wide && scroll.scrollLeft < over - 1)
}

/** A frozen block taller than this share of the screen does not stay (it would hide the table): the rows scroll. */
export const PIN_ROWS_MAX = 0.45
/** Frozen columns wider than this share of the table's box do not stay: the rest would have no room. */
export const PIN_COLS_MAX = 0.6

/** The browser moves the frozen rows itself, on a scroll-driven animation (`tables.css`); else `useTables` does. */
const scrollDriven = (): boolean => typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('animation-timeline: view()')

/**
 * Measures a table's frozen parts, when it comes and when it or the screen changes size, never on a scroll:
 * each frozen column's offset (`--freeze-x-<n>`, a merged header cell gives each column it spans its own left), the
 * run of the frozen rows (`--pin-run`: the table's height less theirs), and whether they may stay (`PIN_ROWS_MAX`,
 * `PIN_COLS_MAX`). `screen` is the height of the page's scroll box.
 */
export function measureFreeze(box: HTMLElement, screen: number): void {
  const table = box.querySelector<HTMLTableElement>('table')
  const scroll = box.querySelector<HTMLElement>('.page-table')
  if (table === null || scroll === null) return
  const rows = Number(table.getAttribute('data-pin-rows') ?? 0)
  const cols = Number(table.getAttribute('data-pin-cols') ?? 0)
  if (cols > 0) {
    const first = table.rows[0]
    const start = first?.cells[0]?.offsetLeft ?? 0
    let c = 0
    let right = 0
    for (const cell of first?.cells ?? []) {
      if (c >= cols) break
      const left = cell.offsetLeft - start
      right = left + cell.offsetWidth
      for (let span = 0; span < Math.max(1, cell.colSpan) && c < cols; span++, c++) table.style.setProperty(`--freeze-x-${c}`, `${left}px`)
    }
    table.toggleAttribute('data-pin-cols-off', scroll.clientWidth > 0 && right > scroll.clientWidth * PIN_COLS_MAX)
  }
  if (rows > 0) {
    const top = table.rows[0]!.offsetTop
    const last = table.rows[rows - 1]!
    const height = last.offsetTop + last.offsetHeight - top
    table.style.setProperty('--pin-run', `${Math.max(0, table.offsetHeight - height)}px`)
    table.toggleAttribute('data-pin-rows-off', screen > 0 && height > screen * PIN_ROWS_MAX)
  }
  measureSubheads(table, rows)
}

/**
 * YAZ-5567: each sticky subheader row's run (`tableSubheads.ts`, the Mac's `SubheadPinner`), in layout px from the
 * frame's top (no transform counts): it starts to move when the page has scrolled past the frame's top by its place less
 * the frozen rows' bottom (`--sub-from`: then it is right under them), and moves until it meets the next subheader row
 * or the table's end (`--pin-run`). Marked `data-sub-pin` only when it has a run; a table that is not sticky, none.
 */
function measureSubheads(table: HTMLTableElement, frozen: number): void {
  const subs = [...table.querySelectorAll<HTMLTableRowElement>('tr.table-subhead-row')]
  if (subs.length === 0) return
  const sticky = table.getAttribute('data-sticky-subheaders') !== 'off'
  const top = table.offsetTop
  const pinned = frozen > 0 && !table.hasAttribute('data-pin-rows-off') ? table.rows[Math.min(frozen, table.rows.length) - 1] : undefined
  const under = pinned === undefined ? 0 : top + pinned.offsetTop + pinned.offsetHeight
  const end = top + table.offsetHeight
  subs.forEach((row, i) => {
    const at = top + row.offsetTop
    const stop = Math.min(i + 1 < subs.length ? top + subs[i + 1]!.offsetTop : end, end) - row.offsetHeight
    const run = stop - at
    const from = at - under
    if (!sticky || run <= 0 || row.rowIndex < frozen || from < 0) {
      row.removeAttribute('data-sub-pin')
      return
    }
    row.setAttribute('data-sub-pin', '')
    row.style.setProperty('--sub-from', `${from}px`)
    row.style.setProperty('--pin-run', `${run}px`)
  })
}

/**
 * Without scroll-driven animations (`tables.css`): the frozen rows of each table move by the page's scroll, once a frame
 * (passive), with `transform` only. The frames' places in the page are measured with the tables, never on a scroll.
 */
function pinByScript(host: HTMLElement, scroller: HTMLElement): { measure(): void; stop(): void } {
  let pins: Array<{ cells: HTMLElement[]; top: number; run: number; at: number }> = []
  let frame = 0
  const sync = () => {
    frame = 0
    const y = scroller.scrollTop
    for (const pin of pins) {
      const at = Math.max(0, Math.min(pin.run, y - pin.top))
      if (at === pin.at) continue
      pin.at = at
      for (const cell of pin.cells) cell.style.transform = at === 0 ? '' : `translateY(${at}px)`
    }
  }
  const schedule = () => {
    if (frame === 0) frame = requestAnimationFrame(sync)
  }
  scroller.addEventListener('scroll', schedule, { passive: true })
  return {
    measure() {
      const base = scroller.getBoundingClientRect().top - scroller.scrollTop
      pins = [...host.querySelectorAll<HTMLElement>('.page-table-frame')].flatMap((el) => {
        const table = el.querySelector('table')
        if (table === null) return []
        const frameTop = el.getBoundingClientRect().top - base
        const cells = [...table.querySelectorAll<HTMLElement>('[data-pin-row]')]
        const own = cells.length === 0 || table.hasAttribute('data-pin-rows-off') ? [] : [{ cells, top: frameTop, run: parseFloat(table.style.getPropertyValue('--pin-run')) || 0, at: -1 }]
        // YAZ-5567: each sticky subheader row, from its own start, for its own run (`measureSubheads`).
        const subs = table.getAttribute('data-sticky-subheaders') === 'off' ? [] : [...table.querySelectorAll<HTMLTableRowElement>('tr[data-sub-pin]')]
        return [...own, ...subs.map((row) => ({ cells: [...row.cells] as HTMLElement[], top: frameTop + (parseFloat(row.style.getPropertyValue('--sub-from')) || 0), run: parseFloat(row.style.getPropertyValue('--pin-run')) || 0, at: -1 }))]
      })
      schedule()
    },
    stop() {
      scroller.removeEventListener('scroll', schedule)
      if (frame !== 0) cancelAnimationFrame(frame)
    },
  }
}

type Load = () => Promise<{ showTable(box: HTMLElement, back?: HTMLElement | null, band?: BandLook): { close(): void } }>

export function watchTables(host: HTMLElement, load: Load = () => import('./tableView'), calendar: CalendarOptions = {}, band: BandLook = DEFAULT_BAND): TableWatch {
  const boxes = () => host.querySelectorAll<HTMLElement>('.page-table-box')
  // The page's scroll box (`.screen`); the frozen rows stay at its top.
  const scroller = host.closest<HTMLElement>('.screen')
  const script = scroller !== null && !scrollDriven() ? pinByScript(host, scroller) : null
  const measure = () => {
    const screen = scroller?.clientHeight ?? window.innerHeight
    boxes().forEach((box) => {
      markTable(box)
      measureFreeze(box, screen)
    })
    script?.measure()
    // YAZ-5658: a table that changed size (Wide tables, a turn of the phone): the Time in slot pill's room on its line again.
    placeSlotRooms(host)
  }
  let view: { close(): void } | null = null
  let stopped = false

  const sizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measure())
  // Text above a table that changes height moves it: its place, for the script's frozen rows.
  if (script !== null) sizes?.observe(host)
  const seen = new WeakSet<Element>()
  const calendars = watchCalendars(host, calendar)
  const bands = watchBand(host, band)
  const take = () => {
    // A table that came without its frame (a card filled in later).
    if (host.querySelector('table:not([data-cols]):not([data-sized])') !== null) layoutTables(host)
    let fresh = false
    for (const box of boxes()) {
      if (seen.has(box)) continue
      seen.add(box)
      sizes?.observe(box)
      fresh = true
    }
    if (!fresh) return
    measure()
    calendars.refresh()
  }
  take()
  const added = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => take())
  added?.observe(host, { childList: true, subtree: true })

  // Scroll does not bubble: heard on the way down.
  const scrolled = (e: Event) => {
    const box = (e.target as Element | null)?.closest?.('.page-table-box')
    if (box instanceof HTMLElement && (e.target as Element).classList.contains('page-table')) markTable(box)
  }
  host.addEventListener('scroll', scrolled, { capture: true, passive: true })
  window.addEventListener('resize', measure)

  const tapped = (e: MouseEvent) => {
    const button = (e.target as Element | null)?.closest?.('[data-table-open]')
    const box = button?.closest('.page-table-box')
    if (!(box instanceof HTMLElement)) return
    // The page's own tap (links) never sees it.
    e.stopPropagation()
    e.preventDefault()
    void load().then((m) => {
      if (stopped || !box.isConnected) return
      view = m.showTable(box, button as HTMLElement, band)
      // The copy shows now too, and moves with the page's tables.
      calendars.refresh()
    })
  }
  host.addEventListener('click', tapped)

  return {
    measure,
    stop() {
      stopped = true
      sizes?.disconnect()
      added?.disconnect()
      script?.stop()
      calendars.stop()
      bands.stop()
      host.removeEventListener('scroll', scrolled, { capture: true })
      window.removeEventListener('resize', measure)
      host.removeEventListener('click', tapped)
      view?.close()
    },
  }
}

/** `watchTables` on a page's or a card's element, while it shows. */
export function useTables(host: RefObject<HTMLElement | null>, look: PhoneTableLook | null = null): void {
  useEffect(() => {
    const el = host.current
    if (el === null) return
    // The vault's calendar look (`table-look.json`), else the Mac's defaults.
    const watch = watchTables(el, undefined, { look: tableCalendarLook(look) }, bandLookOf(look))
    return () => watch.stop()
  }, [host, look])
}
