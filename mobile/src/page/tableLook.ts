import { nextColour } from '@client/editor/table/tableLook'
import { TABLE_LOOK_DEFAULTS, type TableLookSettings } from '@shared/tableLook'
import { calendarLook, type CalendarLook } from './calendarLook'

/**
 * THE VAULT'S TABLE LOOK ON THE PHONE: the Mac's 21 table settings live in the vault's
 * `.yaseendocs/table-look.json` (`shared/tableLook.ts`); the phone reads it with the page's other vault files
 * (`vaultLook.ts`, in the page's chunk: the first load does not grow) and feeds the small functions its tables already
 * read their defaults through:
 *  - Sticky header row (`freezeOf`, `frozenRows`): a table with no freeze of its own freezes its header row unless the
 *    vault says Off;
 *  - Text in cells: a table with no Wrap or Clip of its own, and a column with none, take the vault's;
 *  - Header row: each part a table does not set itself (`data-header-*`, `tables.css`), when the vault's differs from
 *    the Mac's default (so a vault with the default look draws as before);
 *  - Subheader row and Sticky subheaders: as the header row, each part a table does not set itself
 *    (`data-subheader-*`), and Off when the table says nothing (`tableSubheads.ts`, `tables.css`);
 *  - the cell bullets' indent and gap and the Table position: CSS variables on the reader (`tableLookVars`);
 *  - the calendar look (`calendarLook()`): Mark the current time, Shade the next time slot and its colour, Time in
 *    slot and Show seconds (YAZ-5606),
 *    Dim past rows, Shade darkness, Calendar day. The Now
 *    button is a habit of each Mac, so the phone keeps the Mac's default.
 * No file, or a file that is not JSON: null, the Mac's defaults, as before. The phone never writes the file.
 */
export type PhoneTableLook = TableLookSettings

/** The calendar look of a vault's tables (`calendarLook` checks each value again). */
export const tableCalendarLook = (look: PhoneTableLook | null | undefined): CalendarLook =>
  look == null
    ? calendarLook()
    : calendarLook({
        nowMark: look.tableNowMark,
        dimPast: look.tableDimPast,
        shadeDarkness: look.tableShadeDarkness,
        dayStart: look.tableDayStart,
        dayEnd: look.tableDayEnd,
        nextShade: look.tableNextShade,
        // The default (red) is the CSS's own fallback, the now mark's red.
        nextColour: look.tableNextColour === TABLE_LOOK_DEFAULTS.tableNextColour ? null : nextColour(look.tableNextColour),
        // YAZ-5606: Time in slot and Show seconds (`look.slotTime`, `look.slotSeconds`).
        slotTime: look.tableSlotTime,
        slotSeconds: look.tableSlotSeconds,
      })

/** The Sticky header row default of a vault's tables (the Mac's: on). */
export const stickyHeaderOf = (look: PhoneTableLook | null | undefined): boolean => look?.tableStickyHeader ?? TABLE_LOOK_DEFAULTS.tableStickyHeader

/**
 * A table's defaults from the vault, for the parts the table does not set itself: its header row's look and, with no
 * comment, its frozen header row and its cells' Clip. Run before the table is laid out (`layoutTables`).
 */
export function applyTableLook(table: HTMLTableElement, look: PhoneTableLook | null | undefined): void {
  if (look == null) return
  const d = TABLE_LOOK_DEFAULTS.tableHeaderRow
  for (const [part, value] of Object.entries(look.tableHeaderRow) as [keyof typeof d, string | null][]) {
    if (value === null || value === d[part] || table.hasAttribute(`data-header-${part}`)) continue
    table.setAttribute(`data-header-${part}`, value)
  }
  // YAZ-5567: the subheader rows' look, part by part, as the header row's; their sticky choice when the table has none.
  const ds = TABLE_LOOK_DEFAULTS.tableSubheaderRow
  for (const [part, value] of Object.entries(look.tableSubheaderRow) as [keyof typeof ds, string | null][]) {
    if (value === null || value === ds[part] || table.hasAttribute(`data-subheader-${part}`)) continue
    table.setAttribute(`data-subheader-${part}`, value)
  }
  if (!look.tableStickySubheaders && !table.hasAttribute('data-sticky-subheaders')) table.setAttribute('data-sticky-subheaders', 'off')
  // A table with a comment had its freeze and Clip from it (`applyTableFile`, with the vault's defaults).
  if (table.hasAttribute('data-table-look-own')) return
  if (!look.tableStickyHeader && !table.hasAttribute('data-freeze-rows')) table.setAttribute('data-freeze-rows', '0')
  if (look.tableTextInCells === 'clip') for (const row of table.rows) for (const cell of row.cells) cell.setAttribute('data-clip', '')
}

/**
 * YAZ-5567: the look the vault's tables read as CSS variables on the reader, the Mac's (`tableLookVars`): Bullet indent
 * and gap in cells (`--cell-bullet-indent`, `--cell-bullet-gap`) and Table position Centre (`--page-table-inline: auto`;
 * a card's own Card tables, `--card-table-inline`, comes with the card look). Only what differs from the Mac's default,
 * so a vault with the default look sets none. No file: none.
 */
export function tableLookVars(look: PhoneTableLook | null | undefined): Record<string, string> {
  if (look == null) return {}
  const d = TABLE_LOOK_DEFAULTS
  return {
    ...(look.tableCellBulletIndent !== d.tableCellBulletIndent && { '--cell-bullet-indent': `${look.tableCellBulletIndent}px` }),
    ...(look.tableCellBulletGap !== d.tableCellBulletGap && { '--cell-bullet-gap': `${look.tableCellBulletGap}px` }),
    ...(look.tablePosition === 'center' && { '--page-table-inline': 'auto' }),
  }
}
