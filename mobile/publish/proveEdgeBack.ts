import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * THE LEFT-EDGE BACK IN HEADLESS CHROME (YAZ-5435, YAZ-5499): a real touch swipe on the real app. The fixtures build runs
 * in Chrome with NO window (`--headless=new`) at an iPhone's size (390 x 844) with touch and an iPhone Safari user agent.
 * For each screen (a page from Search, a card from Search) and each place the app runs:
 *  - THE HOME SCREEN APP (`navigator.standalone`): a finger goes down at x = 5 and moves to x = 200
 *    (`Input.dispatchTouchEvent`, so the browser hit-tests the touch as a phone does), on the page's text, just under
 *    the top bar, and on the page arrows. Back must fire: the top bar shows the vault again, with no Back button.
 *  - A SAFARI TAB: the same swipe must do NOTHING (Safari's own swipe is the only one: no double Back). Then Safari's
 *    edge swipe, the browser's history back (`history.back()`, as the gesture does), must show Search again, in the
 *    app; before YAZ-5499 the app wrote no history entry, and that Back left the app.
 * Run after `npm run build:fixtures -w mobile`: `npx vite-node mobile/publish/proveEdgeBack.ts` (LAYOUT_DIST: another
 * build folder). Exit 0: every swipe went back.
 */

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const mobile = new URL('..', import.meta.url).pathname
const DIST = process.env.LAYOUT_DIST ?? join(mobile, 'dist-fixtures')
const PORT = Number(process.env.PROOF_PORT ?? 8934)
const DEBUG = 9354
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

process.env.NOTECARDS_SERVE = 'no'
const { serveDist } = await import('./serve')
const server = await serveDist(DIST, PORT)
setTimeout(() => (console.log('TIMEOUT'), process.exit(2)), 180_000).unref()
const profile = mkdtempSync(join(tmpdir(), 'notecards-edge-profile-'))
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

type Where = 'home-screen' | 'safari-tab'
/** Where the finger goes down at the left edge: the page's text, just under the top bar, the page arrows (the foot). */
type Spot = 'middle' | 'top' | 'foot'
type Result = { fixture: string; where: Where; spot: Spot; before: string; swiped: string; after: string; ok: boolean; note: string }

async function run(fixture: 'page' | 'card', where: Where, spot: Spot): Promise<Result> {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const page = (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId as string
  // A Back that leaves the app navigates the tab: an answer lost on the way is "nothing".
  const evaluate = async (expression: string) => send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, page).then((r) => r.result.value, () => null)
  await send('Page.enable', {}, page)
  await send('Runtime.enable', {}, page)
  await send('Emulation.setUserAgentOverride', { userAgent: IPHONE_UA, platform: 'iPhone' }, page)
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true }, page)
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, page)
  // iOS says "Home Screen app" with `navigator.standalone` (and the display-mode media query).
  if (where === 'home-screen') {
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(navigator, 'standalone', { value: true, configurable: true })` }, page)
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'display-mode', value: 'standalone' }] }, page).catch(() => undefined)
  }
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/?edge#fixture=${fixture}` }, page)
  for (let i = 0; i < 150; i++) {
    await wait(100)
    if ((await evaluate(`document.documentElement.dataset.fixtureReady === '${fixture}' || document.body.dataset.fixtureError !== undefined`)) === true) break
  }
  await wait(500)
  const screen = `(() => { const t = document.querySelector('.topbar__title'); return (t ? t.textContent : '?') + (document.querySelector('.topbar .back') ? ' [Back]' : '') })()`
  const before = String(await evaluate(screen))
  const y = Number(
    await evaluate(`(() => {
      const top = document.querySelector('.topbar').getBoundingClientRect().bottom
      const foot = document.querySelector('.page-arrows')
      return '${spot}' === 'top' ? Math.round(top + 12) : '${spot}' === 'foot' && foot ? Math.round(foot.getBoundingClientRect().top + foot.getBoundingClientRect().height / 2) : 420
    })()`),
  )
  const entries = String(await evaluate(`history.length + ' ' + JSON.stringify(history.state)`))
  const under = String(await evaluate(`(() => { const e = document.elementFromPoint(5, ${y}); return e ? e.tagName.toLowerCase() + [...e.classList].map((c) => '.' + c).join('') : 'none' })()`))
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number) =>
    send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, radiusX: 4, radiusY: 4, force: 1, id: 1 }] }, page)
  // The finger: down at x = 5, right to x = 200, up.
  await touch('touchStart', 5)
  for (let x = 15; x <= 200; x += 15) {
    await touch('touchMove', x)
    await wait(16)
  }
  await touch('touchMove', 200)
  await touch('touchEnd', 200)
  await wait(700)
  const swiped = String(await evaluate(screen))
  // In a tab, Safari's own edge swipe is the browser's Back: take it now.
  if (where === 'safari-tab') await evaluate('history.back()')
  await wait(1000)
  const after = String(await evaluate(screen))
  const left = String(await evaluate('location.href'))
  await send('Target.closeTarget', { targetId })
  const onScreen = (t: string) => t.endsWith('[Back]')
  const stayed = left.startsWith(`http://127.0.0.1:${PORT}/`)
  // The Home Screen app: the swipe went back, once. A tab: the app's swipe did nothing (Safari's is the only one), and
  // Safari's Back showed the screen under, in the app.
  const ok = onScreen(before) && stayed && !onScreen(after) && (where === 'home-screen' ? !onScreen(swiped) : swiped === before)
  return { fixture, where, spot, before, swiped, after, ok, note: `under the finger at y ${y}: ${under}; history ${entries}` }
}

const results: Result[] = []
for (const fixture of ['page', 'card'] as const)
  for (const where of ['home-screen', 'safari-tab'] as const) for (const spot of ['middle', 'top', 'foot'] as const) results.push(await run(fixture, where, spot))
let failed = 0
for (const r of results) {
  if (!r.ok) failed++
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.where}, ${r.fixture}, ${r.spot}: "${r.before}" -> swipe -> "${r.swiped}"${r.where === 'safari-tab' ? ` -> Safari Back -> "${r.after}"` : ''} (${r.note})`)
}
chrome.kill()
server.close()
console.log(failed === 0 ? '\nThe edge Back checks pass.' : `\n${failed} edge Back checks FAILED.`)
process.exit(failed === 0 ? 0 : 1)
