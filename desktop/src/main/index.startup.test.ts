/**
 * THE GLUE in `index.ts` (YAZ-2131 1E, YAZ-2172): the Electron wiring no other suite loads, with
 * Electron and the heavy modules stubbed and the real link queue, link parser and profile override
 * left in. Every rule here is one a launch or size refactor (lazy imports, deferred IPC, the V8
 * code cache on `app://`) could break without an error: a cold-start link opening nothing, a test
 * profile taking the real app's lock, the renderer losing its secure origin, a quit that exits
 * before the last edit is written.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fileLink } from '@shared/links'

const h = vi.hoisted(() => {
  const s = {
    order: [] as string[],
    on: new Map<string, (...args: unknown[]) => void>(),
    ready: (): void => undefined,
    windows: [] as Array<{ isDestroyed: () => boolean; isMinimized: () => boolean; restore: () => void; focus: () => void }>,
  }
  const log = (entry: string) => () => void s.order.push(entry)
  const app = {
    isPackaged: true,
    setName: vi.fn(),
    setPath: vi.fn((name: string) => s.order.push(`setPath:${name}`)),
    requestSingleInstanceLock: vi.fn(() => (s.order.push('singleInstanceLock'), true)),
    setAsDefaultProtocolClient: vi.fn(),
    on: vi.fn((event: string, fn: (...args: unknown[]) => void) => {
      s.order.push(`on:${event}`)
      s.on.set(event, fn)
    }),
    whenReady: vi.fn(() => new Promise<void>((resolve) => (s.ready = () => (s.order.push('ready'), resolve())))),
    getPath: vi.fn(() => '/profile'),
    quit: vi.fn(),
    exit: vi.fn(log('exit')),
  }
  const manager = {
    restoreAll: vi.fn(log('restoreAll')),
    routeToFile: vi.fn((path: string) => s.order.push(`route:${path}`)),
    linkNotice: vi.fn(),
    idFor: vi.fn(),
    flushAllForQuit: vi.fn(async (): Promise<void> => void s.order.push('flushAllForQuit')),
  }
  const store = {
    get: () => ({ settings: { theme: 'system' }, windows: [], recents: [] }),
    flush: vi.fn(async () => void s.order.push('store.flush')),
  }
  const gitSync = { notifyFocus: vi.fn(), notifyWake: vi.fn(), flushForQuit: vi.fn(async (): Promise<void> => void s.order.push('gitSync.flushForQuit')) }
  return {
    s,
    app,
    manager,
    store,
    gitSync,
    protocol: { registerSchemesAsPrivileged: vi.fn(log('registerSchemesAsPrivileged')), handle: vi.fn() },
    flushIndexCache: vi.fn(async () => void s.order.push('flushIndexCache')),
    registerIpc: vi.fn(() => (s.order.push('registerIpc'), gitSync)),
    registerClipboardIpc: vi.fn(log('registerClipboardIpc')),
    registerAgentIpc: vi.fn(log('registerAgentIpc')),
  }
})

vi.mock('electron', () => ({
  app: h.app,
  protocol: h.protocol,
  net: { fetch: vi.fn() },
  BrowserWindow: { getAllWindows: () => h.s.windows, getFocusedWindow: () => null },
  clipboard: { readText: vi.fn(), writeText: vi.fn() },
  Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
  nativeTheme: { shouldUseDarkColors: false },
  powerMonitor: { on: vi.fn() },
  screen: { getPrimaryDisplay: vi.fn(), getAllDisplays: vi.fn(() => []) },
  shell: { openExternal: vi.fn() },
}))
vi.mock('./store', () => ({ createStore: () => h.store }))
vi.mock('./windows', () => ({ createWindowManager: () => h.manager }))
vi.mock('./vaultIndex', () => ({ initIndexCache: vi.fn(), flushIndexCache: h.flushIndexCache }))
vi.mock('./ipc', () => ({ registerIpc: h.registerIpc }))
vi.mock('./ipc/clipboard', () => ({ registerClipboardIpc: h.registerClipboardIpc }))
vi.mock('./ipc/agent', () => ({ registerAgentIpc: h.registerAgentIpc }))
vi.mock('./theme', () => ({ subscribeNativeTheme: vi.fn(), windowBackgroundColor: vi.fn() }))
vi.mock('./menu', () => ({
  buildContextMenuTemplate: vi.fn(),
  buildMenuTemplate: vi.fn(() => []),
  createMenuHandlers: vi.fn(() => ({})),
  pickMenuTargetWindow: vi.fn(),
  subscribeMenuRebuild: vi.fn(),
}))

const NOTE = '/vault/Plans/Roadmap.md'
const event = () => ({ preventDefault: vi.fn() })
/** Lets `whenReady().then(…)` and a `.then` chain run to their ends. */
const settle = () => new Promise((r) => setTimeout(r, 0))
/** A promise and the function that resolves it, to hold one quit step open. */
function gate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void
  const promise = new Promise<void>((r) => (open = r))
  return { promise, open }
}

beforeEach(async () => {
  vi.clearAllMocks()
  Object.assign(h.s, { order: [], on: new Map(), windows: [] })
  vi.stubEnv('YASEEN_DOCS_USER_DATA_DIR', '/tmp/isolated-profile')
  vi.resetModules()
  await import('./index')
})

describe('main startup order (YAZ-2172)', () => {
  it('applies the isolated profile before the single-instance lock, so a test profile runs beside the real app', () => {
    expect(h.app.setPath).toHaveBeenCalledWith('userData', '/tmp/isolated-profile')
    expect(h.s.order.indexOf('setPath:userData')).toBeLessThan(h.s.order.indexOf('singleInstanceLock'))
  })

  it('registers app:// with exactly standard + secure + fetch, before ready', () => {
    expect(h.protocol.registerSchemesAsPrivileged).toHaveBeenCalledExactlyOnceWith([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }])
    expect(h.s.order).not.toContain('ready')
  })

  it('listens for open-url and open-file before ready, and routes a cold-start link only after the windows are restored', async () => {
    expect(h.s.order).toEqual(expect.arrayContaining(['on:second-instance', 'on:open-url', 'on:open-file']))
    expect(h.s.order).not.toContain('ready')
    const e = event()
    h.s.on.get('open-file')!(e, NOTE)
    expect(e.preventDefault).toHaveBeenCalled()
    expect(h.manager.routeToFile).not.toHaveBeenCalled()
    h.s.ready()
    await settle()
    expect(h.s.order.slice(h.s.order.indexOf('ready'))).toEqual(['ready', 'registerClipboardIpc', 'registerAgentIpc', 'registerIpc', 'restoreAll', `route:${NOTE}`])
  })

  it('after ready a link routes at once, and a bad one gets the notice instead of a route', async () => {
    h.s.ready()
    await settle()
    h.s.on.get('open-url')!(event(), fileLink(NOTE))
    expect(h.manager.routeToFile).toHaveBeenCalledWith(NOTE, null)
    h.s.on.get('open-url')!(event(), 'https://example.com')
    expect(h.manager.linkNotice).toHaveBeenCalledWith("Can't open link: https://example.com")
  })

  it('a second launch routes the link in its argv, and without one focuses the first window', async () => {
    h.s.ready()
    await settle()
    const win = { isDestroyed: () => false, isMinimized: () => true, restore: vi.fn(), focus: vi.fn() }
    h.s.windows = [win]
    h.s.on.get('second-instance')!(event(), ['/Applications/Yaseen Docs.app/Contents/MacOS/Yaseen Docs', fileLink(NOTE)])
    expect(h.manager.routeToFile).toHaveBeenCalledWith(NOTE, null)
    expect(win.focus).not.toHaveBeenCalled()
    h.s.on.get('second-instance')!(event(), ['/Applications/Yaseen Docs.app/Contents/MacOS/Yaseen Docs', '--flag'])
    expect([win.restore, win.focus].map((f) => f.mock.calls.length)).toEqual([1, 1])
  })
})

describe('main quit order: before-quit runs runQuitSequence with the live deps (YAZ-2172, YAZ-2174)', () => {
  it('flushes the renderers first, then the store, index cache and git sync, and exits only once those settle (YAZ-1081 D2)', async () => {
    h.s.ready()
    await settle() // `whenReady` ran: registerIpc handed back the sync manager
    const renderers = gate()
    const git = gate()
    h.manager.flushAllForQuit.mockImplementationOnce(() => (h.s.order.push('flushAllForQuit'), renderers.promise))
    h.gitSync.flushForQuit.mockImplementationOnce(() => (h.s.order.push('gitSync.flushForQuit'), git.promise))
    h.s.order.length = 0
    const quit = h.s.on.get('before-quit')!
    const first = event()
    quit(first)
    expect(first.preventDefault).toHaveBeenCalled()
    await settle()
    expect(h.s.order).toEqual(['flushAllForQuit'])
    // `app.exit` fires no quit events, but a second ⌘Q while flushing must not start a second sequence.
    const again = event()
    quit(again)
    expect(again.preventDefault).toHaveBeenCalled()
    expect(h.manager.flushAllForQuit).toHaveBeenCalledTimes(1)
    renderers.open()
    await settle()
    expect(h.s.order).toEqual(['flushAllForQuit', 'store.flush', 'flushIndexCache', 'gitSync.flushForQuit'])
    git.open()
    await settle()
    expect(h.s.order).toEqual(['flushAllForQuit', 'store.flush', 'flushIndexCache', 'gitSync.flushForQuit', 'exit'])
    expect(h.app.exit).toHaveBeenCalledExactlyOnceWith(0)
  })

  it('one rejected step skips none of the others, and the app still exits', async () => {
    h.s.ready()
    await settle()
    h.manager.flushAllForQuit.mockRejectedValueOnce(new Error('a window hung'))
    h.store.flush.mockRejectedValueOnce(new Error('disk full'))
    h.s.order.length = 0
    h.s.on.get('before-quit')!(event())
    await settle()
    expect(h.s.order).toEqual(['flushIndexCache', 'gitSync.flushForQuit', 'exit'])
    expect(h.store.flush).toHaveBeenCalledOnce()
    expect(h.manager.flushAllForQuit).toHaveBeenCalledOnce()
  })

  it('a quit before ready (no sync manager yet) still flushes and exits', async () => {
    h.s.on.get('before-quit')!(event())
    await settle()
    expect(h.s.order.slice(h.s.order.indexOf('flushAllForQuit'))).toEqual(['flushAllForQuit', 'store.flush', 'flushIndexCache', 'exit'])
  })
})

describe('runQuitSequence (YAZ-2174)', () => {
  it('never rejects, whichever step fails, and always exits', async () => {
    const { runQuitSequence } = await import('./quitSequence')
    const exit = vi.fn()
    const fail = () => Promise.reject(new Error('no'))
    await expect(runQuitSequence({ flushWindows: fail, flushStore: fail, flushIndex: fail, flushSync: fail, exit })).resolves.toBeUndefined()
    expect(exit).toHaveBeenCalledOnce()
  })
})
