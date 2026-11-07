import { describe, expect, it } from 'vitest'
import type { IndexRecord } from '@shared/types'
import type { ViewSet } from './viewSchema'
import { budgetMs, timeMedian } from '../test-perf'
import { runView } from './engine'
describe('perf (GRO-2133)', () => {
  function record(i: number): IndexRecord {
    return {
      path: `/vault/Library/${i % 7}/Note ${i}.md`,
      name: `Note ${i}.md`,
      basename: `Note ${i}`,
      title: `Note ${i}`,
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
})
