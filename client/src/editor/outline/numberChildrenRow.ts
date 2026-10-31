/**
 * First row of the block handle menu (YAZ-729): number / un-number the hovered item's direct
 * children. Disabled when the item has no direct child list; the row only dispatches
 * toggleNumberedChildren's transaction and never touches text. No row when the block is not in a
 * list item (YAZ-3696 B3): a table, a line or a heading at the top level has nothing to number.
 */
import type { RowProvider } from '../blockHandleMenu'
import { childListState, nearestListItem, toggleNumberedChildren, writeNumbersAsText } from './numberChildren'

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

/**
 * "Bullets with written numbers" (YAZ-3727 D12), after Number children: on a line of a numbered list, the list becomes
 * bullets with each number written as `n) ` text. No row on any other line.
 */
export const writtenNumbersRow: RowProvider = (view, target, ctx) => {
  if (target.inside < 0 || writeNumbersAsText(view.state, target.inside, ctx) === null) return []
  return [
    {
      label: 'Bullets with written numbers',
      disabled: false,
      run: () => {
        const tr = writeNumbersAsText(view.state, target.inside, ctx)
        if (tr !== null) {
          view.dispatch(tr)
          view.focus()
        }
      },
    },
  ]
}
