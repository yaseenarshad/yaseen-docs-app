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
  /** Window › Back (⌘⌥←): the window's Back list steps back (YAZ-3647 D7). */
  onBack: () => void
  /** Window › Forward (⌘⌥→): and forward again (YAZ-3647 D7). */
  onForward: () => void
  /** File › New Tab (⌘T): show the blank tab and put the caret in the sidebar's search bar (YAZ-2655 D10, D11). */
  onNewTab: () => void
  /** File › New Window (⌘⇧N): save the page on show, then open the copy with its page view (YAZ-2951 D5). */
  onNewWindow: () => void
  /** File › New… (⌘N, YAZ-3556 D5): open the New… box. */
  onNewItem: () => void
  /** File › Show in Sidebar (⌘D, YAZ-3556 D9): show the place of `settings.goTo`. */
  onGoTo: () => void
  /** File › Open Today's Daily Note (YAZ-3607 D11): open today's daily note. */
  onDailyNote: () => void
  /** View › Zoom In / Out / Actual Size (⌘+ / ⌘− / ⌘0): the focused note (YAZ-1710), else the sidebar zoom (YAZ-3389). */
  onZoom: (step: ZoomStep) => void
  /** Help › What's New… (YAZ-2976 D8): open the "What's new" sheet, with or without an update. */
  onWhatsNew: () => void
  /** Help › Keys of This Tab… (YAZ-3564 K11). */
  onKeySheet: () => void
  /** File › Export Image… (⌘⇧E, YAZ-3037): the visible drawing opens the engine's export dialog; a diagram saves a PNG or SVG. */
  onExportImage: () => void
  /** File › Export Excalidraw Drawing… (⌘⇧S, YAZ-3037): the visible drawing writes a standalone `.excalidraw`. */
  onExportDrawing: () => void
  /** File › Share Link (⌘⇧L, YAZ-3037): open the Share dialog for the visible board (YAZ-3040). */
  onShareLink: () => void
  /** View › Canvas Background › a pick (YAZ-3037): the visible drawing takes `color`. */
  onCanvasBackground: (color: string) => void
}

/** Menu gestures from the main process (GRO-2161, tabs GRO-2232); main sends them to the focused window only. */
export function useMenuEvents({ onOpenFolder, onOpenRoot, onSearch, onSwitchVault, onSettings, onToggleSidebar, onCloseTab, onNextTab, onPrevTab, onTabOverview, onBack, onForward, onNewTab, onNewWindow, onNewItem, onGoTo, onDailyNote, onZoom, onWhatsNew, onKeySheet, onExportImage, onExportDrawing, onShareLink, onCanvasBackground }: UseMenuEventsOptions): void {
  useEffect(() => {
    const menu = api.menu
    const offs = [
      menu.onOpenFolder(onOpenFolder),
      menu.onOpenRoot(onOpenRoot),
      menu.onSearch(onSearch),
      menu.onSwitchVault(onSwitchVault),
      menu.onSettings(onSettings),
      menu.onToggleSidebar(onToggleSidebar),
      menu.onCloseTab(onCloseTab),
      menu.onNextTab(onNextTab),
      menu.onPrevTab(onPrevTab),
      menu.onTabOverview(onTabOverview),
      menu.onBack(onBack),
      menu.onForward(onForward),
      menu.onNewTab(onNewTab),
      menu.onNewWindow(onNewWindow),
      menu.onNewItem(onNewItem),
      menu.onGoTo(onGoTo),
      menu.onDailyNote(onDailyNote),
      menu.onZoom(onZoom),
      menu.onWhatsNew(onWhatsNew),
      menu.onKeySheet(onKeySheet),
      menu.onExportImage(onExportImage),
      menu.onExportDrawing(onExportDrawing),
      menu.onShareLink(onShareLink),
      menu.onCanvasBackground(onCanvasBackground),
    ]
    return () => offs.forEach((off) => off())
  }, [onOpenFolder, onOpenRoot, onSearch, onSwitchVault, onSettings, onToggleSidebar, onCloseTab, onNextTab, onPrevTab, onTabOverview, onBack, onForward, onNewTab, onNewWindow, onNewItem, onGoTo, onDailyNote, onZoom, onWhatsNew, onKeySheet, onExportImage, onExportDrawing, onShareLink, onCanvasBackground])
}
