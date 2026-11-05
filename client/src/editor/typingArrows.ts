/**
 * Arrows while you type (YAZ-4273 D6, D7, C15): one character for each direction, at the keystroke that ends the arrow.
 *
 *  - Any run of `-` before `>` → `→` (`->`, `-->`, `--->`), any run of `=` → `⇒` (`=>`, `==>`) (YAZ-4273 demo).
 *  - `<-` → `←` and `<=` → `⇐` fire before any `>` is typed, so the longer ones chain: `←-` → `←` (`<--`), `←>` → `↔`
 *    (`<->`, `<-->`), `⇐=` → `⇐` (`<==`), `⇐>` → `⇔` (`<=>`, `<==>`). `<=` is an arrow too (YAZ-4273 demo): ⌘Z right
 *    after gives "less than or equal" back, and a `<=` or `<-` that ⌘Z gave back stays text as you type on.
 *  - ⌘Z or Backspace right after a step gives back the text before that step: the change is its own undo step.
 *  - Never in code (a code block or inline code), and never as the end of an open `<!-- … -->` in the line.
 *  - Pasted text and text an agent writes keep their `->`: `handleTextInput` sees only typing (C19).
 *  - Settings › Editor › Typing › Arrows turns it off (D8); App sets it with `setTypingArrows`, so no editor is rebuilt.
 *
 * A `handleTextInput` prop, not an input rule (YAZ-4273 demo: ⌘Z gave back nothing, as the arrow and the typing were one
 * undo step), the same as `listMarkerTyping`: a keystroke tests one short regex at the caret.
 */
import { closeHistory, undo } from '@milkdown/kit/prose/history'
import type { Mark } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { $prose, $shortcut } from '@milkdown/kit/utils'

/** Each arrow, with its run of `-` or `=` made one character (`arrowFor`). */
const ARROWS: Readonly<Record<string, string>> = {
  '->': '→',
  '=>': '⇒',
  '<-': '←',
  '←-': '←',
  '←>': '↔',
  '<=': '⇐',
  '⇐=': '⇐',
  '⇐>': '⇔',
}

/** The text before the caret, with the typed text, ends in an arrow. */
const ARROW_END = /(?:-+>|=+>|<-|<=|←-|←>|⇐=|⇐>)$/

const arrowFor = (typed: string) => ARROWS[typed.replace(/-+/g, '-').replace(/=+/g, '=')]

let on = true

/** App, when Settings › Editor › Typing › Arrows changes. An open note uses it at its next keystroke. */
export function setTypingArrows(next: boolean): void {
  on = next
}

/** True right after a change to an arrow, until the next document change or caret move. */
const arrowKey = new PluginKey<boolean>('YAZ_TYPING_ARROWS')

export const typingArrows = $prose(
  () =>
    new Plugin<boolean>({
      key: arrowKey,
      state: {
        init: () => false,
        apply: (tr, prev, oldState, newState) => {
          const meta = tr.getMeta(arrowKey) as boolean | undefined
          if (meta !== undefined) return meta
          return prev && !tr.docChanged && newState.selection.eq(oldState.selection)
        },
      },
      props: {
        handleTextInput(view, from, to, text) {
          // Every arrow ends in `>`, `-` or `=`: any other key costs one test. The line is read as far back as the
          // input-rules plugin reads (500 characters), so a long paragraph types as fast as a short one.
          if (!on || view.composing || !/[->=]$/.test(text)) return false
          const { state } = view
          const $from = state.doc.resolve(from)
          if ($from.parent.type.spec.code) return false
          const line = $from.parent.textBetween(Math.max(0, $from.parentOffset - 500), $from.parentOffset, undefined, '\ufffc') + text
          const match = ARROW_END.exec(line)
          if (match === null) return false
          const isCode = (marks: readonly Mark[]) => marks.some((mark) => mark.type.spec.code === true)
          if (isCode(state.storedMarks ?? $from.marks())) return false
          const end = from + text.length
          const start = end - match[0].length
          let code = false
          if (start < from) state.doc.nodesBetween(start, from, (node) => void (code ||= isCode(node.marks)))
          if (code) return false
          // `-->` closes an HTML comment: inside an open `<!--` of this line, every arrow stays as typed.
          const before = line.slice(0, match.index)
          if (before.lastIndexOf('<!--') > before.lastIndexOf('-->')) return false
          // The typed character goes in as plain typing (it joins the typing's undo step); THEN the arrow, as its own
          // step, so ⌘Z gives back what you typed. The last empty step closes it: text typed after the arrow is a new step.
          view.dispatch(state.tr.insertText(text, from, to))
          view.dispatch(closeHistory(view.state.tr.insertText(arrowFor(match[0]), start, end)).setMeta(arrowKey, true))
          view.dispatch(closeHistory(view.state.tr))
          return true
        },
      },
    }),
)

/** Backspace right after a change to an arrow: history `undo`, the same as ⌘Z. Priority 200, above the outliner's 100. */
export const undoTypingArrow = $shortcut(() => ({
  UndoTypingArrow: {
    key: 'Backspace',
    priority: 200,
    onRun: () => (state, dispatch) => arrowKey.getState(state) === true && undo(state, dispatch),
  },
}))
