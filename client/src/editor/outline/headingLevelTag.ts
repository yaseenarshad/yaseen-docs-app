/**
 * THE HEADING LEVEL TAG (YAZ-2700): which level is this heading? A rendered heading never says —
 * an H2 and an H3 differ by a few px — so the heading the CARET is in wears a small "H2" after its
 * text, and so does a heading under the mouse. Every other heading stays exactly as it was.
 *
 * The tag itself is CSS (`headingLevelTag.css`): an `::after` on the heading, never a DOM node, so
 * it is not text, not selectable, and never reaches the markdown. This plugin only says WHERE the
 * caret's heading is: one node decoration, `data-heading-caret`, on that heading.
 *
 * 🔒 THE TYPING BUDGET: the state is the position of that one heading and its one-decoration set.
 * A caret move inside the same heading, or anywhere outside headings, keeps the SAME state object
 * (so `decorations` answers with the identical set, YAZ-2131 4C), and typing outside headings
 * stays on the one empty state: neither does any work. A change that leaves the caret's heading
 * the node it was (text typed in it, or above it) maps the set through the change.
 *
 * A keystroke IN a heading does not end there: Milkdown's `syncHeadingIdPlugin` answers it with a
 * step of its own that writes the heading's new `id`, and no node decoration survives a step that
 * replaces its node. So the fallback below runs once per such keystroke — one `nodeAt` and one
 * `DecorationSet.create` of ONE decoration, which passes over the document's top-level blocks (and
 * the items of the lists around a heading in a bullet) and enters no textblock: 0.05–0.09 ms on a
 * note of 2,500 blocks and 2,500 bullets, measured. Nothing here walks the document's text.
 */
import type { EditorState } from '@milkdown/kit/prose/state'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { ReplaceAroundStep } from '@milkdown/kit/prose/transform'
import { $prose } from '@milkdown/kit/utils'

export const HEADING_CARET_ATTR = 'data-heading-caret'

interface HeadingLevelTagState {
  /** Where the caret's heading starts, or null when the caret is in no heading. */
  pos: number | null
  set: DecorationSet
}

const NONE: HeadingLevelTagState = { pos: null, set: DecorationSet.empty }

const pluginKey = new PluginKey<HeadingLevelTagState>('mdapp-heading-level-tag')

/** The start of the heading that holds the caret; a selection across blocks is in no ONE heading. */
const caretHeadingPos = (state: EditorState): number | null => {
  const { $from, $to } = state.selection
  return $from.parent.type.name === 'heading' && $from.sameParent($to) ? $from.before() : null
}

const tagAt = (state: EditorState, pos: number | null): HeadingLevelTagState => {
  if (pos === null) return NONE
  const node = state.doc.nodeAt(pos)
  return node === null ? NONE : { pos, set: DecorationSet.create(state.doc, [Decoration.node(pos, pos + node.nodeSize, { [HEADING_CARET_ATTR]: '' })]) }
}

export const headingLevelTag = $prose(
  () =>
    new Plugin<HeadingLevelTagState>({
      key: pluginKey,
      state: {
        init: (_config, state) => tagAt(state, caretHeadingPos(state)),
        apply: (transaction, previous, _oldState, newState) => {
          const pos = caretHeadingPos(newState)
          if (!transaction.docChanged) return pos === previous.pos ? previous : tagAt(newState, pos)
          // The same heading, still the node it was: the one decoration rides the mapping, and nothing
          // is rebuilt. Milkdown's id step replaces the node, the mapped set comes back empty, and
          // the line below builds the one decoration again (the header has the cost). A wrap or a lift
          // (a ReplaceAroundStep: a list or quote put round the heading, or taken off it, ⌘Z of one
          // too) builds it again as well: ProseMirror's `DecorationSet.map` throws on a node decoration
          // whose node moves down or up a level (YAZ-3806).
          if (pos !== null && previous.pos !== null && transaction.mapping.map(previous.pos, 1) === pos && !transaction.steps.some((step) => step instanceof ReplaceAroundStep)) {
            const set = previous.set.map(transaction.mapping, newState.doc)
            if (set.find(pos, pos + 1).length > 0) return { pos, set }
          }
          return tagAt(newState, pos)
        },
      },
      props: { decorations: (state) => pluginKey.getState(state)?.set ?? DecorationSet.empty },
    }),
)
