/**
 * Relation-column helpers (5E, GRO-2217; contract GRO-2120 comment 73479ea3 §4): a view pins a
 * type when the effective filter conjunction (base AND view, and-reachable leaves only — 5D's
 * walk) contains the canonical `page_type == "<x>"` leaf `exprToRule` reads as `note.page_type`
 * `is`; `or`/`not` branches never pin. `relationBasenames` narrows the picker to records whose
 * `page_type` equals the target, falling back to ALL basenames when nothing matches (§3).
 */
import { describe, expect, it } from 'vitest'
import type { IndexRecord } from '@shared/types'
import { parseBase } from './baseFile'
import { pinnedType, relationBasenames } from './relation'

const defOf = (yaml: string) => parseBase(yaml).def

const VIEW_ONLY = 'views:\n  - type: table\n    name: T\n'

describe('pinnedType', () => {
  it('a base-level page_type equality pins the type', () => {
    const def = defOf(`filters: page_type == "kpi"\n${VIEW_ONLY}`)
    expect(pinnedType(def, def.views[0])).toBe('kpi')
  })

  it('a view-level leaf under and: pins too', () => {
    const def = defOf(`views:\n  - type: table\n    name: T\n    filters:\n      and:\n        - page_type == "funnel"\n        - status == "live"\n`)
    expect(pinnedType(def, def.views[0])).toBe('funnel')
  })

  it('accessor spellings note.page_type and note["page_type"] pin as well', () => {
    for (const leaf of ['note.page_type == "kpi"', 'note["page_type"] == "kpi"']) {
      const def = defOf(`filters: '${leaf}'\n${VIEW_ONLY}`)
      expect(pinnedType(def, def.views[0])).toBe('kpi')
    }
  })

  it('nested and: groups are walked; the view leaf wins over the base leaf (last, like deriveSeed)', () => {
    const def = defOf(
      `filters:\n  and:\n    - and:\n        - page_type == "kpi"\nviews:\n  - type: table\n    name: T\n    filters:\n      and:\n        - page_type == "funnel"\n`,
    )
    expect(pinnedType(def, def.views[0])).toBe('funnel')
  })

  it('or: and not: branches never pin', () => {
    const or = defOf(`filters:\n  or:\n    - page_type == "kpi"\n${VIEW_ONLY}`)
    expect(pinnedType(or, or.views[0])).toBeNull()
    const not = defOf(`filters:\n  not:\n    - page_type == "kpi"\n${VIEW_ONLY}`)
    expect(pinnedType(not, not.views[0])).toBeNull()
  })

  it('only the canonical string-equality leaf pins — inequality, contains and numbers do not', () => {
    for (const leaf of ['page_type != "kpi"', 'page_type.contains("kpi")', 'page_type == 3']) {
      const def = defOf(`filters: '${leaf}'\n${VIEW_ONLY}`)
      expect(pinnedType(def, def.views[0])).toBeNull()
    }
  })

  it('no filters → unpinned (vault scope)', () => {
    const def = defOf(VIEW_ONLY)
    expect(pinnedType(def, def.views[0])).toBeNull()
  })
})

const rec = (basename: string, properties: Record<string, unknown>): IndexRecord => ({
  path: `/vault/${basename}.md`,
  name: `${basename}.md`,
  basename,
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

const RECORDS = [
  rec('Alice', { page_type: 'person' }),
  rec('Bob', { page_type: 'person' }),
  rec('Signup', { page_type: 'funnel' }),
  rec('Untyped', {}),
]

describe('relationBasenames', () => {
  it('narrows to records whose page_type equals the target', () => {
    expect(relationBasenames(RECORDS, 'person')).toEqual(['Alice', 'Bob'])
  })

  it('a target no record carries falls back to ALL basenames — never an error (§3)', () => {
    expect(relationBasenames(RECORDS, 'ghost')).toEqual(['Alice', 'Bob', 'Signup', 'Untyped'])
  })
})
