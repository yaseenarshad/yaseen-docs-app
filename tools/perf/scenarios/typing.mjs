/**
 * typing: keydown → next presented frame, per key, typing 40 characters 90 ms apart at the end of a
 * 5k- and a 20k-line bullet note (restored as the active tab). p50 / p95 / max over the keys.
 * A note that is not painted within PAINT_TIMEOUT_MS (20k on v0.9.27) reports null.
 */
import path from 'node:path'
import { sentinel, writeNote } from '../genVault.mjs'
import { sleep } from '../lib/app.mjs'
import { ACTIVE, js, session } from '../lib/session.mjs'
import { quantiles } from '../lib/stats.mjs'

const PAINT_TIMEOUT_MS = 90_000
const NOTES = [['bullets5k', 'Bullets 5k', 5000], ['bullets20k', 'Bullets 20k', 20000]]
const TEXT = 'the quick brown fox jumps over the lazy d'

/** In the page: record keydown → rAF → next task for every key from now on. */
const KEY_PROBE = `window.__keys = [], window.addEventListener('keydown', (e) => requestAnimationFrame(() => setTimeout(() => __keys.push(performance.now() - e.timeStamp))), true), true`

export function setup(dir) {
  return { dir, vault: path.join(dir, 'vault') }
}

export async function run(app, { dir, vault }) {
  const out = {}
  for (const [key, name, lines] of NOTES) {
    const file = writeNote(vault, name, 'bullets', lines) // afresh: the last run typed into it
    const keys = await session(app, { profile: path.join(dir, `profile-${key}`), wins: [{ id: 'w1', root: vault, tabs: [file] }], doc: name, timeoutMs: PAINT_TIMEOUT_MS }, async ({ page }) => {
      // The caret goes to the end of the last line, the way a user clicks there.
      const [x, y] = await page.ev(`(() => { const p = [...document.querySelectorAll('${ACTIVE} p')].find((p) => p.textContent.includes(${js(sentinel(name))})); p.scrollIntoView({ block: 'center' }); const r = p.getBoundingClientRect(); return [r.right - 2, r.top + r.height / 2] })()`)
      await page.mouse('mousePressed', x, y, { button: 'left', buttons: 1, clickCount: 1 })
      await page.mouse('mouseReleased', x, y, { button: 'left', buttons: 0, clickCount: 1 })
      await sleep(1000)
      await page.ev(KEY_PROBE)
      for (const ch of TEXT) {
        await page.type(ch)
        await sleep(90)
      }
      await sleep(500)
      return quantiles(await page.ev('__keys'))
    }).catch((e) => {
      if (/TIMEOUT/.test(e.message)) return null
      throw e
    })
    Object.assign(out, { [`${key}KeyP50Ms`]: keys?.p50 ?? null, [`${key}KeyP95Ms`]: keys?.p95 ?? null, [`${key}KeyMaxMs`]: keys?.max ?? null })
  }
  return out
}
