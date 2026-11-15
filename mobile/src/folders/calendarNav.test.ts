import { describe, expect, it } from 'vitest'
import type { Row } from '@client/views/engine'
import { MODES, agendaDays, emptyText, modeOf, periodOf, periodTitle, rollingMonth, rollingTarget, stepAnchor } from './calendarNav'

/** YAZ-5597: which days each mode lists, its title, ‹ › and the empty words. Made-up days in November 2026 (the 15th a Sunday). */
const row = (path: string) => ({ record: { path } }) as unknown as Row
const names = (days: ReturnType<typeof agendaDays>) => days.map((d) => `${d.day}: ${d.rows.map((r) => `${r.row.record.path}${r.from ? ` since ${r.from}` : ''}${r.until ? ` until ${r.until}` : ''}`).join(', ')}`)

describe('the calendar modes (YAZ-5597)', () => {
  it('Month: the whole month; ‹ › the 1st of the month before or after, across a year', () => {
    expect(periodOf('month', '2026-11-15', true)).toEqual({ start: '2026-11-01', end: '2026-11-30' })
    expect(periodOf('month', '2028-02-10', true)).toEqual({ start: '2028-02-01', end: '2028-02-29' })
    expect(stepAnchor('month', '2026-11-15', -1)).toBe('2026-10-01')
    expect(stepAnchor('month', '2026-11-15', 1)).toBe('2026-12-01')
    expect(stepAnchor('month', '2026-01-31', -1)).toBe('2025-12-01')
    expect(stepAnchor('month', '2026-12-31', 1)).toBe('2027-01-01')
    expect(periodTitle('month', '2026-11-15', true)).toBe('November 2026')
  })

  it('Week: 7 days from the vault week start; ‹ › a week; the Mac title', () => {
    expect(periodOf('week', '2026-11-18', true)).toEqual({ start: '2026-11-15', end: '2026-11-21' })
    expect(periodOf('week', '2026-11-18', false)).toEqual({ start: '2026-11-16', end: '2026-11-22' })
    expect(periodOf('week', '2026-11-15', false)).toEqual({ start: '2026-11-09', end: '2026-11-15' })
    expect(stepAnchor('week', '2026-11-15', 1)).toBe('2026-11-22')
    expect(stepAnchor('week', '2026-11-15', -1)).toBe('2026-11-08')
    expect(periodTitle('week', '2026-11-15', true)).toBe('Nov 15 – Nov 21, 2026')
    expect(periodTitle('week', '2026-12-30', true)).toBe('Dec 27, 2026 – Jan 2, 2027')
  })

  it('Rolling: every day; ‹ › from month heading to month heading, none past the ends', () => {
    expect(periodOf('rolling', '2026-11-15', true)).toBeNull()
    const months = ['2026-09', '2026-11', '2027-01']
    expect(rollingMonth(months, '2026-11', -1)).toBe('2026-09')
    expect(rollingMonth(months, '2026-11', 1)).toBe('2027-01')
    expect(rollingMonth(months, '2026-09', -1)).toBeNull()
    expect(rollingMonth(months, '2027-01', 1)).toBeNull()
    // Opens at today: the first day on or after it (the last day when all are past).
    expect(rollingTarget(['2026-11-03', '2026-11-16'], '2026-11-15')).toBe('2026-11-16')
    expect(rollingTarget(['2026-11-03'], '2026-11-15')).toBe('2026-11-03')
  })

  it('opens on the view scale (the Mac default Month); empty words', () => {
    expect(modeOf(undefined)).toBe('month')
    expect(modeOf('month')).toBe('month')
    expect(modeOf('week')).toBe('week')
    // A Rolling the Mac may write later; an unknown value is Month.
    expect(modeOf('rolling')).toBe('rolling')
    expect(modeOf('year')).toBe('month')
    expect(modeOf(7)).toBe('month')
    expect(MODES.map(([, label]) => label)).toEqual(['Week', 'Month', 'Rolling'])
    expect(emptyText('month', '2026-12-01', '2026-11-15', true)).toBe('Nothing in December')
    expect(emptyText('month', '2027-02-01', '2026-11-15', true)).toBe('Nothing in February 2027')
    expect(emptyText('week', '2026-11-15', '2026-11-15', true)).toBe('Nothing this week')
    expect(emptyText('week', '2026-11-22', '2026-11-15', true)).toBe('Nothing in Nov 22 – Nov 28, 2026')
  })

  it('multi-day pages: on their first day with the last; one begun before the period on its first day, first', () => {
    const days = new Map([
      ['2026-11-01', [row('a')]],
      ['2026-11-16', [row('b')]],
    ])
    const multi = [
      { row: row('trip'), start: '2026-11-13', end: '2026-11-18' },
      { row: row('fair'), start: '2026-11-17', end: '2026-11-25' },
      { row: row('past'), start: '2026-10-01', end: '2026-10-05' },
    ]
    expect(names(agendaDays(days, multi, { start: '2026-11-15', end: '2026-11-21' }))).toEqual(['2026-11-15: trip since 2026-11-13 until 2026-11-18', '2026-11-16: b', '2026-11-17: fair until 2026-11-25'])
    expect(names(agendaDays(days, multi, null))).toEqual(['2026-10-01: past until 2026-10-05', '2026-11-01: a', '2026-11-13: trip until 2026-11-18', '2026-11-16: b', '2026-11-17: fair until 2026-11-25'])
    // A period's first day with its own pages: the running page first.
    expect(names(agendaDays(new Map([['2026-11-15', [row('c')]]]), multi, { start: '2026-11-15', end: '2026-11-21' }))[0]).toBe('2026-11-15: trip since 2026-11-13 until 2026-11-18, c')
  })
})
