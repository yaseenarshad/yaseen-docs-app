import { describe, expect, it } from 'vitest'
import type { IndexRecord } from '@shared/types'
import type { ViewSet } from './viewSchema'
import { budgetMs, timeMedian } from '../test-perf'
import { type Group, runView } from './engine'
import { optionOrderFor } from './editorType'
import type { FolderSettings } from './folderSettings'
describe('perf (GRO-2133)', () => {
  function record(i: number): IndexRecord {
    return {
      path: `/vault/Library/${i % 7}/Page ${i}.md`,
      name: `Page ${i}.md`,
      basename: `Page ${i}`,
      title: `Page ${i}`,
      folder: `Library/${i % 7}`,
      ext: 'md',
      size: i * 10,
      ctime: 1_700_000_000_000 + i,
      mtime: 1_750_000_000_000 + i * 1000,
      properties: { status: i % 3 ? 'todo' : 'done', price: i % 50, title: `Page ${i}`, due: '2026-08-01', tags: ['a', 'b'] },
      aliases: [],
      tags: ['book', `genre/${i % 5}`],
      links: [`Page ${i + 1}`],
      embeds: [],
    }
  }

  it('1000 records × 3-clause filter + 2 formulas + sort + groupBy under 50 ms', () => {
    const records = Array.from({ length: 1000 }, (_, i) => record(i))
    const def: ViewSet = {
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
    const go = () => runView(def, def.views[0], records, { root: '/vault' })
    go() // warm-up (JIT)
    const { result: r, median: ms, worst } = timeMedian(7, go)
    expect(r.errors).toEqual([])
    expect(r.rows.length).toBeGreaterThan(0)
    expect(r.rows.length).toBeLessThan(1000)
    expect(r.groups).toHaveLength(7)
    expect(r.rows[0].values['formula.label']).toMatch(/dollars$/)
    // eslint-disable-next-line no-console
    console.log(`engine perf: 1000 records, median ${ms.toFixed(1)} ms, worst ${worst.toFixed(1)} ms of 7 (${r.rows.length} kept)`)
    // Runs in the `perf` project, alone on an idle pool (YAZ-740), so this is a real budget:
    // ~18 ms measured, 50 ms allowed. The grouping wave's first cut regressed this 4-6x and was
    // caught HERE — at 150 ms it would have shipped.
    expect(ms).toBeLessThan(budgetMs(50))
  })

  it('1000 records × 3-clause filter + sort + two-level groupBy under 50 ms', () => {
    const records = Array.from({ length: 1000 }, (_, i) => record(i))
    const def: ViewSet = {
      views: [
        {
          type: 'table',
          name: 'T',
          filters: { and: ['file.ext == "md"', 'status != "done"', 'price > 10'] },
          order: ['file.name', 'status', 'price'],
          sort: [{ property: 'price', direction: 'DESC' }, { property: 'file.name', direction: 'ASC' }],
          groupBy: [{ property: 'file.folder' }, { property: 'price' }],
          summaries: { price: 'Sum' },
        },
      ],
    }
    const go = () => runView(def, def.views[0], records, { root: '/vault' })
    go() // warm-up (JIT)
    const { result: r, median: ms, worst } = timeMedian(7, go)
    expect(r.errors).toEqual([])
    expect(r.groups).toHaveLength(7)
    // No price equals a folder name and none is missing, so every row lands in exactly one child.
    expect(r.groups!.every(g => g.direct!.length === 0)).toBe(true)
    expect(r.groups!.every(g => g.children!.length === 39 && g.children!.reduce((n, c) => n + c.rows.length, 0) === g.rows.length)).toBe(true)
    // eslint-disable-next-line no-console
    console.log(`engine perf: 1000 records, two levels, median ${ms.toFixed(1)} ms, worst ${worst.toFixed(1)} ms of 7 (${r.rows.length} kept)`)
    // The inner level buckets each outer separately (YAZ-745), so the same budget must still hold.
    expect(ms).toBeLessThan(budgetMs(50))
  })

  it('1000 records × 3-clause filter + sort + three-level groupBy under 50 ms (YAZ-4531)', () => {
    const records = Array.from({ length: 1000 }, (_, i) => record(i))
    const def: ViewSet = {
      views: [
        {
          type: 'table',
          name: 'T',
          filters: { and: ['file.ext == "md"', 'status != "done"', 'price > 10'] },
          order: ['file.name', 'status', 'price'],
          sort: [{ property: 'price', direction: 'DESC' }, { property: 'file.name', direction: 'ASC' }],
          groupBy: [{ property: 'file.folder' }, { property: 'price' }, { property: 'status' }],
          summaries: { price: 'Sum' },
        },
      ],
    }
    const go = () => runView(def, def.views[0], records, { root: '/vault' })
    go() // warm-up (JIT)
    const { result: r, median: ms, worst } = timeMedian(7, go)
    expect(r.errors).toEqual([])
    expect(r.groups).toHaveLength(7)
    // Every kept row is `todo`, so each price group holds one status group with all its rows.
    const second = r.groups!.flatMap(g => g.children!)
    expect(second.every(c => c.children!.length === 1 && c.children![0].rows.length === c.rows.length)).toBe(true)
    // eslint-disable-next-line no-console
    console.log(`engine perf: 1000 records, three levels, median ${ms.toFixed(1)} ms, worst ${worst.toFixed(1)} ms of 7 (${r.rows.length} kept)`)
    expect(ms).toBeLessThan(budgetMs(50))
  })

  it('1000 pages in a 5-level folder tree × Folder (All) nested, then Status, under 50 ms, one group per folder (YAZ-4918)', () => {
    // 1000 pages over 5 folder levels under the page `Library`: a fixed tree, 4 subfolders at each step, so the tree is
    // built from the paths alone, and every folder has pages of its own and in its subfolders.
    const dirs: string[] = []
    const grow = (dir: string, level: number) => {
      dirs.push(dir)
      if (level < 5) for (let k = 0; k < 4; k++) grow(`${dir}/f${k}`, level + 1)
    }
    grow('Library', 1)
    // 1 + 4 + 16 + 64 + 256 = 341 folders, the page's own among them.
    expect(dirs).toHaveLength(341)
    const records = Array.from({ length: 1000 }, (_, i) => {
      const folder = dirs[i % dirs.length]
      return { ...record(i), path: `/vault/${folder}/Page ${i}.md`, folder }
    })
    const folders: IndexRecord[] = dirs.map((folder, i) => ({ ...record(i), path: `/vault/${folder}/.folder.md`, name: '.folder.md', folder, title: `T ${folder}` }))
    const page = { folder: 'Library', folders, vault: 'V' }
    const def: ViewSet = {
      views: [{ type: 'table', name: 'T', order: ['file.name', 'status'], sort: [{ property: 'file.name', direction: 'ASC' }], groupBy: [{ property: 'file.folder', depth: 'all' }, { property: 'status' }] }],
    }
    const go = () => runView(def, def.views[0], records, { root: '/vault', page })
    go()
    const { result: r, median: ms, worst } = timeMedian(7, go)
    expect(r.errors).toEqual([])
    // Count guards (no slack): one group per folder, the Status groups inside each DEEPEST folder (a folder's own pages
    // above its subfolders sit unsplit, the merge rule; the page's own pages form a group with no subfolder under it,
    // so it gets them too), and every row placed once.
    const leaves = new Map<string, Set<string>>()
    for (const r of records) if (r.folder === 'Library' || r.folder.split('/').length === 5) (leaves.get(r.folder) ?? leaves.set(r.folder, new Set()).get(r.folder)!).add(r.properties.status as string)
    expect(leaves.size).toBe(257)
    let folderGroups = 0
    let statusGroups = 0
    let placed = 0
    const walk = (groups: readonly Group[], level: number) => {
      for (const g of groups) {
        if (level === 0) folderGroups++
        else statusGroups++
        if (g.children === undefined) placed += g.rows.length
        else {
          placed += g.direct!.length
          walk(g.children, g.nested ? level : level + 1)
        }
      }
    }
    walk(r.groups!, 0)
    expect(folderGroups).toBe(341)
    expect(statusGroups).toBe([...leaves.values()].reduce((n, set) => n + set.size, 0))
    expect(placed).toBe(1000)
    // eslint-disable-next-line no-console
    console.log(`engine perf: 1000 pages, Folder (All) then Status, median ${ms.toFixed(1)} ms, worst ${worst.toFixed(1)} ms of 7`)
    expect(ms).toBeLessThan(budgetMs(50))
  })

  it('1000 records × sort + two-level groupBy on Select columns with optionOrder under 50 ms (YAZ-3940)', () => {
    const records = Array.from({ length: 1000 }, (_, i) => record(i))
    // 50 options for price (one per value, in a shuffled order) and 2 for status: the option rank is a Map lookup.
    const prices = Array.from({ length: 50 }, (_, i) => String((i * 17) % 50))
    for (const r of records) r.properties.price = String(r.properties.price)
    const optionOrder = (property: string) => (property === 'price' ? prices : property === 'status' ? ['todo', 'done'] : undefined)
    const def: ViewSet = {
      views: [
        {
          type: 'table',
          name: 'T',
          order: ['file.name', 'status', 'price'],
          sort: [{ property: 'price', direction: 'DESC' }, { property: 'file.name', direction: 'ASC' }],
          groupBy: [{ property: 'status' }, { property: 'price' }],
          summaries: { price: 'Sum' },
        },
      ],
    }
    const go = () => runView(def, def.views[0], records, { root: '/vault', optionOrder })
    go() // warm-up (JIT)
    const { result: r, median: ms, worst } = timeMedian(7, go)
    expect(r.errors).toEqual([])
    expect(r.groups!.map(g => g.key)).toEqual(['todo', 'done'])
    // The inner groups follow the option order, not the value order.
    const inner = r.groups![0].children!.map(c => c.key)
    expect(inner).toEqual(prices.filter(p => inner.includes(p)))
    expect(r.rows[0].values.price).toBe(prices[prices.length - 1])
    // eslint-disable-next-line no-console
    console.log(`engine perf: 1000 records, option order, median ${ms.toFixed(1)} ms, worst ${worst.toFixed(1)} ms of 7 (${r.rows.length} kept)`)
    expect(ms).toBeLessThan(budgetMs(50))
  })

  it('1000 records × sort + two-level groupBy on Select columns with the REAL optionOrder (ViewsPane\'s) under 50 ms (YAZ-4544)', () => {
    const records = Array.from({ length: 1000 }, (_, i) => record(i))
    const prices = Array.from({ length: 50 }, (_, i) => String((i * 17) % 50))
    for (const r of records) r.properties.price = String(r.properties.price)
    // The folder declares both columns, as the column editor writes them: `columnTyping` still reads every record.
    const settings: FolderSettings = { columns: { price: { kind: 'select', options: prices }, status: { kind: 'select', options: ['todo', 'done'] } }, views: [], problems: [] }
    const def: ViewSet = {
      views: [
        {
          type: 'table',
          name: 'T',
          order: ['file.name', 'status', 'price'],
          sort: [{ property: 'price', direction: 'DESC' }, { property: 'file.name', direction: 'ASC' }],
          groupBy: [{ property: 'status' }, { property: 'price' }],
        },
      ],
    }
    // A new snapshot each run: the cache starts empty, the worst case.
    const go = () => runView(def, def.views[0], records, { root: '/vault', optionOrder: optionOrderFor(records, null, settings) })
    go() // warm-up (JIT)
    const { result: r, median: ms, worst } = timeMedian(7, go)
    expect(r.errors).toEqual([])
    expect(r.groups!.map(g => g.key)).toEqual(['todo', 'done'])
    const inner = r.groups![0].children!.map(c => c.key)
    expect(inner).toEqual(prices.filter(p => inner.includes(p)))
    // One snapshot answers each key once: a second ask gets the same list, not a new scan.
    // (A sorted option list is a new array each typing, so the same array means one typing.)
    const order = optionOrderFor(records, null, { ...settings, columns: { price: { kind: 'select', options: prices, optionSort: 'ascending' } } })
    expect(order('price')).toEqual([...prices].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })))
    expect(order('price')).toBe(order('price'))
    // eslint-disable-next-line no-console
    console.log(`engine perf: 1000 records, real option order, median ${ms.toFixed(1)} ms, worst ${worst.toFixed(1)} ms of 7`)
    expect(ms).toBeLessThan(budgetMs(50))
  })
})
