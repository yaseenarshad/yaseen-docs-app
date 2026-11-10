import { Fragment, type ReactNode, useContext } from 'react'
import { rowPage } from '../../links/shortcuts'
import { FlyoutParent, MenuFlyout } from '../../components/Flyout'
import type { Value } from '../expr'
import type { FilterNode } from '../viewSchema'
import { valueFilter } from './filterRows'

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

/** The note doors a card view's menu offers (YAZ-3746 13BO CM1): ViewsPane's, as it hands the table its own. */
export interface CardNoteDoors {
  open?: (path: string) => void
  /** "New card below" (CM2): a note seeded as the table's New row below, beside this card; it opens. Absent: no item. */
  newBelow?: (path: string) => void
  duplicate?: (path: string) => void
  remove?: (paths: readonly string[]) => void
}

/**
 * A card's note items (YAZ-3746 13BO CM1), the table row's, for `PageContextMenu`: Open; the new note beside it and
 * Duplicate note as one edit group; Delete note… last. A folder row (YAZ-4579 D32) is no note: no Duplicate, no Delete.
 * `newItem` names the new note's item ("New card below", the calendar's "New note on this day").
 */
export function cardMenuItems(doors: CardNoteDoors | undefined, path: string, close: () => void, newItem?: { label: string; run: () => void }): { onOpen?: (path: string) => void; extra?: ReactNode[]; danger?: ReactNode } {
  if (doors === undefined) return {}
  const run = (action: () => void) => () => {
    close()
    action()
  }
  const note = rowPage(path) === path
  const duplicate = note ? doors.duplicate : undefined
  const remove = note ? doors.remove : undefined
  const edit = (newItem !== undefined || duplicate !== undefined) && (
    <Fragment key="note">
      {newItem !== undefined && (
        <button type="button" className="ctx-menu__item" role="menuitem" onClick={run(newItem.run)}>
          {newItem.label}
        </button>
      )}
      {duplicateNoteItem(duplicate && run(() => duplicate(path)))}
    </Fragment>
  )
  return { onOpen: doors.open, extra: edit === false ? undefined : [edit], danger: deleteNoteItem(remove && run(() => remove([path]))) }
}
