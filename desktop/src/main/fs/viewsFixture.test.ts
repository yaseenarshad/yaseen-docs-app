import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { TreeNode } from '@shared/types'
import { makeViewsFixture } from './viewsFixture'
import { tree } from './tree'

let root: string
let cleanup: () => Promise<void>
beforeAll(async () => ({ root, cleanup } = await makeViewsFixture()))
afterAll(() => cleanup())

type FileNode = Extract<TreeNode, { type: 'file' }>
const files = (nodes: TreeNode[]): FileNode[] => nodes.flatMap((n) => (n.type === 'dir' ? files(n.children) : [n]))
const dirs = (nodes: TreeNode[]): string[] => nodes.flatMap((n) => (n.type === 'dir' ? [n.name, ...dirs(n.children)] : []))

describe('bases fixture', () => {
  it('exposes 8 markdown files through tree(); pngs, .trash and .obsidian hidden', async () => {
    const body = await tree(root)
    const all = files(body.tree)
    expect(all.filter((f) => f.kind === 'markdown')).toHaveLength(8)
    expect(all).toHaveLength(8) // markdown is the only kind the tree serves (YAZ-844)
    expect(all.filter((f) => f.name.endsWith('.png'))).toHaveLength(0)
    expect(dirs(body.tree)).not.toContain('.trash')
    expect(dirs(body.tree)).not.toContain('.obsidian')
  })
})
