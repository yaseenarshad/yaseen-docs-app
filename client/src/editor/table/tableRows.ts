/**
 * The table's settings in the block handle menu (YAZ-3767, YAZ-3696 🔒 D6 / D7 option 2; CONTRACTS
 * rule 41a): a right-click on a table's six dots shows "Border thickness" and "Border darkness"
 * (number fields, as `line/lineRows.ts`), "Header row", "Align all columns", "Fit columns to the
 * page" (a row), "Stripes", "Row height" and "Wrap text" (choices).
 *
 * Each picker shows the table's current value; "Default (…)" sets the attribute's default. Each pick
 * is ONE transaction with the history closed first, so one ⌘Z (R4); the save writes it in the table
 * comment (`tableStyle.ts`). "Align all columns" is no comment part: it sets every cell's GFM
 * `alignment`, which the save writes in the `:-` row, so GitHub and Obsidian show it too. Its value
 * is the alignment all columns share; mixed columns read as the default. "Fit columns to the page"
 * clears every cell's `colwidth`, and is disabled while no column has a width. A read-only note
 * shows no rows (R3).
 */
import { closeHistory } from '@milkdown/kit/prose/history'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { MenuChoice, MenuChoiceField, MenuItem, MenuNumberField, RowProvider } from '../blockHandleMenu'
import { ALIGNS, TABLE_DEFAULTS, type TableAlign, type TableAttrs } from './tableStyle'

/** Crepe's look of a border (table.css): 1px, 20% of the outline colour. */
const BORDER_DEFAULT = { px: 1, darkness: 20 }

/** The table the handle points at, and where it starts; null when it points at anything else. */
function targetTable(doc: ProseNode, inside: number): { node: ProseNode; pos: number } | null {
  if (inside < 0 || inside >= doc.content.size) return null
  const node = doc.nodeAt(inside)
  return node?.type.name === 'table' ? { node, pos: inside } : null
}

/** Every cell of the table at `pos`, with its document position. */
function cellsOf(table: ProseNode, pos: number): Array<{ cell: ProseNode; pos: number }> {
  const out: Array<{ cell: ProseNode; pos: number }> = []
  table.descendants((cell, offset) => {
    if (cell.type.spec.tableRole === 'cell' || cell.type.spec.tableRole === 'header_cell') out.push({ cell, pos: pos + 1 + offset })
    return cell.type.spec.tableRole === 'table' || cell.type.spec.tableRole === 'row'
  })
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

/** One cell attribute on every cell of the table, in one transaction. */
function setCells(view: EditorView, pos: number, attr: string, value: unknown): void {
  const table = view.state.doc.nodeAt(pos)
  if (table?.type.name !== 'table') return
  const tr = closeHistory(view.state.tr)
  for (const { cell, pos: at } of cellsOf(table, pos)) if (cell.attrs[attr] !== value) tr.setNodeAttribute(at, attr, value)
  if (tr.docChanged) view.dispatch(tr)
}

/** The border with one half changed; `null` (no comment part) when both halves are the default. */
function border(current: TableAttrs['border'], half: 'px' | 'darkness', value: number | null): TableAttrs['border'] {
  const next = { ...BORDER_DEFAULT, ...current, [half]: value ?? BORDER_DEFAULT[half] }
  return next.px === BORDER_DEFAULT.px && next.darkness === BORDER_DEFAULT.darkness ? null : next
}

const choice = (label: string, value: string, fallback: string, choices: MenuChoice[], run: (value: string) => void): MenuChoiceField => ({
  kind: 'choice',
  label,
  value,
  choices,
  fallback,
  run: (picked) => run(picked ?? fallback),
})

export const tableRows: RowProvider = (view, target) => {
  if (!view.editable) return []
  const table = targetTable(view.state.doc, target.inside)
  if (table === null) return []
  const { pos } = table
  const attrs = table.node.attrs as TableAttrs
  const current = attrs.border ?? BORDER_DEFAULT
  const cells = cellsOf(table.node, pos)
  const aligns = new Set(cells.map(({ cell }) => cell.attrs.alignment ?? 'left'))
  const align = aligns.size === 1 ? ([...aligns][0] as string) : null
  const thickness: MenuNumberField = {
    kind: 'number',
    label: 'Border thickness',
    unit: 'px',
    value: current.px,
    presets: [1, 2, 3, 6],
    fallback: BORDER_DEFAULT.px,
    min: 1,
    max: 6,
    error: 'Use a whole number from 1–6px.',
    run: (value) => setTable(view, pos, { border: border(attrs.border, 'px', value) }),
  }
  const darkness: MenuNumberField = {
    kind: 'number',
    label: 'Border darkness',
    unit: '%',
    value: current.darkness,
    presets: [10, 20, 50, 100],
    fallback: BORDER_DEFAULT.darkness,
    min: 5,
    max: 100,
    error: 'Use a whole number from 5–100%.',
    run: (value) => setTable(view, pos, { border: border(attrs.border, 'darkness', value) }),
  }
  const fit = {
    label: 'Fit columns to the page',
    disabled: cells.every(({ cell }) => cell.attrs.colwidth === null),
    run: () => setCells(view, pos, 'colwidth', null),
  }
  const items: MenuItem[] = [
    thickness,
    darkness,
    choice('Header row', attrs.header, TABLE_DEFAULTS.header, [{ value: 'shaded', label: 'Shaded' }, { value: 'plain', label: 'Plain' }], (header) =>
      setTable(view, pos, { header: header as TableAttrs['header'] }),
    ),
    {
      kind: 'choice',
      label: 'Align all columns',
      value: align,
      choices: ALIGNS.map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) })),
      fallback: 'left',
      // "Default" is GFM's own: no alignment (`---`).
      run: (picked) => setCells(view, pos, 'alignment', picked as TableAlign | null),
    },
    fit,
    choice('Stripes', attrs.stripes ? 'on' : 'off', 'off', [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }], (on) => setTable(view, pos, { stripes: on === 'on' })),
    choice('Row height', attrs.height, TABLE_DEFAULTS.height, [{ value: 'compact', label: 'Compact' }, { value: 'normal', label: 'Normal' }, { value: 'tall', label: 'Tall' }], (height) =>
      setTable(view, pos, { height: height as TableAttrs['height'] }),
    ),
    choice('Wrap text', attrs.wrap ? 'on' : 'off', 'on', [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }], (on) => setTable(view, pos, { wrap: on === 'on' })),
  ]
  return items
}
