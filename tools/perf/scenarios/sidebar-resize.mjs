/**
 * sidebar-resize: drag the sidebar edge with 3 mounted tabs; per mouse move, the ms from sending the
 * move to the next presented frame (the scope saw a whole-window restyle per move, ~90 ms).
 */
import path from 'node:path'
import { writeNote } from '../genVault.mjs'
import { sleep } from '../lib/app.mjs'
import { clickUntilPainted, session, tab } from '../lib/session.mjs'
import { quantiles } from '../lib/stats.mjs'

export const TABS = ['Tab A', 'Tab B', 'Tab C']
const MOVES = 30

/** A vault with three 200-line bullet notes, the tabs both this scenario and tab-switch keep open. */
export function setup(dir) {
  const vault = path.join(dir, 'vault')
  return { profile: path.join(dir, 'profile'), vault, files: TABS.map((n) => writeNote(vault, n, 'bullets', 200)) }
}

/** Visits the other two tabs so all three editors are mounted, and comes back to the first. */
export async function mountAll(page, files) {
  for (const i of [1, 2, 0]) await page.ev(clickUntilPainted(tab(files[i]), TABS[i]))
}

export function run(app, { profile, vault, files }) {
  return session(app, { profile, wins: [{ id: 'w1', root: vault, tabs: files }], doc: TABS[0] }, async ({ page }) => {
    await mountAll(page, files)
    await sleep(500)
    const [x, y] = await page.ev(`(() => { const r = document.querySelector('.sidebar-resize').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] })()`)
    await page.mouse('mouseMoved', x, y)
    await page.mouse('mousePressed', x, y, { button: 'left', buttons: 1, clickCount: 1 })
    const ms = []
    for (let i = 1; i <= MOVES; i++) {
      const t = performance.now()
      await page.mouse('mouseMoved', x + (i <= MOVES / 2 ? i : MOVES - i) * 4, y, { button: 'left', buttons: 1 })
      await page.ev('__perf.frame()')
      ms.push(performance.now() - t)
    }
    await page.mouse('mouseReleased', x, y, { button: 'left', buttons: 0, clickCount: 1 })
    const q = quantiles(ms)
    return { moveP50Ms: q.p50, moveP95Ms: q.p95, moveMaxMs: q.max }
  })
}
