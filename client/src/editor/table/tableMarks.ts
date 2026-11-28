import { cellAddress, validMerges, type TableStyle } from './tableComment'

/**
 * THE TABLE'S LOOK FROM ITS COMMENT, AS MARKS ON A READ TABLE (YAZ-5482, YAZ-5567; one reader since YAZ-5867). A table
 * outside the editor has no decorations: its look is the comment after it (`<!-- table: … -->`, `tableComment.ts`),
 * turned into attributes and custom properties here. Two hosts use it:
 *  - the phone's page (`mobile/src/page/tableFile.ts`, `applyTableFile`), which adds its own freeze, calendar and
 *    widths, and whose `tables.css` draws the marks;
 *  - a card's read table (`card/cardRender.ts`, the Mac and the phone), which `card.css` draws (inside `.card__table`).
 * No editor and no phone imports: it rides in the card's chunk and the phone page's chunk alike.
 *
 * The marks:
 *  - the table: `data-stripes`, `data-height`, `data-valign`, `data-border` (with `--table-border-px` and
 *    `--table-border-dark`), `data-header-*` (the header row's own parts), the subheader rows (`applySubheads`);
 *  - each cell, by its A1 address in the file's grid: `data-fill` (a custom one with `--table-fill-custom`),
 *    `data-color` (a custom one with `--cell-ink-light` and `--cell-ink-dark`, made readable by `readableInk`), its own
 *    `text-align` and `vertical-align` (inline, so they win over the column's and the table's), `data-clip`;
 *  - the merged cells: `colspan` and `rowspan` on the top-left cell (`data-merged`); the cells it covers go.
 * Every value comes from the parser (names it checked, numbers, `#rrggbb`), so a host sets them after its sanitiser.
 */

/** The page's background in each theme (`app.css`, the phone's `styles.css` `--bg`): a custom text colour is made readable on them. */
export const PAGE_BG = { light: '#ffffff', dark: '#1e1e1e' } as const
/** The least contrast of a custom text colour on the page (WCAG AA for text). */
export const INK_CONTRAST = 4.5

const rgbOf = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
const hexOf = (rgb: number[]): string => `#${rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`
const alphaOf = (hex: string): number => (hex.length === 9 ? parseInt(hex.slice(7, 9), 16) / 255 : 1)
const luminance = (hex: string): number => {
  const [r, g, b] = rgbOf(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * Auto-contrast tone for a custom hex cell fill (`#rrggbb` or `#rrggbbaa`, YAZ-6692 D9):
 * dark solid fills (alpha >= 0.5, relative luminance < 0.35) → `'dark'` (`#ffffff` text);
 * light solid fills (alpha >= 0.5, relative luminance >= 0.35) → `'light'` (`#111111` text);
 * translucent fills (alpha < 0.5) or invalid strings → `null` (keep page default text color).
 */
export function fillTone(hex: string): 'dark' | 'light' | null {
  if (!/^#([0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex)) return null
  if (alphaOf(hex) < 0.5) return null
  return luminance(hex) < 0.35 ? 'dark' : 'light'
}

/** Composite `#rrggbb` or `#rrggbbaa` over an opaque `#rrggbb` background. */
export function compositeOver(hex: string, bg: string): string {
  const a = alphaOf(hex)
  if (a >= 1) return hex.slice(0, 7)
  const fg = rgbOf(hex)
  const back = rgbOf(bg)
  return hexOf(fg.map((v, i) => v * a + back[i]! * (1 - a)))
}

/** The WCAG contrast of two `#rrggbb` colours. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * A custom text colour (`#rrggbb`), readable on `bg`: the colour itself when it reaches `INK_CONTRAST`, else
 * the nearest mix of it toward black (on a light page) or white (on a dark one) that does. The Mac's page shows a custom
 * text colour as picked in both themes; out of the editor a dark ink in dark mode (or a pale one in light) would not be read.
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

/** The table's grid as the file writes it (GFM: every row has every cell; before the merges are drawn). */
export function gridOf(table: HTMLTableElement): { rows: number; cols: number } {
  let cols = 0
  for (const row of table.rows) cols = Math.max(cols, [...row.cells].reduce((n, c) => n + Math.max(1, c.colSpan), 0))
  return { rows: table.rows.length, cols }
}

/**
 * SUBHEADER ROWS (YAZ-5567), the Mac's `tableSubhead.ts` (YAZ-4899): a body row made a section's title. The Mac keeps
 * them in the table's comment (`subhead 5 12`: the rows, 0-based with the header row as 0, never 0), with the table's
 * own look (`subheader <words>`, the header row's words) and its own sticky choice (`stickysubheads` /
 * `nostickysubheads`). A table with none of its own look takes the vault's on the phone (`tableLook.ts`), Settings' on
 * the Mac, else the Mac's defaults (grey, medium, bold, full text, sticky), which the CSS holds as its fallbacks.
 *
 * The marks, as the Mac's decorations: the table `data-subheads`, each subheader row `table-subhead-row` and its cells
 * `data-subhead`; the stripes start again after each subheader row (the second, fourth… row of each section, and of
 * the rows above the first, `data-stripe`). The look's parts are `data-subheader-*` on the table, its sticky choice
 * `data-sticky-subheaders`. The phone's page pins a sticky one (`useTables.ts`); a card does not. Every row shows.
 */
export function applySubheads(table: HTMLTableElement, style: TableStyle): void {
  const rows = [...table.rows]
  const subheads = [...new Set(style.subhead ?? [])].filter((r) => r > 0 && r < rows.length).sort((a, b) => a - b)
  for (const [part, value] of Object.entries(style.subheader ?? {})) {
    if (typeof value !== 'string') continue
    table.setAttribute(`data-subheader-${part}`, value)
    if (part === 'color' && value.startsWith('#')) table.style.setProperty('--table-subheader-hue', value)
    if (part === 'text' && value.startsWith('#')) table.style.setProperty('--table-subheader-ink', value)
  }
  if (style.sticky !== undefined) table.setAttribute('data-sticky-subheaders', style.sticky ? 'on' : 'off')
  if (subheads.length === 0) return
  table.setAttribute('data-subheads', '')
  for (const r of subheads) {
    rows[r]!.classList.add('table-subhead-row')
    for (const cell of rows[r]!.cells) cell.setAttribute('data-subhead', '')
  }
  // The stripes of each section: the rows above the first subheader row are one too (the Mac's `stripe`).
  const stripe = (from: number, to: number) => {
    for (let r = from + 1; r <= to; r += 2) rows[r]?.setAttribute('data-stripe', '')
  }
  stripe(1, subheads[0]! - 1)
  subheads.forEach((row, i) => stripe(row + 1, (subheads[i + 1] ?? rows.length) - 1))
}

export interface TableMarksOptions {
  /** Text in cells when neither the column nor the table says: the vault's on the phone; Wrap by default (the Mac's). */
  textInCells?: 'wrap' | 'clip'
  /** The thickest border line, px (the phone's page: 2). Absent: as saved. */
  borderMaxPx?: number
}

/** The look part of `style` as marks on `table` (see the header). The table is the file's grid: no merge drawn yet. */
export function applyTableMarks(table: HTMLTableElement, style: TableStyle, options: TableMarksOptions = {}): void {
  const grid = gridOf(table)
  if (style.stripes) table.setAttribute('data-stripes', '')
  if (style.height !== undefined) table.setAttribute('data-height', style.height)
  if (style.valignTable !== undefined) table.setAttribute('data-valign', style.valignTable)
  if (style.border !== undefined) {
    table.setAttribute('data-border', '')
    table.style.setProperty('--table-border-px', `${Math.min(options.borderMaxPx ?? Number.POSITIVE_INFINITY, style.border.px)}px`)
    table.style.setProperty('--table-border-dark', `${style.border.darkness}%`)
  }
  for (const [part, value] of Object.entries(style.header ?? {})) {
    if (typeof value !== 'string') continue
    table.setAttribute(`data-header-${part}`, value)
    if (part === 'color' && value.startsWith('#')) table.style.setProperty('--table-header-hue', value)
    if (part === 'text' && value.startsWith('#')) table.style.setProperty('--table-header-ink', value)
  }
  applySubheads(table, style)

  // Each cell by its A1 address, in the file's grid (before the merges).
  const cells = new Map<string, HTMLTableCellElement>()
  ;[...table.rows].forEach((row, r) => [...row.cells].forEach((cell, c) => cells.set(cellAddress(r, c), cell)))
  for (const [address, fill] of style.fill) {
    const cell = cells.get(address)
    if (cell === undefined) continue
    cell.setAttribute('data-fill', fill)
    if (fill.startsWith('#')) {
      cell.style.setProperty('--table-fill-custom', fill)
      if (!style.color.has(address)) {
        const tone = fillTone(fill)
        if (tone !== null) cell.setAttribute('data-fill-tone', tone)
      }
    }
  }
  for (const [address, color] of style.color) {
    const cell = cells.get(address)
    if (cell === undefined) continue
    cell.setAttribute('data-color', color)
    if (color.startsWith('#')) {
      const fill = style.fill.get(address)
      const solidFill = fill !== undefined && fill.startsWith('#') && alphaOf(fill) >= 0.5 ? fill : null
      const lightBg = solidFill !== null ? compositeOver(solidFill, PAGE_BG.light) : PAGE_BG.light
      const darkBg = solidFill !== null ? compositeOver(solidFill, PAGE_BG.dark) : PAGE_BG.dark
      cell.style.setProperty('--cell-ink-light', readableInk(color.slice(0, 7), lightBg))
      cell.style.setProperty('--cell-ink-dark', readableInk(color.slice(0, 7), darkBg))
    }
  }
  for (const [address, align] of style.align) cells.get(address)?.style.setProperty('text-align', align)
  for (const [address, valign] of style.valign) cells.get(address)?.style.setProperty('vertical-align', valign)

  // Text in cells: each column's own, else the table's Clip or Wrap, else the host's default, else Wrap, as the Mac's.
  const clip = (c: number) => (style.text?.get(c) ?? (style.nowrap ? 'clip' : style.wrap ? 'wrap' : (options.textInCells ?? 'wrap'))) === 'clip'
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
}
