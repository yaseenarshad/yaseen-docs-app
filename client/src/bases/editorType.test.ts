/**
 * Editor type inference for inline cell editors (5B, GRO-2142). Locked precedence: an explicit
 * `.obsidian/types.json` assignment wins over any inference from values; otherwise the note's own
 * YAML value decides; a note without the key borrows the dominant value type across the view's
 * records; text is the fallback. `file.*` and `formula.*` never get an editor.
 */
import { describe, expect, it } from 'vitest'
import type { IndexRecord, RegistryResponse } from '@shared/types'
import { cellEditor, columnTyping, valueKind } from './editorType'
import { TEST_RECORDS } from './testRecords'

const record = (properties: Record<string, unknown>, i = 0): IndexRecord => ({
  path: `/vault/n${i}.md`,
  name: `n${i}.md`,
  basename: `n${i}`,
  folder: '',
  ext: 'md',
  size: 0,
  ctime: 0,
  mtime: 0,
  properties,
  tags: [],
  links: [],
  embeds: [],
})

describe('valueKind', () => {
  it('maps raw YAML values to editors', () => {
    expect(valueKind(true)).toBe('checkbox')
    expect(valueKind(false)).toBe('checkbox')
    expect(valueKind(3)).toBe('number')
    expect(valueKind(['a', 'b'])).toBe('list')
    expect(valueKind('2026-08-01')).toBe('date')
    expect(valueKind('2026-08-01T10:00:00')).toBe('date')
    expect(valueKind('[[Agentic Agency]]')).toBe('link')
    expect(valueKind('idea')).toBe('text')
  })

  it('missing values have no kind; odd scalars fall back to text', () => {
    expect(valueKind(undefined)).toBeNull()
    expect(valueKind(null)).toBeNull()
    expect(valueKind({ nested: 1 })).toBe('text')
  })
})

describe('columnTyping + cellEditor', () => {
  it('file.* and formula.* columns are read-only', () => {
    expect(columnTyping('file.name', TEST_RECORDS, undefined)).toBeNull()
    expect(columnTyping('formula.x', TEST_RECORDS, undefined)).toBeNull()
    expect(cellEditor('anything', null)).toBeNull()
  })

  it('the current YAML value decides when nothing is assigned', () => {
    const col = columnTyping('note.priority', TEST_RECORDS, undefined)
    expect(cellEditor(2, col)).toBe('number')
    expect(cellEditor('high', col)).toBe('text')
  })

  it('an explicit types.json assignment wins over inference from values', () => {
    const col = columnTyping('priority', TEST_RECORDS, { priority: 'text' })
    expect(col?.assigned).toBe('text')
    expect(cellEditor(2, col)).toBe('text')
    expect(cellEditor(undefined, col)).toBe('text')
  })

  it('obsidian type names map onto our editors; unknown names do not assign', () => {
    const recs = [record({ x: 'plain' })]
    expect(cellEditor('plain', columnTyping('x', recs, { x: 'datetime' }))).toBe('date')
    expect(cellEditor('plain', columnTyping('x', recs, { x: 'multitext' }))).toBe('list')
    expect(cellEditor('plain', columnTyping('x', recs, { x: 'tags' }))).toBe('list')
    expect(cellEditor('plain', columnTyping('x', recs, { x: 'aliases' }))).toBe('list')
    expect(cellEditor('plain', columnTyping('x', recs, { x: 'checkbox' }))).toBe('checkbox')
    expect(cellEditor('plain', columnTyping('x', recs, { x: 'mystery' }))).toBe('text')
  })

  it('a note without the key borrows the dominant value type across the view records', () => {
    const recs = [record({ n: 1 }, 1), record({ n: 2 }, 2), record({ n: 'three' }, 3), record({}, 4)]
    const col = columnTyping('n', recs, undefined)
    expect(col?.dominant).toBe('number')
    expect(cellEditor(undefined, col)).toBe('number')
  })

  it('falls back to text when the key exists nowhere', () => {
    expect(cellEditor(undefined, columnTyping('ghost', TEST_RECORDS, undefined))).toBe('text')
  })

  it('ties go to the first kind seen', () => {
    const recs = [record({ v: 'a' }, 1), record({ v: 2 }, 2)]
    expect(cellEditor(undefined, columnTyping('v', recs, undefined))).toBe('text')
  })
})

describe('registry precedence (5E, GRO-2217 — locked amendment on GRO-2120)', () => {
  const REG: RegistryResponse = {
    root: '/vault',
    version: 1,
    types: { kpi: { properties: { x: { kind: 'number' }, owner: { kind: 'link', target: 'person' } } } },
    properties: { x: { kind: 'date' }, funnels: { kind: 'multi-link', target: 'funnel' } },
  }
  const recs = [record({ x: 'plain', owner: 7, funnels: 'plain' })]

  it("the pinned type's declaration beats the vault-wide one, which beats .obsidian/types.json", () => {
    expect(columnTyping('x', recs, { x: 'text' }, REG, 'kpi')?.assigned).toBe('number')
    expect(columnTyping('x', recs, { x: 'text' }, REG, null)?.assigned).toBe('date')
    expect(columnTyping('x', recs, { x: 'text' }, undefined, null)?.assigned).toBe('text')
  })

  it('a pinned type silent on the key falls through to the vault-wide declaration', () => {
    const col = columnTyping('funnels', recs, undefined, REG, 'kpi')
    expect(col?.assigned).toBe('multi-link')
    expect(col?.target).toBe('funnel')
  })

  it('an unpinned view never reads type-scoped declarations', () => {
    const col = columnTyping('owner', recs, undefined, REG, null)
    expect(col?.assigned).toBeNull()
    expect(col?.target).toBeUndefined()
    expect(cellEditor(7, col)).toBe('number') // the note's own value decides, as before
  })

  it('registry declarations beat the value and carry the target onto the column', () => {
    const col = columnTyping('owner', recs, undefined, REG, 'kpi')
    expect(col?.assigned).toBe('link')
    expect(col?.target).toBe('person')
    expect(cellEditor(7, col)).toBe('link')
    expect(cellEditor(undefined, col)).toBe('link')
  })

  it("multi-link maps onto the chips editor kind 'multi-link'", () => {
    expect(cellEditor(undefined, columnTyping('funnels', recs, undefined, REG, null))).toBe('multi-link')
  })

  it('an empty (or absent) registry changes nothing below rank 3', () => {
    const empty: RegistryResponse = { root: '/vault', version: 0, types: {}, properties: {} }
    expect(columnTyping('x', recs, { x: 'text' }, empty, 'kpi')?.assigned).toBe('text')
    expect(cellEditor('plain', columnTyping('x', recs, undefined, empty, null))).toBe('text')
  })
})
