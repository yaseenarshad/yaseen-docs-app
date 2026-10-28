import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, MAX_COLLAPSED_GROUP_KEYS, MAX_FOLD_KEYS_PER_FILE, addRecentRoot, defaultAppState, defaultFolderState, defaultRightPanelIdentity, listVaults, openVaultRoots, type AppState, type WindowEntry, type WindowIdentity } from '@shared/types'
import { storage } from './storage'
import { hashFilePath } from './urlHash'

/** A fake `window.yaseenDocs` with just the state / window halves the storage module talks to. */
type IdentityFixture = Omit<WindowIdentity, 'roots' | 'rightPanel' | 'sidebarCollapsed' | 'sidebarLens'> & Partial<Pick<WindowIdentity, 'roots' | 'rightPanel' | 'sidebarCollapsed' | 'sidebarLens'>>

function installBridge(state: AppState, identity: IdentityFixture) {
  let listener: ((s: AppState) => void) | null = null
  const bridge = {
    state: {
      get: vi.fn(async () => state),
      setSettings: vi.fn(async () => undefined),
      setSidebarWidth: vi.fn(async () => undefined),
      setFavoritesOrder: vi.fn(async () => undefined),
      setFocusOrder: vi.fn(async () => undefined),
      pushRecent: vi.fn(async () => undefined),
      removeRecent: vi.fn(async () => undefined),
      setFolder: vi.fn(async () => undefined),
      setFolds: vi.fn(async () => undefined),
      setTocSource: vi.fn(async () => undefined),
      setSectionIndent: vi.fn(async () => undefined),
      setTocSwitch: vi.fn(async () => undefined),
      setBaseGroups: vi.fn(async () => undefined),
      setTabCanvas: vi.fn(async () => undefined),
      onChange: vi.fn((l: (s: AppState) => void) => {
        listener = l
        return () => {
          if (listener === l) listener = null
        }
      }),
    },
    window: {
      identity: vi.fn(async (): Promise<WindowIdentity> => ({
        ...identity,
        roots: identity.roots ?? (identity.root === null ? [] : [identity.root]),
        rightPanel: identity.rightPanel ?? defaultRightPanelIdentity(),
        sidebarCollapsed: identity.sidebarCollapsed ?? false,
        sidebarLens: identity.sidebarLens ?? 'favorites',
      })),
      setIdentity: vi.fn(async () => undefined),
      setName: vi.fn(async () => undefined),
      open: vi.fn(),
      duplicate: vi.fn(),
    },
  }
  Object.defineProperty(window, 'yaseenDocs', { value: bridge, configurable: true, writable: true })
  return { bridge, emit: (s: AppState) => listener?.(s), hasListener: () => listener !== null }
}

const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0))

let b: ReturnType<typeof installBridge>
beforeEach(async () => {
  b = installBridge(defaultAppState(), { id: 'w1', root: null, file: null, tabs: [], sidebarCollapsed: false })
  await storage.init()
})
afterEach(() => {
  delete (window as unknown as Record<string, unknown>).yaseenDocs
  vi.restoreAllMocks()
})

describe('addRecentRoot', () => {
  it('prepends, de-dupes and caps at 10', () => {
    let list = addRecentRoot([], '/a', 1)
    list = addRecentRoot(list, '/b', 2)
    list = addRecentRoot(list, '/a', 3)
    expect(list).toEqual([
      { path: '/a', lastOpened: 3 },
      { path: '/b', lastOpened: 2 },
    ])
    for (let i = 0; i < 20; i++) list = addRecentRoot(list, `/x${i}`, 10 + i)
    expect(list).toHaveLength(10)
    expect(list[0].path).toBe('/x19')
  })
})

describe('openVaultRoots (YAZ-2555 D1)', () => {
  it('is each window\'s root in window order, once per vault — a trailing slash off, never off "/" — with Welcome windows left out', () => {
    expect(openVaultRoots([{ roots: ['/v/b'] }, { roots: [] }, { roots: ['/v/a/'] }, { roots: ['/v/b/'] }, { roots: ['/v/a'] }, { roots: ['/'] }])).toEqual(['/v/b', '/v/a', '/'])
    expect(openVaultRoots([{ roots: [] }])).toEqual([])
  })
})

describe('listVaults (YAZ-2556 D2: the one vault list of ⌘O and `yaseendocs vaults`)', () => {
  const win = (id: string, root: string | null): WindowEntry => ({ id, root, roots: root === null ? [] : [root], file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'files', bounds: { x: 0, y: 0, width: 800, height: 600 } })

  it('is the recents, last used first, then the open vaults and the numbered ones (in number order) that are not among them — each by its display name, else its folder name', () => {
    const vaults = listVaults({
      recents: [{ path: '/v/b', lastOpened: 30 }, { path: '/v/a', lastOpened: 20 }],
      windows: [win('w1', '/v/c/'), win('w2', null), win('w3', '/v/a'), win('w4', '/v/c')],
      folders: {
        '/v/a': { ...defaultFolderState(), name: 'Alpha', key: 2 },
        '/v/e': { ...defaultFolderState(), key: 9 },
        '/v/d': { ...defaultFolderState(), name: 'Delta', key: 1 },
        '/v/x': { ...defaultFolderState(), name: 'A folder that is no vault now: not recent, not open, no number' },
      },
    })
    expect(vaults).toEqual([
      { path: '/v/b', name: 'b', key: null, open: false, lastUsed: 30 },
      { path: '/v/a', name: 'Alpha', key: 2, open: true, lastUsed: 20 },
      { path: '/v/c', name: 'c', key: null, open: true, lastUsed: null },
      { path: '/v/d', name: 'Delta', key: 1, open: false, lastUsed: null },
      { path: '/v/e', name: 'e', key: 9, open: false, lastUsed: null },
    ])
    expect(Object.keys(vaults[0])).toEqual(['path', 'name', 'key', 'open', 'lastUsed']) // the order `--json` prints
  })

  it('a state with no vault is an empty list', () => {
    expect(listVaults({ ...defaultAppState(), windows: [win('w1', null)] })).toEqual([])
  })
})

describe('storage.getVaultSets (YAZ-2602 D8)', () => {
  it('is the cache\'s saved sets, last used first as main keeps them, and follows a change made in any window', async () => {
    expect(storage.getVaultSets()).toEqual([])
    const work = { id: 's1', name: 'Work', roots: ['/v/a', '/v/b'], lastUsed: 20 }
    const reading = { id: 's2', name: 'Reading', roots: ['/v/c', '/v/a'], lastUsed: 10 }
    b = installBridge({ ...defaultAppState(), vaultSets: [work, reading] }, { id: 'w1', root: '/v/a', file: null, tabs: [] })
    await storage.init()
    expect(storage.getVaultSets()).toEqual([work, reading])
    const woke = vi.fn()
    storage.subscribe(woke)
    b.emit({ ...defaultAppState(), vaultSets: [reading] })
    expect(storage.getVaultSets()).toEqual([reading])
    expect(woke).toHaveBeenCalledTimes(1)
  })
})

describe('the tab board: its canvas and window names (YAZ-3343 D1, D14)', () => {
  const entry = (id: string, extra: Partial<WindowEntry> = {}): WindowEntry => ({ id, root: '/v', roots: ['/v'], file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'files', bounds: { x: 0, y: 0, width: 800, height: 600 }, ...extra })
  const card = { win: 'w2', path: '/v/a.md', copy: 0, by: 'window' as const, x: 5, y: 6 }

  it('getTabCanvas is the default without one; setTabCanvas applies main\'s rule in the cache at once and sends the patch; a no-op sends nothing; a broadcast of the same canvas keeps the snapshot', async () => {
    // "Show all windows" is on by default (D19).
    expect(storage.getTabCanvas()).toEqual({ allWindows: true, snap: true, cards: [], frames: [] })
    expect(storage.getTabCanvas()).toBe(storage.getTabCanvas())
    const state = { ...defaultAppState(), windows: [entry('w1'), entry('w2')] }
    b = installBridge(state, { id: 'w1', root: '/v', file: null, tabs: [] })
    await storage.init()
    // The board renders its own moves at once: the cache wakes its readers (a no-op wakes none).
    const woke = vi.fn()
    storage.subscribe(woke)
    storage.setTabCanvas({ allWindows: true, set: [card, { ...card, win: 'gone' }] })
    expect(woke).toHaveBeenCalledTimes(1)
    expect(storage.getTabCanvas()).toEqual({ allWindows: true, snap: true, cards: [card], frames: [] }) // a card of no window is not kept, as main keeps none
    expect(b.bridge.state.setTabCanvas).toHaveBeenCalledExactlyOnceWith({ allWindows: true, set: [card, { ...card, win: 'gone' }] })
    storage.setTabCanvas({ allWindows: true, set: [card] })
    expect([b.bridge.state.setTabCanvas.mock.calls.length, woke.mock.calls.length]).toEqual([1, 1])
    const snapshot = storage.getTabCanvas()
    b.emit({ ...state, tabCanvas: { allWindows: true, snap: true, cards: [{ ...card }], frames: [] }, sidebarWidth: 300 })
    expect(storage.getTabCanvas()).toBe(snapshot)
    b.emit({ ...state, tabCanvas: { allWindows: false, snap: true, cards: [], frames: [] } })
    expect(storage.getTabCanvas()).toEqual({ allWindows: false, snap: true, cards: [], frames: [] })
  })

  it('windowName reads this window\'s name, or another\'s by id; setWindowName cleans it in the cache at once and sends the clean name, null for none', async () => {
    b = installBridge({ ...defaultAppState(), windows: [entry('w1', { name: 'Writing' }), entry('w2')] }, { id: 'w1', root: '/v', file: null, tabs: [] })
    await storage.init()
    expect(storage.windowName()).toBe('Writing')
    expect(storage.windowName('w2')).toBeUndefined()
    const woke = vi.fn()
    storage.subscribe(woke)
    storage.setWindowName('w2', '  Research  ')
    expect(storage.windowName('w2')).toBe('Research')
    // The new name wakes the cache's readers; the same name again wakes none.
    storage.setWindowName('w2', 'Research')
    expect(woke).toHaveBeenCalledTimes(1)
    expect(b.bridge.window.setName).toHaveBeenLastCalledWith('w2', 'Research')
    storage.setWindowName('w1', '   ')
    expect(storage.windowName()).toBeUndefined()
    expect(storage.getOtherWindows()).toEqual([entry('w2', { name: 'Research' })])
    // The same array while the windows are the same: the board reads it as a snapshot (D2).
    expect(storage.getOtherWindows()).toBe(storage.getOtherWindows())
    expect(b.bridge.window.setName).toHaveBeenLastCalledWith('w1', null)
  })
})

describe('storage.getSessions (YAZ-3147 D2)', () => {
  it('is the cache\'s sessions, last used first as main keeps them; the same array until a change, which any window can make (S36)', async () => {
    expect(storage.getSessions()).toEqual([])
    const work = { id: 's1', name: 'Work', tabs: [{ path: '/v/a/1.md', active: true as const }], roots: ['/v/a'], lastUsed: 20 }
    const empty = { id: 's2', name: 'Empty', tabs: [], roots: [], lastUsed: 10 }
    b = installBridge({ ...defaultAppState(), sessions: [work, empty] }, { id: 'w1', root: '/v/a', file: null, tabs: [] })
    await storage.init()
    const loaded = storage.getSessions()
    expect(loaded).toEqual([work, empty])
    expect(storage.getSessions()).toBe(loaded)
    const woke = vi.fn()
    storage.subscribe(woke)
    // A broadcast for anything else (a tab click writes the window) is a new copy of the same sessions:
    // the array keeps its identity, so the open Sessions tab does not draw again.
    b.emit({ ...defaultAppState(), sessions: structuredClone([work, empty]), sidebarWidth: 300 })
    expect(storage.getSessions()).toBe(loaded)
    b.emit({ ...defaultAppState(), sessions: [empty] })
    expect(storage.getSessions()).toEqual([empty])
    expect(woke).toHaveBeenCalledTimes(2)
  })
})

// The two orders across vaults have one rule in the cache (YAZ-2702 Decision 3): the test runs for the two.
describe.each([
  ['favoritesOrder', 'getFavoritesOrder', 'setFavoritesOrder'],
  ['focusOrder', 'getFocusOrder', 'setFocusOrder'],
] as const)('storage: %s, an order across vaults (YAZ-2631 D1; the focus order: YAZ-2702 Decision 3)', (key, getter, setter) => {
  const other = key === 'focusOrder' ? 'getFavoritesOrder' : 'getFocusOrder'

  const [a1, a2, b1, c1] = ['/v/a/1.md', '/v/a/2.md', '/v/b/1.md', '/v/c/1.md']

  it('a drag is in the cache at once, merged as main merges it (R5), and wakes the readers; the broadcast of the same order changes nothing, and a different one — another window\'s drag — replaces it (S12)', async () => {
    expect(storage[getter]()).toEqual([])
    b = installBridge({ ...defaultAppState(), [key]: [a1, c1, b1, a2] }, { id: 'w1', root: '/v/a', roots: ['/v/a', '/v/b'], file: null, tabs: [] })
    await storage.init()
    const woke = vi.fn()
    storage.subscribe(woke)
    const loaded = storage[getter]()
    expect(loaded).toEqual([a1, c1, b1, a2])
    expect(storage[getter]()).toBe(loaded)

    storage[setter](['/v/a', '/v/b'], [b1, a2, a1])
    // The entry of a vault this window does not show keeps its place.
    const dragged = storage[getter]()
    expect(dragged).toEqual([b1, c1, a2, a1])
    expect(storage[other]()).toEqual([]) // the other order is not this one's to move
    expect(b.bridge.state[setter].mock.calls).toEqual([[['/v/a', '/v/b'], [b1, a2, a1]]])
    expect(woke).toHaveBeenCalledTimes(1)

    // Main's echo is a new copy of the same paths: the list keeps its identity, so nothing that reads it draws again.
    b.emit({ ...defaultAppState(), [key]: [b1, c1, a2, a1], sidebarWidth: 300 })
    expect(storage[getter]()).toBe(dragged)
    expect(storage.getSidebarWidth()).toBe(300)
    b.emit({ ...defaultAppState(), [key]: [a1, a2, b1] })
    expect(storage[getter]()).toEqual([a1, a2, b1])

    // The order that is held already: still sent — main decides — and no reader wakes.
    woke.mockClear()
    storage[setter](['/v/a', '/v/b'], [a1, a2, b1])
    expect(b.bridge.state[setter]).toHaveBeenCalledTimes(2)
    expect(woke).not.toHaveBeenCalled()
  })
})

describe('storage.init', () => {
  it('loads the state and this window\'s identity from the bridge and subscribes to changes', async () => {
    const seeded: AppState = {
      ...defaultAppState(),
      settings: { ...DEFAULT_SETTINGS, lineSpacing: 2 },
      recents: [{ path: '/v', lastOpened: 5 }],
      folders: { '/v': { expanded: ['/v/sub'], lastFile: '/v/a.md', folds: { '/v/a.md': ['k1'] }, baseGroups: { '/v/b.md::T': ['v:idea'] }, opens: {}, edits: {}, closed: {}, tocSources: {}, sectionIndents: {}, tocSwitches: {}, name: null, key: null } },
    }
    const rightPanel = { open: true, width: 520, items: ['/v/b.md'], expanded: '/v/b.md' }
    b = installBridge(seeded, { id: 'w2', root: '/v', file: '/v/a.md', tabs: ['/v/a.md'], rightPanel, sidebarCollapsed: true })
    await storage.init()
    expect(b.bridge.state.get).toHaveBeenCalledTimes(1)
    expect(b.bridge.window.identity).toHaveBeenCalledTimes(1)
    expect(b.hasListener()).toBe(true)
    expect(storage.getRoot()).toBe('/v')
    expect(storage.getFile()).toBe('/v/a.md')
    expect(storage.getTabs()).toEqual(['/v/a.md'])
    expect(storage.getRightPanel()).toEqual(rightPanel)
    expect(storage.getRightPanel()).not.toBe(rightPanel)
    expect(storage.getSettings()).toEqual({ ...DEFAULT_SETTINGS, lineSpacing: 2 })
    expect(storage.getSidebarCollapsed()).toBe(true)
    expect(storage.getRecentRoots()).toEqual([{ path: '/v', lastOpened: 5 }])
    expect(storage.getExpanded('/v')).toEqual(['/v/sub'])
    expect(storage.getLastFile('/v')).toBe('/v/a.md')
    expect(storage.getFolds('/v', '/v/a.md')).toEqual(['k1'])
    expect(storage.getViewGroups('/v', '/v/b.md::T')).toEqual(['v:idea'])
  })

  it('reads fall back to defaults before init / when the bridge is unavailable', async () => {
    vi.resetModules()
    delete (window as unknown as Record<string, unknown>).yaseenDocs
    const fresh = (await import('./storage')).storage
    expect(fresh.getRoot()).toBeNull()
    expect(fresh.getTabs()).toEqual([])
    expect(fresh.getRecentRoots()).toEqual([])
    expect(fresh.getExpanded('/r')).toEqual([])
    expect(fresh.getLastFile('/r')).toBeNull()
    expect(fresh.getFolds('/r', '/r/a.md')).toEqual([])
    expect(fresh.getViewGroups('/r', '/r/a.md::T')).toEqual([])
    expect(fresh.getSidebarCollapsed()).toBe(false)
    expect(fresh.getSettings()).toEqual(DEFAULT_SETTINGS)
    await expect(fresh.init()).rejects.toBeDefined()
  })

  it('re-initialising drops the previous change subscription', async () => {
    const first = b
    b = installBridge(defaultAppState(), { id: 'w1', root: null, file: null, tabs: [], sidebarCollapsed: false })
    await storage.init()
    expect(first.hasListener()).toBe(false)
    expect(b.hasListener()).toBe(true)
  })
})

describe('storage', () => {
  it('root is the window identity; changing it clears the file AND tabs in one write, re-setting it keeps them', () => {
    expect(storage.getRoot()).toBeNull()
    storage.setRoot('/notes')
    expect(storage.getRoot()).toBe('/notes')
    expect(b.bridge.window.setIdentity).toHaveBeenLastCalledWith({ root: '/notes', file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarLens: 'files' })
    storage.setWorkspace('/notes', [{ path: '/notes/a.md' }], '/notes/a.md', defaultRightPanelIdentity())
    storage.setRoot('/notes')
    expect(b.bridge.window.setIdentity).toHaveBeenLastCalledWith({ root: '/notes' })
    expect(storage.getFile()).toBe('/notes/a.md')
    expect(storage.getTabs()).toEqual(['/notes/a.md'])
    storage.setRoot(null)
    expect(storage.getRoot()).toBeNull()
    expect(b.bridge.window.setIdentity).toHaveBeenLastCalledWith({ root: null, file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarLens: 'files' })
    expect(storage.getFile()).toBeNull()
    expect(storage.getTabs()).toEqual([])
  })

  it('the vaults of the window (YAZ-2602 D1): `setRoot` leaves that one vault and names `root` alone in its write; `setRoots` keeps the tabs; `mirrorRoots` writes nothing', () => {
    storage.setRoot('/v')
    expect(storage.getRoots()).toEqual(['/v'])
    storage.setWorkspace('/v', [{ path: '/v/a.md' }], '/v/a.md', defaultRightPanelIdentity())
    storage.setRoots(['/v', '/w/'])
    expect(storage.getRoots()).toEqual(['/v', '/w'])
    expect(storage.getRoot()).toBe('/v')
    expect(storage.getTabs()).toEqual(['/v/a.md'])
    expect(b.bridge.window.setIdentity).toHaveBeenLastCalledWith({ roots: ['/v', '/w'] })
    // A file is the last file of the vault that holds it.
    storage.setWorkspace('/v', [{ path: '/v/a.md' }, { path: '/w/b.md' }], '/w/b.md', defaultRightPanelIdentity())
    expect(storage.getLastFile('/w')).toBe('/w/b.md')
    expect(storage.getLastFile('/v')).toBe('/v/a.md')

    const writes = b.bridge.window.setIdentity.mock.calls.length
    storage.mirrorRoots(['/v', '/w2'])
    expect(storage.getRoots()).toEqual(['/v', '/w2'])
    expect(b.bridge.window.setIdentity).toHaveBeenCalledTimes(writes)

    // A vault that leaves is a write of the vault list alone (YAZ-2702 S9): the window holds no focus list to cut — it is the vault's, in the vault.
    storage.setRoots(['/w2'])
    expect(storage.getRoot()).toBe('/w2')
    expect(b.bridge.window.setIdentity).toHaveBeenLastCalledWith({ roots: ['/w2'] })
    // The same root again keeps the list; another root is the whole list (S61). Main makes the list from `root` (S76).
    storage.setRoots(['/w2', '/x'])
    storage.setRoot('/w2')
    expect(storage.getRoots()).toEqual(['/w2', '/x'])
    storage.setRoot('/z')
    expect(storage.getRoots()).toEqual(['/z'])
    expect(b.bridge.window.setIdentity).toHaveBeenLastCalledWith({ root: '/z', file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarLens: 'files' })
    storage.setRoot(null)
    expect(storage.getRoots()).toEqual([])
  })

  it('setWorkspace mirrors main and right identity in one call and keeps independent item arrays', () => {
    const rightPanel = { open: true, width: 600, items: ['/v/b.md'], expanded: '/v/b.md' }
    // Two copies of one page, one named and one active (YAZ-3057): `tabs` has the path once, the strip keeps both.
    const strip = [{ path: '/v/a.md', name: 'Draft' }, { path: '/v/a.md', active: true as const }]
    storage.setWorkspace('/v', strip, '/v/a.md', rightPanel)
    expect(storage.getTabs()).toEqual(['/v/a.md'])
    expect(storage.getRightPanel()).toEqual(rightPanel)
    expect(storage.getRightPanel().items).not.toBe(rightPanel.items)
    expect(b.bridge.window.setIdentity).toHaveBeenCalledTimes(1)
    expect(b.bridge.window.setIdentity).toHaveBeenLastCalledWith({
      tabs: ['/v/a.md'],
      tabStrip: strip,
      file: '/v/a.md',
      rightPanel,
    })
  })

  it('recent roots are MRU in the cache and pushed through the bridge', () => {
    expect(storage.pushRecentRoot('/a', 5)).toEqual([{ path: '/a', lastOpened: 5 }])
    storage.pushRecentRoot('/b', 6)
    expect(storage.getRecentRoots()).toEqual([
      { path: '/b', lastOpened: 6 },
      { path: '/a', lastOpened: 5 },
    ])
    expect(b.bridge.state.pushRecent.mock.calls).toEqual([['/a'], ['/b']])
  })

  it('removeRecentRoot drops the entry from the cache and sends the removal over the bridge', () => {
    storage.pushRecentRoot('/a', 5)
    storage.pushRecentRoot('/b', 6)
    storage.removeRecentRoot('/a')
    expect(storage.getRecentRoots()).toEqual([{ path: '/b', lastOpened: 6 }])
    expect(b.bridge.state.removeRecent).toHaveBeenCalledWith('/a')
  })

  it('expanded and lastFile are keyed by root; setWorkspace records lastFile and one complete identity write', () => {
    storage.setExpanded('/r1', ['/r1/a'])
    storage.setExpanded('/r2', ['/r2/b'])
    expect(storage.getExpanded('/r1')).toEqual(['/r1/a'])
    expect(storage.getExpanded('/r2')).toEqual(['/r2/b'])
    expect(storage.getExpanded('/r3')).toEqual([])
    expect(b.bridge.state.setFolder.mock.calls).toEqual([
      ['/r1', { expanded: ['/r1/a'] }],
      ['/r2', { expanded: ['/r2/b'] }],
    ])
    storage.setWorkspace('/r1', [{ path: '/r1/a/x.md' }, { path: '/r1/y.md' }], '/r1/a/x.md', defaultRightPanelIdentity())
    expect(storage.getLastFile('/r1')).toBe('/r1/a/x.md')
    expect(storage.getLastFile('/r2')).toBeNull()
    expect(storage.getExpanded('/r1')).toEqual(['/r1/a']) // the other folder fields survive
    expect(b.bridge.state.setFolder).toHaveBeenLastCalledWith('/r1', { lastFile: '/r1/a/x.md' })
    // ONE explicit write carries BOTH halves — never the legacy { file }-only patch, whose
    // main-side normalization would prepend the file into tabs on its own.
    expect(b.bridge.window.setIdentity).toHaveBeenLastCalledWith({ tabs: ['/r1/a/x.md', '/r1/y.md'], tabStrip: [{ path: '/r1/a/x.md' }, { path: '/r1/y.md' }], file: '/r1/a/x.md', rightPanel: defaultRightPanelIdentity() })
    storage.setWorkspace('/r1', [], null, defaultRightPanelIdentity())
    expect(storage.getLastFile('/r1')).toBeNull()
    expect(b.bridge.state.setFolder).toHaveBeenLastCalledWith('/r1', { lastFile: null })
    expect(b.bridge.window.setIdentity).toHaveBeenLastCalledWith({ tabs: [], tabStrip: [], file: null, rightPanel: defaultRightPanelIdentity() })
  })

  it('a tabs-only change (active file unchanged) writes the identity but NOT the folder (FN14, GRO-2197)', () => {
    storage.setWorkspace('/r', [{ path: '/r/a.md' }], '/r/a.md', defaultRightPanelIdentity())
    expect(b.bridge.state.setFolder).toHaveBeenCalledTimes(1)
    expect(b.bridge.state.setFolder).toHaveBeenLastCalledWith('/r', { lastFile: '/r/a.md' })
    // ⌘-click background tab / drag-reorder / closing a non-active tab: `file` is identical —
    // no redundant lastFile write (which would commit, hit disk and broadcast to every window).
    storage.setWorkspace('/r', [{ path: '/r/a.md' }, { path: '/r/b.md' }], '/r/a.md', defaultRightPanelIdentity())
    expect(b.bridge.state.setFolder).toHaveBeenCalledTimes(1)
    expect(b.bridge.window.setIdentity).toHaveBeenLastCalledWith({ tabs: ['/r/a.md', '/r/b.md'], tabStrip: [{ path: '/r/a.md' }, { path: '/r/b.md' }], file: '/r/a.md', rightPanel: defaultRightPanelIdentity() })
    expect(storage.getTabs()).toEqual(['/r/a.md', '/r/b.md'])
    expect(storage.getLastFile('/r')).toBe('/r/a.md')
    // A REAL active-file change still writes both halves.
    storage.setWorkspace('/r', [{ path: '/r/a.md' }, { path: '/r/b.md' }], '/r/b.md', defaultRightPanelIdentity())
    expect(b.bridge.state.setFolder).toHaveBeenCalledTimes(2)
    expect(b.bridge.state.setFolder).toHaveBeenLastCalledWith('/r', { lastFile: '/r/b.md' })
    expect(b.bridge.window.setIdentity).toHaveBeenLastCalledWith({ tabs: ['/r/a.md', '/r/b.md'], tabStrip: [{ path: '/r/a.md' }, { path: '/r/b.md' }], file: '/r/b.md', rightPanel: defaultRightPanelIdentity() })
  })

  it('setWorkspace on a null root (no folder to remember into) updates the identity only', () => {
    storage.setWorkspace(null, [{ path: '/x/a.md' }], '/x/a.md', defaultRightPanelIdentity())
    expect(storage.getFile()).toBe('/x/a.md')
    expect(storage.getTabs()).toEqual(['/x/a.md'])
    expect(b.bridge.state.setFolder).not.toHaveBeenCalled()
    expect(b.bridge.window.setIdentity).toHaveBeenCalledWith({ tabs: ['/x/a.md'], tabStrip: [{ path: '/x/a.md' }], file: '/x/a.md', rightPanel: defaultRightPanelIdentity() })
  })

  it('getFile/getTabs are the window identity: set by setWorkspace, cleared when the root changes', () => {
    expect(storage.getFile()).toBeNull()
    storage.setRoot('/v')
    storage.setWorkspace('/v', [{ path: '/v/b.md' }, { path: '/v/c.md' }], '/v/b.md', defaultRightPanelIdentity())
    expect(storage.getFile()).toBe('/v/b.md')
    expect(storage.getTabs()).toEqual(['/v/b.md', '/v/c.md'])
    storage.setRoot('/other')
    expect(storage.getFile()).toBeNull()
    expect(storage.getTabs()).toEqual([])
  })

  /** The workspace boot precedence: `hashFilePath(hash) ?? storage.getFile()` — no `lastFile` fallback (YAZ-3487 D7). */
  const bootFile = (hash: string) => hashFilePath(hash) ?? storage.getFile()

  it('boot precedence (GRO-2160, YAZ-3487 D7): a pasted hash beats the identity file; the folder lastFile is never the fallback', async () => {
    // Two windows on the same folder: w2 restored on b.md while the folder's lastFile is a.md.
    const seeded: AppState = { ...defaultAppState(), folders: { '/v': { expanded: [], lastFile: '/v/a.md', folds: {}, baseGroups: {}, opens: {}, edits: {}, closed: {}, tocSources: {}, sectionIndents: {}, tocSwitches: {}, name: null, key: null } } }
    b = installBridge(seeded, { id: 'w2', root: '/v', file: '/v/b.md', tabs: ['/v/b.md'], sidebarCollapsed: false })
    await storage.init()
    expect(bootFile('')).toBe('/v/b.md')
    expect(bootFile('#/v/c.md')).toBe('/v/c.md')
    // A fresh window on the folder (identity file null) opens blank: the folder's lastFile stays unread (YAZ-3487 D7).
    b = installBridge(seeded, { id: 'w3', root: '/v', file: null, tabs: [], sidebarCollapsed: false })
    await storage.init()
    expect(bootFile('')).toBeNull()
  })

  it('the table of contents source is keyed by root then file; null — Auto — is no entry; the same choice again writes nothing (YAZ-2700 D14)', () => {
    expect(storage.getTocSource('/r1', '/r1/a.md')).toBeNull()
    storage.setTocSource('/r1', '/r1/a.md', 'bullets')
    storage.setTocSource('/r1', '/r1/b.md', 'headings')
    expect(storage.getTocSource('/r1', '/r1/a.md')).toBe('bullets')
    expect(storage.getTocSource('/r1', '/r1/b.md')).toBe('headings')
    expect(storage.getTocSource('/r2', '/r1/a.md')).toBeNull()
    expect(b.bridge.state.setTocSource).toHaveBeenCalledWith('/r1', '/r1/a.md', 'bullets')
    expect(b.bridge.state.setTocSource).toHaveBeenCalledTimes(2)
    // The same choice again, and Auto on a note that is on Auto: no write.
    storage.setTocSource('/r1', '/r1/a.md', 'bullets')
    storage.setTocSource('/r1', '/r1/never.md', null)
    expect(b.bridge.state.setTocSource).toHaveBeenCalledTimes(2)
    storage.setTocSource('/r1', '/r1/a.md', 'headings')
    expect(storage.getTocSource('/r1', '/r1/a.md')).toBe('headings')
    storage.setTocSource('/r1', '/r1/a.md', null)
    expect(storage.getTocSource('/r1', '/r1/a.md')).toBeNull()
    expect(b.bridge.state.setTocSource).toHaveBeenLastCalledWith('/r1', '/r1/a.md', null)
    // Another window's choice arrives with the state broadcast, as its folds do.
    b.emit({ ...defaultAppState(), folders: { '/r1': { ...defaultFolderState(), tocSources: { '/r1/a.md': 'bullets' } } } })
    expect(storage.getTocSource('/r1', '/r1/a.md')).toBe('bullets')
    expect(storage.getTocSource('/r1', '/r1/b.md')).toBeNull()
  })

  it('the section indent switch is keyed by root then file; a note with no entry is off; on AND off are sent, and the same value again writes nothing (YAZ-2709 D2)', () => {
    expect(storage.getSectionIndent('/r1', '/r1/a.md')).toBe(false)
    storage.setSectionIndent('/r1', '/r1/a.md', true)
    storage.setSectionIndent('/r1', '/r1/b.md', true)
    expect(storage.getSectionIndent('/r1', '/r1/a.md')).toBe(true)
    expect(storage.getSectionIndent('/r1', '/r1/b.md')).toBe(true)
    expect(storage.getSectionIndent('/r2', '/r1/a.md')).toBe(false)
    expect(b.bridge.state.setSectionIndent).toHaveBeenCalledWith('/r1', '/r1/a.md', true)
    expect(b.bridge.state.setSectionIndent).toHaveBeenCalledTimes(2)
    // The same value again: no write.
    storage.setSectionIndent('/r1', '/r1/a.md', true)
    expect(b.bridge.state.setSectionIndent).toHaveBeenCalledTimes(2)
    // Off is sent as `false`, never as a removal — and off on a note never touched is sent too: it is a choice.
    storage.setSectionIndent('/r1', '/r1/a.md', false)
    expect(storage.getSectionIndent('/r1', '/r1/a.md')).toBe(false)
    expect(b.bridge.state.setSectionIndent).toHaveBeenLastCalledWith('/r1', '/r1/a.md', false)
    storage.setSectionIndent('/r1', '/r1/never.md', false)
    expect(b.bridge.state.setSectionIndent).toHaveBeenLastCalledWith('/r1', '/r1/never.md', false)
    expect(b.bridge.state.setSectionIndent).toHaveBeenCalledTimes(4)
    // Another window's switch arrives with the state broadcast, as its folds do.
    b.emit({ ...defaultAppState(), folders: { '/r1': { ...defaultFolderState(), sectionIndents: { '/r1/a.md': true, '/r1/b.md': false } } } })
    expect(storage.getSectionIndent('/r1', '/r1/a.md')).toBe(true)
    expect(storage.getSectionIndent('/r1', '/r1/b.md')).toBe(false)
  })

  it('the table of contents switch is keyed by root then file; a note with no entry made no choice (`undefined`: the setting decides, YAZ-3558 D1); on AND off are sent, and the same value again writes nothing (YAZ-2950)', () => {
    expect(storage.getTocSwitch('/r1', '/r1/a.md')).toBeUndefined()
    storage.setTocSwitch('/r1', '/r1/a.md', false)
    expect(storage.getTocSwitch('/r1', '/r1/a.md')).toBe(false)
    expect(storage.getTocSwitch('/r2', '/r1/a.md')).toBeUndefined()
    expect(b.bridge.state.setTocSwitch).toHaveBeenCalledExactlyOnceWith('/r1', '/r1/a.md', false)
    // The same value again: no write.
    storage.setTocSwitch('/r1', '/r1/a.md', false)
    expect(b.bridge.state.setTocSwitch).toHaveBeenCalledTimes(1)
    // On again is sent as `true`, never as a removal.
    storage.setTocSwitch('/r1', '/r1/a.md', true)
    expect(storage.getTocSwitch('/r1', '/r1/a.md')).toBe(true)
    expect(b.bridge.state.setTocSwitch).toHaveBeenLastCalledWith('/r1', '/r1/a.md', true)
    // Another window's switch arrives with the state broadcast, as its folds do.
    b.emit({ ...defaultAppState(), folders: { '/r1': { ...defaultFolderState(), tocSwitches: { '/r1/a.md': false } } } })
    expect(storage.getTocSwitch('/r1', '/r1/a.md')).toBe(false)
  })

  it('folds are keyed by root then file, capped, and pruned when empty', () => {
    expect(storage.getFolds('/r1', '/r1/a.md')).toEqual([])
    storage.setFolds('/r1', '/r1/a.md', ['k1', 'k2'])
    storage.setFolds('/r1', '/r1/b.md', ['k3'])
    storage.setFolds('/r2', '/r2/a.md', ['k4'])
    expect(storage.getFolds('/r1', '/r1/a.md')).toEqual(['k1', 'k2'])
    expect(storage.getFolds('/r1', '/r1/b.md')).toEqual(['k3'])
    expect(storage.getFolds('/r2', '/r1/a.md')).toEqual([])
    expect(b.bridge.state.setFolds).toHaveBeenCalledWith('/r1', '/r1/a.md', ['k1', 'k2'])
    // Replacing with the live set drops keys the plugin no longer reports.
    storage.setFolds('/r1', '/r1/a.md', ['k2'])
    expect(storage.getFolds('/r1', '/r1/a.md')).toEqual(['k2'])
    storage.setFolds('/r1', '/r1/a.md', [])
    storage.setFolds('/r1', '/r1/b.md', [])
    expect(storage.getFolds('/r1', '/r1/a.md')).toEqual([])
    expect(b.bridge.state.setFolds).toHaveBeenLastCalledWith('/r1', '/r1/b.md', [])
    const many = Array.from({ length: MAX_FOLD_KEYS_PER_FILE + 50 }, (_, i) => `k${i}`)
    storage.setFolds('/r2', '/r2/a.md', many)
    expect(storage.getFolds('/r2', '/r2/a.md')).toHaveLength(MAX_FOLD_KEYS_PER_FILE)
    expect(b.bridge.state.setFolds).toHaveBeenLastCalledWith('/r2', '/r2/a.md', many)
  })

  it('base group collapse state is keyed by root then base::view, capped, and pruned when empty', () => {
    expect(storage.getViewGroups('/r1', '/r1/a.md::T')).toEqual([])
    storage.setViewGroups('/r1', '/r1/a.md::T', ['v:idea', '∅'])
    storage.setViewGroups('/r2', '/r2/a.md::T', ['v:x'])
    expect(storage.getViewGroups('/r1', '/r1/a.md::T')).toEqual(['v:idea', '∅'])
    expect(storage.getViewGroups('/r2', '/r1/a.md::T')).toEqual([])
    expect(b.bridge.state.setBaseGroups).toHaveBeenCalledWith('/r1', '/r1/a.md::T', ['v:idea', '∅'])
    // Replacing with the live set drops keys no longer collapsed.
    storage.setViewGroups('/r1', '/r1/a.md::T', ['∅'])
    expect(storage.getViewGroups('/r1', '/r1/a.md::T')).toEqual(['∅'])
    storage.setViewGroups('/r1', '/r1/a.md::T', [])
    expect(storage.getViewGroups('/r1', '/r1/a.md::T')).toEqual([])
    expect(b.bridge.state.setBaseGroups).toHaveBeenLastCalledWith('/r1', '/r1/a.md::T', [])
    const many = Array.from({ length: MAX_COLLAPSED_GROUP_KEYS + 50 }, (_, i) => `v:${i}`)
    storage.setViewGroups('/r2', '/r2/a.md::T', many)
    expect(storage.getViewGroups('/r2', '/r2/a.md::T')).toHaveLength(MAX_COLLAPSED_GROUP_KEYS)
    expect(b.bridge.state.setBaseGroups).toHaveBeenLastCalledWith('/r2', '/r2/a.md::T', many)
  })

  it('vaultName falls back to the folder name; setVaultName cleans, stores the folder name as null, and rides setFolder (YAZ-1974 D3)', () => {
    expect(storage.vaultName('/v/business-wiki-MASTER')).toBe('business-wiki-MASTER')
    storage.setVaultName('/v/business-wiki-MASTER', '  Business Wiki ')
    expect(storage.vaultName('/v/business-wiki-MASTER')).toBe('Business Wiki')
    expect(b.bridge.state.setFolder).toHaveBeenLastCalledWith('/v/business-wiki-MASTER', { name: 'Business Wiki' })
    storage.setVaultName('/v/business-wiki-MASTER', 'business-wiki-MASTER') // the folder's own name = no custom name
    expect(b.bridge.state.setFolder).toHaveBeenLastCalledWith('/v/business-wiki-MASTER', { name: null })
    storage.setVaultName('/v/business-wiki-MASTER', 'Business Wiki')
    storage.setVaultName('/v/business-wiki-MASTER', '')
    expect(b.bridge.state.setFolder).toHaveBeenLastCalledWith('/v/business-wiki-MASTER', { name: null })
    expect(storage.vaultName('/v/business-wiki-MASTER')).toBe('business-wiki-MASTER')
  })

  it('vaultKey is null until set; setVaultKey rides setFolder ONCE and the cache takes the number from its old holder at once; keyedVaults names the holders in number order (YAZ-2555 D2)', () => {
    expect(storage.vaultKey('/v/a')).toBeNull()
    storage.setVaultName('/v/a', 'Wiki')
    storage.setVaultKey('/v/a', 2)
    storage.setVaultKey('/v/b', 1)
    expect(b.bridge.state.setFolder).toHaveBeenLastCalledWith('/v/b', { key: 1 })
    expect(storage.keyedVaults()).toEqual([
      { key: 1, path: '/v/b', name: 'b' },
      { key: 2, path: '/v/a', name: 'Wiki' },
    ])
    storage.setVaultKey('/v/b', 2) // one vault per number — right before any broadcast comes back; main frees /v/a in its own commit
    expect(b.bridge.state.setFolder).toHaveBeenLastCalledWith('/v/b', { key: 2 })
    expect(b.bridge.state.setFolder).toHaveBeenCalledTimes(4)
    expect(storage.vaultKey('/v/a')).toBeNull()
    expect(storage.vaultName('/v/a')).toBe('Wiki')
    expect(storage.keyedVaults()).toEqual([{ key: 2, path: '/v/b', name: 'b' }])
    storage.setVaultKey('/v/b', null)
    expect(b.bridge.state.setFolder).toHaveBeenLastCalledWith('/v/b', { key: null })
    expect(storage.keyedVaults()).toEqual([])
  })

  it('sidebarCollapsed is this window identity and round-trips through window.setIdentity', () => {
    expect(storage.getSidebarCollapsed()).toBe(false)
    storage.setSidebarCollapsed(true)
    expect(storage.getSidebarCollapsed()).toBe(true)
    expect(b.bridge.window.setIdentity).toHaveBeenLastCalledWith({ sidebarCollapsed: true })
    storage.setSidebarCollapsed(false)
    expect(storage.getSidebarCollapsed()).toBe(false)
    expect(b.bridge.window.setIdentity).toHaveBeenLastCalledWith({ sidebarCollapsed: false })
  })

  it('sidebarLens is this window identity (YAZ-847, per window since YAZ-1628): restored at boot, written through window.setIdentity, deaf to state broadcasts, reset to Files by a root change (YAZ-1846 D2)', async () => {
    expect(storage.getSidebarLens()).toBe('favorites')
    storage.setSidebarLens('files')
    expect(storage.getSidebarLens()).toBe('files')
    expect(b.bridge.window.setIdentity).toHaveBeenLastCalledWith({ sidebarLens: 'files' })
    storage.setSidebarLens('favorites')
    expect(storage.getSidebarLens()).toBe('favorites')
    expect(b.bridge.window.setIdentity).toHaveBeenLastCalledWith({ sidebarLens: 'favorites' })
    // Restored from main at boot, like sidebarCollapsed.
    b = installBridge(defaultAppState(), { id: 'w1', root: '/r1', file: null, tabs: [], sidebarLens: 'files' })
    await storage.init()
    expect(storage.getSidebarLens()).toBe('files')
    // Another window's write lands as a state broadcast; it cannot move THIS window's lens.
    b.emit({ ...defaultAppState(), sidebarWidth: 333 })
    expect(storage.getSidebarWidth()).toBe(333)
    expect(storage.getSidebarLens()).toBe('files')
    // Re-setting the SAME root keeps it.
    storage.setSidebarLens('favorites')
    storage.setRoot('/r1')
    expect(b.bridge.window.setIdentity).toHaveBeenLastCalledWith({ root: '/r1' })
    expect(storage.getSidebarLens()).toBe('favorites')
    // A root CHANGE lands on Files (YAZ-1846 D2) — in the same single identity write.
    storage.setRoot('/r2')
    expect(b.bridge.window.setIdentity).toHaveBeenLastCalledWith({ root: '/r2', file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarLens: 'files' })
    expect(storage.getSidebarLens()).toBe('files')
  })

  it('settings default and round-trip through the bridge', () => {
    expect(storage.getSettings()).toEqual(DEFAULT_SETTINGS)
    const next = { ...DEFAULT_SETTINGS, lineSpacing: 2.0, blockGap: 12, bulletThreading: false, threadWidth: 1, threadColor: '#00AAff' }
    storage.setSettings(next)
    expect(storage.getSettings()).toEqual(next)
    expect(b.bridge.state.setSettings).toHaveBeenCalledWith(next)
  })

  it('a state:changed broadcast replaces the cache and notifies subscribers; unsubscribe stops them', () => {
    const seen = vi.fn()
    const off = storage.subscribe(seen)
    const next: AppState = {
      ...defaultAppState(),
      settings: { ...DEFAULT_SETTINGS, threadWidth: 3 },
      folders: { '/v': { expanded: [], lastFile: null, folds: { '/v/a.md': ['z'] }, baseGroups: {}, opens: {}, edits: {}, closed: {}, tocSources: {}, sectionIndents: {}, tocSwitches: {}, name: null, key: null } },
    }
    b.emit(next)
    expect(seen).toHaveBeenCalledTimes(1)
    expect(storage.getSettings().threadWidth).toBe(3)
    expect(storage.getSidebarCollapsed()).toBe(false) // another window's global-state broadcast cannot change this identity
    expect(storage.getSidebarLens()).toBe('favorites') // nor the lens (YAZ-1628)
    expect(storage.getFolds('/v', '/v/a.md')).toEqual(['z'])
    off()
    b.emit(defaultAppState())
    expect(seen).toHaveBeenCalledTimes(1)
    expect(storage.getSidebarCollapsed()).toBe(false)
  })

  it('local writes do not notify subscribers (the broadcast echo does)', () => {
    const seen = vi.fn()
    storage.subscribe(seen)
    storage.setSidebarCollapsed(true)
    storage.setSettings({ ...DEFAULT_SETTINGS, blockGap: 8 })
    expect(seen).not.toHaveBeenCalled()
  })

  it('a failed bridge write is logged once and the optimistic cache value stays', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    b.bridge.state.setSettings.mockRejectedValueOnce({ code: 'BAD_REQUEST', message: 'nope' })
    storage.setSettings({ ...DEFAULT_SETTINGS, blockGap: 2 })
    await flushMicrotasks()
    expect(error).toHaveBeenCalledTimes(1)
    expect(storage.getSettings().blockGap).toBe(2)
  })
})
