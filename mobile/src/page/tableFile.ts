import { parseTableComment, type TableStyle } from '@client/editor/table/tableComment'
import { applyTableMarks, gridOf } from '@client/editor/table/tableMarks'
import { stickyHeaderOf, type PhoneTableLook } from './tableLook'

// YAZ-5867: the look's reader is shared with a card's table (`tableMarks.ts`); the phone's tests read them from here.
export { INK_CONTRAST, PAGE_BG, contrast, readableInk } from '@client/editor/table/tableMarks'

/**
 * THE TABLE'S OWN SETTINGS, FROM THE FILE. The Mac keeps each table's settings in the file, in the comment
 * right after the table (`<!-- table: … freeze 2 rows 1 col … -->`), and reads it with ONE parser,
 * `client/src/editor/table/tableComment.ts` (no editor imports; the line-number worker reads it too). The phone reads
 * it with the same parser: this file is in the reader's lazy chunk (`pageRender.ts` imports it), never in the first
 * load.
 *
 * The page renderer finds the comment after each table (`commentAfter`), puts its text on the table as a mark, and,
 * after the clean, `applyTableFile` turns it into the table's marks, which `tableLayout.ts` and `tables.css` read:
 *  - `data-freeze-rows`: the rows that stay at the top while the page scrolls down through the table;
 *  - `data-freeze-cols`: the columns that stay at the left while the table scrolls sideways (only when the file
 *    freezes columns: then they replace the phone's own "first column sticky" rule);
 *  - the table's look: see `applyTableFile`.
 */

/**
 * THE MAC'S RULES (`tableFreeze.ts`, `frozenRowCount`):
 *  - rows: the table's own `freeze N rows` wins; else one row (the header row) when the header is sticky: the table's
 *    own `stickyheader` / `nostickyheader`, else Settings › Tables › Sticky header row, which is ON by default
 *    (`shared/types.ts`: `tableStickyHeader: true`). The phone has no such setting: the Mac's default.
 *  - columns: the table's own `freeze N cols`; none by default.
 *  - both stay inside the table (`ownCounts`, clamped on load): never more rows than the table has, nor more columns.
 */
export function freezeOf(style: TableStyle | null, rows: number, cols: number, stickyDefault = STICKY_HEADER_DEFAULT): { rows: number; cols: number } {
  const own = style?.freeze ?? { rows: 0, cols: 0 }
  // The vault's Sticky header row (`table-look.json`, `tableLook.ts`), else the Mac's default.
  const sticky = style?.stickyHeader ?? stickyDefault
  const r = own.rows > 0 ? own.rows : sticky ? 1 : 0
  return { rows: Math.max(0, Math.min(r, rows)), cols: Math.max(0, Math.min(own.cols, cols)) }
}

/** Settings › Tables › Sticky header row: the Mac's default (`DEFAULT_SETTINGS.tableStickyHeader`). */
export const STICKY_HEADER_DEFAULT = true

/** The settings of a table comment, or `null` when the text is no table comment (the Mac's parser). */
export const readTableComment = (text: string): TableStyle | null => parseTableComment(text.trim())

/** The phone's thickest table line: a Mac border of 3 px and more is 2 on a phone. */
export const BORDER_PX_PHONE = 2

/**
 * The table's marks from its comment's body (`table: freeze 2 rows 1 col`, the comment without `<!--` and `-->`). A
 * body that is no table comment changes nothing. YAZ-5480: the frozen rows and columns. YAZ-5482: what the comment says
 * of the table's look, translated for a phone (`tables.css` draws it; `tableLayout.ts` sizes the columns):
 *  - `widths`: the Mac's column widths, as `data-widths` and `data-desk`; `tableLayout.ts` draws them as is (Same as
 *    Desktop) or leaves them (Fit Screen);
 *  - `fill` and `color`: each cell's `data-fill` and `data-color`, the Mac's ten names (light and dark shades, as the
 *    Mac's `table.css`) or a custom colour: a fill as the Mac's wash, a text colour made readable in each theme
 *    (`readableInk`);
 *  - `align` and `valign`: each cell's own alignment (it wins over its column's); the table's vertical alignment;
 *  - `merge`: the merged cells, drawn with `colspan` and `rowspan` (the Mac's `validMerges`; the file's grid stays);
 *  - `header`: the header row's own colour, strength (`plain` is off), weight, text colour and alignment;
 *  - `stripes`, `border` (at most `BORDER_PX_PHONE`), `height`, `nowrap` / `wrap` and each column's `text`;
 *  - YAZ-5567: `subhead`, `subheader` and `stickysubheads` / `nostickysubheads` (`applySubheads`).
 * YAZ-5867: everything but the freeze, the calendar and the widths is `applyTableMarks` (`tableMarks.ts`), the reader a
 * card's table shares.
 */
export function applyTableFile(table: HTMLTableElement, body: string, look: PhoneTableLook | null = null): TableStyle | null {
  const style = readTableComment(`<!-- ${body} -->`)
  if (style === null) return null
  // Its freeze and Clip are decided here, with the vault's defaults (`applyTableLook` leaves them).
  table.setAttribute('data-table-look-own', '')
  const grid = gridOf(table)
  const { rows, cols } = freezeOf(style, grid.rows, grid.cols, stickyHeaderOf(look))
  table.setAttribute('data-freeze-rows', String(rows))
  if (cols > 0) table.setAttribute('data-freeze-cols', String(cols))
  // A calendar table (`calendar 15m | 30m | 60m`): its slot length, `nonow` (no Now button) and the rows it
  // never dims (`nodim`, the rows' indexes with the header row as 0, the Mac's). `tableCalendar.ts` draws now from them.
  if (style.calendar) {
    table.setAttribute('data-calendar', String(style.calendar))
    if (style.nonow) table.setAttribute('data-nonow', '')
    for (const r of style.nodim ?? []) table.rows[r]?.setAttribute('data-nodim', '')
  }

  if (style.widths.some((w) => w !== null)) {
    table.setAttribute('data-widths', style.widths.map((w) => w ?? 'auto').join(' '))
    // YAZ-5658: Same as Desktop draws these widths as is (`deskWidths`).
    table.setAttribute('data-desk', '')
  }
  // The look (YAZ-5867: the one reader a card's table uses too), the phone's border at most `BORDER_PX_PHONE`.
  applyTableMarks(table, style, { textInCells: look?.tableTextInCells ?? 'wrap', borderMaxPx: BORDER_PX_PHONE })
  return style
}
