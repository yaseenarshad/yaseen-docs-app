/**
 * A cell note's preview (YAZ-3818 D14), as a note's link hover (`wikilink/wikilinkHover.ts`): rest the pointer on a
 * cell's mark for the hover dwell (`HOVER_PREVIEW_DWELL_MS`) and a small read-only box shows beside the cell, with the
 * note's crumb ("Note: <column> · <row>"), "Click to open", and its first 6 lines as plain text (a bullet as `• `). A
 * click on the mark opens the note's page (`zoom.ts`).
 *
 * Dismissed as the link's card is (`tabs/cardPreview.tsx`): the pointer leaving the mark, and a key, a click, the wheel
 * or a scroll anywhere, listened to only while a dwell or a box is live. Built on hover only: the view's own DOM events,
 * nothing on a key or a caret move. The box goes on the page's body (table.css draws it), not in the editor's DOM.
 */
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { HOVER_PREVIEW_DWELL_MS } from '../../sidebar/HoverPreviewHost'
import { itemPosForZoomKey, zoomLabelAt } from '../outline/zoom'
import { CELL_NOTE_LABEL } from './cellNotes'

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

/** The mark under a pointer event, in a cell of this editor, or null. */
function markAt(view: EditorView, target: EventTarget | null): HTMLElement | null {
  const mark = target instanceof Element ? target.closest<HTMLElement>('sup[data-type="footnote_reference"]') : null
  return mark !== null && view.dom.contains(mark) && CELL_NOTE_LABEL.test(mark.dataset.label ?? '') && mark.closest('td, th') !== null ? mark : null
}

/** The box for the cell note labelled `label`, beside `cell`'s top-right corner; null when the note is not there. */
function previewBox(view: EditorView, label: string, cell: Element): HTMLElement | null {
  const pos = itemPosForZoomKey(view.state.doc, `note:${label}`)
  if (pos === null) return null
  const box = document.createElement('div')
  box.className = 'cell-note-preview'
  box.setAttribute('role', 'status')
  const header = document.createElement('div')
  header.className = 'cell-note-preview__header'
  header.textContent = zoomLabelAt(view.state, pos)
  const hint = document.createElement('div')
  hint.className = 'cell-note-preview__hint'
  hint.textContent = 'Click to open'
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
  /** The mark the pointer rests on, its dwell, and its box. */
  let mark: HTMLElement | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let box: HTMLElement | null = null
  const events = ['keydown', 'mousedown', 'wheel', 'scroll'] as const
  const close = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    box?.remove()
    box = null
    mark = null
    for (const type of events) window.removeEventListener(type, close, true)
  }
  return new Plugin({
    key: new PluginKey('mdapp-cell-note-preview'),
    props: {
      handleDOMEvents: {
        mouseover: (view, event) => {
          const over = markAt(view, event.target)
          if (over === null || over === mark) return false
          close()
          mark = over
          for (const type of events) window.addEventListener(type, close, true)
          timer = setTimeout(() => {
            timer = null
            const shown = mark === null ? null : previewBox(view, mark.dataset.label!, mark.closest('td, th')!)
            if (shown !== null) box = document.body.appendChild(shown)
          }, HOVER_PREVIEW_DWELL_MS)
          return false
        },
        mouseout: (view, event) => {
          if (mark !== null && markAt(view, event.relatedTarget) !== mark) close()
          return false
        },
      },
    },
    view: () => ({ destroy: close }),
  })
})
