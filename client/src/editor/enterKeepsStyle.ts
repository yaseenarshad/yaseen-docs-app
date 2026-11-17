/**
 * ENTER KEEPS THE TEXT STYLE (YAZ-3746 13AB): Enter at the end of a styled line, and the new line types in that style
 * (bold, italic, underline, strikethrough, colour, highlight), as in Google Docs. A link or code does not carry on.
 *
 * Settings › Editor › Typing › "Enter keeps the text style": one switch for pages (off, the editor's own way) and one
 * for drawing text boxes (on: a box styled letter by letter then acts as a box styled as a whole, 13AA). App sets them
 * with `setEnterKeepsStyle`, so an open page or box follows at its next Enter.
 *
 * An `appendTransaction`, not an Enter key: Enter has many owners (lists, the outline, folds, tables), and each of them
 * ends with the caret on a new, empty line. The style is the old line's, at its end: what typing there would take.
 */
import type { Mark } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { $prose } from '@milkdown/kit/utils'

/** The styles that carry to the new line; a link and inline code start fresh. */
const CARRIED = new Set(['strong', 'emphasis', 'underline', 'strike_through', 'highlight', 'text_color'])

let inPages = false
let inBoxes = true

/** App, when Settings › Editor › Typing › "Enter keeps the text style" changes. */
export function setEnterKeepsStyle(pages: boolean, boxes: boolean): void {
  inPages = pages
  inBoxes = boxes
}

export const enterKeepsStyleInPages = () => inPages
export const enterKeepsStyleInBoxes = () => inBoxes

export const enterKeepsStyle = (isOn: () => boolean) =>
  $prose(
    () =>
      new Plugin({
        key: new PluginKey('YAZ_ENTER_KEEPS_STYLE'),
        appendTransaction(trs, oldState, state) {
          if (!isOn() || state.storedMarks !== null || !trs.some((tr) => tr.docChanged)) return null
          // the caret was at the end of a line with letters …
          const was = oldState.selection
          const $was = was.$from
          if (!was.empty || !$was.parent.isTextblock || $was.parent.content.size === 0 || $was.parentOffset !== $was.parent.content.size) return null
          // … and is now on an empty line after it
          const now = state.selection
          if (!now.empty || !now.$from.parent.isTextblock || now.$from.parent.content.size !== 0) return null
          // the old line's end stays with it (-1): a split right there puts the new line after
          const mapped = trs.reduce((pos, tr) => tr.mapping.map(pos, -1), was.from)
          if (mapped >= now.from) return null
          const marks: Mark[] = (oldState.storedMarks ?? $was.marks()).filter((mark) => CARRIED.has(mark.type.name))
          return marks.length === 0 ? null : state.tr.setStoredMarks(marks)
        },
      }),
  )
