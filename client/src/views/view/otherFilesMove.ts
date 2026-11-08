/**
 * The views' door into the folder page's Other files tray (YAZ-4597, D46). `FolderView` provides it around the views
 * only — never around the tray — while the tray shows and the folder page is not read only (D36); null otherwise.
 * Every view's row menu (`PageContextMenu`) reads it for "Move to Other files", and an ungrouped table row for its
 * drag onto the tray (`trayRowDrag`).
 */
import { createContext, type DragEvent as ReactDragEvent } from 'react'
import { rowPage } from '../../links/shortcuts'

export const OtherFilesMove = createContext<((path: string) => void) | null>(null)

/** A note row can move; a folder row (YAZ-4579 D32) cannot: its page is its folder. */
export const movesToOtherFiles = (path: string): boolean => rowPage(path) === path

/**
 * An ungrouped table row as a drag source for the tray (D46): the groups' own drag sets `text/plain` to the path
 * (`groupDrag.ts`), and so does this. Nothing when the tray takes no moves. `dataTransfer` is guarded: jsdom's
 * synthetic drags have none.
 */
export function trayRowDrag(move: ((path: string) => void) | null, path: string): Record<string, unknown> {
  if (move === null || !movesToOtherFiles(path)) return {}
  return {
    draggable: true,
    onDragStart: (e: ReactDragEvent) => {
      e.dataTransfer?.setData('text/plain', path)
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
    },
  }
}
