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
 * `tableEditing`, so the click starts no cell selection. A read-only note keeps the run folded. ↑ / ↓ at the edge of
 * a cell's text step over a run, to the row past it (or out of the table below a run at its end): `tableEditing`
 * would put the caret in the run's hidden cells. "Fold N rows" is in
 * the table menu (`tableMenu.ts`, `foldRows`). Fill down and a paste never write a folded row (`unfoldedRows`).
 */
import { SchemaReady, prosePluginsCtx } from '@milkdown/kit/core'
import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import { closeHistory } from '@milkdown/kit/prose/history'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { keydownHandler } from '@milkdown/kit/prose/keymap'
import { Plugin, PluginKey, Selection, TextSelection, type Command, type EditorState, type Transaction } from '@milkdown/kit/prose/state'
import { TableMap, selectedRect, tableEditingKey } from '@milkdown/kit/prose/tables'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { detectTimeFormat, formatTime, readTime } from '@shared/timeFormat'
import { rowFolded, setCellsAttr } from './cells'
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

/** The run that holds row `row`, if any. */
export const runOf = (runs: readonly FoldRun[], row: number | null): FoldRun | undefined => (row === null ? undefined : runs.find((run) => run.from <= row && row <= run.to))

/** The bar's label: "10 rows", or in a calendar table "5:30 pm – 10:00 pm · 10 rows". */
export function foldLabel(table: ProseNode, run: FoldRun): string {
  const n = run.to - run.from + 1
  const rows = `${n} row${n === 1 ? '' : 's'}`
  if (!((table.attrs.calendar as number) > 0)) return rows
  const timeOf = (r: number) => readTime(table.child(r).firstChild?.textContent ?? '')
  const first = timeOf(run.from)
  const last = timeOf(run.to)
  if (first === null || last === null) return rows
  const texts: string[] = []
  table.forEach((row, _, r) => {
    if (r > 0) texts.push(row.firstChild?.textContent ?? '')
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
    for (let r = run.from; r <= run.to; r++) {
      const row = table.child(r)
      out.push(Decoration.node(starts[r]!, starts[r]! + row.nodeSize, { class: r === run.from ? 'table-fold-bar' : 'table-fold-hidden' }, { fold: true }))
    }
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

/** "Fold N rows": every cell of the target's body rows (the header row never folds), whole rows, gets `fold`. */
export function foldRows(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const rect = selectedRect(state)
  if (rect.bottom - Math.max(rect.top, 1) < 2) return false
  if (dispatch) {
    const map = TableMap.get(rect.table)
    const tr = setCellsAttr(state.tr, { ...rect, top: Math.max(rect.top, 1), left: 0, right: map.width }, 'fold', true)
    // The caret leaves the rows it hid (the YAZ-4163 demo): a selection in hidden rows made the browser put it, and
    // the scroll, somewhere else. It goes to the first row below the fold, else to the last row above it.
    const row = rect.bottom < map.height ? rect.bottom : Math.max(rect.top, 1) - 1
    tr.setSelection(TextSelection.near(tr.doc.resolve(rect.tableStart + map.positionAt(row, 0, rect.table) + 1)))
    if (tr.docChanged) dispatch(tr)
  }
  return true
}

/** The note's scroll box around `view`: the nearest ancestor that scrolls, else the page. */
function scrollerOf(view: EditorView): Element {
  for (let el = view.dom.parentElement; el !== null; el = el.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight) return el
  }
  return document.scrollingElement ?? document.documentElement
}

/** Run `fold` and keep the note where it was: the rows above the fold do not move, so the bar stays under the pointer. */
export function keepingScroll(view: EditorView, fold: () => void): void {
  const scroller = scrollerOf(view)
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

/** ↑ / ↓ at the edge of a cell's text, onto a folded row: the caret goes to the row past the run, in the same column. */
const stepOver =
  (dir: 1 | -1): Command =>
  (state, dispatch, view) => {
    const at = view === undefined ? null : atEndOfCell(view, 'vert', dir)
    if (at === null) return false
    // `at` is before the cell: its row is the parent, its table the row's parent.
    const $cell = state.doc.resolve(at)
    const table = $cell.node(-1)
    const tableStart = $cell.start(-1)
    const map = TableMap.get(table)
    const { top, bottom, left } = map.findCell(at - tableStart)
    let row = dir > 0 ? bottom : top - 1
    if (row < 0 || row >= map.height || !rowFolded(table.child(row))) return false
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
  })

/** Register with `editor.use(tableFold)`: just before `tableEditing`, so a click on a bar starts no cell selection. */
export const tableFold: MilkdownPlugin = (ctx) => async () => {
  await ctx.wait(SchemaReady)
  const plugin = foldPlugin()
  ctx.update(prosePluginsCtx, (ps) => {
    const at = ps.findIndex((p) => p.spec.key === tableEditingKey)
    return at < 0 ? [...ps, plugin] : [...ps.slice(0, at), plugin, ...ps.slice(at)]
  })
  return () => {
    ctx.update(prosePluginsCtx, (ps) => ps.filter((p) => p !== plugin))
  }
}
