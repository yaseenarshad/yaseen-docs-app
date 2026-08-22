/**
 * The renderer-owned tab model (Tabs I2, GRO-2234): the pure reducer's invariants
 * (`active ∈ tabs`, `tabs: []` ⇔ `active: null`, de-duplication, the keep-mounted set),
 * the boot snapshot precedence, and the hook's ONE-explicit-`setIdentity({tabs, file})`
 * mirror per change.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { defaultAppState, type AppState, type WindowIdentity } from '@shared/types'
import { storage } from '../lib/storage'
import { bootTabs, tabsReducer, useTabs, type TabsState, type UseTabs } from './useTabs'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const state = (tabs: string[], active: string | null, mounted?: string[]): TabsState => ({
  tabs,
  active,
  mounted: mounted ?? (active === null ? [] : [active]),
})

describe('tabsReducer', () => {
  describe('open-current (rule 4: replace the active tab)', () => {
    it('creates the first tab of an empty window', () => {
      expect(tabsReducer(state([], null), { type: 'open-current', path: '/v/a.md' })).toEqual(state(['/v/a.md'], '/v/a.md'))
    })

    it('replaces the active tab in its slot; the replaced path leaves the mounted set', () => {
      const s = state(['/v/a.md', '/v/b.md'], '/v/a.md', ['/v/b.md', '/v/a.md'])
      expect(tabsReducer(s, { type: 'open-current', path: '/v/c.md' })).toEqual({
        tabs: ['/v/c.md', '/v/b.md'],
        active: '/v/c.md',
        mounted: ['/v/b.md', '/v/c.md'],
      })
    })

    it('ACTIVATES an already-open path instead of duplicating (rule 3)', () => {
      const s = state(['/v/a.md', '/v/b.md'], '/v/a.md')
      expect(tabsReducer(s, { type: 'open-current', path: '/v/b.md' })).toEqual({
        tabs: ['/v/a.md', '/v/b.md'],
        active: '/v/b.md',
        mounted: ['/v/a.md', '/v/b.md'],
      })
    })

    it('re-opening the active path is a no-op (same state object — no identity mirror)', () => {
      const s = state(['/v/a.md'], '/v/a.md')
      expect(tabsReducer(s, { type: 'open-current', path: '/v/a.md' })).toBe(s)
    })
  })

  describe('open-new / open-background (rule 5)', () => {
    it('open-new appends at the end and activates', () => {
      const s = state(['/v/a.md'], '/v/a.md')
      expect(tabsReducer(s, { type: 'open-new', path: '/v/b.md' })).toEqual({
        tabs: ['/v/a.md', '/v/b.md'],
        active: '/v/b.md',
        mounted: ['/v/a.md', '/v/b.md'],
      })
    })

    it('open-new on an already-open path activates its tab', () => {
      const s = state(['/v/a.md', '/v/b.md'], '/v/b.md')
      expect(tabsReducer(s, { type: 'open-new', path: '/v/a.md' })).toEqual(state(['/v/a.md', '/v/b.md'], '/v/a.md', ['/v/b.md', '/v/a.md']))
    })

    it('open-background appends WITHOUT activating or mounting (the editor lazy-mounts on first activation)', () => {
      const s = state(['/v/a.md'], '/v/a.md')
      expect(tabsReducer(s, { type: 'open-background', path: '/v/b.md' })).toEqual({
        tabs: ['/v/a.md', '/v/b.md'],
        active: '/v/a.md',
        mounted: ['/v/a.md'],
      })
    })

    it('open-background on an already-open path is a no-op — it never yanks activation', () => {
      const s = state(['/v/a.md', '/v/b.md'], '/v/a.md')
      expect(tabsReducer(s, { type: 'open-background', path: '/v/b.md' })).toBe(s)
    })

    it('open-background as the FIRST tab activates: non-empty tabs require a non-null file', () => {
      expect(tabsReducer(state([], null), { type: 'open-background', path: '/v/a.md' })).toEqual(state(['/v/a.md'], '/v/a.md'))
    })
  })

  describe('activate', () => {
    it('activates a listed tab and adds it to the mounted set once', () => {
      const s = state(['/v/a.md', '/v/b.md'], '/v/a.md')
      const next = tabsReducer(s, { type: 'activate', path: '/v/b.md' })
      expect(next).toEqual(state(['/v/a.md', '/v/b.md'], '/v/b.md', ['/v/a.md', '/v/b.md']))
      // Re-activating keeps the mounted set stable (no duplicates).
      const back = tabsReducer(tabsReducer(next, { type: 'activate', path: '/v/a.md' }), { type: 'activate', path: '/v/b.md' })
      expect(back.mounted).toEqual(['/v/a.md', '/v/b.md'])
    })

    it('an unknown path or the already-active path is a no-op', () => {
      const s = state(['/v/a.md'], '/v/a.md')
      expect(tabsReducer(s, { type: 'activate', path: '/v/zzz.md' })).toBe(s)
      expect(tabsReducer(s, { type: 'activate', path: '/v/a.md' })).toBe(s)
    })
  })

  describe('close (rule 7 ladder)', () => {
    const abc = state(['/v/a.md', '/v/b.md', '/v/c.md'], '/v/b.md')

    it('closing the active tab activates its RIGHT neighbour', () => {
      expect(tabsReducer(abc, { type: 'close', path: '/v/b.md' })).toEqual(state(['/v/a.md', '/v/c.md'], '/v/c.md', ['/v/c.md']))
    })

    it('closing the active LAST tab falls back to the left neighbour', () => {
      const s = state(['/v/a.md', '/v/b.md'], '/v/b.md')
      expect(tabsReducer(s, { type: 'close', path: '/v/b.md' })).toEqual(state(['/v/a.md'], '/v/a.md'))
    })

    it('closing a NON-active tab keeps the active one (and prunes the mounted set)', () => {
      const s = state(['/v/a.md', '/v/b.md', '/v/c.md'], '/v/b.md', ['/v/c.md', '/v/b.md'])
      expect(tabsReducer(s, { type: 'close', path: '/v/c.md' })).toEqual(state(['/v/a.md', '/v/b.md'], '/v/b.md', ['/v/b.md']))
    })

    it('closing the only tab leaves the empty state (tabs: [] ⇔ active: null); the window stays alive', () => {
      expect(tabsReducer(state(['/v/a.md'], '/v/a.md'), { type: 'close', path: '/v/a.md' })).toEqual(state([], null))
    })

    it('closing an unknown path is a no-op', () => {
      expect(tabsReducer(abc, { type: 'close', path: '/v/zzz.md' })).toBe(abc)
    })
  })

  describe('move (I3 drag-to-reorder, GRO-2235)', () => {
    const abc = state(['/v/a.md', '/v/b.md', '/v/c.md'], '/v/b.md')

    it('moves the tab at `from` to final index `to`; active and mounted are untouched', () => {
      expect(tabsReducer(abc, { type: 'move', from: 0, to: 2 })).toEqual(state(['/v/b.md', '/v/c.md', '/v/a.md'], '/v/b.md'))
      expect(tabsReducer(abc, { type: 'move', from: 2, to: 0 })).toEqual(state(['/v/c.md', '/v/a.md', '/v/b.md'], '/v/b.md'))
      const withMounts = state(['/v/a.md', '/v/b.md'], '/v/b.md', ['/v/a.md', '/v/b.md'])
      expect(tabsReducer(withMounts, { type: 'move', from: 1, to: 0 }).mounted).toEqual(['/v/a.md', '/v/b.md'])
    })

    it('the same slot, an out-of-range `from`, or a `to` clamped back onto `from` are no-ops (same object)', () => {
      expect(tabsReducer(abc, { type: 'move', from: 1, to: 1 })).toBe(abc)
      expect(tabsReducer(abc, { type: 'move', from: 3, to: 0 })).toBe(abc)
      expect(tabsReducer(abc, { type: 'move', from: -1, to: 0 })).toBe(abc)
      expect(tabsReducer(abc, { type: 'move', from: 2, to: 99 })).toBe(abc) // clamped to the last slot — its own
    })
  })

  describe('cycle (rule 9: wraparound, plain left→right order)', () => {
    const abc = state(['/v/a.md', '/v/b.md', '/v/c.md'], '/v/c.md')

    it('next wraps from the last tab to the first; prev wraps back', () => {
      const next = tabsReducer(abc, { type: 'cycle', dir: 1 })
      expect(next.active).toBe('/v/a.md')
      expect(tabsReducer(next, { type: 'cycle', dir: -1 }).active).toBe('/v/c.md')
    })

    it('is a no-op with fewer than two tabs', () => {
      const one = state(['/v/a.md'], '/v/a.md')
      expect(tabsReducer(one, { type: 'cycle', dir: 1 })).toBe(one)
      const none = state([], null)
      expect(tabsReducer(none, { type: 'cycle', dir: -1 })).toBe(none)
    })
  })

  describe('reset', () => {
    it('normalizes: de-duplicates and PREPENDS an active file missing from the list (main\'s order)', () => {
      expect(tabsReducer(state([], null), { type: 'reset', tabs: ['/v/a.md', '/v/a.md', '/v/b.md'], active: '/v/c.md' })).toEqual(
        state(['/v/c.md', '/v/a.md', '/v/b.md'], '/v/c.md'),
      )
    })

    it('a null active forces the empty state; resetting an already-empty state is a no-op', () => {
      const s = state(['/v/a.md'], '/v/a.md')
      expect(tabsReducer(s, { type: 'reset', tabs: ['/v/a.md'], active: null })).toEqual(state([], null))
      const empty = state([], null)
      expect(tabsReducer(empty, { type: 'reset', tabs: [], active: null })).toBe(empty)
    })

    it('mounts ONLY the active tab (rule 15: restore shows all tabs, one editor)', () => {
      const next = tabsReducer(state([], null), { type: 'reset', tabs: ['/v/a.md', '/v/b.md'], active: '/v/b.md' })
      expect(next.mounted).toEqual(['/v/b.md'])
    })
  })

  describe('rename (Links E1, GRO-2194: an open tab follows its renamed file)', () => {
    it('remaps the tab in place — slot, activation and the mounted set all follow', () => {
      const s = state(['/v/old.md', '/v/x.md'], '/v/old.md', ['/v/x.md', '/v/old.md'])
      expect(tabsReducer(s, { type: 'rename', oldPath: '/v/old.md', newPath: '/v/new.md' })).toEqual({
        tabs: ['/v/new.md', '/v/x.md'],
        active: '/v/new.md',
        mounted: ['/v/x.md', '/v/new.md'],
      })
    })

    it('remaps a background tab without touching activation', () => {
      const s = state(['/v/x.md', '/v/old.md'], '/v/x.md')
      expect(tabsReducer(s, { type: 'rename', oldPath: '/v/old.md', newPath: '/v/new.md' })).toEqual(state(['/v/x.md', '/v/new.md'], '/v/x.md'))
    })

    it('is a no-op (same state object — no identity mirror) when the old path is not open', () => {
      const s = state(['/v/x.md'], '/v/x.md')
      expect(tabsReducer(s, { type: 'rename', oldPath: '/v/old.md', newPath: '/v/new.md' })).toBe(s)
    })

    it('drops the old tab when the new path is somehow already open (dedupe), keeping activation sane', () => {
      const s = state(['/v/old.md', '/v/new.md'], '/v/old.md', ['/v/old.md'])
      const next = tabsReducer(s, { type: 'rename', oldPath: '/v/old.md', newPath: '/v/new.md' })
      expect(next.tabs).toEqual(['/v/new.md'])
      expect(next.active).toBe('/v/new.md')
      expect(next.mounted).toEqual(['/v/new.md'])
    })
  })

  describe('rename-dir (Links E1b, GRO-2241: every tab under a renamed folder follows by prefix)', () => {
    it('remaps every tab under the old prefix in place — slots, activation and the mounted set follow', () => {
      const s = state(['/v/Old/a.md', '/v/x.md', '/v/Old/deep/b.md'], '/v/Old/a.md', ['/v/x.md', '/v/Old/a.md'])
      expect(tabsReducer(s, { type: 'rename-dir', oldPath: '/v/Old', newPath: '/v/New' })).toEqual({
        tabs: ['/v/New/a.md', '/v/x.md', '/v/New/deep/b.md'],
        active: '/v/New/a.md',
        mounted: ['/v/x.md', '/v/New/a.md'],
      })
    })

    it('is a no-op (same state object — no identity mirror) when nothing is open under the folder', () => {
      const s = state(['/v/x.md', '/v/Older/a.md'], '/v/x.md') // `/v/Older` is NOT under `/v/Old` — prefix means `/v/Old/`
      expect(tabsReducer(s, { type: 'rename-dir', oldPath: '/v/Old', newPath: '/v/New' })).toBe(s)
    })

    it('drops a remapped tab whose target path is somehow already open (dedupe), keeping activation sane', () => {
      const s = state(['/v/Old/a.md', '/v/New/a.md'], '/v/Old/a.md', ['/v/Old/a.md'])
      const next = tabsReducer(s, { type: 'rename-dir', oldPath: '/v/Old', newPath: '/v/New' })
      expect(next.tabs).toEqual(['/v/New/a.md'])
      expect(next.active).toBe('/v/New/a.md')
      expect(next.mounted).toEqual(['/v/New/a.md'])
    })
  })
})

/** A fake `window.yaseenDocs` with just the surface storage touches (the storage.test.ts pattern). */
function installBridge(app: AppState, identity: WindowIdentity) {
  const bridge = {
    state: {
      get: vi.fn(async () => app),
      setFolder: vi.fn(async () => undefined),
      onChange: vi.fn(() => () => undefined),
    },
    window: {
      identity: vi.fn(async () => identity),
      setIdentity: vi.fn(async () => undefined),
    },
  }
  Object.defineProperty(window, 'yaseenDocs', { value: bridge, configurable: true, writable: true })
  return bridge
}

afterEach(() => {
  history.replaceState(null, '', '/')
  delete (window as unknown as Record<string, unknown>).yaseenDocs
  vi.restoreAllMocks()
})

describe('bootTabs (rules 12/15)', () => {
  const seeded: AppState = {
    ...defaultAppState(),
    folders: { '/v': { expanded: [], lastFile: '/v/last.md', folds: {}, baseGroups: {} } },
  }

  it('restores the stored tabs with the identity file active; only the active tab mounts', async () => {
    installBridge(seeded, { id: 'w1', root: '/v', file: '/v/b.md', tabs: ['/v/a.md', '/v/b.md'] })
    await storage.init()
    expect(bootTabs('/v')).toEqual(state(['/v/a.md', '/v/b.md'], '/v/b.md'))
  })

  it('a pasted #hash wins as active and is PREPENDED when missing from the stored tabs', async () => {
    installBridge(seeded, { id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md'] })
    await storage.init()
    history.replaceState(null, '', '#/v/pasted.md')
    expect(bootTabs('/v')).toEqual(state(['/v/pasted.md', '/v/a.md'], '/v/pasted.md'))
  })

  it('a fresh window falls back to the folder lastFile; a null root (Welcome) is empty', async () => {
    installBridge(seeded, { id: 'w1', root: '/v', file: null, tabs: [] })
    await storage.init()
    expect(bootTabs('/v')).toEqual(state(['/v/last.md'], '/v/last.md'))
    expect(bootTabs(null)).toEqual(state([], null))
  })
})

describe('useTabs mirror (the GRO-2232 gotcha: ONE explicit {tabs, file} write per change)', () => {
  let reactRoot: Root | null = null
  let latest: UseTabs
  let bridge: ReturnType<typeof installBridge>

  function Probe({ root }: { root: string | null }) {
    latest = useTabs(root)
    return null
  }

  beforeEach(async () => {
    bridge = installBridge(defaultAppState(), { id: 'w1', root: '/v', file: null, tabs: [] })
    await storage.init()
    reactRoot = createRoot(document.createElement('div'))
    act(() => reactRoot?.render(<Probe root="/v" />))
  })

  afterEach(() => {
    act(() => reactRoot?.unmount())
    reactRoot = null
  })

  it('every mutating action sends ONE setIdentity carrying BOTH tabs and file, plus the folder lastFile', () => {
    act(() => latest.openCurrent('/v/a.md'))
    expect(bridge.window.setIdentity).toHaveBeenCalledTimes(1)
    expect(bridge.window.setIdentity).toHaveBeenLastCalledWith({ tabs: ['/v/a.md'], file: '/v/a.md' })
    expect(bridge.state.setFolder).toHaveBeenLastCalledWith('/v', { lastFile: '/v/a.md' })

    act(() => latest.openBackground('/v/b.md'))
    expect(bridge.window.setIdentity).toHaveBeenLastCalledWith({ tabs: ['/v/a.md', '/v/b.md'], file: '/v/a.md' })

    act(() => latest.next())
    expect(bridge.window.setIdentity).toHaveBeenLastCalledWith({ tabs: ['/v/a.md', '/v/b.md'], file: '/v/b.md' })

    act(() => latest.close('/v/a.md'))
    expect(bridge.window.setIdentity).toHaveBeenLastCalledWith({ tabs: ['/v/b.md'], file: '/v/b.md' })
    expect(bridge.window.setIdentity).toHaveBeenCalledTimes(4)
  })

  it('a no-op action mirrors nothing', () => {
    act(() => latest.openCurrent('/v/a.md'))
    expect(bridge.window.setIdentity).toHaveBeenCalledTimes(1)
    act(() => latest.activate('/v/a.md')) // already active
    act(() => latest.openBackground('/v/a.md')) // already open
    act(() => latest.prev()) // one tab: nothing to cycle
    act(() => latest.close('/v/zzz.md')) // unknown
    expect(bridge.window.setIdentity).toHaveBeenCalledTimes(1)
  })

  it('move mirrors the reorder as ONE {tabs, file} write with the active file unchanged; a no-op move mirrors nothing', () => {
    act(() => latest.openCurrent('/v/a.md'))
    act(() => latest.openBackground('/v/b.md'))
    const writes = bridge.window.setIdentity.mock.calls.length
    act(() => latest.move(0, 1))
    expect(bridge.window.setIdentity).toHaveBeenCalledTimes(writes + 1)
    expect(bridge.window.setIdentity).toHaveBeenLastCalledWith({ tabs: ['/v/b.md', '/v/a.md'], file: '/v/a.md' })
    act(() => latest.move(1, 1))
    expect(bridge.window.setIdentity).toHaveBeenCalledTimes(writes + 1)
  })

  it('closeActive reports whether there was a tab to close (false → App escalates to closeSelf)', () => {
    let closed: boolean | undefined
    act(() => {
      closed = latest.closeActive()
    })
    expect(closed).toBe(false)
    act(() => latest.openCurrent('/v/a.md'))
    act(() => {
      closed = latest.closeActive()
    })
    expect(closed).toBe(true)
    expect(latest.tabs).toEqual([])
    expect(bridge.window.setIdentity).toHaveBeenLastCalledWith({ tabs: [], file: null })
  })

  it('reset with a restored file mirrors against the EXPLICIT new root; an empty reset mirrors nothing', () => {
    act(() => latest.openCurrent('/v/a.md'))
    act(() => latest.reset('/w', '/w/b.md'))
    expect(latest.tabs).toEqual(['/w/b.md'])
    expect(bridge.state.setFolder).toHaveBeenLastCalledWith('/w', { lastFile: '/w/b.md' })
    expect(bridge.window.setIdentity).toHaveBeenLastCalledWith({ tabs: ['/w/b.md'], file: '/w/b.md' })
    const writes = bridge.window.setIdentity.mock.calls.length
    act(() => latest.reset(null, null)) // rides on setRoot's own {root, file: null, tabs: []} write
    expect(latest.tabs).toEqual([])
    expect(latest.active).toBeNull()
    expect(bridge.window.setIdentity).toHaveBeenCalledTimes(writes)
  })
})
