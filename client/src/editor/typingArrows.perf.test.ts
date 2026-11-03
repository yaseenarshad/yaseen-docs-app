/**
 * One plain keystroke's typing handlers (YAZ-4273 C18, YAZ-4275): every `handleTextInput` of the editor, in order, the
 * way the browser's typing reaches them. The arrow rule adds one regex to the input-rules plugin, and the link guard of
 * `idLinkCaret.ts` one comparison; a plain letter makes neither change the document. The worst place for the regex is
 * the end of a long line: the input-rules plugin reads up to 500 characters before the caret. Runs in the `perf` project;
 * the budget holds the median of 50, after 10 warm-up runs.
 */
import { TextSelection } from '@milkdown/kit/prose/state'
import { afterEach, describe, expect, it } from 'vitest'
import { median } from '../test-perf'
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
    expect(median(ms)).toBeLessThan(0.5)
  }, 60_000)
})
