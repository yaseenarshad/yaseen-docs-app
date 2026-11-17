/**
 * Option parents, "Not set" vs "Any" (YAZ-4799 demo). Grouped Layer › Sub-layer with "Show empty groups" on:
 * - a sub-layer whose parent is a layer gets an empty group under that layer only;
 * - an "Any" sub-layer (`parent.any`) gets one under each layer;
 * - a "Not set" sub-layer (no parent, not in `any`) gets none: it shows only where its pages are.
 * And `.folder.md` reads `parent.any`, dropping an entry that also has a parent.
 */
import { describe, expect, it } from 'vitest'
import type { IndexRecord } from '@shared/types'
import type { ColumnTyping } from './editorType'
import { runView } from './engine'
import { boardOptionGroups } from './boardOptionGroups'
import { folderSettings } from './folderSettings'
import { TEST_RECORDS } from './testRecords'
import type { ViewDef } from './viewSchema'

const LAYERS = ['1) Clients', '2) Edge']
const SUBS = ['DNS', 'CDN', 'Browser', 'Logs']
const select = (options: string[]): ColumnTyping => ({ assigned: 'select', dominant: null, options })
const typing = (key: string) => (key === 'note.Layer' ? select(LAYERS) : select(SUBS))
const view: ViewDef = { type: 'table', name: 'T', groupBy: [{ property: 'note.Layer' }, { property: 'note.Sub' }], showEmptyColumns: true }
const page = (name: string, properties: Record<string, unknown>) =>
  ({ ...TEST_RECORDS[0], path: `/vault/db/${name}.md`, basename: name, title: name, folder: 'db', properties }) as IndexRecord

/**
 * Browser's parent is Clients; DNS's is Edge; CDN is "Any"; Logs is "Not set" and has one page, under Edge.
 * Only Browser and Logs have pages.
 */
const recs = [page('Chrome', { Layer: '1) Clients', Sub: 'Browser' }), page('Loki', { Layer: '2) Edge', Sub: 'Logs' })]
const parent = { column: 'Layer', of: { Browser: '1) Clients', DNS: '2) Edge' }, any: ['CDN'] }
const optionParent = (key: string) => (key === 'note.Sub' || key === 'Sub' ? parent : undefined)

function shown(v: ViewDef = view) {
  const groups = runView({ views: [v] }, v, recs, { optionParent }).groups
  const out = boardOptionGroups(groups, v, typing, optionParent)!
  return Object.fromEntries(out.map((g) => [String(g.key), (g.children ?? []).map((c) => `${String(c.key)} ${c.rows.length}`)]))
}

describe('YAZ-4799 demo: empty sub-layer groups under a parent group', () => {
  it('YAZ-4799 demo: a "Not set" option gets no empty group under a parent; "Any" gets one under each; a parented one only under its parent', () => {
    expect(shown()).toEqual({
      '1) Clients': ['CDN 0', 'Browser 1'],
      '2) Edge': ['DNS 0', 'CDN 0', 'Logs 1'],
    })
  })

  it('YAZ-4799 demo: a "Not set" option still shows where it has pages (Logs under Edge), never under another layer', () => {
    const s = shown()
    expect(s['2) Edge']).toContain('Logs 1')
    expect(s['1) Clients'].some((c) => c.startsWith('Logs'))).toBe(false)
  })

  it('YAZ-4799 demo: by value (A → Z) the same rule holds', () => {
    const byValue: ViewDef = { ...view, groupBy: [{ property: 'note.Layer' }, { property: 'note.Sub', by: 'value' }] }
    expect(shown(byValue)).toEqual({
      '1) Clients': ['Browser 1', 'CDN 0'],
      '2) Edge': ['CDN 0', 'DNS 0', 'Logs 1'],
    })
  })

  it('YAZ-4799 demo: with "Show empty groups" off, only groups with pages show', () => {
    expect(shown({ ...view, showEmptyColumns: false })).toEqual({ '1) Clients': ['Browser 1'], '2) Edge': ['Logs 1'] })
  })

  it('YAZ-4799 demo: grouped by the sub-layer alone (no parent level above), every option gets its empty group', () => {
    const flat: ViewDef = { ...view, groupBy: [{ property: 'note.Sub' }] }
    const out = boardOptionGroups(runView({ views: [flat] }, flat, recs, { optionParent }).groups, flat, typing, optionParent)!
    expect(out.map((g) => g.key)).toEqual(['DNS', 'CDN', 'Browser', 'Logs'])
  })
})

describe('YAZ-4799 demo: folderSettings reads parent.any', () => {
  const settingsOf = (parentDecl: unknown) =>
    folderSettings({ ...TEST_RECORDS[0], path: '/vault/db/.folder.md', properties: { folder_settings: { columns: { Sub: { kind: 'select', options: SUBS, parent: parentDecl } } } } } as IndexRecord, true)

  it('YAZ-4799 demo: `any` reads as a list of option names; nothing for "Not set"', () => {
    const s = settingsOf({ column: 'Layer', of: { Browser: '1) Clients' }, any: ['CDN', 'Logs'] })
    expect(s.columns.Sub.parent).toEqual({ column: 'Layer', of: { Browser: '1) Clients' }, any: ['CDN', 'Logs'] })
    expect(s.problems).toEqual([])
    expect(settingsOf({ column: 'Layer', of: { Browser: '1) Clients' } }).columns.Sub.parent).toEqual({ column: 'Layer', of: { Browser: '1) Clients' } })
  })

  it('YAZ-4799 demo: an `any` entry that also has a parent keeps the parent and leaves `any`; repeats and non-text drop', () => {
    const s = settingsOf({ column: 'Layer', of: { Browser: '1) Clients' }, any: ['Browser', 'CDN', 'CDN', 3, ''] })
    expect(s.columns.Sub.parent).toEqual({ column: 'Layer', of: { Browser: '1) Clients' }, any: ['CDN'] })
  })

  it('YAZ-4799 demo: an `any` left empty after the drops writes no `any`', () => {
    expect(settingsOf({ column: 'Layer', of: { Browser: '1) Clients' }, any: ['Browser'] }).columns.Sub.parent).toEqual({ column: 'Layer', of: { Browser: '1) Clients' } })
    expect(settingsOf({ column: 'Layer', of: {}, any: 'CDN' }).columns.Sub.parent).toEqual({ column: 'Layer', of: {} })
  })
})
