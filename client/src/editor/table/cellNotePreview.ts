/**
 * The hover cards of a page table's cells (YAZ-3818 D14, YAZ-4901), one controller (`cellHoverCard.ts`) per editor:
 *
 * - A cell with a note (the YAZ-3818 demo): rest the pointer anywhere on it for the hover dwell (`HOVER_PREVIEW_DWELL_MS`,
 *   as a note's link hover, `wikilink/wikilinkHover.ts`) and a small read-only box shows beside the cell, with the note's
 *   title ("Note: <column> · <row>"), the hint "Click the corner to open", and its first lines as plain text (a bullet
 *   as `• `): Settings › Tables › Cell notes › Hover preview lines, 20 by default, then "…" when the note has more
 *   (YAZ-5717). A long line wraps; the box is 360 px wide and stays inside the window. A click in the cell puts the
 *   caret there as always; a click on the corner opens the note's card (`cellNoteCard.ts`). The box takes no click
 *   (5A-13), and never shows while that note's card is open.
 * - A cut cell (YAZ-4901; Clip, YAZ-4900, its line wider inside than out, checked on the hover only): after 250 ms the
 *   full-text card under the cell, the cell's lines as the note preview writes them (a bullet `• `, a to-do ☐ / ☑), up to
 *   12 then "…". No macOS tooltip. Never while the caret is in that cell (item 9). In a read-only page too (item 12).
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
import { CELL_NOTE_PREVIEW_LINES_MAX, CELL_NOTE_PREVIEW_LINES_MIN, DEFAULT_SETTINGS } from '@shared/types'
import { HOVER_PREVIEW_DWELL_MS } from '../../sidebar/HoverPreviewHost'
import { cellPosAround } from '../outline/listNodes'
import { CARD_TEXT_LINES, CUT_CARD_DWELL_MS, type CellCard, cardShell, cellHoverCards, textPart } from './cellHoverCard'
import { cellNoteOf, cellNoteTitle, notePosOf, openCellNoteLabel } from './cellNotes'

/** How wide the note's box is, in px: `.cell-note-preview` in `cellHoverCard.css` says the same (YAZ-5717). */
export const CELL_NOTE_BOX_WIDTH = 360

/** How many lines the note's box shows, then "…" (Settings › Tables › Cell notes › Hover preview lines, YAZ-5717). App sets it. */
let previewLines = DEFAULT_SETTINGS.tableCellNotePreviewLines

/** Set how many lines the note's box shows: App, when the setting changes. The next box reads it. Whole lines, 6 to 60. */
export function setCellNotePreviewLines(lines: number): void {
  const n = Number.isFinite(lines) ? Math.round(lines) : DEFAULT_SETTINGS.tableCellNotePreviewLines
  previewLines = Math.min(CELL_NOTE_PREVIEW_LINES_MAX, Math.max(CELL_NOTE_PREVIEW_LINES_MIN, n))
}

/** The body's padding under its last line, in px (`.cell-note-preview__body` in `cellHoverCard.css`). */
const BODY_PAD_BOTTOM = 8

/**
 * A note box that the window cuts (YAZ-5717): its CSS `max-height` is the window less 16px, so in a short window the last
 * lines would end in the middle with no sign. The lines past the box's bottom go, and the last line that shows reads
 * "…". One layout read for the box and its lines, on show only.
 */
export function fitCellNoteLines(box: HTMLElement): void {
  const rect = box.getBoundingClientRect()
  // No layout (a box that is not drawn): nothing to measure.
  if (rect.height === 0) return
  const bottom = rect.bottom - BODY_PAD_BOTTOM
  const lines = Array.from(box.querySelectorAll<HTMLElement>('.cell-note-preview__line'))
  const past = lines.findIndex((line) => line.getBoundingClientRect().bottom > bottom)
  if (past < 0) return
  const keep = Math.max(1, past)
  for (const line of lines.slice(keep)) line.remove()
  lines[keep - 1].textContent = '…'
}

/** A list item's marker as plain text: a to-do's box, a number, else a bullet. */
const marker = (list: ProseNode, item: ProseNode, index: number): string =>
  item.attrs.checked === true ? '☑ ' : item.attrs.checked === false ? '☐ ' : list.type.name === 'ordered_list' ? `${(list.attrs.order as number) + index}. ` : '• '

/** The first `max` lines of a cell note (or of a cell) as plain text: each line of a bullet after its marker, nested ones indented. */
export function cellNotePreviewLines(note: ProseNode, max: number): string[] {
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

/** A preview line's lead: its indent, then a marker (`• `, `☐ `, `☑ `, `1. `) or the spaces of a later line in the same item. */
const LEAD = /^ *(?:• |☐ |☑ |\d+\. )?/

/** One note line. The lead is its own column, so a wrapped row starts under the text, not under the marker (YAZ-5717). */
function noteLine(text: string): HTMLElement {
  const line = document.createElement('div')
  line.className = 'cell-note-preview__line'
  const lead = LEAD.exec(text)![0]
  if (lead === '') {
    line.textContent = text
    return line
  }
  const marker = document.createElement('span')
  marker.className = 'cell-note-preview__lead'
  marker.textContent = lead
  const rest = document.createElement('span')
  rest.className = 'cell-note-preview__line-text'
  rest.textContent = text.slice(lead.length)
  line.append(marker, rest)
  return line
}

/** The note's part of a card: its title, the hint, and its first lines, then "…" when it has more (YAZ-5717). */
function noteParts(view: EditorView, label: string, pos: number): HTMLElement[] {
  const header = document.createElement('div')
  header.className = 'cell-note-preview__header'
  header.textContent = cellNoteTitle(view.state.doc, label)
  const hint = document.createElement('div')
  hint.className = 'cell-note-preview__hint'
  hint.textContent = 'Click the corner to open'
  const body = document.createElement('div')
  body.className = 'cell-note-preview__body'
  // One line more than it shows: that one tells that the note goes on.
  const lines = cellNotePreviewLines(view.state.doc.nodeAt(pos)!, previewLines + 1)
  for (const text of lines.length > previewLines ? [...lines.slice(0, previewLines), '…'] : lines) body.appendChild(noteLine(text))
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
  const pagePos = label === null || label === openCellNoteLabel(view.state) ? null : notePosOf(doc, label)
  if (!cut && pagePos === null) return null
  const box = cardShell()
  if (cut) box.appendChild(textPart(cellNotePreviewLines(doc.nodeAt(cellPos)!, CARD_TEXT_LINES + 1)))
  if (pagePos !== null) box.append(...noteParts(view, label!, pagePos))
  // A cut cell's card with a note fits its note lines too: the window can cut it as it cuts the box (YAZ-5746).
  if (cut) return { box, dwell: CUT_CARD_DWELL_MS, under: true, ...(pagePos !== null && { fit: fitCellNoteLines }) }
  // The note's box: right of the corner, or left of it at the window's edge. `cellHoverCards` moves it up when its
  // bottom is below the window (YAZ-5717).
  const rect = cell.getBoundingClientRect()
  box.style.left = `${rect.right + 4 + CELL_NOTE_BOX_WIDTH > window.innerWidth ? Math.max(0, rect.right - 4 - CELL_NOTE_BOX_WIDTH) : rect.right + 4}px`
  box.style.top = `${rect.top}px`
  return { box, dwell: HOVER_PREVIEW_DWELL_MS, under: false, fit: fitCellNoteLines }
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
