import { api, BridgeRequestError } from '../api'
import { ContextMenuSurface } from '../components/ContextMenuSurface'

/** An open tab menu: where it stands, the tab it is about, and that tab's review state as it was when the menu opened. */
export interface TabMenuAt {
  x: number
  y: number
  path: string
  /** Whether the note is in review; null for a path that is no note in the index, which hides the item. */
  review: boolean | null
}

export interface TabMenuProps {
  menu: TabMenuAt
  /** The tab as the menu's notices name it. */
  label: string
  onClose: () => void
  /** Context-menu equivalent of dragging this tab into the right panel. */
  onMoveToRight?: (path: string) => void
  /** Reveal this exact tab in the sidebar without activating it. */
  onShowInSidebar?: (path: string) => void
  onSetReview?: (path: string, on: boolean) => void
  /** Where a failed OS action says so (YAZ-963) — App's passive notice. */
  onNotice?: (message: string) => void
}

/**
 * A tab's right-click menu, in ONE place (YAZ-2648): the strip's tabs and the board's pages are
 * the same open files, so they offer the same items — the sidebar row's Copy path (YAZ-922) and
 * its OS actions (YAZ-963: Reveal in Finder, Open in VS Code), Show in sidebar, the move to the
 * right panel, and the review toggle (YAZ-2322).
 */
export function TabMenu({ menu, label, onClose, onMoveToRight, onShowInSidebar, onSetReview, onNotice }: TabMenuProps) {
  /**
   * The menu's OS actions (YAZ-963), the sidebar's `reveal` idiom on a tab: read-only, so the
   * menu closes at once and there is nothing to confirm or repair — but a STALE tab (deleted or
   * moved externally) rejects `NOT_FOUND`, and without the notice the item would just look
   * broken. Both messages are the caller's, because "reveal" and "open … in VS Code" name the
   * gesture differently in each half.
   */
  const osAction = (call: Promise<unknown>, stale: string, failed: string): void => {
    onClose()
    call.catch((err: unknown) => {
      onNotice?.(err instanceof BridgeRequestError && err.code === 'NOT_FOUND' ? stale : `${failed}: ${err instanceof Error ? err.message : String(err)}`)
    })
  }

  return (
    <ContextMenuSurface x={menu.x} y={menu.y} onClose={onClose}>
      {onMoveToRight !== undefined && (
        <button
          type="button"
          className="ctx-menu__item"
          role="menuitem"
          onClick={() => {
            onMoveToRight(menu.path)
            onClose()
          }}
        >
          Move to right panel
        </button>
      )}
      <button
        type="button"
        className="ctx-menu__item"
        role="menuitem"
        onClick={() => {
          onShowInSidebar?.(menu.path)
          onClose()
        }}
      >
        Show in sidebar
      </button>
      <button
        type="button"
        className="ctx-menu__item"
        role="menuitem"
        onClick={() => {
          void navigator.clipboard.writeText(menu.path)
          onClose()
        }}
      >
        Copy path
      </button>
      {/* The review toggle (YAZ-2322), under Copy path: a tab that is not a note has no state and no item. */}
      {menu.review !== null && (
        <button
          type="button"
          className="ctx-menu__item"
          role="menuitem"
          onClick={() => {
            onSetReview?.(menu.path, !menu.review)
            onClose()
          }}
        >
          {menu.review ? 'Turn review off' : 'Turn review on'}
        </button>
      )}
      <button type="button" className="ctx-menu__item" role="menuitem" onClick={() => osAction(api.shell.reveal({ path: menu.path }), `Can't reveal "${label}" — it is no longer there`, "Can't reveal")}>
        Reveal in Finder
      </button>
      <button type="button" className="ctx-menu__item" role="menuitem" onClick={() => osAction(api.shell.openVsCode({ path: menu.path }), `Can't open "${label}" in VS Code — it is no longer there`, "Can't open in VS Code")}>
        Open in VS Code
      </button>
    </ContextMenuSurface>
  )
}
