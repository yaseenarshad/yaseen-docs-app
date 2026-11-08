import { createPortal } from 'react-dom'
import { ContextMenuSurface } from '../../components/ContextMenuSurface'

interface GroupHeaderMenuProps {
  x: number
  y: number
  collapsed: boolean
  onToggle: () => void
  /** The header's "+" (5D); absent → no "New note in this group". */
  onNew?: () => void
  onClose: () => void
}

/**
 * A group header's right-click menu (YAZ-4604, D55): the header's "+", then collapse or expand only that group, through
 * its chevron's toggle — the edit before the view item, the one order of every folder-page menu (YAZ-4608 C8). On
 * `document.body`: a frozen table row is translated, and a `position: fixed` menu inside it would be placed by that
 * row, not by the window.
 */
export function GroupHeaderMenu({ x, y, collapsed, onToggle, onNew, onClose }: GroupHeaderMenuProps) {
  return createPortal(
    <ContextMenuSurface x={x} y={y} onClose={onClose}>
      {onNew !== undefined && (
        <button
          type="button"
          className="ctx-menu__item"
          role="menuitem"
          onClick={() => {
            onClose()
            onNew()
          }}
        >
          New note in this group
        </button>
      )}
      <button
        type="button"
        className="ctx-menu__item"
        role="menuitem"
        onClick={() => {
          onClose()
          onToggle()
        }}
      >
        {collapsed ? 'Expand this group' : 'Collapse this group'}
      </button>
    </ContextMenuSurface>,
    document.body,
  )
}
