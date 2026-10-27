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
    /** The store's windows, as far as this file reads them: each one's id and its vaults. */
    stored: [] as Array<{ id: string; roots: string[] }>,
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
    getAppPath: vi.fn(() => '/Applications/Yaseen Docs.app/Contents/Resources/app.asar'),
    getVersion: vi.fn(() => '1.0.12'),
    quit: vi.fn(),
    exit: vi.fn(log('exit')),
  }
  const manager = {
    // A path under `/gone` cannot open: the manager says it has no vault (YAZ-2589 A6).
    rootFor: vi.fn((path: string): string | null => (path.startsWith('/gone') ? null : `root-of:${path}`)),
    restore: vi.fn((which: readonly string[] | string) => void s.order.push(`restore:${String(which)}`)),
    routeToFile: vi.fn((path: string) => s.order.push(`route:${path}`)),
    linkNotice: vi.fn(),
    idFor: vi.fn(),
    flushAllForQuit: vi.fn(async (): Promise<void> => void s.order.push('flushAllForQuit')),
  }
  const store = {
    get: () => ({ settings: { theme: 'system', startupWindows: 'none' }, windows: s.stored, recents: [] }),
    flush: vi.fn(async () => void s.order.push('store.flush')),
    // The 1.0.15 heading styles (YAZ-3066 D11): none here, so the move writes nothing.
    takeLegacyHeadingStyles: vi.fn(() => (s.order.push('takeLegacyHeadingStyles'), {})),
  }
  /** The updater's face to index.ts (YAZ-2976); `updater.test.ts` tests the updater itself. */
  const updater = {
    kind: 'idle' as string,
    start: vi.fn(log('updater.start')),
    check: vi.fn(async (): Promise<{ kind: string }> => ({ kind: 'idle' })),
    state: vi.fn(() => ({ kind: updater.kind })),
    notes: vi.fn(async () => []),
    installOnExit: vi.fn((reopen: boolean) => void s.order.push(`installOnExit:${String(reopen)}`)),
  }
  const gitSync = { notifyFocus: vi.fn(), notifyWake: vi.fn(), flushForQuit: vi.fn(async (): Promise<void> => void s.order.push('gitSync.flushForQuit')) }
  return {
    s,
    app,
    manager,
    store,
    gitSync,
    updater,
    createUpdater: vi.fn(() => updater),
    /** `ipcMain.handle` by channel: the update doors register through the real envelope. */
    handles: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
    protocol: { registerSchemesAsPrivileged: vi.fn(log('registerSchemesAsPrivileged')), handle: vi.fn() },
    flushIndexCache: vi.fn(async () => void s.order.push('flushIndexCache')),
    // The settings folder (YAZ-3276 D4) with no folder chosen: its first read is done at once, and quit has nothing to write.
    settingsFolder: { ready: Promise.resolve(), missing: () => false, hasOtherMacs: async () => false, settled: async () => undefined, flush: vi.fn(async () => undefined), close: async () => undefined },
    registerIpc: vi.fn(() => (s.order.push('registerIpc'), { sync: gitSync, secrets: {} })),
    registerClipboardIpc: vi.fn(log('registerClipboardIpc')),
    /** The Draw import's wiring (YAZ-3028 D6); `drawImport.test.ts` tests the import itself. */
    startDrawImport: vi.fn((_deps: Record<string, unknown>) => void s.order.push('startDrawImport')),
  }
})

// Electron sets it in a real app; main reads it at `ready` for the share viewer's place (YAZ-3040).
Object.defineProperty(process, 'resourcesPath', { value: '/Applications/Yaseen Docs.app/Contents/Resources', configurable: true })

vi.mock('electron', () => ({
  app: h.app,
  ipcMain: { handle: vi.fn((channel: string, fn: (...args: unknown[]) => Promise<unknown>) => h.handles.set(channel, fn)) },
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
// The diaries of links (YAZ-2677 R27) are flushed with the index cache, in the same step.
vi.mock('./vaultIndex', () => ({ initIndexCache: vi.fn(), flushIndexCache: h.flushIndexCache, flushDiaries: vi.fn(async () => undefined) }))
vi.mock('./ipc', () => ({ registerIpc: h.registerIpc }))
vi.mock('./settingsFolder', () => ({ followSettingsFolder: () => h.settingsFolder }))
vi.mock('./library/folder', () => ({ ensureLibraryFolder: vi.fn(async () => '/userData/library') }))
vi.mock('./updater', async (importOriginal) => ({ shortVersion: (await importOriginal<typeof import('./updater')>()).shortVersion, createUpdater: h.createUpdater, runFile: vi.fn(), spawnDetached: vi.fn(), RELEASES_PAGE: 'https://github.com/yaseenarshad/yaseen-docs-app/releases/latest' }))
vi.mock('./ipc/clipboard', () => ({ registerClipboardIpc: h.registerClipboardIpc }))
vi.mock('./drawImport', async (importOriginal) => ({ ...(await importOriginal<typeof import('./drawImport')>()), startDrawImport: h.startDrawImport }))
vi.mock('./theme', () => ({ subscribeNativeTheme: vi.fn(), windowBackgroundColor: vi.fn() }))
vi.mock('./menu', () => ({
  buildContextMenuTemplate: vi.fn(),
  buildMenuTemplate: vi.fn(() => []),
  createMenuHandlers: vi.fn(() => ({})),
  gateOnBoardKind: vi.fn((_kind: unknown, apply: () => void) => ({ apply, applyIfMoved: apply })),
  menuKeyedVaults: vi.fn(() => []),
  pickMenuTargetWindow: vi.fn(),
  subscribeMenuRebuild: vi.fn(),
  subscribeMenuRebuildOnActiveFile: vi.fn(),
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
  Object.assign(h.s, { order: [], on: new Map(), windows: [], stored: [] })
  h.handles.clear()
  h.updater.kind = 'idle'
  vi.stubEnv('YASEEN_DOCS_USER_DATA_DIR', '/tmp/isolated-profile')
  vi.stubEnv('YASEEN_DOCS_E2E', '')
  vi.resetModules()
  await import('./index')
})

describe('main startup order (YAZ-2172)', () => {
  it('applies the isolated profile before the single-instance lock, so a test profile runs beside the real app', () => {
    expect(h.app.setPath).toHaveBeenCalledWith('userData', '/tmp/isolated-profile')
    expect(h.s.order.indexOf('setPath:userData')).toBeLessThan(h.s.order.indexOf('singleInstanceLock'))
  })

  it('claims the yaseendocs:// and yaseendraw:// handlers once each, and never under the e2e harness (YAZ-2131 🔒 D8, YAZ-3028 D7)', async () => {
    expect(h.app.setAsDefaultProtocolClient.mock.calls).toEqual([['yaseendocs'], ['yaseendraw']])
    vi.clearAllMocks()
    vi.stubEnv('YASEEN_DOCS_E2E', '1')
    vi.resetModules()
    await import('./index')
    expect(h.app.setAsDefaultProtocolClient).not.toHaveBeenCalled()
  })

  it('registers app:// with exactly standard + secure + fetch + code cache, before ready', () => {
    expect(h.protocol.registerSchemesAsPrivileged).toHaveBeenCalledExactlyOnceWith([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } }])
    expect(h.s.order).not.toContain('ready')
  })

  it('listens for open-url and open-file before ready; a launch with a waiting link asks the manager for that link\'s vault only, and routes the link after the windows are restored (YAZ-2589 D1)', async () => {
    expect(h.s.order).toEqual(expect.arrayContaining(['on:second-instance', 'on:open-url', 'on:open-file']))
    expect(h.s.order).not.toContain('ready')
    const e = event()
    h.s.on.get('open-file')!(e, NOTE)
    expect(e.preventDefault).toHaveBeenCalled()
    expect(h.manager.routeToFile).not.toHaveBeenCalled()
    h.s.ready()
    await settle()
    // Every door registered before the windows restore; the cold-start link routes only after them.
    const at = (entry: string) => h.s.order.indexOf(entry)
    for (const door of ['registerClipboardIpc', 'registerIpc']) expect(at(door)).toBeGreaterThan(at('ready'))
    for (const door of ['registerClipboardIpc', 'registerIpc']) expect(at(door)).toBeLessThan(at(`restore:root-of:${NOTE}`))
    expect(at(`route:${NOTE}`)).toBeGreaterThan(at(`restore:root-of:${NOTE}`))
    expect(h.manager.rootFor).toHaveBeenCalledExactlyOnceWith(NOTE, null)
    expect(h.manager.restore).toHaveBeenCalledExactlyOnceWith([`root-of:${NOTE}`])
  })

  it('a launch with two waiting links asks for both vaults; a link that cannot be read and a path that cannot open ask for nothing, and are handled all the same (YAZ-2589 S6, S7, A6)', async () => {
    h.s.on.get('open-url')!(event(), 'https://example.com')
    h.s.on.get('open-url')!(event(), `${fileLink('/work/a.md')}?root=${encodeURIComponent('/work')}`)
    h.s.on.get('open-file')!(event(), '/gone/x.md')
    h.s.on.get('open-file')!(event(), '/vault')
    h.s.ready()
    await settle()
    expect(h.manager.rootFor.mock.calls).toEqual([['/work/a.md', '/work'], ['/gone/x.md', null], ['/vault', null]])
    expect(h.manager.restore).toHaveBeenCalledExactlyOnceWith(['root-of:/work/a.md', 'root-of:/vault'])
    expect(h.manager.linkNotice).toHaveBeenCalledExactlyOnceWith("Can't open link: https://example.com")
    expect(h.manager.routeToFile.mock.calls).toEqual([['/work/a.md', '/work'], ['/gone/x.md', null], ['/vault', null]]) // the manager says why the dead one cannot open
  })

  it.each<[string, string[], Array<[string]>, Array<[string, null]>]>([
    ['nothing waits', [], [], []],
    ['the only link cannot be read (S7)', ['https://example.com'], [["Can't open link: https://example.com"]], []],
    ['the only request is a file that is gone (S8, A6)', [fileLink('/gone/x.md')], [], [['/gone/x.md', null]]],
  ])('a plain launch gives the manager the setting, and only then handles what waits (YAZ-2589 D2): %s', async (_case, urls, notices, routes) => {
    for (const url of urls) h.s.on.get('open-url')!(event(), url)
    h.s.ready()
    await settle()
    expect(h.manager.restore).toHaveBeenCalledExactlyOnceWith('none')
    // The 1.0.15 heading styles move once, before `restore` drops the windows a launch does not bring back (YAZ-3066 D11).
    expect(h.store.takeLegacyHeadingStyles).toHaveBeenCalledOnce()
    expect(h.s.order.indexOf('takeLegacyHeadingStyles')).toBeLessThan(h.s.order.indexOf('restore:none'))
    expect(h.manager.rootFor.mock.calls).toEqual(routes)
    expect(h.manager.linkNotice.mock.calls).toEqual(notices)
    expect(h.manager.routeToFile.mock.calls).toEqual(routes)
    const restored = h.manager.restore.mock.invocationCallOrder[0]
    for (const handled of [...h.manager.linkNotice.mock.invocationCallOrder, ...h.manager.routeToFile.mock.invocationCallOrder]) expect(handled).toBeGreaterThan(restored)
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
    // Draw's scheme rides the same door (YAZ-3028 D7).
    h.s.on.get('second-instance')!(event(), ['/Applications/Yaseen Docs.app/Contents/MacOS/Yaseen Docs', 'yaseendraw:///vault/Board%20one.excalidraw'])
    expect(h.manager.routeToFile).toHaveBeenLastCalledWith('/vault/Board one.excalidraw', null)
    expect(win.focus).not.toHaveBeenCalled()
    h.s.on.get('second-instance')!(event(), ['/Applications/Yaseen Docs.app/Contents/MacOS/Yaseen Docs', '--flag'])
    expect([win.restore, win.focus].map((f) => f.mock.calls.length)).toEqual([1, 1])
  })

  it('a yaseendraw:// link opens the file like a yaseendocs:// one (YAZ-3028 D7)', async () => {
    h.s.ready()
    await settle()
    h.s.on.get('open-url')!(event(), 'yaseendraw:///vault/Board%20one.excalidraw?root=%2Fvault')
    expect(h.manager.routeToFile).toHaveBeenCalledWith('/vault/Board one.excalidraw', '/vault')
  })

  it('starts the Draw import once on ready, before the windows restore, with the app-data half off for an isolated profile (YAZ-3028 D6)', async () => {
    expect(h.startDrawImport).not.toHaveBeenCalled()
    h.s.ready()
    await settle()
    expect(h.startDrawImport).toHaveBeenCalledOnce()
    expect(h.startDrawImport.mock.calls[0]![0]).toMatchObject({ drawDir: '/profile/Yaseen Draw', userData: '/profile', appData: false })
    expect(h.s.order.indexOf('startDrawImport')).toBeLessThan(h.s.order.findIndex((e) => e.startsWith('restore:')))
  })
})

describe('a window focus is a pull trigger (YAZ-1081 D2)', () => {
  it('asks the sync manager to pull EVERY vault the focused window shows, and no vault of another window; a Welcome window or an unknown one asks for none (YAZ-2602 S43)', async () => {
    h.s.ready()
    await settle() // `whenReady` ran: registerIpc handed back the sync manager (and the one secrets instance)
    h.s.stored = [{ id: 'w1', roots: ['/notes', '/work'] }, { id: 'w2', roots: ['/other'] }, { id: 'w3', roots: [] }]
    const focus = (id: string | undefined) => {
      const webContents = { id: 7 }
      h.manager.idFor.mockReturnValue(id)
      h.gitSync.notifyFocus.mockClear()
      h.s.on.get('browser-window-focus')!(event(), { webContents })
      expect(h.manager.idFor).toHaveBeenLastCalledWith(webContents)
      return h.gitSync.notifyFocus.mock.calls
    }
    expect(focus('w1')).toEqual([['/notes'], ['/work']])
    expect(focus('w2')).toEqual([['/other']])
    expect(focus('w3')).toEqual([])
    expect(focus(undefined)).toEqual([])
  })
})

describe('main quit order: before-quit runs runQuitSequence with the live deps (YAZ-2172, YAZ-2174)', () => {
  it('flushes the renderers first, then the store, index cache and git sync, and exits only once those settle (YAZ-1081 D2)', async () => {
    h.s.ready()
    await settle() // `whenReady` ran: registerIpc handed back the sync manager (and the one secrets instance)
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
    // The swap starts last, with no reopen for a plain quit (YAZ-2976 S22), right before the exit.
    expect(h.s.order).toEqual(['flushAllForQuit', 'store.flush', 'flushIndexCache', 'gitSync.flushForQuit', 'installOnExit:false', 'exit'])
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
    expect(h.s.order).toEqual(['flushIndexCache', 'gitSync.flushForQuit', 'installOnExit:false', 'exit'])
    expect(h.store.flush).toHaveBeenCalledOnce()
    expect(h.manager.flushAllForQuit).toHaveBeenCalledOnce()
  })

  it('a quit before ready (no sync manager yet) still flushes and exits', async () => {
    h.s.on.get('before-quit')!(event())
    await settle()
    expect(h.s.order.slice(h.s.order.indexOf('flushAllForQuit'))).toEqual(['flushAllForQuit', 'store.flush', 'flushIndexCache', 'installOnExit:false', 'exit'])
  })
})

describe('the updater in index.ts (YAZ-2976)', () => {
  const invoke = (channel: string) => h.handles.get(channel)!({})

  it('is created once at load with the bundle, the version and the feed, and broadcasts each state to every window (S20)', async () => {
    expect(h.createUpdater).toHaveBeenCalledOnce()
    const [host, onState] = h.createUpdater.mock.calls[0] as unknown as [Record<string, unknown>, (s: unknown) => void]
    expect(host).toMatchObject({ bundle: '/Applications/Yaseen Docs.app', version: '1.0.12', userData: '/profile', isPackaged: true, pid: process.pid })
    const send = vi.fn()
    h.s.windows = [{ isDestroyed: () => false, webContents: { isDestroyed: () => false, send } }] as never
    onState({ kind: 'ready', version: '1.0.13' })
    expect(send).toHaveBeenCalledExactlyOnceWith('update:state-changed', { kind: 'ready', version: '1.0.13' })
  })

  it('on ready registers the three update doors before the windows restore, then starts the timer (D7)', async () => {
    expect([...h.handles.keys()]).toEqual([])
    h.s.ready()
    await settle()
    expect([...h.handles.keys()].sort()).toEqual(['update:notes', 'update:restart', 'update:state'])
    expect(h.s.order.indexOf('updater.start')).toBeLessThan(h.s.order.indexOf('restore:none'))
    h.updater.kind = 'manual'
    await expect(invoke('update:state')).resolves.toEqual({ ok: true, value: { kind: 'manual' } })
  })

  it('restart: manual opens the release page (S13, D3); ready quits, and the swap then reopens the app (S21); any other state does nothing', async () => {
    const { shell } = await import('electron')
    h.s.ready()
    await settle()
    h.updater.kind = 'idle'
    await invoke('update:restart')
    h.updater.kind = 'manual'
    await invoke('update:restart')
    expect(shell.openExternal).toHaveBeenCalledExactlyOnceWith('https://github.com/yaseenarshad/yaseen-docs-app/releases/latest')
    expect(h.app.quit).not.toHaveBeenCalled()
    h.updater.kind = 'ready'
    await invoke('update:restart')
    expect(h.app.quit).toHaveBeenCalledOnce()
    h.s.order.length = 0
    h.s.on.get('before-quit')!(event())
    await settle()
    expect(h.s.order.slice(-2)).toEqual(['installOnExit:true', 'exit'])
  })

  it('Check for Updates… answers in the window in front for each state: nothing newer says the version (S4), a download says so, a staged or manual update opens the sheet (S6), a failure says so (S5)', async () => {
    const menu = await import('./menu')
    const whatsNew = vi.fn()
    vi.mocked(menu.createMenuHandlers).mockReturnValueOnce({ whatsNew } as never)
    h.s.ready()
    await settle()
    const host = vi.mocked(menu.createMenuHandlers).mock.calls[0][1]
    const answers = [{ kind: 'idle' }, { kind: 'updated', version: '1.0.12' }, { kind: 'downloading', version: '1.0.13' }, { kind: 'ready', version: '1.0.13' }, { kind: 'manual', version: '1.0.13' }]
    for (const answer of answers) {
      h.updater.check.mockResolvedValueOnce(answer)
      host.checkForUpdates()
      await settle()
    }
    h.updater.check.mockRejectedValueOnce(new Error('offline'))
    host.checkForUpdates()
    await settle()
    expect(h.manager.linkNotice.mock.calls).toEqual([['Yaseen Docs 1.0.12 is the newest version'], ['Yaseen Docs 1.0.12 is the newest version'], ['Downloading Yaseen Docs 1.0.13…'], ["Can't check for updates. Try again later"]])
    expect(whatsNew).toHaveBeenCalledTimes(2)
  })

})

describe('runQuitSequence (YAZ-2174)', () => {
  it('never rejects, whichever step fails, and always exits', async () => {
    const { runQuitSequence } = await import('./quitSequence')
    const exit = vi.fn()
    const fail = () => Promise.reject(new Error('no'))
    await expect(runQuitSequence({ flushWindows: fail, flushStore: fail, flushIndex: fail, flushSync: fail, stopHelpers: fail, exit })).resolves.toBeUndefined()
    expect(exit).toHaveBeenCalledOnce()
  })
})
