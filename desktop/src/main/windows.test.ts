import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
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
  store.upsertWindow({ id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md'], sidebarCollapsed: false, sidebarLens: 'files', focusList: [], bounds: { x: 10, y: 10, width: 800, height: 600 } })
  store.upsertWindow({ id: 'w2', root: null, file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files', focusList: [], bounds: { x: 40, y: 40, width: 800, height: 600 } })
  const { host, created } = makeHost()
  const manager = createWindowManager(store, host)
  manager.restore('all')
  return { manager, w1: created[0].win, w2: created[1].win }
}

describe('createWindowManager: restore', () => {
  it('first launch seeds one Welcome window (root null, D3) and persists it', () => {
    const { host, created } = makeHost()
    createWindowManager(store, host).restore('last')
    expect(created).toHaveLength(1)
    expect(created[0].entry.root).toBeNull()
    expect(created[0].entry.file).toBeNull()
    expect(created[0].entry.tabs).toEqual([])
    expect(created[0].entry.rightPanel).toEqual(defaultRightPanelIdentity())
    expect(created[0].entry.sidebarCollapsed).toBe(false)
    expect(created[0].entry.sidebarLens).toBe('files') // the default lens (YAZ-1846)
    expect(store.get().windows).toEqual([created[0].entry])
  })

  it('the Welcome window of a first launch shows no vault: `roots: []` beside `root: null`; a restored window keeps every vault it showed (YAZ-2602 D1)', () => {
    const first = makeHost()
    createWindowManager(store, first.host).restore('all')
    expect(first.created[0].entry).toMatchObject({ root: null, roots: [] })
    expect(store.get().windows[0].roots).toEqual([])
    store.upsertWindow({ ...store.get().windows[0], root: '/a', roots: ['/a', '/b'] })
    const next = makeHost()
    createWindowManager(store, next.host).restore('all') // the next launch
    expect(next.created.map((c) => c.entry.roots)).toEqual([['/a', '/b']])
  })

  it('registers every window it creates so IPC can resolve its caller', () => {
    const { manager, w1 } = seedTwo()
    expect(manager.idFor(w1.webContents)).toBe('w1')
  })
})

describe('createWindowManager: bounds', () => {
  it('saves moved/resized bounds once per burst (debounced), onto the entry as it is now', () => {
    store.upsertWindow({ id: 'w1', root: null, file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files', focusList: [], bounds: { x: 10, y: 10, width: 800, height: 600 } })
    const { host, created } = makeHost()
    createWindowManager(store, host).restore('all')
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
    expect(store.get().windows[0]).toEqual({ id: 'w1', root: '/v', roots: ['/v'], file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'files', focusList: [], bounds: { x: 50, y: 60, width: 900, height: 700 } })
  })
})

describe('createWindowManager: close', () => {
  it('intercepts close, waits for app:flushed, then destroys and drops the entry; a close with other windows open records no vault (YAZ-2589 A1, S22)', async () => {
    const { manager, w1 } = seedTwo()
    w1.close()
    expect(w1.flushCount()).toBe(1)
    expect(w1.isDestroyed()).toBe(false)
    manager.handleFlushed(w1.webContents)
    await vi.advanceTimersByTimeAsync(0)
    expect(w1.isDestroyed()).toBe(true)
    expect(store.get().windows.map((w) => w.id)).toEqual(['w2'])
    expect(manager.idFor(w1.webContents)).toBeUndefined()
    expect(store.get().recents).toEqual([])
  })

  it('the last window keeps its entry (its close is the quit), saves its final bounds, and its vault is recorded as the "last vault" (YAZ-2589 A1, S23)', async () => {
    store.pushRecent('/v/other', 1)
    store.upsertWindow({ id: 'w1', root: '/v', file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files', focusList: [], bounds: { x: 10, y: 10, width: 800, height: 600 } })
    const { host, created } = makeHost()
    const manager = createWindowManager(store, host)
    manager.restore('all')
    const win = created[0].win
    win.bounds = { x: 200, y: 100, width: 800, height: 600 }
    win.close()
    manager.handleFlushed(win.webContents)
    await vi.advanceTimersByTimeAsync(0)
    expect(win.isDestroyed()).toBe(true)
    expect(store.get().windows).toEqual([{ id: 'w1', root: '/v', roots: ['/v'], file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'files', focusList: [], bounds: { x: 200, y: 100, width: 800, height: 600 } }])
    expect(store.get().recents.map((r) => r.path)).toEqual(['/v', '/v/other'])
  })

  it('YAZ-2602 A8: the last window to close shows two vaults and works in the second → that vault is the "last vault"', async () => {
    store.pushRecent('/v/b', 1)
    store.pushRecent('/v/a', 2)
    store.upsertWindow({ id: 'ab', root: '/v/a', roots: ['/v/a', '/v/b'], file: '/v/b/x.md', tabs: ['/v/b/x.md'], sidebarCollapsed: false, sidebarLens: 'files', focusList: [], bounds: { x: 10, y: 10, width: 800, height: 600 } })
    const { host, created } = makeHost()
    const manager = createWindowManager(store, host)
    manager.restore('all')
    created[0].win.close()
    manager.handleFlushed(created[0].win.webContents)
    await vi.advanceTimersByTimeAsync(0)
    expect(created[0].win.isDestroyed()).toBe(true)
    expect(store.get().recents.map((r) => r.path)).toEqual(['/v/b', '/v/a'])
    expect(store.get().windows.map((w) => w.id)).toEqual(['ab'])
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

describe('createWindowManager: what a launch brings back (YAZ-2589)', () => {
  const ids = (list: ReadonlyArray<{ id: string }>): string[] => list.map((w) => w.id)
  const entry = (id: string, root: string | null): Omit<WindowEntry, 'rightPanel'> => ({ id, root, roots: root === null ? [] : [root], file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files', focusList: [], bounds: { x: 0, y: 0, width: 800, height: 600 } })

  /** A quit left windows on A, B (two, one root with a trailing slash) and C, and a Welcome window; `recents` is most recent first. The store's commits are counted from here on. */
  function seedSaved(recents: string[] = ['/v/a', '/v/b', '/v/c'], exists: (path: string) => boolean = () => true, dirExists: (path: string) => boolean = () => false) {
    for (const [i, p] of [...recents].reverse().entries()) store.pushRecent(p, i)
    store.setFolder('/v/a', { lastFile: '/v/a/Start here.md', key: 1, name: 'Alpha' })
    store.upsertWindow(entry('a', '/v/a'))
    store.upsertWindow({ ...entry('b1', '/v/b'), file: '/v/b/x.md', tabs: ['/v/b/x.md', '/v/b/y.md'], bounds: { x: 9000, y: 9000, width: 700, height: 500 } })
    store.upsertWindow(entry('b2', '/v/b/'))
    store.upsertWindow(entry('c', '/v/c'))
    store.upsertWindow(entry('w', null))
    const { host, created } = makeHost([AREA], exists, dirExists)
    const manager = createWindowManager(store, host)
    let commits = 0
    store.onChange(() => commits++)
    return { manager, created, commits: () => commits }
  }

  it('D1 (S1, S3, S6): asked for vault B → only B\'s windows, with their tabs and their place clamped; the others are forgotten in ONE commit, and their vaults stay known (D3, S19)', () => {
    const { manager, created, commits } = seedSaved()
    const { recents, folders } = store.get()
    manager.restore(['/v/b/']) // a link keeps a trailing slash: the same vault
    expect(ids(created.map((c) => c.entry))).toEqual(['b1', 'b2'])
    expect(created[0].entry).toMatchObject({ file: '/v/b/x.md', tabs: ['/v/b/x.md', '/v/b/y.md'], bounds: { x: 740, y: 400, width: 700, height: 500 } })
    expect(ids(store.get().windows)).toEqual(['b1', 'b2'])
    expect(commits()).toBe(2) // the windows that did not come back, then b1's clamped place
    expect(store.get().recents).toBe(recents)
    expect(store.get().folders).toBe(folders)
  })

  it('D1 (S6): asked for two vaults → the windows of both', () => {
    const { manager, created } = seedSaved()
    manager.restore(['/v/c', '/v/a'])
    expect(ids(created.map((c) => c.entry))).toEqual(['a', 'c'])
    expect(ids(store.get().windows)).toEqual(['a', 'c'])
  })

  it('D1 (S2, S18): asked for a vault with no saved window → nothing comes back and no Welcome window opens; the request then opens the vault in a new window on its last page, and a second request for that vault waits for that window\'s page', () => {
    const { manager, created } = seedSaved(['/v/b', '/v/a'], (p) => p === '/v/a/note.md', (p) => p === '/v/a' || p === '/v/a/')
    store.removeWindow('a')
    manager.restore([manager.rootFor('/v/a/')!])
    expect(created).toHaveLength(0)
    expect(store.get().windows).toEqual([])
    manager.routeToFile('/v/a/')
    expect(created.map((c) => [c.entry.root, c.entry.file])).toEqual([['/v/a', '/v/a/Start here.md']])
    expect(store.get().folders['/v/a']).toMatchObject({ key: 1, name: 'Alpha' })
    // A window that a request opened is still loading too: the hold is per window, not only for the ones `restore` brought back.
    const win = created[0].win
    manager.routeToFile('/v/a/note.md')
    expect(created).toHaveLength(1)
    expect(win.webContents.send).not.toHaveBeenCalled()
    manager.handleLinkReady(win.webContents)
    expect(win.webContents.send.mock.calls).toEqual([[CONTRACT.link.onOpenFile.channel, '/v/a/note.md']])
  })

  it('D2 "All vaults" (S12, S24, S25): every saved window comes back, the Welcome window too; a place on a display that is gone is clamped onto one, and the clamp is saved', () => {
    const { manager, created, commits } = seedSaved()
    manager.restore('all')
    expect(ids(created.map((c) => c.entry))).toEqual(['a', 'b1', 'b2', 'c', 'w'])
    expect(ids(store.get().windows)).toEqual(['a', 'b1', 'b2', 'c', 'w'])
    expect(created[0].entry.bounds).toEqual({ x: 0, y: 0, width: 800, height: 600 }) // on a display: as it was saved
    expect(created[1].entry.bounds).toEqual({ x: 740, y: 400, width: 700, height: 500 })
    expect(store.get().windows.find((w) => w.id === 'b1')?.bounds).toEqual({ x: 740, y: 400, width: 700, height: 500 })
    expect(commits()).toBe(1) // b1's clamped place; nothing is forgotten
  })

  it('D2 "Last vault" (S10): the windows of the vault used last come back; the others, and the Welcome window (S25), are forgotten', () => {
    const { manager, created } = seedSaved(['/v/b', '/v/a', '/v/c'])
    manager.restore('last')
    expect(ids(created.map((c) => c.entry))).toEqual(['b1', 'b2'])
    expect(ids(store.get().windows)).toEqual(['b1', 'b2'])
  })

  it.each([
    ['"Last vault", and the vault used last has no saved window (S11)', 'last', ['/v/z', '/v/a']],
    ['"Last vault", and no vault is on record (an empty `recents`)', 'last', []],
    ['"None" (S13)', 'none', ['/v/a', '/v/b']],
  ] as const)('D2 %s: one new Welcome window, and every saved window is forgotten', (_case, setting, recents) => {
    const { manager, created } = seedSaved([...recents])
    manager.restore(setting)
    expect(created).toHaveLength(1)
    expect(created[0].entry).toMatchObject({ root: null, file: null, tabs: [] })
    expect(store.get().windows).toEqual([created[0].entry])
    expect(store.get().recents.map((r) => r.path)).toEqual(recents) // the list of vaults the Welcome window shows
  })

  it('rootFor (D1, S4, S5): a folder is its own vault, slash off; a file belongs to the root `resolveLinkTarget` picks: the saved window that contains it, else the recent root, else its parent folder. A path that cannot open has no vault (A6)', () => {
    const { manager } = seedSaved(['/v/a', '/r/known'], (p) => !p.endsWith('/gone.md'), (p) => p === '/v/a/sub/' || p === '/elsewhere')
    expect(manager.rootFor('/v/a/sub/')).toBe('/v/a/sub') // a folder inside a vault is its own vault (YAZ-2556 D1)
    expect(manager.rootFor('/elsewhere')).toBe('/elsewhere')
    expect(manager.rootFor('/v/c/deep/note.md')).toBe('/v/c')
    expect(manager.rootFor('/r/known/deep/note.md')).toBe('/r/known')
    expect(manager.rootFor('/nowhere/deep/note.md')).toBe('/nowhere/deep')
    expect(manager.rootFor('/v/b/deep/note.md', '/v/b/deep')).toBe('/v/b/deep') // `?root=` names the vault
    // What `routeToFile` answers with a notice is not a request: a file that is gone, a kind the app does not open, a folder that is gone.
    expect(manager.rootFor('/v/b/gone.md')).toBeNull()
    expect(manager.rootFor('/v/b/gone.md', '/v/b')).toBeNull()
    expect(manager.rootFor('/v/b/archive.zip')).toBeNull()
    expect(manager.rootFor('/v/b/was-a-folder')).toBeNull()
  })

  it('YAZ-2602 A8: asked for vault B → the saved window that shows A and B comes back with both its vaults, beside B\'s own windows; the windows on A alone and on C alone are forgotten', () => {
    const { manager, created } = seedSaved()
    store.upsertWindow({ ...entry('ab', '/v/a'), roots: ['/v/a', '/v/b/'] })
    manager.restore(['/v/b'])
    expect(ids(created.map((c) => c.entry))).toEqual(['b1', 'b2', 'ab'])
    expect(created[2].entry).toMatchObject({ root: '/v/a', roots: ['/v/a', '/v/b'] })
    expect(ids(store.get().windows)).toEqual(['b1', 'b2', 'ab'])
  })

  it('YAZ-2602 A8: rootFor answers with the vault of a window that holds the path — the most specific one, whichever place it has in its window — and a launch that asks for a file there brings back that window alone and opens the file in it', () => {
    const { manager, created } = seedSaved(['/r/known'])
    store.upsertWindow({ ...entry('ab', '/v/a'), roots: ['/v/a', '/w/second', '/v/b/deep'] })
    expect(manager.rootFor('/w/second/x/note.md')).toBe('/w/second') // its SECOND vault: not the file's parent folder
    expect(manager.rootFor('/v/b/deep/x/note.md')).toBe('/v/b/deep') // its third, more specific than the windows on /v/b
    expect(manager.rootFor('/w/second/x/note.md', '/w/second/')).toBe('/w/second') // `?root=` finds the window by any of its vaults
    manager.restore([manager.rootFor('/w/second/x/note.md')!])
    manager.routeToFile('/w/second/x/note.md')
    expect(ids(created.map((c) => c.entry))).toEqual(['ab'])
    expect(ids(store.get().windows)).toEqual(['ab'])
    manager.handleLinkReady(created[0].win.webContents)
    expect(created[0].win.webContents.send.mock.calls).toEqual([[CONTRACT.link.onOpenFile.channel, '/w/second/x/note.md']])
  })

  it('D1 (S4): asked for a FILE in vault B → B\'s windows come back, nothing else opens, and the file opens in B\'s window once its page listens', () => {
    const { manager, created } = seedSaved()
    manager.restore([manager.rootFor('/v/b/deep/note.md')!])
    manager.routeToFile('/v/b/deep/note.md')
    const sent = () => created.flatMap((c) => c.win.webContents.send.mock.calls)
    expect(ids(created.map((c) => c.entry))).toEqual(['b1', 'b2'])
    expect(sent()).toEqual([]) // the pages are still loading: they would not hear it
    for (const c of created) manager.handleLinkReady(c.win.webContents)
    expect(sent()).toEqual([[CONTRACT.link.onOpenFile.channel, '/v/b/deep/note.md']])
  })
})

describe('createWindowManager: a request that cannot open is not a request (YAZ-2589 A6), the app never runs with no window, and a notice is never lost (A2)', () => {
  const entry = (id: string, root: string): Omit<WindowEntry, 'rightPanel'> => ({ id, root, roots: [root], file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files', focusList: [], bounds: { x: 0, y: 0, width: 800, height: 600 } })

  /** A quit left windows on A, B and C, with A used last. Only `/v/b/note.md` is a file that exists; no path is a folder. */
  function seedThree() {
    for (const [i, p] of ['/v/c', '/v/b', '/v/a'].entries()) store.pushRecent(p, i)
    for (const id of ['a', 'b', 'c']) store.upsertWindow(entry(id, `/v/${id}`))
    const { host, created } = makeHost([AREA], (p) => p === '/v/b/note.md', () => false)
    return { manager: createWindowManager(store, host), created }
  }
  /** What `index.ts` does at launch: only the requests that can open are asked for; with none, the setting decides. Then each request is handled. */
  function launch(manager: ReturnType<typeof createWindowManager>, paths: string[]): void {
    const asked = paths.flatMap((p) => manager.rootFor(p) ?? [])
    manager.restore(asked.length > 0 ? asked : 'last')
    for (const p of paths) manager.routeToFile(p)
  }

  it('S8: asked for a file that is gone → a plain launch: the setting decides which windows come back, none is forgotten for the dead request, and the notice shows in a window that came back once its page listens', () => {
    const { manager, created } = seedThree()
    launch(manager, ['/v/b/gone.md'])
    expect(created.map((c) => c.entry.id)).toEqual(['a']) // "Last vault", not vault B and not the Welcome window
    const win = created[0].win
    expect(win.webContents.send).not.toHaveBeenCalled()
    manager.handleLinkReady(win.webContents)
    expect(win.webContents.send.mock.calls).toEqual([[CONTRACT.link.onNotice.channel, "Can't open /v/b/gone.md: file not found"]])
  })

  it('one request that can open and one that cannot → only the vault of the good one comes back, and the notice shows there', () => {
    const { manager, created } = seedThree()
    launch(manager, ['/v/c/archive.zip', '/v/b/note.md'])
    expect(created.map((c) => c.entry.id)).toEqual(['b'])
    expect(store.get().windows.map((w) => w.id)).toEqual(['b'])
    const win = created[0].win
    manager.handleLinkReady(win.webContents)
    expect(win.webContents.send.mock.calls).toEqual([
      [CONTRACT.link.onNotice.channel, "Can't open /v/c/archive.zip: unsupported file type"],
      [CONTRACT.link.onOpenFile.channel, '/v/b/note.md'],
    ])
  })

  it('A2, the safety net: a folder that goes away between the launch\'s check and the open, with no window back → the Welcome window opens, and the notice shows there once its page listens', () => {
    let there = true
    const { host, created } = makeHost([AREA], () => false, () => there)
    const manager = createWindowManager(store, host)
    manager.restore([manager.rootFor('/v/gone')!])
    expect(created).toHaveLength(0)
    there = false
    manager.routeToFile('/v/gone')
    manager.linkNotice("Can't open link: nope") // a second one finds the window that is there
    expect(created).toHaveLength(1)
    expect(created[0].entry.root).toBeNull()
    expect(store.get().windows).toEqual([created[0].entry])
    const win = created[0].win
    expect(win.webContents.send).not.toHaveBeenCalled()
    manager.handleLinkReady(win.webContents)
    expect(win.webContents.send.mock.calls).toEqual([
      [CONTRACT.link.onNotice.channel, "Can't open /v/gone: unsupported file type"],
      [CONTRACT.link.onNotice.channel, "Can't open link: nope"],
    ])
    // From then on a notice goes out at once, and nothing is sent twice.
    manager.handleLinkReady(win.webContents)
    manager.linkNotice('again')
    expect(win.webContents.send.mock.calls.slice(2)).toEqual([[CONTRACT.link.onNotice.channel, 'again']])
  })

  it('S7: a notice at launch for a window that came back waits for its page; a window that closes first takes its notice with it', async () => {
    const { manager, w1, w2 } = seedTwo()
    manager.linkNotice("Can't open link: nope")
    expect(w1.focusCount).toBe(1) // raised at once; the words follow
    expect(w1.webContents.send).not.toHaveBeenCalled()
    w1.close()
    manager.handleFlushed(w1.webContents)
    await vi.advanceTimersByTimeAsync(0)
    manager.handleLinkReady(w1.webContents)
    expect(w1.webContents.send.mock.calls.filter(([ch]) => ch === CONTRACT.link.onNotice.channel)).toEqual([])
    expect(w2.webContents.send).not.toHaveBeenCalled()
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
    store.upsertWindow({ id: 'w1', root: '/v/other/', file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'favorites', focusList: [], bounds: { x: 0, y: 0, width: 800, height: 600 } })
    const { host, created } = makeHost()
    const manager = createWindowManager(store, host)
    manager.restore('all')
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
    // The vault is on top now, so going to it again writes nothing (YAZ-2555 D5, S25): the door bumps through `noteUsed`.
    const before = store.get()
    expect(manager.openRecentBeside('/v/other')).toBe(true)
    expect(store.get()).toBe(before)
  })

  it('D9: two windows on the vault, focus history A then B → raised A then B, so B (most recently focused) ends on top', () => {
    const entry = (id: string) => ({ id, root: '/v/other', file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files' as const, focusList: [], bounds: { x: 0, y: 0, width: 800, height: 600 } })
    store.upsertWindow(entry('a'))
    store.upsertWindow(entry('b'))
    store.upsertWindow({ ...entry('c'), root: '/v/notes' })
    const { host, created } = makeHost()
    const manager = createWindowManager(store, host)
    manager.restore('all')
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
    const entry = (id: string) => ({ id, root: '/v/other', file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files' as const, focusList: [], bounds: { x: 0, y: 0, width: 800, height: 600 } })
    store.upsertWindow(entry('a'))
    store.upsertWindow(entry('b'))
    const { host, created } = makeHost()
    const manager = createWindowManager(store, host)
    manager.restore('all')
    const [a, b] = created.map((x) => x.win)
    const order: string[] = []
    a.focus = () => order.push('a')
    b.focus = () => order.push('b')
    a.emit('focus')
    expect(manager.openRecentBeside('/v/other')).toBe(true)
    expect(order).toEqual(['b', 'a'])
  })

  it('YAZ-2602 S55/S56: a window is on EACH vault it shows — the door raises a window that shows the vault beside another, opens nothing, and with several such windows the one focused last ends on top', () => {
    const entry = (id: string, ...roots: string[]) => ({ id, root: roots[0], roots, file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files' as const, focusList: [], bounds: { x: 0, y: 0, width: 800, height: 600 } })
    store.upsertWindow(entry('ab', '/v/a', '/v/b'))
    store.upsertWindow(entry('b', '/v/b'))
    store.upsertWindow(entry('cd', '/v/c', '/v/d'))
    const { host, created } = makeHost()
    const manager = createWindowManager(store, host)
    manager.restore('all')
    const [ab, b, cd] = created.map((x) => x.win)
    const order: string[] = []
    ab.focus = () => order.push('ab')
    b.focus = () => order.push('b')
    cd.focus = () => order.push('cd')
    // A vault that is ONLY the second vault of one window: that window comes to the front.
    expect(manager.openRecentBeside('/v/d')).toBe(true)
    expect(order).toEqual(['cd'])
    expect(store.get().recents[0]?.path).toBe('/v/d')
    // Two windows show /v/b, one of them beside /v/a: both are raised, the one focused last on top.
    order.length = 0
    ab.emit('focus')
    b.emit('focus')
    ab.emit('focus')
    expect(manager.openRecentBeside('/v/b')).toBe(true)
    expect(order).toEqual(['b', 'ab'])
    order.length = 0
    b.emit('focus')
    expect(manager.openRecentBeside('/v/b/')).toBe(true) // a trailing slash is the same vault
    expect(order).toEqual(['ab', 'b'])
    expect(created).toHaveLength(3) // never a new window
    expect(store.get().windows.map((w) => w.roots)).toEqual([['/v/a', '/v/b'], ['/v/b'], ['/v/c', '/v/d']])
  })

  it('D9: a matching entry with NO live window (mid-close) falls through to a new window', () => {
    store.upsertWindow({ id: 'w1', root: '/v/other', file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files', focusList: [], bounds: { x: 0, y: 0, width: 800, height: 600 } })
    const { host, created } = makeHost()
    const manager = createWindowManager(store, host)
    manager.restore('all')
    created[0].win.destroy() // `closed` fires: the manager forgets the live window and its focus rank
    expect(manager.openRecentBeside('/v/other')).toBe(true)
    expect(created).toHaveLength(2)
    expect(created[1].entry.root).toBe('/v/other')
  })

  it('a SUBFOLDER of an open vault is its own vault: a new window on it, the parent vault untouched (YAZ-1914 S12)', () => {
    store.upsertWindow({ id: 'w1', root: '/v/notes', file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files', focusList: [], bounds: { x: 0, y: 0, width: 800, height: 600 } })
    const { host, created } = makeHost()
    const manager = createWindowManager(store, host)
    manager.restore('all')
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

describe('createWindowManager: openVaultSet (YAZ-2602 D8 — a saved set of vaults opens as ONE window)', () => {
  const entry = (id: string, ...roots: string[]) => ({ id, root: roots[0], roots, file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files' as const, focusList: [], bounds: { x: 0, y: 0, width: 800, height: 600 } })
  /** Three saved sets; "Work" (`/v/b`, `/v/a`, in that order) is the least recently used. */
  const seedSets = () => {
    const work = store.saveVaultSet('Work', ['/v/b', '/v/a'], 1)
    const home = store.saveVaultSet('Home', ['/v/c', '/v/d'], 2)
    const three = store.saveVaultSet('Three', ['/v/a', '/v/b', '/v/c'], 3)
    if (work === null || home === null || three === null) throw new Error('the store refused a set')
    return { work, home, three }
  }
  const setIds = () => store.get().vaultSets.map((s) => s.id)

  it('S65: no window shows exactly the set → ONE new window on its vaults in the SAVED order, on the first vault\'s last file; the set becomes the last used', () => {
    const { work, home, three } = seedSets()
    store.setFolder('/v/b', { lastFile: '/v/b/Start here.md' })
    store.setFolder('/v/a', { lastFile: '/v/a/Other.md' })
    // Windows that show MORE vaults, FEWER vaults, or one different vault are not the set's window.
    store.upsertWindow(entry('more', '/v/a', '/v/b', '/v/x'))
    store.upsertWindow(entry('fewer', '/v/b'))
    store.upsertWindow(entry('other', '/v/b', '/v/x'))
    const { host, created } = makeHost()
    const manager = createWindowManager(store, host)
    manager.restore('all')
    vi.setSystemTime(5000)
    expect(manager.openVaultSet(work.id)).toEqual({ opened: true, missing: [] })
    expect(created).toHaveLength(4)
    expect(created.slice(0, 3).map((c) => c.win.focusCount)).toEqual([0, 0, 0])
    expect(created[3].entry).toMatchObject({ root: '/v/b', roots: ['/v/b', '/v/a'], file: '/v/b/Start here.md', tabs: ['/v/b/Start here.md'] })
    expect(store.get().windows).toHaveLength(4)
    expect(store.get().windows[3]).toEqual(created[3].entry)
    expect(setIds()).toEqual([work.id, three.id, home.id])
    expect(store.get().vaultSets[0]).toEqual({ ...work, lastUsed: 5000 })

    // A set whose first vault has no remembered file opens on nothing.
    expect(manager.openVaultSet(home.id)).toEqual({ opened: true, missing: [] })
    expect(created[4].entry).toMatchObject({ root: '/v/c', roots: ['/v/c', '/v/d'], file: null, tabs: [] })
    // An id that names no set opens nothing and changes nothing.
    const before = store.get()
    expect(manager.openVaultSet('nope')).toEqual({ opened: false, missing: [] })
    expect(created).toHaveLength(5)
    expect(store.get()).toBe(before)
  })

  it('S65: a window whose vaults are EXACTLY the set is raised — the order and a trailing slash do not count — and nothing opens; with several, the one focused last ends on top', () => {
    const { work, home, three } = seedSets()
    store.upsertWindow(entry('ab', '/v/a/', '/v/b')) // the set is saved as b, a
    store.upsertWindow(entry('ba', '/v/b', '/v/a'))
    store.upsertWindow(entry('abc', '/v/a', '/v/b', '/v/c'))
    store.upsertWindow(entry('a', '/v/a'))
    const { host, created } = makeHost()
    const manager = createWindowManager(store, host)
    manager.restore('all')
    const [ab, ba, abc, a] = created.map((x) => x.win)
    const order: string[] = []
    ab.focus = () => order.push('ab')
    ba.focus = () => order.push('ba')
    abc.focus = () => order.push('abc')
    a.focus = () => order.push('a')
    ba.emit('focus')
    ab.emit('focus')
    ab.minimized = true
    vi.setSystemTime(7000)
    expect(manager.openVaultSet(work.id)).toEqual({ opened: true, missing: [] })
    expect(order).toEqual(['ba', 'ab']) // `ab` had focus last: it ends on top
    expect(ab.minimized).toBe(false)
    expect(created).toHaveLength(4)
    expect(store.get().windows.map((w) => w.roots)).toEqual([['/v/a/', '/v/b'], ['/v/b', '/v/a'], ['/v/a', '/v/b', '/v/c'], ['/v/a']])
    expect(setIds()).toEqual([work.id, three.id, home.id])
    expect(store.get().vaultSets[0].lastUsed).toBe(7000)

    // The focus history moves, and a window never focused ranks last. The set of three raises its own window only.
    order.length = 0
    ba.emit('focus')
    expect(manager.openVaultSet(work.id).opened).toBe(true)
    expect(order).toEqual(['ab', 'ba'])
    order.length = 0
    expect(manager.openVaultSet(three.id)).toEqual({ opened: true, missing: [] })
    expect(order).toEqual(['abc'])
    expect(created).toHaveLength(4)
    expect(setIds()).toEqual([three.id, work.id, home.id])

    // The exact window is mid-close (an entry with no live window): a new window opens.
    ab.destroy()
    ba.destroy()
    expect(manager.openVaultSet(work.id).opened).toBe(true)
    expect(created).toHaveLength(5)
    expect(created[4].entry.roots).toEqual(['/v/b', '/v/a'])
  })

  it('S66: a folder that is gone is left out and named in `missing`, and the saved set keeps it; a window that already shows exactly the vaults that are left is raised; all gone → nothing opens', () => {
    const { work, home, three } = seedSets()
    store.setFolder('/v/b', { lastFile: '/v/b/Start here.md' })
    const gone = new Set(['/v/a'])
    const { host, created } = makeHost([AREA], () => true, (p) => !gone.has(p))
    const manager = createWindowManager(store, host)
    // `/v/a` is gone: "Three" opens on b and c, in the saved order, on the last file of the first vault that is left.
    expect(manager.openVaultSet(three.id)).toEqual({ opened: true, missing: ['/v/a'] })
    expect(created).toHaveLength(1)
    expect(created[0].entry).toMatchObject({ root: '/v/b', roots: ['/v/b', '/v/c'], file: '/v/b/Start here.md' })
    // The folder can come back (a drive that is not mounted): the set is as it was saved, and it is the last used.
    expect(store.get().vaultSets[0]).toMatchObject({ id: three.id, roots: ['/v/a', '/v/b', '/v/c'] })
    // Again: the window that opened without the folder is the set's window now. It is raised; no second one opens.
    expect(manager.openVaultSet(three.id)).toEqual({ opened: true, missing: ['/v/a'] })
    expect(created).toHaveLength(1)
    expect(created[0].win.focusCount).toBe(1)

    // The folder is back: the window on b and c is one vault short of the set, so the full set opens beside it.
    gone.clear()
    expect(manager.openVaultSet(three.id)).toEqual({ opened: true, missing: [] })
    expect(created).toHaveLength(2)
    expect(created[1].entry.roots).toEqual(['/v/a', '/v/b', '/v/c'])

    // Every folder of "Home" is gone: no window, no raise, and the set is neither changed nor made the last used.
    gone.add('/v/c').add('/v/d')
    const before = store.get()
    expect(manager.openVaultSet(home.id)).toEqual({ opened: false, missing: ['/v/c', '/v/d'] })
    expect(created).toHaveLength(2)
    expect(created.map((c) => c.win.focusCount)).toEqual([1, 0])
    expect(store.get()).toBe(before)
    expect(setIds()).toEqual([three.id, home.id, work.id])
    expect(work.roots).toEqual(['/v/b', '/v/a'])
  })
})

describe('createWindowManager: "last used" (YAZ-2555 D5 — a focus on a vault\'s window bumps it in the MRU)', () => {
  const mru = (): string[] => store.get().recents.map((r) => r.path)

  /** Stored windows restored over a seeded MRU (most recent first); the store's commits are counted from the restore on. */
  function seedFocus(windows: Array<[id: string, root: string | null]>, recents: string[]) {
    for (const [i, p] of [...recents].reverse().entries()) store.pushRecent(p, i)
    for (const [id, root] of windows) store.upsertWindow({ id, root, file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files', focusList: [], bounds: { x: 0, y: 0, width: 800, height: 600 } })
    const { host, created } = makeHost()
    const manager = createWindowManager(store, host)
    manager.restore('all')
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

  it('YAZ-2589 A1 (S10): the quit records the vault of the window in front, though its first focus did not bump it, and the store\'s flush writes it', async () => {
    const { manager, wins: [a, b], commits } = seedFocus([['a', '/v/a'], ['b', '/v/b']], ['/v/a', '/v/b'])
    for (const w of [a, b]) w.emit('focus') // each one's first focus: B is in front, and `recents` still says A
    expect(mru()).toEqual(['/v/a', '/v/b'])
    vi.setSystemTime(7000)
    const quit = manager.flushAllForQuit()
    expect(store.get().recents[0]).toEqual({ path: '/v/b', lastOpened: 7000 })
    for (const w of [b, a]) manager.handleFlushed(w.webContents)
    await quit
    manager.linkNotice("Can't open link: late") // a quit has no window on purpose: no Welcome window opens for it (A2)
    expect(mru()).toEqual(['/v/b', '/v/a'])
    expect(commits()).toBe(1)
    vi.useRealTimers()
    await store.flush() // `runQuitSequence` runs it after the windows
    const onDisk = JSON.parse(await readFile(path.join(dir, 'yaseendocs.json'), 'utf8')) as { recents: RecentRoots; windows: WindowEntry[] }
    expect(onDisk.recents.map((r) => r.path)).toEqual(['/v/b', '/v/a'])
    expect(onDisk.windows.map((w) => w.id)).toEqual(['a', 'b'])
  })

  it('YAZ-2602 A8 (S60): the quit records the ACTIVE vault of the window in front, the one that holds its active file; "Last vault" then brings back every saved window that shows that vault, and no other', async () => {
    const { manager, wins: [ab, b, a, c] } = seedFocus([['ab', '/v/a'], ['b', '/v/b'], ['a', '/v/a'], ['c', '/v/c']], ['/v/a', '/v/c', '/v/b'])
    store.upsertWindow({ ...store.get().windows[0], roots: ['/v/a', '/v/b'], file: '/v/b/x.md', tabs: ['/v/b/x.md'] })
    for (const w of [c, a, b, ab]) w.emit('focus') // each one's first focus: AB is in front, and `recents` still says A
    expect(mru()).toEqual(['/v/a', '/v/c', '/v/b'])
    const quit = manager.flushAllForQuit()
    expect(mru()).toEqual(['/v/b', '/v/a', '/v/c']) // AB works in its SECOND vault
    for (const w of [ab, b, a, c]) manager.handleFlushed(w.webContents)
    await quit
    const next = makeHost()
    createWindowManager(store, next.host).restore('last') // the next launch
    expect(next.created.map((w) => w.entry.id)).toEqual(['ab', 'b'])
    expect(store.get().windows.map((w) => w.id)).toEqual(['ab', 'b'])
  })

  it('YAZ-2589 A1: a quit with a Welcome window in front records no vault: `recents` stays as it is', () => {
    const { manager, wins: [a, welcome], commits } = seedFocus([['a', '/v/a'], ['w', null]], ['/v/b', '/v/a'])
    for (const w of [a, welcome]) w.emit('focus')
    void manager.flushAllForQuit()
    expect(mru()).toEqual(['/v/b', '/v/a'])
    expect(commits()).toBe(0)
  })

  it('S37: focus moving between two windows of ONE vault (a trailing slash on a stored root is the same vault), or onto a Welcome window, makes no write', () => {
    const { wins: [a1, a2, welcome], commits } = seedFocus([['a1', '/v/a'], ['a2', '/v/a/'], ['w', null]], ['/v/a', '/v/b'])
    for (const w of [a1, a2, welcome]) w.emit('focus') // each one's first focus
    for (const w of [a2, a1, welcome, a2]) w.emit('focus')
    expect(mru()).toEqual(['/v/a', '/v/b'])
    expect(commits()).toBe(0)
  })

  it('YAZ-2602 S60: a later focus on a window that shows several vaults bumps its ACTIVE vault — the one that holds its active file, else its first', () => {
    const { wins: [ab, c] } = seedFocus([['ab', '/v/a'], ['c', '/v/c']], ['/v/c', '/v/a', '/v/b'])
    const patch = (over: Partial<WindowEntry>) => store.upsertWindow({ ...store.get().windows[0], ...over })
    patch({ roots: ['/v/a', '/v/b'], file: '/v/b/sub/x.md', tabs: ['/v/b/sub/x.md'] })
    for (const w of [c, ab]) w.emit('focus') // each one's first focus
    expect(mru()).toEqual(['/v/c', '/v/a', '/v/b'])
    ab.emit('focus') // its active file is in its SECOND vault
    expect(mru()).toEqual(['/v/b', '/v/c', '/v/a'])
    patch({ file: null, tabs: [] }) // no tab: the first vault
    c.emit('focus')
    ab.emit('focus')
    expect(mru()).toEqual(['/v/a', '/v/c', '/v/b'])
    patch({ file: '/elsewhere/y.md', tabs: ['/elsewhere/y.md'] }) // a file in no vault of the window: the first vault
    c.emit('focus')
    ab.emit('focus')
    expect(mru()).toEqual(['/v/a', '/v/c', '/v/b'])
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
    expect(created[0].entry.focusList).toEqual([]) // a new window starts with an empty focus list (YAZ-2619)
    expect(store.get().windows).toEqual([created[0].entry])
  })

  it('duplicateWindow copies the complete workspace identity, then the two entries can diverge', () => {
    const rightPanel = { open: true, width: 560, items: ['/v/right-a.md', '/v/right-b.md'], expanded: '/v/right-b.md' }
    const from: WindowEntry = { id: 'w1', root: '/v', roots: ['/v'], file: '/v/a.md', tabs: ['/v/a.md', '/v/b.md'], rightPanel, sidebarCollapsed: true, sidebarLens: 'focus', focusList: ['/v/a', '/v/f.md'], bounds: { x: 100, y: 100, width: 800, height: 600 } }
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
    expect(entry.sidebarLens).toBe('focus') // the lens comes along too (YAZ-1628) — copied, not the Files default (YAZ-1846 G)
    // The focus list comes along BY VALUE (YAZ-2619 S26): the copy holds the same paths, in order, in a fresh array.
    expect(entry.focusList).toEqual(['/v/a', '/v/f.md'])
    expect(entry.focusList).not.toBe(from.focusList)
    expect(entry.bounds).toEqual({ x: 100 + WINDOW_CASCADE_PX, y: 100 + WINDOW_CASCADE_PX, width: 800, height: 600 })
    expect(store.get().windows).toContainEqual(entry)
    store.upsertWindow({ ...entry, sidebarCollapsed: false })
    expect(store.get().windows.find((w) => w.id === 'w1')?.sidebarCollapsed).toBe(true)
    expect(store.get().windows.find((w) => w.id === entry.id)?.sidebarCollapsed).toBe(false)
    // The two lists then change independently (S26): a write to the copy leaves the source's alone…
    store.upsertWindow({ ...entry, focusList: ['/v/new'] })
    expect(store.get().windows.find((w) => w.id === 'w1')?.focusList).toEqual(['/v/a', '/v/f.md'])
    from.focusList.push('/v/mutated') // …and mutating the source afterwards never reaches the copy
    expect(entry.focusList).toEqual(['/v/a', '/v/f.md'])
  })

  it('openWindow takes more vaults for the window: `root` first, each vault once — and a vault another window already shows is shown by both (YAZ-2602 S9)', () => {
    const { host, created } = makeHost()
    const manager = createWindowManager(store, host)
    manager.openWindow({ root: '/b', file: null })
    manager.openWindow({ root: '/a', file: '/b/x.md', roots: ['/b', '/a/', '/c', '/b/'] })
    manager.openWindow({ root: null, file: null, roots: ['/a'] }) // no first vault: a Welcome window
    expect(created.map((c) => c.entry.roots)).toEqual([['/b'], ['/a', '/b', '/c'], []])
    expect(created[1].entry).toMatchObject({ root: '/a', file: '/b/x.md', tabs: ['/b/x.md'] })
    expect(created.map((c) => c.win.focusCount)).toEqual([0, 0, 0]) // the first window on /b is not raised instead
    expect(store.get().windows).toEqual(created.map((c) => c.entry))
  })

  it('duplicateWindow copies every vault of the window, BY VALUE (YAZ-2602 S34)', () => {
    const from: WindowEntry = { id: 'w1', root: '/a', roots: ['/a', '/b'], file: '/b/x.md', tabs: ['/b/x.md'], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'files', focusList: [], bounds: { x: 100, y: 100, width: 800, height: 600 } }
    store.upsertWindow(from)
    const { host, created } = makeHost()
    createWindowManager(store, host).duplicateWindow(from)
    const entry = created[0].entry
    expect(entry).toMatchObject({ root: '/a', roots: ['/a', '/b'], file: '/b/x.md', tabs: ['/b/x.md'] })
    expect(entry.roots).not.toBe(from.roots)
    from.roots.push('/mutated') // mutating the source afterwards never reaches the copy
    expect(entry.roots).toEqual(['/a', '/b'])
    expect(store.get().windows.map((w) => w.roots)).toEqual([['/a', '/b'], ['/a', '/b']])
    store.upsertWindow({ ...entry, roots: ['/a'] }) // the copy drops a vault: the source keeps its own
    expect(store.get().windows.map((w) => w.roots)).toEqual([['/a', '/b'], ['/a']])
  })

  it('duplicating a Welcome window keeps root and file null — Welcome → Welcome (⌘⇧N, GRO-2167)', () => {
    const from: WindowEntry = { id: 'w1', root: null, roots: [], file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: true, sidebarLens: 'files', focusList: [], bounds: { x: 100, y: 100, width: 800, height: 600 } }
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
    const from: WindowEntry = { id: 'w1', root: '/v', roots: ['/v'], file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'files', focusList: [], bounds: { x: 640, y: 300, width: 800, height: 600 } }
    store.upsertWindow(from)
    const { host, created } = makeHost()
    createWindowManager(store, host).duplicateWindow(from)
    expect(created[0].entry.bounds).toEqual({ x: 640, y: 300, width: 800, height: 600 })
  })
})

// ---------- deep-link routing (E1, GRO-2171) ----------

describe('resolveLinkTarget (pure)', () => {
  const win = (id: string, root: string | null): WindowEntry => ({ id, root, roots: root === null ? [] : [root], file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'files', focusList: [], bounds: { x: 0, y: 0, width: 800, height: 600 } })
  const recents = (...paths: string[]): RecentRoots => paths.map((path, i) => ({ path, lastOpened: 100 - i }))

  it('picks the open window whose root contains the path (root = dirname included), and says its root', () => {
    expect(resolveLinkTarget('/v/a.md', [win('w1', '/v')], [])).toEqual({ kind: 'existing', id: 'w1', root: '/v' })
    expect(resolveLinkTarget('/v/sub/deep/a.md', [win('w1', '/v')], [])).toEqual({ kind: 'existing', id: 'w1', root: '/v' })
  })

  it('containment is by path segment: /a/b does not contain /a/bc/x.md', () => {
    expect(resolveLinkTarget('/a/bc/x.md', [win('w1', '/a/b')], [])).toEqual({ kind: 'new', root: '/a/bc', file: '/a/bc/x.md' })
  })

  it('the most specific (longest) containing root wins; a tie keeps the first in windows[]', () => {
    const windows = [win('w1', '/v'), win('w2', '/v/sub'), win('w3', '/v/sub')]
    expect(resolveLinkTarget('/v/sub/a.md', windows, [])).toEqual({ kind: 'existing', id: 'w2', root: '/v/sub' })
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
    expect(resolveLinkTarget('/v/sub/a.md', windows, [], '/v')).toEqual({ kind: 'existing', id: 'w1', root: '/v' })
    expect(resolveLinkTarget('/v/sub/a.md', [], [], '/v')).toEqual({ kind: 'new', root: '/v', file: '/v/sub/a.md' })
  })

  it('YAZ-2602 S57: a window is on EVERY vault it shows — a file in its second vault routes to it; the most specific vault wins across windows, a tie keeps the first window, and a rootOverride matches a window that shows that vault as its second', () => {
    const showing = (id: string, ...roots: string[]): WindowEntry => ({ ...win(id, roots[0]), roots })
    const ab = showing('ab', '/a', '/b')
    const deep = showing('deep', '/c', '/b/sub')
    expect(resolveLinkTarget('/b/x.md', [win('w0', '/other'), ab], recents('/b'))).toEqual({ kind: 'existing', id: 'ab', root: '/b' }) // not a new window on the recent /b
    expect(resolveLinkTarget('/bc/x.md', [ab], [])).toEqual({ kind: 'new', root: '/bc', file: '/bc/x.md' }) // by segment, for a second vault too
    // The most specific vault, wherever it sits in its window's list and in windows[].
    expect(resolveLinkTarget('/b/sub/x.md', [ab, deep], [])).toEqual({ kind: 'existing', id: 'deep', root: '/b/sub' })
    expect(resolveLinkTarget('/b/sub/x.md', [deep, ab], [])).toEqual({ kind: 'existing', id: 'deep', root: '/b/sub' })
    expect(resolveLinkTarget('/b/x.md', [deep, ab], [])).toEqual({ kind: 'existing', id: 'ab', root: '/b' })
    // A tie: the first window in windows[], whether the vault is its first or its second.
    expect(resolveLinkTarget('/b/x.md', [ab, win('b', '/b')], [])).toEqual({ kind: 'existing', id: 'ab', root: '/b' })
    expect(resolveLinkTarget('/b/x.md', [win('b', '/b'), ab], [])).toEqual({ kind: 'existing', id: 'b', root: '/b' })
    // The override pins /b: the window that shows /b, not the more specific /b/sub.
    expect(resolveLinkTarget('/b/sub/x.md', [deep, ab], [], '/b/')).toEqual({ kind: 'existing', id: 'ab', root: '/b' })
    expect(resolveLinkTarget('/b/sub/x.md', [deep], [], '/b')).toEqual({ kind: 'new', root: '/b', file: '/b/sub/x.md' })
  })

  it('a rootOverride that does not contain the path is ignored', () => {
    expect(resolveLinkTarget('/v/a.md', [win('w1', '/v')], [], '/w')).toEqual({ kind: 'existing', id: 'w1', root: '/v' })
    expect(resolveLinkTarget('/v/a.md', [], [], null)).toEqual({ kind: 'new', root: '/v', file: '/v/a.md' })
  })
})

describe('createWindowManager: routeToFile (E1)', () => {
  /** One folder window on /v plus a Welcome window — the routing fixture. No path is a folder unless a test says so (YAZ-2556 D1: `routeToFile` asks `dirExists` first). */
  function seedRouting(exists: (path: string) => boolean = () => true, dirExists: (path: string) => boolean = () => false) {
    store.upsertWindow({ id: 'w1', root: '/v', file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files', focusList: [], bounds: { x: 10, y: 10, width: 800, height: 600 } })
    store.upsertWindow({ id: 'w2', root: null, file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files', focusList: [], bounds: { x: 40, y: 40, width: 800, height: 600 } })
    const { host, created } = makeHost([AREA], exists, dirExists)
    const manager = createWindowManager(store, host)
    manager.restore('all')
    // Both pages have loaded: a link push goes out at once (YAZ-2589 A2 holds it until then).
    for (const c of created) manager.handleLinkReady(c.win.webContents)
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
    store.upsertWindow({ id: 'w3', root: '/v/deeper', file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files', focusList: [], bounds: { x: 20, y: 20, width: 800, height: 600 } })
    manager.routeToFile('/v/deeper/n.md') // most specific root wins → resolves to the dead w3
    expect(created).toHaveLength(3)
    expect(created[2].entry.id).not.toBe('w3') // a fresh window, not a resurrection of the dead entry
    expect(created[2].entry.root).toBe('/v/deeper')
    expect(created[2].entry.file).toBe('/v/deeper/n.md')
  })

  it('YAZ-2602 S57/S58: a file in the SECOND vault of a window opens as a tab there, and that vault\'s folder from outside raises the window — no new window either way', () => {
    store.upsertWindow({ id: 'ab', root: '/a', roots: ['/a', '/b'], file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files', focusList: [], bounds: { x: 10, y: 10, width: 800, height: 600 } })
    const { host, created } = makeHost([AREA], (p) => p !== '/b', (p) => p === '/b' || p === '/b/')
    const manager = createWindowManager(store, host)
    manager.restore('all')
    const ab = created[0].win
    manager.handleLinkReady(ab.webContents) // the page has loaded: a link push goes out at once (YAZ-2589 A2)
    manager.routeToFile('/b/sub/x.md')
    expect(ab.focusCount).toBe(1)
    expect(ab.webContents.send.mock.calls).toEqual([[CONTRACT.link.onOpenFile.channel, '/b/sub/x.md']])
    manager.routeToFile('/b/') // the folder itself, as a link keeps it
    expect(ab.focusCount).toBe(2)
    expect(ab.webContents.send).toHaveBeenCalledTimes(1) // no file to open, no notice
    expect(store.get().recents[0]?.path).toBe('/b')
    expect(created).toHaveLength(1)
    expect(store.get().windows).toHaveLength(1)
  })

  it('YAZ-2602: a stored entry with no live window falls back to a fresh window on the vault OF THAT ENTRY that holds the file, not on its first', () => {
    const { manager, created } = seedRouting()
    store.upsertWindow({ id: 'w3', root: '/q', roots: ['/q', '/v/deeper'], file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files', focusList: [], bounds: { x: 20, y: 20, width: 800, height: 600 } })
    manager.routeToFile('/v/deeper/n.md') // the most specific vault is the dead w3's second
    expect(created).toHaveLength(3)
    expect(created[2].entry).toMatchObject({ root: '/v/deeper', roots: ['/v/deeper'], file: '/v/deeper/n.md' })
  })

  it('S6: an unsupported path (a path that does not exist and names no supported file kind is one) opens nothing and reports “unsupported file type” passively', () => {
    const { manager, created, w1 } = seedRouting()
    manager.routeToFile('/v/archive.zip')
    expect(created).toHaveLength(2)
    expect(w1.focusCount).toBe(1)
    const notices = sentOn(w1, CONTRACT.link.onNotice.channel)
    expect(notices).toEqual([[CONTRACT.link.onNotice.channel, "Can't open /v/archive.zip: unsupported file type"]])
    expect(sentOn(w1, CONTRACT.link.onOpenFile.channel)).toHaveLength(0)
  })

  it('S6: a missing file (host.exists false) reports “file not found” the same way: no window, no dialog', () => {
    const { manager, created, w1 } = seedRouting(() => false)
    manager.routeToFile('/v/gone.md')
    expect(created).toHaveLength(2)
    expect(sentOn(w1, CONTRACT.link.onNotice.channel)).toEqual([[CONTRACT.link.onNotice.channel, "Can't open /v/gone.md: file not found"]])
    expect(sentOn(w1, CONTRACT.link.onOpenFile.channel)).toHaveLength(0)
  })

  // ---------- a FOLDER from outside (YAZ-2556 D1): "Open Folder…" on it, through the one open-recent door ----------

  /** What a real folder answers: not a regular file, and a directory. */
  const seedFolder = (folder: string) => seedRouting((p) => p !== folder, (p) => p === folder)

  it('S1: a vault\'s folder, and the vault has a window → that window is restored if minimized and raised; nothing new opens, nothing is sent to it', () => {
    const { manager, created, w1, w2 } = seedFolder('/v')
    w1.minimized = true
    manager.routeToFile('/v')
    expect(w1.isMinimized()).toBe(false)
    expect(w1.focusCount).toBe(1)
    expect(w2.focusCount).toBe(0)
    expect(created).toHaveLength(2)
    expect(w1.webContents.send).not.toHaveBeenCalled() // no file to open, no notice
    expect(store.get().recents[0]?.path).toBe('/v') // the door's bump: the vault is "last used"
  })

  it('S2: a known vault\'s folder with no window → a new window on its remembered last file', () => {
    const { manager, created, w1 } = seedFolder('/w')
    store.pushRecent('/w', 1)
    store.setFolder('/w', { lastFile: '/w/Start here.md' })
    manager.routeToFile('/w')
    expect(created).toHaveLength(3)
    expect(created[2].entry.root).toBe('/w')
    expect(created[2].entry.file).toBe('/w/Start here.md')
    expect(w1.focusCount).toBe(0)
  })

  it('S2: the same folder with a trailing slash (a link keeps it) is the SAME vault: the window is on the stored root and its last file, and the recents hold it once', () => {
    const { manager, created } = seedRouting(() => false, (p) => p === '/w' || p === '/w/')
    store.pushRecent('/w', 1)
    store.setFolder('/w', { lastFile: '/w/Start here.md' })
    manager.routeToFile('/w/')
    expect(created).toHaveLength(3)
    expect(created[2].entry.root).toBe('/w')
    expect(created[2].entry.file).toBe('/w/Start here.md')
    expect(store.get().recents.map((r) => r.path)).toEqual(['/w'])
  })

  it('S4: a folder the app never opened → it opens as a vault, on no file, and enters the recents', () => {
    const { manager, created } = seedFolder('/elsewhere/fresh')
    manager.routeToFile('/elsewhere/fresh')
    expect(created).toHaveLength(3)
    expect(created[2].entry.root).toBe('/elsewhere/fresh')
    expect(created[2].entry.file).toBeNull()
    expect(store.get().recents.map((r) => r.path)).toEqual(['/elsewhere/fresh'])
    expect(store.get().windows).toContainEqual(created[2].entry)
  })

  it('S5: a folder INSIDE an open vault → its own vault window; the vault that contains it is not raised and is sent nothing — a `?root=` that names that vault is ignored', () => {
    const { manager, created, w1 } = seedFolder('/v/sub')
    manager.routeToFile('/v/sub', '/v')
    expect(created).toHaveLength(3)
    expect(created[2].entry.root).toBe('/v/sub')
    expect(w1.focusCount).toBe(0)
    expect(w1.webContents.send).not.toHaveBeenCalled()
    expect(store.get().windows.find((w) => w.id === 'w1')?.root).toBe('/v')
  })

  it('a folder whose name ends like a supported file is a folder all the same: it opens as a vault (the regular-file probe refused it before YAZ-2556 D1)', () => {
    const { manager, created, w1 } = seedFolder('/v/folder.pdf')
    manager.routeToFile('/v/folder.pdf')
    expect(created).toHaveLength(3)
    expect(created[2].entry.root).toBe('/v/folder.pdf')
    expect(w1.webContents.send).not.toHaveBeenCalled()
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
