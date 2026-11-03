/**
 * Shift+arrow in a table cell (YAZ-4171): at the edge of the cell's text, the first Shift+arrow selects only that
 * cell (a CellSelection of one cell); the next one grows the selection to the neighbour cell, as before.
 *
 * - WHY: `tableEditing`'s `shiftArrow` (prosemirror-tables) makes the cell and its neighbour one CellSelection in one
 *   step. A quick copy of one cell took two. It acts on all four arrows, ⇧↑ / ⇧↓ too: `tableEditing` gets a key
 *   before the keymaps, so `lineKeymap`'s ⇧↑ / ⇧↓ (YAZ-1734) acts in a cell only away from its edge.
 * - THE EDGE is `shiftArrow`'s own (`atEndOfCell` below, a copy of the unexported one): the caret is in the cell's
 *   first (last) textblock and `endOfTextblock` says the next move leaves it. ⇧← / ⇧→ read no layout for left-to-right
 *   text; ⇧↑ / ⇧↓ read the line boxes, as `shiftArrow` already did, and ProseMirror caches the answer for the state,
 *   so `shiftArrow` after us reads nothing more. Away from the edge we do nothing, as before: ⇧← / ⇧→ are the
 *   browser's own move, and ⇧↑ / ⇧↓ go to `lineKeymap`.
 * - ORDER: the plugin goes in just BEFORE `tableEditing`, as `tableColumnResize.ts` does. A CellSelection is not ours:
 *   `shiftArrow` grows it.
 */
import { keydownHandler } from '@milkdown/kit/prose/keymap'
import { type Command, Plugin, TextSelection } from '@milkdown/kit/prose/state'
import { CellSelection } from '@milkdown/kit/prose/tables'
import type { EditorView } from '@milkdown/kit/prose/view'
import { beforeTableEditing } from './beforeTableEditing'

export type Axis = 'horiz' | 'vert'

/** The position of the caret's cell when the next move in `dir` leaves the cell's text, else null (prosemirror-tables). Also `tableFold.ts`'s. */
export function atEndOfCell(view: EditorView, axis: Axis, dir: 1 | -1): number | null {
  if (!(view.state.selection instanceof TextSelection)) return null
  const { $head } = view.state.selection
  for (let d = $head.depth - 1; d >= 0; d--) {
    const parent = $head.node(d)
    const index = dir < 0 ? $head.index(d) : $head.indexAfter(d)
    if (index !== (dir < 0 ? 0 : parent.childCount)) return null
    const role = parent.type.spec.tableRole
    if (role === 'cell' || role === 'header_cell') {
      const towards = axis === 'vert' ? (dir > 0 ? 'down' : 'up') : dir > 0 ? 'right' : 'left'
      return view.endOfTextblock(towards) ? $head.before(d) : null
    }
  }
  return null
}

/** At the edge of a cell's text: select only that cell. */
const selectCell = (axis: Axis, dir: 1 | -1): Command => (state, dispatch, view) => {
  if (view === undefined) return false
  const cell = atEndOfCell(view, axis, dir)
  if (cell === null) return false
  if (dispatch) dispatch(state.tr.setSelection(new CellSelection(state.doc.resolve(cell))).scrollIntoView())
  return true
}

export const tableShiftArrow = beforeTableEditing(() => [
  new Plugin({
    props: {
      handleKeyDown: keydownHandler({
        'Shift-ArrowLeft': selectCell('horiz', -1),
        'Shift-ArrowRight': selectCell('horiz', 1),
        'Shift-ArrowUp': selectCell('vert', -1),
        'Shift-ArrowDown': selectCell('vert', 1),
      }),
    },
  }),
])
