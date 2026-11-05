/**
 * One plain keystroke's typing handlers (YAZ-4273 C18, YAZ-4275): every `handleTextInput` of the editor, in order, the
 * way the browser's typing reaches them. The arrow handler (a `handleTextInput` prop since the YAZ-4273 demo) returns at
 * once for a key that ends no arrow, and the link guard of `idLinkCaret.ts` adds one comparison; a plain letter makes
 * neither change the document. The worst place is the end of a long line: the input-rules plugin and the arrow handler
 * read up to 500 characters before the caret. The key that makes an arrow is three transactions (the key, the arrow as its
 * own undo step, and the step that closes it): it is timed too. Runs in the `perf` project;
 * the budget holds the median of 50, after 10 warm-up runs.
 */
import { TextSelection } from '@milkdown/kit/prose/state'
import { afterEach, describe, expect, it } from 'vitest'
import { budgetMs, median } from '../test-perf'
import { mount, unmountAll } from './marks/markTestKit'

afterEach(unmountAll)

const LONG = 'word '.repeat(110).trim()
const NOTE = `${Array.from({ length: 2000 }, (_, i) => `* line ${i} [[Plan.excalidraw]] ${i === 1000 ? LONG : 'tail'}`).join('\n')}\n`

describe('the typing handlers on a big note', () => {
  it('perf smoke: a plain letter at the end of a 550-character line, all typing handlers take under 0.5 ms', async () => {
    const { view } = await mount(NOTE)
    let end = -1
    view.state.doc.descendants((node, pos) => {
      if (end < 0 && node.isTextblock && node.textContent.endsWith(LONG)) end = pos + node.nodeSize - 1
      return end < 0
    })
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end)))
    const ms: number[] = []
    for (let i = 0; i < 60; i++) {
      const start = performance.now()
      const handled = view.someProp('handleTextInput', (f) => f(view, end, end, 'x', () => view.state.tr.insertText('x', end, end)))
      if (i >= 10) ms.push(performance.now() - start)
      expect(handled ?? false).toBe(false)
    }
    const sorted = [...ms].sort((a, b) => a - b)
    console.log(
      `typing handlers perf: a plain letter at the end of a ${LONG.length}-character line, 2,000 bullets: median ${median(ms).toFixed(3)} ms, p95 ${sorted[Math.floor(ms.length * 0.95)].toFixed(3)} ms, max ${sorted[sorted.length - 1].toFixed(3)} ms (50 runs)`,
    )
    expect(median(ms)).toBeLessThan(budgetMs(0.5))
  }, 60_000)

  it('perf smoke: the key that makes an arrow (`-` then `>`), at the end of a 550-character line, takes under one frame (16 ms)', async () => {
    const { view } = await mount(NOTE)
    let end = -1
    view.state.doc.descendants((node, pos) => {
      if (end < 0 && node.isTextblock && node.textContent.endsWith(LONG)) end = pos + node.nodeSize - 1
      return end < 0
    })
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end)))
    const arrow: number[] = []
    const plain: number[] = []
    for (let i = 0; i < 60; i++) {
      const at = view.state.selection.head
      // A plain letter as the browser types it: one transaction, for the comparison in the log.
      let start = performance.now()
      view.dispatch(view.state.tr.insertText(' ', at, at))
      if (i >= 10) plain.push(performance.now() - start)
      view.dispatch(view.state.tr.insertText('-'))
      const head = view.state.selection.head
      start = performance.now()
      const handled = view.someProp('handleTextInput', (f) => f(view, head, head, '>', () => view.state.tr.insertText('>', head, head)))
      if (i >= 10) arrow.push(performance.now() - start)
      expect(handled).toBe(true)
    }
    expect(view.state.doc.textBetween(end, view.state.selection.head)).toBe(' →'.repeat(60))
    console.log(`typing handlers perf: the arrow key at the end of a long line, 2,000 bullets: median ${median(arrow).toFixed(3)} ms (a plain letter's own transaction: median ${median(plain).toFixed(3)} ms), 50 runs`)
    expect(median(arrow)).toBeLessThan(budgetMs(16))
  }, 60_000)
})
