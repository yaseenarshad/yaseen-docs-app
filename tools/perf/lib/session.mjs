/** One app session for a scenario (YAZ-2131 1C): seed the profile, launch, wait for the document, act, always quit. */
import { sentinel } from '../genVault.mjs'
import { launch } from './app.mjs'
import { PAGE_PROBES } from './stats.mjs'
import { writeState } from './work.mjs'

/** The editor of the tab in front: every visited tab stays mounted, the others are hidden layers. */
export const ACTIVE = '.tabstack__layer:not(.tabstack__layer--hidden) .ProseMirror'

/** True once note `name`'s last line is in the editor in front, i.e. the whole note is painted. */
export const painted = (name) => `(document.querySelector('${ACTIVE}')?.textContent.includes(${JSON.stringify(sentinel(name))}) ?? false)`

export const js = JSON.stringify

/**
 * Launches `app` on `profile` seeded with `wins` (see writeState), waits for window w1 to paint note
 * `doc` (within `timeoutMs`), installs the page probes and hands `act` the running session.
 * The app is quit whatever happens, so a scenario never leaves a process behind.
 */
export async function session(app, { profile, wins, doc, timeoutMs = 30_000 }, act) {
  writeState(profile, wins)
  const proc = await launch({ ...app, profile })
  try {
    const pages = await proc.windows(wins.length)
    const page = pages.find((p) => p.win === 'w1')
    const docAt = await page.waitFor(painted(doc), timeoutMs)
    await page.ev(PAGE_PROBES)
    return await act({ proc, page, pages, docAt })
  } finally {
    await proc.quit()
  }
}

/** In the page: click `selector`, then resolve with ms until note `name` is painted plus one frame, and the longest task on the way. */
export const clickUntilPainted = (selector, name) => `(async () => {
  const t0 = performance.now()
  document.querySelector(${js(selector)}).click()
  while (!${painted(name)}) await new Promise((r) => requestAnimationFrame(r))
  await __perf.frame()
  return { ms: performance.now() - t0, longTaskMs: __perf.longestSince(t0) }
})()`

/** The tree row / tab button of note `file`. */
export const row = (file) => `.tree__row--file[data-path=${js(file)}]`
export const tab = (file) => `.tabbar__btn[title=${js(file)}]`
