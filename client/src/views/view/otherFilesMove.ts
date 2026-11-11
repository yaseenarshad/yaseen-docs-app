/**
 * The views' door into the folder page's Other files tray (YAZ-4597, D46). `FolderView` provides it around the views
 * only — never around the tray — while the tray shows and the folder page is not read only (D36); null otherwise.
 * Every view's row menu (`PageContextMenu`) reads it for "Move to Other files", and an ungrouped table row for its
 * drag onto the tray (`trayRowDrag`).
 */
import { createContext, type DragEvent as ReactDragEvent } from 'react'
import { rowPage } from '../../links/shortcuts'

export const OtherFilesMove = createContext<((path: string) => void) | null>(null)

/** A subfolder directly under the folder page, by its directory and its name. */
export interface TraySubfolder {
  dir: string
  name: string
}

/**
 * The views' door for a WHOLE subfolder (YAZ-4747 OF1), beside `OtherFilesMove` and under the same rule (null while
 * the tray takes no moves). `FolderView` provides it; `ViewsPane` provides it again with `move` bound to the notes its
 * view shows, so the ask (OF2) counts what the table shows.
 */
export interface FolderTray {
  /** The subfolder directly under the page that holds this row's page (a note in Desserts/Cakes → Desserts); null for a note of the page itself, or a folder already moved. */
  folderOf: (rowPath: string) => TraySubfolder | null
  /** The same for a Folder group's key, a root-relative folder: only a subfolder directly under the page. */
  folderAt: (rel: string) => TraySubfolder | null
  /** Move it: the ask first when the view shows notes of it (`shown`, the view's note paths). */
  move: (dir: string, shown?: readonly string[]) => void
}

export const OtherFilesFolderMove = createContext<FolderTray | null>(null)

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
