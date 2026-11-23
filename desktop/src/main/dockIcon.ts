import { join } from 'node:path'
import { rootOfPath, stripSlash, type AppState } from '@shared/types'
import type { Store } from './store'

/**
 * Resolves the default Yaseen Docs PNG icon path for `app.dock.setIcon()` (YAZ-6386).
 * Electron's `nativeImage.createFromPath()` decodes PNG/JPEG, not `.icns`, so packaged builds
 * ship `build/icon.png` in `Contents/Resources/icon.png` via `extraResources`.
 */
export function defaultDockIconPath(opts: { isPackaged: boolean; resourcesPath: string; mainDir: string }): string {
  return opts.isPackaged ? join(opts.resourcesPath, 'icon.png') : join(opts.mainDir, '../../build/icon.png')
}

/**
 * Resolves the PNG icon path to show in the macOS Dock for the currently focused window (YAZ-5967, YAZ-6374).
 *
 * - Finds `focusedWinId` in `state.windows`.
 * - Determines the active vault: the root in `entry.roots` that owns `entry.file`, else `entry.root`.
 * - Checks `state.folders[activeVault]?.launcher` and returns `launcher.iconPath` only when both
 *   `launcher.appPath` and `launcher.iconPath` exist on disk.
 * - Returns `null` when the default Yaseen Docs icon should be shown (Welcome screen, empty window,
 *   no focused window, no launcher, or a launcher removed in Finder).
 */
function resolveLauncherCandidate(
  state: Pick<AppState, 'windows' | 'folders'>,
  focusedWinId: string | null | undefined,
): { appPath: string; iconPath: string } | null {
  if (focusedWinId == null) return null
  const entry = state.windows.find((w) => w.id === focusedWinId)
  if (entry === undefined) return null
  const activeVault = (entry.file !== null ? rootOfPath(entry.roots, entry.file) : null) ?? entry.root
  if (activeVault === null) return null
  const launcher = state.folders[activeVault]?.launcher ?? state.folders[stripSlash(activeVault)]?.launcher
  if (launcher === undefined) return null
  return { appPath: launcher.appPath, iconPath: launcher.iconPath }
}

export function resolveDockIconPath(
  state: Pick<AppState, 'windows' | 'folders'>,
  focusedWinId: string | null | undefined,
  exists: (path: string) => boolean,
): string | null {
  const candidate = resolveLauncherCandidate(state, focusedWinId)
  if (candidate === null) return null
  if (!exists(candidate.appPath) || !exists(candidate.iconPath)) return null
  return candidate.iconPath
}

export interface DockIconControllerDeps<TImage> {
  store: Pick<Store, 'get' | 'onChange'>
  getFocusedWindowId: () => string | null | undefined
  defaultIconPath: string | null
  setDockIcon: (image: TImage) => void
  loadImage: (path: string) => TImage | null
  exists: (path: string) => boolean
}

export interface DockIconController {
  /** Recomputes the focused vault's Dock icon and calls `setDockIcon` only if the resolved key changed. */
  sync(): void
  /** Evicts `iconPath` (or all cached images if omitted) and resets the applied key if it matched. */
  invalidate(iconPath?: string): void
  /** Unsubscribes from `store.onChange` and clears the image cache. */
  dispose(): void
}

/**
 * Live macOS Dock icon controller (YAZ-5967, YAZ-6374).
 *
 * - Caches loaded images by `iconPath` in memory so focus/tab switches do not hit disk repeatedly.
 * - Tracks `lastAppliedKey` so repeated focus/store events for the same vault make 0 `setDockIcon` calls.
 * - Subscribes to `store.onChange` (catches tab switches in multi-vault windows and launcher edits/deletes).
 */
export function createDockIconController<TImage>(deps: DockIconControllerDeps<TImage>): DockIconController {
  const cache = new Map<string, TImage>()
  // `undefined` = nothing applied yet; `null` = default icon applied; `string` = custom iconPath applied.
  let lastAppliedKey: string | null | undefined = undefined
  // Tracks the last checked `(appPath, iconPath)` candidate so unrelated `store.onChange` commits skip `existsSync`.
  let lastCandidateKey: string | null | undefined = undefined
  let disposed = false

  const getImage = (iconPath: string): TImage | null => {
    const cached = cache.get(iconPath)
    if (cached !== undefined) return cached
    const loaded = deps.loadImage(iconPath)
    if (loaded === null) return null
    cache.set(iconPath, loaded)
    return loaded
  }

  const syncInternal = (verifyDiskIfSame: boolean): void => {
    if (disposed) return
    const candidate = resolveLauncherCandidate(deps.store.get(), deps.getFocusedWindowId())
    const candidateKey = candidate === null ? null : `${candidate.appPath}\0${candidate.iconPath}`
    if (!verifyDiskIfSame && candidateKey === lastCandidateKey) return
    lastCandidateKey = candidateKey

    const resolved = candidate !== null && deps.exists(candidate.appPath) && deps.exists(candidate.iconPath) ? candidate.iconPath : null
    if (resolved === lastAppliedKey) return

    if (resolved !== null) {
      const img = getImage(resolved)
      if (img !== null) {
        deps.setDockIcon(img)
        lastAppliedKey = resolved
        return
      }
      // Failed to load the custom PNG — fall back to default icon.
      if (lastAppliedKey === null) return
    }

    if (deps.defaultIconPath !== null) {
      const def = getImage(deps.defaultIconPath)
      if (def !== null) {
        deps.setDockIcon(def)
      }
    }
    lastAppliedKey = null
  }

  const sync = (): void => syncInternal(true)

  const invalidate = (iconPath?: string): void => {
    if (disposed) return
    lastCandidateKey = undefined
    if (iconPath === undefined) {
      cache.clear()
      lastAppliedKey = undefined
    } else {
      cache.delete(iconPath)
      if (lastAppliedKey === iconPath) lastAppliedKey = undefined
    }
    sync()
  }

  const unsubscribe = deps.store.onChange(() => {
    syncInternal(false)
  })

  const dispose = (): void => {
    if (disposed) return
    disposed = true
    unsubscribe()
    cache.clear()
  }

  return { sync, invalidate, dispose }
}
