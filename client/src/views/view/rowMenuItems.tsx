import { type ReactNode, useContext } from 'react'
import { FlyoutParent, MenuFlyout } from '../../components/Flyout'
import type { Value } from '../expr'
import type { FilterNode } from '../viewSchema'
import { valueFilter } from './filterRows'

/**
 * "Filter by this value" and "Hide this value" (YAZ-4592 S25): the cell's value as an `is` or `is not` rule
 * (`valueFilter`), handed to `onFilter`. Null, so the menu has no such group, when no rule names the value.
 */
export function filterValueItems(property: string, value: Value, onFilter: (rule: FilterNode) => void): ReactNode {
  const is = valueFilter(property, value, false)
  const isNot = valueFilter(property, value, true)
  if (is === null || isNot === null) return null
  return (
    <>
      <button type="button" className="ctx-menu__item" role="menuitem" onClick={() => onFilter(is)}>
        Filter by this value
      </button>
      <button type="button" className="ctx-menu__item" role="menuitem" onClick={() => onFilter(isNot)}>
        Hide this value
      </button>
    </>
  )
}

/**
 * "Filter ›" (YAZ-3746 13AW): the same two rules in one flyout of the row menu — "Show only this value" and "Hide this
 * value" — on the menu's one flyout (`MenuFlyout`). Null when no rule names the value.
 */
export function FilterValueParent({ property, value, onFilter }: { property: string; value: Value; onFilter: (rule: FilterNode) => void }) {
  const flyout = useContext(MenuFlyout)
  const is = valueFilter(property, value, false)
  const isNot = valueFilter(property, value, true)
  if (is === null || isNot === null || flyout === null) return null
  return (
    <FlyoutParent label="Filter" open={flyout.open === 'filter'} onHover={() => flyout.hover('filter')} onOpen={() => flyout.openNow('filter')} onCloseFlyout={() => flyout.openNow(null)}>
      <button type="button" className="ctx-menu__item" role="menuitem" onClick={() => onFilter(is)}>
        Show only this value
      </button>
      <button type="button" className="ctx-menu__item" role="menuitem" onClick={() => onFilter(isNot)}>
        Hide this value
      </button>
    </FlyoutParent>
  )
}

/** "Duplicate note" (YAZ-4592 S26), only when the table has its door; an edit item (YAZ-4608 C8). Null without the door. */
export function duplicateNoteItem(onDuplicate: (() => void) | undefined): ReactNode {
  if (onDuplicate === undefined) return null
  return (
    <button type="button" className="ctx-menu__item" role="menuitem" onClick={onDuplicate}>
      Duplicate note
    </button>
  )
}

/** "Delete note…" (YAZ-4592 S26), only when the table has its door: the menu's LAST group, the destructive one (YAZ-4608 C8). */
export function deleteNoteItem(onDelete: (() => void) | undefined): ReactNode {
  if (onDelete === undefined) return null
  return (
    <button type="button" className="ctx-menu__item ctx-menu__item--danger" role="menuitem" onClick={onDelete}>
      Delete note…
    </button>
  )
}
