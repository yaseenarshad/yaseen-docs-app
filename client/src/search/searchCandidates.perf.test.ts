/** The title-search perf smoke (YAZ-802) — keeps the 1,000+ file acceptance honest. Runs in the `perf` project (YAZ-740). */
import { describe, expect, it } from 'vitest'
import type { IndexRecord, TreeNode } from '@shared/types'
import { allDirs, otherFiles } from '../lib/treeState'
import { fileCandidates, folderCandidates, searchCandidates, searchRows } from './searchCandidates'
import { searchTree } from './searchTree'

const rec = (path: string, aliases: string[] = []): IndexRecord => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const folder = path.slice('/vault/'.length, path.lastIndexOf('/')).replace(/^\/+$/, '')
  return {
    path,
    name,
    basename: name.replace(/\.md$/, ''),
    title: name.replace(/\.md$/, ''),
    folder: path.indexOf('/', '/vault/'.length) === -1 ? '' : folder,
    ext: 'md',
    size: 1,
    ctime: 1,
    mtime: 1,
    properties: {},
    aliases,
    tags: [],
    links: [],
    embeds: [],
  }
}

const file = (path: string, kind: 'markdown' | null): TreeNode => ({ type: 'file', name: path.slice(path.lastIndexOf('/') + 1), path, size: 1, mtime: 1, kind })

describe('searchCandidates', () => {
  it('perf smoke: 2,000 records + 500 folders + 250 other files derive, match and cut to a tree well under a keystroke budget', () => {
    // The tree the Sidebar holds: 50 top-level folders, each with 9 nested (YAZ-1491 🔒 D1), 5 files
    // that are no notes (YAZ-2620 🔒 D3) and 40 notes — 3,250 rows.
    const tree: TreeNode[] = Array.from({ length: 50 }, (_, f) => ({
      type: 'dir' as const,
      name: `folder${f}`,
      path: `/vault/folder${f}`,
      children: [
        ...Array.from({ length: 9 }, (_, j): TreeNode => ({ type: 'dir', name: `sub${j}`, path: `/vault/folder${f}/sub${j}`, children: [] })),
        ...Array.from({ length: 5 }, (_, j) => file(`/vault/folder${f}/Note tool ${f}-${j}.py`, null)),
        ...Array.from({ length: 40 }, (_, j) => file(`/vault/folder${f}/Note ${j * 50 + f}.md`, 'markdown')),
      ],
    }))
    // Every note has an id, so each keystroke also looks for all 2,000 in the query (YAZ-2420 D32).
    const records = Array.from({ length: 2000 }, (_, i) => ({ ...rec(`/vault/folder${i % 50}/Note ${i}.md`, [`N${i}`]), id: `k3m9x2pq${String(i).padStart(4, '0')}` }))
    const start = performance.now()
    const candidates = [...folderCandidates('/vault', allDirs(tree), []), ...searchCandidates(records), ...fileCandidates('/vault', otherFiles(tree))]
    let rows = 0
    // One keystroke is the ranking scan AND the cut of the tree to what it kept (YAZ-2620 🔒 D1).
    for (let i = 0; i < 10; i++) rows = searchTree(tree, new Set(searchRows(candidates, `Note 49`).map((c) => c.path))).order.length
    const elapsed = performance.now() - start
    expect(candidates).toHaveLength(4750) // 500 folder rows + one basename row + one alias row per record + 250 other files
    expect(rows).toBe(11) // `Note 49` and `Note 490`…`Note 499`: the cut found every kept row in the tree
    // The measured ms in the run's output, like every other perf smoke (YAZ-861): a budget that
    // only ever prints on failure hides the drift that walks up to it.
    console.log(`search perf: 2000 records + 500 folders + 250 other files in ${elapsed.toFixed(1)} ms (${candidates.length} candidates, 10 searches, each cut to a tree)`)
    // Alone on an idle pool this is a real budget: ~4 ms measured before the cut, 50 ms allowed.
    expect(elapsed).toBeLessThan(50)
  })
})
