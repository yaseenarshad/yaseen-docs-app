/**
 * Cell notes (YAZ-3818 D4, D12), like notes in Google Sheets. A cell note is its own block, `cell_note`: in the file a
 * GFM footnote labelled `cell-N` right under its table, `[^cell-1]: …`, with the mark `[^cell-1]` in the cell. GitHub
 * shows the mark in the cell and the note at the bottom of the page. A cell note holds what a body cell holds
 * (`CELL_CONTENT`, D1): a `cell-N` footnote with a heading, a quote, code or a table is no cell note and stays
 * Milkdown's `footnote_definition`, as does every other footnote. In the note view a cell note is hidden (`table.css`);
 * the hidden-line checks (`lineSelection.ts`) skip it through `isCellNoteHidden`.
 *
 * `notesFollowTables` (D12): after a change that adds or removes a table, a cell note or a cell note's mark, each cell
 * note goes right under the table that holds its mark, in the order of the marks. A cell note with no mark stays where
 * it is and shows (`cell-note--orphan`): no words are hidden for good. A typed key never runs it.
 */
import { footnoteDefinitionSchema } from '@milkdown/kit/preset/gfm'
import { Fragment, type Node as ProseNode } from '@milkdown/kit/prose/model'
import { type Command, type EditorState, Plugin, PluginKey, TextSelection, type Transaction } from '@milkdown/kit/prose/state'
import { ReplaceAroundStep, ReplaceStep, type Step } from '@milkdown/kit/prose/transform'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import type { MarkdownNode } from '@milkdown/kit/transformer'
import { $nodeSchema, $prose, $remark } from '@milkdown/kit/utils'
import type { FootnoteDefinition } from 'mdast'
import { visit } from 'unist-util-visit'
import { CELL_CONTENT } from '../inlineBreaks'
import { getZoomedItemPos } from '../outline/zoom'

/** A cell note's label: `cell-1`, `cell-2`, … */
export const CELL_NOTE_LABEL = /^cell-\d+$/

/** A footnote the file holds that is a cell note: a `cell-N` label, and only lines and lists in it (D1). */
const isCellNoteDefinition = (node: MarkdownNode): boolean =>
  node.type === 'footnoteDefinition' &&
  CELL_NOTE_LABEL.test(String(node.label ?? '')) &&
  (node.children ?? []).every((child) => child.type === 'paragraph' || child.type === 'list')

const EMPTY_LINE = /^<br\s*\/?>$/i

/**
 * An empty line in a footnote: Milkdown writes it `<br />`, which reads back as an HTML block, and `inlineBreaksRemark`
 * made that a break the footnote cannot hold, so the whole footnote was dropped on load. Read it as the empty line it
 * is; the bytes stay `<br />`. Before `inlineBreaksRemark`.
 */
const footnoteEmptyLines = $remark('mdapp-footnote-empty-lines', () => () => (tree) => {
  visit(tree, 'footnoteDefinition', (note: FootnoteDefinition) => {
    note.children = note.children.map((child) => (child.type === 'html' && EMPTY_LINE.test(child.value.trim()) ? { type: 'paragraph', children: [] } : child))
  })
})

/** A cell note block. */
export const isCellNote = (node: ProseNode): boolean => node.type.name === 'cell_note'

/** A cell note's mark: a footnote reference with a `cell-N` label. */
export const isCellNoteMark = (node: ProseNode): boolean => node.type.name === 'footnote_reference' && CELL_NOTE_LABEL.test(node.attrs.label as string)

/**
 * The cell note (D4): hidden in the note view, opened as a page by the bullet zoom (YAZ-3818 4B). It holds what a body
 * cell holds. Read from a `footnoteDefinition` labelled `cell-N`, written back as one.
 */
export const cellNoteSchema = $nodeSchema('cell_note', () => ({
  group: 'block',
  content: CELL_CONTENT,
  defining: true,
  attrs: { label: { default: '', validate: 'string' } },
  parseDOM: [{ tag: 'section[data-type="cell_note"]', getAttrs: (dom) => ({ label: (dom as HTMLElement).dataset.label ?? '' }) }],
  toDOM: (node) => ['section', { 'data-type': 'cell_note', 'data-label': node.attrs.label as string, class: 'cell-note' }, 0],
  parseMarkdown: {
    match: isCellNoteDefinition,
    runner: (state, node, type) => {
      state.openNode(type, { label: node.label as string }).next(node.children).closeNode()
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'cell_note',
    runner: (state, node) => {
      const label = node.attrs.label as string
      state.openNode('footnoteDefinition', undefined, { label, identifier: label }).next(node.content).closeNode()
    },
  },
}))

/** Every other footnote keeps Milkdown's node. */
const otherFootnotes = footnoteDefinitionSchema.extendSchema((prev) => (ctx) => {
  const base = prev(ctx)
  return { ...base, parseMarkdown: { ...base.parseMarkdown, match: (node: MarkdownNode) => base.parseMarkdown.match(node) && !isCellNoteDefinition(node) } }
})

/** The `cell-N` labels of the marks in `node` (a cell, a row, a table), in document order. */
export function cellNoteLabelsIn(node: ProseNode): string[] {
  const labels: string[] = []
  node.descendants((child) => {
    if (isCellNoteMark(child)) labels.push(child.attrs.label as string)
    return true
  })
  return labels
}

/** The smallest `cell-N` that no mark, cell note or footnote in `doc` uses. */
export function nextCellNoteLabel(doc: ProseNode): string {
  const used = new Set<string>()
  doc.descendants((node) => {
    if (node.type.name === 'footnote_reference' || node.type.name === 'footnote_definition' || isCellNote(node)) used.add(node.attrs.label as string)
    return true
  })
  let n = 1
  while (used.has(`cell-${n}`)) n++
  return `cell-${n}`
}

/** The label of the first mark in the cell at `cellPos`, or null. */
export const cellNoteOf = (doc: ProseNode, cellPos: number): string | null => cellNoteLabelsIn(doc.nodeAt(cellPos)!)[0] ?? null

/** The cell at `cellPos`'s table: its position, and where the node after it starts. */
const tableAround = (doc: ProseNode, cellPos: number): { pos: number; end: number; node: ProseNode } => {
  const $cell = doc.resolve(cellPos)
  const depth = $cell.depth - 1
  return { pos: $cell.before(depth), end: $cell.after(depth), node: $cell.node(depth) }
}

/**
 * Add a cell note to the cell at `cellPos` (D4, D8): the mark at the END of the cell's first line (in a cell that
 * starts with a list, the first bullet's line), and a cell note with one empty line right under the table, among the
 * table's notes in the order of the marks. `added` gets the note's position in the new doc, for 4B to open it.
 * Declines on a cell that already has a cell note.
 */
export const addCellNote =
  (cellPos: number, added?: (notePos: number) => void): Command =>
  (state, dispatch) => {
    const { doc, schema } = state
    if (cellNoteOf(doc, cellPos) !== null) return false
    let line = doc.nodeAt(cellPos)!
    let linePos = cellPos
    while (!line.isTextblock) {
      line = line.firstChild!
      linePos++
    }
    if (!dispatch) return true
    const label = nextCellNoteLabel(doc)
    const tr = state.tr.insert(linePos + line.nodeSize - 1, schema.nodes.footnote_reference.create({ label }))
    const table = tableAround(tr.doc, cellPos)
    const order = cellNoteLabelsIn(table.node)
    const $end = tr.doc.resolve(table.end)
    // Past the table's notes whose marks come first.
    let at = table.end
    for (let index = $end.index(); index < $end.parent.childCount; index++) {
      const next = $end.parent.child(index)
      const rank = isCellNote(next) ? order.indexOf(next.attrs.label as string) : -1
      if (rank < 0 || rank > order.indexOf(label)) break
      at += next.nodeSize
    }
    tr.insert(at, schema.nodes.cell_note.createAndFill({ label })!)
    dispatch(tr)
    added?.(at)
    return true
  }

/** Delete every mark labelled `label` and its cell note (4C calls it). Returns `tr`. */
export function removeCellNote(tr: Transaction, label: string): Transaction {
  const ranges: Array<{ from: number; to: number }> = []
  tr.doc.descendants((node, pos) => {
    if ((isCellNoteMark(node) || isCellNote(node)) && node.attrs.label === label) {
      ranges.push({ from: pos, to: pos + node.nodeSize })
      return false
    }
    return true
  })
  for (const { from, to } of ranges.reverse()) tr.delete(from, to)
  return tr
}

/**
 * For 4B's crumb (D9): the column's header text and the row's first-cell text of the cell that holds the mark
 * `label`. Empty strings when no table holds it.
 */
export function cellNoteCrumbParts(doc: ProseNode, label: string): { column: string; row: string } {
  let markPos: number | null = null
  doc.descendants((node, pos) => {
    if (markPos === null && isCellNoteMark(node) && node.attrs.label === label) markPos = pos
    return markPos === null
  })
  if (markPos === null) return { column: '', row: '' }
  // Up from the mark to its cell: table > row > cell.
  const $mark = doc.resolve(markPos)
  for (let depth = $mark.depth; depth > 2; depth--) {
    if ($mark.node(depth - 2).type.name !== 'table') continue
    const column = $mark.node(depth - 2).firstChild!.maybeChild($mark.index(depth - 1))
    return { column: column?.textContent ?? '', row: $mark.node(depth - 1).firstChild!.textContent }
  }
  return { column: '', row: '' }
}

const cellNotesKey = new PluginKey<DecorationSet>('mdapp-cell-notes')

/** The orphan decorations: a cell note whose label no mark in `doc` has (D12). */
function orphans(doc: ProseNode): DecorationSet {
  const marked = new Set<string>()
  const notes: Array<{ pos: number; node: ProseNode }> = []
  doc.descendants((node, pos) => {
    if (isCellNoteMark(node)) marked.add(node.attrs.label as string)
    else if (isCellNote(node)) notes.push({ pos, node })
    return true
  })
  const decorations = notes.filter(({ node }) => !marked.has(node.attrs.label as string)).map(({ pos, node }) => Decoration.node(pos, pos + node.nodeSize, { class: 'cell-note--orphan' }))
  return DecorationSet.create(doc, decorations)
}

/** A cell note with no mark: it shows (D12). */
const isOrphan = (state: EditorState, pos: number): boolean => (cellNotesKey.getState(state)?.find(pos, pos + 1) ?? []).some((deco) => deco.from === pos)

/**
 * Is the cell note at `pos` hidden? Yes, unless it has no mark, or the zoom shows it: its page, or a bullet in it
 * (YAZ-3818 D9).
 */
export const isCellNoteHidden = (state: EditorState, pos: number): boolean => {
  if (isOrphan(state, pos)) return false
  const zoomed = getZoomedItemPos(state)
  return zoomed === null || zoomed < pos || zoomed >= pos + state.doc.nodeAt(pos)!.nodeSize
}

/** A node whose coming or going can move a cell note: a table, a cell note, a mark. */
const isNoteNode = (node: ProseNode): boolean => node.type.name === 'table' || isCellNote(node) || isCellNoteMark(node)

/** Does `fragment` hold a table, a cell note or a mark? */
const holdsNoteNodes = (fragment: Fragment): boolean => {
  let found = false
  fragment.descendants((node) => {
    found ||= isNoteNode(node)
    return !found
  })
  return found
}

/**
 * Does the step (on `doc`, the doc before it) add or remove a table, a cell note or a mark? Its slice, and the range it
 * replaces. A typed character inserts text and replaces nothing; a key that deletes looks at its own line only.
 */
const stepTouchesNotes = (step: Step, doc: ProseNode): boolean => {
  if (!(step instanceof ReplaceStep || step instanceof ReplaceAroundStep)) return false
  if (holdsNoteNodes(step.slice.content)) return true
  const { from, to } = step
  if (from === to) return false
  const $from = doc.resolve(from)
  if ($from.parent.isTextblock && to <= $from.end()) {
    let found = false
    $from.parent.nodesBetween($from.parentOffset, $from.parentOffset + to - from, (node) => {
      found ||= isCellNoteMark(node)
    })
    return found
  }
  let found = false
  doc.nodesBetween(from, to, (node, pos) => {
    // A node around the whole range stays.
    found ||= isNoteNode(node) && !(pos < from && pos + node.nodeSize > to)
    return !found
  })
  return found
}

const touched = new WeakMap<Transaction, boolean>()
/**
 * Does `tr` add or remove a table, a cell note or a mark? Asked by the state, by the placement and by the "Add cell note"
 * button (`cellNoteButton.ts`): kept per transaction.
 */
export const touchesNotes = (tr: Transaction): boolean => {
  let answer = touched.get(tr)
  if (answer === undefined) {
    answer = tr.steps.some((step, i) => stepTouchesNotes(step, tr.docs[i]!))
    touched.set(tr, answer)
  }
  return answer
}

/** How many times the placement ran: a test proves that typing never runs it (D12). */
export const cellNotePlacements = { runs: 0 }

/**
 * D12: each table's cell notes right under it, in its parent, in the order of the marks. A transaction that moves the
 * notes that are not in place, or null when all are.
 */
function placeNotes(state: EditorState): Transaction | null {
  cellNotePlacements.runs++
  const { doc } = state
  const tables: Array<{ pos: number; node: ProseNode; parent: ProseNode; index: number }> = []
  // The first cell note with each label.
  const notes = new Map<string, { pos: number; node: ProseNode }>()
  doc.descendants((node, pos, parent, index) => {
    if (node.type.name === 'table') tables.push({ pos, node, parent: parent!, index })
    else if (isCellNote(node) && !notes.has(node.attrs.label as string)) notes.set(node.attrs.label as string, { pos, node })
    return !node.isTextblock
  })
  if (notes.size === 0) return null
  // Each label goes to the innermost table that holds its mark: a later table in this walk is the deeper one.
  const owner = new Map<string, number>()
  tables.forEach(({ node }, t) => {
    for (const label of cellNoteLabelsIn(node)) if (notes.has(label)) owner.set(label, t)
  })
  const moves: Array<{ table: (typeof tables)[number]; notes: Array<{ pos: number; node: ProseNode }> }> = []
  tables.forEach((table, t) => {
    const own = [...new Set(cellNoteLabelsIn(table.node))].filter((label) => owner.get(label) === t).map((label) => notes.get(label)!)
    // A note that holds the table cannot go under it.
    const placed = own.filter((note) => !(note.pos < table.pos && table.pos < note.pos + note.node.nodeSize))
    const inPlace = placed.every((note, k) => table.parent.maybeChild(table.index + 1 + k) === note.node)
    if (!inPlace) moves.push({ table, notes: placed })
  })
  if (moves.length === 0) return null
  const tr = state.tr
  const moved = moves.flatMap((move) => move.notes).sort((a, b) => b.pos - a.pos)
  for (const note of moved) tr.delete(note.pos, note.pos + note.node.nodeSize)
  for (const { table, notes: own } of moves) tr.insert(tr.mapping.map(table.pos + table.node.nodeSize, -1), Fragment.from(own.map((note) => note.node)))
  return tr
}

/**
 * D12. The state: the orphan decorations, built again after a transaction that adds or removes a table, a cell note or
 * a mark, and mapped after any other.
 */
const notesFollowTables = $prose(
  () =>
    new Plugin<DecorationSet>({
      key: cellNotesKey,
      state: {
        init: (_, { doc }) => orphans(doc),
        apply: (tr, set) => {
          if (!tr.docChanged) return set
          return touchesNotes(tr) ? orphans(tr.doc) : set.map(tr.mapping, tr.doc)
        },
      },
      appendTransaction: (trs, _old, state) => (trs.some((tr) => tr.docChanged && touchesNotes(tr)) ? placeNotes(state) : null),
      props: { decorations: (state) => cellNotesKey.getState(state) },
    }),
)

/**
 * The mark is protected (D8): Backspace right after a mark, or Delete right before one, moves the caret over it, and
 * the key then does its own work there. So Backspace after "Flights[^cell-1]" deletes the "s". Before every keymap
 * (Milkdown puts the keymaps after the plugins), so each of them reads the moved caret. Any other removal is allowed:
 * the cell note then shows (D12).
 */
const protectMarks = $prose(
  () =>
    new Plugin({
      key: new PluginKey('mdapp-cell-note-marks'),
      props: {
        handleKeyDown: (view, event) => {
          const back = event.key === 'Backspace'
          if ((!back && event.key !== 'Delete') || event.isComposing || !view.state.selection.empty) return false
          const { doc } = view.state
          const beside = (at: number) => (back ? doc.resolve(at).nodeBefore : doc.resolve(at).nodeAfter)
          let pos = view.state.selection.head
          for (let node = beside(pos); node !== null && isCellNoteMark(node); node = beside(pos)) pos += back ? -node.nodeSize : node.nodeSize
          if (pos !== view.state.selection.head) view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, pos)))
          return false
        },
      },
    }),
)

/** Register with `editor.use(cellNotes)`, next to the table and cell schemas, before `inlineBreaks`. */
export const cellNotes = [footnoteEmptyLines, cellNoteSchema, otherFootnotes, notesFollowTables, protectMarks].flat()
