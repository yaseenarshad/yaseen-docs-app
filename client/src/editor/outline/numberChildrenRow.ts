/**
 * First row of the block handle menu (YAZ-729): number / un-number the hovered item's direct
 * children. Disabled when the item has no direct child list; the row only dispatches
 * toggleNumberedChildren's transaction and never touches text. No row when the block is not in a
 * list item (YAZ-3696 B3): a table, a line or a heading at the top level has nothing to number.
 */
import type { RowProvider } from '../blockHandleMenu'
import { childListState, nearestListItem, toggleNumberedChildren } from './numberChildren'

export const numberChildrenRow: RowProvider = (view, target, ctx) => {
  if (target.inside < 0 || nearestListItem(view.state.doc, target.inside) === null) return []
  const s = childListState(view.state.doc, target.inside)
  return [
    {
      label: s === 'ordered' ? 'Bullet children' : 'Number children',
      disabled: s === null,
      run: () => {
        const tr = toggleNumberedChildren(view.state, target.inside, ctx)
        if (tr !== null) {
          view.dispatch(tr)
          view.focus()
        }
      },
    },
  ]
}
