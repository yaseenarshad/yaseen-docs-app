import { useEffect } from 'react'

interface ContextMenuProps {
  x: number
  y: number
  onNewNote: () => void
  onNewFolder: () => void
  onClose: () => void
}

/** Right-click menu for the file tree (GRO-2022). The overlay catches click-away and stray right-clicks. */
export function ContextMenu({ x, y, onNewNote, onNewFolder, onClose }: ContextMenuProps) {
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
        <button type="button" className="ctx-menu__item" role="menuitem" onClick={onNewNote}>
          New note
        </button>
        <button type="button" className="ctx-menu__item" role="menuitem" onClick={onNewFolder}>
          New folder
        </button>
      </div>
    </div>
  )
}
