/**
 * The window's Focus and Favorites in App (YAZ-3264 D1): each vault's two lists read when it joins
 * and dropped when it leaves, `stateOf` for the tab menu (S7, S8), and the two toggles with their
 * toasts — the limit (S6), the roll back of a failed write (S13) and the order across vaults (S12).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MAX_FOCUS, defaultAppState, defaultRightPanelIdentity, type AppState, type WindowIdentity } from '@shared/types'
import { storage } from '../lib/storage'
import { useVaultListsHere, type VaultListsHere } from './useVaultListsHere'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** One bridge namespace of a vault list (`favorites` or `focus`): `get` answers from `files`, `set` resolves. */
const listBridge = (files: Record<string, string[]>) => ({
  get: vi.fn(async (root: string): Promise<string[]> => files[root] ?? []),
  set: vi.fn(async (_root: string, _paths: readonly string[]) => undefined),
  onChanged: vi.fn((_listener: (change: { root: string }) => void) => () => undefined),
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
function Probe({ roots }: { roots: readonly string[] }) {
  lists = useVaultListsHere(roots, onNotice)
  return null
}
const here = (): VaultListsHere => {
  if (lists === null) throw new Error('not mounted')
  return lists
}
async function mount(roots: readonly string[]) {
  root = createRoot(document.createElement('div'))
  await act(async () => root?.render(<Probe roots={roots} />))
  return { rerender: (next: readonly string[]) => act(async () => root?.render(<Probe roots={next} />)) }
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
    expect(bridge.focus.get.mock.calls).toEqual([['/a']])
    expect(bridge.favorites.get.mock.calls).toEqual([['/a']])
    // Focus is read, Favorites is not yet: no state, so the tab menu hides both items (S7).
    expect(here().stateOf('/a/f.md')).toBeNull()
    await act(async () => answer?.(['/a/g.md']))
    expect(here().stateOf('/a/f.md')).toEqual({ focus: true, favorite: false })
    expect(here().stateOf('/a/g.md')).toEqual({ focus: false, favorite: true })
    expect(here().stateOf('/elsewhere/n.md')).toBeNull()
    await rerender(['/a', '/b'])
    expect(bridge.focus.get.mock.calls).toEqual([['/a'], ['/b']]) // the vault that stays is not read again
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
    expect(bridge.focus.set.mock.calls).toEqual([['/b', ['/b/x.md']]])
    expect(onNotice).toHaveBeenLastCalledWith('Added to focus', 'info', 'lists')
    expect(storage.getFocusOrder()).toEqual(['/a/f.md', '/b/x.md'])
    expect(here().stateOf('/b/x.md')).toEqual({ focus: true, favorite: false })
    act(() => void here().toggleFocus(['/b/x.md'], true))
    expect(bridge.focus.set.mock.calls[1]).toEqual(['/b', []])
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
    expect(bridge.focus.set.mock.calls).toEqual([['/a', [...full, '/a/new.md']]])
    expect(onNotice.mock.calls).toEqual([[`Focus limit reached: ${MAX_FOCUS} items`, 'error']])
  })

  it('a write that fails puts the list back and toasts the error (S13)', async () => {
    const bridge = installBridge({ '/a': ['/a/f.md'] })
    await storage.init()
    await mount(['/a'])
    bridge.focus.set.mockRejectedValueOnce(new Error('disk full'))
    await act(async () => void here().toggleFocus(['/a/f.md'], true))
    expect(bridge.focus.set.mock.calls).toEqual([['/a', []]])
    expect(onNotice).toHaveBeenLastCalledWith("Can't save focus: disk full", 'error')
    expect(here().focusList).toEqual(['/a/f.md'])
    expect(here().stateOf('/a/f.md')).toEqual({ focus: true, favorite: false })
  })

  it('toggleFavorite writes the vault file and toasts with the favorite glyph', async () => {
    const bridge = installBridge({}, { '/a': ['/a/g.md'] })
    await storage.init()
    await mount(['/a'])
    act(() => here().toggleFavorite(['/a/h.md'], false))
    expect(bridge.favorites.set.mock.calls).toEqual([['/a', ['/a/g.md', '/a/h.md']]])
    expect(onNotice).toHaveBeenLastCalledWith('Added to favorites', 'favorite', 'lists')
    act(() => here().toggleFavorite(['/a/g.md'], true))
    expect(bridge.favorites.set.mock.calls[1]).toEqual(['/a', ['/a/h.md']])
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
