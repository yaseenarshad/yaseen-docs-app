/**
 * Starting a calendar table (YAZ-4163, YAZ-4159 D7 / D8 / D15): the time format (`shared/timeFormat.ts`), the format a
 * table already has, a slot change that keeps all text (`slotTimes`), "Time slots" in the six-dot menu, and the time
 * format of new tables and of "Current time".
 */
import { afterEach, describe, expect, it } from 'vitest'
import { undo, undoDepth } from '@milkdown/kit/prose/history'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'
import { DEFAULT_CALENDAR_DAY, DEFAULT_TIME_FORMAT, TIME_FORMAT_STYLES, detectTimeFormat, formatTime, timeFormatProblem } from '@shared/timeFormat'
import { getMarkdownForSave } from '../createCrepe'
import { mount, unmountAll } from '../marks/markTestKit'
import { formatCurrentTime } from '../slashMenu'
import type { MenuChoiceField, MenuItem } from '../blockHandleMenu'
import { calendarTableNode, fillCalendarDay, setTimeSlots, slotTimes } from './tableCalendar'
import { tableRows } from './tableRows'
import { setCalendarDaySetting, setTimeFormatSetting } from './timeFormatSetting'

afterEach(async () => {
  setTimeFormatSetting(DEFAULT_TIME_FORMAT)
  setCalendarDaySetting(DEFAULT_CALENDAR_DAY.start, DEFAULT_CALENDAR_DAY.end)
  await unmountAll()
})

const table = (rows: string[][], part = 'calendar 30m'): string =>
  [`| ${rows[0].join(' | ')} |`, `| ${rows[0].map(() => '---').join(' | ')} |`, ...rows.slice(1).map((r) => `| ${r.join(' | ')} |`)].join('\n') + (part === '' ? '\n' : `\n\n<!-- table: ${part} -->\n`)

const firstTable = (doc: ProseNode): { node: ProseNode; pos: number } => {
  let out: { node: ProseNode; pos: number } | null = null
  doc.descendants((node, pos) => {
    if (out === null && node.type.name === 'table') out = { node, pos }
    return out === null
  })
  return out!
}

/** Each row's cells as text. */
const cellsOf = (node: ProseNode): string[][] => {
  const rows: string[][] = []
  node.forEach((row) => {
    const cells: string[] = []
    row.forEach((cell) => cells.push(cell.textContent))
    rows.push(cells)
  })
  return rows
}

describe('the time format (D15)', () => {
  it('the ready styles are 9:00 am, 9:00am, 9am / 9:30am and 09:00; the default is 9:00 am', () => {
    expect(TIME_FORMAT_STYLES.map((style) => formatTime(style, 540))).toEqual(['9:00 am', '9:00am', '9am', '09:00'])
    expect(formatTime(TIME_FORMAT_STYLES[2], 570)).toBe('9:30am')
    expect(DEFAULT_TIME_FORMAT).toBe('h:mm a')
  })

  it('formats every token, after midnight too, and keeps [text]', () => {
    expect(formatTime('h:mm a', 0)).toBe('12:00 am')
    expect(formatTime('h:mm A', 750)).toBe('12:30 PM')
    expect(formatTime('hh:mma', 545)).toBe('09:05am')
    expect(formatTime('H:mm', 1290)).toBe('21:30')
    expect(formatTime('HH:mm', 1440 + 30)).toBe('00:30')
    expect(formatTime('[at ]h:mm a', 600)).toBe('at 10:00 am')
  })

  it('( ) holds a part shown only when the minutes are not 00 (the YAZ-4163 demo): 9am, 9:30am, 930am', () => {
    expect([formatTime('h(:mm)a', 540), formatTime('h(:mm)a', 570), formatTime('h(:mm) a', 1260)]).toEqual(['9am', '9:30am', '9 pm'])
    expect([formatTime('h(mm)a', 540), formatTime('h(mm)a', 570), formatTime('hmma', 540)]).toEqual(['9am', '930am', '900am'])
    expect(formatTime('[(]h:mm a[)]', 540)).toBe('(9:00 am)')
    for (const style of ['h(:mm)a', 'h(mm)a', 'hmma', 'h(:mm) A', 'H:mm']) expect(timeFormatProblem(style)).toBeNull()
    expect(timeFormatProblem('HHmm')).toMatch(/cannot read/)
  })

  it('refuses a custom style the reader cannot read back, and says why', () => {
    expect(timeFormatProblem('h a')).toMatch(/minutes/)
    expect(timeFormatProblem('h:mm')).toMatch(/a or A/)
    expect(timeFormatProblem('[at ]h:mm a')).toMatch(/cannot read/)
    expect(timeFormatProblem('H.mm')).toMatch(/cannot read/)
    for (const style of [...TIME_FORMAT_STYLES, 'hh:mm A', 'H:mm']) expect(timeFormatProblem(style)).toBeNull()
  })

  it.each<[string[], string | null]>([
    [['Time', '9:00 am', '9:30 am'], 'h:mm a'],
    [['9:00am'], 'h:mma'],
    [['09:00', '09:30'], 'HH:mm'],
    [['21:30', '7:00'], 'H:mm'],
    [['21:30'], 'HH:mm'],
    [['9am', '9:30am'], 'h(:mm)a'],
    [['9:00am', '9am'], 'h(:mm)a'],
    [['930am', '1000am'], 'hmma'],
    [['9am', '930am'], 'h(mm)a'],
    [['9 pm'], 'h(:mm) a'],
    [['09:00 AM'], 'hh:mm A'],
    [['Wake', 'Gym'], null],
  ])('a table with %j has the style %j', (texts, style) => {
    expect(detectTimeFormat(texts)).toBe(style)
  })
})

describe('"Current time" uses the setting (D15)', () => {
  it('writes the time in the time format, then " - "', () => {
    const at = new Date(2026, 10, 2, 21, 5)
    expect(formatCurrentTime(at)).toBe('9:05 pm - ')
    setTimeFormatSetting('HH:mm')
    expect(formatCurrentTime(at)).toBe('21:05 - ')
    setTimeFormatSetting('h:mm a')
    expect(formatCurrentTime(at)).toBe('9:05 pm - ')
  })
})

describe('a slot change keeps all text (D8)', () => {
  const HALF = [['Time', 'Plan'], ['7:00 am', 'Wake'], ['7:30 am', ''], ['8:00 am', ''], ['8:30 am', 'Gym'], ['9:00 am', '']]

  it('30 → 60: a row with text stays off the grid; an empty row off the grid goes', async () => {
    const { view } = await mount(table(HALF))
    const next = slotTimes(firstTable(view.state.doc).node, 60, view.state.schema)
    expect(next.attrs.calendar).toBe(60)
    expect(cellsOf(next)).toEqual([['Time', 'Plan'], ['7:00 am', 'Wake'], ['8:00 am', ''], ['8:30 am', 'Gym'], ['9:00 am', '']])
  })

  it('30 → 15: the missing grid times come back as empty rows, in the table\'s own format', async () => {
    const { view } = await mount(table([['Time', 'Plan'], ['7:00am', 'Wake'], ['7:30am', 'Gym']]))
    setTimeFormatSetting('HH:mm')
    const next = slotTimes(firstTable(view.state.doc).node, 15, view.state.schema)
    expect(cellsOf(next)).toEqual([['Time', 'Plan'], ['7:00am', 'Wake'], ['7:15am', ''], ['7:30am', 'Gym']])
  })

  it('a row with no time stays after the row above it; a table that runs past midnight keeps its order', async () => {
    const { view } = await mount(table([['Time', 'Plan'], ['11:00 pm', ''], ['Note', 'x'], ['12:00 am', 'Sleep'], ['1:00 am', '']], 'calendar 60m'))
    const next = slotTimes(firstTable(view.state.doc).node, 30, view.state.schema)
    expect(cellsOf(next)).toEqual([['Time', 'Plan'], ['11:00 pm', ''], ['Note', 'x'], ['11:30 pm', ''], ['12:00 am', 'Sleep'], ['12:30 am', ''], ['1:00 am', '']])
  })

  it('a slot change in a real editor is one transaction and one undo step; ⌘Z gives the table back', async () => {
    const { crepe, view } = await mount(table(HALF))
    const before = getMarkdownForSave(crepe)
    const depth = undoDepth(view.state)
    setTimeSlots(view, firstTable(view.state.doc).pos, 60)
    expect(undoDepth(view.state)).toBe(depth + 1)
    expect(firstTable(view.state.doc).node.attrs.calendar).toBe(60)
    expect(getMarkdownForSave(crepe)).toContain('<!-- table: calendar 60m -->')
    undo(view.state, view.dispatch)
    expect(getMarkdownForSave(crepe)).toBe(before)
  })

  it('"Off" removes the part and keeps every row and its text', async () => {
    const { view } = await mount(table(HALF))
    const rows = cellsOf(firstTable(view.state.doc).node)
    setTimeSlots(view, firstTable(view.state.doc).pos, 0)
    expect(firstTable(view.state.doc).node.attrs.calendar).toBe(0)
    expect(cellsOf(firstTable(view.state.doc).node)).toEqual(rows)
  })

  it('"On" for a table with no times adds a "Time" column, a time in each row from the calendar day\'s start (5:00 am), in the setting\'s format', async () => {
    const { view } = await mount(table([['Plan', 'Notes'], ['Wake', ''], ['', 'x'], ['Gym', '']], ''))
    setTimeFormatSetting('h:mm a')
    setTimeSlots(view, firstTable(view.state.doc).pos, 30)
    const { node } = firstTable(view.state.doc)
    expect(node.attrs.calendar).toBe(30)
    expect(cellsOf(node)).toEqual([['Time', 'Plan', 'Notes'], ['5:00 am', 'Wake', ''], ['5:30 am', '', 'x'], ['6:00 am', 'Gym', '']])
  })
})

describe('new time rows and cells take the vertical alignment of the time column (YAZ-4176)', () => {
  /** Column A's vertical alignment in each row. */
  const valignsOf = (node: ProseNode): unknown[] => {
    const out: unknown[] = []
    node.forEach((row) => out.push(row.firstChild!.attrs.valign))
    return out
  }

  it('"On" for a table with no times: the new Time cells are in the middle, as "/Calendar table" makes them', async () => {
    const { view } = await mount(table([['Plan', 'Notes'], ['Wake', ''], ['Gym', '']], ''))
    setTimeSlots(view, firstTable(view.state.doc).pos, 30)
    expect(valignsOf(firstTable(view.state.doc).node)).toEqual([null, 'middle', 'middle'])
  })

  it('"Fill the calendar day": a new first row takes the first body row\'s alignment, not the header row\'s', async () => {
    const { view } = await mount(table([['Time', 'Plan'], ['7:00 am', 'Wake'], ['7:30 am', '']], 'valign A2:A3 middle, calendar 30m'))
    setCalendarDaySetting(6 * 60, 8 * 60)
    fillCalendarDay(view, firstTable(view.state.doc).pos)
    const { node } = firstTable(view.state.doc)
    expect(cellsOf(node).map(([time]) => time)).toEqual(['Time', '6:00 am', '6:30 am', '7:00 am', '7:30 am', '8:00 am'])
    expect(valignsOf(node)).toEqual([null, 'middle', 'middle', 'middle', 'middle', 'middle'])
  })
})

describe('"Time slots" in the six-dot menu (D7)', () => {
  const menu = (view: EditorView): MenuItem[] => tableRows(view, { inside: firstTable(view.state.doc).pos + 3 } as Parameters<typeof tableRows>[1], undefined as never)
  const slots = (view: EditorView) => menu(view).find((item) => 'label' in item && item.label === 'Time slots') as MenuChoiceField

  it('shows Off / 15 min / 30 min / 1 hour with the current value; a pick sets it', async () => {
    const { view } = await mount(table([['Time', 'Plan'], ['7:00 am', ''], ['8:00 am', '']], ''))
    const field = slots(view)
    // Off is the default: the menu reads "Default (Off)" and lists it once (`defaultOnce`, YAZ-3791).
    expect(field.choices.map((c) => c.label)).toEqual(['Off', '15 min', '30 min', '1 hour'])
    expect([field.value, field.fallback, field.defaultOnce]).toEqual([null, '0', true])
    field.run('60')
    expect(firstTable(view.state.doc).node.attrs.calendar).toBe(60)
    expect(slots(view).value).toBe('60')
  })
})

describe('"/Calendar table" makes the table (D7, D10)', () => {
  it('Time | Plan 1, a row each 30 minutes of the calendar day (5:00 am to 10:00 pm by default) in the time format, calendar 30m, compact rows, the header row and column A frozen', async () => {
    const { view } = await mount('x\n')
    setTimeFormatSetting('h:mm a')
    const node = calendarTableNode(view.state.schema)
    expect(node.attrs).toMatchObject({ calendar: 30, height: 'compact', freezeRows: 1, freezeCols: 1 })
    const rows = cellsOf(node)
    expect(rows[0]).toEqual(['Time', 'Plan 1'])
    expect(rows.slice(1).map(([time]) => time)).toEqual(Array.from({ length: 35 }, (_, i) => formatTime('h:mm a', 300 + 30 * i)))
    expect(rows.at(-1)).toEqual(['10:00 pm', ''])
  })

  it('follows Settings › Tables › Calendar day: 6:00 am to 8:00 pm gives those rows', async () => {
    const { view } = await mount('x\n')
    setTimeFormatSetting('h:mm a')
    setCalendarDaySetting(6 * 60, 20 * 60)
    const times = cellsOf(calendarTableNode(view.state.schema)).slice(1).map(([time]) => time)
    expect([times.length, times[0], times.at(-1)]).toEqual([29, '6:00 am', '8:00 pm'])
  })

  it('a day whose end is not after its start is the default day', async () => {
    const { view } = await mount('x\n')
    setTimeFormatSetting('h:mm a')
    setCalendarDaySetting(20 * 60, 6 * 60)
    const times = cellsOf(calendarTableNode(view.state.schema)).slice(1).map(([time]) => time)
    expect([times[0], times.at(-1)]).toEqual(['5:00 am', '10:00 pm'])
  })
})

describe('"Fill the calendar day" (YAZ-4163 demo): the rows of the day that a calendar table does not have yet', () => {
  const menu = (view: EditorView): MenuItem[] => tableRows(view, { inside: firstTable(view.state.doc).pos + 3 } as Parameters<typeof tableRows>[1], undefined as never)
  const fill = (view: EditorView) => menu(view).find((item) => 'label' in item && item.label.startsWith('Fill the calendar day')) as (MenuItem & { label: string; disabled?: boolean; run: () => void }) | undefined

  it('adds an empty row for each slot of the day, before and after, in the table\'s own format; the rows and text it has stay; one undo', async () => {
    const { view } = await mount(table([['Time', 'Plan'], ['7:00am', 'Wake'], ['7:30am', ''], ['8:00am', 'Gym']]))
    setCalendarDaySetting(6 * 60, 9 * 60)
    const before = view.state.doc
    expect(fillCalendarDay(view, firstTable(view.state.doc).pos)).toBe(true)
    expect(cellsOf(firstTable(view.state.doc).node)).toEqual([['Time', 'Plan'], ['6:00am', ''], ['6:30am', ''], ['7:00am', 'Wake'], ['7:30am', ''], ['8:00am', 'Gym'], ['8:30am', ''], ['9:00am', '']])
    undo(view.state, view.dispatch)
    // The table as it was (the editor keeps its empty line after a table at the end of the note).
    expect(firstTable(view.state.doc).node.eq(firstTable(before).node)).toBe(true)
  })

  it('keeps a row outside the day and a row with no time; a 1 hour table gets hours', async () => {
    const { view } = await mount(table([['Time', 'Plan'], ['8:00 am', 'Gym'], ['', 'note'], ['11:00 pm', 'Sleep']], 'calendar 60m'))
    setCalendarDaySetting(7 * 60, 10 * 60)
    fillCalendarDay(view, firstTable(view.state.doc).pos)
    expect(cellsOf(firstTable(view.state.doc).node)).toEqual([['Time', 'Plan'], ['7:00 am', ''], ['8:00 am', 'Gym'], ['', 'note'], ['9:00 am', ''], ['10:00 am', ''], ['11:00 pm', 'Sleep']])
  })

  it('the six-dot item names the day, shows on a calendar table only, and is off when the table has the whole day', async () => {
    setTimeFormatSetting('h:mm a')
    setCalendarDaySetting(7 * 60, 8 * 60)
    const { view } = await mount(table([['Time', 'Plan'], ['7:00 am', ''], ['7:30 am', '']]))
    expect(fill(view)?.label).toBe('Fill the calendar day (7:00 am – 8:00 am)')
    expect(fill(view)?.disabled).toBe(false)
    fill(view)!.run()
    expect(cellsOf(firstTable(view.state.doc).node).map(([time]) => time)).toEqual(['Time', '7:00 am', '7:30 am', '8:00 am'])
    expect(fill(view)?.disabled).toBe(true)
    expect(fillCalendarDay(view, firstTable(view.state.doc).pos)).toBe(false)
    const plain = await mount(table([['Time', 'Plan'], ['7:00 am', '']], ''))
    expect(fill(plain.view)).toBeUndefined()
  })
})
