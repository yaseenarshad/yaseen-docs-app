/**
 * useMenuEvents (GRO-2161, tabs GRO-2232): the renderer's half of the File › Open Folder… /
 * Open Recent / Search Vault / Close Tab, Yaseen Docs › Settings… (YAZ-1679) and Window › Next/Previous Tab menu gestures — subscribed on
 * mount, unsubscribed on unmount, latest callbacks win.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useMenuEvents } from './useMenuEvents'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

function installBridge() {
  const openFolderListeners = new Set<() => void>()
  const openRootListeners = new Set<(path: string) => void>()
  const searchListeners = new Set<() => void>()
  const exploreListeners = new Set<() => void>()
  const switchVaultListeners = new Set<() => void>()
  const settingsListeners = new Set<() => void>()
  const toggleSidebarListeners = new Set<() => void>()
  const closeTabListeners = new Set<() => void>()
  const nextTabListeners = new Set<() => void>()
  const prevTabListeners = new Set<() => void>()
  const tabOverviewListeners = new Set<() => void>()
  const backListeners = new Set<() => void>()
  const forwardListeners = new Set<() => void>()
  // Window › Open Back / Forward in New Tab (YAZ-4156 7).
  const backNewTabListeners = new Set<() => void>()
  const forwardNewTabListeners = new Set<() => void>()
  const newTabListeners = new Set<() => void>()
  const newWindowListeners = new Set<() => void>()
  // ⌘N and ⌘D (YAZ-3556 D1).
  const newItemListeners = new Set<() => void>()
  const goToListeners = new Set<() => void>()
  // File › Open Today's Daily Page (YAZ-3607 D11).
  const dailyPageListeners = new Set<() => void>()
  const zoomListeners = new Set<(step: -1 | 0 | 1) => void>()
  const whatsNewListeners = new Set<() => void>()
  const keySheetListeners = new Set<() => void>()
  // The board gestures (YAZ-3037).
  const exportImageListeners = new Set<() => void>()
  const exportDrawingListeners = new Set<() => void>()
  const shareLinkListeners = new Set<() => void>()
  const canvasBackgroundListeners = new Set<(color: string) => void>()
  const sub = <T,>(set: Set<T>) =>
    vi.fn((l: T) => {
      set.add(l)
      return () => set.delete(l)
    })
  const bridge = {
    menu: {
      onOpenFolder: sub(openFolderListeners),
      onOpenRoot: sub(openRootListeners),
      onSearch: sub(searchListeners),
      onExplore: sub(exploreListeners),
      onSwitchVault: sub(switchVaultListeners),
      onSettings: sub(settingsListeners),
      onToggleSidebar: sub(toggleSidebarListeners),
      onCloseTab: sub(closeTabListeners),
      onNextTab: sub(nextTabListeners),
      onPrevTab: sub(prevTabListeners),
      onTabOverview: sub(tabOverviewListeners),
      onBack: sub(backListeners),
      onForward: sub(forwardListeners),
      onBackNewTab: sub(backNewTabListeners),
      onForwardNewTab: sub(forwardNewTabListeners),
      onNewTab: sub(newTabListeners),
      onNewWindow: sub(newWindowListeners),
      onNewItem: sub(newItemListeners),
      onGoTo: sub(goToListeners),
      onDailyPage: sub(dailyPageListeners),
      onZoom: sub(zoomListeners),
      onWhatsNew: sub(whatsNewListeners),
      onKeySheet: sub(keySheetListeners),
      onExportImage: sub(exportImageListeners),
      onExportDrawing: sub(exportDrawingListeners),
      onShareLink: sub(shareLinkListeners),
      onCanvasBackground: sub(canvasBackgroundListeners),
    },
  }
  Object.defineProperty(window, 'yaseenDocs', { value: bridge, configurable: true, writable: true })
  return {
    emitOpenFolder: () => openFolderListeners.forEach((l) => l()),
    emitOpenRoot: (path: string) => openRootListeners.forEach((l) => l(path)),
    emitSearch: () => searchListeners.forEach((l) => l()),
    emitExplore: () => exploreListeners.forEach((l) => l()),
    emitSwitchVault: () => switchVaultListeners.forEach((l) => l()),
    emitSettings: () => settingsListeners.forEach((l) => l()),
    emitToggleSidebar: () => toggleSidebarListeners.forEach((l) => l()),
    emitCloseTab: () => closeTabListeners.forEach((l) => l()),
    emitNextTab: () => nextTabListeners.forEach((l) => l()),
    emitPrevTab: () => prevTabListeners.forEach((l) => l()),
    emitTabOverview: () => tabOverviewListeners.forEach((l) => l()),
    emitBack: () => backListeners.forEach((l) => l()),
    emitForward: () => forwardListeners.forEach((l) => l()),
    emitBackNewTab: () => backNewTabListeners.forEach((l) => l()),
    emitForwardNewTab: () => forwardNewTabListeners.forEach((l) => l()),
    emitNewTab: () => newTabListeners.forEach((l) => l()),
    emitNewWindow: () => newWindowListeners.forEach((l) => l()),
    emitNewItem: () => newItemListeners.forEach((l) => l()),
    emitGoTo: () => goToListeners.forEach((l) => l()),
    emitDailyPage: () => dailyPageListeners.forEach((l) => l()),
    emitZoom: (step: -1 | 0 | 1) => zoomListeners.forEach((l) => l(step)),
    emitWhatsNew: () => whatsNewListeners.forEach((l) => l()),
    emitKeySheet: () => keySheetListeners.forEach((l) => l()),
    emitExportImage: () => exportImageListeners.forEach((l) => l()),
    emitExportDrawing: () => exportDrawingListeners.forEach((l) => l()),
    emitShareLink: () => shareLinkListeners.forEach((l) => l()),
    emitCanvasBackground: (color: string) => canvasBackgroundListeners.forEach((l) => l(color)),
    count: () =>
      openFolderListeners.size +
      openRootListeners.size +
      searchListeners.size +
      exploreListeners.size +
      switchVaultListeners.size +
      settingsListeners.size +
      toggleSidebarListeners.size +
      closeTabListeners.size +
      nextTabListeners.size +
      prevTabListeners.size +
      tabOverviewListeners.size +
      backListeners.size +
      forwardListeners.size +
      backNewTabListeners.size +
      forwardNewTabListeners.size +
      newTabListeners.size +
      newWindowListeners.size +
      newItemListeners.size +
      goToListeners.size +
      dailyPageListeners.size +
      zoomListeners.size +
      whatsNewListeners.size +
      keySheetListeners.size +
      exportImageListeners.size +
      exportDrawingListeners.size +
      shareLinkListeners.size +
      canvasBackgroundListeners.size,
  }
}

interface ProbeProps {
  onOpenFolder: () => void
  onOpenRoot: (path: string) => void
  onSearch: () => void
  onExplore: () => void
  onSwitchVault: () => void
  onSettings: () => void
  onToggleSidebar: () => void
  onCloseTab: () => void
  onNextTab: () => void
  onPrevTab: () => void
  onTabOverview: () => void
  onBack: () => void
  onForward: () => void
  onBackNewTab: () => void
  onForwardNewTab: () => void
  onNewTab: () => void
  onNewWindow: () => void
  onNewItem: () => void
  onGoTo: () => void
  onDailyPage: () => void
  onZoom: (step: -1 | 0 | 1) => void
  onWhatsNew: () => void
  onKeySheet: () => void
  onExportImage: () => void
  onExportDrawing: () => void
  onShareLink: () => void
  onCanvasBackground: (color: string) => void
}

function Probe(props: ProbeProps) {
  useMenuEvents(props)
  return null
}

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  delete (window as unknown as Record<string, unknown>).yaseenDocs
})

describe('useMenuEvents', () => {
  it('routes menu gestures to the callbacks and unsubscribes on unmount', () => {
    const b = installBridge()
    const handlers = { onOpenFolder: vi.fn(), onOpenRoot: vi.fn(), onSearch: vi.fn(), onExplore: vi.fn(), onSwitchVault: vi.fn(), onSettings: vi.fn(), onToggleSidebar: vi.fn(), onCloseTab: vi.fn(), onNextTab: vi.fn(), onPrevTab: vi.fn(), onTabOverview: vi.fn(), onBack: vi.fn(), onForward: vi.fn(), onBackNewTab: vi.fn(), onForwardNewTab: vi.fn(), onNewTab: vi.fn(), onNewWindow: vi.fn(), onNewItem: vi.fn(), onGoTo: vi.fn(), onDailyPage: vi.fn(), onZoom: vi.fn(), onWhatsNew: vi.fn(), onKeySheet: vi.fn(), onExportImage: vi.fn(), onExportDrawing: vi.fn(), onShareLink: vi.fn(), onCanvasBackground: vi.fn() }
    root = createRoot(document.createElement('div'))
    act(() => root?.render(<Probe {...handlers} />))

    act(() => b.emitOpenFolder())
    expect(handlers.onOpenFolder).toHaveBeenCalledTimes(1)
    act(() => b.emitOpenRoot('/vaults/pages'))
    expect(handlers.onOpenRoot).toHaveBeenCalledWith('/vaults/pages')
    act(() => b.emitSearch())
    expect(handlers.onSearch).toHaveBeenCalledTimes(1)
    act(() => b.emitExplore())
    expect(handlers.onExplore).toHaveBeenCalledTimes(1)
    act(() => b.emitSwitchVault())
    expect(handlers.onSwitchVault).toHaveBeenCalledTimes(1)
    act(() => b.emitSettings())
    expect(handlers.onSettings).toHaveBeenCalledTimes(1)
    act(() => b.emitToggleSidebar())
    expect(handlers.onToggleSidebar).toHaveBeenCalledTimes(1)
    act(() => b.emitCloseTab())
    expect(handlers.onCloseTab).toHaveBeenCalledTimes(1)
    act(() => b.emitNextTab())
    expect(handlers.onNextTab).toHaveBeenCalledTimes(1)
    act(() => b.emitPrevTab())
    expect(handlers.onPrevTab).toHaveBeenCalledTimes(1)
    act(() => b.emitTabOverview())
    expect(handlers.onTabOverview).toHaveBeenCalledTimes(1)
    act(() => b.emitBack())
    expect(handlers.onBack).toHaveBeenCalledTimes(1)
    act(() => b.emitForward())
    expect(handlers.onForward).toHaveBeenCalledTimes(1)
    act(() => b.emitBackNewTab())
    expect(handlers.onBackNewTab).toHaveBeenCalledTimes(1)
    act(() => b.emitForwardNewTab())
    expect(handlers.onForwardNewTab).toHaveBeenCalledTimes(1)
    act(() => b.emitNewTab())
    expect(handlers.onNewTab).toHaveBeenCalledTimes(1)
    act(() => b.emitNewWindow())
    expect(handlers.onNewWindow).toHaveBeenCalledTimes(1)
    act(() => b.emitNewItem())
    expect(handlers.onNewItem).toHaveBeenCalledTimes(1)
    act(() => b.emitGoTo())
    expect(handlers.onGoTo).toHaveBeenCalledTimes(1)
    act(() => b.emitDailyPage())
    expect(handlers.onDailyPage).toHaveBeenCalledTimes(1)
    act(() => b.emitZoom(-1))
    expect(handlers.onZoom).toHaveBeenCalledExactlyOnceWith(-1)
    act(() => b.emitWhatsNew())
    expect(handlers.onWhatsNew).toHaveBeenCalledTimes(1)
    act(() => b.emitKeySheet())
    expect(handlers.onKeySheet).toHaveBeenCalledTimes(1)
    act(() => b.emitExportImage())
    expect(handlers.onExportImage).toHaveBeenCalledTimes(1)
    act(() => b.emitExportDrawing())
    expect(handlers.onExportDrawing).toHaveBeenCalledTimes(1)
    act(() => b.emitShareLink())
    expect(handlers.onShareLink).toHaveBeenCalledTimes(1)
    act(() => b.emitCanvasBackground('#fffce8'))
    expect(handlers.onCanvasBackground).toHaveBeenCalledExactlyOnceWith('#fffce8')

    act(() => root?.unmount())
    root = null
    expect(b.count()).toBe(0)
  })
})
