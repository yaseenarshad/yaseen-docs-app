/**
 * "New" note derivation (5D, GRO-2144), pure over the view's filter AST: equality filters and
 * `file.hasTag` become seed frontmatter (YAML types preserved), and names de-duplicate.
 */
import { describe, expect, it } from 'vitest'
import type { ViewSet, ViewDef, FilterNode } from './viewSchema'
import { deriveSeed } from './newNote'
import { ruleToExpr } from './view/filterRows'

/** A minimal def + view around the two filter slots. */
const seed = (viewFilters?: FilterNode, defFilters?: FilterNode) =>
  deriveSeed({ views: [], filters: defFilters } as unknown as ViewSet, { type: 'table', name: 'T', filters: viewFilters } as ViewDef)

describe('deriveSeed', () => {
  it('seeds equality filters with their YAML types preserved', () => {
    const s = seed({ and: ['note.status == "idea"', 'note.priority == 2', 'note.published == false'] })
    expect(s.properties).toEqual({ status: 'idea', priority: 2, published: false })
  })

  it('handles bare identifiers, quoted property names and negative numbers', () => {
    const s = seed({ and: ['status == "idea"', 'note["my prop"] == "v"', 'note.score == -3'] })
    expect(s.properties).toEqual({ status: 'idea', 'my prop': 'v', score: -3 })
  })

  it('a bare string filter node seeds like a one-item and', () => {
    expect(seed('status == "idea"').properties).toEqual({ status: 'idea' })
  })

  it('def filters and view filters both contribute', () => {
    const s = seed({ and: ['status == "idea"'] }, { and: ['pillar == "Agentic"'] })
    expect(s.properties).toEqual({ pillar: 'Agentic', status: 'idea' })
  })

  it('file.hasTag seeds the note’s own tags, merged across rules — beside the values, never among them', () => {
    const s = seed({ and: ['file.hasTag("agentic")', 'file.hasTag("pillar")', 'tags == "a column of that name"'] })
    expect(s).toEqual({ properties: { tags: 'a column of that name' }, tags: ['agentic', 'pillar'] })
  })

  it('ignores non-equality filters', () => {
    const s = seed({ and: ['note.views > 100', 'note.status != "done"', 'note.title.contains("x")', 'note.status.isEmpty()', 'file.name == "x"'] })
    expect(s.properties).toEqual({})
  })

  it('ignores rules inside or / not branches (seeding them would not satisfy the view)', () => {
    const s = seed({ and: ['status == "idea"', { or: ['pillar == "A"', 'pillar == "B"'] }, { not: ['note.archived == true'] }] })
    expect(s.properties).toEqual({ status: 'idea' })
  })

  // The strings the Filter menu actually writes (YAZ-1236): built through `ruleToExpr`, never typed
  // out here, so the seed is pinned to the BUILDER's grammar and moves with it.
  it('a menu-built equality rule seeds its property', () => {
    const s = seed({ and: [ruleToExpr({ property: 'note.status', op: 'is', value: 'Done' })] })
    expect(s.properties).toEqual({ status: 'Done' })
  })

  it('a D5-guarded ordering rule seeds nothing — its leaf is the `&&` guard, not an equality', () => {
    const s = seed({ and: [ruleToExpr({ property: 'note.priority', op: 'lt', value: '3' })] })
    expect(s.properties).toEqual({})
  })

  it('a menu-built nested group contributes nothing while its top-level sibling still seeds', () => {
    const s = seed({
      and: [
        ruleToExpr({ property: 'note.status', op: 'is', value: 'Done' }),
        { or: [ruleToExpr({ property: 'note.priority', op: 'eq', value: '1' })] },
      ],
    })
    expect(s.properties).toEqual({ status: 'Done' })
  })
})
