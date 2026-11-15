import type { ViewDef } from '../viewSchema'
import { canonicalKey } from './keys'

/**
 * A column's alignment in a table view (YAZ-3746 13Y): `view.columnAlign[<canonical key>]`, `left`, `center` or
 * `right`. No entry = Auto, today's look: a number cell right-aligned (`view-table__cell--num`), everything else left.
 * Stored beside `columnWrap` (per view, per column, the same `Mutate` door), pruned by Delete column, copied by
 * Duplicate view, cleared by ⌘\ on whole columns. `columnAlignOf` is the ONE reader and `setColumnAlign` the ONE writer:
 * the header menu's Text › Align items, the column editor's Align row and the table's cells all go through them.
 */

export const COLUMN_ALIGNS = ['left', 'center', 'right'] as const

export type ColumnAlign = (typeof COLUMN_ALIGNS)[number]

const isAlign = (v: unknown): v is ColumnAlign => typeof v === 'string' && (COLUMN_ALIGNS as readonly string[]).includes(v)

/** The column's chosen alignment under its key in any spelling, or null for Auto; a value that is not one of the three reads as Auto. */
export function columnAlignOf(view: ViewDef, key: string): ColumnAlign | null {
  const c = canonicalKey(key)
  const entries = view.columnAlign
  if (entries === undefined || entries === null || typeof entries !== 'object') return null
  const found = Object.entries(entries).find(([k, v]) => isAlign(v) && canonicalKey(k) === c)
  return found === undefined ? null : (found[1] as ColumnAlign)
}

/** Writes the column's alignment: `null` (Auto) removes its entry in any spelling, and an emptied map deletes itself. */
export function setColumnAlign(view: ViewDef, key: string, align: ColumnAlign | null): void {
  const c = canonicalKey(key)
  const next = Object.fromEntries(Object.entries(view.columnAlign ?? {}).filter(([k]) => canonicalKey(k) !== c))
  if (align !== null) next[c] = align
  if (Object.keys(next).length) view.columnAlign = next
  else delete view.columnAlign
}

/** The cell class a column's alignment paints (views.css, 13Y); undefined for Auto. */
export const alignClass = (align: ColumnAlign | null): string | undefined => (align === null ? undefined : `view-table__cell--align-${align}`)
