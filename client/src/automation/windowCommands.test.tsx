import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { AutomationFailure } from '@shared/automation'
import { validateOutput } from '@shared/automationCommands'
import type { RendererCommand, TabMode, WindowInspectResult } from '@shared/automationNavigation'
import type { SidebarTab } from '@shared/types'
import { _resetRenameContinuity, registerRenameContinuity } from '../lib/renameContinuity'
import { tabsReducer, NO_STEPS, type Tab, type TabsState } from '../workspace/useWorkspace'
import { api } from '../api'
import { useAutomationSurface } from './surfaces'
import { useAutomation } from './useAutomation'
import { runWindowCommand, type WindowCommandDeps } from './windowCommands'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null

afterEach(() => {
  act(() => root?.unmount())
  root = null
  _resetRenameContinuity()
})

interface HarnessOptions {
  initialTabs?: Tab[]
  initialActive?: string | null
  initialMounted?: string[]
  initialSidebar?: SidebarTab
  initialCollapsed?: boolean
  dirtyPaths?: Set<string>
  flushResult?: boolean
  flushPathThrows?: boolean
  useRealDirty?: boolean
}

function createHarness(opts: HarnessOptions = {}) {
  const initialTabs = opts.initialTabs ?? [
    { id: 't1', path: '/v/a.md' },
    { id: 't2', path: '/v/b.md', name: 'Custom B', zoom: 'z-1' },
    { id: 't3', path: '/v/c.md' },
  ]
  const initialActive = opts.initialActive !== undefined ? opts.initialActive : (initialTabs[0]?.id ?? null)
  const initialMounted = opts.initialMounted ?? (initialActive !== null ? [initialActive] : [])

  let tabsState: TabsState = {
    tabs: initialTabs,
    active: initialActive,
    mounted: initialMounted,
    history: NO_STEPS,
    preview: null,
    blank: false,
  }
  let sidebar: SidebarTab = opts.initialSidebar ?? 'files'
  let sidebarCollapsed = opts.initialCollapsed ?? false
  const dirtySet = opts.dirtyPaths ?? new Set<string>()
  let surfaceUpdate: (() => void) | null = null

  const closeCalls: Array<{ ids: readonly string[]; moved?: boolean }> = []
  const leaveChrome = vi.fn()
  const reveal = vi.fn()
  const flushWindow = vi.fn(async () => opts.flushResult ?? true)
  const flushPath = vi.fn(async () => {
    if (opts.flushPathThrows) throw new Error('disk full')
  })

  const notifyRender = () => {
    surfaceUpdate?.()
  }

  const getActivePath = (): string | null => {
    const active = tabsState.tabs.find((t) => t.id === tabsState.active)
    return active?.path ?? null
  }

  const deps: WindowCommandDeps = {
    getState: () => ({
      path: getActivePath(),
      activeTab: tabsState.active,
      tabs: tabsState.tabs,
      sidebar,
      sidebarCollapsed,
    }),
    toggleSidebar: () => {
      sidebarCollapsed = !sidebarCollapsed
      notifyRender()
    },
    changeLens: (lens) => {
      sidebar = lens
      notifyRender()
    },
    openPage: (path) => {
      tabsState = tabsReducer(tabsState, { type: 'open-current', path })
      notifyRender()
    },
    openBatch: (paths: readonly string[], activePath: string | null, tabMode: TabMode) => {
      tabsState = tabsReducer(tabsState, { type: 'open-batch', paths, activePath, tabMode })
      notifyRender()
      return tabsState.tabs
    },
    activateTab: (id) => {
      tabsState = tabsReducer(tabsState, { type: 'activate', id })
      notifyRender()
    },
    closeTabs: (ids, moved) => {
      closeCalls.push({ ids: [...ids], moved })
      tabsState = tabsReducer(tabsState, { type: 'close-many', ids })
      notifyRender()
    },
    titleOf: (path, name) => name ?? path.split('/').pop()!.replace(/\.md$/, ''),
    leaveChrome,
    ...(opts.useRealDirty ? {} : { isDirty: (path: string) => dirtySet.has(path) }),
    flushWindow,
    flushPath,
  }

  function AppSurfaceProbe({ tick }: { tick: number }) {
    void tick
    useAutomationSurface('app', {
      ready: true,
      inspect: () => ({
        path: getActivePath(),
        tab: tabsState.active,
        sidebar,
        sidebarCollapsed,
      }),
    })
    useAutomationSurface('sidebar', {
      ready: true,
      inspect: () => ({ sidebar }),
      reveal,
    })
    return null
  }

  const mountSurface = async () => {
    let tick = 0
    root = createRoot(document.createElement('div'))
    surfaceUpdate = () => {
      tick += 1
      root?.render(<AppSurfaceProbe tick={tick} />)
    }
    await act(async () => {
      root!.render(<AppSurfaceProbe tick={tick} />)
    })
  }

  return {
    deps,
    mountSurface,
    getTabsState: () => tabsState,
    closeCalls,
    leaveChrome,
    reveal,
    flushWindow,
    flushPath,
    dirtySet,
  }
}

describe('runWindowCommand (YAZ-6539)', () => {
  describe('inspect', () => {
    it('returns live in-memory tabs with title, active, and dirty without waking sleeping tabs', async () => {
      const h = createHarness({
        initialMounted: ['t1'], // t2 and t3 are sleeping (not mounted)
        dirtyPaths: new Set(['/v/a.md']),
      })

      const result = (await runWindowCommand({ id: 'c1', action: 'inspect' }, h.deps)) as WindowInspectResult

      expect(result).toEqual({
        path: '/v/a.md',
        tab: 't1',
        sidebar: 'files',
        sidebarCollapsed: false,
        activeTab: 't1',
        tabs: [
          { tab: 't1', path: '/v/a.md', title: 'a', active: true, dirty: true },
          { tab: 't2', path: '/v/b.md', title: 'Custom B', active: false, dirty: false },
          { tab: 't3', path: '/v/c.md', title: 'c', active: false, dirty: false },
        ],
      })
      // Sleeping tabs remain unmounted.
      expect(h.getTabsState().mounted).toEqual(['t1'])
    })

    it('reads dirty state from renameContinuity when isDirty is not overridden', async () => {
      registerRenameContinuity('/v/a.md', {
        flush: async () => undefined,
        capture: () => ({ frontmatter: '', body: 'unsaved' }),
        retire: () => undefined,
      })
      const h = createHarness({ useRealDirty: true, initialMounted: ['t1'] })

      const result = (await runWindowCommand({ id: 'c2', action: 'inspect' }, h.deps)) as WindowInspectResult
      expect(result.tabs.map((t) => [t.tab, t.dirty])).toEqual([
        ['t1', true],
        ['t2', false],
        ['t3', false],
      ])
    })
  })

  describe('navigate (multi-tab batch and tabMode)', () => {
    it('opens a batch of paths in order, lazy-mounts only activePath, and returns schema-valid applied.tabs', async () => {
      const h = createHarness({ initialTabs: [], initialActive: null, initialMounted: [] })
      await h.mountSurface()

      const applied = await runWindowCommand(
        {
          id: 'n1',
          action: 'navigate',
          target: {
            paths: ['/v/one.md', '/v/two.md', '/v/three.md'],
            activePath: '/v/two.md',
            tabMode: 'activate-or-new',
            sidebar: 'favorites',
          },
        },
        h.deps,
      )

      const state = h.getTabsState()
      expect(state.tabs.map((t) => t.path)).toEqual(['/v/one.md', '/v/two.md', '/v/three.md'])
      // Lazy-mount invariant: ONLY the active tab is mounted!
      expect(state.mounted).toEqual([state.tabs[1].id])
      expect(state.active).toBe(state.tabs[1].id)
      expect(h.leaveChrome).toHaveBeenCalledTimes(1)
      expect(h.reveal).toHaveBeenCalledWith(expect.objectContaining({ path: '/v/two.md', sidebar: 'favorites' }))

      expect(applied).toEqual({
        path: '/v/two.md',
        tab: state.tabs[1].id,
        tabs: state.tabs.map((t) => ({ tab: t.id, path: t.path })),
        sidebar: 'favorites',
        sidebarCollapsed: false,
        acknowledged: true,
      })

      // Output strictly conforms to shared navigation.open output schema.
      expect(() =>
        validateOutput('navigation.open', {
          window: 'w1',
          roots: ['/v'],
          missing: [],
          created: false,
          applied,
          closedStartWindows: [],
        }),
      ).not.toThrow()
    })

    it('supports single-path tabMode: new appends a copy while activate-or-new activates existing', async () => {
      const h = createHarness()
      await h.mountSurface()

      await runWindowCommand(
        { id: 'n2', action: 'navigate', target: { path: '/v/b.md', tabMode: 'activate-or-new' } },
        h.deps,
      )
      expect(h.getTabsState().tabs.map((t) => t.id)).toEqual(['t1', 't2', 't3'])
      expect(h.getTabsState().active).toBe('t2')

      await runWindowCommand(
        { id: 'n3', action: 'navigate', target: { path: '/v/b.md', tabMode: 'new' } },
        h.deps,
      )
      expect(h.getTabsState().tabs).toHaveLength(4)
      expect(h.getTabsState().tabs[3].path).toBe('/v/b.md')
      expect(h.getTabsState().active).toBe(h.getTabsState().tabs[3].id)
    })
  })

  describe('tab.activate', () => {
    it('activates by tab ID or path and throws TAB_NOT_FOUND for unknown targets', async () => {
      const h = createHarness({ initialMounted: ['t1'] })

      const byId = await runWindowCommand({ id: 'a1', action: 'tab.activate', tab: 't3' }, h.deps)
      expect(byId).toEqual({ tab: 't3', path: '/v/c.md' })
      expect(h.getTabsState().active).toBe('t3')
      expect(h.leaveChrome).toHaveBeenCalledTimes(1)

      const byPath = await runWindowCommand({ id: 'a2', action: 'tab.activate', path: '/v/b.md' }, h.deps)
      expect(byPath).toEqual({ tab: 't2', path: '/v/b.md' })
      expect(h.getTabsState().active).toBe('t2')

      await expect(runWindowCommand({ id: 'a3', action: 'tab.activate', tab: 'missing' }, h.deps)).rejects.toMatchObject({
        name: 'AutomationFailure',
        code: 'TAB_NOT_FOUND',
      })
      await expect(runWindowCommand({ id: 'a4', action: 'tab.activate' }, h.deps)).rejects.toMatchObject({
        name: 'AutomationFailure',
        code: 'INVALID_INPUT',
      })
    })
  })

  describe('tab.close', () => {
    it('closes by tab ID, by path, by tabs[], and with others: true', async () => {
      const h = createHarness()

      const r1 = await runWindowCommand({ id: 'cl1', action: 'tab.close', tab: 't2' }, h.deps)
      expect(r1).toEqual({ closed: ['t2'], activeTab: 't1', closedWindow: false })
      expect(h.getTabsState().tabs.map((t) => t.id)).toEqual(['t1', 't3'])
      expect(h.flushWindow).toHaveBeenCalledTimes(1)
      expect(h.closeCalls[0]).toEqual({ ids: ['t2'], moved: false })

      const h2 = createHarness()
      const r2 = await runWindowCommand({ id: 'cl2', action: 'tab.close', others: true, tab: 't2' }, h2.deps)
      expect(r2).toEqual({ closed: ['t1', 't3'], activeTab: 't2', closedWindow: false })
      expect(h2.getTabsState().tabs.map((t) => t.id)).toEqual(['t2'])

      const h3 = createHarness()
      const r3 = await runWindowCommand({ id: 'cl3', action: 'tab.close', others: true }, h3.deps)
      expect(r3).toEqual({ closed: ['t2', 't3'], activeTab: 't1', closedWindow: false })

      const h4 = createHarness()
      const r4 = await runWindowCommand({ id: 'cl4', action: 'tab.close', tabs: ['t1', 't3'] }, h4.deps)
      expect(r4).toEqual({ closed: ['t1', 't3'], activeTab: 't2', closedWindow: false })
    })

    it('guards dirty/unflushed tabs with DIRTY_TAB unless force: true', async () => {
      const hFail = createHarness({ flushResult: false })
      await expect(runWindowCommand({ id: 'cl5', action: 'tab.close', tab: 't1' }, hFail.deps)).rejects.toMatchObject({
        code: 'DIRTY_TAB',
        details: { tabs: ['t1'] },
      })
      expect(hFail.getTabsState().tabs.map((t) => t.id)).toEqual(['t1', 't2', 't3'])

      // force: true overrides failed flush and closes cleanly.
      const forced = await runWindowCommand({ id: 'cl6', action: 'tab.close', tab: 't1', force: true }, hFail.deps)
      expect(forced).toEqual({ closed: ['t1'], activeTab: 't2', closedWindow: false })

      // Still-dirty tab after flush also triggers DIRTY_TAB.
      const hDirty = createHarness({ dirtyPaths: new Set(['/v/b.md']) })
      await expect(runWindowCommand({ id: 'cl7', action: 'tab.close', path: '/v/b.md' }, hDirty.deps)).rejects.toMatchObject({
        code: 'DIRTY_TAB',
        details: { tabs: ['t2'] },
      })
      expect(hDirty.getTabsState().tabs).toHaveLength(3)

      // Hung flush times out with DIRTY_TAB instead of stalling, and force: true bypasses it cleanly.
      const hHung = createHarness()
      const hungDeps = {
        ...hHung.deps,
        flushTimeoutMs: 25,
        flushPath: vi.fn(() => new Promise<void>(() => undefined)),
        flushWindow: vi.fn(() => new Promise<boolean>(() => undefined)),
      }
      await expect(runWindowCommand({ id: 'cl7b', action: 'tab.close', tab: 't1' }, hungDeps)).rejects.toMatchObject({
        code: 'DIRTY_TAB',
        details: { tabs: ['t1'], timedOut: true },
      })
      expect(hHung.getTabsState().tabs.map((t) => t.id)).toEqual(['t1', 't2', 't3'])

      const forcedHung = await runWindowCommand({ id: 'cl7c', action: 'tab.close', tab: 't1', force: true }, hungDeps)
      expect(forcedHung).toEqual({ closed: ['t1'], activeTab: 't2', closedWindow: false })
      expect(hHung.getTabsState().tabs.map((t) => t.id)).toEqual(['t2', 't3'])

      // Combining others: true with tabs is rejected as INVALID_INPUT.
      await expect(runWindowCommand({ id: 'cl7d', action: 'tab.close', others: true, tabs: ['t2'] }, hHung.deps)).rejects.toMatchObject({
        code: 'INVALID_INPUT',
      })
    })

    it('keeps the window open on Start page (activeTab: null, closedWindow: false) when the last tab closes', async () => {
      const h = createHarness({ initialTabs: [{ id: 't1', path: '/v/only.md' }], initialActive: 't1' })
      const res = await runWindowCommand({ id: 'cl8', action: 'tab.close', tab: 't1' }, h.deps)
      expect(res).toEqual({ closed: ['t1'], activeTab: null, closedWindow: false })
      expect(h.getTabsState().tabs).toEqual([])
      expect(h.getTabsState().active).toBeNull()
    })

    it('throws TAB_NOT_FOUND when a named tab or path is missing', async () => {
      const h = createHarness()
      await expect(runWindowCommand({ id: 'cl9', action: 'tab.close', tab: 'nope' }, h.deps)).rejects.toBeInstanceOf(AutomationFailure)
      await expect(runWindowCommand({ id: 'cl10', action: 'tab.close', path: '/v/nope.md' }, h.deps)).rejects.toMatchObject({
        code: 'TAB_NOT_FOUND',
      })
      await expect(runWindowCommand({ id: 'cl11', action: 'tab.close', tabs: ['t1', 'nope'] }, h.deps)).rejects.toMatchObject({
        code: 'TAB_NOT_FOUND',
        details: { tabs: ['nope'] },
      })
    })
  })

  describe('tab.move', () => {
    it('flushes cleanly, removes source tab with moved=true, and returns metadata for cross-window transfer', async () => {
      const h = createHarness()
      const res = await runWindowCommand(
        { id: 'm1', action: 'tab.move', tab: 't2', to: 'w-other' } as RendererCommand,
        h.deps,
      )
      expect(res).toEqual({
        tab: 't2',
        path: '/v/b.md',
        closedSource: true,
        name: 'Custom B',
        zoom: 'z-1',
      })
      expect(h.flushPath).toHaveBeenCalledWith('/v/b.md')
      expect(h.flushWindow).toHaveBeenCalledTimes(1)
      expect(h.closeCalls).toEqual([{ ids: ['t2'], moved: true }])
      expect(h.getTabsState().tabs.map((t) => t.id)).toEqual(['t1', 't3'])
    })

    it('refuses with DIRTY_TAB and keeps the source tab when flush fails', async () => {
      const h = createHarness({ flushResult: false })
      await expect(runWindowCommand({ id: 'm2', action: 'tab.move', path: '/v/b.md', to: 'w-other' }, h.deps)).rejects.toMatchObject({
        code: 'DIRTY_TAB',
        details: { tabs: ['t2'] },
      })
      expect(h.closeCalls).toEqual([])
      expect(h.getTabsState().tabs.map((t) => t.id)).toEqual(['t1', 't2', 't3'])
    })

    it('throws TAB_NOT_FOUND when the tab to move does not exist', async () => {
      const h = createHarness()
      await expect(runWindowCommand({ id: 'm3', action: 'tab.move', tab: 'ghost', newWindow: true }, h.deps)).rejects.toMatchObject({
        code: 'TAB_NOT_FOUND',
      })
    })
  })

  describe('useAutomation generalized command bridge', () => {
    it('routes full RendererCommand to the handler and replies with ok or structured AutomationFailure', async () => {
      let listener: ((cmd: RendererCommand) => void) | null = null
      const onRequestSpy = vi.spyOn(api.automation, 'onRequest').mockImplementation((fn) => {
        listener = fn
        return () => { listener = null }
      })
      const readySpy = vi.spyOn(api.automation, 'ready').mockResolvedValue(undefined)
      const replySpy = vi.spyOn(api.automation, 'reply').mockResolvedValue(undefined)

      const handler = vi.fn(async (cmd: RendererCommand) => {
        if (cmd.action === 'inspect') return { activeTab: 't1', tabs: [] }
        throw new AutomationFailure('TAB_NOT_FOUND', 'Missing tab', { tab: 'nope' })
      })

      function BridgeProbe() {
        useAutomation(handler)
        return null
      }

      try {
        root = createRoot(document.createElement('div'))
        await act(async () => { root!.render(<BridgeProbe />) })
        expect(readySpy).toHaveBeenCalledWith(true)
        expect(listener).not.toBeNull()

        listener!({ id: 'req-1', action: 'inspect' })
        listener!({ id: 'req-2', action: 'tab.activate', tab: 'nope' })
        await vi.waitFor(() => expect(replySpy).toHaveBeenCalledTimes(2))

        expect(handler).toHaveBeenNthCalledWith(1, { id: 'req-1', action: 'inspect' })
        expect(replySpy).toHaveBeenNthCalledWith(1, { id: 'req-1', ok: true, value: { activeTab: 't1', tabs: [] } })
        expect(replySpy).toHaveBeenNthCalledWith(2, {
          id: 'req-2',
          ok: false,
          error: { code: 'TAB_NOT_FOUND', message: 'Missing tab', details: { tab: 'nope' } },
        })
        act(() => root?.unmount())
        root = null
        expect(readySpy).toHaveBeenCalledWith(false)
      } finally {
        onRequestSpy.mockRestore()
        readySpy.mockRestore()
        replySpy.mockRestore()
      }
    })
  })
})
