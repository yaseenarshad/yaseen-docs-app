/**
 * The card icon at scale (YAZ-5037): a vault of 10,000 records, 5,000 of them card files (an import of Mochi cards).
 * The window's set of card files is walked once per index snapshot, and kept as the same object while no card file
 * comes or goes, so a save draws no icon again; each icon is one Set lookup. Runs in the `perf` project (YAZ-740).
 */
import { describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { IndexRecord } from '@shared/types'
import { budgetMs, timeMedian } from '../test-perf'
import { cardFilePaths } from './cardFiles'
import { FileIcon, IconsContext, fileIconAttrs, type IconsHere } from './FileIcon'
import { NO_ROW_ICONS } from './rowIcons'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const rec = (path: string, card: boolean, mtime = 1): IndexRecord => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return { path, name, basename: name.slice(0, -3), title: name, folder: 'Cards', ext: 'md', size: 1, ctime: 1, mtime, properties: {}, aliases: [], tags: [], links: [], embeds: [], ...(card && { kind: 'card' as const, cards: [{ id: `GEO-${name}`, off: false, next: false, reviews: [] }] }) }
}
// 5,000 card files and 5,000 pages, in 100 folders.
const records = (mtime = 1): IndexRecord[] => Array.from({ length: 10_000 }, (_, i) => rec(`/v/Folder ${i % 100}/${i < 5_000 ? 'card' : 'page'}-${i}.md`, i < 5_000, mtime))

describe('card files perf (YAZ-5037)', () => {
  it('the set of 5,000 card files in 10,000 records is under 20 ms cold; a save (a new snapshot, the same card files) keeps the same set, under 3 ms', () => {
    const t0 = performance.now()
    const cards = cardFilePaths([{ records: records() }])
    const cold = performance.now() - t0
    expect(cards.size).toBe(5_000)
    expect(cold).toBeLessThan(budgetMs(20))
    // Each save is a new snapshot (a new array, one record newer): the walk is per snapshot, the set the same object.
    const saves = Array.from({ length: 30 }, (_, i) => [{ records: records(i + 2) }])
    const { median, worst, result } = timeMedian(30, (i) => cardFilePaths(saves[i], cards))
    console.log(`card files perf: cold ${cold.toFixed(1)} ms, a save median ${median.toFixed(2)} ms, worst ${worst.toFixed(2)} ms`)
    expect(result).toBe(cards)
    expect(median).toBeLessThan(budgetMs(3))
  })

  it('5,000 card file icons: the attributes in under 10 ms, and a list of 5,000 icons draws in under 400 ms', () => {
    const all = records()
    const here: IconsHere = { rowIcons: NO_ROW_ICONS, roots: ['/v'], cards: cardFilePaths([{ records: all }]) }
    const paths = all.slice(0, 5_000).map((r) => r.path)
    const { median } = timeMedian(10, () => paths.map((p) => fileIconAttrs(here, p, false)['data-kind']))
    expect(paths.every((p) => fileIconAttrs(here, p, false)['data-kind'] === 'card')).toBe(true)
    expect(median).toBeLessThan(budgetMs(10))

    const el = document.body.appendChild(document.createElement('div'))
    const root = createRoot(el)
    const t0 = performance.now()
    act(() =>
      root.render(
        <IconsContext.Provider value={here}>
          {paths.map((p) => (
            <FileIcon key={p} path={p} />
          ))}
        </IconsContext.Provider>,
      ),
    )
    const drawn = performance.now() - t0
    console.log(`card file icons perf: attributes median ${median.toFixed(2)} ms, 5,000 icons drawn in ${drawn.toFixed(0)} ms`)
    expect(el.querySelectorAll('.file-icon[data-kind="card"]')).toHaveLength(5_000)
    expect(drawn).toBeLessThan(budgetMs(400))
    act(() => root.unmount())
    el.remove()
  })
})
