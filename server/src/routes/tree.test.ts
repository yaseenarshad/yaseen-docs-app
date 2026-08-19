import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import path from 'node:path'
import type { TreeNode, TreeResponse } from '@shared/types'
import { app } from '../index'
import { makeFixture } from '../fixture'

let root: string
let cleanup: () => Promise<void>
beforeAll(async () => ({ root, cleanup } = await makeFixture()))
afterAll(() => cleanup())

const get = (r: string) => app.request(`/api/tree?root=${encodeURIComponent(r)}`)
const names = (nodes: TreeNode[]) => nodes.map((n) => n.name)
const flatten = (nodes: TreeNode[]): string[] =>
  nodes.flatMap((n) => (n.type === 'dir' ? [n.path, ...flatten(n.children)] : [n.path]))

describe('GET /api/tree', () => {
  it('returns dirs first then files, case-insensitive, only markdown, pruned', async () => {
    const res = await get(root)
    expect(res.status).toBe(200)
    const body = (await res.json()) as TreeResponse
    expect(body.root).toBe(root)
    expect(typeof body.generatedAt).toBe('number')
    // Empty (no files) and assets-only (no markdown) pruned; dirs before files
    expect(names(body.tree)).toEqual(['alpha', 'Zeta', 'A.md', 'b.md'])
    const zeta = body.tree[1]
    if (zeta.type !== 'dir') throw new Error('expected dir')
    expect(names(zeta.children)).toEqual(['inner', 'z.markdown'])
    const all = flatten(body.tree)
    expect(all).not.toContain(path.join(root, 'notes.txt'))
    expect(all.some((p) => p.includes('.obsidian') || p.includes('.git') || p.includes('node_modules'))).toBe(false)
    expect(all).not.toContain(path.join(root, '.hidden.md'))
  })

  it('file nodes carry size and mtime', async () => {
    const body = (await (await get(root)).json()) as TreeResponse
    const a = body.tree.find((n) => n.name === 'A.md')
    if (a?.type !== 'file') throw new Error('expected file')
    expect(a.size).toBe(4)
    expect(a.mtime).toBeGreaterThan(0)
  })

  it('400 missing/relative root, 404 missing dir, 400 when root is a file', async () => {
    expect((await app.request('/api/tree')).status).toBe(400)
    expect((await get('rel')).status).toBe(400)
    expect((await get(path.join(root, 'nope'))).status).toBe(404)
    expect((await get(path.join(root, 'b.md'))).status).toBe(400)
  })
})
