import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { TreeNode } from '@shared/types'
import { makeViewsFixture } from './viewsFixture'
import { tree } from './tree'

let root: string
let cleanup: () => Promise<void>
beforeAll(async () => {
  ;({ root, cleanup } = await makeViewsFixture())
  await Promise.all([
    writeFile(path.join(root, 'sample.json'), '{}'),
    writeFile(path.join(root, 'script.py'), 'print("fixture")\n'),
    writeFile(path.join(root, 'reference.pdf'), '%PDF-1.7'),
    writeFile(path.join(root, 'cover.WEBP'), 'webp'),
    writeFile(path.join(root, 'vector.svg'), '<svg/>'),
  ])
})
afterAll(() => cleanup())

type FileNode = Extract<TreeNode, { type: 'file' }>
const files = (nodes: TreeNode[]): FileNode[] => nodes.flatMap((n) => (n.type === 'dir' ? files(n.children) : [n]))
const dirs = (nodes: TreeNode[]): string[] => nodes.flatMap((n) => (n.type === 'dir' ? [n.name, ...dirs(n.children)] : []))

describe('bases fixture', () => {
  it('exposes Markdown plus supported view-only text, PDF, and raster images while SVG and dot-dirs stay hidden', async () => {
    const body = await tree(root)
    const all = files(body.tree)
    expect(all.filter((f) => f.kind === 'markdown')).toHaveLength(8)
    expect(all.filter((f) => f.kind === 'text')).toHaveLength(2)
    expect(all.filter((f) => f.kind === 'pdf')).toHaveLength(1)
    expect(all.filter((f) => f.kind === 'image')).toHaveLength(3)
    expect(all).toHaveLength(14)
    expect(all).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'levels.png', kind: 'image' }),
      expect.objectContaining({ name: 'chart.png', kind: 'image' }),
      expect.objectContaining({ name: 'cover.WEBP', kind: 'image' }),
    ]))
    expect(all.some((f) => f.name === 'vector.svg')).toBe(false)
    expect(dirs(body.tree)).not.toContain('.trash')
    expect(dirs(body.tree)).not.toContain('.obsidian')
  })
})
