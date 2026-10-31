/**
 * The block menu's "turn into" rows (YAZ-3727 D13): Text, Checklist, Bullet list and Numbered list, the selection
 * toolbar's T and list buttons (`listButtons.ts`, YAZ-3806) from a right-click on a line's handle or dot, for those
 * who find the bullet easier to reach than a selection. The same commands, so the same rule: one transaction, folds
 * and zoom kept.
 *
 * The LINE is the item's first block, or the top-level paragraph or heading, that the handle points at; never a code
 * block or a table cell (no line for the toolbar either). The rows act on that line, or on every selected line when a
 * selection over text already covers it. The line's own kind has a ✓ and is disabled: it has nothing to change.
 */
import { TextSelection, type Command, type EditorState } from '@milkdown/kit/prose/state'
import type { Node } from '@milkdown/kit/prose/model'
import type { MenuRow, RowProvider } from '../blockHandleMenu'
import { allLinesAre, LIST_KINDS, toggleListKind, turnIntoText, type ListKind } from '../listButtons'
import { ownIcon, TOOLBAR_LABELS } from '../toolbarButtons'

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

/** A selection over text that covers the line keeps its lines; otherwise the caret goes to the line's start. */
const coversLine = (state: EditorState, line: number): boolean => {
  const { selection } = state
  return selection instanceof TextSelection && !selection.empty && selection.from < state.doc.resolve(line).end() && selection.to > line
}

const atLine = (state: EditorState, line: number): EditorState =>
  coversLine(state, line) ? state : state.apply(state.tr.setSelection(TextSelection.create(state.doc, line)))

/** The toolbar's T is drawn as SVG text; a menu glyph holds no text (its row's text is the label), so here it is a shape. */
const T_GLYPH = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M6 5.5h12v2.6h-4.7V19h-2.6V8.1H6z"/></svg>'

/** The toolbar's icon at the menu's glyph size. */
const glyph = (id: ListKind | 'text') => (): SVGElement => {
  const template = document.createElement('template')
  template.innerHTML = id === 'text' ? T_GLYPH : ownIcon(id)
  const svg = template.content.firstElementChild as SVGElement
  svg.setAttribute('width', '14')
  svg.setAttribute('height', '14')
  svg.setAttribute('aria-hidden', 'true')
  return svg
}

export const turnIntoRows: RowProvider = (view, target) => {
  const line = menuLine(view.state.doc, target.inside)
  if (line === null) return []
  const shown = atLine(view.state, line)
  const row = (id: ListKind | 'text', command: Command): MenuRow => {
    const current = allLinesAre(shown, id)
    return {
      label: TOOLBAR_LABELS[id],
      group: 'kind',
      icon: glyph(id),
      ...(current ? { hint: '✓' } : {}),
      disabled: current,
      run: () => {
        if (!coversLine(view.state, line)) view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, line)))
        command(view.state, view.dispatch, view)
        view.focus()
      },
    }
  }
  return [row('text', turnIntoText), ...LIST_KINDS.map((kind) => row(kind, toggleListKind(kind)))]
}
