import { cellAddress, parseTableComment, validMerges, type TableStyle } from '@client/editor/table/tableComment'
import { stickyHeaderOf, type PhoneTableLook } from './tableLook'

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
 *    freezes columns: then they replace the phone's own "first column sticky" rule);
 *  - the table's look (YAZ-5482): see `applyTableFile`.
 */

/**
 * THE MAC'S RULES (`tableFreeze.ts`, `frozenRowCount`, YAZ-3769, YAZ-4899 round 2):
 *  - rows: the table's own `freeze N rows` wins; else one row (the header row) when the header is sticky: the table's
 *    own `stickyheader` / `nostickyheader`, else Settings › Tables › Sticky header row, which is ON by default
 *    (`shared/types.ts`: `tableStickyHeader: true`). The phone has no such setting: the Mac's default.
 *  - columns: the table's own `freeze N cols`; none by default.
 *  - both stay inside the table (`ownCounts`, clamped on load): never more rows than the table has, nor more columns.
 */
export function freezeOf(style: TableStyle | null, rows: number, cols: number, stickyDefault = STICKY_HEADER_DEFAULT): { rows: number; cols: number } {
  const own = style?.freeze ?? { rows: 0, cols: 0 }
  // YAZ-5487: the vault's Sticky header row (`table-look.json`, `tableLook.ts`), else the Mac's default.
  const sticky = style?.stickyHeader ?? stickyDefault
  const r = own.rows > 0 ? own.rows : sticky ? 1 : 0
  return { rows: Math.max(0, Math.min(r, rows)), cols: Math.max(0, Math.min(own.cols, cols)) }
}

/** Settings › Tables › Sticky header row: the Mac's default (`DEFAULT_SETTINGS.tableStickyHeader`). */
export const STICKY_HEADER_DEFAULT = true

/** The settings of a table comment, or `null` when the text is no table comment (the Mac's parser). */
export const readTableComment = (text: string): TableStyle | null => parseTableComment(text.trim())

/** The table's grid as the file writes it (GFM: every row has every cell; before the merges are drawn). */
function gridOf(table: HTMLTableElement): { rows: number; cols: number } {
  let cols = 0
  for (const row of table.rows) cols = Math.max(cols, [...row.cells].reduce((n, c) => n + Math.max(1, c.colSpan), 0))
  return { rows: table.rows.length, cols }
}

/** The page's background in each theme (`styles.css` `--bg`): a custom text colour is made readable on them. */
export const PAGE_BG = { light: '#ffffff', dark: '#1e1e1e' } as const
/** The least contrast of a custom text colour on the page (WCAG AA for text). */
export const INK_CONTRAST = 4.5

const rgbOf = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
const hexOf = (rgb: number[]): string => `#${rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`
const luminance = (hex: string): number => {
  const [r, g, b] = rgbOf(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
/** The WCAG contrast of two `#rrggbb` colours. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * A custom text colour (`#rrggbb`), readable on `bg` (YAZ-5482): the colour itself when it reaches `INK_CONTRAST`, else
 * the nearest mix of it toward black (on a light page) or white (on a dark one) that does. The Mac shows a custom text
 * colour as picked in both themes; on the phone a dark ink in dark mode (or a pale one in light) would not be read.
 */
export function readableInk(hex: string, bg: string): string {
  if (contrast(hex, bg) >= INK_CONTRAST) return hex
  const toward = luminance(bg) > 0.5 ? [0, 0, 0] : [255, 255, 255]
  const from = rgbOf(hex)
  for (let t = 0.05; t < 1; t += 0.05) {
    const mixed = hexOf(from.map((v, i) => v + (toward[i]! - v) * t))
    if (contrast(mixed, bg) >= INK_CONTRAST) return mixed
  }
  return hexOf(toward)
}

/** The phone's thickest table line: a Mac border of 3 px and more is 2 on a phone. */
export const BORDER_PX_PHONE = 2

/**
 * The table's marks from its comment's body (`table: freeze 2 rows 1 col`, the comment without `<!--` and `-->`). A
 * body that is no table comment changes nothing. YAZ-5480: the frozen rows and columns. YAZ-5482: what the comment says
 * of the table's look, translated for a phone (`tables.css` draws it; `tableLayout.ts` sizes the columns):
 *  - `widths`: the Mac's column widths, as `data-widths`; `tableLayout.ts` takes them as proportions and minimums;
 *  - `fill` and `color`: each cell's `data-fill` and `data-color`, the Mac's ten names (light and dark shades, as the
 *    Mac's `table.css`) or a custom colour: a fill as the Mac's wash, a text colour made readable in each theme
 *    (`readableInk`);
 *  - `align` and `valign`: each cell's own alignment (it wins over its column's); the table's vertical alignment;
 *  - `merge`: the merged cells, drawn with `colspan` and `rowspan` (the Mac's `validMerges`; the file's grid stays);
 *  - `header`: the header row's own colour, strength (`plain` is off), weight, text colour and alignment;
 *  - `stripes`, `border` (at most `BORDER_PX_PHONE`), `height`, `nowrap` / `wrap` and each column's `text`.
 */
export function applyTableFile(table: HTMLTableElement, body: string, look: PhoneTableLook | null = null): TableStyle | null {
  const style = readTableComment(`<!-- ${body} -->`)
  if (style === null) return null
  // YAZ-5487: its freeze and Clip are decided here, with the vault's defaults (`applyTableLook` leaves them).
  table.setAttribute('data-table-look-own', '')
  const grid = gridOf(table)
  const { rows, cols } = freezeOf(style, grid.rows, grid.cols, stickyHeaderOf(look))
  table.setAttribute('data-freeze-rows', String(rows))
  if (cols > 0) table.setAttribute('data-freeze-cols', String(cols))
  // YAZ-5493: a calendar table (`calendar 15m | 30m | 60m`): its slot length, `nonow` (no Now button) and the rows it
  // never dims (`nodim`, the rows' indexes with the header row as 0, the Mac's). `tableCalendar.ts` draws now from them.
  if (style.calendar) {
    table.setAttribute('data-calendar', String(style.calendar))
    if (style.nonow) table.setAttribute('data-nonow', '')
    for (const r of style.nodim ?? []) table.rows[r]?.setAttribute('data-nodim', '')
  }

  if (style.widths.some((w) => w !== null)) table.setAttribute('data-widths', style.widths.map((w) => w ?? 'auto').join(' '))
  if (style.stripes) table.setAttribute('data-stripes', '')
  if (style.height !== undefined) table.setAttribute('data-height', style.height)
  if (style.valignTable !== undefined) table.setAttribute('data-valign', style.valignTable)
  if (style.border !== undefined) {
    table.setAttribute('data-border', '')
    table.style.setProperty('--table-border-px', `${Math.min(BORDER_PX_PHONE, style.border.px)}px`)
    table.style.setProperty('--table-border-dark', `${style.border.darkness}%`)
  }
  for (const [part, value] of Object.entries(style.header ?? {})) if (typeof value === 'string') table.setAttribute(`data-header-${part}`, value)

  // Each cell by its A1 address, in the file's grid (before the merges).
  const cells = new Map<string, HTMLTableCellElement>()
  ;[...table.rows].forEach((row, r) => [...row.cells].forEach((cell, c) => cells.set(cellAddress(r, c), cell)))
  for (const [address, fill] of style.fill) {
    const cell = cells.get(address)
    if (cell === undefined) continue
    cell.setAttribute('data-fill', fill)
    if (fill.startsWith('#')) cell.style.setProperty('--table-fill-custom', fill)
  }
  for (const [address, color] of style.color) {
    const cell = cells.get(address)
    if (cell === undefined) continue
    cell.setAttribute('data-color', color)
    if (color.startsWith('#')) {
      cell.style.setProperty('--cell-ink-light', readableInk(color, PAGE_BG.light))
      cell.style.setProperty('--cell-ink-dark', readableInk(color, PAGE_BG.dark))
    }
  }
  for (const [address, align] of style.align) cells.get(address)?.style.setProperty('text-align', align)
  for (const [address, valign] of style.valign) cells.get(address)?.style.setProperty('vertical-align', valign)

  // Text in cells (YAZ-4900): each column's own, else the table's Clip or Wrap, else the vault's (YAZ-5487), else Wrap, as the Mac's.
  const clip = (c: number) => (style.text?.get(c) ?? (style.nowrap ? 'clip' : style.wrap ? 'wrap' : (look?.tableTextInCells ?? 'wrap'))) === 'clip'
  for (const row of table.rows) [...row.cells].forEach((cell, c) => clip(c) && cell.setAttribute('data-clip', ''))

  // Merged cells: the top-left cell spans the range; the cells it covers (empty in the file) go.
  for (const { top, left, bottom, right } of validMerges(style.merge ?? [], grid.cols, grid.rows)) {
    const first = cells.get(cellAddress(top, left))
    if (first === undefined) continue
    if (right - left > 1) first.colSpan = right - left
    if (bottom - top > 1) first.rowSpan = bottom - top
    first.setAttribute('data-merged', '')
    for (let r = top; r < bottom; r++) for (let c = left; c < right; c++) if (r !== top || c !== left) cells.get(cellAddress(r, c))?.remove()
  }
  return style
}
