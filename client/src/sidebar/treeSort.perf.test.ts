/** The sidebar sort at the repo's 10k-note scale (YAZ-3227): a level, a whole tree and a save stay far under a frame. Runs in the `perf` project (YAZ-740). */
import { describe, expect, it } from 'vitest'
import type { TabSort, TreeNode, TreeResponse } from '@shared/types'
import { pageLabel } from '../lib/pageLabel'
import { searchTree } from '../search/searchTree'
import { sortLevel, timeOf, withMtime } from './treeSort'
import { timeMedian } from '../test-perf'

// 100 folders × 10 subfolders × 10 notes = 10,000 notes, each with its own time; plus a level of 108 rows, the largest one a real vault has.
const note = (path: string, mtime: number): TreeNode => ({ type: 'file', name: path.slice(path.lastIndexOf('/') + 1), path, size: 1, mtime, kind: 'markdown' })
const tree = (): TreeNode[] =>
  Array.from({ length: 100 }, (_, f) => ({
    type: 'dir' as const,
    name: `Folder ${f}`,
    path: `/v/Folder ${f}`,
    children: Array.from({ length: 10 }, (_, s) => ({
      type: 'dir' as const,
      name: `Sub ${s}`,
      path: `/v/Folder ${f}/Sub ${s}`,
      children: Array.from({ length: 10 }, (_, n) => note(`/v/Folder ${f}/Sub ${s}/Note ${n}.md`, (f * 100 + s * 10 + n) * 7919 % 10_000)),
    })),
  }))
/** The label the rows draw (`Tree.tsx`): no title known, so the file name without `.md`, as for a note the index has not read. */
const NO_TITLES = new Map<string, string>()
const label = (node: TreeNode) => pageLabel(node.path, node.type === 'dir', NO_TITLES)
const UPDATED: TabSort = { by: 'updated', reverse: false }

/** Every level of the tree sorted, as a fully open sidebar draws it. */
function sortAll(nodes: TreeNode[], sort: TabSort): number {
  let rows = 0
  for (const node of sortLevel(nodes, sort, label)) {
    rows += 1
    if (node.type === 'dir') rows += sortAll(node.children, sort)
  }
  return rows
}

describe('sidebar sort perf (YAZ-3227)', () => {
  it('a 108-row level sorts by name in well under 1 ms', () => {
    const level = Array.from({ length: 108 }, (_, i) => note(`/v/Phase ${(i * 37) % 108}.md`, i))
    sortLevel(level, { by: 'name', reverse: false }, label)
    const { median } = timeMedian(100, (i) => sortLevel(level, { by: 'name', reverse: i % 2 === 1 }, label))
    expect(median).toBeLessThan(1)
  })

  it('every level of 10,000 notes, fully open, sorts by Last updated in under 50 ms — the folder times come once per tree', () => {
    const nodes = tree()
    const t0 = performance.now()
    expect(sortAll(nodes, UPDATED)).toBe(11_100)
    const cold = performance.now() - t0
    const t1 = performance.now()
    sortAll(nodes, { by: 'updated', reverse: true })
    const warm = performance.now() - t1
    console.log(`sortAll 10k: cold ${cold.toFixed(1)} ms, warm ${warm.toFixed(1)} ms`)
    expect(cold).toBeLessThan(50)
  })

  it('a save patches one time into 10,000 notes in under 1 ms', () => {
    let trees: ReadonlyMap<string, TreeResponse> = new Map([['/v', { root: '/v', tree: tree() } as TreeResponse]])
    const { median: each, worst } = timeMedian(100, (i) => (trees = withMtime(trees, '/v', `/v/Folder ${i}/Sub 9/Note 9.md`, 20_000 + i)))
    console.log(`withMtime 10k: median ${(each * 1000).toFixed(0)} µs per save, worst ${(worst * 1000).toFixed(0)} µs of 100`)
    expect(each).toBeLessThan(1)
  })

  it('a keystroke on Search (YAZ-3511): 50 matches cut from 10,000 notes, sorted by Last updated, each row\'s date, in under 2 ms', () => {
    const nodes = tree()
    // 50 matches spread over the vault, a new set each run: each keystroke cuts a new tree, so no folder time is warm.
    const hitsOf = (run: number) => new Set(Array.from({ length: 50 }, (_, i) => `/v/Folder ${(i * 2 + run) % 100}/Sub ${i % 10}/Note ${(i + run) % 10}.md`))
    const keystroke = (run: number) => {
      const cut = searchTree(nodes, hitsOf(run), new Set())
      let dated = 0
      const draw = (level: readonly TreeNode[]): void => {
        for (const node of sortLevel(level, UPDATED, label)) {
          if (timeOf(node) > 0) dated += 1
          if (node.type === 'dir') draw(node.children)
        }
      }
      draw(cut.nodes)
      return dated
    }
    expect(keystroke(0)).toBeGreaterThanOrEqual(50)
    const { median, worst } = timeMedian(100, keystroke)
    console.log(`search keystroke, 50 of 10k by Last updated: median ${(median * 1000).toFixed(0)} µs, worst ${(worst * 1000).toFixed(0)} µs of 100`)
    expect(median).toBeLessThan(2)
  })
})
