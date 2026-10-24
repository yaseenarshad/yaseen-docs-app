import { describe, expect, it, vi } from 'vitest'
import type { TabSort, TreeNode, TreeResponse } from '@shared/types'
import type { MenuAction, MenuSection } from './menuSections'
import { sortLevel, sortSections, withMtime } from './treeSort'

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

  it('Files: Name and Last updated, then the way; no Manual', () => {
    expect(labels(sortSections('files', NAME, vi.fn()))).toEqual([['Name✓', 'Last updated'], ['A to Z✓', 'Z to A']])
    expect(labels(sortSections('files', { by: 'updated', reverse: true }, vi.fn()))).toEqual([['Name', 'Last updated✓'], ['Newest first', 'Oldest first✓']])
  })

  it('Focus and Favorites: Manual first, and under Manual no way group', () => {
    expect(labels(sortSections('focus', { by: 'manual', reverse: false }, vi.fn()))).toEqual([['Manual✓', 'Name', 'Last updated']])
    expect(labels(sortSections('favorites', NAME, vi.fn()))[0]).toEqual(['Manual', 'Name✓', 'Last updated'])
  })

  it('a new sort starts its natural way, a way keeps its sort, and a pick that changes nothing writes nothing', () => {
    const set = vi.fn()
    const reversed = sortSections('files', { by: 'name', reverse: true }, set)
    item(reversed, 'Last updated').onSelect()
    expect(set).toHaveBeenLastCalledWith(UPDATED)
    item(reversed, 'A to Z').onSelect()
    expect(set).toHaveBeenLastCalledWith(NAME)
    set.mockClear()
    item(reversed, 'Name').onSelect()
    item(reversed, 'Z to A').onSelect()
    expect(set).not.toHaveBeenCalled()
  })
})
