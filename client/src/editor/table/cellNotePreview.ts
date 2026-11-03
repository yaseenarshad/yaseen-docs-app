/**
 * A cell note's preview (YAZ-3818 D14), as a note's link hover (`wikilink/wikilinkHover.ts`): rest the pointer anywhere
 * on a cell that has a note (the YAZ-3818 demo) for the hover dwell (`HOVER_PREVIEW_DWELL_MS`) and a small read-only
 * box shows beside the cell, with the note's title ("Note: <column> · <row>"), the hint "Click the corner to open", and
 * its first 6 lines as plain text (a bullet as `• `). A click in the cell puts the caret there as always; a click on the
 * corner opens the note's card (`cellNoteCard.ts`). The box takes no click (5A-13), and never shows while that note's
 * card is open.
 *
 * Dismissed as the link's card is (`tabs/cardPreview.tsx`): the pointer leaving the cell, and a key, a click, the wheel
 * or a scroll anywhere, listened to only while a dwell or a box is live. Built on the pointer only: the view's own
 * `mousemove` (one `closest` for the cell with a note), nothing on a key or a caret move. The box goes on the page's
 * body (table.css draws it), not in the editor's DOM.
 */
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { HOVER_PREVIEW_DWELL_MS } from '../../sidebar/HoverPreviewHost'
import { cellPosAround } from '../outline/listNodes'
import { CELL_NOTE_CELL_CLASS, cellNoteOf, cellNoteTitle, notePosOf, openCellNoteLabel } from './cellNotes'

/** How many lines the box shows. */
export const PREVIEW_LINES = 6

/** A list item's marker as plain text: a to-do's box, a number, else a bullet. */
const marker = (list: ProseNode, item: ProseNode, index: number): string =>
  item.attrs.checked === true ? '☑ ' : item.attrs.checked === false ? '☐ ' : list.type.name === 'ordered_list' ? `${(list.attrs.order as number) + index}. ` : '• '

/** The first `max` lines of a cell note as plain text: each line of a bullet after its marker, nested ones indented. */
export function cellNotePreviewLines(note: ProseNode, max = PREVIEW_LINES): string[] {
  const lines: string[] = []
  const visit = (block: ProseNode, indent: string, first: string) => {
    block.forEach((child, _offset, index) => {
      if (lines.length >= max) return
      if (child.isTextblock) lines.push(indent + (index === 0 ? first : ' '.repeat(first.length)) + child.textContent)
      else child.forEach((item, _o, n) => visit(item, block === note ? indent : `${indent}  `, marker(child, item, n)))
    })
  }
  visit(note, '', '')
  return lines
}

/** The box for the cell note of `cell`, beside the cell's top-right corner; null when the note is not there. */
function previewBox(view: EditorView, cell: Element): HTMLElement | null {
  const { doc } = view.state
  const cellPos = cellPosAround(doc.resolve(view.posAtDOM(cell, 0)))
  const label = cellPos === null ? null : cellNoteOf(doc, cellPos)
  const pos = label === null || label === openCellNoteLabel(view.state) ? null : notePosOf(doc, label)
  if (pos === null) return null
  const box = document.createElement('div')
  box.className = 'cell-note-preview'
  box.setAttribute('role', 'status')
  const header = document.createElement('div')
  header.className = 'cell-note-preview__header'
  header.textContent = cellNoteTitle(doc, label!)
  const hint = document.createElement('div')
  hint.className = 'cell-note-preview__hint'
  hint.textContent = 'Click the corner to open'
  const body = document.createElement('div')
  body.className = 'cell-note-preview__body'
  for (const text of cellNotePreviewLines(view.state.doc.nodeAt(pos)!)) {
    const line = document.createElement('div')
    line.className = 'cell-note-preview__line'
    line.textContent = text
    body.appendChild(line)
  }
  box.append(header, hint, body)
  // Right of the corner, or left of it at the window's edge (the box is 260px wide).
  const rect = cell.getBoundingClientRect()
  box.style.left = `${rect.right + 4 + 260 > window.innerWidth ? Math.max(0, rect.right - 264) : rect.right + 4}px`
  box.style.top = `${rect.top}px`
  return box
}

export const cellNotePreview = $prose(() => {
  /** The cell with a note the pointer rests on, its dwell, and its box. */
  let corner: HTMLElement | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let box: HTMLElement | null = null
  const events = ['keydown', 'mousedown', 'wheel', 'scroll'] as const
  const close = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    box?.remove()
    box = null
    corner = null
    for (const type of events) window.removeEventListener(type, close, true)
  }
  return new Plugin({
    key: new PluginKey('mdapp-cell-note-preview'),
    props: {
      handleDOMEvents: {
        mousemove: (view, event) => {
          const cell = event.target instanceof Element ? event.target.closest<HTMLElement>(`.${CELL_NOTE_CELL_CLASS}`) : null
          const over = cell !== null && view.dom.contains(cell) ? cell : null
          if (over === corner) return false
          close()
          if (over === null) return false
          corner = over
          for (const type of events) window.addEventListener(type, close, true)
          timer = setTimeout(() => {
            timer = null
            const shown = corner === null ? null : previewBox(view, corner)
            if (shown !== null) box = document.body.appendChild(shown)
          }, HOVER_PREVIEW_DWELL_MS)
          return false
        },
        // Out of the cell. Inside it, the next `mousemove` tells.
        mouseout: (_view, event) => {
          if (corner !== null && !(event.relatedTarget instanceof Node && corner.contains(event.relatedTarget))) close()
          return false
        },
      },
    },
    view: () => ({ destroy: close }),
  })
})
