import { describe, expect, it, vi } from 'vitest'
import { AutomationFailure } from '@shared/automation'
import { validateOutput } from '@shared/automationCommands'
import type { DisplayInfo, TabSummary, WindowInspectResult } from '@shared/automationNavigation'
import { defaultAppState, defaultRightPanelIdentity, type WindowBounds } from '@shared/types'
import type { LiveWindowInfo, NavigationHost, NavigationWindow } from './navigation'
import {
  activateTab,
  closeTab,
  closeWindow,
  focusWindow,
  INSPECT_TIMEOUT_MS,
  listWindows,
  minimizeWindow,
  moveTab,
  moveWindow,
} from './windowControl'

const DISPLAY_1: DisplayInfo = {
  id: 1,
  label: 'Primary',
  primary: true,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 25, width: 1920, height: 1055 },
}

const DISPLAY_2: DisplayInfo = {
  id: 2,
  label: 'Left',
  primary: false,
  bounds: { x: -1920, y: 0, width: 1920, height: 1080 },
  workArea: { x: -1920, y: 25, width: 1920, height: 1055 },
}

const winEntry = (
  id: string,
  roots: string[],
  extra: Partial<NavigationWindow> = {},
): NavigationWindow => ({
  id,
  root: roots[0] ?? null,
  roots,
  tabs: [],
  file: null,
  rightPanel: defaultRightPanelIdentity(),
  sidebarCollapsed: false,
  sidebarLens: 'files',
  bounds: { x: 100, y: 100, width: 1000, height: 700 },
  ...extra,
})

function makeHost(
  windows: NavigationWindow[],
  infos: Record<string, LiveWindowInfo> = {},
): NavigationHost {
  const defaultInfo = (w: NavigationWindow): LiveWindowInfo => ({
    ready: true,
    focused: false,
    minimized: false,
    fullscreen: false,
    displayId: 1,
    bounds: w.bounds,
  })
  return {
    state: () => defaultAppState(),
    windows: () => windows,
    open: vi.fn(() => 'w-new'),
    raise: vi.fn(),
    apply: vi.fn(async () => ({ path: null, tab: 'tab-new', sidebar: 'files', sidebarCollapsed: false, acknowledged: true })),
    usedWorkspace: vi.fn(async () => {}),
    displays: vi.fn(() => [DISPLAY_1, DISPLAY_2]),
    cursorPoint: vi.fn(() => ({ x: 500, y: 500 })),
    windowInfo: vi.fn((id: string) => {
      if (infos[id]) return infos[id]
      const w = windows.find((item) => item.id === id)
      return w ? defaultInfo(w) : undefined
    }),
    moveWindow: vi.fn(async (_id: string, bounds: WindowBounds, focus: boolean) => ({
      displayId: bounds.x < 0 ? 2 : 1,
      bounds,
      focused: focus,
      exitedFullScreen: false,
    })),
    focusWindow: vi.fn(() => ({ focused: true, restored: false })),
    minimizeWindow: vi.fn(() => true),
    closeWindow: vi.fn(async () => 'closed' as const),
    command: vi.fn(async () => ({})),
  }
}

describe('window.list', () => {
  it('merges displays and live OS state with parallel renderer inspect and falls back to store when booting or timed out', async () => {
    const w1 = winEntry('w1', ['/v'], { tabs: ['/v/a.md'], file: '/v/a.md' })
    const w2 = winEntry('w2', ['/v2'], { tabs: ['/v2/b.md', '/v2/c.md'], file: '/v2/b.md', readOnly: true })
    const w3 = winEntry('w3', ['/v3'], { tabs: ['/v3/d.md'], file: '/v3/d.md', tabStrip: [{ path: '/v3/d.md', name: 'Custom D' }] })

    const host = makeHost([w1, w2, w3], {
      w1: { ready: true, focused: true, minimized: false, fullscreen: false, displayId: 1, bounds: { x: 0, y: 25, width: 960, height: 1055 } },
      w2: { ready: false, focused: false, minimized: true, fullscreen: false, displayId: 2, bounds: { x: -1920, y: 25, width: 960, height: 1055 } },
      w3: { ready: true, focused: false, minimized: false, fullscreen: true, displayId: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
    })

    const w1Tabs: TabSummary[] = [{ tab: 'tab-1', path: '/v/a.md', title: 'Alpha', active: true, dirty: false }]
    host.command = vi.fn(async (id) => {
      if (id === 'w1') {
        return { path: '/v/a.md', tab: 'tab-1', sidebar: 'files', sidebarCollapsed: false, activeTab: 'tab-1', tabs: w1Tabs } satisfies WindowInspectResult
      }
      throw new AutomationFailure('RENDERER_TIMEOUT', 'timed out')
    })

    const res = await listWindows(host)
    validateOutput('window.list', res)

    expect(host.command).toHaveBeenCalledTimes(2) // w1 and w3 (w2 was not ready)
    expect(host.command).toHaveBeenCalledWith('w1', { action: 'inspect' }, INSPECT_TIMEOUT_MS)
    expect(res.displays).toEqual([DISPLAY_1, DISPLAY_2])
    expect(res.windows[0]).toMatchObject({
      window: 'w1',
      ready: true,
      focused: true,
      readOnly: false,
      activeTab: 'tab-1',
      tabs: w1Tabs,
    })
    expect(res.windows[1]).toMatchObject({
      window: 'w2',
      ready: false,
      minimized: true,
      readOnly: true,
      displayId: 2,
      activeTab: 'stored-1',
      tabs: [
        { tab: 'stored-1', path: '/v2/b.md', title: 'b.md', active: true, dirty: false },
        { tab: 'stored-2', path: '/v2/c.md', title: 'c.md', active: false, dirty: false },
      ],
    })
    // w3 inspect failed -> falls back to store snapshot with ready: false and tabStrip name.
    expect(res.windows[2]).toMatchObject({
      window: 'w3',
      ready: false,
      fullscreen: true,
      activeTab: 'stored-1',
      tabs: [{ tab: 'stored-1', path: '/v3/d.md', title: 'Custom D', active: true, dirty: false }],
    })
  })
})

describe('window.move / focus / minimize / close', () => {
  it('tiles a window on primary or negative-coord display and validates inputs', async () => {
    const host = makeHost([winEntry('w1', ['/v'])])
    const tiled = await moveWindow(host, { window: 'w1', tile: 'right', display: 2, focus: true })
    validateOutput('window.move', tiled)
    expect(host.moveWindow).toHaveBeenCalledWith('w1', { x: -960, y: 25, width: 960, height: 1055 }, true)
    expect(tiled).toEqual({
      window: 'w1',
      displayId: 2,
      bounds: { x: -960, y: 25, width: 960, height: 1055 },
      focused: true,
      exitedFullScreen: false,
    })

    // Custom partial bounds clamped to target display.
    const custom = await moveWindow(host, { window: 'w1', x: 50, width: 200 })
    validateOutput('window.move', custom)
    expect(host.moveWindow).toHaveBeenLastCalledWith('w1', { x: 50, y: 100, width: 480, height: 700 }, false)

    // Validation errors
    await expect(moveWindow(host, { window: 'w1' })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(moveWindow(host, { window: 'w1', tile: 'left', x: 0 })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(moveWindow(host, { window: 'w1', tile: 'left', display: 999 })).rejects.toMatchObject({ code: 'DISPLAY_NOT_FOUND' })
    await expect(moveWindow(host, { window: 'gone', tile: 'left' })).rejects.toMatchObject({ code: 'WINDOW_NOT_FOUND' })
  })

  it('focuses and minimizes live windows, rejecting unknown window IDs', () => {
    const host = makeHost([winEntry('w1', ['/v'])])
    host.focusWindow = vi.fn(() => ({ focused: true, restored: true }))
    const focused = focusWindow(host, { window: 'w1' })
    validateOutput('window.focus', focused)
    expect(focused).toEqual({ window: 'w1', focused: true, restored: true })

    const minimized = minimizeWindow(host, { window: 'w1' })
    validateOutput('window.minimize', minimized)
    expect(minimized).toEqual({ window: 'w1', minimized: true })

    expect(() => focusWindow(host, { window: 'gone' })).toThrow(expect.objectContaining({ code: 'WINDOW_NOT_FOUND' }))
    expect(() => minimizeWindow(host, { window: 'gone' })).toThrow(expect.objectContaining({ code: 'WINDOW_NOT_FOUND' }))
  })

  it('enforces flush-first close guard with DIRTY_TAB unless force is true', async () => {
    const host = makeHost([winEntry('w1', ['/v'])])
    host.closeWindow = vi.fn(async () => 'dirty' as const)
    await expect(closeWindow(host, { window: 'w1' })).rejects.toMatchObject({ code: 'DIRTY_TAB', details: { reason: 'dirty' } })

    host.closeWindow = vi.fn(async () => 'timeout' as const)
    await expect(closeWindow(host, { window: 'w1' })).rejects.toMatchObject({ code: 'DIRTY_TAB', details: { reason: 'timeout' } })

    host.closeWindow = vi.fn(async () => 'missing' as const)
    await expect(closeWindow(host, { window: 'w1' })).rejects.toMatchObject({ code: 'WINDOW_NOT_FOUND' })

    host.closeWindow = vi.fn(async (_id, force) => (force ? 'closed' : 'dirty'))
    const forced = await closeWindow(host, { window: 'w1', force: true })
    validateOutput('window.close', forced)
    expect(forced).toEqual({ window: 'w1', closed: true })
    expect(host.closeWindow).toHaveBeenCalledWith('w1', true)
  })
})

describe('tab.activate and tab.close', () => {
  it('activates a tab by ID or path and optionally focuses the window', async () => {
    const host = makeHost([winEntry('w1', ['/v'])])
    host.command = vi.fn(async () => ({ tab: 'tab-2', path: '/v/b.md' }))

    const quiet = await activateTab(host, { window: 'w1', tab: 'tab-2' })
    validateOutput('tab.activate', quiet)
    expect(quiet).toEqual({ window: 'w1', tab: 'tab-2', path: '/v/b.md', focused: false })
    expect(host.focusWindow).not.toHaveBeenCalled()

    const loud = await activateTab(host, { window: 'w1', path: '/v/b.md', focus: true })
    validateOutput('tab.activate', loud)
    expect(loud).toEqual({ window: 'w1', tab: 'tab-2', path: '/v/b.md', focused: true })
    expect(host.focusWindow).toHaveBeenCalledWith('w1')

    await expect(activateTab(host, { window: 'w1' })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(activateTab(host, { window: 'w1', path: 'relative.md' })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(activateTab(host, { window: 'gone', tab: 'tab-1' })).rejects.toMatchObject({ code: 'WINDOW_NOT_FOUND' })
  })

  it('closes single, batch, or other tabs and validates selectors', async () => {
    const host = makeHost([winEntry('w1', ['/v'])])
    host.command = vi.fn(async () => ({ closed: ['tab-2', 'tab-3'], activeTab: 'tab-1', closedWindow: false }))

    const res = await closeTab(host, { window: 'w1', tab: 'tab-1', others: true, force: true })
    validateOutput('tab.close', res)
    expect(res).toEqual({ window: 'w1', closed: ['tab-2', 'tab-3'], activeTab: 'tab-1', closedWindow: false })
    expect(host.command).toHaveBeenCalledWith('w1', { action: 'tab.close', tab: 'tab-1', others: true, force: true })

    await expect(closeTab(host, { window: 'w1' })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(closeTab(host, { window: 'w1', tabs: [] })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(closeTab(host, { window: 'gone', others: true })).rejects.toMatchObject({ code: 'WINDOW_NOT_FOUND' })
  })
})

describe('tab.move', () => {
  it('validates target roots BEFORE mutating source, then transfers cleanly into destination window', async () => {
    const host = makeHost([winEntry('w1', ['/v']), winEntry('w2', ['/v']), winEntry('w3', ['/other'])])
    const inspectW1: WindowInspectResult = {
      path: '/v/a.md',
      tab: 'tab-1',
      sidebar: 'files',
      sidebarCollapsed: false,
      activeTab: 'tab-1',
      tabs: [{ tab: 'tab-1', path: '/v/a.md', title: 'a.md', active: true, dirty: false }],
    }
    host.command = vi.fn(async (_id, body) => {
      if (body.action === 'inspect') return inspectW1
      if (body.action === 'tab.move') return { tab: 'tab-1', path: '/v/a.md' }
      return {}
    })

    // Destination with unrelated vaults fails BEFORE calling tab.move on source!
    await expect(moveTab(host, { from: 'w1', tab: 'tab-1', to: 'w3' })).rejects.toMatchObject({ code: 'OUTSIDE_WINDOW_ROOTS' })
    expect(vi.mocked(host.command).mock.calls.some(([, body]) => body.action === 'tab.move')).toBe(false)

    // Valid cross-window move
    const res = await moveTab(host, { from: 'w1', tab: 'tab-1', to: 'w2', focus: true })
    validateOutput('tab.move', res)
    expect(res).toEqual({ from: 'w1', to: 'w2', tab: 'tab-new', path: '/v/a.md', createdWindow: false })
    expect(host.command).toHaveBeenCalledWith('w1', { action: 'tab.move', tab: 'tab-1', path: '/v/a.md', to: 'w2', focus: true })
    expect(host.apply).toHaveBeenCalledWith('w2', { path: '/v/a.md', tabMode: 'new' })
    expect(host.focusWindow).toHaveBeenCalledWith('w2')
  })

  it('pops a tab out into a new tiled window without stealing focus unless focus: true', async () => {
    const host = makeHost([winEntry('w1', ['/v'], { readOnly: true })])
    const inspectW1: WindowInspectResult = {
      path: '/v/note.md',
      tab: 'tab-2',
      sidebar: 'files',
      sidebarCollapsed: false,
      activeTab: 'tab-2',
      tabs: [{ tab: 'tab-2', path: '/v/note.md', title: 'note.md', active: true, dirty: false }],
    }
    host.command = vi.fn(async (_id, body) => {
      if (body.action === 'inspect') return inspectW1
      return { tab: 'tab-2', path: '/v/note.md' }
    })

    const res = await moveTab(host, { from: 'w1', path: '/v/note.md', newWindow: true, tile: 'right', display: 2 })
    validateOutput('tab.move', res)
    expect(host.open).toHaveBeenCalledWith({
      root: '/v',
      roots: ['/v'],
      file: null,
      readOnly: true,
      bounds: { x: -960, y: 25, width: 960, height: 1055 },
      inactive: true,
    })
    expect(host.focusWindow).not.toHaveBeenCalled()
    expect(host.apply).toHaveBeenCalledWith('w-new', { path: '/v/note.md' })
    expect(res).toEqual({
      from: 'w1',
      to: 'w-new',
      tab: 'tab-new',
      path: '/v/note.md',
      createdWindow: true,
      bounds: { x: -960, y: 25, width: 960, height: 1055 },
    })
  })

  it('refuses invalid combinations, missing tabs, dirty flush failures, and unknown displays before mutating', async () => {
    const host = makeHost([winEntry('w1', ['/v']), winEntry('w2', ['/v'])])
    await expect(moveTab(host, { from: 'w1', to: 'w2' })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(moveTab(host, { from: 'w1', tab: 'tab-1' })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(moveTab(host, { from: 'w1', tab: 'tab-1', to: 'w2', newWindow: true })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(moveTab(host, { from: 'w1', tab: 'tab-1', to: 'w1' })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(moveTab(host, { from: 'w1', tab: 'tab-1', to: 'w2', tile: 'left' })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(moveTab(host, { from: 'w1', tab: 'tab-1', newWindow: true, tile: 'left', display: 999 })).rejects.toMatchObject({ code: 'DISPLAY_NOT_FOUND' })
    expect(host.command).not.toHaveBeenCalled()

    // TAB_NOT_FOUND
    host.command = vi.fn(async () => ({ path: null, tab: null, sidebar: 'files', sidebarCollapsed: false, activeTab: null, tabs: [] }))
    await expect(moveTab(host, { from: 'w1', tab: 'tab-99', to: 'w2' })).rejects.toMatchObject({ code: 'TAB_NOT_FOUND' })

    // DIRTY_TAB prevents opening new window
    host.command = vi.fn(async (_id, body) => {
      if (body.action === 'inspect') {
        return { path: '/v/a.md', tab: 'tab-1', sidebar: 'files', sidebarCollapsed: false, activeTab: 'tab-1', tabs: [{ tab: 'tab-1', path: '/v/a.md', title: 'a.md', active: true, dirty: true }] }
      }
      throw new AutomationFailure('DIRTY_TAB', 'Unsaved edits could not be flushed.')
    })
    await expect(moveTab(host, { from: 'w1', tab: 'tab-1', newWindow: true })).rejects.toMatchObject({ code: 'DIRTY_TAB' })
    expect(host.open).not.toHaveBeenCalled()
  })
})
