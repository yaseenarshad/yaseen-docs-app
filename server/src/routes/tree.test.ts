import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import path from 'node:path'
import type { TreeNode, TreeResponse } from '@shared/types'
import { app } from '../app'
import { makeFixture } from '../test-fixture'

let root: string
let cleanup: () => Promise<void>
beforeAll(async () => ({ root, cleanup } = await makeFixture()))
afterAll(() => cleanup())

const get = (r: string) => app.request(`/api/tree?root=${encodeURIComponent(r)}`)
const names = (nodes: TreeNode[]) => nodes.map((n) => n.name)
const flatten = (nodes: TreeNode[]): string[] =>
  nodes.flatMap((n) => (n.type === 'dir' ? [n.path, ...flatten(n.children)] : [n.path]))

describe('GET /api/tree', () => {
  it('returns dirs first then files, case-insensitive, only vault files (.md/.markdown/.base), all dirs shown', async () => {
    const res = await get(root)
    expect(res.status).toBe(200)
    const body = (await res.json()) as TreeResponse
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
    const body = (await (await get(root)).json()) as TreeResponse
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

  it('400 missing/relative root, 404 missing dir, 400 when root is a file', async () => {
    expect((await app.request('/api/tree')).status).toBe(400)
    expect((await get('rel')).status).toBe(400)
    expect((await get(path.join(root, 'nope'))).status).toBe(404)
    expect((await get(path.join(root, 'b.md'))).status).toBe(400)
  })
})
