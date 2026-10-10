/**
 * The search bar's index feed (YAZ-803): one `api.index` read per root, refetched on the same
 * structural watch events the sidebar tree refreshes on, ranked per keystroke. The failure case
 * matters most — search degrades to "no rows", never to an error surface.
 *
 * Since F1 finding 1 (YAZ-808) the feed is LAZY: an untouched bar reads no index and subscribes
 * to nothing — the always-on feed is WikilinkIndexBridge's — and the first non-empty query
 * latches it on for good. Both halves are asserted here, subscription included.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StrictMode, act, useMemo } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IndexRecord, WatchEvent } from '@shared/types'
import type { WatchSource } from '../hooks/useWatch'

/**
 * What the hook asks of `searchCandidates.ts`, counted (YAZ-2602 R2): the REAL functions behind
 * recording wrappers, so a test can say what a keystroke, a snapshot and a tree each cost.
 */
const asked = vi.hoisted(() => ({ ranked: [] as number[], first: [] as (ReadonlySet<string> | undefined)[], notes: [] as unknown[], folders: [] as string[], files: [] as string[] }))
vi.mock('./searchCandidates', async (importOriginal) => {
  const real = await importOriginal<typeof import('./searchCandidates')>()
  const searchRows: typeof real.searchRows = (candidates, query, first) => {
    asked.ranked.push(candidates.length)
    asked.first.push(first)
    return real.searchRows(candidates, query, first)
  }
  const searchCandidates: typeof real.searchCandidates = (records) => {
    asked.notes.push(records)
    return real.searchCandidates(records)
  }
  const folderCandidates: typeof real.folderCandidates = (root, dirs, folders) => {
    asked.folders.push(root)
    return real.folderCandidates(root, dirs, folders)
  }
  const fileCandidates: typeof real.fileCandidates = (root, files) => {
    asked.files.push(root)
    return real.fileCandidates(root, files)
  }
  return { ...real, searchRows, searchCandidates, folderCandidates, fileCandidates }
})

import { useSearchResults, type SearchVault } from './useSearchResults'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const rec = (basename: string, folder = ''): IndexRecord => ({
  path: `/v/${folder === '' ? '' : `${folder}/`}${basename}.md`,
  name: `${basename}.md`,
  basename,
  title: basename,
  folder,
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

function installBridge(records: IndexRecord[], folders: IndexRecord[]) {
  const bridge = { index: vi.fn(async (root: string) => ({ root, records, folders, generatedAt: 1, ids: true })) }
  Object.defineProperty(window, 'yaseenDocs', { value: bridge, configurable: true, writable: true })
  return bridge
}

let reactRoot: Root | null = null
let container: HTMLElement | null = null
/** The rendered rows' labels — the hook's whole output, flattened for assertions. */
const labels = () => (container?.textContent === '' ? [] : (container?.textContent ?? '').split('|').filter((s) => s !== ''))

/** The Sidebar's own `dirs` (🔒 D1, YAZ-1491): folder rows need no index read at all. */
const NO_DIRS: readonly string[] = []
/** The Sidebar's own `files` (🔒 D3, YAZ-2620): the tree's files that are no notes, and no index read either. */
const NO_FILES: readonly string[] = []
/** No pinned item (YAZ-2662 D4): the ranking of before. */
const NO_PINNED: ReadonlySet<string> = new Set()

function Harness({ watch, query, dirs = NO_DIRS, files = NO_FILES }: { watch: WatchSource; query: string; dirs?: readonly string[]; files?: readonly string[] }) {
  // The window's one vault, as the Sidebar hands it: the same list while nothing in it changed.
  const results = useSearchResults(useMemo(() => [{ root: '/v', watch, dirs, files }], [watch, dirs, files]), query, NO_PINNED)
  return <>{results.map((r) => `${r.kind === 'dir' ? '📁' : ''}${r.label}|`)}</>
}

async function mount(records: IndexRecord[], query: string, tweak?: (bridge: ReturnType<typeof installBridge>) => void, dirs: readonly string[] = NO_DIRS, folders: IndexRecord[] = [], files: readonly string[] = NO_FILES) {
  const bridge = installBridge(records, folders)
  tweak?.(bridge) // before the first render: the mount read is the one that can fail
  // A real fan-out watch (useWatch's shape), so "did search subscribe at all?" is answerable.
  const listeners: ((ev: WatchEvent) => void)[] = []
  const subscribe = vi.fn((l: (ev: WatchEvent) => void) => {
    listeners.push(l)
    return () => listeners.splice(listeners.indexOf(l), 1)
  })
  const watch: WatchSource = { subscribe }
  container = document.createElement('div')
  document.body.appendChild(container)
  reactRoot = createRoot(container)
  await act(async () => reactRoot?.render(<StrictMode><Harness watch={watch} query={query} dirs={dirs} files={files} /></StrictMode>))
  const rerender = async (q: string) => act(async () => reactRoot?.render(<StrictMode><Harness watch={watch} query={q} dirs={dirs} files={files} /></StrictMode>))
  const emit = (ev: WatchEvent) => [...listeners].forEach((l) => l(ev))
  /** An event, then past the 100 ms quiet window a structural burst waits out (YAZ-2191). */
  const fire = async (ev: WatchEvent) => {
    await act(async () => emit(ev))
    await act(() => new Promise<void>((r) => setTimeout(r, 150)))
  }
  return { bridge, rerender, fire, emit, subscribe }
}

afterEach(() => {
  act(() => reactRoot?.unmount())
  reactRoot = null
  container?.remove()
  container = null
  delete (window as unknown as Record<string, unknown>).yaseenDocs
  vi.restoreAllMocks()
})

describe('useSearchResults (YAZ-803)', () => {
  it('reads the index for a query it already has and ranks it against that query', async () => {
    const { bridge } = await mount([rec('Meeting notes'), rec('Other')], 'meet')
    expect(bridge.index).toHaveBeenCalledWith('/v')
    expect(labels()).toEqual(['Meeting notes'])
  })

  it('an untouched bar reads NO index and subscribes to NOTHING; the first non-empty query does both (YAZ-808)', async () => {
    const { bridge, subscribe, rerender } = await mount([rec('Alpha')], '')
    expect(bridge.index).not.toHaveBeenCalled()
    expect(subscribe).not.toHaveBeenCalled()
    await rerender('   ') // whitespace is still no query
    expect(bridge.index).not.toHaveBeenCalled()
    expect(subscribe).not.toHaveBeenCalled()
    await rerender('a')
    expect(bridge.index).toHaveBeenCalledWith('/v')
    expect(subscribe).toHaveBeenCalled()
    expect(labels()).toEqual(['Alpha'])
  })

  it('the feed stays once activated: clearing the query refetches nothing, and a structural event still lands', async () => {
    const { bridge, rerender, fire } = await mount([rec('Alpha')], '')
    await rerender('a')
    bridge.index.mockClear()
    await rerender('') // back to no query: the records stay, nothing is refetched
    expect(bridge.index).not.toHaveBeenCalled()
    bridge.index.mockResolvedValue({ root: '/v', records: [rec('Alpha'), rec('Anchor')], folders: [], generatedAt: 2, ids: true })
    await fire({ type: 'add', path: '/v/Anchor.md', mtime: 1 }) // still subscribed while the bar is empty
    await rerender('a')
    expect(labels()).toEqual(['Alpha', 'Anchor'])
  })

  it('a structural watch event refetches the index; the new snapshot is searchable', async () => {
    const { bridge, fire } = await mount([rec('Alpha')], 'a')
    bridge.index.mockResolvedValue({ root: '/v', records: [rec('Alpha'), rec('Anchor')], folders: [], generatedAt: 2, ids: true })
    await fire({ type: 'add', path: '/v/Anchor.md', mtime: 1 })
    expect(labels()).toEqual(['Alpha', 'Anchor'])
  })

  it('a structural burst is one index read at once and ONE more, 100 ms after its last event; `ready` reads at once (YAZ-2240)', async () => {
    const { bridge, emit } = await mount([rec('Alpha')], 'a')
    bridge.index.mockClear()
    act(() => {
      for (let i = 0; i < 40; i++) emit({ type: 'add', path: `/v/pulled-${i}.md`, mtime: 1 })
    })
    expect(bridge.index).toHaveBeenCalledTimes(1) // the leading read
    await act(() => new Promise<void>((r) => setTimeout(r, 60)))
    expect(bridge.index).toHaveBeenCalledTimes(1)
    await act(() => new Promise<void>((r) => setTimeout(r, 90)))
    expect(bridge.index).toHaveBeenCalledTimes(2) // the trailing read
    act(() => emit({ type: 'ready', root: '/v' }))
    expect(bridge.index).toHaveBeenCalledTimes(3)
  })

  it('a lone structural event reads the index at once, and nothing follows it (YAZ-2240)', async () => {
    const { bridge, emit } = await mount([rec('Alpha')], 'a')
    bridge.index.mockClear()
    act(() => emit({ type: 'add', path: '/v/Anchor.md', mtime: 1 }))
    expect(bridge.index).toHaveBeenCalledTimes(1)
    await act(() => new Promise<void>((r) => setTimeout(r, 150)))
    expect(bridge.index).toHaveBeenCalledTimes(1)
  })

  it('a stale answer is never applied over a newer one (YAZ-2191)', async () => {
    const { bridge, emit } = await mount([rec('Alpha')], 'a')
    let answerOld!: () => void
    bridge.index.mockImplementationOnce((root: string) => new Promise((r) => (answerOld = () => r({ root, records: [rec('Alpha')], folders: [], generatedAt: 2, ids: true }))))
    bridge.index.mockResolvedValueOnce({ root: '/v', records: [rec('Alpha'), rec('Anchor')], folders: [], generatedAt: 3, ids: true })
    act(() => emit({ type: 'ready', root: '/v' }))
    await act(async () => emit({ type: 'ready', root: '/v' }))
    expect(labels()).toEqual(['Alpha', 'Anchor'])
    await act(async () => answerOld())
    expect(labels()).toEqual(['Alpha', 'Anchor'])
  })

  it('a plain `change` event refetches nothing — a body edit cannot change a title', async () => {
    const { bridge, fire } = await mount([rec('Alpha')], 'a')
    bridge.index.mockClear()
    await fire({ type: 'change', path: '/v/Alpha.md', mtime: 2 })
    expect(bridge.index).not.toHaveBeenCalled()
  })

  it('an empty or whitespace query yields no rows at all (the shared matcher would match everything)', async () => {
    const { rerender } = await mount([rec('Alpha'), rec('Beta')], '')
    expect(labels()).toEqual([])
    await rerender('   ')
    expect(labels()).toEqual([])
    await rerender('a')
    expect(labels()).toEqual(['Alpha', 'Beta'])
  })

  it('the tree\'s folders are rows too, ahead of a same-rank note (🔒 D1, YAZ-1491)', async () => {
    await mount([rec('Archive'), rec('Archived plan')], 'archive', undefined, ['/v/Archive', '/v/Archive/Old'])
    // Exact bucket: the folder sits above the note; prefix bucket: the note; `Old` never matches.
    expect(labels()).toEqual(['📁Archive', 'Archive', 'Archived plan'])
  })

  it("D: an id in the bar is that note alone, and a folder's id that folder, read off the index's folder records (YAZ-2420 D32)", async () => {
    const records = [{ ...rec('up-001-abdul-k3m9x2pq7abc'), title: 'UP-001 - Abdul', id: 'k3m9x2pq7abc' }, rec('Archive')]
    const folders = [{ ...rec('.folder', 'Archive'), title: 'Archive', id: 'f7n2w8rt4xyz' }]
    const { rerender } = await mount(records, '[[k3m9x2pq7abc]]', undefined, ['/v/Archive'], folders)
    expect(labels()).toEqual(['UP-001 - Abdul'])
    await rerender('/v/Archive/f7n2w8rt4xyz')
    expect(labels()).toEqual(['📁Archive'])
  })

  it('folder rows survive an unreadable index — they come from the tree, not the feed', async () => {
    await mount([rec('Alpha')], 'arch', (b) => b.index.mockRejectedValue(new Error('no index')), ['/v/Archive'])
    expect(labels()).toEqual(['📁Archive'])
  })

  it('S12: the tree\'s files that are no notes are rows too, by file name — behind a folder and a note of the same rank (🔒 D3, YAZ-2620)', async () => {
    await mount([rec('Transcript')], 'transcript', undefined, ['/v/transcript'], [], ['/v/skills/transcript', '/v/skills/get-transcript.py'])
    // Exact bucket: folder, note, then the file with no extension; substring bucket: the script.
    expect(labels()).toEqual(['📁transcript', 'Transcript', 'transcript', 'get-transcript.py'])
  })

  it('S35: folders and files that are no notes survive an index that is not loaded or cannot be read — both come from the tree; the notes arrive with the index', async () => {
    const { bridge, fire } = await mount([rec('Archive notes')], 'arch', (b) => b.index.mockRejectedValue(new Error('no index')), ['/v/Archive'], [], ['/v/archive.zip'])
    expect(labels()).toEqual(['📁Archive', 'archive.zip'])
    bridge.index.mockResolvedValue({ root: '/v', records: [rec('Archive notes')], folders: [], generatedAt: 2, ids: true })
    await fire({ type: 'add', path: '/v/Archive notes.md', mtime: 1 })
    expect(labels()).toEqual(['📁Archive', 'Archive notes', 'archive.zip'])
  })

  it('an unreadable index leaves search empty rather than throwing or surfacing anything', async () => {
    const { fire } = await mount([rec('Alpha')], 'a', (b) => b.index.mockRejectedValue(new Error('no index')))
    expect(labels()).toEqual([])
    await fire({ type: 'add', path: '/v/Beta.md', mtime: 1 }) // …and a refetch that fails again is just as quiet
    expect(labels()).toEqual([])
  })
})

/**
 * The search over every vault of the window (YAZ-2602 R2, S38): one list, one ranking per
 * keystroke however many vaults, and each vault read and rebuilt on its own.
 */
describe('useSearchResults with pinned items (YAZ-2662 D4, R1)', () => {
  const DIRS: readonly string[] = ['/v/Pinned', '/v/Pinned/Sub']
  const WATCH: WatchSource = { subscribe: () => () => undefined }
  function Pinned({ query, pinned }: { query: string; pinned: ReadonlySet<string> }) {
    const results = useSearchResults(useMemo(() => [{ root: '/v', watch: WATCH, dirs: DIRS, files: NO_FILES }], []), query, pinned)
    return <>{results.map((r) => `${r.label}|`)}</>
  }

  it('the matches that are a pinned item or are inside one lead the ranking; the set of those rows is built when the rows or the pinned paths change, and never on a keystroke', async () => {
    installBridge([rec('Plan'), rec('Old plan', 'Pinned'), rec('Plan deep', 'Pinned/Sub')], [])
    container = document.createElement('div')
    document.body.appendChild(container)
    reactRoot = createRoot(container)
    const render = (query: string, pinned: ReadonlySet<string>) => act(async () => reactRoot?.render(<StrictMode><Pinned query={query} pinned={pinned} /></StrictMode>))
    const folder = new Set(['/v/Pinned'])
    await render('plan', folder)
    expect(labels()).toEqual(['Plan deep', 'Old plan', 'Plan']) // `Plan` is the exact name, and is not pinned
    // The rows of the top group: the pinned folder, and each folder and note inside it.
    const first = asked.first.at(-1)
    expect(first).toEqual(new Set(['/v/Pinned', '/v/Pinned/Sub', '/v/Pinned/Old plan.md', '/v/Pinned/Sub/Plan deep.md']))
    asked.first.length = 0
    await render('pla', folder)
    await render('pl', folder)
    expect(asked.first.length).toBeGreaterThan(0)
    expect(asked.first.every((set) => set === first)).toBe(true)
    // A list changed: a new set. No pinned item: nothing to look in, and the ranking of before.
    await render('pl', new Set(['/v/Plan.md']))
    expect(asked.first.at(-1)).toEqual(new Set(['/v/Plan.md']))
    await render('plan', new Set())
    expect(asked.first.at(-1)?.size).toBe(0)
    expect(labels()).toEqual(['Plan', 'Plan deep', 'Old plan'])
  })
})

describe('useSearchResults over several vaults (YAZ-2602 R2)', () => {
  const at = (root: string, basename: string): IndexRecord => ({ ...rec(basename), path: `${root}/${basename}.md` })
  function Many({ vaults, query }: { vaults: readonly SearchVault[]; query: string }) {
    const results = useSearchResults(vaults, query, NO_PINNED)
    return <>{results.map((r) => `${r.kind === 'dir' ? '📁' : ''}${r.path}|`)}</>
  }
  /** A vault with its own fan-out watcher, so a test can say which vault's watcher spoke and which subscriptions ended. */
  const vault = (root: string, dirs: readonly string[] = NO_DIRS, files: readonly string[] = NO_FILES) => {
    const listeners = new Set<(ev: WatchEvent) => void>()
    const counts = { subscribed: 0, ended: 0 }
    const watch: WatchSource = {
      subscribe: (l) => {
        counts.subscribed++
        listeners.add(l)
        return () => {
          counts.ended++
          listeners.delete(l)
        }
      },
    }
    return { root, watch, dirs, files, counts, fire: (ev: WatchEvent) => [...listeners].forEach((l) => l(ev)) }
  }
  const only = ({ root, watch, dirs, files }: SearchVault): SearchVault => ({ root, watch, dirs, files })
  async function mountMany(byRoot: Record<string, IndexRecord[]>, vaults: readonly SearchVault[], query: string) {
    const bridge = { index: vi.fn(async (root: string) => ({ root, records: byRoot[root] ?? [], folders: [], generatedAt: 1, ids: true })) }
    Object.defineProperty(window, 'yaseenDocs', { value: bridge, configurable: true, writable: true })
    container = document.createElement('div')
    document.body.appendChild(container)
    reactRoot = createRoot(container)
    const render = (list: readonly SearchVault[], q: string) => act(async () => reactRoot?.render(<StrictMode><Many vaults={list} query={q} /></StrictMode>))
    await render(vaults, query)
    return { bridge, render }
  }
  const forget = () => {
    asked.ranked.length = 0
    asked.notes.length = 0
    asked.folders.length = 0
    asked.files.length = 0
  }
  const afterQuiet = () => act(() => new Promise<void>((r) => setTimeout(r, 150)))

  it('one ranked list over every vault: a better match of a later vault leads, and a folder leads a note it ties with inside its own vault', async () => {
    const [a, b] = [vault('/a', ['/a/Plan']), vault('/b')]
    await mountMany({ '/a': [at('/a', 'Old plan'), at('/a', 'Plan')], '/b': [at('/b', 'Plan B')] }, [only(a), only(b)], 'plan')
    expect(labels()).toEqual(['📁/a/Plan', '/a/Plan.md', '/b/Plan B.md', '/a/Old plan.md'])
  })

  it('a keystroke is ONE ranking of ONE list, with one vault and with three: it reads no index and rebuilds no row; the list is the sum of the vaults\' rows', async () => {
    const notes = (root: string) => [at(root, 'Alpha'), at(root, 'Beta')]
    const one = [only(vault('/a', ['/a/dir']))]
    const single = await mountMany({ '/a': notes('/a') }, one, 'a')
    forget()
    single.bridge.index.mockClear()
    await single.render(one, 'al')
    const perKey = { ranked: [...asked.ranked], rebuilt: asked.notes.length + asked.folders.length, read: single.bridge.index.mock.calls.length }
    expect(perKey.rebuilt).toBe(0)
    expect(perKey.read).toBe(0)
    expect(new Set(perKey.ranked)).toEqual(new Set([3])) // the vault's one folder and two notes
    act(() => reactRoot?.unmount())
    container?.remove()

    const three = [only(vault('/a', ['/a/dir'])), only(vault('/b', ['/b/dir'])), only(vault('/c', ['/c/dir']))]
    const many = await mountMany({ '/a': notes('/a'), '/b': notes('/b'), '/c': notes('/c') }, three, 'a')
    expect(many.bridge.index.mock.calls.map(([root]) => root).sort()).toEqual(['/a', '/b', '/c'])
    forget()
    many.bridge.index.mockClear()
    await many.render(three, 'al')
    // The same number of rankings as with one vault, each over the one list of all three.
    expect(asked.ranked).toHaveLength(perKey.ranked.length)
    expect(new Set(asked.ranked)).toEqual(new Set([9]))
    expect(asked.notes.length + asked.folders.length).toBe(0)
    expect(many.bridge.index).not.toHaveBeenCalled()
    expect(labels()).toEqual(['/a/Alpha.md', '/b/Alpha.md', '/c/Alpha.md'])
  })

  it('a vault\'s watcher re-reads that vault alone and rebuilds its rows alone; a tree of one vault rebuilds that vault\'s folder rows alone and reads nothing', async () => {
    const [a, b] = [vault('/a', ['/a/dir']), vault('/b', ['/b/dir'])]
    const byRoot = { '/a': [at('/a', 'Alpha')], '/b': [at('/b', 'Beta')] }
    const list = [only(a), only(b)]
    const { bridge, render } = await mountMany(byRoot, list, 'a')
    expect(labels()).toEqual(['/a/Alpha.md', '/b/Beta.md'])
    forget()
    bridge.index.mockClear()
    const next = [at('/b', 'Beta'), at('/b', 'Banana')]
    byRoot['/b'] = next
    await act(async () => b.fire({ type: 'add', path: '/b/Banana.md', mtime: 1 }))
    await afterQuiet()
    expect(new Set(bridge.index.mock.calls.map(([root]) => root))).toEqual(new Set(['/b']))
    // A snapshot brings new records and new folder records, as it does with one vault: `/b`'s rows, and no row of `/a`.
    expect(new Set(asked.notes)).toEqual(new Set([next]))
    expect(new Set(asked.folders)).toEqual(new Set(['/b']))
    expect(labels()).toEqual(['/a/Alpha.md', '/b/Beta.md', '/b/Banana.md'])

    forget()
    bridge.index.mockClear()
    // The Sidebar's list after a tree of `/a` landed: a new list, `/a` with new folders, `/b` as it was.
    await render([{ ...only(a), dirs: ['/a/dir', '/a/arch'] }, list[1]], 'a')
    expect(new Set(asked.folders)).toEqual(new Set(['/a']))
    expect(asked.notes).toEqual([])
    expect(bridge.index).not.toHaveBeenCalled()
    expect([a.counts, b.counts]).toEqual([{ subscribed: 1, ended: 0 }, { subscribed: 1, ended: 0 }])
    expect(labels()).toEqual(['📁/a/arch', '/a/Alpha.md', '/b/Beta.md', '/b/Banana.md'])
  })

  it('the files that are no notes are rows of their own vault, behind its notes, in the one ranking; a keystroke rebuilds none of them, and a tree that changed one vault\'s files rebuilds that vault\'s file rows alone (YAZ-2620 D3, A9)', async () => {
    const [a, b] = [vault('/a', ['/a/plan'], ['/a/plan', '/a/sub/plan.pdf']), vault('/b', NO_DIRS, ['/b/Plan'])]
    const list = [only(a), only(b)]
    const { bridge, render } = await mountMany({ '/a': [at('/a', 'Plan')], '/b': [at('/b', 'Plan B')] }, list, 'plan')
    // Exact names first — folder, note, other file inside a vault, then the next vault's — then the names that start with the text.
    expect(labels()).toEqual(['📁/a/plan', '/a/Plan.md', '/a/plan', '/b/Plan', '/a/sub/plan.pdf', '/b/Plan B.md'])
    forget()
    bridge.index.mockClear()
    await render(list, 'plan.')
    expect(labels()).toEqual(['/a/sub/plan.pdf'])
    expect(asked.ranked.length).toBeGreaterThan(0)
    expect(new Set(asked.ranked)).toEqual(new Set([6])) // one list: 1 folder, 2 notes, 3 other files
    expect(asked.files.length + asked.notes.length + asked.folders.length).toBe(0)

    // The Sidebar's list after a tree of `/b` landed with a new file: `/b`'s file rows, no row of `/a`, no read.
    await render([list[0], { ...only(b), files: ['/b/Plan', '/b/plan.png'] }], 'plan.')
    expect(new Set(asked.files)).toEqual(new Set(['/b']))
    expect(asked.notes.length + asked.folders.length).toBe(0)
    expect(bridge.index).not.toHaveBeenCalled()
    expect(labels()).toEqual(['/a/sub/plan.pdf', '/b/plan.png'])
  })

  it('a vault that joins is read once and the vault that stays is not read again; a vault that leaves ends its subscription and takes its rows', async () => {
    const [a, b] = [vault('/a'), vault('/b')]
    const { bridge, render } = await mountMany({ '/a': [at('/a', 'Alpha')], '/b': [at('/b', 'Alpha')] }, [only(a)], 'alpha')
    expect(labels()).toEqual(['/a/Alpha.md'])
    bridge.index.mockClear()
    await render([only(a), only(b)], 'alpha')
    expect(bridge.index.mock.calls).toEqual([['/b']])
    expect(labels()).toEqual(['/a/Alpha.md', '/b/Alpha.md'])
    await render([only(b)], 'alpha')
    expect(labels()).toEqual(['/b/Alpha.md'])
    expect([a.counts, b.counts]).toEqual([{ subscribed: 1, ended: 1 }, { subscribed: 1, ended: 0 }])
    expect(bridge.index).toHaveBeenCalledTimes(1)
  })
})
