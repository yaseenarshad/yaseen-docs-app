/**
 * THE HEADING TEXT (YAZ-3049): the span a highlighted heading paints its wash on. A highlight hugs
 * the words (D7), but the heading itself must stay FULL WIDTH: a click right of the words has to
 * land in the heading, at its end, and not in the block below (a `fit-content` heading gave that
 * space to `.ProseMirror`, and Chromium put the caret in the next paragraph).
 *
 * So each text node of a heading (H1-H6, anywhere: outside lists, in a bullet, in a quote) wears
 * one inline decoration, `heading-text`, and app.css paints the wash on it: one span per line,
 * like the `==highlight==` mark. The heading's first text node adds `heading-text--first` and its
 * last adds `heading-text--last`: only those two draw the wash's 3px left and right edge, so two
 * spans side by side (a link, a bold word, a find hit) never lay their see-through edges one over
 * the other. An empty heading has no text and gets none. The decorations are view state only:
 * not text, never saved.
 *
 * 🔒 THE TYPING BUDGET: the set is built once, when the editor starts. A change maps the set and
 * builds again only the textblocks it touched: the ranges its steps replaced, and the doc diff
 * (a mark step maps no position). The same pass as the wikilinks (YAZ-2131 5C). A keystroke in a
 * heading, and Milkdown's heading-id step after it, rebuild that ONE heading. A keystroke
 * anywhere else rebuilds the one textblock it is in and adds nothing. Nothing walks the document
 * after the first build.
 */
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { EditorState, Transaction } from '@milkdown/kit/prose/state'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

export const HEADING_TEXT_CLASS = 'heading-text'
export const HEADING_TEXT_FIRST_CLASS = 'heading-text--first'
export const HEADING_TEXT_LAST_CLASS = 'heading-text--last'

const pluginKey = new PluginKey<DecorationSet>('mdapp-heading-text')

/** The decorations of one heading that starts at `pos`: one for each text node, none when it has no text. */
function decorateHeading(out: Decoration[], heading: ProseNode, pos: number): void {
  let first = -1
  let last = -1
  heading.forEach((child, _offset, index) => {
    if (!child.isText) return
    if (first === -1) first = index
    last = index
  })
  if (first === -1) return
  heading.forEach((child, offset, index) => {
    if (!child.isText) return
    let cls = HEADING_TEXT_CLASS
    if (index === first) cls += ` ${HEADING_TEXT_FIRST_CLASS}`
    if (index === last) cls += ` ${HEADING_TEXT_LAST_CLASS}`
    const from = pos + 1 + offset
    out.push(Decoration.inline(from, from + child.nodeSize, { class: cls }))
  })
}

function build(doc: ProseNode): DecorationSet {
  const decorations: Decoration[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    if (node.type.name === 'heading') decorateHeading(decorations, node, pos)
    return false
  })
  return decorations.length === 0 ? DecorationSet.empty : DecorationSet.create(doc, decorations)
}

/**
 * The set after a change: mapped, then built again for each textblock in a changed range. A
 * textblock that is no heading any more loses what it had; a block that became a heading gets its own.
 */
function update(set: DecorationSet, tr: Transaction, oldState: EditorState, state: EditorState): DecorationSet {
  const { doc } = state
  const ranges: [number, number][] = []
  tr.mapping.maps.forEach((map, i) => {
    const later = tr.mapping.slice(i + 1)
    map.forEach((_oldFrom, _oldTo, from, to) => ranges.push([later.map(from, -1), later.map(to, 1)]))
  })
  const diffStart = oldState.doc.content.findDiffStart(doc.content)
  if (diffStart !== null) ranges.push([diffStart, oldState.doc.content.findDiffEnd(doc.content)!.b])
  if (ranges.length === 0) return set.map(tr.mapping, doc)

  set = set.map(tr.mapping, doc)
  const blocks = new Map<number, ProseNode>()
  for (const [a, b] of ranges) {
    // One position beyond each end, so a change at a block boundary reaches the blocks on both sides.
    doc.nodesBetween(Math.max(0, Math.min(a, b) - 1), Math.min(doc.content.size, Math.max(a, b) + 1), (node, pos) => {
      if (!node.isTextblock) return true
      blocks.set(pos, node)
      return false
    })
  }
  // One remove and one add for all of them: a select-all change touches every block in one tree pass.
  const stale: Decoration[] = []
  const fresh: Decoration[] = []
  for (const [pos, block] of blocks) {
    stale.push(...set.find(pos, pos + block.nodeSize))
    if (block.type.name === 'heading') decorateHeading(fresh, block, pos)
  }
  return stale.length === 0 && fresh.length === 0 ? set : set.remove(stale).add(doc, fresh)
}

export const headingText = $prose(
  () =>
    new Plugin<DecorationSet>({
      key: pluginKey,
      state: {
        init: (_config, state) => build(state.doc),
        apply: (tr, set, oldState, newState) => (tr.docChanged ? update(set, tr, oldState, newState) : set),
      },
      props: { decorations: (state) => pluginKey.getState(state) ?? DecorationSet.empty },
    }),
)
