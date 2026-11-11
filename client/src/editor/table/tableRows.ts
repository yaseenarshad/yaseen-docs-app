/**
 * The table's settings in the block handle menu (YAZ-3767, YAZ-3696 🔒 D6 / D7 option 2; CONTRACTS
 * rule 41a): a right-click on a table's six dots shows three captioned icon strips (the YAZ-4163 demo, D23: `caption`
 * and `stay` of `MenuStrip`; a click sets one and the menu stays open, drawn again by `blockHandleMenu.ts`'s `refresh`):
 * Look (Stripes, Fit columns to the page), Text (Align left / center / right for all columns,
 * Align top / middle / bottom, the table's default; a cell's own wins, YAZ-4166 D10) and Rows (Compact / Normal / Tall
 * rows); then "Text in cells" (Default / Wrap / Clip, YAZ-4900: the table's `wrap`, saved as `nowrap` for Clip and
 * `wrap` for Wrap; Default is Settings › Tables › Text in cells; a column's own choice in `tableMenu.ts` wins); then "Header row ›" (YAZ-4774: "Plain, like any row" (YAZ-4793: Strength Off, Regular, Full at
 * once), then Color, Strength, Weight and Text (YAZ-4794: Fill colour, Strength, Weight, Text colour and Align), each ✓ at what the table shows; a pick
 * that equals Settings › Tables › Header row saves no part, so the table follows Settings again); then "Border
 * thickness" and "Border darkness" (number fields, as `line/lineRows.ts`) and "Time slots" (Off / 15 min / 30 min /
 * 1 hour, YAZ-4163 D7: `setTimeSlots` in `tableCalendar.ts` makes any table a calendar table and keeps its text, D8). A calendar table also has "Now button" (On / Off, the table's `nowButton`, saved as
 * `nonow`, D22), "Go to now" (a row, YAZ-4164 D11: `goToNow`), disabled while no row holds the current time, and "Fill
 * the calendar day" (the YAZ-4163 demo: `fillCalendarDay`), disabled while the table has every slot of the day. Every
 * table has "Cell note button" (Default / On / Off, the table's `noteButton`, saved as `notebutton` / `nonotebutton`,
 * YAZ-4790; Default is Settings › Tables › Cell notes › Add button). Before Time slots, "Turn into Super table" (YAZ-4869
 * S1, `super/superTables.ts`), off with its reason at the right edge while a body cell spans rows or Time slots are on;
 * a Super table has "Turn back into a plain table" there, and its Time slots row is off. YAZ-4899: "Subheader row ›"
 * (the look of the subheader rows, as "Header row ›") after it; a "Sticky" switch (Default / On / Off) sits at the top of
 * the "Header row ›" panel (the table's `stickyHeader`, saved as `stickyheader` / `nostickyheader`) and of the "Subheader
 * row ›" panel (`stickySubheaders`, saved as `stickysubheads` / `nostickysubheads`), Default being Settings › Tables';
 * Time slots is off while the table has subheader rows.
 *
 * A strip's lit button is the table's current value; a value that IS the default saves no part. Each pick
 * is ONE transaction with the history closed first, so one ⌘Z (R4); the save writes it in the table
 * comment (`tableStyle.ts`). The horizontal alignment is no comment part: it sets every cell's GFM
 * `alignment`, which the save writes in the `:-` row, so GitHub and Obsidian show it too, and clears
 * the cells' own alignment (YAZ-3819) in the same step. Its value
 * is the alignment all columns share; mixed columns light no button. While any cell has its own
 * alignment it reads "Mixed": no button is lit, so a pick of the shown value clears them too. "Fit
 * columns to the page" clears every cell's `colwidth`, and is disabled while no column has a width. A read-only note
 * shows no rows (R3).
 */
import { closeHistory } from '@milkdown/kit/prose/history'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { TableMap } from '@milkdown/kit/prose/tables'
import type { EditorView } from '@milkdown/kit/prose/view'
import { formatTime } from '@shared/timeFormat'
import { HEADER_ROW_CHOICES, HEADER_ROW_PARTS, headerRowLabel, headerRowOwn, type HeaderRowOwn } from '@shared/types'
import type { MenuChoice, MenuChoiceField, MenuItem, MenuNumberField, MenuRow, MenuStrip, RowProvider } from '../blockHandleMenu'
import { isListItem } from '../outline/listNodes'
import { tablerIcon, type TablerIcon } from './tableIcons'
import { setCellsAttr, tableHasSubheads } from './cells'
import { fillCalendarDay, goToNow, minutesOf, missingDayTimes, nowPlace, setTimeSlots } from './tableCalendar'
import { calendarDaySetting, cellNoteButtonSetting, headerRowSetting, stickyHeaderSetting, stickySubheadersSetting, subheaderRowSetting, textInCellsSetting, timeFormatSetting } from './timeFormatSetting'
import { capital, headerSwatch } from './colours'
import { CELL_ALIGNS, VALIGNS, type TableAttrs } from './tableStyle'
import { superRule, turnBackPlain, turnIntoSuper } from './super/superTables'

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
 * line, which no table holds; a bullet in a cell (YAZ-3818) is a list item inside the table, so the
 * walk stops there: its dot, or a probe in it, is the bullet's, with the bullet's menu.
 */
function targetTable(doc: ProseNode, inside: number): { node: ProseNode; pos: number } | null {
  if (inside < 0 || inside >= doc.content.size) return null
  const node = doc.nodeAt(inside)
  if (node?.type.name === 'table') return { node, pos: inside }
  // A bullet whose first block is a table (YAZ-4800): its handle stands left of the dot, as a code block's does, and
  // carries the table's settings too, so the table's own handle no longer covers the dot.
  if (node !== null && isListItem(node) && node.firstChild?.type.name === 'table') return { node: node.firstChild, pos: inside + 1 }
  if (node !== null && isListItem(node)) return null
  const $pos = doc.resolve(inside)
  for (let depth = $pos.depth; depth > 0; depth--) {
    if (isListItem($pos.node(depth))) return null
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

/** A colour's swatch as a row's glyph (YAZ-4774), the cell palette's colour. */
const swatchIcon = (background: string) => (): SVGElement => {
  const template = document.createElement('template')
  template.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="0.5" y="0.5" width="13" height="13" rx="3" stroke="currentColor" stroke-opacity="0.2"/></svg>'
  const svg = template.content.firstElementChild as SVGElement
  svg.querySelector('rect')!.style.fill = background
  return svg
}

/**
 * "Header row ›" (YAZ-4774) and "Subheader row ›" (YAZ-4899): "Plain, like any row", the Sticky switch, then each part's
 * choices in the Fill · Text · Style tabs, a ✓ at what the table shows: its own part, else Settings' (no Text colour in
 * Settings is Full, a note table's look). A pick that equals Settings removes the part. YAZ-4794: Text colour (Muted,
 * Full, the eight colours) and Align (Follow column, Left, Center, Right) are parts too. The cell's right-click menu draws
 * the same row as its "Header row style ›" / "Subheader row style ›" panel (`tableMenu.ts`, YAZ-4899).
 */
export function headerRowParent(view: EditorView, pos: number, kind: 'header' | 'subheader'): MenuRow {
  const own = (view.state.doc.nodeAt(pos)?.attrs[kind] ?? {}) as HeaderRowOwn
  const settings = kind === 'header' ? headerRowSetting() : subheaderRowSetting()
  const fallback: Required<HeaderRowOwn> = { ...settings, text: settings.text ?? 'full' }
  const shown = { ...fallback, ...headerRowOwn(own) }
  const set = (next: HeaderRowOwn) => {
    for (const p of HEADER_ROW_PARTS) if (next[p] === fallback[p]) delete next[p]
    setTable(view, pos, { [kind]: next })
  }
  /** One choice of a part: its name, its swatch for a colour, ✓ when the table shows it. */
  const pick = <K extends keyof HeaderRowOwn>(part: K, value: NonNullable<HeaderRowOwn[K]>): MenuRow => ({
    label: headerRowLabel(value),
    icon: part === 'color' || (part === 'text' && value !== 'muted' && value !== 'full') ? swatchIcon(headerSwatch(value)) : undefined,
    hint: shown[part] === value ? '✓' : undefined,
    run: () => set({ ...headerRowOwn(own), [part]: value }),
  })
  const parts = Object.fromEntries(HEADER_ROW_PARTS.map((part) => [part, HEADER_ROW_CHOICES[part].map((value) => pick(part, value))])) as Record<keyof HeaderRowOwn, MenuRow[]>
  // YAZ-4793: one pick makes the row look like any other row (no shade, regular, full text); a second pick hands the
  // three parts back to Settings.
  const plain = shown.strength === 'off' && shown.weight === 'regular' && shown.text === 'full'
  const plainRow: MenuRow = {
    label: 'Plain, like any row',
    hint: plain ? '✓' : undefined,
    run: () => {
      const next: HeaderRowOwn = { ...headerRowOwn(own) }
      if (plain) {
        delete next.strength
        delete next.weight
        delete next.text
      } else Object.assign(next, { strength: 'off', weight: 'regular', text: 'full' } satisfies HeaderRowOwn)
      set(next)
    },
  }
  // Sticky (YAZ-4899 demo: "move the sticky header row and the subheader sticky into the option for this ... on top of
  // the plain like any row"): the header row frozen (`stickyHeader`, `tableFreeze.ts`) or the subheader rows pinned
  // (`stickySubheaders`, `tableSubhead.ts`); Default is Settings › Tables' (On by default), and a pick of it saves no part.
  const attr = kind === 'header' ? 'stickyHeader' : 'stickySubheaders'
  const ownSticky = view.state.doc.nodeAt(pos)?.attrs[attr] as boolean | null
  const stickyDefault = kind === 'header' ? stickyHeaderSetting() : stickySubheadersSetting()
  const sticky: MenuRow[] = ([null, true, false] as const).map((value) => ({
    label: value === null ? `Default (${stickyDefault ? 'On' : 'Off'})` : value ? 'On' : 'Off',
    hint: ownSticky === value ? '✓' : undefined,
    run: () => setTable(view, pos, { [attr]: value }),
  }))
  return {
    label: kind === 'header' ? 'Header row' : 'Subheader row',
    run: () => {},
    // A pick keeps the flyout open, so colour, strength and text go in one visit (YAZ-4774 demo).
    stay: true,
    switches: [{ label: 'Sticky', options: sticky }],
    // YAZ-4794 demo ("holy shite thats a long flyout"): Plain on top, then Fill · Text · Style tabs, as Fill's Cell · Row · Column. YAZ-4794: Text is "Text colour"
    // (Muted, Full, then the eight colours' swatches) and Align follows it; Color is "Fill colour" beside it.
    children: [[plainRow]],
    tabs: [
      {
        label: 'Fill',
        // Strength as a short switch, as the folder table's (YAZ-4794 demo: "shouldnt it follow?").
        bar: parts.strength,
        children: [parts.color],
      },
      { label: 'Text', children: [parts.text] },
      { label: 'Style', headings: ['Weight', 'Align'], children: [parts.weight, parts.align] },
    ],
  }
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
  stay: true,
  run: (picked) => run(picked ?? fallback),
})

export const tableRows: RowProvider = (view, target) => {
  if (!view.editable) return []
  const table = targetTable(view.state.doc, target.inside)
  if (table === null) return []
  const { pos } = table
  const attrs = table.node.attrs as TableAttrs
  const noteDefault = cellNoteButtonSetting() ? 'on' : 'off'
  const textDefault = textInCellsSetting()
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
    stay: true,
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
    stay: true,
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
    ],
  }
  const items: MenuItem[] = [
    look,
    text,
    rowsStrip,
    // YAZ-4900: this table's Wrap or Clip; Default is Settings › Tables › Text in cells (Wrap by default). Clip saves
    // `nowrap`, the part of before; Wrap saves `wrap`; a pick of Settings' value saves no part. A column's own choice
    // (a cell's right-click › Text in this column) wins over it.
    choice('Text in cells', attrs.wrap === null ? textDefault : attrs.wrap ? 'wrap' : 'clip', textDefault, [{ value: 'wrap', label: 'Wrap' }, { value: 'clip', label: 'Clip' }], (text) =>
      setTable(view, pos, { wrap: text === textDefault ? null : text === 'wrap' }),
    ),
    headerRowParent(view, pos, 'header'),
    // YAZ-4899: the look of the table's subheader rows ("Make subheader row" in a cell's right-click).
    headerRowParent(view, pos, 'subheader'),
    thickness,
    darkness,
    // YAZ-4869 S1: a Super table and a Time-slots table are never one table (item 18); a body cell that spans rows
    // would break the groups (item 17). Off, the row says why at its right edge.
    attrs.superTable
      ? { label: 'Turn back into a plain table', run: () => turnBackPlain(view, pos) }
      : { label: 'Turn into Super table', disabled: superRule(table.node) !== null, hint: superRule(table.node) ?? undefined, run: () => turnIntoSuper(view, pos) },
    attrs.superTable
      ? { label: 'Time slots: off in a Super table', disabled: true, run: () => {} }
      : tableHasSubheads(table.node)
        ? { label: 'Time slots: off with subheader rows', disabled: true, run: () => {} }
        : choice(
          'Time slots',
          String(attrs.calendar),
          '0',
          [{ value: '0', label: 'Off' }, { value: '15', label: '15 min' }, { value: '30', label: '30 min' }, { value: '60', label: '1 hour' }],
          (slot) => setTimeSlots(view, pos, Number(slot)),
        ),
    // YAZ-4790: this table's cell note "+"; Settings › Tables › Cell notes › Add button turns off every one. A cell's
    // right-click still has "Add cell note", and a note already there still shows its corner.
    // YAZ-4790 demo: Default follows Settings › Tables › Cell notes › Add button (off by default); a pick of Settings' value saves no part.
    choice('Cell note button', attrs.noteButton === null ? noteDefault : attrs.noteButton ? 'on' : 'off', noteDefault, [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }], (on) =>
      setTable(view, pos, { noteButton: on === noteDefault ? null : on === 'on' }),
    ),
  ]
  if (attrs.calendar > 0) {
    // The YAZ-4163 demo: this table's "Now" chip; Settings › Calendar tables › Now button turns off every one.
    items.push(choice('Now button', attrs.nowButton ? 'on' : 'off', 'on', [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }], (on) => setTable(view, pos, { nowButton: on === 'on' })))
    items.push({ label: 'Go to now', disabled: nowPlace(table.node, minutesOf(new Date()))?.row == null, run: () => void goToNow(view, pos) })
    // The YAZ-4163 demo: the rows of Settings › Calendar tables › Calendar day that the table does not have yet.
    const { start, end } = calendarDaySetting()
    const format = timeFormatSetting()
    items.push({ label: `Fill the calendar day (${formatTime(format, start)} – ${formatTime(format, end)})`, disabled: missingDayTimes(table.node).length === 0, run: () => void fillCalendarDay(view, pos) })
  }
  return items
}
