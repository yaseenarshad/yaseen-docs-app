import { api, BridgeRequestError } from '../../api'
import { ContextMenuSurface } from '../../components/ContextMenuSurface'
import { copyNoteId } from '../../lib/copyNoteId'

interface PageContextMenuProps {
  x: number
  y: number
  path: string
  /** The page's title, off the row's own index record (YAZ-2420 🔒 D14): what a notice calls it. */
  title: string
  /** The page's note id (YAZ-2293), off the row's own index record; absent when it has none, and "Copy ID" is then not offered. */
  noteId?: string
  onOpenRight?: (path: string) => void
  onOpenBackground?: (path: string) => void
  onNotice?: (message: string) => void
  onClose: () => void
}

/** Page actions shared by folder views; positioning and dismissal stay action-free. */
export function PageContextMenu({ x, y, path, title, noteId, onOpenRight, onOpenBackground, onNotice, onClose }: PageContextMenuProps) {
  const reveal = (): void => {
    onClose()
    api.shell.reveal({ path }).catch((error: unknown) => {
      onNotice?.(
        error instanceof BridgeRequestError && error.code === 'NOT_FOUND'
          ? `Can't reveal "${title}" — it is no longer there`
          : `Can't reveal: ${error instanceof Error ? error.message : String(error)}`,
      )
    })
  }

  return (
    <ContextMenuSurface x={x} y={y} onClose={onClose}>
      {onOpenBackground !== undefined && (
        <button
          type="button"
          className="ctx-menu__item"
          role="menuitem"
          onClick={() => {
            onOpenBackground(path)
            onClose()
          }}
        >
          Open in new tab
        </button>
      )}
      <button
        type="button"
        className="ctx-menu__item"
        role="menuitem"
        onClick={() => {
          void navigator.clipboard.writeText(path).catch((error: unknown) => {
            onNotice?.(`Can't copy path: ${error instanceof Error ? error.message : String(error)}`)
          })
          onClose()
        }}
      >
        Copy path
      </button>
      {/* Right under Copy path (YAZ-2293): exactly the id, which is what a `[[id]]` link names. */}
      {noteId !== undefined && (
        <button
          type="button"
          className="ctx-menu__item"
          role="menuitem"
          onClick={() => {
            copyNoteId(noteId, onNotice)
            onClose()
          }}
        >
          Copy ID
        </button>
      )}
      <button type="button" className="ctx-menu__item" role="menuitem" onClick={reveal}>
        Reveal in Finder
      </button>
      {/* Last on purpose (YAZ-1556): the pane-specific open sits below the page actions every surface shares. */}
      {onOpenRight !== undefined && (
        <button
          type="button"
          className="ctx-menu__item"
          role="menuitem"
          onClick={() => {
            onOpenRight(path)
            onClose()
          }}
        >
          Open in right panel
        </button>
      )}
    </ContextMenuSurface>
  )
}
