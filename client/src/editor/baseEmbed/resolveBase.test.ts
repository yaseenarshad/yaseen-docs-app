/**
 * Client-side `.base` target resolution (6A, GRO-2145): the Obsidian shortest-path rule over a
 * bridge `tree()` snapshot, mirroring the main process's `findByBasename` (assets.ts): breadth
 * first (a shallower match always wins), first case-insensitive basename match in tree order.
 */
import { describe, expect, it } from 'vitest'
import type { TreeNode } from '@shared/types'
import { resolveBasePath } from './resolveBase'

const ROOT = '/vault'

const file = (path: string): TreeNode => ({
  type: 'file',
  name: path.slice(path.lastIndexOf('/') + 1),
  path,
  size: 1,
  mtime: 1,
  kind: 'base',
})

const dir = (path: string, children: TreeNode[]): TreeNode => ({
  type: 'dir',
  name: path.slice(path.lastIndexOf('/') + 1),
  path,
  children,
})

describe('resolveBasePath', () => {
  it('finds a bare basename anywhere under the root', () => {
    const tree = [dir(`${ROOT}/Bases`, [file(`${ROOT}/Bases/Topics.base`)])]
    expect(resolveBasePath(tree, ROOT, 'Topics.base')).toBe(`${ROOT}/Bases/Topics.base`)
  })

  it('a shallower match wins over a deeper one (shortest-path rule)', () => {
    const tree = [
      dir(`${ROOT}/a`, [dir(`${ROOT}/a/deep`, [file(`${ROOT}/a/deep/Topics.base`)])]),
      file(`${ROOT}/Topics.base`),
    ]
    expect(resolveBasePath(tree, ROOT, 'Topics.base')).toBe(`${ROOT}/Topics.base`)
  })

  it('at equal depth the first match in tree order wins', () => {
    const tree = [
      dir(`${ROOT}/a`, [file(`${ROOT}/a/Topics.base`)]),
      dir(`${ROOT}/b`, [file(`${ROOT}/b/Topics.base`)]),
    ]
    expect(resolveBasePath(tree, ROOT, 'Topics.base')).toBe(`${ROOT}/a/Topics.base`)
  })

  it('a whole level is scanned before descending', () => {
    // a/'s subdirectory holds a match one level deeper than b/'s direct child: b/ wins
    const tree = [
      dir(`${ROOT}/a`, [dir(`${ROOT}/a/deep`, [file(`${ROOT}/a/deep/Topics.base`)])]),
      dir(`${ROOT}/b`, [file(`${ROOT}/b/Topics.base`)]),
    ]
    expect(resolveBasePath(tree, ROOT, 'Topics.base')).toBe(`${ROOT}/b/Topics.base`)
  })

  it('matches the basename case-insensitively', () => {
    const tree = [file(`${ROOT}/Topics.base`)]
    expect(resolveBasePath(tree, ROOT, 'topics.BASE')).toBe(`${ROOT}/Topics.base`)
  })

  it('a target with a slash resolves as a root-relative path first', () => {
    const tree = [
      file(`${ROOT}/Topics.base`),
      dir(`${ROOT}/Bases`, [file(`${ROOT}/Bases/Topics.base`)]),
    ]
    expect(resolveBasePath(tree, ROOT, 'Bases/Topics.base')).toBe(`${ROOT}/Bases/Topics.base`)
  })

  it('a slash target with no exact match falls back to the basename', () => {
    const tree = [dir(`${ROOT}/Bases`, [file(`${ROOT}/Bases/Topics.base`)])]
    expect(resolveBasePath(tree, ROOT, 'gone/Topics.base')).toBe(`${ROOT}/Bases/Topics.base`)
  })

  it('null when nothing matches', () => {
    const tree = [dir(`${ROOT}/Bases`, [file(`${ROOT}/Bases/Topics.base`)])]
    expect(resolveBasePath(tree, ROOT, 'Missing.base')).toBeNull()
  })
})
