import { flushSync } from 'react-dom'
import type { NavigationTarget, TabMode } from '@shared/automationNavigation'
import { fileKind } from '@shared/fileKind'
import type { SidebarTab } from '@shared/types'
import { waitForSurface } from './surfaces'

export interface AppNavigationDeps {
  isSidebarCollapsed(): boolean
  toggleSidebar(): void
  changeLens(lens: SidebarTab): void
  openPage(path: string): void
  openBatch?(paths: readonly string[], activePath: string | null, tabMode: TabMode): readonly { id: string; path: string }[]
  getTabs?(): readonly { id: string; path: string }[]
}

/** Execute one CLI `navigation.open` target against the live App window and wait for surfaces to settle (YAZ-4502, YAZ-6539). */
export async function navigateApp(target: NavigationTarget, deps: AppNavigationDeps): Promise<Record<string, unknown>> {
  const batchPaths = target.paths !== undefined && target.paths.length > 0 ? target.paths : null
  const wantedPath = batchPaths !== null ? (target.activePath ?? batchPaths[0]) : target.path
  const tabMode: TabMode = target.tabMode ?? (batchPaths !== null ? 'activate-or-new' : 'reuse')
  const openCode = wantedPath !== undefined && target.line !== undefined && fileKind(wantedPath) === 'text' ? (await import('../code/codeOpener')).openCodeAt : null

  const openTarget = (): void => {
    if (batchPaths !== null) {
      if (deps.openBatch !== undefined) deps.openBatch(batchPaths, wantedPath ?? null, tabMode)
      else {
        for (const p of batchPaths) deps.openPage(p)
        if (wantedPath !== undefined) deps.openPage(wantedPath)
      }
      return
    }
    if (target.path !== undefined) {
      if (tabMode === 'reuse' || deps.openBatch === undefined) deps.openPage(target.path)
      else deps.openBatch([target.path], target.path, tabMode)
    }
  }

  flushSync(() => {
    if (target.sidebar !== undefined) {
      if (deps.isSidebarCollapsed()) deps.toggleSidebar()
      deps.changeLens(target.sidebar)
    }
    if (openCode !== null && wantedPath !== undefined && target.line !== undefined) {
      openCode(wantedPath, { lineNumber: target.line, column: 1 }, () => openTarget())
    } else {
      openTarget()
    }
  })

  const app = await waitForSurface('app', (surface) => {
    const shown = surface.inspect() as { path: string | null; sidebar: SidebarTab; sidebarCollapsed: boolean }
    return (wantedPath === undefined || shown.path === wantedPath) && (target.sidebar === undefined || (shown.sidebar === target.sidebar && !shown.sidebarCollapsed))
  })
  if (wantedPath !== undefined && target.line !== undefined && fileKind(wantedPath) === 'markdown') {
    const editor = await waitForSurface(`editor:${String(app.inspect().tab)}`)
    await editor.jumpToLine?.(target.line)
  }
  if ((wantedPath !== undefined || target.group !== undefined) && target.reveal !== false && target.sidebar !== undefined) {
    const sidebar = await waitForSurface('sidebar')
    const revealTarget = wantedPath !== undefined && target.path === undefined ? { ...target, path: wantedPath } : target
    await sidebar.reveal?.(revealTarget)
  }
  if (target.view !== undefined) {
    const key = `view:${String(app.inspect().tab)}`
    // Main named a view the saved file holds; a page whose index has not caught up with that file yet waits for it.
    const view = await waitForSurface(key, (surface) => (surface.inspect().views as string[] | undefined)?.includes(target.view!) === true)
    flushSync(() => view.selectView?.(target.view!))
    await waitForSurface(key, (surface) => surface.inspect().view === target.view)
  }
  const shown = app.inspect()
  const tabs = deps.getTabs?.().map((t) => ({ tab: t.id, path: t.path }))
  return { ...shown, ...(tabs !== undefined ? { tabs } : {}), acknowledged: true }
}
