import { useEffect } from 'react'
import type { MovedTab } from '@shared/types'
import { api } from '../api'

interface UseLinkEventsOptions {
  /** A yaseendocs:// link resolved to this window: open `path` (guaranteed inside this window's root). */
  onOpenFile: (path: string) => void
  /** A link could not be opened: show `message` unobtrusively (never a dialog). */
  onNotice: (message: string) => void
  /** Another window moved a tab here (YAZ-3091 D1, D5): its page, with its name and page view when it has them. */
  onTakeTab: (tab: MovedTab) => void
}

/** Deep-link pushes from the main process (E1, GRO-2171); main routes each link to the best window. A tab moved from another window comes the same way (YAZ-3091 D1). */
export function useLinkEvents({ onOpenFile, onNotice, onTakeTab }: UseLinkEventsOptions): void {
  useEffect(() => {
    const offOpenFile = api.link.onOpenFile(onOpenFile)
    const offNotice = api.link.onNotice(onNotice)
    const offTakeTab = api.link.onTakeTab(onTakeTab)
    // Main holds a link push until this window can hear it (YAZ-2589 A2): a page that is still loading hears nothing.
    void api.link.ready()
    return () => {
      offOpenFile()
      offNotice()
      offTakeTab()
    }
  }, [onOpenFile, onNotice, onTakeTab])
}
