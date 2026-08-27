import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { fileLink } from '@shared/links'

interface ContextMenuProps {
  x: number
  y: number
  /** Absolute path of the right-clicked row (file or folder); null for blank space (GRO-2069). */
  copyPath: string | null
  /** Absolute path of the right-clicked FILE row; null (folders, blank space) hides "Copy link" — a folder link would only fail main's markdown guard (E3, GRO-2173). */
  copyLinkPath: string | null
  /** Absolute path of the right-clicked FILE row; null (folders, blank space) hides "Open in new window" (D2, GRO-2168). */
  newWindowPath: string | null
  onOpenNewWindow: (path: string) => void
  /** Absolute path of the right-clicked row — FILE (Links E1, GRO-2194) or FOLDER (E1b, GRO-2241); null (blank space) hides "Rename". */
  renamePath: string | null
  onRename: (path: string) => void
  /** Absolute path of the right-clicked row — file or folder; null (blank space) hides "Delete" (GRO-2272). */
  deletePath: string | null
  onDelete: (path: string) => void
  /** Row to reveal in Finder — file, folder, or the vault ROOT for blank space (GRO-2274). */
  revealPath: string | null
  onReveal: (path: string) => void
  onNewNote: () => void
  /** Create a note born a folder page — the flag and nothing else (🔒 D4 + D1, YAZ-841). */
  onNewFolderPage: () => void
  /**
   * Create a DISK folder — null hides the item (YAZ-948). The Topics lens browses by meaning,
   * never by disk location, so a folder made from it would land somewhere that lens cannot
   * show: an item whose result is invisible is worse than an item that is not offered.
   */
  onNewFolder: (() => void) | null
  /**
   * The folder-page toggle's own target (🔒 D2, YAZ-817): MARKDOWN FILE rows only — null on
   * folders and on blank space, neither of which can carry the flag.
   */
  folderPagePath: string | null
  /** Is that page a folder page ALREADY? One item, two labels — the flag picks which (🔒 D2). */
  folderPageIsOn: boolean
  /** The direction rides along with the target so the caller never re-derives it after the close. */
  onToggleFolderPage: (path: string, isOn: boolean) => void
  onClose: () => void
}

/** Right-click menu for the file tree (GRO-2022). The overlay catches click-away and stray right-clicks. */
export function ContextMenu({ x, y, copyPath, copyLinkPath, newWindowPath, onOpenNewWindow, renamePath, onRename, deletePath, onDelete, revealPath, onReveal, onNewNote, onNewFolderPage, onNewFolder, folderPagePath, folderPageIsOn, onToggleFolderPage, onClose }: ContextMenuProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Viewport clamping (GRO-2204): render at the cursor, then measure and pull the menu back
  // inside the window instead of spilling off an edge.
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const el = menuRef.current
    if (el === null) return
    const r = el.getBoundingClientRect()
    setPos({ left: Math.max(0, Math.min(x, window.innerWidth - r.width)), top: Math.max(0, Math.min(y, window.innerHeight - r.height)) })
  }, [x, y])

  return (
    <div
      className="ctx-overlay"
      onMouseDown={onClose}
      onContextMenu={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <div ref={menuRef} className="ctx-menu" style={{ left: pos.left, top: pos.top }} onMouseDown={(e) => e.stopPropagation()} role="menu">
        {newWindowPath !== null && (
          <button
            type="button"
            className="ctx-menu__item"
            role="menuitem"
            onClick={() => {
              onOpenNewWindow(newWindowPath)
              onClose()
            }}
          >
            Open in new window
          </button>
        )}
        {/* Reveal in Finder (GRO-2274): available on every row type AND on blank space, where
            it reveals the vault root — the same target Copy path uses. Grouped with the other
            read-only utilities, deliberately above the destructive item. */}
        {revealPath !== null && (
          <button
            type="button"
            className="ctx-menu__item"
            role="menuitem"
            onClick={() => {
              onReveal(revealPath)
              onClose()
            }}
          >
            Reveal in Finder
          </button>
        )}
        {copyPath !== null && (
          <button
            type="button"
            className="ctx-menu__item"
            role="menuitem"
            onClick={() => {
              void navigator.clipboard.writeText(copyPath)
              onClose()
            }}
          >
            Copy path
          </button>
        )}
        {copyLinkPath !== null && (
          <button
            type="button"
            className="ctx-menu__item"
            role="menuitem"
            onClick={() => {
              void navigator.clipboard.writeText(fileLink(copyLinkPath))
              onClose()
            }}
          >
            Copy link
          </button>
        )}
        <button type="button" className="ctx-menu__item" role="menuitem" onClick={onNewNote}>
          New note
        </button>
        {/* Directly after "New note" (🔒 D4, YAZ-817): a folder page is a NOTE born with one
            flag (🔒 D1), so it belongs beside the note it is a kind of. It creates beside the
            right-clicked row like the rest of this group — the act-on-this-row toggle below is
            the other half of the gesture, and the two must not drift together. */}
        <button type="button" className="ctx-menu__item" role="menuitem" onClick={onNewFolderPage}>
          New folder page
        </button>
        {onNewFolder !== null && (
          <button type="button" className="ctx-menu__item" role="menuitem" onClick={onNewFolder}>
            New folder
          </button>
        )}
        {/* The folder-page toggle (🔒 D2, YAZ-817): ONE state-aware item, both directions. It
            acts ON the right-clicked page rather than creating beside it, so it sits after the
            create group — and above Rename, because the destructive pair keeps the bottom. The
            reverse label is the one that opens a confirm sheet (🔒 D5); the forward one writes
            immediately (🔒 D1), which is why neither reads like a warning. */}
        {folderPagePath !== null && (
          <button
            type="button"
            className="ctx-menu__item"
            role="menuitem"
            onClick={() => {
              onToggleFolderPage(folderPagePath, folderPageIsOn)
              onClose()
            }}
          >
            {folderPageIsOn ? 'Turn back into normal page' : 'Turn into folder page'}
          </button>
        )}
        {/* Rename and Delete render LAST (GRO-2272 `C1a-`, LOCKED): VS Code's Explorer puts
            both at the bottom, and destructive-last is safer on its own merits — Delete used
            to sit directly under Rename, which is the misclick pair that matters most.
            Delete opens the confirm sheet; it must NEVER delete directly. Both are null on
            blank space: no target, and main refuses the vault root anyway. */}
        {renamePath !== null && (
          <button
            type="button"
            className="ctx-menu__item"
            role="menuitem"
            onClick={() => {
              onRename(renamePath)
              onClose()
            }}
          >
            Rename
          </button>
        )}
        {deletePath !== null && (
          <button
            type="button"
            className="ctx-menu__item ctx-menu__item--danger"
            role="menuitem"
            onClick={() => {
              onDelete(deletePath)
              onClose()
            }}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  )
}
