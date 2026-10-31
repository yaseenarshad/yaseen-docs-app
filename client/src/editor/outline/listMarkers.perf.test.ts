/**
 * The marker plugin's step on one keystroke (YAZ-3727 D2, B4). Three 6,000-line notes: bullets with numbered children,
 * a flat list of top-level bullets (the most common note shape), and one flat numbered list (YAZ-3855); a character
 * typed into a line in the middle. Runs in the `perf` project (YAZ-740); the budget holds the median of 50, after 10
 * warm-up runs (`test-perf.ts`), and the worst run gets a loose ceiling. Mounting a note takes ~10 s in jsdom, so each
 * test has 60 s.
 *
 * The budget is the PLUGIN'S OWN WORK: its `appendTransaction` on the typed transaction, which is built and applied
 * untimed before each run. The numbers of Milkdown's `syncListOrderPlugin`, which it replaces, are in the
 * `listMarkers.ts` header.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { median } from '../../test-perf'
import { mount, posOf, unmountAll } from '../marks/markTestKit'
import { listMarkersKey } from './listMarkers'

afterEach(unmountAll)

const NOTE = `${Array.from({ length: 1000 }, (_, i) => `* item ${i}\n  1. a ${i}\n  2. b ${i}\n     * c ${i}\n  3. d ${i}\n* tail ${i}`).join('\n')}\n`
const FLAT_BULLETS = `${Array.from({ length: 6000 }, (_, i) => `* line ${i}`).join('\n')}\n`
const FLAT_NUMBERS = `${Array.from({ length: 6000 }, (_, i) => `${i + 1}. line ${i}`).join('\n')}\n`

/** 60 keystrokes at the end of `text`'s first character; the plugin step of the last 50, logged as `name`. */
async function keystroke(note: string, text: string, name: string): Promise<{ median: number; worst: number }> {
  const { crepe, view } = await mount(note)
  const plugin = listMarkersKey.get(view.state)!
  const at = posOf(crepe, text) + 1
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
  const worst = sorted[sorted.length - 1]
  console.log(
    `list markers perf: ${name}, one keystroke: median ${median(ms).toFixed(3)} ms, p95 ${sorted[Math.floor(ms.length * 0.95)].toFixed(3)} ms, max ${worst.toFixed(3)} ms (50 runs)`,
  )
  return { median: median(ms), worst }
}

describe('list markers on a big note', () => {
  it('perf smoke: one keystroke at 6,000 lines, the plugin step takes under 1 ms', async () => {
    expect((await keystroke(NOTE, 'b 500', '6,000 lines')).median).toBeLessThan(1)
  }, 60_000)

  it.each([
    ['6,000 top-level bullets', FLAT_BULLETS],
    ['a 6,000-item numbered list', FLAT_NUMBERS],
  ])('perf smoke: one keystroke in %s, the plugin step takes under 1 ms', async (name, note) => {
    const { median: mid, worst } = await keystroke(note, 'line 3000', name)
    expect(mid).toBeLessThan(1)
    expect(worst).toBeLessThan(20)
  }, 60_000)
})
