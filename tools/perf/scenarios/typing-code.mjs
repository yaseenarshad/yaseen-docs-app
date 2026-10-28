/**
 * typing-code (YAZ-3438, YAZ-3501): keydown → next presented frame, per key, typing 20 characters into
 * the 5 MB code file (`bigCode.mjs`) the way a person types: 4 bursts of 5 keys 100 ms apart, each
 * followed by a 700 ms pause, so each pause sets off what waits for one (the Outline's read, sticky
 * scroll, the autosave). p50 / p95 / max over the keys, and the longest task from the first key to 2 s
 * after the last. The plan's target: every key under 16 ms. Before YAZ-3501 each pause cost the page
 * 470–690 ms and a key typed then waited for it; `codeTab.spec.ts` step 11 measures the same in the
 * hidden e2e.
 *
 * WRITTEN, NOT RUN: `npm run perf` starts the app with a window on screen, which an agent may not do
 * here. The first person to run it corrects what they find:
 * `npm run desktop:build && npm run perf -- typing-code --runs 5`.
 */
import path from 'node:path'
import { writeNote } from '../genVault.mjs'
import { sleep } from '../lib/app.mjs'
import { js, painted, row, session } from '../lib/session.mjs'
import { quantiles } from '../lib/stats.mjs'
import { CODE_SHOWN, writeBigCode } from './bigCode.mjs'

const OPEN_TIMEOUT_MS = 60_000
const LINE = 'export const value3 ='

/** In the page: record keydown → rAF → next task for every key from now on (`typing.mjs`'s probe). */
const KEY_PROBE = `window.__keys = [], window.addEventListener('keydown', (e) => requestAnimationFrame(() => setTimeout(() => __keys.push(performance.now() - e.timeStamp))), true), true`

export function setup(dir) {
  const vault = path.join(dir, 'vault')
  return { profile: path.join(dir, 'profile'), vault, small: writeNote(vault, 'Small', 'bullets', 20), big: path.join(vault, 'big-5mb.ts') }
}

export async function run(app, { profile, vault, small }) {
  const big = writeBigCode(vault) // afresh: the last run typed into it
  return session(app, { profile, wins: [{ id: 'w1', root: vault, tabs: [small] }], doc: 'Small' }, async ({ page }) => {
    await page.waitFor(painted('Small'))
    await page.ev(`document.querySelector(${js(row(big))}).click(), true`)
    await page.waitFor(CODE_SHOWN, OPEN_TIMEOUT_MS)
    await sleep(3000) // the TS worker's first parse and the Outline's first read
    // The cursor goes to the start of a line, the way a user clicks there.
    const [x, y] = await page.ev(`(() => { const line = [...document.querySelectorAll('.tabstack__layer:not(.tabstack__layer--hidden) .editor--code .view-line')].find((l) => l.textContent.includes(${js(LINE)})); const r = line.getBoundingClientRect(); return [r.left + 1, r.top + r.height / 2] })()`)
    await page.mouse('mousePressed', x, y, { button: 'left', buttons: 1, clickCount: 1 })
    await page.mouse('mouseReleased', x, y, { button: 'left', buttons: 0, clickCount: 1 })
    await sleep(1000)
    await page.ev(KEY_PROBE)
    const t0 = await page.ev('performance.now()')
    for (let burst = 0; burst < 4; burst++) {
      for (let i = 0; i < 5; i++) {
        await page.type('x')
        await sleep(100)
      }
      await sleep(700)
    }
    await sleep(2000)
    const keys = quantiles(await page.ev('__keys'))
    const longest = await page.ev(`__perf.longestSince(${t0})`)
    return { codeKeyP50Ms: keys.p50, codeKeyP95Ms: keys.p95, codeKeyMaxMs: keys.max, codeTypingLongTaskMs: longest }
  })
}
