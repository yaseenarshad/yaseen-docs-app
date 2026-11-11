import { describe, expect, it } from 'vitest'
import { TEST_RECORDS } from '../testRecords'
import { columnFilterShape, columnRules, dateSpanRules, sameRules, withColumnRules } from './columnFilter'
import { propertyValues } from './filterRows'

/** The column header's Filter › rules (YAZ-4919): pure, in the Filter panel's grammar. */
describe('a column\'s rules in the view\'s filters (YAZ-4919)', () => {
  const STATUS = 'note.status == "idea"'
  const PRIORITY = '!note.priority.isEmpty() && note.priority > 1'

  it('columnRules reads this column\'s top-level rules, in any spelling of the key; a raw expression and a nested group are nobody\'s', () => {
    expect(columnRules(undefined, 'note.status')).toEqual([])
    expect(columnRules(STATUS, 'status')).toEqual([{ property: 'note.status', op: 'is', value: 'idea' }])
    expect(columnRules({ and: [STATUS, PRIORITY, 'note.status.lower() == "x"', { or: ['note.status.isEmpty()'] }] }, 'note.status')).toEqual([
      { property: 'note.status', op: 'is', value: 'idea' },
    ])
    expect(columnRules({ or: [STATUS, PRIORITY] }, 'note.priority')).toEqual([{ property: 'note.priority', op: 'gt', value: '1' }])
  })

  it('withColumnRules replaces this column\'s rules and keeps the other column\'s; none left takes the key with it', () => {
    expect(withColumnRules(undefined, 'note.status', [{ property: 'note.status', op: 'isEmpty', value: '' }])).toEqual({ and: ['note.status.isEmpty()'] })
    expect(withColumnRules({ and: [STATUS, PRIORITY] }, 'status', [{ property: 'note.status', op: 'isAnyOf', value: ['idea', 'drafting'] }])).toEqual({
      and: [PRIORITY, '["idea", "drafting"].contains(note.status)'],
    })
    expect(withColumnRules({ and: [STATUS, PRIORITY] }, 'note.status', [])).toEqual({ and: [PRIORITY] })
    expect(withColumnRules({ and: [STATUS] }, 'note.status', [])).toBeUndefined()
    expect(withColumnRules(STATUS, 'note.status', [])).toBeUndefined()
  })

  it('withColumnRules on an Any or None group: the column\'s rules leave it, and the rest goes under a new All beside the new rules', () => {
    expect(withColumnRules({ or: [STATUS, PRIORITY] }, 'note.status', [{ property: 'note.status', op: 'isEmpty', value: '' }])).toEqual({
      and: [{ or: [PRIORITY] }, 'note.status.isEmpty()'],
    })
    expect(withColumnRules({ not: [STATUS] }, 'note.status', [{ property: 'note.status', op: 'isEmpty', value: '' }])).toEqual({ and: ['note.status.isEmpty()'] })
    expect(withColumnRules({ or: [STATUS, PRIORITY] }, 'note.status', [])).toEqual({ or: [PRIORITY] })
  })

  it('the shape by type: a checklist for a Select, Link, Multi-select, List, Tags and Multi-link; Checked for a checkbox; a box for text, number and date; only Is empty for an image', () => {
    expect(columnFilterShape('note.status', 'select')).toEqual({ kind: 'options', op: 'isAnyOf' })
    expect(columnFilterShape('note.related', 'link')).toEqual({ kind: 'options', op: 'isAnyOf' })
    for (const type of ['multi-select', 'list', 'tags', 'multi-link'] as const) expect(columnFilterShape('note.x', type)).toEqual({ kind: 'options', op: 'hasAnyOf' })
    expect(columnFilterShape('note.published', 'checkbox')).toEqual({ kind: 'checkbox' })
    expect(columnFilterShape('note.pillar', 'text')).toEqual({ kind: 'text', op: 'contains', label: 'Contains' })
    expect(columnFilterShape('note.mentions', 'mentions')).toEqual({ kind: 'text', op: 'contains', label: 'Contains' })
    expect(columnFilterShape('note.priority', 'number')).toEqual({ kind: 'number' })
    expect(columnFilterShape('note.date', 'date')).toEqual({ kind: 'date' })
    expect(columnFilterShape('note.cover', 'image')).toEqual({ kind: 'empty' })
    expect(columnFilterShape('file.tags', 'file')).toEqual({ kind: 'options', op: 'hasAnyOf' })
    expect(columnFilterShape('file.folder', 'file')).toEqual({ kind: 'options', op: 'isAnyOf' })
    expect(columnFilterShape('file.links', 'file')).toEqual({ kind: 'text', op: 'hasLink', label: 'Links to' })
  })

  it('Today, This week and This month as the grammar\'s date rules, fixed at the pick; the week starts on Sunday or Monday', () => {
    // Wednesday 2026-11-11.
    const now = new Date(2026, 10, 11, 15, 30).getTime()
    expect(dateSpanRules('note.date', 'today', 'sunday', now)).toEqual([{ property: 'note.date', op: 'dateIs', value: '2026-11-11' }])
    expect(dateSpanRules('note.date', 'week', 'sunday', now)).toEqual([
      { property: 'note.date', op: 'dateAfter', value: '2026-11-07' },
      { property: 'note.date', op: 'dateBefore', value: '2026-11-15' },
    ])
    expect(dateSpanRules('note.date', 'week', 'monday', now)).toEqual([
      { property: 'note.date', op: 'dateAfter', value: '2026-11-08' },
      { property: 'note.date', op: 'dateBefore', value: '2026-11-16' },
    ])
    expect(dateSpanRules('note.date', 'month', 'sunday', now)).toEqual([
      { property: 'note.date', op: 'dateAfter', value: '2026-10-31' },
      { property: 'note.date', op: 'dateBefore', value: '2026-12-01' },
    ])
    // A week across a month's end, and December's month across the year's end.
    expect(dateSpanRules('note.date', 'week', 'monday', new Date(2026, 11, 1).getTime())).toEqual([
      { property: 'note.date', op: 'dateAfter', value: '2026-11-29' },
      { property: 'note.date', op: 'dateBefore', value: '2026-12-07' },
    ])
    expect(dateSpanRules('note.date', 'month', 'sunday', new Date(2026, 11, 20).getTime())).toEqual([
      { property: 'note.date', op: 'dateAfter', value: '2026-11-30' },
      { property: 'note.date', op: 'dateBefore', value: '2027-01-01' },
    ])
  })

  it('sameRules: the same rules in any order', () => {
    const week = dateSpanRules('note.date', 'week', 'sunday')
    expect(sameRules(week, [week[1], week[0]])).toBe(true)
    expect(sameRules(week, [week[0]])).toBe(false)
    expect(sameRules(week, dateSpanRules('note.date', 'month', 'sunday'))).toBe(false)
  })

  it('propertyValues: the declared options first, then the rows\' values, distinct; file.tags from the tags', () => {
    expect(propertyValues('note.status', TEST_RECORDS, { assigned: 'select', dominant: null, options: ['zeta', 'idea'] })).toEqual(['zeta', 'idea', 'drafting', 'published'])
    expect(propertyValues('note.status', TEST_RECORDS, null, 1)).toEqual(['idea'])
    expect(propertyValues('file.tags', TEST_RECORDS, null).slice(0, 3)).toEqual(['agentic', 'pillar', 'agentic/levels'])
    expect(propertyValues('formula.x', TEST_RECORDS, null)).toEqual([])
  })
})
