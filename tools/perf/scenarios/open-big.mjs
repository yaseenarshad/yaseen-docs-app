/**
 * open-big: click a big note in the tree → its last line painted (plus a frame), and the longest task
 * on the way. From a small note each time. v0.9.27 needs ~24 min for the 20k-line note, so an open
 * gets OPEN_TIMEOUT_MS: past it that note and the rest of the run report null.
 */
import path from 'node:path'
import { writeNote } from '../genVault.mjs'
import { clickUntilPainted, painted, row, session } from '../lib/session.mjs'
import { sleep } from '../lib/app.mjs'

const OPEN_TIMEOUT_MS = 90_000
/** Cheapest first; the note that may not finish goes last. */
const BIG = [
  ['bullets1k', 'Bullets 1k', 'bullets', 1000],
  ['prose5k', 'Prose 5k', 'prose', 5000],
  ['code5k', 'Code 5k', 'code', 5000],
  ['bullets5k', 'Bullets 5k', 'bullets', 5000],
  ['bullets20k', 'Bullets 20k', 'bullets', 20000],
]

export function setup(dir) {
  const vault = path.join(dir, 'vault')
  const files = Object.fromEntries(BIG.map(([key, name, kind, lines]) => [key, writeNote(vault, name, kind, lines)]))
  return { profile: path.join(dir, 'profile'), vault, small: writeNote(vault, 'Small', 'bullets', 20), files }
}

export function run(app, { profile, vault, small, files }) {
  return session(app, { profile, wins: [{ id: 'w1', root: vault, tabs: [small] }], doc: 'Small' }, async ({ page }) => {
    const out = {}
    for (const [key, name] of BIG) {
      out[`${key}Ms`] = out[`${key}LongTaskMs`] = null
      if (out.timedOut) continue
      await page.ev(`document.querySelector(${JSON.stringify(row(small))}).click()`)
      await page.waitFor(painted('Small'))
      await sleep(300)
      try {
        const r = await page.ev(clickUntilPainted(row(files[key]), name), OPEN_TIMEOUT_MS)
        out[`${key}Ms`] = r.ms
        out[`${key}LongTaskMs`] = r.longTaskMs
      } catch (e) {
        if (!/TIMEOUT/.test(e.message)) throw e
        out.timedOut = key
      }
    }
    return out
  })
}
