/**
 * The folder table's selection (YAZ-4593, S27 / S28): a cell range, whole rows (the `#` gutter) or whole columns (⇧-click
 * on a header). It is the product of a set of data row indices and a set of column indices; null means every one. The
 * indices are the `data-cell` ones. The table keeps a selection in a ref and marks the mounted cells on the DOM, so a
 * change of selection renders nothing (`TableView`).
 */
import type { EditorKind } from '../editorType'

export interface TableSelection {
  /** 'rows' and 'cols' are whole lines: the menu offers Duplicate and Delete for rows only. */
  kind: 'cells' | 'rows' | 'cols'
  /** null: every data row. */
  rows: ReadonlySet<number> | null
  /** null: every column. */
  cols: ReadonlySet<number> | null
  /** Where ⇧ extends from: a cell for a range, a row for rows (`c` -1), a column for columns (`r` -1). */
  anchor: { r: number; c: number }
}

const span = (a: number, b: number): Set<number> => {
  const out = new Set<number>()
  for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.add(i)
  return out
}

/** The range from `a` to `b`; null for one cell, which is the focused cell and no selection. */
export function cellRange(a: { r: number; c: number }, b: { r: number; c: number }): TableSelection | null {
  if (a.r === b.r && a.c === b.c) return null
  return { kind: 'cells', rows: span(a.r, b.r), cols: span(a.c, b.c), anchor: a }
}

export type Pick = 'plain' | 'shift' | 'meta'

/**
 * A click on a row's `#` (`line` 'rows') or a ⇧ / ⌘ click on a header (`line` 'cols'): plain picks that one line, ⇧
 * extends from the anchor, ⌘ adds or removes one line. The last line removed leaves no selection.
 */
export function pickLine(sel: TableSelection | null, line: 'rows' | 'cols', at: number, how: Pick): TableSelection | null {
  const same = sel !== null && sel.kind === line
  const anchor = same ? (line === 'rows' ? sel.anchor.r : sel.anchor.c) : at
  let set: Set<number>
  if (how === 'shift' && same) set = span(anchor, at)
  else if (how === 'meta' && same) {
    set = new Set(line === 'rows' ? sel.rows : sel.cols)
    if (set.has(at)) set.delete(at)
    else set.add(at)
    if (set.size === 0) return null
  } else set = new Set([at])
  const keep = how === 'shift' && same ? anchor : at
  return line === 'rows' ? { kind: 'rows', rows: set, cols: null, anchor: { r: keep, c: -1 } } : { kind: 'cols', rows: null, cols: set, anchor: { r: -1, c: keep } }
}

export const inSelection = (sel: TableSelection, r: number, c: number): boolean => (sel.rows === null || sel.rows.has(r)) && (sel.cols === null || sel.cols.has(c))

/** A set as a sorted list, null as `0..count-1`; indices past `count` drop (rows that are gone). */
export function indicesOf(set: ReadonlySet<number> | null, count: number): number[] {
  if (set === null) return Array.from({ length: count }, (_, i) => i)
  return [...set].filter((i) => i < count).sort((a, b) => a - b)
}

/** Tab-separated text: a tab or a line break inside a cell becomes a space, so the grid stays a grid. */
export const toTsv = (grid: readonly (readonly string[])[]): string => grid.map((line) => line.map((cell) => cell.replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n')

/** Tab-separated text as lines of cells; the final line break of a copy from a spreadsheet adds no line. */
export function parseTsv(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines.map((line) => line.split('\t'))
}

const TRUE = /^(true|yes|y|x|1|checked|✓|☑)$/i
const FALSE = /^(false|no|n|0|unchecked)$/i

/**
 * A pasted or typed text as a value of a cell of `kind`, or undefined when it is not one (a word in a number cell):
 * that cell is skipped. Empty text is null, the empty value. A list kind splits on commas, as a list cell shows them.
 */
export function valueFromText(text: string, kind: EditorKind): unknown {
  const t = text.trim()
  if (t === '') return null
  switch (kind) {
    case 'number': {
      const n = Number(t.replace(/,/g, ''))
      return Number.isFinite(n) ? n : undefined
    }
    case 'checkbox':
      return TRUE.test(t) ? true : FALSE.test(t) ? false : undefined
    case 'list':
    case 'multi-select':
    case 'multi-link':
      return t
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== '')
    default:
      return t
  }
}
