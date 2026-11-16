import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * THE SHEET DRAG IN HEADLESS CHROME (YAZ-5472): "butter smooth" in numbers. The fixtures build runs in Chrome with NO
 * window (`--headless=new`), as `proveLayout.ts` runs it, at an iPhone's size with touch. On `#fixture=explore-one` (one
 * sheet over a page) a finger drags the sheet down from its body (at its top) and from its head: many touch moves, two
 * for each frame. It reports, for each drag:
 *  - the browser's own counts while the finger moved (`Performance.getMetrics`): layouts, style recalcs, script time;
 *  - the frames the page drew (a requestAnimationFrame clock): how many, the gap between them (median, 95th, worst),
 *    and how many came late (over 20 ms);
 *  - the sheet's place at the end (it must be where the finger is).
 * Run after `npm run build:fixtures -w mobile`: `npx vite-node mobile/publish/proveSmooth.ts` (LAYOUT_DIST, PROOF_DIR as
 * `proveLayout.ts`).
 */

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const mobile = new URL('..', import.meta.url).pathname
const DIST = process.env.LAYOUT_DIST ?? join(mobile, 'dist-fixtures')
const PORT = Number(process.env.PROOF_PORT ?? 8932)
const DEBUG = 9352
const out = process.env.PROOF_DIR ?? mkdtempSync(join(tmpdir(), 'notecards-smooth-'))
mkdirSync(out, { recursive: true })
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

process.env.NOTECARDS_SERVE = 'no'
const { serveDist } = await import('./serve')
const server = await serveDist(DIST, PORT)
setTimeout(() => (console.log('TIMEOUT'), process.exit(2)), 180_000).unref()
const profile = mkdtempSync(join(tmpdir(), 'notecards-smooth-profile-'))
const chrome = spawn(
  CHROME,
  ['--headless=new', `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'],
  { stdio: 'ignore' },
)
let browserWs = ''
for (let i = 0; i < 50 && !browserWs; i++) {
  await wait(200)
  browserWs = await fetch(`http://127.0.0.1:${DEBUG}/json/version`).then((r) => r.json()).then((j) => j.webSocketDebuggerUrl, () => '')
}
const ws = new WebSocket(browserWs)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let seq = 0
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
ws.addEventListener('message', (e) => {
  const m = JSON.parse(String(e.data))
  const p = m.id ? pending.get(m.id) : undefined
  if (!p) return
  pending.delete(m.id)
  if (m.error) p.reject(new Error(m.error.message))
  else p.resolve(m.result)
})
const send = (method: string, params: object = {}, sessionId?: string): Promise<any> =>
  new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params, sessionId }))
  })
const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const page = (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId as string
await send('Page.enable', {}, page)
await send('Runtime.enable', {}, page)
await send('Performance.enable', {}, page)
const evaluate = async (expression: string) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, page)).result.value

const [W, H] = [390, 844]
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 3, mobile: true }, page)
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, page)
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/?smooth#fixture=explore-one` }, page)
for (let i = 0; i < 150; i++) {
  await wait(100)
  if ((await evaluate(`document.documentElement.dataset.fixtureReady === 'explore-one' || document.body.dataset.fixtureError !== undefined`)) === true) break
}
await wait(500)

const metrics = async () => Object.fromEntries(((await send('Performance.getMetrics', {}, page)).metrics as { name: string; value: number }[]).map((m) => [m.name, m.value]))
const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) =>
  send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, radiusX: 4, radiusY: 4, force: 1, id: 1 }] }, page)

/** Where to put the finger: the top sheet's body (its upper part) or its head. */
const spot = async (part: 'body' | 'head') =>
  evaluate(`(() => {
    const sheet = [...document.querySelectorAll('.explore-sheet')].at(-1)
    const r = sheet.querySelector('.explore-sheet__${part}').getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + (${part === 'body' ? 60 : 'r.height / 2'})), boxTop: Math.round(sheet.querySelector('.explore-sheet__box').getBoundingClientRect().top), scrollTop: sheet.querySelector('.explore-sheet__body').scrollTop }
  })()`)

const CLOCK = `(() => { const f = []; window.__frames = f; const tick = (t) => { f.push(t); if (window.__frames === f) requestAnimationFrame(tick) }; requestAnimationFrame(tick); return true })()`
const STOP = `(() => { const f = window.__frames; window.__frames = null; return f })()`
const sheetY = `(() => { const s = [...document.querySelectorAll('.explore-sheet')].at(-1); return s ? Math.round(new DOMMatrixReadOnly(getComputedStyle(s.querySelector('.explore-sheet__box')).transform).m42) : null })()`

async function drag(part: 'body' | 'head', moves: number, stepPx: number) {
  const at = await spot(part)
  const before = await metrics()
  await evaluate(CLOCK)
  await touch('touchStart', at.x, at.y)
  for (let i = 1; i <= moves; i++) {
    await touch('touchMove', at.x, at.y + i * stepPx)
    // Two moves for each frame (a 120 Hz finger on a 60 Hz screen).
    if (i % 2 === 0) await wait(16)
  }
  await wait(40)
  const y = await evaluate(sheetY)
  const frames = ((await evaluate(STOP)) as number[]) ?? []
  const after = await metrics()
  // Let go short of a quarter: the sheet springs back (it stays for the next drag).
  await touch('touchEnd', at.x, at.y + moves * stepPx)
  await wait(700)
  const gaps = frames.slice(1).map((t, i) => t - frames[i]).sort((a, b) => a - b)
  const q = (p: number) => (gaps.length === 0 ? 0 : gaps[Math.min(gaps.length - 1, Math.floor(p * gaps.length))])
  const d = (k: string) => (after[k] ?? 0) - (before[k] ?? 0)
  return {
    part,
    moves,
    finger: moves * stepPx,
    sheetY: y,
    layouts: d('LayoutCount'),
    styleRecalcs: d('RecalcStyleCount'),
    layoutMs: +(d('LayoutDuration') * 1000).toFixed(2),
    styleMs: +(d('RecalcStyleDuration') * 1000).toFixed(2),
    scriptMs: +(d('ScriptDuration') * 1000).toFixed(2),
    scriptPerMoveMs: +((d('ScriptDuration') * 1000) / moves).toFixed(3),
    frames: frames.length,
    gapMedianMs: +q(0.5).toFixed(1),
    gap95Ms: +q(0.95).toFixed(1),
    gapWorstMs: +(gaps.at(-1) ?? 0).toFixed(1),
    lateFrames: gaps.filter((g) => g > 20).length,
    back: await evaluate(sheetY),
  }
}

const results = [await drag('body', 120, 1.5), await drag('head', 120, 1.5)]
writeFileSync(join(out, 'smooth.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' }, page)).data, 'base64'))
let failed = 0
for (const r of results) {
  // The sheet is where the finger is (less the few px the first move took to decide), and it went back to its place.
  const follows = r.sheetY !== null && Math.abs(r.sheetY - r.finger) <= 10
  const ok = follows && r.back === 0 && r.layouts <= 2
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.part} drag: ${r.moves} moves, finger ${r.finger}px, sheet at ${r.sheetY}px, back to ${r.back}px`)
  console.log(`      browser: ${r.layouts} layouts (${r.layoutMs} ms), ${r.styleRecalcs} style recalcs (${r.styleMs} ms), script ${r.scriptMs} ms (${r.scriptPerMoveMs} ms a move)`)
  console.log(`      frames: ${r.frames}, gap median ${r.gapMedianMs} ms, 95th ${r.gap95Ms} ms, worst ${r.gapWorstMs} ms, late (>20 ms) ${r.lateFrames}`)
}
writeFileSync(join(out, 'smooth.json'), JSON.stringify(results, null, 2))
chrome.kill()
server.close()
console.log(failed === 0 ? `\nThe sheet drag checks pass. ${out}` : `\n${failed} sheet drag checks FAILED. ${out}`)
process.exit(failed === 0 ? 0 : 1)
