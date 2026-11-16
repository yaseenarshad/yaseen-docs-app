import { overEdge, placeSlotRoom as placeRoom, slotRoomAt } from '@shared/slotRoom'
import { minutesOf, nowPlace, rowTimes, secondsOf, slotPillChars, slotTimeLabel, type NowPlace } from '@shared/tableSlots'
import { calendarLook, type CalendarLook } from './calendarLook'
import { gridColumns } from './tableLayout'

/**
 * CALENDAR TABLES ON THE PHONE, as the Mac draws them (`client/src/editor/table/tableCalendar.ts`):
 * a table whose comment says `calendar 15m | 30m | 60m` (`tableFile.ts` puts it on the table as `data-calendar`) is a
 * day of time slots. Column A holds the times (the Mac's `readTime`); the header row is never a slot.
 *
 * THE SLOTS: the Mac's rule, ONE copy (`shared/tableSlots.ts`): a row whose column A reads as a time starts a slot to
 * the next time; a time earlier than the one above is on the next day; a merged time cell is one slot as long as its rows.
 *
 * THE MARKS: the row whose slot holds the current minute (today's, or tomorrow's for a row after midnight) gets
 * `table-now-row` and `--table-now`, how far down the slot now is (0..1); `tables.css` draws the red line and the dot in
 * column A by `transform` only (never a layout property), or the tint. Each body row before it gets `table-past-row`
 * (grey text, the light shade), except a row the file keeps out (`nodim`, `data-nodim`). With no now row: before the
 * first slot no row is past, after the last every row is. The look is the Mac's defaults (`calendarLook.ts`).
 * With Shade the next time slot on (the vault's), the body row right after the now row gets `table-next-row`
 * (before the first slot, the first slot; none after the last), tinted as the now tint in `--table-next-colour`.
 *
 * THE CLOCK (`watchCalendars`, from `useTables`): one `setTimeout` to the next whole minute, only while the page has a
 * calendar table; the phone's local time. The app back in front (`visibilitychange`, `pageshow`) marks at once. Nothing
 * is read from the layout on a tick: the times are read from the text once per table, and a tick writes classes and
 * one custom property. The full-screen view (`tableView.ts`, a copy of the table) is marked with the page's tables.
 *
 * GO TO NOW (the Mac's "Now" chip): a small pill with a red dot that sticks to the bottom of the screen
 * while the table is in view and its now row is not; its arrow points at the row. A tap scrolls the row to the middle
 * (the Mac's `goToNow` on a read-only page). A table with `nonow`, or the Now button setting off, has none. One
 * `IntersectionObserver` says when it shows: no position is read on a scroll.
 *
 * TIME IN SLOT (YAZ-5606, the Mac's YAZ-5602): with the vault's `look.slotTime` down or up, a pill at the right end of
 * the now line says the time left in the now row's slot, or since it started (`19:14 left`, `20 min left`, `10:46 in`:
 * the Mac's `slotTimeLabel`, ONE copy in `shared/tableSlots.ts`), and the Now pill says `Now · 19:14 left`. As the Mac's
 * widget: an anchor in the now row's last cell, its track on the line (`--table-now`), the pill sticky at the right end of
 * the table's visible part; YAZ-5658: a last cell with text keeps room for the pill on the pill's own line only (two
 * floats, `placeSlotRoom`: its one read of the layout, once at each mark, in the next frame). The clock
 * sets the text only. With seconds, a timer to each next second runs only while a table with a pill is on the screen
 * and the app is in front; without, the minute's mark sets it. Off: no pill, no timer, nothing changes.
 */

export { minutesOf, nowPlace, rowTimes, slotRoomAt, slotTimeLabel, type NowPlace }

/** A cell's own text: without a Time in slot pill it holds (a one-column table's column A is its last cell). */
const ownText = (cell: Element): string => {
  const text = cell.textContent ?? ''
  const anchor = cell.querySelector(':scope > .table-slot-anchor')
  // The anchor is the cell's first child: its text comes first.
  return anchor === null ? text : text.slice(anchor.textContent?.length ?? 0)
}

/** Column A's text of each row through the grid (a row a merged cell from above covers has `null`). Pure: no layout. */
export function columnATexts(table: HTMLTableElement): Array<string | null> {
  const grid = gridColumns(table)
  return [...table.rows].map((row) => {
    for (const cell of row.cells) if (grid.get(cell) === 0) return ownText(cell).trim()
    return null
  })
}

/** The pill's text for the slot `start`–`end` (minutes from today's midnight) at `seconds` from today's midnight; `''` when off. */
export const slotPillText = (look: CalendarLook, start: number, end: number, seconds: number): string =>
  look.slotTime === 'off' ? '' : slotTimeLabel(look.slotTime, look.slotSeconds, start, end, seconds)

/** The Time in slot pill of the now row's last cell: its anchor, its track on the now line, the pill (the Mac's `slotPill`). */
function slotAnchor(): HTMLElement {
  const anchor = document.createElement('span')
  anchor.className = 'table-slot-anchor'
  anchor.setAttribute('aria-hidden', 'true')
  const track = document.createElement('span')
  track.className = 'table-slot-track'
  const pill = document.createElement('span')
  pill.className = 'table-slot-pill'
  track.append(pill)
  anchor.append(track)
  return anchor
}

/** The two floats that keep the pill's room on its line in a cell with text (`tables.css`): the gap, then the room. */
function slotRoom(): HTMLElement[] {
  return ['table-slot-gap', 'table-slot-room'].map((name) => {
    const el = document.createElement('span')
    el.className = name
    el.setAttribute('aria-hidden', 'true')
    return el
  })
}

/**
 * YAZ-5658: puts the pill's room of `cell` (a now row's last cell with text) on the now line: the one rule of
 * `shared/slotRoom.ts` (`placeSlotRoom`), on this cell's floats.
 */
export function placeSlotRoom(cell: HTMLElement): void {
  const gap = cell.querySelector<HTMLElement>(':scope > .table-slot-gap')
  const room = cell.querySelector<HTMLElement>(':scope > .table-slot-room')
  if (gap === null || room === null) return
  const now = Number(cell.parentElement?.style.getPropertyValue('--table-now') || 0)
  const look = getComputedStyle(cell)
  // YAZ-4965: the table's scroll box (none in the full-screen view, where it does not scroll): the room and the pill
  // move in to its visible edge, so the pill never lies over the cut text.
  const box = cell.closest<HTMLElement>('.page-table')
  const scrolls = box !== null && /auto|scroll/.test(getComputedStyle(box).overflowX)
  const anchor = cell.querySelector<HTMLElement>(':scope > .table-slot-anchor')
  const side = {
    over: () => (scrolls ? overEdge(cell, box) : 0),
    content: () => cell.clientWidth - (parseFloat(look.paddingLeft) || 0) - (parseFloat(look.paddingRight) || 0),
    width: () => cell.clientWidth,
    room: () => room.getBoundingClientRect().width,
    pill: () => anchor?.querySelector('.table-slot-pill')?.getBoundingClientRect().width ?? 0,
    set: (px: string) => {
      if (anchor !== null && anchor.style.getPropertyValue('--slot-side') !== px) anchor.style.setProperty('--slot-side', px)
    },
  }
  placeRoom(now, { height: () => cell.clientHeight, look, gap, room, side })
}

/** The cells whose room waits for the next frame (one frame for every table of the page). */
const toPlace = new Set<HTMLElement>()
let placing = 0
function placeSoon(cell: HTMLElement): void {
  toPlace.add(cell)
  if (placing !== 0 || typeof requestAnimationFrame === 'undefined') return
  placing = requestAnimationFrame(() => {
    placing = 0
    for (const c of toPlace) if (c.isConnected) placeSlotRoom(c)
    toPlace.clear()
  })
}

/** Every pill's room in `root` again (its columns changed width: Wide tables). */
export function placeSlotRooms(root: ParentNode): void {
  for (const cell of root.querySelectorAll<HTMLElement>('.table-slot-pad')) placeSoon(cell)
}

/**
 * The pill on `row` (the now row, or `null` for none) of `table` for the slot `start`–`end`: made, moved or taken away,
 * its cell given the pill's room on the now line when it has text. Its text at `seconds`. Writes only what changed.
 */
function drawSlotPill(table: HTMLTableElement, row: HTMLTableRowElement | null, start: number, end: number, seconds: number, look: CalendarLook): void {
  const cell = row === null || look.slotTime === 'off' ? null : (row.cells[row.cells.length - 1] ?? null)
  for (const host of table.querySelectorAll<HTMLElement>('.table-slot-host')) {
    if (host === cell) continue
    for (const el of host.querySelectorAll(':scope > :is(.table-slot-anchor, .table-slot-gap, .table-slot-room)')) el.remove()
    host.classList.remove('table-slot-host', 'table-slot-pad')
    host.style.removeProperty('--table-slot-chars')
    toPlace.delete(host)
  }
  if (cell === null) return
  let anchor = cell.querySelector<HTMLElement>(':scope > .table-slot-anchor')
  if (anchor === null) {
    // Its own text, read before the pill comes: a cell with text keeps room for the pill on its line.
    const filled = (cell.textContent ?? '').trim() !== ''
    cell.prepend(...(filled ? [(anchor = slotAnchor()), ...slotRoom()] : [(anchor = slotAnchor())]))
    cell.classList.add('table-slot-host')
    cell.classList.toggle('table-slot-pad', filled)
  }
  if (cell.classList.contains('table-slot-pad')) placeSoon(cell)
  const chars = String(slotPillChars(look.slotTime, look.slotSeconds, start, end))
  if (cell.style.getPropertyValue('--table-slot-chars') !== chars) cell.style.setProperty('--table-slot-chars', chars)
  const pill = anchor.querySelector<HTMLElement>('.table-slot-pill')!
  if (pill.dataset.start !== String(start)) pill.dataset.start = String(start)
  if (pill.dataset.end !== String(end)) pill.dataset.end = String(end)
  const text = slotPillText(look, start, end, seconds)
  if (pill.textContent !== text) pill.textContent = text
}

/** The pills' text of `root`'s calendar tables at `seconds` (the clock's each second): text only, no layout. */
function setPillTexts(root: ParentNode, seconds: number, look: CalendarLook): void {
  for (const pill of root.querySelectorAll<HTMLElement>('table[data-calendar] .table-slot-pill')) {
    const text = slotPillText(look, Number(pill.dataset.start), Number(pill.dataset.end), seconds)
    if (pill.textContent !== text) pill.textContent = text
  }
}

/** Each calendar table's row times, read once (the reader never changes a table's text). */
const timesOf = new WeakMap<HTMLTableElement, Array<number | null>>()

/**
 * Marks `table` (a calendar table) for `minutes`: its past rows, its now row and its look, and with Time in slot the
 * pill on the now line, its text at `seconds` from midnight (the minute's start by default); returns the now row (or
 * `null`). Writes only what changed.
 */
export function markCalendar(table: HTMLTableElement, minutes: number, look: CalendarLook = calendarLook(), seconds = minutes * 60): HTMLTableRowElement | null {
  let times = timesOf.get(table)
  if (times === undefined) timesOf.set(table, (times = rowTimes(columnATexts(table))))
  const place = nowPlace(times, Number(table.getAttribute('data-calendar')), minutes)
  if (table.getAttribute('data-now-mark') !== look.nowMark) table.setAttribute('data-now-mark', look.nowMark)
  if (table.getAttribute('data-dim-past') !== look.dimPast) table.setAttribute('data-dim-past', look.dimPast)
  const shade = `${look.shadeDarkness}%`
  if (table.style.getPropertyValue('--table-past-shade') !== shade) table.style.setProperty('--table-past-shade', shade)
  if (look.nextColour === null) table.style.removeProperty('--table-next-colour')
  else if (table.style.getPropertyValue('--table-next-colour') !== look.nextColour) table.style.setProperty('--table-next-colour', look.nextColour)
  const rows = table.rows.length
  const after = place === null ? rows : place.row === null ? place.pastEnd : place.row + 1
  const nextRow = look.nextShade && after < rows ? after : -1
  let nowRow: HTMLTableRowElement | null = null
  ;[...table.rows].forEach((row, r) => {
    const past = place !== null && r > 0 && r < place.pastEnd && !row.hasAttribute('data-nodim')
    const now = place !== null && r === place.row
    if (row.classList.contains('table-past-row') !== past) row.classList.toggle('table-past-row', past)
    if (row.classList.contains('table-now-row') !== now) row.classList.toggle('table-now-row', now)
    if (row.classList.contains('table-next-row') !== (r === nextRow)) row.classList.toggle('table-next-row', r === nextRow)
    if (now) {
      nowRow = row
      const at = String(Math.round(place!.fraction * 1000) / 1000)
      if (row.style.getPropertyValue('--table-now') !== at) row.style.setProperty('--table-now', at)
    } else if (row.style.getPropertyValue('--table-now') !== '') row.style.removeProperty('--table-now')
  })
  // Time in slot (YAZ-5606): none with Off, and none on a table that never had one: nothing changes.
  if (look.slotTime !== 'off' || table.querySelector('.table-slot-host') !== null) drawSlotPill(table, nowRow, place?.start ?? 0, place?.end ?? 0, seconds, look)
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
  label.className = 'page-table__now-label'
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
  /** Time in slot with seconds: the timer to the next whole second, and the table boxes on the screen now. */
  let second: ReturnType<typeof setTimeout> | null = null
  const onScreen = new Set<Element>()
  const counts = look.slotTime !== 'off' && look.slotSeconds
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
            if (entry.target.classList.contains('page-table-box')) {
              if (entry.isIntersecting) onScreen.add(entry.target)
              else onScreen.delete(entry.target)
            }
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
          if (counts) {
            texts()
            seconds()
          }
        })

  /** Each Now pill's label: `Now · 19:14 left` while its table has a Time in slot pill (YAZ-5606), else `Now`. */
  const labels = () => {
    for (const w of watches) {
      const label = w.chip.querySelector('.page-table__now-label')
      const pill = w.table.querySelector('.table-slot-pill')?.textContent ?? ''
      const text = pill === '' ? 'Now' : `Now · ${pill}`
      if (label !== null && label.textContent !== text) label.textContent = text
    }
  }

  /** The pills' and the Now pills' text at the clock's second: text only (each second, with Show seconds). */
  const texts = () => {
    if (stopped || look.slotTime === 'off') return
    const at = secondsOf(now())
    setPillTexts(host, at, look)
    const view = document.querySelector('.table-view')
    if (view !== null) setPillTexts(view, at, look)
    labels()
  }

  /**
   * The second's timer: only with Time in slot counting seconds, the app in front, and a calendar table with a pill on
   * the screen (its box seen by the observer; with none, every box counts; the full-screen view's copy is on the screen).
   */
  const seconds = () => {
    const shows = () =>
      document.querySelector('.table-view table[data-calendar] .table-slot-pill') !== null ||
      [...own()].some((table) => table.querySelector('.table-slot-pill') !== null && (observer === null || onScreen.has(table.closest('.page-table-box') ?? table)))
    const want = counts && !stopped && !document.hidden && shows()
    if (want && second === null) {
      second = setTimeout(() => {
        second = null
        texts()
        seconds()
      }, 1000 - (Date.now() % 1000) + 5)
    } else if (!want && second !== null) {
      clearTimeout(second)
      second = null
    }
  }

  /** Marks every calendar table for the clock's minute; the chips follow their now rows. */
  const mark = () => {
    if (stopped) return
    const date = now()
    const minutes = minutesOf(date)
    const at = secondsOf(date)
    const rows = new Map<HTMLTableElement, HTMLTableRowElement | null>()
    for (const table of all()) rows.set(table, markCalendar(table, minutes, look, at))
    for (const w of watches) {
      const row = rows.get(w.table) ?? null
      if (row === w.row) continue
      if (w.row !== null) observer?.unobserve(w.row)
      w.row = row
      w.rowOn = false
      if (row !== null) observer?.observe(row)
      draw(w)
    }
    if (look.slotTime !== 'off') labels()
    seconds()
  }

  const schedule = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    // No timer while the app is not in front: back in front, `shown` marks at once and schedules again.
    if (stopped || own().length === 0 || document.hidden) return
    // A little after the minute turns, so the clock reads the new minute.
    timer = setTimeout(() => {
      timer = null
      if (!document.hidden) mark()
      schedule()
    }, 60_000 - (Date.now() % 60_000) + 20)
  }

  const shown = () => {
    if (document.hidden) {
      // Hidden: no timers (the minute's and the second's).
      if (timer !== null) clearTimeout(timer)
      timer = null
      seconds()
      return
    }
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
      // With seconds, the second's timer runs only while a box is on the screen.
      if (box !== null && counts) observer?.observe(box)
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
      if (second !== null) clearTimeout(second)
      observer?.disconnect()
      document.removeEventListener('visibilitychange', shown)
      window.removeEventListener('pageshow', shown)
      host.removeEventListener('click', goTo)
    },
  }
}
