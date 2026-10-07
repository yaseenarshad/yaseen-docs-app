import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { defaultRightPanelIdentity, type RecentRoots, type WindowBounds, type WindowEntry } from '@shared/types'
import { CONTRACT, SPECIAL } from '@shared/ipc'
import { createStore, type Store } from './store'
import {
  BOUNDS_DEBOUNCE_MS,
  FLUSH_TIMEOUT_MS,
  WINDOW_CASCADE_PX,
  clampBounds,
  createWindowManager,
  resolveLinkTarget,
  type ManagedWindow,
  type WindowHost,
} from './windows'

// ---------- clampBounds (pure) ----------

describe('clampBounds', () => {
  const primary: WindowBounds = { x: 0, y: 0, width: 1440, height: 900 }
  const secondary: WindowBounds = { x: 1440, y: 0, width: 1920, height: 1080 }

  it('leaves a window fully inside a display untouched', () => {
    const b = { x: 100, y: 100, width: 800, height: 600 }
    expect(clampBounds(b, [primary, secondary])).toEqual(b)
  })

  it('nudges a partially visible window fully onto its display', () => {
    expect(clampBounds({ x: -200, y: -50, width: 800, height: 600 }, [primary])).toEqual({ x: 0, y: 0, width: 800, height: 600 })
    expect(clampBounds({ x: 1200, y: 700, width: 800, height: 600 }, [primary])).toEqual({ x: 640, y: 300, width: 800, height: 600 })
  })

  it('brings a fully off-screen window onto the nearest display', () => {
    // Far right of both displays: the secondary is nearest.
    expect(clampBounds({ x: 5000, y: 200, width: 800, height: 600 }, [primary, secondary])).toEqual({ x: 2560, y: 200, width: 800, height: 600 })
    // Far below the primary: the primary is nearest.
    expect(clampBounds({ x: 100, y: 5000, width: 800, height: 600 }, [primary, secondary])).toEqual({ x: 100, y: 300, width: 800, height: 600 })
  })

  it('shrinks an oversized window to the work area', () => {
    expect(clampBounds({ x: -100, y: -100, width: 3000, height: 2000 }, [primary])).toEqual({ x: 0, y: 0, width: 1440, height: 900 })
  })

  it('a window spanning two displays snaps into the one holding the larger share', () => {
    // 440px of the width sit on the primary, 360px on the secondary.
    expect(clampBounds({ x: 1000, y: 100, width: 800, height: 600 }, [primary, secondary])).toEqual({ x: 640, y: 100, width: 800, height: 600 })
  })

  it('no work areas at all (headless edge) leaves the bounds alone', () => {
    const b = { x: 9000, y: 9000, width: 800, height: 600 }
    expect(clampBounds(b, [])).toEqual(b)
  })
})

// ---------- the manager, against fakes ----------

let nextWebContentsId = 100

/** A `ManagedWindow` stand-in: records sends, replays events, destroys like Electron (`closed` fires, `close` does not). */
class FakeWindow {
  webContents = { id: nextWebContentsId++, send: vi.fn() }
  destroyed = false
  minimized = false
  focusCount = 0
  private listeners = new Map<string, Array<(...args: unknown[]) => void>>()
  constructor(public bounds: WindowBounds) {}
  focus(): void {
    this.focusCount++
  }
  isMinimized(): boolean {
    return this.minimized
  }
  restore(): void {
    this.minimized = false
  }
  on(event: string, listener: (...args: unknown[]) => void): this {
    const list = this.listeners.get(event) ?? []
    list.push(listener)
    this.listeners.set(event, list)
    return this
  }
  emit(event: 'move' | 'resize' | 'focus'): void {
    for (const l of this.listeners.get(event) ?? []) l()
  }
  /** What Electron does on a user close: emit `close`; destroy only when nobody preventDefault-ed. */
  close(): void {
    let prevented = false
    for (const l of this.listeners.get('close') ?? []) l({ preventDefault: () => (prevented = true) })
    if (!prevented) this.destroy()
  }
  getBounds(): WindowBounds {
    return { ...this.bounds }
  }
  isDestroyed(): boolean {
    return this.destroyed
  }
  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    for (const l of this.listeners.get('closed') ?? []) l()
  }
  flushCount(): number {
    return this.webContents.send.mock.calls.filter(([ch]) => ch === SPECIAL.appFlush).length
  }
}

const AREA: WindowBounds = { x: 0, y: 0, width: 1440, height: 900 }

function makeHost(
  areas: WindowBounds[] = [AREA],
  exists: (path: string) => boolean = () => true,
  dirExists: (path: string) => boolean = () => true,
): { host: WindowHost; created: Array<{ entry: WindowEntry; win: FakeWindow }> } {
  const created: Array<{ entry: WindowEntry; win: FakeWindow }> = []
  const host: WindowHost = {
    create(entry) {
      const win = new FakeWindow({ ...entry.bounds })
      created.push({ entry, win })
      return win as ManagedWindow
    },
    workAreas: () => areas,
    exists,
    dirExists,
  }
  return { host, created }
}

let dir: string
let store: Store
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'yd-windows-'))
  store = createStore(path.join(dir, 'yaseendocs.json'))
  vi.useFakeTimers()
})
afterEach(async () => {
  vi.useRealTimers()
  await store.flush()
  await rm(dir, { recursive: true, force: true })
})

/** Two stored windows, restored: the common close/quit fixture. */
function seedTwo() {
  store.upsertWindow({ id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md'], sidebarCollapsed: false, sidebarLens: 'files', focusDirs: [], focusFavorites: [], bounds: { x: 10, y: 10, width: 800, height: 600 } })
  store.upsertWindow({ id: 'w2', root: null, file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files', focusDirs: [], focusFavorites: [], bounds: { x: 40, y: 40, width: 800, height: 600 } })
  const { host, created } = makeHost()
  const manager = createWindowManager(store, host)
  manager.restoreAll()
  return { manager, w1: created[0].win, w2: created[1].win }
}

describe('createWindowManager: restore', () => {
  it('first launch seeds one Welcome window (root null, D3) and persists it', () => {
    const { host, created } = makeHost()
    createWindowManager(store, host).restoreAll()
    expect(created).toHaveLength(1)
    expect(created[0].entry.root).toBeNull()
    expect(created[0].entry.file).toBeNull()
    expect(created[0].entry.tabs).toEqual([])
    expect(created[0].entry.rightPanel).toEqual(defaultRightPanelIdentity())
    expect(created[0].entry.sidebarCollapsed).toBe(false)
    expect(created[0].entry.sidebarLens).toBe('files') // the default lens (YAZ-1846)
    expect(store.get().windows).toEqual([created[0].entry])
  })

  it('restores every stored entry, clamping lost bounds back onto a display and persisting the clamp', () => {
    store.upsertWindow({ id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md'], sidebarCollapsed: false, sidebarLens: 'files', focusDirs: [], focusFavorites: [], bounds: { x: 10, y: 10, width: 800, height: 600 } })
    store.upsertWindow({ id: 'w2', root: null, file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files', focusDirs: [], focusFavorites: [], bounds: { x: 9000, y: 9000, width: 800, height: 600 } })
    const { host, created } = makeHost()
    createWindowManager(store, host).restoreAll()
    expect(created.map((c) => c.entry.id)).toEqual(['w1', 'w2'])
    expect(created[0].entry.bounds).toEqual({ x: 10, y: 10, width: 800, height: 600 })
    expect(created[1].entry.bounds).toEqual({ x: 640, y: 300, width: 800, height: 600 })
    expect(store.get().windows.find((w) => w.id === 'w2')?.bounds).toEqual({ x: 640, y: 300, width: 800, height: 600 })
  })

  it('registers every window it creates so IPC can resolve its caller', () => {
    const { manager, w1 } = seedTwo()
    expect(manager.idFor(w1.webContents)).toBe('w1')
  })
})

describe('createWindowManager: bounds', () => {
  it('saves moved/resized bounds once per burst (debounced), onto the entry as it is now', () => {
    store.upsertWindow({ id: 'w1', root: null, file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files', focusDirs: [], focusFavorites: [], bounds: { x: 10, y: 10, width: 800, height: 600 } })
    const { host, created } = makeHost()
    createWindowManager(store, host).restoreAll()
    const win = created[0].win
    // The renderer picked a folder mid-drag: the bounds commit must not undo it.
    store.upsertWindow({ ...store.get().windows[0], root: '/v' })
    let changes = 0
    store.onChange(() => changes++)
    win.bounds = { x: 50, y: 60, width: 900, height: 700 }
    win.emit('move')
    win.emit('resize')
    win.emit('move')
    expect(changes).toBe(0)
    vi.advanceTimersByTime(BOUNDS_DEBOUNCE_MS)
    expect(changes).toBe(1)
    expect(store.get().windows[0]).toEqual({ id: 'w1', root: '/v', file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'files', focusDirs: [], focusFavorites: [], bounds: { x: 50, y: 60, width: 900, height: 700 } })
  })
})

describe('createWindowManager: close', () => {
  it('intercepts close, waits for app:flushed, then destroys and drops the entry', async () => {
    const { manager, w1 } = seedTwo()
    w1.close()
    expect(w1.flushCount()).toBe(1)
    expect(w1.isDestroyed()).toBe(false)
    manager.handleFlushed(w1.webContents)
    await vi.advanceTimersByTimeAsync(0)
    expect(w1.isDestroyed()).toBe(true)
    expect(store.get().windows.map((w) => w.id)).toEqual(['w2'])
    expect(manager.idFor(w1.webContents)).toBeUndefined()
  })

  it('the last window keeps its entry (its close is the quit) and saves its final bounds', async () => {
    store.upsertWindow({ id: 'w1', root: '/v', file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files', focusDirs: [], focusFavorites: [], bounds: { x: 10, y: 10, width: 800, height: 600 } })
    const { host, created } = makeHost()
    const manager = createWindowManager(store, host)
    manager.restoreAll()
    const win = created[0].win
    win.bounds = { x: 200, y: 100, width: 800, height: 600 }
    win.close()
    manager.handleFlushed(win.webContents)
    await vi.advanceTimersByTimeAsync(0)
    expect(win.isDestroyed()).toBe(true)
    expect(store.get().windows).toEqual([{ id: 'w1', root: '/v', file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'files', focusDirs: [], focusFavorites: [], bounds: { x: 200, y: 100, width: 800, height: 600 } }])
  })

  it('a hung renderer cannot block close: the handshake times out after FLUSH_TIMEOUT_MS', async () => {
    const { w1 } = seedTwo()
    w1.close()
    await vi.advanceTimersByTimeAsync(FLUSH_TIMEOUT_MS - 1)
    expect(w1.isDestroyed()).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(w1.isDestroyed()).toBe(true)
  })

  it('a second close while the flush is pending does not start a second handshake', () => {
    const { w1 } = seedTwo()
    w1.close()
    w1.close()
    expect(w1.flushCount()).toBe(1)
    expect(w1.isDestroyed()).toBe(false)
  })

  it('closeWindow (window:close-self, GRO-2232) runs the REAL close path: flush handshake, then destroy and drop', async () => {
    const { manager, w1 } = seedTwo()
    manager.closeWindow('w1')
    expect(w1.flushCount()).toBe(1)
    expect(w1.isDestroyed()).toBe(false) // never a bare destroy — the handshake holds the window
    manager.handleFlushed(w1.webContents)
    await vi.advanceTimersByTimeAsync(0)
    expect(w1.isDestroyed()).toBe(true)
    expect(store.get().windows.map((w) => w.id)).toEqual(['w2'])
  })

  it('closeWindow on an unknown or already-destroyed id is a no-op (mid-close race)', async () => {
    const { manager, w1, w2 } = seedTwo()
    manager.closeWindow('nope')
    expect(w1.flushCount()).toBe(0)
    expect(w2.flushCount()).toBe(0)
    w1.close()
    manager.handleFlushed(w1.webContents)
    await vi.advanceTimersByTimeAsync(0)
    expect(w1.isDestroyed()).toBe(true)
    manager.closeWindow('w1') // gone: nothing to close, nothing thrown
    expect(w1.flushCount()).toBe(1)
  })
})

describe('createWindowManager: quit', () => {
  it('flushes every window at once (YAZ-2198), keeps all entries, saves final bounds, and resolves once the last has flushed', async () => {
    const { manager, w1, w2 } = seedTwo()
    w1.bounds = { x: 111, y: 11, width: 800, height: 600 }
    const done = vi.fn()
    void manager.flushAllForQuit().then(done)
    await vi.advanceTimersByTimeAsync(0)
    expect([w1.flushCount(), w2.flushCount()]).toEqual([1, 1]) // both asked together, not one after the other
    manager.handleFlushed(w2.webContents)
    await vi.advanceTimersByTimeAsync(0)
    expect(w2.isDestroyed()).toBe(true)
    expect(w1.isDestroyed()).toBe(false)
    expect(done).not.toHaveBeenCalled()
    manager.handleFlushed(w1.webContents)
    await vi.advanceTimersByTimeAsync(0)
    expect(w1.isDestroyed()).toBe(true)
    expect(done).toHaveBeenCalled()
    expect(store.get().windows.map((w) => w.id)).toEqual(['w1', 'w2'])
    expect(store.get().windows[0].bounds).toEqual({ x: 111, y: 11, width: 800, height: 600 })
  })

  it('a hung renderer cannot delay the others past the one 5 s cap: quit takes one cap in total, not one per window', async () => {
    const { manager, w1, w2 } = seedTwo()
    const done = vi.fn()
    void manager.flushAllForQuit().then(done)
    await vi.advanceTimersByTimeAsync(0)
    manager.handleFlushed(w2.webContents) // w2 answers; w1 hangs
    await vi.advanceTimersByTimeAsync(0)
    expect(w2.isDestroyed()).toBe(true)
    await vi.advanceTimersByTimeAsync(FLUSH_TIMEOUT_MS)
    expect(w1.isDestroyed()).toBe(true)
    expect(done).toHaveBeenCalled()
    expect(store.get().windows).toHaveLength(2)
  })

  it('a close that lands mid-quit joins the running handshake instead of racing it', async () => {
    const { manager, w1 } = seedTwo()
    void manager.flushAllForQuit()
    await vi.advanceTimersByTimeAsync(0)
    w1.close()
    expect(w1.flushCount()).toBe(1)
    manager.handleFlushed(w1.webContents)
    await vi.advanceTimersByTimeAsync(0)
    expect(w1.isDestroyed()).toBe(true)
    expect(store.get().windows).toHaveLength(2) // quit keeps every entry
  })
})

describe('createWindowManager: openRecentBeside (YAZ-1767 D1 — the one open-recent door)', () => {
  it('a live folder: bumps it to the top of the MRU, opens a window on its remembered last file (D2), returns true', () => {
    store.pushRecent('/v/other', 1)
    store.pushRecent('/v/notes', 2)
    store.setFolder('/v/other', { lastFile: '/v/other/Start here.md' })
    const { host, created } = makeHost()
    const manager = createWindowManager(store, host)
    expect(manager.openRecentBeside('/v/other')).toBe(true)
    expect(created).toHaveLength(1)
    expect(created[0].entry.root).toBe('/v/other')
    expect(created[0].entry.file).toBe('/v/other/Start here.md')
    expect(created[0].entry.tabs).toEqual(['/v/other/Start here.md'])
    expect(created[0].entry.sidebarLens).toBe('files') // ⌘O onto a vault with no window lands on Files (YAZ-1846)
    expect(store.get().recents.map((r) => r.path)).toEqual(['/v/other', '/v/notes'])
    expect(store.get().windows).toEqual([created[0].entry])
  })

  it('a vault with no remembered file opens on nothing (file null, no tabs)', () => {
    const { host, created } = makeHost()
    expect(createWindowManager(store, host).openRecentBeside('/v/fresh')).toBe(true)
    expect(created[0].entry.file).toBeNull()
    expect(created[0].entry.tabs).toEqual([])
    expect(store.get().recents[0]?.path).toBe('/v/fresh')
  })

  it('D9: the vault is already open in ONE window → that window is raised, nothing new opens, true', () => {
    store.upsertWindow({ id: 'w1', root: '/v/other/', file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'favorites', focusDirs: [], focusFavorites: [], bounds: { x: 0, y: 0, width: 800, height: 600 } })
    const { host, created } = makeHost()
    const manager = createWindowManager(store, host)
    manager.restoreAll()
    expect(created).toHaveLength(1)
    const w1 = created[0].win
    w1.minimized = true
    // Trailing slash on the stored root, none on the request: `resolveLinkTarget`'s comparison.
    expect(manager.openRecentBeside('/v/other')).toBe(true)
    expect(created).toHaveLength(1)
    expect(w1.focusCount).toBe(1)
    expect(w1.minimized).toBe(false)
    expect(store.get().recents[0]?.path).toBe('/v/other')
    expect(store.get().windows).toHaveLength(1)
    expect(store.get().windows[0].sidebarLens).toBe('favorites') // raising a window never touches its lens (YAZ-1846 B)
  })

  it('D9: two windows on the vault, focus history A then B → raised A then B, so B (most recently focused) ends on top', () => {
    const entry = (id: string) => ({ id, root: '/v/other', file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files' as const, focusDirs: [], focusFavorites: [], bounds: { x: 0, y: 0, width: 800, height: 600 } })
    store.upsertWindow(entry('a'))
    store.upsertWindow(entry('b'))
    store.upsertWindow({ ...entry('c'), root: '/v/notes' })
    const { host, created } = makeHost()
    const manager = createWindowManager(store, host)
    manager.restoreAll()
    const [a, b, c] = created.map((x) => x.win)
    const order: string[] = []
    a.focus = () => order.push('a')
    b.focus = () => order.push('b')
    c.focus = () => order.push('c')
    a.emit('focus')
    b.emit('focus')
    expect(manager.openRecentBeside('/v/other')).toBe(true)
    expect(order).toEqual(['a', 'b'])
    expect(created).toHaveLength(3)

    // The history moves: A focused again → A on top; C (another vault) is never touched.
    order.length = 0
    a.emit('focus')
    expect(manager.openRecentBeside('/v/other')).toBe(true)
    expect(order).toEqual(['b', 'a'])
  })

  it('D9: a window never focused ranks LAST (raised first, ends underneath)', () => {
    const entry = (id: string) => ({ id, root: '/v/other', file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files' as const, focusDirs: [], focusFavorites: [], bounds: { x: 0, y: 0, width: 800, height: 600 } })
    store.upsertWindow(entry('a'))
    store.upsertWindow(entry('b'))
    const { host, created } = makeHost()
    const manager = createWindowManager(store, host)
    manager.restoreAll()
    const [a, b] = created.map((x) => x.win)
    const order: string[] = []
    a.focus = () => order.push('a')
    b.focus = () => order.push('b')
    a.emit('focus')
    expect(manager.openRecentBeside('/v/other')).toBe(true)
    expect(order).toEqual(['b', 'a'])
  })

  it('D9: a matching entry with NO live window (mid-close) falls through to a new window', () => {
    store.upsertWindow({ id: 'w1', root: '/v/other', file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files', focusDirs: [], focusFavorites: [], bounds: { x: 0, y: 0, width: 800, height: 600 } })
    const { host, created } = makeHost()
    const manager = createWindowManager(store, host)
    manager.restoreAll()
    created[0].win.destroy() // `closed` fires: the manager forgets the live window and its focus rank
    expect(manager.openRecentBeside('/v/other')).toBe(true)
    expect(created).toHaveLength(2)
    expect(created[1].entry.root).toBe('/v/other')
  })

  it('a SUBFOLDER of an open vault is its own vault: a new window on it, the parent vault untouched (YAZ-1914 S12)', () => {
    store.upsertWindow({ id: 'w1', root: '/v/notes', file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files', focusDirs: [], focusFavorites: [], bounds: { x: 0, y: 0, width: 800, height: 600 } })
    const { host, created } = makeHost()
    const manager = createWindowManager(store, host)
    manager.restoreAll()
    const w1 = created[0].win
    expect(manager.openRecentBeside('/v/notes/sub')).toBe(true)
    expect(created).toHaveLength(2)
    expect(created[1].entry.root).toBe('/v/notes/sub')
    expect(w1.focusCount).toBe(0)
    expect(store.get().windows.find((w) => w.id === 'w1')?.root).toBe('/v/notes')
  })

  it('a dead folder: pruned from the MRU, no window, returns false (GRO-2211); its number stays (YAZ-2555 A3, S27)', () => {
    store.pushRecent('/v/gone', 1)
    store.pushRecent('/v/notes', 2)
    store.setFolder('/v/gone', { key: 3 })
    const { host, created } = makeHost([AREA], () => true, (p) => p !== '/v/gone')
    expect(createWindowManager(store, host).openRecentBeside('/v/gone')).toBe(false)
    expect(created).toHaveLength(0)
    expect(store.get().windows).toEqual([])
    expect(store.get().recents.map((r) => r.path)).toEqual(['/v/notes'])
    expect(store.get().folders['/v/gone']?.key).toBe(3)
  })
})

describe('createWindowManager: "last used" (YAZ-2555 D5 — a focus on a vault\'s window bumps it in the MRU)', () => {
  const mru = (): string[] => store.get().recents.map((r) => r.path)

  /** Stored windows restored over a seeded MRU (most recent first); the store's commits are counted from the restore on. */
  function seedFocus(windows: Array<[id: string, root: string | null]>, recents: string[]) {
    for (const [i, p] of [...recents].reverse().entries()) store.pushRecent(p, i)
    for (const [id, root] of windows) store.upsertWindow({ id, root, file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files', focusDirs: [], focusFavorites: [], bounds: { x: 0, y: 0, width: 800, height: 600 } })
    const { host, created } = makeHost()
    const manager = createWindowManager(store, host)
    manager.restoreAll()
    let commits = 0
    store.onChange(() => commits++)
    return { manager, wins: created.map((c) => c.win), commits: () => commits }
  }

  it('S34/S35: a window\'s FIRST focus does not bump its vault; a later one does, stamped with the time of use (S38); already on top → no commit', () => {
    const { wins: [a, b], commits } = seedFocus([['a', '/v/a'], ['b', '/v/b']], ['/v/a', '/v/b'])
    b.emit('focus') // the launch focusing it, not a use
    a.emit('focus')
    expect(mru()).toEqual(['/v/a', '/v/b'])
    expect(commits()).toBe(0)

    vi.setSystemTime(5000)
    b.emit('focus') // a click on B's window, or ⌘`
    expect(store.get().recents).toEqual([{ path: '/v/b', lastOpened: 5000 }, { path: '/v/a', lastOpened: 1 }])
    expect(commits()).toBe(1)
    b.emit('focus') // already on top
    expect(commits()).toBe(1)
    a.emit('focus')
    expect(mru()).toEqual(['/v/a', '/v/b'])
    expect(commits()).toBe(2)
  })

  it('S36: a relaunch restores three windows and focuses each in turn → `recents` is as the quit left it', () => {
    const { wins, commits } = seedFocus([['a', '/v/a'], ['b', '/v/b'], ['c', '/v/c']], ['/v/b', '/v/c', '/v/a'])
    for (const w of wins) w.emit('focus')
    expect(mru()).toEqual(['/v/b', '/v/c', '/v/a'])
    expect(commits()).toBe(0)
  })

  it('S36: a quit does not reorder `recents` — once flushAllForQuit has started, the focus macOS hands the next window as each one is destroyed makes no commit', async () => {
    const { manager, wins: [a, b], commits } = seedFocus([['a', '/v/a'], ['b', '/v/b']], ['/v/a', '/v/b'])
    for (const w of [b, a]) w.emit('focus') // each one's first focus; A is in front
    void manager.flushAllForQuit()
    await vi.advanceTimersByTimeAsync(0)
    manager.handleFlushed(a.webContents)
    await vi.advanceTimersByTimeAsync(0)
    expect(a.isDestroyed()).toBe(true)
    b.emit('focus') // not a first focus: without the guard this is a use of B
    expect(mru()).toEqual(['/v/a', '/v/b'])
    expect(commits()).toBe(0)
  })

  it('S37: focus moving between two windows of ONE vault (a trailing slash on a stored root is the same vault), or onto a Welcome window, makes no write', () => {
    const { wins: [a1, a2, welcome], commits } = seedFocus([['a1', '/v/a'], ['a2', '/v/a/'], ['w', null]], ['/v/a', '/v/b'])
    for (const w of [a1, a2, welcome]) w.emit('focus') // each one's first focus
    for (const w of [a2, a1, welcome, a2]) w.emit('focus')
    expect(mru()).toEqual(['/v/a', '/v/b'])
    expect(commits()).toBe(0)
  })

  it('openWindow on a vault is a use of it: bumped (already on top → `recents` untouched), and the new window\'s first focus adds nothing; a Welcome window is not a vault', () => {
    store.pushRecent('/v/b', 1)
    store.pushRecent('/v/a', 2)
    const { host, created } = makeHost()
    const manager = createWindowManager(store, host)
    manager.openWindow({ root: '/v/b', file: null })
    expect(mru()).toEqual(['/v/b', '/v/a'])
    const bumped = store.get().recents
    manager.openWindow({ root: '/v/b', file: '/v/b/x.md' }) // already on top
    manager.openWindow({ root: null, file: null })
    for (const c of created) c.win.emit('focus')
    expect(store.get().recents).toBe(bumped) // the same snapshot: nothing wrote `recents` again
  })
})

describe('createWindowManager: openWindow / duplicateWindow (D6 plumbing)', () => {
  it('openWindow creates an independent window and persists its entry', () => {
    const { host, created } = makeHost()
    const manager = createWindowManager(store, host)
    manager.openWindow({ root: '/v', file: '/v/a.md' })
    expect(created).toHaveLength(1)
    expect(created[0].entry.root).toBe('/v')
    expect(created[0].entry.file).toBe('/v/a.md')
    expect(created[0].entry.tabs).toEqual(['/v/a.md']) // the opened file is the one tab (GRO-2232)
    expect(created[0].entry.rightPanel).toEqual(defaultRightPanelIdentity())
    expect(created[0].entry.sidebarCollapsed).toBe(false)
    expect(created[0].entry.sidebarLens).toBe('files') // a new window starts on Files (YAZ-1846)
    expect(created[0].entry.focusDirs).toEqual([]) // a new window starts unfocused (YAZ-1628)
    expect(created[0].entry.focusFavorites).toEqual([])
    expect(store.get().windows).toEqual([created[0].entry])
  })

  it('duplicateWindow copies the complete workspace identity, then the two entries can diverge', () => {
    const rightPanel = { open: true, width: 560, items: ['/v/right-a.md', '/v/right-b.md'], expanded: '/v/right-b.md' }
    const from: WindowEntry = { id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md', '/v/b.md'], rightPanel, sidebarCollapsed: true, sidebarLens: 'favorites', focusDirs: ['/v/a'], focusFavorites: ['/v/f'], bounds: { x: 100, y: 100, width: 800, height: 600 } }
    store.upsertWindow(from)
    const { host, created } = makeHost()
    createWindowManager(store, host).duplicateWindow(from)
    expect(created).toHaveLength(1)
    const entry = created[0].entry
    expect(entry.id).not.toBe('w1')
    expect(entry.root).toBe('/v')
    expect(entry.file).toBe('/v/a.md')
    expect(entry.tabs).toEqual(['/v/a.md', '/v/b.md']) // the copy carries every tab, not just the active file (GRO-2232)
    expect(entry.rightPanel).toEqual(rightPanel)
    expect(entry.rightPanel.items).not.toBe(from.rightPanel.items)
    expect(entry.sidebarCollapsed).toBe(true)
    expect(entry.sidebarLens).toBe('favorites') // the lens comes along too (YAZ-1628) — copied, not the Files default (YAZ-1846 G)
    // Both Focus Mode lists come along BY VALUE (YAZ-1628): the copy holds the same paths in fresh arrays.
    expect(entry.focusDirs).toEqual(['/v/a'])
    expect(entry.focusFavorites).toEqual(['/v/f'])
    expect(entry.focusDirs).not.toBe(from.focusDirs)
    expect(entry.focusFavorites).not.toBe(from.focusFavorites)
    expect(entry.bounds).toEqual({ x: 100 + WINDOW_CASCADE_PX, y: 100 + WINDOW_CASCADE_PX, width: 800, height: 600 })
    expect(store.get().windows).toContainEqual(entry)
    store.upsertWindow({ ...entry, sidebarCollapsed: false })
    expect(store.get().windows.find((w) => w.id === 'w1')?.sidebarCollapsed).toBe(true)
    expect(store.get().windows.find((w) => w.id === entry.id)?.sidebarCollapsed).toBe(false)
    from.focusDirs.push('/v/mutated') // mutating the source afterwards never reaches the copy
    from.focusFavorites.push('/v/mutated')
    expect(entry.focusDirs).toEqual(['/v/a'])
    expect(entry.focusFavorites).toEqual(['/v/f'])
  })

  it('duplicating a Welcome window keeps root and file null — Welcome → Welcome (⌘⇧N, GRO-2167)', () => {
    const from: WindowEntry = { id: 'w1', root: null, file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: true, sidebarLens: 'files', focusDirs: [], focusFavorites: [], bounds: { x: 100, y: 100, width: 800, height: 600 } }
    store.upsertWindow(from)
    const { host, created } = makeHost()
    createWindowManager(store, host).duplicateWindow(from)
    expect(created).toHaveLength(1)
    expect(created[0].entry.id).not.toBe('w1')
    expect(created[0].entry.root).toBeNull()
    expect(created[0].entry.file).toBeNull()
    expect(store.get().windows.map((w) => w.id)).toEqual(['w1', created[0].entry.id])
  })

  it('the cascade is clamped: duplicating a window at the display edge stays fully on-screen (GRO-2167)', () => {
    // Bottom-right corner of the 1440×900 area: the +24/+24 cascade would hang off the display.
    const from: WindowEntry = { id: 'w1', root: '/v', file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'files', focusDirs: [], focusFavorites: [], bounds: { x: 640, y: 300, width: 800, height: 600 } }
    store.upsertWindow(from)
    const { host, created } = makeHost()
    createWindowManager(store, host).duplicateWindow(from)
    expect(created[0].entry.bounds).toEqual({ x: 640, y: 300, width: 800, height: 600 })
  })
})

// ---------- deep-link routing (E1, GRO-2171) ----------

describe('resolveLinkTarget (pure)', () => {
  const win = (id: string, root: string | null): WindowEntry => ({ id, root, file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'files', focusDirs: [], focusFavorites: [], bounds: { x: 0, y: 0, width: 800, height: 600 } })
  const recents = (...paths: string[]): RecentRoots => paths.map((path, i) => ({ path, lastOpened: 100 - i }))

  it('picks the open window whose root contains the path (root = dirname included)', () => {
    expect(resolveLinkTarget('/v/a.md', [win('w1', '/v')], [])).toEqual({ kind: 'existing', id: 'w1' })
    expect(resolveLinkTarget('/v/sub/deep/a.md', [win('w1', '/v')], [])).toEqual({ kind: 'existing', id: 'w1' })
  })

  it('containment is by path segment: /a/b does not contain /a/bc/x.md', () => {
    expect(resolveLinkTarget('/a/bc/x.md', [win('w1', '/a/b')], [])).toEqual({ kind: 'new', root: '/a/bc', file: '/a/bc/x.md' })
  })

  it('the most specific (longest) containing root wins; a tie keeps the first in windows[]', () => {
    const windows = [win('w1', '/v'), win('w2', '/v/sub'), win('w3', '/v/sub')]
    expect(resolveLinkTarget('/v/sub/a.md', windows, [])).toEqual({ kind: 'existing', id: 'w2' })
  })

  it('Welcome windows (root null) are never targets', () => {
    expect(resolveLinkTarget('/v/a.md', [win('w1', null)], [])).toEqual({ kind: 'new', root: '/v', file: '/v/a.md' })
  })

  it('no containing window: the first (most recent) recents entry containing the path roots a new window', () => {
    const target = resolveLinkTarget('/w/sub/b.md', [win('w1', '/v')], recents('/other', '/w', '/w/sub'))
    expect(target).toEqual({ kind: 'new', root: '/w', file: '/w/sub/b.md' })
  })

  it('nothing contains the path: a new window rooted at its parent folder', () => {
    expect(resolveLinkTarget('/elsewhere/deep/c.md', [win('w1', '/v')], recents('/w'))).toEqual({
      kind: 'new',
      root: '/elsewhere/deep',
      file: '/elsewhere/deep/c.md',
    })
  })

  it('a containing rootOverride wins: the open window on exactly that root first, else a new window there', () => {
    const windows = [win('w1', '/v'), win('w2', '/v/sub')]
    // Without the override, the more specific /v/sub would win; the override pins /v.
    expect(resolveLinkTarget('/v/sub/a.md', windows, [], '/v')).toEqual({ kind: 'existing', id: 'w1' })
    expect(resolveLinkTarget('/v/sub/a.md', [], [], '/v')).toEqual({ kind: 'new', root: '/v', file: '/v/sub/a.md' })
  })

  it('a rootOverride that does not contain the path is ignored', () => {
    expect(resolveLinkTarget('/v/a.md', [win('w1', '/v')], [], '/w')).toEqual({ kind: 'existing', id: 'w1' })
    expect(resolveLinkTarget('/v/a.md', [], [], null)).toEqual({ kind: 'new', root: '/v', file: '/v/a.md' })
  })
})

describe('createWindowManager: routeToFile (E1)', () => {
  /** One folder window on /v plus a Welcome window — the routing fixture. */
  function seedRouting(exists: (path: string) => boolean = () => true) {
    store.upsertWindow({ id: 'w1', root: '/v', file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files', focusDirs: [], focusFavorites: [], bounds: { x: 10, y: 10, width: 800, height: 600 } })
    store.upsertWindow({ id: 'w2', root: null, file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files', focusDirs: [], focusFavorites: [], bounds: { x: 40, y: 40, width: 800, height: 600 } })
    const { host, created } = makeHost([AREA], exists)
    const manager = createWindowManager(store, host)
    manager.restoreAll()
    return { manager, created, w1: created[0].win, w2: created[1].win }
  }

  const sentOn = (win: FakeWindow, channel: string) => win.webContents.send.mock.calls.filter(([ch]) => ch === channel)

  it('routes into the containing open window: restored if minimized, focused, sent link:open-file with the path', () => {
    const { manager, created, w1 } = seedRouting()
    w1.minimized = true
    manager.routeToFile('/v/sub/a.md')
    expect(w1.isMinimized()).toBe(false)
    expect(w1.focusCount).toBe(1)
    expect(w1.webContents.send).toHaveBeenCalledWith(CONTRACT.link.onOpenFile.channel, '/v/sub/a.md')
    expect(created).toHaveLength(2) // no new window
  })

  it('.markdown and upper-case extensions route too', () => {
    const { manager, w1 } = seedRouting()
    manager.routeToFile('/v/A.MARKDOWN')
    expect(w1.webContents.send).toHaveBeenCalledWith(CONTRACT.link.onOpenFile.channel, '/v/A.MARKDOWN')
  })

  it.each(['/v/data.json', '/v/tool.PY', '/v/report.pdf'])('routes supported view-only file %s through the existing window', (file) => {
    const { manager, created, w1 } = seedRouting()
    manager.routeToFile(file)
    expect(w1.webContents.send).toHaveBeenCalledWith(CONTRACT.link.onOpenFile.channel, file)
    expect(created).toHaveLength(2)
  })

  it('no containing window: a new window on the most recent recents folder containing the file, persisted', () => {
    const { manager, created } = seedRouting()
    store.pushRecent('/w', 1)
    manager.routeToFile('/w/sub/b.md')
    expect(created).toHaveLength(3)
    expect(created[2].entry.root).toBe('/w')
    expect(created[2].entry.file).toBe('/w/sub/b.md')
    expect(created[2].entry.sidebarCollapsed).toBe(false)
    expect(store.get().windows).toContainEqual(created[2].entry)
  })

  it('nothing matches: a new window rooted at the file parent folder', () => {
    const { manager, created } = seedRouting()
    manager.routeToFile('/elsewhere/deep/c.md')
    expect(created).toHaveLength(3)
    expect(created[2].entry.root).toBe('/elsewhere/deep')
    expect(created[2].entry.file).toBe('/elsewhere/deep/c.md')
  })

  it('a rootOverride routes into the open window on exactly that root', () => {
    const { manager, created, w1 } = seedRouting()
    manager.routeToFile('/v/sub/a.md', '/v')
    expect(w1.webContents.send).toHaveBeenCalledWith(CONTRACT.link.onOpenFile.channel, '/v/sub/a.md')
    expect(created).toHaveLength(2)
  })

  it('a stored entry with no live window (mid-close race) falls back to a fresh window on that entry root', () => {
    const { manager, created } = seedRouting()
    // The entry exists in the state but was never attached — its window is already gone.
    store.upsertWindow({ id: 'w3', root: '/v/deeper', file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files', focusDirs: [], focusFavorites: [], bounds: { x: 20, y: 20, width: 800, height: 600 } })
    manager.routeToFile('/v/deeper/n.md') // most specific root wins → resolves to the dead w3
    expect(created).toHaveLength(3)
    expect(created[2].entry.id).not.toBe('w3') // a fresh window, not a resurrection of the dead entry
    expect(created[2].entry.root).toBe('/v/deeper')
    expect(created[2].entry.file).toBe('/v/deeper/n.md')
  })

  it('an unsupported path opens nothing and reports “unsupported file type” passively', () => {
    const { manager, created, w1 } = seedRouting()
    manager.routeToFile('/v/archive.zip')
    expect(created).toHaveLength(2)
    expect(w1.focusCount).toBe(1)
    const notices = sentOn(w1, CONTRACT.link.onNotice.channel)
    expect(notices).toEqual([[CONTRACT.link.onNotice.channel, "Can't open /v/archive.zip: unsupported file type"]])
    expect(sentOn(w1, CONTRACT.link.onOpenFile.channel)).toHaveLength(0)
  })

  it('a missing file (host.exists false) gets the same notice: no window, no dialog', () => {
    const { manager, created, w1 } = seedRouting(() => false)
    manager.routeToFile('/v/gone.md')
    expect(created).toHaveLength(2)
    expect(sentOn(w1, CONTRACT.link.onNotice.channel)).toHaveLength(1)
    expect(sentOn(w1, CONTRACT.link.onOpenFile.channel)).toHaveLength(0)
  })

  it('a directory with a supported-looking suffix is refused passively by the regular-file probe', () => {
    const directory = '/v/folder.pdf'
    const { manager, created, w1 } = seedRouting((candidate) => candidate !== directory)
    manager.routeToFile(directory)
    expect(created).toHaveLength(2)
    expect(sentOn(w1, CONTRACT.link.onNotice.channel)).toEqual([[CONTRACT.link.onNotice.channel, `Can't open ${directory}: file not found`]])
    expect(sentOn(w1, CONTRACT.link.onOpenFile.channel)).toHaveLength(0)
  })

  it('linkNotice (the parse-failure path) restores + focuses a live window and delivers the message: the window that had focus last (YAZ-2555 S27), else the first live one', () => {
    const { manager, w1, w2 } = seedRouting()
    w1.minimized = true
    manager.linkNotice("Can't open link")
    expect(w1.isMinimized()).toBe(false)
    expect(w1.focusCount).toBe(1)
    expect(w1.webContents.send).toHaveBeenCalledWith(CONTRACT.link.onNotice.channel, "Can't open link")

    // You are in w2: the notice shows there, and w1 (a different vault) is not raised — D5 would make it "last used".
    w2.emit('focus')
    manager.linkNotice("Can't open Work: folder not found")
    expect(sentOn(w2, CONTRACT.link.onNotice.channel)).toEqual([[CONTRACT.link.onNotice.channel, "Can't open Work: folder not found"]])
    expect([w1.focusCount, w2.focusCount]).toEqual([1, 1])
    expect(sentOn(w1, CONTRACT.link.onNotice.channel)).toHaveLength(1)
  })
})
