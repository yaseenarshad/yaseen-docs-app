// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://app.example/"}
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nowPlace, rowTimes, secondsOf, slotPillChars, slotTimeLabel } from '@shared/tableSlots'
import { slotTimeLabel as macSlotTimeLabel } from '@client/editor/table/tableCalendar'
import { CALENDAR_PAGE } from '../dev/tableFixtures'
import { calendarLook } from './calendarLook'
import { renderPage, type PageLook } from './pageRender'
import { markCalendar, setCalendarClock, watchCalendars } from './tableCalendar'

/**
 * YAZ-5606 (the phone side of the Mac's YAZ-5602): Time in slot. The words of the pill are ONE function for the Mac and
 * the phone (`shared/tableSlots.ts`: `slotTimeLabel`); the phone draws the pill on the now line of a calendar table and
 * says it on the Now pill, from the vault's `look.slotTime` and `look.slotSeconds` (`tableLook.test.tsx` reads them from
 * table-look.json); its clock ticks each second only with seconds and only while a table with a pill shows. Made-up day.
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
/** Seconds from midnight. */
const hms = (h: number, m: number, s = 0) => h * 3600 + m * 60 + s
const min = (h: number, m: number) => h * 60 + m
const pills = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>('.table-slot-pill')].map((p) => [p.closest('tr')!.rowIndex, p.textContent])

afterEach(() => {
  document.querySelectorAll('.reader__body').forEach((el) => el.remove())
  setCalendarClock(null)
  vi.useRealTimers()
})

describe('the words of the pill: one function for the Mac and the phone (shared/tableSlots.ts)', () => {
  const s930 = [min(9, 30), min(10, 0)] as const
  it('is the Mac\'s own: the Mac\'s editor re-exports it', () => {
    expect(macSlotTimeLabel).toBe(slotTimeLabel)
  })

  it('count down and count up, with seconds: the time left rounds up as a timer does, the time in rounds down', () => {
    expect(slotTimeLabel('down', true, ...s930, hms(9, 40, 46))).toBe('19:14 left')
    expect(slotTimeLabel('down', true, ...s930, hms(9, 40, 45.2))).toBe('19:15 left')
    expect(slotTimeLabel('up', true, ...s930, hms(9, 40, 46))).toBe('10:46 in')
    expect(slotTimeLabel('up', true, ...s930, hms(9, 40, 46.9))).toBe('10:46 in')
  })

  it('seconds off: minutes, "N min left" and "N min in"; the last minute reads 1 min left, never 0', () => {
    expect(slotTimeLabel('down', false, ...s930, hms(9, 40, 46))).toBe('20 min left')
    expect(slotTimeLabel('up', false, ...s930, hms(9, 40, 46))).toBe('10 min in')
    expect(slotTimeLabel('down', false, ...s930, hms(9, 59, 30))).toBe('1 min left')
    expect(slotTimeLabel('down', false, ...s930, hms(9, 40))).toBe('20 min left')
    expect(slotTimeLabel('down', false, ...s930, hms(9, 40, 1))).toBe('20 min left')
    expect(slotTimeLabel('down', false, ...s930, hms(9, 41))).toBe('19 min left')
  })

  it('from an hour: h:mm:ss with seconds, "1 h 20 min" without, "2 h" on the hour', () => {
    const long = [min(9, 0), min(11, 0)] as const
    expect(slotTimeLabel('down', true, ...long, hms(9, 0))).toBe('2:00:00 left')
    expect(slotTimeLabel('down', false, ...long, hms(9, 0))).toBe('2 h left')
    expect(slotTimeLabel('down', true, ...long, hms(9, 39, 40))).toBe('1:20:20 left')
    expect(slotTimeLabel('down', false, ...long, hms(9, 39, 40))).toBe('1 h 21 min left')
    expect(slotTimeLabel('up', true, ...long, hms(10, 5, 9))).toBe('1:05:09 in')
    expect(slotTimeLabel('up', false, ...long, hms(10, 5, 9))).toBe('1 h 5 min in')
  })

  it('the slot\'s edges: its first second and its last; kept inside the slot', () => {
    expect(slotTimeLabel('down', true, ...s930, hms(9, 30))).toBe('30:00 left')
    expect(slotTimeLabel('up', true, ...s930, hms(9, 30))).toBe('0:00 in')
    expect(slotTimeLabel('down', true, ...s930, hms(9, 59, 59.5))).toBe('0:01 left')
    expect(slotTimeLabel('up', true, ...s930, hms(9, 59, 59.5))).toBe('29:59 in')
    expect(slotTimeLabel('down', false, ...s930, hms(9, 59, 59.5))).toBe('1 min left')
    expect(slotTimeLabel('up', false, ...s930, hms(9, 59, 59.5))).toBe('29 min in')
    // Outside the slot (a clock a little off): never more than the slot, never less than nothing.
    expect(slotTimeLabel('down', true, ...s930, hms(9, 20))).toBe('30:00 left')
    expect(slotTimeLabel('up', true, ...s930, hms(9, 20))).toBe('0:00 in')
    expect(slotTimeLabel('down', true, ...s930, hms(10, 0, 30))).toBe('0:00 left')
  })

  it('after midnight: a slot that ends at midnight, and a row after midnight (its slot in today\'s minutes)', () => {
    const t = rowTimes(['Time', '11:00 pm', '11:30 pm', '12:00 am', '12:30 am'])
    const late = nowPlace(t, 30, min(23, 50))!
    expect([late.row, late.start, late.end]).toEqual([2, min(23, 30), 1440])
    expect(slotTimeLabel('down', true, late.start, late.end, hms(23, 50))).toBe('10:00 left')
    const after = nowPlace(t, 30, min(0, 10))!
    expect([after.row, after.start, after.end]).toEqual([3, 0, 30])
    expect(slotTimeLabel('down', true, after.start, after.end, hms(0, 10))).toBe('20:00 left')
    expect(slotTimeLabel('up', false, after.start, after.end, hms(0, 10, 59))).toBe('10 min in')
    // The last row's slot runs one slot length past midnight.
    const last = nowPlace(t, 30, min(0, 45))!
    expect([last.row, last.start, last.end]).toEqual([4, 30, 60])
  })

  it('its widest text (the last cell\'s padding): a count down at the slot\'s start, a count up at its end; off, none', () => {
    expect(slotPillChars('down', true, min(9, 30), min(10, 0))).toBe('30:00 left'.length)
    expect(slotPillChars('up', false, min(9, 30), min(10, 0))).toBe('30 min in'.length)
    expect(slotPillChars('off', true, min(9, 30), min(10, 0))).toBe(0)
    expect(secondsOf(new Date(2026, 10, 14, 9, 40, 46, 500))).toBe(hms(9, 40, 46.5))
  })
})

describe('the pill on the phone\'s now line (markCalendar)', () => {
  it('Off: nothing changes, the table as before', async () => {
    const t = (await draw(CALENDAR_PAGE)).querySelector('table')!
    markCalendar(t, min(9, 40))
    const before = t.outerHTML
    markCalendar(t, min(9, 40), calendarLook({ slotTime: 'off' }), hms(9, 40, 46))
    expect(t.outerHTML).toBe(before)
    expect(t.querySelector('.table-slot-anchor')).toBeNull()
  })

  it('in the now row\'s last cell, on the line; it moves with the now row and goes with Off; column A\'s times stay its own', async () => {
    const t = (await draw(CALENDAR_PAGE)).querySelector('table')!
    const down = calendarLook({ slotTime: 'down' })
    expect(markCalendar(t, min(9, 40), down, hms(9, 40, 46))?.rowIndex).toBe(7)
    expect(pills(t)).toEqual([[7, '19:14 left']])
    const cell = t.rows[7].cells[t.rows[7].cells.length - 1]
    expect(cell.querySelector(':scope > .table-slot-anchor > .table-slot-track > .table-slot-pill')).not.toBeNull()
    // "Write the seed list" has an empty Where: the last cell has no text, so no padding.
    expect([cell.classList.contains('table-slot-host'), cell.classList.contains('table-slot-pad'), cell.style.getPropertyValue('--table-slot-chars')]).toEqual([true, false, '10'])
    markCalendar(t, min(10, 5), down, hms(10, 5))
    expect(pills(t)).toEqual([[8, '25:00 left']])
    expect(t.rows[8].cells[2].classList.contains('table-slot-pad')).toBe(true)
    expect(t.querySelectorAll('.table-slot-host')).toHaveLength(1)
    markCalendar(t, min(10, 5), calendarLook(), hms(10, 5))
    expect(t.querySelector('.table-slot-anchor, .table-slot-host')).toBeNull()
    expect(t.rows[8].cells[2].getAttribute('style') ?? '').not.toContain('--table-slot')
  })

  it('no now row (before the first slot, after the last): no pill', async () => {
    const t = (await draw(CALENDAR_PAGE)).querySelector('table')!
    markCalendar(t, min(23, 30), calendarLook({ slotTime: 'up' }), hms(23, 30))
    expect(pills(t)).toEqual([])
  })
})

describe('the clock: each second with seconds, only while a pill shows; each minute without', () => {
  it('with seconds: the text each second, the Now pill too, no transaction of the marks; hidden, no timer', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 14, 9, 40, 46))
    const body = await draw(CALENDAR_PAGE)
    const t = body.querySelector('table')!
    const watch = watchCalendars(body, { look: calendarLook({ slotTime: 'down' }), now: () => new Date() })
    expect(pills(t)).toEqual([[7, '19:14 left']])
    expect(body.querySelector('.page-table__now-label')?.textContent).toBe('Now · 19:14 left')
    const line = t.rows[7].style.getPropertyValue('--table-now')
    vi.advanceTimersByTime(1010)
    expect(pills(t)).toEqual([[7, '19:13 left']])
    expect(body.querySelector('.page-table__now-label')?.textContent).toBe('Now · 19:13 left')
    vi.advanceTimersByTime(3000)
    expect(pills(t)).toEqual([[7, '19:10 left']])
    // The line moves on the minute only.
    expect(t.rows[7].style.getPropertyValue('--table-now')).toBe(line)
    // Hidden: no timer at all; back in front, the text at once and the timers again.
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(vi.getTimerCount()).toBe(0)
    vi.setSystemTime(new Date(2026, 10, 14, 9, 45, 0))
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(pills(t)).toEqual([[7, '15:00 left']])
    expect(vi.getTimerCount()).toBe(2)
    watch.stop()
    expect(vi.getTimerCount()).toBe(0)
    delete (document as { hidden?: boolean }).hidden
  })

  it('without seconds: the minute\'s timer only, "N min left" set on the minute; Off: the minute\'s timer of before, no pill', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 14, 9, 40, 46))
    const body = await draw(CALENDAR_PAGE)
    const t = body.querySelector('table')!
    const watch = watchCalendars(body, { look: calendarLook({ slotTime: 'down', slotSeconds: false }), now: () => new Date() })
    expect(pills(t)).toEqual([[7, '20 min left']])
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(14_100)
    expect(pills(t)).toEqual([[7, '19 min left']])
    expect(body.querySelector('.page-table__now-label')?.textContent).toBe('Now · 19 min left')
    watch.stop()
    const plain = await draw(CALENDAR_PAGE)
    const off = watchCalendars(plain, { now: () => new Date() })
    expect(plain.querySelector('.table-slot-anchor')).toBeNull()
    expect(plain.querySelector('.page-table__now-label')?.textContent).toBe('Now')
    expect(vi.getTimerCount()).toBe(1)
    off.stop()
  })

  it('with seconds, no timer while the table is off the screen; on it again, the text at once and the timer', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 14, 9, 40, 46))
    const seen: Array<(entries: Array<Partial<IntersectionObserverEntry>>) => void> = []
    const targets: Element[] = []
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: (entries: Array<Partial<IntersectionObserverEntry>>) => void) {
          seen.push(cb)
        }
        observe(el: Element) {
          targets.push(el)
        }
        unobserve() {}
        disconnect() {}
      },
    )
    try {
      const body = await draw(CALENDAR_PAGE)
      const t = body.querySelector('table')!
      const box = body.querySelector('.page-table-box')!
      const watch = watchCalendars(body, { look: calendarLook({ slotTime: 'up' }), now: () => new Date() })
      expect(targets).toContain(box)
      // Not yet seen on the screen: the minute's timer only.
      expect(vi.getTimerCount()).toBe(1)
      vi.setSystemTime(new Date(2026, 10, 14, 9, 40, 50))
      seen[0]([{ target: box, isIntersecting: true }])
      expect(pills(t)).toEqual([[7, '10:50 in']])
      expect(vi.getTimerCount()).toBe(2)
      vi.advanceTimersByTime(1010)
      expect(pills(t)).toEqual([[7, '10:51 in']])
      seen[0]([{ target: box, isIntersecting: false }])
      expect(vi.getTimerCount()).toBe(1)
      watch.stop()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
