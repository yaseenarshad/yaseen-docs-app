/**
 * The block menu's strip (YAZ-3727 D13, D14, D18): Bullet list, Numbered list, Checklist and Text, the selection toolbar's
 * list buttons and T (`listButtons.ts`, YAZ-3806) as one row of icon buttons, from a right-click on a line's handle or
 * dot, or on its text (D15, in the page's own menu: `blockMenuItems`), for those who find the bullet easier to reach than a selection. The same commands, so the same rule: one
 * transaction, folds and zoom kept, the lit list button takes the lines out of their list, and Text only makes each line a
 * paragraph in place, so on a list it keeps the list (YAZ-4369). The most used first (D18); T is last: the least used.
 *
 * The LINE is the item's first block, or the paragraph or heading, that the handle points at; never a code block, a
 * table cell, or a table, rule or image the handle points at (also in a bullet). Which lines change:
 *  - text highlighted that covers the line: the highlighted lines, as on the toolbar;
 *  - else, on an item line: the whole list it is in, one level (its siblings; their children keep their kind). The
 *    zoomed bullet's own line asks for itself: its siblings are hidden;
 *  - else (a paragraph, a heading, an item's later block): that line.
 * A page that cannot change has no strip.
 */
import { TextSelection, type Command, type EditorState, type Selection } from '@milkdown/kit/prose/state'
import type { Node } from '@milkdown/kit/prose/model'
import type { MenuRow, MenuStrip, RowProvider } from '../blockHandleMenu'
import { allLinesAre, listLines, toggleListKind, turnLinesIntoText, type LinePick, type ListKind } from '../listButtons'
import { ownIcon, TOOLBAR_LABELS } from '../toolbarButtons'
import { embedOnlyParagraph } from '../drawing/boardEmbedScan'
import { addLineBeside } from './addLineBeside'
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

/**
 * A bullet whose first block is a code block or a table (YAZ-4800: "i have a code block that is on a bullet and i cant
 * figure out how to remove the bullet // the same is the case for tables"): the item's first block and its kind, from
 * the item itself (its dot) or its first block (the handle on it); null for any other target.
 */
function blockItem(doc: Node, inside: number): { pos: number; kind: ListKind | null } | null {
  if (inside < 0 || inside >= doc.content.size) return null
  const node = doc.nodeAt(inside)
  let itemPos: number | null = null
  if (node?.type.name === 'list_item') itemPos = inside
  else {
    const $pos = doc.resolve(inside)
    if ($pos.parent.type.name === 'list_item' && $pos.index() === 0) itemPos = $pos.before()
    // A code block or a table in no bullet (YAZ-4800 demo: "a table that doesnt have any bullet doesnt show the option
    // to put it on a bullet … same for code block"): the strip makes it the first block of a new bullet.
    // A block that is a later block of a bullet is IN one: no strip, as the table's cell probe below (YAZ-4800).
    else if (node !== null && (node.type.name === 'table' || node.type.spec.code === true)) return $pos.parent.type.name === 'list_item' ? null : { pos: inside, kind: null }
    else {
      // A table's handle points into its first cell (YAZ-3795): the table is an ancestor.
      for (let depth = $pos.depth; depth > 0; depth--) {
        if ($pos.node(depth).type.name !== 'table') continue
        const tablePos = $pos.before(depth)
        const $table = doc.resolve(tablePos)
        if ($table.parent.type.name === 'list_item' && $table.index() === 0) itemPos = $table.before()
        else if ($table.parent.type.name === 'list_item') return null
        else return { pos: tablePos, kind: null }
        break
      }
    }
  }
  if (itemPos === null) return null
  const item = doc.nodeAt(itemPos)
  const first = item?.firstChild
  if (item == null || first == null || (first.isTextblock && first.type.spec.code !== true)) return null
  const list = doc.resolve(itemPos).parent
  const kind: ListKind = typeof item.attrs.checked === 'boolean' ? 'checklist' : list.type.name === 'ordered_list' ? 'numberedList' : 'bulletList'
  return { pos: itemPos + 1, kind }
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

/** The strip's order (D18): the most used first. The toolbar keeps its own (`LIST_KINDS`). */
const STRIP_KINDS: readonly ListKind[] = ['bulletList', 'numberedList', 'checklist']

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
  if (line === null) return view.editable ? blockItemStrip(view, target.inside) : []
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
      // The highlighted lines it showed lit, not the page selection read since (YAZ-4464: the menu waits for its guesses).
      if (highlighted && target.selection !== undefined && !target.selection.eq(view.state.selection)) view.dispatch(view.state.tr.setSelection(target.selection))
      command(view.state, view.dispatch, view)
      view.focus()
    },
  })
  const strip: MenuStrip = {
    kind: 'strip',
    label: 'Turn into',
    group: 'kind',
    buttons: [...STRIP_KINDS.map((kind) => button(kind, toggleListKind(kind, pick))), button('text', turnLinesIntoText(pick))],
  }
  // An embed's own line (YAZ-4907): a line beside it, as beside a code block or a table. Its keys, `addLineBeside.ts`.
  const embed = embedParagraph(view.state, line)
  return embed === null ? [strip] : [strip, ...addLineRows(view, embed)]
}

/** The paragraph at `line` when it is an embed's own line (YAZ-4907: "how do you add a bullet under it?", `embedOnlyParagraph`), else null. */
function embedParagraph(state: EditorState, line: number): number | null {
  const $line = state.doc.resolve(line)
  if ($line.depth === 0) return null
  const pos = $line.before()
  return embedOnlyParagraph(state, pos) ? pos : null
}

/** "Add line above" / "Add line below" beside the block at `blockPos`, as Enter makes one on a bullet (YAZ-4800 demo). */
function addLineRows(view: Parameters<RowProvider>[0], blockPos: number): MenuRow[] {
  const addLine = (side: 'above' | 'below'): MenuRow => ({
    label: side === 'above' ? 'Add line above' : 'Add line below',
    hint: side === 'above' ? '⌘⇧↵' : '⌘↵',
    group: 'addLine',
    run: () => void addLineBeside(view, blockPos, side),
  })
  return [addLine('above'), addLine('below')]
}

/**
 * The strip of a bullet that holds a code block or a table (YAZ-4800): Bullet list, Numbered list and Checklist, on
 * that item alone (a block is no line of its siblings' list). The lit one takes the bullet away and leaves the block
 * in place (the list rule's lift); another changes the item's kind. No T: it would make the code text a paragraph.
 */
function blockItemStrip(view: Parameters<RowProvider>[0], inside: number): (MenuStrip | MenuRow)[] {
  const block = blockItem(view.state.doc, inside)
  if (block === null) return []
  const pick: LinePick = () => [{ pos: block.pos, kind: block.kind, paragraph: false }]
  return [
    {
      kind: 'strip',
      label: 'Turn into',
      group: 'kind',
      buttons: STRIP_KINDS.map((kind) => ({
        label: block.kind === kind ? `${TOOLBAR_LABELS[kind]} (click to remove)` : block.kind === null ? `Put on a ${kind === 'bulletList' ? 'bullet' : kind === 'numberedList' ? 'numbered line' : 'checklist line'}` : TOOLBAR_LABELS[kind],
        icon: glyph(kind),
        active: block.kind === kind,
        run: () => {
          toggleListKind(kind, pick)(view.state, view.dispatch, view)
          view.focus()
        },
      })),
    },
    // A new line beside the block, as Enter makes one on a bullet (YAZ-4800 demo); its keys, `addLineBeside.ts`.
    ...addLineRows(view, block.pos),
  ]
}
