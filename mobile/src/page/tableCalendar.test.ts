// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://app.example/"}
import { DEFAULT_SETTINGS, TABLE_SHADE_MAX, TABLE_SHADE_MIN } from '@shared/types'
import { DEFAULT_CALENDAR_DAY } from '@shared/timeFormat'
import { readFileSync } from 'node:fs'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { CALENDAR_NOW, CALENDAR_PAGE } from '../dev/tableFixtures'
import { MAC_CALENDAR_LOOK, SHADE_MAX, SHADE_MIN, calendarLook } from './calendarLook'
import { renderPage, type PageLook } from './pageRender'
import { markCalendar, minutesOf, nowPlace, rowTimes, setCalendarClock, watchCalendars } from './tableCalendar'
import { showTable } from './tableView'
import { watchTables } from './useTables'

/**
 * YAZ-5493: calendar tables on the phone, from the Mac's rules (`client/src/editor/table/tableCalendar.ts`): the slot
 * math, the past rows, the now row and its place in the slot, the clock (each minute, and the app back in front), the
 * full-screen copy, and the look settings (the Mac's defaults, through `calendarLook`). That the line draws where it
 * should is checked in headless Chrome (`publish/proveLayout.ts`, `page-calendar`, light and dark).
 */
const look: PageLook = {
  link: (inner) => ({ label: inner, open: { kind: 'page', path: `${inner}.md` } }),
  embed: (inner) => ({ kind: 'text', text: `![[${inner}]]` }),
  asset: () => null,
  card: () => document.createElement('div'),
}
async function draw(text: string): Promise<HTMLElement> {
  const body = document.createElement('div')
  body.className = 'reader__body'
  document.body.append(body)
  await renderPage(text, look, body)
  return body
}
const at = (h: number, m: number) => h * 60 + m
const times = (...texts: Array<string | null>) => rowTimes(['Time', ...texts])
const rowsOf = (table: HTMLTableElement, cls: string) => [...table.rows].flatMap((row, i) => (row.classList.contains(cls) ? [i] : []))
const table = (lines: string[], comment: string) => `${['| Time | Plan |', '| --- | --- |', ...lines].join('\n')}\n\n${comment}\n`

let styles: HTMLStyleElement[] = []
beforeAll(() => {
  styles = ['../styles.css', './reader.css', './tables.css'].map((path) => {
    const el = document.createElement('style')
    el.textContent = readFileSync(new URL(path, import.meta.url), 'utf8')
    document.head.append(el)
    return el
  })
})
afterAll(() => styles.forEach((s) => s.remove()))
afterEach(() => {
  document.querySelectorAll('.reader__body, .screen, .table-view').forEach((el) => el.remove())
  setCalendarClock(null)
  vi.useRealTimers()
})

describe('the slot math, as the Mac (YAZ-5493)', () => {
  it('15m, 30m and 60m slots: the now row and how far down its slot now is', () => {
    const t15 = times('9:00 am', '9:15 am', '9:30 am', '9:45 am')
    expect(nowPlace(t15, 15, at(9, 20))).toEqual({ row: 2, fraction: 5 / 15, pastEnd: 2 })
    const t30 = times('9:00 am', '9:30 am', '10:00 am')
    expect(nowPlace(t30, 30, at(9, 40))).toEqual({ row: 2, fraction: 10 / 30, pastEnd: 2 })
    const t60 = times('9:00', '10:00', '11:00')
    expect(nowPlace(t60, 60, at(10, 45))).toEqual({ row: 2, fraction: 0.75, pastEnd: 2 })
    // The last slot is one slot length long.
    expect(nowPlace(t60, 60, at(11, 59))).toEqual({ row: 3, fraction: 59 / 60, pastEnd: 3 })
    expect(nowPlace(t15, 15, at(9, 59))?.row).toBe(4)
    expect(nowPlace(t15, 15, at(10, 0))).toEqual({ row: null, fraction: 0, pastEnd: 5 })
  })

  it('a slot runs to the next row with a time: a row with no time has none, and a gap is one long slot', () => {
    const t = times('To-do', '9:00 am', null, '', '11:00 am')
    expect(t).toEqual([null, null, 540, null, null, 660])
    expect(nowPlace(t, 30, at(10, 0))).toEqual({ row: 2, fraction: 0.5, pastEnd: 2 })
  })

  it('the start and the end of the day: before the first slot no row is past; after the last every row is', () => {
    const t = times('To-do', '7:00 am', '7:30 am', '8:00 am')
    expect(nowPlace(t, 30, at(6, 0))).toEqual({ row: null, fraction: 0, pastEnd: 2 })
    expect(nowPlace(t, 30, at(23, 0))).toEqual({ row: null, fraction: 0, pastEnd: 5 })
    // No time at all, or no slot length: no calendar.
    expect(nowPlace(times('To-do', 'Later'), 30, at(9, 0))).toBeNull()
    expect(nowPlace(t, 0, at(9, 0))).toBeNull()
  })

  it('midnight: a time earlier than the one above is the next day, so 11:30 pm and 12:00 am run on', () => {
    const t = times('11:00 pm', '11:30 pm', '12:00 am', '12:30 am')
    expect(t.slice(1)).toEqual([1380, 1410, 1440, 1470])
    expect(nowPlace(t, 30, at(0, 10))).toEqual({ row: 3, fraction: 1 / 3, pastEnd: 3 })
    expect(nowPlace(t, 30, at(23, 45))?.row).toBe(2)
  })

  it('reads the Mac\'s time styles: 9:00 am, 9am, 930am, 09:00, 21:30 (the same time is no new day)', () => {
    expect(times('9:00 am', '9am', '930am', '09:00', '21:30', '9').slice(1)).toEqual([540, 540, 570, 540 + 1440, 1290 + 1440, null])
    expect(minutesOf(new Date(2026, 0, 1, 13, 7))).toBe(787)
  })
})

describe('the marks on a page (YAZ-5493)', () => {
  it('the comment makes the table a calendar; the rows before now dim, the now row carries its place; a nodim row never dims', async () => {
    const body = await draw(CALENDAR_PAGE)
    const t = body.querySelector('table')!
    expect(t.getAttribute('data-calendar')).toBe('30')
    expect(t.rows[1]!.hasAttribute('data-nodim')).toBe(true)
    // 9:40: rows 2-6 (7:00 .. 9:00) are past, row 7 (9:30) is now, a third down; row 1 (To-do) is kept.
    markCalendar(t, minutesOf(CALENDAR_NOW))
    expect(rowsOf(t, 'table-past-row')).toEqual([2, 3, 4, 5, 6])
    expect(rowsOf(t, 'table-now-row')).toEqual([7])
    expect(t.rows[7]!.style.getPropertyValue('--table-now')).toBe('0.333')
    // The Mac's default look.
    expect(t.getAttribute('data-now-mark')).toBe('line')
    expect(t.getAttribute('data-dim-past')).toBe('shade')
    expect(t.style.getPropertyValue('--table-past-shade')).toBe('6%')
  })

  it('a plain table gets no marks; a merged time cell is one slot as long as its rows', async () => {
    const plain = (await draw(table(['| 9:00 am | a |'], '<!-- table: stripes -->'))).querySelector('table')!
    expect(plain.hasAttribute('data-calendar')).toBe(false)
    const merged = (await draw(table(['| 9:00 am | a |', '|  | b |', '| 10:00 am | c |'], '<!-- table: merge A2:A3, calendar 30m -->'))).querySelector('table')!
    markCalendar(merged, at(9, 45))
    expect(rowsOf(merged, 'table-now-row')).toEqual([1])
    expect(merged.rows[1]!.style.getPropertyValue('--table-now')).toBe('0.75')
  })

  it('the past and the now marks follow the minute, and leave a row that is no longer now', async () => {
    const t = (await draw(CALENDAR_PAGE)).querySelector('table')!
    markCalendar(t, at(9, 40))
    markCalendar(t, at(10, 5))
    expect(rowsOf(t, 'table-now-row')).toEqual([8])
    expect(t.rows[7]!.style.getPropertyValue('--table-now')).toBe('')
    expect(rowsOf(t, 'table-past-row')).toEqual([2, 3, 4, 5, 6, 7])
    markCalendar(t, at(5, 0))
    expect(rowsOf(t, 'table-past-row')).toEqual([])
    expect(rowsOf(t, 'table-now-row')).toEqual([])
  })

  it('the line moves by transform only (no layout property), from `--table-now`', () => {
    const css = styles[2]!.textContent ?? ''
    const rules = css.slice(css.indexOf('/* Calendar tables (`tableCalendar.ts`)'), css.indexOf('/* Go to now'))
    expect(rules).toContain('transform: translateY(calc(var(--table-now, 0) * 100%))')
    expect(rules).not.toMatch(/\b(top|height|margin-top)\s*:\s*calc\(var\(--table-now/)
  })
})

describe('the clock (YAZ-5493)', () => {
  it('marks at once, then each minute, a little after it turns; no timer without a calendar table', async () => {
    vi.useFakeTimers({ now: new Date(2026, 10, 14, 9, 40, 30) })
    const body = await draw(CALENDAR_PAGE)
    const t = body.querySelector('table')!
    const watch = watchCalendars(body)
    expect(rowsOf(t, 'table-now-row')).toEqual([7])
    const before = t.rows[7]!.style.getPropertyValue('--table-now')
    vi.advanceTimersByTime(30_100)
    expect(t.rows[7]!.style.getPropertyValue('--table-now')).not.toBe(before)
    expect(t.rows[7]!.style.getPropertyValue('--table-now')).toBe('0.367')
    // Twenty minutes later: the 10:00 row.
    vi.advanceTimersByTime(20 * 60_000)
    expect(rowsOf(t, 'table-now-row')).toEqual([8])
    watch.stop()
    expect(vi.getTimerCount()).toBe(0)
    const plain = await draw('| a | b |\n| --- | --- |\n| 1 | 2 |\n')
    const none = watchCalendars(plain)
    expect(vi.getTimerCount()).toBe(0)
    none.stop()
  })

  it('the app back in front marks at once (a hidden phone skips the minute)', async () => {
    let clock = new Date(2026, 10, 14, 9, 40)
    setCalendarClock(() => clock)
    const body = await draw(CALENDAR_PAGE)
    const t = body.querySelector('table')!
    const watch = watchCalendars(body)
    expect(rowsOf(t, 'table-now-row')).toEqual([7])
    clock = new Date(2026, 10, 14, 13, 10)
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(rowsOf(t, 'table-now-row')).toEqual([7])
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(rowsOf(t, 'table-now-row')).toEqual([14])
    watch.stop()
    delete (document as { hidden?: boolean }).hidden
  })

  it('the full-screen copy shows now and moves with the page', async () => {
    let clock = new Date(2026, 10, 14, 9, 40)
    setCalendarClock(() => clock)
    const body = await draw(CALENDAR_PAGE)
    const watch = watchTables(body, async () => ({ showTable }))
    body.querySelector<HTMLElement>('[data-table-open]')!.click()
    await vi.waitFor(() => expect(document.querySelector('.table-view table')).not.toBeNull())
    const copy = document.querySelector<HTMLTableElement>('.table-view table')!
    expect(rowsOf(copy, 'table-now-row')).toEqual([7])
    clock = new Date(2026, 10, 14, 11, 0)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(rowsOf(copy, 'table-now-row')).toEqual([10])
    expect(rowsOf(copy, 'table-past-row')).toEqual([2, 3, 4, 5, 6, 7, 8, 9])
    watch.stop()
  })
})

describe('go to now (YAZ-5493)', () => {
  it('a Now pill after the table, hidden until its row is off the screen; a tap brings the row to the middle', async () => {
    setCalendarClock(() => CALENDAR_NOW)
    const body = await draw(CALENDAR_PAGE)
    const watch = watchCalendars(body)
    const chip = body.querySelector<HTMLButtonElement>('.page-table-box > .page-table__now-anchor > [data-table-now]')!
    expect(chip).not.toBeNull()
    expect(chip.hidden).toBe(true)
    const row = body.querySelector('table')!.rows[7]!
    const scroll = vi.fn()
    row.scrollIntoView = scroll
    chip.click()
    expect(scroll).toHaveBeenCalledWith({ block: 'center', inline: 'nearest' })
    watch.stop()
  })

  it('none with `nonow`, nor with the Now button off', async () => {
    const off = await draw(CALENDAR_PAGE.replace('calendar 30m', 'calendar 30m, nonow'))
    const a = watchCalendars(off)
    expect(off.querySelector('[data-table-now]')).toBeNull()
    a.stop()
    const body = await draw(CALENDAR_PAGE)
    const b = watchCalendars(body, { look: calendarLook({ nowButton: false }) })
    expect(body.querySelector('[data-table-now]')).toBeNull()
    b.stop()
  })
})

describe('the next time slot (YAZ-5541)', () => {
  const on = calendarLook({ nextShade: true })
  it('only with Shade the next time slot on: the body row right after the now row; it follows the minute and leaves the old row', async () => {
    const t = (await draw(CALENDAR_PAGE)).querySelector('table')!
    markCalendar(t, at(9, 40))
    expect(rowsOf(t, 'table-next-row')).toEqual([])
    markCalendar(t, at(9, 40), on)
    expect(rowsOf(t, 'table-now-row')).toEqual([7])
    expect(rowsOf(t, 'table-next-row')).toEqual([8])
    expect(rowsOf(t, 'table-past-row')).not.toContain(8)
    markCalendar(t, at(10, 5), on)
    expect(rowsOf(t, 'table-next-row')).toEqual([9])
    // Off again: the class goes.
    markCalendar(t, at(10, 5))
    expect(rowsOf(t, 'table-next-row')).toEqual([])
  })

  it('before the first slot: the first slot; the now row the last, or after the last slot: none', async () => {
    const t = (await draw(table(['| 9:00 am | a |', '| 9:30 am | b |'], '<!-- table: calendar 30m -->'))).querySelector('table')!
    markCalendar(t, at(8, 0), on)
    expect(rowsOf(t, 'table-next-row')).toEqual([1])
    markCalendar(t, at(9, 45), on)
    expect(rowsOf(t, 'table-now-row')).toEqual([2])
    expect(rowsOf(t, 'table-next-row')).toEqual([])
    markCalendar(t, at(11, 0), on)
    expect(rowsOf(t, 'table-next-row')).toEqual([])
  })

  it('its colour: `--table-next-colour` on the table when the vault picked one; none for the default red', async () => {
    const t = (await draw(CALENDAR_PAGE)).querySelector('table')!
    markCalendar(t, at(9, 40), calendarLook({ nextShade: true, nextColour: 'var(--table-text-teal)' }))
    expect(t.style.getPropertyValue('--table-next-colour')).toBe('var(--table-text-teal)')
    markCalendar(t, at(9, 40), on)
    expect(t.style.getPropertyValue('--table-next-colour')).toBe('')
  })

  it('tables.css tints it at the now tint\'s 12%, in `--table-next-colour` or the now mark\'s red', () => {
    const css = (styles[2]!.textContent ?? '').replace(/\/\*[\s\S]*?\*\//g, '')
    const now = /\.table-now-row > :is\(th, td\) \{\s*background-image: linear-gradient\(color-mix\(in srgb, var\(--table-text-red\) (\d+)%/.exec(css)?.[1]
    const next = /\.table-next-row > :is\(th, td\) \{\s*background-image: linear-gradient\(color-mix\(in srgb, var\(--table-next-colour, var\(--table-text-red\)\) (\d+)%/.exec(css)?.[1]
    expect([now, next]).toEqual(['12', '12'])
  })
})

describe('the next time slot at the day\'s edges (YAZ-5557)', () => {
  const on = calendarLook({ nextShade: true })
  const marks = (t: HTMLTableElement) => ({ now: rowsOf(t, 'table-now-row'), next: rowsOf(t, 'table-next-row'), past: rowsOf(t, 'table-past-row') })
  /** A night: rows after midnight count on (the 12:00 am row is the next day). */
  const NIGHT = table(['| 10:00 pm | a |', '| 11:00 pm | b |', '| 12:00 am | c |', '| 1:00 am | d |'], '<!-- table: calendar 60m -->')

  it('after midnight: the next slot of 11:40 pm is the 12:00 am row; at 12:20 am the 1:00 am row', async () => {
    const t = (await draw(NIGHT)).querySelector('table')!
    markCalendar(t, at(23, 40), on)
    expect(marks(t)).toEqual({ now: [2], next: [3], past: [1] })
    markCalendar(t, at(0, 20), on)
    expect(marks(t)).toEqual({ now: [3], next: [4], past: [1, 2] })
  })

  it('the day ends: now in the last row (after midnight too) and after the last slot, no next row', async () => {
    const t = (await draw(NIGHT)).querySelector('table')!
    markCalendar(t, at(1, 30), on)
    expect(marks(t)).toEqual({ now: [4], next: [], past: [1, 2, 3] })
    // 2:30 am: after the last slot (it ended at 2:00 am); before 10 pm today, so the first slot is the next to come.
    markCalendar(t, at(2, 30), on)
    expect(marks(t)).toEqual({ now: [], next: [1], past: [] })
    // A day that ends at 6 pm: at 7 pm every row is past and none is next.
    const day = (await draw(table(['| 4:00 pm | a |', '| 5:00 pm | b |'], '<!-- table: calendar 60m -->'))).querySelector('table')!
    markCalendar(day, at(19, 0), on)
    expect(marks(day)).toEqual({ now: [], next: [], past: [1, 2] })
  })

  it('now in the last row, with a row of no time under it: that row is next (as the Mac); with nothing under it, none', async () => {
    const t = (await draw(table(['| 9:00 am | a |', '| 9:30 am | b |', '| Notes | c |'], '<!-- table: calendar 30m -->'))).querySelector('table')!
    markCalendar(t, at(9, 45), on)
    expect(marks(t)).toEqual({ now: [2], next: [3], past: [1] })
    const last = (await draw(table(['| 9:00 am | a |', '| 9:30 am | b |'], '<!-- table: calendar 30m -->'))).querySelector('table')!
    markCalendar(last, at(9, 59), on)
    expect(marks(last)).toEqual({ now: [2], next: [], past: [1] })
  })

  it('a folded run: the phone draws no fold (every row of the run shows), so the next row is the row right after the now row', async () => {
    const times = ['5:00 pm', '5:30 pm', '6:00 pm', '6:30 pm', '7:00 pm'].map((time) => `| ${time} | |`)
    const t = (await draw(table(times, '<!-- table: fold 3-5, calendar 30m -->'))).querySelector('table')!
    expect([t.rows.length, [...t.rows].every((row) => !row.hidden)]).toEqual([6, true])
    // Now in the run's rows: the next is the row under it, also inside the run (each is on the screen).
    markCalendar(t, at(18, 15), on)
    expect(marks(t)).toEqual({ now: [3], next: [4], past: [1, 2] })
    // Now right above the run: its first row.
    markCalendar(t, at(17, 10), on)
    expect(marks(t)).toEqual({ now: [1], next: [2], past: [] })
    // Now in the run's last row, the table's last: none.
    markCalendar(t, at(19, 10), on)
    expect(marks(t)).toEqual({ now: [5], next: [], past: [1, 2, 3, 4] })
  })
})

describe('the look settings: the Mac defaults, through one function (YAZ-5493, for YAZ-5487)', () => {
  it("are the Mac's DEFAULT_SETTINGS", () => {
    expect(MAC_CALENDAR_LOOK).toEqual({
      nowMark: DEFAULT_SETTINGS.tableNowMark,
      nowButton: DEFAULT_SETTINGS.tableNowButton,
      dimPast: DEFAULT_SETTINGS.tableDimPast,
      shadeDarkness: DEFAULT_SETTINGS.tableShadeDarkness,
      dayStart: DEFAULT_SETTINGS.tableDayStart,
      dayEnd: DEFAULT_SETTINGS.tableDayEnd,
      nextShade: DEFAULT_SETTINGS.tableNextShade,
      // null: the CSS's own red (the Mac's default, `red`, is the now mark's red).
      nextColour: null,
    })
    expect(DEFAULT_SETTINGS.tableNextColour).toBe('red')
    expect([MAC_CALENDAR_LOOK.dayStart, MAC_CALENDAR_LOOK.dayEnd]).toEqual([DEFAULT_CALENDAR_DAY.start, DEFAULT_CALENDAR_DAY.end])
    expect([SHADE_MIN, SHADE_MAX]).toEqual([TABLE_SHADE_MIN, TABLE_SHADE_MAX])
    expect(calendarLook()).toEqual(MAC_CALENDAR_LOOK)
  })

  it('a vault file can feed it later: good values are taken, bad ones fall back', () => {
    expect(calendarLook({ nowMark: 'both', dimPast: 'text', shadeDarkness: 99, nowButton: false, dayStart: 360, dayEnd: 1200, nextShade: true, nextColour: 'var(--accent)' })).toEqual({ nowMark: 'both', dimPast: 'text', shadeDarkness: 30, nowButton: false, dayStart: 360, dayEnd: 1200, nextShade: true, nextColour: 'var(--accent)' })
    expect(calendarLook({ nowMark: 'red', dimPast: 7, shadeDarkness: 'dark', nowButton: 'yes', dayStart: 1200, dayEnd: 360, nextShade: 'on', nextColour: 3 })).toEqual(MAC_CALENDAR_LOOK)
  })

  it('the table takes the look it is given', async () => {
    const t = (await draw(CALENDAR_PAGE)).querySelector('table')!
    markCalendar(t, at(9, 40), calendarLook({ nowMark: 'tint', dimPast: 'off', shadeDarkness: 12 }))
    expect([t.getAttribute('data-now-mark'), t.getAttribute('data-dim-past'), t.style.getPropertyValue('--table-past-shade')]).toEqual(['tint', 'off', '12%'])
  })
})
