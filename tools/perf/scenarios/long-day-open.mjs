/**
 * long-day-open (YAZ-3737 5A): long-day's "tabs left open" variant. One window opens long-day's 20 files as kept tabs
 * (`OPENS`: notes, a `.drawio`, an `.excalidraw` with pictures, `.ts`, `.py`, the 5 MB `.ts`), goes back to its
 * first note, and leaves every tab open. Tab sleep is on with a short clock: `YASEEN_DOCS_TAB_SLEEP_SECONDS`
 * (`SLEEP_SECONDS`), which main reads only under `YASEEN_DOCS_E2E=1` and hands the page as `?sleepSeconds=`. The run
 * waits until every tab but the one in front has slept, then wakes one by a click.
 *
 * Numbers, each after GC: the renderer's JS heap and the RSS summed over every renderer helper of the app (draw.io may
 * run in its own) with all 20 tabs awake, once they sleep, and after one wake; how many tab layers are mounted at each
 * point; and how long the sleep took after the last tab left the front.
 *
 * Opt-in (not in `all`), 1 run, no warm-up. The app runs HIDDEN (`YASEEN_DOCS_E2E_HIDDEN=1`) and is driven with in-page
 * events only, never `Input.dispatch*`, so it never takes the screen, mouse or keyboard. The memory reload is off in its
 * profile (long-day's `SETTINGS`, YAZ-3915). Ceiling: `perf["long-day-open.heapAfterWakeMb"]` in budget.json (tolerance 0).
 * Not `heapAsleepMb`: React can keep the last slept editor's hook state until its next render, so that number reads
 * 41.9 or 66.7 MB on the same build (the 5 MB code model, YAZ-3915). The wake is a render, and after it the heap reads
 * the same every run.
 * `npm run build && npm run perf -- long-day-open --app desktop/out/main/index.js`
 */
import path from 'node:path'
import { helpers, sleep, usage } from '../lib/app.mjs'
import { js, painted, row, session, tab } from '../lib/session.mjs'
import { sentinel } from '../genVault.mjs'
import { CODE_SHOWN } from './bigCode.mjs'
import { SETTINGS, setup as longDaySetup } from './long-day.mjs'

export const optIn = true
export const runs = 1
export const warmup = 0

/** The sleep clock for this run, seconds. */
export const SLEEP_SECONDS = 20
const OPEN_TIMEOUT_MS = 90_000
/** Rounds run every SLEEP_SECONDS / 4 s: sleep must come within this of its due time. */
const SLEEP_TIMEOUT_MS = 120_000
const MB = 1024 * 1024
const mb = (bytes) => Math.round((bytes / MB) * 10) / 10
const LAYER = '.tabstack__layer:not(.tabstack__layer--hidden)'
const LAYERS = `document.querySelectorAll('.tabstack__layer[data-tab]').length`

/** long-day's vault and its 20 files; one cycle's worth. */
export const setup = (dir) => longDaySetup(dir, { cycles: 1 })

/** In the page: true once `f` is on screen in the tab in front (as long-day reads it). */
function shown({ name, kind }) {
  if (kind === 'note') return painted(name)
  if (kind === 'code') return `(document.querySelector('${LAYER} .editor--code .view-lines')?.textContent.includes(${js(sentinel(name))}) ?? false)`
  if (kind === 'bigCode') return CODE_SHOWN
  if (kind === 'diagram') return 'window.__drawioLoad !== undefined'
  return `document.querySelector('${LAYER} .editor--drawing canvas') !== null`
}

/** Opens `f` as a kept tab the way a double click does (click, click, dblclick on its tree row), until it is on screen. */
async function open(page, f) {
  await page.ev(`(() => {
    window.__drawioLoad = undefined
    const el = document.querySelector(${js(row(f.file))})
    for (const [type, detail] of [['click', 1], ['click', 2], ['dblclick', 2]]) el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, detail }))
  })()`)
  await page.waitFor(shown(f), OPEN_TIMEOUT_MS)
}

/** The page's JS heap after 3 GCs, the RSS over every renderer helper, and the tab layers mounted now. */
async function sample(proc, page) {
  for (let i = 0; i < 3; i++) await page.send('HeapProfiler.collectGarbage', {})
  const heap = await page.send('Runtime.getHeapUsage', {})
  const pids = helpers(proc.pid).filter((h) => h.type === 'renderer').map((h) => h.pid)
  const rss = [...usage(pids).values()].reduce((a, u) => a + u.rssMb, 0)
  return { heapMb: mb(heap.usedSize), rendererRssMb: Math.round(rss * 10) / 10, layers: await page.ev(LAYERS) }
}

export async function run(app, fx) {
  const { vault, home, files, dir } = fx
  const was = process.env.YASEEN_DOCS_TAB_SLEEP_SECONDS
  process.env.YASEEN_DOCS_TAB_SLEEP_SECONDS = String(SLEEP_SECONDS)
  try {
    return await session(app, { profile: path.join(dir, 'profile-open'), wins: [{ id: 'w1', root: vault, tabs: [home] }], doc: 'Home', hidden: true, settings: SETTINGS, timeoutMs: 60_000 }, async ({ proc, page }) => {
      await page.waitFor(`document.querySelector(${js(row(home))}) !== null`, 30_000)
      if (!(await page.ev(`location.search.includes('sleepSeconds=${SLEEP_SECONDS}')`))) throw new Error('long-day-open: the build does not take YASEEN_DOCS_TAB_SLEEP_SECONDS (YAZ-3737 5A)')
      // draw.io's first `load` message after each open marks the diagram on screen (as long-day does).
      await page.ev(`window.addEventListener('message', (e) => { if (typeof e.data === 'string' && e.data.includes('"event":"load"')) window.__drawioLoad ??= performance.now() })`)
      const t0 = performance.now()
      for (const f of files) await open(page, f)
      // Back to the first note: every one of the 20 is now a tab behind it.
      await page.ev(`document.querySelector(${js(tab(home))}).click()`)
      await page.waitFor(painted('Home'), OPEN_TIMEOUT_MS)
      const left = performance.now()
      const openSeconds = Math.round((left - t0) / 100) / 10
      const awake = await sample(proc, page)
      console.error(`long-day-open awake: ${JSON.stringify(awake)}`)
      // Every tab behind the first note sleeps: one layer is left, the one in front.
      await page.waitFor(`${LAYERS} === 1 && document.querySelectorAll('.tabbar__tab').length === ${files.length + 1}`, SLEEP_TIMEOUT_MS)
      const sleptAfterSeconds = Math.round((performance.now() - left) / 100) / 10
      await sleep(3000) // the slept editors' unmounts and the GC of their workers' messages
      const asleep = await sample(proc, page)
      console.error(`long-day-open asleep: ${JSON.stringify(asleep)}`)
      // One wake: a click on a sleeping note's tab, which comes back on screen.
      const woken = files.find((f) => f.kind === 'note')
      await page.ev(`document.querySelector(${js(tab(woken.file))}).click()`)
      await page.waitFor(shown(woken), OPEN_TIMEOUT_MS)
      const afterWake = await sample(proc, page)
      console.error(`long-day-open after one wake: ${JSON.stringify(afterWake)}`)
      return {
        tabsOpen: files.length + 1,
        sleepSeconds: SLEEP_SECONDS,
        openSeconds,
        sleptAfterSeconds,
        heapAwakeMb: awake.heapMb,
        heapAsleepMb: asleep.heapMb,
        heapAfterWakeMb: afterWake.heapMb,
        rendererRssAwakeMb: awake.rendererRssMb,
        rendererRssAsleepMb: asleep.rendererRssMb,
        rendererRssAfterWakeMb: afterWake.rendererRssMb,
        layersAwake: awake.layers,
        layersAsleep: asleep.layers,
        layersAfterWake: afterWake.layers,
      }
    })
  } finally {
    if (was === undefined) delete process.env.YASEEN_DOCS_TAB_SLEEP_SECONDS
    else process.env.YASEEN_DOCS_TAB_SLEEP_SECONDS = was
  }
}
