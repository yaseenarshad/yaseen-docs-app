import { isAbsolute, resolve } from 'node:path'
import { AutomationFailure } from '@shared/automation'
import type {
  DisplaySelector,
  TabSummary,
  TilePreset,
  WindowInspectResult,
} from '@shared/automationNavigation'
import { basename, rootOfPath, type WindowBounds } from '@shared/types'
import type { NavigationHost, NavigationWindow } from './navigation'
import { clampCustomBounds, displayIdForBounds, resolveDisplay, tileBounds } from './windowLayout'

/** Per-window renderer inspect timeout for `window.list` (YAZ-6539 Decision 3). */
export const INSPECT_TIMEOUT_MS = 2_000

const DEFAULT_NEW_WINDOW_BOUNDS: WindowBounds = { x: 100, y: 100, width: 1200, height: 800 }

function normalizeAbsolutePath(input: string): string {
  if (!isAbsolute(input)) throw new AutomationFailure('INVALID_INPUT', 'Use an absolute path.')
  return resolve(input).replace(/\\/g, '/')
}

function requireLiveWindow(host: NavigationHost, id: string): NavigationWindow {
  const win = host.windows().find((w) => w.id === id)
  if (!win) throw new AutomationFailure('WINDOW_NOT_FOUND', 'The target window is not live.')
  return win
}

function storeFallbackTabs(entry: NavigationWindow): { activeTab: string | null; tabs: TabSummary[] } {
  let matchedActive = false
  let activeTab: string | null = null
  const tabs: TabSummary[] = entry.tabs.map((path, idx) => {
    const id = `stored-${idx + 1}`
    const isActive = !matchedActive && entry.file !== null && path === entry.file
    if (isActive) {
      matchedActive = true
      activeTab = id
    }
    const stripEntry = entry.tabStrip?.[idx]
    const title = stripEntry?.path === path && stripEntry.name ? stripEntry.name : basename(path)
    return {
      tab: id,
      path,
      title,
      active: isActive,
      dirty: false,
    }
  })
  return { activeTab, tabs }
}

/** `window.list` (YAZ-6539 Decision 3): merges Electron displays/OS window state with parallel renderer `inspect`. */
export async function listWindows(host: NavigationHost) {
  const displays = host.displays?.() ?? []
  const liveEntries = host.windows()

  const windows = await Promise.all(
    liveEntries.map(async (entry) => {
      const info = host.windowInfo?.(entry.id)
      const bounds = info?.bounds ?? entry.bounds
      const displayId = info?.displayId ?? displayIdForBounds(displays, bounds)
      const focused = info?.focused ?? false
      const minimized = info?.minimized ?? false
      const fullscreen = info?.fullscreen ?? false
      let ready = info?.ready ?? false
      let activeTab: string | null = null
      let tabs: TabSummary[] = []

      if (ready && host.command) {
        try {
          const inspected = (await host.command(entry.id, { action: 'inspect' }, INSPECT_TIMEOUT_MS)) as WindowInspectResult
          activeTab = inspected.activeTab ?? null
          tabs = Array.isArray(inspected.tabs) ? inspected.tabs : []
        } catch {
          ready = false
          const fallback = storeFallbackTabs(entry)
          activeTab = fallback.activeTab
          tabs = fallback.tabs
        }
      } else {
        ready = false
        const fallback = storeFallbackTabs(entry)
        activeTab = fallback.activeTab
        tabs = fallback.tabs
      }

      return {
        window: entry.id,
        roots: entry.roots,
        readOnly: entry.readOnly === true,
        ready,
        focused,
        minimized,
        fullscreen,
        displayId,
        bounds,
        activeTab,
        tabs,
      }
    }),
  )

  return { displays, windows }
}

export interface MoveWindowArgs {
  window: string
  tile?: TilePreset
  display?: DisplaySelector
  x?: number
  y?: number
  width?: number
  height?: number
  focus?: boolean
}

/** `window.move` (YAZ-6539 Decision 6): tiles or positions a live window on the resolved display. */
export async function moveWindow(host: NavigationHost, args: MoveWindowArgs) {
  const hasCustom = args.x !== undefined || args.y !== undefined || args.width !== undefined || args.height !== undefined
  if (args.tile === undefined && !hasCustom) {
    throw new AutomationFailure('INVALID_INPUT', 'Specify a tile preset or at least one of x, y, width, height.')
  }
  if (args.tile !== undefined && hasCustom) {
    throw new AutomationFailure('INVALID_INPUT', 'Cannot combine tile with explicit x, y, width, or height.')
  }

  const entry = requireLiveWindow(host, args.window)
  const info = host.windowInfo?.(args.window)
  const currentBounds = info?.bounds ?? entry.bounds
  const displays = host.displays?.() ?? []
  const targetDisplay = resolveDisplay(displays, args.display, currentBounds, host.cursorPoint?.())

  const targetBounds =
    args.tile !== undefined
      ? tileBounds(args.tile, targetDisplay.workArea)
      : clampCustomBounds(
          {
            ...(args.x !== undefined ? { x: args.x } : {}),
            ...(args.y !== undefined ? { y: args.y } : {}),
            ...(args.width !== undefined ? { width: args.width } : {}),
            ...(args.height !== undefined ? { height: args.height } : {}),
          },
          currentBounds,
          targetDisplay.workArea,
        )

  if (!host.moveWindow) {
    throw new AutomationFailure('UNAVAILABLE', 'Window movement is unavailable in this host.')
  }
  const moved = await host.moveWindow(args.window, targetBounds, args.focus === true)
  return {
    window: args.window,
    displayId: moved.displayId,
    bounds: moved.bounds,
    focused: moved.focused,
    exitedFullScreen: moved.exitedFullScreen,
  }
}

/** `window.focus` (YAZ-6539): unminimizes and brings a live window to OS front. */
export function focusWindow(host: NavigationHost, args: { window: string }) {
  requireLiveWindow(host, args.window)
  if (!host.focusWindow) {
    throw new AutomationFailure('UNAVAILABLE', 'Window focusing is unavailable in this host.')
  }
  const result = host.focusWindow(args.window)
  return {
    window: args.window,
    focused: result.focused,
    restored: result.restored,
  }
}

/** `window.minimize` (YAZ-6539): minimizes a live window. */
export function minimizeWindow(host: NavigationHost, args: { window: string }) {
  requireLiveWindow(host, args.window)
  if (!host.minimizeWindow) {
    throw new AutomationFailure('UNAVAILABLE', 'Window minimizing is unavailable in this host.')
  }
  const minimized = host.minimizeWindow(args.window)
  return {
    window: args.window,
    minimized,
  }
}

/** `window.close` (YAZ-6539 Decision 4): flush-first close refusing dirty/timeout unless `force: true`. */
export async function closeWindow(host: NavigationHost, args: { window: string; force?: boolean }) {
  requireLiveWindow(host, args.window)
  if (!host.closeWindow) {
    throw new AutomationFailure('UNAVAILABLE', 'Window closing is unavailable in this host.')
  }
  const status = await host.closeWindow(args.window, args.force === true)
  if (status === 'missing') {
    throw new AutomationFailure('WINDOW_NOT_FOUND', 'The target window is not live.')
  }
  if (status === 'dirty') {
    throw new AutomationFailure('DIRTY_TAB', 'Unsaved edits could not be flushed. Pass force: true to close anyway.', {
      window: args.window,
      reason: 'dirty',
    })
  }
  if (status === 'timeout') {
    throw new AutomationFailure('DIRTY_TAB', 'Timed out waiting for pending saves to flush. Pass force: true to close anyway.', {
      window: args.window,
      reason: 'timeout',
    })
  }
  return {
    window: args.window,
    closed: true,
  }
}

export interface ActivateTabArgs {
  window: string
  tab?: string
  path?: string
  focus?: boolean
}

/** `tab.activate` (YAZ-6539): activates an open tab by ID or path, optionally focusing the window. */
export async function activateTab(host: NavigationHost, args: ActivateTabArgs) {
  if (args.tab === undefined && args.path === undefined) {
    throw new AutomationFailure('INVALID_INPUT', 'Specify tab or path.')
  }
  requireLiveWindow(host, args.window)
  if (!host.command) {
    throw new AutomationFailure('UNAVAILABLE', 'Renderer commands are unavailable in this host.')
  }
  const normalizedPath = args.path === undefined ? undefined : normalizeAbsolutePath(args.path)
  const result = (await host.command(args.window, {
    action: 'tab.activate',
    ...(args.tab !== undefined ? { tab: args.tab } : {}),
    ...(normalizedPath !== undefined ? { path: normalizedPath } : {}),
  })) as { tab: string; path: string | null }

  let focused = host.windowInfo?.(args.window)?.focused ?? false
  if (args.focus === true && host.focusWindow) {
    focused = host.focusWindow(args.window).focused
  }

  return {
    window: args.window,
    tab: result.tab,
    path: result.path ?? null,
    focused,
  }
}

export interface CloseTabArgs {
  window: string
  tab?: string
  path?: string
  tabs?: string[]
  others?: boolean
  force?: boolean
}

/** `tab.close` (YAZ-6539 Decisions 4 & 5): flushes and closes one or more tabs; keeps window open on Start page on last tab. */
export async function closeTab(host: NavigationHost, args: CloseTabArgs) {
  const hasTabsList = Array.isArray(args.tabs) && args.tabs.length > 0
  if (args.tab === undefined && args.path === undefined && !hasTabsList && args.others !== true) {
    throw new AutomationFailure('INVALID_INPUT', 'Specify tab, path, tabs, or others: true.')
  }
  requireLiveWindow(host, args.window)
  if (!host.command) {
    throw new AutomationFailure('UNAVAILABLE', 'Renderer commands are unavailable in this host.')
  }
  const normalizedPath = args.path === undefined ? undefined : normalizeAbsolutePath(args.path)
  const result = (await host.command(args.window, {
    action: 'tab.close',
    ...(args.tab !== undefined ? { tab: args.tab } : {}),
    ...(normalizedPath !== undefined ? { path: normalizedPath } : {}),
    ...(args.tabs !== undefined ? { tabs: args.tabs } : {}),
    ...(args.others !== undefined ? { others: args.others } : {}),
    ...(args.force !== undefined ? { force: args.force } : {}),
  })) as { closed: string[]; activeTab: string | null; closedWindow: boolean }

  return {
    window: args.window,
    closed: result.closed,
    activeTab: result.activeTab ?? null,
    closedWindow: result.closedWindow === true,
  }
}

export interface MoveTabArgs {
  from: string
  tab?: string
  path?: string
  to?: string
  newWindow?: boolean
  tile?: TilePreset
  display?: DisplaySelector
  focus?: boolean
}

/**
 * `tab.move` (YAZ-6539): validates target window/roots or new-window display bounds BEFORE mutating `from`,
 * flushes & removes the tab from `from` via acknowledged `tab.move`, then opens it in `to` or a new window.
 */
export async function moveTab(host: NavigationHost, args: MoveTabArgs) {
  if (args.tab === undefined && args.path === undefined) {
    throw new AutomationFailure('INVALID_INPUT', 'Specify tab or path.')
  }
  const wantsTo = args.to !== undefined
  const wantsNew = args.newWindow === true
  if (wantsTo === wantsNew) {
    throw new AutomationFailure('INVALID_INPUT', 'Specify exactly one of to or newWindow: true.')
  }
  if (wantsTo && args.to === args.from) {
    throw new AutomationFailure('INVALID_INPUT', 'Source and destination windows must be different.')
  }
  if (wantsTo && (args.tile !== undefined || args.display !== undefined)) {
    throw new AutomationFailure('INVALID_INPUT', 'tile and display are only valid with newWindow: true.')
  }

  const fromWin = requireLiveWindow(host, args.from)
  const toWin = wantsTo ? requireLiveWindow(host, args.to!) : undefined
  if (!host.command) {
    throw new AutomationFailure('UNAVAILABLE', 'Renderer commands are unavailable in this host.')
  }

  const normalizedPath = args.path === undefined ? undefined : normalizeAbsolutePath(args.path)

  // Validate display / compute bounds before mutating source tab so invalid display fails cleanly.
  let targetBounds: WindowBounds | undefined
  if (wantsNew && (args.tile !== undefined || args.display !== undefined)) {
    const displays = host.displays?.() ?? []
    const fromBounds = host.windowInfo?.(args.from)?.bounds ?? fromWin.bounds
    const targetDisplay = resolveDisplay(displays, args.display, fromBounds, host.cursorPoint?.())
    if (args.tile !== undefined) {
      targetBounds = tileBounds(args.tile, targetDisplay.workArea)
    } else {
      const base = fromBounds ?? DEFAULT_NEW_WINDOW_BOUNDS
      targetBounds = clampCustomBounds(
        {
          x: targetDisplay.workArea.x + Math.max(0, Math.floor((targetDisplay.workArea.width - base.width) / 2)),
          y: targetDisplay.workArea.y + Math.max(0, Math.floor((targetDisplay.workArea.height - base.height) / 2)),
        },
        base,
        targetDisplay.workArea,
      )
    }
  }

  // Inspect source window first to resolve the exact tab & path before mutating anything.
  const inspected = (await host.command(args.from, { action: 'inspect' }, INSPECT_TIMEOUT_MS)) as WindowInspectResult
  const tabs = Array.isArray(inspected.tabs) ? inspected.tabs : []
  const matched = tabs.find((t) => {
    if (args.tab !== undefined && normalizedPath !== undefined) return t.tab === args.tab && t.path === normalizedPath
    if (args.tab !== undefined) return t.tab === args.tab
    return t.path === normalizedPath
  })
  if (!matched) {
    throw new AutomationFailure('TAB_NOT_FOUND', 'The requested tab was not found in the source window.')
  }
  if (matched.path === null) {
    throw new AutomationFailure('INVALID_INPUT', 'Cannot move a tab that has no file path.')
  }

  // Validate destination window vaults BEFORE flushing/closing source tab.
  if (toWin) {
    const inside = toWin.roots.includes(matched.path) || rootOfPath(toWin.roots, matched.path) !== null
    if (!inside) {
      throw new AutomationFailure('OUTSIDE_WINDOW_ROOTS', 'The tab path is outside the destination window vaults.', {
        path: matched.path,
        targetRoots: toWin.roots,
      })
    }
  }

  // Flush and remove tab from source window (throws DIRTY_TAB if save fails/conflicts).
  const moved = (await host.command(args.from, {
    action: 'tab.move',
    tab: matched.tab,
    path: matched.path,
    ...(wantsTo ? { to: args.to } : {}),
    ...(wantsNew ? { newWindow: true } : {}),
    ...(args.focus !== undefined ? { focus: args.focus } : {}),
  })) as { tab: string; path: string; name?: string; zoom?: string }

  const movedPath = moved.path ?? matched.path

  if (wantsTo) {
    const applied = (await host.apply(args.to!, { path: movedPath, tabMode: 'new' })) as { tab?: string | null } | undefined
    if (args.focus === true) {
      if (host.focusWindow) host.focusWindow(args.to!)
      else host.raise(args.to!)
    }
    return {
      from: args.from,
      to: args.to!,
      tab: applied?.tab ?? moved.tab ?? matched.tab,
      path: movedPath,
      createdWindow: false,
    }
  }

  const newId = host.open({
    root: fromWin.roots[0] ?? null,
    roots: [...fromWin.roots],
    file: null,
    ...(fromWin.readOnly ? { readOnly: true } : {}),
    ...(targetBounds !== undefined ? { bounds: targetBounds } : {}),
    ...(args.focus !== true ? { inactive: true } : {}),
  })
  if (args.focus === true) {
    if (host.focusWindow) host.focusWindow(newId)
    else host.raise(newId)
  }
  const applied = (await host.apply(newId, { path: movedPath })) as { tab?: string | null } | undefined
  const finalBounds = host.windowInfo?.(newId)?.bounds ?? targetBounds

  return {
    from: args.from,
    to: newId,
    tab: applied?.tab ?? moved.tab ?? matched.tab,
    path: movedPath,
    createdWindow: true,
    ...(finalBounds !== undefined ? { bounds: finalBounds } : {}),
  }
}
