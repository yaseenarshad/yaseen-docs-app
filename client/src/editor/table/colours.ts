/**
 * The cell colours' helpers (YAZ-3817), shared by the cell toolbar (`cellToolbar.ts`) and the table
 * menu (`tableMenu.ts`, YAZ-3820): the labels, the swatches, the custom fill's wash, and the system
 * colour picker with its target cells.
 *
 * A custom pick goes to the cells that were the target when the picker opened. The macOS colour
 * panel does not block the window: while it is open, the user can select other cells, type, or get
 * a sync from disk. So `customColourPick` keeps the target's two corner cells in its plugin state,
 * mapped through each transaction. The pick does nothing when a corner cell is gone or the note's
 * view is destroyed (⌘W).
 */
import { closeHistory } from '@milkdown/kit/prose/history'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@milkdown/kit/prose/state'
import { CellSelection, TableMap, type TableRect } from '@milkdown/kit/prose/tables'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { setCellsAttr } from './cells'
import { cellColor, type TableColor } from './tableComment'

/** A menu label from a value: `blue` → `Blue`. */
export const capital = (word: string) => word[0].toUpperCase() + word.slice(1)

/** Each swatch's colour: a fill at full strength in light and dark (`table.css`; the cells keep their wash). */
export const fillSwatch = (c: TableColor) => `var(--table-fill-solid-${c})`
export const textSwatch = (c: TableColor) => `var(--table-text-${c})`

/** A custom fill's see-through wash: `table.css` `--table-fill-wash` (35%), and a copy to Docs (`clipboardCopyOut.ts`). */
export const FILL_WASH = 0.35

/** Where the picker opens when the target cells have no one custom colour: the input's own start. */
const START = '#000000'

/** The target's corner cells (their positions) while a picker is open, or null. */
type Target = { anchor: number; head: number } | null
const pickKey = new PluginKey<Target>('mdapp-custom-colour-pick')

/** A cell node still starts at `pos`, mapped through `tr`; `null` when it was deleted. */
const mapCell = (tr: Transaction, pos: number): number | null => {
  const mapped = tr.mapping.mapResult(pos)
  return mapped.deletedAfter ? null : mapped.pos
}

/** Keeps the open picker's target cells through every transaction (one map per change, nothing else). */
export const customColourPick = $prose(
  () =>
    new Plugin<Target>({
      key: pickKey,
      state: {
        init: () => null,
        apply: (tr, target) => {
          const meta = tr.getMeta(pickKey) as Target | undefined
          if (meta !== undefined) return meta
          if (target === null || !tr.docChanged) return target
          const anchor = mapCell(tr, target.anchor)
          const head = mapCell(tr, target.head)
          return anchor === null || head === null ? null : { anchor, head }
        },
      },
    }),
)

/** The target again as a CellSelection of `state`, or null when its cells are no longer one table's cells. */
function targetOf(state: EditorState): CellSelection | null {
  const target = pickKey.getState(state)
  if (target == null) return null
  const isCell = (pos: number) => ['cell', 'header_cell'].includes(state.doc.nodeAt(pos)?.type.spec.tableRole as string)
  if (!isCell(target.anchor) || !isCell(target.head)) return null
  const $anchor = state.doc.resolve(target.anchor)
  const $head = state.doc.resolve(target.head)
  return $anchor.start(-1) === $head.start(-1) ? new CellSelection($anchor, $head) : null
}

/** The rectangle of `cells`, as prosemirror-tables' `selectedRect` reads it from a selection. */
function rectOf(cells: CellSelection): TableRect {
  const { $anchorCell, $headCell } = cells
  const table = $anchorCell.node(-1)
  const tableStart = $anchorCell.start(-1)
  const map = TableMap.get(table)
  return { ...map.rectBetween($anchorCell.pos - tableStart, $headCell.pos - tableStart), tableStart, map, table }
}

/**
 * One hidden `<input type="color">` per document (not `display: none`, so its `click()` opens the
 * picker). Its `change` is the pick; its live `input` events do nothing, so one pick is one undo step.
 */
const pickers = new WeakMap<Document, { input: HTMLInputElement; onPick: (color: string) => void }>()
const NO_PICK = () => {}

/**
 * Open the system colour picker for `attr` of the cells of `target` (YAZ-3817). The picker opens on
 * those cells' custom colour when they all share one, else on black: a browser fires `change` only
 * for a new value, so the same colour picked for other cells still applies. One pick, one undo step.
 */
export function pickCustomColour(view: EditorView, target: CellSelection, attr: 'fill' | 'color'): void {
  const doc = view.dom.ownerDocument
  let picker = pickers.get(doc)
  if (picker === undefined) {
    const input = doc.createElement('input')
    input.type = 'color'
    input.className = 'table-colour-input'
    input.tabIndex = -1
    input.setAttribute('aria-hidden', 'true')
    const made = { input, onPick: NO_PICK as (color: string) => void }
    input.addEventListener('change', () => {
      const onPick = made.onPick
      made.onPick = NO_PICK
      const color = cellColor(input.value)
      if (color !== null) onPick(color)
    })
    pickers.set(doc, made)
    picker = made
  }
  if (!picker.input.isConnected) doc.body.appendChild(picker.input)
  const colours = new Set<unknown>()
  target.forEachCell((cell) => void colours.add(cell.attrs[attr]))
  const [only] = colours
  picker.input.value = colours.size === 1 && typeof only === 'string' && only.startsWith('#') ? only : START
  view.dispatch(view.state.tr.setMeta(pickKey, { anchor: target.$anchorCell.pos, head: target.$headCell.pos }))
  picker.onPick = (color) => {
    if (view.isDestroyed) return
    const cells = targetOf(view.state)
    const tr = view.state.tr.setMeta(pickKey, null)
    if (cells !== null) setCellsAttr(closeHistory(tr), rectOf(cells), attr, color)
    view.dispatch(tr)
  }
  picker.input.click()
}

