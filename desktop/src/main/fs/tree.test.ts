import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import path from 'node:path'
import type { TreeNode } from '@shared/types'
import { tree } from './tree'
import { failure, makeFixture } from './testFixture'

let root: string
let cleanup: () => Promise<void>
beforeAll(async () => ({ root, cleanup } = await makeFixture()))
afterAll(() => cleanup())

const names = (nodes: TreeNode[]) => nodes.map((n) => n.name)
const flatten = (nodes: TreeNode[]): string[] =>
  nodes.flatMap((n) => (n.type === 'dir' ? [n.path, ...flatten(n.children)] : [n.path]))

describe('tree', () => {
  it('returns dirs first then files, case-insensitive, only vault files (.md/.markdown/.base), all dirs shown', async () => {
    const body = await tree(root)
    expect(body.root).toBe(root)
    expect(typeof body.generatedAt).toBe('number')
    // Every dir shows, vault files or not (GRO-2022 D1): Empty and assets-only included, files still md/base-only
    expect(names(body.tree)).toEqual(['alpha', 'assets-only', 'Empty', 'Zeta', 'A.md', 'b.md'])
    const zeta = body.tree[3]
    if (zeta.type !== 'dir') throw new Error('expected dir')
    expect(names(zeta.children)).toEqual(['inner', 'z.markdown'])
    const alpha = body.tree[0]
    if (alpha.type !== 'dir') throw new Error('expected dir')
    expect(names(alpha.children)).toEqual(['a.md', 'Topics.base'])
    const assetsOnly = body.tree[1]
    if (assetsOnly.type !== 'dir') throw new Error('expected dir')
    expect(assetsOnly.children).toEqual([])
    const all = flatten(body.tree)
    expect(all).not.toContain(path.join(root, 'notes.txt'))
    expect(all.some((p) => p.includes('.obsidian') || p.includes('.git') || p.includes('node_modules'))).toBe(false)
    expect(all).not.toContain(path.join(root, '.hidden.md'))
  })

  it('file nodes carry size, mtime and kind', async () => {
    const body = await tree(root)
    const a = body.tree.find((n) => n.name === 'A.md')
    if (a?.type !== 'file') throw new Error('expected file')
    expect(a.size).toBe(4)
    expect(a.mtime).toBeGreaterThan(0)
    expect(a.kind).toBe('markdown')
    const alpha = body.tree[0]
    if (alpha.type !== 'dir') throw new Error('expected dir')
    const base = alpha.children.find((n) => n.name === 'Topics.base')
    if (base?.type !== 'file') throw new Error('expected file')
    expect(base.kind).toBe('base')
    const z = (body.tree[3] as { children: TreeNode[] }).children.find((n) => n.name === 'z.markdown')
    if (z?.type !== 'file') throw new Error('expected file')
    expect(z.kind).toBe('markdown')
  })

  it('BAD_REQUEST missing root, NOT_ABSOLUTE relative, NOT_FOUND missing dir, NOT_A_DIRECTORY when root is a file', async () => {
    expect((await failure(tree(undefined as never))).code).toBe('BAD_REQUEST')
    expect((await failure(tree('rel'))).code).toBe('NOT_ABSOLUTE')
    const missing = await failure(tree(path.join(root, 'nope')))
    expect(missing.code).toBe('NOT_FOUND')
    expect(missing.path).toBe(path.join(root, 'nope'))
    expect((await failure(tree(path.join(root, 'b.md')))).code).toBe('NOT_A_DIRECTORY')
  })
})
