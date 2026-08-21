import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { TreeNode } from '@shared/types'
import { makeBasesFixture } from './basesFixture'
import { tree } from './tree'

let root: string
let cleanup: () => Promise<void>
beforeAll(async () => ({ root, cleanup } = await makeBasesFixture()))
afterAll(() => cleanup())

type FileNode = Extract<TreeNode, { type: 'file' }>
const files = (nodes: TreeNode[]): FileNode[] => nodes.flatMap((n) => (n.type === 'dir' ? files(n.children) : [n]))
const dirs = (nodes: TreeNode[]): string[] => nodes.flatMap((n) => (n.type === 'dir' ? [n.name, ...dirs(n.children)] : []))

describe('bases fixture', () => {
  it('exposes 8 markdown files and 1 base through tree(); pngs, .trash and .obsidian hidden', async () => {
    const body = await tree(root)
    const all = files(body.tree)
    expect(all.filter((f) => f.kind === 'markdown')).toHaveLength(8)
    expect(all.filter((f) => f.kind === 'base').map((f) => f.name)).toEqual(['Content Topics DB.base'])
    expect(all.filter((f) => f.name.endsWith('.png'))).toHaveLength(0)
    expect(dirs(body.tree)).not.toContain('.trash')
    expect(dirs(body.tree)).not.toContain('.obsidian')
  })
})
