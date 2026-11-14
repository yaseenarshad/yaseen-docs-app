import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_FOLDER_PAGES, type IndexRecord, readColorStrength, writeColorStrength } from '@shared/types'
import type { Row } from './engine'
import { FileValue, fromYaml, render } from './expr'
import { addDays, bucketByDay, calLineColor, calLineCss, calendarDateKey, calendarStartColumn, calendarEndKey, daysBetween, layoutWeek, spanLabel, spanOf, type Span, dateColumns, dayOf, hideWeekendsDefault, hidesWeekends, monthStart, monthWeeks, movedDate, timeFirst, timeOf, dayLabel, weekDays, weekendHomes, weekendOf, weekLabel, withoutWeekends } from './calendar'
import type { ViewDef, ViewSet } from './viewSchema'

const rec = (name: string, properties: Record<string, unknown>): IndexRecord => ({
  path: `/vault/${name}.md`,
  name: `${name}.md`,
  basename: name,
  title: name,
  folder: '',
  ext: 'md',
  size: 0,
  ctime: 0,
  mtime: 0,
  properties,
  aliases: [],
  tags: [],
  links: [],
  embeds: [],
})
const row = (name: string, properties: Record<string, unknown>): Row => {
  const record = rec(name, properties)
  return { record, file: new FileValue(record), values: {} }
}

describe('dayOf (YAZ-4540 S3): the date part as written', () => {
  it('a bare date is its own day', () => {
    expect(dayOf('2026-12-03')).toBe('2026-12-03')
  })
  it('a time does not move the day', () => {
    expect(dayOf('2026-12-03 10:30')).toBe('2026-12-03')
    expect(dayOf('2026-12-03T23:59:59')).toBe('2026-12-03')
  })
  it('an impossible date such as 2026-02-30 has no day: its card goes to "No date" (YAZ-4635 P6)', () => {
    expect(dayOf('2026-02-30')).toBeNull()
    expect(dayOf('2026-02-30 09:00')).toBeNull()
    expect(dayOf('2026-04-31T10:00Z')).toBeNull()
    expect(dayOf('2026-02-28')).toBe('2026-02-28')
    expect(dayOf('2028-02-29')).toBe('2028-02-29')
    expect(bucketByDay([row('Odd', { due: '2026-02-30' })], 'due').undated.map((r) => r.record.title)).toEqual(['Odd'])
  })
  it('a time zone does not move the day (2026-12-03T23:30Z goes on Dec 3)', () => {
    expect(dayOf('2026-12-03T23:30Z')).toBe('2026-12-03')
    expect(dayOf('2026-12-03T00:30+05:00')).toBe('2026-12-03')
    expect(dayOf('2026-12-03T23:30-08:00')).toBe('2026-12-03')
  })
  it('a JS Date (YAML parses a bare date as UTC midnight) goes on its UTC date', () => {
    expect(dayOf(new Date(Date.UTC(2026, 11, 3)))).toBe('2026-12-03')
    expect(dayOf(new Date('2026-12-03T23:30Z'))).toBe('2026-12-03')
  })
  it('anything that is not a date has no day', () => {
    for (const raw of [undefined, null, '', 'soon', '2026-13-01', '2026-12-3', 42, true, ['2026-12-03'], new Date(NaN)]) expect(dayOf(raw)).toBeNull()
  })
})

describe('movedDate (YAZ-4540 D4): a move writes the day and keeps the time', () => {
  it('a bare date becomes the new day', () => {
    expect(movedDate('2026-12-03', '2026-12-09')).toBe('2026-12-09')
    expect(movedDate(undefined, '2026-12-09')).toBe('2026-12-09')
    expect(movedDate('soon', '2026-12-09')).toBe('2026-12-09')
  })
  it('a time (and its zone) is kept as written', () => {
    expect(movedDate('2026-12-03 10:30', '2026-12-09')).toBe('2026-12-09 10:30')
    expect(movedDate('2026-12-03T23:30Z', '2026-12-09')).toBe('2026-12-09T23:30Z')
    expect(movedDate('2026-12-03T08:00:00+02:00', '2026-01-31')).toBe('2026-01-31T08:00:00+02:00')
  })
  it('a JS Date keeps its UTC time, and a bare UTC midnight stays a bare date', () => {
    expect(movedDate(new Date(Date.UTC(2026, 11, 3)), '2026-12-09')).toBe('2026-12-09')
    expect(movedDate(new Date('2026-12-03T23:30Z'), '2026-12-09')).toBe('2026-12-09T23:30:00.000Z')
  })
})

describe('dayLabel (YAZ-4541 S6): the day a move toast names', () => {
  it('reads Dec 9, 2026', () => {
    expect(dayLabel('2026-12-09')).toBe('Dec 9, 2026')
    expect(dayLabel('2027-01-31')).toBe('Jan 31, 2027')
  })
})

describe('timeOf (YAZ-4540): the time a card shows', () => {
  it('reads HH:mm off a value with a time, and nothing off a bare date', () => {
    expect(timeOf('2026-12-03 10:30')).toBe('10:30')
    expect(timeOf('2026-12-03')).toBeNull()
    expect(timeOf('soon')).toBeNull()
    expect(timeOf(new Date())).toBeNull()
  })
})

describe('timeOf (YAZ-4544, finding 23): a time with a zone reads as the board and the table read it', () => {
  it('the local time of the app\'s date renderer, while the day stays the date part as written (S3)', () => {
    for (const raw of ['2026-11-30T23:45Z', '2026-12-03T08:15+05:30', '2026-12-03 10:30']) {
      const local = new Date(Date.parse(raw.replace(' ', 'T')))
      expect(timeOf(raw)).toBe(`${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`)
      expect(timeOf(raw)).toBe(render(fromYaml(raw)).slice(11, 16))
    }
    expect(dayOf('2026-11-30T23:45Z')).toBe('2026-11-30')
  })
})

describe('bucketByDay (YAZ-4540)', () => {
  it('puts each row on its day once, in row order, and the rest in the No date tray', () => {
    const rows = [row('a', { due: '2026-12-03' }), row('b', { due: '2026-12-03T23:30Z' }), row('c', {}), row('d', { due: 'later' }), row('e', { due: '2026-12-04 09:00' })]
    const { days, undated } = bucketByDay(rows, 'due')
    expect(days.get('2026-12-03')?.map((r) => r.record.title)).toEqual(['a', 'b'])
    expect(days.get('2026-12-04')?.map((r) => r.record.title)).toEqual(['e'])
    expect(undated.map((r) => r.record.title)).toEqual(['c', 'd'])
  })
  it('with no date key every row is undated', () => {
    const rows = [row('a', { due: '2026-12-03' })]
    expect(bucketByDay(rows, null).undated).toHaveLength(1)
  })
})

describe('monthWeeks (YAZ-4540 D11): Monday first', () => {
  it('December 2026 starts on a Tuesday: the grid opens on Monday Nov 30', () => {
    const weeks = monthWeeks(2026, 11)
    expect(weeks[0][0]).toBe('2026-11-30')
    expect(weeks[0][1]).toBe('2026-12-01')
    expect(weeks.at(-1)?.at(-1)).toBe('2027-01-03')
    expect(weeks.every((w) => w.length === 7)).toBe(true)
    expect(weeks).toHaveLength(5)
  })
  it('a month that starts on Monday opens on its 1st; one that needs six weeks has six', () => {
    expect(monthWeeks(2026, 5)[0][0]).toBe('2026-06-01')
    // March 2026 starts on a Sunday: 6 + 31 days need six weeks.
    expect(monthWeeks(2026, 2)).toHaveLength(6)
    expect(monthWeeks(2026, 2)[0][0]).toBe('2026-02-23')
  })
})

describe('Week starts on Sunday (YAZ-4585, Settings › Folder pages)', () => {
  it('monthWeeks: the grid opens on the Sunday before the 1st, and a month that starts on Sunday opens on it', () => {
    expect(monthWeeks(2026, 11, true)[0][0]).toBe('2026-11-29')
    expect(monthWeeks(2026, 11, true).at(-1)?.at(-1)).toBe('2027-01-02')
    expect(monthWeeks(2026, 2, true)[0][0]).toBe('2026-03-01')
    expect(monthWeeks(2026, 2, true)).toHaveLength(5)
  })
  it('weekDays: Sunday to Saturday of the week that holds the day; a Sunday starts its own week', () => {
    expect(weekDays('2026-12-10', true)).toEqual(['2026-12-06', '2026-12-07', '2026-12-08', '2026-12-09', '2026-12-10', '2026-12-11', '2026-12-12'])
    expect(weekDays('2026-12-06', true)[0]).toBe('2026-12-06')
    expect(weekDays('2026-12-05', true)[0]).toBe('2026-11-29')
  })
})

describe('the week view (YAZ-4558 D22)', () => {
  it('weekDays: Monday to Sunday of the week that holds the day', () => {
    expect(weekDays('2026-12-10')).toEqual(['2026-12-07', '2026-12-08', '2026-12-09', '2026-12-10', '2026-12-11', '2026-12-12', '2026-12-13'])
    // A Monday and a Sunday stay in their own week; a week may cross a month and a year.
    expect(weekDays('2026-11-30')[0]).toBe('2026-11-30')
    expect(weekDays('2026-12-06')).toEqual(weekDays('2026-11-30'))
    expect(weekDays('2027-01-01')).toEqual(['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03'])
  })
  it('addDays steps by days across months; monthStart steps by months across years', () => {
    expect(addDays('2026-11-30', 7)).toBe('2026-12-07')
    expect(addDays('2026-12-07', -7)).toBe('2026-11-30')
    expect(addDays('2026-12-28', 7)).toBe('2027-01-04')
    expect(monthStart('2026-12-10', 1)).toBe('2027-01-01')
    expect(monthStart('2026-01-31', -1)).toBe('2025-12-01')
    expect(monthStart('2026-12-10', 0)).toBe('2026-12-01')
  })
  it('weekLabel names the range: one year once, two years both', () => {
    expect(weekLabel(weekDays('2026-11-30'))).toBe('Nov 30 – Dec 6, 2026')
    expect(weekLabel(weekDays('2026-12-10'))).toBe('Dec 7 – Dec 13, 2026')
    expect(weekLabel(weekDays('2027-01-01'))).toBe('Dec 28, 2026 – Jan 3, 2027')
  })
  it('timeFirst: the cards with a time first, in time order, then the rest in row order', () => {
    const rows = [
      row('plain 1', { due: '2026-12-08' }),
      row('late', { due: '2026-12-08 15:00' }),
      row('plain 2', { due: '2026-12-08' }),
      row('early', { due: '2026-12-08 09:15' }),
      row('also early', { due: '2026-12-08 09:15' }),
    ]
    expect(timeFirst(rows, 'due').map((r) => r.record.title)).toEqual(['early', 'also early', 'late', 'plain 1', 'plain 2'])
  })
})

describe('dateColumns and calendarDateKey (YAZ-4540 D4)', () => {
  const def: ViewSet = { views: [] }
  const view: ViewDef = { type: 'calendar', name: 'C' }
  const records = [rec('a', { due: '2026-12-03', start: '2026-11-01 10:00', title2: 'x', n: 3 }), rec('b', { due: '2026-12-04', start: 'nope' })]
  it('lists declared Date columns and properties whose values are ISO dates', () => {
    const settings = { columns: { deadline: { kind: 'date' as const }, owner: { kind: 'text' as const } }, views: [], problems: [] }
    const keys = dateColumns(def, view, records, null, settings)
    expect(keys).toEqual(expect.arrayContaining(['note.due', 'note.start', 'note.deadline']))
    expect(keys).not.toContain('note.owner')
    expect(keys).not.toContain('note.n')
    expect(keys).not.toContain('note.title2')
  })
  it('a declared non-date column never shows, even when its values look like dates', () => {
    const settings = { columns: { due: { kind: 'text' as const } }, views: [], problems: [] }
    expect(dateColumns(def, view, records, null, settings)).not.toContain('note.due')
  })
  it('the date key is the saved dateProperty, else the first date column', () => {
    expect(calendarDateKey(view, ['note.due', 'note.start'], {})).toBe('due')
    expect(calendarDateKey({ ...view, dateProperty: 'note.start' }, ['note.due', 'note.start'], {})).toBe('start')
    expect(calendarDateKey({ ...view, dateProperty: 'note.seen_in' }, ['note.due'], { seen_in: { kind: 'mentions' } })).toBeNull() // 7A 28
    expect(calendarDateKey(view, [], {})).toBeNull()
  })
  it('YAZ-4866: with no dateProperty, the start is the first date column that is not the End date', () => {
    const withEnd: ViewDef = { ...view, endDateProperty: 'note.end' }
    expect(calendarDateKey(withEnd, ['note.end', 'note.start'], {})).toBe('start')
    expect(calendarStartColumn(withEnd, ['note.end', 'note.start'])).toBe('note.start')
    // Its own dateProperty always wins; a lone date column is still the start.
    expect(calendarDateKey({ ...withEnd, dateProperty: 'note.end' }, ['note.end', 'note.start'], {})).toBe('end')
    expect(calendarDateKey(withEnd, ['note.end'], {})).toBe('end')
  })
})

describe('hide weekends (YAZ-4595 S33)', () => {
  it('weekendOf names a Saturday and a Sunday, and nothing else', () => {
    expect(weekendOf('2026-12-05')).toBe('Sat')
    expect(weekendOf('2026-12-06')).toBe('Sun')
    expect(weekendOf('2026-12-04')).toBeNull()
    expect(weekendOf('2026-12-07')).toBeNull()
  })

  it('withoutWeekends keeps Monday to Friday of a week, in order', () => {
    expect(withoutWeekends(weekDays('2026-12-10'))).toEqual(['2026-12-07', '2026-12-08', '2026-12-09', '2026-12-10', '2026-12-11'])
  })

  // One rule for the grid and the mini window's order (YAZ-4635 P3): a Saturday goes to the Friday before; a Sunday too, unless
  // that Friday is off the grid — a Sunday-first grid opens on a Sunday — then it goes to the Monday after. No weekend card is lost.
  it('weekendHomes, Monday first: each Friday takes the Saturday and the Sunday after it, across a year', () => {
    const homes = weekendHomes(monthWeeks(2026, 11))
    expect(homes.get('2026-12-04')).toEqual(['2026-12-05', '2026-12-06'])
    expect(homes.get('2027-01-01')).toEqual(['2027-01-02', '2027-01-03'])
    expect(homes.get('2026-12-03')).toBeUndefined()
    expect([...homes.values()].flat()).toHaveLength(10)
  })

  it('weekendHomes, Sunday first: the grid\'s first Sunday goes to the Monday after it; every other weekend day to its Friday', () => {
    // November 2026 starts on a Sunday: the grid opens on Nov 1, whose Friday (Oct 30) is off the grid.
    const weeks = monthWeeks(2026, 10, true)
    expect(weeks[0][0]).toBe('2026-11-01')
    const homes = weekendHomes(weeks)
    expect(homes.get('2026-11-02')).toEqual(['2026-11-01'])
    expect(homes.get('2026-11-06')).toEqual(['2026-11-07', '2026-11-08'])
    expect(homes.get('2026-11-27')).toEqual(['2026-11-28', '2026-11-29'])
    // Every weekend day of the grid lands once, Saturday before Sunday.
    expect([...homes.values()].flat().sort()).toEqual(weeks.flat().filter((d) => weekendOf(d) !== null).sort())
    // Monday first, the same month: Oct 30 is on the grid, so Nov 1 goes there.
    expect(weekendHomes(monthWeeks(2026, 10)).get('2026-10-30')).toEqual(['2026-10-31', '2026-11-01'])
  })

  it('weekendHomes in Week: Sunday first, the Sunday goes to Monday and the Saturday to Friday; Monday first, both to Friday', () => {
    const sundayFirst = weekendHomes([weekDays('2026-11-04', true)])
    expect(sundayFirst.get('2026-11-02')).toEqual(['2026-11-01'])
    expect(sundayFirst.get('2026-11-06')).toEqual(['2026-11-07'])
    const mondayFirst = weekendHomes([weekDays('2026-11-04')])
    expect(mondayFirst.get('2026-11-06')).toEqual(['2026-11-07', '2026-11-08'])
    expect(mondayFirst.get('2026-11-02')).toBeUndefined()
  })

  it('the Settings default is off; a view key wins over it either way', () => {
    expect(hideWeekendsDefault(DEFAULT_FOLDER_PAGES)).toBe(false)
    expect(hideWeekendsDefault({ ...DEFAULT_FOLDER_PAGES, hideWeekends: true })).toBe(true)
    const view = (extra: Partial<ViewDef> = {}): ViewDef => ({ type: 'calendar', name: 'C', ...extra })
    expect(hidesWeekends(view(), false)).toBe(false)
    expect(hidesWeekends(view(), true)).toBe(true)
    expect(hidesWeekends(view({ hideWeekends: true }), false)).toBe(true)
    expect(hidesWeekends(view({ hideWeekends: false }), true)).toBe(false)
  })
})

describe('cards over several days (YAZ-4858)', () => {
  it('spanOf: start to end; an end with no start is its end day (item 5); an end on or before the start is one day', () => {
    expect(spanOf({ due: '2026-12-03 09:00', end: '2026-12-05' }, 'due', 'end')).toEqual({ start: '2026-12-03', end: '2026-12-05' })
    expect(spanOf({ end: '2026-12-05' }, 'due', 'end')).toEqual({ start: '2026-12-05', end: '2026-12-05' })
    expect(spanOf({ due: '2026-12-05', end: '2026-12-03' }, 'due', 'end')).toEqual({ start: '2026-12-05', end: '2026-12-05' })
    expect(spanOf({ due: '2026-12-05' }, 'due', null)).toEqual({ start: '2026-12-05', end: '2026-12-05' })
    expect(spanOf({}, 'due', 'end')).toBeNull()
  })

  it('bucketByDay: a span goes to `multi`, an end-only page on its end day, and a preview moves one card', () => {
    const rows = [row('Trip', { due: '2026-12-03', end: '2026-12-05' }), row('After', { end: '2026-12-07' }), row('One', { due: '2026-12-04' }), row('None', {})]
    const { days, multi, undated } = bucketByDay(rows, 'due', 'end')
    expect(multi.map((m) => [m.row.record.title, m.start, m.end])).toEqual([['Trip', '2026-12-03', '2026-12-05']])
    expect(days.get('2026-12-07')?.map((r) => r.record.title)).toEqual(['After'])
    expect(days.get('2026-12-04')?.map((r) => r.record.title)).toEqual(['One'])
    expect(undated.map((r) => r.record.title)).toEqual(['None'])
    // With no End date the calendar is as before: by the start alone.
    expect(bucketByDay(rows, 'due').multi).toEqual([])
    expect(bucketByDay(rows, 'due').undated.map((r) => r.record.title)).toEqual(['After', 'None'])
    const preview = bucketByDay(rows, 'due', 'end', { path: '/vault/One.md', start: '2026-12-04', end: '2026-12-06' })
    expect(preview.multi.map((m) => m.row.record.title)).toEqual(['Trip', 'One'])
    expect(preview.days.get('2026-12-04')).toBeUndefined()
  })

  const span = (name: string, start: string, end: string): Span => ({ row: row(name, {}), start, end })
  const WEEK = weekDays('2026-12-07') // Mon Dec 7 … Sun Dec 13
  const placed = (bars: ReturnType<typeof layoutWeek>['bars']) => bars.map((b) => [b.span.row.record.title, b.col, b.cols, b.lane, b.cutStart, b.cutEnd])

  it('layoutWeek: each bar cut to the row, in the first free lane; longer first on the same start', () => {
    const { bars, lanes } = layoutWeek(WEEK, [span('Short', '2026-12-08', '2026-12-09'), span('Long', '2026-12-08', '2026-12-11'), span('Later', '2026-12-10', '2026-12-12'), span('Edge', '2026-12-12', '2026-12-15')])
    expect(placed(bars)).toEqual([
      ['Long', 1, 4, 0, false, false],
      ['Short', 1, 2, 1, false, false],
      ['Later', 3, 3, 1, false, false],
      ['Edge', 5, 2, 0, false, true],
    ])
    expect(lanes).toBe(2)
  })

  it('layoutWeek: a bar from an earlier week is cut at the start; one off the row is left out', () => {
    const { bars } = layoutWeek(WEEK, [span('From before', '2026-12-04', '2026-12-08'), span('Elsewhere', '2026-12-14', '2026-12-16')])
    expect(placed(bars)).toEqual([['From before', 0, 2, 0, true, false]])
  })

  it('layoutWeek: with the weekends hidden a bar over a weekend is cut on both rows', () => {
    const days = withoutWeekends(WEEK) // Mon Dec 7 … Fri Dec 11
    expect(placed(layoutWeek(days, [span('Weekend trip', '2026-12-11', '2026-12-14')]).bars)).toEqual([['Weekend trip', 4, 1, 0, false, true]])
    expect(placed(layoutWeek(withoutWeekends(weekDays('2026-12-14')), [span('Weekend trip', '2026-12-11', '2026-12-14')]).bars)).toEqual([['Weekend trip', 0, 1, 0, true, false]])
    // A bar on Saturday and Sunday alone has no shown day on the row.
    expect(layoutWeek(days, [span('Sat–Sun', '2026-12-12', '2026-12-13')]).bars).toEqual([])
  })

  it('daysBetween and spanLabel', () => {
    expect(daysBetween('2026-12-03', '2026-12-05')).toBe(2)
    expect(daysBetween('2026-12-05', '2026-11-30')).toBe(-5)
    // Across the change to summer time the count stays whole.
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2)
    expect(spanLabel('2026-12-03', '2026-12-03')).toBe('Dec 3, 2026')
  })

  it('YAZ-4866: spanLabel leaves the year out when both days are in this year, else names it once at the end', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date(2026, 10, 10, 12, 0))
      expect(spanLabel('2026-11-10', '2026-11-13')).toBe('Nov 10 – Nov 13')
      expect(spanLabel('2027-01-04', '2027-01-06')).toBe('Jan 4 – Jan 6, 2027')
      // Across two years each day keeps its year: one year alone would name the wrong one.
      expect(spanLabel('2026-12-30', '2027-01-02')).toBe('Dec 30, 2026 – Jan 2, 2027')
      vi.setSystemTime(new Date(2025, 5, 1, 12, 0))
      expect(spanLabel('2026-12-03', '2026-12-05')).toBe('Dec 3 – Dec 5, 2026')
    } finally {
      vi.useRealTimers()
    }
  })

  it('calendarEndKey: only the view\'s own choice, and never the start column itself', () => {
    const view = (endDateProperty?: string): ViewDef => ({ type: 'calendar', name: 'C', ...(endDateProperty === undefined ? {} : { endDateProperty }) })
    expect(calendarEndKey(view(), 'due', {})).toBeNull()
    expect(calendarEndKey(view('note.end'), 'due', {})).toBe('end')
    expect(calendarEndKey(view('note.due'), 'due', {})).toBeNull()
  })
})

describe('a colour with a strength (YAZ-4878, YAZ-4906)', () => {
  it('reads `blue`, `blue light` and `Black STRONG`; writes Medium as the bare colour; refuses a word that is no colour, a strength that is none, or three words', () => {
    expect(readColorStrength('blue')).toEqual({ color: 'blue', strength: 'medium' })
    expect(readColorStrength(' blue  light ')).toEqual({ color: 'blue', strength: 'light' })
    expect(readColorStrength('Black STRONG')).toEqual({ color: 'black', strength: 'strong' })
    for (const bad of ['turquoise', 'blue bold', 'blue light strong', '', 3, null, undefined]) expect(readColorStrength(bad)).toBeNull()
    for (const text of ['blue', 'blue light', 'gray strong']) expect(writeColorStrength(readColorStrength(text)!)).toBe(text)
  })

  it('a line with no colour, or one the app cannot read, is Gray, Medium: the line of before, darker when wider than 1 px', () => {
    expect(calLineColor(undefined)).toEqual({ color: 'gray', strength: 'medium' })
    expect(calLineColor('mauve')).toEqual({ color: 'gray', strength: 'medium' })
    expect(calLineCss(calLineColor(undefined), 1)).toBe('var(--border)')
    expect(calLineCss(calLineColor(undefined), 3)).toContain('--fg-muted')
    expect(calLineCss({ color: 'gray', strength: 'light' }, 1)).toContain('50%')
    expect(calLineCss({ color: 'blue', strength: 'strong' }, 1)).toBe('color-mix(in srgb, var(--table-fill-solid-blue) 100%, transparent)')
  })
})
