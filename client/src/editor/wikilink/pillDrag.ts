/**
 * A drag across a link pill (YAZ-5960): the pill joins the selection when the pointer passes its middle, and leaves it
 * when the pointer goes back before the middle, as a letter does. The browser's letter position under the pointer
 * says nothing useful over a pill (its `[[`, `]]` and an ID link's id are hidden, its title is a widget), so the head
 * was put on the edge nearer that letter, and the pill lit only at its far edge. Here the pointer itself decides,
 * against the pill's boxes: it does not flip while the pointer stays in one half, whatever letter the browser picks.
 *
 * `trackDrag` follows a plain press of the main button (no double- or triple-click: their word and line are their
 * own) from the press to the button's release, and reports the pointer only once it has moved 4px, so a click stays a
 * click. Nothing listens between drags: typing pays nothing.
 */
import type { EditorView } from '@milkdown/kit/prose/view'
import { WIKILINK_CLASS } from './cardPill'

/** `BOARD_EMBED_CLASS` (`boardEmbed.ts`, which imports `idLinkCaret.ts`: named here, not imported, to keep no cycle). */
const BOARD_EMBED_CLASS = 'board-embed'

export type Pointer = { x: number; y: number }

/** A line of the pill: the union of its boxes on one line. */
type Line = { left: number; right: number; top: number; bottom: number }

/**
 * Whether the widget at `pos` is a piece of the link at `from`..`to`. A `[[link]]`'s widget stands inside it or at its
 * end (`side: -1`); one at its start is the end of the link before. A Markdown link pill's head and tail stand at its
 * edges inside the link's anchor (`marks`), so the anchor says whose they are: one that starts in the link.
 */
function widgetOf(view: EditorView, widget: Element, pos: number, from: number, to: number): boolean {
  const anchor = widget.parentElement?.closest('a')
  if (anchor === null || anchor === undefined || !view.dom.contains(anchor)) return pos > from && pos <= to
  try {
    const start = view.posAtDOM(anchor, 0)
    return start >= from && start < to
  } catch {
    return false
  }
}

/** The boxes the link at `from`..`to` shows, as lines in reading order; empty when it shows none (a test's DOM). */
function pillLines(view: EditorView, from: number, to: number): Line[] {
  let block: Node | null
  try {
    const $from = view.state.doc.resolve(from)
    block = $from.depth === 0 ? null : view.nodeDOM($from.before())
  } catch {
    return []
  }
  if (!(block instanceof HTMLElement)) return []
  const rects: DOMRect[] = []
  for (const el of block.querySelectorAll(`.${WIKILINK_CLASS}, .${BOARD_EMBED_CLASS}`)) {
    const widget = el.closest('.ProseMirror-widget')
    let pos: number
    try {
      pos = view.posAtDOM(widget ?? el, 0)
    } catch {
      continue
    }
    if (!(el.classList.contains(BOARD_EMBED_CLASS) ? pos === from : widget !== null ? widgetOf(view, widget, pos, from, to) : pos >= from && pos < to)) continue
    for (const r of el.getClientRects()) if (r.width > 0 || r.height > 0) rects.push(r)
  }
  rects.sort((a, b) => a.top - b.top || a.left - b.left)
  const lines: Line[] = []
  for (const r of rects) {
    const line = lines[lines.length - 1]
    const middle = (r.top + r.bottom) / 2
    if (line !== undefined && middle >= line.top && middle <= line.bottom) {
      line.left = Math.min(line.left, r.left)
      line.right = Math.max(line.right, r.right)
      line.top = Math.min(line.top, r.top)
      line.bottom = Math.max(line.bottom, r.bottom)
    } else lines.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })
  }
  return lines
}

/**
 * Whether the pointer is past the middle of the pill of the link at `from`..`to`, in reading order: a line below the
 * pill is past all of it, a line above it before all of it, and on a line of it the pointer counts up to its x. A pill
 * that wraps counts its lines one after another. Null when the pill shows no box: the caller keeps its own rule.
 */
export function pastMiddle(view: EditorView, from: number, to: number, pointer: Pointer): boolean | null {
  const lines = pillLines(view, from, to)
  let total = 0
  for (const line of lines) total += line.right - line.left
  if (total <= 0) return null
  let passed = 0
  for (const line of lines) {
    const width = line.right - line.left
    if (pointer.y < line.top) break
    if (pointer.y > line.bottom) {
      passed += width
      continue
    }
    passed += Math.min(width, Math.max(0, pointer.x - line.left))
    break
  }
  // As a click does (`nearerEdge`): the exact middle is past it.
  return passed * 2 >= total
}

/**
 * Follows a drag in `view`: the pointer while the main button is held after a plain press, once it moved 4px, else
 * null. A move with no button held ends the drag, as ProseMirror's own does: the mouseup can be lost outside the window.
 */
export function trackDrag(view: EditorView): { pointer: () => Pointer | null; destroy: () => void } {
  const doc = view.dom.ownerDocument
  let start: Pointer | null = null
  let pointer: Pointer | null = null
  const move = (event: MouseEvent) => {
    if ((event.buttons & 1) === 0) return up()
    if (pointer === null && start !== null && Math.abs(event.clientX - start.x) + Math.abs(event.clientY - start.y) < 4) return
    pointer = { x: event.clientX, y: event.clientY }
  }
  const up = () => {
    start = null
    pointer = null
    doc.removeEventListener('mousemove', move, true)
    doc.removeEventListener('mouseup', up, true)
  }
  // Capture, on the editor: it runs before any handler of the editor's (a click on a pill takes the press for its own).
  const down = (event: MouseEvent) => {
    up()
    if (event.button !== 0 || event.detail > 1) return
    start = { x: event.clientX, y: event.clientY }
    doc.addEventListener('mousemove', move, true)
    doc.addEventListener('mouseup', up, true)
  }
  view.dom.addEventListener('mousedown', down, true)
  return {
    pointer: () => pointer,
    destroy: () => {
      up()
      view.dom.removeEventListener('mousedown', down, true)
    },
  }
}
