import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freePort } from './freePort'

/**
 * The layout check in headless Chrome (YAZ-5360, YAZ-5364). jsdom has no layout, so this runs the fixtures build in
 * Chrome with NO window (`--headless=new`), driven through the DevTools protocol, at the phone sizes. It checks:
 *  - the erase ask (and the other asks of Settings): when it opens, its first sentence (the loss) and every button are
 *    between the top bar and the tab bar; the question starts at its top; Cancel has the focus;
 *  - the trick-tag page (`#fixture=page-tricks`): its last block draws;
 *  - the tables (`#fixture=page-tables`, `page-table-full`, YAZ-5471): words whole, the wide one scrolls in its box;
 *  - the frozen table (`#fixture=page-table-frozen`, `page-table-frozen-full`, YAZ-5480): while the page scrolls down
 *    and the table sideways, its two frozen rows stay at the top and its frozen column at the left; at the table's end
 *    the rows stop inside it; full screen too;
 *  - the table look (`#fixture=page-table-look`, YAZ-5482), light and dark: the merged cells span their rows and
 *    columns, the fills and text colours paint (a custom dark ink made readable in dark mode), a clipped cell is one
 *    line, no column is too narrow to read, the page never scrolls sideways.
 *  - the calendar table (`#fixture=page-calendar`, `page-calendar-chip`, `page-calendar-full`, YAZ-5493), light and dark at
 *    375 px, the clock frozen at 9:40 am: the now line a third down the 9:30 row, red, across the row; the rows before
 *    it dimmed, the kept to-do row not; scrolled past the row, the Now pill at the bottom of the screen pointing up;
 *    full screen, the copy marked too.
 *  - the task page (`#fixture=page-tasks`, YAZ-5494), light and dark: each box of the page a check box with a 44 px tap
 *    area, a done task struck through.
 *  - numbered tasks (`#fixture=page-tasks-numbered`, YAZ-5510), light and dark, at 375 px: for 1. to 11., the number, then
 *    the box (right of the number, its middle a tap on it), then the text.
 *  - the reading look (`#fixture=page-look`, YAZ-5458): every block, light and dark, at 375 px, screen by screen down
 *    the page; the page never scrolls sideways.
 *  - the Headings sheet (`#fixture=page-headings`, `page-headings-few`, `page-headings-alone`, YAZ-5497) and the properties
 *    panel (`page-properties`) at 375×667 and 390×844: the box inside the screen, and on top: `elementFromPoint` at its
 *    list's centre, its head and its bottom finds the sheet itself, and at the page arrows' and the tab bar's place too.
 *  - the folder page (`#fixture=folder-*`, YAZ-5460), light and dark, at 375 px: a held folder's menu, the page with
 *    its text and tabs, its table (in its box, the header row and the Name column marked to stay), the grouped table,
 *    the board (its columns scroll sideways in their row), the cards, the calendar's agenda, the page in a sheet; the
 *    page never scrolls sideways.
 *  - sticky folders in Search's tree (`#fixture=search-sticky`, YAZ-5506), light and dark, at 375 px: the open
 *    folders stuck at the top, flush, one row apart, the shallower on top, opaque, the open chevron, at most the cap;
 *    a tap on a stuck folder scrolls back to it, landing under the rows stuck above it.
 *  - the guide lines of Search's tree (`#fixture=search-lines`, YAZ-5507), light and dark, at 375 px: with a finger on
 *    the list they show, each at the centre of the chevron of the folder above; the stuck rows cover them.
 *  - the card strip (`#fixture=card-strip`, `page-card-strip`, YAZ-5508), light and dark, at 375 px: closed under the
 *    card, each toggle a 44px tap, the bar inside the screen; a tap opens Reviews' drawer to its table (a picture of
 *    each); a page's card and a card embed with theirs; the page never scrolls sideways.
 *  - the comment count of a card file (`#fixture=card-strip`, YAZ-5511), light and dark, at 375 px: on the screen above
 *    the card, a 44 px tap, its centre the count's own; a tap brings the comments under the card up.
 *  - a link to a heading (`#fixture=page-links`, YAZ-5519 S2) at 320 and 375 px: the heading lands whole under the top
 *    bar, a small gap between.
 *  - the top bar of a page with an ID chip (`#fixture=page`, `page-long-id`, YAZ-5519 S3) at 320, 375 and 430 px: every
 *    control inside the screen, the dot clear of the ⚙; the title cut first, then the ID's letters; its number shows.
 *    YAZ-5521: the same with the dot amber (`page-not-sent`, `page-waiting`, and with the long ID), at 390 px too.
 *    YAZ-5524: and a page with NO ID chip (`page-no-id-*`): the words cut down to a count, never the ⚙ off the screen.
 *  - the Discard ask of a comment not sent, holding a long URL (`#fixture=page-not-sent`, YAZ-5521) at 320, 375 and
 *    390 px: its words wrap, its buttons inside the screen.
 *  - a page card's ⋯ menu low on the screen (`#fixture=page-card-menu`, YAZ-5519 S6) at 375 and 430 px: inside the
 *    screen, above the page arrows and the tab bar; its first row on top.
 *  - a card file's own ⋯ (`#fixture=card-menu`, YAZ-5527), light and dark, at 375 px: at the right of the card's head, a
 *    44 px tap; its menu inside the screen; the top bar's ⋯ holds Find in card and no card action.
 * It writes a picture of each case. Run after `npm run build:fixtures -w mobile`:
 * `npx vite-node mobile/publish/proveLayout.ts` (LAYOUT_DIST: another build folder; PROOF_DIR: where the pictures go;
 * LAYOUT_ASKS=no, LAYOUT_PAGES=no, LAYOUT_LOOK=no, LAYOUT_SHEETS=no, LAYOUT_FOLDERS=no, LAYOUT_STICKY=no, LAYOUT_LINES=no, LAYOUT_STRIP=no, LAYOUT_COUNT=no, LAYOUT_HEADING=no, LAYOUT_TOPBAR=no, LAYOUT_CARD_MENU=no, LAYOUT_DISCARD=no skip a part).
 */

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const mobile = new URL('..', import.meta.url).pathname
const DIST = process.env.LAYOUT_DIST ?? join(mobile, 'dist-fixtures')
// PROOF_PORT, PROOF_DEBUG: the file server's port and Chrome's debug port; each a free port when not named.
const PORT = await freePort(process.env.PROOF_PORT)
const DEBUG = await freePort(process.env.PROOF_DEBUG)
const out = process.env.PROOF_DIR ?? mkdtempSync(join(tmpdir(), 'notecards-layout-'))
mkdirSync(out, { recursive: true })
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

const SIZES = [
  [320, 568],
  [375, 667],
  [390, 844],
] as const
const ASKS = process.env.LAYOUT_ONLY === 'tables' ? [] : ['c4erase-3-friends-removes3', 'c4erase-1-friends-removes1', 'c4erase-3-friends', 'c4erase-0-friends', 'c4erase-0']

process.env.NOTECARDS_SERVE = 'no'
const { serveDist } = await import('./serve')
const server = await serveDist(DIST, PORT)
// YAZ-5524: 28 more top-bar cases (pages with no ID chip): the budget grows with them.
setTimeout(() => (console.log('TIMEOUT'), process.exit(2)), 420_000).unref()
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
  // A fresh document each time: the same URL again (light, then dark) must never find the last one's "ready" mark.
  await send('Page.navigate', { url: 'about:blank' }, page)
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
for (const [w, h] of process.env.LAYOUT_ASKS === 'no' ? [] : SIZES) {
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
// YAZ-5480: the file freezes 2 rows and 1 column (`src/dev/tableFixtures.ts`: FROZEN). Scrolled down into the table and
// sideways, the frozen rows sit at the top of the page's scroll box and the frozen column at the frame's left; scrolled to
// the table's end, the rows stop inside the table. Then full screen, scrolled both ways.
const FROZEN_CHECK = `(async () => {
  const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 60))))
  const r = (el) => el.getBoundingClientRect()
  const screen = document.querySelector('.screen'), frame = document.querySelector('.reader__body .page-table-frame')
  const table = frame.querySelector('table'), scroll = frame.querySelector('.page-table')
  const top = () => r(screen).top
  screen.scrollTop += r(frame).top - top() + 300
  scroll.scrollLeft = 160
  await frames()
  const head = table.rows[0].cells[0], head2 = table.rows[0].cells[3], units = table.rows[1].cells[0], body = table.rows[8].cells[0], body2 = table.rows[8].cells[3]
  const mid = { headTop: r(head).top - top(), unitsTop: r(units).top - r(head).bottom, cornerLeft: r(head).left - r(frame).left, bodyLeft: r(body).left - r(frame).left, head2Shift: Math.round(r(head2).left - r(body2).left), bodyAbove: r(table.rows[3]).top < top() }
  screen.scrollTop += r(table).bottom - top() - 20
  await frames()
  const end = { unitsBottom: r(units).bottom - r(table).bottom }
  screen.scrollTop += r(frame).top - top() + 300
  await frames()
  return { mid, end, run: table.style.getPropertyValue('--pin-run'), rows: table.dataset.pinRows, cols: table.dataset.pinCols, timeline: CSS.supports('animation-timeline: view()') }
})()`
const FROZEN_FULL = `(async () => {
  const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 60))))
  const r = (el) => el.getBoundingClientRect()
  const v = document.querySelector('.table-view'); if (!v) return { none: true }
  const pane = v.querySelector('.table-view__pane'), table = v.querySelector('table')
  pane.scrollTop = 400; pane.scrollLeft = 200
  await frames()
  const head = table.rows[0].cells[0], units = table.rows[1].cells[2], body = table.rows[12].cells[0]
  return { headTop: Math.round(r(head).top - r(pane).top), headLeft: Math.round(r(head).left - r(pane).left), unitsTop: Math.round(r(units).top - r(pane).top), bodyLeft: Math.round(r(body).left - r(pane).left), scale: v.dataset.scale, scrolled: [pane.scrollTop, pane.scrollLeft], ranges: ['--tv-y-from', '--tv-y-to', '--tv-y-run'].map((n) => v.querySelector('.table-view__content').style.getPropertyValue(n)).join(' ') }
})()`
if (process.env.LAYOUT_PAGES !== 'no') {
  for (const [w, h] of [[375, 667], [320, 568]] as const) {
    const file = await open('page-table-frozen', w, h)
    const m = await evaluate(FROZEN_CHECK)
    writeFileSync(file.replace('.png', '-scrolled.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' }, page)).data, 'base64'))
    const near = (a: number, b: number) => Math.abs(a - b) <= 2
    const ok = m.rows === '2' && m.cols === '1' && near(m.mid.headTop, 1) && near(m.mid.unitsTop, 0) && near(m.mid.cornerLeft, 1) && near(m.mid.bodyLeft, 1) && m.mid.head2Shift === 0 && m.mid.bodyAbove && m.end.unitsBottom <= 1
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  page-table-frozen at ${w}x${h}: ${m.timeline ? 'scroll-driven' : 'script'}; frozen ${m.rows} rows ${m.cols} col; scrolled down and sideways: header ${m.mid.headTop}px from the top, row 2 under it (${m.mid.unitsTop}), corner ${m.mid.cornerLeft}px and column ${m.mid.bodyLeft}px from the left, header with its column (${m.mid.head2Shift}); at the end the rows stop ${-m.end.unitsBottom}px inside  ${file}`)
  }
  {
    const file = await open('page-table-frozen-full', 375, 667)
    const m = await evaluate(FROZEN_FULL)
    writeFileSync(file.replace('.png', '-scrolled.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' }, page)).data, 'base64'))
    const ok = !m.none && m.scrolled[0] >= 300 && m.scrolled[1] >= 20 && m.headTop >= -1 && m.headTop <= 2 && m.headLeft >= -1 && m.headLeft <= 2 && m.bodyLeft >= -1 && m.bodyLeft <= 2 && m.unitsTop > 0
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  page-table-frozen-full at 375x667: scale ${m.scale}; scrolled ${m.scrolled?.join(',')}, header ${m.headTop}px from the top and ${m.headLeft}px from the left, column ${m.bodyLeft}px from the left (rows ${m.ranges})  ${file}`)
  }
}
// YAZ-5482: the file's look on the phone, in light and dark (`src/dev/tableFixtures.ts`: LOOK, LOOK_CLIP).
const LOOK_CHECK = `(() => {
  const r = (el) => el.getBoundingClientRect()
  const [look, clip] = [...document.querySelectorAll('.reader__body table')]
  const row = (i) => look.rows[i]
  const garden = row(1).cells[0], kitchen = row(3).cells[0], total = row(5).cells[1]
  const heads = [...look.rows[0].cells]
  const ink = getComputedStyle(row(4).cells[4]).color
  const fills = [row(2).cells[0], row(2).cells[3], row(3).cells[4], heads[0]].map((c) => getComputedStyle(c).backgroundImage.includes('rgb'))
  const box = clip.rows[1].querySelector('.page-table__clip')
  const narrow = [...document.querySelectorAll('.reader__body table')].flatMap((t) => [...t.rows[0].cells].map((c) => Math.round(r(c).width))).filter((w) => w < 44)
  return {
    rowspan: Math.round(r(garden).height) === Math.round(r(row(2)).bottom - r(row(1)).top),
    colspan: Math.abs(r(total).width - (r(heads[1]).width + r(heads[2]).width)) <= 1,
    kitchenBelow: r(kitchen).top >= r(garden).bottom - 1,
    fills, ink, clipCut: !!box && box.scrollWidth > box.clientWidth, clipOneLine: !!box && r(box).height < 30,
    narrow, pageWide: document.scrollingElement.scrollWidth > innerWidth + 1,
    clipInfo: box && [box.scrollWidth, box.clientWidth, box.style.maxWidth, Math.round(r(box).height), box.textContent.slice(0, 20)],
  }
})()`
if (process.env.LAYOUT_PAGES !== 'no') {
  for (const scheme of ['light', 'dark'] as const) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }, page)
    const file = await open('page-table-look', 375, 667)
    const m = await evaluate(LOOK_CHECK)
    const dark = scheme === 'dark'
    const ok = m.rowspan && m.colspan && m.kitchenBelow && m.fills.every(Boolean) && m.ink === (dark ? 'rgb(141, 141, 160)' : 'rgb(26, 26, 64)') && m.clipCut && m.clipOneLine && m.narrow.length === 0 && !m.pageWide
    if (!ok) failed++
    const shot = file.replace('.png', `-${scheme}.png`)
    writeFileSync(shot, Buffer.from((await send('Page.captureScreenshot', { format: 'png' }, page)).data, 'base64'))
    await evaluate(`document.querySelectorAll('.reader__body table')[1].scrollIntoView({ block: 'center' })`)
    await wait(200)
    writeFileSync(shot.replace('.png', '-clip.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' }, page)).data, 'base64'))
    console.log(`${ok ? 'PASS' : 'FAIL'}  page-table-look at 375x667, ${scheme}: merged ${m.rowspan ? 'rows' : 'ROWS NOT'} and ${m.colspan ? 'columns' : 'COLUMNS NOT'}; fills ${m.fills.map((f: boolean) => (f ? 'Y' : 'n')).join('')}; custom ink ${m.ink}; clip ${m.clipCut && m.clipOneLine ? 'one line, cut' : 'NOT CUT ' + JSON.stringify(m.clipInfo)}; narrow columns ${m.narrow.length === 0 ? 'none' : m.narrow.join(',')}; page ${m.pageWide ? 'SCROLLS SIDEWAYS' : 'stays'}  ${shot}`)
  }
  await send('Emulation.setEmulatedMedia', { features: [] }, page)
}
// YAZ-5493: the calendar table, light and dark, at 375 px (`src/dev/tableFixtures.ts`: CALENDAR, the clock at 9:40 am).
const CALENDAR_CHECK = `(() => {
  const r = (el) => el.getBoundingClientRect()
  const table = document.querySelector('.reader__body table[data-calendar], .table-view table[data-calendar]')
  if (!table) return { none: true }
  const rows = [...table.rows]
  const now = rows.findIndex((row) => row.classList.contains('table-now-row'))
  const past = rows.flatMap((row, i) => (row.classList.contains('table-past-row') ? [i] : []))
  const cell = rows[now].cells[1]
  const after = getComputedStyle(cell, '::after')
  const dot = getComputedStyle(rows[now].cells[0], '::before')
  const ty = new DOMMatrix(after.transform).m42
  // The line's middle: the pseudo starts 1px above the cell's top and its 2px border is the line.
  const lineAt = Math.round(ty / r(rows[now]).height * 1000) / 1000
  const colour = (el) => getComputedStyle(el).color
  const chip = document.querySelector('.reader__body [data-table-now]')
  const tab = document.querySelector('.tabbar')
  const c = chip && !chip.hidden ? r(chip) : null
  return {
    now, past, lineAt, line: after.borderTopColor + ' ' + after.borderTopWidth, dot: dot.backgroundImage.includes('radial-gradient'),
    pastInk: colour(rows[2].cells[1]), keptInk: colour(rows[1].cells[1]), nowInk: colour(rows[now].cells[1]),
    shade: getComputedStyle(rows[2].cells[1]).backgroundImage.includes('color-mix') || getComputedStyle(rows[2].cells[1]).backgroundImage.includes('rgba'),
    chip: c && { top: Math.round(c.top), bottom: Math.round(c.bottom), dir: chip.dataset.dir, tab: tab ? Math.round(r(tab).top) : innerHeight },
    pageWide: document.scrollingElement.scrollWidth > innerWidth + 1,
  }
})()`
if (process.env.LAYOUT_PAGES !== 'no') {
  for (const scheme of ['light', 'dark'] as const) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }, page)
    for (const name of ['page-calendar', 'page-calendar-chip', 'page-calendar-full']) {
      const file = await open(name, 375, 667)
      if (name === 'page-calendar-chip') {
        // Down the page until the now row is above the screen and the table's end is in view.
        await evaluate(`(() => { const s = document.querySelector('.screen--reader'), row = document.querySelector('.reader__body table tbody tr:last-child'); s.scrollTop += row.getBoundingClientRect().bottom - s.getBoundingClientRect().bottom + 40 })()`)
        await wait(400)
      }
      const shot = file.replace('.png', `-${scheme}.png`)
      writeFileSync(shot, Buffer.from((await send('Page.captureScreenshot', { format: 'png' }, page)).data, 'base64'))
      const m = await evaluate(CALENDAR_CHECK)
      const red = scheme === 'dark' ? 'rgb(255, 123, 114)' : 'rgb(192, 57, 43)'
      const marks = !m.none && m.now === 7 && m.past.join() === '2,3,4,5,6' && Math.abs(m.lineAt - 0.333) < 0.02 && m.line === `${red} 2px` && m.dot && m.pastInk !== m.keptInk && m.keptInk === m.nowInk && m.shade && !m.pageWide
      const chipOk = name !== 'page-calendar-chip' ? true : m.chip !== null && m.chip.dir === 'up' && m.chip.top > 0 && m.chip.bottom <= m.chip.tab
      const ok = marks && chipOk
      if (!ok) failed++
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} at 375x667, ${scheme}: ${m.none ? 'NO CALENDAR' : `now row ${m.now}, the line ${m.lineAt} down it (${m.line}), dot ${m.dot}; past rows ${m.past.join(',')} (${m.pastInk}, shade ${m.shade}), the kept row ${m.keptInk}; Now pill ${m.chip ? `${m.chip.top}-${m.chip.bottom} above the tab bar at ${m.chip.tab}, arrow ${m.chip.dir}` : 'hidden'}; page ${m.pageWide ? 'SCROLLS SIDEWAYS' : 'stays'}`}  ${shot}`)
    }
  }
  await send('Emulation.setEmulatedMedia', { features: [] }, page)
}
// YAZ-5494: the task page, light and dark, at 375 px: each box of the page is a check box, a tap 18 px off its middle
// still lands on it (its 44 px area), the box itself is the reader's size, a done task is struck through.
const TASKS_CHECK = `(() => {
  const boxes = [...document.querySelectorAll('.reader__body .page-task')]
  const own = boxes.filter((b) => b.dataset.task)
  // Sideways 18 px off the middle (44 px wide); up and down 9 px at least (tasks one line apart share the gap: 44 px where a task is alone).
  const at = (b, dx, dy) => { const r = b.getBoundingClientRect(); const y = r.top + r.height / 2 + dy; return y < 60 || y > innerHeight - 60 || document.elementFromPoint(r.left + r.width / 2 + dx, y) === b }
  const hits = own.map((b) => [[18, 0], [-18, 0], [0, 9], [0, -9]].every(([dx, dy]) => at(b, dx, dy)))
  const misses = own.flatMap((b, i) => (hits[i] ? [] : [b.dataset.task + ' ' + [[18, 0], [-18, 0], [0, 9], [0, -9]].map(([dx, dy]) => (at(b, dx, dy) ? 'y' : 'n')).join('')]))
  const done = own.find((b) => b.dataset.checked === 'true' && !b.closest('li').querySelector('ul, ol'))
  const li = done && done.closest('li')
  return { all: boxes.length, own: own.length, checkboxes: own.every((b) => b.getAttribute('role') === 'checkbox'), hits: hits.filter(Boolean).length, misses, size: own[0] ? Math.round(own[0].getBoundingClientRect().width) : 0, struck: li ? getComputedStyle(li).textDecorationLine : '', pageWide: document.scrollingElement.scrollWidth > innerWidth + 1 }
})()`
if (process.env.LAYOUT_PAGES !== 'no') {
  for (const scheme of ['light', 'dark'] as const) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }, page)
    const file = await open('page-tasks', 375, 667)
    const shot = file.replace('.png', `-${scheme}.png`)
    writeFileSync(shot, Buffer.from((await send('Page.captureScreenshot', { format: 'png' }, page)).data, 'base64'))
    const m = await evaluate(TASKS_CHECK)
    const ok = m.own === 11 && m.checkboxes && m.hits === m.own && m.size > 0 && m.size < 30 && m.struck.includes('line-through') && !m.pageWide
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  page-tasks at 375x667, ${scheme}: ${m.own} of ${m.all} boxes are the page's check boxes; ${m.hits} answer a tap 18 px to each side and 9 px up and down${m.misses.length ? ' (MISSED ' + m.misses.join(' | ') + ')' : ''}; a box is ${m.size}px; a done task ${m.struck}; page ${m.pageWide ? 'SCROLLS SIDEWAYS' : 'stays'}  ${shot}`)
  }
  await send('Emulation.setEmulatedMedia', { features: [] }, page)
}
// YAZ-5510: numbered tasks, light and dark, at 375 px: each number (its `::marker`, outside the item, so it ends at the
// item's left edge) shows, its box starts right of it, the text right of the box; a tap at the box's middle is the box.
const NUMBERED_CHECK = `(() => {
  const items = [...document.querySelectorAll('.reader__body ol > li')].flatMap((li) => {
    const box = li.querySelector(':scope > .page-task, :scope > p:first-child > .page-task')
    if (!box) return []
    const b = box.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(li)
    const words = [...range.getClientRects()].filter((r) => r.width > 0 && r.left >= b.right - 0.5)
    const n = li.parentElement.start + [...li.parentElement.children].indexOf(li)
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2) === box
    return [{ n, gap: Math.round((b.left - li.getBoundingClientRect().left) * 10) / 10, text: words.length ? Math.round((Math.min(...words.map((r) => r.left)) - b.right) * 10) / 10 : null, shown: getComputedStyle(li).listStyleType !== 'none', hit }]
  })
  return { items, pageWide: document.scrollingElement.scrollWidth > innerWidth + 1 }
})()`
if (process.env.LAYOUT_PAGES !== 'no') {
  for (const scheme of ['light', 'dark'] as const) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }, page)
    const file = await open('page-tasks-numbered', 375, 667)
    const shot = file.replace('.png', `-${scheme}.png`)
    writeFileSync(shot, Buffer.from((await send('Page.captureScreenshot', { format: 'png' }, page)).data, 'base64'))
    const m = await evaluate(NUMBERED_CHECK)
    const items = m.items as { n: number; gap: number; text: number | null; shown: boolean; hit: boolean }[]
    const ok = items.map((i) => i.n).join(',') === '1,2,10,11' && items.every((i) => i.shown && i.gap >= 0 && i.text !== null && i.text > 0 && i.hit) && !m.pageWide
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  page-tasks-numbered at 375x667, ${scheme}: ${items.map((i) => `${i.n}. ${i.shown ? '' : 'NO NUMBER '}box ${i.gap}px right of the number, text ${i.text}px right of the box${i.hit ? '' : ' (TAP MISSES)'}`).join('; ')}; page ${m.pageWide ? 'SCROLLS SIDEWAYS' : 'stays'}  ${shot}`)
  }
  await send('Emulation.setEmulatedMedia', { features: [] }, page)
}
// YAZ-5497: a sheet over the page is whole and on top. Its box is inside the screen; the point at its list's centre (the
// words of a page with no headings), at its head and just above its bottom edge is the sheet's own; so is the point at
// the page arrows' and the tab bar's centre (the sheet covers them: nothing at the bottom paints over it).
const ON_TOP = (sheet: string, panel: string, list: string, head: string) => `(() => {
  const r = (el) => el.getBoundingClientRect()
  const s = document.querySelector(${JSON.stringify(sheet)}), p = s && s.querySelector(${JSON.stringify(panel)})
  if (!p) return { none: true }
  const box = r(p)
  const inside = box.top >= -0.5 && box.left >= -0.5 && box.bottom <= innerHeight + 0.5 && box.right <= innerWidth + 0.5 && box.height > 40
  const own = (x, y, el) => { const hit = document.elementFromPoint(x, y); return { ok: !!hit && el.contains(hit), at: Math.round(y), hit: hit ? (hit.className || hit.tagName).toString().slice(0, 40) : 'nothing' } }
  const l = p.querySelector(${JSON.stringify(list)}), lb = l && r(l)
  const h = p.querySelector(${JSON.stringify(head)}), hb = h && r(h)
  const points = {
    list: lb ? own(lb.left + lb.width / 2, lb.top + Math.min(lb.height, box.bottom - lb.top) / 2, p) : { ok: false, hit: 'no list' },
    head: hb ? own(hb.left + hb.width / 2, hb.top + hb.height / 2, p) : { ok: false, hit: 'no head' },
    bottom: own(box.left + box.width / 2, box.bottom - 8, p),
  }
  for (const bar of document.querySelectorAll('.page-arrows, .tabbar')) {
    const b = r(bar)
    points[bar.className.split(' ')[0]] = own(b.left + b.width / 2, b.top + b.height / 2, s)
  }
  const list2 = l ? { rows: l.children.length, scrolls: l.scrollHeight > l.clientHeight + 1 } : null
  return { box: [Math.round(box.top), Math.round(box.bottom), Math.round(box.width)], inside, points, list: list2, tabbar: !!document.querySelector('.tabbar'), arrows: !!document.querySelector('.page-arrows') }
})()`
if (process.env.LAYOUT_SHEETS !== 'no') {
  const CASES = [
    ['page-headings', ON_TOP('.headings-sheet', '.headings-sheet__panel', '.headings-sheet__list', '.headings-sheet__title')],
    ['page-headings-few', ON_TOP('.headings-sheet', '.headings-sheet__panel', '.headings-sheet__none', '.headings-sheet__title')],
    ['page-headings-alone', ON_TOP('.headings-sheet', '.headings-sheet__panel', '.headings-sheet__list', '.headings-sheet__title')],
    ['page-properties', ON_TOP('.props', '.props__panel', '.props__rows', '.props__title')],
  ] as const
  for (const [w, h] of SIZES.slice(1)) {
    for (const [name, check] of CASES) {
      const file = await open(name, w, h)
      const m = await evaluate(check)
      const pts = m.none ? [] : Object.entries(m.points as Record<string, { ok: boolean; at: number; hit: string }>)
      const ok = !m.none && m.inside && pts.length >= 3 && pts.every(([, p]) => p.ok) && (name !== 'page-headings-alone' || !m.tabbar) && (name.startsWith('page-headings') ? m.arrows : true) && (name === 'page-headings' ? m.list?.scrolls === true : true)
      if (!ok) failed++
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} at ${w}x${h}: ${m.none ? 'NO SHEET' : `box ${m.box.join('..')} ${m.inside ? 'inside' : 'OUTSIDE'} the screen; ${m.tabbar ? 'tab bar' : 'no tab bar'}, ${m.arrows ? 'arrows' : 'no arrows'}; on top at ${pts.map(([k, p]) => `${k} ${p.ok ? 'yes' : `NO (${p.hit} at ${p.at})`}`).join(', ')}${m.list ? `; list ${m.list.rows} rows, ${m.list.scrolls ? 'scrolls' : 'fits'}` : ''}`}  ${file}`)
    }
  }
}
// YAZ-5498: the top bar cuts a long title; its ⋯ menu shows it whole (wrapped, never cut) and the folder, inside the screen.
if (process.env.LAYOUT_SHEETS !== 'no') {
  for (const [w, h] of SIZES.slice(1)) {
    const file = await open('page-menu-title', w, h)
    const m = await evaluate(`(() => {
      const t = document.querySelector('.topbar__title'), menu = document.querySelector('.page-tools__menu'), top = menu && menu.querySelector('.menu-title')
      if (!top) return { none: true, barCut: t.scrollWidth > t.clientWidth }
      const name = top.querySelector('.menu-title__name'), r = menu.getBoundingClientRect()
      return { barCut: t.scrollWidth > t.clientWidth, whole: name.scrollWidth <= name.clientWidth && name.textContent.length > 60, lines: Math.round(name.getBoundingClientRect().height / parseFloat(getComputedStyle(name).lineHeight)), folder: top.querySelector('.menu-title__path')?.textContent, inside: r.left >= 0 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight, box: [Math.round(r.left), Math.round(r.right)] }
    })()`)
    const ok = !m.none && m.barCut && m.whole && m.lines >= 2 && m.folder === 'travel / 2026' && m.inside
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  page-menu-title at ${w}x${h}: ${m.none ? `NO TITLE in the menu (bar cut: ${m.barCut})` : `bar cut ${m.barCut}; the full title ${m.whole ? 'whole' : 'CUT'} on ${m.lines} lines; folder "${m.folder}"; menu ${m.box.join('..')} ${m.inside ? 'inside' : 'OUTSIDE'}`}  ${file}`)
  }
}
// YAZ-5458: the reading look, light and dark, at 375 px: a picture of each screen down the page.
if (process.env.LAYOUT_LOOK !== 'no') {
  for (const scheme of ['light', 'dark'] as const) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }, page)
    const file = await open('page-look', 375, 667)
    const m = await evaluate(`(() => { const s = document.querySelector('.screen--reader'); return { height: s ? s.scrollHeight : 0, view: s ? s.clientHeight : 0, wide: s ? s.scrollWidth > s.clientWidth + 1 : true, blocks: document.querySelectorAll('.reader__body > *').length } })()`)
    const shots: string[] = []
    for (let y = 0, i = 1; y < m.height; y += m.view - 80, i++) {
      await evaluate(`document.querySelector('.screen--reader').scrollTop = ${y}`)
      await wait(150)
      const shot = file.replace('.png', `-${scheme}-${i}.png`)
      writeFileSync(shot, Buffer.from((await send('Page.captureScreenshot', { format: 'png' }, page)).data, 'base64'))
      shots.push(shot)
    }
    const ok = m.blocks > 20 && !m.wide
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  page-look ${scheme} at 375x667: ${m.blocks} blocks, ${m.height}px tall; ${m.wide ? 'SCROLLS SIDEWAYS' : 'no side scroll'}; ${shots.length} pictures  ${shots[0]}`)
  }
  await send('Emulation.setEmulatedMedia', { features: [] }, page)
}
// YAZ-5460: the folder page and its views, light and dark, at 375 px.
const FOLDER_CHECK = `(() => {
  const r = (el) => el.getBoundingClientRect()
  const table = document.querySelector('.folder-table table')
  const board = document.querySelector('.folder-board')
  const narrow = table ? [...table.rows[0].cells].filter((c) => r(c).width < 44).map((c) => c.textContent) : []
  return {
    menu: !!document.querySelector('.hold-menu [role=menu]'),
    page: !!document.querySelector('.folder-page'),
    tabs: document.querySelectorAll('.folder-tabs__tab').length,
    table: !!table,
    pinned: table ? table.getAttribute('data-pin-rows') === '1' && table.getAttribute('data-pin-cols') === '1' : null,
    inBox: table ? !!table.closest('.page-table-box') : null,
    narrow,
    board: board ? { columns: board.children.length, scrolls: board.scrollWidth > board.clientWidth + 1 } : null,
    cards: document.querySelectorAll('.folder-card').length,
    agenda: document.querySelectorAll('.folder-agenda__day').length,
    pageWide: document.scrollingElement.scrollWidth > innerWidth + 1 || [...document.querySelectorAll('.screen, .explore-sheet__body')].some((s) => s.scrollWidth > s.clientWidth + 1),
  }
})()`
if (process.env.LAYOUT_FOLDERS !== 'no') {
  const want: Record<string, (m: any) => boolean> = {
    'folder-hold': (m) => m.menu,
    'folder-page': (m) => m.page && m.tabs === 5 && m.table && m.pinned && m.inBox,
    'folder-table': (m) => m.table && m.pinned && m.inBox && m.narrow.length === 0,
    'folder-grouped': (m) => m.table && m.pinned && m.narrow.length === 0,
    'folder-board': (m) => m.board !== null && m.board.columns === 3 && m.board.scrolls && m.cards === 5,
    'folder-cards': (m) => m.cards === 5,
    'folder-calendar': (m) => m.agenda === 5,
    'folder-sheet': (m) => m.page && m.table,
  }
  for (const scheme of ['light', 'dark'] as const) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }, page)
    for (const [name, check] of Object.entries(want)) {
      const file = await open(name, 375, 667)
      const m = await evaluate(FOLDER_CHECK)
      const ok = check(m) && !m.pageWide
      if (!ok) failed++
      const shot = file.replace('.png', `-${scheme}.png`)
      writeFileSync(shot, Buffer.from((await send('Page.captureScreenshot', { format: 'png' }, page)).data, 'base64'))
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${scheme} at 375x667: ${JSON.stringify(m)}  ${shot}`)
    }
  }
  await send('Emulation.setEmulatedMedia', { features: [] }, page)
}
// YAZ-5506: sticky folders in Search's tree (`search-sticky`: nine folders deep, scrolled to the deepest pages).
const STICKY = `(() => {
  const r = (el) => el.getBoundingClientRect()
  const screen = document.querySelector('.screen')
  const top = r(screen).top + screen.clientTop
  const stuck = [...document.querySelectorAll('.tree__stuck .tree__row--stuck')].sort((a, b) => r(a).top - r(b).top)
  const h = r(document.querySelector('.tree > li')).height
  const label = (el) => el.querySelector('.tree__label')?.textContent
  const style = (el) => getComputedStyle(el)
  return {
    names: stuck.map(label),
    tops: stuck.map((el) => Math.round(r(el).top - top)),
    h, view: screen.clientHeight,
    depths: stuck.map((el) => Number(el.style.getPropertyValue('--tree-depth'))),
    z: stuck.map((el) => Number(style(el).zIndex)),
    opaque: stuck.every((el) => /^rgb\\(/.test(style(el).backgroundColor)),
    line: stuck.every((el) => style(el).boxShadow.includes('1px')),
    open: stuck.every((el) => el.querySelector('.tree__chevron--open') !== null),
    wide: screen.scrollWidth > screen.clientWidth + 1,
  }
})()`
const STICKY_TAP = `(async () => {
  const r = (el) => el.getBoundingClientRect()
  const screen = document.querySelector('.screen')
  const top = r(screen).top + screen.clientTop
  const stuck = [...document.querySelectorAll('.tree__stuck .tree__row--stuck')].sort((a, b) => r(a).top - r(b).top)
  const pick = stuck[2]
  const name = pick.querySelector('.tree__label').textContent
  pick.querySelector('.tree__label').click()
  await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)))
  const row = [...document.querySelectorAll('.tree > li > .tree__row')].find((b) => b.querySelector('.tree__label')?.textContent === name)
  const h = r(row).height
  return { name, at: Math.round(r(row).top - top), want: Math.round(2 * h), open: row.closest('li').getAttribute('aria-expanded') }
})()`
if (process.env.LAYOUT_STICKY !== 'no') {
  for (const scheme of ['light', 'dark'] as const) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }, page)
    // A fresh load for each scheme: the same URL again would only change the hash, and keep the tapped list.
    await send('Page.navigate', { url: 'about:blank' }, page)
    const file = await open('search-sticky', 375, 667)
    const m = await evaluate(STICKY)
    const shot = file.replace('.png', `-${scheme}.png`)
    writeFileSync(shot, Buffer.from((await send('Page.captureScreenshot', { format: 'png' }, page)).data, 'base64'))
    // The cap: the setting (7), cut to the rows that fit in 40% of the list (the Mac's `stickyCap`).
    const cap = Math.min(7, Math.floor((0.4 * m.view) / m.h))
    const flush = m.tops.every((t: number, i: number) => Math.abs(t - i * m.h) <= 1)
    const ok = m.names.length === cap && flush && m.depths.every((d: number, i: number) => d === i) && m.z.every((z: number, i: number) => i === 0 || z < m.z[i - 1]) && m.opaque && m.line && m.open && !m.wide
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  search-sticky ${scheme} at 375x667: ${m.names.length} stuck (cap ${cap}: 7 levels, ${Math.round(m.view)}px list): ${m.names.join(' / ')}; tops ${m.tops.join(',')} (row ${m.h}px); ${m.opaque ? 'opaque' : 'SEE-THROUGH'}, ${m.line ? 'line under' : 'NO LINE'}, ${m.open ? 'open chevrons' : 'CLOSED CHEVRON'}; ${m.wide ? 'SCROLLS SIDEWAYS' : 'no side scroll'}  ${shot}`)
    if (scheme === 'light') {
      const t = await evaluate(STICKY_TAP)
      const tapOk = Math.abs(t.at - t.want) <= 1 && t.open === 'true'
      if (!tapOk) failed++
      writeFileSync(file.replace('.png', '-tapped.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' }, page)).data, 'base64'))
      console.log(`${tapOk ? 'PASS' : 'FAIL'}  search-sticky tap on the stuck "${t.name}": its row at ${t.at}px (under the 2 rows stuck above it: ${t.want}px), still ${t.open === 'true' ? 'open' : 'CLOSED'}`)
    }
  }
  await send('Emulation.setEmulatedMedia', { features: [] }, page)
}
// YAZ-5507: the guide lines (`search-lines`: a finger on the list, three folders stuck).
const LINES = `(() => {
  const r = (el) => el.getBoundingClientRect()
  const rows = [...document.querySelectorAll('ul.tree > li > .tree__row')]
  const deep = rows.find((b) => b.querySelector('.tree__label')?.textContent === 'Seville note 1')
  const line = getComputedStyle(deep, '::before')
  const shown = Number(line.opacity) === 1
  // Each level's line, at the centre of the chevron of that level's folder.
  const left = r(deep).left + parseFloat(line.left)
  const chevrons = ['Atlas', 'Europe', 'Spain', 'Andalusia'].map((n) => rows.find((b) => b.querySelector('.tree__label')?.textContent === n).querySelector('.tree__chevron')).map((c) => r(c).left + r(c).width / 2)
  const lines = chevrons.map((_, k) => left + 14 * k + 0.5)
  const centred = chevrons.every((c, k) => Math.abs(c - lines[k]) <= 1)
  // Over a stuck row, at a line's x, the stuck row is on top.
  const stuck = [...document.querySelectorAll('.tree__row--stuck')]
  const covered = stuck.length > 0 && stuck.every((s) => { const y = r(s).top + r(s).height / 2; return document.elementFromPoint(lines[0], y)?.closest('.tree__stuck') !== null })
  return { shown, centred, covered, stuck: stuck.length, color: line.backgroundImage.slice(0, 60), chevrons: chevrons.map(Math.round), lines: lines.map(Math.round) }
})()`
if (process.env.LAYOUT_LINES !== 'no') {
  for (const scheme of ['light', 'dark'] as const) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }, page)
    await send('Page.navigate', { url: 'about:blank' }, page)
    const file = await open('search-lines', 375, 667)
    const m = await evaluate(LINES)
    const shot = file.replace('.png', `-${scheme}.png`)
    writeFileSync(shot, Buffer.from((await send('Page.captureScreenshot', { format: 'png' }, page)).data, 'base64'))
    const ok = m.shown && m.centred && m.covered
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  search-lines ${scheme} at 375x667: lines ${m.shown ? 'show' : 'HIDDEN'} with a finger on the list; at x ${m.lines.join(',')}, the chevrons at ${m.chevrons.join(',')} (${m.centred ? 'centred' : 'OFF CENTRE'}); ${m.stuck} stuck rows ${m.covered ? 'cover them' : 'DO NOT COVER them'}  ${shot}`)
  }
  await send('Emulation.setEmulatedMedia', { features: [] }, page)
}
// YAZ-5508: the card strip, light and dark, at 375 px: closed, then Reviews open; a page's card and embed with theirs.
const STRIP_CHECK = `(() => {
  const s = document.querySelector('.card-view .phone-strip, .reader__body .phone-strip')
  if (!s) return { error: 'no strip' }
  const screen = document.querySelector('.screen--reader')
  const r = (el) => el.getBoundingClientRect()
  const toggles = [...s.querySelectorAll('.card-reviews__toggle')]
  const drawer = s.querySelector('.phone-strip__drawer')
  return {
    tabs: toggles.map((b) => b.textContent),
    short: toggles.filter((b) => r(b).height < 44 || r(b).width < 44).map((b) => b.textContent),
    outside: toggles.filter((b) => r(b).right > innerWidth + 0.5 || r(b).left < -0.5).map((b) => b.textContent),
    drawer: Math.round(r(drawer).height),
    rows: s.querySelectorAll('.card-view__table tbody tr').length,
    wide: screen ? screen.scrollWidth > screen.clientWidth + 1 : true,
  }
})()`
if (process.env.LAYOUT_STRIP !== 'no') {
  for (const scheme of ['light', 'dark'] as const) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }, page)
    const file = await open('card-strip', 375, 667)
    await evaluate(`document.querySelector('.card-view .phone-strip').scrollIntoView({ block: 'center' })`)
    await wait(200)
    const closed = await evaluate(STRIP_CHECK)
    const shot = file.replace('.png', `-${scheme}.png`)
    writeFileSync(shot, Buffer.from((await send('Page.captureScreenshot', { format: 'png' }, page)).data, 'base64'))
    await evaluate(`document.querySelector('.card-view .card-reviews__toggle[data-part="reviews"]').click()`)
    await wait(500)
    await evaluate(`document.querySelector('.card-view .phone-strip').scrollIntoView({ block: 'center' })`)
    await wait(200)
    const opened = await evaluate(STRIP_CHECK)
    writeFileSync(shot.replace('.png', '-open.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' }, page)).data, 'base64'))
    const ok = closed.error === undefined && closed.drawer === 0 && closed.rows === 0 && closed.short.length === 0 && closed.outside.length === 0 && !closed.wide && opened.drawer > 100 && opened.rows === 4 && !opened.wide
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  card-strip ${scheme} at 375x667: ${JSON.stringify(closed.tabs)}; closed drawer ${closed.drawer}px; short taps ${closed.short.length === 0 ? 'none' : closed.short.join(',')}; off screen ${closed.outside.length === 0 ? 'none' : closed.outside.join(',')}; open: ${opened.rows} rows, ${opened.drawer}px; ${closed.wide || opened.wide ? 'SCROLLS SIDEWAYS' : 'no side scroll'}  ${shot}`)
    const pageFile = await open('page-card-strip', 375, 667)
    const inPage = await evaluate(STRIP_CHECK)
    const pageShot = pageFile.replace('.png', `-${scheme}.png`)
    writeFileSync(pageShot, Buffer.from((await send('Page.captureScreenshot', { format: 'png' }, page)).data, 'base64'))
    const pageOk = inPage.error === undefined && inPage.drawer === 0 && inPage.short.length === 0 && !inPage.wide
    if (!pageOk) failed++
    console.log(`${pageOk ? 'PASS' : 'FAIL'}  page-card-strip ${scheme} at 375x667: ${JSON.stringify(inPage.tabs)}; closed drawer ${inPage.drawer}px; ${inPage.wide ? 'SCROLLS SIDEWAYS' : 'no side scroll'}  ${pageShot}`)
  }
  await send('Emulation.setEmulatedMedia', { features: [] }, page)
}
// YAZ-5511: the comment count of a card file, light and dark, at 375 px: on the screen, above the card (not under it),
// a 44 px tap whose centre is the count; a tap brings the comments (under the card and its strip) up, under the top bar
// (to the top, or as far as the view scrolls: a short view ends first).
const COUNT_CHECK = `(() => {
  const count = document.querySelector('.card-view .comments-count')
  if (!count) return { error: 'no count' }
  const card = document.querySelector('.card-view .card-view__card')
  const r = count.getBoundingClientRect()
  const c = card.getBoundingClientRect()
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
  return { text: count.textContent, rect: [r.left, r.top, r.right, r.bottom].map(Math.round), onScreen: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, tap: r.height >= 44 && r.width >= 44, hit: hit !== null && hit.closest('.comments-count') === count, overCard: r.bottom > c.top + 0.5 }
})()`
if (process.env.LAYOUT_COUNT !== 'no') {
  for (const scheme of ['light', 'dark'] as const) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }, page)
    const file = await open('card-strip', 375, 667)
    const shot = file.replace('.png', `-count-${scheme}.png`)
    writeFileSync(shot, Buffer.from((await send('Page.captureScreenshot', { format: 'png' }, page)).data, 'base64'))
    const m = await evaluate(COUNT_CHECK)
    await evaluate(`document.querySelector('.card-view .comments-count').click()`)
    await wait(800)
    const went = await evaluate(`(() => { const s = document.querySelector('.card-view .page-comments').getBoundingClientRect(); const top = document.querySelector('.topbar').getBoundingClientRect().bottom; return Math.round(s.top - top) })()`)
    writeFileSync(shot.replace('.png', '-tapped.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' }, page)).data, 'base64'))
    const ok = m.error === undefined && m.text === '2' && m.onScreen && m.tap && m.hit && !m.overCard && went >= 0 && went <= 667 / 3
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  card-strip count ${scheme} at 375x667: "${m.text}" at ${m.rect?.join(',')}; ${m.onScreen ? 'on screen' : 'OFF SCREEN'}; ${m.tap ? '44px tap' : 'TAP TOO SMALL'}; its centre ${m.hit ? 'is the count' : 'IS COVERED'}; ${m.overCard ? 'OVER THE CARD' : 'above the card'}; a tap: the comments ${went}px under the top bar  ${shot}`)
  }
  await send('Emulation.setEmulatedMedia', { features: [] }, page)
}
// YAZ-5519 S2: a link to a heading of another page (`[[Spanish words#Places]]`, `#fixture=page-links`) lands with the
// heading whole under the top bar, a small gap between (the page's H1 repeats its title, so the reader's title hides).
const HEADING_LANDED = `(() => {
  const bar = document.querySelector('.topbar').getBoundingClientRect().bottom
  const h = [...document.querySelectorAll('.reader__body h2')].find((x) => x.textContent.trim() === 'Places')
  return h ? { top: Math.round(h.getBoundingClientRect().top), bar: Math.round(bar) } : { error: 'no heading' }
})()`
if (process.env.LAYOUT_HEADING !== 'no') {
  for (const [w, h] of [[320, 568], [375, 667]] as const) {
    const file = await open('page-links', w, h)
    await evaluate(`[...document.querySelectorAll('.reader__body a')].find((a) => a.textContent === 'Spanish words > Places').click()`)
    for (let i = 0; i < 40 && (await evaluate(`document.querySelector('.topbar__title')?.textContent`)) !== 'Spanish words'; i++) await wait(100)
    await wait(1200)
    const m = await evaluate(HEADING_LANDED)
    const shot = file.replace('.png', '-heading.png')
    writeFileSync(shot, Buffer.from((await send('Page.captureScreenshot', { format: 'png' }, page)).data, 'base64'))
    const ok = m.error === undefined && m.top >= m.bar + 8 && m.top <= m.bar + 48
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  page-links heading at ${w}x${h}: "Places" top at ${m.top}, the top bar ends at ${m.bar} (${m.top - m.bar}px under it)  ${shot}`)
  }
}
// YAZ-5519 S3: the top bar of a page with an ID chip at 320, 375 and 430 px (`#fixture=page` "Spanish words" DEMO-1;
// `page-long-id`: a long title, the ID GARDN-1234567): every control inside the screen, the dot clear of the ⚙, the ⚙
// whole; the title gives room first (cut with "…"), then the chip's letters; the chip's number always shows.
const TOPBAR_FITS = `(() => {
  const bar = document.querySelector('.topbar')
  const box = (el) => el ? el.getBoundingClientRect() : null
  const parts = { back: '.back', kind: '.topbar__kind', title: '.topbar__title', chip: '.page-id', tools: '.page-tools', dot: '.sync-status', gear: '.topbar__gear' }
  const at = {}
  for (const [k, s] of Object.entries(parts)) { const b = box(bar.querySelector(s)); at[k] = b ? [Math.round(b.left), Math.round(b.right)] : null }
  const noId = bar.querySelector('.page-id') === null
  const inside = Object.entries(at).every(([k, v]) => (v === null ? k === 'chip' && noId : v[0] >= -0.5 && v[1] <= innerWidth + 0.5))
  const range = document.createRange()
  range.selectNodeContents(bar.querySelector('.topbar__gear'))
  const gear = range.getBoundingClientRect()
  const dot = box(bar.querySelector('.sync-dot'))
  const pill = box(bar.querySelector('.page-id__pill'))
  const numberEl = bar.querySelector('.page-id__number')
  const number = numberEl && numberEl.scrollWidth <= numberEl.clientWidth ? box(numberEl) : null
  const title = bar.querySelector('.topbar__title')
  const words = [...bar.querySelectorAll('.sync-status__words')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.textContent).join('|')
  return { words, at, inside, clear: dot.right <= gear.left && gear.right <= innerWidth, number: noId || (number !== null && number.left >= pill.left - 0.5 && number.right <= pill.right + 0.5), titleWidth: Math.round(title.getBoundingClientRect().width), titleCut: title.scrollWidth > title.clientWidth, sideways: document.scrollingElement.scrollWidth > innerWidth }
})()`
if (process.env.LAYOUT_TOPBAR !== 'no') {
  // YAZ-5521 (sweep2 S-B): also with the dot amber, one comment not sent or two waiting, at 390 too:
  // topBar_allControlsInsideViewport_withDotWords_1notSent_and_Nwaiting.
  for (const [w, h] of [[320, 568], [375, 667], [390, 844], [430, 932]] as const) {
    // YAZ-5524 (sweep3 S-1): topBar_allControlsInsideViewport_pageWithoutId_withWaitingWords: a page with NO ID chip and
    // a long title, "1 comment waiting · no signal", "2 waiting · no signal", 2 comments waiting, 1 not sent; and S-2's
    // "1 not sent · 2 waiting" with and without the chip.
    for (const name of ['page', 'page-long-id', 'page-not-sent', 'page-waiting', 'page-long-id-not-sent', 'page-long-id-waiting', 'page-no-id', 'page-no-id-waiting1-offline', 'page-no-id-waiting2-offline', 'page-no-id-waiting', 'page-no-id-not-sent', 'page-no-id-mixed-offline', 'page-mixed-offline']) {
      const file = await open(name, w, h)
      const m = await evaluate(TOPBAR_FITS)
      const ok = m.inside && m.clear && m.number && m.titleWidth >= 30 && !m.sideways
      if (!ok) failed++
      console.log(`${ok ? 'PASS' : 'FAIL'}  top bar ${name} at ${w}x${h}: ${Object.entries(m.at).map(([k, v]) => `${k} ${v ? (v as number[]).join('-') : 'NONE'}`).join(', ')}; ${m.inside ? 'all inside' : 'OFF SCREEN'}; the dot ${m.clear ? 'clear of the ⚙' : 'UNDER THE ⚙ (or the ⚙ cut)'}; the ID's number ${m.number ? 'shows' : 'IS CUT'}; the title ${m.titleWidth}px${m.titleCut ? ', cut with …' : ''}; the dot says "${m.words}"  ${file}`)
    }
  }
}
// YAZ-5521 (sweep2 S-C): discardAsk_wrapsLongWords_buttonsInsideViewport. The dot's sheet (`#fixture=page-not-sent`:
// one comment not sent, holding a long URL), Discard tapped: the ask wraps its words, every button is inside the screen.
const DISCARD_ASK = `(() => {
  const ask = document.querySelector('.status-sheet .confirm')
  if (!ask) return { error: 'no ask' }
  const box = (el) => { const b = el.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.right)] }
  const buttons = [...ask.querySelectorAll('button')].map(box)
  const q = ask.querySelector('.confirm__question')
  return { ask: box(ask), question: box(q), buttons, inside: [box(ask), box(q), ...buttons].every(([l, r]) => l >= -0.5 && r <= innerWidth + 0.5), wraps: q.scrollWidth <= q.clientWidth + 1, sideways: document.scrollingElement.scrollWidth > innerWidth }
})()`
if (process.env.LAYOUT_DISCARD !== 'no') {
  for (const [w, h] of [[320, 568], [375, 667], [390, 844]] as const) {
    const file = await open('page-not-sent', w, h)
    await evaluate(`document.querySelector('.sync-status').click()`)
    for (let i = 0; i < 30 && (await evaluate(`document.querySelector('.status-sheet .not-sent .discard-answer') !== null`)) !== true; i++) await wait(100)
    await evaluate(`document.querySelector('.status-sheet .not-sent .discard-answer').click()`)
    await wait(400)
    const m = await evaluate(DISCARD_ASK)
    const shot = file.replace('.png', '-discard-ask.png')
    writeFileSync(shot, Buffer.from((await send('Page.captureScreenshot', { format: 'png' }, page)).data, 'base64'))
    const ok = m.error === undefined && m.inside && m.wraps && !m.sideways
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  discard ask (a long URL) at ${w}x${h}: ${m.error ?? `ask ${m.ask.join('-')}, question ${m.question.join('-')}, buttons ${m.buttons.map((b: number[]) => b.join('-')).join(', ')}; ${m.inside ? 'all inside' : 'OFF SCREEN'}; the words ${m.wraps ? 'wrap' : 'DO NOT WRAP'}; page ${m.sideways ? 'SCROLLS SIDEWAYS' : 'stays'}`}  ${shot}`)
  }
}
// YAZ-5519 S6: a page card's ⋯ low on the screen (`#fixture=page-card-menu`, the third card, unscrolled) opens its menu
// inside the screen, above the page arrows and the tab bar (upward); its first row is on top where a finger taps it.
// YAZ-5527: the card view's card ⋯: the last thing in the head, inside the card box at its right (its 44 px tap may
// reach a few px over the card's top edge, as a page card's: the head is shorter than a tap), a 44 px tap.
const CARD_VIEW_MORE = `(() => {
  const b = document.querySelector('.card-view__card .card__head .card__more')
  if (!b) return { error: 'no card ⋯' }
  const head = b.closest('.card__head')
  const card = b.closest('.card-view__card').getBoundingClientRect()
  const r = b.getBoundingClientRect()
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
  return { last: head.lastElementChild === b.parentElement, inCard: r.left >= card.left - 0.5 && r.right <= card.right + 0.5 && r.top + r.height / 2 > card.top && r.top >= card.top - 8, rightGap: Math.round(card.right - r.right), tap: r.width >= 44 && r.height >= 44, hit: hit === b }
})()`
const CARD_MENU_PLACE = `(() => {
  const m = document.querySelector('.card-menu')
  if (!m) return { error: 'no menu' }
  const r = m.getBoundingClientRect()
  const s = document.querySelector('.screen').getBoundingClientRect()
  const row = m.querySelector('[role=menuitem]').getBoundingClientRect()
  const hit = document.elementFromPoint(row.left + 20, row.top + row.height / 2)
  return { top: Math.round(r.top), bottom: Math.round(r.bottom), screenTop: Math.round(s.top), screenBottom: Math.round(s.bottom), place: m.dataset.place ?? 'down', hit: hit !== null && hit.closest('.card-menu') === m }
})()`
if (process.env.LAYOUT_CARD_MENU !== 'no') {
  for (const [w, h] of [[375, 667], [430, 932]] as const) {
    const file = await open('page-card-menu', w, h)
    await evaluate(`document.querySelector('[aria-label="Card actions: River of Vienna"]').click()`)
    for (let i = 0; i < 30 && (await evaluate(`document.querySelector('.card-menu [data-action="off"]:not(:disabled)') !== null`)) !== true; i++) await wait(100)
    await wait(300)
    const m = await evaluate(CARD_MENU_PLACE)
    const shot = file.replace('.png', '-low-card.png')
    writeFileSync(shot, Buffer.from((await send('Page.captureScreenshot', { format: 'png' }, page)).data, 'base64'))
    const ok = m.error === undefined && m.top >= m.screenTop - 0.5 && m.bottom <= m.screenBottom + 0.5 && m.hit
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  page-card-menu third card at ${w}x${h}: menu ${m.top}-${m.bottom} (${m.place}), the screen ${m.screenTop}-${m.screenBottom}; its first row ${m.hit ? 'is on top' : 'IS COVERED'}  ${shot}`)
  }  // YAZ-5527: a card file's view (`#fixture=card-menu`), light and dark, at 375 px: the card's own ⋯ at the right of its
  // head (inside the card, a 44 px tap, its centre the ⋯ itself), its menu open (Archive card armed) inside the screen
  // with its first row on top; the top bar's ⋯ has Find in card and no card action.
  for (const scheme of ['light', 'dark'] as const) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }, page)
    const file = await open('card-menu', 375, 667)
    const more = await evaluate(CARD_VIEW_MORE)
    const m = await evaluate(CARD_MENU_PLACE)
    const shot = file.replace('.png', `-${scheme}.png`)
    writeFileSync(shot, Buffer.from((await send('Page.captureScreenshot', { format: 'png' }, page)).data, 'base64'))
    await evaluate(`document.querySelector('.card-view__card .card__more').click()`)
    await wait(200)
    await evaluate(`document.querySelector('[aria-label="Card tools"]').click()`)
    await wait(300)
    const bar = await evaluate(`(() => { const t = document.querySelector('.page-tools__menu'); return t ? { rows: [...t.querySelectorAll('[role=menuitem]')].map((b) => b.textContent.trim()), actions: document.querySelectorAll('[data-action]').length } : { error: 'no top bar menu' } })()`)
    writeFileSync(shot.replace('.png', '-top-bar.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' }, page)).data, 'base64'))
    const ok = more.error === undefined && more.last && more.inCard && more.tap && more.hit && more.rightGap <= 8 && m.error === undefined && m.top >= m.screenTop - 0.5 && m.bottom <= m.screenBottom + 0.5 && m.hit && bar.error === undefined && bar.actions === 0 && bar.rows.length === 1 && /Find in card/.test(bar.rows[0])
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  card-menu ${scheme} at 375x667: the card ⋯ ${more.last ? 'last in the head' : 'NOT LAST IN THE HEAD'}, ${more.inCard ? 'in the card' : 'OUTSIDE THE CARD'}, ${more.rightGap}px from its right, ${more.tap ? '44px tap' : 'TAP TOO SMALL'}, ${more.hit ? 'its centre the ⋯' : 'COVERED'}; menu ${m.top}-${m.bottom}, the screen ${m.screenTop}-${m.screenBottom}, first row ${m.hit ? 'on top' : 'COVERED'}; top bar ⋯ ${JSON.stringify(bar.rows)}, ${bar.actions} card actions  ${shot}`)
  }
  await send('Emulation.setEmulatedMedia', { features: [] }, page)
}
chrome.kill()
server.close()
console.log(failed === 0 ? `\nAll layout checks pass. Pictures: ${out}` : `\n${failed} layout checks FAILED. Pictures: ${out}`)
process.exit(failed === 0 ? 0 : 1)
