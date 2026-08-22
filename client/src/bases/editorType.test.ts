/**
 * Editor type inference for inline cell editors (5B, GRO-2142). Locked precedence: an explicit
 * `.obsidian/types.json` assignment wins over any inference from values; otherwise the note's own
 * YAML value decides; a note without the key borrows the dominant value type across the view's
 * records; text is the fallback. `file.*` and `formula.*` never get an editor.
 */
import { describe, expect, it } from 'vitest'
import type { IndexRecord } from '@shared/types'
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
