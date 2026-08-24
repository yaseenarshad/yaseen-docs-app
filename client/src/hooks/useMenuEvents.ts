import { useEffect } from 'react'

interface UseMenuEventsOptions {
  /** File › Open Folder… (⌘⇧O) targeted this window: run the pick-folder flow. */
  onOpenFolder: () => void
  /** File › Open Recent chose `path` for this window: switch the root in place. */
  onOpenRoot: (path: string) => void
  /** File › Search Vault (⌘K): focus the sidebar's search bar, un-collapsing the sidebar first (YAZ-804). */
  onSearch: () => void
  /** File › Close Tab (⌘W): close the active tab — or the window when none are open (GRO-2234). */
  onCloseTab: () => void
  /** Window › Next Tab (⌃Tab / ⌘⇧]): activate the tab to the right, wrapping (GRO-2234). */
  onNextTab: () => void
  /** Window › Previous Tab (⌃⇧Tab / ⌘⇧[): activate the tab to the left, wrapping (GRO-2234). */
  onPrevTab: () => void
}

/** Menu gestures from the main process (GRO-2161, tabs GRO-2232); main sends them to the focused window only. */
export function useMenuEvents({ onOpenFolder, onOpenRoot, onSearch, onCloseTab, onNextTab, onPrevTab }: UseMenuEventsOptions): void {
  useEffect(() => {
    const menu = window.yaseenDocs.menu
    const offs = [menu.onOpenFolder(onOpenFolder), menu.onOpenRoot(onOpenRoot), menu.onSearch(onSearch), menu.onCloseTab(onCloseTab), menu.onNextTab(onNextTab), menu.onPrevTab(onPrevTab)]
    return () => offs.forEach((off) => off())
  }, [onOpenFolder, onOpenRoot, onSearch, onCloseTab, onNextTab, onPrevTab])
}
