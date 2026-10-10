/** The title-search perf smoke (YAZ-802) — keeps the 1,000+ file acceptance honest. Runs in the `perf` project (YAZ-740). */
import { describe, expect, it } from 'vitest'
import type { IndexRecord, TreeNode } from '@shared/types'
import { allDirs, atOrBelow, otherFiles, pinnedRoots, withoutPaths } from '../lib/treeState'
import { fileCandidates, folderCandidates, searchCandidates, searchRows, type SearchCandidate } from './searchCandidates'
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
/** A change of the text leaves no folder that shows all (YAZ-2662 S53): a keystroke cuts with none. */
const NO_FULL: ReadonlySet<string> = new Set()
// Every note has an id, so each keystroke also looks for all 2,000 in the query (YAZ-2420 D32).
const records = Array.from({ length: 2000 }, (_, i) => ({ ...rec(`/vault/folder${i % 50}/Note ${i}.md`, [`N${i}`]), id: `k3m9x2pq${String(i).padStart(4, '0')}` }))

describe('searchCandidates', () => {
  it('perf smoke: 2,000 records + 500 folders + 250 other files derive, match and cut to a tree well under a keystroke budget', () => {
    const start = performance.now()
    const candidates = [...folderCandidates('/vault', allDirs(tree), []), ...searchCandidates(records), ...fileCandidates('/vault', otherFiles(tree))]
    let rows = 0
    // One keystroke is the ranking scan AND the cut of the tree to what it kept (YAZ-2620 🔒 D1).
    for (let i = 0; i < 10; i++) rows = searchTree(tree, new Set(searchRows(candidates, `Note 49`).map((c) => c.path)), NO_FULL).order.length
    const elapsed = performance.now() - start
    expect(candidates).toHaveLength(4750) // 500 folder rows + one basename row + one alias row per record + 250 other files
    expect(rows).toBe(11) // `Note 49` and `Note 490`…`Note 499`: the cut found every kept row in the tree
    // The measured ms in the run's output, like every other perf smoke (YAZ-861): a budget that
    // only ever prints on failure hides the drift that walks up to it.
    console.log(`search perf: 2000 records + 500 folders + 250 other files in ${elapsed.toFixed(1)} ms (${candidates.length} candidates, 10 searches, each cut to a tree)`)
    // Alone on an idle pool this is a real budget: ~4 ms measured before the cut, 50 ms allowed.
    expect(elapsed).toBeLessThan(50)
  })

  it('perf smoke: 10,000 notes with a number ID. A search by title, by a bare number and by an ID each cost one read of the query (YAZ-2677 D9, S78)', () => {
    const records = Array.from({ length: 10000 }, (_, i) => ({ ...rec(`/vault/folder${i % 50}/Note ${i}.md`, [`N${i}`]), id: `YAZ-${i + 1}` }))
    const candidates = searchCandidates(records, ['YAZ', 'OLD'])
    const time = (query: string): { ms: number; first: string | undefined } => {
      const start = performance.now()
      let first: string | undefined
      for (let i = 0; i < 10; i++) first = searchRows(candidates, query)[0]?.label
      return { ms: (performance.now() - start) / 10, first }
    }
    const title = time('Note 49')
    const number = time('4912')
    const id = time('yaz 4912')
    const was = time('old-4912')
    expect(title.first).toBe('Note 49')
    for (const run of [number, id, was]) expect(run.first).toBe('YAZ-4912 — Note 4911')
    console.log(`search perf: 10000 notes with a number ID (20000 candidates), one search: by title ${title.ms.toFixed(2)} ms, by bare number ${number.ms.toFixed(2)} ms, by ID ${id.ms.toFixed(2)} ms, by letters of before ${was.ms.toFixed(2)} ms`)
    // A search that holds an ID does the title scan too, so it may cost about two of them: never a parse for each note.
    for (const run of [title, number, id, was]) expect(run.ms).toBeLessThan(25)
  })

  // The two groups (YAZ-2662 D2, D4, R2): the same vault with pinned items. What a keystroke pays
  // is the ranking with one look in a set for each match, the cut of the pinned items, and the cut
  // of the tree without those that the top group draws; the set is built when a list or the tree changes (R1).
  it.each([
    ['30 pinned folders', tree.slice(0, 30)],
    ['490 pinned paths: 10 folders, 40 notes of each of 12 more', [...tree.slice(0, 10), ...tree.slice(10, 22).flatMap((dir) => (dir.type === 'dir' ? dir.children.slice(-40) : []))]],
  ])('perf smoke with pinned items: %s', (label, listed) => {
    const candidates = [...folderCandidates('/vault', allDirs(tree), []), ...searchCandidates(records), ...fileCandidates('/vault', otherFiles(tree))]
    const built = performance.now()
    const pinned = pinnedRoots(listed)
    const paths = new Set(pinned.map((node) => node.path))
    const first = new Set(candidates.flatMap((c) => (atOrBelow(paths, c.path) ? [c.path] : [])))
    const start = performance.now()
    let rows: SearchCandidate[] = []
    let drawn = 0
    // `Note` is the widest search of this vault: each of the 2,000 notes and the 250 other files
    // matches, and the ranking with pinned rows first ranks them all before the limit cuts (D4).
    for (let i = 0; i < 10; i++) {
      rows = searchRows(candidates, `Note`, first)
      const hits = new Set(rows.map((c) => c.path))
      const top = searchTree(pinned, hits, NO_FULL)
      drawn = top.order.length + searchTree(withoutPaths(tree, new Set(top.nodes.map((node) => node.path))), hits, NO_FULL).order.length
    }
    const elapsed = performance.now() - start
    expect(rows).toHaveLength(50)
    expect(rows.every((c) => first.has(c.path))).toBe(true) // each pinned match went before each other match
    expect(drawn).toBe(new Set(rows.map((c) => c.path)).size) // the two cuts found each kept row one time
    console.log(`search perf, ${label}: 10 searches, each cut to the two groups, in ${elapsed.toFixed(1)} ms (the set of ${first.size} pinned rows built once, in ${(start - built).toFixed(1)} ms)`)
    expect(elapsed).toBeLessThan(50)
  })
})
