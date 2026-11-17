/**
 * Time in slot (YAZ-5602, Option A): the pill at the right end of the now line says the time left in the now row's slot
 * (count down) or since it started (count up), with seconds or in minutes; the Now button says it too. A slot runs from
 * its row's time to the next row's time. The clock sets the pill's text only: no transaction each second.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'
import { mount, unmountAll } from '../marks/markTestKit'
import { nowPlace, slotTimeLabel } from './tableCalendar'
import { TABLE_LOOK_DEFAULTS, type TableSlotTime } from '@shared/tableLook'
import { setAppTableLook } from './tableLook'

/** Time in slot is the vault's (YAZ-5602 round 2); an editor of no vault reads the app's look, set here. */
const setSlotTimeSetting = (mode: TableSlotTime, seconds: boolean): void => setAppTableLook({ ...TABLE_LOOK_DEFAULTS, tableSlotTime: mode, tableSlotSeconds: seconds })
import calendarCss from './tableCalendar.css?inline'

afterEach(async () => {
  await unmountAll()
  setSlotTimeSetting('off', true)
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** A calendar table: "Time | Plan | Lookback", one row per time, then its comment. */
const calendar = (rows: Array<[string, string, string?]>, part = 'calendar 30m'): string =>
  ['| Time | Plan | Lookback |', '| --- | --- | --- |', ...rows.map(([t, plan, look = ' ']) => `| ${t} | ${plan} | ${look} |`)].join('\n') + `\n\n<!-- table: ${part} -->\n`

const DAY: Array<[string, string, string?]> = [
  ['10:00 am', 'Inbox zero', 'Answered mail'],
  ['10:30 am', 'Write the launch post'],
  ['11:00 am', 'Lunch'],
  ['12:30 pm', 'Walk'],
]

const firstTable = (doc: ProseNode): ProseNode => {
  let out: ProseNode | null = null
  doc.descendants((node) => {
    if (out === null && node.type.name === 'table') out = node
    return out === null
  })
  return out!
}

/** Fake timers that move with real time, so the editor's own debounces still run; 200 ms into the second, so the real time a mount takes never turns a second. */
const fakeClock = (hours: number, minutes: number, seconds = 0) => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
  vi.setSystemTime(new Date(2026, 10, 2, hours, minutes, seconds, 200))
}

const pills = (view: EditorView) => [...view.dom.querySelectorAll<HTMLElement>('.table-slot-pill')]
const nowRow = (view: EditorView) => view.dom.querySelector<HTMLTableRowElement>('tr.table-now-row')

describe('what the pill says (slotTimeLabel)', () => {
  // The slot 10:30–11:00 am; now 10:40:46.
  const at = 10 * 3600 + 40 * 60 + 46
  it.each([
    ['down', true, '19:14 left'],
    ['down', false, '20 min left'],
    ['up', true, '10:46 in'],
    ['up', false, '10 min in'],
  ] as const)('%s, seconds %s: %s', (mode, seconds, text) => {
    expect(slotTimeLabel(mode, seconds, 630, 660, at)).toBe(text)
  })

  it('a slot of an hour or more adds the hours; minutes only, the count down rounds up and never reads 0', () => {
    // 10:30 am–12:00 pm (a 90-minute slot), at 10:40:46.
    expect(slotTimeLabel('down', true, 630, 720, at)).toBe('1:19:14 left')
    expect(slotTimeLabel('down', false, 630, 720, at)).toBe('1 h 20 min left')
    expect(slotTimeLabel('down', false, 630, 720, 630 * 60)).toBe('1 h 30 min left')
    expect(slotTimeLabel('down', false, 630, 690, 630 * 60)).toBe('1 h left')
    expect(slotTimeLabel('down', false, 630, 660, 660 * 60 - 1)).toBe('1 min left')
    expect(slotTimeLabel('down', true, 630, 660, 660 * 60 - 1)).toBe('0:01 left')
    expect(slotTimeLabel('up', true, 630, 720, 630 * 60 + 3725)).toBe('1:02:05 in')
  })

  it('stays inside the slot: never below 0, never over its length', () => {
    expect(slotTimeLabel('down', true, 630, 660, 661 * 60)).toBe('0:00 left')
    expect(slotTimeLabel('up', true, 630, 660, 629 * 60)).toBe('0:00 in')
    expect(slotTimeLabel('up', false, 630, 660, 700 * 60)).toBe('30 min in')
  })
})

describe('the slot (nowPlace): this row to the next row, any length', () => {
  it.each([
    [9 * 60 + 10, 1, 540, 570],
    // A 90-minute row.
    [10 * 60, 2, 570, 660],
    // A 15-minute row.
    [11 * 60 + 5, 3, 660, 675],
    // The 11:15 am row runs to 11:30 pm.
    [15 * 60, 4, 675, 1410],
    // Across midnight: 11:30 pm to 12:15 am.
    [23 * 60 + 50, 5, 1410, 1455],
    // After midnight (today's 00:20), the 12:15 am row: the last row, one slot (30 min) long.
    [20, 6, 15, 45],
  ])('at minute %i: row %i, %i–%i', async (minutes, row, start, end) => {
    const { view } = await mount(calendar([['9:00 am', 'a'], ['9:30 am', 'b'], ['11:00 am', 'c'], ['11:15 am', 'd'], ['11:30 pm', 'e'], ['12:15 am', 'f']]))
    expect(nowPlace(firstTable(view.state.doc), minutes)).toMatchObject({ row, start, end })
  })
})

describe('the pill on the now line', () => {
  it('Off (the default): no pill, and the Now button says "Now"', async () => {
    fakeClock(10, 40, 46)
    const { view } = await mount(calendar(DAY), { calendarClock: true })
    expect(nowRow(view)).not.toBeNull()
    expect(pills(view)).toEqual([])
  })

  it('Count down with seconds: the pill sits in the now row\'s last cell and ticks each second, with no transaction', async () => {
    setSlotTimeSetting('down', true)
    fakeClock(10, 40, 46)
    const { view } = await mount(calendar(DAY), { calendarClock: true })
    const [pill] = pills(view)
    expect(pill?.textContent).toBe('19:14 left')
    expect(pill!.closest('td')).toBe(nowRow(view)!.lastElementChild)
    const dispatch = vi.spyOn(view, 'dispatch')
    await vi.advanceTimersByTimeAsync(1000)
    expect(pills(view)[0]?.textContent).toBe('19:13 left')
    await vi.advanceTimersByTimeAsync(2000)
    expect(pills(view)[0]?.textContent).toBe('19:11 left')
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('minutes only ticks on the minute; Count up counts from the slot\'s start', async () => {
    setSlotTimeSetting('down', false)
    fakeClock(10, 40, 46)
    const { view } = await mount(calendar(DAY), { calendarClock: true })
    expect(pills(view)[0]?.textContent).toBe('20 min left')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(pills(view)[0]?.textContent).toBe('20 min left')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(pills(view)[0]?.textContent).toBe('19 min left')
    setSlotTimeSetting('up', false)
    expect(pills(view)[0]?.textContent).toBe('11 min in')
    setSlotTimeSetting('up', true)
    expect(pills(view)[0]?.textContent).toMatch(/^11:01 in$/)
  })

  it('moves to the next row with the line when the slot ends; a slot of 90 minutes counts its own length', async () => {
    setSlotTimeSetting('down', true)
    fakeClock(10, 59, 58)
    const { view } = await mount(calendar(DAY), { calendarClock: true })
    expect(pills(view)[0]?.textContent).toBe('0:02 left')
    await vi.advanceTimersByTimeAsync(3000)
    expect(pills(view)).toHaveLength(1)
    // 11:00 am–12:30 pm.
    expect(pills(view)[0]?.textContent).toBe('1:29:59 left')
    expect(nowRow(view)!.cells[0]!.textContent).toBe('11:00 am')
  })

  it('a setting changed in Settings draws the pill at once; Off takes it away', async () => {
    fakeClock(10, 40, 46)
    const { view } = await mount(calendar(DAY), { calendarClock: true })
    expect(pills(view)).toEqual([])
    setSlotTimeSetting('down', true)
    expect(pills(view).map((p) => p.textContent)).toEqual(['19:14 left'])
    setSlotTimeSetting('off', true)
    expect(pills(view)).toEqual([])
  })

  it('before the first row and after the last: no pill; the hover preview (no clock) has none', async () => {
    setSlotTimeSetting('down', true)
    fakeClock(8, 0)
    expect(pills((await mount(calendar(DAY), { calendarClock: true })).view)).toEqual([])
    fakeClock(14, 0)
    expect(pills((await mount(calendar(DAY), { calendarClock: true })).view)).toEqual([])
    fakeClock(10, 40)
    expect(pills((await mount(calendar(DAY))).view)).toEqual([])
  })

  it('a last cell with text gets the padding as wide as the pill; an empty one does not', async () => {
    setSlotTimeSetting('down', true)
    fakeClock(10, 10)
    const { view } = await mount(calendar(DAY), { calendarClock: true })
    const cell = nowRow(view)!.lastElementChild as HTMLElement
    expect(cell.textContent).toContain('Answered mail')
    expect(cell.classList.contains('table-slot-pad')).toBe(true)
    // "30:00 left": ten characters.
    expect(cell.style.getPropertyValue('--table-slot-chars')).toBe('10')
    vi.setSystemTime(new Date(2026, 10, 2, 10, 40, 0))
    await vi.advanceTimersByTimeAsync(61_000)
    const empty = nowRow(view)!.lastElementChild as HTMLElement
    expect(empty.classList.contains('table-slot-host')).toBe(true)
    expect(empty.classList.contains('table-slot-pad')).toBe(false)
  })

  it('YAZ-5658: the room only on the pill\'s lines: two floats at the start of the cell\'s first paragraph, no padding down the cell', async () => {
    setSlotTimeSetting('down', true)
    fakeClock(10, 10)
    const { view } = await mount(calendar(DAY), { calendarClock: true })
    const cell = nowRow(view)!.lastElementChild as HTMLElement
    const floats = cell.querySelector(':scope > p > .table-slot-floats')
    expect(floats?.parentElement?.firstChild).toBe(floats)
    expect([...floats!.children].map((c) => c.className)).toEqual(['table-slot-gap', 'table-slot-room'])
    // The paragraph's text is the cell's own: the floats hold none, and the doc does not change.
    expect(floats!.textContent).toBe('')
    expect(view.state.doc.textContent).not.toContain('table-slot')
    // No padding down the whole cell; a clipped (one-line) cell keeps the padding, without the floats.
    expect(calendarCss).not.toMatch(/\.table-slot-pad > p \{\s*padding-right/)
    expect(calendarCss).toMatch(/@container style\(--table-text: clip\) \{\s*\.table-slot-pad:not\(\[data-cell-text='wrap'\]\) > p \{\s*padding-right: var\(--table-clip-pad\);/)
    // "30:00 left": the room (and a clipped cell's padding) 10 × 7 + 26 px; the floats styled where they are made.
    expect(cell.style.getPropertyValue('--table-clip-pad')).toBe('96px')
    const room = floats!.querySelector<HTMLElement>('.table-slot-room')!
    expect([room.style.float, room.style.clear]).toEqual(['right', 'right'])
    // The clock places the gap and the room in the next frame, with `slotRooms.ts` loaded then (not in the first load).
    // Made at 0 px; placed, the room takes the pill's line (one line in a cell this test's DOM gives no height).
    expect(room.style.height).toBe('0px')
    await vi.advanceTimersByTimeAsync(20)
    await vi.waitFor(() => expect(parseFloat(room.style.height)).toBeGreaterThan(0))
    vi.setSystemTime(new Date(2026, 10, 2, 10, 40, 0))
    await vi.advanceTimersByTimeAsync(61_000)
    // An empty last cell: the pill, no room; the room left the cell it was in.
    expect(view.dom.querySelectorAll('.table-slot-floats')).toHaveLength(0)
  })

  it('a hidden window pauses the seconds; showing it reads the clock at once', async () => {
    setSlotTimeSetting('down', true)
    fakeClock(10, 40, 46)
    const { view } = await mount(calendar(DAY), { calendarClock: true })
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(5000)
    expect(pills(view)[0]?.textContent).toBe('19:14 left')
    hidden.mockReturnValue(false)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(pills(view)[0]?.textContent).toBe('19:09 left')
  })

  it('the Now button says the same time while the now row is off the screen: "Now · 19:14 left"', async () => {
    const observers: Array<(entries: Array<{ isIntersecting: boolean; target?: Element }>) => void> = []
    vi.stubGlobal('IntersectionObserver', class {
      constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) {
        observers.push(cb)
      }
      observe() {}
      disconnect() {}
    })
    setSlotTimeSetting('down', true)
    fakeClock(10, 40, 46)
    const { view } = await mount(calendar(DAY), { calendarClock: true })
    const label = view.dom.querySelector('.table-now-chip__label')!
    expect(label.textContent).toBe('Now · 19:14 left')
    await vi.advanceTimersByTimeAsync(1000)
    expect(label.textContent).toBe('Now · 19:13 left')
    setSlotTimeSetting('off', true)
    expect(label.textContent).toBe('Now')
  })
})

describe('the pill in tableCalendar.css', () => {
  const rules = [...calendarCss.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selector: selector.trim(), body }))
  const rule = (part: string) => rules.find(({ selector }) => selector.endsWith(part))?.body ?? ''

  it('out of the flow, on the line inside the row, stuck to the visible right edge (YAZ-5700: over the text there, on its own background), tabular digits', () => {
    expect(rule('.table-slot-anchor')).toMatch(/position:\s*absolute/)
    expect(rule('.table-slot-track')).toMatch(/top:\s*clamp\(0px, calc\(var\(--table-now, 0\) \* 100% - 10px\), calc\(100% - 20px\)\)/)
    expect(rule('.table-slot-pill')).toMatch(/position:\s*sticky/)
    expect(rule('.table-slot-pill')).toMatch(/right:\s*6px/)
    expect(rule('.table-slot-pill')).toMatch(/background:\s*var\(--bg\)/)
    expect(calendarCss).not.toContain('--slot-side')
    expect(rule('.table-slot-pill')).toMatch(/font-variant-numeric:\s*tabular-nums/)
    expect(rule('.table-slot-pill')).toMatch(/color:\s*var\(--table-text-red\)/)
  })

  it('a frozen last cell keeps its sticky position', () => {
    const host = rules.find(({ selector }) => selector.includes('.table-slot-host'))!
    expect(host.selector).toContain(':not(.table-frozen-col, .table-frozen-row > *)')
  })
})
