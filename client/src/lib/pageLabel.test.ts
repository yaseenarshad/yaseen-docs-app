/**
 * A tab path as a name (YAZ-2290): the Files tree says which path is a folder, and a folder's
 * label is its whole name. `api.tree` is mocked; each case stands in its own root, with its own feed.
 */
import { describe, expect, it, vi } from 'vitest'
import type { TreeNode } from '@shared/types'
import { isFolderPath, pageLabel } from './pageLabel'
import { fetchTree } from './treeFeed'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { tree: vi.fn() },
}))

import { api } from '../api'

const TREE: TreeNode[] = [
  { type: 'dir', name: 'Notes.md', path: '/labels/Notes.md', children: [] },
  { type: 'file', name: 'Plan.md', path: '/labels/Plan.md', size: 1, mtime: 1, kind: 'markdown' },
]

describe('pageLabel', () => {
  it('a file hides its Markdown extension; a folder keeps its whole name, even one named like a file', () => {
    expect(pageLabel('/v/sub/Plan.markdown', false)).toBe('Plan')
    expect(pageLabel('/v/report.PDF', false)).toBe('report.PDF')
    expect(pageLabel('/v/Notes.md', true)).toBe('Notes.md')
    expect(pageLabel('/v/v1.2', true)).toBe('v1.2')
  })
})

describe('isFolderPath', () => {
  it('is the newest tree\'s answer: false with no root, false before the first tree, then by the tree alone', async () => {
    expect(isFolderPath(null, '/labels/Notes.md')).toBe(false)
    expect(isFolderPath('/labels', '/labels/Notes.md')).toBe(false)
    vi.mocked(api.tree).mockResolvedValueOnce({ root: '/labels', tree: TREE, generatedAt: 1 })
    await fetchTree('/labels')
    expect(isFolderPath('/labels', '/labels/Notes.md')).toBe(true)
    expect(isFolderPath('/labels', '/labels/Plan.md')).toBe(false)
    expect(isFolderPath('/labels', '/labels/Gone')).toBe(false)
  })
})
