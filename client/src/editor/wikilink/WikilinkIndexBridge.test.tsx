/**
 * WikilinkIndexBridge: the App-level glue for the stable semantic index source, separate
 * tree-derived view-only source, and their picker-only candidate composition. Tests pin live
 * refresh, source isolation, and root-switch retirement in both async arrival orders.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IndexRecord, IndexResponse, TreeNode, TreeResponse, WatchEvent } from '@shared/types'
import type { WatchListener, WatchSource } from '../../hooks/useWatch'
import { createWikilinkCandidateSource, type MutableWikilinkCandidateSource } from './wikilinkPicker'
import { createWikilinkResolveSource, idLinkTitle, type MutableWikilinkResolveSource } from './wikilinkPlugin'
import { pathTitles } from '../../lib/pageLabel'
import { createViewOnlyLinkSource, type MutableViewOnlyLinkSource } from './viewOnlyLinkSource'
import { WikilinkIndexBridge } from './WikilinkIndexBridge'

vi.mock('../../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api')>()),
  api: { index: vi.fn(), tree: vi.fn(), vaultConfig: { onChange: vi.fn(() => () => undefined) } },
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
    title: name.replace(/\.md$/, ''),
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

const response = (...paths: string[]): IndexResponse => ({ root: '/vault', records: paths.map((p) => rec(p)), folders: [], generatedAt: 1, ids: true })
const viewNode = (path: string, kind: 'text' | 'pdf' | 'image'): TreeNode => ({ type: 'file', name: path.slice(path.lastIndexOf('/') + 1), path, kind, size: 1, mtime: 1 })
const dirNode = (path: string, children: TreeNode[] = []): TreeNode => ({ type: 'dir', name: path.slice(path.lastIndexOf('/') + 1), path, children })
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

function renderBridge(vault = '/vault'): void {
  act(() => root?.render(<WikilinkIndexBridge root={vault} watch={watch} source={source} candidates={candidates} viewOnly={viewOnly} />))
}

function mount(vault = '/vault'): void {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  renderBridge(vault)
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

  it("a folder's settings file refetches like a note and rides `source.folders`, never `records` (YAZ-2290 D8)", async () => {
    mount()
    await flush()
    expect(source.folders).toEqual([])
    const settings = rec('/vault/deep/.folder.md')
    indexFn.mockResolvedValue({ ...response('/vault/Note.md', '/vault/deep/Other.md'), folders: [settings] })
    await emitPastDebounce({ type: 'add', path: settings.path, mtime: 2 })
    expect(source.folders).toEqual([settings])
    expect(source.records.map((r) => r.path)).toEqual(['/vault/Note.md', '/vault/deep/Other.md'])
  })

  it('a save wakes the semantic source once and never the unchanged view-only catalog, while the picker still takes the new records (YAZ-2196 P8)', async () => {
    mount()
    await flush()
    const semanticWake = vi.fn()
    const viewOnlyWake = vi.fn()
    source.subscribe(semanticWake)
    viewOnly.subscribe(viewOnlyWake)
    indexFn.mockResolvedValue({ ...response('/vault/Note.md', '/vault/deep/Other.md'), records: [rec('/vault/Note.md', ['Saved alias']), rec('/vault/deep/Other.md')] })
    await emitPastDebounce({ type: 'change', path: '/vault/Note.md', mtime: 2 })
    expect(semanticWake).toHaveBeenCalledTimes(1)
    expect(viewOnlyWake).not.toHaveBeenCalled()
    expect(candidates.candidates.map((c) => c.label)).toContain('Saved alias — Note')
    expect(candidates.candidates.map((c) => c.insert)).toContain('data.json')
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

  it('the vault’s kind rides the same feed (YAZ-2523): no IDs until the first snapshot, then the snapshot’s `ids` on the source, and `ids` and `ask` to `onSnapshot`', async () => {
    const onSnapshot = vi.fn()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root?.render(<WikilinkIndexBridge root="/vault" watch={watch} source={source} onSnapshot={onSnapshot} />))
    expect(source.ids).toBe(false)
    await flush()
    expect(source.ids).toBe(true)
    expect(onSnapshot).toHaveBeenLastCalledWith(source.records, source.folders, true, undefined)
    const ask = { notes: 2, folders: 1, foreign: 0 }
    indexFn.mockResolvedValue({ ...response('/vault/Note.md'), ids: false, ask })
    await emitPastDebounce({ type: 'change', path: '/vault/Note.md', mtime: 2 })
    expect(source.ids).toBe(false)
    expect(onSnapshot).toHaveBeenLastCalledWith(source.records, source.folders, false, ask)
  })

  it('aliases ride the same feed: the resolver dims nothing for `[[CAC]]` and the picker offers a piped row (E2, GRO-2214)', async () => {
    indexFn.mockResolvedValue({
      root: '/vault',
      records: [rec('/vault/Customer Acquisition Cost.md', ['CAC'])],
      folders: [],
      generatedAt: 1,
      ids: true,
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
    indexFn.mockResolvedValue({ root: '/vault', records: [rec('/vault/Customer Acquisition Cost.md')], folders: [], generatedAt: 2, ids: true })
    await emitPastDebounce({ type: 'change', path: '/vault/Customer Acquisition Cost.md', mtime: 2 })
    expect(source.resolve?.('CAC')).toBeNull()
    expect(candidates.candidates.map((c) => c.label)).toEqual(['Customer Acquisition Cost', 'data.json', 'report.PDF'])
  })

  it('ids ride the same feed (YAZ-2293): nothing resolves before the index is ready, then the id follows its note through a rename and names nothing once it is deleted', async () => {
    const ID = 'k3m9x2pq7abc'
    const withId = (path: string): IndexResponse => ({ root: '/vault', records: [{ ...rec(path), id: ID }, rec('/vault/Zed.md')], folders: [], generatedAt: 1, ids: true })
    indexFn.mockResolvedValue(withId('/vault/Road Map.md'))
    mount()
    expect(source.resolve).toBeNull() // D13: no resolver yet, so an id link has no title to show
    await flush()
    expect(source.resolve?.(ID)).toBe('/vault/Road Map.md')
    expect(source.resolve?.('Road Map')).toBe('/vault/Road Map.md') // D11: the name still resolves

    // C2: renamed and moved outside the app — the next snapshot carries the same id at the new path.
    indexFn.mockResolvedValue(withId('/vault/Archive/Roadmap 2027.md'))
    await emitPastDebounce({ type: 'add', path: '/vault/Archive/Roadmap 2027.md', mtime: 2 })
    expect(source.resolve?.(ID)).toBe('/vault/Archive/Roadmap 2027.md')
    expect(source.resolve?.('Road Map')).toBeNull()

    // C3: deleted — the id resolves to nothing, which is what dims the link.
    indexFn.mockResolvedValue(response('/vault/Zed.md'))
    await emitPastDebounce({ type: 'unlink', path: '/vault/Archive/Roadmap 2027.md' })
    expect(source.resolve?.(ID)).toBeNull()
  })

  it('the picker links a note by its id and a PDF, a text file or an image by its name, as before (YAZ-2293, scenario D12)', async () => {
    indexFn.mockResolvedValue({ root: '/vault', records: [{ ...rec('/vault/Road Map.md', ['Plan']), id: 'k3m9x2pq7abc' }, rec('/vault/Zed.md')], folders: [], generatedAt: 1, ids: true })
    treeFn.mockResolvedValue(treeResponse(viewNode('/vault/data.json', 'text'), viewNode('/vault/deep/report.PDF', 'pdf'), viewNode('/vault/photo.PNG', 'image')))
    mount()
    await flush()
    expect(candidates.candidates.map(({ label, insert }) => [label, insert])).toEqual([
      ['Road Map', 'k3m9x2pq7abc'],
      ['Plan — Road Map', 'k3m9x2pq7abc'],
      ['Zed', 'Zed'],
      ['data.json', 'data.json'],
      ['report.PDF', 'report.PDF'],
      ['photo.PNG', 'photo.PNG'],
    ])
    // A view-only file resolves through its own catalog, by name; the semantic resolver knows it by neither name nor id.
    expect(viewOnly.resolve?.('report.PDF')).toBe('/vault/deep/report.PDF')
    expect(source.resolve?.('report.PDF')).toBeNull()
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

  it('feeds images only through the tree catalog and picker, never through semantic records', async () => {
    treeFn.mockResolvedValueOnce(treeResponse(viewNode('/vault/photo.PNG', 'image')))
    mount()
    await flush()

    expect(source.records.map((record) => record.path)).toEqual(['/vault/Note.md', '/vault/deep/Other.md'])
    expect(source.records.some((record) => record.path === '/vault/photo.PNG')).toBe(false)
    expect(source.resolve?.('photo.PNG')).toBeNull()
    expect(viewOnly.resolve?.('photo.png')).toBe('/vault/photo.PNG')
    expect(viewOnly.targets).toEqual([{ path: '/vault/photo.PNG', name: 'photo.PNG', kind: 'image' }])
    expect(candidates.candidates.map((candidate) => candidate.insert)).toEqual(['Note', 'Other', 'photo.PNG'])
  })

  it('never offers a dead semantic data.json target before the view-only file exists, then offers only the real file', async () => {
    const semantic = response('/vault/data.json.md', '/vault/Note.md')
    indexFn.mockResolvedValue(semantic)
    treeFn.mockResolvedValue(treeResponse())
    mount()
    await flush()
    expect(source.resolve?.('data.json')).toBe('/vault/data.json.md') // semantic feed remains untouched
    expect(candidates.candidates.map((candidate) => candidate.insert)).toEqual(['Note'])

    treeFn.mockResolvedValueOnce(treeResponse(viewNode('/vault/data.json', 'text')))
    await emitPastDebounce({ type: 'add', path: '/vault/data.json', mtime: 2 })
    expect(candidates.candidates.map((candidate) => candidate.insert)).toEqual(['Note', 'data.json'])
    expect(candidates.candidates.find((candidate) => candidate.insert === 'data.json')?.path).toBe('/vault/data.json')
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

  it('clears the old view-only catalog and all merged rows immediately on a root change', async () => {
    mount()
    await flush()
    expect(viewOnly.resolve?.('data.json')).toBe('/vault/data.json')
    expect(candidates.candidates.map((candidate) => candidate.insert)).toContain('data.json')
    const semanticSource = source
    let resolveNextTree!: (response: TreeResponse) => void
    treeFn.mockImplementation((vault) => vault === '/next'
      ? new Promise((resolve) => { resolveNextTree = resolve })
      : Promise.resolve(treeResponse()))
    indexFn.mockImplementation(async (vault) => vault === '/next'
      ? { root: vault, records: [rec('/next/New.md')], folders: [], generatedAt: 2, ids: true }
      : response('/vault/Note.md'))

    renderBridge('/next')
    expect(source).toBe(semanticSource)
    expect(viewOnly.ready).toBe(false)
    expect(viewOnly.resolve).toBeNull()
    expect(viewOnly.targets).toEqual([])
    expect(candidates.candidates).toEqual([])

    await flush()
    expect(source.resolve?.('New')).toBe('/next/New.md')
    expect(candidates.candidates.map((candidate) => candidate.insert)).toEqual(['New'])
    expect(candidates.candidates.map((candidate) => candidate.insert)).not.toContain('data.json')

    resolveNextTree({ root: '/next', tree: [viewNode('/next/tool.py', 'text')], generatedAt: 2 })
    await flush()
    expect(viewOnly.resolve?.('tool.py')).toBe('/next/tool.py')
    expect(candidates.candidates.map((candidate) => candidate.insert)).toEqual(['New', 'tool.py'])
  })

  it('never merges a new root catalog with the previous root semantic snapshot', async () => {
    mount()
    await flush()
    let resolveNextIndex!: (response: IndexResponse) => void
    treeFn.mockImplementation(async (vault) => vault === '/next'
      ? { root: vault, tree: [viewNode('/next/tool.py', 'text')], generatedAt: 2 }
      : treeResponse())
    indexFn.mockImplementation((vault) => vault === '/next'
      ? new Promise((resolve) => { resolveNextIndex = resolve })
      : Promise.resolve(response('/vault/Old.md')))

    renderBridge('/next')
    await flush()
    expect(viewOnly.resolve?.('tool.py')).toBe('/next/tool.py')
    expect(candidates.candidates.map((candidate) => candidate.insert)).toEqual(['tool.py'])
    expect(candidates.candidates.map((candidate) => candidate.insert)).not.toContain('Old')

    resolveNextIndex({ root: '/next', records: [rec('/next/New.md')], folders: [], generatedAt: 2, ids: true })
    await flush()
    expect(candidates.candidates.map((candidate) => candidate.insert)).toEqual(['New', 'tool.py'])
  })

  describe('folders are pages (YAZ-2290 D10): the tree feed\'s folders ride the semantic source', () => {
    // Its own root, with its own tree feed: `/trees` is as long as `/vault`, which `rec` measures by.
    const FOLDER_ID = 'f7n2w8rt4xyz'
    const index = (...paths: string[]): IndexResponse => ({
      root: '/trees',
      records: paths.map((p) => rec(p)),
      folders: [{ ...rec('/trees/Work/Projects/.folder.md'), id: FOLDER_ID, title: 'Client Projects' }],
      generatedAt: 1,
      ids: true,
    })
    const tree = (...extra: TreeNode[]): TreeResponse => ({
      root: '/trees',
      tree: [dirNode('/trees/Note'), dirNode('/trees/Projects'), dirNode('/trees/Work', [dirNode('/trees/Work/Projects')]), ...extra],
      generatedAt: 1,
    })

    beforeEach(() => {
      indexFn.mockResolvedValue(index('/trees/Note.md', '/trees/Work/Plan.md'))
      treeFn.mockResolvedValue(tree())
    })

    it('a link no note answers resolves to the FOLDER of that name — its directory path — and a note of the name still wins', async () => {
      mount('/trees')
      await flush()
      expect(source.resolve?.('Projects')).toBe('/trees/Projects') // the shallowest of the two
      expect(source.resolve?.('Work/Projects')).toBe('/trees/Work/Projects')
      expect(source.resolve?.('Note')).toBe('/trees/Note.md')
      expect(source.resolve?.('Nope')).toBeNull()
    })

    it('the id of a folder\'s settings file resolves to the folder, and an id link shows the folder\'s title', async () => {
      mount('/trees')
      await flush()
      expect(source.resolve?.(FOLDER_ID)).toBe('/trees/Work/Projects')
      expect(idLinkTitle(FOLDER_ID, source.resolve, pathTitles(source.records, source.folders))).toBe('Client Projects')
    })

    it('the picker offers the folders after the notes, each "(folder)": by id when it has one, else by name — not at all when a note holds its path', async () => {
      mount('/trees')
      await flush()
      expect(candidates.candidates.map((c) => c.insert)).toEqual(['Note', 'Plan', 'Projects', 'Work', FOLDER_ID])
      expect(candidates.candidates.map((c) => c.label)).toEqual(['Note', 'Plan', 'Projects (folder)', 'Work (folder)', 'Client Projects (folder)']) // its title (YAZ-2420 D17)
    })

    it('a new folder wakes the editors once and resolves; a tree that moved no folder wakes nobody (YAZ-2196)', async () => {
      mount('/trees')
      await flush()
      const wake = vi.fn()
      source.subscribe(wake)
      await emitPastDebounce({ type: 'addDir', path: '/trees/Elsewhere' }) // the same tree comes back
      expect(wake).not.toHaveBeenCalled()
      treeFn.mockResolvedValue(tree(dirNode('/trees/Empty')))
      await emitPastDebounce({ type: 'addDir', path: '/trees/Empty' })
      expect(wake).toHaveBeenCalledTimes(1)
      expect(source.resolve?.('Empty')).toBe('/trees/Empty') // an EMPTY folder: only the tree knows it
      expect(candidates.candidates.map((c) => c.insert)).toContain('Empty')
    })

    it('a folder list that moved is no index snapshot: `onSnapshot` hears each snapshot once', async () => {
      const onSnapshot = vi.fn()
      container = document.createElement('div')
      document.body.appendChild(container)
      root = createRoot(container)
      act(() => root?.render(<WikilinkIndexBridge root="/trees" watch={watch} source={source} candidates={candidates} viewOnly={viewOnly} onSnapshot={onSnapshot} />))
      await flush()
      expect(onSnapshot).toHaveBeenCalledTimes(1)
      treeFn.mockResolvedValue(tree(dirNode('/trees/Later')))
      await emitPastDebounce({ type: 'addDir', path: '/trees/Later' })
      expect(source.resolve?.('Later')).toBe('/trees/Later')
      expect(onSnapshot).toHaveBeenCalledTimes(1)
    })
  })
})
