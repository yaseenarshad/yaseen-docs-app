/**
 * The row band (YAZ-4167, YAZ-4159 D16; CONTRACTS rule 41a): a light accent band across the table row under the caret
 * or the mouse, its first cell bold, so the eye follows a wide row back to its time.
 *
 * - THE CARET BAND is one node decoration, `table-band-row`, on the body row that holds the head of a TextSelection.
 *   The plugin keeps that row's position: a transaction maps it, and the set is the same set (mapped) unless the caret
 *   goes to a different row, so a key press adds no decoration work (`tableSpeed.test.ts`). The header row, a
 *   CellSelection (its own highlight shows) and a caret outside a table have none.
 * - THE MOUSE BAND is CSS only (`:hover` on a body row, `table.css`).
 * - THE SETTING, Settings › Editor › Tables › "Row band" (Off / Calendar tables / All tables), is `data-table-row-band`
 *   on `.app`: `table.css` draws the band for its value, so a change restyles and builds no decoration. The band is a
 *   background layer (`--table-band`), so a cell's fill shows under it, a frozen cell stays `sticky`, and the
 *   current-time marker shows on the same row. Nothing goes in the file.
 */
import type { ResolvedPos } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, TextSelection, type EditorState } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

interface BandState {
  set: DecorationSet
  /** The banded row's position, or `null` for none. */
  row: number | null
}

export const rowBandKey = new PluginKey<BandState>('mdapp-table-row-band')

/** The position of the body row that holds `$head`, or `null` (the header row, or no table). */
function bodyRowOf($head: ResolvedPos): number | null {
  for (let depth = $head.depth; depth > 0; depth--) {
    const node = $head.node(depth)
    if (node.type.spec.tableRole === 'row') return node.type.name === 'table_header_row' ? null : $head.before(depth)
  }
  return null
}

const caretRow = (state: EditorState): number | null => (state.selection instanceof TextSelection ? bodyRowOf(state.selection.$head) : null)

function band(state: EditorState, row: number | null): BandState {
  if (row === null) return { set: DecorationSet.empty, row }
  const node = state.doc.nodeAt(row)!
  return { set: DecorationSet.create(state.doc, [Decoration.node(row, row + node.nodeSize, { class: 'table-band-row' }, { band: true })]), row }
}

export const tableRowBand = $prose(
  () =>
    new Plugin<BandState>({
      key: rowBandKey,
      state: {
        init: (_, state) => band(state, caretRow(state)),
        apply: (tr, value, _old, state) => {
          if (!tr.docChanged && !tr.selectionSet) return value
          const row = caretRow(state)
          if (!tr.docChanged) return row === value.row ? value : band(state, row)
          // The same row, mapped and still there: the same set, mapped (no new decoration on a key).
          const mapped = value.row === null ? null : tr.mapping.mapResult(value.row)
          if (mapped !== null && !mapped.deleted && mapped.pos === row) return { set: value.set.map(tr.mapping, tr.doc), row }
          return value.row === null && row === null ? value : band(state, row)
        },
      },
      props: { decorations: (state) => rowBandKey.getState(state)!.set },
    }),
)
