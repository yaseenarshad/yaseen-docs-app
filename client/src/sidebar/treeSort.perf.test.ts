/** The sidebar sort at the repo's 10k-note scale (YAZ-3227): a level, a whole tree and a save stay far under a frame. Runs in the `perf` project (YAZ-740). */
import { describe, expect, it } from 'vitest'
import type { TabSort, TreeNode, TreeResponse } from '@shared/types'
import { sortLevel, withMtime } from './treeSort'

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
const label = (node: TreeNode) => node.name
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
    const t0 = performance.now()
    for (let i = 0; i < 100; i++) sortLevel(level, { by: 'name', reverse: i % 2 === 1 }, label)
    expect((performance.now() - t0) / 100).toBeLessThan(1)
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
    const t0 = performance.now()
    for (let i = 0; i < 100; i++) trees = withMtime(trees, '/v', `/v/Folder ${i}/Sub 9/Note 9.md`, 20_000 + i)
    const each = (performance.now() - t0) / 100
    console.log(`withMtime 10k: ${(each * 1000).toFixed(0)} µs per save`)
    expect(each).toBeLessThan(1)
  })
})
