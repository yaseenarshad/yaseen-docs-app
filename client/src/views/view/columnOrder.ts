import type { ViewDef, ViewSet } from '../viewSchema'
import { frozenColumnCount } from './frozenColumns'
import { canonicalKey } from './keys'
import { cardRowsOf } from '../cardRows'

/**
 * THE one order writer (YAZ-1549): a view with `order` replaced, its `frozenColumns` following
 * POSITIONALLY (YAZ-1007) — the frozen prefix is a count over the shown columns, so a shorter order
 * clamps the count and an empty order deletes the key. Pure; the same object comes back when nothing
 * would change. Every place that assigns an order — the Properties checklist, reorder and bulk
 * buttons, "+ Add column", the table header's Hide / Add-to-the-right / drag, and a column delete —
 * spells it through here, so no view can hold an order its frozen prefix disagrees with.
 */
export function withOrder(view: ViewDef, order: string[], field: 'order' | 'cardOrder' = 'order'): ViewDef {
  const next: ViewDef = { ...view, [field]: order }
  if (next.frozenColumns !== undefined) {
    const count = frozenColumnCount(next.frozenColumns, order.length)
    if (count === 0) delete next.frozenColumns
    else next.frozenColumns = count
  }
  return next
}

/** A column the view may hide (YAZ-4544: one rule for the Properties menu and the column editor): Name only in a table or a board. */
export const canHideColumn = (view: ViewDef, key: string): boolean => !(canonicalKey(key) === 'file.name' && view.type !== 'table' && view.type !== 'board')

/**
 * `withOrder` as a `Mutate` body: the def's view at `viewIndex` takes the new order of its SHOWN columns. A view that
 * lists cards (YAZ-5319) writes its own `cardOrder`, so the pages' columns come back as they were.
 */
export function setViewOrder(d: ViewSet, viewIndex: number, order: string[]): void {
  const view = d.views[viewIndex]
  d.views[viewIndex] = withOrder(view, order, cardRowsOf(view) ? 'cardOrder' : 'order')
}
