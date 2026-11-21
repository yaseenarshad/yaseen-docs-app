import { cellColor } from '../../editor/table/tableComment'
import type { ViewDef } from '../viewSchema'
import { canonicalKey } from './keys'

/**
 * A column's fill in a table view (YAZ-3746 13AQ): `view.columnFill[<canonical key>]`, a table-block colour name
 * (`TABLE_COLORS`) or `#rrggbb`, as a cell or row fill. It paints every body cell of the column, rows added later too;
 * a row's fill and a cell's own fill show over it (cell, then row, then column). Stored beside `columnAlign` (per view,
 * per column), pruned by Delete column, copied by Duplicate view, cleared by ⌘\ on whole columns. `columnFillOf` is the
 * ONE reader and `setColumnFill` the ONE writer.
 */

/** The column's fill under its key in any spelling, or undefined; a value that is no colour reads as none. */
export function columnFillOf(view: ViewDef, key: string): string | undefined {
  const c = canonicalKey(key)
  const entries = view.columnFill
  if (entries === undefined || entries === null || typeof entries !== 'object') return undefined
  for (const [k, v] of Object.entries(entries)) {
    if (canonicalKey(k) !== c) continue
    const fill = cellColor(v)
    if (fill !== null) return fill
  }
  return undefined
}

/** Writes the column's fill: `null` (No fill) removes its entry in any spelling, and an emptied map deletes itself. */
export function setColumnFill(view: ViewDef, key: string, fill: string | null): void {
  const c = canonicalKey(key)
  const next = Object.fromEntries(Object.entries(view.columnFill ?? {}).filter(([k]) => canonicalKey(k) !== c))
  const checked = cellColor(fill)
  if (checked !== null) next[c] = checked
  if (Object.keys(next).length) view.columnFill = next
  else delete view.columnFill
}
