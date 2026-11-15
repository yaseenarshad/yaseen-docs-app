import { readTime } from '@shared/timeFormat'
import { calendarLook, type CalendarLook } from './calendarLook'
import { gridColumns } from './tableLayout'

/**
 * CALENDAR TABLES ON THE PHONE (YAZ-5493), as the Mac draws them (`client/src/editor/table/tableCalendar.ts`, YAZ-4162):
 * a table whose comment says `calendar 15m | 30m | 60m` (`tableFile.ts` puts it on the table as `data-calendar`) is a
 * day of time slots. Column A holds the times (the Mac's `readTime`); the header row is never a slot.
 *
 * THE SLOTS (the Mac's `nowPlace`): a body row whose column A reads as a time starts a slot; the slot runs to the next
 * row with a time, and the last one is one slot length long. A row with no time has no slot. A time earlier than the
 * one above it is on the next day (`11:30 pm`, `12:00 am` run on). A row that a merged time cell covers has no time
 * of its own, so the merged cell is one slot as long as its rows.
 *
 * THE MARKS: the row whose slot holds the current minute (today's, or tomorrow's for a row after midnight) gets
 * `table-now-row` and `--table-now`, how far down the slot now is (0..1); `tables.css` draws the red line and the dot in
 * column A by `transform` only (never a layout property), or the tint. Each body row before it gets `table-past-row`
 * (grey text, the light shade), except a row the file keeps out (`nodim`, `data-nodim`). With no now row: before the
 * first slot no row is past, after the last every row is. The look is the Mac's defaults (`calendarLook.ts`).
 *
 * THE CLOCK (`watchCalendars`, from `useTables`): one `setTimeout` to the next whole minute, only while the page has a
 * calendar table; the phone's local time. The app back in front (`visibilitychange`, `pageshow`) marks at once. Nothing
 * is read from the layout on a tick: the times are read from the text once per table, and a tick writes classes and
 * one custom property. The full-screen view (`tableView.ts`, a copy of the table) is marked with the page's tables.
 *
 * GO TO NOW (the Mac's "Now" chip, YAZ-4164 D12): a small pill with a red dot that sticks to the bottom of the screen
 * while the table is in view and its now row is not; its arrow points at the row. A tap scrolls the row to the middle
 * (the Mac's `goToNow` on a read-only page). A table with `nonow`, or the Now button setting off, has none. One
 * `IntersectionObserver` says when it shows: no position is read on a scroll.
 */

/** Minutes from midnight of `date`, local time. */
export const minutesOf = (date: Date): number => date.getHours() * 60 + date.getMinutes()

/** Where now is in a calendar table: its now row (an index of the table's rows, the header row 0), how far down its slot, and the first row that is not past. */
export interface NowPlace {
  row: number | null
  fraction: number
  /** Body rows before this index are past. */
  pastEnd: number
}

/** Each row's time from the first day's midnight (a time earlier than the one above is a day on), or `null`; `texts[0]` is the header row's. */
export function rowTimes(texts: ReadonlyArray<string | null>): Array<number | null> {
  const out: Array<number | null> = []
  let day = 0
  let last = -1
  texts.forEach((text, r) => {
    if (r === 0) return void out.push(null)
    const time = text === null ? null : readTime(text)
    if (time !== null && time < last) day += 1440
    if (time !== null) last = time
    out.push(time === null ? null : time + day)
  })
  return out
}

/** Now among `times` (`rowTimes`) at `minutes` from midnight with slots `slot` long; `null` when there is no slot or no time. */
export function nowPlace(times: ReadonlyArray<number | null>, slot: number, minutes: number): NowPlace | null {
  if (!(slot > 0)) return null
  const starts = times.flatMap((start, row) => (row === 0 || start === null ? [] : [{ row, start }]))
  if (starts.length === 0) return null
  const slots = starts.map(({ row, start }, i) => ({ row, start, end: starts[i + 1]?.start ?? start + slot }))
  // Today's minute first, then the same minute tomorrow (a row after midnight).
  for (const at of [minutes, minutes + 1440]) {
    const now = slots.find(({ start, end }) => start <= at && at < end)
    if (now !== undefined) return { row: now.row, fraction: (at - now.start) / (now.end - now.start), pastEnd: now.row }
  }
  const next = slots.find(({ start }) => start > minutes)
  return { row: null, fraction: 0, pastEnd: next?.row ?? times.length }
}

/** Column A's text of each row through the grid (a row a merged cell from above covers has `null`). Pure: no layout. */
export function columnATexts(table: HTMLTableElement): Array<string | null> {
  const grid = gridColumns(table)
  return [...table.rows].map((row) => {
    for (const cell of row.cells) if (grid.get(cell) === 0) return (cell.textContent ?? '').trim()
    return null
  })
}

/** Each calendar table's row times, read once (the reader never changes a table's text). */
const timesOf = new WeakMap<HTMLTableElement, Array<number | null>>()

/**
 * Marks `table` (a calendar table) for `minutes`: its past rows, its now row and its look; returns the now row (or
 * `null`). Writes only what changed.
 */
export function markCalendar(table: HTMLTableElement, minutes: number, look: CalendarLook = calendarLook()): HTMLTableRowElement | null {
  let times = timesOf.get(table)
  if (times === undefined) timesOf.set(table, (times = rowTimes(columnATexts(table))))
  const place = nowPlace(times, Number(table.getAttribute('data-calendar')), minutes)
  if (table.getAttribute('data-now-mark') !== look.nowMark) table.setAttribute('data-now-mark', look.nowMark)
  if (table.getAttribute('data-dim-past') !== look.dimPast) table.setAttribute('data-dim-past', look.dimPast)
  const shade = `${look.shadeDarkness}%`
  if (table.style.getPropertyValue('--table-past-shade') !== shade) table.style.setProperty('--table-past-shade', shade)
  let nowRow: HTMLTableRowElement | null = null
  ;[...table.rows].forEach((row, r) => {
    const past = place !== null && r > 0 && r < place.pastEnd && !row.hasAttribute('data-nodim')
    const now = place !== null && r === place.row
    if (row.classList.contains('table-past-row') !== past) row.classList.toggle('table-past-row', past)
    if (row.classList.contains('table-now-row') !== now) row.classList.toggle('table-now-row', now)
    if (now) {
      nowRow = row
      const at = String(Math.round(place!.fraction * 1000) / 1000)
      if (row.style.getPropertyValue('--table-now') !== at) row.style.setProperty('--table-now', at)
    } else if (row.style.getPropertyValue('--table-now') !== '') row.style.removeProperty('--table-now')
  })
  return nowRow
}

/** The chip's arrow, pointing at the now row. */
const ARROW = { up: 'M12 19V5M6 11l6-6 6 6', down: 'M12 5v14M6 13l6 6 6-6' }

/** The "Now" pill in a zero-height anchor that sticks to the bottom of the screen, after the table's frame. */
function nowChip(): { anchor: HTMLElement; chip: HTMLButtonElement } {
  const anchor = document.createElement('div')
  anchor.className = 'page-table__now-anchor'
  const chip = document.createElement('button')
  chip.type = 'button'
  chip.className = 'page-table__now'
  chip.hidden = true
  chip.setAttribute('data-table-now', '')
  const dot = document.createElement('span')
  dot.className = 'page-table__now-dot'
  const label = document.createElement('span')
  label.textContent = 'Now'
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  svg.append(path)
  chip.append(dot, label, svg)
  anchor.append(chip)
  return { anchor, chip }
}

function drawArrow(chip: HTMLButtonElement, dir: 'up' | 'down'): void {
  if (chip.dataset.dir === dir) return
  chip.dataset.dir = dir
  chip.setAttribute('aria-label', `Go to now, ${dir === 'up' ? 'above' : 'below'}`)
  chip.querySelector('path')?.setAttribute('d', ARROW[dir])
}

interface ChipWatch {
  box: HTMLElement
  table: HTMLTableElement
  chip: HTMLButtonElement
  row: HTMLTableRowElement | null
  boxOn: boolean
  rowOn: boolean
  rowAbove: boolean
}

export interface CalendarWatch {
  /** Takes the calendar tables that came (a page's, a card's filled in later) and marks every one. */
  refresh(): void
  stop(): void
}

/** The phone's clock; a screen fixture freezes it (`setCalendarClock`). */
let clock: () => Date = () => new Date()
/** Sets the calendar tables' clock (`null`: the phone's own again). For the screen fixtures and the tests. */
export function setCalendarClock(fn: (() => Date) | null): void {
  clock = fn ?? (() => new Date())
}

export interface CalendarOptions {
  look?: CalendarLook
  /** The clock (a fixture or a test freezes it). */
  now?: () => Date
}

/** Marks the calendar tables of `host` (and of the open full-screen view) now and at each minute; see the header. */
export function watchCalendars(host: HTMLElement, { look = calendarLook(), now = () => clock() }: CalendarOptions = {}): CalendarWatch {
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false
  const watches: ChipWatch[] = []
  const seen = new WeakSet<HTMLTableElement>()
  const own = () => host.querySelectorAll<HTMLTableElement>('table[data-calendar]')
  const all = () => [...own(), ...document.querySelectorAll<HTMLTableElement>('.table-view table[data-calendar]')]

  const draw = (w: ChipWatch) => {
    const hidden = !w.boxOn || w.row === null || w.rowOn
    if (w.chip.hidden !== hidden) w.chip.hidden = hidden
    drawArrow(w.chip, w.rowAbove ? 'up' : 'down')
  }
  const observer =
    typeof IntersectionObserver === 'undefined'
      ? null
      : new IntersectionObserver((entries) => {
          for (const entry of entries) {
            for (const w of watches) {
              if (entry.target === w.box) w.boxOn = entry.isIntersecting
              else if (entry.target === w.row) {
                w.rowOn = entry.isIntersecting
                const root = entry.rootBounds
                const middle = root === null ? window.innerHeight / 2 : (root.top + root.bottom) / 2
                w.rowAbove = (entry.boundingClientRect.top + entry.boundingClientRect.bottom) / 2 < middle
              } else continue
              draw(w)
            }
          }
        })

  /** Marks every calendar table for the clock's minute; the chips follow their now rows. */
  const mark = () => {
    if (stopped) return
    const minutes = minutesOf(now())
    const rows = new Map<HTMLTableElement, HTMLTableRowElement | null>()
    for (const table of all()) rows.set(table, markCalendar(table, minutes, look))
    for (const w of watches) {
      const row = rows.get(w.table) ?? null
      if (row === w.row) continue
      if (w.row !== null) observer?.unobserve(w.row)
      w.row = row
      w.rowOn = false
      if (row !== null) observer?.observe(row)
      draw(w)
    }
  }

  const schedule = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    if (stopped || own().length === 0) return
    // A little after the minute turns, so the clock reads the new minute.
    timer = setTimeout(() => {
      timer = null
      if (!document.hidden) mark()
      schedule()
    }, 60_000 - (Date.now() % 60_000) + 20)
  }

  const shown = () => {
    if (document.hidden) return
    mark()
    schedule()
  }
  document.addEventListener('visibilitychange', shown)
  window.addEventListener('pageshow', shown)

  const goTo = (e: Event) => {
    const chip = (e.target as Element | null)?.closest?.('[data-table-now]')
    if (chip === null || chip === undefined) return
    e.stopPropagation()
    e.preventDefault()
    const row = watches.find((w) => w.chip === chip)?.row
    if (row != null && typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'center', inline: 'nearest' })
  }
  host.addEventListener('click', goTo)

  const refresh = () => {
    if (stopped) return
    for (const table of own()) {
      if (seen.has(table)) continue
      seen.add(table)
      const box = table.closest<HTMLElement>('.page-table-box')
      if (box === null || !look.nowButton || table.hasAttribute('data-nonow')) continue
      const { anchor, chip } = nowChip()
      box.append(anchor)
      const w: ChipWatch = { box, table, chip, row: null, boxOn: false, rowOn: false, rowAbove: false }
      watches.push(w)
      observer?.observe(box)
      draw(w)
    }
    mark()
    schedule()
  }
  refresh()

  return {
    refresh,
    stop() {
      stopped = true
      if (timer !== null) clearTimeout(timer)
      observer?.disconnect()
      document.removeEventListener('visibilitychange', shown)
      window.removeEventListener('pageshow', shown)
      host.removeEventListener('click', goTo)
    },
  }
}
