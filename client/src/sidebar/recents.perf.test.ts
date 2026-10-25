/** The Recents list at the real scale (YAZ-3235): three vaults of 10,000 notes, each with a full save log of MAX_EDITS files. Runs in the `perf` project (YAZ-740). */
import { describe, expect, it } from 'vitest'
import { MAX_EDITS, type TreeNode, type TreeResponse } from '@shared/types'
import { timeMedian } from '../test-perf'
import { MAX_RECENTS, recentDays, recentFiles } from './recents'

const T = 1_700_000_000_000
const HOUR = 60 * 60 * 1000
// 100 folders × 100 notes = 10,000 notes in each vault.
const vault = (root: string): TreeResponse => ({
  root,
  generatedAt: T,
  tree: Array.from({ length: 100 }, (_, f) => ({
    type: 'dir' as const,
    name: `Folder ${f}`,
    path: `${root}/Folder ${f}`,
    children: Array.from({ length: 100 }, (_, n): TreeNode => ({ type: 'file', name: `Note ${n}.md`, path: `${root}/Folder ${f}/Note ${n}.md`, size: 1, mtime: T, kind: 'markdown' })),
  })),
})
const roots = ['/a', '/b', '/c']
// A full log in each vault: 500 different notes, one save every 3 hours, spread over 2 months.
const log = (root: string, shift: number): Record<string, number> => Object.fromEntries(Array.from({ length: MAX_EDITS }, (_, i) => [`${root}/Folder ${i % 100}/Note ${Math.floor(i / 100) * 17}.md`, T - (i * 3 + shift) * HOUR]))

describe('Recents perf (YAZ-3235)', () => {
  it('the first list of 3 × 10,000 notes and 3 full logs is under 50 ms; a save (a new log, the same trees) is under 2 ms', () => {
    const trees = new Map(roots.map((root) => [root, vault(root)]))
    const edits = roots.map((root, i) => log(root, i))
    const t0 = performance.now()
    const files = recentFiles(trees, roots, edits)
    const cold = performance.now() - t0
    expect(edits.every((e) => Object.keys(e).length === MAX_EDITS)).toBe(true)
    expect(files).toHaveLength(MAX_RECENTS)
    expect(cold).toBeLessThan(50)

    // A save: one log is a new object; the trees are the same objects, so their file sets are not read again.
    // The median of 100 saves is the budget (`timeMedian`): re-reading the trees costs every save ~10x it.
    const saves = Array.from({ length: 100 }, (_, i) => [{ ...edits[0], '/a/Folder 0/Note 0.md': T + i }, edits[1], edits[2]])
    const { median, worst } = timeMedian(100, (i) => recentDays(recentFiles(trees, roots, saves[i]), new Date(T)))
    console.log(`recents perf: cold ${cold.toFixed(1)} ms, a save median ${median.toFixed(2)} ms, worst ${worst.toFixed(2)} ms of 100`)
    expect(median).toBeLessThan(2)
  })
})
