import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The layout check in headless Chrome (YAZ-5360, YAZ-5364). jsdom has no layout, so this runs the fixtures build in
 * Chrome with NO window (`--headless=new`), driven through the DevTools protocol, at the phone sizes. It checks:
 *  - the erase ask (and the other asks of Settings): when it opens, its first sentence (the loss) and every button are
 *    between the top bar and the tab bar; the question starts at its top; Cancel has the focus;
 *  - the trick-tag page (`#fixture=page-tricks`): its last block draws;
 *  - the tables (`#fixture=page-tables`, `page-table-full`, YAZ-5471): words whole, the wide one scrolls in its box.
 * It writes a picture of each case. Run after `npm run build:fixtures -w mobile`:
 * `npx vite-node mobile/publish/proveLayout.ts` (LAYOUT_DIST: another build folder; PROOF_DIR: where the pictures go).
 */

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const mobile = new URL('..', import.meta.url).pathname
const DIST = process.env.LAYOUT_DIST ?? join(mobile, 'dist-fixtures')
const PORT = Number(process.env.PROOF_PORT ?? 8931)
const DEBUG = 9351
const out = process.env.PROOF_DIR ?? mkdtempSync(join(tmpdir(), 'notecards-layout-'))
mkdirSync(out, { recursive: true })
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

const SIZES = [
  [320, 568],
  [375, 667],
  [390, 844],
] as const
const ASKS = ['c4erase-3-friends-removes3', 'c4erase-1-friends-removes1', 'c4erase-3-friends', 'c4erase-0-friends', 'c4erase-0']

process.env.NOTECARDS_SERVE = 'no'
const { serveDist } = await import('./serve')
const server = await serveDist(DIST, PORT)
setTimeout(() => (console.log('TIMEOUT'), process.exit(2)), 240_000).unref()
const profile = mkdtempSync(join(tmpdir(), 'notecards-layout-profile-'))
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' })
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
const evaluate = async (expression: string) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, page)).result.value

async function open(name: string, width: number, height: number) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true }, page)
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/?${name}-${width}#fixture=${name}` }, page)
  for (let i = 0; i < 100; i++) {
    await wait(100)
    if ((await evaluate(`document.documentElement.dataset.fixtureReady === ${JSON.stringify(name)} || document.body.dataset.fixtureError !== undefined`)) === true) break
  }
  await wait(300)
  const shot = await send('Page.captureScreenshot', { format: 'png' }, page)
  const file = join(out, `${name}-${width}x${height}.png`)
  writeFileSync(file, Buffer.from(shot.data, 'base64'))
  return file
}

const MEASURE = `(() => {
  const r = (el) => el.getBoundingClientRect()
  const top = r(document.querySelector('.topbar')).bottom
  const tab = r(document.querySelector('.tabbar')).top
  const q = document.querySelector('#confirm-question')
  if (!q) return { error: 'no ask' }
  const first = q.querySelector('p')
  const box = q.closest('[role=alertdialog]')
  const buttons = [...box.querySelectorAll('button')].map((b) => ({ text: b.textContent, top: Math.round(r(b).top), bottom: Math.round(r(b).bottom), shows: r(b).top >= top - 0.5 && r(b).bottom <= tab + 0.5 }))
  return { top: Math.round(top), tab: Math.round(tab), first: Math.round(r(first).top), firstBottom: Math.round(r(first).bottom), firstText: first.textContent, scrollTop: q.scrollTop, scrolls: q.scrollHeight > q.clientHeight, box: [Math.round(r(box).top), Math.round(r(box).bottom)], buttons, focus: document.activeElement && document.activeElement.textContent }
})()`

let failed = 0
for (const [w, h] of SIZES) {
  for (const name of ASKS) {
    const file = await open(name, w, h)
    const m = await evaluate(MEASURE)
    const firstShows = m.first >= m.top - 0.5 && Math.min(m.firstBottom, m.first + 20) <= m.tab
    const ok = !m.error && firstShows && m.scrollTop === 0 && /^Erase this phone\?/.test(m.firstText) && m.buttons.every((b: { shows: boolean }) => b.shows) && m.focus === 'Cancel'
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} at ${w}x${h}: top bar ends ${m.top}, tab bar at ${m.tab}; the first line at ${m.first} ("${String(m.firstText).slice(0, 34)}…"); the question ${m.scrolls ? 'scrolls inside' : 'fits'} (at ${m.scrollTop}); buttons ${m.buttons?.map((b: { text: string; top: number; bottom: number; shows: boolean }) => `${b.text} ${b.top}-${b.bottom}${b.shows ? '' : ' HIDDEN'}`).join(', ')}; focus ${m.focus}  ${file}`)
  }
}
if (process.env.LAYOUT_PAGES !== 'no') {
  for (const [w, h] of SIZES.slice(0, 2)) {
    const file = await open('page-tricks', w, h)
    // The end of the page in view, for the picture.
    await evaluate(`document.querySelector('.reader__body h2')?.scrollIntoView({ block: 'center' })`)
    await wait(200)
    writeFileSync(file.replace('.png', '-end.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' }, page)).data, 'base64'))
    const m = await evaluate(`({ text: document.querySelector('.reader__body')?.textContent ?? '', html: document.documentElement.outerHTML, last: [...document.querySelectorAll('.reader__body h2')].some((h) => h.textContent === 'The end') })`)
    const ok = /The end of the page\./.test(m.text) && /After the comment\./.test(m.text) && m.last && !/data-m[0-9a-f]{16}-/.test(m.html)
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  page-tricks at ${w}x${h}: "The end" heading ${m.last ? 'draws' : 'is GONE'}; the last line ${/After the comment\./.test(m.text) ? 'shows' : 'is GONE'}; ${/data-m[0-9a-f]{16}-/.test(m.html) ? 'the SECRET shows' : 'no secret'}  ${file}`)
  }
}
// YAZ-5471: the made-up tables in the real shapes (`src/dev/tableFixtures.ts`). Words wrap whole (never letter by
// letter), a short cell never spills, the page never scrolls sideways, the two-column table fits, the wide one scrolls
// in its box with its first column in place and its ⤢; full screen, the whole table, upright and turned.
const TABLES = `(async () => {
  const words = (cell) => {
    const out = []
    const walk = (n) => n.nodeType === 3 ? [...n.nodeValue.matchAll(/\\S+/g)].forEach((m) => out.push([n, m.index, m[0]])) : [...n.childNodes].forEach(walk)
    walk(cell)
    return out
  }
  const broken = []
  let cells = 0
  for (const cell of document.querySelectorAll('.reader__body .page-table td, .reader__body .page-table th')) {
    cells++
    for (const [node, at, word] of words(cell)) {
      if ([...word].length > 24) continue
      const r = document.createRange(); r.setStart(node, at); r.setEnd(node, at + word.length)
      const lines = new Set([...r.getClientRects()].map((q) => Math.round(q.top)))
      if (lines.size > 1) broken.push(word)
    }
    if (cell.hasAttribute('data-fit') && cell.scrollWidth > cell.clientWidth + 1) broken.push('spill:' + cell.textContent)
  }
  const boxes = [...document.querySelectorAll('.reader__body .page-table-box')]
  const wide = boxes.map((b) => b.hasAttribute('data-wide'))
  const six = boxes[2], scroll = six.querySelector('.page-table')
  scroll.scrollLeft = 200
  await new Promise((r) => setTimeout(r, 150))
  const first = six.querySelector('tbody td').getBoundingClientRect().left
  const frameLeft = six.querySelector('.page-table-frame').getBoundingClientRect().left
  const shadows = [six.querySelector('.page-table-frame').hasAttribute('data-more-left'), six.querySelector('.page-table-frame').hasAttribute('data-more-right')]
  const open = six.querySelector('.page-table__open').getBoundingClientRect()
  scroll.scrollLeft = 0
  return { cells, broken, wide, sticky: Math.abs(first - frameLeft) <= 2, shadows, button: open.width >= 40 && open.height >= 30, pageWide: document.scrollingElement.scrollWidth > innerWidth + 1, widths: [...six.querySelectorAll('thead th')].map((th) => Math.round(th.getBoundingClientRect().width)) }
})()`
if (process.env.LAYOUT_PAGES !== 'no') {
  for (const [w, h] of [...SIZES, [844, 390]] as const) {
    const file = await open('page-tables', w, h)
    const m = await evaluate(TABLES)
    // Two columns fit a phone held upright; six and eight do not (they scroll, with ⤢); turned, the page is wider.
    const ok = m.cells > 50 && m.broken.length === 0 && !m.pageWide && m.wide[1] === false && m.wide[2] === true && m.sticky && m.shadows[0] && m.button
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  page-tables at ${w}x${h}: ${m.cells} cells, ${m.broken.length === 0 ? 'no word broken' : 'BROKEN ' + m.broken.slice(0, 6).join(' | ')}; wide ${m.wide.map((x: boolean) => (x ? 'Y' : 'n')).join('')}; first column ${m.sticky ? 'stays' : 'SCROLLS AWAY'}; shadows ${m.shadows}; ⤢ ${m.button ? 'ok' : 'SMALL'}; page ${m.pageWide ? 'SCROLLS SIDEWAYS' : 'stays'}; six-column widths ${m.widths.join(',')}  ${file}`)
  }
  for (const [w, h] of [[375, 667], [844, 390]] as const) {
    const file = await open('page-table-full', w, h)
    const m = await evaluate(`(() => { const v = document.querySelector('.table-view'); if (!v) return { none: true }; const r = v.getBoundingClientRect(); const t = v.querySelector('table').getBoundingClientRect(); return { cover: r.top <= 0 && r.left <= 0 && r.width >= innerWidth - 1 && r.height >= innerHeight - 1, rows: v.querySelectorAll('tbody tr').length, scale: v.dataset.scale, table: [Math.round(t.width), Math.round(t.height)], close: !!v.querySelector('.table-view__close') } })()`)
    const ok = !m.none && m.cover && m.rows === 5 && m.close
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  page-table-full at ${w}x${h}: ${m.none ? 'NO VIEW' : `covers ${m.cover}, ${m.rows} rows, scale ${m.scale}, table ${m.table?.join('x')} px`}  ${file}`)
  }
}
chrome.kill()
server.close()
console.log(failed === 0 ? `\nAll layout checks pass. Pictures: ${out}` : `\n${failed} layout checks FAILED. Pictures: ${out}`)
process.exit(failed === 0 ? 0 : 1)
