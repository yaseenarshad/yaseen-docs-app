/**
 * A tab path as a name (YAZ-2290): the Files tree says which path is a folder, and a folder's
 * label is its whole name. `api.tree` is mocked; each case stands in its own root, with its own feed.
 */
import { describe, expect, it, vi } from 'vitest'
import type { IndexRecord, TreeNode } from '@shared/types'
import { isFolderPath, pageLabel, pathTitles } from './pageLabel'
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

const titled = (path: string, title: string) => ({ path, title }) as IndexRecord

describe('pageLabel', () => {
  it('a path the index does not know shows its file name: a file hides its Markdown extension; a folder keeps its whole name, even one named like a file', () => {
    const none = pathTitles([], [])
    expect(pageLabel('/v/sub/Plan.markdown', false, none)).toBe('Plan')
    expect(pageLabel('/v/report.PDF', false, none)).toBe('report.PDF')
    expect(pageLabel('/v/Notes.md', true, none)).toBe('Notes.md')
    expect(pageLabel('/v/v1.2', true, none)).toBe('v1.2')
  })

  it('E: a note shows its title, and a folder the title in its settings file (YAZ-2420 D14)', () => {
    const titles = pathTitles([titled('/v/upwork/up-001-abdul-k3m9x2pq7abc.md', 'UP-001 - Abdul')], [titled('/v/upwork/.folder.md', 'Upwork 2026')])
    expect(pageLabel('/v/upwork/up-001-abdul-k3m9x2pq7abc.md', false, titles)).toBe('UP-001 - Abdul')
    expect(pageLabel('/v/upwork', true, titles)).toBe('Upwork 2026')
    expect(pageLabel('/v/upwork/scan.pdf', false, titles)).toBe('scan.pdf')
  })
})

describe('pathTitles', () => {
  it('a snapshot that changed no title keeps the Map the last one had (YAZ-2194)', () => {
    const first = pathTitles([titled('/v/a.md', 'A')], [titled('/v/dir/.folder.md', 'Dir')])
    expect([...first]).toEqual([['/v/a.md', 'A'], ['/v/dir', 'Dir']])
    expect(pathTitles([titled('/v/a.md', 'A')], [titled('/v/dir/.folder.md', 'Dir')])).toBe(first)
    expect(pathTitles([titled('/v/a.md', 'A2')], [titled('/v/dir/.folder.md', 'Dir')]).get('/v/a.md')).toBe('A2')
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
