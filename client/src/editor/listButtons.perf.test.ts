/**
 * The list buttons' and T's lit state (YAZ-3806 T3, YAZ-4369) — a hot path: Crepe asks it for each of the four buttons on
 * every update while the strip shows. It is one walk per state (the buttons share it). The documents are
 * `visibleFormatting.perf.test.ts`'s folded outline and 5,000 plain lines, everything selected; each pass is a NEW
 * state, so the cache never answers. The highlight buttons and the ▾ (YAZ-4366) are asked the same way: the ▾ stops at
 * the first colour that is not a button. Runs in the `perf` project.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Transaction } from '@milkdown/kit/prose/state'
import { budgetMs, median } from '../test-perf'
import { allLinesAre, toggleListKind, turnIntoText } from './listButtons'
import { endOf, mount, posOf, pressKey, select, unmountAll } from './marks/markTestKit'
import { panelColour } from './highlightPanel'
import { highlightSchema, QUICK_HIGHLIGHTS, rangeHasHighlight } from './marks/highlight'

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

/** Select first to last line of `markdown` and time the three highlight buttons' and the ▾'s lit checks on 10 fresh states. */
async function highlightCheck(markdown: string, first: string, last: string, fold: boolean): Promise<[number, number]> {
  const { crepe } = await mount(markdown)
  if (fold) expect(pressKey(crepe, 'u', { mod: true, shift: true })).toBe(true)
  const from = posOf(crepe, first)
  const to = endOf(crepe, last)
  const runs: number[] = []
  for (let i = 0; i < 10; i++) {
    select(crepe, from, to - i)
    const [state, type] = crepe.editor.action((ctx) => [ctx.get(editorViewCtx).state, highlightSchema.type(ctx)] as const)
    const start = performance.now()
    for (const color of [null, ...QUICK_HIGHLIGHTS]) rangeHasHighlight(state, type, color)
    panelColour(state, type)
    runs.push(performance.now() - start)
  }
  return [median(runs), Math.max(...runs)]
}

describe('listButtons', () => {
  it('perf smoke: the four lit checks over 1,000 folded parents (5,000 lines) stay inside a frame', async () => {
    const [median, worst] = await litCheck(OUTLINE, 'P0', `P${PARENTS - 1}`, true)
    console.log(`listButtons perf: folded bullets, ${PARENTS * 5} lines, median ${median.toFixed(1)} ms, worst ${worst.toFixed(1)} ms of 10`)
    expect(median).toBeLessThan(budgetMs(10))
  })

  it('perf smoke: the same over 5,000 plain lines', async () => {
    const [median, worst] = await litCheck(PLAIN, 'L0', `L${PARENTS * 5 - 1}`, false)
    console.log(`listButtons perf: plain, ${PARENTS * 5} lines, median ${median.toFixed(1)} ms, worst ${worst.toFixed(1)} ms of 10`)
    expect(median).toBeLessThan(budgetMs(10))
  })

  // A click is one transaction of about ONE step per line: lines side by side change as one run (a wrap round the
  // run and a split per line, or a markup per item and a split each side; checker 4D, YAZ-3878). Logged, not gated:
  // the time swings with the machine's load. Measured at load 55: 1,000 plain lines → Bullet, 1,000 steps (1,999
  // before the runs), build 186 ms, apply and draw 2,073 ms; 1,000 bullets → Numbered, 1,001 steps (3,998 before),
  // build 180 ms, apply and draw 967 ms. Most of the draw is 1,000 new items (Crepe's item views).
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

  // T (YAZ-4369): one block type change per heading line, and no lift, so the click is ONE step per line.
  it('perf smoke: T over 1,000 H3 bullets → plain bullets, one step per line', async () => {
    const { crepe } = await mount(Array.from({ length: 1000 }, (_, i) => `* ### L${i}\n`).join(''))
    select(crepe, posOf(crepe, 'L0'), endOf(crepe, 'L999'))
    const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx))
    let tr: Transaction | null = null
    let start = performance.now()
    expect(turnIntoText(view.state, (built) => (tr = built))).toBe(true)
    const build = performance.now() - start
    expect(tr!.steps.length).toBe(1000)
    start = performance.now()
    view.dispatch(tr!)
    console.log(`listButtons perf: T over 1,000 H3 bullets, ${tr!.steps.length} steps, build ${build.toFixed(0)} ms, apply and draw ${(performance.now() - start).toFixed(0)} ms`)
  })

  // ⌘A on a long page: the ▾ asks on each update (YAZ-4366). Highlighted at the top, so the ▾'s walk can stop there.
  it.each([
    ['1,000 folded parents (5,000 lines)', `<mark class="highlight-red">top</mark>\n\n${OUTLINE}`, `P${PARENTS - 1}`, true],
    ['5,000 plain lines', `<mark class="highlight-red">top</mark>\n\n${PLAIN}`, `L${PARENTS * 5 - 1}`, false],
  ] as const)('perf smoke: the highlight buttons\' and the ▾\'s lit checks over %s, everything selected, stay inside a frame', async (name, markdown, last, fold) => {
    const [median, worst] = await highlightCheck(markdown, 'top', last, fold)
    console.log(`listButtons perf: highlight checks, ${name}, median ${median.toFixed(1)} ms, worst ${worst.toFixed(1)} ms of 10`)
    expect(median).toBeLessThan(budgetMs(10))
  })
})
