/**
 * Arrows while you type (YAZ-4273 D6, D7, C15): one character for each direction, at the keystroke that ends the arrow.
 *
 *  - `->` and `-->` → `→`, `==>` → `⇒`.
 *  - `<-` → `←` and `<==` → `⇐` fire before any `>` is typed, so the longer ones chain: `←-` → `←` (`<--`), `←>` → `↔`
 *    (`<->`, `<-->`), `⇐>` → `⇔` (`<==>`). `<=` alone stays text.
 *  - Backspace right after a step gives back the text before that step: Milkdown's Backspace runs `undoInputRule` first.
 *  - Never in code, and never as the end of an open `<!-- … -->` in the line. Milkdown's own input-rule runner skips a code
 *    block, but not inline code (it ignores prosemirror-inputrules' `inCodeMark`), so the rule checks the code mark itself.
 *  - Pasted text and text an agent writes keep their `->`: an input rule sees only typing (C19).
 *  - Settings › Editor › Typing › Arrows turns it off (D8); App sets it with `setTypingArrows`, so no editor is rebuilt.
 *
 * One rule in the editor's one input-rules plugin: a keystroke tests one more short regex at the caret.
 */
import { InputRule } from '@milkdown/kit/prose/inputrules'
import type { Mark } from '@milkdown/kit/prose/model'
import { $inputRule } from '@milkdown/kit/utils'

const ARROWS: Readonly<Record<string, string>> = {
  '-->': '→',
  '->': '→',
  '==>': '⇒',
  '<-': '←',
  '←-': '←',
  '←>': '↔',
  '<==': '⇐',
  '⇐>': '⇔',
}

let on = true

/** App, when Settings › Editor › Typing › Arrows changes. An open note uses it at its next keystroke. */
export function setTypingArrows(next: boolean): void {
  on = next
}

export const typingArrows = $inputRule(
  () =>
    new InputRule(
      /(?:-->|->|==>|<==|<-|←-|←>|⇐>)$/,
      (state, match, start, end) => {
        if (!on) return null
        const isCode = (marks: readonly Mark[]) => marks.some((mark) => mark.type.spec.code === true)
        if (isCode(state.storedMarks ?? state.doc.resolve(end).marks())) return null
        let code = false
        state.doc.nodesBetween(start, end, (node) => void (code ||= isCode(node.marks)))
        if (code) return null
        const $start = state.doc.resolve(start)
        // `-->` closes an HTML comment: inside an open `<!--` of this line, every arrow stays as typed.
        const before = state.doc.textBetween($start.start(), start, undefined, '\ufffc')
        if (before.lastIndexOf('<!--') > before.lastIndexOf('-->')) return null
        return state.tr.insertText(ARROWS[match[0]], start, end)
      },
    ),
)
