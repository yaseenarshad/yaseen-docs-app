import { describe, expect, it } from 'vitest'
import type { IndexRecord } from '@shared/types'
import type { Row } from './engine'
import { FileValue } from './expr'
import { bucketByDay, calendarDateKey, dateColumns, dayOf, monthWeeks, movedDate, timeOf } from './calendar'
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

describe('timeOf (YAZ-4540): the time a card shows, as written', () => {
  it('reads HH:mm off a value with a time, and nothing off a bare date', () => {
    expect(timeOf('2026-12-03 10:30')).toBe('10:30')
    expect(timeOf('2026-12-03T23:30Z')).toBe('23:30')
    expect(timeOf('2026-12-03')).toBeNull()
    expect(timeOf('soon')).toBeNull()
    expect(timeOf(new Date())).toBeNull()
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
    expect(calendarDateKey(view, ['note.due', 'note.start'])).toBe('due')
    expect(calendarDateKey({ ...view, dateProperty: 'note.start' }, ['note.due', 'note.start'])).toBe('start')
    expect(calendarDateKey(view, [])).toBeNull()
  })
})
