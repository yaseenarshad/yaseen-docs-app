import { useEffect } from 'react'
import type { MovedTab, TabAction, TabRef } from '@shared/types'
import { api } from '../api'

interface UseLinkEventsOptions {
  /** A yaseendocs:// link resolved to this window: open `path` (guaranteed inside this window's root). */
  onOpenFile: (path: string) => void
  /** A link could not be opened: show `message` unobtrusively (never a dialog). */
  onNotice: (message: string) => void
  /** Another window moved a tab here (YAZ-3091 D1, D5): its page, with its name and page view when it has them. */
  onTakeTab: (tab: MovedTab) => void
  /** Another window's tab board picked a tab of this window (YAZ-3343 D3): make copy `ref.copy` of `ref.path` active. Main raised the window already. */
  onFocusTab?: (ref: TabRef) => void
  /** Another window's tab board closed tabs of this window (YAZ-3343 D3, D10): close them here, as ⌘W does. */
  onCloseTabs?: (refs: TabRef[]) => void
  /** Another window's tab board dropped this window's tab `ref` in the frame of window `to` (YAZ-3343 D13): save it, send it with `window.moveTo`, close it here. */
  onSendTab?: (req: { to: string; ref: TabRef }) => void
  /** A tab board's vault chip picked this EMPTY window's vaults (YAZ-3343 D22): show them, if it still has no tab. */
  onSetRoots?: (roots: string[]) => void
  /** A tab board of another window asked this one to move its tab `ref` to a new window, quietly (YAZ-3343). */
  onPopOutTab?: (ref: TabRef) => void
  /** Another window's board highlights this window's tab `ref`, or `null` (YAZ-3343): the strip lights it. */
  onHighlightTab?: (ref: TabRef | null) => void
  /** Another window's board asks a tab action of this window's tab (YAZ-3343): run it here. */
  onTabAction?: (req: { ref: TabRef; action: TabAction }) => void
}

/**
 * Deep-link pushes from the main process (E1, GRO-2171); main routes each link to the best window. A tab moved from
 * another window comes the same way (YAZ-3091 D1), and so do the tab board's requests from other windows (YAZ-3343
 * D3, D13). Every listener is on BEFORE `link.ready`: main sends what it held at that call, and a push with no
 * listener is lost. The board's seven are optional: a window without them hears nothing of the board.
 */
export function useLinkEvents({ onOpenFile, onNotice, onTakeTab, onFocusTab, onCloseTabs, onSendTab, onSetRoots, onPopOutTab, onHighlightTab, onTabAction }: UseLinkEventsOptions): void {
  useEffect(() => {
    const offs = [
      api.link.onOpenFile(onOpenFile),
      api.link.onNotice(onNotice),
      api.link.onTakeTab(onTakeTab),
      ...(onFocusTab === undefined ? [] : [api.link.onFocusTab(onFocusTab)]),
      ...(onCloseTabs === undefined ? [] : [api.link.onCloseTabs(onCloseTabs)]),
      ...(onSendTab === undefined ? [] : [api.link.onSendTab(onSendTab)]),
      ...(onSetRoots === undefined ? [] : [api.link.onSetRoots(onSetRoots)]),
      ...(onPopOutTab === undefined ? [] : [api.link.onPopOutTab(onPopOutTab)]),
      ...(onHighlightTab === undefined ? [] : [api.link.onHighlightTab(onHighlightTab)]),
      ...(onTabAction === undefined ? [] : [api.link.onTabAction(onTabAction)]),
    ]
    // Main holds a link push until this window can hear it (YAZ-2589 A2): a page that is still loading hears nothing.
    void api.link.ready()
    return () => {
      for (const off of offs) off()
    }
  }, [onOpenFile, onNotice, onTakeTab, onFocusTab, onCloseTabs, onSendTab, onSetRoots, onPopOutTab, onHighlightTab, onTabAction])
}
