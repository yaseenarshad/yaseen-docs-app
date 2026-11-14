import { describe, expect, it } from 'vitest'
import { TEST_RECORDS } from '../testRecords'
import { columnFilterShape, columnRules, valueCounts, withColumnRules } from './columnFilter'
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
    // Each checklist and the Contains box carry their opposite (YAZ-4929): the panel's "is none of", "has none of" and "does not contain".
    expect(columnFilterShape('note.status', 'select')).toEqual({ kind: 'options', op: 'isAnyOf', not: 'isNoneOf' })
    expect(columnFilterShape('note.related', 'link')).toEqual({ kind: 'options', op: 'isAnyOf', not: 'isNoneOf' })
    for (const type of ['multi-select', 'list', 'tags', 'multi-link'] as const) expect(columnFilterShape('note.x', type)).toEqual({ kind: 'options', op: 'hasAnyOf', not: 'hasNoneOf' })
    expect(columnFilterShape('note.published', 'checkbox')).toEqual({ kind: 'checkbox' })
    expect(columnFilterShape('note.pillar', 'text')).toEqual({ kind: 'text', op: 'contains', label: 'Contains', not: { op: 'notContains', label: 'Does not contain' } })
    // The panel has no "does not contain" on a Linked mentions column, nor on the file links: no opposite there.
    expect(columnFilterShape('note.mentions', 'mentions')).toEqual({ kind: 'text', op: 'contains', label: 'Contains' })
    expect(columnFilterShape('note.priority', 'number')).toEqual({ kind: 'number' })
    expect(columnFilterShape('note.date', 'date')).toEqual({ kind: 'date' })
    expect(columnFilterShape('note.cover', 'image')).toEqual({ kind: 'empty' })
    expect(columnFilterShape('file.tags', 'file')).toEqual({ kind: 'options', op: 'hasAnyOf', not: 'hasNoneOf' })
    expect(columnFilterShape('file.folder', 'file')).toEqual({ kind: 'options', op: 'isAnyOf', not: 'isNoneOf' })
    expect(columnFilterShape('file.links', 'file')).toEqual({ kind: 'text', op: 'hasLink', label: 'Links to' })
  })

  it('a live date rule (Today · This week · This month) is this column\'s rule like any other: read for the ✓, replaced by a pick', () => {
    const today = { property: 'note.date', op: 'dateIsToday' as const, value: '' }
    expect(withColumnRules(undefined, 'note.date', [today])).toEqual({ and: ['note.date.isToday()'] })
    expect(columnRules({ and: ['note.date.isThisWeek()', STATUS] }, 'date')).toEqual([{ property: 'note.date', op: 'dateInThisWeek', value: '' }])
    expect(withColumnRules({ and: ['note.date.isThisWeek()', STATUS] }, 'note.date', [{ property: 'note.date', op: 'dateInThisMonth', value: '' }])).toEqual({
      and: [STATUS, 'note.date.isThisMonth()'],
    })
  })

  it('withColumnRules on a text column writes the case-ignoring form (YAZ-4919 round 2), and columnRules reads both forms as the column\'s', () => {
    expect(withColumnRules(undefined, 'note.pillar', [{ property: 'note.pillar', op: 'contains', value: 'Agentic' }], 'text')).toEqual({ and: ['note.pillar.lower().contains("agentic")'] })
    expect(withColumnRules(undefined, 'note.tags', [{ property: 'note.tags', op: 'contains', value: 'Agentic' }], 'tags')).toEqual({ and: ['note.tags.contains("Agentic")'] })
    expect(columnRules({ and: ['note.pillar.contains("Agentic")', 'note.pillar.lower().contains("creator")'] }, 'pillar')).toEqual([
      { property: 'note.pillar', op: 'contains', value: 'Agentic' },
      { property: 'note.pillar', op: 'contains', value: 'creator' },
    ])
    // An old exact rule is this column's, so a pick replaces it.
    expect(withColumnRules({ and: ['note.pillar.contains("Agentic")', STATUS] }, 'note.pillar', [{ property: 'note.pillar', op: 'is', value: 'Creator Economy' }], 'text')).toEqual({
      and: [STATUS, 'note.pillar == "Creator Economy"'],
    })
  })

  it('valueCounts: the column\'s values that contain the text, case ignored, each with its count, most rows first; empty text lists the most common; eight at most', () => {
    // TEST_RECORDS: pillar is "Agentic Agency" twice, "Creator Economy" twice, null once, absent elsewhere.
    expect(valueCounts('note.pillar', TEST_RECORDS, '')).toEqual([
      { value: 'Agentic Agency', count: 2 },
      { value: 'Creator Economy', count: 2 },
    ])
    expect(valueCounts('note.pillar', TEST_RECORDS, 'CREATOR')).toEqual([{ value: 'Creator Economy', count: 2 }])
    expect(valueCounts('note.pillar', TEST_RECORDS, 'xyz')).toEqual([])
    // Ties keep the rows' order; the count decides first.
    expect(valueCounts('note.status', TEST_RECORDS, '').map((v) => v.value)).toEqual(['idea', 'published', 'drafting'])
    expect(valueCounts('note.status', TEST_RECORDS, 'ed')).toEqual([{ value: 'published', count: 2 }])
    expect(valueCounts('note.status', TEST_RECORDS, '', 1)).toEqual([{ value: 'idea', count: 2 }])
    // A list cell counts each item; a link is its target, as the checklist's values.
    expect(valueCounts('note.tags', TEST_RECORDS, 'agentic')).toEqual([
      { value: 'agentic', count: 1 },
      { value: 'agentic/levels', count: 1 },
    ])
    expect(valueCounts('note.related', TEST_RECORDS, '')).toEqual([{ value: 'Agentic Agency', count: 1 }])
    // Only a page column lists values: a file field or a formula has none here.
    expect(valueCounts('file.name', TEST_RECORDS, '')).toEqual([])
    expect(valueCounts('formula.x', TEST_RECORDS, '')).toEqual([])
  })

  it('propertyValues: the declared options first, then the rows\' values, distinct; file.tags from the tags', () => {
    expect(propertyValues('note.status', TEST_RECORDS, { assigned: 'select', dominant: null, options: ['zeta', 'idea'] })).toEqual(['zeta', 'idea', 'drafting', 'published'])
    expect(propertyValues('note.status', TEST_RECORDS, null, 1)).toEqual(['idea'])
    expect(propertyValues('file.tags', TEST_RECORDS, null).slice(0, 3)).toEqual(['agentic', 'pillar', 'agentic/levels'])
    expect(propertyValues('formula.x', TEST_RECORDS, null)).toEqual([])
  })
})
