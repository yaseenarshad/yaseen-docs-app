/**
 * typing: keydown → next presented frame, per key, typing 40 characters 90 ms apart at the end of a
 * 5k- and a 20k-line bullet note and a 5k-line prose note (restored as the active tab). p50 / p95 /
 * max over the keys. A note that is not painted within PAINT_TIMEOUT_MS (20k on v0.9.27) reports null.
 *
 * The prose note is typed into twice, with "Section indent" off and on (YAZ-2724). That feature
 * marks every top-level block of a section (YAZ-2709), and the prose note is made of them: about
 * 1,800 in its 5,000 lines, a heading every 11, against about 600 in the bullet note of that
 * length. `prose5kIndent` against `prose5k` is the cost of the feature per key. A build with no
 * such switch reports null for it.
 *
 * THE TWO PROSE ROWS ARE WRITTEN, NOT RUN: `npm run perf` starts the app, which an agent may not do
 * here. The first person to run them corrects what they find:
 * `npm run desktop:build && npm run perf -- typing --runs 5`.
 */
import path from 'node:path'
import { sentinel, writeNote } from '../genVault.mjs'
import { sleep } from '../lib/app.mjs'
import { ACTIVE, js, session } from '../lib/session.mjs'
import { quantiles } from '../lib/stats.mjs'

const PAINT_TIMEOUT_MS = 90_000
/** key, note, body (genVault.mjs), lines, and whether the note's "Section indent" is turned on before the typing. */
export const NOTES = [
  ['bullets5k', 'Bullets 5k', 'bullets', 5000],
  ['bullets20k', 'Bullets 20k', 'bullets', 20000],
  ['prose5k', 'Prose 5k', 'prose', 5000],
  ['prose5kIndent', 'Prose 5k', 'prose', 5000, true],
]
const TEXT = 'the quick brown fox jumps over the lazy d'

/** In the page: record keydown → rAF → next task for every key from now on. */
const KEY_PROBE = `window.__keys = [], window.addEventListener('keydown', (e) => requestAnimationFrame(() => setTimeout(() => __keys.push(performance.now() - e.timeStamp))), true), true`

/**
 * In the page: turn the note's "Section indent" on by the clicks a user makes: the page cog, its
 * switch, the cog again to close the menu. The window has one tab, so one cog. False on a build
 * with no cog or no such switch (one from before YAZ-2709 under `--vs`).
 */
const INDENT_ON = `(async () => {
  const cog = document.querySelector('.page-settings__trigger')
  if (cog === null) return false
  cog.click()
  await __perf.frame()
  const item = [...document.querySelectorAll('.page-settings__menu button')].find((b) => b.textContent.includes('Section indent'))
  if (item !== undefined && item.getAttribute('aria-pressed') !== 'true') item.click()
  await __perf.frame()
  cog.click()
  return item !== undefined
})()`

/** True once a top-level block of the note in front carries its depth: the indent is drawn. */
const INDENTED = `document.querySelector('${ACTIVE} > [data-sd]') !== null`

export function setup(dir) {
  return { dir, vault: path.join(dir, 'vault') }
}

export async function run(app, { dir, vault }) {
  const out = {}
  for (const [key, name, kind, lines, indent = false] of NOTES) {
    const file = writeNote(vault, name, kind, lines) // afresh: the last run typed into it
    const keys = await session(app, { profile: path.join(dir, `profile-${key}`), wins: [{ id: 'w1', root: vault, tabs: [file] }], doc: name, timeoutMs: PAINT_TIMEOUT_MS }, async ({ page }) => {
      // Before the caret: the indent moves the last line, and the click below is measured from where it stands.
      if (indent) {
        if (!(await page.ev(INDENT_ON))) return null
        await page.waitFor(INDENTED)
      }
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
