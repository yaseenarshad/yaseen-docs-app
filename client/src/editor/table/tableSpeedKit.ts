/**
 * The shared data and helpers of the S6 table speed files (YAZ-3696, YAZ-3818): the 500 × 10 table, its frozen,
 * styled, list and cell-note forms, and the mount / type helpers. Each big case has its own perf file so that each
 * runs in a fresh worker: a 500 × 10 table with 1,000 cell lists takes hundreds of MB in jsdom, and the cases
 * together ran the 2 GB worker heap out on CI (PR #242).
 */
import { editorViewCtx } from '@milkdown/kit/core'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { timeMedian } from '../../test-perf'
import { createCrepe } from '../createCrepe'

export const COLS = 10
export const ROWS = 500
export const head = Array.from({ length: COLS }, (_, c) => `H${c + 1}`)
export const body = Array.from({ length: ROWS }, (_, r) => head.map((_, c) => `r${r + 1}c${c + 1}`))
export const BIG = [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...body.map((cells) => `| ${cells.join(' | ')} |`)].join('\n') + '\n'
export const STYLED = `${BIG}\n<!-- table: fill A2:B2 blue C5 green, stripes, freeze 1 row 2 cols -->\n`
/** The freeze alone (YAZ-3790): it must add no work per key either. */
export const FROZEN = `${BIG}\n<!-- table: freeze 1 row 2 cols -->\n`
/** A 3-bullet list in a cell, one bullet with a child (YAZ-3818 D3). */
export const CELL_LIST = '<ul><li>one</li><li>two<ul><li>kid</li></ul></li><li>three</li></ul>'
/** The same table with a list in one body cell in five. */
export const LISTS = [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...body.map((cells, r) => `| ${cells.map((cell, c) => ((r * COLS + c) % 5 === 0 ? cell + CELL_LIST : cell)).join(' | ')} |`)].join('\n') + '\n'
/**
 * LISTS with a cell note on one cell in ten (each one a list cell): 500 marks, and 500 notes of 3 bullets under the
 * table, as the checker's probe (YAZ-4263).
 */
export const NOTED =
  [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...body.map((cells, r) => `| ${cells.map((cell, c) => ((r * COLS + c) % 10 === 0 ? `${cell}[^cell-${(r * COLS + c) / 10 + 1}]${CELL_LIST}` : (r * COLS + c) % 5 === 0 ? cell + CELL_LIST : cell)).join(' | ')} |`)].join('\n') +
  '\n\n' +
  Array.from({ length: (ROWS * COLS) / 10 }, (_, n) => `[^cell-${n + 1}]: * one\n    * two\n    * three`).join('\n\n') +
  '\n'
/** The same words as paragraphs: what typing costs in a note with no table. */
export const PLAIN = body.map((cells) => cells.join(' ')).join('\n\n') + '\n'
export const TSV = Array.from({ length: 50 }, (_, r) => Array.from({ length: 4 }, (_, c) => `p${r}-${c}`).join('\t')).join('\n')
export const KEYS = 'typing in a cell'

/** What a Sheets copy puts on the clipboard as plain text: tab-separated cells. */
export const clipboard = (text: string) =>
  ({ clipboardData: { getData: (t: string) => (t === 'text/plain' ? text : '') }, preventDefault() {} }) as unknown as ClipboardEvent

export const open = new Set<() => Promise<void>>()
/** Register in each perf file: closes what a test left open. */
export const closeAll = async (): Promise<void> => {
  for (const close of open) await close()
}

/** A note, the ms it took to open, and `close`. */
export async function mount(markdown: string): Promise<{ view: EditorView; ms: number; close: () => Promise<void> }> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const start = performance.now()
  const crepe = createCrepe({ root, defaultValue: markdown, tableZoomPill: true })
  await crepe.create()
  const ms = performance.now() - start
  const close = async () => {
    open.delete(close)
    await crepe.destroy()
    root.remove()
    // jsdom's selector cache keeps the last node a `matches` / `closest` read, and through a node view's `getPos` the
    // whole closed editor: hundreds of MB for the tables with cell lists and notes. One query on a live node lets it
    // go (the perf worker ran out of its 2 GB heap on CI, PR #242).
    document.body.matches('body')
  }
  open.add(close)
  return { view: crepe.editor.ctx.get(editorViewCtx), ms, close }
}

/** The text position inside body row `row` (1-based), column `col` (0-based), of the first table. */
export function cellText(doc: ProseNode, row: number, col: number): number {
  let found = -1
  doc.descendants((node, pos) => {
    if (found >= 0) return false
    if (node.type.name !== 'table') return true
    let offset = pos + 1
    for (let i = 0; i < row; i++) offset += node.child(i).nodeSize
    offset += 1
    for (let i = 0; i < col; i++) offset += node.child(row).child(i).nodeSize
    found = offset + 2
    return false
  })
  return found
}

/** The text position inside the first bullet of the cell at body row `row` (1-based), column `col` (0-based). */
export function bulletText(doc: ProseNode, row: number, col: number): number {
  const cell = cellText(doc, row, col) - 2
  let found = -1
  doc.nodeAt(cell)!.descendants((node, pos) => {
    if (found < 0 && node.type.name === 'list_item') found = cell + 1 + pos + 2
    return found < 0
  })
  return found
}

/** The median ms of one key, typed at `pos`: one dispatch per key, after a warm-up of three keys. */
export function typeAt(view: EditorView, pos: number): { median: number; worst: number } {
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)))
  for (const ch of 'abc') view.dispatch(view.state.tr.insertText(ch))
  return timeMedian(KEYS.length, (i) => view.dispatch(view.state.tr.insertText(KEYS[i]!)))
}

/**
 * Each view's ms of each key, the keys typed in turn, one in each view (YAZ-3792): a busy moment of the
 * machine slows each view alike, so their ratio holds. After a warm-up of three keys in each.
 */
export function typeInTurn(views: EditorView[], at: (doc: ProseNode, v: number) => number = (doc) => cellText(doc, 250, 3)): number[][] {
  for (const [v, view] of views.entries()) {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at(view.state.doc, v))))
    for (const ch of 'abc') view.dispatch(view.state.tr.insertText(ch))
  }
  const ms = views.map((): number[] => [])
  for (const ch of KEYS) {
    views.forEach((view, v) => {
      const start = performance.now()
      view.dispatch(view.state.tr.insertText(ch))
      ms[v]!.push(performance.now() - start)
    })
  }
  return ms
}

