/**
 * Clear formatting (YAZ-4277 demo round 1), ⌘\ as in Google Docs: the selected letters lose their styles (bold,
 * italic, underline, strike, inline code, highlight, and a text box's colour), and a heading the selection or the
 * caret touches becomes plain text (Yaseen: a heading is formatting here; one in a bullet stays in its bullet). The
 * other blocks stay: a bullet, a numbered or check list, a quote and the indent. Links and `[[` pills stay too: they
 * are content. One undo step, over the visible lines only (`onVisibleLines`, as the marks). With only a caret, the
 * next typed letters are plain.
 *
 * In a text box the drawing's ⌘\ runs first (`hostTextWysiwyg.ts` takes it in the capture phase), so the one key never
 * means two things there.
 */
import type { Ctx } from '@milkdown/kit/ctx'
import type { Command } from '@milkdown/kit/prose/state'
import { $shortcut } from '@milkdown/kit/utils'
import { onVisibleLines } from '../lineSelection'
import { rowShortcuts } from '../pageKeys'

/** The letter styles ⌘\ clears; `link` (and any other mark) stays. `text_color` exists in a text box only. */
const CLEARED_MARKS = ['strong', 'emphasis', 'underline', 'strike_through', 'inlineCode', 'highlight', 'text_color']

export const clearFormatting: Command = (state, dispatch) => {
  const { schema, selection } = state
  const types = CLEARED_MARKS.flatMap((name) => schema.marks[name] ?? [])
  const tr = state.tr
  const { heading, paragraph } = schema.nodes
  // the headings the selection (or the caret) touches: plain paragraphs, the letters kept
  for (const { $from, $to } of selection.ranges) {
    state.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
      if (node.type === heading && paragraph) tr.setNodeMarkup(tr.mapping.map(pos), paragraph)
      return !node.isTextblock
    })
  }
  if (selection.empty) {
    const marks = state.storedMarks ?? selection.$from.marks()
    tr.setStoredMarks(marks.filter((mark) => !types.includes(mark.type)))
  } else {
    for (const { $from, $to } of selection.ranges) for (const type of types) tr.removeMark($from.pos, $to.pos, type)
  }
  dispatch?.(tr)
  return true
}

const PRIORITY = 100

export const clearFormattingKeymap = $shortcut((ctx: Ctx) =>
  rowShortcuts(ctx, 'page.clearFormatting', 'ClearFormatting', { priority: PRIORITY, onRun: () => onVisibleLines(clearFormatting) }),
)
