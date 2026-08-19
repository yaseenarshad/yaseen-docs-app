/** List node helpers shared by the folding plugin and the outliner keymap. */
import type { Node as ProseNode } from '@milkdown/kit/prose/model'

export const LIST_NODE_NAMES: ReadonlySet<string> = new Set(['bullet_list', 'ordered_list'])

export interface NestedList {
  list: ProseNode
  /** Offset of the list inside the item (`itemPos + 1 + offset` is its document position). */
  offset: number
}

/** Every nested list owned by a list_item, in order. Mixed markers (`*` vs `-`) parse as sibling lists. */
export const findNestedLists = (item: ProseNode): NestedList[] => {
  const found: NestedList[] = []
  item.forEach((child, offset) => {
    if (LIST_NODE_NAMES.has(child.type.name)) found.push({ list: child, offset })
  })
  return found
}

/** The first nested list owned by a list_item, or null for a leaf item. */
export const findNestedList = (item: ProseNode): NestedList | null => findNestedLists(item)[0] ?? null
