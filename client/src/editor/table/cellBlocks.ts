/**
 * What a cell and a cell note hold (YAZ-3818 D1): lines and lists, and in a list's items lines and lists too. Milkdown's
 * `list_item` holds any block, so a key, a command, a paste or a drag could put a heading, a quote, code, a rule or a
 * table in a cell's bullet. The cell's one line of HTML (D2) cannot keep them: the save dropped a heading, and a table
 * broke its row. `cellBlocksOnly` turns each such block into lines right after the change that put it there, in the
 * same history step: a heading is a line with its words, code one line for each of its lines, a quote or a table one
 * line for each of its lines of text, a rule nothing. An input rule (`# `, `> `, `---`, a code fence, `|2x2| `) is
 * undone instead, and its typed text comes back: `# ` then a word stays `# word`.
 *
 * It looks only at each step's slice: a slice with no other block (a typed character, Enter in a bullet) stops the
 * check, so a key pays one short walk of its slice. The slash menu hides the rows a cell cannot hold (`slashMenu.ts`).
 */
import type { Node as ProseNode, ResolvedPos, Schema, Slice } from '@milkdown/kit/prose/model'
import { type EditorState, Plugin, PluginKey, TextSelection, type Transaction } from '@milkdown/kit/prose/state'
import { Mapping, ReplaceAroundStep, ReplaceStep } from '@milkdown/kit/prose/transform'
import { $prose } from '@milkdown/kit/utils'
import { isTableCell } from '../outline/listNodes'
import { isCellNote } from './cellNotes'

/** Is `$pos` inside a table cell or a cell note, at any depth? What they hold is lines and lists (D1). */
export const inCellOrNote = ($pos: ResolvedPos): boolean => {
  for (let depth = $pos.depth; depth > 0; depth--) if (isTableCell($pos.node(depth)) || isCellNote($pos.node(depth))) return true
  return false
}

/** The blocks a cell holds, and the ones a table is made of (a table's own cells are checked as cells). */
const ALLOWED = new Set(['paragraph', 'bullet_list', 'ordered_list', 'list_item', 'table_header_row', 'table_row', 'table_header', 'table_cell'])

const isOther = (node: ProseNode): boolean => node.isBlock && !ALLOWED.has(node.type.name)

/** Does a step's slice hold a block a cell cannot hold? */
const holdsOther = (content: ProseNode['content']): boolean => {
  let found = false
  content.descendants((node) => {
    found ||= isOther(node)
    return !found && !node.isTextblock
  })
  return found
}

/** `node` as lines: a heading's words, code's lines, the lines of text in a quote or a table; a rule gives none. */
function linesOf(node: ProseNode, schema: Schema): ProseNode[] {
  const line = schema.nodes.paragraph!
  if (node.type.spec.code) return node.textContent.split('\n').map((text) => line.create(null, text === '' ? null : schema.text(text)))
  if (node.isTextblock) return [line.create(null, node.content)]
  const lines: ProseNode[] = []
  node.descendants((child) => {
    if (child.isTextblock) lines.push(...linesOf(child, schema))
    return !child.isTextblock
  })
  return lines
}

/** A range in the last doc where a change put a slice with another block; `split` when the slice closes and opens a cell note. */
interface Inserted {
  from: number
  to: number
  split: boolean
}

/** Does the slice close a cell note at its start and open one at its end (a block put on the note's line)? */
const splitsNote = (slice: Slice): boolean => {
  const side = (first: boolean, open: number): boolean => {
    let node = first ? slice.content.firstChild : slice.content.lastChild
    for (let depth = 0; node !== null && depth < open; depth++, node = first ? node.firstChild : node.lastChild) if (isCellNote(node)) return true
    return false
  }
  return side(true, slice.openStart) && side(false, slice.openEnd)
}

/** Where the changes of `trs` put a slice with another block, as ranges in the last doc. */
function insertedRanges(trs: readonly Transaction[]): Inserted[] {
  const ranges: Inserted[] = []
  trs.forEach((tr, t) => {
    tr.steps.forEach((step, s) => {
      if (!(step instanceof ReplaceStep || step instanceof ReplaceAroundStep) || !holdsOther(step.slice.content)) return
      let from = Infinity
      let to = -Infinity
      step.getMap().forEach((_oldFrom, _oldTo, newFrom, newTo) => {
        from = Math.min(from, newFrom)
        to = Math.max(to, newTo)
      })
      const rest = new Mapping(tr.mapping.maps.slice(s + 1))
      for (const later of trs.slice(t + 1)) rest.appendMapping(later.mapping)
      ranges.push({ from: rest.map(from, -1), to: rest.map(to, 1), split: splitsNote(step.slice) })
    })
  })
  return ranges
}

/** The blocks in `ranges` that sit in a cell or a cell note, outermost only. */
function othersIn(doc: ProseNode, ranges: Inserted[]): Array<{ pos: number; node: ProseNode }> {
  const found = new Map<number, ProseNode>()
  for (const { from, to } of ranges) {
    doc.nodesBetween(from, to, (node, pos) => {
      if (found.has(pos)) return false
      if (!isOther(node) || !inCellOrNote(doc.resolve(pos))) return !node.isTextblock
      found.set(pos, node)
      return false
    })
  }
  return [...found].map(([pos, node]) => ({ pos, node }))
}

/**
 * A step that put a block on a cell note's line closes the note before the block and opens it again after (the
 * replace's fit; `isolating` stops only the commands): two notes with one label, side by side with the block between.
 * Each such run in the ranges of a slice that splits a note, to become one note again. A pasted note with a label in use
 * is no split (YAZ-4206 gives it a new label).
 */
function splitNotes(doc: ProseNode, ranges: Inserted[]): Array<{ from: number; to: number; nodes: ProseNode[] }> {
  const notes: Array<{ pos: number; node: ProseNode; parent: ProseNode; index: number }> = []
  for (const { from, to } of ranges.filter((range) => range.split)) {
    doc.nodesBetween(from, to, (node, pos, parent, index) => {
      if (isCellNote(node) && !notes.some((note) => note.pos === pos)) notes.push({ pos, node, parent: parent!, index })
      return !isCellNote(node) && !node.isTextblock
    })
  }
  notes.sort((a, b) => a.pos - b.pos)
  const runs: Array<{ from: number; to: number; nodes: ProseNode[] }> = []
  notes.forEach((note, i) => {
    const first = notes[i - 1]
    if (first === undefined || first.parent !== note.parent || first.node.attrs.label !== note.node.attrs.label) return
    const nodes: ProseNode[] = []
    for (let k = first.index; k <= note.index; k++) nodes.push(note.parent.child(k))
    runs.push({ from: first.pos, to: note.pos + note.node.nodeSize, nodes })
  })
  return runs
}

/** One cell note of a split run: the halves' blocks, and the blocks between as lines (or as they are: a line, a list). */
function joinedNote(nodes: ProseNode[], schema: Schema): ProseNode {
  const blocks = nodes.flatMap((node) => (isCellNote(node) ? node.children : ALLOWED.has(node.type.name) ? [node] : linesOf(node, schema)))
  return nodes[0]!.type.create(nodes[0]!.attrs, blocks)
}

/** The input rule's own record of its last run (prosemirror-inputrules): its transaction and the text it took. */
interface InputRuleRun {
  transform: Transaction
  from: number
  to: number
  text: string
}

/** The run of an input rule that `tr` is, or null. */
const inputRuleRun = (state: EditorState, tr: Transaction): InputRuleRun | null => {
  const rules = state.plugins.find((plugin) => (plugin.spec as { isInputRules?: boolean }).isInputRules)
  return rules === undefined ? null : ((tr.getMeta(rules) as InputRuleRun | undefined) ?? null)
}

/** Undo the input rule's run, the last change, and type its text, as `undoInputRule` does. */
function typedBack(state: EditorState, run: InputRuleRun): Transaction {
  const tr = state.tr
  const { steps, docs } = run.transform
  for (let i = steps.length - 1; i >= 0; i--) tr.step(steps[i]!.invert(docs[i]!))
  tr.replaceWith(run.from, run.to, state.schema.text(run.text, tr.doc.resolve(run.from).marks()))
  return tr.setSelection(TextSelection.create(tr.doc, run.from + run.text.length))
}

/** D1: register with `editor.use(cellBlocksOnly)`. */
export const cellBlocksOnly = $prose(
  () =>
    new Plugin({
      key: new PluginKey('mdapp-cell-blocks'),
      appendTransaction: (trs, _old, state) => {
        if (!trs.some((tr) => tr.docChanged)) return null
        const ranges = insertedRanges(trs)
        const others = othersIn(state.doc, ranges)
        const splits = splitNotes(state.doc, ranges)
        if (others.length === 0 && splits.length === 0) return null
        const last = trs.filter((tr) => tr.docChanged).at(-1)!
        const run = inputRuleRun(state, last)
        if (run !== null && run.transform === last) return typedBack(state, run)
        const tr = state.tr
        // A split note first: the next round turns what it holds into lines.
        if (splits.length > 0) {
          for (const { from, to, nodes } of splits.reverse()) tr.replaceWith(from, to, joinedNote(nodes, state.schema))
          return tr
        }
        for (const { pos, node } of others.sort((a, b) => b.pos - a.pos)) {
          const lines = linesOf(node, state.schema)
          const parent = state.doc.resolve(pos).parent
          tr.replaceWith(pos, pos + node.nodeSize, lines.length > 0 || parent.childCount > 1 ? lines : [state.schema.nodes.paragraph!.create()])
        }
        return tr
      },
    }),
)
