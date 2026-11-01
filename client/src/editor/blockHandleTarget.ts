/**
 * Where the 6-dot block handle points. The handle floats in the gutter left of the block, so
 * the block it belongs to is found by probing just right of the handle at the pointer's y.
 */
import type { Node } from '@milkdown/kit/prose/model'
import type { Selection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { cssZoom } from '../lib/cssZoom'
import { isListItem } from './outline/listNodes'

/** How far right of the handle to probe for the block it points at (the gutter is ~24px). */
export const PROBE_OFFSET_PX = 24

/** Element, not HTMLElement: the pointer usually lands on the icon's <svg>/<path>. */
export const isDragHandleGrab = (t: EventTarget | null): t is Element =>
  t instanceof Element && t.closest('.milkdown-block-handle .operation-item') !== null

/** A grab on THIS editor's own handle (tabs keep hidden editors mounted, each with its own handle). */
export const isOwnHandleGrab = (view: EditorView, t: EventTarget | null): t is Element =>
  isDragHandleGrab(t) && (view.dom.parentElement?.contains(t) ?? false)

export interface HandleTarget {
  pos: number
  inside: number
  /**
   * The selection before the right-click, when it was on the text (YAZ-3727 D15): a right-click there can
   * select the word under the pointer first, and that word is no highlight of the user's.
   */
  selection?: Selection
}

/** A task's checkbox in this editor (YAZ-3694 F7): the `.label-wrapper` of a task item. Another editor's box is not this one's. */
export function isTaskBox(view: EditorView, t: EventTarget | null): boolean {
  const box = t instanceof Element ? t.closest('.label-wrapper') : null
  return box !== null && view.dom.contains(box) && box.querySelector('.label.checked, .label.unchecked') !== null
}

/**
 * A right-click on a bullet's own dot (YAZ-3646 D8), a number, or a task's checkbox (YAZ-3727 D20: a right press
 * there ticks nothing, YAZ-3694 F7): its list item, as the handle would point at it. Another editor's dot is not this one's.
 */
export function bulletDotTarget(view: EditorView, t: EventTarget | null): HandleTarget | null {
  const dot = t instanceof Element ? t.closest('.label-wrapper') : null
  if (dot === null || !view.dom.contains(dot)) return null
  // As the handle's probe gives it for a hovered item: the position BEFORE the list_item (`nearestListItem`).
  const $pos = view.state.doc.resolve(view.posAtDOM(dot, 0))
  if (!isListItem($pos.parent)) return null
  const item = $pos.before()
  return { pos: item, inside: item }
}

/**
 * Where the handle points: probe PROBE_OFFSET_PX right of the handle at the pointer's y. Null
 * when the probe misses. `pos` lands on the block's start boundary, so consumers that need the
 * enclosing node (e.g. a list_item) must use `inside`.
 */
export function handleTargetPos(view: EditorView, e: MouseEvent): HandleTarget | null {
  const handle = (e.target as Element).closest('.milkdown-block-handle')!
  const rect = handle.getBoundingClientRect()
  // The handle floats beside the zoomed content at 100% (D14), so the probe scales with the content.
  const probe = view.posAtCoords({ left: rect.right + PROBE_OFFSET_PX * cssZoom(view.dom), top: e.clientY })
  return probe === null ? null : { pos: probe.pos, inside: probe.inside }
}

/**
 * The line a right-click on its text is in (YAZ-3727 D15), as the handle points at it: a bullet's first line
 * stands for its bullet, any other line for itself. A right-click beside the text, in a bullet's row (the gap
 * after a checkbox, D22), stands for that bullet, and one in the indent left of a child line for that child. Null elsewhere off a line, and in code or a table cell,
 * which have menus of their own.
 */
export function textLineTarget(doc: Node, pos: number, selection: Selection): HandleTarget | null {
  const $pos = doc.resolve(pos)
  if (!$pos.parent.isTextblock) {
    // In the indent left of a child line (6B nit): the bullet right after the pointer, not the one around it.
    const after = $pos.nodeAfter
    const first = after?.firstChild ?? null
    const child = after !== null && isListItem(after) ? pos : isListItem($pos.parent) && first !== null && isListItem(first) ? pos + 1 : null
    if (child !== null) return { pos: child, inside: child, selection }
    for (let depth = $pos.depth; depth > 0; depth--) {
      if ($pos.node(depth).type.spec.tableRole !== undefined) return null
      if (isListItem($pos.node(depth))) return { pos: $pos.before(depth), inside: $pos.before(depth), selection }
    }
    return null
  }
  if ($pos.parent.type.spec.code === true) return null
  for (let depth = $pos.depth; depth > 0; depth--) if ($pos.node(depth).type.spec.tableRole !== undefined) return null
  const at = $pos.depth > 1 && isListItem($pos.node(-1)) && $pos.index(-1) === 0 ? $pos.before(-1) : $pos.before()
  return { pos: at, inside: at, selection }
}
