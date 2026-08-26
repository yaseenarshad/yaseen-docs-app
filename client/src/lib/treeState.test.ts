import { describe, expect, it } from 'vitest'
import type { TreeNode } from '@shared/types'
import { allDirs, ancestorDirs, treeHasFile, treeReducer } from './treeState'

describe('treeReducer', () => {
  it('toggle adds then removes a dir', () => {
    const a = treeReducer([], { type: 'toggle', dir: '/r/a' })
    expect(a).toEqual(['/r/a'])
    expect(treeReducer(a, { type: 'toggle', dir: '/r/a' })).toEqual([])
  })

  it('setAll replaces the whole set verbatim — expand-all and collapse-all are the same action', () => {
    expect(treeReducer(['/r/a'], { type: 'setAll', dirs: ['/r/a', '/r/b', '/r/b/c'] })).toEqual(['/r/a', '/r/b', '/r/b/c'])
    expect(treeReducer(['/r/a', '/r/b'], { type: 'setAll', dirs: [] })).toEqual([])
  })

  it('expandTo opens every ancestor of the file under root and keeps existing state', () => {
    const next = treeReducer(['/r/other'], { type: 'expandTo', root: '/r', file: '/r/a/b/c.md' })
    expect(next).toEqual(['/r/other', '/r/a', '/r/a/b'])
    expect(treeReducer(next, { type: 'expandTo', root: '/r', file: '/r/a/b/c.md' })).toBe(next)
  })
})

describe('ancestorDirs', () => {
  it('returns nothing for a file directly under root or outside it', () => {
    expect(ancestorDirs('/r', '/r/x.md')).toEqual([])
    expect(ancestorDirs('/r', '/other/x.md')).toEqual([])
    expect(ancestorDirs('/r/', '/r/a/x.md')).toEqual(['/r/a'])
  })
})

describe('treeHasFile', () => {
  const tree: TreeNode[] = [
    {
      type: 'dir',
      name: 'a',
      path: '/r/a',
      children: [{ type: 'file', name: 'x.md', path: '/r/a/x.md', size: 1, mtime: 1, kind: 'markdown' }],
    },
    { type: 'file', name: 'y.md', path: '/r/y.md', size: 1, mtime: 1, kind: 'markdown' },
  ]
  it('finds nested and top-level files only', () => {
    expect(treeHasFile(tree, '/r/a/x.md')).toBe(true)
    expect(treeHasFile(tree, '/r/y.md')).toBe(true)
    expect(treeHasFile(tree, '/r/a')).toBe(false)
    expect(treeHasFile(tree, '/r/z.md')).toBe(false)
  })
})

describe('allDirs', () => {
  it('lists every directory at every depth, outer before inner, and no files', () => {
    const tree: TreeNode[] = [
      {
        type: 'dir',
        name: 'a',
        path: '/r/a',
        children: [
          { type: 'dir', name: 'b', path: '/r/a/b', children: [] },
          { type: 'file', name: 'x.md', path: '/r/a/x.md', size: 1, mtime: 1, kind: 'markdown' },
        ],
      },
      { type: 'file', name: 'y.md', path: '/r/y.md', size: 1, mtime: 1, kind: 'markdown' },
      { type: 'dir', name: 'c', path: '/r/c', children: [] },
    ]
    expect(allDirs(tree)).toEqual(['/r/a', '/r/a/b', '/r/c'])
    expect(allDirs([])).toEqual([])
  })
})
