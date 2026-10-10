import { describe, expect, it } from 'vitest'
import type { TreeNode } from '@shared/types'
import { allDirs, ancestorDirs, atOrBelow, favoriteOrder, favoriteRoots, findDirNode, findNode, notesAt, otherFiles, pinnedRoots, treeHasFile, treeHasPath, treeReducer, withoutPaths } from './treeState'

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

  it('treeHasPath finds files AND folders — the selection may hold either (YAZ-1578)', () => {
    expect(treeHasPath(tree, '/r/a')).toBe(true)
    expect(treeHasPath(tree, '/r/a/x.md')).toBe(true)
    expect(treeHasPath(tree, '/r/y.md')).toBe(true)
    expect(treeHasPath(tree, '/r/b')).toBe(false)
    expect(treeHasPath(tree, '/r/z.md')).toBe(false)
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

/**
 * The dir lookup (YAZ-1605). `PROJECTS` sits AFTER its prefix-sharing sibling on
 * purpose: the descent test is `startsWith(`${path}/`)`, so `/v/Projects-Archive` must never
 * swallow a search for `/v/Projects`.
 */
describe('findDirNode (YAZ-1605)', () => {
  const tree: TreeNode[] = [
    { type: 'dir', name: 'Projects-Archive', path: '/v/Projects-Archive', children: [] },
    {
      type: 'dir',
      name: 'Projects',
      path: '/v/Projects',
      children: [
        { type: 'dir', name: 'Alpha', path: '/v/Projects/Alpha', children: [] },
        { type: 'file', name: 'p.md', path: '/v/Projects/p.md', size: 1, mtime: 1, kind: 'markdown' },
      ],
    },
    { type: 'file', name: 'top.md', path: '/v/top.md', size: 1, mtime: 1, kind: 'markdown' },
  ]

  it('finds a dir nested two deep and hands back the node itself', () => {
    expect(findDirNode(tree, '/v/Projects/Alpha')?.name).toBe('Alpha')
  })

  it('is null for a file path, for an unknown path, and for the root itself', () => {
    expect(findDirNode(tree, '/v/Projects/p.md')).toBeNull()
    expect(findDirNode(tree, '/v/Nope')).toBeNull()
    expect(findDirNode([], '/v/Projects')).toBeNull()
  })

  it('a prefix-sharing sibling never answers for the shorter name', () => {
    expect(findDirNode(tree, '/v/Projects')?.path).toBe('/v/Projects')
    expect(findDirNode(tree, '/v/Projects-Archive/Alpha')).toBeNull()
  })
})

/**
 * The Favorites tab's two lookups (YAZ-1766 D4), the Focus tab's too (YAZ-2619 D2). `findNode` is
 * `findDirNode`'s kind-agnostic twin; `favoriteRoots` keeps the STORED order and every nesting.
 */
describe('findNode (YAZ-1766)', () => {
  const tree: TreeNode[] = [
    { type: 'dir', name: 'Projects-Archive', path: '/v/Projects-Archive', children: [] },
    {
      type: 'dir',
      name: 'Projects',
      path: '/v/Projects',
      children: [
        { type: 'dir', name: 'Alpha', path: '/v/Projects/Alpha', children: [] },
        { type: 'file', name: 'p.md', path: '/v/Projects/p.md', size: 1, mtime: 1, kind: 'markdown' },
      ],
    },
    { type: 'file', name: 'top.md', path: '/v/top.md', size: 1, mtime: 1, kind: 'markdown' },
  ]

  it('finds a file and a dir, at the root and nested', () => {
    expect(findNode(tree, '/v/top.md')?.name).toBe('top.md')
    expect(findNode(tree, '/v/Projects/p.md')?.name).toBe('p.md')
    expect(findNode(tree, '/v/Projects/Alpha')?.type).toBe('dir')
  })

  it('is null for an unknown path, and a prefix-sharing sibling never answers for the shorter name', () => {
    expect(findNode(tree, '/v/Nope.md')).toBeNull()
    expect(findNode(tree, '/v/Projects-Archive/p.md')).toBeNull()
    expect(findNode([], '/v/top.md')).toBeNull()
  })
})

describe('favoriteRoots (YAZ-1766 D4)', () => {
  const tree: TreeNode[] = [
    { type: 'dir', name: 'Notes', path: '/v/Notes', children: [] },
    {
      type: 'dir',
      name: 'Projects',
      path: '/v/Projects',
      children: [{ type: 'file', name: 'p.md', path: '/v/Projects/p.md', size: 1, mtime: 1, kind: 'markdown' }],
    },
    { type: 'file', name: 'top.md', path: '/v/top.md', size: 1, mtime: 1, kind: 'markdown' },
  ]

  it('returns the favorites in STORED order, files and dirs alike — never tree order', () => {
    expect(favoriteRoots(tree, ['/v/top.md', '/v/Projects', '/v/Notes']).map((n) => n.path)).toEqual(['/v/top.md', '/v/Projects', '/v/Notes'])
  })

  it('keeps a favorite INSIDE a favorited folder as its own root row too (redundancy; YAZ-2619 S7, S8 on the Focus tab)', () => {
    expect(favoriteRoots(tree, ['/v/Projects/p.md', '/v/Projects']).map((n) => n.path)).toEqual(['/v/Projects/p.md', '/v/Projects'])
  })

  it('a path the tree no longer holds yields no row, and no favorites yields nothing', () => {
    expect(favoriteRoots(tree, ['/v/Gone.md', '/v/Notes']).map((n) => n.path)).toEqual(['/v/Notes'])
    expect(favoriteRoots(tree, [])).toEqual([])
  })
})

describe('favoriteOrder (YAZ-2631 D1)', () => {
  const [a1, a2, a3, b1, b2, c1] = ['/v/a/1.md', '/v/a/2.md', '/v/a/3.md', '/v/b/1.md', '/v/b/2.md', '/v/c/1.md']
  const roots = ['/v/a', '/v/b']

  it('one vault: its file\'s order, whatever the stored order says (S1); two or more and no stored order: vault order, then each file\'s order (S3)', () => {
    expect(favoriteOrder(['/v/a'], { '/v/a': [a2, a1] }, [a1, b1, a2])).toEqual([a2, a1])
    expect(favoriteOrder(['/v/a'], {}, [a1])).toEqual([])
    expect(favoriteOrder(roots, { '/v/a': [a2, a1], '/v/b': [b1, b2] }, [])).toEqual([a2, a1, b1, b2])
    expect(favoriteOrder(['/v/b', '/v/a'], { '/v/a': [a2, a1], '/v/b': [b1, b2] }, [])).toEqual([b1, b2, a2, a1])
    expect(favoriteOrder(roots, {}, [a1, b1])).toEqual([])
  })

  it('the stored order says which VAULT has each place, and each vault fills its places in its own file\'s order (R2, S8)', () => {
    expect(favoriteOrder(roots, { '/v/a': [a1, a2], '/v/b': [b1] }, [a1, b1, a2])).toEqual([a1, b1, a2])
    // A synced file changed the order inside vault A: A keeps its two places, filled in the file's new order.
    expect(favoriteOrder(roots, { '/v/a': [a2, a1], '/v/b': [b1] }, [a1, b1, a2])).toEqual([a2, b1, a1])
    // The order of the vaults does not move a place that is stored.
    expect(favoriteOrder(['/v/b', '/v/a'], { '/v/a': [a2, a1], '/v/b': [b1] }, [a1, b1, a2])).toEqual([a2, b1, a1])
  })

  it('a favorite with no place goes last, in vault order (S6); a removed one leaves and the others keep their order (S7); a vault that is not in the window has no row (S14)', () => {
    expect(favoriteOrder(roots, { '/v/a': [a1, a2, a3], '/v/b': [b1, b2] }, [b1, a1, a2])).toEqual([b1, a1, a2, a3, b2])
    expect(favoriteOrder(roots, { '/v/a': [a2], '/v/b': [b1, b2] }, [b1, a1, b2, a2])).toEqual([b1, b2, a2])
    expect(favoriteOrder(roots, { '/v/a': [a1], '/v/b': [b1] }, [c1, b1, c1, a1])).toEqual([b1, a1])
    // A path the order holds twice has one place: no entry is made up.
    expect(favoriteOrder(roots, { '/v/a': [a1], '/v/b': [b1] }, [a1, a1, b1])).toEqual([a1, b1])
  })
})

describe('notesAt (YAZ-2420 3E1)', () => {
  const file = (path: string, kind: 'markdown' | 'pdf' = 'markdown'): TreeNode => ({ type: 'file', name: path.slice(path.lastIndexOf('/') + 1), path, size: 1, mtime: 1, kind })
  const tree: TreeNode[] = [
    { type: 'dir', name: 'a', path: '/v/a', children: [{ type: 'dir', name: 'b', path: '/v/a/b', children: [file('/v/a/b/deep.md'), file('/v/a/b/scan.pdf', 'pdf')] }, file('/v/a/one.md')] },
    { type: 'dir', name: 'ab', path: '/v/ab', children: [file('/v/ab/other.md')] },
    file('/v/top.md'),
  ]

  it('a note is itself; a folder is every note under it at any depth, never a file that is no note nor a sibling whose name it begins', () => {
    expect(notesAt(tree, '/v/top.md')).toEqual(['/v/top.md'])
    expect(notesAt(tree, '/v/a')).toEqual(['/v/a/b/deep.md', '/v/a/one.md'])
    expect(notesAt(tree, '/v/a/b/scan.pdf')).toEqual([])
    expect(notesAt(tree, '/v/gone')).toEqual([])
  })
})

describe('otherFiles (YAZ-2620 D3)', () => {
  const file = (path: string, kind: 'markdown' | 'pdf' | null): TreeNode => ({ type: 'file', name: path.slice(path.lastIndexOf('/') + 1), path, size: 1, mtime: 1, kind })
  const tree: TreeNode[] = [
    { type: 'dir', name: 'skills', path: '/r/skills', children: [{ type: 'dir', name: 'empty', path: '/r/skills/empty', children: [] }, file('/r/skills/get-transcript.py', null), file('/r/skills/SKILL.md', 'markdown')] },
    file('/r/a.md', 'markdown'),
    file('/r/scan.pdf', 'pdf'),
  ]

  it('every file that is no note, at any depth, in tree order — one the app can show and one it cannot alike; never a note, never a folder', () => {
    expect(otherFiles(tree)).toEqual(['/r/skills/get-transcript.py', '/r/scan.pdf'])
    expect(otherFiles([])).toEqual([])
  })
})

describe('the pinned items of the search (YAZ-2662 D3)', () => {
  const file = (path: string): TreeNode => ({ type: 'file', name: path.slice(path.lastIndexOf('/') + 1), path, size: 1, mtime: 1, kind: 'markdown' })
  const dir = (path: string, children: TreeNode[] = []): TreeNode => ({ type: 'dir', name: path.slice(path.lastIndexOf('/') + 1), path, children })
  const a = file('/v/Projects/Alpha/a.md')
  const alpha = dir('/v/Projects/Alpha', [a])
  const projects = dir('/v/Projects', [alpha, file('/v/Projects/p.md')])
  const archive = dir('/v/Projects-Archive', [file('/v/Projects-Archive/old.md')])
  const top = file('/v/top.md')
  const tree = [projects, archive, top]

  it('atOrBelow: a path is one of the paths or stands inside one, at any depth; a name that only starts the same is not inside', () => {
    const paths = new Set(['/v/Projects', '/v/top.md'])
    expect(['/v/Projects', '/v/Projects/p.md', '/v/Projects/Alpha/a.md', '/v/top.md'].map((path) => atOrBelow(paths, path))).toEqual([true, true, true, true])
    expect(['/v', '/v/Projects-Archive', '/v/Projects-Archive/old.md', '/v/top.md.bak', '/v/other.md'].map((path) => atOrBelow(paths, path))).toEqual([false, false, false, false, false])
    expect(atOrBelow(new Set(), '/v/top.md')).toBe(false)
  })

  it('pinnedRoots, S17: an item listed two times shows one time, at its first place — the focus list is handed in first', () => {
    expect(pinnedRoots([top, archive, archive, top])).toEqual([top, archive])
  })

  it('pinnedRoots, S18: an item inside a different pinned folder is no top row, at any depth and wherever the folder is listed; a folder of a name that starts the same is not inside', () => {
    expect(pinnedRoots([a, alpha, top, projects, archive])).toEqual([top, projects, archive])
    expect(pinnedRoots([])).toEqual([])
  })

  it('withoutPaths, S19: the tree with no node at the paths, at any depth; a folder that holds none of them is the tree\'s own node, and so is the tree with no path at all', () => {
    const cut = withoutPaths(tree, new Set(['/v/Projects/Alpha', '/v/top.md']))
    expect(cut).toEqual([dir('/v/Projects', [file('/v/Projects/p.md')]), archive])
    expect(cut[1]).toBe(archive)
    expect(withoutPaths(tree, new Set())).toBe(tree)
    expect(withoutPaths(tree, new Set(['/v/Gone.md']))).toBe(tree)
    expect(projects.type === 'dir' && projects.children).toHaveLength(2) // the tree itself is never cut
  })
})
