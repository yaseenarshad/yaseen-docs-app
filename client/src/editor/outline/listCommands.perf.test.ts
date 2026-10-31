/**
 * The joins next to a big fold (YAZ-3695 3-): Backspace at the start of the line after a fold, and Delete at the end of
 * the folded line, find the next VISIBLE line through `nextVisibleTextblock`, which steps over the hidden run in one
 * jump. A fold that hides 2,000 lines, as a bullet and as a heading section. Runs in the `perf` project (YAZ-740); the
 * budget holds the median of 10 (`test-perf.ts`).
 *
 * The budget is the JOIN'S OWN WORK: the keymap, the walk to the next visible line and the transaction, with the view's
 * dispatch caught. Stepping over 2,000 hidden lines one by one cost ~14 ms here alone. The whole press (the dispatch
 * too) is logged, not gated: next to a folded heading it is the heading fold's decoration rebuild when the heading's
 * text changes, which plain typing in that heading pays as well (~60 ms here; on `main` too). Each press is undone,
 * untimed, before the next one.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { undo } from '@milkdown/kit/prose/history'
import type { Transaction } from '@milkdown/kit/prose/state'
import { median } from '../../test-perf'
import { endOf, mount, posOf, pressKey, select, unmountAll } from '../marks/markTestKit'

afterEach(unmountAll)

const HIDDEN = 2000
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
  ] as const)('perf smoke: %s fold hiding 2,000 lines, %s: the join takes under 5 ms', async (kind, key, markdown) => {
    const [own, whole] = await timeJoin(markdown, key)
    console.log(`outliner join perf: ${kind} fold, ${HIDDEN} hidden lines, ${key}: join ${own.toFixed(2)} ms, whole press ${whole.toFixed(2)} ms (medians of 10)`)
    expect(own).toBeLessThan(5)
  })
})
