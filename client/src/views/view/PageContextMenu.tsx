import { useContext, type ReactNode } from 'react'
import { api, BridgeRequestError } from '../../api'
import { ContextMenuSurface } from '../../components/ContextMenuSurface'
import { rowPage } from '../../links/shortcuts'
import { OtherFilesMove, movesToOtherFiles } from './otherFilesMove'

interface PageContextMenuProps {
  x: number
  y: number
  path: string
  /** The page's title, off the row's own index record (YAZ-2420 🔒 D14): what a notice calls it. */
  title: string
  /** "Open", in the current tab (YAZ-2420 🔒 D26): a table's, whose Name cell no longer opens on a click. */
  onOpen?: (path: string) => void
  onOpenRight?: (path: string) => void
  onOpenBackground?: (path: string) => void
  /** "Open in a window" (YAZ-4547): the card over the folder page. Only the folder table passes it. */
  onOpenWindow?: (path: string) => void
  onNotice?: (message: string) => void
  onClose: () => void
  /** A surface's own items, each entry a group after the page actions: the folder table's "Fill cell ›" and "Fill row ›" (YAZ-4536 D12), then its row freeze (YAZ-4537). */
  extra?: ReactNode[]
}

/** Page actions shared by folder views; positioning and dismissal stay action-free. */
export function PageContextMenu({ x, y, path, title, onOpen, onOpenRight, onOpenBackground, onNotice, onClose, extra, onOpenWindow }: PageContextMenuProps) {
  // A folder row's page is its folder (YAZ-4579 D32): Copy path and Reveal name the directory, not its hidden `.folder.md`.
  const page = rowPage(path)
  // "Move to Other files" (YAZ-4597 D46): its own group, last, on a note row of a folder page whose tray takes moves.
  const moveToTray = useContext(OtherFilesMove)
  const groups =
    moveToTray === null || !movesToOtherFiles(path)
      ? extra
      : [
          ...(extra ?? []),
          <button
            key="other-files"
            type="button"
            className="ctx-menu__item"
            role="menuitem"
            onClick={() => {
              onClose()
              moveToTray(path)
            }}
          >
            Move to Other files
          </button>,
        ]
  const reveal = (): void => {
    onClose()
    api.shell.reveal({ path: page }).catch((error: unknown) => {
      onNotice?.(
        error instanceof BridgeRequestError && error.code === 'NOT_FOUND'
          ? `Can't reveal "${title}" — it is no longer there`
          : `Can't reveal: ${error instanceof Error ? error.message : String(error)}`,
      )
    })
  }

  const actions = (
    <>
      {onOpen !== undefined && (
        <button
          type="button"
          className="ctx-menu__item"
          role="menuitem"
          onClick={() => {
            onOpen(path)
            onClose()
          }}
        >
          Open
        </button>
      )}
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
          void navigator.clipboard.writeText(page).catch((error: unknown) => {
            onNotice?.(`Can't copy path: ${error instanceof Error ? error.message : String(error)}`)
          })
          onClose()
        }}
      >
        Copy path
      </button>
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
      {onOpenWindow !== undefined && (
        <button
          type="button"
          className="ctx-menu__item"
          role="menuitem"
          onClick={() => {
            onOpenWindow(path)
            onClose()
          }}
        >
          Open in a window
        </button>
      )}
    </>
  )

  return (
    <ContextMenuSurface x={x} y={y} onClose={onClose}>
      {groups === undefined ? (
        actions
      ) : (
        // The groups' line between them is `.ctx-menu__group + .ctx-menu__group` (app.css).
        <>
          <div className="ctx-menu__group" role="group">
            {actions}
          </div>
          {groups.map((group, i) => (
            <div key={i} className="ctx-menu__group" role="group">
              {group}
            </div>
          ))}
        </>
      )}
    </ContextMenuSurface>
  )
}
