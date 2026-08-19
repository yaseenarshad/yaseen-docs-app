/** List node helpers shared by the folding plugin and the outliner keymap. */
import type { Node as ProseNode } from '@milkdown/kit/prose/model'

export const LIST_NODE_NAMES: ReadonlySet<string> = new Set(['bullet_list', 'ordered_list'])

export interface NestedList {
  list: ProseNode
  /** Offset of the list inside the item (`itemPos + 1 + offset` is its document position). */
  offset: number
}

/** The first nested list owned by a list_item, or null for a leaf item. */
export const findNestedList = (item: ProseNode): NestedList | null => {
  let found: NestedList | null = null
  item.forEach((child, offset) => {
    if (found === null && LIST_NODE_NAMES.has(child.type.name)) found = { list: child, offset }
  })
  return found
}
