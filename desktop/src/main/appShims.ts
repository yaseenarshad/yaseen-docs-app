/**
 * macOS App Shim host controller (YAZ-6625).
 *
 * Pure TypeScript, zero Electron runtime imports: `main/index.ts` injects the Electron `AppShimHost`
 * events, menu builder, `shell.openPath`, and Dock show/hide callbacks so every security check,
 * lifecycle transition, handoff, and shim-first routing rule unit-tests cleanly under vitest.
 */
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { parseFileLink, type LinkOpenTarget } from '@shared/links'
import { stripSlash } from '@shared/types'
import { LAUNCHER_BUNDLE_ID_PREFIX, type LauncherPlistInfo } from './vaultLauncher'
import type { Store } from './store'
import type { WindowManager } from './windows'

/** Default grace window (ms) before a `--app-shim-host` launch exits if no shim connects. */
export const HEADLESS_GRACE_MS = 15_000

/** Default TTL (ms) for a queued file/target open waiting on a launching shim `.app`. */
export const PENDING_OPEN_TTL_MS = 15_000

const WORKSPACE_KEY_PREFIX = 'workspace:'
const VALID_BUNDLE_ID_RE = /^[a-zA-Z0-9._-]+$/

export interface AppShimEvent {
  preventDefault(): void
}

/** Structural subset of Electron's `AppShimHost` so `appShims.ts` stays Electron-free. */
export interface AppShimLike<MenuT = unknown> {
  readonly bundleId: string
  readonly bundlePath: string
  readonly pid: number
  isConnected(): boolean
  quit(): void
  satisfiesCodeRequirement(requirement: string): boolean
  setApplicationMenu(menu: MenuT | null): void
  bounce?(type?: 'critical' | 'informational'): void
  cancelBounce?(): void
  setBadge?(text: string): void
  on(event: 'activate', listener: (event: AppShimEvent, hasVisibleWindows: boolean) => void): unknown
  on(event: 'disconnected', listener: (event: AppShimEvent) => void): unknown
  on(event: 'open-file', listener: (event: AppShimEvent, path: string) => void): unknown
  on(event: 'open-url', listener: (event: AppShimEvent, url: string) => void): unknown
  on(event: 'quit-requested', listener: (event: AppShimEvent) => void): unknown
}

export type ShimValidationResult =
  | { ok: true; shimKey: string; vaultPath: string; vaultUrl: string; workspaceId: string | null }
  | { ok: false; reason: string }

export type ShimRouteDecision =
  | { mode: 'connected'; shimKey: string }
  | { mode: 'launch'; appPath: string; shimKey: string }
  | { mode: 'host' }

export interface PendingShimOpen {
  filePath?: string
  rootOverride?: string | null
  openTarget?: LinkOpenTarget
}

/** True when the host process was launched headlessly by an App Shim (`--app-shim-host`). */
export function isAppShimHostLaunch(argv: readonly string[] = process.argv): boolean {
  return argv.includes('--app-shim-host')
}

/** Allowed parent directories for installed App Shim `.app` bundles (D5). */
export function allowedShimDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  const override = env.YASEEN_DOCS_APP_SHIM_DIRS
  if (typeof override === 'string' && override.trim().length > 0) {
    const dirs = override
      .split(':')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .map((entry) => resolve(entry))
    if (dirs.length > 0) return dirs
  }
  return ['/Applications', join(homedir(), 'Applications')]
}

/** Canonical shim key for a single vault root path. */
export function vaultShimKey(root: string): string {
  return stripSlash(root)
}

/** Canonical shim key for a saved workspace (`VaultSet`) id. */
export function workspaceShimKey(workspaceId: string): string {
  return `${WORKSPACE_KEY_PREFIX}${workspaceId}`
}

/** Extracts the workspace id if `shimKey` represents a workspace shim, else `null`. */
export function parseWorkspaceShimKey(shimKey: string): string | null {
  if (!shimKey.startsWith(WORKSPACE_KEY_PREFIX)) return null
  const id = shimKey.slice(WORKSPACE_KEY_PREFIX.length)
  return id.length > 0 ? id : null
}

/**
 * Validate an incoming App Shim connection (YAZ-6625 D5, fail-closed):
 * - `bundleId` starts with `LAUNCHER_BUNDLE_ID_PREFIX` and contains only `[a-zA-Z0-9._-]`.
 * - `bundlePath` is an `.app` directly inside one of `allowedDirs` (normalized; no `..` traversal).
 * - `plist` is present, matches `shim.bundleId`, and carries non-empty `vaultPath` + `vaultUrl`.
 * - `shim.satisfiesCodeRequirement('identifier "<bundleId>"') === true` (throws fail closed).
 */
export function validateShimConnection(
  shim: Pick<AppShimLike, 'bundleId' | 'bundlePath' | 'satisfiesCodeRequirement'>,
  plist: LauncherPlistInfo | null,
  allowedDirs: readonly string[],
): ShimValidationResult {
  const { bundleId, bundlePath } = shim
  if (
    typeof bundleId !== 'string' ||
    !bundleId.startsWith(LAUNCHER_BUNDLE_ID_PREFIX) ||
    bundleId.length <= LAUNCHER_BUNDLE_ID_PREFIX.length ||
    !VALID_BUNDLE_ID_RE.test(bundleId)
  ) {
    return { ok: false, reason: `invalid bundleId: ${String(bundleId)}` }
  }

  if (typeof bundlePath !== 'string' || bundlePath.length === 0 || !isAbsolute(bundlePath) || bundlePath.includes('\0')) {
    return { ok: false, reason: `invalid bundlePath: ${String(bundlePath)}` }
  }

  if (bundlePath.split('/').includes('..')) {
    return { ok: false, reason: `bundlePath contains parent traversal: ${bundlePath}` }
  }

  const normalizedBundlePath = resolve(bundlePath)
  const bundleBase = basename(normalizedBundlePath)
  if (!bundleBase.toLowerCase().endsWith('.app') || bundleBase.length <= 4) {
    return { ok: false, reason: `bundlePath is not a .app bundle: ${bundlePath}` }
  }

  const parentDir = dirname(normalizedBundlePath)
  const inAllowedDir = allowedDirs.some((dir) => resolve(dir) === parentDir)
  if (!inAllowedDir) {
    return { ok: false, reason: `bundlePath not directly inside allowed dirs: ${normalizedBundlePath}` }
  }

  if (plist === null) {
    return { ok: false, reason: `missing or unreadable Info.plist for ${normalizedBundlePath}` }
  }

  if (plist.bundleId !== bundleId) {
    return { ok: false, reason: `plist bundleId mismatch: expected ${bundleId}, got ${String(plist.bundleId)}` }
  }

  const rawVaultPath = plist.vaultPath?.trim() ?? ''
  const rawVaultUrl = plist.vaultUrl?.trim() ?? ''
  if (rawVaultPath.length === 0 || rawVaultUrl.length === 0) {
    return { ok: false, reason: `missing YaseenDocsVaultPath or YaseenDocsVaultURL in ${normalizedBundlePath}` }
  }

  let codeValid = false
  try {
    codeValid = shim.satisfiesCodeRequirement(`identifier "${bundleId}"`) === true
  } catch (err) {
    return { ok: false, reason: `satisfiesCodeRequirement threw: ${String(err)}` }
  }
  if (!codeValid) {
    return { ok: false, reason: `code signature did not satisfy identifier "${bundleId}"` }
  }

  const workspaceId = parseWorkspaceShimKey(rawVaultPath)
  const shimKey = workspaceId !== null ? workspaceShimKey(workspaceId) : vaultShimKey(rawVaultPath)
  const vaultPath = workspaceId !== null ? rawVaultPath : stripSlash(rawVaultPath)
  return { ok: true, shimKey, vaultPath, vaultUrl: rawVaultUrl, workspaceId }
}

const pathInRoot = (root: string, target: string): boolean => {
  const r = stripSlash(root)
  const t = stripSlash(target)
  if (t === r) return true
  return t.startsWith(r === '/' ? '/' : `${r}/`)
}

export interface AppShimControllerDeps<MenuT = unknown> {
  store: Pick<Store, 'get'>
  windows: Pick<
    WindowManager,
    | 'openWindow'
    | 'openVaultSet'
    | 'openAlone'
    | 'routeToFile'
    | 'windowsForShim'
    | 'regularWindowCount'
    | 'focusWindowById'
    | 'findHostWindowForVault'
    | 'findHostWindowForWorkspace'
    | 'handoffWindowToShim'
    | 'flushAndCloseWindows'
    | 'appNotice'
  >
  readPlist: (bundlePath: string) => Promise<LauncherPlistInfo | null>
  allowedDirs?: () => readonly string[]
  buildMenuForShim: (shimKey: string, shim: AppShimLike<MenuT>) => MenuT
  handleLink: (url: string) => void
  exists: (path: string) => boolean
  launchApp: (appPath: string) => Promise<void> | void
  showHostDock: () => void
  hideHostDock: () => void
  quitHost: () => void
  headlessStart?: boolean
  headlessGraceMs?: number
  pendingOpenTtlMs?: number
  now?: () => number
  warn?: (message: string) => void
  onShimsChanged?: () => void
}

export interface AppShimController<MenuT = unknown> {
  /** Validate and attach a newly connected App Shim. Returns true when accepted. */
  handleConnected(shim: AppShimLike<MenuT>): Promise<boolean>
  /** Handle `app-shim-version-mismatch` with a clear restart notice (D5). */
  handleVersionMismatch(bundlePath: string): void
  /** Notify controller that a window was opened (syncs host Dock visibility). */
  onWindowOpened(windowId: string, shimKey: string | undefined): void
  /** Notify controller that a window closed (quits shim if its last window closed; syncs host Dock / headless exit). */
  onWindowClosed(windowId: string, shimKey: string | undefined): void
  /** Decide whether a vault should route to a connected shim, launch a stopped shim, or stay in host (D3). */
  resolveShimForVault(root: string): ShimRouteDecision
  /** Decide whether a workspace should route to a connected shim, launch a stopped shim, or stay in host (D3). */
  resolveShimForWorkspace(workspaceId: string): ShimRouteDecision
  /** Find the most specific vault shim owning `path` (file or vault folder), honoring `rootOverride` when present. */
  resolveShimForPath(path: string, rootOverride?: string | null): ShimRouteDecision
  /** Queue a file/target open for a stopped shim that is launching; consumed on connect within TTL. */
  queuePendingOpen(shimKey: string, req: PendingShimOpen): void
  /** Launch a stopped shim `.app` via the injected `launchApp` callback. */
  launchApp(appPath: string): Promise<void> | void
  /** Rebuild and push application menus to all currently connected shims. */
  refreshMenus(): void
  /** Look up a connected shim instance by `shimKey` (used by `WindowHost.create`). */
  getShim(shimKey: string): AppShimLike<MenuT> | undefined
  /** Number of currently connected shims. */
  connectedCount(): number
  /** True while `--app-shim-host` is still waiting for its initial shim to connect. */
  isWaitingForFirstShim(): boolean
  /** Bundle paths of all currently connected shims (for updater restart #5). */
  activeBundlePaths(): string[]
  /** Quit all connected shims cleanly during host `before-quit`. */
  quitAll(): void
  /** Cancel any background timers (for clean teardown in tests). */
  dispose(): void
}

interface ConnectedShimEntry<MenuT> {
  shimKey: string
  shim: AppShimLike<MenuT>
  bundleId: string
  bundlePath: string
  vaultPath: string
  vaultUrl: string
  workspaceId: string | null
  quitting: boolean
  opening: boolean
}

export function createAppShimController<MenuT = unknown>(deps: AppShimControllerDeps<MenuT>): AppShimController<MenuT> {
  const connected = new Map<string, ConnectedShimEntry<MenuT>>()
  const pendingOpens = new Map<string, PendingShimOpen & { expiresAt: number }>()
  const now = deps.now ?? Date.now
  const warn = deps.warn ?? ((msg: string) => console.warn(msg))
  const getAllowedDirs = deps.allowedDirs ?? (() => allowedShimDirs())
  const pendingTtlMs = deps.pendingOpenTtlMs ?? PENDING_OPEN_TTL_MS

  let quittingAll = false
  let waitingForFirstShim = Boolean(deps.headlessStart)
  let dockVisible: boolean | null = deps.headlessStart ? false : null
  let graceTimer: ReturnType<typeof setTimeout> | null = null

  const clearGraceTimer = (): void => {
    if (graceTimer !== null) {
      clearTimeout(graceTimer)
      graceTimer = null
    }
  }

  const syncHostDock = (): void => {
    if (quittingAll) return
    const regularCount = deps.windows.regularWindowCount()
    const shimCount = connected.size
    if (regularCount >= 1) {
      if (dockVisible !== true) {
        dockVisible = true
        deps.showHostDock()
      }
      return
    }
    if (shimCount >= 1) {
      if (dockVisible !== false) {
        dockVisible = false
        deps.hideHostDock()
      }
      return
    }
    if (!waitingForFirstShim) {
      deps.quitHost()
    }
  }

  if (waitingForFirstShim) {
    graceTimer = setTimeout(() => {
      graceTimer = null
      waitingForFirstShim = false
      syncHostDock()
    }, deps.headlessGraceMs ?? HEADLESS_GRACE_MS)
    graceTimer.unref?.()
  }

  const takePendingOpen = (shimKey: string): PendingShimOpen | undefined => {
    const item = pendingOpens.get(shimKey)
    if (item === undefined) return undefined
    pendingOpens.delete(shimKey)
    if (item.expiresAt < now()) return undefined
    return {
      ...(item.filePath !== undefined ? { filePath: item.filePath } : {}),
      ...(item.rootOverride !== undefined ? { rootOverride: item.rootOverride } : {}),
      ...(item.openTarget !== undefined ? { openTarget: item.openTarget } : {}),
    }
  }

  const isPathInShim = (entry: ConnectedShimEntry<MenuT>, filePath: string): boolean => {
    if (entry.workspaceId !== null) {
      const set = (deps.store.get().vaultSets ?? []).find((s) => s.id === entry.workspaceId)
      return set?.roots.some((root) => pathInRoot(root, filePath)) ?? false
    }
    return pathInRoot(entry.vaultPath, filePath)
  }

  const openDefaultForShim = (entry: ConnectedShimEntry<MenuT>, openTarget?: LinkOpenTarget): void => {
    if (entry.workspaceId !== null) {
      deps.windows.openVaultSet(entry.workspaceId, undefined, entry.shimKey)
      return
    }
    const target = openTarget ?? parseFileLink(entry.vaultUrl)?.open
    deps.windows.routeToFile(entry.vaultPath, null, target, entry.shimKey)
  }

  const resolveShimForVault = (root: string): ShimRouteDecision => {
    const key = vaultShimKey(root)
    const liveEntry = connected.get(key)
    if (liveEntry !== undefined && liveEntry.shim.isConnected() && !liveEntry.quitting) {
      return { mode: 'connected', shimKey: key }
    }
    const folders = deps.store.get().folders ?? {}
    const appPath = folders[key]?.launcher?.appPath ?? folders[root]?.launcher?.appPath
    if (appPath !== undefined && deps.exists(appPath)) {
      return { mode: 'launch', appPath, shimKey: key }
    }
    return { mode: 'host' }
  }

  const resolveShimForWorkspace = (workspaceId: string): ShimRouteDecision => {
    const key = workspaceShimKey(workspaceId)
    const liveEntry = connected.get(key)
    if (liveEntry !== undefined && liveEntry.shim.isConnected() && !liveEntry.quitting) {
      return { mode: 'connected', shimKey: key }
    }
    const set = (deps.store.get().vaultSets ?? []).find((s) => s.id === workspaceId)
    const appPath = set?.launcher?.appPath
    if (appPath !== undefined && deps.exists(appPath)) {
      return { mode: 'launch', appPath, shimKey: key }
    }
    return { mode: 'host' }
  }

  const resolveShimForPath = (path: string, rootOverride?: string | null): ShimRouteDecision => {
    if (rootOverride != null && pathInRoot(rootOverride, path)) {
      const overrideDecision = resolveShimForVault(rootOverride)
      if (overrideDecision.mode !== 'host') return overrideDecision
    }
    // Check all connected vault shims and installed vault launchers, preferring the most specific root.
    const candidates = new Set<string>()
    for (const entry of connected.values()) {
      if (entry.workspaceId === null && entry.shim.isConnected() && !entry.quitting) candidates.add(entry.vaultPath)
    }
    for (const [root, folder] of Object.entries(deps.store.get().folders ?? {})) {
      if (folder.launcher !== undefined) candidates.add(stripSlash(root))
    }
    let bestRoot: string | null = null
    for (const root of candidates) {
      if (!pathInRoot(root, path)) continue
      if (bestRoot === null || root.length > bestRoot.length) bestRoot = root
    }
    return bestRoot === null ? { mode: 'host' } : resolveShimForVault(bestRoot)
  }

  return {
    async handleConnected(shim) {
      const plist = await deps.readPlist(shim.bundlePath)
      const check = validateShimConnection(shim, plist, getAllowedDirs())
      if (!check.ok) {
        warn(`[appShims] rejected shim connection (${check.reason})`)
        if (shim.isConnected()) shim.quit()
        return false
      }
      if (!shim.isConnected() || quittingAll) return false

      waitingForFirstShim = false
      clearGraceTimer()

      const entry: ConnectedShimEntry<MenuT> = {
        shimKey: check.shimKey,
        shim,
        bundleId: shim.bundleId,
        bundlePath: shim.bundlePath,
        vaultPath: check.vaultPath,
        vaultUrl: check.vaultUrl,
        workspaceId: check.workspaceId,
        quitting: false,
        opening: true,
      }
      connected.set(entry.shimKey, entry)
      shim.setApplicationMenu(deps.buildMenuForShim(entry.shimKey, shim))

      shim.on('activate', () => {
        if (entry.quitting || quittingAll || !shim.isConnected()) return
        const liveIds = deps.windows.windowsForShim(entry.shimKey)
        if (liveIds.length > 0) {
          deps.windows.focusWindowById(liveIds[0])
          return
        }
        openDefaultForShim(entry)
      })

      shim.on('quit-requested', (event) => {
        // Must be called synchronously so Electron does not skip window `close` / flush events (YAZ-6625 D4).
        event.preventDefault()
        if (entry.quitting) return
        entry.quitting = true
        const ids = deps.windows.windowsForShim(entry.shimKey)
        void deps.windows
          .flushAndCloseWindows(ids)
          .catch(() => undefined)
          .finally(() => {
            if (shim.isConnected()) shim.quit()
          })
      })

      shim.on('open-file', (event, filePath) => {
        event.preventDefault()
        if (entry.quitting || quittingAll) return
        deps.windows.routeToFile(filePath, undefined, undefined, isPathInShim(entry, filePath) ? entry.shimKey : undefined)
      })

      shim.on('open-url', (event, url) => {
        event.preventDefault()
        if (entry.quitting || quittingAll) return
        deps.handleLink(url)
      })

      shim.on('disconnected', () => {
        if (connected.get(entry.shimKey) !== entry) return
        connected.delete(entry.shimKey)
        deps.onShimsChanged?.()
        syncHostDock()
      })

      // Handoff & initial window (D3): if a regular host window owns this exact vault/workspace,
      // flush & close it and reopen its state inside the shim; otherwise open fresh (honoring pending deep links).
      const pending = takePendingOpen(entry.shimKey)
      const openTarget = pending?.openTarget ?? parseFileLink(entry.vaultUrl)?.open
      try {
        let hostWinId: string | undefined
        if (entry.workspaceId !== null) {
          const set = (deps.store.get().vaultSets ?? []).find((s) => s.id === entry.workspaceId)
          if (set !== undefined) hostWinId = deps.windows.findHostWindowForWorkspace(set.roots)
        } else {
          hostWinId = deps.windows.findHostWindowForVault(entry.vaultPath)
        }

        if (hostWinId !== undefined) {
          await deps.windows.handoffWindowToShim(hostWinId, entry.shimKey)
          if (pending?.filePath !== undefined) {
            deps.windows.routeToFile(pending.filePath, pending.rootOverride, pending.openTarget, entry.shimKey)
          } else if (openTarget !== undefined && entry.workspaceId === null) {
            deps.windows.routeToFile(entry.vaultPath, null, openTarget, entry.shimKey)
          }
        } else if (pending?.filePath !== undefined) {
          deps.windows.routeToFile(pending.filePath, pending.rootOverride, pending.openTarget, entry.shimKey)
        } else {
          openDefaultForShim(entry, openTarget)
        }
      } finally {
        entry.opening = false
      }

      if (!shim.isConnected() || connected.get(entry.shimKey) !== entry) return true
      shim.setApplicationMenu(deps.buildMenuForShim(entry.shimKey, shim))
      deps.onShimsChanged?.()
      syncHostDock()
      return true
    },

    handleVersionMismatch(bundlePath) {
      const name = basename(bundlePath, '.app') || 'Vault App'
      warn(`[appShims] version mismatch for ${bundlePath}`)
      deps.windows.appNotice(`${name} needs to restart to match the updated Yaseen Docs app`)
    },

    onWindowOpened(_windowId, _shimKey) {
      syncHostDock()
    },

    onWindowClosed(_windowId, shimKey) {
      if (quittingAll) return
      if (shimKey !== undefined) {
        const entry = connected.get(shimKey)
        if (entry !== undefined && !entry.quitting && !entry.opening && entry.shim.isConnected()) {
          if (deps.windows.windowsForShim(shimKey).length === 0) {
            entry.quitting = true
            entry.shim.quit()
          }
        }
      }
      syncHostDock()
    },

    resolveShimForVault,
    resolveShimForWorkspace,
    resolveShimForPath,

    queuePendingOpen(shimKey, req) {
      pendingOpens.set(shimKey, { ...req, expiresAt: now() + pendingTtlMs })
    },

    launchApp: (appPath) => deps.launchApp(appPath),

    refreshMenus() {
      for (const entry of connected.values()) {
        if (!entry.quitting && entry.shim.isConnected()) {
          entry.shim.setApplicationMenu(deps.buildMenuForShim(entry.shimKey, entry.shim))
        }
      }
    },

    getShim: (shimKey) => {
      const entry = connected.get(shimKey)
      return entry !== undefined && !entry.quitting && entry.shim.isConnected() ? entry.shim : undefined
    },

    connectedCount: () => connected.size,
    isWaitingForFirstShim: () => waitingForFirstShim,
    activeBundlePaths: () => [...connected.values()].filter((e) => e.shim.isConnected()).map((e) => e.bundlePath),

    quitAll() {
      quittingAll = true
      waitingForFirstShim = false
      clearGraceTimer()
      for (const entry of [...connected.values()]) {
        entry.quitting = true
        try {
          if (entry.shim.isConnected()) entry.shim.quit()
        } catch {
          // ignore disconnect errors during shutdown
        }
      }
      connected.clear()
      pendingOpens.clear()
    },

    dispose() {
      clearGraceTimer()
    },
  }
}
