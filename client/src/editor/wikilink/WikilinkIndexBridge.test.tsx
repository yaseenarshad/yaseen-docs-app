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
import type { IndexRecord, IndexResponse, TreeNode, TreeResponse, WatchEvent } from '@shared/types'
import type { WatchListener, WatchSource } from '../../hooks/useWatch'
import { createWikilinkCandidateSource, type MutableWikilinkCandidateSource } from './wikilinkPicker'
import { createWikilinkResolveSource, type MutableWikilinkResolveSource } from './wikilinkPlugin'
import { createViewOnlyLinkSource, type MutableViewOnlyLinkSource } from './viewOnlyLinkSource'
import { WikilinkIndexBridge } from './WikilinkIndexBridge'

vi.mock('../../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api')>()),
  api: { index: vi.fn(), tree: vi.fn() },
}))

import { api } from '../../api'

const indexFn = vi.mocked(api.index)
const treeFn = vi.mocked(api.tree)

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
const viewNode = (path: string, kind: 'text' | 'pdf'): TreeNode => ({ type: 'file', name: path.slice(path.lastIndexOf('/') + 1), path, kind, size: 1, mtime: 1 })
const treeResponse = (...nodes: TreeNode[]): TreeResponse => ({ root: '/vault', tree: nodes, generatedAt: 1 })

let root: Root | null = null
let container: HTMLElement | null = null
let listeners: WatchListener[] = []
let source: MutableWikilinkResolveSource
let candidates: MutableWikilinkCandidateSource
let viewOnly: MutableViewOnlyLinkSource

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
  act(() => root?.render(<WikilinkIndexBridge root="/vault" watch={watch} source={source} candidates={candidates} viewOnly={viewOnly} />))
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
  viewOnly = createViewOnlyLinkSource()
  indexFn.mockResolvedValue(response('/vault/Note.md', '/vault/deep/Other.md'))
  treeFn.mockResolvedValue(treeResponse(viewNode('/vault/data.json', 'text'), viewNode('/vault/deep/report.PDF', 'pdf')))
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
    expect(candidates.candidates.map((c) => c.insert)).toEqual(['Note', 'deep/Note', 'Other', 'data.json', 'report.PDF'])
    const wake = vi.fn()
    candidates.subscribe(wake)
    indexFn.mockResolvedValue(response('/vault/Note.md', '/vault/New.md'))
    await emitPastDebounce({ type: 'add', path: '/vault/New.md', mtime: 2 })
    expect(wake).toHaveBeenCalled()
    expect(candidates.candidates.map((c) => c.insert)).toEqual(['Note', 'New', 'data.json', 'report.PDF'])
  })

  it('the snapshot RECORDS ride into the resolve source with the resolver (Links D, GRO-2193)', async () => {
    mount()
    expect(source.records).toEqual([]) // pending: the backlinks section has nothing to list
    await flush()
    expect(source.records.map((r) => r.path)).toEqual(['/vault/Note.md', '/vault/deep/Other.md'])
    indexFn.mockResolvedValue(response('/vault/Note.md', '/vault/New.md'))
    await emitPastDebounce({ type: 'add', path: '/vault/New.md', mtime: 2 })
    // Records and resolver are swapped together, so a count can never disagree with resolution.
    expect(source.records.map((r) => r.path)).toEqual(['/vault/Note.md', '/vault/New.md'])
    expect(source.resolve?.('New')).toBe('/vault/New.md')
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
      'data.json',
      'report.PDF',
    ])

    // Dropping the alias from the frontmatter unresolves `[[CAC]]` again on the next snapshot.
    indexFn.mockResolvedValue({ root: '/vault', records: [rec('/vault/Customer Acquisition Cost.md')], generatedAt: 2 })
    await emitPastDebounce({ type: 'change', path: '/vault/Customer Acquisition Cost.md', mtime: 2 })
    expect(source.resolve?.('CAC')).toBeNull()
    expect(candidates.candidates.map((c) => c.label)).toEqual(['Customer Acquisition Cost', 'data.json', 'report.PDF'])
  })

  it('feeds a separate view-only source and merges only picker candidates, reserving explicit collisions', async () => {
    const semantic = response('/vault/data.json.md', '/vault/Note.md')
    indexFn.mockResolvedValue(semantic)
    mount()
    expect(viewOnly.ready).toBe(false)
    await flush()

    expect(source.records).toBe(semantic.records)
    expect(source.resolve?.('data.json')).toBe('/vault/data.json.md') // semantic source is unchanged
    expect(viewOnly.resolve?.('data.json')).toBe('/vault/data.json')
    expect(viewOnly.targets.map((target) => target.path)).toEqual(['/vault/data.json', '/vault/deep/report.PDF'])
    expect(candidates.candidates.map((candidate) => candidate.insert)).toEqual(['Note', 'data.json', 'report.PDF'])
    expect('records' in viewOnly).toBe(false)
  })

  it('refreshes the catalog and merged picker on structural view-only events without touching semantic identity', async () => {
    const semantic = response('/vault/Note.md')
    indexFn.mockResolvedValue(semantic)
    mount()
    await flush()
    const semanticResolve = source.resolve
    treeFn.mockResolvedValueOnce(treeResponse(viewNode('/vault/data.json', 'text'), viewNode('/vault/tool.PY', 'text')))
    await emitPastDebounce({ type: 'add', path: '/vault/tool.PY', mtime: 2 })
    expect(treeFn).toHaveBeenCalledTimes(2)
    expect(indexFn).toHaveBeenCalledTimes(1)
    expect(source.records).toBe(semantic.records)
    expect(source.resolve).toBe(semanticResolve)
    expect(viewOnly.resolve?.('tool.py')).toBe('/vault/tool.PY')
    expect(candidates.candidates.map((candidate) => candidate.insert)).toEqual(['Note', 'data.json', 'tool.PY'])
  })
})
