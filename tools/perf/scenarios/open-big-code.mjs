/**
 * open-big-code (YAZ-3438, YAZ-3501): click the 5 MB code file (`bigCode.mjs`) in the tree → its first
 * lines painted (plus a frame), the longest task on the way, and the time until its Outline is there
 * (the TS worker's tree, `nav.outline` in the tab). From a small note each time.
 *
 * WRITTEN, NOT RUN: `npm run perf` starts the app with a window on screen, which an agent may not do
 * here (YAZ-3501 proved the typing with the hidden `codeTab.spec.ts` step 11 instead). The first person
 * to run it corrects what they find: `npm run desktop:build && npm run perf -- open-big-code --runs 5`.
 */
import path from 'node:path'
import { writeNote } from '../genVault.mjs'
import { sleep } from '../lib/app.mjs'
import { painted, row, session } from '../lib/session.mjs'
import { CODE_SHOWN, writeBigCode } from './bigCode.mjs'

const OPEN_TIMEOUT_MS = 60_000

export function setup(dir) {
  const vault = path.join(dir, 'vault')
  return { profile: path.join(dir, 'profile'), vault, small: writeNote(vault, 'Small', 'bullets', 20), big: writeBigCode(vault) }
}

export function run(app, { profile, vault, small, big }) {
  return session(app, { profile, wins: [{ id: 'w1', root: vault, tabs: [small] }], doc: 'Small' }, async ({ page }) => {
    await page.waitFor(painted('Small'))
    await sleep(300)
    return page.ev(
      `(async () => {
        const t0 = performance.now()
        document.querySelector(${JSON.stringify(row(big))}).click()
        while (!${CODE_SHOWN}) {
          if (performance.now() - t0 > ${OPEN_TIMEOUT_MS}) return { codeOpenMs: null, codeOpenLongTaskMs: null, codeOutlineMs: null }
          await new Promise((r) => requestAnimationFrame(r))
        }
        await __perf.frame()
        const codeOpenMs = performance.now() - t0
        const codeOpenLongTaskMs = __perf.longestSince(t0)
        while (document.querySelector('.tabstack__layer:not(.tabstack__layer--hidden) nav.outline') === null) {
          if (performance.now() - t0 > ${OPEN_TIMEOUT_MS}) return { codeOpenMs, codeOpenLongTaskMs, codeOutlineMs: null }
          await new Promise((r) => setTimeout(r, 20))
        }
        return { codeOpenMs, codeOpenLongTaskMs, codeOutlineMs: performance.now() - t0 }
      })()`,
      OPEN_TIMEOUT_MS * 2 + 5_000,
    )
  })
}
