import { flushSync } from 'react-dom'
import { AutomationFailure } from '@shared/automation'
import type { RendererCommand, TabMode, WindowInspectResult } from '@shared/automationNavigation'
import type { SidebarTab } from '@shared/types'
import { dirtyPaths, flushRenamedPath } from '../lib/renameContinuity'
import { flushWindow } from '../lib/windowFlush'
import { tabOf, type Tab } from '../workspace/useWorkspace'
import { navigateApp } from './navigateApp'

export interface WindowStateSnapshot {
  path: string | null
  activeTab: string | null
  tabs: readonly Tab[]
  sidebar: SidebarTab
  sidebarCollapsed: boolean
}

export interface WindowCommandDeps {
  getState(): WindowStateSnapshot
  toggleSidebar(): void
  changeLens(lens: SidebarTab): void
  openPage(path: string): void
  openBatch(paths: readonly string[], activePath: string | null, tabMode: TabMode): readonly Tab[]
  activateTab(id: string): void
  closeTabs(ids: string[], moved?: boolean): void
  titleOf(path: string, name?: string): string
  leaveChrome?(): void
  isDirty?(path: string): boolean
  flushWindow?(): Promise<boolean>
  flushPath?(path: string): Promise<void>
}

function findTab(state: Pick<WindowStateSnapshot, 'tabs' | 'activeTab'>, tabId?: string, path?: string): Tab | null {
  if (tabId !== undefined) {
    const byId = state.tabs.find((t) => t.id === tabId) ?? null
    if (byId === null) return null
    if (path !== undefined && byId.path !== path) return null
    return byId
  }
  if (path !== undefined) {
    return tabOf({ tabs: [...state.tabs], active: state.activeTab }, path) ?? state.tabs.find((t) => t.path === path) ?? null
  }
  return null
}

async function flushOrGuard(tabs: readonly Tab[], deps: WindowCommandDeps, force: boolean): Promise<void> {
  if (tabs.length === 0) return
  const paths = [...new Set(tabs.map((t) => t.path))]
  let clean = true
  const doFlushPath = deps.flushPath ?? flushRenamedPath
  for (const p of paths) {
    try {
      await doFlushPath(p)
    } catch {
      clean = false
    }
  }
  let windowClean = true
  try {
    windowClean = await (deps.flushWindow ?? flushWindow)()
  } catch {
    windowClean = false
  }
  if (force) return
  const dirtySet = deps.isDirty === undefined ? new Set(dirtyPaths()) : null
  const isDirty = deps.isDirty ?? ((path: string) => dirtySet!.has(path))
  const stillDirty = tabs.filter((t) => isDirty(t.path))
  if (!clean || !windowClean || stillDirty.length > 0) {
    const failedIds = stillDirty.length > 0 ? stillDirty.map((t) => t.id) : tabs.map((t) => t.id)
    throw new AutomationFailure('DIRTY_TAB', 'Unsaved edits could not be flushed.', { tabs: failedIds })
  }
}

/** Execute one renderer-side CLI automation command (`navigate`, `inspect`, `tab.activate`, `tab.close`, `tab.move`, YAZ-6539). */
export async function runWindowCommand(command: RendererCommand, deps: WindowCommandDeps): Promise<unknown> {
  switch (command.action) {
    case 'navigate':
      return navigateApp(command.target, {
        isSidebarCollapsed: () => deps.getState().sidebarCollapsed,
        toggleSidebar: deps.toggleSidebar,
        changeLens: deps.changeLens,
        openPage: deps.openPage,
        openBatch: (paths, activePath, tabMode) => {
          deps.leaveChrome?.()
          return deps.openBatch(paths, activePath, tabMode)
        },
        getTabs: () => deps.getState().tabs,
      })

    case 'inspect': {
      const state = deps.getState()
      // Never wakes sleeping tabs: reads only live in-memory tab metadata and mounted editors' dirty set.
      const dirtySet = deps.isDirty === undefined ? new Set(dirtyPaths()) : null
      const isDirty = deps.isDirty ?? ((path: string) => dirtySet!.has(path))
      const result: WindowInspectResult = {
        path: state.path,
        tab: state.activeTab,
        sidebar: state.sidebar,
        sidebarCollapsed: state.sidebarCollapsed,
        activeTab: state.activeTab,
        tabs: state.tabs.map((t) => ({
          tab: t.id,
          path: t.path,
          title: deps.titleOf(t.path, t.name),
          active: t.id === state.activeTab,
          dirty: isDirty(t.path),
        })),
      }
      return result
    }

    case 'tab.activate': {
      if (command.tab === undefined && command.path === undefined) {
        throw new AutomationFailure('INVALID_INPUT', 'Specify tab or path to activate.')
      }
      const state = deps.getState()
      const target = findTab(state, command.tab, command.path)
      if (target === null) {
        throw new AutomationFailure('TAB_NOT_FOUND', 'No open tab matches the requested tab or path.', {
          ...(command.tab !== undefined ? { tab: command.tab } : {}),
          ...(command.path !== undefined ? { path: command.path } : {}),
        })
      }
      flushSync(() => {
        deps.leaveChrome?.()
        deps.activateTab(target.id)
      })
      return { tab: target.id, path: target.path }
    }

    case 'tab.close': {
      const state = deps.getState()
      let targetTabs: Tab[] = []
      if (command.others === true) {
        if (command.tab !== undefined || command.path !== undefined) {
          const keep = findTab(state, command.tab, command.path)
          if (keep === null) {
            throw new AutomationFailure('TAB_NOT_FOUND', 'No open tab matches the tab to keep.', {
              ...(command.tab !== undefined ? { tab: command.tab } : {}),
              ...(command.path !== undefined ? { path: command.path } : {}),
            })
          }
          targetTabs = state.tabs.filter((t) => t.id !== keep.id)
        } else if (state.activeTab !== null) {
          targetTabs = state.tabs.filter((t) => t.id !== state.activeTab)
        } else if (state.tabs.length > 0) {
          throw new AutomationFailure('TAB_NOT_FOUND', 'No active tab to keep.')
        }
      } else if (command.tabs !== undefined || command.tab !== undefined || command.path !== undefined) {
        const idSet = new Set<string>()
        if (command.tabs !== undefined) {
          const missing: string[] = []
          for (const id of command.tabs) {
            const found = state.tabs.find((t) => t.id === id)
            if (found === undefined) missing.push(id)
            else idSet.add(found.id)
          }
          if (missing.length > 0) {
            throw new AutomationFailure('TAB_NOT_FOUND', 'One or more requested tabs were not found.', { tabs: missing })
          }
        }
        if (command.tab !== undefined) {
          const found = findTab(state, command.tab, command.path)
          if (found === null) {
            throw new AutomationFailure('TAB_NOT_FOUND', 'No open tab matches the requested tab or path.', {
              tab: command.tab,
              ...(command.path !== undefined ? { path: command.path } : {}),
            })
          }
          idSet.add(found.id)
        } else if (command.path !== undefined) {
          const matched = state.tabs.filter((t) => t.path === command.path)
          if (matched.length === 0) {
            throw new AutomationFailure('TAB_NOT_FOUND', 'No open tab matches the requested path.', { path: command.path })
          }
          for (const t of matched) idSet.add(t.id)
        }
        targetTabs = state.tabs.filter((t) => idSet.has(t.id))
      } else {
        const active = state.tabs.find((t) => t.id === state.activeTab) ?? null
        if (active === null) {
          throw new AutomationFailure('TAB_NOT_FOUND', 'No active tab to close.')
        }
        targetTabs = [active]
      }

      await flushOrGuard(targetTabs, deps, command.force === true)
      const ids = targetTabs.map((t) => t.id)
      if (ids.length > 0) {
        flushSync(() => deps.closeTabs(ids, false))
      }
      const after = deps.getState()
      return { closed: ids, activeTab: after.activeTab, closedWindow: false }
    }

    case 'tab.move': {
      if (command.tab === undefined && command.path === undefined) {
        throw new AutomationFailure('INVALID_INPUT', 'Specify tab or path to move.')
      }
      const state = deps.getState()
      const target = findTab(state, command.tab, command.path)
      if (target === null) {
        throw new AutomationFailure('TAB_NOT_FOUND', 'No open tab matches the requested tab or path.', {
          ...(command.tab !== undefined ? { tab: command.tab } : {}),
          ...(command.path !== undefined ? { path: command.path } : {}),
        })
      }
      await flushOrGuard([target], deps, false)
      flushSync(() => deps.closeTabs([target.id], true))
      return {
        tab: target.id,
        path: target.path,
        closedSource: true,
        ...(target.name !== undefined ? { name: target.name } : {}),
        ...(target.zoom !== undefined ? { zoom: target.zoom } : {}),
      }
    }
  }
}
