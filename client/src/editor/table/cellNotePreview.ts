/**
 * The hover cards of a note table's cells (YAZ-3818 D14, YAZ-4901), one controller (`cellHoverCard.ts`) per editor:
 *
 * - A cell with a note (the YAZ-3818 demo): rest the pointer anywhere on it for the hover dwell (`HOVER_PREVIEW_DWELL_MS`,
 *   as a note's link hover, `wikilink/wikilinkHover.ts`) and a small read-only box shows beside the cell, with the note's
 *   title ("Note: <column> · <row>"), the hint "Click the corner to open", and its first 6 lines as plain text (a bullet
 *   as `• `). A click in the cell puts the caret there as always; a click on the corner opens the note's card
 *   (`cellNoteCard.ts`). The box takes no click (5A-13), and never shows while that note's card is open.
 * - A cut cell (YAZ-4901; Clip, YAZ-4900, its line wider inside than out, checked on the hover only): after 250 ms the
 *   full-text card under the cell, the cell's lines as the note preview writes them (a bullet `• `, a to-do ☐ / ☑), up to
 *   12 then "…". No macOS tooltip. Never while the caret is in that cell (item 9). In a read-only note too (item 12).
 * - A cut cell WITH a note (item 10): ONE card at the full-text card's place and wait: the full text, a line, then the
 *   note's part as above.
 *
 * Dismissed as the link's card is (`tabs/cardPreview.tsx`): the pointer leaving the cell, and a key, a click, the wheel
 * or a scroll anywhere, listened to only while a dwell or a card is live. Built on the pointer only: the view's own
 * `mousemove` (one `closest` for the cell), nothing on a key or a caret move. The box goes on the page's body
 * (`cellHoverCard.css` draws it), not in the editor's DOM.
 */
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { HOVER_PREVIEW_DWELL_MS } from '../../sidebar/HoverPreviewHost'
import { cellPosAround } from '../outline/listNodes'
import { CARD_TEXT_LINES, CUT_CARD_DWELL_MS, type CellCard, cardShell, cellHoverCards, textPart } from './cellHoverCard'
import { cellNoteOf, cellNoteTitle, notePosOf, openCellNoteLabel } from './cellNotes'

/** How many lines the note's box shows. */
export const PREVIEW_LINES = 6

/** A list item's marker as plain text: a to-do's box, a number, else a bullet. */
const marker = (list: ProseNode, item: ProseNode, index: number): string =>
  item.attrs.checked === true ? '☑ ' : item.attrs.checked === false ? '☐ ' : list.type.name === 'ordered_list' ? `${(list.attrs.order as number) + index}. ` : '• '

/** The first `max` lines of a cell note (or of a cell) as plain text: each line of a bullet after its marker, nested ones indented. */
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

/** Is this cell's text cut (YAZ-4900)? A clipped cell has a line (any `p`: plain, bullet, sub-bullet, to-do) wider inside than out. */
const isCut = (cell: HTMLElement): boolean => Array.from(cell.querySelectorAll('p')).some((line) => line.scrollWidth > line.clientWidth + 1)

/** The note's part of a card: its title, the hint, and its first lines. */
function noteParts(view: EditorView, label: string, pos: number): HTMLElement[] {
  const header = document.createElement('div')
  header.className = 'cell-note-preview__header'
  header.textContent = cellNoteTitle(view.state.doc, label)
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
  return [header, hint, body]
}

/** The card of `cell`: the full text (cut), the note (one that is not open), both, or null. */
function cellCard(view: EditorView, cell: HTMLElement): CellCard | null {
  const { doc, selection } = view.state
  const cellPos = cellPosAround(doc.resolve(view.posAtDOM(cell, 0)))
  if (cellPos === null) return null
  // No card while the caret is in that cell (item 9).
  if (view.hasFocus() && cellPosAround(selection.$from) === cellPos) return null
  const cut = isCut(cell)
  const label = cellNoteOf(doc, cellPos)
  const notePos = label === null || label === openCellNoteLabel(view.state) ? null : notePosOf(doc, label)
  if (!cut && notePos === null) return null
  const box = cardShell()
  if (cut) box.appendChild(textPart(cellNotePreviewLines(doc.nodeAt(cellPos)!, CARD_TEXT_LINES + 1)))
  if (notePos !== null) box.append(...noteParts(view, label!, notePos))
  if (cut) return { box, dwell: CUT_CARD_DWELL_MS, under: true }
  // The note's box: right of the corner, or left of it at the window's edge (the box is 260px wide).
  const rect = cell.getBoundingClientRect()
  box.style.left = `${rect.right + 4 + 260 > window.innerWidth ? Math.max(0, rect.right - 264) : rect.right + 4}px`
  box.style.top = `${rect.top}px`
  return { box, dwell: HOVER_PREVIEW_DWELL_MS, under: false }
}

export const cellNotePreview = $prose(() => {
  let cards: ReturnType<typeof cellHoverCards> | null = null
  return new Plugin({
    key: new PluginKey('mdapp-cell-note-preview'),
    props: {
      handleDOMEvents: {
        mousemove: (view, event) => {
          const cell = event.target instanceof Element ? event.target.closest<HTMLElement>('td, th') : null
          // A cell of THIS editor: a cell note card's editor can sit inside the note's DOM, and it has a controller of its own.
          cards?.enter(cell !== null && cell.closest('.ProseMirror') === view.dom ? cell : null)
          return false
        },
        // Out of the editor. Inside it, the next `mousemove` tells.
        mouseout: (view, event) => {
          if (!(event.relatedTarget instanceof Node && view.dom.contains(event.relatedTarget))) cards?.enter(null)
          return false
        },
      },
    },
    view: (view) => {
      cards = cellHoverCards((cell) => cellCard(view, cell))
      return { destroy: () => cards?.destroy() }
    },
  })
})
