/**
 * Structural diff of two ProseMirror documents (YAZ-1350) — the input to YAZ-1347's
 * one-transaction external apply.
 *
 * The constraint that shapes everything here: an external edit must NOT be expressed as one big
 * replace. ProseMirror carries folds, caret and scroll through position mapping, and a range that
 * spans the whole document maps every fold onto the same collapsed point — exactly the
 * `setMarkdown` rebuild we are replacing. So the walk is deliberately structural, one rule at
 * every level (YAZ-1638):
 *  - trim `.eq()` children off both ends, then pair the middle index-wise, recursing through
 *    same-markup children so a renumber of every list item produces one small range PER item
 *    instead of one range over the list; whatever one side has left over is a sibling shift (a
 *    bullet added or removed), expressed as ONE insert or delete, never a rewrite of its neighbours;
 *  - textblocks → `findDiffStart`/`findDiffEnd` over the INLINE fragment, so marks travel with the
 *    text instead of being re-derived from a plain-string diff.
 *
 * Attributes alone are not identity (YAZ-3704): a node whose type, marks and content match but whose
 * attrs differ (an ordered list item renumbered, a heading's id or level) is an ATTR range — the node
 * keeps its place and only those attrs change — instead of a replace of the whole node. The end trim
 * compares the same way, so one item added at the top of an ordered list is one insert plus a label
 * change on each item below it, not a rewrite of every item.
 *
 * Positions are in the OLD document; every slice is cut from the NEW one. The absolute invariant
 * (asserted by the contract tests): applying every returned range right-to-left yields a document
 * that `.eq(newDoc)`. Callers that cannot honour that must fall back to a rebuild.
 */
import { type Attrs, Mark, type Node as ProseNode, Slice } from '@milkdown/kit/prose/model'

export interface ReplaceRange {
  /** Start of the range, in OLD-document coordinates. For an attr range, the node's position. */
  from: number
  /** End of the range, in OLD-document coordinates. Equals `from` for an attr range. */
  to: number
  /** The replacement content, cut from the NEW document. Empty for an attr range. */
  slice: Slice
  /** Present on an ATTR range: the attrs of the node at `from` that change, with their new values. Nothing to replace. */
  attrs?: Attrs
}

/** The same node apart from its own attrs: type, marks and content equal. */
const sameButAttrs = (a: ProseNode, b: ProseNode): boolean => a.type === b.type && Mark.sameSet(a.marks, b.marks) && a.content.eq(b.content)

/** The attrs of `b` that differ from `a`'s. */
const changedAttrs = (a: ProseNode, b: ProseNode): Attrs => {
  const changed: Record<string, unknown> = {}
  for (const key of Object.keys(b.attrs)) if (a.attrs[key] !== b.attrs[key]) changed[key] = b.attrs[key]
  return changed
}

const attrRange = (pos: number, a: ProseNode, b: ProseNode): ReplaceRange => ({ from: pos, to: pos, slice: Slice.empty, attrs: changedAttrs(a, b) })

/**
 * Attrs the editor works out by itself, never a change anyone made (YAZ-3704 4A, 4B): an ordered item's
 * `label` (its number), a list's `spread` (blank lines between items) and a heading's `id` (from its text;
 * the live doc has one, a freshly parsed file does not). A range of only these changes nothing you see.
 */
const DERIVED_ATTRS = new Set(['label', 'spread', 'id'])
/** An attr the editor works out itself, never one the file says (a list number, a heading's id). */
export const isDerivedAttr = (key: string): boolean => DERIVED_ATTRS.has(key)

export const onlyDerived = (range: ReplaceRange): boolean => range.attrs !== undefined && Object.keys(range.attrs).every((key) => DERIVED_ATTRS.has(key))

/** Offset of child `index` within its parent's content. */
const offsetOfChild = (node: ProseNode, index: number): number => {
  let offset = 0
  for (let i = 0; i < index; i++) offset += node.child(i).nodeSize
  return offset
}

/**
 * Inline diff of one textblock pair. `findDiffEnd` may walk back past the shared prefix when the
 * change repeats characters ("Kid" → "Kid but edited elsewhere"); pushing both ends forward by the
 * overlap keeps the range well-ordered without widening it to the whole block.
 */
const diffTextblock = (
  oldNode: ProseNode,
  newNode: ProseNode,
  oldPos: number,
  newPos: number,
  newDoc: ProseNode,
  out: ReplaceRange[],
): void => {
  const start = oldNode.content.findDiffStart(newNode.content)
  const end = start === null ? null : oldNode.content.findDiffEnd(newNode.content)
  if (start === null || end === null) return
  const overlap = Math.max(0, start - Math.min(end.a, end.b))
  out.push({
    from: oldPos + start,
    to: oldPos + end.a + overlap,
    slice: newDoc.slice(newPos + start, newPos + end.b + overlap),
  })
}

/** `oldPos` / `newPos` are the CONTENT starts of the two nodes, each in its own document. */
const diffNode = (
  oldNode: ProseNode,
  newNode: ProseNode,
  oldPos: number,
  newPos: number,
  newDoc: ProseNode,
  out: ReplaceRange[],
): void => {
  if (oldNode.isTextblock) {
    diffTextblock(oldNode, newNode, oldPos, newPos, newDoc, out)
    return
  }

  // The ends trim on `sameButAttrs`; a trimmed pair whose own attrs differ still gets its attr range.
  let head = 0
  let oldTail = oldNode.childCount
  let newTail = newNode.childCount
  while (head < oldTail && head < newTail && sameButAttrs(oldNode.child(head), newNode.child(head))) head++
  while (oldTail > head && newTail > head && sameButAttrs(oldNode.child(oldTail - 1), newNode.child(newTail - 1))) {
    oldTail--
    newTail--
  }
  // Before the pairs and the sibling shift: an attr range at the same position as an insert must apply first.
  const trimmedAttrs = (from: number, to: number, newFrom: number): void => {
    let pos = oldPos + offsetOfChild(oldNode, from)
    for (let i = from; i < to; i++) {
      const oldChild = oldNode.child(i)
      const newChild = newNode.child(newFrom + i - from)
      if (!oldChild.eq(newChild)) out.push(attrRange(pos, oldChild, newChild))
      pos += oldChild.nodeSize
    }
  }
  trimmedAttrs(0, head, 0)
  trimmedAttrs(oldTail, oldNode.childCount, newTail)

  let oldChildPos = oldPos + offsetOfChild(oldNode, head)
  let newChildPos = newPos + offsetOfChild(newNode, head)
  const paired = Math.min(oldTail, newTail) - head
  for (let i = 0; i < paired; i++) {
    const oldChild = oldNode.child(head + i)
    const newChild = newNode.child(head + i)
    if (!oldChild.eq(newChild)) {
      // A changed type or marks (a paragraph turned heading) is a node identity change: replace it
      // whole rather than diffing across two different shapes. Attrs alone are not (YAZ-3704).
      if (oldChild.sameMarkup(newChild) && !oldChild.isLeaf) {
        diffNode(oldChild, newChild, oldChildPos + 1, newChildPos + 1, newDoc, out)
      } else if (oldChild.type === newChild.type && !oldChild.isLeaf && Mark.sameSet(oldChild.marks, newChild.marks)) {
        // Same node, new attrs (YAZ-3704): change them in place, then diff inside as usual.
        out.push(attrRange(oldChildPos, oldChild, newChild))
        diffNode(oldChild, newChild, oldChildPos + 1, newChildPos + 1, newDoc, out)
      } else {
        out.push({
          from: oldChildPos,
          to: oldChildPos + oldChild.nodeSize,
          slice: newDoc.slice(newChildPos, newChildPos + newChild.nodeSize),
        })
      }
    }
    oldChildPos += oldChild.nodeSize
    newChildPos += newChild.nodeSize
  }

  // Whatever one side has left over is a sibling shift: one insert (`from === to`) or one delete
  // (an empty slice), placed after the pairs so the neighbours' own ranges stay small.
  if (oldTail - head > paired || newTail - head > paired) {
    out.push({
      from: oldChildPos,
      to: oldPos + offsetOfChild(oldNode, oldTail),
      slice: newDoc.slice(newChildPos, newPos + offsetOfChild(newNode, newTail)),
    })
  }
}

/**
 * Non-overlapping ranges, in document order, that turn `oldDoc` into `newDoc`. Empty when equal. An attr
 * range and an insert at the same position keep that order (the sort is stable): applied right-to-left,
 * the attr change lands on its node before the insert moves it.
 */
export const diffDocs = (oldDoc: ProseNode, newDoc: ProseNode): ReplaceRange[] => {
  const ranges: ReplaceRange[] = []
  if (!oldDoc.eq(newDoc)) diffNode(oldDoc, newDoc, 0, 0, newDoc, ranges)
  return ranges.sort((a, b) => a.from - b.from)
}
