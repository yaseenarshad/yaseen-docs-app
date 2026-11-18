import { describe, expect, it } from 'vitest'
import type { IndexRecord } from '@shared/types'
import { buildTree, visibleRows } from './vaultTree'
import { budgetMs } from '../../../client/src/test-perf'

/** YAZ-5438: the Mac's sidebar tree, its pure parts (order, names, kinds, open folders to any depth). */
const rec = (path: string, title = '', kind?: 'card', cardId?: string): IndexRecord =>
  ({ path, name: path.slice(path.lastIndexOf('/') + 1), title, ...(kind && { kind }), ...(cardId && { cards: [{ id: cardId }] }) }) as unknown as IndexRecord

const show = (rows: ReturnType<typeof visibleRows>) => rows.map((r) => `${'  '.repeat(r.depth)}${r.kind}:${r.label}${r.open ? ' (open)' : ''}`)

describe('the Mac sidebar tree on the phone (YAZ-5438)', () => {
  const records = [
    rec('Phase 10.md', 'Phase 10'),
    rec('phase 2.md', 'phase 2'),
    rec('Alpha.md', ''),
    rec('cards/capital-geo-3.md', 'Capital of France', 'card', 'GEO-3'),
    rec('Work/Notes.md', 'Notes'),
    rec('Work/2026/Plans/Q1.md', 'Q1 plan'),
    rec('.yaseendocs/hidden.md', 'Hidden'),
    rec('Work/.trash/Old.md', 'Old'),
  ]
  const folders = [rec('Work/.folder.md', 'Work things')]

  it('closed: folders first, then files, by name, case-blind, numbers as numbers; a folder by its own title; no hidden rows', () => {
    expect(show(visibleRows(buildTree(records, folders), new Set()))).toEqual(['folder:cards', 'folder:Work things', 'page:Alpha', 'page:phase 2', 'page:Phase 10'])
  })

  it('folders open to any depth, and each keeps its own state', () => {
    const tree = buildTree(records, folders)
    expect(show(visibleRows(tree, new Set(['Work', 'Work/2026', 'Work/2026/Plans', 'cards'])))).toEqual([
      'folder:cards (open)',
      '  card:Capital of France',
      'folder:Work things (open)',
      '  folder:2026 (open)',
      '    folder:Plans (open)',
      '      page:Q1 plan',
      '  page:Notes',
      'page:Alpha',
      'page:phase 2',
      'page:Phase 10',
    ])
    // A closed folder hides its rows, and the open folders inside it keep their state for when it opens again.
    expect(show(visibleRows(tree, new Set(['Work/2026', 'Work/2026/Plans'])))).toContain('folder:Work things')
    expect(visibleRows(tree, new Set(['Work/2026'])).some((r) => r.label === 'Q1 plan')).toBe(false)
  })

  it('a card file opens its card (its ID); Pages leaves card files out', () => {
    const tree = buildTree(records, folders)
    expect(visibleRows(tree, new Set(['cards'])).find((r) => r.kind === 'card')).toMatchObject({ path: 'cards/capital-geo-3.md', id: 'GEO-3' })
    expect(visibleRows(tree, new Set(['cards']), (r) => r.kind !== 'card').map((r) => r.label)).not.toContain('Capital of France')
  })

  // timing test: up to 3 tries so a busy CI machine doesn't fail it (YAZ-4965); still fails if slow every time
  it('5,000 pages: building, and opening a folder of 5,000, each stay far under a long task (50 ms)', { retry: 2 }, () => {
    const many: IndexRecord[] = []
    for (let i = 0; i < 5000; i++) many.push(rec(`Folder ${i % 50}/Big/Page ${i}.md`, `Page ${i}`))
    for (let i = 0; i < 5000; i++) many.push(rec(`All/Page ${i}.md`, `Page ${i}`))
    let t = performance.now()
    const tree = buildTree(many)
    expect(performance.now() - t).toBeLessThan(budgetMs(50))
    t = performance.now()
    const closed = visibleRows(tree, new Set())
    expect(performance.now() - t).toBeLessThan(budgetMs(50))
    expect(closed).toHaveLength(51)
    t = performance.now()
    const open = visibleRows(tree, new Set(['All']))
    expect(performance.now() - t).toBeLessThan(budgetMs(50))
    expect(open).toHaveLength(5051)
    expect(open.slice(0, 4).map((r) => r.label)).toEqual(['All', 'Page 0', 'Page 1', 'Page 2'])
  })
})
