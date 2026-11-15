import type { TableStyle } from '@client/editor/table/tableComment'

/**
 * SUBHEADER ROWS ON THE PHONE (YAZ-5567), the Mac's `tableSubhead.ts` (YAZ-4899): a body row made a section's title.
 * The Mac keeps them in the table's comment (`subhead 5 12`: the rows, 0-based with the header row as 0, never 0), with
 * the table's own look (`subheader <words>`, the header row's words) and its own sticky choice (`stickysubheads` /
 * `nostickysubheads`); the phone reads that comment with the Mac's parser (`tableFile.ts`). A table with none of its own
 * look takes the vault's (`table-look.json` › `look.subheaderRow`, `stickySubheaders`: `tableLook.ts`), else the Mac's
 * defaults (grey, medium, bold, full text, sticky), which `tables.css` holds as its fallbacks.
 *
 * The marks, as the Mac's decorations: the table `data-subheads`, each subheader row `table-subhead-row` and its cells
 * `data-subhead`; the stripes start again after each subheader row (the second, fourth… row of each section, and of
 * the rows above the first, `data-stripe`). The look's parts are `data-subheader-*` on the table, its sticky choice
 * `data-sticky-subheaders`. The pinning (a sticky subheader row moves down under the frozen rows while its section is at
 * the top, the next one pushes it up) is `useTables.ts`' (`measureFreeze`) and `tables.css`'. Collapsing a section is
 * folding (YAZ-5568): the phone shows every row.
 */
export function applySubheads(table: HTMLTableElement, style: TableStyle): void {
  const rows = [...table.rows]
  const subheads = [...new Set(style.subhead ?? [])].filter((r) => r > 0 && r < rows.length).sort((a, b) => a - b)
  for (const [part, value] of Object.entries(style.subheader ?? {})) if (typeof value === 'string') table.setAttribute(`data-subheader-${part}`, value)
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
