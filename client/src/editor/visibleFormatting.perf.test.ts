/**
 * The toolbar's lit-state check over hidden lines (YAZ-3209 D4) — a hot path: Crepe asks it for
 * each button on every update while the strip shows. 1,000 folded parents with 4 kids each (5,000
 * lines), the whole outline selected; each pass is a NEW state, so `visiblePieces` misses its cache
 * every time. Runs in the `perf` project (YAZ-740).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { commandsCtx } from '@milkdown/kit/core'
import { isMarkSelectedCommand, strongSchema } from '@milkdown/kit/preset/commonmark'
import { endOf, mount, posOf, pressKey, select, unmountAll } from './marks/markTestKit'

afterEach(unmountAll)

const PARENTS = 1000
const OUTLINE = Array.from({ length: PARENTS }, (_, i) => `* P${i}\n  * a${i}\n  * b${i}\n  * c${i}\n  * d${i}\n`).join('')

describe('visibleFormatting', () => {
  it('perf smoke: the Bold lit check over 1,000 folded parents (5,000 lines) stays inside a frame', async () => {
    const { crepe } = await mount(OUTLINE)
    expect(pressKey(crepe, 'u', { mod: true, shift: true })).toBe(true) // fold all
    const first = posOf(crepe, 'P0')
    const last = endOf(crepe, `P${PARENTS - 1}`)
    const lit = () => crepe.editor.action((ctx) => ctx.get(commandsCtx).call(isMarkSelectedCommand.key, strongSchema.type(ctx)))
    const runs: number[] = []
    for (let i = 0; i < 10; i++) {
      select(crepe, first, last - i) // a new state each pass: the cache never answers
      const start = performance.now()
      expect(lit()).toBe(false)
      runs.push(performance.now() - start)
    }
    const median = [...runs].sort((a, b) => a - b)[runs.length >> 1]
    const worst = Math.max(...runs)
    // The measured ms in the run's output, like every other perf smoke (YAZ-861). The median is
    // the budget: one pass can stall on a busy machine (a 7 ms worst seen at load 39).
    console.log(`visibleFormatting perf: lit check over ${PARENTS * 5} lines, median ${median.toFixed(1)} ms, worst ${worst.toFixed(1)} ms of 10`)
    // ~2.7 ms measured (main's plain `rangeHasMark`: ~1 ms); 10 ms allowed.
    expect(median).toBeLessThan(10)
  })
})
