import type { ReactNode } from 'react'
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

/** "Duplicate note" and "Delete note…" (YAZ-4592 S26), each only when the table has its door. Null when it has neither. */
export function noteItems(onDuplicate: (() => void) | undefined, onDelete: (() => void) | undefined): ReactNode {
  if (onDuplicate === undefined && onDelete === undefined) return null
  return (
    <>
      {onDuplicate !== undefined && (
        <button type="button" className="ctx-menu__item" role="menuitem" onClick={onDuplicate}>
          Duplicate note
        </button>
      )}
      {onDelete !== undefined && (
        <button type="button" className="ctx-menu__item ctx-menu__item--danger" role="menuitem" onClick={onDelete}>
          Delete note…
        </button>
      )}
    </>
  )
}
