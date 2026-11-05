/**
 * The window's Focus and Favorites in App (YAZ-3264 D1): each vault's two lists read when it joins
 * and dropped when it leaves, `stateOf` for the tab menu (S7, S8), and the two toggles with their
 * toasts — the limit (S6), the roll back of a failed write (S13) and the order across vaults (S12).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MAX_FOCUS, defaultAppState, defaultRightPanelIdentity, type AppState, type ListScope, type WindowIdentity, type WorkspaceLists } from '@shared/types'
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
    expect(bridge.focus.get.mock.calls).toEqual([['/a', 'vault']])
    expect(bridge.favorites.get.mock.calls).toEqual([['/a', 'vault']])
    // Focus is read, Favorites is not yet: no state, so the tab menu hides both items (S7).
    expect(here().stateOf('/a/f.md')).toBeNull()
    await act(async () => answer?.(['/a/g.md']))
    expect(here().stateOf('/a/f.md')).toEqual({ focus: true, favorite: false })
    expect(here().stateOf('/a/g.md')).toEqual({ focus: false, favorite: true })
    expect(here().stateOf('/elsewhere/n.md')).toBeNull()
    await rerender(['/a', '/b'])
    expect(bridge.focus.get.mock.calls).toEqual([['/a', 'vault'], ['/b', 'vault']]) // the vault that stays is not read again
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
    expect(onNotice).toHaveBeenLastCalledWith('Added to focus', 'info', 'lists')
    expect(storage.getFocusOrder()).toEqual(['/a/f.md', '/b/x.md'])
    expect(here().stateOf('/b/x.md')).toEqual({ focus: true, favorite: false })
    act(() => void here().toggleFocus(['/b/x.md'], true))
    expect(bridge.focus.set.mock.calls[1]).toEqual(['/b', [], 'vault'])
    expect(onNotice).toHaveBeenLastCalledWith('Removed from focus', 'info', 'lists')
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
    expect(here().stateOf('/a/f.md')).toEqual({ focus: true, favorite: false })
  })

  it('toggleFavorite writes the vault file and toasts with the favorite glyph', async () => {
    const bridge = installBridge({}, { '/a': ['/a/g.md'] })
    await storage.init()
    await mount(['/a'])
    act(() => here().toggleFavorite(['/a/h.md'], false))
    expect(bridge.favorites.set.mock.calls).toEqual([['/a', ['/a/g.md', '/a/h.md'], 'vault']])
    expect(onNotice).toHaveBeenLastCalledWith('Added to favorites', 'favorite', 'lists')
    act(() => here().toggleFavorite(['/a/g.md'], true))
    expect(bridge.favorites.set.mock.calls[1]).toEqual(['/a', ['/a/h.md'], 'vault'])
    expect(onNotice).toHaveBeenLastCalledWith('Removed from favorites', 'favorite', 'lists')
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
    expect(here().stateOf('/a/own.md')).toEqual({ focus: false, favorite: false })
    await act(async () => void here().toggleFocus(['/b/new.md'], false))
    expect(bridge.focus.set.mock.calls).toEqual([['/b', ['/b/new.md'], 'workspace']])
    await rerender(['/a'])
    expect(here().focusList).toEqual(['/a/own.md'])
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
    expect(bridge.focus.get.mock.calls.slice(-2)).toEqual([['/a', 'workspace'], ['/b', 'workspace']])
    // /a's workspace list is on its way: nothing is held, so a toggle there writes nothing (no own list into the workspace file).
    expect(here().stateOf('/a/own.md')).toBeNull()
    expect(here().toggleFocus(['/a/x.md'], false)).toBe(false)
    expect(bridge.focus.set).not.toHaveBeenCalled()
    await act(async () => answer?.(['/a/ws.md']))
    expect(here().focusList).toEqual(['/a/ws.md'])
  })

  it('a change of the other list is not read; an answer for the scope just left is dropped', async () => {
    const bridge = scopedBridge({ '/a': ['/a/own.md'], '/b': [] }, { '/a': ['/a/ws.md'] })
    await storage.init()
    let late: ((paths: string[]) => void) | undefined
    bridge.focus.get.mockImplementationOnce(() => new Promise((resolve) => (late = resolve)))
    const { rerender } = await mount(['/a', '/b'], ON)
    await rerender(['/a', '/b'], OFF)
    await act(async () => late?.(['/a/stale.md'])) // the workspace answer lands after the flip
    expect(here().focusList).toEqual(['/a/own.md'])
    const heard = bridge.focus.onChanged.mock.calls.at(-1)?.[0]
    const reads = bridge.focus.get.mock.calls.length
    await act(async () => heard?.({ root: '/a', scope: 'workspace' }))
    expect(bridge.focus.get.mock.calls.length).toBe(reads)
    await act(async () => heard?.({ root: '/a', scope: 'vault' }))
    expect(bridge.focus.get.mock.calls.at(-1)).toEqual(['/a', 'vault'])
  })
})
