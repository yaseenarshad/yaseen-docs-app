/**
 * Cell notes and the actions that delete, duplicate or paste cells (YAZ-4206: D16, D17).
 *
 * THE ASK: the editor asks `PageMenu` (`pageMenu.tsx`) for the app's `ConfirmSheet` through a DOM event on the
 * editor (`CELL_NOTE_ASK`), as a table handle asks for the menu (`TABLE_HANDLE_MENU`). An editor with no `PageMenu`
 * (a bare mount, a preview) hears no answer, and the action runs as it did before.
 *
 * D16, DELETE: `deleteWithNotes` builds the action's transaction on the current state and compares the cell note
 * marks before and after. When no cell note would go it dispatches at once. Else the sheet asks ("Delete this row
 * and its 2 cell notes?", Delete in red, Cancel); Delete builds the action again and removes each gone cell note in
 * the same transaction, so one ⌘Z brings back the cells and the cell notes. The paths: the table menu's Delete row,
 * Delete column and Clear cells (`tableMenu.ts`), the cell toolbar's Clear cells (`cellToolbar.ts`), each delete
 * key (Delete, Backspace, ⌘Backspace, …) on selected cells and on a selection that holds a whole table
 * (`cellNoteDeleteGuard`, before `tableEditing`). Cut never asks: its cell notes go to the clipboard (`clipboardCopyOut.ts`, D13).
 *
 * D17, DUPLICATE: `duplicateWithNotes` asks only when the copied cells hold a mark: "Copy with notes" gives each
 * copied mark a new label and clones its cell note under the table; "Cells only" leaves the copies with no marks.
 * Two cells never share one cell note.
 */
import { SchemaReady, prosePluginsCtx } from '@milkdown/kit/core'
import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import { closeHistory } from '@milkdown/kit/prose/history'
import { keydownHandler } from '@milkdown/kit/prose/keymap'
import { Fragment, type Node as ProseNode } from '@milkdown/kit/prose/model'
import { type Command, type EditorState, Plugin, PluginKey, type Transaction } from '@milkdown/kit/prose/state'
import { CellSelection, deleteCellSelection, tableEditingKey } from '@milkdown/kit/prose/tables'
import type { EditorView } from '@milkdown/kit/prose/view'
import { cellNoteLabelsIn, isCellNote, isCellNoteMark, nextCellNoteLabel, notePosOf, removeCellNote } from './cellNotes'

/** The editor's ask for a sheet (`PageMenu` shows it). */
export const CELL_NOTE_ASK = 'yd-cell-note-ask'

/** What the sheet says, its buttons, and what each one does. Esc and a click outside are Cancel (nothing). */
export interface CellNoteAsk {
  text: string
  confirm: string
  danger?: boolean
  onConfirm: () => void
  /** A second answer beside Cancel (D17's "Cells only"). */
  other?: { label: string; run: () => void }
}

/** Ask through `PageMenu`; with no one to ask, the confirm runs (the action as before 4C). */
export function askCellNotes(view: EditorView, ask: CellNoteAsk): void {
  const event = new CustomEvent<CellNoteAsk>(CELL_NOTE_ASK, { detail: ask, cancelable: true })
  view.dom.dispatchEvent(event)
  if (!event.defaultPrevented) ask.onConfirm()
}

/** "its cell note" / "its 2 cell notes", and "their …" for more than one row. */
const notes = (count: number, their: boolean) => `${their ? 'their' : 'its'} ${count === 1 ? 'cell note' : `${count} cell notes`}`

/** The words of each delete's sheet (D16): what goes, how many of it, and how many cell notes. */
export type DeleteKind = 'row' | 'column' | 'cells' | 'table'
export function deleteText(kind: DeleteKind, count: number, gone: number): string {
  if (kind === 'cells') return count === 1 ? `Clear this cell and ${notes(gone, false)}?` : `Clear these cells and ${notes(gone, true)}?`
  if (kind === 'table') return `Delete this table and ${notes(gone, false)}?`
  return count === 1 ? `Delete this ${kind} and ${notes(gone, false)}?` : `Delete these ${count} ${kind}s and ${notes(gone, true)}?`
}

/** The cell notes that go when `before` becomes `after`: each label with a cell note whose last mark goes. */
export function goneNotes(before: ProseNode, after: ProseNode): string[] {
  const kept = new Set(cellNoteLabelsIn(after))
  return [...new Set(cellNoteLabelsIn(before))].filter((label) => !kept.has(label) && notePosOf(before, label) !== null)
}

/**
 * D16: dispatch the transaction `build` makes from the current state, asking first when it would delete a cell
 * note. `text` names it with the count of cell notes. `false` when `build` makes none.
 */
export function deleteWithNotes(view: EditorView, build: (state: EditorState) => Transaction | null, text: (gone: number) => string): boolean {
  const tr = build(view.state)
  if (tr === null) return false
  const gone = goneNotes(view.state.doc, tr.doc)
  if (gone.length === 0) {
    view.dispatch(tr)
    return true
  }
  askCellNotes(view, {
    text: text(gone.length),
    confirm: 'Delete',
    danger: true,
    onConfirm: () => {
      const again = build(view.state)
      if (again === null) return
      for (const label of goneNotes(view.state.doc, again.doc)) removeCellNote(again, label)
      view.dispatch(again)
    },
  })
  return true
}

/** Clear the selected cells (prosemirror-tables' Delete), as one undo step: the toolbar's, the menu's and the keys'. */
export const clearCells = (state: EditorState): Transaction | null => {
  let made: Transaction | null = null
  deleteCellSelection(state, (tr) => {
    made = closeHistory(tr)
  })
  return made
}

/** The cells of `rows` (rows or cells) with no cell note marks: "Cells only" (D17). */
export function withoutMarks(content: Fragment): Fragment {
  const kept: ProseNode[] = []
  content.forEach((node) => {
    if (!isCellNoteMark(node)) kept.push(node.isLeaf ? node : node.copy(withoutMarks(node.content)))
  })
  return Fragment.from(kept)
}

/** `content` with each mark's label in `labels` replaced by its new one. */
export function relabel(content: Fragment, labels: ReadonlyMap<string, string>): Fragment {
  const out: ProseNode[] = []
  content.forEach((node) => {
    if (isCellNoteMark(node)) out.push(node.type.create({ ...node.attrs, label: labels.get(node.attrs.label as string) ?? node.attrs.label }))
    else out.push(node.isLeaf ? node : node.copy(relabel(node.content, labels)))
  })
  return Fragment.from(out)
}

/**
 * New labels for `labels`, none used in `doc` nor among themselves, `cell-N` one by one (`nextCellNoteLabel`), with
 * `reserved` counted as used too.
 */
export function freshLabels(doc: ProseNode, labels: readonly string[], reserved: Iterable<string> = []): Map<string, string> {
  const used = new Set<string>(reserved)
  const taken = (label: string) => used.has(label)
  const map = new Map<string, string>()
  for (const label of labels) {
    let n = Number(nextCellNoteLabel(doc).slice('cell-'.length))
    while (taken(`cell-${n}`) || notePosOf(doc, `cell-${n}`) !== null || cellNoteLabelsIn(doc).includes(`cell-${n}`)) n++
    map.set(label, `cell-${n}`)
    used.add(`cell-${n}`)
  }
  return map
}

/** The cell note nodes of `labels` in `doc`, each once, with the new label of `map`. */
export function clonedNotes(doc: ProseNode, labels: readonly string[], map: ReadonlyMap<string, string>): ProseNode[] {
  return labels.flatMap((label) => {
    const pos = notePosOf(doc, label)
    const note = pos === null ? null : doc.nodeAt(pos)
    return note === null || !isCellNote(note) ? [] : [note.type.create({ ...note.attrs, label: map.get(label) ?? label }, note.content)]
  })
}

/**
 * D17: a duplicate of cells that hold marks asks "This row has 2 cell notes." — "Copy with notes" or "Cells only".
 * `build(copy)` makes the duplicate, `copy` mapping each copied node to what is inserted; `pagesIn` are the copied
 * labels. Copy with notes relabels the copies and clones each cell note under the table (`pagesFollowTables` puts them
 * in mark order); Cells only drops the marks. No marks: the duplicate at once.
 */
export function duplicateWithNotes(
  view: EditorView,
  labels: readonly string[],
  noun: string,
  build: (state: EditorState, copy: (content: Fragment) => Fragment) => Transaction | null,
  tableEnd: (doc: ProseNode) => number,
): boolean {
  const withPages = labels.filter((label) => notePosOf(view.state.doc, label) !== null)
  if (labels.length === 0) {
    const tr = build(view.state, (content) => content)
    if (tr !== null) view.dispatch(tr)
    return tr !== null
  }
  const run = (keep: boolean) => {
    const { doc } = view.state
    const map = freshLabels(doc, labels)
    const tr = build(view.state, (content) => (keep ? relabel(content, map) : withoutMarks(content)))
    if (tr === null) return
    if (keep) {
      const cloned = clonedNotes(doc, withPages, map)
      if (cloned.length > 0) tr.insert(tableEnd(tr.doc), cloned)
    }
    view.dispatch(tr)
  }
  const count = withPages.length
  askCellNotes(view, {
    text: `${noun} ${noun.startsWith('These') ? 'have' : 'has'} ${count === 1 ? '1 cell note' : `${count} cell notes`}.`,
    confirm: 'Copy with notes',
    onConfirm: () => run(true),
    other: { label: 'Cells only', run: () => run(false) },
  })
  return true
}

/** The tables wholly inside `from`–`to` of `doc`, with their positions. */
function tablesWithin(doc: ProseNode, from: number, to: number): Array<{ pos: number; node: ProseNode }> {
  const found: Array<{ pos: number; node: ProseNode }> = []
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name !== 'table') return true
    if (pos >= from && pos + node.nodeSize <= to) found.push({ pos, node })
    return false
  })
  return found
}

/**
 * Every key that clears a selection on this platform: `tableEditing`'s four (`deleteCellSelection`), and the base
 * keymap's (`deleteSelection`): `pcBaseKeymap`'s, plus `macBaseKeymap`'s own on a Mac. A key with a modifier took the
 * marks with no sheet (YAZ-4264), so the guard binds them all. Off a Mac, `Ctrl-d` and the others are other commands
 * (Ctrl+D is "Show in sidebar"; the checker's round 2 nit), so it binds none of the Mac ones there. `deleteKeys` reads
 * the platform as the base keymap does, when the editor mounts.
 */
function deleteKeysOf(mac: boolean): string[] {
  const keys = ['Backspace', 'Delete', 'Mod-Backspace', 'Mod-Delete', 'Shift-Backspace']
  return mac ? [...keys, 'Alt-Backspace', 'Alt-Delete', 'Ctrl-Alt-Backspace', 'Ctrl-h', 'Ctrl-d', 'Alt-d'] : keys
}

/** D16 on a delete key: ask when the clear would take a cell note; `false` lets the key run as before. */
function askDelete(view: EditorView): boolean {
  if (!view.editable) return false
  const { selection } = view.state
  if (selection instanceof CellSelection) {
    const tr = clearCells(view.state)
    if (tr === null || goneNotes(view.state.doc, tr.doc).length === 0) return false
    let count = 0
    selection.forEachCell(() => count++)
    return deleteWithNotes(view, clearCells, (gone) => deleteText('cells', count, gone))
  }
  if (selection.empty) return false
  const tables = tablesWithin(view.state.doc, selection.from, selection.to)
  if (!tables.some(({ node }) => cellNoteLabelsIn(node).some((label) => notePosOf(view.state.doc, label) !== null))) return false
  return deleteWithNotes(view, (state) => closeHistory(state.tr).deleteSelection(), (gone) => deleteText('table', 1, gone))
}

/**
 * D16's keys: each delete key of this platform (`deleteKeysOf`) on selected cells, and on a selection that holds a
 * whole table with cell notes, asks before the notes go. Before `tableEditing`, whose own keys clear the cells.
 */
function deleteKeys(): Plugin {
  const ask: Command = (_state, _dispatch, view) => view !== undefined && askDelete(view)
  const keys = deleteKeysOf(/Mac|iP(hone|[oa]d)/.test(navigator.platform))
  return new Plugin({
    key: new PluginKey('mdapp-cell-note-delete'),
    props: { handleKeyDown: keydownHandler(Object.fromEntries(keys.map((key) => [key, ask]))) },
  })
}

/** Register with `editor.use(cellNoteDeleteGuard)`: its keys go just before `tableEditing`. */
export const cellNoteDeleteGuard: MilkdownPlugin = (ctx) => async () => {
  await ctx.wait(SchemaReady)
  const plugin = deleteKeys()
  ctx.update(prosePluginsCtx, (ps) => {
    const at = ps.findIndex((p) => p.spec.key === tableEditingKey)
    return at < 0 ? [...ps, plugin] : [...ps.slice(0, at), plugin, ...ps.slice(at)]
  })
  return () => {
    ctx.update(prosePluginsCtx, (ps) => ps.filter((p) => p !== plugin))
  }
}
