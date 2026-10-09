import { useEffect } from 'react'
import type { ZoomStep } from '@shared/types'
import { api } from '../api'

interface UseMenuEventsOptions {
  /** File › Open Folder… (⌘⇧O) targeted this window: run the pick-folder flow. */
  onOpenFolder: () => void
  /** File › Open Recent chose `path` for this window: switch the root in place. */
  onOpenRoot: (path: string) => void
  /** File › Search Vault (⌘K): show the sidebar's Search tab and focus its bar (YAZ-2638 D2), un-collapsing the sidebar first (YAZ-804). */
  onSearch: () => void
  /** File › Switch Vault… (⌘O): open the sidebar header's vault switcher, un-collapsing the sidebar first (YAZ-1767 D8). */
  onSwitchVault: () => void
  /** Yaseen Docs › Settings… (⌘,): open the settings dialog (YAZ-1679). */
  onSettings: () => void
  /** View › Toggle Sidebar: toggle only this renderer's window identity (YAZ-1280). */
  onToggleSidebar: () => void
  /** File › Close Tab (⌘W): close the active tab — or the window when none are open (GRO-2234). */
  onCloseTab: () => void
  /** Window › Next Tab (⌃Tab / ⌘⇧]): activate the tab to the right, wrapping (GRO-2234). */
  onNextTab: () => void
  /** Window › Previous Tab (⌃⇧Tab / ⌘⇧[): activate the tab to the left, wrapping (GRO-2234). */
  onPrevTab: () => void
  /** Window › Tab Overview (⌘⇧M): show every open tab at once, or go back to the page (YAZ-2648 D5). */
  onTabOverview: () => void
  /** File › New Tab (⌘T): show the blank tab and put the caret in the sidebar's search bar (YAZ-2655 D10, D11). */
  onNewTab: () => void
  /** View › Zoom In / Out / Actual Size (⌘+ / ⌘− / ⌘0): the focused note, else the whole app (YAZ-1710). */
  onZoom: (step: ZoomStep) => void
}

/** Menu gestures from the main process (GRO-2161, tabs GRO-2232); main sends them to the focused window only. */
export function useMenuEvents({ onOpenFolder, onOpenRoot, onSearch, onSwitchVault, onSettings, onToggleSidebar, onCloseTab, onNextTab, onPrevTab, onTabOverview, onNewTab, onZoom }: UseMenuEventsOptions): void {
  useEffect(() => {
    const menu = api.menu
    const offs = [menu.onOpenFolder(onOpenFolder), menu.onOpenRoot(onOpenRoot), menu.onSearch(onSearch), menu.onSwitchVault(onSwitchVault), menu.onSettings(onSettings), menu.onToggleSidebar(onToggleSidebar), menu.onCloseTab(onCloseTab), menu.onNextTab(onNextTab), menu.onPrevTab(onPrevTab), menu.onTabOverview(onTabOverview), menu.onNewTab(onNewTab), menu.onZoom(onZoom)]
    return () => offs.forEach((off) => off())
  }, [onOpenFolder, onOpenRoot, onSearch, onSwitchVault, onSettings, onToggleSidebar, onCloseTab, onNextTab, onPrevTab, onTabOverview, onNewTab, onZoom])
}
