/**
 * Cell notes (YAZ-3818 D4, D12), like notes in Google Sheets. A cell note is its own block, `cell_note`: in the file a
 * GFM footnote labelled `cell-N` right under its table, `[^cell-1]: …`, with the mark `[^cell-1]` in the cell. GitHub
 * shows the mark in the cell and the note at the bottom of the page. A cell note holds what a body cell holds
 * (`CELL_CONTENT`, D1): a `cell-N` footnote with a heading, a quote, code or a table is no cell note and stays
 * Milkdown's `footnote_definition`, as does every other footnote. In the note view a cell note is hidden (`table.css`),
 * except the one open as a card beside its cell (`cellNoteCard.ts`, the YAZ-3818 demo); the hidden-line checks
 * (`lineSelection.ts`) skip it through `isCellNoteHidden`.
 *
 * `notesFollowTables` (D12): after a change that adds or removes a table, a cell note or a cell note's mark, each cell
 * note goes right under the table that holds its mark, in the order of the marks. A cell note with no mark in a table
 * cell stays where it is and shows (`cell-note--orphan`): no words are hidden for good. A typed key never runs it. Its
 * state also gives each cell that holds a mark the class that draws the corner triangle (`CELL_NOTE_CELL_CLASS`).
 */
import { footnoteDefinitionSchema } from '@milkdown/kit/preset/gfm'
import { Fragment, type Node as ProseNode, type ResolvedPos } from '@milkdown/kit/prose/model'
import { type Command, type EditorState, Plugin, PluginKey, TextSelection, type Transaction } from '@milkdown/kit/prose/state'
import { ReplaceAroundStep, ReplaceStep, type Step } from '@milkdown/kit/prose/transform'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import type { MarkdownNode } from '@milkdown/kit/transformer'
import { $nodeSchema, $prose, $remark } from '@milkdown/kit/utils'
import type { FootnoteDefinition } from 'mdast'
import { visit } from 'unist-util-visit'
import { BR, CELL_CONTENT } from '../inlineBreaks'
import { cellPosAround } from '../outline/listNodes'

/** A cell note's label: `cell-1`, `cell-2`, … */
export const CELL_NOTE_LABEL = /^cell-\d+$/

/** A footnote the file holds that is a cell note: a `cell-N` label, and only lines and lists in it (D1). */
const isCellNoteDefinition = (node: MarkdownNode): boolean =>
  node.type === 'footnoteDefinition' &&
  CELL_NOTE_LABEL.test(String(node.label ?? '')) &&
  (node.children ?? []).every((child) => child.type === 'paragraph' || child.type === 'list')

/**
 * An empty line in a footnote: Milkdown writes it `<br />`, which reads back as an HTML block, and `inlineBreaksRemark`
 * made that a break the footnote cannot hold, so the whole footnote was dropped on load. Read it as the empty line it
 * is; the bytes stay `<br />`. Before `inlineBreaksRemark`.
 */
const footnoteEmptyLines = $remark('mdapp-footnote-empty-lines', () => () => (tree) => {
  visit(tree, 'footnoteDefinition', (note: FootnoteDefinition) => {
    note.children = note.children.map((child) => (child.type === 'html' && BR.test(child.value.trim()) ? { type: 'paragraph', children: [] } : child))
  })
})

/** A cell note block. */
export const isCellNote = (node: ProseNode): boolean => node.type.name === 'cell_note'

/** A cell note's mark: a footnote reference with a `cell-N` label. */
export const isCellNoteMark = (node: ProseNode): boolean => node.type.name === 'footnote_reference' && CELL_NOTE_LABEL.test(node.attrs.label as string)

/**
 * The cell note (D4): hidden in the note view, opened as a card beside its cell (`cellNoteCard.ts`). It holds what a body
 * cell holds. Read from a `footnoteDefinition` labelled `cell-N`, written back as one.
 */
export const cellNoteSchema = $nodeSchema('cell_note', () => ({
  group: 'block',
  content: CELL_CONTENT,
  defining: true,
  // One label, one note (YAZ-3818 5A-2): no split, join or block insert crosses its edge, as for a table's cells.
  isolating: true,
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

/** The cell at `cellPos`'s table: its position, and where the node after it starts (a new cell note goes there). */
export const tableAround = (doc: ProseNode, cellPos: number): { pos: number; end: number; node: ProseNode } => {
  const $cell = doc.resolve(cellPos)
  const depth = $cell.depth - 1
  return { pos: $cell.before(depth), end: $cell.after(depth), node: $cell.node(depth) }
}

/**
 * Add a cell note to the cell at `cellPos` (D4, D8): the mark at the END of the cell's first line (in a cell that
 * starts with a list, the first bullet's line), and a cell note with one empty line right under the table, among the
 * table's notes in the order of the marks. Find the note by its label (`notePosOf`): `notesFollowTables` may move it.
 * Declines on a cell that already has a cell note. `blocks`: what the new note holds instead (the template, round 3 of
 * the demo).
 */
export const addCellNote =
  (cellPos: number, blocks?: readonly ProseNode[]): Command =>
  (state, dispatch) => {
    if (cellNoteOf(state.doc, cellPos) !== null) return false
    if (dispatch) dispatch(insertCellNote(state.tr, cellPos, blocks))
    return true
  }

/** `addCellNote`'s steps, in `tr` (on its doc): the mark, and the note under the table. Returns `tr`. */
export function insertCellNote(tr: Transaction, cellPos: number, blocks?: readonly ProseNode[]): Transaction {
  const { schema } = tr.doc.type
  let line = tr.doc.nodeAt(cellPos)!
  let linePos = cellPos
  while (!line.isTextblock) {
    line = line.firstChild!
    linePos++
  }
  const label = nextCellNoteLabel(tr.doc)
  tr.insert(linePos + line.nodeSize - 1, schema.nodes.footnote_reference.create({ label }))
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
  tr.insert(at, (blocks === undefined ? null : schema.nodes.cell_note.createAndFill({ label }, blocks)) ?? schema.nodes.cell_note.createAndFill({ label })!)
  return tr
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

/** The position of the first node in `doc` that `match` takes, or null. A walk that stops at it. */
const firstPos = (doc: ProseNode, match: (node: ProseNode) => boolean): number | null => {
  let found: number | null = null
  doc.descendants((node, pos) => {
    if (found === null && match(node)) found = pos
    return found === null
  })
  return found
}

/** The position of the first mark labelled `label`, or null. */
export const markPosOf = (doc: ProseNode, label: string): number | null => firstPos(doc, (node) => isCellNoteMark(node) && node.attrs.label === label)

/** The position of the first cell note labelled `label`, or null. */
export const notePosOf = (doc: ProseNode, label: string): number | null => firstPos(doc, (node) => isCellNote(node) && node.attrs.label === label)

/** The position of the cell note that holds `$pos`, or null. */
export const cellNoteAround = ($pos: ResolvedPos): number | null => {
  for (let depth = $pos.depth; depth > 0; depth--) if (isCellNote($pos.node(depth))) return $pos.before(depth)
  return null
}

/** The new cell note template's content as JSON (`cellNoteCard.ts`), or null when there is none: a note just so is empty. */
let templateJson: string | null = null

/** Set by the card when it makes a note from the template, cleared when the template changes (round 3 of the demo). */
export function setCellNoteTemplateJson(json: string | null): void {
  templateJson = json
}

/**
 * A cell note that holds one empty line, or exactly the new note template (round 3 of the demo): closing its card
 * removes it, and a save leaves it out (D15).
 */
export const isEmptyCellNote = (note: ProseNode): boolean =>
  (note.childCount === 1 && note.firstChild!.isTextblock && note.firstChild!.content.size === 0) ||
  (templateJson !== null && JSON.stringify(note.content.toJSON()) === templateJson)

/**
 * The doc a save writes (D15): without each cell note that holds one empty line, and without its mark. Every route
 * that saves (the debounced save, a tab closing, another note in the tab, quit) reads the bytes from here, so an empty
 * note never reaches the file, whatever way its page closes. `state.doc` itself when there is none.
 */
export function withoutEmptyCellNotes(state: EditorState): ProseNode {
  const labels: string[] = []
  state.doc.descendants((node) => {
    if (isCellNote(node) && isEmptyCellNote(node)) labels.push(node.attrs.label as string)
    return !isCellNote(node) && !node.isTextblock
  })
  if (labels.length === 0) return state.doc
  const tr = state.tr
  for (const label of labels) removeCellNote(tr, label)
  return tr.doc
}

/**
 * For 4B's crumb (D9): the column's header text and the row's first-cell text of the cell that holds the mark
 * `label`, a cell's lines and bullets joined with a space. No row for a cell in the header row: it names no row.
 * Empty strings when no table holds it.
 */
export function cellNoteCrumbParts(doc: ProseNode, label: string): { column: string; row: string } {
  const mark = markPosOf(doc, label)
  const cell = mark === null ? null : cellPosAround(doc.resolve(mark))
  if (cell === null) return { column: '', row: '' }
  // table > row > cell.
  const $cell = doc.resolve(cell)
  const words = (node: ProseNode | null) => (node === null ? '' : node.textBetween(0, node.content.size, ' '))
  const header = $cell.index(-1) === 0
  return { column: words($cell.node(-1).firstChild!.maybeChild($cell.index())), row: header ? '' : words($cell.parent.firstChild) }
}

/** A cell note's title (D9), for its card and its preview: "Note: <column> · <row>", or "Note" when neither has words. */
export function cellNoteTitle(doc: ProseNode, label: string): string {
  const { column, row } = cellNoteCrumbParts(doc, label)
  const parts = [column, row].map((text) => text.trim()).filter((text) => text !== '')
  const title = parts.length === 0 ? 'Note' : `Note: ${parts.join(' · ')}`
  return title.length > 60 ? `${title.slice(0, 59).trimEnd()}…` : title
}

/**
 * The open cell note card (the YAZ-3818 demo, `cellNoteCard.ts`): the open note's label, its position and its cell's
 * position (mapped), and the card's decorations. All null when no card is open. Here so `isCellNoteHidden` reads it.
 */
export interface CellNoteCardState {
  label: string | null
  pos: number | null
  cell: number | null
  /** "All notes" (round 4 of the demo): the card shows every cell note of the page, read-only. */
  all: boolean
  set: DecorationSet
}

export const cellNoteCardKey = new PluginKey<CellNoteCardState>('mdapp-cell-note-card')

/** The label of the cell note open as a card, or null. */
export const openCellNoteLabel = (state: EditorState): string | null => cellNoteCardKey.getState(state)?.label ?? null

const cellNotesKey = new PluginKey<DecorationSet>('mdapp-cell-notes')

/** The class of a cell that holds a mark: table.css draws the corner triangle on it (D8). */
export const CELL_NOTE_CELL_CLASS = 'has-cell-note'

/**
 * The state's decorations: each cell that holds a mark gets `CELL_NOTE_CELL_CLASS`, and a cell note whose label no
 * mark in a table cell has is an orphan (D12). A mark in a plain line or in a cell note does not count: no table
 * places that note, and a click on that mark opens nothing.
 */
function noteDecorations(doc: ProseNode): DecorationSet {
  const marked = new Set<string>()
  const cells = new Map<number, ProseNode>()
  const notes: Array<{ pos: number; node: ProseNode }> = []
  doc.descendants((node, pos) => {
    if (isCellNote(node)) notes.push({ pos, node })
    else if (isCellNoteMark(node)) {
      const cell = cellPosAround(doc.resolve(pos))
      if (cell !== null) {
        marked.add(node.attrs.label as string)
        cells.set(cell, doc.nodeAt(cell)!)
      }
    }
    return true
  })
  const decorations = [
    ...[...cells].map(([pos, node]) => Decoration.node(pos, pos + node.nodeSize, { class: CELL_NOTE_CELL_CLASS })),
    ...notes.filter(({ node }) => !marked.has(node.attrs.label as string)).map(({ pos, node }) => Decoration.node(pos, pos + node.nodeSize, { class: 'cell-note--orphan' })),
  ]
  return DecorationSet.create(doc, decorations)
}

/** The corner square that takes a click or a rest for the triangle (D8): the triangle's 8 px and a little more. */
const CORNER_PX = 10

/**
 * The cell of this view whose corner triangle a pointer event is in, or null (D8, 5A-18): a cell with
 * `CELL_NOTE_CELL_CLASS`, and the event in its top-right `CORNER_PX` square. Reads the cell's box only over such a cell.
 */
export function cellNoteCornerAt(view: EditorView, event: MouseEvent): HTMLElement | null {
  const cell = event.target instanceof Element ? event.target.closest<HTMLElement>(`.${CELL_NOTE_CELL_CLASS}`) : null
  if (cell === null || !view.dom.contains(cell)) return null
  const box = cell.getBoundingClientRect()
  return event.clientX >= box.right - CORNER_PX && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.top + CORNER_PX ? cell : null
}

/** A cell note with no mark in a cell: it shows (D12). Only an orphan's decoration starts at a cell note. */
const isOrphan = (state: EditorState, pos: number): boolean => (cellNotesKey.getState(state)?.find(pos, pos + 1) ?? []).some((deco) => deco.from === pos)

/** Is the cell note at `pos` hidden? Yes, unless it has no mark, or it is open as a card (the YAZ-3818 demo). */
export const isCellNoteHidden = (state: EditorState, pos: number): boolean => !isOrphan(state, pos) && cellNoteCardKey.getState(state)?.pos !== pos

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
 * D12. The state: the orphan decorations and the marked cells' class (5A-18), built again after a transaction that adds
 * or removes a table, a cell note or a mark, and mapped after any other: a typed key only maps them.
 */
const notesFollowTables = $prose(
  () =>
    new Plugin<DecorationSet>({
      key: cellNotesKey,
      state: {
        init: (_, { doc }) => noteDecorations(doc),
        apply: (tr, set) => {
          if (!tr.docChanged) return set
          return touchesNotes(tr) ? noteDecorations(tr.doc) : set.map(tr.mapping, tr.doc)
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
