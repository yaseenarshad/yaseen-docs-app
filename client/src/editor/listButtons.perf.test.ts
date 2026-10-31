/**
 * The list buttons' and T's lit state (YAZ-3806 T3, T4) — a hot path: Crepe asks it for each of the four buttons on
 * every update while the strip shows. It is one walk per state (the buttons share it). The documents are
 * `visibleFormatting.perf.test.ts`'s folded outline and 5,000 plain lines, everything selected; each pass is a NEW
 * state, so the cache never answers. Runs in the `perf` project.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import { median } from '../test-perf'
import { allLinesAre } from './listButtons'
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
})
