/** The title-search perf smoke (YAZ-802) — keeps the 1,000+ file acceptance honest. Runs in the `perf` project (YAZ-740). */
import { describe, expect, it } from 'vitest'
import { pageFileName } from '@shared/pageName'
import type { IndexRecord, TreeNode } from '@shared/types'
import { allDirs, atOrBelow, otherFiles, pinnedRoots, withoutPaths } from '../lib/treeState'
import { fileCandidates, folderCandidates, searchCandidates, searchRows, type SearchCandidate } from './searchCandidates'
import { searchTree } from './searchTree'
import { budgetMs, timeMedian } from '../test-perf'

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
// that are no pages (YAZ-2620 🔒 D3) and 40 pages — 3,250 rows.
const tree: TreeNode[] = Array.from({ length: 50 }, (_, f) => ({
  type: 'dir' as const,
  name: `folder${f}`,
  path: `/vault/folder${f}`,
  children: [
    ...Array.from({ length: 9 }, (_, j): TreeNode => ({ type: 'dir', name: `sub${j}`, path: `/vault/folder${f}/sub${j}`, children: [] })),
    ...Array.from({ length: 5 }, (_, j) => file(`/vault/folder${f}/Page tool ${f}-${j}.py`, null)),
    ...Array.from({ length: 40 }, (_, j) => file(`/vault/folder${f}/Page ${j * 50 + f}.md`, 'markdown')),
  ],
}))
/** A change of the text leaves no folder that shows all (YAZ-2662 S53): a keystroke cuts with none. */
const NO_FULL: ReadonlySet<string> = new Set()
// Every page has an id, so each keystroke also looks for all 2,000 in the query (YAZ-2420 D32). Its file name is the one
// the app gives it (`page-12-k3m9x2pq0012`), which adds no file-name row; one page in ten was named by hand (`2026-10`)
// and adds one (YAZ-3748 B4). The derive reads each name, so it pays for both.
const records = Array.from({ length: 2000 }, (_, i) => {
  const id = `k3m9x2pq${String(i).padStart(4, '0')}`
  return { ...rec(`/vault/folder${i % 50}/Page ${i}.md`, [`N${i}`]), id, basename: i % 10 === 0 ? `2026-${i}` : pageFileName(`Page ${i}`, id).slice(0, -'.md'.length) }
})

/** One warm-up run (the first run of a file pays the JIT), then the median of 5 (`timeMedian`). */
const warmMedian = <T>(run: () => T): { ms: number; result: T } => {
  run()
  const { median: ms, result } = timeMedian(5, run)
  return { ms, result }
}

describe('searchCandidates', () => {
  it('perf smoke: 2,000 records + 500 folders + 250 other files derive, match and cut to a tree well under a keystroke budget', () => {
    const { ms: elapsed, result: { candidates, rows } } = warmMedian(() => {
      const candidates = [...folderCandidates('/vault', allDirs(tree), []), ...searchCandidates(records), ...fileCandidates('/vault', otherFiles(tree))]
      let rows = 0
      // One keystroke is the ranking scan AND the cut of the tree to what it kept (YAZ-2620 🔒 D1).
      for (let i = 0; i < 10; i++) rows = searchTree(tree, new Set(searchRows(candidates, `Page 49`).map((c) => c.path)), NO_FULL).order.length
      return { candidates, rows }
    })
    expect(candidates).toHaveLength(4950) // 500 folder rows + one title row + one alias row per record + 200 file-name rows (B4) + 250 other files
    // `Page 49` and `Page 490`…`Page 499` by their text, and `Page tool 49-0.py`…`Page tool 49-4.py` by their words
    // (YAZ-3748 D2): the cut found every kept row in the tree.
    expect(rows).toBe(16)
    // The measured ms in the run's output, like every other perf smoke (YAZ-861): a budget that
    // only ever prints on failure hides the drift that walks up to it.
    console.log(`search perf: 2000 records + 500 folders + 250 other files in ${elapsed.toFixed(1)} ms (${candidates.length} candidates, 10 searches, each cut to a tree)`)
    // Alone on an idle pool, warm and the median of 5 runs, this is a real budget: ~3 ms measured, 50 ms allowed.
    expect(elapsed).toBeLessThan(budgetMs(50))
  })

  it('perf smoke: 10,000 pages with a number ID. A search by title, by a bare number and by an ID each cost one read of the query (YAZ-2677 D9, S78)', () => {
    const records = Array.from({ length: 10000 }, (_, i) => ({ ...rec(`/vault/folder${i % 50}/Page ${i}.md`, [`N${i}`]), id: `YAZ-${i + 1}` }))
    const candidates = searchCandidates(records, ['YAZ', 'OLD'])
    const time = (query: string): { ms: number; first: string | undefined } => {
      const { ms, result: first } = warmMedian(() => {
        let first: string | undefined
        for (let i = 0; i < 10; i++) first = searchRows(candidates, query)[0]?.label
        return first
      })
      return { ms: ms / 10, first }
    }
    const title = time('Page 49')
    const number = time('4912')
    const id = time('yaz 4912')
    const was = time('old-4912')
    // No match (YAZ-3748 D2): the costliest text, as each row runs every tier. `page` starts a word of each row, so
    // the word match reads every row up to `xyzzy`, and then the joined match looks for `notexyzzy` in each.
    const none = time('page xyzzy')
    expect(title.first).toBe('Page 49')
    for (const run of [number, id, was]) expect(run.first).toBe('YAZ-4912 — Page 4911')
    expect(none.first).toBeUndefined()
    console.log(`search perf: 10000 pages with a number ID (20000 candidates), one search: by title ${title.ms.toFixed(2)} ms, by bare number ${number.ms.toFixed(2)} ms, by ID ${id.ms.toFixed(2)} ms, by letters of before ${was.ms.toFixed(2)} ms, no match ${none.ms.toFixed(2)} ms`)
    // A search that holds an ID does the title scan too, so it may cost about two of them: never a parse for each page.
    for (const run of [title, number, id, was, none]) expect(run.ms).toBeLessThan(budgetMs(25))
  })

  it('perf smoke (YAZ-5037): 5,000 cards inside 1,000 pages and 500 card files, Review on. The rows come from the index alone, and a search by title, by an exact ID and with no match each stay well under a keystroke', () => {
    const card = (n: number) => ({ id: `YAZ-${n}`, off: false, next: false, reviews: [], title: `Capital ${n}` })
    const pages = Array.from({ length: 1000 }, (_, i) => ({ ...rec(`/vault/folder${i % 50}/Deck ${i}.md`), id: `YAZ-${i + 1}`, cards: Array.from({ length: 5 }, (_, j) => card(10_000 + i * 5 + j)) }))
    const cardFiles = Array.from({ length: 500 }, (_, i) => ({ ...rec(`/vault/folder${i % 50}/capital-${20_000 + i}-yaz-${20_000 + i}.md`), title: `Capital ${20_000 + i}`, kind: 'card' as const, cards: [card(20_000 + i)] }))
    const records = [...pages, ...cardFiles]
    const { ms: derive, result: candidates } = warmMedian(() => searchCandidates(records, ['YAZ'], true))
    // One row per page, per card inside a page, and per card file: a card file is one row.
    expect(candidates).toHaveLength(1000 + 5000 + 500)
    const time = (query: string): { ms: number; first: string | undefined } => {
      const { ms, result: first } = warmMedian(() => {
        let first: string | undefined
        for (let i = 0; i < 10; i++) first = searchRows(candidates, query)[0]?.label
        return first
      })
      return { ms: ms / 10, first }
    }
    const title = time('Capital 12345')
    const id = time('yaz-12345')
    const none = time('capital xyzzy')
    expect(title.first).toBe('Capital 12345')
    expect(id.first).toBe('YAZ-12345 — Capital 12345')
    expect(none.first).toBeUndefined()
    console.log(`search perf: 5000 cards in 1000 pages + 500 card files (${candidates.length} candidates), built in ${derive.toFixed(1)} ms; one search: by title ${title.ms.toFixed(2)} ms, by ID ${id.ms.toFixed(2)} ms, no match ${none.ms.toFixed(2)} ms`)
    // Built once per index snapshot, never per keystroke.
    expect(derive).toBeLessThan(budgetMs(50))
    for (const run of [title, id, none]) expect(run.ms).toBeLessThan(budgetMs(25))
  })

  // The two groups (YAZ-2662 D2, D4, R2): the same vault with pinned items. What a keystroke pays
  // is the ranking with one look in a set for each match, the cut of the pinned items, and the cut
  // of the tree without those that the top group draws; the set is built when a list or the tree changes (R1).
  it.each([
    ['30 pinned folders', tree.slice(0, 30)],
    ['490 pinned paths: 10 folders, 40 pages of each of 12 more', [...tree.slice(0, 10), ...tree.slice(10, 22).flatMap((dir) => (dir.type === 'dir' ? dir.children.slice(-40) : []))]],
  ])('perf smoke with pinned items: %s', (label, listed) => {
    const candidates = [...folderCandidates('/vault', allDirs(tree), []), ...searchCandidates(records), ...fileCandidates('/vault', otherFiles(tree))]
    const built = performance.now()
    const pinned = pinnedRoots(listed)
    const paths = new Set(pinned.map((node) => node.path))
    const first = new Set(candidates.flatMap((c) => (atOrBelow(paths, c.path) ? [c.path] : [])))
    const start = performance.now()
    const { ms: elapsed, result: { rows, drawn } } = warmMedian(() => {
      let rows: SearchCandidate[] = []
      let drawn = 0
      // `Page` is the widest search of this vault: each of the 2,000 pages and the 250 other files
      // matches, and the ranking with pinned rows first ranks them all before the limit cuts (D4).
      for (let i = 0; i < 10; i++) {
        rows = searchRows(candidates, `Page`, first)
        const hits = new Set(rows.map((c) => c.path))
        const top = searchTree(pinned, hits, NO_FULL)
        drawn = top.order.length + searchTree(withoutPaths(tree, new Set(top.nodes.map((node) => node.path))), hits, NO_FULL).order.length
      }
      return { rows, drawn }
    })
    expect(rows).toHaveLength(50)
    expect(rows.every((c) => first.has(c.path))).toBe(true) // each pinned match went before each other match
    expect(drawn).toBe(new Set(rows.map((c) => c.path)).size) // the two cuts found each kept row one time
    console.log(`search perf, ${label}: 10 searches, each cut to the two groups, in ${elapsed.toFixed(1)} ms (the set of ${first.size} pinned rows built once, in ${(start - built).toFixed(1)} ms)`)
    expect(elapsed).toBeLessThan(budgetMs(50))
  })
})
