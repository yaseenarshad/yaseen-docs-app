/**
 * Marks on line breaks (YAZ-2280). Replaces Milkdown's `hardbreakClearMarkPlugin`, which rebuilt
 * every break under a new mark with default attrs and so turned a soft break (`isInline`, a
 * newline shown as a space) into a hard one. CONTRACTS rule 33.
 *
 * One rule, checked on the part of the document a transaction changed: a soft break keeps a mark
 * only while the text on BOTH sides carries it (Markdown cannot open or close a mark against a
 * newline); a hard break never carries one, as in Milkdown.
 */
import { hardbreakSchema } from '@milkdown/kit/preset/commonmark'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { $prose } from '@milkdown/kit/utils'

export const breakMarks = $prose((ctx) => new Plugin({
  key: new PluginKey('mdapp-break-marks'),
  appendTransaction: (trs, oldState, newState) => {
    if (!trs.some((tr) => tr.docChanged)) return undefined
    const start = oldState.doc.content.findDiffStart(newState.doc.content)
    if (start === null) return undefined
    const end = oldState.doc.content.findDiffEnd(newState.doc.content)!.b
    const type = hardbreakSchema.type(ctx)
    const { doc, tr } = newState
    // One position wider than the change: the break beside edited text is the one that can go stale.
    const from = Math.max(0, Math.min(start, end) - 1)
    const to = Math.min(doc.content.size, Math.max(start, end) + 1)
    doc.nodesBetween(from, to, (node, pos, parent, index) => {
      if (node.type !== type || node.marks.length === 0) return
      const before = parent?.maybeChild(index - 1)
      const after = parent?.maybeChild(index + 1)
      const keep = node.attrs.isInline ? node.marks.filter((m) => before && after && m.isInSet(before.marks) && m.isInSet(after.marks)) : []
      if (keep.length < node.marks.length) tr.setNodeMarkup(pos, type, node.attrs, keep)
    })
    return tr.docChanged ? tr : undefined
  },
}))
