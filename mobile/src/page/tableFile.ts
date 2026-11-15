import { parseTableComment, type TableStyle } from '@client/editor/table/tableComment'

/**
 * THE TABLE'S OWN SETTINGS, FROM THE FILE (YAZ-5480). The Mac keeps each table's settings in the file, in the comment
 * right after the table (`<!-- table: … freeze 2 rows 1 col … -->`), and reads it with ONE parser,
 * `client/src/editor/table/tableComment.ts` (no editor imports; the line-number worker reads it too). The phone reads
 * it with the same parser: this file is in the reader's lazy chunk (`pageRender.ts` imports it), never in the first
 * load.
 *
 * The page renderer finds the comment after each table (`commentAfter`), puts its text on the table as a mark, and,
 * after the clean, `applyTableFile` turns it into the table's marks, which `tableLayout.ts` and `tables.css` read:
 *  - `data-freeze-rows`: the rows that stay at the top while the page scrolls down through the table;
 *  - `data-freeze-cols`: the columns that stay at the left while the table scrolls sideways (only when the file
 *    freezes columns: then they replace the phone's own "first column sticky" rule).
 */

/**
 * THE MAC'S RULES (`tableFreeze.ts`, `frozenRowCount`, YAZ-3769, YAZ-4899 round 2):
 *  - rows: the table's own `freeze N rows` wins; else one row (the header row) when the header is sticky: the table's
 *    own `stickyheader` / `nostickyheader`, else Settings › Tables › Sticky header row, which is ON by default
 *    (`shared/types.ts`: `tableStickyHeader: true`). The phone has no such setting: the Mac's default.
 *  - columns: the table's own `freeze N cols`; none by default.
 *  - both stay inside the table (`ownCounts`, clamped on load): never more rows than the table has, nor more columns.
 */
export function freezeOf(style: TableStyle | null, rows: number, cols: number): { rows: number; cols: number } {
  const own = style?.freeze ?? { rows: 0, cols: 0 }
  const sticky = style?.stickyHeader ?? STICKY_HEADER_DEFAULT
  const r = own.rows > 0 ? own.rows : sticky ? 1 : 0
  return { rows: Math.max(0, Math.min(r, rows)), cols: Math.max(0, Math.min(own.cols, cols)) }
}

/** Settings › Tables › Sticky header row: the Mac's default (`DEFAULT_SETTINGS.tableStickyHeader`). */
export const STICKY_HEADER_DEFAULT = true

/** The settings of a table comment, or `null` when the text is no table comment (the Mac's parser). */
export const readTableComment = (text: string): TableStyle | null => parseTableComment(text.trim())

/** The table's grid: its rows, and its columns (the widest row, a cell's `colspan` counted). */
function gridOf(table: HTMLTableElement): { rows: number; cols: number } {
  let cols = 0
  for (const row of table.rows) cols = Math.max(cols, [...row.cells].reduce((n, c) => n + Math.max(1, c.colSpan), 0))
  return { rows: table.rows.length, cols }
}

/**
 * The table's marks from its comment's body (`table: freeze 2 rows 1 col`, the comment without `<!--` and `-->`): its
 * frozen rows and columns. A body that is no table comment changes nothing.
 */
export function applyTableFile(table: HTMLTableElement, body: string): TableStyle | null {
  const style = readTableComment(`<!-- ${body} -->`)
  if (style === null) return null
  const grid = gridOf(table)
  const { rows, cols } = freezeOf(style, grid.rows, grid.cols)
  table.setAttribute('data-freeze-rows', String(rows))
  if (cols > 0) table.setAttribute('data-freeze-cols', String(cols))
  return style
}
