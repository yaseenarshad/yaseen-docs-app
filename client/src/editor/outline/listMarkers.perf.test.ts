/**
 * The marker plugin's step on one keystroke (YAZ-3727 D2, B4). A 6,000-line note of bullets with numbered children;
 * a character typed into a numbered child in the middle. Runs in the `perf` project (YAZ-740); the budget holds the
 * median of 50, after 10 warm-up runs (`test-perf.ts`). Mounting the note takes ~10 s in jsdom, so the test has 60 s.
 *
 * The budget is the PLUGIN'S OWN WORK: its `appendTransaction` on the typed transaction, which is built and applied
 * untimed before each run. Milkdown's `syncListOrderPlugin`, which it replaces, walked the whole note there: median
 * 19.3 ms, p95 184.8 ms in jsdom.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { median } from '../../test-perf'
import { mount, posOf, unmountAll } from '../marks/markTestKit'
import { listMarkersKey } from './listMarkers'

afterEach(unmountAll)

const NOTE = `${Array.from({ length: 1000 }, (_, i) => `* item ${i}\n  1. a ${i}\n  2. b ${i}\n     * c ${i}\n  3. d ${i}\n* tail ${i}`).join('\n')}\n`

describe('list markers on a big note', () => {
  it('perf smoke: one keystroke at 6,000 lines, the plugin step takes under 1 ms', async () => {
    const { crepe, view } = await mount(NOTE)
    const plugin = listMarkersKey.get(view.state)!
    const at = posOf(crepe, 'b 500') + 1
    const ms: number[] = []
    for (let i = 0; i < 60; i++) {
      const tr = view.state.tr.insertText('x', at)
      const next = view.state.apply(tr)
      const start = performance.now()
      const appended = plugin.spec.appendTransaction!([tr], view.state, next)
      if (i >= 10) ms.push(performance.now() - start)
      expect(appended).toBeNull()
    }
    const sorted = [...ms].sort((a, b) => a - b)
    console.log(`list markers perf: 6,000 lines, one keystroke: median ${median(ms).toFixed(3)} ms, p95 ${sorted[Math.floor(ms.length * 0.95)].toFixed(3)} ms (50 runs)`)
    expect(median(ms)).toBeLessThan(1)
  }, 60_000)
})
