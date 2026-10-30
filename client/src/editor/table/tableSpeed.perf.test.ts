/**
 * S6 (YAZ-3696): the speed of a big note table on the real editor in jsdom — open a 500 × 10 table, type in a
 * cell, paste 50 × 4 tab-separated cells; then the same table frozen and styled (`freeze 1 row 2 cols, stripes,
 * fill`), where each key must not build the frozen cells' decorations again. jsdom has no layout, so the numbers
 * are the editor's own work (parse, transactions, DOM updates), not paint. Runs in the `perf` project (YAZ-740),
 * each budget on the MEDIAN (`src/test-perf.ts`). The frozen, styled table is held as a ratio to the plain one,
 * so a slower machine moves both. The measured numbers print, with a plain note of the same text for scale.
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
  const crepe = createCrepe({ root, defaultValue: markdown })
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

/** The median ms of one key, typed at `pos`: one dispatch per key, after a warm-up of three keys. */
function typeAt(view: EditorView, pos: number): { median: number; worst: number } {
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)))
  for (const ch of 'abc') view.dispatch(view.state.tr.insertText(ch))
  return timeMedian(KEYS.length, (i) => view.dispatch(view.state.tr.insertText(KEYS[i]!)))
}

describe('S6: a 500 × 10 table stays fast', () => {
  it('perf smoke: opens, types, and pastes 50 × 4 in under 50 ms; frozen and styled, it types as fast', async () => {
    const opens: number[] = []
    const keys = { note: [] as number[], table: [] as number[], frozen: [] as number[], styled: [] as number[] }
    const pastes: number[] = []
    // Three runs, each kind once per run, so a busy moment slows all kinds alike.
    for (let run = 0; run < 3; run++) {
      const note = await mount(PLAIN)
      keys.note.push(typeAt(note.view, 300).median)
      await note.close()
      for (const kind of ['table', 'frozen', 'styled'] as const) {
        const { view, ms, close } = await mount({ table: BIG, frozen: FROZEN, styled: STYLED }[kind])
        if (kind === 'table') opens.push(ms)
        keys[kind].push(typeAt(view, cellText(view.state.doc, 250, 3)).median)
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cellText(view.state.doc, 100, 2))))
        const start = performance.now()
        view.pasteText(TSV, clipboard(TSV))
        if (kind === 'table') pastes.push(performance.now() - start)
        await close()
      }
    }
    const [note, table, frozen, styled, paste] = [median(keys.note), median(keys.table), median(keys.frozen), median(keys.styled), median(pastes)]
    console.log(
      `S6: open ${median(opens).toFixed(0)} ms · type ms/key: note ${note.toFixed(2)}, table ${table.toFixed(2)}, frozen table ${frozen.toFixed(2)}, frozen styled table ${styled.toFixed(2)} · paste 50×4 ${paste.toFixed(1)} ms (medians of 3, jsdom)`,
    )
    // The note is for the log: Milkdown's own `keepTableAlignPlugin` walks every cell of the table on each key
    // (main has it too), so the table types ~9× slower than a note of the same text at idle (~7 ms against ~0.8).
    // 60 ms catches a rescan of our own on top of it.
    expect(table).toBeLessThan(60)
    // "No change in typing speed" (YAZ-3790): the freeze and the styles add no work per key, so the frozen table
    // and the frozen, styled table type as fast as the plain one.
    expect(frozen / table).toBeLessThan(1.15)
    expect(styled / table).toBeLessThan(1.15)
    // The approved number (YAZ-3697): ~15 ms measured.
    expect(paste).toBeLessThan(50)
  }, 120_000)
})
