import { useEffect } from 'react'
import { api } from '../api'

interface UseLinkEventsOptions {
  /** A yaseendocs:// link resolved to this window: open `path` (guaranteed inside this window's root). */
  onOpenFile: (path: string) => void
  /** A link could not be opened: show `message` unobtrusively (never a dialog). */
  onNotice: (message: string) => void
}

/** Deep-link pushes from the main process (E1, GRO-2171); main routes each link to the best window. */
export function useLinkEvents({ onOpenFile, onNotice }: UseLinkEventsOptions): void {
  useEffect(() => {
    const offOpenFile = api.link.onOpenFile(onOpenFile)
    const offNotice = api.link.onNotice(onNotice)
    // Main holds a link push until this window can hear it (YAZ-2589 A2): a page that is still loading hears nothing.
    void api.link.ready()
    return () => {
      offOpenFile()
      offNotice()
    }
  }, [onOpenFile, onNotice])
}
