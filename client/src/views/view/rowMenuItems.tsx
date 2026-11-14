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

/** "Duplicate page" (YAZ-4592 S26), only when the table has its door; an edit item (YAZ-4608 C8). Null without the door. */
export function duplicatePageItem(onDuplicate: (() => void) | undefined): ReactNode {
  if (onDuplicate === undefined) return null
  return (
    <button type="button" className="ctx-menu__item" role="menuitem" onClick={onDuplicate}>
      Duplicate page
    </button>
  )
}

/** "Delete page…" (YAZ-4592 S26), only when the table has its door: the menu's LAST group, the destructive one (YAZ-4608 C8). */
export function deletePageItem(onDelete: (() => void) | undefined): ReactNode {
  if (onDelete === undefined) return null
  return (
    <button type="button" className="ctx-menu__item ctx-menu__item--danger" role="menuitem" onClick={onDelete}>
      Delete page…
    </button>
  )
}

/** The page doors a card view's menu offers (YAZ-3746 13BO CM1): ViewsPane's, as it hands the table its own. */
export interface CardPageDoors {
  open?: (path: string) => void
  /** "New card below" (CM2): a page seeded as the table's New row below, beside this card; it opens. Absent: no item. */
  newBelow?: (path: string) => void
  duplicate?: (path: string) => void
  remove?: (paths: readonly string[]) => void
}

/**
 * A card's page items (YAZ-3746 13BO CM1), the table row's, for `PageContextMenu`: Open; the new page beside it and
 * Duplicate page as one edit group; Delete page… last. A folder row (YAZ-4579 D32) is no page: no Duplicate, no Delete.
 * `newItem` names the new page's item ("New card below", the calendar's "New page on this day").
 */
export function cardMenuItems(doors: CardPageDoors | undefined, path: string, close: () => void, newItem?: { label: string; run: () => void }): { onOpen?: (path: string) => void; extra?: ReactNode[]; danger?: ReactNode } {
  if (doors === undefined) return {}
  const run = (action: () => void) => () => {
    close()
    action()
  }
  const page = rowPage(path) === path
  const duplicate = page ? doors.duplicate : undefined
  const remove = page ? doors.remove : undefined
  const edit = (newItem !== undefined || duplicate !== undefined) && (
    <Fragment key="page">
      {newItem !== undefined && (
        <button type="button" className="ctx-menu__item" role="menuitem" onClick={run(newItem.run)}>
          {newItem.label}
        </button>
      )}
      {duplicatePageItem(duplicate && run(() => duplicate(path)))}
    </Fragment>
  )
  return { onOpen: doors.open, extra: edit === false ? undefined : [edit], danger: deletePageItem(remove && run(() => remove([path]))) }
}
