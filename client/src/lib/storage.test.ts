import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, MAX_FOLD_KEYS_PER_FILE, defaultAppState, type AppState, type WindowIdentity } from '@shared/types'
import { addRecentRoot, storage } from './storage'

/** A fake `window.yaseenDocs` with just the state / window halves the storage module talks to. */
function installBridge(state: AppState, identity: WindowIdentity) {
  let listener: ((s: AppState) => void) | null = null
  const bridge = {
    state: {
      get: vi.fn(async () => state),
      setSettings: vi.fn(async () => undefined),
      setSidebarCollapsed: vi.fn(async () => undefined),
      pushRecent: vi.fn(async () => undefined),
      setFolder: vi.fn(async () => undefined),
      setFolds: vi.fn(async () => undefined),
      onChange: vi.fn((l: (s: AppState) => void) => {
        listener = l
        return () => {
          if (listener === l) listener = null
        }
      }),
    },
    window: {
      identity: vi.fn(async () => identity),
      setIdentity: vi.fn(async () => undefined),
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
  b = installBridge(defaultAppState(), { id: 'w1', root: null, file: null })
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

describe('storage.init', () => {
  it('loads the state and this window\'s identity from the bridge and subscribes to changes', async () => {
    const seeded: AppState = {
      ...defaultAppState(),
      settings: { ...DEFAULT_SETTINGS, lineSpacing: 2 },
      sidebarCollapsed: true,
      recents: [{ path: '/v', lastOpened: 5 }],
      folders: { '/v': { expanded: ['/v/sub'], lastFile: '/v/a.md', folds: { '/v/a.md': ['k1'] } } },
    }
    b = installBridge(seeded, { id: 'w2', root: '/v', file: '/v/a.md' })
    await storage.init()
    expect(b.bridge.state.get).toHaveBeenCalledTimes(1)
    expect(b.bridge.window.identity).toHaveBeenCalledTimes(1)
    expect(b.hasListener()).toBe(true)
    expect(storage.getRoot()).toBe('/v')
    expect(storage.getSettings()).toEqual({ ...DEFAULT_SETTINGS, lineSpacing: 2 })
    expect(storage.getSidebarCollapsed()).toBe(true)
    expect(storage.getRecentRoots()).toEqual([{ path: '/v', lastOpened: 5 }])
    expect(storage.getExpanded('/v')).toEqual(['/v/sub'])
    expect(storage.getLastFile('/v')).toBe('/v/a.md')
    expect(storage.getFolds('/v', '/v/a.md')).toEqual(['k1'])
  })

  it('reads fall back to defaults before init / when the bridge is unavailable', async () => {
    vi.resetModules()
    delete (window as unknown as Record<string, unknown>).yaseenDocs
    const fresh = (await import('./storage')).storage
    expect(fresh.getRoot()).toBeNull()
    expect(fresh.getRecentRoots()).toEqual([])
    expect(fresh.getExpanded('/r')).toEqual([])
    expect(fresh.getLastFile('/r')).toBeNull()
    expect(fresh.getFolds('/r', '/r/a.md')).toEqual([])
    expect(fresh.getSidebarCollapsed()).toBe(false)
    expect(fresh.getSettings()).toEqual(DEFAULT_SETTINGS)
    await expect(fresh.init()).rejects.toBeDefined()
  })

  it('re-initialising drops the previous change subscription', async () => {
    const first = b
    b = installBridge(defaultAppState(), { id: 'w1', root: null, file: null })
    await storage.init()
    expect(first.hasListener()).toBe(false)
    expect(b.hasListener()).toBe(true)
  })
})

describe('storage', () => {
  it('root is the window identity; changing it clears the file, re-setting it keeps the file', () => {
    expect(storage.getRoot()).toBeNull()
    storage.setRoot('/notes')
    expect(storage.getRoot()).toBe('/notes')
    expect(b.bridge.window.setIdentity).toHaveBeenLastCalledWith({ root: '/notes', file: null })
    storage.setLastFile('/notes', '/notes/a.md')
    storage.setRoot('/notes')
    expect(b.bridge.window.setIdentity).toHaveBeenLastCalledWith({ root: '/notes' })
    storage.setRoot(null)
    expect(storage.getRoot()).toBeNull()
    expect(b.bridge.window.setIdentity).toHaveBeenLastCalledWith({ root: null, file: null })
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

  it('expanded and lastFile are keyed by root; lastFile also updates the window identity', () => {
    storage.setExpanded('/r1', ['/r1/a'])
    storage.setExpanded('/r2', ['/r2/b'])
    expect(storage.getExpanded('/r1')).toEqual(['/r1/a'])
    expect(storage.getExpanded('/r2')).toEqual(['/r2/b'])
    expect(storage.getExpanded('/r3')).toEqual([])
    expect(b.bridge.state.setFolder.mock.calls).toEqual([
      ['/r1', { expanded: ['/r1/a'] }],
      ['/r2', { expanded: ['/r2/b'] }],
    ])
    storage.setLastFile('/r1', '/r1/a/x.md')
    expect(storage.getLastFile('/r1')).toBe('/r1/a/x.md')
    expect(storage.getLastFile('/r2')).toBeNull()
    expect(storage.getExpanded('/r1')).toEqual(['/r1/a']) // the other folder fields survive
    expect(b.bridge.state.setFolder).toHaveBeenLastCalledWith('/r1', { lastFile: '/r1/a/x.md' })
    expect(b.bridge.window.setIdentity).toHaveBeenLastCalledWith({ file: '/r1/a/x.md' })
    storage.setLastFile('/r1', null)
    expect(storage.getLastFile('/r1')).toBeNull()
    expect(b.bridge.state.setFolder).toHaveBeenLastCalledWith('/r1', { lastFile: null })
    expect(b.bridge.window.setIdentity).toHaveBeenLastCalledWith({ file: null })
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

  it('sidebarCollapsed defaults to false and round-trips through the bridge', () => {
    expect(storage.getSidebarCollapsed()).toBe(false)
    storage.setSidebarCollapsed(true)
    expect(storage.getSidebarCollapsed()).toBe(true)
    expect(b.bridge.state.setSidebarCollapsed).toHaveBeenLastCalledWith(true)
    storage.setSidebarCollapsed(false)
    expect(storage.getSidebarCollapsed()).toBe(false)
    expect(b.bridge.state.setSidebarCollapsed).toHaveBeenLastCalledWith(false)
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
      sidebarCollapsed: true,
      folders: { '/v': { expanded: [], lastFile: null, folds: { '/v/a.md': ['z'] } } },
    }
    b.emit(next)
    expect(seen).toHaveBeenCalledTimes(1)
    expect(storage.getSettings().threadWidth).toBe(3)
    expect(storage.getSidebarCollapsed()).toBe(true)
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
