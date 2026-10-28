import { describe, expect, it, vi } from 'vitest'
import type { TabSort, TreeNode, TreeResponse } from '@shared/types'
import type { MenuAction, MenuSection } from './menuSections'
import { sortLevel, sortSections, timeOf, withMtime } from './treeSort'

const file = (path: string, mtime: number): TreeNode => ({ type: 'file', name: path.split('/').pop()!, path, size: 1, mtime, kind: 'markdown' })
const dir = (path: string, children: TreeNode[]): TreeNode => ({ type: 'dir', name: path.split('/').pop()!, path, children })
const byFileName = (node: TreeNode) => node.name.replace(/\.md$/, '')
const names = (nodes: TreeNode[]) => nodes.map(byFileName)
const NAME: TabSort = { by: 'name', reverse: false }
const UPDATED: TabSort = { by: 'updated', reverse: false }

// One level of a vault: two folders (one empty), files whose names hold numbers and capitals.
const level = (): TreeNode[] => [
  file('/v/Phase 10.md', 50),
  dir('/v/Old', [file('/v/Old/a.md', 10), dir('/v/Old/Deep', [file('/v/Old/Deep/b.md', 90)])]),
  file('/v/phase 2.md', 20),
  dir('/v/Empty', []),
  file('/v/Zebra.md', 70),
]

describe('sortLevel (YAZ-3227)', () => {
  it('D7, D8: Name puts folders first, then files, case-blind and with numbers in number order; Z to A flips both groups', () => {
    expect(names(sortLevel(level(), NAME, byFileName))).toEqual(['Empty', 'Old', 'phase 2', 'Phase 10', 'Zebra'])
    expect(names(sortLevel(level(), { by: 'name', reverse: true }, byFileName))).toEqual(['Old', 'Empty', 'Zebra', 'Phase 10', 'phase 2'])
  })

  it('D8: Name compares the label the row shows, not the file name', () => {
    const titles: Record<string, string> = { '/v/Zebra.md': 'Aardvark' }
    expect(names(sortLevel(level(), NAME, (node) => titles[node.path] ?? byFileName(node)))).toEqual(['Empty', 'Old', 'Zebra', 'phase 2', 'Phase 10'])
  })

  it('D7: Last updated reads a folder as its newest file anywhere inside, an empty folder as 0; Oldest first flips it', () => {
    expect(names(sortLevel(level(), UPDATED, byFileName))).toEqual(['Old', 'Empty', 'Zebra', 'Phase 10', 'phase 2'])
    expect(names(sortLevel(level(), { by: 'updated', reverse: true }, byFileName))).toEqual(['Empty', 'Old', 'phase 2', 'Phase 10', 'Zebra'])
  })

  it('equal times fall back to the name', () => {
    expect(names(sortLevel([file('/v/b.md', 5), file('/v/a.md', 5)], UPDATED, byFileName))).toEqual(['a', 'b'])
  })

  it('no sort and Manual both read as Name, A to Z (the rows below a manual list\'s top rows, and the search)', () => {
    expect(names(sortLevel(level(), undefined, byFileName))).toEqual(names(sortLevel(level(), NAME, byFileName)))
    expect(names(sortLevel(level(), { by: 'manual', reverse: true }, byFileName))).toEqual(names(sortLevel(level(), NAME, byFileName)))
  })

  it('a patched tree gives its folders their new time (the cache follows the node, not the path)', () => {
    const tree = level()
    expect(names(sortLevel(tree, UPDATED, byFileName))[0]).toBe('Old')
    const trees = withMtime(new Map([['/v', { root: '/v', tree } as TreeResponse]]), '/v', '/v/Zebra.md', 100)
    expect(names(sortLevel(trees.get('/v')!.tree, UPDATED, byFileName))).toEqual(['Old', 'Empty', 'Zebra', 'Phase 10', 'phase 2'])
    const later = withMtime(trees, '/v', '/v/Old/a.md', 1)
    expect(names(sortLevel(later.get('/v')!.tree, UPDATED, byFileName))[0]).toBe('Old') // Deep/b.md (90) still leads it
  })
})

describe('withMtime (YAZ-3227 D2)', () => {
  const landed = (): ReadonlyMap<string, TreeResponse> => new Map([['/v', { root: '/v', tree: level() } as TreeResponse]])

  it('changes the one file and the folders above it; every other node keeps its identity', () => {
    const before = landed()
    const after = withMtime(before, '/v', '/v/Old/Deep/b.md', 99)
    const [was, now] = [before.get('/v')!.tree, after.get('/v')!.tree]
    expect(now).not.toBe(was)
    const oldDir = (t: TreeNode[]) => t[1] as Extract<TreeNode, { type: 'dir' }>
    expect(oldDir(now)).not.toBe(oldDir(was))
    expect(oldDir(now).children[0]).toBe(oldDir(was).children[0]) // Old/a.md
    expect((oldDir(now).children[1] as Extract<TreeNode, { type: 'dir' }>).children[0]).toMatchObject({ path: '/v/Old/Deep/b.md', mtime: 99 })
    expect(now.filter((n, i) => n !== was[i]).map((n) => n.path)).toEqual(['/v/Old'])
  })

  it('returns the same map for an unknown vault, an unknown file, or the same time', () => {
    const trees = landed()
    expect(withMtime(trees, '/other', '/other/x.md', 1)).toBe(trees)
    expect(withMtime(trees, '/v', '/v/Gone.md', 1)).toBe(trees)
    expect(withMtime(trees, '/v', '/v/Zebra.md', 70)).toBe(trees)
  })
})

describe('sortSections (YAZ-3227 D4)', () => {
  const labels = (sections: MenuSection[]) => sections.map((section) => section.map((item) => `${item.label}${item.hint ?? ''}`))
  const item = (sections: MenuSection[], label: string) => sections.flat().find((i) => i.label === label) as MenuAction
  const OFF = { on: false, set: vi.fn() }

  it('Files: Name and Last updated, then the way, then "Show last updated" (YAZ-3511 D10); no Manual', () => {
    expect(labels(sortSections('files', NAME, vi.fn(), OFF))).toEqual([['Name✓', 'Last updated'], ['A to Z✓', 'Z to A'], ['Show last updated']])
    expect(labels(sortSections('files', { by: 'updated', reverse: true }, vi.fn(), OFF))).toEqual([['Name', 'Last updated✓'], ['Newest first', 'Oldest first✓'], ['Show last updated']])
  })

  it('Focus and Favorites: Manual first, and under Manual no way group, but the date row (YAZ-3511 D10, edge case 23)', () => {
    expect(labels(sortSections('focus', { by: 'manual', reverse: false }, vi.fn(), OFF))).toEqual([['Manual✓', 'Name', 'Last updated'], ['Show last updated']])
    expect(labels(sortSections('favorites', NAME, vi.fn(), { on: true, set: vi.fn() }))).toEqual([['Manual', 'Name✓', 'Last updated'], ['A to Z✓', 'Z to A'], ['Show last updated✓']])
  })

  it('a new sort starts its natural way, a way keeps its sort, and a pick that changes nothing writes nothing', () => {
    const set = vi.fn()
    const reversed = sortSections('files', { by: 'name', reverse: true }, set, OFF)
    item(reversed, 'Last updated').onSelect()
    expect(set).toHaveBeenLastCalledWith(UPDATED)
    item(reversed, 'A to Z').onSelect()
    expect(set).toHaveBeenLastCalledWith(NAME)
    set.mockClear()
    item(reversed, 'Name').onSelect()
    item(reversed, 'Z to A').onSelect()
    expect(set).not.toHaveBeenCalled()
  })

  it('Search (YAZ-3511 D4, D7, D12): Best match, Name and Last updated, the way where there are two, then "Show last updated"; no Manual. The date row flips the switch and writes no sort', () => {
    const set = vi.fn()
    const flip = vi.fn()
    const on = sortSections('search', NAME, set, { on: true, set: flip })
    expect(labels(on)).toEqual([['Best match', 'Name✓', 'Last updated'], ['A to Z✓', 'Z to A'], ['Show last updated✓']])
    item(on, 'Show last updated').onSelect()
    expect(flip).toHaveBeenCalledExactlyOnceWith(false)
    expect(set).not.toHaveBeenCalled()
    const off = sortSections('search', { by: 'updated', reverse: true }, set, { on: false, set: flip })
    expect(labels(off)).toEqual([['Best match', 'Name', 'Last updated✓'], ['Newest first', 'Oldest first✓'], ['Show last updated']])
    item(off, 'Show last updated').onSelect()
    expect(flip).toHaveBeenLastCalledWith(true)
  })

  it('Best match has one way, the best first: no way group, and a pick of it writes reverse false (edge cases 34, 35)', () => {
    const set = vi.fn()
    expect(labels(sortSections('search', { by: 'best', reverse: false }, set, OFF))).toEqual([['Best match✓', 'Name', 'Last updated'], ['Show last updated']])
    item(sortSections('search', { by: 'name', reverse: true }, set, OFF), 'Best match').onSelect()
    expect(set).toHaveBeenLastCalledWith({ by: 'best', reverse: false })
  })

  it('the filter rows go last, Search only (YAZ-3511 D13, D14)', () => {
    const filters = [{ id: 'filter-type', label: 'Type', onSelect: vi.fn() }]
    expect(labels(sortSections('search', { by: 'best', reverse: false }, vi.fn(), OFF, filters)).at(-1)).toEqual(['Type'])
  })
})

describe('sortLevel under Best match (YAZ-3511 D12)', () => {
  const BEST: TabSort = { by: 'best', reverse: false }
  const nodes = (): TreeNode[] => [
    file('/v/Project plan.md', 90),
    dir('/v/Plans', [file('/v/Plans/plan.md', 10)]),
    file('/v/Plan B.md', 30),
    file('/v/Plan C.md', 60),
    file('/v/notes.md', 99),
  ]
  const scores = new Map([
    ['/v/Project plan.md', 3],
    ['/v/Plans', 1],
    ['/v/Plans/plan.md', 1],
    ['/v/Plan B.md', 2],
    ['/v/Plan C.md', 2],
  ])

  it('the best score first; on a tie the newer row; folders do not go first; a row with no score goes last (edge cases 28 to 31)', () => {
    expect(names(sortLevel(nodes(), BEST, byFileName, scores))).toEqual(['Plans', 'Plan C', 'Plan B', 'Project plan', 'notes'])
    const fileFirst = new Map([...scores, ['/v/Plans', 2], ['/v/Project plan.md', 1]])
    expect(names(sortLevel(nodes(), BEST, byFileName, fileFirst))).toEqual(['Project plan', 'Plan C', 'Plan B', 'Plans', 'notes'])
  })

  it('the same score and the same time: by name, A to Z (edge case 29); reverse does nothing', () => {
    const same = [file('/v/b.md', 5), file('/v/a.md', 5)]
    const tie = new Map([['/v/a.md', 2], ['/v/b.md', 2]])
    expect(names(sortLevel(same, BEST, byFileName, tie))).toEqual(['a', 'b'])
    expect(names(sortLevel(same, { by: 'best', reverse: true }, byFileName, tie))).toEqual(['a', 'b'])
  })
})

describe('timeOf (YAZ-3511 D6)', () => {
  it('a file is its mtime; a folder is its newest file anywhere inside; an empty folder is 0', () => {
    const [, old, , empty] = level()
    expect(timeOf(file('/v/x.md', 42))).toBe(42)
    expect(timeOf(old)).toBe(90)
    expect(timeOf(empty)).toBe(0)
  })

  it('a cut folder is as new as the rows it still holds: the search tree\'s own time, not the folder\'s on Files', () => {
    const [, old] = level()
    if (old.type !== 'dir') throw new Error('a folder')
    expect(timeOf({ ...old, children: [old.children[0]] })).toBe(10)
  })
})
