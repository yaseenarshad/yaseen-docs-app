import { useEffect } from 'react'
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
  onNewNote: () => void
  /** Create an Obsidian-compatible `.base` file (GRO-2126). */
  onNewBase: () => void
  onNewFolder: () => void
  onClose: () => void
}

/** Right-click menu for the file tree (GRO-2022). The overlay catches click-away and stray right-clicks. */
export function ContextMenu({ x, y, copyPath, copyLinkPath, newWindowPath, onOpenNewWindow, onNewNote, onNewBase, onNewFolder, onClose }: ContextMenuProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="ctx-overlay"
      onMouseDown={onClose}
      onContextMenu={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <div className="ctx-menu" style={{ left: x, top: y }} onMouseDown={(e) => e.stopPropagation()} role="menu">
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
        <button type="button" className="ctx-menu__item" role="menuitem" onClick={onNewBase}>
          New base
        </button>
        <button type="button" className="ctx-menu__item" role="menuitem" onClick={onNewFolder}>
          New folder
        </button>
      </div>
    </div>
  )
}
