/**
 * WikilinkIndexBridge (Links A, GRO-2190 + Links B, GRO-2191): the App-level glue that keeps
 * the wikilink resolve source AND the `[[` picker's candidate source fed from `useIndex`. The
 * bridge is mocked like useIndex.test.tsx; asserted here: the sources stay untouched until the
 * index is READY, resolve/candidate contents once it is (candidates as shortest unambiguous
 * names — duplicates folder-disambiguated — plus frontmatter alias rows, GRO-2214), and fresh
 * contents after a watch-driven refetch (which notifies subscribers).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IndexRecord, IndexResponse, WatchEvent } from '@shared/types'
import type { WatchListener, WatchSource } from '../../hooks/useWatch'
import { createWikilinkCandidateSource, type MutableWikilinkCandidateSource } from './wikilinkPicker'
import { createWikilinkResolveSource, type MutableWikilinkResolveSource } from './wikilinkPlugin'
import { WikilinkIndexBridge } from './WikilinkIndexBridge'

vi.mock('../../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api')>()),
  api: { index: vi.fn() },
}))

import { api } from '../../api'

const indexFn = vi.mocked(api.index)

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const rec = (path: string, aliases: string[] = []): IndexRecord => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const folder = path.slice('/vault/'.length, path.lastIndexOf('/')).replace(/^\/+/, '')
  return {
    path,
    name,
    basename: name.replace(/\.md$/, ''),
    folder: path.indexOf('/', '/vault/'.length) === -1 ? '' : folder,
    ext: 'md',
    size: 1,
    ctime: 1,
    mtime: 1,
    properties: {},
    aliases,
    tags: [],
    links: [],
    embeds: [],
  }
}

const response = (...paths: string[]): IndexResponse => ({ root: '/vault', records: paths.map((p) => rec(p)), generatedAt: 1 })

let root: Root | null = null
let container: HTMLElement | null = null
let listeners: WatchListener[] = []
let source: MutableWikilinkResolveSource
let candidates: MutableWikilinkCandidateSource

const watch: WatchSource = {
  subscribe: (l) => {
    listeners.push(l)
    return () => {
      listeners = listeners.filter((x) => x !== l)
    }
  },
}

function mount(): void {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<WikilinkIndexBridge root="/vault" watch={watch} source={source} candidates={candidates} />))
}

async function flush(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

async function emitPastDebounce(ev: WatchEvent): Promise<void> {
  await act(async () => {
    listeners.forEach((l) => l(ev))
    await vi.advanceTimersByTimeAsync(400)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  source = createWikilinkResolveSource()
  candidates = createWikilinkCandidateSource()
  indexFn.mockResolvedValue(response('/vault/Note.md', '/vault/deep/Other.md'))
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  listeners = []
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('WikilinkIndexBridge', () => {
  it('leaves the source untouched until the index is ready, then resolves targets to paths', async () => {
    mount()
    expect(source.resolve).toBeNull() // pending: links render resolved, no dimming flash
    await flush()
    expect(source.resolve).not.toBeNull()
    expect(source.resolve?.('Note')).toBe('/vault/Note.md')
    expect(source.resolve?.('Other')).toBe('/vault/deep/Other.md')
    expect(source.resolve?.('deep/Other')).toBe('/vault/deep/Other.md')
    expect(source.resolve?.('Nope')).toBeNull()
  })

  it('a watch-driven refetch swaps in a fresh resolver and notifies subscribers', async () => {
    mount()
    await flush()
    const wake = vi.fn()
    source.subscribe(wake)
    indexFn.mockResolvedValue(response('/vault/Note.md', '/vault/New.md'))
    await emitPastDebounce({ type: 'add', path: '/vault/New.md', mtime: 2 })
    expect(wake).toHaveBeenCalled()
    expect(source.resolve?.('New')).toBe('/vault/New.md')
  })

  it('a failed refetch keeps the previous resolver (never downgrades to unresolved)', async () => {
    mount()
    await flush()
    indexFn.mockRejectedValue(new Error('boom'))
    await emitPastDebounce({ type: 'change', path: '/vault/Note.md', mtime: 2 })
    expect(source.resolve?.('Note')).toBe('/vault/Note.md')
  })

  it('feeds the picker candidate source too: shortest names, duplicates folder-disambiguated (GRO-2191)', async () => {
    indexFn.mockResolvedValue(response('/vault/Note.md', '/vault/deep/Note.md', '/vault/deep/Other.md'))
    mount()
    expect(candidates.candidates).toEqual([]) // pending: nothing yet
    await flush()
    // Candidates are rows, not strings, since E2 (GRO-2214) — the inserted text is the pin.
    expect(candidates.candidates.map((c) => c.insert)).toEqual(['Note', 'deep/Note', 'Other'])
    const wake = vi.fn()
    candidates.subscribe(wake)
    indexFn.mockResolvedValue(response('/vault/Note.md', '/vault/New.md'))
    await emitPastDebounce({ type: 'add', path: '/vault/New.md', mtime: 2 })
    expect(wake).toHaveBeenCalled()
    expect(candidates.candidates.map((c) => c.insert)).toEqual(['Note', 'New'])
  })

  it('aliases ride the same feed: the resolver dims nothing for `[[CAC]]` and the picker offers a piped row (E2, GRO-2214)', async () => {
    indexFn.mockResolvedValue({
      root: '/vault',
      records: [rec('/vault/Customer Acquisition Cost.md', ['CAC'])],
      generatedAt: 1,
    })
    mount()
    await flush()
    // The decorations resolve through THIS function, so an alias-form link renders resolved.
    expect(source.resolve?.('CAC')).toBe('/vault/Customer Acquisition Cost.md')
    expect(source.resolve?.('cac')).toBe('/vault/Customer Acquisition Cost.md')
    expect(source.resolve?.('Nope')).toBeNull()
    expect(candidates.candidates.map((c) => c.label)).toEqual([
      'Customer Acquisition Cost',
      'CAC — Customer Acquisition Cost',
    ])

    // Dropping the alias from the frontmatter unresolves `[[CAC]]` again on the next snapshot.
    indexFn.mockResolvedValue({ root: '/vault', records: [rec('/vault/Customer Acquisition Cost.md')], generatedAt: 2 })
    await emitPastDebounce({ type: 'change', path: '/vault/Customer Acquisition Cost.md', mtime: 2 })
    expect(source.resolve?.('CAC')).toBeNull()
    expect(candidates.candidates.map((c) => c.label)).toEqual(['Customer Acquisition Cost'])
  })
})
