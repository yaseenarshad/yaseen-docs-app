/**
 * tab-switch: click a tab → its note painted plus a frame. First visit mounts a new editor (the
 * second tab); revisits flip between three mounted editors, 10 switches.
 */
import { clickUntilPainted, session, tab } from '../lib/session.mjs'
import { quantiles } from '../lib/stats.mjs'
import { sleep } from '../lib/app.mjs'
import { TABS, mountAll, setup } from './sidebar-resize.mjs'

export { setup }

export function run(app, { profile, vault, files }) {
  return session(app, { profile, wins: [{ id: 'w1', root: vault, tabs: files }], doc: TABS[0] }, async ({ page }) => {
    await sleep(500)
    const first = await page.ev(clickUntilPainted(tab(files[1]), TABS[1]))
    await mountAll(page, files)
    const ms = []
    for (let i = 1; i <= 10; i++) {
      await sleep(300)
      ms.push((await page.ev(clickUntilPainted(tab(files[i % 3]), TABS[i % 3]))).ms)
    }
    const q = quantiles(ms)
    return { firstVisitMs: first.ms, revisitP50Ms: q.p50, revisitP95Ms: q.p95 }
  })
}
