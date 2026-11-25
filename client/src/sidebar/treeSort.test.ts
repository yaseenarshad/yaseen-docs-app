import { describe, expect, it, vi } from 'vitest'
import type { FileKind, TabSort, TreeNode, TreeResponse } from '@shared/types'
import type { MenuAction, MenuParent, MenuSection } from './menuSections'
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

describe('sortLevel under Kind first (YAZ-4614 D66)', () => {
  const of = (path: string, kind: FileKind | null, mtime: number): TreeNode => ({ type: 'file', name: path.split('/').pop()!, path, size: 1, mtime, kind })
  const byName = (node: TreeNode) => node.name
  const paths = (nodes: TreeNode[]) => nodes.map(byName)
  // One level with every kind, in no order: two folders, two pages, a drawing, a diagram, a PDF, an image, a text file, a file with no viewer.
  const mixed = (): TreeNode[] => [
    of('/v/b.md', 'markdown', 40),
    of('/v/a.png', 'image', 60),
    of('/v/a.excalidraw', 'drawing', 70),
    dir('/v/z', [of('/v/z/n.md', 'markdown', 10)]),
    of('/v/a.zip', null, 20),
    of('/v/a.drawio', 'diagram', 80),
    of('/v/a.md', 'markdown', 30),
    dir('/v/y', [of('/v/y/n.md', 'markdown', 100)]),
    of('/v/a.txt', 'text', 50),
    of('/v/a.pdf', 'pdf', 90),
  ]
  const KINDS: TabSort = { by: 'name', reverse: false, kinds: true }
  const BY_KIND = ['y', 'z', 'a.md', 'b.md', 'a.excalidraw', 'a.drawio', 'a.pdf', 'a.png', 'a.txt', 'a.zip']

  it('off, or kinds false: folders first, then every file by the sort, as before', () => {
    const before = ['y', 'z', 'a.drawio', 'a.excalidraw', 'a.md', 'a.pdf', 'a.png', 'a.txt', 'a.zip', 'b.md']
    expect(paths(sortLevel(mixed(), NAME, byName))).toEqual(before)
    expect(paths(sortLevel(mixed(), { ...NAME, kinds: false }, byName))).toEqual(before)
  })

  it('on: folders, pages, drawings, diagrams, PDFs, images, text files, other files; Name A to Z inside each kind, and Z to A flips the rows of a kind, not the kinds', () => {
    expect(paths(sortLevel(mixed(), KINDS, byName))).toEqual(BY_KIND)
    expect(paths(sortLevel(mixed(), { ...KINDS, reverse: true }, byName))).toEqual(['z', 'y', 'b.md', 'a.md', 'a.excalidraw', 'a.drawio', 'a.pdf', 'a.png', 'a.txt', 'a.zip'])
  })

  it('on with Last updated: the kinds first, the newer row first inside each; Oldest first flips the rows of a kind alone', () => {
    expect(paths(sortLevel(mixed(), { ...UPDATED, kinds: true }, byName))).toEqual(['y', 'z', 'b.md', 'a.md', 'a.excalidraw', 'a.drawio', 'a.pdf', 'a.png', 'a.txt', 'a.zip'])
    expect(paths(sortLevel(mixed(), { ...UPDATED, reverse: true, kinds: true }, byName))).toEqual(['z', 'y', 'a.md', 'b.md', 'a.excalidraw', 'a.drawio', 'a.pdf', 'a.png', 'a.txt', 'a.zip'])
  })

  it('Manual below the top rows reads as Name, A to Z, inside each kind', () => {
    expect(paths(sortLevel(mixed(), { by: 'manual', reverse: false, kinds: true }, byName))).toEqual(BY_KIND)
  })

  it('Best match ignores it: the best row first, a file before a folder', () => {
    const scores = new Map([['/v/a.zip', 0], ['/v/z', 1]])
    const best = sortLevel(mixed(), { by: 'best', reverse: false }, byName, scores)
    expect(paths(best).slice(0, 2)).toEqual(['a.zip', 'z'])
    expect(sortLevel(mixed(), { by: 'best', reverse: false, kinds: true }, byName, scores)).toEqual(best)
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

  it('Files: Name, Last updated and Manual (YAZ-5916), then the way, then "Show last updated" (YAZ-3511 D10)', () => {
    expect(labels(sortSections('files', NAME, vi.fn(), OFF))).toEqual([['Name✓', 'Last updated', 'Manual'], ['A to Z✓', 'Z to A'], ['Show last updated', 'Kind first']])
    expect(labels(sortSections('files', { by: 'updated', reverse: true }, vi.fn(), OFF))).toEqual([['Name', 'Last updated✓', 'Manual'], ['Newest first', 'Oldest first✓'], ['Show last updated', 'Kind first']])
    expect(labels(sortSections('files', { by: 'manual', reverse: false }, vi.fn(), OFF))).toEqual([['Name', 'Last updated', 'Manual✓'], ['Show last updated', 'Kind first']])
  })

  it('Files under Manual (YAZ-5916 D1, D3): the folder\'s list first, unknown items last in the Name order', () => {
    const dir = (name: string): TreeNode => ({ type: 'dir', name, path: `/v/${name}`, children: [] })
    const file = (name: string): TreeNode => ({ type: 'file', name, path: `/v/${name}`, size: 1, kind: 'markdown', mtime: 0 })
    const nodes = [dir('B'), file('a.md'), dir('A'), file('z.md'), file('new.md')]
    const label = (node: TreeNode) => node.name
    const manual = { by: 'manual' as const, reverse: false }
    expect(sortLevel(nodes, manual, label, undefined, ['z.md', 'B']).map((n) => n.name)).toEqual(['z.md', 'B', 'A', 'a.md', 'new.md'])
    // No list yet: the Name order.
    expect(sortLevel(nodes, manual, label, undefined, []).map((n) => n.name)).toEqual(['A', 'B', 'a.md', 'new.md', 'z.md'])
  })

  it('Focus and Favorites: Manual first, and under Manual no way group, but the date row (YAZ-3511 D10, edge case 23)', () => {
    expect(labels(sortSections('focus', { by: 'manual', reverse: false }, vi.fn(), OFF))).toEqual([['Manual✓', 'Name', 'Last updated'], ['Show last updated', 'Kind first']])
    expect(labels(sortSections('favorites', NAME, vi.fn(), { on: true, set: vi.fn() }))).toEqual([['Manual', 'Name✓', 'Last updated'], ['A to Z✓', 'Z to A'], ['Show last updated✓', 'Kind first']])
  })

  it('"Kind first" (YAZ-4614 D66): after "Show last updated" on Files, Focus and Favorites, not Search; ✓ when on; a click writes the tab\'s sort once, flipped; a new sort keeps it', () => {
    const set = vi.fn()
    expect(labels(sortSections('favorites', { by: 'manual', reverse: false, kinds: true }, set, OFF))).toEqual([['Manual✓', 'Name', 'Last updated'], ['Show last updated', 'Kind first✓']])
    item(sortSections('files', NAME, set, OFF), 'Kind first').onSelect()
    expect(set).toHaveBeenCalledExactlyOnceWith({ ...NAME, kinds: true })
    set.mockClear()
    const on = sortSections('files', { ...NAME, kinds: true }, set, OFF)
    item(on, 'Kind first').onSelect()
    expect(set).toHaveBeenCalledExactlyOnceWith({ ...NAME, kinds: false })
    item(on, 'Last updated').onSelect()
    expect(set).toHaveBeenLastCalledWith({ ...UPDATED, kinds: true })
    expect(labels(sortSections('search', NAME, set, OFF)).flat()).not.toContain('Kind first')
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

  it('Search "Show IDs" flyout (YAZ-6502): present under "Show last updated" when searchIds is provided, absent otherwise, ignored on non-Search tabs', () => {
    const setIds = vi.fn()
    const without = sortSections('search', { by: 'best', reverse: false }, vi.fn(), { on: true, set: vi.fn() })
    expect(labels(without)).toEqual([['Best match✓', 'Name', 'Last updated'], ['Show last updated✓']])

    const withIds = sortSections('search', { by: 'best', reverse: false }, vi.fn(), { on: true, set: vi.fn() }, undefined, undefined, { value: 'number', set: setIds })
    expect(labels(withIds)).toEqual([['Best match✓', 'Name', 'Last updated'], ['Show last updated✓', 'Show IDsNumber (#12)']])
    const parent = withIds[1][1] as MenuParent
    expect(parent.children).toHaveLength(1)
    expect(parent.children[0].map((c) => `${c.label}${c.hint ?? ''}`)).toEqual(['Off', 'Number (#12)✓', 'Full ID', 'Only on ID match'])
    // Clicking the already-active choice is a no-op; clicking another calls setIds once.
    ;(parent.children[0][1] as MenuAction).onSelect()
    expect(setIds).not.toHaveBeenCalled()
    ;(parent.children[0][2] as MenuAction).onSelect()
    expect(setIds).toHaveBeenCalledExactlyOnceWith('full')
    ;(parent.children[0][0] as MenuAction).onSelect()
    expect(setIds).toHaveBeenLastCalledWith('off')
    ;(parent.children[0][3] as MenuAction).onSelect()
    expect(setIds).toHaveBeenLastCalledWith('match')

    // Non-Search tabs never include Show IDs.
    expect(labels(sortSections('files', NAME, vi.fn(), OFF, undefined, undefined, { value: 'number', set: setIds })).flat()).not.toContain('Show IDsNumber (#12)')
  })
})

describe('sortLevel under Best match (YAZ-3511 D12)', () => {
  const BEST: TabSort = { by: 'best', reverse: false }
  const nodes = (): TreeNode[] => [
    file('/v/Project plan.md', 90),
    dir('/v/Plans', [file('/v/Plans/plan.md', 10)]),
    file('/v/Plan B.md', 30),
    file('/v/Plan C.md', 60),
    file('/v/pages.md', 99),
  ]
  const scores = new Map([
    ['/v/Project plan.md', 3],
    ['/v/Plans', 1],
    ['/v/Plans/plan.md', 1],
    ['/v/Plan B.md', 2],
    ['/v/Plan C.md', 2],
  ])

  it('the best score first; on a tie the newer row; folders do not go first; a row with no score goes last (edge cases 28 to 31)', () => {
    expect(names(sortLevel(nodes(), BEST, byFileName, scores))).toEqual(['Plans', 'Plan C', 'Plan B', 'Project plan', 'pages'])
    const fileFirst = new Map([...scores, ['/v/Plans', 2], ['/v/Project plan.md', 1]])
    expect(names(sortLevel(nodes(), BEST, byFileName, fileFirst))).toEqual(['Project plan', 'Plan C', 'Plan B', 'Plans', 'pages'])
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
