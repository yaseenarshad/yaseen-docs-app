/**
 * The window's Focus and Favorites in App (YAZ-3264 D1): each vault's two lists read when it joins
 * and dropped when it leaves, `stateOf` for the tab menu (S7, S8), and the two toggles with their
 * toasts — the limit (S6), the roll back of a failed write (S13) and the order across vaults (S12).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MAX_FOCUS, MAX_FOLDER_ITEMS, defaultAppState, defaultRightPanelIdentity, type AppState, type FocusFolder, type ListScope, type WindowIdentity, type WorkspaceLists } from '@shared/types'
import { storage } from '../lib/storage'
import { useVaultListsHere, type VaultListsHere } from './useVaultListsHere'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** One bridge namespace of a vault list (`favorites` or `focus`): `get` answers from `files`, `set` resolves. */
const listBridge = (files: Record<string, string[]>) => ({
  get: vi.fn(async (root: string, _scope: ListScope): Promise<string[]> => files[root] ?? []),
  set: vi.fn(async (_root: string, _paths: readonly string[], _scope: ListScope) => undefined),
  onChanged: vi.fn((_listener: (change: { root: string; scope: ListScope }) => void) => () => undefined),
})

function installBridge(focus: Record<string, string[]> = {}, favorites: Record<string, string[]> = {}) {
  const bridge = {
    focus: listBridge(focus),
    // The focus folders (YAZ-4460): none unless a test seeds them.
    focusFolders: { get: vi.fn(async (_root: string, _scope?: unknown): Promise<FocusFolder[]> => []), set: vi.fn(async (_root: string, _scope: unknown, _folders: readonly FocusFolder[]) => undefined), onChanged: vi.fn((_listener: (change: { root: string; scope: ListScope }) => void) => () => undefined) },
    favoriteFolders: { get: vi.fn(async (_root: string, _scope?: unknown): Promise<FocusFolder[]> => []), set: vi.fn(async (_root: string, _scope: unknown, _folders: readonly FocusFolder[]) => undefined), onChanged: vi.fn((_listener: (change: { root: string; scope: ListScope }) => void) => () => undefined) },
    favorites: listBridge(favorites),
    state: {
      get: vi.fn(async (): Promise<AppState> => defaultAppState()),
      setFocusOrder: vi.fn(async () => undefined),
      setFavoritesOrder: vi.fn(async () => undefined),
      onChange: vi.fn((_listener: (state: AppState) => void) => () => undefined),
    },
    window: { identity: vi.fn(async (): Promise<WindowIdentity> => ({ id: 'w1', root: '/a', roots: ['/a'], file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'files' })) },
  }
  Object.defineProperty(window, 'yaseenDocs', { value: bridge, configurable: true, writable: true })
  return bridge
}

/** The reads of one scope: the other scope is read too, for the menus' "Show it in" checks (YAZ-4471). */
const readsOf = (get: { mock: { calls: unknown[][] } }, scope: ListScope) => get.mock.calls.filter((call) => call[1] === scope)
/** The undo action every list toast carries since the demo (YAZ-4471). */
const UNDO = expect.objectContaining({ label: 'Undo' })

let root: Root | null = null
let lists: VaultListsHere | null = null
const onNotice = vi.fn()
/** The switches off unless a test says so: the tests above YAZ-4450 are about each vault's own list. */
const OFF: WorkspaceLists = { focus: false, favorites: false }
function Probe({ roots, separate = OFF }: { roots: readonly string[]; separate?: WorkspaceLists }) {
  lists = useVaultListsHere(roots, onNotice, separate)
  return null
}
const here = (): VaultListsHere => {
  if (lists === null) throw new Error('not mounted')
  return lists
}
async function mount(roots: readonly string[], separate?: WorkspaceLists) {
  root = createRoot(document.createElement('div'))
  await act(async () => root?.render(<Probe roots={roots} separate={separate} />))
  return { rerender: (next: readonly string[], nextSeparate = separate) => act(async () => root?.render(<Probe roots={next} separate={nextSeparate} />)) }
}

beforeEach(() => onNotice.mockReset())
afterEach(() => {
  act(() => root?.unmount())
  root = null
  lists = null
})

describe('useVaultListsHere (YAZ-3264 D1)', () => {
  it('reads both lists of a vault that joins and drops them when it leaves; stateOf is null before the read and for a path in no vault (S7, S8)', async () => {
    const bridge = installBridge({ '/a': ['/a/f.md'], '/b': ['/b/x.md'] }, { '/a': ['/a/g.md'] })
    await storage.init()
    let answer: ((paths: string[]) => void) | undefined
    bridge.favorites.get.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)))
    const { rerender } = await mount(['/a'])
    expect(readsOf(bridge.focus.get, 'vault')).toEqual([['/a', 'vault']])
    expect(readsOf(bridge.favorites.get, 'vault')).toEqual([['/a', 'vault']])
    // Focus is read, Favorites is not yet: no state, so the tab menu hides both items (S7).
    expect(here().stateOf('/a/f.md')).toBeNull()
    await act(async () => answer?.(['/a/g.md']))
    expect(here().stateOf('/a/f.md')).toMatchObject({ focus: true, favorite: false })
    expect(here().stateOf('/a/g.md')).toMatchObject({ focus: false, favorite: true })
    expect(here().stateOf('/elsewhere/n.md')).toBeNull()
    await rerender(['/a', '/b'])
    expect(readsOf(bridge.focus.get, 'vault')).toEqual([['/a', 'vault'], ['/b', 'vault']]) // the vault that stays is not read again
    expect(here().focusList).toEqual(['/a/f.md', '/b/x.md'])
    await rerender(['/a'])
    expect(here().focusList).toEqual(['/a/f.md'])
    expect(here().stateOf('/b/x.md')).toBeNull()
    expect(bridge.focus.set).not.toHaveBeenCalled() // a vault that leaves keeps its file
  })

  it('toggleFocus adds to and removes from the list of the vault that holds the path, and toasts; an add with two vaults goes last in the order across vaults (S5, S12)', async () => {
    const bridge = installBridge({ '/a': ['/a/f.md'], '/b': [] })
    await storage.init()
    await mount(['/a', '/b'])
    let acted = false
    act(() => void (acted = here().toggleFocus(['/b/x.md'], false)))
    expect(acted).toBe(true)
    expect(bridge.focus.set.mock.calls).toEqual([['/b', ['/b/x.md'], 'vault']])
    expect(onNotice).toHaveBeenLastCalledWith('Added to focus', 'focus', 'lists', UNDO)
    expect(storage.getFocusOrder()).toEqual(['/a/f.md', '/b/x.md'])
    expect(here().stateOf('/b/x.md')).toMatchObject({ focus: true, favorite: false })
    act(() => void here().toggleFocus(['/b/x.md'], true))
    expect(bridge.focus.set.mock.calls[1]).toEqual(['/b', [], 'vault'])
    expect(onNotice).toHaveBeenLastCalledWith('Removed from focus', 'focus', 'lists', UNDO)
    expect(onNotice).toHaveBeenCalledTimes(2)
  })

  it(`an add past MAX_FOCUS keeps the first ${MAX_FOCUS} and toasts the limit, once (S6)`, async () => {
    const full = Array.from({ length: MAX_FOCUS - 1 }, (_, i) => `/a/${i}.md`)
    const bridge = installBridge({ '/a': full })
    await storage.init()
    await mount(['/a'])
    let acted = false
    act(() => void (acted = here().toggleFocus(['/a/new.md', '/a/past.md'], false)))
    expect(acted).toBe(true)
    expect(bridge.focus.set.mock.calls).toEqual([['/a', [...full, '/a/new.md'], 'vault']])
    expect(onNotice.mock.calls).toEqual([[`Focus limit reached: ${MAX_FOCUS} items`, 'error']])
  })

  it('a write that fails puts the list back and toasts the error (S13)', async () => {
    const bridge = installBridge({ '/a': ['/a/f.md'] })
    await storage.init()
    await mount(['/a'])
    bridge.focus.set.mockRejectedValueOnce(new Error('disk full'))
    await act(async () => void here().toggleFocus(['/a/f.md'], true))
    expect(bridge.focus.set.mock.calls).toEqual([['/a', [], 'vault']])
    expect(onNotice).toHaveBeenLastCalledWith("Can't save focus: disk full", 'error')
    expect(here().focusList).toEqual(['/a/f.md'])
    expect(here().stateOf('/a/f.md')).toMatchObject({ focus: true, favorite: false })
  })

  it('toggleFavorite writes the vault file and toasts with the favorite glyph', async () => {
    const bridge = installBridge({}, { '/a': ['/a/g.md'] })
    await storage.init()
    await mount(['/a'])
    act(() => here().toggleFavorite(['/a/h.md'], false))
    expect(bridge.favorites.set.mock.calls).toEqual([['/a', ['/a/g.md', '/a/h.md'], 'vault']])
    expect(onNotice).toHaveBeenLastCalledWith('Added to favorites', 'favorite', 'lists', UNDO)
    act(() => here().toggleFavorite(['/a/g.md'], true))
    expect(bridge.favorites.set.mock.calls[1]).toEqual(['/a', ['/a/h.md'], 'vault'])
    expect(onNotice).toHaveBeenLastCalledWith('Removed from favorites', 'favorite', 'lists', UNDO)
  })

  it('a toggle before the vault\'s list is read writes nothing and toasts; toggleFocus answers false', async () => {
    const bridge = installBridge()
    await storage.init()
    bridge.focus.get.mockImplementationOnce(() => new Promise(() => undefined))
    bridge.favorites.get.mockImplementationOnce(() => new Promise(() => undefined))
    await mount(['/a'])
    let acted = true
    act(() => void (acted = here().toggleFocus(['/a/f.md'], false)))
    act(() => here().toggleFavorite(['/a/f.md'], false))
    expect(acted).toBe(false)
    expect(onNotice.mock.calls).toEqual([['Focus is still loading. Try again.', 'error'], ['Favorites are still loading. Try again.', 'error']])
    expect(bridge.focus.set).not.toHaveBeenCalled()
    expect(bridge.favorites.set).not.toHaveBeenCalled()
  })
})

describe('the workspace list (YAZ-4450 D2, D4)', () => {
  /** A bridge that answers each scope from its own files, as main does. */
  function scopedBridge(own: Record<string, string[]>, workspace: Record<string, string[]>) {
    const bridge = installBridge()
    for (const kind of ['focus', 'favorites'] as const) bridge[kind].get.mockImplementation(async (vault: string, scope: ListScope) => (scope === 'workspace' ? workspace : own)[vault] ?? [])
    return bridge
  }
  const ON: WorkspaceLists = { focus: true, favorites: true }

  it('a vault alone shows its own lists; two vaults with the switch on show and write each vault\'s workspace list', async () => {
    const bridge = scopedBridge({ '/a': ['/a/own.md'], '/b': ['/b/own.md'] }, { '/a': ['/a/ws.md'] })
    await storage.init()
    const { rerender } = await mount(['/a'], ON)
    expect(here().focusScope).toBe('vault')
    expect(here().focusList).toEqual(['/a/own.md'])
    await rerender(['/a', '/b'])
    expect(here().focusScope).toBe('workspace')
    expect(here().favoritesScope).toBe('workspace')
    expect(here().focusList).toEqual(['/a/ws.md']) // /b has no workspace file: an empty list (D3), never its own
    expect(here().stateOf('/a/own.md')).toMatchObject({ focus: false, favorite: false })
    await act(async () => void here().toggleFocus(['/b/new.md'], false))
    expect(bridge.focus.set.mock.calls).toEqual([['/b', ['/b/new.md'], 'workspace']])
    // The vault the add went to, alone: its own list, without the workspace's add.
    await rerender(['/b'])
    expect(here().focusList).toEqual(['/b/own.md'])
  })

  it('the switch picks the list per tab, and a flip reads each vault again with no list held meanwhile', async () => {
    const bridge = scopedBridge({ '/a': ['/a/own.md'], '/b': [] }, { '/a': ['/a/ws.md'] })
    await storage.init()
    let answer: ((paths: string[]) => void) | undefined
    const { rerender } = await mount(['/a', '/b'], { focus: false, favorites: true })
    expect(here().focusScope).toBe('vault')
    expect(here().favoritesScope).toBe('workspace')
    expect(here().focusList).toEqual(['/a/own.md'])
    bridge.focus.get.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)))
    await rerender(['/a', '/b'], ON)
    expect(readsOf(bridge.focus.get, 'workspace').slice(-2)).toEqual([['/a', 'workspace'], ['/b', 'workspace']])
    // /a's workspace list is on its way: nothing is held, so a toggle there writes nothing (no own list into the workspace file).
    expect(here().stateOf('/a/own.md')).toBeNull()
    expect(here().toggleFocus(['/a/x.md'], false)).toBe(false)
    expect(bridge.focus.set).not.toHaveBeenCalled()
    await act(async () => answer?.(['/a/ws.md']))
    expect(here().focusList).toEqual(['/a/ws.md'])
  })

  it('a change of the other list is read for the menus\' checks (YAZ-4471) and never shown; an answer for the scope just left is dropped', async () => {
    const bridge = scopedBridge({ '/a': ['/a/own.md'], '/b': [] }, { '/a': ['/a/ws.md'] })
    await storage.init()
    let late: ((paths: string[]) => void) | undefined
    bridge.focus.get.mockImplementationOnce(() => new Promise((resolve) => (late = resolve)))
    const { rerender } = await mount(['/a', '/b'], ON)
    await rerender(['/a', '/b'], OFF)
    await act(async () => late?.(['/a/stale.md'])) // the workspace answer lands after the flip
    expect(here().focusList).toEqual(['/a/own.md'])
    // Every listener the hook ever gave the bridge hears each change (the stub's unsubscribe keeps them all).
    const heard = (change: { root: string; scope: ListScope }) => bridge.focus.onChanged.mock.calls.forEach(([listener]) => listener(change))
    const reads = readsOf(bridge.focus.get, 'workspace').length
    await act(async () => heard({ root: '/a', scope: 'workspace' }))
    expect(readsOf(bridge.focus.get, 'workspace').length).toBeGreaterThan(reads)
    expect(here().focusList).toEqual(['/a/own.md'])
    await act(async () => heard({ root: '/a', scope: 'vault' }))
    expect(bridge.focus.get.mock.calls.at(-1)).toEqual(['/a', 'vault'])
  })
})

describe('the folders of a tab (YAZ-4460; demo YAZ-4471, YAZ-4472; ideas YAZ-4470)', () => {
  const ON: WorkspaceLists = { focus: true, favorites: true }
  const roots = ['/x/Notes', '/x/Work']
  const folder = (id: string, items: FocusFolder['items'], extra: Partial<FocusFolder> = {}): FocusFolder => ({ id, name: id, created: 1, at: 1, items, ...extra })
  /** A bridge whose focus folders and lists live in maps by vault and scope, as main keeps them in each vault. */
  function folderBridge(folders: FocusFolder[], scopes: ListScope[] = ['workspace', 'vault']) {
    const bridge = installBridge()
    const held = new Map<string, FocusFolder[]>(roots.flatMap((r) => scopes.map((s) => [`${r}|${s}`, folders] as const)))
    bridge.focusFolders.get.mockImplementation(async (r: string, scope?: unknown) => held.get(`${r}|${String(scope)}`) ?? [])
    bridge.focusFolders.set.mockImplementation(async (r: string, scope: unknown, next: readonly FocusFolder[]) => void held.set(`${r}|${String(scope)}`, [...next]))
    const lists = new Map<string, string[]>()
    bridge.focus.get.mockImplementation(async (r: string, scope: ListScope) => lists.get(`${r}|${scope}`) ?? [])
    bridge.focus.set.mockImplementation(async (r: string, paths: readonly string[], scope: ListScope) => void lists.set(`${r}|${scope}`, [...paths]))
    const live = (r: string, scope: ListScope) => (held.get(`${r}|${scope}`) ?? []).filter((f) => !f.deleted).map((f) => f.id)
    return { bridge, live, list: (r: string, scope: ListScope) => lists.get(`${r}|${scope}`) ?? [] }
  }
  const undo = () => {
    const action = onNotice.mock.lastCall?.[3] as { run: () => void } | undefined
    if (action === undefined) throw new Error('no Undo on the last toast')
    act(() => action.run())
  }
  const items: FocusFolder['items'] = [{ vault: 'Notes', path: 'a.md' }, { vault: 'Work', path: 'b.md' }]

  it('YAZ-4472: a delete reaches both scopes, and "Keep items" puts the items at the top level of each; Undo brings the folder back', async () => {
    const { live, list } = folderBridge([folder('f', items)])
    await storage.init()
    await mount(roots, ON)
    expect(here().focusTab.folders.map((f) => f.id)).toEqual(['f'])
    await act(async () => here().focusTab.remove('f'))
    for (const r of roots) for (const scope of ['workspace', 'vault'] as const) expect(live(r, scope), `${r} ${scope}`).toEqual([])
    for (const scope of ['workspace', 'vault'] as const) {
      expect(list('/x/Notes', scope)).toEqual(['/x/Notes/a.md'])
      expect(list('/x/Work', scope)).toEqual(['/x/Work/b.md'])
    }
    expect(onNotice).toHaveBeenLastCalledWith('Deleted f (focus folder)', 'focus', 'lists', UNDO)
    undo()
    await act(async () => undefined)
    for (const r of roots) for (const scope of ['workspace', 'vault'] as const) expect(live(r, scope), `${r} ${scope}`).toEqual(['f'])
    expect(list('/x/Notes', 'workspace')).toEqual([])
    expect(list('/x/Work', 'vault')).toEqual([])
  })

  it('YAZ-4476: an item in a folder of the other list shows that list as on; a check there never puts it in that list two times, and off takes it out of the folder, with Undo', async () => {
    const { live, list, bridge } = folderBridge([folder('f', items)])
    await storage.init()
    await mount(roots, ON)
    // The folder shows in both lists (workspace and vault), so b.md is in the vault list, inside f.
    expect(here().focusTab.scopesOfFolder('f')).toEqual({ workspace: true, vault: true })
    expect(here().scopesOf('focus', ['/x/Work/b.md']).vault).toBe(true)
    await act(async () => here().setScope('focus', ['/x/Work/b.md'], 'vault', true))
    expect(list('/x/Work', 'vault')).toEqual([])
    await act(async () => here().setScope('focus', ['/x/Work/b.md'], 'vault', false))
    const vaultCopy = () => bridge.focusFolders.set.mock.calls.filter((call) => call[0] === '/x/Work' && call[1] === 'vault').at(-1)?.[2]
    expect(vaultCopy()?.find((f) => f.id === 'f')?.items).toEqual([{ vault: 'Notes', path: 'a.md' }])
    expect(here().scopesOf('focus', ['/x/Work/b.md']).vault).toBe(false)
    expect(live('/x/Work', 'workspace')).toEqual(['f']) // the folder on show keeps it
    undo()
    await act(async () => undefined)
    expect(vaultCopy()?.find((f) => f.id === 'f')?.items).toEqual(items)
    expect(list('/x/Work', 'vault')).toEqual([]) // it was in the folder, not at the top level
  })

  it(`YAZ-4479: a folder holds ${MAX_FOLDER_ITEMS} items at most and says so; at a full top level "Keep items" says what left, and a move out keeps the item in its folder`, async () => {
    const many = Array.from({ length: MAX_FOLDER_ITEMS + 5 }, (_, i) => `/x/Notes/n${i}.md`)
    const full = Array.from({ length: MAX_FOCUS }, (_, i) => `/x/Notes/top${i}.md`)
    const { bridge } = folderBridge([folder('f', [])], ['workspace'])
    bridge.focus.get.mockImplementation(async (r: string, scope: ListScope) => (r === '/x/Notes' && scope === 'workspace' ? full : []))
    await storage.init()
    await mount(roots, ON)
    await act(async () => void here().focusTab.addTo(many, 'f'))
    expect(here().focusTab.folders[0].items).toHaveLength(MAX_FOLDER_ITEMS)
    expect(onNotice).toHaveBeenCalledWith('A folder holds 500 items at most: 5 items stay where they were.', 'error')
    onNotice.mockReset()
    await act(async () => here().focusTab.moveOut('/x/Notes/n0.md'))
    expect(onNotice).toHaveBeenLastCalledWith('Focus limit reached: 500 items. It stays in its folder.', 'error')
    expect(here().focusTab.folderOf('/x/Notes/n0.md')?.id).toBe('f')
    await act(async () => here().focusTab.remove('f'))
    expect(onNotice).toHaveBeenLastCalledWith('Deleted f. Focus limit reached: 500 items, so some of its items left focus.', 'error', undefined, UNDO)
  })

  it('YAZ-4477 (M13, M15): Undo of an add and of a remove in Focus and in Favorites; a folder add names the folder and its kind, a new folder says "a new … folder"', async () => {
    const { bridge, list } = folderBridge([folder('f', [])], ['workspace'])
    const favs = new Map<string, string[]>()
    bridge.favorites.get.mockImplementation(async (r: string, scope: ListScope) => favs.get(`${r}|${scope}`) ?? [])
    bridge.favorites.set.mockImplementation(async (r: string, paths: readonly string[], scope: ListScope) => void favs.set(`${r}|${scope}`, [...paths]))
    await storage.init()
    await mount(roots, ON)
    act(() => void here().toggleFocus(['/x/Notes/a.md'], false))
    expect(list('/x/Notes', 'workspace')).toEqual(['/x/Notes/a.md'])
    undo()
    expect(list('/x/Notes', 'workspace')).toEqual([])
    act(() => void here().toggleFocus(['/x/Notes/a.md'], false))
    act(() => void here().toggleFocus(['/x/Notes/a.md'], true))
    expect(onNotice).toHaveBeenLastCalledWith('Removed from focus', 'focus', 'lists', UNDO)
    undo()
    expect(list('/x/Notes', 'workspace')).toEqual(['/x/Notes/a.md'])
    act(() => here().toggleFavorite(['/x/Work/b.md'], false))
    expect(favs.get('/x/Work|workspace')).toEqual(['/x/Work/b.md'])
    undo()
    expect(favs.get('/x/Work|workspace')).toEqual([])
    act(() => here().toggleFavorite(['/x/Work/b.md'], false))
    act(() => here().toggleFavorite(['/x/Work/b.md'], true))
    undo()
    expect(favs.get('/x/Work|workspace')).toEqual(['/x/Work/b.md'])
    // A folder add: the folder's name and kind, with the eye; a new folder has no name yet.
    await act(async () => void here().focusTab.addTo(['/x/Work/c.md'], 'f'))
    expect(onNotice).toHaveBeenLastCalledWith('Added to f (focus folder)', 'focus', 'lists', UNDO)
    await act(async () => void here().favoritesTab.addTo(['/x/Work/c.md'], null))
    expect(onNotice).toHaveBeenLastCalledWith('Added to a new favorite folder', 'favorite', 'lists', UNDO)
  })

  it('YAZ-4471 M18: "Remove items too" deletes the folder and puts nothing at the top level', async () => {
    const { live, list } = folderBridge([folder('f', items)])
    await storage.init()
    await mount(roots, ON)
    await act(async () => here().focusTab.remove('f', false))
    expect(live('/x/Notes', 'workspace')).toEqual([])
    expect(live('/x/Work', 'vault')).toEqual([])
    expect(list('/x/Notes', 'workspace')).toEqual([])
    expect(list('/x/Work', 'vault')).toEqual([])
  })

  it('YAZ-4470 13: a drag of the folders writes each one whose place changed, with its `pos`; the tab shows the new order', async () => {
    const { bridge } = folderBridge([folder('a', [], { created: 1 }), folder('b', [], { created: 2 })], ['workspace'])
    await storage.init()
    await mount(roots, ON)
    expect(here().focusTab.folders.map((f) => f.id)).toEqual(['a', 'b'])
    await act(async () => here().focusTab.reorderFolders(['b', 'a']))
    expect(here().focusTab.folders.map((f) => [f.id, f.pos])).toEqual([['b', 0], ['a', 1]])
    const last = bridge.focusFolders.set.mock.calls.filter((call) => call[0] === '/x/Notes' && call[1] === 'workspace').at(-1)?.[2]
    expect(last?.map((f) => [f.id, f.pos])).toEqual([['a', 1], ['b', 0]])
  })

  it('YAZ-4470 7: Clear empties the top level of each vault and toasts with Undo, which brings each list back', async () => {
    const { bridge, list } = folderBridge([])
    bridge.focus.get.mockImplementation(async (r: string, scope: ListScope) => (scope === 'workspace' ? [`${r}/top.md`] : []))
    await storage.init()
    await mount(roots, ON)
    expect(here().focusList).toEqual(['/x/Notes/top.md', '/x/Work/top.md'])
    await act(async () => here().clearFocus())
    expect(list('/x/Notes', 'workspace')).toEqual([])
    expect(onNotice).toHaveBeenLastCalledWith('Cleared the top level of Focus', 'focus', 'lists', UNDO)
    undo()
    expect(list('/x/Notes', 'workspace')).toEqual(['/x/Notes/top.md'])
    expect(list('/x/Work', 'workspace')).toEqual(['/x/Work/top.md'])
  })

  it('YAZ-4471 M12, YAZ-4470 8: a folder leaves the list on show for the other, with a toast that says where, and Undo', async () => {
    const { live } = folderBridge([folder('f', items)])
    await storage.init()
    await mount(roots, ON)
    await act(async () => here().focusTab.setFolderScope('f', 'workspace', false))
    expect(live('/x/Notes', 'workspace')).toEqual([])
    expect(live('/x/Notes', 'vault')).toEqual(['f'])
    expect(onNotice).toHaveBeenLastCalledWith('f moved to the vault list', 'focus', 'lists', UNDO)
    undo()
    await act(async () => undefined)
    expect(live('/x/Notes', 'workspace')).toEqual(['f'])
  })
})
