/**
 * "Number children" block-handle action (YAZ-728): flip every direct child list of a list_item
 * between bullet and ordered. Grandchild lists are untouched and paragraph text is never read
 * or written — a hand-typed `1) Setup` stays `1) Setup`. One transaction, one undo step.
 */
import type { Ctx } from '@milkdown/kit/ctx'
import { bulletListSchema, orderedListSchema } from '@milkdown/kit/preset/commonmark'
import type { Node } from '@milkdown/kit/prose/model'
import type { EditorState, Transaction } from '@milkdown/kit/prose/state'
import { findNestedList, findNestedLists, innermostItemPos } from './listNodes'

/** Closest enclosing list_item of `inside` (the node at `inside` itself counts), or null. */
export function nearestListItem(doc: Node, inside: number): { node: Node; pos: number } | null {
  // Not defensive: posAtCoords().inside for a hovered item is the position BEFORE the list_item,
  // where resolve().node(depth) is the list and the ancestor walk would return the grandparent item.
  const at = doc.nodeAt(inside)
  if (at?.type.name === 'list_item') return { node: at, pos: inside }
  const pos = innermostItemPos(doc.resolve(inside))
  return pos === null ? null : { node: doc.nodeAt(pos)!, pos }
}

/** Type of the first direct child list of the enclosing list_item; null when none / not in a list item. */
export function childListState(doc: Node, inside: number): 'bullet' | 'ordered' | null {
  const item = nearestListItem(doc, inside)
  const first = item && findNestedList(item.node)
  return first === null ? null : first.list.type.name === 'bullet_list' ? 'bullet' : 'ordered'
}

/**
 * Flip every direct child list of the enclosing list_item. Grandchildren untouched. One transaction. Never touches text.
 * Each item's `listType` and `label` follow on dispatch: `listMarkers` sets them from the new list (YAZ-3727 D2).
 */
export function toggleNumberedChildren(state: EditorState, inside: number, ctx: Ctx): Transaction | null {
  const item = nearestListItem(state.doc, inside)
  if (!item) return null
  const lists = findNestedLists(item.node)
  if (lists.length === 0) return null
  const tr = state.tr
  // setNodeMarkup never changes node sizes, so positions computed on the original doc stay valid.
  for (const { list, offset } of lists) {
    const toOrdered = list.type.name === 'bullet_list'
    const listPos = item.pos + 1 + offset
    tr.setNodeMarkup(
      listPos,
      toOrdered ? orderedListSchema.type(ctx) : bulletListSchema.type(ctx),
      toOrdered ? { order: 1, spread: list.attrs.spread } : { spread: list.attrs.spread },
    )
  }
  return tr
}

/**
 * "Bullets with written numbers" (YAZ-3727 D12): the numbered list that holds the item becomes a bullet list, and each
 * of its lines gets its shown number written at the start of its text as `n) ` (`3. apples` → `* 3) apples`, literal
 * bullet text under rule 8). Sublists are untouched. One transaction; null when the item is in no numbered list.
 */
export function writeNumbersAsText(state: EditorState, inside: number, ctx: Ctx): Transaction | null {
  const item = nearestListItem(state.doc, inside)
  if (!item) return null
  const $item = state.doc.resolve(item.pos)
  const list = $item.parent
  if (list.type !== orderedListSchema.type(ctx)) return null
  const listPos = $item.before()
  const tr = state.tr
  // Last line first, so each insert leaves the positions before it as they were.
  for (let index = list.childCount - 1; index >= 0; index--) {
    const line = list.child(index)
    let at = listPos + 1
    for (let i = 0; i < index; i++) at += list.child(i).nodeSize
    const shown = Number.parseInt(String(line.attrs.label), 10)
    const label = `${Number.isNaN(shown) ? (list.attrs.order as number) + index : shown}) `
    if (line.firstChild?.isTextblock) tr.insertText(label, at + 2)
    else tr.insert(at + 1, state.schema.nodes.paragraph.create(null, state.schema.text(label)))
  }
  tr.setNodeMarkup(listPos, bulletListSchema.type(ctx), { spread: list.attrs.spread })
  return tr
}
