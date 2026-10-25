/**
 * The toolbar's lit-state check over hidden lines (YAZ-3209 D4) — a hot path: Crepe asks it for
 * each button on every update while the strip shows. 1,000 folded parents with 4 kids each, then
 * 1,000 folded H2 sections with 4 lines each (5,000 lines each), everything selected; each pass is
 * a NEW state, so `visiblePieces` misses its cache every time. Runs in the `perf` project (YAZ-740).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { commandsCtx } from '@milkdown/kit/core'
import { isMarkSelectedCommand, strongSchema } from '@milkdown/kit/preset/commonmark'
import { median } from '../test-perf'
import { endOf, mount, posOf, pressKey, select, unmountAll } from './marks/markTestKit'

afterEach(unmountAll)

const PARENTS = 1000
const OUTLINE = Array.from({ length: PARENTS }, (_, i) => `* P${i}\n  * a${i}\n  * b${i}\n  * c${i}\n  * d${i}\n`).join('')
const SECTIONS = Array.from({ length: PARENTS }, (_, i) => `## H${i}\n\na${i}\n\nb${i}\n\nc${i}\n\nd${i}\n`).join('\n')

/** Fold everything, select first to last visible line, and time the lit check on 10 fresh states; returns [median, worst] ms. */
async function litCheck(markdown: string, first: string, last: string): Promise<[number, number]> {
  const { crepe } = await mount(markdown)
  expect(pressKey(crepe, 'u', { mod: true, shift: true })).toBe(true) // fold all
  const from = posOf(crepe, first)
  const to = endOf(crepe, last)
  const lit = () => crepe.editor.action((ctx) => ctx.get(commandsCtx).call(isMarkSelectedCommand.key, strongSchema.type(ctx)))
  const runs: number[] = []
  for (let i = 0; i < 10; i++) {
    select(crepe, from, to - i) // a new state each pass: the cache never answers
    const start = performance.now()
    expect(lit()).toBe(false)
    runs.push(performance.now() - start)
  }
  return [median(runs), Math.max(...runs)]
}

describe('visibleFormatting', () => {
  // The median is the budget: one pass can stall on a busy machine (a 7 ms worst seen at load 39).
  // The measured ms in the run's output, like every other perf smoke (YAZ-861).
  it('perf smoke: the Bold lit check over 1,000 folded parents (5,000 lines) stays inside a frame', async () => {
    const [median, worst] = await litCheck(OUTLINE, 'P0', `P${PARENTS - 1}`)
    console.log(`visibleFormatting perf: bullets, ${PARENTS * 5} lines, median ${median.toFixed(1)} ms, worst ${worst.toFixed(1)} ms of 10`)
    // ~0.5 ms measured (main's whole-range `rangeHasMark`: ~1 ms); 10 ms allowed.
    expect(median).toBeLessThan(10)
  })

  it('perf smoke: the same over 1,000 folded H2 sections (5,000 lines)', async () => {
    const [median, worst] = await litCheck(SECTIONS, 'H0', `H${PARENTS - 1}`)
    console.log(`visibleFormatting perf: headings, ${PARENTS * 5} lines, median ${median.toFixed(1)} ms, worst ${worst.toFixed(1)} ms of 10`)
    // ~0.5 ms measured; a per-piece `doc.rangeHasMark` took ~22 ms here. 10 ms allowed.
    expect(median).toBeLessThan(10)
  })
})
