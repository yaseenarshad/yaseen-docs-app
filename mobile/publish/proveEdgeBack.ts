import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freePort } from './freePort'

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
 *
 * YAZ-5518, the ONE overlay stack (sheets, panels, menus, full-screen views):
 *  - A SAFARI TAB, Explore sheets (Search: a full page with 3 sheets over it; Review: a sheet; Today: the daily page full
 *    screen with a sheet over it): each `history.back()` (Safari's swipe) closes ONE sheet, and the tab stays in the app
 *    (before, sheets wrote no entry and Back left the app). YAZ-5472 Q4: a tab screen's first open is a full page, so
 *    under Search's and Today's sheets is that page; one more Back goes to the tab screen.
 *  - THE HOME SCREEN APP: a real touch swipe from x = 2 (the sheet sits 8 px in: the finger lands on its dim) closes the top sheet.
 *  - A page's overlays (the ⋯ menu, Find, Headings, Properties, a table full screen): Back closes ONLY the overlay and
 *    the page stays: `history.back()` in a tab, the edge swipe in the Home Screen app.
 * Run after `npm run build:fixtures -w mobile`: `npx vite-node mobile/publish/proveEdgeBack.ts` (LAYOUT_DIST: another
 * build folder; PROOF_PORT, PROOF_DEBUG: the ports, else free ones). Exit 0: every swipe went back.
 */

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const mobile = new URL('..', import.meta.url).pathname
const DIST = process.env.LAYOUT_DIST ?? join(mobile, 'dist-fixtures')
// PROOF_PORT, PROOF_DEBUG: the file server's port and Chrome's debug port; each a free port when not named.
const PORT = await freePort(process.env.PROOF_PORT)
const DEBUG = await freePort(process.env.PROOF_DEBUG)
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

process.env.NOTECARDS_SERVE = 'no'
const { serveDist } = await import('./serve')
const server = await serveDist(DIST, PORT)
setTimeout(() => (console.log('TIMEOUT'), process.exit(2)), 360_000).unref()
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

/** A fixture open in a new tab, as `run` opens it. */
async function session(fixture: string, where: Where) {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const page = (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId as string
  const evaluate = async (expression: string) => send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, page).then((r) => r.result.value, () => null)
  await send('Page.enable', {}, page)
  await send('Runtime.enable', {}, page)
  await send('Emulation.setUserAgentOverride', { userAgent: IPHONE_UA, platform: 'iPhone' }, page)
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true }, page)
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, page)
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
  /** A finger from `from` to x = 300 at `y`, as `run`'s. */
  const swipe = async (from: number, y: number) => {
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number) =>
      send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, radiusX: 4, radiusY: 4, force: 1, id: 1 }] }, page)
    await touch('touchStart', from)
    for (let x = from + 15; x <= 300; x += 15) {
      await touch('touchMove', x)
      await wait(16)
    }
    await touch('touchEnd', 300)
    await wait(900)
  }
  const stayed = async () => String(await evaluate('location.href')).startsWith(`http://127.0.0.1:${PORT}/`)
  const back = async () => {
    await evaluate('history.back()')
    await wait(900)
  }
  return { evaluate, swipe, stayed, back, close: () => send('Target.closeTarget', { targetId }) }
}

const SHEETS = `document.querySelectorAll('.explore-sheet').length`
const SCREEN = `(() => { const t = document.querySelector('.topbar__title'); return (t ? t.textContent : '?') + (document.querySelector('.topbar .back') ? ' [Back]' : '') })()`
type Check = { name: string; ok: boolean; note: string }

/** A Safari tab, sheets over a tab screen: each Back closes one sheet, in the app. */
async function sheetsBack(fixture: 'explore-stack' | 'explore-review' | 'explore-today'): Promise<Check> {
  const s = await session(fixture, 'safari-tab')
  const counts = [Number(await s.evaluate(SHEETS))]
  while (counts.at(-1)! > 0 && counts.length < 6 && (await s.stayed())) {
    await s.back()
    counts.push(Number(await s.evaluate(SHEETS)))
  }
  // YAZ-5472 Q4: Search's and Today's first open is a full page, under the sheets; its own Back goes to the tab screen.
  const pageUnder = fixture !== 'explore-review'
  const under = String(await s.evaluate(SCREEN))
  if (pageUnder && (await s.stayed())) await s.back()
  const stayed = await s.stayed()
  const screen = String(await s.evaluate(SCREEN))
  await s.close()
  const ok = counts[0] > 0 && stayed && counts.every((c, i) => i === 0 || c === counts[i - 1] - 1) && counts.at(-1) === 0 && under.endsWith('[Back]') === pageUnder && !screen.endsWith('[Back]')
  return { name: `safari-tab, Back with sheets over ${fixture.replace('explore-', '').replace('stack', 'search')}`, ok, note: `sheets ${counts.join(' -> ')}; under: "${under}"; in the app: ${stayed}; then: "${screen}"` }
}

/** The Home Screen app: a swipe from x = 2 (on the dim beside the sheet) closes the top sheet. */
async function sheetEdge(): Promise<Check> {
  const s = await session('explore-stack', 'home-screen')
  const before = Number(await s.evaluate(SHEETS))
  const under = String(await s.evaluate(`(() => { const e = document.elementFromPoint(2, 420); return e ? e.tagName.toLowerCase() + [...e.classList].map((c) => '.' + c).join('') : 'none' })()`))
  await s.swipe(2, 420)
  const after = Number(await s.evaluate(SHEETS))
  await s.close()
  return { name: 'home-screen, the edge swipe from x = 2 closes the top sheet', ok: before === 3 && after === 2, note: `sheets ${before} -> ${after}; under the finger: ${under}` }
}

/** Opens one of the page's overlays; its selector, to see it shut. */
const OVERLAYS: { name: string; open: string; shows: string }[] = [
  { name: 'the ⋯ menu', open: `document.querySelector('[aria-label="Page tools"]').click()`, shows: '.page-tools__menu' },
  { name: 'Find in page', open: `document.querySelector('[aria-label="Page tools"]').click(); await new Promise((r) => setTimeout(r, 100)); [...document.querySelectorAll('[role="menuitem"]')].find((b) => /Find in page/.test(b.textContent)).click()`, shows: '.find-line' },
  { name: 'Headings', open: `document.querySelector('[aria-label="Page tools"]').click(); await new Promise((r) => setTimeout(r, 100)); [...document.querySelectorAll('[role="menuitem"]')].find((b) => /Headings/.test(b.textContent)).click()`, shows: '[role="dialog"][aria-label="Headings"]' },
  { name: 'Properties', open: `document.querySelector('[aria-label="Properties"]').click()`, shows: '[role="dialog"][aria-label="Properties"]' },
  { name: 'a table, full screen', open: `document.querySelector('[data-table-open]').click()`, shows: '.table-view' },
]

/** Back with a page overlay open closes only the overlay: the browser's Back in a tab, the edge swipe in the Home Screen app. */
async function overlayBack(where: Where): Promise<Check[]> {
  const s = await session('page', where)
  const checks: Check[] = []
  for (const o of OVERLAYS) {
    await s.evaluate(`(async () => { ${o.open} })()`)
    await wait(900)
    const shown = (await s.evaluate(`document.querySelector(${JSON.stringify(o.shows)}) !== null`)) === true
    if (where === 'safari-tab') await s.back()
    else await s.swipe(5, 420)
    const gone = (await s.evaluate(`document.querySelector(${JSON.stringify(o.shows)}) === null`)) === true
    const screen = String(await s.evaluate(SCREEN))
    const stayed = await s.stayed()
    // The page did not slide away under the overlay's Back.
    const still = (await s.evaluate(`(document.querySelector('.app')?.style.transform ?? '') === ''`)) === true
    checks.push({ name: `${where}, Back with ${o.name} open closes only it`, ok: shown && gone && stayed && still && screen === 'Spanish words [Back]', note: `shown ${shown}, closed ${gone}, page: "${screen}", page in place: ${still}` })
  }
  // Then Back closes the page itself.
  if (where === 'safari-tab') await s.back()
  else await s.swipe(5, 420)
  const screen = String(await s.evaluate(SCREEN))
  checks.push({ name: `${where}, then Back closes the page`, ok: !screen.endsWith('[Back]') && (await s.stayed()), note: `"${screen}"` })
  await s.close()
  return checks
}

const results: Result[] = []
for (const fixture of ['page', 'card'] as const)
  for (const where of ['home-screen', 'safari-tab'] as const) for (const spot of ['middle', 'top', 'foot'] as const) results.push(await run(fixture, where, spot))
let failed = 0
for (const r of results) {
  if (!r.ok) failed++
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.where}, ${r.fixture}, ${r.spot}: "${r.before}" -> swipe -> "${r.swiped}"${r.where === 'safari-tab' ? ` -> Safari Back -> "${r.after}"` : ''} (${r.note})`)
}
// YAZ-5518: the overlay stack.
const checks: Check[] = []
for (const fixture of ['explore-stack', 'explore-review', 'explore-today'] as const) checks.push(await sheetsBack(fixture))
checks.push(await sheetEdge())
for (const where of ['safari-tab', 'home-screen'] as const) checks.push(...(await overlayBack(where)))
for (const c of checks) {
  if (!c.ok) failed++
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name} (${c.note})`)
}
chrome.kill()
server.close()
console.log(failed === 0 ? '\nThe edge Back checks pass.' : `\n${failed} edge Back checks FAILED.`)
process.exit(failed === 0 ? 0 : 1)
