/**
 * The "Add cell note" button (YAZ-3818 D8): ONE button for the editor, a widget at the end of a cell that table.css
 * puts in the cell's top-right corner (cells are `position: relative`). It goes to the body or header cell under the
 * pointer, else to the caret's cell while the editor has focus, and only to a cell with no cell note. A click adds the
 * cell note and opens it as a page (`openCellNote`, zoom.ts).
 *
 * The widget is placed again only when the pointer moves into another cell, the selection moves into another cell,
 * the focus moves the button, or a change adds or removes a mark (`touchesNotes`). A typed key only maps it. A pointer
 * or focus change sends a transaction only when it moves the button: off the tables nothing is sent, so Crepe's
 * trailing paragraph is never added by a hover or a focus. Its `stopEvent` hides its mouse events from ProseMirror, so
 * no cell select drag starts. Read-only: no button.
 */
import { Plugin, PluginKey, type EditorState } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { isTableCell } from '../outline/listNodes'
import { openCellNote } from '../outline/zoom'
import { cellNoteOf, touchesNotes } from './cellNotes'

interface ButtonState {
  /** The cell under the pointer, or null. */
  hover: number | null
  /** The caret's cell, or null. */
  caret: number | null
  /** The cell the button goes to: the pointer's, else the caret's while focused; it may have a note. */
  target: number | null
  /** The cell the button is in, or null. */
  cell: number | null
  set: DecorationSet
}

/** What moves the button besides the selection: the pointer's cell, or the editor's focus (read off the plugin's view). */
type ButtonMeta = { hover: number | null } | { focus: true }

const key = new PluginKey<ButtonState>('mdapp-cell-note-button')

/** How many times the button was placed: a test proves that a typed key places none. */
export const cellNoteButtonPlacements = { runs: 0 }

const ICON =
  '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M8 4v8M4 8h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M11 1h4v4z" fill="var(--table-cell-note-mark)"/></svg>'

/** The cell of the caret, at any depth (a cell's bullet too), or null. */
function caretCell(state: EditorState): number | null {
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 0; depth--) if (isTableCell($from.node(depth))) return $from.before(depth)
  return null
}

/** The button's DOM: a click opens the cell's new note, read from the plugin state at the click. */
function buttonDOM(view: EditorView): HTMLElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'cell-note-button'
  button.contentEditable = 'false'
  button.title = 'Add cell note'
  button.setAttribute('aria-label', 'Add cell note')
  button.innerHTML = ICON
  button.addEventListener('mousedown', (event) => event.preventDefault())
  button.addEventListener('click', (event) => {
    event.preventDefault()
    const cell = key.getState(view.state)?.cell
    if (cell != null) openCellNote(view, cell)
  })
  return button
}

/** The button in `cell`; none on a cell with a cell note. */
function place(state: EditorState, cell: number | null): { cell: number | null; set: DecorationSet } {
  cellNoteButtonPlacements.runs++
  const node = cell === null ? null : state.doc.nodeAt(cell)
  if (cell === null || node === null || !isTableCell(node) || cellNoteOf(state.doc, cell) !== null) return { cell: null, set: DecorationSet.empty }
  const widget = Decoration.widget(cell + node.nodeSize - 1, buttonDOM, { key: 'cell-note-button', side: 1, ignoreSelection: true, stopEvent: () => true })
  return { cell, set: DecorationSet.create(state.doc, [widget]) }
}

/** The cell under a pointer event, or null off the tables. */
function cellAt(view: EditorView, target: EventTarget | null): number | null {
  const element = target instanceof Element ? target.closest('td, th') : null
  if (element === null || !view.dom.contains(element)) return null
  const $pos = view.state.doc.resolve(view.posAtDOM(element, 0))
  return isTableCell($pos.parent) ? $pos.before() : null
}

export const cellNoteButton = $prose(() => {
  let view: EditorView | null = null
  const focused = () => view?.hasFocus() === true
  const send = (meta: ButtonMeta) => view?.dispatch(view.state.tr.setMeta(key, meta))
  return new Plugin<ButtonState>({
    key,
    state: {
      init: () => ({ hover: null, caret: null, target: null, cell: null, set: DecorationSet.empty }),
      apply: (tr, prev, _old, state) => {
        const meta = tr.getMeta(key) as ButtonMeta | undefined
        if (meta === undefined && !tr.selectionSet && !tr.docChanged) return prev
        const mapped = (pos: number | null) => {
          const result = pos === null ? null : tr.mapping.mapResult(pos, 1)
          return result === null || result.deleted ? null : result.pos
        }
        const hover = meta !== undefined && 'hover' in meta ? meta.hover : mapped(prev.hover)
        const caret = tr.selectionSet ? caretCell(state) : mapped(prev.caret)
        const target = hover ?? (focused() ? caret : null)
        // The same cell, and no mark came or went: a typed key only maps the widget.
        if (mapped(prev.target) === target && !(tr.docChanged && touchesNotes(tr))) {
          return { hover, caret, target, cell: mapped(prev.cell), set: tr.docChanged ? prev.set.map(tr.mapping, tr.doc) : prev.set }
        }
        return { hover, caret, target, ...place(state, target) }
      },
    },
    view: (v) => {
      view = v
      return {
        destroy: () => {
          view = null
        },
      }
    },
    props: {
      // Read-only: no button (R3). The first ask comes before the plugin view; table.css hides it there too.
      decorations: (state) => (view?.editable !== false ? key.getState(state)?.set : undefined),
      handleDOMEvents: {
        mouseover: (v, event) => {
          const cell = cellAt(v, event.target)
          if (cell !== key.getState(v.state)?.hover) send({ hover: cell })
          return false
        },
        mouseleave: (v) => {
          if (key.getState(v.state)?.hover !== null) send({ hover: null })
          return false
        },
        // A focus change moves the button only to or from the caret's cell, with no cell under the pointer. On blur
        // `hasFocus` is already false.
        focus: (v) => {
          const state = key.getState(v.state)
          if (state?.hover === null && state.caret !== null && state.target === null) send({ focus: true })
          return false
        },
        blur: (v) => {
          const state = key.getState(v.state)
          if (state?.hover === null && state.target !== null) send({ focus: true })
          return false
        },
      },
    },
  })
})
