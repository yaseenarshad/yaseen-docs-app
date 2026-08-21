import { useEffect } from 'react'

interface UseMenuEventsOptions {
  /** File › Open Folder… (⌘⇧O) targeted this window: run the pick-folder flow. */
  onOpenFolder: () => void
  /** File › Open Recent chose `path` for this window: switch the root in place. */
  onOpenRoot: (path: string) => void
}

/** Menu gestures from the main process (GRO-2161); main sends them to the focused window only. */
export function useMenuEvents({ onOpenFolder, onOpenRoot }: UseMenuEventsOptions): void {
  useEffect(() => {
    const offFolder = window.yaseenDocs.menu.onOpenFolder(onOpenFolder)
    const offRoot = window.yaseenDocs.menu.onOpenRoot(onOpenRoot)
    return () => {
      offFolder()
      offRoot()
    }
  }, [onOpenFolder, onOpenRoot])
}
