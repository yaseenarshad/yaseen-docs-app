/**
 * long-day (YAZ-3861, YAZ-3737 D7, S11, S12): one window works through a day of tabs, and its memory must come
 * back down. `--cycles` cycles (default 10); each opens 20 kept tabs (a double click on the tree row), switches
 * tabs, types, opens and hides the right panel, then closes every tab it opened (`button.tabbar__close`, not ⌘W).
 * After each cycle: GC 3 times, then the renderer's JS heap (and its workers' heaps), the RSS and the
 * physical footprint summed over EVERY renderer helper of the app (draw.io runs on `app://drawio`, in its own process while
 * a diagram is open) and main's JS heap after GC (S12). The run ends idle: it waits for the TS worker to stop (2 min after the
 * last code tab closes, YAZ-3862), then 30 s more, then one more sample. The `…EndMb` numbers are that one, the
 * `…LastCycleMb` ones the last cycle's.
 * Before the cycles, S11: the base cost of a window with no tab and one with one tab on the same vault, and of a
 * window on an empty vault; the gap is what the vault's index and tree cost each window.
 *
 * Opt-in (not in `all`), 1 run, no warm-up. The app runs HIDDEN (`YASEEN_DOCS_E2E_HIDDEN=1`) and is driven with
 * in-page events only, never `Input.dispatch*`, so it never takes the screen, mouse or keyboard.
 * `--snapshots`: renderer heap snapshots after cycle 1 and the last one, into `<work>/snapshots`.
 *
 * Ceilings: `perf["long-day.*"]` in budget.json (tolerance 0: memory is not timing noise).
 */
import fs from 'node:fs'
import path from 'node:path'
import { sentinel, writeCode, writeDrawing, writeNote, writeVault } from '../genVault.mjs'
import { footprints, helpers, sleep, usage } from '../lib/app.mjs'
import { ACTIVE, js, painted, row, session, tab } from '../lib/session.mjs'
import { slope } from '../lib/stats.mjs'
import { CODE_SHOWN, writeBigCode } from './bigCode.mjs'
import { flowDiagram } from './drawio.mjs'

export const optIn = true
export const runs = 1
export const warmup = 0

const VAULT_NOTES = 2000
const OPEN_TIMEOUT_MS = 90_000
const MB = 1024 * 1024
const mb = (bytes) => Math.round((bytes / MB) * 10) / 10
const LAYER = '.tabstack__layer:not(.tabstack__layer--hidden)'
/**
 * Every long-day profile turns the memory reload off (YAZ-3915): a window over 1.5 GB that is not in front would
 * reload in the middle of the run (YAZ-3866 D6), and the numbers would measure the reload, not the day.
 */
export const SETTINGS = { memoryReload: false }

/**
 * The 20 files a cycle opens, in open order: 1k and 5k bullet notes, a 5k prose note, twelve 200-line notes, a
 * `.drawio` (30 boxes), an `.excalidraw` with three pictures in `files` (D14), small `.ts` and `.py`, and the 5 MB
 * `.ts`. Each is `[name, kind, write(vault) → path]`.
 */
export const OPENS = (() => {
  const short = (i) => [`Short ${i}`, 'note', (v) => writeNote(v, `Short ${i}`, i % 2 ? 'bullets' : 'prose', 200)]
  const list = [
    ['Bullets 1k', 'note', (v) => writeNote(v, 'Bullets 1k', 'bullets', 1000)],
    ['Flow', 'diagram', (v) => writeFile(path.join(v, 'Flow.drawio'), flowDiagram(30))],
    ['Bullets 5k', 'note', (v) => writeNote(v, 'Bullets 5k', 'bullets', 5000)],
    ['Sketch', 'drawing', (v) => writeDrawing(v, 'Sketch')],
    ['Small TS', 'code', (v) => writeCode(v, 'Small TS', 'ts')],
    ['Prose 5k', 'note', (v) => writeNote(v, 'Prose 5k', 'prose', 5000)],
    ['Small PY', 'code', (v) => writeCode(v, 'Small PY', 'py')],
    ['big-5mb', 'bigCode', (v) => writeBigCode(v)],
  ]
  // A 200-line note after each of the first eight, then the last four in a row.
  return [...list.flatMap((f, i) => [f, short(i + 1)]), ...[9, 10, 11, 12].map(short)]
})()

function writeFile(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
  return file
}

export function setup(dir, { cycles = 10, snapshots = null } = {}) {
  const vault = writeVault(path.join(dir, 'vault'), VAULT_NOTES)
  const emptyVault = path.join(dir, 'empty-vault')
  fs.mkdirSync(emptyVault, { recursive: true })
  if (snapshots !== null) fs.mkdirSync(snapshots, { recursive: true })
  return {
    dir,
    vault,
    emptyVault,
    home: writeNote(vault, 'Home', 'bullets', 20),
    files: OPENS.map(([name, kind, write]) => ({ name, kind, file: write(vault) })),
    cycles,
    snapshots,
  }
}

/**
 * The cycles the ratio leaves out (YAZ-3862): V8 compiles the app's code over the first cycles. In the before run
 * that compiled code was +5.9 MB of the +6.6 MB from cycle 1 to 10 (YAZ-3861 snapshots), so a ratio from cycle 1
 * failed on code, not data. From cycle 3 on the heap grows less than 0.5 MB per cycle.
 */
export const WARM_CYCLES = 2

/**
 * The numbers a leak shows in, from the heap after GC of each cycle (MB). The ratio's start is the heap after the
 * warm cycles (cycle 3; the last one when there are fewer). The slope, the main leak signal, takes every cycle.
 */
export function leakMetrics(heapsMb) {
  const [first, start, end] = [heapsMb[0], heapsMb[Math.min(WARM_CYCLES, heapsMb.length - 1)], heapsMb.at(-1)]
  return { heapCycle1Mb: first, heapStartMb: start, heapEndMb: end, heapEndOverStartRatio: end / start, heapSlopeMbPerCycle: slope(heapsMb) }
}

/** In the page: true once `f` is on screen in the tab in front. */
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

/** Clicks the tab of note `f` and waits until it is painted. */
async function switchTo(page, f) {
  await page.ev(`document.querySelector(${js(tab(f.file))}).click()`)
  await page.waitFor(shown(f), OPEN_TIMEOUT_MS)
}

/** Types `text` at the end of the note in front, one `insertText` per character (each its own edit and undo step). */
async function typeInto(page, text) {
  const landed = await page.ev(`(async () => {
    const pm = document.querySelector('${ACTIVE}')
    pm.focus()
    const r = document.createRange()
    r.selectNodeContents(pm.lastElementChild)
    r.collapse(false)
    getSelection().removeAllRanges()
    getSelection().addRange(r)
    for (const ch of ${js(text)}) {
      document.execCommand('insertText', false, ch)
      await new Promise((res) => setTimeout(res, 20))
    }
    return pm.textContent.includes(${js(text)})
  })()`)
  if (!landed) throw new Error(`long-day: typing "${text}" did not land in the note`)
}

/** Shows the right panel, then hides it again. */
async function rightPanel(page) {
  await page.ev(`document.querySelector('button.right-panel-reopen').click()`)
  await page.waitFor(`document.querySelector('button.right-panel__hide') !== null`)
  await page.ev(`document.querySelector('button.right-panel__hide').click()`)
  await page.waitFor(`document.querySelector('button.right-panel-reopen') !== null`)
}

/** Closes the tab of every file in `files` with its ✕, then waits until the closing tabs' slide is over and their layers are gone. */
async function closeAll(page, files) {
  await page.ev(`(async () => {
    for (const sel of ${js(files.map((f) => tab(f.file)))}) {
      document.querySelector(sel)?.closest('.tabbar__tab')?.querySelector('button.tabbar__close')?.click()
      await new Promise((r) => setTimeout(r, 50))
    }
  })()`)
  await page.waitFor(`document.querySelectorAll('.tabbar__tab--out').length === 0 && document.querySelectorAll('.tabstack__layer[data-tab]').length === 1`, 30_000)
  await sleep(1000) // the closed editors' last saves and unmounts
}

/** One cycle: 20 opens with tab switches, typing and the right panel between them, then every one of them closed. */
async function cycle(page, files, n) {
  for (const [i, f] of files.entries()) {
    await open(page, f)
    if (i === 3) await typeInto(page, `typed${n}x`) // into Short 2
    // Every fifth open, back to a note opened earlier: the middle one of those open so far.
    const opened = files.slice(0, i + 1).filter((o) => o.kind === 'note')
    if (i % 5 === 4) await switchTo(page, opened[Math.floor(opened.length / 2)])
    if (i === 9 || i === 19) await rightPanel(page)
  }
  for (const f of files.filter((o) => o.kind === 'note').slice(0, 6)) await switchTo(page, f)
  await closeAll(page, files)
}

/**
 * RSS and physical footprint summed over every renderer helper of the app, how many there are, and the window's own
 * one (`pid`). On macOS, RSS swings with memory pressure (compressed pages leave it); the footprint does not (YAZ-3862).
 */
function renderers(mainPid, windowPid) {
  const pids = helpers(mainPid).filter((h) => h.type === 'renderer').map((h) => h.pid)
  const rss = usage(pids)
  const foot = footprints(pids)
  const sum = (m, key) => Math.round([...m.values()].reduce((a, v) => a + (key ? v[key] : v), 0) * 10) / 10
  return { rendererRssMb: sum(rss, 'rssMb'), rendererFootprintMb: sum(foot), renderers: rss.size, windowRssMb: rss.get(windowPid)?.rssMb ?? null, windowFootprintMb: foot.get(windowPid) ?? null }
}

/** How long the end of the run sits idle after the TS worker stopped: macOS gets a stopped worker's memory back 15 to 30 s later (YAZ-3862). */
const SETTLE_MS = 30_000

/** A session's JS heap after GC (MB): 3 collections, then `Runtime.getHeapUsage`. */
async function heapAfterGc(s, times = 3) {
  return mb((await usageAfterGc(s, times)).usedSize)
}

async function usageAfterGc(s, times, sessionId) {
  for (let i = 0; i < times; i++) await s.send('HeapProfiler.collectGarbage', {}, sessionId)
  return s.send('Runtime.getHeapUsage', {}, sessionId)
}

/**
 * The page's workers (Monaco's `editor.worker` and `tsWorker`), attached in flat mode: each has its own JS heap,
 * which the page's heap leaves out (the TS worker kept about 365 MB after its tabs closed). Returns the live set.
 */
async function watchWorkers(page) {
  const workers = new Map()
  page.on('Target.attachedToTarget', ({ sessionId, targetInfo }) => targetInfo.type === 'worker' && workers.set(sessionId, targetInfo.url))
  page.on('Target.detachedFromTarget', ({ sessionId }) => workers.delete(sessionId))
  await page.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true })
  return workers
}

/**
 * Waits until the page has no TS worker, at most `TS_WORKER_WAIT_MS`: the app stops it 2 min after the last code tab
 * closes (YAZ-3862, `client/src/code/tsWorkerStop.ts`). Returns the seconds it took, or null when it is still there.
 */
const TS_WORKER_WAIT_MS = 150_000
async function tsWorkerStop(workers) {
  const t0 = performance.now()
  while ([...workers.values()].some((url) => url.includes('tsWorker'))) {
    if (performance.now() - t0 > TS_WORKER_WAIT_MS) return null
    await sleep(250)
  }
  return Math.round((performance.now() - t0) / 100) / 10
}

/** The workers' JS heap after GC, summed (MB), and how many there are. A worker that ends mid-read is left out. */
async function workerHeaps(page, workers) {
  let bytes = 0
  for (const sessionId of [...workers.keys()]) bytes += await usageAfterGc(page, 2, sessionId).then((h) => h.usedSize, () => 0)
  return { workerHeapMb: mb(bytes), workers: workers.size }
}

/**
 * One cycle's numbers. Besides the JS heap: Blink's own heap (`embedderHeapUsedSize`: the DOM) and ArrayBuffer
 * stores (`backingStorageSize`) where this Chromium reports them, and the DOM counters (documents, nodes,
 * listeners), which show a kept DOM or iframe that the JS heap alone does not.
 */
async function sample(proc, page, windowPid, workers) {
  const h = await usageAfterGc(page, 3)
  const dom = await page.send('Memory.getDOMCounters')
  const mainHeapMb = await heapAfterGc(await proc.main(), 2)
  return {
    heapMb: mb(h.usedSize),
    ...(h.embedderHeapUsedSize !== undefined && { blinkHeapMb: mb(h.embedderHeapUsedSize) }),
    ...(h.backingStorageSize !== undefined && { backingStoreMb: mb(h.backingStorageSize) }),
    documents: dom.documents,
    domNodes: dom.nodes,
    listeners: dom.jsEventListeners,
    ...(await workerHeaps(page, workers)),
    mainHeapMb,
    ...renderers(proc.pid, windowPid),
  }
}

/** Writes `page`'s heap snapshot to `file` (its chunks arrive as events before the command answers). */
async function snapshot(page, file) {
  const out = fs.createWriteStream(file)
  const off = page.on('HeapProfiler.addHeapSnapshotChunk', ({ chunk }) => out.write(chunk))
  try {
    await page.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false })
  } finally {
    off()
    await new Promise((r) => out.end(r))
  }
}

/** Each window's renderer pid, by its `?win=` id, from main. */
const windowPids = async (proc) =>
  (await proc.main()).ev(`Object.fromEntries(process.mainModule.require('electron').BrowserWindow.getAllWindows().map((w) => [new URL(w.webContents.getURL()).searchParams.get('win'), w.webContents.getOSProcessId()]))`)

/** S11: settle 5 s after the tree is there, then each window's renderer RSS and JS heap after GC, and main's heap. */
async function baseCost({ proc, pages }, treeReady) {
  for (const p of pages) await p.waitFor(treeReady, 30_000)
  await sleep(5000)
  const pids = await windowPids(proc)
  const out = { mainHeapMb: await heapAfterGc(await proc.main(), 2) }
  for (const p of pages) out[p.win] = { heapMb: await heapAfterGc(p), rssMb: usage([pids[p.win]]).get(pids[p.win])?.rssMb ?? null }
  return out
}

export async function run(app, fx) {
  const { vault, emptyVault, home, files, cycles, snapshots, dir } = fx
  const homeRow = js(row(home))
  // S11 on an empty vault: one window, no tab.
  const bare = await session(app, { profile: path.join(dir, 'profile-empty'), wins: [{ id: 'w1', root: emptyVault, tabs: [] }], hidden: true, settings: SETTINGS }, (s) => baseCost(s, `document.querySelector('.tabbar') !== null`))
  // S11 on the vault: a window with one tab (w1) and a window with none (w2).
  const base = await session(app, { profile: path.join(dir, 'profile-base'), wins: [{ id: 'w1', root: vault, tabs: [home] }, { id: 'w2', root: vault, tabs: [] }], doc: 'Home', hidden: true, settings: SETTINGS, timeoutMs: 60_000 }, (s) =>
    baseCost(s, `document.querySelector(${homeRow}) !== null`),
  )
  const s11 = {
    emptyWindowRssMb: base.w2.rssMb,
    oneTabWindowRssMb: base.w1.rssMb,
    emptyVaultWindowRssMb: bare.w1.rssMb,
    emptyWindowHeapMb: base.w2.heapMb,
    oneTabWindowHeapMb: base.w1.heapMb,
    emptyVaultWindowHeapMb: bare.w1.heapMb,
    vaultIndexWindowRssMb: Math.round((base.w2.rssMb - bare.w1.rssMb) * 10) / 10,
    vaultIndexWindowHeapMb: Math.round((base.w2.heapMb - bare.w1.heapMb) * 10) / 10,
    mainHeapEmptyVaultMb: bare.mainHeapMb,
    mainHeapVaultTwoWindowsMb: base.mainHeapMb,
  }
  console.error(`long-day S11: ${JSON.stringify(s11)}`)

  return session(app, { profile: path.join(dir, 'profile'), wins: [{ id: 'w1', root: vault, tabs: [home] }], doc: 'Home', hidden: true, settings: SETTINGS, timeoutMs: 60_000 }, async ({ proc, page }) => {
    await page.waitFor(`document.querySelector(${homeRow}) !== null`, 30_000)
    // draw.io's first `load` message after each open marks the diagram on screen (as the drawio scenario does).
    await page.ev(`window.addEventListener('message', (e) => { if (typeof e.data === 'string' && e.data.includes('"event":"load"')) window.__drawioLoad ??= performance.now() })`)
    await sleep(3000)
    const windowPid = (await windowPids(proc)).w1
    const workers = await watchWorkers(page)
    const before = await sample(proc, page, windowPid, workers)
    const series = []
    for (let n = 1; n <= cycles; n++) {
      const t0 = performance.now()
      await cycle(page, files, n)
      series.push({ cycle: n, seconds: Math.round((performance.now() - t0) / 100) / 10, ...(await sample(proc, page, windowPid, workers)) })
      console.error(`long-day cycle ${n}/${cycles}: ${JSON.stringify(series.at(-1))}`)
      if (snapshots !== null && (n === 1 || n === cycles)) await snapshot(page, path.join(snapshots, `cycle-${n}.heapsnapshot`))
    }
    const last = series.at(-1)
    // The end, every tab closed: the TS worker stops, then SETTLE_MS more idle.
    const tsWorkerStopSec = await tsWorkerStop(workers)
    await sleep(SETTLE_MS)
    const settled = { tsWorkerStopSec, ...(await sample(proc, page, windowPid, workers)) }
    console.error(`long-day settled: ${JSON.stringify(settled)}`)
    return {
      ...leakMetrics(series.map((s) => s.heapMb)),
      heapBeforeCyclesMb: before.heapMb,
      rendererRssBeforeCyclesMb: before.rendererRssMb,
      rendererFootprintBeforeCyclesMb: before.rendererFootprintMb,
      rendererRssStartMb: series[0].rendererRssMb,
      rendererRssLastCycleMb: last.rendererRssMb,
      rendererRssEndMb: settled.rendererRssMb,
      rendererFootprintStartMb: series[0].rendererFootprintMb,
      rendererFootprintLastCycleMb: last.rendererFootprintMb,
      rendererFootprintEndMb: settled.rendererFootprintMb,
      rendererFootprintSlopeMbPerCycle: slope(series.map((s) => s.rendererFootprintMb)),
      heapSettledMb: settled.heapMb,
      windowFootprintEndMb: settled.windowFootprintMb,
      rendererRssSlopeMbPerCycle: slope(series.map((s) => s.rendererRssMb)),
      renderersEnd: settled.renderers,
      windowRssEndMb: settled.windowRssMb,
      workerHeapEndMb: settled.workerHeapMb,
      workersEnd: settled.workers,
      domNodesEnd: last.domNodes,
      documentsEnd: last.documents,
      listenersEnd: last.listeners,
      mainHeapBeforeCyclesMb: before.mainHeapMb,
      mainHeapEndMb: last.mainHeapMb,
      mainHeapSlopeMbPerCycle: slope(series.map((s) => s.mainHeapMb)),
      ...s11,
      series: [...series, { cycle: 'settled', ...settled }],
    }
  })
}
