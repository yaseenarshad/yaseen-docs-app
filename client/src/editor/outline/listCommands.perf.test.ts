/**
 * The joins next to a big fold (YAZ-3695 3-): Backspace at the start of the line after a fold, and Delete at the end of
 * the folded line, find the next VISIBLE line through `nextVisibleTextblock`, which steps over the hidden run in one
 * jump. A fold that hides 2,000 lines, as a bullet and as a heading section. Runs in the `perf` project (YAZ-740); the
 * budget holds the median of 10 (`test-perf.ts`).
 *
 * Two budgets. The JOIN'S OWN WORK: the keymap, the walk to the next visible line and the transaction, with the view's
 * dispatch caught. Stepping over 2,000 hidden lines one by one cost ~14 ms here alone. And the WHOLE PRESS, the dispatch
 * too (YAZ-3816): a folded heading section marks only its heading and the block after it, so the press costs about the
 * same as next to a folded bullet (~5 ms here). It cost ~50 ms when the section put one node decoration on each hidden
 * block, because ProseMirror's work for 2,000 doc-level decorations grows with their square. The budget is 40 ms: the CI
 * runner is about 5× slower than a Mac (the heading Delete press measured 32 ms there and 5 ms here, YAZ-4094), and the
 * old cost (~50 ms here, far more there) still fails it, so that cost cannot come back. Each press is undone, untimed, before the next one.
 *
 * With the page's Folding off (YAZ-4094 F1) the saved heading fold stays, but no set is drawn and none is carried
 * (YAZ-4119 fix 6): a letter typed after it is timed with folding on and off.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { undo } from '@milkdown/kit/prose/history'
import type { Transaction } from '@milkdown/kit/prose/state'
import { budgetMs, median } from '../../test-perf'
import { setFoldingOn } from './foldingSwitch'
import { endOf, mount, posOf, pressKey, select, unmountAll } from '../marks/markTestKit'

afterEach(unmountAll)

const HIDDEN = 2000
/** The whole press, next to a fold that hides 2,000 lines (YAZ-3816). */
const WHOLE_PRESS_BUDGET = 40
const BULLET = `* fold\n${Array.from({ length: HIDDEN }, (_, i) => `  * kid ${i}\n`).join('')}* after\n`
const HEADING = `## fold\n\n${Array.from({ length: HIDDEN }, (_, i) => `line ${i}`).join('\n\n')}\n\n## after\n`

/** Fold `fold`, then press `key` next to it 10 times: [join's own work median, whole press median] in ms. */
async function timeJoin(markdown: string, key: 'Backspace' | 'Delete'): Promise<[number, number]> {
  const { crepe, root, view } = await mount(markdown)
  root.querySelector<HTMLButtonElement>('[aria-label="Collapse fold"]')!.click()
  const caret = () => select(crepe, key === 'Backspace' ? posOf(crepe, 'after') : endOf(crepe, 'fold'))
  const own: number[] = []
  const whole: number[] = []
  const live = view.dispatch
  for (let i = 0; i < 10; i++) {
    caret()
    let caught: Transaction | null = null
    view.dispatch = (tr) => void (caught = tr)
    let start = performance.now()
    expect(pressKey(crepe, key)).toBe(true)
    own.push(performance.now() - start)
    view.dispatch = live
    expect(caught).not.toBeNull()

    start = performance.now()
    pressKey(crepe, key)
    whole.push(performance.now() - start)
    expect(view.state.doc.textContent).toContain('fold after')
    undo(view.state, view.dispatch)
  }
  return [median(own), median(whole)]
}

describe('outliner joins next to a fold', () => {
  it.each([
    ['bullet', 'Backspace', BULLET],
    ['bullet', 'Delete', BULLET],
    ['heading', 'Backspace', HEADING],
    ['heading', 'Delete', HEADING],
  ] as const)('perf smoke: %s fold hiding 2,000 lines, %s: the join takes under 5 ms, the whole press under 40 ms', async (kind, key, markdown) => {
    const [own, whole] = await timeJoin(markdown, key)
    console.log(`outliner join perf: ${kind} fold, ${HIDDEN} hidden lines, ${key}: join ${own.toFixed(2)} ms, whole press ${whole.toFixed(2)} ms (medians of 10)`)
    expect(own).toBeLessThan(budgetMs(5))
    expect(whole).toBeLessThan(budgetMs(WHOLE_PRESS_BUDGET))
  })
})

/** Fold the heading `fold`, set the page's Folding, then type a letter after "after" 10 times: the whole press median in ms. */
async function timeTyping(folding: boolean): Promise<number> {
  const { crepe, root, view } = await mount(HEADING)
  root.querySelector<HTMLButtonElement>('[aria-label="Collapse fold"]')!.click()
  view.dispatch(setFoldingOn(view.state.tr, folding))
  const whole: number[] = []
  for (let i = 0; i < 10; i++) {
    select(crepe, endOf(crepe, 'after'))
    const start = performance.now()
    view.dispatch(view.state.tr.insertText('x'))
    whole.push(performance.now() - start)
    expect(view.state.doc.textContent).toContain('afterx')
    undo(view.state, view.dispatch)
  }
  return median(whole)
}

describe('typing next to a saved heading fold (YAZ-4119 fix 6)', () => {
  it('perf smoke: a letter after a heading fold hiding 2,000 lines takes under 40 ms, with Folding on and off', async () => {
    const on = await timeTyping(true)
    const off = await timeTyping(false)
    console.log(`heading fold typing perf: ${HIDDEN} hidden lines, one letter: folding on ${on.toFixed(2)} ms, folding off ${off.toFixed(2)} ms (medians of 10)`)
    expect(on).toBeLessThan(budgetMs(WHOLE_PRESS_BUDGET))
    expect(off).toBeLessThan(budgetMs(WHOLE_PRESS_BUDGET))
  })
})
