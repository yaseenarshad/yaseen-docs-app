/**
 * Edit card's own extensions (YAZ-5007, YAZ-5008): they join the `card` language (`noteCardLanguage`), so only a card's
 * editor has them; every other code block keeps Crepe's setup. The writing look (font, no gutters, padding) is CSS on
 * `.note-card__code` (`noteCard.css`), so it shows at once, before the language loads.
 *
 * - No marks on other copies of the selected word: `basicSetup`'s `highlightSelectionMatches` is in every code block;
 *   its options combine with `Math.min`, so `maxMatches: 0` here makes it draw none in this editor.
 * - ⌘L (Mochi's key) toggles a hidden word. The rule: a selection INSIDE a hidden word (its words, or the whole word
 *   with its braces) takes the braces off; any other selection gets `{{` `}}`; no selection does nothing. ⌘L is free in
 *   a note: the app's ⌘L is a code tab's (Monaco) and a diagram's key, and CodeMirror's "select line" is ⌃L on a Mac.
 */
import { highlightSelectionMatches } from '@codemirror/search'
import { EditorSelection, Prec, type Extension } from '@codemirror/state'
import { keymap, type EditorView } from '@codemirror/view'

/** A hidden word as `shared/cardText.ts` reads it: `{{word}}`, `{{1::word}}`, `{{c1::word}}`. */
const HIDDEN_RE = /\{\{(?:c?\d+::)?([\s\S]*?)\}\}/g

/** ⌘L: wraps each selection in `{{` `}}`, or unwraps the hidden word it is in. No selection: nothing. */
export function toggleHiddenWord(cm: EditorView): boolean {
  const { state } = cm
  if (state.selection.ranges.every((r) => r.empty)) return true
  const text = state.doc.toString()
  const words = [...text.matchAll(HIDDEN_RE)].map((m) => ({ from: m.index, to: m.index + m[0].length, inner: m[1] }))
  const change = state.changeByRange((range) => {
    if (range.empty) return { range }
    const word = words.find((w) => range.from >= w.from && range.to <= w.to)
    if (word !== undefined)
      return {
        changes: { from: word.from, to: word.to, insert: word.inner },
        range: EditorSelection.range(word.from, word.from + word.inner.length),
      }
    return {
      changes: [
        { from: range.from, insert: '{{' },
        { from: range.to, insert: '}}' },
      ],
      range: EditorSelection.range(range.from + 2, range.to + 2),
    }
  })
  cm.dispatch(state.update(change, { scrollIntoView: true, userEvent: 'input' }))
  return true
}

/** The card editor's extensions, inside the `card` language's support. */
export const noteCardEditExtensions: Extension = [highlightSelectionMatches({ maxMatches: 0 }), Prec.high(keymap.of([{ key: 'Mod-l', run: toggleHiddenWord, preventDefault: true }]))]
