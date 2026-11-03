/**
 * S6 (YAZ-3696): the speed of a big note table on the real editor in jsdom — open a 500 × 10 table, type in a
 * cell, paste 50 × 4 tab-separated cells; then the same table frozen and styled (`freeze 1 row 2 cols, stripes,
 * fill`). jsdom has no layout, so the numbers are the editor's own work (parse, transactions, DOM updates), not
 * paint. Runs in the `perf` project (YAZ-740), each budget on the MEDIAN (`src/test-perf.ts`). The frozen tables'
 * keys are typed in turn with the plain one's, and their ratios to it print. "No change in typing speed" is held by
 * counts, not by this ratio (YAZ-3796): `tableSpeed.test.ts` fails when a key reads layout or does work on the
 * freeze's or the styles' decorations. The measured numbers print, with a plain note of the same text for scale.
 * Last, the same table with a list in one body cell in five, typed in a cell bullet (YAZ-3818 D3); and with 500 cell
 * notes too, typed in a cell bullet of a cell with a mark (YAZ-4263).
 */
import { editorViewCtx } from '@milkdown/kit/core'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { afterEach, describe, expect, it } from 'vitest'
import { median, timeMedian } from '../../test-perf'
import { createCrepe } from '../createCrepe'

const COLS = 10
const ROWS = 500
const head = Array.from({ length: COLS }, (_, c) => `H${c + 1}`)
const body = Array.from({ length: ROWS }, (_, r) => head.map((_, c) => `r${r + 1}c${c + 1}`))
const BIG = [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...body.map((cells) => `| ${cells.join(' | ')} |`)].join('\n') + '\n'
const STYLED = `${BIG}\n<!-- table: fill A2:B2 blue C5 green, stripes, freeze 1 row 2 cols -->\n`
/** The freeze alone (YAZ-3790): it must add no work per key either. */
const FROZEN = `${BIG}\n<!-- table: freeze 1 row 2 cols -->\n`
/** A 3-bullet list in a cell, one bullet with a child (YAZ-3818 D3). */
const CELL_LIST = '<ul><li>one</li><li>two<ul><li>kid</li></ul></li><li>three</li></ul>'
/** The same table with a list in one body cell in five. */
const LISTS = [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...body.map((cells, r) => `| ${cells.map((cell, c) => ((r * COLS + c) % 5 === 0 ? cell + CELL_LIST : cell)).join(' | ')} |`)].join('\n') + '\n'
/**
 * LISTS with a cell note on one cell in ten (each one a list cell): 500 marks, and 500 notes of 3 bullets under the
 * table, as the checker's probe (YAZ-4263).
 */
const NOTED =
  [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...body.map((cells, r) => `| ${cells.map((cell, c) => ((r * COLS + c) % 10 === 0 ? `${cell}[^cell-${(r * COLS + c) / 10 + 1}]${CELL_LIST}` : (r * COLS + c) % 5 === 0 ? cell + CELL_LIST : cell)).join(' | ')} |`)].join('\n') +
  '\n\n' +
  Array.from({ length: (ROWS * COLS) / 10 }, (_, n) => `[^cell-${n + 1}]: * one\n    * two\n    * three`).join('\n\n') +
  '\n'
/** The same words as paragraphs: what typing costs in a note with no table. */
const PLAIN = body.map((cells) => cells.join(' ')).join('\n\n') + '\n'
const TSV = Array.from({ length: 50 }, (_, r) => Array.from({ length: 4 }, (_, c) => `p${r}-${c}`).join('\t')).join('\n')
const KEYS = 'typing in a cell'

/** What a Sheets copy puts on the clipboard as plain text: tab-separated cells. */
const clipboard = (text: string) =>
  ({ clipboardData: { getData: (t: string) => (t === 'text/plain' ? text : '') }, preventDefault() {} }) as unknown as ClipboardEvent

const open = new Set<() => Promise<void>>()
afterEach(async () => {
  for (const close of open) await close()
})

/** A note, the ms it took to open, and `close`. */
async function mount(markdown: string): Promise<{ view: EditorView; ms: number; close: () => Promise<void> }> {
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
  }
  open.add(close)
  return { view: crepe.editor.ctx.get(editorViewCtx), ms, close }
}

/** The text position inside body row `row` (1-based), column `col` (0-based), of the first table. */
function cellText(doc: ProseNode, row: number, col: number): number {
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
function bulletText(doc: ProseNode, row: number, col: number): number {
  const cell = cellText(doc, row, col) - 2
  let found = -1
  doc.nodeAt(cell)!.descendants((node, pos) => {
    if (found < 0 && node.type.name === 'list_item') found = cell + 1 + pos + 2
    return found < 0
  })
  return found
}

/** The median ms of one key, typed at `pos`: one dispatch per key, after a warm-up of three keys. */
function typeAt(view: EditorView, pos: number): { median: number; worst: number } {
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)))
  for (const ch of 'abc') view.dispatch(view.state.tr.insertText(ch))
  return timeMedian(KEYS.length, (i) => view.dispatch(view.state.tr.insertText(KEYS[i]!)))
}

/**
 * Each view's ms of each key, the keys typed in turn, one in each view (YAZ-3792): a busy moment of the
 * machine slows each view alike, so their ratio holds. After a warm-up of three keys in each.
 */
function typeInTurn(views: EditorView[], at: (doc: ProseNode, v: number) => number = (doc) => cellText(doc, 250, 3)): number[][] {
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

describe('S6: a 500 × 10 table stays fast', () => {
  it('perf smoke: opens, types, and pastes 50 × 4 in under 150 ms; frozen and styled, it types as fast', async () => {
    const opens: number[] = []
    const keys = { note: [] as number[], table: [] as number[], frozen: [] as number[], styled: [] as number[] }
    const pastes: number[] = []
    const kinds = ['table', 'frozen', 'styled'] as const
    // Three runs. In each, the three tables are open at once and take their keys in turn.
    for (let run = 0; run < 3; run++) {
      const note = await mount(PLAIN)
      keys.note.push(typeAt(note.view, 300).median)
      await note.close()
      const tables = []
      for (const kind of kinds) tables.push(await mount({ table: BIG, frozen: FROZEN, styled: STYLED }[kind]))
      opens.push(tables[0]!.ms)
      typeInTurn(tables.map((t) => t.view)).forEach((ms, k) => keys[kinds[k]!].push(...ms))
      const { view } = tables[0]!
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cellText(view.state.doc, 100, 2))))
      const start = performance.now()
      view.pasteText(TSV, clipboard(TSV))
      pastes.push(performance.now() - start)
      for (const t of tables) await t.close()
    }
    const [note, table, frozen, styled, paste] = [median(keys.note), median(keys.table), median(keys.frozen), median(keys.styled), median(pastes)]
    console.log(
      `S6: open ${median(opens).toFixed(0)} ms · type ms/key: note ${note.toFixed(2)}, table ${table.toFixed(2)}, frozen table ${frozen.toFixed(2)}, frozen styled table ${styled.toFixed(2)} (medians of 48 keys, typed in turn; ratios ${(frozen / table).toFixed(2)} / ${(styled / table).toFixed(2)}) · paste 50×4 ${paste.toFixed(1)} ms (median of 3, jsdom)`,
    )
    // The note is for the log: Milkdown's own `keepTableAlignPlugin` walks every cell of the table on each key
    // (main has it too), so the table types ~9× slower than a note of the same text at idle (~7 ms against ~0.8).
    // 60 ms catches a rescan of our own on top of it.
    expect(table).toBeLessThan(60)
    // The ratios only print (YAZ-3796): the round-1 freeze cost 1.17–1.24, and a loaded machine reached 1.21 with
    // the fix, so no time ceiling tells them apart. `tableSpeed.test.ts` holds "no change in typing speed" (YAZ-3790)
    // by counts; the 60 ms ceiling above still catches a gross cost in a frozen table.
    expect(frozen).toBeLessThan(60)
    expect(styled).toBeLessThan(60)
    // The approved number (YAZ-3697): ~15 ms measured. The GitHub runner takes 60–87 ms (jsdom) since PR #219, and a
    // loaded Mac 115 ms, so 50 failed every CI run on `main` (YAZ-3743, Yaseen's OK). 150 ms still catches a rescan of
    // the table per pasted cell, which costs seconds.
    expect(paste).toBeLessThan(150)
  }, 120_000)

  // YAZ-3818 D3: 1,000 lists in the cells give the fold scan 1,000 foldable bullets; a key in a cell bullet rescans
  // its own row only (`entriesOfBlock`). The plain table takes its keys in turn, for scale.
  it('perf smoke: with a list in one cell in five, a key in a cell bullet stays under 60 ms', async () => {
    const keys = { table: [] as number[], lists: [] as number[] }
    for (let run = 0; run < 3; run++) {
      const tables = [await mount(BIG), await mount(LISTS)]
      const [table, lists] = typeInTurn(tables.map((t) => t.view), (doc, v) => (v === 0 ? cellText(doc, 250, 3) : bulletText(doc, 250, 5)))
      keys.table.push(...table!)
      keys.lists.push(...lists!)
      for (const t of tables) await t.close()
    }
    const [table, lists] = [median(keys.table), median(keys.lists)]
    console.log(`S6 lists: type ms/key: table ${table.toFixed(2)}, cell bullet in a table with 1,000 cell lists ${lists.toFixed(2)} (medians of 48 keys, typed in turn; ratio ${(lists / table).toFixed(2)}, jsdom)`)
    expect(lists).toBeLessThan(60)
  }, 120_000)

  // YAZ-4263: the same lists and 500 cell notes. A key in a cell bullet of a cell with a mark only maps the cell note
  // plugins' state (D12: no placement; `tableSpeed.test.ts` counts it). The plain table takes its keys in turn. The
  // two notes open ONCE for the three runs: jsdom keeps a closed editor in memory, and three more of this size ran
  // the file out of memory.
  it('perf smoke: with lists and 500 cell notes, a key in a cell with a mark stays under 60 ms', async () => {
    const keys = { table: [] as number[], notes: [] as number[] }
    const tables = [await mount(BIG), await mount(NOTED)]
    let count = 0
    tables[1]!.view.state.doc.forEach((node) => void (node.type.name === 'cell_note' && count++))
    expect(count).toBe(500)
    for (let run = 0; run < 3; run++) {
      // Body row 250, column 1: a list and the mark of `cell-250`.
      const [table, notes] = typeInTurn(tables.map((t) => t.view), (doc, v) => (v === 0 ? cellText(doc, 250, 3) : bulletText(doc, 250, 0)))
      keys.table.push(...table!)
      keys.notes.push(...notes!)
    }
    for (const t of tables) await t.close()
    const [table, notes] = [median(keys.table), median(keys.notes)]
    console.log(`S6 cell notes: type ms/key: table ${table.toFixed(2)}, cell bullet in a cell with a mark, in a table with 1,000 cell lists and 500 cell notes ${notes.toFixed(2)} (medians of 48 keys, typed in turn; ratio ${(notes / table).toFixed(2)}, jsdom)`)
    expect(notes).toBeLessThan(60)
  }, 120_000)
})
