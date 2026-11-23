import { flushSync } from 'react-dom'
import type { NavigationTarget } from '@shared/automationNavigation'
import { fileKind } from '@shared/fileKind'
import type { SidebarTab } from '@shared/types'
import { waitForSurface } from './surfaces'

export interface AppNavigationDeps {
  isSidebarCollapsed(): boolean
  toggleSidebar(): void
  changeLens(lens: SidebarTab): void
  openPage(path: string): void
}

/** Execute one CLI `navigation.open` target against the live App window and wait for surfaces to settle (YAZ-4502). */
export async function navigateApp(target: NavigationTarget, deps: AppNavigationDeps): Promise<Record<string, unknown>> {
  const openCode = target.path !== undefined && target.line !== undefined && fileKind(target.path) === 'text' ? (await import('../code/codeOpener')).openCodeAt : null
  flushSync(() => {
    if (target.sidebar !== undefined) {
      if (deps.isSidebarCollapsed()) deps.toggleSidebar()
      deps.changeLens(target.sidebar)
    }
    if (target.path !== undefined) {
      if (openCode !== null && target.line !== undefined) openCode(target.path, { lineNumber: target.line, column: 1 }, deps.openPage)
      else deps.openPage(target.path)
    }
  })
  const app = await waitForSurface('app', (surface) => {
    const shown = surface.inspect() as { path: string | null; sidebar: SidebarTab; sidebarCollapsed: boolean }
    return (target.path === undefined || shown.path === target.path) && (target.sidebar === undefined || (shown.sidebar === target.sidebar && !shown.sidebarCollapsed))
  })
  if (target.path !== undefined && target.line !== undefined && fileKind(target.path) === 'markdown') {
    const editor = await waitForSurface(`editor:${String(app.inspect().tab)}`)
    await editor.jumpToLine?.(target.line)
  }
  if ((target.path !== undefined || target.group !== undefined) && target.reveal !== false && target.sidebar !== undefined) {
    const sidebar = await waitForSurface('sidebar')
    await sidebar.reveal?.(target)
  }
  if (target.view !== undefined) {
    const key = `view:${String(app.inspect().tab)}`
    // Main named a view the saved file holds; a page whose index has not caught up with that file yet waits for it.
    const view = await waitForSurface(key, (surface) => (surface.inspect().views as string[] | undefined)?.includes(target.view!) === true)
    flushSync(() => view.selectView?.(target.view!))
    await waitForSurface(key, (surface) => surface.inspect().view === target.view)
  }
  return { ...app.inspect(), acknowledged: true }
}
