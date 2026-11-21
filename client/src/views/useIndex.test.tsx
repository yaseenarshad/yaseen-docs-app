/**
 * `useIndex` (GRO-2129): one `api.index(root)` fetch per root, debounced refetch on watch
 * events that can change the index (markdown add/change/unlink, unlinkDir, ready). The
 * bridge is mocked; the watcher is a fake `WatchSource` whose subscribers are captured.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { IDS_FILE } from '@shared/pageId'
import type { IndexRecord, IndexResponse, VaultConfigChange, WatchEvent } from '@shared/types'
import type { WatchListener, WatchSource } from '../hooks/useWatch'
import { consumeRetitleHint, hintRetitle } from '../lib/indexFeed'
import { useIndex, type IndexState } from './useIndex'

let configListeners: Array<(c: VaultConfigChange) => void> = []
let idsListeners: Array<(c: { root: string }) => void> = []
let renameListeners: Array<(ev: { oldPath: string; newPath: string; kind: 'file' | 'dir' }) => void> = []

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: {
    index: vi.fn(),
    vaultConfig: {
      onChange: vi.fn((l: (c: VaultConfigChange) => void) => {
        configListeners.push(l)
        return () => (configListeners = configListeners.filter((x) => x !== l))
      }),
    },
    ids: {
      onChanged: vi.fn((l: (c: { root: string }) => void) => {
        idsListeners.push(l)
        return () => (idsListeners = idsListeners.filter((x) => x !== l))
      }),
    },
    file: {
      onRenamed: vi.fn((l: (ev: { oldPath: string; newPath: string; kind: 'file' | 'dir' }) => void) => {
        renameListeners.push(l)
        return () => (renameListeners = renameListeners.filter((x) => x !== l))
      }),
    },
  },
}))

import { api } from '../api'

const indexFn = vi.mocked(api.index)

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const rec = (path: string): IndexRecord => ({
  path,
  name: path.slice(path.lastIndexOf('/') + 1),
  basename: path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, ''),
  title: path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, ''),
  folder: '',
  ext: 'md',
  size: 1,
  ctime: 1,
  mtime: 1,
  properties: {},
  aliases: [],
  tags: [],
  links: [],
  embeds: [],
})

const response = (root: string, ...paths: string[]): IndexResponse => ({
  root,
  records: paths.map(rec),
  folders: [],
  generatedAt: 1,
  ids: true,
})

let root: Root | null = null
let container: HTMLElement | null = null
let listeners: WatchListener[] = []
let state: IndexState

const watch: WatchSource = {
  subscribe: (l) => {
    listeners.push(l)
    return () => {
      listeners = listeners.filter((x) => x !== l)
    }
  },
}

function Probe({ vaultRoot }: { vaultRoot: string }) {
  state = useIndex(vaultRoot, watch)
  return null
}

function mount(vaultRoot = '/vault'): void {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<Probe vaultRoot={vaultRoot} />))
}

function rerender(vaultRoot: string): void {
  act(() => root?.render(<Probe vaultRoot={vaultRoot} />))
}

/** Lets the mocked fetch promise resolve and React commit. */
async function flush(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

async function emit(ev: WatchEvent): Promise<void> {
  await act(async () => {
    listeners.forEach((l) => l(ev))
    await vi.advanceTimersByTimeAsync(0)
  })
}

async function configChanged(change: VaultConfigChange): Promise<void> {
  await act(async () => {
    configListeners.forEach((l) => l(change))
    await vi.advanceTimersByTimeAsync(0)
  })
}

async function pastDebounce(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  indexFn.mockResolvedValue(response('/vault', '/vault/a.md', '/vault/b.md'))
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  listeners = []
  configListeners = []
  idsListeners = []
  renameListeners = []
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('useIndex', () => {
  it('is pending on mount, then ready with the fetched records', async () => {
    mount()
    expect(state.status).toBe('pending')
    expect(state.records).toEqual([])
    await flush()
    expect(indexFn).toHaveBeenCalledWith('/vault')
    expect(state.status).toBe('ready')
    expect(state.records.map((r) => r.path)).toEqual(['/vault/a.md', '/vault/b.md'])
    expect(state.error).toBeNull()
  })

  it('a failed fetch becomes status error with the message', async () => {
    indexFn.mockRejectedValue(new Error('bridge gone'))
    mount()
    await flush()
    expect(state.status).toBe('error')
    expect(state.error).toBe('bridge gone')
    expect(state.records).toEqual([])
  })

  it('markdown add/change/unlink events collapse into one debounced refetch', async () => {
    mount()
    await flush()
    indexFn.mockResolvedValue(response('/vault', '/vault/a.md', '/vault/b.md', '/vault/c.md'))
    await emit({ type: 'add', path: '/vault/c.md', mtime: 2 })
    await emit({ type: 'change', path: '/vault/a.md', mtime: 2 })
    await emit({ type: 'unlink', path: '/vault/b.md' })
    expect(indexFn).toHaveBeenCalledTimes(1) // still only the mount fetch
    await pastDebounce()
    expect(indexFn).toHaveBeenCalledTimes(2)
    expect(state.records.map((r) => r.path)).toEqual(['/vault/a.md', '/vault/b.md', '/vault/c.md'])
    expect(state.status).toBe('ready')
  })

  it('ignores events for non-markdown paths', async () => {
    mount()
    await flush()
    await emit({ type: 'change', path: '/vault/topics.txt', mtime: 2 })
    await emit({ type: 'add', path: '/vault/cover.png', mtime: 2 })
    await emit({ type: 'addDir', path: '/vault/new-dir' })
    await pastDebounce()
    expect(indexFn).toHaveBeenCalledTimes(1)
  })

  it('unlinkDir and ready refetch (a removed dir may have held pages; ready = missed events)', async () => {
    mount()
    await flush()
    await emit({ type: 'unlinkDir', path: '/vault/old' })
    await pastDebounce()
    expect(indexFn).toHaveBeenCalledTimes(2)
    await emit({ type: 'ready', root: '/vault' })
    await pastDebounce()
    expect(indexFn).toHaveBeenCalledTimes(3)
  })

  it('refresh() refetches immediately', async () => {
    mount()
    await flush()
    indexFn.mockResolvedValue(response('/vault', '/vault/z.md'))
    await act(async () => {
      state.refresh()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(indexFn).toHaveBeenCalledTimes(2)
    expect(state.records.map((r) => r.path)).toEqual(['/vault/z.md'])
  })

  it('a root change resets to pending and fetches the new root', async () => {
    mount('/vault')
    await flush()
    indexFn.mockResolvedValue(response('/other', '/other/x.md'))
    rerender('/other')
    expect(state.status).toBe('pending')
    expect(state.records).toEqual([])
    await flush()
    expect(indexFn).toHaveBeenLastCalledWith('/other')
    expect(state.records.map((r) => r.path)).toEqual(['/other/x.md'])
  })

  it('unmount cancels a pending debounced refetch', async () => {
    mount()
    await flush()
    await emit({ type: 'change', path: '/vault/a.md', mtime: 2 })
    act(() => root?.unmount())
    root = null
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(indexFn).toHaveBeenCalledTimes(1)
  })

  it('exposes the vault’s kind from the snapshot: `ids`, and `ask` while the vault has not answered; no IDs and nothing to ask until the first one lands (YAZ-2523)', async () => {
    indexFn.mockResolvedValue({ ...response('/vault', '/vault/a.md'), ids: false, ask: { pages: 1, folders: 2, foreign: 0 } })
    mount()
    expect(state).toMatchObject({ ids: false, ask: undefined })
    await flush()
    expect(state).toMatchObject({ ids: false, ask: { pages: 1, folders: 2, foreign: 0 } })
    indexFn.mockResolvedValue(response('/vault', '/vault/a.md'))
    await act(async () => {
      state.refresh()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(state).toMatchObject({ ids: true, ask: undefined })
    indexFn.mockResolvedValue({ ...response('/other', '/other/x.md'), ids: false })
    rerender('/other')
    expect(state).toMatchObject({ ids: false, ask: undefined })
  })

  it('refetches at once when `ids.json` changes for its root — not for another root, not for another file (YAZ-2523)', async () => {
    mount()
    await flush()
    await configChanged({ root: '/other', name: IDS_FILE })
    await configChanged({ root: '/vault', name: 'review.json' })
    await pastDebounce()
    expect(indexFn).toHaveBeenCalledTimes(1)
    indexFn.mockResolvedValue({ ...response('/vault', '/vault/a.md'), ids: false })
    await configChanged({ root: '/vault', name: IDS_FILE })
    expect(indexFn).toHaveBeenCalledTimes(2)
    expect(state.ids).toBe(false)
    act(() => root?.unmount())
    root = null
    expect(configListeners).toEqual([])
  })

  it('fetches at once when main says "Change letters" ended for its root, in a burst of events too — not for another root, and not after unmount (YAZ-3102)', async () => {
    mount()
    await flush()
    // A burst of renames keeps the debounce waiting: the change ended, so the index is read now.
    await emit({ type: 'unlink', path: '/vault/a.md' })
    await emit({ type: 'add', path: '/vault/a2.md', mtime: 2 })
    indexFn.mockResolvedValue(response('/vault', '/vault/a2.md', '/vault/b.md'))
    await act(async () => {
      idsListeners.forEach((l) => l({ root: '/other' }))
      idsListeners.forEach((l) => l({ root: '/vault' }))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(indexFn).toHaveBeenCalledTimes(2)
    expect(state.records.map((r) => r.path)).toEqual(['/vault/a2.md', '/vault/b.md'])
    act(() => root?.unmount())
    root = null
    expect(idsListeners).toEqual([])
  })

  it('refetches on the leading edge of `file:renamed` for its root (ignoring other roots) and coalesces bulk rename bursts (YAZ-6008)', async () => {
    mount()
    await flush()
    expect(indexFn).toHaveBeenCalledTimes(1)

    // Arm the watcher's 300 ms cooldown via a `change` event (simulating `writeTitle` right before `renameFile`).
    await emit({ type: 'change', path: '/vault/a.md', mtime: 2 })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40)
    })
    expect(indexFn).toHaveBeenCalledTimes(2)

    // Rename in another vault does nothing.
    await act(async () => {
      renameListeners.forEach((l) => l({ oldPath: '/other/x.md', newPath: '/other/y.md', kind: 'file' }))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(indexFn).toHaveBeenCalledTimes(2)

    // Rename in this vault remaps the record synchronously with the hinted title (before `api.index` even resolves!)
    // and kicks off an immediate refresh even while the watcher's 300 ms cooldown is active.
    let resolveIndex!: (res: IndexResponse) => void
    indexFn.mockImplementationOnce(() => new Promise<IndexResponse>((r) => (resolveIndex = r)))
    hintRetitle('/vault/a.md', 'A Renamed')
    await act(async () => {
      renameListeners.forEach((l) => l({ oldPath: '/vault/a.md', newPath: '/vault/a-renamed-test-1.md', kind: 'file' }))
    })
    expect(indexFn).toHaveBeenCalledTimes(3)
    expect(state.records[0]?.path).toBe('/vault/a-renamed-test-1.md')
    expect(state.records[0]?.title).toBe('A Renamed')

    // Authoritative snapshot lands cleanly afterwards.
    await act(async () => {
      resolveIndex({ ...response('/vault', '/vault/a-renamed-test-1.md', '/vault/b.md'), records: [{ ...rec('/vault/a-renamed-test-1.md'), title: 'A Renamed' }, rec('/vault/b.md')] })
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(state.records[0]?.title).toBe('A Renamed')

    // A burst of 5 rapid renames (e.g. "Change letters") triggers only 1 trailing read after the quiet window.
    await act(async () => {
      for (let i = 0; i < 5; i++) renameListeners.forEach((l) => l({ oldPath: `/vault/p${i}.md`, newPath: `/vault/q${i}.md`, kind: 'file' }))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(indexFn).toHaveBeenCalledTimes(3)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150)
    })
    expect(indexFn).toHaveBeenCalledTimes(4)

    act(() => root?.unmount())
    root = null
    expect(renameListeners).toEqual([])
  })

  const rename = async (oldPath: string, newPath: string, kind: 'file' | 'dir' = 'file'): Promise<void> => {
    await act(async () => {
      renameListeners.forEach((l) => l({ oldPath, newPath, kind }))
    })
  }

  it('a stale leading read of a rename burst never puts old paths back; only the trailing read commits (YAZ-6056)', async () => {
    mount()
    await flush()
    // The leading read was built before renames 2..3 landed in main: it still holds p1 and p2.
    let resolveLeading!: (res: IndexResponse) => void
    indexFn.mockImplementationOnce(() => new Promise<IndexResponse>((r) => (resolveLeading = r)))
    indexFn.mockResolvedValueOnce(response('/vault', '/vault/q0.md', '/vault/q1.md', '/vault/q2.md'))
    await rename('/vault/p0.md', '/vault/q0.md')
    await rename('/vault/p1.md', '/vault/q1.md')
    await rename('/vault/p2.md', '/vault/q2.md')
    await act(async () => {
      resolveLeading(response('/vault', '/vault/q0.md', '/vault/p1.md', '/vault/p2.md'))
      await vi.advanceTimersByTimeAsync(0)
    })
    // The stale answer was dropped: the records did not go back to p1/p2.
    expect(state.records.map((r) => r.path)).toEqual(['/vault/a.md', '/vault/b.md'])
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150)
    })
    expect(indexFn).toHaveBeenCalledTimes(3)
    expect(state.records.map((r) => r.path)).toEqual(['/vault/q0.md', '/vault/q1.md', '/vault/q2.md'])
  })

  it('a plain rename (no title edit) makes no optimistic array: records keep their identity until the read lands (YAZ-6056)', async () => {
    mount()
    await flush()
    const before = state.records
    let resolveRead!: (res: IndexResponse) => void
    indexFn.mockImplementationOnce(() => new Promise<IndexResponse>((r) => (resolveRead = r)))
    await rename('/vault/a.md', '/vault/a2.md')
    expect(state.records).toBe(before)
    await act(async () => {
      resolveRead(response('/vault', '/vault/a2.md', '/vault/b.md'))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(state.records.map((r) => r.path)).toEqual(['/vault/a2.md', '/vault/b.md'])
  })

  it('a title edit remaps at once with the new title, the new name and the right `folder`; a folder title edit moves every record under it (YAZ-6056)', async () => {
    indexFn.mockResolvedValue({ ...response('/vault'), records: [{ ...rec('/vault/sub/a.md'), folder: 'sub' }, { ...rec('/vault/d/x.md'), folder: 'd' }, { ...rec('/vault/d/e/y.md'), folder: 'd/e' }], folders: [{ ...rec('/vault/d/.folder.md'), folder: 'd', title: 'D' }, { ...rec('/vault/d/e/.folder.md'), folder: 'd/e', title: 'E' }] })
    mount()
    await flush()
    indexFn.mockImplementation(() => new Promise<IndexResponse>(() => undefined)) // reads never land: the optimistic state is what shows
    hintRetitle('/vault/sub/a.md', 'Alpha')
    await rename('/vault/sub/a.md', '/vault/sub/alpha-test-1.md')
    expect(state.records[0]).toMatchObject({ path: '/vault/sub/alpha-test-1.md', name: 'alpha-test-1.md', basename: 'alpha-test-1', folder: 'sub', title: 'Alpha' })
    hintRetitle('/vault/d', 'Done')
    await rename('/vault/d', '/vault/done', 'dir')
    expect(state.records.slice(1).map((r) => [r.path, r.folder])).toEqual([['/vault/done/x.md', 'done'], ['/vault/done/e/y.md', 'done/e']])
    expect(state.folders.map((r) => [r.path, r.title])).toEqual([['/vault/done/.folder.md', 'Done'], ['/vault/done/e/.folder.md', 'E']])
  })

  it('a rename event takes its hint once; the hint never reaches a later rename of the same path (YAZ-6056)', async () => {
    mount()
    await flush()
    indexFn.mockImplementation(() => new Promise<IndexResponse>(() => undefined))
    hintRetitle('/vault/a.md', 'First')
    await rename('/vault/a.md', '/vault/first-test-1.md')
    expect(state.records[0]?.title).toBe('First')
    const after = state.records
    await rename('/vault/b.md', '/vault/b2.md')
    expect(state.records).toBe(after)
    expect(consumeRetitleHint('/vault/a.md')).toBeUndefined()
  })
})
