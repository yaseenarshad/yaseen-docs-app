/**
 * The "Add cell note" button (YAZ-3818 D8): ONE button for the editor, an element beside the editable DOM in the
 * editor's `.milkdown` box (as Crepe's block handle), put over the top-right corner of the body or header cell under
 * the pointer, else of the caret's cell while the editor has focus; never in a read-only view. On a cell with a note
 * it is "Edit cell note" (a pencil), and only under the pointer, so the corner triangle shows wherever the pointer is
 * not (the YAZ-3818 demo). A click adds the cell note if there is none and opens it as a card (`openCellNote`,
 * cellNoteCard.ts).
 *
 * It sends no transaction (5A-7): a hover, the focus, a blur and the caret only move the element, so the doc never
 * changes under the pointer (Crepe's trailing paragraph after a last-block table stays away) and a pointer sweep over
 * a big table costs one `closest` per cell. The element is placed again only when its cell changes, when that cell's
 * box changes (a `ResizeObserver`), or when a table scrolls sideways; a typed key that stays in the cell places nothing.
 * The pointer can go from the cell onto the button: leaving the editor for the button keeps it.
 */
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { cellPosAround } from '../outline/listNodes'
import { openCellNote } from './cellNoteCard'
import { CELL_NOTE_CELL_CLASS } from './cellNotes'

/** How many times the button was placed: a test proves that a typed key places none. */
export const cellNoteButtonPlacements = { runs: 0 }

const ADD_ICON =
  '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M8 4v8M4 8h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M11 1h4v4z" fill="var(--table-cell-note-mark)"/></svg>'
const EDIT_ICON =
  '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M3 13l.8-3L10.5 3.3l2.2 2.2L6 12.2z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M11 1h4v4z" fill="var(--table-cell-note-mark)"/></svg>'

/** The button's size and its inset from the cell's corner, in px (table.css): a 22 px target around an 18 px box, the icon 12 px (the YAZ-3818 demo). */
const SIZE = 22
const INSET = 0

/** The cell element (td, th) under a pointer event in this view, or null off the tables. */
const cellUnder = (view: EditorView, target: EventTarget | null): HTMLElement | null => {
  const cell = target instanceof Element ? target.closest<HTMLElement>('td, th') : null
  return cell !== null && view.dom.contains(cell) ? cell : null
}

/** One editor's button: its element, the cell under the pointer, and the cell it is over. */
function buttonView(view: EditorView) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'cell-note-button'
  button.dataset.show = 'false'
  /** "Add cell note" or "Edit cell note", set when the button goes to another cell. */
  const label = (edit: boolean) => {
    const name = edit ? 'Edit cell note' : 'Add cell note'
    if (button.title === name) return
    button.title = name
    button.setAttribute('aria-label', name)
    button.innerHTML = edit ? EDIT_ICON : ADD_ICON
  }
  label(false)
  view.dom.parentElement!.appendChild(button)
  let hovered: HTMLElement | null = null
  let shown: HTMLElement | null = null
  const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => place(shown))

  /** Over `cell`'s corner, or hidden for null. */
  function place(cell: HTMLElement | null): void {
    cellNoteButtonPlacements.runs++
    if (cell !== shown) {
      resize?.disconnect()
      if (cell !== null) resize?.observe(cell)
    }
    shown = cell
    button.dataset.show = String(cell !== null)
    if (cell === null) return
    label(cell.classList.contains(CELL_NOTE_CELL_CLASS))
    const box = cell.getBoundingClientRect()
    const host = button.parentElement!.getBoundingClientRect()
    button.style.left = `${box.right - INSET - SIZE - host.left}px`
    button.style.top = `${box.top + INSET - host.top}px`
  }

  /** The cell the button goes to now: the pointer's, else the caret's while focused, but a cell with a note only under the pointer. */
  function target(): HTMLElement | null {
    if (!view.editable) return null
    // A cell the editor drew again is no longer under the pointer.
    const pointer = hovered?.isConnected === true ? hovered : null
    if (pointer !== null) return pointer
    const caret = view.hasFocus() ? cellPosAround(view.state.selection.$from) : null
    const cell = caret === null ? null : (view.nodeDOM(caret) as HTMLElement | null)
    return cell === null || cell.classList.contains(CELL_NOTE_CELL_CLASS) ? null : cell
  }

  /** Placed again only when the cell it goes to changes. */
  const follow = () => {
    const cell = target()
    if (cell !== shown) place(cell)
  }
  const onScroll = () => {
    if (shown !== null) place(shown)
  }
  view.dom.addEventListener('scroll', onScroll, true)
  button.addEventListener('mousedown', (event) => event.preventDefault())
  button.addEventListener('click', (event) => {
    event.preventDefault()
    const cell = shown === null ? null : cellPosAround(view.state.doc.resolve(view.posAtDOM(shown, 0)))
    if (cell !== null) openCellNote(view, cell)
  })
  // Off the button to the page: no cell under the pointer now.
  button.addEventListener('mouseleave', (event) => {
    if (cellUnder(view, event.relatedTarget) !== null) return
    hovered = null
    follow()
  })

  return {
    hover: (event: MouseEvent) => {
      const cell = cellUnder(view, event.target)
      if (cell === hovered) return
      hovered = cell
      follow()
    },
    leave: (event: MouseEvent) => {
      if (event.relatedTarget === button) return
      hovered = null
      follow()
    },
    follow,
    update: follow,
    destroy: () => {
      resize?.disconnect()
      view.dom.removeEventListener('scroll', onScroll, true)
      button.remove()
    },
  }
}

export const cellNoteButton = $prose(() => {
  let current: ReturnType<typeof buttonView> | null = null
  return new Plugin({
    key: new PluginKey('mdapp-cell-note-button'),
    view: (view) => {
      current = buttonView(view)
      return current
    },
    props: {
      handleDOMEvents: {
        mouseover: (_view, event) => {
          current?.hover(event)
          return false
        },
        mouseleave: (_view, event) => {
          current?.leave(event)
          return false
        },
        // On blur `hasFocus` is already false.
        focus: () => {
          current?.follow()
          return false
        },
        blur: () => {
          current?.follow()
          return false
        },
      },
    },
  })
})
