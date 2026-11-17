import { describe, expect, it } from 'vitest'
import type { IndexRecord } from '@shared/types'
import type { ViewDef } from './viewSchema'
import { runView } from './engine'
import { TEST_RECORDS } from './testRecords'

/**
 * YAZ-4799: grouped by Folder, a shortcut counts in the folder it is a shortcut in (a fan-out, as a multi-select's), and
 * under a Folder group only its places inside that group, so a path keeps its pair (App + API) and never makes
 * Clients › API.
 */
describe('runView: a shortcut in each of its folders when grouped by Folder (YAZ-4799)', () => {
  const at = (path: string, properties: Record<string, unknown> = {}, id?: string) => {
    const basename = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '')
    const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
    return { ...TEST_RECORDS[0], path: `/vault/${path}`, basename, title: basename, folder, properties, ...(id !== undefined && { id }) } as IndexRecord
  }
  const folders = [
    { ...at('db/.folder.md', {}, 'DEMO-1'), folder: 'db', title: 'DB' },
    { ...at('db/1-clients/.folder.md', {}, 'DEMO-2'), folder: 'db/1-clients', title: '1) Clients' },
    { ...at('db/1-clients/1-web/.folder.md', {}, 'DEMO-3'), folder: 'db/1-clients/1-web', title: '1) Web browser' },
    { ...at('db/4-app/.folder.md', {}, 'DEMO-4'), folder: 'db/4-app', title: '4) App' },
    { ...at('db/4-app/2-api/.folder.md', {}, 'DEMO-5'), folder: 'db/4-app/2-api', title: '2) API' },
  ]
  const recs = [
    at('db/4-app/2-api/Next.js.md', { also_in: ['DEMO-3'] }),
    at('db/4-app/2-api/Express.md'),
    at('db/1-clients/1-web/React.md'),
  ]
  const page = { folder: 'db', folders, vault: 'V' }
  const T = (groupBy: ViewDef['groupBy']) => runView({ views: [] }, { type: 'table', name: 'T', groupBy }, recs, { page })
  const names = (rows: { record: IndexRecord }[] | undefined) => (rows ?? []).map((x) => x.record.basename).sort()

  it('one Folder level: Next.js under App (its home) and under Clients (its shortcut)', () => {
    const r = T({ property: 'file.folder' })
    expect(r.groups!.map((g) => [g.label, names(g.rows)])).toEqual([
      ['1) Clients', ['Next.js', 'React']],
      ['4) App', ['Express', 'Next.js']],
    ])
  })

  it('Folder then Folder: only the right pairs, never Clients › API or App › Web browser', () => {
    const r = T([{ property: 'file.folder' }, { property: 'file.folder' }])
    const pairs = r.groups!.flatMap((g) => (g.children ?? []).map((c) => [`${g.label} › ${c.label}`, names(c.rows)]))
    expect(pairs).toEqual([
      ['1) Clients › 1) Web browser', ['Next.js', 'React']],
      ['4) App › 2) API', ['Express', 'Next.js']],
    ])
  })

  it('Folder (Depth 2) nests the same pairs inside ONE level (YAZ-4918): a shortcut stays inside the folder group it is a shortcut in', () => {
    const r = T({ property: 'file.folder', depth: 2 })
    const pairs = r.groups!.flatMap((g) => (g.children ?? []).map((c) => [`${g.label} › ${c.label}`, names(c.rows)]))
    expect(pairs).toEqual([
      ['1) Clients › 1) Web browser', ['Next.js', 'React']],
      ['4) App › 2) API', ['Express', 'Next.js']],
    ])
    expect(r.groups!.every((g) => g.nested === true)).toBe(true)
  })

  it('a page with no shortcut groups as before', () => {
    const r = T({ property: 'file.folder' })
    expect(r.groups!.filter((g) => names(g.rows).includes('Express')).map((g) => g.label)).toEqual(['4) App'])
  })
})

/** YAZ-4799 option parents: grouped Layer › Sub-layer, a page joins only the sub-layer groups whose parent is its layer group. */
describe('runView: option parents keep a two-column grouping paired (YAZ-4799)', () => {
  const page = (name: string, properties: Record<string, unknown>) =>
    ({ ...TEST_RECORDS[0], path: `/vault/db/${name}.md`, basename: name, title: name, folder: 'db', properties }) as IndexRecord
  const recs = [
    page('Next.js', { Layer: ['1) Clients', '4) App'], 'Sub-layer': ['1) Web browser', '2) API'] }),
    page('React', { Layer: ['1) Clients'], 'Sub-layer': ['1) Web browser'] }),
    page('Odd', { Layer: ['1) Clients'], 'Sub-layer': ['2) API'] }),
  ]
  const of: Record<string, string> = { '1) Web browser': '1) Clients', '2) API': '4) App' }
  const optionParent = (key: string) => (key === 'Sub-layer' ? { column: 'Layer', of } : undefined)
  const run = (parents: boolean) =>
    runView({ views: [] }, { type: 'table', name: 'T', groupBy: [{ property: 'Layer' }, { property: 'Sub-layer' }] }, recs, parents ? { optionParent } : {})
  const pairs = (r: ReturnType<typeof run>) =>
    r.groups!.flatMap((g) => [
      ...(g.children ?? []).map((c) => `${g.label} › ${c.label}: ${c.rows.map((x) => x.record.basename).sort().join(', ')}`),
      ...((g.direct ?? []).length > 0 ? [`${g.label} (direct): ${(g.direct ?? []).map((x) => x.record.basename).sort().join(', ')}`] : []),
    ])

  it('without parents every combination shows (the bug)', () => {
    expect(pairs(run(false))).toContain('1) Clients › 2) API: Next.js, Odd')
  })

  it('with parents only the right pairs; a page whose sub-layer belongs elsewhere sits directly under its layer, never lost', () => {
    expect(pairs(run(true))).toEqual(['1) Clients › 1) Web browser: Next.js, React', '1) Clients (direct): Odd', '4) App › 2) API: Next.js'])
  })
})
