import { describe, expect, it } from 'vitest'
import type { IndexRecord } from '@shared/types'
import { type BaseDefinition, type BaseView, type FilterNode, parseBase } from './baseFile'
import { type ViewResult, makeResolver, propertyKeys, propertyLabel, resolverFor, runView } from './engine'
import { DateValue, ErrorValue, FileValue } from './expr'
import { TEST_RECORDS } from './testRecords'

/** Yasin's real base (also in baseFile.test.ts): `formula.Untitled` is a dangling sort key. */
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

const yasin = parseBase(YASIN_BASE).def

/** Path order of TEST_RECORDS, by basename. */
const PATH_ORDER = [
  'Agentic Agency', 'The Levels of an Agency', 'Creator Economy', 'The Gold In Your Archive',
  'Attribution', 'Tech & Silicon Valley', 'List of Topics', 'VSL-v1',
]
const AGENTIC = '/vault/Content Pillars/1. Agentic Agency/Agentic Agency.md'

const names = (r: ViewResult): string[] => r.rows.map(row => row.record.basename)
const labels = (r: ViewResult): string[] => r.groups!.map(g => g.label)

/** Runs Yasin's Table view with per-test overrides on the view and the definition. */
function run(view: Partial<BaseView> = {}, def: Partial<BaseDefinition> = {}, opts: { thisFile?: string | null } = {}): ViewResult {
  const d: BaseDefinition = { ...yasin, ...def }
  const v: BaseView = { ...d.views[0], ...view }
  d.views = [v, ...d.views.slice(1)]
  return runView(d, v, TEST_RECORDS, opts)
}

describe('runView: rows and values (GRO-2133)', () => {
  it("Yasin's Table view → 8 rows with file.name, no groups, no errors", () => {
    const r = run()
    expect(r.rows).toHaveLength(8)
    expect(r.total).toBe(8)
    expect(r.groups).toBe(null)
    expect(r.errors).toEqual([])
    expect(r.rows[0].values).toEqual({ 'file.name': 'Agentic Agency.md' })
    expect(r.rows[0].file).toBeInstanceOf(FileValue)
    expect(r.rows[0].record).toBe(TEST_RECORDS[0])
    expect(r.summaries).toEqual({})
  })

  it('sorting by the dangling formula.Untitled keeps stable path order and reports no error (an unknown formula is an evaluator ErrorValue, not a compile error)', () => {
    const r = run({ order: ['file.name', 'formula.Untitled'] })
    expect(names(r)).toEqual(PATH_ORDER)
    expect(r.errors).toEqual([])
    const cell = r.rows[0].values['formula.Untitled']
    expect(cell).toBeInstanceOf(ErrorValue)
    expect((cell as ErrorValue).message).toMatch(/unknown formula Untitled/)
  })

  it('values: file.*, bare and note.-prefixed properties, formulas; a formula compile error is one EngineError + ErrorValue cells', () => {
    const r = run(
      { order: ['file.name', 'status', 'note.priority', 'formula.ppu', 'formula.bad', 'formula.rel', 'file.nope'], sort: [] },
      { formulas: { ppu: 'priority * 2', bad: '1 +', rel: 'file("Agentic Agency").properties.priority' } },
    )
    const v = r.rows[0].values
    expect(v['file.name']).toBe('Agentic Agency.md')
    expect(v.status).toBe('idea')
    expect(v['note.priority']).toBe(2)
    expect(v['formula.ppu']).toBe(4)
    expect(v['formula.rel']).toBe(2)
    expect(v['formula.bad']).toBeInstanceOf(ErrorValue)
    expect(v['file.nope']).toBeInstanceOf(ErrorValue)
    expect(r.rows[4].values['note.priority']).toBe(null) // Attribution has no frontmatter
    expect(r.rows[0].values.date).toBeUndefined() // not in order
    expect(r.errors).toEqual([{ where: 'formula.bad', message: expect.stringMatching(/./) }])
  })

  it('dates come through fromYaml', () => {
    const r = run({ order: ['date'], sort: [] })
    expect(r.rows[0].values.date).toEqual(new DateValue(new Date(2026, 7, 1).getTime(), false))
  })
})

describe('runView: filters (GRO-2133)', () => {
  it.each<[string, number]>([
    ['file.hasTag("agentic")', 2],
    ['file.hasTag("ads")', 0],
    ['file.hasTag("attribution")', 1],
    ['file.inFolder("Content Pillars/2. Creator Economy")', 2],
    ['file.hasLink("Agentic Agency")', 2],
    ['note.published == true', 1],
    ['published == true', 1],
    ['status == "idea"', 2],
    ['priority >= 2', 2],
    ['file.ext == "md"', 8],
  ])('%s → %i rows', (filter, count) => {
    const r = run({ filters: filter, sort: [] })
    expect(r.rows).toHaveLength(count)
    expect(r.total).toBe(count)
    expect(r.errors).toEqual([])
  })

  it('file.hasLink matches through the resolver: List of Topics and The Levels of an Agency', () => {
    expect(names(run({ filters: 'file.hasLink("Agentic Agency")', sort: [] }))).toEqual(['The Levels of an Agency', 'List of Topics'])
    expect(names(run({ filters: 'file.hasLink("Content Pillars/1. Agentic Agency/Agentic Agency.md")', sort: [] }))).toEqual([
      'The Levels of an Agency', 'List of Topics',
    ])
  })

  it('and / or / not nest; not = none of the children', () => {
    expect(run({ filters: { and: ['file.inFolder("Content Pillars")', { not: ['status == "idea"'] }] }, sort: [] }).rows).toHaveLength(5)
    expect(run({ filters: { or: ['status == "idea"', 'status == "drafting"'] }, sort: [] }).rows).toHaveLength(3)
    expect(run({ filters: { not: ['status == "idea"', 'status == "published"'] }, sort: [] }).rows).toHaveLength(4)
    expect(run({ filters: { and: [{ or: ['status == "idea"', 'status == "published"'] }, 'file.hasProperty("date")'] }, sort: [] }).rows).toHaveLength(2)
    const both = { and: ['file.inFolder("Content Pillars")'], not: ['status == "idea"'] } as unknown as FilterNode
    expect(run({ filters: both, sort: [] }).rows).toHaveLength(5)
  })

  it('a view filter is AND-ed with the base filter', () => {
    const r = run({ filters: 'status == "idea"', sort: [] }, { filters: 'file.inFolder("Content Pillars")' })
    expect(names(r)).toEqual(['Agentic Agency', 'The Gold In Your Archive'])
    expect(run({ sort: [] }, { filters: 'file.inFolder("Content Pillars")' }).rows).toHaveLength(7)
  })

  it('a non-boolean or error result fails the row', () => {
    expect(run({ filters: 'nope()', sort: [] }).rows).toHaveLength(0)
    expect(run({ filters: 'null', sort: [] }).rows).toHaveLength(0)
    expect(run({ filters: '"yes"', sort: [] }).rows).toHaveLength(8)
  })

  it('a compile error excludes every row and is reported once with its path', () => {
    const r = run({ filters: { and: ['1 +', 'file.ext == "md"'] }, sort: [] })
    expect(r.rows).toHaveLength(0)
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0].where).toBe('views[0].filters[0]')
    expect(r.errors[0].message).toMatch(/./)
    const nested = run({ filters: { or: ['status == "idea"', { not: ['(('] }] }, sort: [] })
    expect(nested.rows).toHaveLength(0)
    expect(nested.errors.map(e => e.where)).toEqual(['views[0].filters[1][0]'])
    const base = run({ sort: [] }, { filters: '1 +' })
    expect(base.rows).toHaveLength(0)
    expect(base.errors.map(e => e.where)).toEqual(['filters'])
    const top = run({ filters: '1 +', sort: [] })
    expect(top.errors.map(e => e.where)).toEqual(['views[0].filters'])
  })

  it('a malformed filter node is an error, not a crash', () => {
    const r = run({ filters: { nope: [] } as unknown as FilterNode, sort: [] })
    expect(r.rows).toHaveLength(0)
    expect(r.errors.map(e => e.where)).toEqual(['views[0].filters'])
  })

  it('`this` is the record at opts.thisFile: backlinks to Agentic Agency', () => {
    const r = run({ filters: 'file.hasLink(this)', sort: [] }, {}, { thisFile: AGENTIC })
    expect(names(r)).toEqual(['The Levels of an Agency', 'List of Topics'])
    expect(run({ filters: 'file.hasLink(this)', sort: [] }, {}, { thisFile: null }).rows).toHaveLength(0)
    expect(run({ filters: 'file.hasLink(this)', sort: [] }, {}, { thisFile: '/vault/nope.md' }).rows).toHaveLength(0)
    expect(run({ filters: 'this.basename == "Agentic Agency"', sort: [] }, {}, { thisFile: AGENTIC }).rows).toHaveLength(8)
  })
})

describe('runView: sort and limit (GRO-2133)', () => {
  it('date DESC puts the two dated notes first and the rest (nulls) last in path order', () => {
    const r = run({ sort: [{ property: 'date', direction: 'DESC' }] })
    expect(names(r)).toEqual(['Agentic Agency', 'Creator Economy', ...PATH_ORDER.filter(n => n !== 'Agentic Agency' && n !== 'Creator Economy')])
    const asc = run({ sort: [{ property: 'note.date', direction: 'ASC' }] })
    expect(names(asc).slice(0, 2)).toEqual(['Creator Economy', 'Agentic Agency'])
    expect(names(asc).slice(2)).toEqual(PATH_ORDER.filter(n => n !== 'Agentic Agency' && n !== 'Creator Economy'))
  })

  it('numbers numeric, strings natural + case-insensitive, booleans false < true, multi-key priority', () => {
    expect(names(run({ sort: [{ property: 'priority', direction: 'DESC' }] })).slice(0, 3)).toEqual([
      'Creator Economy', 'Agentic Agency', 'The Levels of an Agency',
    ])
    expect(names(run({ sort: [{ property: 'file.name', direction: 'DESC' }] }))).toEqual([...PATH_ORDER].sort((a, b) => b.localeCompare(a, undefined, { sensitivity: 'base' })))
    expect(names(run({ sort: [{ property: 'published', direction: 'ASC' }] })).slice(0, 2)).toEqual(['Agentic Agency', 'Creator Economy'])
    expect(names(run({ sort: [{ property: 'published', direction: 'DESC' }] })).slice(0, 2)).toEqual(['Creator Economy', 'Agentic Agency'])
    // status ASC, then priority DESC inside each status
    expect(names(run({ sort: [{ property: 'status', direction: 'ASC' }, { property: 'priority', direction: 'DESC' }] }))).toEqual([
      'The Levels of an Agency', 'Agentic Agency', 'The Gold In Your Archive', 'Creator Economy', 'VSL-v1',
      'Attribution', 'Tech & Silicon Valley', 'List of Topics',
    ])
  })

  it('natural string order: Note 2 before Note 10', () => {
    const recs = ['Note 10', 'Note 2', 'note 1'].map((b, i) => ({ ...TEST_RECORDS[0], path: `/vault/${i}/${b}.md`, basename: b, name: `${b}.md` }))
    const r = runView({ views: [] }, { type: 'table', name: 'T', sort: [{ property: 'file.basename', direction: 'ASC' }] }, recs, {})
    expect(r.rows.map(x => x.record.basename)).toEqual(['note 1', 'Note 2', 'Note 10'])
  })

  it('limit applies after sort; total is the pre-limit count', () => {
    const r = run({ limit: 3 })
    expect(r.rows).toHaveLength(3)
    expect(r.total).toBe(8)
    expect(names(run({ sort: [{ property: 'date', direction: 'DESC' }], limit: 1 }))).toEqual(['Agentic Agency'])
    expect(run({ filters: 'status == "idea"', limit: 5 }).total).toBe(2)
    expect(run({ limit: 0 }).rows).toHaveLength(8) // 0 / negative / NaN → no limit
  })
})

describe('runView: group by (GRO-2133 D6)', () => {
  it('status ASC → drafting, idea, published, then No value last', () => {
    const r = run({ groupBy: { property: 'status' } })
    expect(labels(r)).toEqual(['drafting', 'idea', 'published', 'No value'])
    expect(r.groups!.map(g => g.key)).toEqual(['drafting', 'idea', 'published', null])
    expect(r.groups![3].rows.map(x => x.record.basename)).toEqual(['Attribution', 'Tech & Silicon Valley', 'List of Topics'])
    expect(r.groups![1].rows.map(x => x.record.basename)).toEqual(['Agentic Agency', 'The Gold In Your Archive'])
    expect(r.rows).toHaveLength(8) // flat rows still returned
  })

  it('priority DESC → 3, 2, 1, No value', () => {
    const r = run({ groupBy: { property: 'note.priority', direction: 'DESC' } })
    expect(labels(r)).toEqual(['3', '2', '1', 'No value'])
    expect(r.groups!.map(g => g.key)).toEqual([3, 2, 1, null])
    expect(r.groups![3].rows).toHaveLength(5)
  })

  it('lists group by the whole list; empty string, empty list and null are No value', () => {
    const r = run({ groupBy: { property: 'tags' } })
    expect(labels(r)).toEqual(['agentic, pillar', 'agentic/levels', 'creator', 'No value'])
    expect(r.groups![0].key).toEqual(['agentic', 'pillar'])
    const recs = [
      { ...TEST_RECORDS[0], path: '/vault/a.md', properties: { k: '' } },
      { ...TEST_RECORDS[0], path: '/vault/b.md', properties: { k: [] } },
      { ...TEST_RECORDS[0], path: '/vault/c.md', properties: { k: null } },
      { ...TEST_RECORDS[0], path: '/vault/d.md', properties: { k: 'x' } },
    ]
    const g = runView({ views: [] }, { type: 'table', name: 'T', groupBy: { property: 'k' } }, recs, {})
    expect(labels(g)).toEqual(['x', 'No value'])
    expect(g.groups![1].rows).toHaveLength(3)
  })

  it('groups by a formula and a file field; limit applies before grouping', () => {
    const r = run({ groupBy: { property: 'formula.half' }, limit: 4 }, { formulas: { half: 'if(priority, priority > 1)' } })
    expect(labels(r)).toEqual(['false', 'true', 'No value'])
    expect(r.groups!.reduce((n, g) => n + g.rows.length, 0)).toBe(4)
    expect(run({ groupBy: { property: 'file.folder' } }).groups!.map(g => g.rows.length)).toEqual([1, 2, 2, 1, 1, 1])
  })
})

describe('propertyKeys / propertyLabel (GRO-2133)', () => {
  it('propertyKeys: view.order when set, else file.name + sorted note keys', () => {
    expect(propertyKeys(yasin, yasin.views[0], TEST_RECORDS)).toEqual(['file.name'])
    expect(propertyKeys(yasin, yasin.views[1], TEST_RECORDS)).toEqual([
      'file.name', 'note.cover', 'note.date', 'note.pillar', 'note.priority', 'note.published', 'note.related', 'note.status', 'note.tags', 'note.views',
    ])
    expect(propertyKeys(yasin, yasin.views[1], [])).toEqual(['file.name'])
  })

  it('propertyLabel: displayName (bare or note.-prefixed key) else the key without note.', () => {
    const def: BaseDefinition = { properties: { status: { displayName: 'Status' }, 'note.views': { displayName: 'Views' }, 'file.name': { displayName: 'Name' } }, views: [] }
    expect(propertyLabel(def, 'status')).toBe('Status')
    expect(propertyLabel(def, 'note.status')).toBe('Status')
    expect(propertyLabel(def, 'views')).toBe('Views')
    expect(propertyLabel(def, 'note.views')).toBe('Views')
    expect(propertyLabel(def, 'file.name')).toBe('Name')
    expect(propertyLabel(def, 'note.priority')).toBe('priority')
    expect(propertyLabel(def, 'priority')).toBe('priority')
    expect(propertyLabel(def, 'formula.x')).toBe('formula.x')
    expect(propertyLabel({ views: [] }, 'note.status')).toBe('status')
  })
})

describe('makeResolver (GRO-2132)', () => {
  const files = TEST_RECORDS.map(r => new FileValue(r))
  const resolve = makeResolver(files, '/vault')

  it('matches absolute path, root-relative path (± .md, ± leading slash), then basename; case-insensitive', () => {
    expect(resolve(AGENTIC)?.record.basename).toBe('Agentic Agency')
    expect(resolve('Content Pillars/1. Agentic Agency/Agentic Agency')?.record.path).toBe(AGENTIC)
    expect(resolve('Content Pillars/1. Agentic Agency/Agentic Agency.md')?.record.path).toBe(AGENTIC)
    expect(resolve('/Content Pillars/1. Agentic Agency/Agentic Agency.md')?.record.path).toBe(AGENTIC)
    expect(resolve('agentic agency')?.record.path).toBe(AGENTIC)
    expect(resolve('[[Agentic Agency]]')?.record.path).toBe(AGENTIC)
    expect(resolve('Agentic Agency#Heading')?.record.path).toBe(AGENTIC)
    expect(resolve('Agentic Agency|alias')?.record.path).toBe(AGENTIC)
    expect(resolve('VSL-v1')?.record.path).toBe('/vault/VSL-v1.md')
    expect(resolve('levels.png')).toBe(null)
    expect(resolve('Other/Agentic Agency')).toBe(null)
    expect(resolve('')).toBe(null)
  })

  it('duplicate basenames resolve to the shallowest folder; equal depth → first in the given order (GRO-2190)', () => {
    const dup = [
      { ...TEST_RECORDS[0], path: '/vault/b/Dup.md', basename: 'Dup', folder: 'b' },
      { ...TEST_RECORDS[0], path: '/vault/a/Dup.md', basename: 'Dup', folder: 'a' },
    ].map(r => new FileValue(r))
    expect(makeResolver(dup)('Dup')?.record.path).toBe('/vault/b/Dup.md') // equal depth: first given wins
    expect(makeResolver(dup)('a/Dup')?.record.path).toBe('/vault/a/Dup.md') // a path is never ambiguous
    // a shallower LATER file beats a deeper earlier one (Obsidian's shortest-path rule)
    const deep = [
      { ...TEST_RECORDS[0], path: '/vault/a/b/Dup.md', basename: 'Dup', folder: 'a/b' },
      { ...TEST_RECORDS[0], path: '/vault/z/Dup.md', basename: 'Dup', folder: 'z' },
    ].map(r => new FileValue(r))
    expect(makeResolver(deep)('Dup')?.record.path).toBe('/vault/z/Dup.md')
    expect(makeResolver(deep)('a/b/Dup')?.record.path).toBe('/vault/a/b/Dup.md')
    // the vault root is depth 0 and beats any folder
    const withRoot = [
      { ...TEST_RECORDS[0], path: '/vault/a/Dup.md', basename: 'Dup', folder: 'a' },
      { ...TEST_RECORDS[0], path: '/vault/Dup.md', basename: 'Dup', folder: '' },
    ].map(r => new FileValue(r))
    expect(makeResolver(withRoot)('Dup')?.record.path).toBe('/vault/Dup.md')
  })

  it('resolverFor memoizes per records array identity, per root and per alias mode (GRO-2190, GRO-2214)', () => {
    const r1 = resolverFor(TEST_RECORDS, '/vault')
    expect(resolverFor(TEST_RECORDS, '/vault')).toBe(r1)
    expect(resolverFor(TEST_RECORDS)).not.toBe(r1) // another root key → its own resolver
    expect(resolverFor(TEST_RECORDS, '/vault', { aliases: false })).not.toBe(r1) // name-only → its own
    expect(resolverFor([...TEST_RECORDS], '/vault')).not.toBe(r1) // a new snapshot → a fresh resolver
    expect(r1('Agentic Agency')?.record.path).toBe(AGENTIC)
    expect(r1(AGENTIC)?.record.path).toBe(AGENTIC)
  })
})

describe('makeResolver: frontmatter aliases (Links E2, GRO-2214)', () => {
  /** `Costs/Customer Acquisition Cost.md` answers to `CAC`; `Attribution.md` has none. */
  const aliased = (over: Partial<IndexRecord> = {}): IndexRecord => ({
    ...TEST_RECORDS[0],
    path: '/vault/Costs/Customer Acquisition Cost.md',
    name: 'Customer Acquisition Cost.md',
    basename: 'Customer Acquisition Cost',
    folder: 'Costs',
    aliases: ['CAC', 'Acquisition Cost'],
    ...over,
  })
  const resolve = (records: IndexRecord[]) => makeResolver(records.map(r => new FileValue(r)), '/vault')

  it('an alias resolves to its note, case-insensitively, with `[[…]]` / `|alias` / `#heading` stripped', () => {
    const r = resolve([aliased()])
    const path = '/vault/Costs/Customer Acquisition Cost.md'
    expect(r('CAC')?.record.path).toBe(path)
    expect(r('cac')?.record.path).toBe(path)
    expect(r('[[CAC]]')?.record.path).toBe(path)
    expect(r('CAC|shown')?.record.path).toBe(path)
    expect(r('CAC#Heading')?.record.path).toBe(path)
    expect(r('Acquisition Cost')?.record.path).toBe(path)
    expect(r('Customer Acquisition Cost')?.record.path).toBe(path) // the real name still resolves
    expect(r('Costs/CAC')).toBe(null) // an alias is a NAME: it never joins a folder path
  })

  it('a real name ALWAYS beats an alias, whatever their depths', () => {
    const named = { ...TEST_RECORDS[0], path: '/vault/deep/deeper/CAC.md', name: 'CAC.md', basename: 'CAC', folder: 'deep/deeper' }
    // The aliased note sits shallower (Costs/) and comes first — the basename map still wins.
    expect(resolve([aliased(), named])('CAC')?.record.path).toBe('/vault/deep/deeper/CAC.md')
    expect(resolve([named, aliased()])('CAC')?.record.path).toBe('/vault/deep/deeper/CAC.md')
    // …and the root-relative path form of the named note is unaffected too.
    expect(resolve([aliased(), named])('deep/deeper/CAC')?.record.path).toBe('/vault/deep/deeper/CAC.md')
  })

  it('two notes claiming one alias: shallowest wins; equal depth → first in path order', () => {
    const deep = aliased({ path: '/vault/a/b/Deep.md', name: 'Deep.md', basename: 'Deep', folder: 'a/b', aliases: ['CAC'] })
    const shallow = aliased({ path: '/vault/z/Shallow.md', name: 'Shallow.md', basename: 'Shallow', folder: 'z', aliases: ['CAC'] })
    expect(resolve([deep, shallow])('CAC')?.record.path).toBe('/vault/z/Shallow.md') // a later shallower file wins
    const first = aliased({ path: '/vault/a/First.md', name: 'First.md', basename: 'First', folder: 'a', aliases: ['CAC'] })
    const second = aliased({ path: '/vault/b/Second.md', name: 'Second.md', basename: 'Second', folder: 'b', aliases: ['CAC'] })
    expect(resolve([first, second])('CAC')?.record.path).toBe('/vault/a/First.md')
  })

  it('`{ aliases: false }` builds the NAME-ONLY resolver the rename engine probes with', () => {
    const files = [aliased()].map(r => new FileValue(r))
    expect(makeResolver(files, '/vault', { aliases: false })('CAC')).toBe(null)
    expect(makeResolver(files, '/vault', { aliases: false })('Customer Acquisition Cost')?.record.basename).toBe('Customer Acquisition Cost')
  })

  it('aliases reach every resolver consumer for free — `file.hasLink` sees them', () => {
    const hub = { ...TEST_RECORDS[0], path: '/vault/Hub.md', name: 'Hub.md', basename: 'Hub', folder: '', links: ['CAC'] }
    const records = [hub, aliased()]
    // The hub links `[[CAC]]`; asked about the aliased note's REAL name, hasLink compares
    // RESOLVED paths — both sides land on the same note through the fourth map.
    const hasLink = (arg: string): string[] => {
      const view: BaseView = { type: 'table', name: 'T', filters: `file.hasLink("${arg}")` }
      return names(runView({ views: [view] }, view, records, { root: '/vault' }))
    }
    expect(hasLink('Customer Acquisition Cost')).toEqual(['Hub'])
    expect(hasLink('CAC')).toEqual(['Hub'])
    expect(hasLink('Attribution')).toEqual([])
  })
})

describe('perf (GRO-2133)', () => {
  function record(i: number): IndexRecord {
    return {
      path: `/vault/Library/${i % 7}/Note ${i}.md`,
      name: `Note ${i}.md`,
      basename: `Note ${i}`,
      folder: `Library/${i % 7}`,
      ext: 'md',
      size: i * 10,
      ctime: 1_700_000_000_000 + i,
      mtime: 1_750_000_000_000 + i * 1000,
      properties: { status: i % 3 ? 'todo' : 'done', price: i % 50, title: `Note ${i}`, due: '2026-08-01', tags: ['a', 'b'] },
      aliases: [],
      tags: ['book', `genre/${i % 5}`],
      links: [`Note ${i + 1}`],
      embeds: [],
    }
  }

  it('1000 records × 3-clause filter + 2 formulas + sort + groupBy under 50 ms', () => {
    const records = Array.from({ length: 1000 }, (_, i) => record(i))
    const def: BaseDefinition = {
      formulas: { label: 'if(price, price.toFixed(2) + " dollars")', age: '(now() - file.mtime).days.floor()' },
      views: [
        {
          type: 'table',
          name: 'T',
          filters: { and: ['file.ext == "md"', 'status != "done"', 'price > 10'] },
          order: ['file.name', 'status', 'price', 'formula.label', 'formula.age'],
          sort: [{ property: 'price', direction: 'DESC' }, { property: 'file.name', direction: 'ASC' }],
          groupBy: { property: 'file.folder' },
          summaries: { price: 'Sum' },
        },
      ],
    }
    const go = () => runView(def, def.views[0], records, { thisFile: records[0].path, root: '/vault' })
    go() // warm-up (JIT)
    const t0 = performance.now()
    const r = go()
    const ms = performance.now() - t0
    expect(r.errors).toEqual([])
    expect(r.rows.length).toBeGreaterThan(0)
    expect(r.rows.length).toBeLessThan(1000)
    expect(r.groups).toHaveLength(7)
    expect(r.rows[0].values['formula.label']).toMatch(/dollars$/)
    // eslint-disable-next-line no-console
    console.log(`engine perf: 1000 records in ${ms.toFixed(1)} ms (${r.rows.length} kept)`)
    expect(ms).toBeLessThan(50)
  })
})
