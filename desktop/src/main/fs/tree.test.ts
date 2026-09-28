import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { TreeNode } from '@shared/types'
import { buildTree } from './fsUtils'
import { tree } from './tree'
import { failure, makeFixture } from './testFixture'

// A pass-through spy: the single-flight tests count real walks.
vi.mock('./fsUtils', async (importOriginal) => {
  const m = await importOriginal<typeof import('./fsUtils')>()
  return { ...m, buildTree: vi.fn(m.buildTree) }
})

let root: string
let cleanup: () => Promise<void>
beforeAll(async () => ({ root, cleanup } = await makeFixture()))
afterAll(() => cleanup())

const names = (nodes: TreeNode[]) => nodes.map((n) => n.name)
const flatten = (nodes: TreeNode[]): string[] =>
  nodes.flatMap((n) => (n.type === 'dir' ? [n.path, ...flatten(n.children)] : [n.path]))

describe('tree', () => {
  it('returns dirs first then every regular file, case-insensitive, with all dirs shown', async () => {
    const body = await tree(root)
    expect(body.root).toBe(root)
    expect(typeof body.generatedAt).toBe('number')
    // Every dir shows, viewer-able files or not (GRO-2022 D1): Empty and assets-only included.
    // Every regular file shows too, viewer or not (YAZ-1577 D1): book.epub is listed with `kind: null`.
    expect(names(body.tree)).toEqual(['alpha', 'assets-only', 'Empty', 'Zeta', 'A.md', 'b.md', 'book.epub', 'notes.txt'])
    expect(body.tree.find((n) => n.name === 'book.epub')).toMatchObject({ type: 'file', kind: null })
    const zeta = body.tree[3]
    if (zeta.type !== 'dir') throw new Error('expected dir')
    expect(names(zeta.children)).toEqual(['inner', 'z.markdown'])
    const alpha = body.tree[0]
    if (alpha.type !== 'dir') throw new Error('expected dir')
    expect(names(alpha.children)).toEqual(['a.md'])
    const assetsOnly = body.tree[1]
    if (assetsOnly.type !== 'dir') throw new Error('expected dir')
    expect(assetsOnly.children).toEqual([
      expect.objectContaining({ type: 'file', name: 'img.png', kind: 'image' }),
    ])
    const all = flatten(body.tree)
    expect(all).toContain(path.join(root, 'notes.txt'))
    expect(all.some((p) => p.includes('.obsidian') || p.includes('.git') || p.includes('node_modules'))).toBe(false)
    expect(all).not.toContain(path.join(root, '.hidden.md'))
    // `.yaseendocs/` (vault-local config, GRO-2188) never reaches the tree — the sidebar renders the tree as-is.
    expect(all.some((p) => p.includes('.yaseendocs'))).toBe(false)
  })

  it('classifies text, PDF and raster images by kind, and lists SVG and arbitrary binaries with kind null (YAZ-1577 D1)', async () => {
    const candidates = [
      [path.join(root, 'data.JSON'), '{}', 'text'],
      [path.join(root, 'tool.py'), 'print("ok")\n', 'text'],
      [path.join(root, 'report.PDF'), '%PDF-1.7', 'pdf'],
      [path.join(root, 'photo.png'), 'png', 'image'],
      [path.join(root, 'cover.WEBP'), 'webp', 'image'],
      [path.join(root, 'vector.svg'), '<svg/>', null],
      [path.join(root, 'archive.zip'), 'binary', null],
    ] as const
    try {
      await Promise.all(candidates.map(([file, content]) => writeFile(file, content)))
      const all = files(await tree(root))
      expect(all.find((node) => node.name === 'data.JSON')?.kind).toBe('text')
      expect(all.find((node) => node.name === 'tool.py')?.kind).toBe('text')
      expect(all.find((node) => node.name === 'report.PDF')?.kind).toBe('pdf')
      expect(all.find((node) => node.name === 'photo.png')?.kind).toBe('image')
      expect(all.find((node) => node.name === 'cover.WEBP')?.kind).toBe('image')
      expect(all.find((node) => node.name === 'vector.svg')?.kind).toBeNull()
      expect(all.find((node) => node.name === 'archive.zip')?.kind).toBeNull()
    } finally {
      await Promise.all(candidates.map(([file]) => rm(file, { force: true })))
    }
  })

  it("hides a crash-left atomic-write tmp (never deletes it), while names that merely contain `.tmp` still show (YAZ-2179)", async () => {
    const leftover = path.join(root, 'alpha', 'a.md.tmp-0123456789ab')
    const lookalikes = ['notes.tmp', 'draft.tmp.md', 'report.tmp-draft.md', 'x.tmp-0123456789ab.md', 'y.md.tmp-0123456789AB', 'z.md.tmp-0123456789a']
    try {
      await writeFile(leftover, '# a (the only copy of a torn save)')
      await Promise.all(lookalikes.map((name) => writeFile(path.join(root, name), 'mine')))
      const all = files(await tree(root)).map((node) => node.name)
      expect(all).not.toContain('a.md.tmp-0123456789ab')
      expect(all).toEqual(expect.arrayContaining(lookalikes))
      expect(await readFile(leftover, 'utf8')).toBe('# a (the only copy of a torn save)')
    } finally {
      await Promise.all([leftover, ...lookalikes.map((name) => path.join(root, name))].map((file) => rm(file, { force: true })))
    }
  })

  it('file nodes carry size, mtime and kind', async () => {
    const body = await tree(root)
    const a = body.tree.find((n) => n.name === 'A.md')
    if (a?.type !== 'file') throw new Error('expected file')
    expect(a.size).toBe(4)
    expect(a.mtime).toBeGreaterThan(0)
    expect(a.kind).toBe('markdown')
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

type FileNode = Extract<TreeNode, { type: 'file' }>
const files = (body: Awaited<ReturnType<typeof tree>>): FileNode[] => {
  const collect = (nodes: TreeNode[]): FileNode[] => nodes.flatMap((node) => (node.type === 'dir' ? collect(node.children) : [node]))
  return collect(body.tree)
}

describe('tree: one walk per root at a time (YAZ-2191)', () => {
  const walks = () => vi.mocked(buildTree).mock.calls.filter(([dir]) => dir === root).length

  it('N callers during a walk share ONE trailing walk, whose answer post-dates their request', async () => {
    vi.mocked(buildTree).mockClear()
    const first = tree(root)
    const late = path.join(root, 'arrived-mid-walk.md')
    writeFileSync(late, 'x') // the change behind the calls below, landing after the first walk began
    try {
      const joiners = Array.from({ length: 10 }, () => tree(root))
      const answers = await Promise.all([first, ...joiners])
      expect(walks()).toBe(2)
      expect(answers[1]).not.toBe(answers[0]) // never the running walk's answer
      for (const a of answers.slice(1)) expect(a).toBe(answers[1]) // one shared answer
      expect(flatten(answers[1].tree)).toContain(late)
    } finally {
      await rm(late)
    }
  })

  it('a call after the flight settles walks again: nothing is cached', async () => {
    await tree(root)
    vi.mocked(buildTree).mockClear()
    await tree(root)
    expect(walks()).toBe(1)
  })

  it('a failed walk rejects its callers and leaves the next call free to walk', async () => {
    const missing = path.join(root, 'gone')
    const [a, b] = await Promise.allSettled([tree(missing), tree(missing)])
    expect([a.status, b.status]).toEqual(['rejected', 'rejected'])
    expect((await failure(tree(missing))).code).toBe('NOT_FOUND')
    expect((await tree(root)).root).toBe(root)
  })
})
