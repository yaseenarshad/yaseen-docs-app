import { type ReactNode, useContext } from 'react'
import { createPortal } from 'react-dom'
import { GroupLevelStepsContext } from '../groupLevelSteps'
import { ContextMenuSurface } from '../../components/ContextMenuSurface'
import { CollapseAllIcon, ExpandAllIcon, PlusIcon } from './icons'

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
  // One level at a time (YAZ-3746 13AT): every group of a level, beside this one group; only with two levels or more.
  const levels = useContext(GroupLevelStepsContext)
  const step = (label: string, icon: ReactNode, run: (() => void) | undefined) => (
    <button
      type="button"
      className="ctx-menu__item"
      role="menuitem"
      disabled={run === undefined}
      onClick={() => {
        onClose()
        run?.()
      }}
    >
      <span className="ctx-menu__label">
        {icon}
        {label}
      </span>
    </button>
  )
  return createPortal(
    <ContextMenuSurface x={x} y={y} onClose={onClose}>
      <div className="ctx-menu__group" role="group">
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
            <span className="ctx-menu__label"><PlusIcon />New note in this group</span>
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
          {/* The toolbar's own fold glyphs (YAZ-3746 13B): the same picture for the same act, muscle memory. */}
          <span className="ctx-menu__label">{collapsed ? <><ExpandAllIcon />Expand this group</> : <><CollapseAllIcon />Collapse this group</>}</span>
        </button>
      </div>
      {levels !== null && (
        <div className="ctx-menu__group" role="group">
          {step('Collapse one level', <CollapseAllIcon />, levels.collapseOne)}
          {step('Expand one level', <ExpandAllIcon />, levels.expandOne)}
        </div>
      )}
    </ContextMenuSurface>,
    document.body,
  )
}
