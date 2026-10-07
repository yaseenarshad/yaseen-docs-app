/**
 * The search results as a TREE (YAZ-2620, overturning the flat-list ruling on YAZ-739 for the
 * sidebar): the Files tree cut down to the matched rows and the folders that lead to them, so a
 * result keeps its place. The `Tree` component draws the cut as it draws any tree.
 */
import type { TreeNode } from '@shared/types'

export interface SearchTree {
  /** The cut tree: every row is a match, a folder on the way to one, or a row inside a matched folder that holds no match (🔒 D2). */
  nodes: TreeNode[]
  /** The folders that lead to a match: drawn open. */
  open: Set<string>
  /** The matched rows, top to bottom as drawn: what ↑/↓ walk. */
  order: string[]
}

export function searchTree(tree: readonly TreeNode[], hits: ReadonlySet<string>): SearchTree {
  const open = new Set<string>()
  const order: string[] = []
  const cut = (nodes: readonly TreeNode[]): TreeNode[] =>
    nodes.flatMap((n): TreeNode[] => {
      const hit = hits.has(n.path)
      if (hit) order.push(n.path)
      if (n.type === 'file') return hit ? [n] : []
      const kept = cut(n.children)
      // A matched folder with no match inside keeps ALL it holds, closed (🔒 D2): one click looks inside.
      if (kept.length === 0) return hit ? [n] : []
      open.add(n.path)
      return [{ ...n, children: kept }]
    })
  return { nodes: cut(tree), open, order }
}
