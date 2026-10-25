/**
 * The sidebar's shared-board mark (YAZ-1799 D14, YAZ-1890), end to end through the real Tree: a
 * link glyph on exactly the shared boards, red when the last update failed or the link is stale,
 * the status as its tooltip, and it follows the record — shared, stopped, renamed — on every
 * `share:changed`. A save waiting to upload re-derives the tooltip without refetching the list.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ShareListEntry, TreeNode } from '@shared/types'

vi.mock('../api', () => ({ api: { share: { list: vi.fn(), onChanged: vi.fn() } } }))

import { api } from '../api'
import { Tree, type TreeFileMove, type TreeSelection } from '../sidebar/Tree'
import { noteBoardSaved, resetLiveShareForTests } from './liveShare'
import { useShareBadges } from './useShareBadges'

const list = vi.mocked(api.share.list)
let changed: () => void = () => {}

const file = (path: string): TreeNode => ({ type: 'file', name: path.slice(path.lastIndexOf('/') + 1), path, size: 1, mtime: 0, kind: 'drawing' })
const MOVE: TreeFileMove = { accepts: () => false, start: vi.fn(), end: vi.fn(), hover: vi.fn(), leave: vi.fn(), drop: vi.fn(), dropFiles: vi.fn() }
const SELECTION: TreeSelection = { paths: new Set(), toggle: vi.fn(), set: vi.fn() }
const NONE = new Map<string, never>()
const VAULTS = ['/v']
const row = (path: string, over: Partial<ShareListEntry> = {}): ShareListEntry => ({ path, id: 'abc', url: 'https://share.test/b/abc', allowDownload: true, sharedAt: 0, updatedAt: Date.now(), sync: { state: 'ok' }, stale: false, fileExists: true, ...over })

const seen: Array<ReadonlyMap<string, unknown>> = []
function Probe({ nodes, vaults = VAULTS }: { nodes: TreeNode[]; vaults?: readonly string[] }) {
  const badges = useShareBadges(vaults)
  seen.push(badges)
  return <Tree nodes={nodes} dirPath="/v" vaultRows={NONE} expanded={new Set()} activeFile={null} onToggle={vi.fn()} onOpenFile={vi.fn()} onKeepFile={vi.fn()} onOpenFileBackground={vi.fn()} onOpenDefault={vi.fn()} onNodeContextMenu={vi.fn()} pending={null} renaming={null} move={MOVE} selection={SELECTION} shortcuts={NONE} titles={NONE} shareBadges={badges} />
}

let root: Root | null = null
let el: HTMLElement
beforeEach(() => {
  list.mockReset().mockResolvedValue([])
  vi.mocked(api.share.onChanged).mockImplementation((l) => {
    changed = l
    return () => {}
  })
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  el?.remove()
  resetLiveShareForTests()
})

const flush = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
async function mount(nodes: TreeNode[]) {
  el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
  act(() => root?.render(<Probe nodes={nodes} />))
  await flush()
  return (nodes2: TreeNode[]) => act(() => root?.render(<Probe nodes={nodes2} />))
}
const mark = (path: string) => el.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"] .tree__share`)
const A = '/v/A.excalidraw'
const B = '/v/B.excalidraw'

describe('shared-board marks (YAZ-1890, YAZ-3040)', () => {
  it('marks exactly the shared rows, green, with the status as the tooltip — unshared rows wear nothing', async () => {
    list.mockResolvedValue([row(A)])
    await mount([file(A), file(B)])
    expect(mark(A)?.dataset.tone).toBe('ok')
    expect(mark(A)?.getAttribute('title')).toBe('Shared · Up to date')
    expect(mark(A)?.getAttribute('aria-label')).toBe('Shared · Up to date')
    expect(mark(B)).toBeNull()
    expect(el.querySelectorAll('.tree__share')).toHaveLength(1)
  })

  it('appears when a board is shared and disappears when it is stopped, on share:changed', async () => {
    await mount([file(A)])
    expect(mark(A)).toBeNull()
    list.mockResolvedValue([row(A)])
    act(() => changed())
    await flush()
    expect(mark(A)).not.toBeNull()
    list.mockResolvedValue([])
    act(() => changed())
    await flush()
    expect(mark(A)).toBeNull()
  })

  it('red when the last update failed, and when the link is stale', async () => {
    list.mockResolvedValue([row(A, { sync: { state: 'failed', message: 'You are offline.' } }), row(B, { stale: true })])
    await mount([file(A), file(B)])
    expect(mark(A)?.dataset.tone).toBe('error')
    expect(mark(A)?.getAttribute('title')).toBe("Shared · Couldn't update: You are offline.")
    expect(mark(B)?.dataset.tone).toBe('error')
    expect(mark(B)?.getAttribute('title')).toMatch(/gone from Cloudflare/)
  })

  it('follows a rename: the record moves in main, share:changed refetches, the mark moves with the row', async () => {
    list.mockResolvedValue([row(A)])
    const rerender = await mount([file(A)])
    const renamed = '/v/Renamed.excalidraw'
    list.mockResolvedValue([row(renamed)])
    rerender([file(renamed)])
    act(() => changed())
    await flush()
    expect(mark(renamed)?.dataset.tone).toBe('ok')
    expect(el.querySelectorAll('.tree__share')).toHaveLength(1)
  })

  it('a save waiting to upload updates the tooltip without asking main for the list again', async () => {
    list.mockResolvedValue([row(A)])
    await mount([file(A)])
    expect(list).toHaveBeenCalledTimes(1)
    act(() => noteBoardSaved('/v', A, 1e9))
    expect(mark(A)?.getAttribute('title')).toBe('Shared · Waiting to upload changes…')
    expect(mark(A)?.dataset.tone).toBe('ok')
    expect(list).toHaveBeenCalledTimes(1)
  })

  it('never asks for the live check: a save (three share:changed) costs no network call per share', async () => {
    list.mockResolvedValue([row(A), row(B)])
    await mount([file(A), file(B)])
    for (let i = 0; i < 3; i++) act(() => changed())
    await flush()
    expect(list.mock.calls.length).toBeGreaterThan(1)
    for (const call of list.mock.calls) expect(call).toEqual(['/v', false])
  })

  it('marks the shared boards of every vault the window shows, and one list that cannot be read costs only its own marks (YAZ-3040)', async () => {
    const W = '/w/C.excalidraw'
    list.mockImplementation(async (root) => (root === '/v' ? [row(A)] : root === '/w' ? [row(W, { id: 'w' })] : Promise.reject(new Error('gone'))))
    el = document.createElement('div')
    document.body.appendChild(el)
    root = createRoot(el)
    act(() => root?.render(<Probe nodes={[file(A), file(W)]} vaults={['/v', '/w', '/x']} />))
    await flush()
    expect(mark(A)?.dataset.tone).toBe('ok')
    expect(mark(W)?.dataset.tone).toBe('ok')
    expect(list.mock.calls.map(([vault]) => vault).sort()).toEqual(['/v', '/w', '/x'])
  })

  it('YAZ-3044 A29: hands back the SAME map while no mark changes, so the tree is not rendered again on each save', async () => {
    const A = '/v/a.excalidraw'
    list.mockResolvedValue([row(A)])
    await mount([file(A)])
    const before = seen.at(-1)
    act(() => root?.render(<Probe nodes={[file(A)]} />))
    expect(seen.at(-1)).toBe(before)
    // A save of an UNSHARED board re-derives, and the marks are the same: still the same map.
    act(() => noteBoardSaved('/v', '/v/other.excalidraw', 1e9))
    expect(seen.at(-1)).toBe(before)
  })
})
