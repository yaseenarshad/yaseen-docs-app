/**
 * S6 (YAZ-3696): the speed of a big note table on the real editor in jsdom — open a 500 × 10 table, type in a
 * cell, paste 50 × 4 tab-separated cells. jsdom has no layout, so the numbers are the editor's own work (parse,
 * transactions, DOM updates), not paint. The ceilings are loose on purpose: they catch a hot path that turned
 * slow (a rescan per key, a redraw of the whole table), not machine noise. The measured numbers print.
 */
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import { afterEach, describe, expect, it } from 'vitest'
import { createCrepe } from '../createCrepe'

const COLS = 10
const ROWS = 500
const head = Array.from({ length: COLS }, (_, c) => `H${c + 1}`)
const BIG = [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`]
  .concat(Array.from({ length: ROWS }, (_, r) => `| ${head.map((_, c) => `r${r + 1}c${c + 1}`).join(' | ')} |`))
  .join('\n') + '\n'
const TSV = Array.from({ length: 50 }, (_, r) => Array.from({ length: 4 }, (_, c) => `p${r}-${c}`).join('\t')).join('\n')

/** What a Sheets copy puts on the clipboard as plain text: tab-separated cells. */
const clipboard = (text: string) =>
  ({ clipboardData: { getData: (t: string) => (t === 'text/plain' ? text : '') }, preventDefault() {} }) as unknown as ClipboardEvent

const roots: HTMLElement[] = []
afterEach(() => roots.splice(0).forEach((r) => r.remove()))

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

async function open() {
  const root = document.createElement('div')
  document.body.appendChild(root)
  roots.push(root)
  const start = performance.now()
  const crepe = createCrepe({ root, defaultValue: BIG })
  await crepe.create()
  const ms = performance.now() - start
  return { crepe, view: crepe.editor.ctx.get(editorViewCtx), ms }
}

/** The text position inside body row `row` (1-based), column `col` (0-based). */
function cellText(doc: import('@milkdown/kit/prose/model').Node, row: number, col: number): number {
  let found = -1
  doc.descendants((node, pos) => {
    if (found >= 0) return false
    if (node.type.name !== 'table') return true
    const r = node.child(row)
    let offset = pos + 1
    for (let i = 0; i < row; i++) offset += node.child(i).nodeSize
    offset += 1
    for (let i = 0; i < col; i++) offset += r.child(i).nodeSize
    found = offset + 2
    return false
  })
  return found
}

describe('S6: a 500 × 10 table stays fast', () => {
  it('opens, types and pastes within loose ceilings', async () => {
    const opens: number[] = [], keys: number[] = [], pastes: number[] = []
    for (let run = 0; run < 3; run++) {
      const { crepe, view, ms } = await open()
      opens.push(ms)
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cellText(view.state.doc, 250, 3))))
      const t = performance.now()
      for (const ch of 'typing in a cell') view.dispatch(view.state.tr.insertText(ch))
      keys.push((performance.now() - t) / 16)
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cellText(view.state.doc, 100, 2))))
      const p = performance.now()
      view.pasteText(TSV, clipboard(TSV))
      pastes.push(performance.now() - p)
      await crepe.destroy()
    }
    console.log(`S6: open ${median(opens).toFixed(0)} ms · type ${median(keys).toFixed(2)} ms/key · paste 50×4 ${median(pastes).toFixed(1)} ms (median of 3, jsdom)`)
    expect(median(keys)).toBeLessThan(60)
    expect(median(pastes)).toBeLessThan(500)
  }, 120_000)
})
