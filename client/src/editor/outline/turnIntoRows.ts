/**
 * The block menu's strip (YAZ-3727 D13, D14): Checklist, Bullet list, Numbered list and Text, the selection toolbar's
 * list buttons and T (`listButtons.ts`, YAZ-3806) as one row of icon buttons, from a right-click on a line's handle or
 * dot, or on its text (D15, in the note's own menu: `blockMenuItems`), for those who find the bullet easier to reach than a selection. The same commands, so the same rule: one
 * transaction, folds and zoom kept, and the lit button takes the lines out of their list. T is last: the least used.
 *
 * The LINE is the item's first block, or the paragraph or heading, that the handle points at; never a code block, a
 * table cell, or a table, rule or image the handle points at (also in a bullet). Which lines change:
 *  - text highlighted that covers the line: the highlighted lines, as on the toolbar;
 *  - else, on an item line: the whole list it is in, one level (its siblings; their children keep their kind). The
 *    zoomed bullet's own line asks for itself: its siblings are hidden;
 *  - else (a paragraph, a heading, an item's later block): that line.
 * A note that cannot change has no strip.
 */
import { TextSelection, type Command, type EditorState, type Selection } from '@milkdown/kit/prose/state'
import type { Node } from '@milkdown/kit/prose/model'
import type { MenuStrip, RowProvider } from '../blockHandleMenu'
import { allLinesAre, LIST_KINDS, listLines, toggleListKind, turnLinesIntoText, type LinePick, type ListKind } from '../listButtons'
import { ownIcon, TOOLBAR_LABELS } from '../toolbarButtons'
import { getZoomedItemPos } from './zoom'

/**
 * The start of the line's text the handle points at (`inside`), or null for no line: a list item stands for its first
 * block; a table, a rule or an image the handle points at is no line, also inside a bullet.
 */
function menuLine(doc: Node, inside: number): number | null {
  if (inside < 0) return null
  const node = doc.nodeAt(inside)
  const pos = node?.type.name === 'list_item' ? inside + 2 : node?.isTextblock ? inside + 1 : null
  if (pos === null || !doc.resolve(pos).parent.isTextblock) return null
  const $pos = doc.resolve(pos)
  if ($pos.parent.type.spec.code) return null
  for (let depth = $pos.depth; depth > 0; depth--) if ($pos.node(depth).type.spec.tableRole !== undefined) return null
  return pos
}

/** Highlighted text that covers the line: its lines are the ones that change. */
const coversLine = (state: EditorState, selection: Selection, line: number): boolean =>
  selection instanceof TextSelection && !selection.empty && selection.from < state.doc.resolve(line).end() && selection.to > line

/** The list the line's item is in, when the line is an item's first block and not the zoomed bullet's own line. */
function wholeList(state: EditorState, line: number): number | null {
  const $line = state.doc.resolve(line)
  if ($line.depth < 3 || $line.node(-1).type.name !== 'list_item' || $line.index(-1) !== 0) return null
  if ($line.before(-1) === getZoomedItemPos(state)) return null
  return $line.before(-2)
}

/** The toolbar's T is drawn as SVG text; a strip button holds no text (its tooltip names it), so here it is a shape. */
const T_GLYPH = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M7 6.5h10v2.4h-3.8V18h-2.4V8.9H7z"/></svg>'

/** The toolbar's icon. */
const glyph = (id: ListKind | 'text') => (): SVGElement => {
  const template = document.createElement('template')
  template.innerHTML = id === 'text' ? T_GLYPH : ownIcon(id)
  const svg = template.content.firstElementChild as SVGElement
  svg.setAttribute('aria-hidden', 'true')
  return svg
}

export const turnIntoRows: RowProvider = (view, target) => {
  const line = view.editable ? menuLine(view.state.doc, target.inside) : null
  if (line === null) return []
  // What the strip shows lit is read on the lines it would change; a lone line is read with the caret on it. A
  // right-click on the text reads the selection from before it (D15): the word it selected is no highlight.
  const highlighted = coversLine(view.state, target.selection ?? view.state.selection, line)
  const listPos = highlighted ? null : wholeList(view.state, line)
  const pick: LinePick | undefined = listPos === null ? undefined : listLines(listPos)
  const shown = highlighted || pick !== undefined ? view.state : view.state.apply(view.state.tr.setSelection(TextSelection.create(view.state.doc, line)))
  const button = (id: ListKind | 'text', command: Command) => ({
    label: TOOLBAR_LABELS[id],
    icon: glyph(id),
    active: allLinesAre(shown, id, pick),
    run: () => {
      if (!highlighted && pick === undefined) view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, line)))
      command(view.state, view.dispatch, view)
      view.focus()
    },
  })
  const strip: MenuStrip = {
    kind: 'strip',
    label: 'Turn into',
    group: 'kind',
    buttons: [...LIST_KINDS.map((kind) => button(kind, toggleListKind(kind, pick))), button('text', turnLinesIntoText(pick))],
  }
  return [strip]
}
