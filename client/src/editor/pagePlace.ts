/**
 * WHERE YOU STAND IN A PAGE, AS A PLACE IN ITS TEXT (YAZ-5164: "it should keep me and maintain the scroll of where I am,
 * so that way I can just start editing wherever I am"). A tab keeps its place in px (`PageView.scrollTop`): the copy is
 * the same editor, so the same px show the same text. Explore's reading layer and its editor are two views of the same
 * text with other things above it (the editor's title and Properties), so px would land somewhere else. The place is
 * the top-level block at the scroller's top edge instead: its document position, and how far below the edge it starts.
 * Both views parse the same Markdown, so the position names the same block in each.
 */
import type { EditorView } from '@milkdown/kit/prose/view'

/** The block at a scroller's top edge: its document position, and how far below the edge it starts, px (negative: above). */
export interface PagePlace {
  pos: number
  offset: number
}

/** A page place, and where the caret goes so the next key types there: the first block that starts in view. */
export interface ReadPlace extends PagePlace {
  caret: number
}

/** A block's box, or null when it is not drawn (folded away, or not an element). */
function boxOf(view: EditorView, pos: number): DOMRect | null {
  const dom = view.nodeDOM(pos)
  if (!(dom instanceof HTMLElement) || dom.getClientRects().length === 0) return null
  return dom.getBoundingClientRect()
}

/**
 * Where `scroller` stands in `view`'s page: the first top-level block that reaches below its top edge, or `pinned` (a
 * card the person chose: Edit card keeps THAT card where it is on screen). Null when nothing is drawn.
 */
export function readPagePlace(view: EditorView, scroller: Element, pinned?: Element): ReadPlace | null {
  const { top: edge, bottom } = scroller.getBoundingClientRect()
  let place: PagePlace | null = null
  let caret: number | null = null
  let done = false
  if (pinned !== undefined) {
    view.state.doc.descendants((_node, pos) => {
      if (place !== null) return false
      if (view.nodeDOM(pos) !== pinned) return true
      place = { pos, offset: pinned.getBoundingClientRect().top - edge }
      caret = pos + 1
      return false
    })
  }
  // A block that starts below the scroller's bottom edge is out of view: the caret then goes into the top block.
  view.state.doc.forEach((_node, pos) => {
    if (done || caret !== null) return
    const box = boxOf(view, pos)
    if (box === null || box.bottom <= edge) return
    place ??= { pos, offset: box.top - edge }
    if (box.top >= bottom) done = true
    else if (box.top >= edge) caret = pos + 1
  })
  const found = place as PagePlace | null
  return found === null ? null : { ...found, caret: caret ?? found.pos + 1 }
}

/** Puts `place` back: `scroller` scrolls so the block at its position starts `offset` below the top edge. False when that block is not drawn. */
export function showPagePlace(view: EditorView, scroller: Element, place: PagePlace): boolean {
  if (place.pos < 0 || place.pos >= view.state.doc.content.size) return false
  const box = boxOf(view, place.pos)
  if (box === null) return false
  scroller.scrollTop += box.top - scroller.getBoundingClientRect().top - place.offset
  return true
}
