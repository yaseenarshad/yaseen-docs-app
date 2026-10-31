/**
 * The list buttons' and T's lit state (YAZ-3806 T3, T4) — a hot path: Crepe asks it for each of the four buttons on
 * every update while the strip shows. It is one walk per state (the buttons share it). The documents are
 * `visibleFormatting.perf.test.ts`'s folded outline and 5,000 plain lines, everything selected; each pass is a NEW
 * state, so the cache never answers. Runs in the `perf` project.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Transaction } from '@milkdown/kit/prose/state'
import { median } from '../test-perf'
import { allLinesAre, toggleListKind } from './listButtons'
import { endOf, mount, posOf, pressKey, select, unmountAll } from './marks/markTestKit'

afterEach(unmountAll)

const PARENTS = 1000
const OUTLINE = Array.from({ length: PARENTS }, (_, i) => `* P${i}\n  * a${i}\n  * b${i}\n  * c${i}\n  * d${i}\n`).join('')
const PLAIN = Array.from({ length: PARENTS * 5 }, (_, i) => `L${i}\n`).join('\n')

/** Select first to last line (folded first, if asked), and time the four buttons' lit check on 10 fresh states; returns [median, worst] ms. */
async function litCheck(markdown: string, first: string, last: string, fold: boolean): Promise<[number, number]> {
  const { crepe } = await mount(markdown)
  if (fold) expect(pressKey(crepe, 'u', { mod: true, shift: true })).toBe(true)
  const from = posOf(crepe, first)
  const to = endOf(crepe, last)
  const runs: number[] = []
  for (let i = 0; i < 10; i++) {
    select(crepe, from, to - i)
    const state = crepe.editor.action((ctx) => ctx.get(editorViewCtx).state)
    const start = performance.now()
    for (const kind of ['text', 'checklist', 'bulletList', 'numberedList'] as const) allLinesAre(state, kind)
    runs.push(performance.now() - start)
  }
  return [median(runs), Math.max(...runs)]
}

describe('listButtons', () => {
  it('perf smoke: the four lit checks over 1,000 folded parents (5,000 lines) stay inside a frame', async () => {
    const [median, worst] = await litCheck(OUTLINE, 'P0', `P${PARENTS - 1}`, true)
    console.log(`listButtons perf: folded bullets, ${PARENTS * 5} lines, median ${median.toFixed(1)} ms, worst ${worst.toFixed(1)} ms of 10`)
    expect(median).toBeLessThan(10)
  })

  it('perf smoke: the same over 5,000 plain lines', async () => {
    const [median, worst] = await litCheck(PLAIN, 'L0', `L${PARENTS * 5 - 1}`, false)
    console.log(`listButtons perf: plain, ${PARENTS * 5} lines, median ${median.toFixed(1)} ms, worst ${worst.toFixed(1)} ms of 10`)
    expect(median).toBeLessThan(10)
  })

  // A click is one transaction of about two steps per line (a wrap or a split, then a join); 1,000 lines is a big
  // selection for a toolbar click. Logged, not gated: the time swings with the machine's load. Measured at load 75
  // (YAZ-3806 3B): the BUILD of the transaction went from 1,156 ms to 283 ms for 1,000 plain lines once the lines
  // went last to first (no position maps through the steps before it). Applying it and drawing 1,000 new items
  // (Crepe's item views) is the rest, as for a plain `setBlockType` over 1,000 headings.
  it.each([
    ['1,000 plain lines → Bullet', Array.from({ length: 1000 }, (_, i) => `L${i}\n`).join('\n'), 'bulletList'],
    ['1,000 bullets → Numbered (one list, a new type)', Array.from({ length: 1000 }, (_, i) => `* L${i}\n`).join(''), 'numberedList'],
    ['1,000 bullets, the lit Bullet → plain text', Array.from({ length: 1000 }, (_, i) => `* L${i}\n`).join(''), 'bulletList'],
  ] as const)('perf smoke: one click over %s', async (name, markdown, kind) => {
    const { crepe } = await mount(markdown)
    select(crepe, posOf(crepe, 'L0'), endOf(crepe, 'L999'))
    const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx))
    let tr: Transaction | null = null
    let start = performance.now()
    expect(toggleListKind(kind)(view.state, (built) => (tr = built))).toBe(true)
    const build = performance.now() - start
    start = performance.now()
    view.dispatch(tr!)
    console.log(`listButtons perf: click over ${name}, ${tr!.steps.length} steps, build ${build.toFixed(0)} ms, apply and draw ${(performance.now() - start).toFixed(0)} ms`)
  })
})
