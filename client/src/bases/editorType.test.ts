/**
 * Editor type inference for inline cell editors (5B, GRO-2142). Locked precedence: an explicit
 * `.obsidian/types.json` assignment wins over any inference from values; otherwise the note's own
 * YAML value decides; a note without the key borrows the dominant value type across the view's
 * records; text is the fallback. `file.*` and `formula.*` never get an editor.
 */
import { describe, expect, it } from 'vitest'
import type { IndexRecord, PropertiesResponse, PropertyKind } from '@shared/types'
import { cellEditor, columnTyping, valueKind } from './editorType'
import { DEFAULT_VIEWS, type FolderPageSettings } from './folderPageSettings'
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
  aliases: [],
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

describe('declaration precedence (5E, GRO-2217 — locked amendment on GRO-2120; type rung deleted by YAZ-836)', () => {
  const DECLS: PropertiesResponse = {
    root: '/vault',
    version: 1,
    properties: { x: { kind: 'date' }, owner: { kind: 'link', target: 'person' }, funnels: { kind: 'multi-link', target: 'funnel' } },
  }
  const recs = [record({ x: 'plain', owner: 7, funnels: 'plain' })]

  it('the vault-wide declaration beats .obsidian/types.json, which beats the value', () => {
    expect(columnTyping('x', recs, { x: 'text' }, DECLS)?.assigned).toBe('date')
    expect(columnTyping('x', recs, { x: 'text' }, undefined)?.assigned).toBe('text')
  })

  it('an undeclared key falls straight through — there is no type-scoped rung any more (YAZ-836)', () => {
    const none: PropertiesResponse = { ...DECLS, properties: {} }
    const col = columnTyping('owner', recs, undefined, none)
    expect(col?.assigned).toBeNull()
    expect(col?.target).toBeUndefined()
    expect(cellEditor(7, col)).toBe('number') // the note's own value decides, as before
  })

  it('vault-wide declarations beat the value and carry the target onto the column', () => {
    const col = columnTyping('owner', recs, undefined, DECLS)
    expect(col?.assigned).toBe('link')
    expect(col?.target).toBe('person')
    expect(cellEditor(7, col)).toBe('link')
    expect(cellEditor(undefined, col)).toBe('link')
  })

  it("multi-link maps onto the chips editor kind 'multi-link'", () => {
    expect(cellEditor(undefined, columnTyping('funnels', recs, undefined, DECLS))).toBe('multi-link')
  })

  it('an empty (or absent) response changes nothing below rank 3', () => {
    const empty: PropertiesResponse = { root: '/vault', version: 0, properties: {} }
    expect(columnTyping('x', recs, { x: 'text' }, empty)?.assigned).toBe('text')
    expect(cellEditor('plain', columnTyping('x', recs, undefined, empty))).toBe('text')
  })
})

/**
 * The ladder's TOP rung (🔒 Q8 of YAZ-815, wired here at YAZ-819): a FOLDER PAGE's own column
 * declaration, view-scoped — read through `columnKindIn`, never re-parsed here.
 */
describe('folder-page columns are the top rung (🔒 Q8, YAZ-815)', () => {
  const DECLS: PropertiesResponse = {
    root: '/vault',
    version: 1,
    properties: { owner: { kind: 'text' }, stage: { kind: 'date' } },
  }
  const recs = [record({ owner: 7, stage: 'plain' })]
  const settings = (columns: Record<string, { kind: PropertyKind; target?: string }>): FolderPageSettings => ({
    columns,
    views: DEFAULT_VIEWS.map((v) => ({ ...v })),
    problems: [],
  })

  it('beats the vault-wide declaration, .obsidian/types.json and the value — and carries its own target', () => {
    const col = columnTyping('owner', recs, { owner: 'number' }, DECLS, settings({ owner: { kind: 'multi-link', target: '[[KPIs]]' } }))
    expect(col?.assigned).toBe('multi-link')
    expect(col?.target).toBe('[[KPIs]]')
    expect(cellEditor(7, col)).toBe('multi-link')
  })

  it('a key the folder page does not declare falls through to the rungs below, untouched', () => {
    expect(columnTyping('stage', recs, undefined, DECLS, settings({ owner: { kind: 'link' } }))?.assigned).toBe('date')
  })

  it('no folder page (a plain `.base`) is exactly today’s ladder', () => {
    expect(columnTyping('owner', recs, undefined, DECLS, null)?.assigned).toBe('text')
    expect(columnTyping('owner', recs, undefined, DECLS)?.assigned).toBe('text')
  })

  it('a folder page whose settings declare nothing changes nothing', () => {
    expect(columnTyping('owner', recs, undefined, DECLS, settings({}))?.assigned).toBe('text')
  })
})
