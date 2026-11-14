/**
 * Copy, cut and paste carry cell notes (YAZ-4206 D13, D18).
 *
 * COPY (`cellNotesMarkdown`, called by `clipboardCopyOut.ts`): the cell notes of the marks in the copied fragment ride
 * as Markdown, written by the save serializer, in ONE attribute (`CELL_NOTES_ATTR`) on the clipboard HTML's first
 * element. Google Sheets and Docs ignore it, so no note words reach them, nor `text/plain`.
 *
 * PASTE (`cellNoteClipboard`): the attribute is read as the HTML comes in, and the pasted slice's marks are fixed
 * before any paste path uses it (`pasteIntoCells`, a new table, text in a cell): a label a mark in this note already
 * uses gets a new one, in the marks and in the cell notes; a mark with no cell note in the attribute (a paste from another app)
 * goes, so no mark is left without its note. The paste's transaction then gets the cell notes, at the end of the
 * note; `pagesFollowTables` puts each under the table that holds its mark.
 *
 * PASTE AS › CELLS ONLY (D18, `pasteCellsOnly`): the HTML's cells with no marks and no cell notes.
 *
 * CUT: no sheet (D16). Its cell notes go to the clipboard with the copy, and leave the note with their marks.
 */
import { parserCtx, serializerCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { Fragment, type Node as ProseNode, Slice } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { isInTable } from '@milkdown/kit/prose/tables'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { freshLabels, goneNotes } from './cellNoteGuard'
import { cellNoteLabelsIn, isCellNote, isCellNoteMark, notePosOf, removeCellNote } from './cellNotes'

/** The clipboard HTML's attribute that holds the copied cell notes, as Markdown. */
export const CELL_NOTES_ATTR = 'data-yaseendocs-cell-notes'

/** The `cell-N` labels of the marks in `content`, in order, each once. */
const labelsIn = (content: Fragment): string[] => {
  const labels: string[] = []
  content.forEach((node) => {
    for (const label of isCellNoteMark(node) ? [node.attrs.label as string] : cellNoteLabelsIn(node)) if (!labels.includes(label)) labels.push(label)
  })
  return labels
}

/** The Markdown of the cell notes in `doc` of the marks in `content`, or null when there are none (D13). */
export function cellNotesMarkdown(content: Fragment, doc: ProseNode, serialize: (doc: ProseNode) => string): string | null {
  const notes = labelsIn(content).flatMap((label) => {
    const pos = notePosOf(doc, label)
    return pos === null ? [] : [doc.nodeAt(pos)!]
  })
  return notes.length === 0 ? null : serialize(doc.type.create(null, notes))
}

/** `content` with each mark's label mapped: a new label, or `null` to drop the mark. */
function remapMarks(content: Fragment, map: ReadonlyMap<string, string | null>): Fragment {
  const out: ProseNode[] = []
  content.forEach((node) => {
    if (isCellNoteMark(node)) {
      const to = map.has(node.attrs.label as string) ? map.get(node.attrs.label as string)! : (node.attrs.label as string)
      if (to !== null) out.push(node.type.create({ ...node.attrs, label: to }))
    } else out.push(node.isLeaf ? node : node.copy(remapMarks(node.content, map)))
  })
  return Fragment.from(out)
}

/**
 * A paste in flight: the attribute's Markdown, read with its HTML (null: HTML with none); the cell notes its
 * transaction gets. `undefined`: no HTML came in (a drag inside the note, a plain-text paste), and the slice is left as
 * it is.
 */
let captured: string | null | undefined
let pending: ProseNode[] = []
/** Paste as › Cells only is running: the slice loses its marks, and no cell note comes. */
let cellsOnly = false

/** The Markdown in `html`'s attribute, or null. */
const notesOfHTML = (html: string): string | null => {
  const template = document.createElement('template')
  template.innerHTML = html
  return template.content.querySelector(`[${CELL_NOTES_ATTR}]`)?.getAttribute(CELL_NOTES_ATTR) ?? null
}

/** The pasted slice, its marks fixed (relabelled, or dropped with no cell note); `pending` gets the cell notes. */
function fixSlice(ctx: Ctx, view: EditorView, slice: Slice): Slice {
  const markdown = captured
  captured = undefined
  pending = []
  const labels = labelsIn(slice.content)
  if (labels.length === 0 || (markdown === undefined && !cellsOnly)) return slice
  const notes = cellsOnly || markdown == null ? [] : ctx.get(parserCtx)(markdown).children.filter((node) => isCellNote(node) && labels.includes(node.attrs.label as string))
  const noted = new Set(notes.map((note) => note.attrs.label as string))
  const { doc } = view.state
  // A label clashes when a mark in the note uses it, or a different cell note has it. The same cell note with no mark
  // (the table's notes, left in place after a delete) keeps its label: the paste's mark takes it back, and no copy
  // comes (`appendTransaction` adds only missing notes).
  const marked = new Set(cellNoteLabelsIn(doc))
  const same = (note: ProseNode) => {
    const pos = notePosOf(doc, note.attrs.label as string)
    return pos === null || doc.nodeAt(pos)!.content.eq(note.content)
  }
  const clash = notes.filter((note) => marked.has(note.attrs.label as string) || !same(note)).map((note) => note.attrs.label as string)
  const fresh = freshLabels(doc, clash, noted)
  const map = new Map<string, string | null>(labels.map((label) => [label, noted.has(label) ? (fresh.get(label) ?? label) : null]))
  pending = notes.map((note) => note.type.create({ ...note.attrs, label: map.get(note.attrs.label as string) ?? note.attrs.label }, note.content))
  return new Slice(remapMarks(slice.content, map), slice.openStart, slice.openEnd)
}

export const cellNoteClipboard = $prose(
  (ctx) =>
    new Plugin({
      key: new PluginKey('mdapp-cell-note-clipboard'),
      props: {
        transformPastedHTML: (html) => {
          captured = notesOfHTML(html)
          return html
        },
        transformPasted: (slice, view) => fixSlice(ctx, view, slice),
      },
      appendTransaction: (trs, oldState, newState) => {
        // A cut takes its cell notes out of the note with their marks (they went to the clipboard).
        if (trs.some((tr) => tr.getMeta('uiEvent') === 'cut')) {
          const gone = goneNotes(oldState.doc, newState.doc)
          if (gone.length === 0) return null
          const tr = newState.tr
          for (const label of gone) removeCellNote(tr, label)
          return tr
        }
        if (pending.length === 0 || !trs.some((tr) => tr.getMeta('paste') === true || tr.getMeta('uiEvent') === 'paste')) return null
        const notes = pending
        pending = []
        // Only for marks the paste put in: a declined paste leaves its cell notes out.
        const placed = new Set(cellNoteLabelsIn(newState.doc))
        const kept = notes.filter((note) => placed.has(note.attrs.label as string) && notePosOf(newState.doc, note.attrs.label as string) === null)
        return kept.length === 0 ? null : newState.tr.insert(newState.doc.content.size, Fragment.from(kept))
      },
    }),
)

/**
 * Paste as › Cells only (D18): `html`'s cells into the table at the caret, with no marks and no cell notes. Outside
 * a table it does nothing (the menu row is off there).
 */
export function pasteCellsOnly(view: EditorView, html: string, text: string): boolean {
  if (!isInTable(view.state)) return false
  cellsOnly = true
  try {
    const data = { getData: (type: string) => (type === 'text/html' ? html : type === 'text/plain' ? text : '') }
    return view.pasteHTML(html, { clipboardData: data } as unknown as ClipboardEvent)
  } finally {
    cellsOnly = false
    pending = []
  }
}

/** The copy's serializer for `clipboardCopyOut.ts`: the editor's save serializer. */
export const copySerializer = (ctx: Ctx) => (doc: ProseNode) => ctx.get(serializerCtx)(doc)
