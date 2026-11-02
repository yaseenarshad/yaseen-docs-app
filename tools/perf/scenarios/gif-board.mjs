/**
 * gif-board (YAZ-3944 2B "Scale", YAZ-4071 7K): the frame time on a board with 20 playing GIFs. One window opens a
 * board of 20 animated GIFs (200 × 100, 16 frames of 80 ms, inside the file: `writeGifDrawing`), waits until all 20
 * play, then times `FRAMES` frames one after the other (rAF, then a task: `__perf.frame()`), with the longest task and
 * the window's renderer CPU over that time. Then the same on a board of 20 still pictures, the baseline: what the GIFs
 * cost is the gap. A build with no GIF player (main before YAZ-3943) shows the GIFs still, and `gifDecoders` is 0.
 *
 * `GIF_PROBE` counts the GIF decoders the page holds open (`ImageDecoder`s made and not closed yet), with no code in the
 * app: long-day reads it too, to see the decoders close.
 *
 * Opt-in (not in `all`). The app runs HIDDEN (`YASEEN_DOCS_E2E_HIDDEN=1`: unthrottled, so the page stays visible and
 * the GIFs play) and is driven with in-page events only, so it never takes the screen, mouse or keyboard.
 * `npm run build && npm run perf -- gif-board --app desktop/out/main/index.js`
 */
import path from 'node:path'
import { usage, helpers, sleep } from '../lib/app.mjs'
import { js, row, session } from '../lib/session.mjs'
import { PAGE_PROBES, quantiles } from '../lib/stats.mjs'
import { writeDrawing, writeGifDrawing, writeNote } from '../genVault.mjs'

export const optIn = true

const GIFS = 20
/** Frames timed on each board: about 5 s at 60 Hz. */
const FRAMES = 300
/** How long to wait for every GIF to play: each one's decoder opens on its first paint. */
const PLAY_TIMEOUT_MS = 30_000

/** Evaluated in the page before a board opens: `__gifDecoders.open` is how many GIF `ImageDecoder`s are open now. */
export const GIF_PROBE = `window.__gifDecoders ??= (() => {
  const count = { open: 0, made: 0 }
  const Base = window.ImageDecoder
  if (Base === undefined) return count
  window.ImageDecoder = class extends Base {
    constructor(init) {
      super(init)
      this.__gif = init?.type === 'image/gif'
      if (this.__gif) count.open++, count.made++
    }
    close() {
      if (this.__gif && !this.__closed) count.open--
      this.__closed = true
      return super.close()
    }
  }
  return count
})(), true`

export function setup(dir) {
  const vault = path.join(dir, 'vault')
  return {
    profile: path.join(dir, 'profile'),
    vault,
    small: writeNote(vault, 'Small', 'bullets', 20),
    gifs: writeGifDrawing(vault, 'GIFs', GIFS),
    stills: writeDrawing(vault, 'Stills', { boxes: 0, images: GIFS }),
  }
}

const CANVAS = `document.querySelector('.tabstack__layer:not(.tabstack__layer--hidden) .editor--drawing canvas') !== null`

/** Opens `file` from its tree row, waits for its canvas and `settle`, then times FRAMES frames. */
async function timeBoard(page, file, rendererPid, settle) {
  await page.ev(`document.querySelector(${js(row(file))}).click()`)
  await page.waitFor(CANVAS, 60_000)
  await settle()
  await sleep(1000)
  const before = usage([rendererPid]).get(rendererPid)
  const { frames, longest, ms } = await page.ev(`(async () => {
    const t0 = performance.now()
    const frames = []
    for (let i = 0; i < ${FRAMES}; i++) {
      const t = performance.now()
      await __perf.frame()
      frames.push(performance.now() - t)
    }
    return { frames, longest: __perf.longestSince(t0), ms: performance.now() - t0 }
  })()`)
  const after = usage([rendererPid]).get(rendererPid)
  const q = quantiles(frames)
  return { p50: q.p50, p95: q.p95, max: q.max, longest: Math.round(longest), cpuPct: before && after ? Math.round(((after.cpuSec - before.cpuSec) / (ms / 1000)) * 1000) / 10 : null }
}

export function run(app, { profile, vault, small, gifs, stills }) {
  return session(app, { profile, wins: [{ id: 'w1', root: vault, tabs: [small] }], doc: 'Small', hidden: true }, async ({ proc, page }) => {
    await page.ev(PAGE_PROBES)
    await page.ev(GIF_PROBE)
    const rendererPid = (await (await proc.main()).ev(`process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].webContents.getOSProcessId()`)) ?? helpers(proc.pid).find((h) => h.type === 'renderer')?.pid
    const visible = await page.ev('document.visibilityState')
    const playing = async () => {
      await page.waitFor(`window.__gifDecoders.open >= ${GIFS}`, PLAY_TIMEOUT_MS).catch(() => undefined)
    }
    const g = await timeBoard(page, gifs, rendererPid, playing)
    const gifDecoders = await page.ev('window.__gifDecoders.open')
    const s = await timeBoard(page, stills, rendererPid, async () => undefined)
    return {
      gifFrameP50Ms: g.p50,
      gifFrameP95Ms: g.p95,
      gifFrameMaxMs: g.max,
      gifLongestTaskMs: g.longest,
      gifRendererCpuPct: g.cpuPct,
      stillFrameP50Ms: s.p50,
      stillFrameP95Ms: s.p95,
      stillFrameMaxMs: s.max,
      stillLongestTaskMs: s.longest,
      stillRendererCpuPct: s.cpuPct,
      gifDecoders,
      pageVisible: visible === 'visible' ? 1 : 0,
    }
  })
}
