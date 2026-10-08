/**
 * A tab path as a name (YAZ-2290): the Files tree says which path is a folder, and a folder's
 * label is its whole name. `api.tree` is mocked; each case stands in its own root, with its own feed.
 */
import { describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { IndexRecord, TreeNode } from '@shared/types'
import { createWikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { isFolderPath, pageLabel, pathTitles, useAllPathTitles, useFolderPaths, type PathTitles } from './pageLabel'
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

  it('two vaults: each keeps its own Map while its titles stand, whichever vault\'s snapshot was read between (YAZ-2602)', () => {
    const a = pathTitles([titled('/pa/a.md', 'A')], [])
    const b = pathTitles([titled('/pb/b.md', 'B')], [])
    // A save in /pa that changes no title, read after /pb's snapshot: the Map /pa's name holders already have.
    expect(pathTitles([titled('/pa/a.md', 'A')], [])).toBe(a)
    expect(pathTitles([titled('/pb/b.md', 'B')], [])).toBe(b)
    // A changed title is a new Map for its own vault, and the other vault's stands.
    const a2 = pathTitles([titled('/pa/a.md', 'A2')], [])
    expect(a2).not.toBe(a)
    expect(pathTitles([titled('/pb/b.md', 'B')], [])).toBe(b)
    expect(pathTitles([titled('/pa/a.md', 'A2')], [])).toBe(a2)
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

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** Renders `hook` in a component and hands back what its newest render returned, and how often it rendered. */
function probe<T>(hook: () => T) {
  const seen = { value: undefined as T, renders: 0 }
  const Probe = (): null => {
    seen.value = hook()
    seen.renders++
    return null
  }
  const root = createRoot(document.createElement('div'))
  act(() => root.render(createElement(Probe)))
  return { seen, unmount: () => act(() => root.unmount()) }
}

describe('useAllPathTitles (YAZ-2602 D1)', () => {
  it('one vault: that vault\'s own Map, as `usePathTitles` gives it', () => {
    const source = createWikilinkResolveSource()
    const records = [titled('/one/a.md', 'A')]
    source.update(() => null, records, [])
    const sources = [source]
    const { seen, unmount } = probe(() => useAllPathTitles(sources))
    expect(seen.value).toBe(pathTitles(records, []))
    unmount()
  })

  it('two vaults: one Map over both, kept while no title changed, whichever vault\'s snapshot landed', () => {
    const v = createWikilinkResolveSource()
    const w = createWikilinkResolveSource()
    v.update(() => null, [titled('/v/a.md', 'A')], [titled('/v/dir/.folder.md', 'Dir')])
    w.update(() => null, [titled('/w/b.md', 'B')], [])
    const sources = [v, w]
    const { seen, unmount } = probe<PathTitles>(() => useAllPathTitles(sources))
    const first = seen.value
    expect([...first]).toEqual([['/v/a.md', 'A'], ['/v/dir', 'Dir'], ['/w/b.md', 'B']])

    // A save in /w, then one in /v, that change no title: the same Map, so nothing that shows a name renders.
    const renders = seen.renders
    act(() => w.update(() => null, [titled('/w/b.md', 'B')], []))
    act(() => v.update(() => null, [titled('/v/a.md', 'A')], [titled('/v/dir/.folder.md', 'Dir')]))
    expect(seen.value).toBe(first)
    expect(seen.renders).toBe(renders)

    act(() => w.update(() => null, [titled('/w/b.md', 'B2'), titled('/w/c.md', 'C')], []))
    expect(seen.value).not.toBe(first)
    expect([...seen.value]).toEqual([['/v/a.md', 'A'], ['/v/dir', 'Dir'], ['/w/b.md', 'B2'], ['/w/c.md', 'C']])
    unmount()
  })

  it('no vault: an empty Map, the same one on each render', () => {
    const sources: never[] = []
    const { seen, unmount } = probe(() => useAllPathTitles(sources))
    expect(seen.value.size).toBe(0)
    unmount()
  })
})

describe('useFolderPaths (YAZ-2602 S31)', () => {
  it('asks the tree of the vault that holds each path, the most specific one, and follows each vault\'s tree as it lands', async () => {
    const dir = (path: string): TreeNode => ({ type: 'dir', name: path.slice(path.lastIndexOf('/') + 1), path, children: [] })
    vi.mocked(api.tree).mockImplementation(async (root) => ({ root, tree: root === '/fp/a' ? [dir('/fp/a/Notes.md')] : [dir('/fp/b/Plans.md')], generatedAt: 1 }))
    const roots = ['/fp/a', '/fp/b']
    const { seen, unmount } = probe(() => useFolderPaths(roots))
    expect(seen.value('/fp/a/Notes.md')).toBe(false) // no tree yet
    await act(async () => void (await fetchTree('/fp/a')))
    expect(seen.value('/fp/a/Notes.md')).toBe(true)
    expect(seen.value('/fp/b/Plans.md')).toBe(false)
    const renders = seen.renders
    await act(async () => void (await fetchTree('/fp/b')))
    expect(seen.renders).toBeGreaterThan(renders)
    expect(seen.value('/fp/b/Plans.md')).toBe(true)
    expect(seen.value('/fp/b/Notes.md')).toBe(false) // a folder of /fp/a says nothing about /fp/b
    expect(seen.value('/elsewhere/Notes.md')).toBe(false) // in no vault: the first vault's tree is asked
    unmount()
  })
})
