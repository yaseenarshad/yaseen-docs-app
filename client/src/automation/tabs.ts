import { flushSync } from 'react-dom'
import { AutomationFailure } from '@shared/automation'
import type { TabOperation } from '@shared/automationTabs'
import { dirtyPaths, flushRenamedPath } from '../lib/renameContinuity'
import type { UseWorkspace } from '../workspace/useWorkspace'
import type { RightPanelIdentity } from '@shared/types'
import { waitForSurface } from './surfaces'

export interface TabActions {
  current(): Pick<UseWorkspace, 'tabs' | 'active' | 'mounted' | 'blank'>
  open: UseWorkspace['openKept']
  background: UseWorkspace['openBackground']
  blank: UseWorkspace['newTab']
  duplicate(tab: string): void
  close: UseWorkspace['close']
  keep: UseWorkspace['keep']
  rename: UseWorkspace['setName']
  move: UseWorkspace['move']
  sleep: UseWorkspace['sleep']
  wake: UseWorkspace['wake']
  restore: UseWorkspace['openStored']
  collapse(value: boolean): void
  right(): RightPanelIdentity
  setRightOpen: UseWorkspace['setRightOpen']
  /** The GUI's send-tab path, awaited: true when the source window closed itself with its last tab. */
  send(tab: string, to: string | null, at: number | undefined, background: boolean): Promise<boolean>
}
export async function operateTabs(target: TabOperation, actions: TabActions) {
  const state = actions.current()
  const tab = 'tab' in target ? state.tabs.find(tab => tab.id === target.tab) : undefined
  if ('tab' in target && !tab) throw new AutomationFailure('TAB_NOT_FOUND', 'The requested tab is not in this window.')
  if (target.command === 'tab.reorder' && target.index >= state.tabs.length) throw new AutomationFailure('INVALID_INPUT', 'The target tab index is outside this strip.')
  if (target.command === 'tab.sleep' && state.active === target.tab) throw new AutomationFailure('INVALID_INPUT', 'The active tab cannot sleep.')
  if (target.command === 'tab.received') {
    // The moved tab arrives through this window's own take-tab door; each render re-registers the app surface.
    const arrived = () => actions.current().tabs.find(tab => tab.path === target.path && !target.except.includes(tab.id))
    await waitForSurface('app', () => arrived() !== undefined)
    return { ...actions.current(), tab: arrived()!.id, rendererApplied: true }
  }
  if (tab && ['tab.close', 'tab.sleep', 'tab.duplicate', 'tab.move'].includes(target.command)) {
    await flushRenamedPath(tab.path)
    if (dirtyPaths().includes(tab.path)) throw new AutomationFailure('UNSAVED_CHANGES', 'The tab could not save. Resolve its save error or conflict before this action.')
  }
  if (target.command === 'tab.open' && target.copy) {
    await flushRenamedPath(target.path)
    if (dirtyPaths().includes(target.path)) throw new AutomationFailure('UNSAVED_CHANGES', 'The source could not save. Resolve its save error or conflict before opening a copy.')
  }
  // Recheck after an asynchronous flush: a human may have closed the selected tab in the meantime.
  if (tab && !actions.current().tabs.some(current => current.id === tab.id)) throw new AutomationFailure('TAB_NOT_FOUND', 'The requested tab closed during its save.')
  if (target.command === 'tab.sleep' && actions.current().active === target.tab) throw new AutomationFailure('INVALID_INPUT', 'The tab became active during its save and cannot sleep.')
  if (target.command === 'tab.move') {
    const sourceClosed = await actions.send(target.tab, target.to, target.at, target.background)
    return { ...actions.current(), rightPanel: actions.right(), sourceClosed, rendererApplied: true }
  }
  flushSync(() => {
    switch (target.command) {
      case 'tab.open': (target.background ? actions.background : actions.open)(target.path, target.copy); break
      case 'tab.blank': actions.blank(); break
      case 'tab.close': actions.close(target.tab); break
      case 'tab.duplicate': actions.duplicate(target.tab); break
      case 'tab.keep': actions.keep(target.tab); break
      case 'tab.rename': actions.rename(target.tab, target.name); break
      case 'tab.reorder': actions.move(actions.current().tabs.findIndex(tab => tab.id === target.tab), target.index); break
      case 'tab.sleep': actions.sleep([target.tab]); break
      case 'tab.wake': actions.wake(target.tab); break
      case 'session.apply': actions.restore(target.tabs); break
      case 'sidebar.setCollapsed': actions.collapse(target.collapsed); break
      case 'rightPanel.setOpen': actions.setRightOpen(target.open); break
    }
  })
  return { ...actions.current(), rightPanel: actions.right(), rendererApplied: true }
}
