/**
 * "Number children" block-handle action (YAZ-728): flip every direct child list of a list_item
 * between bullet and ordered. Grandchild lists are untouched and paragraph text is never read
 * or written — a hand-typed `1) Setup` stays `1) Setup`. One transaction, one undo step.
 */
import type { Ctx } from '@milkdown/kit/ctx'
import { bulletListSchema, orderedListSchema } from '@milkdown/kit/preset/commonmark'
import type { Node } from '@milkdown/kit/prose/model'
import type { EditorState, Transaction } from '@milkdown/kit/prose/state'
import { LIST_NODE_NAMES } from './listNodes'

/** Closest enclosing list_item of `inside` (the node at `inside` itself counts), or null. */
export function nearestListItem(doc: Node, inside: number): { node: Node; pos: number } | null {
  const at = doc.nodeAt(inside)
  if (at?.type.name === 'list_item') return { node: at, pos: inside }
  const $pos = doc.resolve(inside)
  for (let depth = $pos.depth; depth >= 1; depth--) {
    const node = $pos.node(depth)
    if (node.type.name === 'list_item') return { node, pos: $pos.before(depth) }
  }
  return null
}

/** Type of the first direct child list of the enclosing list_item; null when none / not in a list item. */
export function childListState(doc: Node, inside: number): 'bullet' | 'ordered' | null {
  const item = nearestListItem(doc, inside)
  if (!item) return null
  let state: 'bullet' | 'ordered' | null = null
  item.node.forEach((child) => {
    if (state === null && LIST_NODE_NAMES.has(child.type.name)) {
      state = child.type.name === 'bullet_list' ? 'bullet' : 'ordered'
    }
  })
  return state
}

/** Flip every direct child list of the enclosing list_item. Grandchildren untouched. One transaction. Never touches text. */
export function toggleNumberedChildren(state: EditorState, inside: number, ctx: Ctx): Transaction | null {
  const item = nearestListItem(state.doc, inside)
  if (!item) return null
  const tr = state.tr
  let flipped = false
  // setNodeMarkup never changes node sizes, so positions computed on the original doc stay valid.
  item.node.forEach((list, offset) => {
    if (!LIST_NODE_NAMES.has(list.type.name)) return
    flipped = true
    const toOrdered = list.type.name === 'bullet_list'
    const listPos = item.pos + 1 + offset
    tr.setNodeMarkup(
      listPos,
      toOrdered ? orderedListSchema.type(ctx) : bulletListSchema.type(ctx),
      toOrdered ? { order: 1, spread: list.attrs.spread } : { spread: list.attrs.spread },
    )
    list.forEach((li, liOffset, i) => {
      tr.setNodeMarkup(listPos + 1 + liOffset, undefined, {
        ...li.attrs,
        listType: toOrdered ? 'ordered' : 'bullet',
        label: toOrdered ? `${i + 1}.` : '•',
      })
    })
  })
  return flipped ? tr : null
}
