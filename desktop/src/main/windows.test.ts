import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { defaultRightPanelIdentity, type PageView, type RecentRoots, type WindowBounds, type WindowEntry } from '@shared/types'
import { CONTRACT, SPECIAL } from '@shared/ipc'
import { createStore, type Store } from './store'
import {
  BOUNDS_DEBOUNCE_MS,
  FLUSH_TIMEOUT_MS,
  TEAR_OFF_GRAB,
  WINDOW_CASCADE_PX,
  besideFilesBounds,
  clampBounds,
  createWindowManager,
  filesPreviewBounds,
  filesWindowBounds,
  pickFilesTarget,
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
  showCount = 0
  moveTopCount = 0
  /** Every `setBounds` call (YAZ-3357 D3): the bounds and whether it animates. */
  setBoundsCalls: Array<[WindowBounds, boolean | undefined]> = []
  private listeners = new Map<string, Array<(...args: unknown[]) => void>>()
  constructor(public bounds: WindowBounds) {}
  focus(): void {
    this.focusCount++
  }
  show(): void {
    this.showCount++
  }
  moveTop(): void {
    this.moveTopCount++
  }
  /** Like Electron's: the window takes the bounds, and `resize` follows. */
  setBounds(bounds: WindowBounds, animate?: boolean): void {
    this.setBoundsCalls.push([{ ...bounds }, animate])
    this.bounds = { ...bounds }
    this.emit('resize')
  }
  /** A 28 px title bar. */
  getContentBounds(): WindowBounds {
    return { x: this.bounds.x, y: this.bounds.y + 28, width: this.bounds.width, height: this.bounds.height - 28 }
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
  emit(event: 'move' | 'resize' | 'focus' | 'minimize' | 'restore'): void {
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
): { host: WindowHost; created: Array<{ entry: WindowEntry; win: FakeWindow; hidden?: true }>; previews: Array<[FakeWindow, WindowBounds | null]>; cursor: { x: number; y: number } } {
  const created: Array<{ entry: WindowEntry; win: FakeWindow; hidden?: true }> = []
  const previews: Array<[FakeWindow, WindowBounds | null]> = []
  /** Where the pointer is (YAZ-3637): a test moves it. */
  const cursor = { x: 0, y: 0 }
  const host: WindowHost = {
    create(entry, opts) {
      const win = new FakeWindow({ ...entry.bounds })
      created.push({ entry, win, ...(opts?.hidden === true ? { hidden: true as const } : {}) })
      return win as ManagedWindow
    },
    workAreas: () => areas,
    cursorPoint: () => ({ ...cursor }),
    exists,
    dirExists,
    showPreview: (win, bounds) => void previews.push([win as unknown as FakeWindow, bounds]),
  }
  return { host, created, previews, cursor }
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
  store.upsertWindow({ id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md'], sidebarCollapsed: false, sidebarLens: 'files', bounds: { x: 10, y: 10, width: 800, height: 600 } })
  store.upsertWindow({ id: 'w2', root: null, file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files', bounds: { x: 40, y: 40, width: 800, height: 600 } })
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

  it('S10 (YAZ-2663): a launch that restores windows adds no use to the open history — also for a window that the launch moves back onto a display, which is a write of that window', () => {
    const shown = { tabs: ['/v/a.md'], sidebarCollapsed: false, sidebarLens: 'files' as const }
    store.upsertWindow({ id: 'w1', root: '/v', file: '/v/a.md', ...shown, bounds: { x: 10, y: 10, width: 800, height: 600 } }, '/v/a.md', 1000)
    store.upsertWindow({ id: 'w2', root: '/v', file: '/v/a.md', ...shown, bounds: { x: 9000, y: 9000, width: 800, height: 600 } })
    const { host, created } = makeHost()
    createWindowManager(store, host).restore('all')
    expect(created.map((c) => c.entry.file)).toEqual(['/v/a.md', '/v/a.md'])
    expect(store.get().windows[1].bounds).toEqual({ x: 640, y: 300, width: 800, height: 600 }) // the launch did write `w2`
    expect(store.get().folders['/v'].opens).toEqual({ '/v/a.md': { score: 1, last: 1000 } })
  })

  it('registers every window it creates so IPC can resolve its caller', () => {
    const { manager, w1 } = seedTwo()
    expect(manager.idFor(w1.webContents)).toBe('w1')
  })
})

describe('createWindowManager: bounds', () => {
  it('saves moved/resized bounds once per burst (debounced), onto the entry as it is now', () => {
    store.upsertWindow({ id: 'w1', root: null, file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files', bounds: { x: 10, y: 10, width: 800, height: 600 } })
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
    expect(store.get().windows[0]).toEqual({ id: 'w1', root: '/v', roots: ['/v'], file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'files', bounds: { x: 50, y: 60, width: 900, height: 700 } })
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
    store.upsertWindow({ id: 'w1', root: '/v', file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files', bounds: { x: 10, y: 10, width: 800, height: 600 } })
    const { host, created } = makeHost()
    const manager = createWindowManager(store, host)
    manager.restore('all')
    const win = created[0].win
    win.bounds = { x: 200, y: 100, width: 800, height: 600 }
    win.close()
    manager.handleFlushed(win.webContents)
    await vi.advanceTimersByTimeAsync(0)
    expect(win.isDestroyed()).toBe(true)
    expect(store.get().windows).toEqual([{ id: 'w1', root: '/v', roots: ['/v'], file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'files', bounds: { x: 200, y: 100, width: 800, height: 600 } }])
    expect(store.get().recents.map((r) => r.path)).toEqual(['/v', '/v/other'])
  })

  it('YAZ-2602 A8: the last window to close shows two vaults and works in the second → that vault is the "last vault"', async () => {
    store.pushRecent('/v/b', 1)
    store.pushRecent('/v/a', 2)
    store.upsertWindow({ id: 'ab', root: '/v/a', roots: ['/v/a', '/v/b'], file: '/v/b/x.md', tabs: ['/v/b/x.md'], sidebarCollapsed: false, sidebarLens: 'files', bounds: { x: 10, y: 10, width: 800, height: 600 } })
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
  const entry = (id: string, root: string | null): Omit<WindowEntry, 'rightPanel'> => ({ id, root, roots: root === null ? [] : [root], file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files', bounds: { x: 0, y: 0, width: 800, height: 600 } })

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

  it('D1 (S2, S18): asked for a vault with no saved window → nothing comes back and no Welcome window opens; the request then opens the vault in a new window, blank (YAZ-3487 D7), and a second request for that vault waits for that window\'s page', () => {
    const { manager, created } = seedSaved(['/v/b', '/v/a'], (p) => p === '/v/a/note.md', (p) => p === '/v/a' || p === '/v/a/')
    store.removeWindow('a')
    manager.restore([manager.rootFor('/v/a/')!])
    expect(created).toHaveLength(0)
    expect(store.get().windows).toEqual([])
    manager.routeToFile('/v/a/')
    expect(created.map((c) => [c.entry.root, c.entry.file])).toEqual([['/v/a', null]])
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
  const entry = (id: string, root: string): Omit<WindowEntry, 'rightPanel'> => ({ id, root, roots: [root], file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files', bounds: { x: 0, y: 0, width: 800, height: 600 } })

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
  it('a live folder: bumps it to the top of the MRU, opens a window on it BLANK — its remembered last file stays unread (YAZ-3487 D7, was D2) — returns true', () => {
    store.pushRecent('/v/other', 1)
    store.pushRecent('/v/notes', 2)
    store.setFolder('/v/other', { lastFile: '/v/other/Start here.md' })
    const { host, created } = makeHost()
    const manager = createWindowManager(store, host)
    expect(manager.openRecentBeside('/v/other')).toBe(true)
    expect(created).toHaveLength(1)
    expect(created[0].entry.root).toBe('/v/other')
    expect(created[0].entry.file).toBeNull()
    expect(created[0].entry.tabs).toEqual([])
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
    store.upsertWindow({ id: 'w1', root: '/v/other/', file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'favorites', bounds: { x: 0, y: 0, width: 800, height: 600 } })
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
    const entry = (id: string) => ({ id, root: '/v/other', file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files' as const, bounds: { x: 0, y: 0, width: 800, height: 600 } })
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
    const entry = (id: string) => ({ id, root: '/v/other', file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files' as const, bounds: { x: 0, y: 0, width: 800, height: 600 } })
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
    const entry = (id: string, ...roots: string[]) => ({ id, root: roots[0], roots, file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files' as const, bounds: { x: 0, y: 0, width: 800, height: 600 } })
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
    store.upsertWindow({ id: 'w1', root: '/v/other', file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files', bounds: { x: 0, y: 0, width: 800, height: 600 } })
    const { host, created } = makeHost()
    const manager = createWindowManager(store, host)
    manager.restore('all')
    created[0].win.destroy() // `closed` fires: the manager forgets the live window and its focus rank
    expect(manager.openRecentBeside('/v/other')).toBe(true)
    expect(created).toHaveLength(2)
    expect(created[1].entry.root).toBe('/v/other')
  })

  it('a SUBFOLDER of an open vault is its own vault: a new window on it, the parent vault untouched (YAZ-1914 S12)', () => {
    store.upsertWindow({ id: 'w1', root: '/v/notes', file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files', bounds: { x: 0, y: 0, width: 800, height: 600 } })
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

describe('createWindowManager: openAlone (YAZ-2858 D1 — "Open by itself": a window with this vault alone)', () => {
  const entry = (id: string, ...roots: string[]) => ({ id, root: roots[0], roots, file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files' as const, bounds: { x: 0, y: 0, width: 800, height: 600 } })

  it('S1: the vault is open ONLY in a workspace window → a new window with it alone, blank (YAZ-3487 D7); the workspace window is not raised and does not change', () => {
    store.upsertWindow(entry('ab', '/v/a', '/v/b'))
    store.setFolder('/v/b', { lastFile: '/v/b/Start here.md' })
    const { host, created } = makeHost()
    const manager = createWindowManager(store, host)
    manager.restore('all')
    const ab = created[0].win
    const before = store.get().windows[0]
    expect(manager.openAlone('/v/b')).toBe(true)
    expect(created).toHaveLength(2)
    expect(created[1].entry.root).toBe('/v/b')
    expect(created[1].entry.roots).toEqual(['/v/b'])
    expect(created[1].entry.file).toBeNull() // blank (YAZ-3487 D7)
    expect(created[1].entry.tabs).toEqual([])
    expect(ab.focusCount).toBe(0)
    expect(store.get().windows[0]).toEqual(before)
  })

  it('S2: a window already shows the vault alone → that window is raised (minimized too), nothing new opens; a trailing slash is the same vault', () => {
    store.upsertWindow(entry('ab', '/v/a', '/v/b'))
    store.upsertWindow(entry('b', '/v/b/'))
    const { host, created } = makeHost()
    const manager = createWindowManager(store, host)
    manager.restore('all')
    const [ab, b] = created.map((x) => x.win)
    b.minimized = true
    expect(manager.openAlone('/v/b')).toBe(true)
    expect(created).toHaveLength(2)
    expect(b.focusCount).toBe(1)
    expect(b.minimized).toBe(false)
    expect(ab.focusCount).toBe(0)
    expect(manager.openAlone('/v/b/')).toBe(true)
    expect(created).toHaveLength(2)
    expect(b.focusCount).toBe(2)
  })

  it('S3: several windows show the vault alone → all of them are raised, the one focused last ends on top (the raiseWindows rule)', () => {
    store.upsertWindow(entry('b1', '/v/b'))
    store.upsertWindow(entry('b2', '/v/b'))
    store.upsertWindow(entry('ab', '/v/a', '/v/b'))
    const { host, created } = makeHost()
    const manager = createWindowManager(store, host)
    manager.restore('all')
    const [b1, b2, ab] = created.map((x) => x.win)
    const order: string[] = []
    b1.focus = () => order.push('b1')
    b2.focus = () => order.push('b2')
    ab.focus = () => order.push('ab')
    b2.emit('focus')
    b1.emit('focus')
    expect(manager.openAlone('/v/b')).toBe(true)
    expect(order).toEqual(['b2', 'b1'])
    expect(created).toHaveLength(3)
  })

  it('S4: the vault is in no window → a new window on it, as the plain open-recent door opens it', () => {
    store.upsertWindow(entry('a', '/v/a'))
    const { host, created } = makeHost()
    const manager = createWindowManager(store, host)
    manager.restore('all')
    expect(manager.openAlone('/v/fresh')).toBe(true)
    expect(created).toHaveLength(2)
    expect(created[1].entry.root).toBe('/v/fresh')
    expect(created[1].entry.roots).toEqual(['/v/fresh'])
    expect(created[1].entry.file).toBeNull()
    expect(created[1].entry.tabs).toEqual([])
  })

  it('S5: a dead folder → pruned from the MRU, no window, returns false', () => {
    store.pushRecent('/v/gone', 1)
    store.pushRecent('/v/notes', 2)
    const { host, created } = makeHost([AREA], () => true, (p) => p !== '/v/gone')
    expect(createWindowManager(store, host).openAlone('/v/gone')).toBe(false)
    expect(created).toHaveLength(0)
    expect(store.get().windows).toEqual([])
    expect(store.get().recents.map((r) => r.path)).toEqual(['/v/notes'])
  })

  it('S6: each use bumps the vault to the top of the MRU; already on top → no write', () => {
    store.pushRecent('/v/b', 1)
    store.pushRecent('/v/a', 2)
    store.upsertWindow(entry('b', '/v/b'))
    const { host } = makeHost()
    const manager = createWindowManager(store, host)
    manager.restore('all')
    expect(manager.openAlone('/v/b')).toBe(true)
    expect(store.get().recents.map((r) => r.path)).toEqual(['/v/b', '/v/a'])
    const before = store.get()
    expect(manager.openAlone('/v/b')).toBe(true)
    expect(store.get()).toBe(before)
  })

  it('S7: no saved workspace changes, and the window with the vault alone never stands for the workspace (YAZ-2602 S70)', () => {
    const work = store.saveVaultSet('Work', ['/v/a', '/v/b'], 1)
    store.upsertWindow(entry('ab', '/v/a', '/v/b'))
    const { host, created } = makeHost()
    const manager = createWindowManager(store, host)
    manager.restore('all')
    const sets = store.get().vaultSets
    expect(manager.openAlone('/v/b')).toBe(true)
    expect(store.get().vaultSets).toBe(sets)
    const [ab, b] = created.map((x) => x.win)
    expect(manager.openVaultSet(work!.id).opened).toBe(true)
    expect(ab.focusCount).toBe(1)
    expect(b.focusCount).toBe(0)
    expect(created).toHaveLength(2)
  })

  it('S8: after S1, the plain open-recent door still raises BOTH windows that show the vault, the one focused last on top (YAZ-2602 D6 stays)', () => {
    store.upsertWindow(entry('ab', '/v/a', '/v/b'))
    const { host, created } = makeHost()
    const manager = createWindowManager(store, host)
    manager.restore('all')
    expect(manager.openAlone('/v/b')).toBe(true)
    const [ab, b] = created.map((x) => x.win)
    const order: string[] = []
    ab.focus = () => order.push('ab')
    b.focus = () => order.push('b')
    b.emit('focus')
    ab.emit('focus')
    expect(manager.openRecentBeside('/v/b')).toBe(true)
    expect(order).toEqual(['b', 'ab'])
    order.length = 0
    b.emit('focus')
    expect(manager.openRecentBeside('/v/b')).toBe(true)
    expect(order).toEqual(['ab', 'b'])
    expect(created).toHaveLength(2)
  })
})

describe('createWindowManager: openVaultSet (YAZ-2602 D8 — a saved set of vaults opens as ONE window)', () => {
  const entry = (id: string, ...roots: string[]) => ({ id, root: roots[0], roots, file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files' as const, bounds: { x: 0, y: 0, width: 800, height: 600 } })
  /** Three saved sets; "Work" (`/v/b`, `/v/a`, in that order) is the least recently used. */
  const seedSets = () => {
    const work = store.saveVaultSet('Work', ['/v/b', '/v/a'], 1)
    const home = store.saveVaultSet('Home', ['/v/c', '/v/d'], 2)
    const three = store.saveVaultSet('Three', ['/v/a', '/v/b', '/v/c'], 3)
    if (work === null || home === null || three === null) throw new Error('the store refused a set')
    return { work, home, three }
  }
  const setIds = () => store.get().vaultSets.map((s) => s.id)

  it('S65: no window shows exactly the set → ONE new window on its vaults in the SAVED order, blank (YAZ-3487 D7); the set becomes the last used', () => {
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
    expect(created[3].entry).toMatchObject({ root: '/v/b', roots: ['/v/b', '/v/a'], file: null, tabs: [] }) // blank (YAZ-3487 D7)
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
    expect(created[0].entry).toMatchObject({ root: '/v/b', roots: ['/v/b', '/v/c'], file: null }) // blank (YAZ-3487 D7)
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
    for (const [id, root] of windows) store.upsertWindow({ id, root, file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files', bounds: { x: 0, y: 0, width: 800, height: 600 } })
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
    expect(created[0].entry).not.toHaveProperty('focusList') // the focus list is the vault's (YAZ-2702 S10): the window reads it, and holds none
    expect(store.get().windows).toEqual([created[0].entry])
  })

  it('duplicateWindow (⌘⇧N) opens on the same vault with NO tab and an empty right panel — the sidebar comes along — then the two entries can diverge (YAZ-3343 replaced the copy of the tabs)', () => {
    const rightPanel = { open: true, width: 560, items: ['/v/right-a.md', '/v/right-b.md'], expanded: '/v/right-b.md' }
    const from: WindowEntry = { id: 'w1', root: '/v', roots: ['/v'], file: '/v/a.md', tabs: ['/v/a.md', '/v/b.md'], rightPanel, sidebarCollapsed: true, sidebarLens: 'focus', bounds: { x: 100, y: 100, width: 800, height: 600 } }
    store.upsertWindow(from)
    const { host, created } = makeHost()
    createWindowManager(store, host).duplicateWindow(from)
    expect(created).toHaveLength(1)
    const entry = created[0].entry
    expect(entry.id).not.toBe('w1')
    expect(entry.root).toBe('/v')
    expect(entry.file).toBeNull()
    expect(entry.tabs).toEqual([]) // no tab: it boots on the blank tab (YAZ-3343 D35)
    expect(entry.rightPanel.items).toEqual([])
    expect(entry.sidebarCollapsed).toBe(true)
    expect(entry.sidebarLens).toBe('focus') // the lens comes along too (YAZ-1628) — copied, not the Files default (YAZ-1846 G)
    // No focus list comes along (YAZ-2702 S10, which overturns YAZ-2619 S26): the copy reads the vault's list, as the source does.
    expect(entry).not.toHaveProperty('focusList')
    expect(entry.bounds).toEqual({ x: 100 + WINDOW_CASCADE_PX, y: 100 + WINDOW_CASCADE_PX, width: 800, height: 600 })
    expect(store.get().windows).toContainEqual(entry)
    store.upsertWindow({ ...entry, sidebarCollapsed: false })
    expect(store.get().windows.find((w) => w.id === 'w1')?.sidebarCollapsed).toBe(true)
    expect(store.get().windows.find((w) => w.id === entry.id)?.sidebarCollapsed).toBe(false)
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
    const from: WindowEntry = { id: 'w1', root: '/a', roots: ['/a', '/b'], file: '/b/x.md', tabs: ['/b/x.md'], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'files', bounds: { x: 100, y: 100, width: 800, height: 600 } }
    store.upsertWindow(from)
    const { host, created } = makeHost()
    createWindowManager(store, host).duplicateWindow(from)
    const entry = created[0].entry
    expect(entry).toMatchObject({ root: '/a', roots: ['/a', '/b'], file: null, tabs: [] })
    expect(entry.roots).not.toBe(from.roots)
    from.roots.push('/mutated') // mutating the source afterwards never reaches the copy
    expect(entry.roots).toEqual(['/a', '/b'])
    expect(store.get().windows.map((w) => w.roots)).toEqual([['/a', '/b'], ['/a', '/b']])
    store.upsertWindow({ ...entry, roots: ['/a'] }) // the copy drops a vault: the source keeps its own
    expect(store.get().windows.map((w) => w.roots)).toEqual([['/a', '/b'], ['/a']])
  })

  it('duplicating a Welcome window keeps root and file null — Welcome → Welcome (⌘⇧N, GRO-2167)', () => {
    const from: WindowEntry = { id: 'w1', root: null, roots: [], file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: true, sidebarLens: 'files', bounds: { x: 100, y: 100, width: 800, height: 600 } }
    store.upsertWindow(from)
    const { host, created } = makeHost()
    createWindowManager(store, host).duplicateWindow(from)
    expect(created).toHaveLength(1)
    expect(created[0].entry.id).not.toBe('w1')
    expect(created[0].entry.root).toBeNull()
    expect(created[0].entry.file).toBeNull()
    expect(store.get().windows.map((w) => w.id)).toEqual(['w1', created[0].entry.id])
  })

  it('popOut opens ONE tab of the window in its own window: every vault, the lens, the sidebar hidden, the right panel shut (YAZ-2933 D3, D5)', () => {
    const rightPanel = { open: true, width: 560, items: ['/b/right.md'], expanded: '/b/right.md' }
    const from: WindowEntry = { id: 'w1', root: '/a', roots: ['/a', '/b'], file: '/a/x.md', tabs: ['/a/x.md', '/b/y.md'], rightPanel, sidebarCollapsed: false, sidebarLens: 'focus', bounds: { x: 100, y: 100, width: 800, height: 600 } }
    store.upsertWindow(from)
    const { host, created } = makeHost()
    createWindowManager(store, host).popOut(from, '/b/y.md')
    expect(created).toHaveLength(1)
    const entry = created[0].entry
    expect(entry).toEqual({ id: entry.id, root: '/a', roots: ['/a', '/b'], file: '/b/y.md', tabs: ['/b/y.md'], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: true, sidebarLens: 'focus', bounds: { x: 100 + WINDOW_CASCADE_PX, y: 100 + WINDOW_CASCADE_PX, width: 800, height: 600 } })
    expect(entry.id).not.toBe('w1')
    expect(entry.roots).not.toBe(from.roots) // by value, as ⌘⇧N (YAZ-2602 S34)
    // The source is untouched here: the renderer closes its own tab once the new window is there (D2).
    expect(store.get().windows).toEqual([from, entry])
  })

  it('popOut STORES the tab\'s display name in the new window\'s strip; the source\'s own strip stays behind; no name, no strip (YAZ-3057 D3, S12, S13)', () => {
    const sourceStrip = [{ path: '/a/x.md', name: 'Source' }, { path: '/a/x.md', active: true as const }, { path: '/a/y.md' }]
    const from: WindowEntry = { id: 'w1', root: '/a', roots: ['/a'], file: '/a/x.md', tabs: ['/a/x.md', '/a/y.md'], tabStrip: sourceStrip, rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'files', bounds: { x: 100, y: 100, width: 800, height: 600 } }
    store.upsertWindow(from)
    const { host, created } = makeHost()
    const manager = createWindowManager(store, host)
    manager.popOut(from, '/a/x.md', { name: 'Outline' })
    manager.popOut(from, '/a/y.md', {})
    const [one, two] = created.map((c) => c.entry)
    expect(one.tabStrip).toEqual([{ path: '/a/x.md', name: 'Outline' }])
    expect(two).not.toHaveProperty('tabStrip')
    // In the store, so every identity read gets it again: a reload and a restart keep the name.
    expect(store.get().windows.find((w) => w.id === one.id)?.tabStrip).toEqual([{ path: '/a/x.md', name: 'Outline' }])
    expect(store.get().windows.find((w) => w.id === 'w1')?.tabStrip).toEqual(sourceStrip)
  })

  it('popOut carries the page view and the display name together: the view is taken once, the name is stored (YAZ-2951 D2, YAZ-3057 D3)', () => {
    const from: WindowEntry = { id: 'w1', root: '/a', roots: ['/a'], file: '/a/x.md', tabs: ['/a/x.md'], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'files', bounds: { x: 100, y: 100, width: 800, height: 600 } }
    store.upsertWindow(from)
    const { host, created } = makeHost()
    const manager = createWindowManager(store, host)
    const view = { scrollTop: 10, zoomKey: null, folds: [], magnification: 100 }
    manager.popOut(from, '/a/x.md', { view, name: 'Outline' })
    const { id, tabStrip } = created[0].entry
    expect(manager.takeStartView(id)).toEqual({ path: '/a/x.md', view })
    expect(tabStrip).toEqual([{ path: '/a/x.md', name: 'Outline' }])
    expect(manager.takeStartView(id)).toBeUndefined()
  })

  it('the cascade is clamped: duplicating a window at the display edge stays fully on-screen (GRO-2167)', () => {
    // Bottom-right corner of the 1440×900 area: the +24/+24 cascade would hang off the display.
    const from: WindowEntry = { id: 'w1', root: '/v', roots: ['/v'], file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'files', bounds: { x: 640, y: 300, width: 800, height: 600 } }
    store.upsertWindow(from)
    const { host, created } = makeHost()
    createWindowManager(store, host).duplicateWindow(from)
    expect(created[0].entry.bounds).toEqual({ x: 640, y: 300, width: 800, height: 600 })
  })
})

describe('createWindowManager: moveTo hands a tab to an open window (YAZ-3091 D1, D2)', () => {
  /** w1 shows /a and /b, w2 shows /c only, w3 is a Welcome window. Nothing has listened yet: link pushes are held. */
  function seedMove() {
    store.upsertWindow({ id: 'w1', root: '/a', roots: ['/a', '/b'], file: '/a/x.md', tabs: ['/a/x.md'], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'files', bounds: { x: 10, y: 10, width: 800, height: 600 } })
    store.upsertWindow({ id: 'w2', root: '/c', roots: ['/c'], file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'files', bounds: { x: 40, y: 40, width: 800, height: 600 } })
    store.upsertWindow({ id: 'w3', root: null, roots: [], file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'files', bounds: { x: 70, y: 70, width: 800, height: 600 } })
    const { host, created } = makeHost()
    const manager = createWindowManager(store, host)
    manager.restore('all')
    const [w1, w2, w3] = created.map((c) => c.win)
    return { manager, w1, w2, w3, created }
  }

  it('YAZ-3343, the tab board\'s "New window": a window on the caller\'s vaults with no tab, cascaded, built HIDDEN — every window hears it is; its id is answered', () => {
    const { manager, w1, created } = seedMove()
    const from = store.get().windows.find((w) => w.id === 'w1')!
    const id = manager.openBehind(from)
    const made = created.at(-1)!
    expect(made.entry).toMatchObject({ id, root: '/a', roots: ['/a', '/b'], file: null, tabs: [], bounds: { x: 10 + WINDOW_CASCADE_PX, y: 10 + WINDOW_CASCADE_PX } })
    expect(made.entry.name).toBeUndefined()
    expect(store.get().windows.some((w) => w.id === id)).toBe(true)
    expect(made.hidden).toBe(true)
    expect([made.win.showCount, made.win.focusCount]).toEqual([0, 0])
    expect(manager.hiddenWindows()).toEqual([id])
    expect(w1.webContents.send).toHaveBeenLastCalledWith(CONTRACT.window.onHiddenWindows.channel, [id])
    // Its FIRST identity says it opened empty (D22: it boots with no tab), and only that one.
    expect([manager.takeStartEmpty(id), manager.takeStartEmpty(id), manager.takeStartEmpty('w1')]).toEqual([true, false, false])
  })

  it('YAZ-3343, a hidden window: "Show window" shows and focuses it; opening one of its tabs from the board shows it; and with no window left on screen it shows by itself', () => {
    const { manager, w1, w2, w3, created } = seedMove()
    const from = store.get().windows.find((w) => w.id === 'w1')!
    const a = manager.openBehind(from)
    const b = manager.openBehind(from)
    const [wa, wb] = created.slice(-2).map((c) => c.win)
    expect(manager.showWindow(a)).toBe(true)
    expect([wa.showCount, wa.focusCount]).toEqual([1, 1])
    expect(manager.hiddenWindows()).toEqual([b])
    manager.handleLinkReady(wb.webContents)
    expect(manager.focusTab(b, { path: '/a/x.md', copy: 0 })).toBe(true)
    expect(wb.showCount).toBe(1)
    expect(manager.hiddenWindows()).toEqual([])
    expect(manager.showWindow('nope')).toBe(false)
    // A third, hidden; every shown window then closes: it shows rather than run on unseen.
    const c = manager.openBehind(from)
    const wc = created.at(-1)!.win
    for (const w of [w1, w2, w3, wa, wb]) w.destroy()
    expect(wc.showCount).toBe(1)
    expect(manager.hiddenWindows()).toEqual([])
    void c
  })

  it('YAZ-3343, the vault chip: an EMPTY live window hears link:set-roots; a window with a tab, or a closed one, refuses', () => {
    const { manager, w1, w2 } = seedMove()
    for (const w of [w1, w2]) manager.handleLinkReady(w.webContents)
    expect(manager.setRoots('w2', ['/x'])).toBe(true)
    expect(w2.webContents.send).toHaveBeenLastCalledWith(CONTRACT.link.onSetRoots.channel, ['/x'])
    expect(manager.setRoots('w1', ['/x'])).toBe(false) // w1 has a tab
    expect(manager.setRoots('nope', ['/x'])).toBe(false)
  })

  it('YAZ-3808 6B, a tab board\'s Add: the window the card was let go in hears link:add-vault-and-take; one window, a closed one, or a Files window refuses', () => {
    const { manager, w1, w2 } = seedMove()
    for (const w of [w1, w2]) manager.handleLinkReady(w.webContents)
    expect(manager.addVaultAndTake('w2', '/a', 'w1', { path: '/a/x.md', copy: 0 })).toBe(true)
    expect(w2.webContents.send).toHaveBeenLastCalledWith(CONTRACT.link.onAddVaultAndTake.channel, { vault: '/a', from: 'w1', ref: { path: '/a/x.md', copy: 0 } })
    expect(manager.addVaultAndTake('w2', '/a', 'w2', { path: '/a/x.md', copy: 0 })).toBe(false)
    expect(manager.addVaultAndTake('w2', '/a', 'nope', { path: '/a/x.md', copy: 0 })).toBe(false)
    expect(manager.addVaultAndTake('nope', '/a', 'w1', { path: '/a/x.md', copy: 0 })).toBe(false)
    store.upsertWindow({ ...store.get().windows.find((w) => w.id === 'w2')!, kind: 'files' })
    expect(manager.addVaultAndTake('w2', '/a', 'w1', { path: '/a/x.md', copy: 0 })).toBe(false)
  })

  it('YAZ-3343, "Move to new window" from the tab board: QUIET — the window is built HIDDEN; from another window\'s card, that window hears link:pop-out-tab', () => {
    const { manager, w1, w2, created } = seedMove()
    for (const w of [w1, w2]) manager.handleLinkReady(w.webContents)
    const from = store.get().windows.find((w) => w.id === 'w1')!
    manager.popOut(from, '/a/x.md', { name: 'Outline', background: true })
    const made = created.at(-1)!
    expect(made.entry).toMatchObject({ file: '/a/x.md', tabs: ['/a/x.md'], tabStrip: [{ path: '/a/x.md', name: 'Outline' }] })
    expect(made.hidden).toBe(true)
    expect([made.win.showCount, made.win.focusCount]).toEqual([0, 0])
    expect(manager.hiddenWindows()).toEqual([made.entry.id])
    // The strip's own "Move to new window" opens in front, as before.
    manager.popOut(from, '/a/x.md')
    expect(created.at(-1)!.hidden).toBeUndefined()
    expect(manager.popOutTab('w2', { path: '/c/y.md', copy: 1 })).toBe(true)
    expect(w2.webContents.send).toHaveBeenLastCalledWith(CONTRACT.link.onPopOutTab.channel, { path: '/c/y.md', copy: 1 })
    expect(manager.popOutTab('nope', { path: '/c/y.md', copy: 0 })).toBe(false)
  })

  it('YAZ-3343, the board\'s highlight on another window\'s card: that live window hears link:highlight-tab at once; a window that is not live is skipped', () => {
    const { manager, w2 } = seedMove()
    manager.highlightTab('w2', { path: '/c/y.md', copy: 0 })
    expect(w2.webContents.send).toHaveBeenLastCalledWith(CONTRACT.link.onHighlightTab.channel, { path: '/c/y.md', copy: 0 })
    manager.highlightTab('w2', null)
    expect(w2.webContents.send).toHaveBeenLastCalledWith(CONTRACT.link.onHighlightTab.channel, null)
    expect(() => manager.highlightTab('nope', null)).not.toThrow()
  })

  it('YAZ-3343, a card menu\'s tab action on another window: it hears link:tab-action; "Show in sidebar" raises (and shows) it too', () => {
    const { manager, w2 } = seedMove()
    manager.handleLinkReady(w2.webContents)
    expect(manager.tabAction('w2', { path: '/c/y.md', copy: 0 }, { kind: 'duplicate' })).toBe(true)
    expect(w2.webContents.send).toHaveBeenLastCalledWith(CONTRACT.link.onTabAction.channel, { ref: { path: '/c/y.md', copy: 0 }, action: { kind: 'duplicate' } })
    expect(w2.focusCount).toBe(0)
    manager.tabAction('w2', { path: '/c/y.md', copy: 0 }, { kind: 'show-in-sidebar' })
    expect(w2.focusCount).toBe(1)
    expect(manager.tabAction('nope', { path: '/c/y.md', copy: 0 }, { kind: 'duplicate' })).toBe(false)
  })

  it('YAZ-3343, minimized in the Dock: every window hears the minimized set on minimize and on restore; a closed one leaves it', () => {
    const { manager, w1, w2 } = seedMove()
    w2.emit('minimize')
    expect(manager.minimizedWindows()).toEqual(['w2'])
    expect(w1.webContents.send).toHaveBeenLastCalledWith(CONTRACT.window.onMinimizedWindows.channel, ['w2'])
    w2.emit('restore')
    expect(manager.minimizedWindows()).toEqual([])
    expect(w1.webContents.send).toHaveBeenLastCalledWith(CONTRACT.window.onMinimizedWindows.channel, [])
    w2.emit('minimize')
    w2.destroy()
    expect(manager.minimizedWindows()).toEqual([])
    expect(w1.webContents.send).toHaveBeenLastCalledWith(CONTRACT.window.onMinimizedWindows.channel, [])
  })

  it('YAZ-3343, a frame\'s "Close window": the REAL close of another live window (its flush handshake runs); a closed one is false', () => {
    const { manager, w2 } = seedMove()
    const close = vi.spyOn(w2, 'close')
    expect(manager.closeOther('w2')).toBe(true)
    expect(close).toHaveBeenCalledTimes(1)
    expect(w2.isDestroyed()).toBe(false) // the handshake holds it until the renderer flushed
    expect(manager.closeOther('nope')).toBe(false)
  })
  const VIEW: PageView = { scrollTop: 120, zoomKey: 'l1 a:0', folds: ['abc:0'], magnification: 110 }

  it('raises the target and pushes link:take-tab with the path, the view and the name, held until the page listens; no entry changes', () => {
    const { manager, w1 } = seedMove()
    const before = store.get().windows
    w1.minimized = true
    expect(manager.moveTo('w1', '/b/deep/y.md', { view: VIEW, name: 'Outline' })).toBe(true)
    expect(w1.isMinimized()).toBe(false)
    expect(w1.focusCount).toBe(1)
    expect(w1.webContents.send).not.toHaveBeenCalled() // held like any link push (YAZ-2589 A2)
    manager.handleLinkReady(w1.webContents)
    expect(w1.webContents.send.mock.calls).toEqual([[CONTRACT.link.onTakeTab.channel, { path: '/b/deep/y.md', view: VIEW, name: 'Outline' }]])
    // A window that listens gets the push at once; no carry is just the path.
    expect(manager.moveTo('w1', '/a/x.md')).toBe(true)
    expect(w1.webContents.send).toHaveBeenLastCalledWith(CONTRACT.link.onTakeTab.channel, { path: '/a/x.md' })
    // The target stores its own new tab: main changes no entry, and keeps no page view for it.
    expect(store.get().windows).toBe(before)
    expect(manager.takeStartView('w1')).toBeUndefined()
  })

  it('YAZ-3343 D13: a QUIET move (`background`, a card dropped on a tab board) raises nothing, and the target hears it as one', () => {
    const { manager, w1 } = seedMove()
    manager.handleLinkReady(w1.webContents)
    w1.minimized = true
    expect(manager.moveTo('w1', '/a/x.md', { name: 'Outline', background: true })).toBe(true)
    expect([w1.focusCount, w1.isMinimized()]).toEqual([0, true])
    expect(w1.webContents.send).toHaveBeenLastCalledWith(CONTRACT.link.onTakeTab.channel, { path: '/a/x.md', name: 'Outline', background: true })
  })

  it('refuses an unknown id, a closed window, a path in no vault of the target, and a Welcome window (D2): nothing is sent, nothing is raised', () => {
    const { manager, w1, w2, w3 } = seedMove()
    for (const c of [w1, w2, w3]) manager.handleLinkReady(c.webContents)
    expect(manager.moveTo('nope', '/a/x.md')).toBe(false)
    expect(manager.moveTo('w2', '/a/x.md', { name: 'Outline' })).toBe(false) // w2 shows only /c: no vault is added
    expect(manager.moveTo('w1', '/ab/x.md')).toBe(false) // a sibling folder whose name starts with the vault's
    expect(manager.moveTo('w3', '/a/x.md')).toBe(false)
    w1.destroyed = true // destroyed, its `closed` not yet fired
    expect(manager.moveTo('w1', '/a/x.md')).toBe(false)
    w1.destroyed = false
    w1.destroy() // fully closed: no live window
    expect(manager.moveTo('w1', '/a/x.md')).toBe(false)
    for (const c of [w1, w2, w3]) {
      expect(c.webContents.send).not.toHaveBeenCalled()
      expect(c.focusCount).toBe(0)
    }
  })

  it('D8: highlight lights up the window a row points at: on for the row under the pointer, off when the row changes or clears, and when either window closes; it never raises a window', () => {
    const { manager, w1, w2, w3 } = seedMove()
    const glow = (c: typeof w1) => c.webContents.send.mock.calls.filter(([channel]) => channel === CONTRACT.window.onGlow.channel).map(([, on]) => on)
    manager.highlight('w1', 'w2')
    manager.highlight('w1', 'w2') // the same row again: nothing new
    manager.highlight('w1', 'w3')
    manager.highlight('w1', null)
    expect(glow(w2)).toEqual([true, false])
    expect(glow(w3)).toEqual([true, false])
    manager.highlight('w1', 'w1') // its own window never glows
    manager.highlight('w1', 'nope')
    expect(glow(w1)).toEqual([])
    // The source closes while a row is lit: the target goes dark.
    manager.highlight('w1', 'w2')
    w1.destroy()
    expect(glow(w2)).toEqual([true, false, true, false])
    // A lit target that closes is forgotten: nothing goes to it later.
    manager.highlight('w3', 'w2')
    w2.destroy()
    manager.highlight('w3', null)
    expect(glow(w2)).toEqual([true, false, true, false, true])
    for (const c of [w1, w2, w3]) expect(c.focusCount).toBe(0)
  })
})

describe('createWindowManager: a popped-out window gets its page view once (YAZ-2951 D2, S17, S20; ⌘⇧N no longer, YAZ-3343 D35)', () => {
  const VIEW: PageView = { scrollTop: 420, zoomKey: 'l2 a:1', folds: ['abc:0', 'h:def:0'], magnification: 125 }
  const from: WindowEntry = { id: 'w1', root: '/a', roots: ['/a', '/b'], file: '/a/x.md', tabs: ['/a/x.md', '/b/y.md'], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'files', bounds: { x: 100, y: 100, width: 800, height: 600 } }

  it('popOut keeps the view for its path; takeStartView gives it one time; ⌘⇧N carries none any more (YAZ-3343)', () => {
    store.upsertWindow(from)
    const { host, created } = makeHost()
    const manager = createWindowManager(store, host)
    manager.duplicateWindow(from)
    manager.popOut(from, '/b/y.md', { view: VIEW })
    const [dup, popped] = created.map((c) => c.entry.id)
    expect(manager.takeStartView(dup)).toBeUndefined()
    expect(manager.takeStartView(popped)).toEqual({ path: '/b/y.md', view: VIEW })
    expect(manager.takeStartView(popped)).toBeUndefined() // a reload of the new window starts fresh (S17)
    // Never stored (S18): the entries hold no page view.
    expect(JSON.stringify(store.get().windows)).not.toContain('l2 a:1')
  })

  it('YAZ-3343, ⌘⇧N: a window on the SAME vaults with NO tab, cascaded, in front; it boots on the blank tab (startEmpty, once); the sidebar comes along, the right panel does not', () => {
    store.upsertWindow({ ...from, sidebarCollapsed: true, sidebarLens: 'favorites', rightPanel: { ...defaultRightPanelIdentity(), open: true, items: ['/a/r.md'] } })
    const { host, created } = makeHost()
    const manager = createWindowManager(store, host)
    manager.duplicateWindow(store.get().windows.find((w) => w.id === 'w1')!)
    const made = created[0]
    expect(made.entry).toMatchObject({ root: '/a', roots: ['/a', '/b'], file: null, tabs: [], sidebarCollapsed: true, sidebarLens: 'favorites', bounds: { x: 100 + WINDOW_CASCADE_PX, y: 100 + WINDOW_CASCADE_PX } })
    expect(made.entry.tabStrip).toBeUndefined()
    expect(made.entry.rightPanel.items).toEqual([])
    expect(made.hidden).toBeUndefined()
    expect([manager.takeStartEmpty(made.entry.id), manager.takeStartEmpty(made.entry.id)]).toEqual([true, false])
  })

  it('popOut with no view keeps nothing (S13)', () => {
    store.upsertWindow(from)
    const { host, created } = makeHost()
    const manager = createWindowManager(store, host)
    manager.popOut(from, '/b/y.md')
    manager.popOut(from, '/b/y.md', {})
    expect(created.map((c) => manager.takeStartView(c.entry.id))).toEqual([undefined, undefined])
  })

  it('a new window that closes before it reads its view forgets it (S20) — and its empty start (YAZ-3343)', async () => {
    store.upsertWindow(from)
    const { host, created } = makeHost()
    const manager = createWindowManager(store, host)
    manager.popOut(from, '/b/y.md', { view: VIEW })
    manager.duplicateWindow(from)
    for (const { win } of created) {
      win.close()
      manager.handleFlushed(win.webContents)
    }
    await vi.advanceTimersByTimeAsync(0)
    expect(created.map(({ win }) => win.isDestroyed())).toEqual([true, true])
    expect(manager.takeStartView(created[0].entry.id)).toBeUndefined()
    expect(manager.takeStartEmpty(created[1].entry.id)).toBe(false)
  })
})

// ---------- deep-link routing (E1, GRO-2171) ----------

describe('resolveLinkTarget (pure)', () => {
  const win = (id: string, root: string | null): WindowEntry => ({ id, root, roots: root === null ? [] : [root], file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'files', bounds: { x: 0, y: 0, width: 800, height: 600 } })
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
    store.upsertWindow({ id: 'w1', root: '/v', file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files', bounds: { x: 10, y: 10, width: 800, height: 600 } })
    store.upsertWindow({ id: 'w2', root: null, file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files', bounds: { x: 40, y: 40, width: 800, height: 600 } })
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
    store.upsertWindow({ id: 'w3', root: '/v/deeper', file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files', bounds: { x: 20, y: 20, width: 800, height: 600 } })
    manager.routeToFile('/v/deeper/n.md') // most specific root wins → resolves to the dead w3
    expect(created).toHaveLength(3)
    expect(created[2].entry.id).not.toBe('w3') // a fresh window, not a resurrection of the dead entry
    expect(created[2].entry.root).toBe('/v/deeper')
    expect(created[2].entry.file).toBe('/v/deeper/n.md')
  })

  it('YAZ-2602 S57/S58: a file in the SECOND vault of a window opens as a tab there, and that vault\'s folder from outside raises the window — no new window either way', () => {
    store.upsertWindow({ id: 'ab', root: '/a', roots: ['/a', '/b'], file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files', bounds: { x: 10, y: 10, width: 800, height: 600 } })
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
    store.upsertWindow({ id: 'w3', root: '/q', roots: ['/q', '/v/deeper'], file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files', bounds: { x: 20, y: 20, width: 800, height: 600 } })
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

  it('S2: a known vault\'s folder with no window → a new window on it, blank (YAZ-3487 D7: its last file stays unread)', () => {
    const { manager, created, w1 } = seedFolder('/w')
    store.pushRecent('/w', 1)
    store.setFolder('/w', { lastFile: '/w/Start here.md' })
    manager.routeToFile('/w')
    expect(created).toHaveLength(3)
    expect(created[2].entry.root).toBe('/w')
    expect(created[2].entry.file).toBeNull()
    expect(w1.focusCount).toBe(0)
  })

  it('S2: the same folder with a trailing slash (a link keeps it) is the SAME vault: the window is on the stored root, blank (YAZ-3487 D7), and the recents hold it once', () => {
    const { manager, created } = seedRouting(() => false, (p) => p === '/w' || p === '/w/')
    store.pushRecent('/w', 1)
    store.setFolder('/w', { lastFile: '/w/Start here.md' })
    manager.routeToFile('/w/')
    expect(created).toHaveLength(3)
    expect(created[2].entry.root).toBe('/w')
    expect(created[2].entry.file).toBeNull()
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

  it('vaultNotice (YAZ-2677 S45) shows in each window of THAT vault and in no other, raises none, and waits for a page that does not listen yet', () => {
    store.upsertWindow({ id: 'w1', root: '/v', file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files', bounds: { x: 10, y: 10, width: 800, height: 600 } })
    store.upsertWindow({ id: 'w2', root: '/other', roots: ['/other', '/v'], file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files', bounds: { x: 40, y: 40, width: 800, height: 600 } })
    store.upsertWindow({ id: 'w3', root: '/elsewhere', file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files', bounds: { x: 70, y: 70, width: 800, height: 600 } })
    const { host, created } = makeHost([AREA])
    const manager = createWindowManager(store, host)
    manager.restore('all')
    const [w1, w2, w3] = created.map((c) => c.win)
    manager.handleLinkReady(w1.webContents)
    const notice = 'YAZ-101 was used on two Macs. "Bar" is now YAZ-102. 1 link updated.'
    manager.vaultNotice('/v', notice)
    expect(sentOn(w1, CONTRACT.link.onNotice.channel)).toEqual([[CONTRACT.link.onNotice.channel, notice]])
    // The page of w2 is still loading: it hears the notice when it listens. w3 shows another vault.
    expect(w2.webContents.send).not.toHaveBeenCalled()
    manager.handleLinkReady(w2.webContents)
    manager.handleLinkReady(w3.webContents)
    expect(sentOn(w2, CONTRACT.link.onNotice.channel)).toEqual([[CONTRACT.link.onNotice.channel, notice]])
    expect(w3.webContents.send).not.toHaveBeenCalled()
    expect([w1.focusCount, w2.focusCount, w3.focusCount]).toEqual([0, 0, 0])
    expect(created).toHaveLength(3)
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

describe('createWindowManager: the tab board reaches other windows (YAZ-3343 D3, D13, D14)', () => {
  /** w1 shows /a and /b, w2 shows /c only, w3 is a Welcome window. Every page listens, unless a test says otherwise. */
  function seedBoard(listen = true) {
    store.upsertWindow({ id: 'w1', root: '/a', roots: ['/a', '/b'], file: '/a/x.md', tabs: ['/a/x.md'], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'files', bounds: { x: 10, y: 10, width: 800, height: 600 } })
    store.upsertWindow({ id: 'w2', root: '/c', roots: ['/c'], file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'files', bounds: { x: 40, y: 40, width: 800, height: 600 } })
    store.upsertWindow({ id: 'w3', root: null, roots: [], file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'files', bounds: { x: 70, y: 70, width: 800, height: 600 } })
    const { host, created } = makeHost()
    const manager = createWindowManager(store, host)
    manager.restore('all')
    const [w1, w2, w3] = created.map((c) => c.win)
    if (listen) for (const c of [w1, w2, w3]) manager.handleLinkReady(c.webContents)
    return { manager, w1, w2, w3 }
  }
  const REF = { path: '/a/x.md', copy: 1 }

  it('D3 focusTab raises the target and pushes link:focus-tab (held until the page listens); closeTabs pushes link:close-tabs and raises nothing', () => {
    const { manager, w1 } = seedBoard(false)
    w1.minimized = true
    expect(manager.focusTab('w1', REF)).toBe(true)
    expect(w1.isMinimized()).toBe(false)
    expect(w1.focusCount).toBe(1)
    expect(w1.webContents.send).not.toHaveBeenCalled() // held like any link push (YAZ-2589 A2)
    manager.handleLinkReady(w1.webContents)
    expect(w1.webContents.send.mock.calls).toEqual([[CONTRACT.link.onFocusTab.channel, REF]])
    expect(manager.closeTabs('w1', [REF, { path: '/b/y.md', copy: 0 }])).toBe(true)
    expect(w1.webContents.send).toHaveBeenLastCalledWith(CONTRACT.link.onCloseTabs.channel, [REF, { path: '/b/y.md', copy: 0 }])
    expect(w1.focusCount).toBe(1)
  })

  it('D3 focusTab and closeTabs refuse an unknown id, a destroyed window and a closed one: nothing is sent, nothing is raised', () => {
    const { manager, w1 } = seedBoard()
    expect(manager.focusTab('nope', REF)).toBe(false)
    expect(manager.closeTabs('nope', [REF])).toBe(false)
    w1.destroyed = true // destroyed, its `closed` not yet fired
    expect(manager.focusTab('w1', REF)).toBe(false)
    expect(manager.closeTabs('w1', [REF])).toBe(false)
    w1.destroyed = false
    w1.destroy()
    expect(manager.focusTab('w1', REF)).toBe(false)
    expect(w1.webContents.send).not.toHaveBeenCalled()
    expect(w1.focusCount).toBe(0)
  })

  it('D13 moveTab pushes link:send-tab { to, ref } to the SOURCE, raising nothing; it refuses a target with no vault of the page, a Welcome window, the same window, and a window that is not live', () => {
    const { manager, w1, w2, w3 } = seedBoard()
    store.upsertWindow({ ...store.get().windows[1], roots: ['/c', '/a'] }) // w2 now shows /a too
    expect(manager.moveTab('w1', 'w2', REF)).toBe(true)
    expect(w1.webContents.send.mock.calls).toEqual([[CONTRACT.link.onSendTab.channel, { to: 'w2', ref: REF }]])
    // A drop on w2's strip names its slot (YAZ-3637 D4); without one the key is absent, not undefined.
    expect(manager.moveTab('w1', 'w2', REF, 2)).toBe(true)
    expect(w1.webContents.send).toHaveBeenLastCalledWith(CONTRACT.link.onSendTab.channel, { to: 'w2', ref: REF, at: 2 })
    // A tab board card let go on w2's strip (YAZ-3808 6H): its slot, quietly. Quiet with no slot is the board's frame drop.
    expect(manager.moveTab('w1', 'w2', REF, 2, true)).toBe(true)
    expect(w1.webContents.send).toHaveBeenLastCalledWith(CONTRACT.link.onSendTab.channel, { to: 'w2', ref: REF, at: 2, background: true })
    expect(manager.moveTab('w1', 'w2', REF, undefined, true)).toBe(true)
    expect(w1.webContents.send).toHaveBeenLastCalledWith(CONTRACT.link.onSendTab.channel, { to: 'w2', ref: REF })
    expect(manager.moveTab('w1', 'w2', { path: '/b/y.md', copy: 0 })).toBe(false) // w2 shows no /b: no vault is added
    expect(manager.moveTab('w1', 'w3', REF)).toBe(false) // a Welcome window shows no vault
    expect(manager.moveTab('w1', 'w1', REF)).toBe(false)
    expect(manager.moveTab('nope', 'w2', REF)).toBe(false)
    expect(manager.moveTab('w1', 'nope', REF)).toBe(false)
    w2.destroy()
    expect(manager.moveTab('w1', 'w2', REF)).toBe(false)
    expect(w1.webContents.send).toHaveBeenCalledTimes(4)
    for (const c of [w1, w2, w3]) expect(c.focusCount).toBe(0)
  })

  it('D14 setName names a LIVE window only; null takes the name away; duplicateWindow and popOut do not copy it, a launch keeps it', () => {
    const { manager, w2 } = seedBoard()
    expect(manager.setName('w1', '  Writing ')).toBe(true)
    expect(store.get().windows[0].name).toBe('Writing')
    expect(manager.setName('nope', 'X')).toBe(false)
    w2.destroy()
    expect(manager.setName('w2', 'X')).toBe(false)
    const named = store.get().windows[0]
    const { host, created } = makeHost()
    const other = createWindowManager(store, host)
    other.duplicateWindow(named)
    other.popOut(named, '/a/x.md', { name: 'Tab' })
    expect(created.map((c) => c.entry)).toEqual([expect.not.objectContaining({ name: expect.anything() }), expect.not.objectContaining({ name: expect.anything() })])
    expect(store.get().windows.filter((w) => w.name !== undefined).map((w) => w.id)).toEqual(['w1'])
    // A launch brings the window back with its name.
    const relaunch = makeHost()
    createWindowManager(store, relaunch.host).restore('all')
    expect(relaunch.created.find((c) => c.entry.id === 'w1')?.entry.name).toBe('Writing')
    expect(manager.setName('w1', null)).toBe(true)
    expect(store.get().windows[0]).not.toHaveProperty('name')
  })
})

describe('createWindowManager: a tab torn off its strip (YAZ-3637 D3, D5)', () => {
  /** w1 shows /a and /b at the top left; w2 shows /c, off to the right; w3 is a Welcome window under w1. */
  function seedTear(areas: WindowBounds[] = [AREA]) {
    store.upsertWindow({ id: 'w1', root: '/a', roots: ['/a', '/b'], file: '/a/x.md', tabs: ['/a/x.md', '/b/y.md'], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'focus', bounds: { x: 10, y: 10, width: 800, height: 600 } })
    store.upsertWindow({ id: 'w2', root: '/c', roots: ['/c'], file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'files', bounds: { x: 1000, y: 100, width: 300, height: 300 } })
    store.upsertWindow({ id: 'w3', root: null, roots: [], file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'files', bounds: { x: 40, y: 40, width: 800, height: 600 } })
    const made = makeHost(areas)
    const manager = createWindowManager(store, made.host)
    manager.restore('all')
    const [w1, w2, w3] = made.created.map((c) => c.win)
    const from = store.get().windows.find((w) => w.id === 'w1')!
    return { manager, w1, w2, w3, from, ...made }
  }
  const CARRY = { name: 'Outline', view: { scrollTop: 10, zoomKey: null, folds: [], magnification: 100 } }

  it('a point on a window that shows is none — that window took the drop, or refused it (D4, D8); a hidden window and one in the Dock do not count', () => {
    const { manager, w2, from, created } = seedTear()
    expect(manager.tearOff(from, '/a/x.md', CARRY, { x: 20, y: 20 }, false)).toBe('none') // on w1 itself
    expect(manager.tearOff(from, '/a/x.md', CARRY, { x: 1100, y: 200 }, false)).toBe('none') // on w2
    expect(created).toHaveLength(3)
    // w2 in the Dock: the point is on nothing.
    w2.minimized = true
    expect(manager.tearOff(from, '/a/x.md', CARRY, { x: 1100, y: 200 }, false)).toBe('opened')
    expect(created).toHaveLength(4)
    // The window that opened stands under the next point; closed, it counts no more.
    created[3].win.destroy()
    // A window the board made, still hidden, at +24/+24 of w2: a point on it alone is on nothing.
    w2.minimized = false
    manager.openBehind(store.get().windows.find((w) => w.id === 'w2')!)
    expect(created.at(-1)!.hidden).toBe(true)
    expect(manager.tearOff(from, '/a/x.md', CARRY, { x: 1310, y: 410 }, false)).toBe('opened')
    expect(created).toHaveLength(6)
    expect(created.at(-1)!.hidden).toBeUndefined()
  })

  it('D3: off every window, a new window opens there — as big as the source, the tab under the pointer, clamped to the display, sidebar hidden, the carry along; the source keeps its tab until the renderer closes it', () => {
    const { manager, from, created } = seedTear()
    expect(manager.tearOff(from, '/b/y.md', CARRY, { x: 900, y: 300 }, false)).toBe('opened')
    const made = created.at(-1)!
    // x: 900 - the grab, 710, clamped to 1440 - 800; y: 300 - the grab.
    expect(made.entry).toMatchObject({ root: '/a', roots: ['/a', '/b'], file: '/b/y.md', tabs: ['/b/y.md'], tabStrip: [{ path: '/b/y.md', name: 'Outline' }], sidebarCollapsed: true, sidebarLens: 'focus', bounds: { x: 640, y: 300 - TEAR_OFF_GRAB.y, width: 800, height: 600 } })
    expect(made.hidden).toBeUndefined()
    expect(manager.takeStartView(made.entry.id)).toEqual({ path: '/b/y.md', view: CARRY.view })
    expect(store.get().windows.find((w) => w.id === 'w1')?.tabs).toEqual(['/a/x.md', '/b/y.md'])
  })

  it('D5: the only tab of a window takes the window with it — it moves to the point, no new window, the bounds stored at once', () => {
    const { manager, w1, from, created } = seedTear()
    expect(manager.tearOff(from, '/a/x.md', CARRY, { x: 500, y: 700 }, true)).toBe('moved')
    expect(created).toHaveLength(3)
    // 700 less the grab would put the bottom below the 900 px display: the window is pushed up to end at its bottom.
    const bounds = { x: 500 - TEAR_OFF_GRAB.x, y: 900 - 600, width: 800, height: 600 }
    expect(w1.setBoundsCalls).toEqual([[bounds, undefined]])
    expect(store.get().windows.find((w) => w.id === 'w1')?.bounds).toEqual(bounds)
    expect(manager.takeStartView('w1')).toBeUndefined()
  })

  it('D3: a drop near the edge between two displays keeps the window on the display that holds the point, not the one it overlaps most', () => {
    const second: WindowBounds = { x: 1440, y: 0, width: 1920, height: 1080 }
    const { manager, created } = seedTear([AREA, second])
    // 1400 less the grab puts most of an 800 px window on the second display; the point is on the first.
    expect(manager.tearOff(store.get().windows.find((w) => w.id === 'w1')!, '/b/y.md', {}, { x: 1400, y: 300 }, false)).toBe('opened')
    expect(created.at(-1)!.entry.bounds).toEqual({ x: 1440 - 800, y: 300 - TEAR_OFF_GRAB.y, width: 800, height: 600 })
  })

  it('a point of 0,0 is no point (the drag ended with none): the pointer is where it is now', () => {
    const { manager, from, created, cursor } = seedTear()
    cursor.x = 900
    cursor.y = 300
    expect(manager.tearOff(from, '/b/y.md', {}, { x: 0, y: 0 }, false)).toBe('opened')
    expect(created.at(-1)!.entry.bounds).toEqual({ x: 640, y: 300 - TEAR_OFF_GRAB.y, width: 800, height: 600 })
    cursor.x = 20
    cursor.y = 20
    expect(manager.tearOff(from, '/b/y.md', {}, { x: 0, y: 0 }, false)).toBe('none')
  })
})

describe('Files windows (YAZ-3357)', () => {
  const panel = defaultRightPanelIdentity()
  const REF = { path: '/a/x.md', copy: 0 }
  /** w1 and w2 are full windows on /a, w3 a full one on /c, f a Files window on /a and /c. Every page listens. */
  function seedFiles() {
    const normal = { file: null, tabs: [], rightPanel: panel, sidebarCollapsed: false, sidebarLens: 'files' as const }
    store.upsertWindow({ id: 'w1', root: '/a', roots: ['/a'], ...normal, bounds: { x: 400, y: 100, width: 800, height: 600 } })
    store.upsertWindow({ id: 'w2', root: '/a', roots: ['/a'], ...normal, bounds: { x: 420, y: 120, width: 800, height: 600 } })
    store.upsertWindow({ id: 'w3', root: '/c', roots: ['/c'], ...normal, bounds: { x: 440, y: 140, width: 800, height: 600 } })
    store.upsertWindow({ id: 'f', kind: 'files', root: '/a', roots: ['/a', '/c'], ...normal, bounds: { x: 120, y: 100, width: 280, height: 600 } })
    const { host, created, previews } = makeHost([AREA], () => true, (path) => !path.endsWith('.md'))
    const manager = createWindowManager(store, host)
    manager.restore('all')
    for (const c of created) manager.handleLinkReady(c.win.webContents)
    const [w1, w2, w3, f] = created.map((c) => c.win)
    return { manager, host, created, previews, w1, w2, w3, f }
  }
  const sent = (win: FakeWindow) => win.webContents.send.mock.calls.filter(([ch]) => ch === CONTRACT.link.onOpenFromFiles.channel).map(([, action]) => action)

  it('D6: a Files window opens flush left of its source, on its top and as tall, as wide as the sidebar, clamped; with no source at the default spot', () => {
    expect(filesWindowBounds({ x: 500, y: 80, width: 900, height: 700 }, 260, [AREA])).toEqual({ x: 240, y: 80, width: 260, height: 700 })
    // At the left edge of the screen it is pushed onto it, over the source's left side.
    expect(filesWindowBounds({ x: 100, y: 80, width: 900, height: 700 }, 260, [AREA])).toEqual({ x: 0, y: 80, width: 260, height: 700 })
    expect(filesWindowBounds(null, 280, [AREA])).toEqual({ x: 100, y: 100, width: 280, height: 800 })
    // A full window it makes stands right of it, as tall.
    expect(besideFilesBounds({ x: 0, y: 80, width: 260, height: 700 }, [AREA])).toEqual({ x: 260, y: 80, width: 1180, height: 700 })
    // Narrower to stay beside it, down to a usable width; then it moves over the Files window.
    expect(besideFilesBounds({ x: 1000, y: 80, width: 260, height: 700 }, [AREA])).toEqual({ x: 800, y: 80, width: 640, height: 700 })
  })

  it('D5, D6: openFilesWindow stores kind files, takes the source\'s vaults (or the one asked for) and lens, and the source does not change', () => {
    const { manager, created } = seedFiles()
    store.setSidebarWidth(300)
    store.upsertWindow({ ...store.get().windows.find((w) => w.id === 'w3')!, sidebarLens: 'focus' })
    expect(manager.openFilesWindow('w3', null)).toBe(true)
    const made = created.at(-1)!.entry
    expect(made).toMatchObject({ kind: 'files', root: '/c', roots: ['/c'], file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'focus', bounds: { x: 140, y: 140, width: 300, height: 600 } })
    expect(store.get().windows.find((w) => w.id === 'w3')?.bounds).toEqual({ x: 440, y: 140, width: 800, height: 600 })
    expect(manager.openFilesWindow('w1', '/z')).toBe(true)
    expect(created.at(-1)!.entry.roots).toEqual(['/z'])
    expect(manager.openFilesWindow(undefined, null)).toBe(false)
  })

  it('YAZ-3441: at App size 125% a new Files window is as wide ON THE SCREEN as the source\'s sidebar (page px × 1.25), so its page is as wide as that sidebar', () => {
    const { manager, created, w1 } = seedFiles()
    store.setSettings({ ...store.get().settings, appZoom: 125 })
    const opened = (from: string | undefined, root: string | null = null) => {
      expect(manager.openFilesWindow(from, root)).toBe(true)
      return created.at(-1)!.entry.bounds
    }
    // The narrowest sidebar, 180 page px, is 225 screen px: flush left of w1 (x 400).
    store.setSidebarWidth(180)
    expect(opened('w1')).toEqual({ x: 175, y: 100, width: 225, height: 600 })
    // The default sidebar, 260 page px, is 325 screen px.
    store.setSidebarWidth(260)
    expect(opened('w1')).toEqual({ x: 75, y: 100, width: 325, height: 600 })
    // A collapsed source and no source give the default Files window width, 280 page px: 350 screen px.
    store.upsertWindow({ ...store.get().windows.find((w) => w.id === 'w1')!, sidebarCollapsed: true })
    expect(opened('w1').width).toBe(350)
    expect(opened(undefined, '/z')).toEqual({ x: 100, y: 100, width: 350, height: 800 })
    // At 100% nothing changes (D6): the page px are the screen px.
    store.setSettings({ ...store.get().settings, appZoom: 100 })
    expect(opened('w2').width).toBe(260)
    expect(w1.getBounds()).toEqual({ x: 400, y: 100, width: 800, height: 600 })
  })

  it('YAZ-3441: the board makes a Files window FILES_WINDOW_WIDE_W page px wide at the App size (1200 × 1.1 = 1320, clamped to the screen)', () => {
    const { manager, f } = seedFiles()
    store.setSettings({ ...store.get().settings, appZoom: 110 })
    expect(manager.filesWide('f', true)).toBe(true)
    expect(f.getBounds()).toEqual({ x: 120, y: 100, width: 1320, height: 600 })
    manager.filesWide('f', false)
    expect(f.getBounds()).toEqual({ x: 120, y: 100, width: 280, height: 600 })
  })

  it('YAZ-3441: a new App size keeps each Files window\'s page width — its width scales by new / old, its right edge stays — and leaves full windows alone', () => {
    const { manager, f, w1 } = seedFiles()
    // f is 280 wide at x 120: its right edge is 400, flush left of w1.
    manager.appZoomChanged(1, 1.25)
    expect(f.getBounds()).toEqual({ x: 50, y: 100, width: 350, height: 600 })
    expect(store.get().windows.find((w) => w.id === 'f')?.bounds).toEqual({ x: 50, y: 100, width: 350, height: 600 })
    manager.appZoomChanged(1.25, 0.9)
    expect(f.getBounds()).toEqual({ x: 148, y: 100, width: 252, height: 600 })
    expect(w1.getBounds()).toEqual({ x: 400, y: 100, width: 800, height: 600 })
    // While the board makes it wide, its stored narrow bounds scale, and the board's close brings them back. The wide
    // window itself takes the board's width at the new App size (1200 page px: 1080 at 90%, 1200 at 100%).
    store.setSettings({ ...store.get().settings, appZoom: 90 })
    manager.filesWide('f', true)
    expect(f.getBounds()).toEqual({ x: 148, y: 100, width: 1080, height: 600 })
    store.setSettings({ ...store.get().settings, appZoom: 100 })
    manager.appZoomChanged(0.9, 1)
    expect(store.get().windows.find((w) => w.id === 'f')?.bounds).toEqual({ x: 120, y: 100, width: 280, height: 600 })
    expect(f.getBounds()).toEqual({ x: 120, y: 100, width: 1200, height: 600 })
    manager.filesWide('f', false)
    expect(f.getBounds()).toEqual({ x: 120, y: 100, width: 280, height: 600 })
  })

  it('YAZ-3444: while a Files window\'s zoom menu is open, a new App size leaves its size; the menu\'s close gives it the width of its page from before the first change, with no drift; other Files windows resize at once', () => {
    const { manager, created, f, w1 } = seedFiles()
    manager.openFilesWindow('w2', null)
    const g = created.at(-1)!.win
    const gAt = g.getBounds()
    // f: 263 wide, its right edge at 400. Its zoom menu opens; a full window's call is refused.
    f.setBounds({ x: 137, y: 100, width: 263, height: 600 })
    expect(manager.filesZoomMenu('f', true)).toBe(true)
    expect(manager.filesZoomMenu('w1', true)).toBe(false)
    // 100 → 110 → 125 from f's own menu: f keeps its size, so its menu stays under the pointer. g resizes at once.
    store.setSettings({ ...store.get().settings, appZoom: 110 })
    manager.appZoomChanged(1, 1.1)
    store.setSettings({ ...store.get().settings, appZoom: 125 })
    manager.appZoomChanged(1.1, 1.25)
    expect(f.getBounds()).toEqual({ x: 137, y: 100, width: 263, height: 600 })
    expect(g.getBounds().width).toBe(Math.round((Math.round(gAt.width * 1.1) * 1.25) / 1.1))
    expect(w1.getBounds()).toEqual({ x: 400, y: 100, width: 800, height: 600 })
    // The close: ONE resize, from the width before the first change: 263 × 1.25 = 329 (in two steps it would be 328).
    const calls = f.setBoundsCalls.length
    expect(manager.filesZoomMenu('f', false)).toBe(true)
    expect(f.getBounds()).toEqual({ x: 71, y: 100, width: 329, height: 600 })
    expect(store.get().windows.find((w) => w.id === 'f')?.bounds).toEqual({ x: 71, y: 100, width: 329, height: 600 })
    expect(f.setBoundsCalls.length).toBe(calls + 1)
    // A second close, or a close with no change while open, resizes nothing.
    manager.filesZoomMenu('f', false)
    manager.filesZoomMenu('f', true)
    manager.filesZoomMenu('f', false)
    expect(f.setBoundsCalls.length).toBe(calls + 1)
    // There and back while open (125 → 110 → 125): the close keeps the width.
    manager.filesZoomMenu('f', true)
    manager.appZoomChanged(1.25, 1.1)
    manager.appZoomChanged(1.1, 1.25)
    manager.filesZoomMenu('f', false)
    expect(f.getBounds()).toEqual({ x: 71, y: 100, width: 329, height: 600 })
    // A reload of the page while the menu is open counts as its close: the page has no menu after it.
    manager.filesZoomMenu('f', true)
    store.setSettings({ ...store.get().settings, appZoom: 100 })
    manager.appZoomChanged(1.25, 1)
    expect(f.getBounds().width).toBe(329)
    manager.handleLinkReady(f.webContents)
    expect(f.getBounds()).toEqual({ x: 137, y: 100, width: 263, height: 600 })
  })

  it('D13 "Make full window": a full window opens where the Files window stands, on its vaults and lens, empty; then the Files window closes by its real close', () => {
    const { manager, created, f } = seedFiles()
    expect(manager.filesToNormal('w1')).toBe(false)
    expect(manager.filesToNormal('f')).toBe(true)
    const made = created.at(-1)!.entry
    expect(made).toMatchObject({ root: '/a', roots: ['/a', '/c'], file: null, tabs: [], sidebarCollapsed: false, bounds: { x: 120, y: 100, width: 1200, height: 600 } })
    expect(made).not.toHaveProperty('kind')
    expect(manager.takeStartEmpty(made.id)).toBe(true)
    // The flush handshake runs: the Files window goes by its real close, after the new window exists.
    expect(f.flushCount()).toBe(1)
  })

  it('a Files window opens at its source\'s sidebar zoom (YAZ-3487, demo round 3; it was one step above, YAZ-3389 D13) and keeps its own; a full window stores none; a new one starts with its tree closed', () => {
    const { manager, created } = seedFiles()
    const zoomOf = (id: string) => store.get().windows.find((w) => w.id === id)?.zoom
    // From a full window: the shared sidebar zoom as it is (100 → 100, 150 → 150).
    manager.openFilesWindow('w1', null)
    const made = created.at(-1)!.entry
    expect(made.zoom).toBe(100)
    expect(manager.takeStartCollapsed(made.id)).toBe(true)
    expect(manager.takeStartCollapsed(made.id)).toBe(false) // once
    store.setSettings({ ...store.get().settings, sidebarZoom: 150 })
    manager.openFilesWindow('w2', null)
    expect(created.at(-1)!.entry.zoom).toBe(150)
    // From a Files window: ITS zoom, never the shared one.
    expect(manager.setFilesZoom(made.id, 75)).toBe(true)
    expect(zoomOf(made.id)).toBe(75)
    manager.openFilesWindow(made.id, null)
    expect(created.at(-1)!.entry.zoom).toBe(75)
    manager.setFilesZoom(made.id, 200)
    manager.openFilesWindow(made.id, null)
    expect(created.at(-1)!.entry.zoom).toBe(200)
    // A write is normalized: off-range clamps, an old Chromium level is the default.
    manager.setFilesZoom(made.id, 999)
    expect(zoomOf(made.id)).toBe(200)
    manager.setFilesZoom(made.id, 3)
    expect(zoomOf(made.id)).toBe(125)
    // A full window has no zoom of its own: nothing is written.
    expect(manager.setFilesZoom('w1', 150)).toBe(false)
    expect(store.get().windows.find((w) => w.id === 'w1')).not.toHaveProperty('zoom')
    expect(store.get().settings.sidebarZoom).toBe(150)
  })

  it('D2: the target is the most recently focused live FULL window that shows the vault, else the first; never a Files window or a hidden one', () => {
    const windows = store.get().windows
    expect(pickFilesTarget('/a/x.md', windows, [], () => true)).toBeNull()
    const { manager, w1, w2, f } = seedFiles()
    const all = store.get().windows
    expect(pickFilesTarget('/a/x.md', all, [], () => true)).toBe('w1')
    expect(pickFilesTarget('/a/x.md', all, ['f', 'w3', 'w2', 'w1'], () => true)).toBe('w2')
    expect(pickFilesTarget('/a/x.md', all, ['w2'], (id) => id !== 'w2')).toBe('w1')
    expect(pickFilesTarget('/c/y.md', all, ['f'], () => true)).toBe('w3')
    expect(pickFilesTarget('/b/y.md', all, [], () => true)).toBeNull()
    // Through the manager: w2 was focused last, then the Files window itself.
    w2.emit('focus')
    f.emit('focus')
    expect(manager.openFromFiles('f', { kind: 'open', path: '/a/x.md', how: 'preview' })).toBe(true)
    expect(sent(w2)).toEqual([{ kind: 'open', path: '/a/x.md', how: 'preview' }])
    expect(sent(w1)).toEqual([])
    expect(sent(f)).toEqual([])
    // A full window cannot ask through this door.
    expect(manager.openFromFiles('w1', { kind: 'open', path: '/a/x.md', how: 'keep' })).toBe(false)
  })

  it('D7: a preview comes to the front unfocused, keep and the others focus, a background tab raises nothing', () => {
    const { manager, w1, w3 } = seedFiles()
    manager.openFromFiles('f', { kind: 'open', path: '/a/x.md', how: 'preview' })
    expect([w1.moveTopCount, w1.focusCount]).toEqual([1, 0])
    manager.openFromFiles('f', { kind: 'open', path: '/a/x.md', how: 'background' })
    expect([w1.moveTopCount, w1.focusCount]).toEqual([1, 0])
    manager.openFromFiles('f', { kind: 'open', path: '/a/x.md', how: 'keep' })
    manager.openFromFiles('f', { kind: 'inbox', root: '/c' })
    expect([w1.focusCount, w3.focusCount]).toEqual([1, 1])
    expect(sent(w1)).toHaveLength(3)
    expect(sent(w3)).toEqual([{ kind: 'inbox', root: '/c' }])
  })

  it('D2: with no window on the vault a new full window opens beside the Files window — on the page for open, else holding the push for its page', () => {
    const { manager, created, f } = seedFiles()
    store.upsertWindow({ ...store.get().windows.find((w) => w.id === 'f')!, roots: ['/a', '/c', '/d'] })
    expect(manager.openFromFiles('f', { kind: 'open', path: '/d/n.md', how: 'preview' })).toBe(true)
    const opened = created.at(-1)!
    expect(opened.entry).toMatchObject({ root: '/d', file: '/d/n.md', tabs: ['/d/n.md'], bounds: { x: 400, y: 100, width: 1040, height: 600 } })
    expect(opened.entry.kind).toBeUndefined()
    expect(sent(opened.win)).toEqual([])
    manager.openFromFiles('f', { kind: 'history', path: '/d/n.md' })
    expect(created).toHaveLength(5) // the window just opened shows /d now
    manager.openFromFiles('f', { kind: 'review', dir: '/a/x' })
    expect(created).toHaveLength(5)
    opened.win.destroy()
    manager.openFromFiles('f', { kind: 'share', path: '/d/n.md' })
    const again = created.at(-1)!
    expect(again.entry).toMatchObject({ root: '/d', file: null })
    expect(sent(again.win)).toEqual([]) // held: its page does not listen yet
    manager.handleLinkReady(again.win.webContents)
    expect(sent(again.win)).toEqual([{ kind: 'share', path: '/d/n.md' }])
    void f
  })

  it('D2: a Files window is no target of a link, a moved tab or a vault raise', () => {
    const { manager, created, f, w1 } = seedFiles()
    // Only the Files window shows /c besides w3; with w3 gone a link to /c opens a NEW window, not the Files window.
    created[2].win.destroy()
    manager.routeToFile('/c/y.md')
    expect(created.at(-1)!.entry).toMatchObject({ root: '/c', file: '/c/y.md' })
    expect(f.webContents.send.mock.calls.some(([ch]) => ch === CONTRACT.link.onOpenFile.channel)).toBe(false)
    expect(manager.rootFor('/c/z.md')).toBe('/c')
    expect(manager.moveTo('f', '/a/x.md')).toBe(false)
    expect(manager.moveTab('w1', 'f', REF)).toBe(false)
    // ⌘1–9 / Open Recent raise the vault's full windows only.
    const focusBefore = f.focusCount
    manager.openRecentBeside('/a')
    expect(f.focusCount).toBe(focusBefore)
    expect(w1.focusCount).toBe(1)
  })

  it('D1: ⌘⇧N, "Move to new window" and the board\'s "New window" from a Files window make FULL windows beside it, the sidebar shown', () => {
    const { manager, created } = seedFiles()
    const files = store.get().windows.find((w) => w.id === 'f')!
    manager.duplicateWindow({ ...files, sidebarCollapsed: true })
    expect(created.at(-1)!.entry).toMatchObject({ roots: ['/a', '/c'], sidebarCollapsed: false, bounds: { x: 400, y: 100, width: 1040, height: 600 } })
    expect(created.at(-1)!.entry.kind).toBeUndefined()
    manager.openBehind(files)
    expect(created.at(-1)!.entry.kind).toBeUndefined()
    manager.popOut(files, '/a/x.md')
    expect(created.at(-1)!.entry.kind).toBeUndefined()
  })

  it('D3: the board makes the Files window wide while its narrow bounds stay stored; closing puts them back; a quit while wide keeps them narrow', async () => {
    const { manager, f } = seedFiles()
    const narrow = { x: 120, y: 100, width: 280, height: 600 }
    expect(manager.filesWide('f', true)).toBe(true)
    expect(f.setBoundsCalls).toEqual([[{ x: 120, y: 100, width: 1200, height: 600 }, false]])
    vi.advanceTimersByTime(BOUNDS_DEBOUNCE_MS * 2)
    expect(store.get().windows.find((w) => w.id === 'f')?.bounds).toEqual(narrow)
    // Twice open is one growth.
    manager.filesWide('f', true)
    expect(f.setBoundsCalls).toHaveLength(1)
    expect(manager.filesWide('f', false)).toBe(true)
    expect(f.setBoundsCalls.at(-1)).toEqual([narrow, false])
    vi.advanceTimersByTime(BOUNDS_DEBOUNCE_MS * 2)
    expect(store.get().windows.find((w) => w.id === 'f')?.bounds).toEqual(narrow)
    // Wide again, then quit: the next launch opens it narrow.
    manager.filesWide('f', true)
    const quit = manager.flushAllForQuit()
    for (const c of [f]) manager.handleFlushed(c.webContents)
    vi.advanceTimersByTime(FLUSH_TIMEOUT_MS)
    await quit
    expect(store.get().windows.find((w) => w.id === 'f')?.bounds).toEqual(narrow)
    // A full window never grows.
    expect(manager.filesWide('w1', true)).toBe(false)
  })

  it('D9: the floating preview stands right of the Files window on the row\'s height, or left with no room; null hides it', () => {
    const content = { x: 100, y: 128, width: 280, height: 572 }
    expect(filesPreviewBounds(content, [AREA], { width: 500, height: 300, top: 200, bottom: 220 })).toEqual({ x: 380, y: 188, width: 500, height: 300 })
    // No room right of a window at the screen's right edge: left of it.
    expect(filesPreviewBounds({ ...content, x: 1100 }, [AREA], { width: 500, height: 300, top: 200, bottom: 220 })).toEqual({ x: 600, y: 188, width: 500, height: 300 })
    // A row near the bottom keeps the panel on the screen.
    expect(filesPreviewBounds(content, [AREA], { width: 500, height: 600, top: 700, bottom: 720 })).toEqual({ x: 380, y: 300, width: 500, height: 600 })
    const { manager, previews, f } = seedFiles()
    expect(manager.filesPreview('f', { width: 500, height: 300, top: 200, bottom: 220 })).toBe(true)
    expect(manager.filesPreview('f', null)).toBe(true)
    expect(previews).toEqual([[f, { x: 400, y: 188, width: 500, height: 300 }], [f, null]])
    expect(manager.filesPreview('w1', null)).toBe(false)
    // YAZ-3432: at App size 125% the page's px are 1.25 screen px, so the panel and the row's height scale.
    store.setSettings({ ...store.get().settings, appZoom: 125 })
    manager.filesPreview('f', { width: 400, height: 240, top: 160, bottom: 176 })
    expect(previews.at(-1)).toEqual([f, { x: 400, y: 188, width: 500, height: 300 }])
  })
})

describe('createWindowManager: the empty-window door (YAZ-3487 D1, D2, D3)', () => {
  const bounds = { x: 0, y: 0, width: 800, height: 600 }
  /** A stored window on `roots`: `tabs` open, the first on show; none = an EMPTY window. */
  const entry = (id: string, roots: string[], tabs: string[] = [], extra: Partial<WindowEntry> = {}): WindowEntry => ({ id, root: roots[0], roots, file: tabs[0] ?? null, tabs, rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'files', bounds, ...extra })
  /** The windows restored and each one ready for `link:*` messages. */
  const seed = (...entries: WindowEntry[]) => {
    for (const e of entries) store.upsertWindow(e)
    const { host, created } = makeHost()
    const manager = createWindowManager(store, host)
    manager.restore('all')
    for (const c of created) manager.handleLinkReady(c.win.webContents)
    const win = (id: string) => created.find((c) => c.entry.id === id)!.win
    return { manager, created, win }
  }

  it('S3: an EMPTY window asks for a vault with no window → it hears link:set-roots, no window opens, the MRU is bumped', () => {
    const { manager, created, win } = seed(entry('e', ['/v/a']))
    expect(manager.openRecentBeside('/v/c', 'e')).toBe(true)
    expect(created).toHaveLength(1)
    expect(win('e').webContents.send).toHaveBeenLastCalledWith(CONTRACT.link.onSetRoots.channel, ['/v/c'])
    expect(store.get().recents[0]?.path).toBe('/v/c')
  })

  it('S4: the vault has a window → that window comes to the front; the empty window hears nothing (YAZ-2602 D6)', () => {
    const { manager, created, win } = seed(entry('e', ['/v/a']), entry('b', ['/v/b'], ['/v/b/x.md']))
    const focused = win('b').focusCount
    expect(manager.openRecentBeside('/v/b', 'e')).toBe(true)
    expect(created).toHaveLength(2)
    expect(win('b').focusCount).toBe(focused + 1)
    expect(win('e').webContents.send).not.toHaveBeenCalledWith(CONTRACT.link.onSetRoots.channel, expect.anything())
  })

  it('S1, S5: "Open by itself" — a window with a tab gets a NEW window; an empty workspace window takes the vault alone', () => {
    const busy = seed(entry('ab', ['/v/a', '/v/b'], ['/v/a/x.md']))
    expect(busy.manager.openAlone('/v/b', 'ab')).toBe(true)
    expect(busy.created).toHaveLength(2)
    expect(busy.created[1].entry).toMatchObject({ roots: ['/v/b'], file: null, tabs: [] })
    expect(store.get().windows.find((w) => w.id === 'ab')?.roots).toEqual(['/v/a', '/v/b'])

    const empty = seed(entry('ab2', ['/v/c', '/v/d']))
    const before = empty.created.length // every stored window comes back, the first test's too
    expect(empty.manager.openAlone('/v/d', 'ab2')).toBe(true)
    expect(empty.created).toHaveLength(before)
    expect(empty.win('ab2').webContents.send).toHaveBeenLastCalledWith(CONTRACT.link.onSetRoots.channel, ['/v/d'])
  })

  it('S6, S7, S8: the blank tab is no tab; a right-panel item, a page on show, or a Files window is NOT empty → a new window opens', () => {
    const { manager, created } = seed(
      entry('right', ['/v/a'], [], { rightPanel: { ...defaultRightPanelIdentity(), items: ['/v/a/side.md'] } }),
      entry('files', ['/v/a'], [], { kind: 'files' }),
    )
    expect(manager.openRecentBeside('/v/c', 'right')).toBe(true)
    expect(manager.openRecentBeside('/v/d', 'files')).toBe(true)
    expect(created.slice(2).map((c) => c.entry.roots)).toEqual([['/v/c'], ['/v/d']])
  })

  it('S9: a workspace row in an EMPTY window → the window takes the set\'s vaults that are left; the set becomes the last used', () => {
    const work = store.saveVaultSet('Work', ['/v/b', '/v/a'], 1)!
    const { manager, created, win } = seed(entry('e', ['/v/x']))
    expect(manager.openVaultSet(work.id, 'e')).toEqual({ opened: true, missing: [] })
    expect(created).toHaveLength(1)
    expect(win('e').webContents.send).toHaveBeenLastCalledWith(CONTRACT.link.onSetRoots.channel, ['/v/b', '/v/a'])
  })

  it('S10, S12: a Welcome window (no vault) in front counts as empty: ⌘<n> sends it the vault, and no window opens', () => {
    const { manager, created, win } = seed({ ...entry('wel', ['/x']), root: null, roots: [] })
    expect(manager.openRecentBeside('/v/c', 'wel')).toBe(true)
    expect(created).toHaveLength(1)
    expect(win('wel').webContents.send).toHaveBeenLastCalledWith(CONTRACT.link.onSetRoots.channel, ['/v/c'])
  })

  it('D15: with "Open on: Its last note" a new window opens on the vault\'s last file, as before YAZ-3487; blank is the default', () => {
    store.setFolder('/v/c', { lastFile: '/v/c/Start here.md' })
    const blank = seed(entry('b', ['/v/a'], ['/v/a/x.md']))
    blank.manager.openRecentBeside('/v/c', 'b')
    expect(blank.created.at(-1)!.entry.file).toBeNull()
    store.setFolder('/v/d', { lastFile: '/v/d/Notes.md' })
    store.setSettings({ ...store.get().settings, vaultOpensOn: 'last' })
    blank.manager.openAlone('/v/d', 'b')
    expect(blank.created.at(-1)!.entry).toMatchObject({ roots: ['/v/d'], file: '/v/d/Notes.md', tabs: ['/v/d/Notes.md'] })
  })

  it('S13: a folder that is gone → false; nothing is sent, nothing opens', () => {
    store.upsertWindow(entry('e', ['/v/a']))
    const { host, created } = makeHost(undefined, undefined, (p) => p !== '/v/gone')
    const manager = createWindowManager(store, host)
    manager.restore('all')
    manager.handleLinkReady(created[0].win.webContents)
    expect(manager.openRecentBeside('/v/gone', 'e')).toBe(false)
    expect(manager.openAlone('/v/gone', 'e')).toBe(false)
    expect(created).toHaveLength(1)
    expect(created[0].win.webContents.send).not.toHaveBeenCalledWith(CONTRACT.link.onSetRoots.channel, expect.anything())
  })
})

describe('createWindowManager: a closed window\'s notes go to "Recently closed" (YAZ-3487 D10)', () => {
  const close = async (manager: ReturnType<typeof createWindowManager>, win: FakeWindow) => {
    win.close()
    manager.handleFlushed(win.webContents)
    await vi.advanceTimersByTimeAsync(0)
  }

  it('S33: a window you close while others stay puts each of its notes in its vault\'s list', async () => {
    vi.setSystemTime(7000)
    const { manager, w1 } = seedTwo()
    await close(manager, w1)
    expect(store.get().folders['/v'].closed).toEqual({ '/v/a.md': 7000 })
  })

  it('S34, S44: the last window (a quit) and a Files window put nothing in the list', async () => {
    store.upsertWindow({ id: 'f', kind: 'files', root: '/v', roots: ['/v'], file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files', bounds: { x: 10, y: 10, width: 300, height: 600 } })
    store.upsertWindow({ id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md'], sidebarCollapsed: false, sidebarLens: 'files', bounds: { x: 10, y: 10, width: 800, height: 600 } })
    const { host, created } = makeHost()
    const manager = createWindowManager(store, host)
    manager.restore('all')
    await close(manager, created[0].win)
    await close(manager, created[1].win)
    expect(store.get().folders['/v']?.closed ?? {}).toEqual({})
  })
})
