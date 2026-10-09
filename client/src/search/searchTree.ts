/**
 * The search results as a TREE (YAZ-2620, overturning the flat-list ruling on YAZ-739 for the
 * sidebar): the Files tree cut down to the matched rows and the folders that lead to them, so a
 * result keeps its place. The `Tree` component draws the cut as it draws any tree.
 */
import type { TreeNode } from '@shared/types'

export interface SearchTree {
  /** The cut tree: every row is a match, a folder on the way to one, a row inside a matched folder that holds no match (🔒 D2), or a row of a folder that shows all (YAZ-2662 D6). */
  nodes: TreeNode[]
  /** The folders that lead to a match, and those that show all: drawn open. */
  open: Set<string>
  /** The rows that ↑/↓ can stop on, top to bottom as the tree holds them: the matches, and each row below a folder that shows all. */
  order: string[]
}

/**
 * `full` is the folders that show ALL (YAZ-2662 D6): such a folder keeps each row that it holds. A
 * folder inside it that leads to a match stays as cut; a row that the cut dropped is the tree's own
 * node, so a folder among them is closed and keeps all it holds (S47). A folder that the search
 * does not draw is not drawn because it shows all.
 */
export function searchTree(tree: readonly TreeNode[], hits: ReadonlySet<string>, full: ReadonlySet<string>): SearchTree {
  const open = new Set<string>()
  const order: string[] = []
  const cut = (nodes: readonly TreeNode[], inside: boolean): TreeNode[] =>
    nodes.flatMap((n): TreeNode[] => {
      const hit = hits.has(n.path)
      if (hit || inside) order.push(n.path)
      if (n.type === 'file') return hit ? [n] : []
      const whole = full.has(n.path)
      const kept = cut(n.children, inside || whole)
      if (whole) open.add(n.path)
      // A matched folder with no match inside keeps ALL it holds, closed (🔒 D2): one click looks inside.
      if (kept.length === 0) return hit ? [n] : []
      open.add(n.path)
      if (!whole) return [{ ...n, children: kept }]
      // `kept` is in the order of `n.children`: each child is its cut, or itself where the cut dropped it.
      let at = 0
      return [{ ...n, children: n.children.map((child) => (kept[at]?.path === child.path ? kept[at++] : child)) }]
    })
  return { nodes: cut(tree, false), open, order }
}
