import { describe, expect, it } from 'vitest'
import { BaseParseError, parseBase, serializeBase, updateBase } from './baseFile'

/** Yasin's real file, verbatim (trailing newline included). */
const YASIN_BASE = `views:
  - type: table
    name: Table
    order:
      - file.name
    sort:
      - property: formula.Untitled
        direction: ASC
  - type: cards
    name: View
  - type: table
    name: View 2
    indentProperties: false
`

/** chars.base from the Obsidian community — formulas, nested filters, blank line, columnSize. */
const CHARS_BASE = `formulas:
  img2: file.embeds[0]
  info: race + " " + class + " (" + pronouns.join("/") + ")"

views:
  - type: table
    name: Table
    filters:
      and:
        - file.ext == "md"
        - or:
          - file.folder == "PF2 - Cronos/NPCs"
          - file.folder == "PF2 - Cronos/PCs"
    order:
      - file.name
      - aliases
      - tags
    sort:
      - property: formula.img2
        direction: ASC
    columnSize:
      file.name: 140
      note.aliases: 75
`

/** Comments, unknown keys at both levels, flow sequence, not-filter, properties, summaries. */
const KITCHEN_SINK = `# Top-level comment that must survive
foo: 1
filters:
  and:
    - file.ext == "md"
  not:
    - file.name == "draft"
properties:
  status:
    displayName: Status
    custom: true
summaries:
  price: Sum
views:
  - type: table
    name: Main
    # comment inside a view
    mystery: [1, 2]
    order:
      - file.name
  - type: board
    name: Kanban
    groupBy:
      property: status
      direction: DESC
`

/** Multiset difference of lines: those only in `a` (removed) and only in `b` (added), in order. */
function lineDiff(a: string, b: string): { removed: string[]; added: string[] } {
  const la = a.split('\n')
  const lb = b.split('\n')
  const countB = new Map<string, number>()
  for (const l of lb) countB.set(l, (countB.get(l) ?? 0) + 1)
  const countA = new Map<string, number>()
  for (const l of la) countA.set(l, (countA.get(l) ?? 0) + 1)
  const removed = la.filter((l) => (countB.get(l) ?? 0) < (countA.get(l) ?? 0) && countB.set(l, (countB.get(l) ?? 0) + 1))
  const added = lb.filter((l) => (countA.get(l) ?? 0) < (countB.get(l) ?? 0) && countA.set(l, (countA.get(l) ?? 0) + 1))
  return { removed, added }
}

describe('parseBase / serializeBase round-trip', () => {
  it.each([
    ['yasin', YASIN_BASE],
    ['kitchen sink', KITCHEN_SINK],
  ])('%s fixture serialises byte-for-byte', (_name, text) => {
    expect(serializeBase(parseBase(text))).toBe(text)
  })

  // Known, unavoidable normalisation: `yaml`'s stringifier has ONE global `indentSeq`
  // option, but chars.base mixes both styles — `order:` indents its items by two
  // (indentSeq: true) while `- or:` puts its items flush with the key (indentSeq: false).
  // The library cannot reproduce both in one document, so the two lines under `- or:`
  // gain two spaces. Everything else is byte-identical, the output is idempotent, and
  // the parsed definition is unchanged.
  it('chars fixture: identical except the nested `or:` list is re-indented by yaml', () => {
    const out = serializeBase(parseBase(CHARS_BASE))
    expect(lineDiff(CHARS_BASE, out)).toEqual({
      removed: ['          - file.folder == "PF2 - Cronos/NPCs"', '          - file.folder == "PF2 - Cronos/PCs"'],
      added: ['            - file.folder == "PF2 - Cronos/NPCs"', '            - file.folder == "PF2 - Cronos/PCs"'],
    })
    expect(serializeBase(parseBase(out))).toBe(out)
    expect(parseBase(out).def).toEqual(parseBase(CHARS_BASE).def)
  })
})

describe('parseBase def', () => {
  it('exposes typed view fields', () => {
    const { def } = parseBase(YASIN_BASE)
    expect(def.views).toHaveLength(3)
    expect(def.views[0].sort?.[0].property).toBe('formula.Untitled')
    expect(def.views[0].sort?.[0].direction).toBe('ASC')
    expect(def.views[0].order).toEqual(['file.name'])
    expect(def.views[1].type).toBe('cards')
    expect(def.views[2].indentProperties).toBe(false)
  })

  it('exposes formulas, nested filters and columnSize', () => {
    const { def } = parseBase(CHARS_BASE)
    expect(def.formulas?.img2).toBe('file.embeds[0]')
    expect(def.views[0].filters).toEqual({
      and: ['file.ext == "md"', { or: ['file.folder == "PF2 - Cronos/NPCs"', 'file.folder == "PF2 - Cronos/PCs"'] }],
    })
    expect(def.views[0].columnSize).toEqual({ 'file.name': 140, 'note.aliases': 75 })
  })

  it('keeps unknown keys at the top level and inside views', () => {
    const { def } = parseBase(KITCHEN_SINK)
    expect(def.foo).toBe(1)
    expect(def.views[0].mystery).toEqual([1, 2])
    expect(def.filters).toEqual({ and: ['file.ext == "md"'], not: ['file.name == "draft"'] })
    expect(def.properties?.status.displayName).toBe('Status')
    expect(def.properties?.status.custom).toBe(true)
    expect(def.summaries).toEqual({ price: 'Sum' })
    expect(def.views[1].groupBy).toEqual({ property: 'status', direction: 'DESC' })
  })
})

describe('updateBase', () => {
  it('renaming a view changes only that line; comments and unknown keys survive', () => {
    const before = parseBase(KITCHEN_SINK)
    const after = updateBase(before, (def) => {
      def.views[0].name = 'Renamed'
    })
    expect(after.def.views[0].name).toBe('Renamed')
    expect(after.def.foo).toBe(1)
    expect(before.def.views[0].name).toBe('Main') // input def untouched
    const out = serializeBase(after)
    expect(lineDiff(KITCHEN_SINK, out)).toEqual({ removed: ['    name: Main'], added: ['    name: Renamed'] })
    expect(out).toContain('# Top-level comment that must survive')
    expect(out).toContain('    # comment inside a view')
    expect(out).toContain('    mystery: [1, 2]')
  })

  it('adding limit to a view inserts exactly one line', () => {
    const after = updateBase(parseBase(YASIN_BASE), (def) => {
      def.views[0].limit = 10
    })
    const out = serializeBase(after)
    expect(lineDiff(YASIN_BASE, out)).toEqual({ removed: [], added: ['    limit: 10'] })
    expect(out.split('\n')).toHaveLength(YASIN_BASE.split('\n').length + 1)
  })

  it('deleting a key removes its line', () => {
    const after = updateBase(parseBase(YASIN_BASE), (def) => {
      delete def.views[2].indentProperties
    })
    expect(lineDiff(YASIN_BASE, serializeBase(after))).toEqual({ removed: ['    indentProperties: false'], added: [] })
  })

  it('an array that changed length is replaced as a whole', () => {
    const after = updateBase(parseBase(YASIN_BASE), (def) => {
      def.views[0].order = ['file.name', 'tags']
    })
    const out = serializeBase(after)
    expect(after.def.views[0].order).toEqual(['file.name', 'tags'])
    expect(lineDiff(YASIN_BASE, out)).toEqual({ removed: [], added: ['      - tags'] })
    expect(serializeBase(parseBase(out))).toBe(out)
  })
})

describe('parse errors', () => {
  it('invalid YAML → BaseParseError with a line number', () => {
    const bad = 'views:\n  - type: table\n    name: [unclosed\n'
    expect(() => parseBase(bad)).toThrow(BaseParseError)
    try {
      parseBase(bad)
    } catch (e) {
      expect(e).toBeInstanceOf(BaseParseError)
      expect(typeof (e as BaseParseError).line).toBe('number')
    }
  })

  it('views: 3 → BaseParseError mentioning views', () => {
    expect(() => parseBase('views: 3\n')).toThrow(/views/)
    expect(() => parseBase('views: 3\n')).toThrow(BaseParseError)
  })

  it('a view without a string type/name → BaseParseError', () => {
    expect(() => parseBase('views:\n  - name: X\n')).toThrow(BaseParseError)
    expect(() => parseBase('views:\n  - type: table\n')).toThrow(BaseParseError)
    expect(() => parseBase('views:\n  - table\n')).toThrow(BaseParseError)
  })

  it('empty string → BaseParseError (Obsidian requires views)', () => {
    expect(() => parseBase('')).toThrow(BaseParseError)
    expect(() => parseBase('')).toThrow(/views/)
  })

  it('a non-map root → BaseParseError', () => {
    expect(() => parseBase('- a\n- b\n')).toThrow(BaseParseError)
  })
})
