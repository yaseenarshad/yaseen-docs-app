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
  ])
})
afterAll(() => cleanup())

type FileNode = Extract<TreeNode, { type: 'file' }>
const files = (nodes: TreeNode[]): FileNode[] => nodes.flatMap((n) => (n.type === 'dir' ? files(n.children) : [n]))
const dirs = (nodes: TreeNode[]): string[] => nodes.flatMap((n) => (n.type === 'dir' ? [n.name, ...dirs(n.children)] : []))

describe('bases fixture', () => {
  it('exposes 8 markdown plus supported view-only files; pngs, .trash and .obsidian stay hidden', async () => {
    const body = await tree(root)
    const all = files(body.tree)
    expect(all.filter((f) => f.kind === 'markdown')).toHaveLength(8)
    expect(all.filter((f) => f.kind === 'text')).toHaveLength(2)
    expect(all.filter((f) => f.kind === 'pdf')).toHaveLength(1)
    expect(all).toHaveLength(11)
    expect(all.filter((f) => f.name.endsWith('.png'))).toHaveLength(0)
    expect(dirs(body.tree)).not.toContain('.trash')
    expect(dirs(body.tree)).not.toContain('.obsidian')
  })
})
