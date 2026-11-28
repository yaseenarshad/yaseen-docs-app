import { EventEmitter } from 'node:events'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fileLink, workspaceLink } from '@shared/links'
import { defaultAppState, defaultFolderState, type AppState } from '@shared/types'
import { LAUNCHER_BUNDLE_ID_PREFIX, type LauncherPlistInfo } from './vaultLauncher'
import {
  allowedShimDirs,
  createAppShimController,
  isAppShimHostLaunch,
  validateShimConnection,
  vaultShimKey,
  workspaceShimKey,
  type AppShimEvent,
  type AppShimLike,
} from './appShims'

const BUNDLE_ID = `${LAUNCHER_BUNDLE_ID_PREFIX}work-1234abcd`
const BUNDLE_PATH = '/Applications/Work.app'
const VAULT = '/Users/yasin/vaults/work'

class FakeShim extends EventEmitter implements AppShimLike<string> {
  connected = true
  quitCount = 0
  menus: Array<string | null> = []
  checkedRequirements: string[] = []
  requirementResult: boolean | Error = true

  constructor(
    public readonly bundleId = BUNDLE_ID,
    public readonly bundlePath = BUNDLE_PATH,
    public readonly pid = 4242,
  ) {
    super()
  }

  isConnected(): boolean {
    return this.connected
  }

  quit(): void {
    this.quitCount++
    if (!this.connected) return
    this.connected = false
    this.emit('disconnected', { preventDefault: vi.fn() })
  }

  satisfiesCodeRequirement(requirement: string): boolean {
    this.checkedRequirements.push(requirement)
    if (this.requirementResult instanceof Error) throw this.requirementResult
    return this.requirementResult
  }

  setApplicationMenu(menu: string | null): void {
    this.menus.push(menu)
  }

  emitEvent(name: 'activate' | 'disconnected' | 'open-file' | 'open-url' | 'quit-requested', ...args: unknown[]): AppShimEvent {
    const ev: AppShimEvent = { preventDefault: vi.fn() }
    this.emit(name, ev, ...args)
    return ev
  }
}

function validPlist(overrides: Partial<LauncherPlistInfo> = {}): LauncherPlistInfo {
  return {
    bundleId: BUNDLE_ID,
    vaultPath: VAULT,
    vaultUrl: fileLink(VAULT),
    bundleVersion: 3,
    ...overrides,
  }
}

function makeHarness(opts: {
  state?: AppState
  plists?: Record<string, LauncherPlistInfo | null>
  exists?: (p: string) => boolean
  headlessStart?: boolean
  headlessGraceMs?: number
  pendingOpenTtlMs?: number
  now?: () => number
} = {}) {
  const state = opts.state ?? defaultAppState()
  const shimWindows = new Map<string, string[]>()
  let regularCount = 0
  const hostVaultWins = new Map<string, string>()
  const hostWorkspaceWins = new Map<string, string>()

  const windows = {
    openVaultSet: vi.fn((_id: string, _from?: string, shimKey?: string) => {
      if (shimKey !== undefined) {
        const list = shimWindows.get(shimKey) ?? []
        list.unshift(`ws-win-${list.length + 1}`)
        shimWindows.set(shimKey, list)
      }
      return { opened: true, missing: [] }
    }),
    routeToFile: vi.fn((_path: string, _root?: string | null, _open?: unknown, shimKey?: string) => {
      if (shimKey !== undefined) {
        const list = shimWindows.get(shimKey) ?? []
        if (list.length === 0) list.unshift(`win-${list.length + 1}`)
        shimWindows.set(shimKey, list)
      }
    }),
    windowsForShim: vi.fn((shimKey: string) => [...(shimWindows.get(shimKey) ?? [])]),
    regularWindowCount: vi.fn(() => regularCount),
    focusWindowById: vi.fn(() => true),
    findHostWindowForVault: vi.fn((root: string) => hostVaultWins.get(root)),
    findHostWindowForWorkspace: vi.fn((roots: readonly string[]) => hostWorkspaceWins.get(roots.join('|'))),
    handoffWindowToShim: vi.fn(async (windowId: string, shimKey: string) => {
      for (const [k, v] of hostVaultWins) if (v === windowId) hostVaultWins.delete(k)
      for (const [k, v] of hostWorkspaceWins) if (v === windowId) hostWorkspaceWins.delete(k)
      regularCount = Math.max(0, regularCount - 1)
      const list = shimWindows.get(shimKey) ?? []
      list.unshift(`handed-${windowId}`)
      shimWindows.set(shimKey, list)
      return `handed-${windowId}`
    }),
    flushAndCloseWindows: vi.fn(async (ids: readonly string[]) => {
      for (const [k, list] of shimWindows) {
        shimWindows.set(k, list.filter((id) => !ids.includes(id)))
      }
    }),
    linkNotice: vi.fn(),
  }

  const showHostDock = vi.fn()
  const hideHostDock = vi.fn()
  const quitHost = vi.fn()
  const handleLink = vi.fn()
  const launchApp = vi.fn()
  const warn = vi.fn()
  const onShimsChanged = vi.fn()
  const buildMenuForShim = vi.fn((shimKey: string) => `menu:${shimKey}`)

  const plists = opts.plists ?? { [BUNDLE_PATH]: validPlist() }
  const controller = createAppShimController<string>({
    store: { get: () => state },
    windows,
    readPlist: async (p) => plists[p] ?? null,
    allowedDirs: () => ['/Applications', join(homedir(), 'Applications')],
    buildMenuForShim,
    handleLink,
    exists: opts.exists ?? (() => true),
    launchApp,
    showHostDock,
    hideHostDock,
    quitHost,
    headlessStart: opts.headlessStart,
    headlessGraceMs: opts.headlessGraceMs,
    pendingOpenTtlMs: opts.pendingOpenTtlMs,
    now: opts.now,
    warn,
    onShimsChanged,
  })

  return {
    controller,
    state,
    windows,
    shimWindows,
    setRegularCount: (n: number) => {
      regularCount = n
    },
    hostVaultWins,
    hostWorkspaceWins,
    showHostDock,
    hideHostDock,
    quitHost,
    handleLink,
    launchApp,
    warn,
    onShimsChanged,
    buildMenuForShim,
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('isAppShimHostLaunch & allowedShimDirs', () => {
  it('detects --app-shim-host in argv', () => {
    expect(isAppShimHostLaunch(['/Applications/Yaseen Docs.app/Contents/MacOS/Yaseen Docs', '--app-shim-host'])).toBe(true)
    expect(isAppShimHostLaunch(['/Applications/Yaseen Docs.app/Contents/MacOS/Yaseen Docs'])).toBe(false)
  })

  it('defaults allowedShimDirs to /Applications and ~/Applications, and honors YASEEN_DOCS_APP_SHIM_DIRS', () => {
    expect(allowedShimDirs({})).toEqual(['/Applications', join(homedir(), 'Applications')])
    expect(allowedShimDirs({ YASEEN_DOCS_APP_SHIM_DIRS: '/tmp/shims:/var/tmp/more/' })).toEqual(['/tmp/shims', '/var/tmp/more'])
  })
})

describe('validateShimConnection (D5)', () => {
  const dirs = ['/Applications', '/Users/yasin/Applications']

  it('accepts valid vault and workspace shims and checks exact identifier code requirement', () => {
    const shim = new FakeShim()
    const res = validateShimConnection(shim, validPlist({ vaultPath: `${VAULT}/` }), dirs)
    expect(res).toEqual({
      ok: true,
      shimKey: VAULT,
      vaultPath: VAULT,
      vaultUrl: fileLink(VAULT),
      workspaceId: null,
    })
    expect(shim.checkedRequirements).toEqual([`identifier "${BUNDLE_ID}"`])

    const wsShim = new FakeShim(`${LAUNCHER_BUNDLE_ID_PREFIX}suite-9999aaaa`, '/Users/yasin/Applications/Suite.app')
    const wsRes = validateShimConnection(
      wsShim,
      validPlist({ bundleId: wsShim.bundleId, vaultPath: 'workspace:ws-1', vaultUrl: workspaceLink('ws-1') }),
      dirs,
    )
    expect(wsRes).toEqual({
      ok: true,
      shimKey: 'workspace:ws-1',
      vaultPath: 'workspace:ws-1',
      vaultUrl: workspaceLink('ws-1'),
      workspaceId: 'ws-1',
    })
  })

  it('rejects bad bundleId prefix or disallowed characters', () => {
    expect(validateShimConnection(new FakeShim('com.evil.app'), validPlist({ bundleId: 'com.evil.app' }), dirs).ok).toBe(false)
    expect(validateShimConnection(new FakeShim(LAUNCHER_BUNDLE_ID_PREFIX), validPlist({ bundleId: LAUNCHER_BUNDLE_ID_PREFIX }), dirs).ok).toBe(false)
    const badChars = `${LAUNCHER_BUNDLE_ID_PREFIX}bad"quote`
    expect(validateShimConnection(new FakeShim(badChars), validPlist({ bundleId: badChars }), dirs).ok).toBe(false)
  })

  it('rejects bundlePaths outside allowedDirs, nested subdirs, or with .. traversal', () => {
    expect(validateShimConnection(new FakeShim(BUNDLE_ID, '/tmp/Work.app'), validPlist(), dirs).ok).toBe(false)
    expect(validateShimConnection(new FakeShim(BUNDLE_ID, '/Applications/Sub/Work.app'), validPlist(), dirs).ok).toBe(false)
    expect(validateShimConnection(new FakeShim(BUNDLE_ID, '/Applications/../tmp/Work.app'), validPlist(), dirs).ok).toBe(false)
    expect(validateShimConnection(new FakeShim(BUNDLE_ID, '/Users/yasin/Applications/../../Applications/Work.app'), validPlist(), dirs).ok).toBe(false)
    expect(validateShimConnection(new FakeShim(BUNDLE_ID, 'Work.app'), validPlist(), dirs).ok).toBe(false)
    expect(validateShimConnection(new FakeShim(BUNDLE_ID, '/Applications/Work'), validPlist(), dirs).ok).toBe(false)
  })

  it('rejects null plist, mismatched bundleId, or missing vault fields', () => {
    expect(validateShimConnection(new FakeShim(), null, dirs).ok).toBe(false)
    expect(validateShimConnection(new FakeShim(), validPlist({ bundleId: `${LAUNCHER_BUNDLE_ID_PREFIX}other-12345678` }), dirs).ok).toBe(false)
    expect(validateShimConnection(new FakeShim(), validPlist({ vaultPath: '' }), dirs).ok).toBe(false)
    expect(validateShimConnection(new FakeShim(), validPlist({ vaultUrl: null }), dirs).ok).toBe(false)
  })

  it('fails closed when satisfiesCodeRequirement returns false or throws', () => {
    const failed = new FakeShim()
    failed.requirementResult = false
    expect(validateShimConnection(failed, validPlist(), dirs).ok).toBe(false)

    const threw = new FakeShim()
    threw.requirementResult = new Error('OSStatus -67062')
    expect(validateShimConnection(threw, validPlist(), dirs).ok).toBe(false)
  })
})

describe('createAppShimController', () => {
  it('quits and warns on rejected shim connection without registering or opening windows', async () => {
    const h = makeHarness({ plists: {} })
    const bad = new FakeShim('com.evil.shim', '/tmp/Evil.app')
    expect(await h.controller.handleConnected(bad)).toBe(false)
    expect(bad.quitCount).toBe(1)
    expect(h.warn).toHaveBeenCalledOnce()
    expect(h.controller.connectedCount()).toBe(0)
    expect(h.windows.routeToFile).not.toHaveBeenCalled()
    h.controller.dispose()
  })

  it('connects a vault shim, applies its menu, honors ?open=today, and hides host Dock when no regular windows exist', async () => {
    const h = makeHarness({
      plists: { [BUNDLE_PATH]: validPlist({ vaultUrl: `${fileLink(VAULT)}?open=today` }) },
    })
    const shim = new FakeShim()
    expect(await h.controller.handleConnected(shim)).toBe(true)
    expect(h.controller.connectedCount()).toBe(1)
    expect(h.controller.getShim(VAULT)).toBe(shim)
    expect(h.controller.activeBundlePaths()).toEqual([BUNDLE_PATH])
    expect(shim.menus.at(-1)).toBe(`menu:${VAULT}`)
    expect(h.windows.routeToFile).toHaveBeenCalledWith(VAULT, null, 'today', VAULT)
    expect(h.hideHostDock).toHaveBeenCalledOnce()
    expect(h.quitHost).not.toHaveBeenCalled()
    h.controller.dispose()
  })

  it('headless startup (--app-shim-host) waits during grace period, cancels grace on connect, and quits if no shim ever connects', async () => {
    vi.useFakeTimers()
    const h = makeHarness({ headlessStart: true, headlessGraceMs: 5000 })
    expect(h.controller.isWaitingForFirstShim()).toBe(true)
    h.controller.onWindowClosed('w0', undefined)
    expect(h.quitHost).not.toHaveBeenCalled()
    vi.advanceTimersByTime(5000)
    expect(h.controller.isWaitingForFirstShim()).toBe(false)
    expect(h.quitHost).toHaveBeenCalledOnce()

    const h2 = makeHarness({ headlessStart: true, headlessGraceMs: 5000 })
    const shim = new FakeShim()
    await h2.controller.handleConnected(shim)
    expect(h2.controller.isWaitingForFirstShim()).toBe(false)
    vi.advanceTimersByTime(10_000)
    expect(h2.quitHost).not.toHaveBeenCalled()
    h2.controller.dispose()
  })

  it('toggles host Dock visibility (D2): shows when regular window opens, hides when last regular window closes with shim active, quits when last shim disconnects', async () => {
    const h = makeHarness({ headlessStart: true })
    const shim = new FakeShim()
    await h.controller.handleConnected(shim)
    expect(h.showHostDock).not.toHaveBeenCalled()

    // Regular window (e.g., Files window) opens -> host Dock shows.
    h.setRegularCount(1)
    h.controller.onWindowOpened('files-1', undefined)
    expect(h.showHostDock).toHaveBeenCalledTimes(1)

    // Regular window closes while shim is still connected -> host Dock hides again, host stays alive.
    h.setRegularCount(0)
    h.controller.onWindowClosed('files-1', undefined)
    expect(h.hideHostDock).toHaveBeenCalledTimes(1)
    expect(h.quitHost).not.toHaveBeenCalled()

    // Shim disconnects -> 0 regular windows & 0 shims -> host quits cleanly.
    shim.quit()
    expect(h.controller.connectedCount()).toBe(0)
    expect(h.quitHost).toHaveBeenCalledTimes(1)
    h.controller.dispose()
  })

  it('quit-requested (D4) calls preventDefault synchronously, guards re-entrancy, flushes only that shim, then quits shim', async () => {
    const h = makeHarness()
    let finishFlush!: () => void
    h.windows.flushAndCloseWindows.mockImplementationOnce(
      () => new Promise<void>((resolve) => { finishFlush = resolve }),
    )
    const shim = new FakeShim()
    await h.controller.handleConnected(shim)
    h.shimWindows.set(VAULT, ['w1', 'w2'])

    const ev1 = shim.emitEvent('quit-requested')
    expect(ev1.preventDefault).toHaveBeenCalledOnce()
    expect(h.windows.flushAndCloseWindows).toHaveBeenCalledExactlyOnceWith(['w1', 'w2'])
    expect(shim.quitCount).toBe(0)

    // Second quit-requested while flush is in flight is ignored (but still prevented synchronously).
    const ev2 = shim.emitEvent('quit-requested')
    expect(ev2.preventDefault).toHaveBeenCalledOnce()
    expect(h.windows.flushAndCloseWindows).toHaveBeenCalledTimes(1)

    finishFlush()
    await new Promise((r) => setTimeout(r, 0))
    expect(shim.quitCount).toBe(1)
    h.controller.dispose()
  })

  it('closing the last window of a shim quits the shim (#2), while closing one of two keeps it alive', async () => {
    const h = makeHarness()
    const shim = new FakeShim()
    await h.controller.handleConnected(shim)
    h.shimWindows.set(VAULT, ['w1', 'w2'])

    // Close w2, w1 remains -> shim stays alive.
    h.shimWindows.set(VAULT, ['w1'])
    h.controller.onWindowClosed('w2', VAULT)
    expect(shim.quitCount).toBe(0)

    // Close w1, 0 remain -> shim quits cleanly.
    h.shimWindows.set(VAULT, [])
    h.controller.onWindowClosed('w1', VAULT)
    expect(shim.quitCount).toBe(1)
    h.controller.dispose()
  })

  it('activate focuses most recently focused window of shim, or reopens vault when 0 windows remain', async () => {
    const h = makeHarness()
    const shim = new FakeShim()
    await h.controller.handleConnected(shim)
    h.windows.routeToFile.mockClear()

    h.shimWindows.set(VAULT, ['w-top', 'w-back'])
    shim.emitEvent('activate', true)
    expect(h.windows.focusWindowById).toHaveBeenCalledExactlyOnceWith('w-top')
    expect(h.windows.routeToFile).not.toHaveBeenCalled()

    h.shimWindows.set(VAULT, [])
    shim.emitEvent('activate', false)
    expect(h.windows.routeToFile).toHaveBeenCalledExactlyOnceWith(VAULT, null, undefined, VAULT)
    h.controller.dispose()
  })

  it('hands off an existing regular host window to the connecting shim (D3) and hides host Dock', async () => {
    const h = makeHarness()
    h.setRegularCount(1)
    h.hostVaultWins.set(VAULT, 'host-w1')

    const shim = new FakeShim()
    await h.controller.handleConnected(shim)
    expect(h.windows.handoffWindowToShim).toHaveBeenCalledExactlyOnceWith('host-w1', VAULT)
    expect(h.windows.routeToFile).not.toHaveBeenCalled()
    expect(h.hideHostDock).toHaveBeenCalledOnce()
    h.controller.dispose()
  })

  it('shim-first routing (D3) resolves connected, launch, and host, and consumes queued deep links before TTL', async () => {
    let clock = 1000
    const state = defaultAppState()
    state.folders[VAULT] = {
      ...defaultFolderState(),
      launcher: { name: 'Work', appPath: BUNDLE_PATH, iconPath: '/profile/vault-icons/work.png' },
    }
    state.vaultSets = [
      {
        id: 'ws-1',
        name: 'Suite',
        roots: ['/v/a', '/v/b'],
        lastUsed: 1,
        launcher: { name: 'Suite', appPath: '/Applications/Suite.app', iconPath: '/profile/vault-icons/ws.png' },
      },
    ]

    const existing = new Set([BUNDLE_PATH, '/Applications/Suite.app'])
    const h = makeHarness({ state, exists: (p) => existing.has(p), pendingOpenTtlMs: 5000, now: () => clock })

    expect(h.controller.resolveShimForVault(VAULT)).toEqual({ mode: 'launch', appPath: BUNDLE_PATH, shimKey: VAULT })
    expect(h.controller.resolveShimForWorkspace('ws-1')).toEqual({ mode: 'launch', appPath: '/Applications/Suite.app', shimKey: workspaceShimKey('ws-1') })
    expect(h.controller.resolveShimForVault('/other/vault')).toEqual({ mode: 'host' })

    // Path routing respects segment boundaries.
    expect(h.controller.resolveShimForPath(`${VAULT}/notes/todo.md`)).toEqual({ mode: 'launch', appPath: BUNDLE_PATH, shimKey: vaultShimKey(VAULT) })
    expect(h.controller.resolveShimForPath(`${VAULT}-extra/notes/todo.md`)).toEqual({ mode: 'host' })

    // Missing launcher on disk falls back to host.
    existing.delete('/Applications/Suite.app')
    expect(h.controller.resolveShimForWorkspace('ws-1')).toEqual({ mode: 'host' })

    // Queue pending deep link, connect within TTL -> opens queued file in shim.
    h.controller.queuePendingOpen(VAULT, { filePath: `${VAULT}/notes/todo.md`, rootOverride: null })
    clock = 4000
    const shim = new FakeShim()
    await h.controller.handleConnected(shim)
    expect(h.windows.routeToFile).toHaveBeenCalledExactlyOnceWith(`${VAULT}/notes/todo.md`, null, undefined, VAULT)
    expect(h.controller.resolveShimForVault(VAULT)).toEqual({ mode: 'connected', shimKey: VAULT })

    // Expired pending deep link falls back to default vault open on reconnect.
    shim.quit()
    h.windows.routeToFile.mockClear()
    h.controller.queuePendingOpen(VAULT, { filePath: `${VAULT}/notes/stale.md` })
    clock = 20_000
    const shim2 = new FakeShim()
    await h.controller.handleConnected(shim2)
    expect(h.windows.routeToFile).toHaveBeenCalledExactlyOnceWith(VAULT, null, undefined, VAULT)
    h.controller.dispose()
  })

  it('forwards open-file (targeting shim only for in-vault files) and open-url (#8)', async () => {
    const h = makeHarness()
    const shim = new FakeShim()
    await h.controller.handleConnected(shim)
    h.windows.routeToFile.mockClear()

    const evIn = shim.emitEvent('open-file', `${VAULT}/doc.md`)
    expect(evIn.preventDefault).toHaveBeenCalledOnce()
    expect(h.windows.routeToFile).toHaveBeenLastCalledWith(`${VAULT}/doc.md`, undefined, undefined, VAULT)

    const evOut = shim.emitEvent('open-file', '/somewhere/else/doc.md')
    expect(evOut.preventDefault).toHaveBeenCalledOnce()
    expect(h.handleLink).toHaveBeenCalledWith(fileLink('/somewhere/else/doc.md'))

    const evUrl = shim.emitEvent('open-url', fileLink(`${VAULT}/doc.md`))
    expect(evUrl.preventDefault).toHaveBeenCalledOnce()
    expect(h.handleLink).toHaveBeenCalledWith(fileLink(`${VAULT}/doc.md`))
    h.controller.dispose()
  })

  it('quitAll quits all connected shims cleanly and clears activeBundlePaths', async () => {
    const otherBundle = '/Applications/Personal.app'
    const otherId = `${LAUNCHER_BUNDLE_ID_PREFIX}personal-5678efab`
    const otherVault = '/Users/yasin/vaults/personal'
    const h = makeHarness({
      plists: {
        [BUNDLE_PATH]: validPlist(),
        [otherBundle]: validPlist({ bundleId: otherId, vaultPath: otherVault, vaultUrl: fileLink(otherVault) }),
      },
    })
    const s1 = new FakeShim()
    const s2 = new FakeShim(otherId, otherBundle, 4243)
    await h.controller.handleConnected(s1)
    await h.controller.handleConnected(s2)
    expect(h.controller.activeBundlePaths()).toEqual([BUNDLE_PATH, otherBundle])

    h.controller.quitAll()
    expect(s1.quitCount).toBe(1)
    expect(s2.quitCount).toBe(1)
    expect(h.controller.connectedCount()).toBe(0)
    expect(h.controller.activeBundlePaths()).toEqual([])
    expect(h.quitHost).not.toHaveBeenCalled()
    h.controller.dispose()
  })

  it('handleVersionMismatch shows a clear restart notice via linkNotice (D5)', () => {
    const h = makeHarness()
    h.controller.handleVersionMismatch('/Applications/Work.app')
    expect(h.windows.linkNotice).toHaveBeenCalledExactlyOnceWith('Work needs to restart to match the updated Yaseen Docs app')
    expect(h.warn).toHaveBeenCalledOnce()
    h.controller.dispose()
  })

  it('evicts prior connected shim cleanly when a duplicate connection arrives for the same shimKey (YAZ-6626)', async () => {
    const h = makeHarness()
    const s1 = new FakeShim()
    const s2 = new FakeShim(BUNDLE_ID, BUNDLE_PATH, 9002)
    await h.controller.handleConnected(s1)
    await h.controller.handleConnected(s2)
    expect(s1.quitCount).toBe(1)
    expect(h.controller.connectedCount()).toBe(1)
    expect(h.controller.getShim(VAULT)).toBe(s2)
    h.controller.dispose()
  })

  it('accepts macOS APFS case differences in allowedDirs (YAZ-6626)', () => {
    const shim = new FakeShim(BUNDLE_ID, '/applications/Work.app')
    const res = validateShimConnection(shim, validPlist(), ['/Applications'], 'darwin')
    expect(res.ok).toBe(true)
  })
})
