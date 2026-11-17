/**
 * Fold rows (YAZ-4165, YAZ-4159 D3; CONTRACTS rule 41a): a run of body rows shows as one thin bar, and a click on the
 * bar opens it again.
 *
 * THE MARK is on the rows: each cell of a folded row has `fold` (`tableStyle.ts`), so a sort, an insert or a delete
 * keeps it on its row; a row is folded when one of its cells has it (`rowFolded`), so a new column does not open it.
 * A RUN is folded body rows that touch (the header row never folds): a row inserted inside a run is not folded and
 * splits it into two runs, each with its own bar. The save writes the rows as `fold 20-29 31-33` (`tableComment.ts`).
 *
 * THE BAR is the first row of a run, drawn by CSS from node decorations — never a widget, which cannot go between
 * table rows: the row gets `table-fold-bar`, its first cell `data-table-fold-label` ("10 rows"; in a calendar table
 * "5:30 pm – 10:00 pm · 10 rows", the times of column A of the run's first and last rows in the table's own format),
 * and the run's other rows `table-fold-hidden` (`display: none`, `table.css`). Decorations from the attributes and the
 * text, as `tableFreeze.ts`: typing only maps the set (a typed time shows in the label at the next change of the
 * table), any other transaction builds again only the tables it changed (`changedTables`), so `tableSpeed.test.ts`
 * holds. A calendar table's now row in a run puts the marker on the bar (`tableCalendar.ts`, `runOf`).
 *
 * A MOUSEDOWN on the bar opens the run: one transaction with the history closed (one undo step). It goes before
 * `tableEditing`, so the click starts no cell selection. A read-only page keeps the run folded. ↑ / ↓ at the edge of
 * a cell's text step over a run, to the row past it (or out of the table below a run at its end): `tableEditing`
 * would put the caret in the run's hidden cells. "Fold N rows" is in
 * the table menu (`tableMenu.ts`, `foldRows`). Fill down and a paste never write a folded row (`unfoldedRows`).
 *
 * A COLLAPSED SECTION (YAZ-4899, `tableSubhead.ts`) is a run in the same mark, right under a subheader row to its section's
 * end (`sectionRun`): it draws no bar, every row of it is hidden, and the subheader row shows the chevron and the count.
 *
 * MERGED CELLS (YAZ-4792): a run may hold a merged cell whole; "Fold N rows" is refused while a merged cell crosses the
 * rows' edge (its mark would fold the row it starts in too). The bar's times and the caret's step over a run read a
 * column through the table map, not the row's child at that index.
 */
import { closeHistory } from '@milkdown/kit/prose/history'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { keydownHandler } from '@milkdown/kit/prose/keymap'
import { Plugin, PluginKey, Selection, TextSelection, type Command, type EditorState, type Transaction } from '@milkdown/kit/prose/state'
import { CellSelection, TableMap, selectedRect } from '@milkdown/kit/prose/tables'
import { Mapping } from '@milkdown/kit/prose/transform'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { detectTimeFormat, formatTime, readTime } from '@shared/timeFormat'
import { verticalScrollParent } from '../../lib/pinnedHeader'
import { beforeTableEditing } from './beforeTableEditing'
import { cellTextAt, mergeCrosses, rowFolded, rowSubhead, sectionEnd, setCellsAttr } from './cells'
import { atEndOfCell } from './tableShiftArrow'
import { changedTables, typingOnly } from './tableStyle'
import { timeFormatSetting } from './timeFormatSetting'

/** A run of folded rows: the first and the last row's index in the table. */
export interface FoldRun {
  from: number
  to: number
}

/** The table's runs: folded body rows that touch. */
export function foldRuns(table: ProseNode): FoldRun[] {
  const runs: FoldRun[] = []
  table.forEach((row, _, r) => {
    if (r === 0 || !rowFolded(row)) return
    const last = runs.at(-1)
    if (last !== undefined && last.to === r - 1) last.to = r
    else runs.push({ from: r, to: r })
  })
  return runs
}

/**
 * A run is a collapsed section (YAZ-4899, `tableSubhead.ts`): it starts right under a subheader row and ends at the
 * section's end. It draws no bar: the subheader row is the bar, with its chevron and "· N rows".
 */
export const sectionRun = (table: ProseNode, run: FoldRun): boolean => run.from > 1 && rowSubhead(table.child(run.from - 1)) && run.to === sectionEnd(table, run.from - 1)

/** The run that holds row `row`, if any. */
export const runOf = (runs: readonly FoldRun[], row: number | null): FoldRun | undefined => (row === null ? undefined : runs.find((run) => run.from <= row && row <= run.to))

/** The bar's label: "10 rows", or in a calendar table "5:30 pm – 10:00 pm · 10 rows". */
export function foldLabel(table: ProseNode, run: FoldRun): string {
  const n = run.to - run.from + 1
  const rows = `${n} row${n === 1 ? '' : 's'}`
  if (!((table.attrs.calendar as number) > 0)) return rows
  // Column A's cell of each row through the map: a merged cell's row has its own first cell elsewhere (YAZ-4792).
  const timeOf = (r: number) => readTime(cellTextAt(table, r, 0))
  const first = timeOf(run.from)
  const last = timeOf(run.to)
  if (first === null || last === null) return rows
  const texts: string[] = []
  table.forEach((_, __, r) => {
    if (r > 0) texts.push(cellTextAt(table, r, 0))
  })
  const format = detectTimeFormat(texts) ?? timeFormatSetting()
  return `${formatTime(format, first)} – ${formatTime(format, last)} · ${rows}`
}

/** The decorations of one table: its bars, their labels and the hidden rows. */
function foldDecorations(table: ProseNode, pos: number): Decoration[] {
  const runs = foldRuns(table)
  if (runs.length === 0) return []
  const starts: number[] = []
  table.forEach((_, offset) => starts.push(pos + 1 + offset))
  const out: Decoration[] = []
  for (const run of runs) {
    const section = sectionRun(table, run)
    for (let r = run.from; r <= run.to; r++) {
      const row = table.child(r)
      out.push(Decoration.node(starts[r]!, starts[r]! + row.nodeSize, { class: r === run.from && !section ? 'table-fold-bar' : 'table-fold-hidden' }, { fold: true }))
    }
    if (section) continue
    const cell = starts[run.from]! + 1
    out.push(Decoration.node(cell, cell + table.child(run.from).firstChild!.nodeSize, { 'data-table-fold-label': foldLabel(table, run) }, { fold: true }))
  }
  return out
}

/** Open the run that holds row `row` of the table at `tablePos`, in `tr`: its cells lose `fold`. */
export function unfoldRun(tr: Transaction, tablePos: number, row: number): Transaction {
  const table = tr.doc.nodeAt(tablePos)
  const run = table === null ? undefined : runOf(foldRuns(table), row)
  if (table === null || run === undefined) return tr
  let rowPos = tablePos + 1
  table.forEach((node, _, r) => {
    if (r >= run.from && r <= run.to) {
      node.forEach((cell, offset) => {
        if (cell.attrs.fold === true) tr.setNodeAttribute(rowPos + 1 + offset, 'fold', false)
      })
    }
    rowPos += node.nodeSize
  })
  return tr
}

/**
 * "Fold N rows": every cell of the target's body rows (the header row never folds), whole rows, gets `fold`. Not while a
 * merged cell crosses the rows' edge (YAZ-4792): the mark would fold the row it starts in too.
 */
export function foldRows(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const rect = selectedRect(state)
  if (rect.bottom - Math.max(rect.top, 1) < 2) return false
  const map = TableMap.get(rect.table)
  const rows = { ...rect, top: Math.max(rect.top, 1), left: 0, right: map.width }
  if (mergeCrosses(rows)) return false
  if (dispatch) {
    const tr = setCellsAttr(state.tr, rows, 'fold', true)
    // The caret leaves the rows it hid (the YAZ-4163 demo): a selection in hidden rows made the browser put it, and
    // the scroll, somewhere else. It goes to the first row below the fold, else to the last row above it.
    const row = rect.bottom < map.height ? rect.bottom : Math.max(rect.top, 1) - 1
    tr.setSelection(TextSelection.near(tr.doc.resolve(rect.tableStart + map.positionAt(row, 0, rect.table) + 1)))
    if (tr.docChanged) dispatch(tr)
  }
  return true
}

/**
 * Run `fold` and keep the note where it was: the rows above the fold do not move, so the bar stays under the pointer.
 * The scroller is the note's, the one the frozen rows follow (`verticalScrollParent`, `tableFreeze.ts`), else the page.
 */
export function keepingScroll(view: EditorView, fold: () => void): void {
  const scroller = verticalScrollParent(view.dom) ?? document.scrollingElement ?? document.documentElement
  const top = scroller.scrollTop
  fold()
  scroller.scrollTop = top
  requestAnimationFrame(() => {
    scroller.scrollTop = top
  })
}

const foldKey = new PluginKey<DecorationSet>('mdapp-table-fold')

/** A mousedown on a bar: open its run (one undo step). */
function openBar(view: EditorView, event: MouseEvent): boolean {
  if (!view.editable || event.button !== 0 || !(event.target instanceof Element)) return false
  const bar = event.target.closest('tr.table-fold-bar')
  if (bar === null || !view.dom.contains(bar)) return false
  const $at = view.state.doc.resolve(view.posAtDOM(bar, 0))
  for (let depth = $at.depth; depth > 0; depth--) {
    if ($at.node(depth).type.spec.tableRole !== 'row') continue
    event.preventDefault()
    view.dispatch(unfoldRun(closeHistory(view.state.tr), $at.before(depth - 1), $at.index(depth - 1)))
    return true
  }
  return false
}

/**
 * ↑ / ↓ at the edge of a cell's text, onto a folded row: the caret goes to the row past the run, in the same column.
 * The folded row comes first, from the document: with none next to the caret's row, no layout is read (YAZ-4176).
 */
const stepOver =
  (dir: 1 | -1): Command =>
  (state, dispatch, view) => {
    if (view === undefined || !(state.selection instanceof TextSelection)) return false
    const { $head } = state.selection
    let depth = $head.depth
    while (depth > 0 && $head.node(depth).type.spec.tableRole !== 'row') depth--
    if (depth === 0) return false
    const table = $head.node(depth - 1)
    const tableStart = $head.start(depth - 1)
    const at = $head.before(depth + 1)
    const map = TableMap.get(table)
    const { top, bottom, left } = map.findCell(at - tableStart)
    let row = dir > 0 ? bottom : top - 1
    if (row < 0 || row >= map.height || !rowFolded(table.child(row))) return false
    if (atEndOfCell(view, 'vert', dir) === null) return false
    const $cell = state.doc.resolve(at)
    while (row >= 0 && row < map.height && rowFolded(table.child(row))) row += dir
    // Below a run at the table's end: out of the table, as ↓ from its last row.
    const target = row >= map.height ? $cell.end(-1) + 1 : tableStart + map.map[row * map.width + left]! + 1
    dispatch?.(state.tr.setSelection(Selection.near(state.doc.resolve(target), 1)).scrollIntoView())
    return true
  }

const foldPlugin = (): Plugin<DecorationSet> =>
  new Plugin<DecorationSet>({
    key: foldKey,
    state: {
      init: (_, { doc }) => {
        const decorations: Decoration[] = []
        doc.descendants((node, pos) => {
          if (node.type.name !== 'table') return !node.isTextblock
          decorations.push(...foldDecorations(node, pos))
          return false
        })
        return DecorationSet.create(doc, decorations)
      },
      apply: (tr, set) => {
        if (!tr.docChanged) return set
        let next = set.map(tr.mapping, tr.doc)
        // A key changes no row's mark: the mapped set holds (YAZ-3790).
        if (typingOnly(tr)) return next
        for (const [pos, node] of changedTables(tr)) {
          const end = pos + node.nodeSize
          const stale = next.find(pos, end, (spec) => spec.fold === true)
          if (stale.length > 0) next = next.remove(stale)
          const fresh = foldDecorations(node, pos)
          if (fresh.length > 0) next = next.add(tr.doc, fresh)
        }
        return next
      },
    },
    props: {
      decorations: (state) => foldKey.getState(state),
      handleDOMEvents: { mousedown: openBar },
      handleKeyDown: keydownHandler({ ArrowUp: stepOver(-1), ArrowDown: stepOver(1) }),
    },
    appendTransaction: foldGuards,
  })

/**
 * A change never empties a folded row (YAZ-4173 12D): Backspace, Delete, "Clear cells", typed text and ⌘X on a
 * CellSelection that holds a folded row clear every selected cell (`deleteCellSelection`, `CellSelection.replace`).
 * The guard puts back the text of each folded cell of the old selection, in the same undo step. A cell that the change
 * removed or moved (a delete, a sort) is not put back. Fill down and paste already skip folded rows (`unfoldedRows`).
 */
function keepFoldedText(transactions: readonly Transaction[], oldState: EditorState, tr: Transaction): void {
  const old = oldState.selection
  if (!(old instanceof CellSelection) || !transactions.some((t) => t.docChanged)) return
  const mapping = new Mapping()
  for (const t of transactions) mapping.appendMapping(t.mapping)
  old.forEachCell((cell, pos) => {
    if (cell.attrs.fold !== true) return
    const mapped = mapping.mapResult(pos, 1)
    if (mapped.deleted) return
    const at = tr.mapping.map(mapped.pos, 1)
    const now = tr.doc.nodeAt(at)
    if (now?.type !== cell.type || now.attrs.fold !== true || now.content.eq(cell.content)) return
    tr.replaceWith(at + 1, at + now.nodeSize - 1, cell.content)
  })
}

/**
 * The caret never stays in a folded row (YAZ-4173 12A, 12E, 12F): Tab and Shift+Tab (`goToNextCell`, also ⌘] / ⌘[),
 * ← / → at a cell's edge (`tableEditing`), Shift+↑ / Shift+↓ (the head of a CellSelection), and any other move that
 * lands in a run go on past it, the way the move went. Forward: to the first row after the run, or, with none, out of
 * the table below it. Back: to the last row before the run. A CellSelection keeps its anchor, and its head goes to the
 * same column past the run. A move that selected the cell's text (Tab) selects the text of the cell it goes to.
 * Typing never writes a hidden row. A selection that does not land in a folded row costs one walk up from its head.
 */
function caretOutOfRuns(transactions: readonly Transaction[], oldState: EditorState, tr: Transaction): void {
  if (!transactions.some((t) => t.selectionSet)) return
  const { selection, doc } = tr
  const cells = selection instanceof CellSelection
  if (!cells && !(selection instanceof TextSelection)) return
  const $head = cells ? (selection as CellSelection).$headCell : selection.$head
  let depth = $head.depth
  while (depth > 0 && $head.node(depth).type.spec.tableRole !== 'row') depth--
  // A CellSelection's `$headCell` stands before its cell, in its row.
  if (cells) depth = $head.depth
  if (depth === 0 || !rowFolded($head.node(depth))) return
  const table = $head.node(depth - 1)
  const run = runOf(foldRuns(table), $head.index(depth - 1))
  if (run === undefined) return
  let from = oldState.selection.head
  for (const t of transactions) from = t.mapping.map(from)
  from = tr.mapping.map(from)
  const forward = selection.head >= from
  const tableStart = $head.start(depth - 1)
  const rowStart = (r: number) => {
    let pos = tableStart
    for (let i = 0; i < r; i++) pos += table.child(i).nodeSize
    return pos
  }
  const target = forward && run.to + 1 < table.childCount ? run.to + 1 : run.from - 1
  if (cells) {
    // The head cell's column through the map, and the cell that covers it in the target row (YAZ-4792).
    const map = TableMap.get(table)
    const col = map.findCell($head.pos - tableStart).left
    const cellPos = tableStart + map.map[target * map.width + col]!
    tr.setSelection(new CellSelection((selection as CellSelection).$anchorCell, doc.resolve(cellPos)))
    return
  }
  if (forward && target < run.from) {
    // No row after the run: out of the table, below it (as ↓ goes), else back before the run.
    const below = Selection.findFrom(doc.resolve($head.after(depth - 1)), 1, true)
    if (below !== null) return void tr.setSelection(below)
  }
  const row = table.child(target)
  const cell = forward && target > run.to ? rowStart(target) + 1 : rowStart(target) + row.nodeSize - 1 - row.lastChild!.nodeSize
  if (!selection.empty) {
    // Tab selected the cell's text: select the text of the cell it goes to.
    const node = doc.nodeAt(cell)!
    return void tr.setSelection(TextSelection.between(doc.resolve(cell + 1), doc.resolve(cell + node.nodeSize - 1)))
  }
  tr.setSelection(forward && target > run.to ? Selection.near(doc.resolve(cell + 1), 1) : Selection.near(doc.resolve(rowStart(target) + row.nodeSize - 1), -1))
}

/** The fold guards, in one appended step: the folded text first, then the caret. */
function foldGuards(transactions: readonly Transaction[], oldState: EditorState, state: EditorState): Transaction | null {
  const tr = state.tr
  keepFoldedText(transactions, oldState, tr)
  caretOutOfRuns(transactions, oldState, tr)
  return tr.docChanged || tr.selectionSet ? tr : null
}

/** Register with `editor.use(tableFold)`: just before `tableEditing`, so a click on a bar starts no cell selection. */
export const tableFold = beforeTableEditing(() => [foldPlugin()])
