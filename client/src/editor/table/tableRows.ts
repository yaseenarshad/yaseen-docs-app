/**
 * The table's settings in the block handle menu (YAZ-3767, YAZ-3696 🔒 D6 / D7 option 2; CONTRACTS
 * rule 41a): a right-click on a table's six dots shows "Border thickness" and "Border darkness"
 * (number fields, as `line/lineRows.ts`), "Header row", "Align all columns", "Vertical align" (Top / Middle /
 * Bottom, the table's default; a cell's own wins, YAZ-4166 D10), "Fit columns to the page" (a row), "Stripes", "Row height" and "Wrap text" (choices), and "Time slots" (Off / 15 min / 30 min /
 * 1 hour, YAZ-4163 D7: `setTimeSlots` in `tableCalendar.ts` makes any table a calendar table and keeps its text, D8);
 * a calendar table also has "Go to now" (a row, YAZ-4164 D11: `goToNow`), disabled while no row holds the current time,
 * and "Fill the calendar day" (the YAZ-4163 demo: `fillCalendarDay`), disabled while the table has every slot of the day.
 *
 * Each picker shows the table's current value; "Default (…)" sets the attribute's default. A value
 * that IS the default saves no part, so the picker reads "Default (…)" with ✓, and its list does not
 * hold the default a second time (YAZ-3791, as the line pickers, YAZ-3208 D11). Each pick
 * is ONE transaction with the history closed first, so one ⌘Z (R4); the save writes it in the table
 * comment (`tableStyle.ts`). "Align all columns" is no comment part: it sets every cell's GFM
 * `alignment`, which the save writes in the `:-` row, so GitHub and Obsidian show it too, and clears
 * the cells' own alignment (YAZ-3819) in the same step. Its value
 * is the alignment all columns share; mixed columns read as the default. While any cell has its own
 * alignment it reads "Mixed": no item has ✓, so a pick of the shown value clears them too. "Fit
 * columns to the page" clears every cell's `colwidth`, and is disabled while no column has a width. A read-only note
 * shows no rows (R3).
 */
import { closeHistory } from '@milkdown/kit/prose/history'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { TableMap } from '@milkdown/kit/prose/tables'
import type { EditorView } from '@milkdown/kit/prose/view'
import { formatTime } from '@shared/timeFormat'
import type { MenuChoice, MenuChoiceField, MenuItem, MenuNumberField, MenuStrip, RowProvider } from '../blockHandleMenu'
import { tablerIcon, type TablerIcon } from './tableIcons'
import { setCellsAttr } from './cells'
import { fillCalendarDay, goToNow, minutesOf, missingDayTimes, nowPlace, setTimeSlots } from './tableCalendar'
import { calendarDaySetting, timeFormatSetting } from './timeFormatSetting'
import { capital } from './colours'
import { CELL_ALIGNS, VALIGNS, type TableAttrs } from './tableStyle'

/** The strips' icons (the YAZ-4163 demo, `tableIcons.ts`). */
const ALIGN_ICONS: Record<(typeof CELL_ALIGNS)[number], TablerIcon> = { left: 'alignLeft', center: 'alignCenter', right: 'alignRight' }
const VALIGN_ICONS: Record<TableAttrs['valign'], TablerIcon> = { top: 'layoutAlignTop', middle: 'layoutAlignMiddle', bottom: 'layoutAlignBottom' }
const HEIGHT_ICONS: Record<TableAttrs['height'], TablerIcon> = { compact: 'arrowsMinimize', normal: 'lineHeight', tall: 'arrowsMaximize' }

/** Crepe's look of a border (table.css): 1px, 20% of the outline colour. */
const BORDER_DEFAULT = { px: 1, darkness: 20 }

/**
 * The table the handle points at, and where it starts; null when it points at anything else. Below the
 * table's top edge the handle's probe lands in its first cell (YAZ-3795), so the nearest table ancestor
 * counts too: Crepe's handle never belongs to a block inside a table. A bullet's handle probes its own
 * line, which no table holds.
 */
function targetTable(doc: ProseNode, inside: number): { node: ProseNode; pos: number } | null {
  if (inside < 0 || inside >= doc.content.size) return null
  const node = doc.nodeAt(inside)
  if (node?.type.name === 'table') return { node, pos: inside }
  const $pos = doc.resolve(inside)
  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.node(depth).type.name === 'table') return { node: $pos.node(depth), pos: $pos.before(depth) }
  }
  return null
}

/** Every cell of the table. */
function cellsOf(table: ProseNode): ProseNode[] {
  const out: ProseNode[] = []
  table.forEach((row) => row.forEach((cell) => out.push(cell)))
  return out
}

/** One table attribute in one transaction, the history closed first: one undo step. No change, no transaction. */
function setTable(view: EditorView, pos: number, attrs: Partial<TableAttrs>): void {
  const node = view.state.doc.nodeAt(pos)
  if (node?.type.name !== 'table') return
  const next = { ...node.attrs, ...attrs }
  if (JSON.stringify(next) === JSON.stringify(node.attrs)) return
  view.dispatch(closeHistory(view.state.tr).setNodeMarkup(pos, undefined, next))
}

/** Cell attributes on every cell of the table, in one transaction. */
function setCells(view: EditorView, pos: number, attrs: Record<string, unknown>): void {
  const table = view.state.doc.nodeAt(pos)
  if (table?.type.name !== 'table') return
  const map = TableMap.get(table)
  const rect = { map, table, tableStart: pos + 1, left: 0, top: 0, right: map.width, bottom: map.height }
  const tr = closeHistory(view.state.tr)
  for (const [attr, value] of Object.entries(attrs)) setCellsAttr(tr, rect, attr, value)
  if (tr.docChanged) view.dispatch(tr)
}

/** The border with one half changed; `null` (no comment part) when both halves are the default. */
function border(current: TableAttrs['border'], half: 'px' | 'darkness', value: number | null): TableAttrs['border'] {
  const next = { ...BORDER_DEFAULT, ...current, [half]: value ?? BORDER_DEFAULT[half] }
  return next.px === BORDER_DEFAULT.px && next.darkness === BORDER_DEFAULT.darkness ? null : next
}

/** `null` (the picker follows the default) when `value` is the default. */
const orNull = <T>(value: T, fallback: T): T | null => (value === fallback ? null : value)

const choice = (label: string, value: string, fallback: string, choices: MenuChoice[], run: (value: string) => void): MenuChoiceField => ({
  kind: 'choice',
  label,
  value: orNull(value, fallback),
  choices,
  fallback,
  defaultOnce: true,
  run: (picked) => run(picked ?? fallback),
})

export const tableRows: RowProvider = (view, target) => {
  if (!view.editable) return []
  const table = targetTable(view.state.doc, target.inside)
  if (table === null) return []
  const { pos } = table
  const attrs = table.node.attrs as TableAttrs
  const current = attrs.border ?? BORDER_DEFAULT
  const cells = cellsOf(table.node)
  // No alignment on every cell (GFM's `---`) is the default; so are mixed columns. A cell's own
  // alignment makes it "Mixed", a value no item has: no ✓, and every pick runs (YAZ-3819).
  const aligns = new Set(cells.map((cell) => (cell.attrs.alignment as string | null) ?? null))
  const align = cells.some((cell) => cell.attrs.align !== null) ? 'Mixed' : aligns.size === 1 ? [...aligns][0]! : null
  const thickness: MenuNumberField = {
    kind: 'number',
    label: 'Border thickness',
    unit: 'px',
    value: orNull(current.px, BORDER_DEFAULT.px),
    presets: [1, 2, 3, 6],
    fallback: BORDER_DEFAULT.px,
    defaultOnce: true,
    min: 1,
    max: 6,
    error: 'Use a whole number from 1–6px.',
    run: (value) => setTable(view, pos, { border: border(attrs.border, 'px', value) }),
  }
  const darkness: MenuNumberField = {
    kind: 'number',
    label: 'Border darkness',
    unit: '%',
    value: orNull(current.darkness, BORDER_DEFAULT.darkness),
    presets: [10, 20, 50, 100],
    fallback: BORDER_DEFAULT.darkness,
    defaultOnce: true,
    min: 5,
    max: 100,
    error: 'Use a whole number from 5–100%.',
    run: (value) => setTable(view, pos, { border: border(attrs.border, 'darkness', value) }),
  }
  const columnsAlign = aligns.size === 1 ? [...aligns][0]! : null
  // The YAZ-4163 demo: the look settings as three icon strips; a click sets one and the menu stays open, lit anew.
  const look: MenuStrip = {
    kind: 'strip',
    label: 'Look',
    caption: true,
    stay: true,
    buttons: [
      { label: 'Shaded header row', icon: tablerIcon('tableRow'), active: attrs.header === 'shaded', run: () => setTable(view, pos, { header: attrs.header === 'shaded' ? 'plain' : 'shaded' }) },
      { label: 'Stripes', icon: tablerIcon('baselineDensityMedium'), active: attrs.stripes, run: () => setTable(view, pos, { stripes: !attrs.stripes }) },
      { label: 'Fit columns to the page', icon: tablerIcon('arrowsHorizontal'), active: false, disabled: cells.every((cell) => cell.attrs.colwidth === null), run: () => setCells(view, pos, { colwidth: null }) },
    ],
  }
  const text: MenuStrip = {
    kind: 'strip',
    label: 'Text',
    caption: true,
    stay: true,
    buttons: [
      // Left is GFM's own (`---`), so it writes no alignment, unless every column already says `:-`. A cell's own
      // alignment makes the table "Mixed": no button is lit, and each runs. The cells' own alignment goes too (YAZ-3819).
      ...CELL_ALIGNS.map((value) => ({
        label: `Align ${value}`,
        icon: tablerIcon(ALIGN_ICONS[value]),
        active: align === value || (value === 'left' && aligns.size === 1 && aligns.has(null) && align !== 'Mixed'),
        run: () => setCells(view, pos, { alignment: value === 'left' && columnsAlign !== 'left' ? null : value, align: null }),
      })),
      // The table's default only: the cells' own values stay (a calendar table's time column keeps Middle).
      ...VALIGNS.map((value) => ({ label: `Align ${value}`, icon: tablerIcon(VALIGN_ICONS[value]), active: attrs.valign === value, run: () => setTable(view, pos, { valign: value }) })),
    ],
  }
  const rowsStrip: MenuStrip = {
    kind: 'strip',
    label: 'Rows',
    caption: true,
    stay: true,
    buttons: [
      ...(['compact', 'normal', 'tall'] as const).map((value) => ({ label: `${capital(value)} rows`, icon: tablerIcon(HEIGHT_ICONS[value]), active: attrs.height === value, run: () => setTable(view, pos, { height: value }) })),
      { label: 'Wrap text', icon: tablerIcon('textWrap'), active: attrs.wrap, run: () => setTable(view, pos, { wrap: !attrs.wrap }) },
    ],
  }
  const items: MenuItem[] = [
    look,
    text,
    rowsStrip,
    thickness,
    darkness,
    choice(
      'Time slots',
      String(attrs.calendar),
      '0',
      [{ value: '0', label: 'Off' }, { value: '15', label: '15 min' }, { value: '30', label: '30 min' }, { value: '60', label: '1 hour' }],
      (slot) => setTimeSlots(view, pos, Number(slot)),
    ),
  ]
  if (attrs.calendar > 0) {
    items.push({ label: 'Go to now', disabled: nowPlace(table.node, minutesOf(new Date()))?.row == null, run: () => void goToNow(view, pos) })
    // The YAZ-4163 demo: the rows of Settings › Calendar tables › Calendar day that the table does not have yet.
    const { start, end } = calendarDaySetting()
    const format = timeFormatSetting()
    items.push({ label: `Fill the calendar day (${formatTime(format, start)} – ${formatTime(format, end)})`, disabled: missingDayTimes(table.node).length === 0, run: () => void fillCalendarDay(view, pos) })
  }
  return items
}
