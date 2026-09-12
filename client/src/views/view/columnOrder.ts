import type { ViewSet } from '../viewSchema'
import { frozenColumnCount } from './frozenColumns'

/**
 * Write one view's `order` and keep `frozenColumns` following POSITIONALLY (YAZ-1007): the frozen
 * prefix is a count over the shown columns, so a hide inside it clamps the count and an empty order
 * deletes the key. The one rule every order edit goes through — the Properties menu's checklist,
 * reorder and bulk buttons, and the table header's "Hide column" (YAZ-1513) alike.
 */
export function setViewOrder(d: ViewSet, viewIndex: number, order: string[]): void {
  const next = d.views[viewIndex]
  next.order = order
  if (next.frozenColumns !== undefined) {
    const count = frozenColumnCount(next.frozenColumns, order.length)
    if (count === 0) delete next.frozenColumns
    else next.frozenColumns = count
  }
}
