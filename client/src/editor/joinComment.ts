/**
 * The load step that the line's style (YAZ-3164, `line/lineStyle.ts`) and the table's settings
 * (YAZ-3696, `table/tableStyle.ts`) share: a block whose style is an HTML comment as the NEXT block.
 * Every container (the root, lists, list items, blockquotes) is walked, depth first; a block of
 * `type` is joined with its next sibling when that sibling is nothing but a comment `parse` reads —
 * a bare `html` node, or the paragraph Milkdown's `remarkHtmlTransformer` wraps a block `html` in.
 * `apply` gets the block and the value, and the comment leaves the tree. A `type` block's own
 * children are not walked. Any other comment stays an `html` node, bytes untouched.
 */
import type { Nodes, Parent, RootContent } from 'mdast'

/** The value of the comment a block holds, when the block is nothing but one: a bare `html`, or a paragraph wrapping only one. */
function commentValue<T>(node: RootContent | undefined, parse: (value: string) => T | null): T | null {
  if (node === undefined) return null
  if (node.type === 'html') return parse(node.value)
  if (node.type !== 'paragraph' || node.children.length !== 1) return null
  const only = node.children[0]
  return only.type === 'html' ? parse(only.value) : null
}

export function joinNextComment<T>(node: Nodes, type: RootContent['type'], parse: (value: string) => T | null, apply: (block: RootContent, value: T) => void): void {
  if (!('children' in node)) return
  const parent = node as Parent
  for (let i = 0; i < parent.children.length; i++) {
    const child = parent.children[i]
    if (child.type === type) {
      const value = commentValue(parent.children[i + 1], parse)
      if (value !== null) {
        apply(child, value)
        parent.children.splice(i + 1, 1)
      }
    } else joinNextComment(child, type, parse, apply)
  }
}
