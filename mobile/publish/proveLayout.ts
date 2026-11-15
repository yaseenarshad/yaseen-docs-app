import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, renameSync, writeFileSync } from 'node:fs'
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
 *    full screen, the copy marked too. YAZ-5541 (`page-calendar-next`): the next slot tinted as the now row.
 *  - the task page (`#fixture=page-tasks`, YAZ-5494), light and dark: each box of the page a check box with a 44 px tap
 *    area, a done task struck through.
 *  - numbered tasks (`#fixture=page-tasks-numbered`, YAZ-5510, the Mac's rule), light and dark, at 375 px: for 1. to 11.,
 *    no number, only the box in the number's column (its middle a tap on it, a 44 px tap), then the text; the lines
 *    that wrap under the text.
 *  - the reading look (`#fixture=page-look`, YAZ-5458): every block, light and dark, at 375 px, screen by screen down
 *    the page; the page never scrolls sideways.
 *  - the Headings sheet (`#fixture=page-headings`, `page-headings-few`, `page-headings-alone`, YAZ-5497) at 375×667 and
 *    390×844: the box inside the screen, and on top: `elementFromPoint` at its list's centre, its head and its bottom
 *    finds the sheet itself, and at the page arrows' and the tab bar's place too.
 *  - a page's properties (`#fixture=page-properties`, `page-properties-closed`, `page-properties-title`, YAZ-5529), light
 *    and dark, at 375 px: no edge tab; the Mac's chip at the right of the title, on its first line, a 44 px tap, its own
 *    at its centre; closed: no rows; open: the rows right under the title, in the page's flow (they scroll with it), inside
 *    the column; the page never scrolls sideways.
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
 *    card, each toggle a 44px tap, the bar inside the screen, no due line under it (YAZ-5528); a tap opens Reviews'
 *    drawer to its table and its last line, the due words left and the chance right, inside the drawer (a picture of
 *    each); a page's card and a card embed with theirs; the page never scrolls sideways.
 *  - the comment count of a card file (`#fixture=card-strip`, YAZ-5511), light and dark, at 375 px: on the screen above
 *    the card, a 44 px tap, its centre the count's own; a tap brings the comments under the card up.
 *  - a link to a heading (`#fixture=page-links`, YAZ-5519 S2) at 320 and 375 px: the heading lands whole under the top
 *    bar, a small gap between.
 *  - the top bar of a page with an ID chip (`#fixture=page`, `page-long-id`, YAZ-5519 S3) at 320, 375 and 430 px: every
 *    control inside the screen, the dot clear of the ⚙; the title cut first, then the ID's letters; its number shows.
 *    YAZ-5521: the same with the dot amber (`page-not-sent`, `page-waiting`, and with the long ID), at 390 px too.
 *    YAZ-5524: and a page with NO ID chip (`page-no-id-*`): the words cut down to a count, never the ⚙ off the screen.
 *    YAZ-5556: and a card file (`card-file`, DEMO-40 off its card line) with its chip, the kind and the ⋯ too.
 *  - the Discard ask of a comment not sent, holding a long URL (`#fixture=page-not-sent`, YAZ-5521) at 320, 375 and
 *    390 px: its words wrap, its buttons inside the screen.
 *  - a page card's ⋯ menu low on the screen (`#fixture=page-card-menu`, YAZ-5519 S6) at 375 and 430 px: inside the
 *    screen, above the page arrows and the tab bar; its first row on top.
 *  - a card file's own ⋯ (`#fixture=card-menu`, YAZ-5527), light and dark, at 375 px: at the right of the card's head, a
 *    44 px tap; its menu inside the screen; the top bar's ⋯ holds Find in card and no card action.
 *  - a page card's ⋯ in an Explore panel (`#fixture=sheet-card-menu`, YAZ-5548), light and dark, at 375 px: at the right
 *    of the card's head, a 44 px tap; its menu (Archive card armed) inside the panel, its first row on top.
 *  - the Type filter of Search (`#fixture=search-types`, `search-types-menu`, `search-types-favorites`, YAZ-5534), light and
 *    dark, at 375 px: the bar one line, the pill naming the pick; each menu row a 44 px tap; each row of the types in the
 *    tree under its open parent folders; the page never scrolls sideways.
 *    YAZ-5545: on `search-types`, each drawing and diagram row's icon is the Mac's Material icon, drawn, with its contrast.
 *  - "Linked mentions" at the end of a page (`#fixture=explore-mentions`, `page-linked-from`, YAZ-5535), light and dark, at
 *    375 px: in an Explore panel no foot under the body (the body is the box's last part, to its bottom), the section in
 *    the page's scroll (not sticky: it moves when the body scrolls), collapsed with its count, a 44 px tap inside the
 *    screen; a tap opens it in place, its rows inside the screen; the same section on the full page, open, then closed.
 *  - the Today tab (`#fixture=today-open`, YAZ-5522 N6), light and dark, at 375 px: today's page open, "Today" marked
 *    (`aria-current="page"`) in the selected tab's colour and weight; on the tab bar alone (`today`) it is not.
 *    YAZ-5589: a real tap on Today once the app is idle: the first frame after it shows today's page (its title, its
 *    text, the bars), and no frame shows the empty waiting screen or "Loading".
 *  - a folder's table as the vault's folder-pages.json says (`#fixture=folder-table`, `folder-table-look`, YAZ-5549), light
 *    and dark, at 375 px (in the folder views' part): the row height (Short: the Name cell keeps 44 px; Tall: 68 px),
 *    the `#` numbers, a subfolder's "N inside".
 *  - the finger band (`#fixture=page-table-band`, `page-table-band-full`, `folder-table-band`, YAZ-5532), light and dark
 *    at 375 px: the fixture's band (a finger down and lifted) on every cell of its row, the frozen one too, one colour,
 *    not the page's; then a real touch (the DevTools touch events): down on another row bands it, a move bands the row
 *    under the finger, the lift keeps it; a cell's text selectable (`user-select: text`). A folder table: its Name cells
 *    44 px tall; a tap on another cell only moves the band, a tap on a Name opens the page.
 *  - plain draw.io diagrams (`#fixture=page-diagrams`, YAZ-5533), light and dark, at 320 and 375 px: each diagram drawn
 *    by draw.io's viewer in its frame, its picture inside the page's width, the page picker of a diagram of several
 *    pages inside the screen with a 44 px tap; a pick draws that page; the page never scrolls sideways; a picture of
 *    each box.
 *  - the Explore panel's top (`#fixture=explore-one`, `explore-stack`, YAZ-5540), light and dark, at 375 px, the safe-area inset 0 and
 *    47 px, and on a small phone on its side (667x375, YAZ-5522 N7, side insets 0 and 47 px): each sheet at the inset +
 *    12 px + 8 px a step (on its side too: ~363 px tall), a strip of the dim above, the top sheet's head whole below the inset.
 *  - every menu with a real finger (YAZ-5552) at 375 px: Page tools ⋯, a page card's ⋯, Search's Type chip, an Explore
 *    sheet's ⋯, Review's deck button and ⋯: a tap opens it, a tap on its button again closes it; a tap outside closes it
 *    and does nothing else.
 *  - Settings (`#fixture=settings`, YAZ-5555), light and dark, at 320 and 375 px: the build's line at the top, one line.
 *    YAZ-5559 (`settings-health`): Vault health's line a 44 px tap, its list open, inside the screen.
 * It writes a picture of each case. Run after `npm run build:fixtures -w mobile`:
 * `npx vite-node mobile/publish/proveLayout.ts` (LAYOUT_DIST: another build folder; PROOF_DIR: where the pictures go;
 * LAYOUT_ASKS=no, LAYOUT_PAGES=no, LAYOUT_LOOK=no, LAYOUT_SHEETS=no, LAYOUT_FOLDERS=no, LAYOUT_STICKY=no, LAYOUT_LINES=no, LAYOUT_STRIP=no, LAYOUT_COUNT=no, LAYOUT_HEADING=no, LAYOUT_TOPBAR=no, LAYOUT_CARD_MENU=no, LAYOUT_DISCARD=no, LAYOUT_TODAY=no, LAYOUT_PROPS=no, LAYOUT_TYPES=no, LAYOUT_MENTIONS=no, LAYOUT_BAND=no, LAYOUT_DIAGRAMS=no, LAYOUT_PANEL_TOP=no, LAYOUT_MENUS=no, LAYOUT_SETTINGS=no skip a part).
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
// YAZ-5524: 28 more top-bar cases (pages with no ID chip): the budget grows with them. YAZ-5529: 6 properties cases.
// YAZ-5589: the Today tap's frame check (light and dark).
setTimeout(() => (console.log('TIMEOUT'), process.exit(2)), 480_000).unref()
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
// YAZ-5541: Shade the next time slot (`#fixture=page-calendar-next`: the vault's table-look.json, the now tint with its
// line and the next slot on, the default red), light and dark at 375 px: the row after the now row is tinted exactly as
// the now row (the same paint), the row after it and the past rows are not.
const NEXT_CHECK = `(() => {
  const table = document.querySelector('.reader__body table[data-calendar]')
  if (!table) return { none: true }
  const rows = [...table.rows]
  const paint = (i) => getComputedStyle(rows[i].cells[1]).backgroundImage
  const now = rows.findIndex((row) => row.classList.contains('table-now-row'))
  const next = rows.flatMap((row, i) => (row.classList.contains('table-next-row') ? [i] : []))
  return { now, next, nowPaint: paint(now), nextPaint: next.length ? paint(next[0]) : '', laterPaint: paint(now + 2), pageWide: document.scrollingElement.scrollWidth > innerWidth + 1 }
})()`
if (process.env.LAYOUT_PAGES !== 'no') {
  for (const scheme of ['light', 'dark'] as const) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }, page)
    const file = await open('page-calendar-next', 375, 667)
    const shot = file.replace('.png', `-${scheme}.png`)
    writeFileSync(shot, Buffer.from((await send('Page.captureScreenshot', { format: 'png' }, page)).data, 'base64'))
    const m = await evaluate(NEXT_CHECK)
    const ok = !m.none && m.now === 7 && m.next.join() === '8' && m.nowPaint.includes('gradient') && m.nextPaint === m.nowPaint && !m.laterPaint.includes('color') && !m.pageWide
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  page-calendar-next at 375x667, ${scheme}: ${m.none ? 'NO CALENDAR' : `now row ${m.now}, next row ${m.next.join(',') || 'none'}; next paint ${m.nextPaint === m.nowPaint ? 'the now tint\'s' : `DIFFERS (${m.nextPaint} vs ${m.nowPaint})`}; the row after ${m.laterPaint}; page ${m.pageWide ? 'SCROLLS SIDEWAYS' : 'stays'}`}  ${shot}`)
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
// YAZ-5510 (the Mac's rule: Crepe's `renderLabel`): numbered tasks, light and dark, at 375 px: the number is hidden,
// the box in the number's column (inside the list, ending before the text), the text and each wrapped line where the
// item's text starts; a tap at the box's middle is the box, its tap area 44 px.
const NUMBERED_CHECK = `(() => {
  const items = [...document.querySelectorAll('.reader__body ol > li')].flatMap((li) => {
    const box = li.querySelector(':scope > .page-task, :scope > p:first-child > .page-task')
    if (!box) return []
    const b = box.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(li)
    const lines = [...range.getClientRects()].filter((r) => r.width > 0 && r.left >= b.right - 0.5)
    const n = li.parentElement.start + [...li.parentElement.children].indexOf(li)
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2) === box
    const start = li.getBoundingClientRect().left + parseFloat(getComputedStyle(li).paddingLeft)
    const tap = getComputedStyle(box, '::before')
    return [{ n, shown: getComputedStyle(li).listStyleType !== 'none' && getComputedStyle(li, '::marker').content !== 'none', inList: b.left >= li.parentElement.getBoundingClientRect().left, gap: Math.round((start - b.right) * 10) / 10, lines: lines.length ? Math.round((Math.max(...lines.map((r) => Math.abs(r.left - start)))) * 10) / 10 : null, hit, tap: Math.min(parseFloat(tap.width), parseFloat(tap.height)) }]
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
    const items = m.items as { n: number; shown: boolean; inList: boolean; gap: number; lines: number | null; hit: boolean; tap: number }[]
    const ok = items.map((i) => i.n).join(',') === '1,2,10,11' && items.every((i) => !i.shown && i.inList && i.gap > 0 && i.lines !== null && i.lines <= 0.5 && i.hit && i.tap >= 44) && !m.pageWide
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  page-tasks-numbered at 375x667, ${scheme}: ${items.map((i) => `${i.n} ${i.shown ? 'NUMBER SHOWS ' : 'no number, '}box ${i.inList ? 'in the number column' : 'OUT OF THE LIST'} ${i.gap}px before the text, lines ${i.lines}px off the text start, tap ${i.tap}px${i.hit ? '' : ' (TAP MISSES)'}`).join('; ')}; page ${m.pageWide ? 'SCROLLS SIDEWAYS' : 'stays'}  ${shot}`)
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
  // YAZ-5549: the \`#\` column of row numbers is narrow by design (the Mac's gutter); every other column is a readable width.
  const narrow = table ? [...table.rows[0].cells].filter((c) => !c.classList.contains('folder-table__num') && r(c).width < 44).map((c) => c.textContent) : []
  const numbered = table ? table.querySelector('.folder-table__num') !== null : false
  // YAZ-5549: the row height (the vault's), each body row's height, the Name cells' least height (YAZ-5532: 44), the numbers, the counts.
  const look = table ? {
    rowHeight: Number(table.dataset.rowHeight),
    rows: [...table.tBodies[0].rows].filter((tr) => !tr.classList.contains('folder-table__group')).map((tr) => Math.round(r(tr).height)),
    nameMin: Math.min(...[...table.querySelectorAll('td[data-name]')].map((td) => Math.round(r(td).height))),
    numbers: [...table.querySelectorAll('tbody td.folder-table__num')].map((td) => td.textContent).filter((t) => t !== ''),
    numbersShown: [...table.querySelectorAll('tbody td.folder-table__num')].filter((td) => td.textContent !== '').every((td) => r(td).width > 0 && r(td).right <= innerWidth),
    inside: [...table.querySelectorAll('.folder-inside')].map((el) => el.textContent),
  } : null
  return {
    menu: !!document.querySelector('.hold-menu [role=menu]'),
    page: !!document.querySelector('.folder-page'),
    tabs: document.querySelectorAll('.folder-tabs__tab').length,
    table: !!table,
    pinned: table ? table.getAttribute('data-pin-rows') === '1' && table.getAttribute('data-pin-cols') === (numbered ? '2' : '1') : null,
    numbered,
    look,
    inBox: table ? !!table.closest('.page-table-box') : null,
    narrow,
    board: board ? { columns: board.children.length, scrolls: board.scrollWidth > board.clientWidth + 1 } : null,
    cards: document.querySelectorAll('.folder-card').length,
    agenda: document.querySelectorAll('.folder-agenda__day').length,
    // YAZ-5531: the page in an Explore sheet: the sheet up (its box near the top), its title, text, tabs and table drawn in it.
    sheet: (() => {
      const box = [...document.querySelectorAll('.explore-sheet__box')].at(-1)
      if (!box) return null
      const page = box.querySelector('.folder-page')
      return { top: Math.round(r(box).top), up: r(box).top < innerHeight / 3, title: page?.querySelector('.reader__title')?.textContent ?? null, text: !!page?.querySelector('.folder-page__text')?.textContent?.trim(), tabs: page?.querySelectorAll('.folder-tabs__tab').length ?? 0, table: !!page?.querySelector('.folder-table table') }
    })(),
    pageWide: document.scrollingElement.scrollWidth > innerWidth + 1 || [...document.querySelectorAll('.screen, .explore-sheet__body')].some((s) => s.scrollWidth > s.clientWidth + 1),
  }
})()`
if (process.env.LAYOUT_FOLDERS !== 'no') {
  const want: Record<string, (m: any) => boolean> = {
    'folder-hold': (m) => m.menu,
    'folder-page': (m) => m.page && m.tabs === 5 && m.table && m.pinned && m.inBox,
    // YAZ-5549: no file: Short rows (28 px), numbers on; the Name cell keeps its 44 px, so each row is 44 px.
    'folder-table': (m) => m.table && m.pinned && m.inBox && m.narrow.length === 0 && m.numbered && m.look.rowHeight === 28 && m.look.nameMin >= 44 && m.look.rows.every((h: number) => h >= 44 && h <= 60) && m.look.numbers.join() === '1,2,3,4,5' && m.look.numbersShown && m.look.inside.length === 0,
    // YAZ-5549: the vault says Tall (68 px) and "Pages inside count": each row 68 px, the subfolder's "1 inside".
    'folder-table-look': (m) => m.table && m.pinned && m.inBox && m.narrow.length === 0 && m.numbered && m.look.rowHeight === 68 && m.look.nameMin >= 68 && m.look.rows.every((h: number) => h >= 68) && m.look.numbers.join() === '1,2,3,4,5' && m.look.numbersShown && m.look.inside.join() === '1 inside',
    'folder-grouped': (m) => m.table && m.pinned && m.narrow.length === 0,
    'folder-board': (m) => m.board !== null && m.board.columns === 3 && m.board.scrolls && m.cards === 5,
    'folder-cards': (m) => m.cards === 5,
    'folder-calendar': (m) => m.agenda === 5,
    'folder-sheet': (m) => m.sheet !== null && m.sheet.up && m.sheet.title === 'Projects' && m.sheet.text && m.sheet.tabs === 5 && m.sheet.table,
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
    rows: s.querySelectorAll('.card-view__table tbody tr:not(.card-reviews__next)').length,
    // YAZ-5528: the Reviews drawer's last line (the Mac's): the due words on the left, the chance on the right, inside
    // the drawer; and no due line under the strip.
    next: (() => {
      const line = s.querySelector('.card-view__table tbody tr:last-child.card-reviews__next .card-reviews__next-line')
      if (!line) return null
      const due = line.querySelector('.card-reviews__due')
      const chance = line.querySelector('.card-reviews__chance')
      const box = r(drawer)
      const inside = (el) => el === null || (r(el).left >= box.left - 0.5 && r(el).right <= box.right + 0.5)
      return { due: due?.textContent ?? null, chance: chance?.textContent ?? null, dueLeft: due !== null && Math.abs(r(due).left - r(line).left) < 1, chanceRight: chance === null || Math.abs(r(chance).right - r(line).right) < 1, inside: inside(due) && inside(chance) }
    })(),
    factsLine: document.querySelector('.card-view__facts') !== null,
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
    const n = opened.next
    const nextOk = n !== null && /^Due /.test(n.due ?? '') && /^\d+% chance you remember it$/.test(n.chance ?? '') && n.dueLeft && n.chanceRight && n.inside
    const ok = closed.error === undefined && closed.drawer === 0 && closed.rows === 0 && closed.short.length === 0 && closed.outside.length === 0 && !closed.wide && !closed.factsLine && opened.drawer > 100 && opened.rows === 4 && nextOk && !opened.wide
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  card-strip ${scheme} at 375x667: ${JSON.stringify(closed.tabs)}; closed drawer ${closed.drawer}px; short taps ${closed.short.length === 0 ? 'none' : closed.short.join(',')}; off screen ${closed.outside.length === 0 ? 'none' : closed.outside.join(',')}; ${closed.factsLine ? 'A DUE LINE UNDER THE STRIP' : 'no due line under the strip'}; open: ${opened.rows} rows, ${opened.drawer}px, last line ${n === null ? 'MISSING' : `"${n.due}" ${n.dueLeft ? 'left' : 'NOT LEFT'} / "${n.chance}" ${n.chanceRight ? 'right' : 'NOT RIGHT'}${n.inside ? '' : ' OUTSIDE THE DRAWER'}`}; ${closed.wide || opened.wide ? 'SCROLLS SIDEWAYS' : 'no side scroll'}  ${shot}`)
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
  // YAZ-5522 N3 (kept): the dot's and the ⚙'s tap boxes overlap (the 14 px pull less the bar's gap); a tap on each glyph is its own.
  const dotTap = box(bar.querySelector('.sync-status'))
  const gearTap = box(bar.querySelector('.topbar__gear'))
  const overlap = Math.round(dotTap.right - gearTap.left)
  const hit = (r, sel) => { const el = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2); return el !== null && el.closest(sel) !== null }
  const ownTaps = hit(dot, '.sync-status') && hit(gear, '.topbar__gear')
  // YAZ-5522 N14: what the chip shows: "#N" under 400 px, the whole ID at 400 and wider.
  const prefixEl = bar.querySelector('.page-id__prefix')
  const shown = noId ? null : (prefixEl && getComputedStyle(prefixEl).display !== 'none' ? prefixEl.textContent : '') + (getComputedStyle(numberEl, '::before').content === '"#"' ? '#' : '') + numberEl.textContent
  const words = [...bar.querySelectorAll('.sync-status__words')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.textContent).join('|')
  return { overlap, ownTaps, shown, short: noId || shown === '#' + numberEl.textContent, whole: noId || shown === bar.querySelector('.page-id').getAttribute('aria-label').replace(/\. Copy the path$/, ''), words, at, inside, clear: dot.right <= gear.left && gear.right <= innerWidth, number: noId || (number !== null && number.left >= pill.left - 0.5 && number.right <= pill.right + 0.5), titleWidth: Math.round(title.getBoundingClientRect().width), titleCut: title.scrollWidth > title.clientWidth, sideways: document.scrollingElement.scrollWidth > innerWidth }
})()`
if (process.env.LAYOUT_TOPBAR !== 'no') {
  // YAZ-5521 (sweep2 S-B): also with the dot amber, one comment not sent or two waiting, at 390 too:
  // topBar_allControlsInsideViewport_withDotWords_1notSent_and_Nwaiting.
  for (const [w, h] of [[320, 568], [375, 667], [390, 844], [430, 932]] as const) {
    // YAZ-5524 (sweep3 S-1): topBar_allControlsInsideViewport_pageWithoutId_withWaitingWords: a page with NO ID chip and
    // a long title, "1 comment waiting · no signal", "2 waiting · no signal", 2 comments waiting, 1 not sent; and S-2's
    // "1 not sent · 2 waiting" with and without the chip.
    for (const name of ['page', 'page-long-id', 'page-not-sent', 'page-waiting', 'page-long-id-not-sent', 'page-long-id-waiting', 'page-no-id', 'page-no-id-waiting1-offline', 'page-no-id-waiting2-offline', 'page-no-id-waiting', 'page-no-id-not-sent', 'page-no-id-mixed-offline', 'page-mixed-offline', 'card-file']) {
      const file = await open(name, w, h)
      const m = await evaluate(TOPBAR_FITS)
      const ok = m.inside && m.clear && m.number && m.titleWidth >= 30 && !m.sideways && (w < 400 ? m.short : m.whole) && m.overlap > 0 && m.overlap <= 14 && m.ownTaps
      if (!ok) failed++
      console.log(`${ok ? 'PASS' : 'FAIL'}  top bar ${name} at ${w}x${h}: ${Object.entries(m.at).map(([k, v]) => `${k} ${v ? (v as number[]).join('-') : 'NONE'}`).join(', ')}; ${m.inside ? 'all inside' : 'OFF SCREEN'}; the dot ${m.clear ? 'clear of the ⚙' : 'UNDER THE ⚙ (or the ⚙ cut)'}; tap boxes overlap ${m.overlap}px${m.overlap > 0 && m.overlap <= 14 ? '' : ' (NOT THE PULL)'}, ${m.ownTaps ? 'each glyph taps its own' : 'A GLYPH TAPS THE OTHER'}; the ID's number ${m.number ? 'shows' : 'IS CUT'}${m.shown === null ? '' : ` ("${m.shown}"${(w < 400 ? m.short : m.whole) ? '' : (w < 400 ? ' NOT THE NUMBER ALONE' : ' NOT THE WHOLE ID')})`}; the title ${m.titleWidth}px${m.titleCut ? ', cut with …' : ''}; the dot says "${m.words}"  ${file}`)
    }
  }
}
// YAZ-5522 N6: todayTab_markedWhileTodaysPageIsOpen. The Today tab's look against Search's selected look (`#fixture=today`).
const TODAY_TAB = `(() => {
  const t = document.querySelector('.tabbar__today')
  if (!t) return { error: 'no Today' }
  const s = getComputedStyle(t)
  return { current: t.getAttribute('aria-current'), color: s.color, weight: s.fontWeight, page: document.querySelector('.screen--reader') !== null }
})()`
const SELECTED_TAB = `(() => { const s = getComputedStyle(document.querySelector('.tabbar__tab[aria-selected="true"]')); return { color: s.color, weight: s.fontWeight } })()`
if (process.env.LAYOUT_TODAY !== 'no') {
  for (const scheme of ['light', 'dark'] as const) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }, page)
    const barFile = await open('today', 375, 667)
    const bar = await evaluate(TODAY_TAB)
    const selected = await evaluate(SELECTED_TAB)
    const file = await open('today-open', 375, 667)
    const m = await evaluate(TODAY_TAB)
    const shot = file.replace('.png', `-${scheme}.png`)
    writeFileSync(shot, Buffer.from((await send('Page.captureScreenshot', { format: 'png' }, page)).data, 'base64'))
    const ok = bar.error === undefined && bar.current === null && bar.color !== selected.color && m.error === undefined && m.page && m.current === 'page' && m.color === selected.color && m.weight === selected.weight
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  Today tab ${scheme} at 375x667: on Search ${bar.current === null ? 'not marked' : 'MARKED'} (${bar.color}); today's page open: ${m.current === 'page' ? 'marked' : 'NOT MARKED'}, ${m.color} ${m.weight} (the selected tab: ${selected.color} ${selected.weight})  ${barFile} ${shot}`)
  }
  // YAZ-5589: todayTab_firstFrameAfterTheTap_showsThePage. On the tab bar (`#fixture=today`), once the app is idle (the
  // button's read ahead: `data-ahead="ready"`), a real tap: the FIRST frame drawn after it already shows today's page,
  // its title in the top bar, its text, the bars; never the empty waiting screen (`aria-busy`) or "Loading".
  const todayTitle = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const FRAMES = `(() => {
    const frames = []
    let t0 = null
    addEventListener('click', () => { t0 = performance.now() }, { capture: true, once: true })
    const snap = () => ({
      t: Math.round(performance.now() - t0),
      title: document.querySelector('.topbar__title')?.textContent ?? null,
      body: (document.querySelector('.reader__body')?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 40),
      bars: document.querySelector('.topbar') !== null && document.querySelector('.tabbar') !== null,
      busy: document.querySelector('[aria-busy="true"]')?.className ?? null,
      loading: /Loading/.test(document.body.innerText),
    })
    const tick = () => {
      if (t0 !== null) frames.push(snap())
      if (t0 === null || performance.now() - t0 < 600) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    window.__todayFrames = frames
  })()`
  for (const scheme of ['light', 'dark'] as const) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }, page)
    const file = await open('today', 375, 667)
    for (let i = 0; i < 50 && (await evaluate(`document.querySelector('.tabbar__today')?.dataset.ahead`)) !== 'ready'; i++) await wait(100)
    const ahead = await evaluate(`document.querySelector('.tabbar__today')?.dataset.ahead ?? null`)
    await evaluate(FRAMES)
    const at = await evaluate(`(() => { const b = document.querySelector('.tabbar__today').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 } })()`)
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', clickCount: 1 }, page)
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', clickCount: 1 }, page)
    await wait(800)
    const frames = (await evaluate('window.__todayFrames')) as { t: number; title: string | null; body: string; bars: boolean; busy: string | null; loading: boolean }[]
    const shot = file.replace('.png', `-tap-${scheme}.png`)
    writeFileSync(shot, Buffer.from((await send('Page.captureScreenshot', { format: 'png' }, page)).data, 'base64'))
    const first = frames[0]
    const ok = ahead === 'ready' && first !== undefined && first.title === todayTitle && first.body.length > 0 && first.bars && first.busy === null && !first.loading && frames.every((f) => f.busy === null && !f.loading && f.bars)
    if (!ok) failed++
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  Today tap ${scheme} at 375x667: read ahead ${ahead ?? 'NOT DONE'}; the first frame after the tap (+${first?.t ?? '?'} ms): title "${first?.title}"${first?.title === todayTitle ? '' : ` (NOT "${todayTitle}")`}, text "${first?.body}", ${first?.bars ? 'bars' : 'NO BARS'}${first?.busy ? `, WAITING (${first.busy})` : ''}${first?.loading ? ', LOADING TEXT' : ''}; ${frames.length} frames, ${frames.some((f) => f.busy !== null || f.loading || !f.bars) ? 'A WAITING OR EMPTY FRAME' : 'none waiting or empty'}  ${shot}`,
    )
  }
  await send('Emulation.setEmulatedMedia', { features: [] }, page)
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
  // YAZ-5548: a page card's ⋯ in an Explore panel (`#fixture=sheet-card-menu`), light and dark, at 375 px: at the right of
  // its head (inside the card, a 44 px tap, its centre the ⋯ itself); its menu open (Archive card armed) inside the panel's
  // scroller, its first row on top.
  for (const scheme of ['light', 'dark'] as const) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }, page)
    const file = await open('sheet-card-menu', 375, 667)
    const m = await evaluate(`(() => {
      const b = document.querySelector('.explore-sheet .page-card .card__head .card__more')
      const menu = document.querySelector('.explore-sheet .card-menu')
      if (!b || !menu) return { error: b ? 'no menu' : 'no card ⋯' }
      const card = b.closest('.page-card').getBoundingClientRect()
      const r = b.getBoundingClientRect()
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      const s = document.querySelector('.explore-sheet__body').getBoundingClientRect()
      const box = menu.getBoundingClientRect()
      const row = menu.querySelector('[role=menuitem]').getBoundingClientRect()
      const first = document.elementFromPoint(row.left + 20, row.top + row.height / 2)
      return {
        last: b.closest('.card__head').lastElementChild === b.parentElement,
        inCard: r.left >= card.left - 0.5 && r.right <= card.right + 0.5 && r.top >= card.top - 8,
        tap: r.width >= 44 && r.height >= 44,
        hit: hit === b || hit?.closest('.card-menu') === menu,
        armed: menu.querySelector('[data-action="off"]')?.textContent.trim(),
        rows: [...menu.querySelectorAll('[role=menuitem]')].map((x) => x.dataset.action),
        top: Math.round(box.top), bottom: Math.round(box.bottom), sheetTop: Math.round(s.top), sheetBottom: Math.round(s.bottom),
        first: first !== null && first.closest('.card-menu') === menu,
      }
    })()`)
    const shot = file.replace('.png', `-${scheme}.png`)
    writeFileSync(shot, Buffer.from((await send('Page.captureScreenshot', { format: 'png' }, page)).data, 'base64'))
    const ok = m.error === undefined && m.last && m.inCard && m.tap && m.hit && m.armed === 'Tap again to archive' && m.top >= m.sheetTop - 0.5 && m.bottom <= m.sheetBottom + 0.5 && m.first
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  sheet-card-menu ${scheme} at 375x667: ${JSON.stringify(m)}  ${shot}`)
  }
  await send('Emulation.setEmulatedMedia', { features: [] }, page)
}
// YAZ-5529: a page's properties, light and dark, at 375 px. The Mac's chip at the right of the title (the reader's, or the
// page's own heading when that says the title), on its first line, a 44 px tap whose centre is its own; no edge tab. Open,
// the rows right under the title, in the page's flow: a scroll of the page moves them with it.
const PROPS_CHECK = `(() => {
  const r = (el) => el.getBoundingClientRect()
  const chip = document.querySelector('.page-props')
  if (!chip) return { error: 'no chip' }
  const title = document.querySelector('.reader__title:not(.reader__title--same)') || document.querySelector('.reader__body > h1')
  const range = document.createRange()
  range.selectNodeContents(title)
  const line = range.getClientRects()[0]
  const c = r(chip), t = r(title), col = r(document.querySelector('.reader'))
  const hit = document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2)
  const body = document.querySelector('.page-props__body')
  const screen = document.querySelector('.screen--reader')
  let rows = null
  if (body) {
    const b = r(body), before = b.top
    screen.scrollTop = 60
    const moved = Math.round(before - r(body).top)
    screen.scrollTop = 0
    rows = { n: body.querySelectorAll('.props__row').length, gap: Math.round(b.top - t.bottom), inColumn: b.left >= col.left - 0.5 && b.right <= col.right + 0.5, position: getComputedStyle(body).position, moved, next: (body.parentElement.classList.contains('page-props__slot') ? body.parentElement : body).nextElementSibling?.className || '' }
  }
  return {
    title: title.tagName + ' ' + title.textContent.trim(),
    rect: [c.left, c.top, c.right, c.bottom].map(Math.round),
    tap: c.width >= 44 && c.height >= 44,
    right: c.left >= line.right - 0.5 && c.right <= col.right + 8.5 && c.right <= innerWidth,
    onLine: Math.abs((c.top + c.bottom) / 2 - (line.top + line.bottom) / 2) <= 8,
    hit: hit !== null && hit.closest('.page-props') === chip,
    expanded: chip.getAttribute('aria-expanded'),
    edgeTab: document.querySelector('.props-tab, .props__panel') !== null,
    rows,
    wide: screen.scrollWidth > screen.clientWidth + 1,
  }
})()`
if (process.env.LAYOUT_PROPS !== 'no') {
  for (const scheme of ['light', 'dark'] as const) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }, page)
    for (const name of ['page-properties-closed', 'page-properties', 'page-properties-title'] as const) {
      const file = await open(name, 375, 667)
      const m = await evaluate(PROPS_CHECK)
      const shot = file.replace('.png', `-${scheme}.png`)
      writeFileSync(shot, Buffer.from((await send('Page.captureScreenshot', { format: 'png' }, page)).data, 'base64'))
      const open_ = name !== 'page-properties-closed'
      const rowsOk = open_ ? m.rows !== null && m.rows.n === 11 && m.rows.gap >= -0.5 && m.rows.gap <= 16 && m.rows.inColumn && m.rows.position === 'static' && m.rows.moved === 60 && /reader__body|^$/.test(m.rows.next) : m.rows === null
      const ok = m.error === undefined && m.tap && m.right && m.onLine && m.hit && !m.edgeTab && m.expanded === String(open_) && rowsOk && !m.wide
      if (!ok) failed++
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${scheme} at 375x667: ${m.error ?? `title ${m.title}; chip ${m.rect.join(',')} ${m.tap ? '44px tap' : 'TAP TOO SMALL'}, ${m.right ? 'right of the title' : 'NOT RIGHT OF THE TITLE'}, ${m.onLine ? 'on its line' : 'OFF ITS LINE'}, ${m.hit ? 'its own' : 'COVERED'}; ${m.edgeTab ? 'AN EDGE TAB' : 'no edge tab'}; ${m.rows === null ? 'closed' : `${m.rows.n} rows ${m.rows.gap}px under the title, ${m.rows.inColumn ? 'in the column' : 'OUT OF THE COLUMN'}, ${m.rows.position}, a 60px scroll moves them ${m.rows.moved}px`}; ${m.wide ? 'SCROLLS SIDEWAYS' : 'no side scroll'}`}  ${shot}`)
    }
  }
  await send('Emulation.setEmulatedMedia', { features: [] }, page)
}
// YAZ-5534: the Type filter (`search-types*`), light and dark, at 375 px: the bar one line, the pill whole; each menu row a
// 44 px tap with its check; the tree of the types with each row's parent folders open above it; no side scroll.
const TYPES_CHECK = `(() => {
  const r = (el) => el.getBoundingClientRect()
  const screen = document.querySelector('.screen')
  const bar = document.querySelector('.search__bar')
  const pill = bar.querySelector('.pill[aria-haspopup]')
  const chips = [...bar.querySelectorAll('button')]
  const items = [...document.querySelectorAll('[role=menuitemcheckbox]')]
  const rows = [...document.querySelectorAll('.search__found > li > .tree__row')]
  const depth = (b) => Number(b.style.getPropertyValue('--tree-depth'))
  // Each row deeper than 0 sits under its parent, the nearest row above one level up: an open folder, or the page of a card in it.
  const placed = rows.every((b, i) => {
    if (depth(b) === 0) return true
    const parent = rows.slice(0, i).reverse().find((a) => depth(a) === depth(b) - 1)
    return parent !== undefined && (parent.closest('li').getAttribute('aria-expanded') === 'true' || (b.dataset.kind === 'card' && parent.dataset.kind === 'markdown'))
  })
  return {
    pill: pill.textContent,
    lines: new Set(chips.map((c) => Math.round(r(c).top))).size,
    outside: chips.filter((c) => r(c).right > innerWidth + 0.5).map((c) => c.textContent),
    menu: items.map((m) => m.textContent),
    short: items.filter((m) => r(m).height < 44).length,
    rows: rows.map((b) => depth(b) + ':' + b.dataset.kind + ':' + b.querySelector('.tree__label').textContent),
    placed,
    wide: screen.scrollWidth > screen.clientWidth + 1,
    icons: [...document.querySelectorAll('.search__found .tree__row:is([data-kind=drawing], [data-kind=diagram])')].map((b) => {
      const icon = b.querySelector('.file-icon'), ib = r(icon), lb = r(b.querySelector('.tree__label'))
      const cs = getComputedStyle(icon)
      // The icon's own fill (Material's, in the inline SVG; an <img> is Material's served file), against the row's ground.
      const fill = (/%23([0-9a-f]{6})/i.exec(cs.backgroundImage) || [])[1]
      let el = b, ground = 'rgba(0, 0, 0, 0)'
      while (el && /rgba\\(0, 0, 0, 0\\)|transparent/.test(ground)) { ground = getComputedStyle(el).backgroundColor; el = el.parentElement }
      if (/rgba\\(0, 0, 0, 0\\)|transparent/.test(ground)) ground = getComputedStyle(document.body).backgroundColor
      const lum = (rgb) => { const c = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] }
      const g = ground.match(/\\d+/g).slice(0, 3).map(Number)
      const f = fill ? [0, 2, 4].map((i) => parseInt(fill.slice(i, i + 2), 16)) : null
      const [hi, lo] = f ? [lum(f), lum(g)].sort((a, b) => b - a) : [0, 0]
      return {
        name: b.querySelector('.tree__label').textContent, kind: b.dataset.kind, tag: icon.tagName,
        src: icon.tagName === 'IMG' ? icon.getAttribute('src') : (cs.backgroundImage.startsWith('url("data:image/svg+xml') ? 'inline ' + (fill ? '#' + fill : '?') : cs.backgroundImage.slice(0, 30)),
        mask: cs.maskImage !== 'none',
        size: Math.round(ib.width) + 'x' + Math.round(ib.height),
        shown: ib.width >= 15 && ib.height >= 15 && ib.right <= lb.left + 1 && ib.top >= r(b).top - 0.5 && ib.bottom <= r(b).bottom + 0.5 && cs.visibility === 'visible' && cs.opacity === '1' && (icon.tagName === 'IMG' ? icon.complete && icon.naturalWidth > 0 : true),
        contrast: f ? Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100 : null,
      }
    }),
  }
})()`
if (process.env.LAYOUT_TYPES !== 'no') {
  const WANT: Record<string, { pill: string; menu: number }> = {
    'search-types': { pill: '3 types ▾', menu: 0 },
    // Two names do not fit beside the three chips at 375 pt: the count, so the bar keeps one line.
    'search-types-menu': { pill: '2 types ▾', menu: 5 },
    'search-types-favorites': { pill: 'Cards ▾', menu: 0 },
  }
  for (const [name, want] of Object.entries(WANT))
    for (const scheme of ['light', 'dark'] as const) {
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }, page)
      const file = await open(name, 375, 667)
      const m = await evaluate(TYPES_CHECK)
      const shot = file.replace('.png', `-${scheme}.png`)
      writeFileSync(shot, Buffer.from((await send('Page.captureScreenshot', { format: 'png' }, page)).data, 'base64'))
      const ok = m.pill === want.pill && m.lines === 1 && m.outside.length === 0 && m.menu.length === want.menu && m.short === 0 && m.rows.length > 0 && m.placed && !m.wide
      if (!ok) failed++
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${scheme} at 375x667: pill "${m.pill}", bar ${m.lines} line${m.outside.length ? `, OUTSIDE ${m.outside}` : ''}; menu ${JSON.stringify(m.menu)}${m.short ? `, ${m.short} SHORT` : ''}; ${m.rows.length} rows ${m.placed ? 'each under its open parents' : 'NOT UNDER THEIR PARENTS'}: ${m.rows.join(' / ')}; ${m.wide ? 'SCROLLS SIDEWAYS' : 'no side scroll'}  ${shot}`)
      // YAZ-5545: each drawing and diagram row shows the Mac's Material icon, drawn (an image in its own colours, 16 px,
      // before the name, inside the row; a draw.io picture Material's served `svg`). The contrast is the Mac's own colour's
      // against this ground, reported (the Mac's colours are kept as they are).
      if (name === 'search-types') {
        const WANT_ICON: Record<string, string> = { drawing: 'inline #5c6bc0', diagram: 'inline #fb8c00' }
        const iconsOk = m.icons.length > 0 && m.icons.every((i: any) => i.shown && !i.mask && (i.tag === 'IMG' ? i.src === '/material-icons/svg.svg' : i.src === WANT_ICON[i.kind]))
        if (!iconsOk) failed++
        // A picture of the drawing and diagram rows together: scrolled so the last of them shows.
        await evaluate(`[...document.querySelectorAll('.search__found .tree__row[data-kind=diagram]')].pop()?.scrollIntoView({ block: 'center' })`)
        await wait(150)
        writeFileSync(shot.replace('.png', '-icons.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' }, page)).data, 'base64'))
        console.log(`${iconsOk ? 'PASS' : 'FAIL'}  ${name} ${scheme} drawing and diagram icons: ${m.icons.map((i: any) => `${i.name} [${i.kind}] ${i.src} ${i.size}${i.mask ? ' MASKED' : ''}${i.shown ? '' : ' NOT SHOWN'}${i.contrast === null ? '' : ` ${i.contrast}:1`}`).join(' / ')}`)
      }
    }
  await send('Emulation.setEmulatedMedia', { features: [] }, page)
}
// YAZ-5535: "Linked mentions" at the end of a page, in an Explore panel (no sticky foot) and on the full page.
const MENTIONS = (scope: string) => `(() => {
  const root = document.querySelector(${JSON.stringify(scope)})
  const s = root && root.querySelector('.linked-mentions')
  if (!s) return { error: 'no section' }
  const r = (el) => el.getBoundingClientRect()
  const head = s.querySelector('.linked-mentions__header'), hb = r(head)
  const box = document.querySelector('.explore-sheet:last-of-type .explore-sheet__box')
  const body = box && box.querySelector('.explore-sheet__body')
  const hit = document.elementFromPoint(hb.left + hb.width / 2, hb.top + hb.height / 2)
  const scroller = body || document.querySelector('.screen--reader')
  return {
    words: head.textContent, open: head.getAttribute('aria-expanded'), position: getComputedStyle(s).position,
    tap: Math.round(hb.height), inside: hb.left >= -0.5 && hb.right <= innerWidth + 0.5 && hb.top >= 0 && hb.bottom <= innerHeight, hit: !!hit && head.contains(hit),
    rows: [...s.querySelectorAll('.linked-mentions__page')].map((b) => b.textContent),
    rowsInside: [...s.querySelectorAll('.linked-mentions__page')].every((b) => r(b).right <= innerWidth + 0.5),
    foot: box ? box.querySelector('.explore-sheet__foot') !== null : false,
    bodyLast: box ? box.lastElementChild === body || box.lastElementChild?.previousElementSibling === body : true,
    bodyToBottom: box ? Math.round(r(box).bottom - r(body).bottom) : 0,
    wide: scroller ? scroller.scrollWidth > scroller.clientWidth + 1 : false,
    top: Math.round(r(s).top),
  }
})()`
if (process.env.LAYOUT_MENTIONS !== 'no') {
  const shotTo = async (file: string) => writeFileSync(file, Buffer.from((await send('Page.captureScreenshot', { format: 'png' }, page)).data, 'base64'))
  const SHEET = '.explore-sheet:last-of-type .explore-sheet__body'
  for (const scheme of ['light', 'dark'] as const) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }, page)
    // In the panel: closed at the end of the page.
    const file = await open('explore-mentions', 375, 667)
    const closed = await evaluate(MENTIONS(SHEET))
    const shot = file.replace('.png', `-${scheme}.png`)
    await shotTo(shot)
    // It scrolls with the page: 120 px up, the section 120 px lower.
    await evaluate(`document.querySelector(${JSON.stringify(SHEET)}).scrollTop -= 120`)
    await wait(150)
    const moved = (await evaluate(MENTIONS(SHEET))).top - closed.top
    await evaluate(`document.querySelector(${JSON.stringify(SHEET)}).scrollTop += 1000`)
    await evaluate(`document.querySelector(${JSON.stringify(SHEET)} + ' .linked-mentions__header').click()`)
    await wait(600)
    await evaluate(`document.querySelector(${JSON.stringify(SHEET)}).scrollTop += 1000`)
    await wait(200)
    const opened = await evaluate(MENTIONS(SHEET))
    await shotTo(shot.replace('.png', '-open.png'))
    const ok = closed.error === undefined && closed.words === 'Linked mentions (2)' && closed.open === 'false' && !closed.foot && closed.bodyLast && closed.bodyToBottom === 0 && !['sticky', 'fixed'].includes(closed.position) && closed.tap >= 44 && closed.inside && closed.hit && moved === 120 && opened.open === 'true' && opened.rows.length === 2 && opened.rowsInside && !opened.wide
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  explore-mentions ${scheme} at 375x667: "${closed.words}" ${closed.open === 'false' ? 'closed' : 'OPEN'}; ${closed.foot ? 'A FOOT' : 'no foot'}; body ${closed.bodyToBottom}px from the box's bottom; ${closed.position}; ${closed.tap}px tap ${closed.inside ? 'inside' : 'OUTSIDE'}, ${closed.hit ? 'on top' : 'COVERED'}; scrolls with the page: ${moved}px; open: ${JSON.stringify(opened.rows)} ${opened.wide ? 'SCROLLS SIDEWAYS' : ''}  ${shot}`)
    // On the full page: the same section, opened by the fixture, then closed.
    const pageFile = await open('page-linked-from', 375, 667)
    const full = await evaluate(MENTIONS('.screen--reader'))
    const pageShot = pageFile.replace('.png', `-${scheme}.png`)
    await shotTo(pageShot)
    await evaluate(`document.querySelector('.screen--reader .linked-mentions__header').click()`)
    await wait(200)
    const shut = await evaluate(MENTIONS('.screen--reader'))
    await shotTo(pageShot.replace('.png', '-closed.png'))
    const pageOk = full.error === undefined && full.words === 'Linked mentions (2)' && full.open === 'true' && full.rows.length === 2 && full.rowsInside && !['sticky', 'fixed'].includes(full.position) && full.tap >= 44 && !full.wide && shut.open === 'false' && shut.rows.length === 0
    if (!pageOk) failed++
    console.log(`${pageOk ? 'PASS' : 'FAIL'}  page-linked-from ${scheme} at 375x667: "${full.words}" open ${JSON.stringify(full.rows)}; ${full.position}; ${full.tap}px tap; closed: ${shut.rows.length} rows  ${pageShot}`)
  }
  await send('Emulation.setEmulatedMedia', { features: [] }, page)
}
// YAZ-5532: the finger band, light and dark, at 375 px.
const BAND_CHECK = `(() => {
  const root = document.querySelector('.table-view') ?? document.querySelector('.folder-table') ?? document.querySelector('.reader__body')
  const rows = [...root.querySelectorAll('tr[data-band]')]
  const row = rows[0]
  if (!row) return { rows: 0 }
  const bg = (el) => getComputedStyle(el).backgroundColor
  const page = getComputedStyle(document.body).backgroundColor
  const cells = [...row.cells].map(bg)
  const frozen = row.querySelector('[data-pin-col]')
  const other = row.closest('tbody').rows[row.sectionRowIndex + 3] ?? row.closest('tbody').rows[1]
  return { rows: rows.length, text: row.cells[0].textContent.trim(), same: cells.every((c) => c === cells[0]), colour: cells[0], page, otherBg: bg(other.cells[1]), frozen: frozen ? getComputedStyle(frozen).position + ' ' + bg(frozen) : null, select: getComputedStyle(row.cells[1]).userSelect, nameTap: [...root.querySelectorAll('td[data-name]')].map((td) => Math.round(td.getBoundingClientRect().height)).reduce((a, b) => Math.min(a, b), 999) }
})()`
/** The middle of a cell of the `n`th body row of the shown table (on the screen), and that row's first text. */
const CELL_AT = (n: number) => `(() => {
  const root = document.querySelector('.table-view') ?? document.querySelector('.folder-table') ?? document.querySelector('.reader__body')
  const row = root.querySelector('table').tBodies[0].rows[${n}]
  const cell = row.cells[Math.min(2, row.cells.length - 1)]
  cell.scrollIntoView?.({ block: 'center', inline: 'nearest' })
  const r = cell.getBoundingClientRect()
  return { x: Math.round(r.left + Math.min(r.width / 2, 30)), y: Math.round(r.top + r.height / 2), text: row.cells[0].textContent.trim() }
})()`
const BANDED = `(() => { const root = document.querySelector('.table-view') ?? document.querySelector('.folder-table') ?? document.querySelector('.reader__body'); return [...root.querySelectorAll('tr[data-band]')].map((r) => r.cells[0].textContent.trim()) })()`
const UNDER = (x: number, y: number) => `(() => { const tr = document.elementFromPoint(${x}, ${y})?.closest('tr'); return tr ? tr.cells[0].textContent.trim() : null })()`
const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) => send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] }, page)
if (process.env.LAYOUT_BAND !== 'no') {
  for (const scheme of ['light', 'dark'] as const) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }, page)
    for (const name of ['page-table-band', 'page-table-band-full', 'folder-table-band']) {
      const file = await open(name, 375, 667)
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, page)
      const m = await evaluate(BAND_CHECK)
      const shot = file.replace('.png', `-${scheme}.png`)
      writeFileSync(shot, Buffer.from((await send('Page.captureScreenshot', { format: 'png' }, page)).data, 'base64'))
      const marked = m.rows === 1 && m.same && m.colour !== m.page && m.colour !== m.otherBg && /^(sticky|relative) /.test(m.frozen ?? '') && (m.frozen === null || m.frozen.endsWith(m.colour)) && m.select === 'text'
      // A real finger: down on another row, a move, the lift.
      // The row in view first (a scroll), then its place.
      const a = await evaluate(CELL_AT(name === 'folder-table-band' ? 3 : 7))
      await wait(150)
      const a2 = await evaluate(CELL_AT(name === 'folder-table-band' ? 3 : 7))
      await touch('touchStart', a2.x, a2.y)
      await wait(120)
      const onDown = await evaluate(BANDED)
      const to = { x: a2.x + 4, y: a2.y + 60 }
      for (let i = 1; i <= 4; i++) {
        await touch('touchMove', a2.x + i, a2.y + i * 15)
        await wait(40)
      }
      await wait(120)
      const onMove = await evaluate(BANDED)
      const under = await evaluate(UNDER(a2.x + 4, a2.y + 60))
      await touch('touchEnd', to.x, to.y)
      await wait(400)
      const afterLift = await evaluate(BANDED)
      const moved = onDown.length === 1 && onDown[0] === a2.text && onMove.length === 1 && (under === null || onMove[0] === under) && afterLift.join() === onMove.join()
      writeFileSync(shot.replace('.png', '-touched.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' }, page)).data, 'base64'))
      await send('Emulation.setTouchEmulationEnabled', { enabled: false }, page)
      // YAZ-5532 (A): on a folder table a tap on another cell only moves the band; a tap on the Name (44 px tall) opens.
      let taps = true
      let tapNote = ''
      if (name === 'folder-table-band') {
        const tap = async (x: number, y: number) => {
          await touch('touchStart', x, y)
          await wait(60)
          await touch('touchEnd', x, y)
          await wait(500)
        }
        const other = await evaluate(`(() => { const row = document.querySelector('.folder-table tbody tr[data-row]:nth-child(2)'); const r = row.querySelector('td:not([data-name]):not(.folder-table__num)').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), text: row.cells[0].textContent.trim() } })()`)
        await tap(other.x, other.y)
        const afterOther = await evaluate(`({ table: !!document.querySelector('.folder-table table'), band: [...document.querySelectorAll('.folder-table tr[data-band]')].map((r) => r.cells[0].textContent.trim()) })`)
        const nameAt = await evaluate(`(() => { const td = document.querySelector('.folder-table tbody tr[data-row]:nth-child(3) td[data-name]'); const r = td.getBoundingClientRect(); return { x: Math.round(r.left + 20), y: Math.round(r.top + r.height / 2) } })()`)
        await tap(nameAt.x, nameAt.y)
        await wait(400)
        const opened = await evaluate(`/Build the shed before winter\./.test(document.body.textContent)`)
        taps = m.nameTap >= 44 && afterOther.table && afterOther.band.join() === other.text && opened
        tapNote = `; Name cells ${m.nameTap}px tall; a tap on "${other.text}"'s Status: table ${afterOther.table ? 'stays' : 'GONE'}, band ${JSON.stringify(afterOther.band)}; a tap on a Name ${opened ? 'opens its page' : 'DID NOT OPEN'}`
      }
      const ok = marked && moved && taps
      if (!ok) failed++
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${scheme} at 375x667: band on "${m.text}" (${m.rows} row), cells ${m.same ? 'one colour' : 'DIFFER'} ${m.colour} (page ${m.page}, a row without ${m.otherBg}), frozen cell ${m.frozen ?? 'none'}, cell text ${m.select}; finger down on "${a.text}" -> ${JSON.stringify(onDown)}, moved -> ${JSON.stringify(onMove)} (under the finger ${JSON.stringify(under)}), after the lift ${JSON.stringify(afterLift)}${tapNote}  ${shot}`)
    }
  }
  await send('Emulation.setEmulatedMedia', { features: [] }, page)
}
// YAZ-5533: plain draw.io diagrams, drawn by draw.io's viewer in its frame (the fixtures build under the real CSP).
const DIAGRAM_BOXES = `(() => {
  const r = (el) => el.getBoundingClientRect()
  return [...document.querySelectorAll('.reader__body figure[data-vault-drawing]')].map((b) => {
    const img = b.querySelector('img.page-drawing__img')
    const select = b.querySelector('select')
    return {
      path: b.dataset.vaultDrawing.replace('Drawings/', ''),
      drawn: img !== null && img.complete && img.naturalWidth > 0,
      fits: img !== null && r(img).left >= r(b).left - 0.5 && r(img).right <= r(b).right + 0.5 && r(b).right <= innerWidth + 0.5,
      picker: select && { left: Math.round(r(select).left), right: Math.round(r(select).right), height: Math.round(r(select).height), pages: select.options.length },
      text: b.textContent.slice(0, 60),
    }
  })
})()`
if (process.env.LAYOUT_DIAGRAMS !== 'no') {
  for (const scheme of ['light', 'dark'] as const) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }, page)
    for (const [w, h] of [[320, 568], [375, 667]] as const) {
      const file = await open('page-diagrams', w, h)
      const count = (await evaluate(`document.querySelectorAll('.reader__body figure[data-vault-drawing]').length`)) as number
      // Each box near the screen in turn (a box draws as it nears); a picture of each.
      for (let i = 0; i < count; i++) {
        await evaluate(`document.querySelectorAll('.reader__body figure[data-vault-drawing]')[${i}].scrollIntoView({ block: 'start' })`)
        for (let t = 0; t < 150 && (await evaluate(`!document.querySelectorAll('.reader__body figure[data-vault-drawing]')[${i}].classList.contains('page-drawing--wait') && (document.querySelectorAll('.reader__body figure[data-vault-drawing]')[${i}].querySelector('img')?.complete ?? true)`)) !== true; t++) await wait(100)
        await wait(250)
        writeFileSync(file.replace('.png', `-${scheme}-${i + 1}.png`), Buffer.from((await send('Page.captureScreenshot', { format: 'png' }, page)).data, 'base64'))
      }
      const boxes = (await evaluate(DIAGRAM_BOXES)) as { path: string; drawn: boolean; fits: boolean; picker: { left: number; right: number; height: number; pages: number } | null; text: string }[]
      // A pick: the second page of the three-page diagram.
      const picked = await evaluate(`(async () => {
        const box = [...document.querySelectorAll('.reader__body figure[data-vault-drawing]')].find((b) => b.dataset.vaultDrawing.endsWith('multipage.drawio'))
        const select = box.querySelector('select')
        box.scrollIntoView({ block: 'start' })
        select.value = select.options[1].value
        select.dispatchEvent(new Event('change', { bubbles: true }))
        for (let t = 0; t < 100; t++) {
          await new Promise((d) => setTimeout(d, 100))
          if (/Details/.test(box.querySelector('img')?.alt ?? '') && box.querySelector('img').complete) return box.querySelector('img').alt
        }
        return box.querySelector('img')?.alt ?? 'none'
      })()`)
      await wait(250)
      writeFileSync(file.replace('.png', `-${scheme}-picked.png`), Buffer.from((await send('Page.captureScreenshot', { format: 'png' }, page)).data, 'base64'))
      const pageWide = (await evaluate(`document.scrollingElement.scrollWidth > innerWidth + 1`)) as boolean
      const pickers = boxes.filter((b) => b.picker !== null)
      const ok = boxes.length === 6 && boxes.every((b) => b.drawn && b.fits) && pickers.length === 2 && pickers.every((b) => b.picker!.left >= 0 && b.picker!.right <= w && b.picker!.height >= 44) && /Details/.test(String(picked)) && !pageWide
      if (!ok) failed++
      console.log(`${ok ? 'PASS' : 'FAIL'}  page-diagrams at ${w}x${h}, ${scheme}: ${boxes.map((b) => `${b.path} ${b.drawn ? (b.fits ? 'drawn, fits' : 'drawn, TOO WIDE') : `NOT DRAWN (${b.text})`}${b.picker ? `, picker ${b.picker.pages} pages ${b.picker.left}-${b.picker.right} x${b.picker.height}` : ''}`).join('; ')}; a pick drew "${picked}"; page ${pageWide ? 'SCROLLS SIDEWAYS' : 'stays'}  ${file.replace('.png', `-${scheme}-*.png`)}`)
    }
  }
  await send('Emulation.setEmulatedMedia', { features: [] }, page)
}
// YAZ-5540 (taller): the Explore panel rests just under the status bar, light and dark, at 375 px (and 667x375, N7), with the safe-area
// inset at 0 (a Safari tab) and at 47 px (a notched iPhone's Home Screen app; Chrome's own inset override): each
// sheet's top is the inset + 12 px + 8 px a step; above the first, a strip of the dimmed screen shows; the top sheet's
// head and its grab handle are whole on the screen, below the inset, and a tap at the head's middle is the head's.
const PANEL_TOP = `(() => {
  const r = (el) => el.getBoundingClientRect()
  const probe = document.createElement('div')
  probe.style.cssText = 'position: fixed; top: 0; left: 0; width: 1px; height: 0; padding-top: env(safe-area-inset-top, 0px); visibility: hidden'
  document.body.append(probe)
  const inset = r(probe).height
  probe.remove()
  const sheets = [...document.querySelectorAll('.explore-sheet:not(.explore-sheet--deep)')]
  if (sheets.length === 0) return { none: true, inset }
  const top = sheets.at(-1), box = top.querySelector('.explore-sheet__box'), head = top.querySelector('.explore-sheet__head'), grab = top.querySelector('.explore-sheet__grab')
  const hb = r(head), gb = r(grab)
  const at = document.elementFromPoint(innerWidth / 2, inset + 5)
  const mid = document.elementFromPoint(hb.left + hb.width / 2, hb.top + hb.height / 2)
  return {
    inset,
    tops: sheets.map((s) => ({ step: Number(s.style.getPropertyValue('--sheet-step')), top: Math.round(r(s).top * 10) / 10 })),
    boxTop: Math.round(r(box).top * 10) / 10,
    strip: Math.round((r(sheets[0]).top - inset) * 10) / 10,
    stripDim: !!at && at.classList.contains('explore-dim') && !at.closest('.explore-sheet'),
    head: [Math.round(hb.top), Math.round(hb.bottom)],
    headLeft: Math.round(hb.left),
    grab: [Math.round(gb.top), Math.round(gb.bottom)],
    headWhole: hb.top >= inset && hb.bottom <= innerHeight && hb.left >= 0 && hb.right <= innerWidth + 0.5 && gb.top >= inset,
    headOnTop: !!mid && head.contains(mid),
  }
})()`
if (process.env.LAYOUT_PANEL_TOP !== 'no') {
  for (const scheme of ['light', 'dark'] as const) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }, page)
    // YAZ-5522 N7 (option A): a short screen, a small phone on its side (667x375), the same rule: the panel near the
    // top, ~363 px tall (not ~268). On its side a notched iPhone's inset is at the left and right (`side`), not the top.
    const CASES = [['explore-one', 0, 375, 667, 0], ['explore-one', 47, 375, 667, 0], ['explore-stack', 0, 375, 667, 0], ['explore-stack', 47, 375, 667, 0], ['explore-one', 0, 667, 375, 0], ['explore-one', 0, 667, 375, 47], ['explore-stack', 0, 667, 375, 47]] as const
    for (const [name, inset, w, h, side] of CASES) {
      await send('Emulation.setSafeAreaInsetsOverride', { insets: { top: inset, topMax: inset, left: side, leftMax: side, right: side, rightMax: side } }, page)
      const file = await open(name, w, h)
      const m = await evaluate(PANEL_TOP)
      const shot = file.replace('.png', `-inset${inset}${side ? `-side${side}` : ''}-${scheme}.png`)
      writeFileSync(shot, Buffer.from((await send('Page.captureScreenshot', { format: 'png' }, page)).data, 'base64'))
      const steps = m.none ? false : m.tops.every((t: { step: number; top: number }) => Math.abs(t.top - (inset + 12 + 8 * t.step)) <= 0.5)
      // One sheet: the strip is the 12 px. A stack: the lowest drawn sheet's step (two or more down are not drawn) adds 8 px each.
      const strip = m.none ? -1 : m.strip - 8 * m.tops[0].step
      const tall = m.none ? 0 : h - m.boxTop
      const ok = !m.none && Math.abs(m.inset - inset) <= 0.5 && Math.abs(tall - (h - inset - 12 - 8 * m.tops.at(-1).step)) <= 0.5 && m.headLeft >= side - 0.5 && m.tops.length >= (name === 'explore-one' ? 1 : 2) && (name !== 'explore-one' || m.tops[0].step === 0) && steps && strip >= 10 && strip <= 12.5 && m.stripDim && m.headWhole && m.headOnTop
      if (!ok) failed++
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} panel top ${scheme}, inset ${inset}${side ? `, sides ${side}` : ''} at ${w}x${h}: inset read ${m.inset}px; panel ${tall}px tall, head from x ${m.headLeft}; sheets ${m.none ? 'NONE' : m.tops.map((t: { step: number; top: number }) => `step ${t.step} at ${t.top}`).join(', ')} (${steps ? 'inset + 12 + 8 a step' : 'OFF THE STEPS'}); strip ${m.strip}px (${strip}px at step 0) ${m.stripDim ? 'of the dim' : 'NOT THE DIM'}; head ${m.head?.join('..')}, grab ${m.grab?.join('..')} ${m.headWhole ? 'whole, below the inset' : 'UNDER THE INSET OR CUT'}, ${m.headOnTop ? 'on top' : 'COVERED'}  ${shot}`)
    }
  }
  await send('Emulation.setSafeAreaInsetsOverride', { insets: {} }, page)
  await send('Emulation.setEmulatedMedia', { features: [] }, page)
}
// YAZ-5552: every menu with a real finger (the DevTools touch events), at 375 px: a tap on its button opens it, a tap
// on it again closes it, a third opens it; a tap outside closes it and does nothing else (`what` reads the same).
const CENTRE = (sel: string) => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (el === null) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: Math.round(r.left + Math.min(r.width / 2, 20)), y: Math.round(r.top + r.height / 2) } })()`
const MENUS: { fixture: string; name: string; button: string; menu: string; outside: string; what: string }[] = [
  { fixture: 'page', name: 'Page tools ⋯', button: '.page-tools__btn', menu: '.page-tools__menu', outside: '.reader__body h1', what: `document.querySelector('.topbar__title')?.textContent` },
  { fixture: 'page', name: 'a page card\'s ⋯', button: '.reader__body .page-card .card__more', menu: '.card-menu', outside: '.reader__body h1', what: `document.querySelector('.topbar__title')?.textContent` },
  { fixture: 'search-tree', name: 'Search\'s Type chip', button: '.search__type-chip', menu: '.search__menu', outside: '.tree__row--dir', what: `document.querySelector('.tree__row--dir')?.closest('li')?.getAttribute('aria-expanded')` },
  { fixture: 'explore-mentions', name: 'an Explore sheet\'s ⋯', button: '.explore-sheet:last-of-type .explore-sheet__more', menu: '.explore-sheet__menu', outside: '.explore-sheet:last-of-type .linked-mentions__header', what: `[document.querySelectorAll('.explore-sheet').length, document.querySelector('.explore-sheet:last-of-type .linked-mentions__header')?.getAttribute('aria-expanded')].join()` },
  { fixture: 'review-mochi-menus', name: 'Review\'s deck button', button: '.review__count-btn', menu: '.review__sheet', outside: '.review__card', what: `document.querySelector('.review__card')?.textContent` },
  { fixture: 'review-mochi-menus', name: 'Review\'s ⋯', button: '.review__more', menu: '.review__menu--more', outside: '.review__card', what: `document.querySelector('.review__card')?.textContent` },
]
if (process.env.LAYOUT_MENUS !== 'no') {
  const tap = async (at: { x: number; y: number }) => {
    await touch('touchStart', at.x, at.y)
    await wait(60)
    await touch('touchEnd', at.x, at.y)
    await wait(450)
  }
  for (const m of MENUS) {
    const file = await open(m.fixture, 375, 667)
    await wait(600) // past Review's tap guard (YAZ-5226)
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, page)
    const isOpen = async () => (await evaluate(`document.querySelector(${JSON.stringify(m.menu)}) !== null`)) as boolean
    const button = await evaluate(CENTRE(m.button))
    const seen: boolean[] = []
    let before: unknown = null
    let after: unknown = null
    let closedOutside = false
    if (button !== null) {
      for (let i = 0; i < 3; i++) {
        await tap((await evaluate(CENTRE(m.button))) ?? button)
        seen.push(await isOpen())
      }
      writeFileSync(file.replace('.png', `-menu-${MENUS.indexOf(m)}.png`), Buffer.from((await send('Page.captureScreenshot', { format: 'png' }, page)).data, 'base64'))
      before = await evaluate(m.what)
      const out = await evaluate(CENTRE(m.outside))
      if (out !== null) await tap(out)
      closedOutside = !(await isOpen())
      after = await evaluate(m.what)
    }
    await send('Emulation.setTouchEmulationEnabled', { enabled: false }, page)
    const ok = seen.join() === 'true,false,true' && closedOutside && before === after
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  menu toggle (YAZ-5552): ${m.name} (#fixture=${m.fixture}) at 375x667, real touch: taps on its button -> ${button === null ? 'NO BUTTON' : seen.map((o) => (o ? 'open' : 'closed')).join(', ')}; a tap outside -> ${closedOutside ? 'closed' : 'STILL OPEN'}, ${before === after ? 'nothing else changed' : `CHANGED ${JSON.stringify(before)} -> ${JSON.stringify(after)}`}  ${file}`)
  }
}
// YAZ-5555: the build's line at the top of Settings (`#fixture=settings`), light and dark, at 320 and 375 px: it shows
// without opening anything, one line, muted, under the top bar and above the first section, inside the screen.
const BUILD_LINE = `(() => {
  const r = (el) => el.getBoundingClientRect()
  const line = document.querySelector('.settings__build')
  if (!line) return { error: 'no build line' }
  const first = document.querySelector('.screen h2.section')
  const lh = parseFloat(getComputedStyle(line).lineHeight) || parseFloat(getComputedStyle(line).fontSize) * 1.4
  return { text: line.textContent, oneLine: r(line).height <= lh * 1.5, below: r(line).top >= r(document.querySelector('.topbar')).bottom - 0.5, above: !first || r(line).bottom <= r(first).top, inside: r(line).left >= 0 && r(line).right <= innerWidth + 0.5, colour: getComputedStyle(line).color, pageWide: document.scrollingElement.scrollWidth > innerWidth + 1 }
})()`
if (process.env.LAYOUT_SETTINGS !== 'no') {
  for (const scheme of ['light', 'dark'] as const) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }, page)
    for (const [w, h] of [[320, 568], [375, 667]] as const) {
      const file = await open('settings', w, h)
      const shot = file.replace('.png', `-build-${scheme}.png`)
      writeFileSync(shot, Buffer.from((await send('Page.captureScreenshot', { format: 'png' }, page)).data, 'base64'))
      const m = await evaluate(BUILD_LINE)
      const ok = !m.error && /^Build \S+ · \d{1,2} [A-Z][a-z]{2}, \d{2}:\d{2}$/.test(m.text) && m.oneLine && m.below && m.above && m.inside && !m.pageWide
      if (!ok) failed++
      console.log(`${ok ? 'PASS' : 'FAIL'}  settings build line at ${w}x${h}, ${scheme}: ${m.error ?? `"${m.text}", ${m.oneLine ? 'one line' : 'WRAPS'}, ${m.below && m.above ? 'at the top' : 'NOT AT THE TOP'}, ${m.inside ? 'inside' : 'OUTSIDE'}, ${m.colour}; page ${m.pageWide ? 'SCROLLS SIDEWAYS' : 'stays'}`}  ${shot}`)
    }
  }
  await send('Emulation.setEmulatedMedia', { features: [] }, page)
}
// YAZ-5559: Settings › Vault health (`#fixture=settings-health`, its list open), light and dark, at 320 and 375 px: the
// line a 44 px tap inside the screen, its words; each row of the list inside the screen; the page never sideways.
const HEALTH_CHECK = `(() => {
  const r = (el) => el.getBoundingClientRect()
  const toggle = document.querySelector('.vault-health__toggle')
  const list = document.querySelector('#vault-health-list')
  if (!toggle || !list) return { error: 'no vault health' }
  const rows = [...list.querySelectorAll('li.row')]
  return { line: toggle.querySelector('.vault-health__line').textContent, tap: Math.round(r(toggle).height), inside: r(toggle).left >= 0 && r(toggle).right <= innerWidth + 0.5, rows: rows.length, rowsInside: rows.every((li) => r(li).left >= 0 && r(li).right <= innerWidth + 0.5 && [...li.children].every((c) => r(c).right <= r(li).right + 0.5)), pageWide: document.scrollingElement.scrollWidth > innerWidth + 1 }
})()`
if (process.env.LAYOUT_SETTINGS !== 'no') {
  for (const scheme of ['light', 'dark'] as const) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }, page)
    for (const [w, h] of [[320, 568], [375, 667]] as const) {
      const file = await open('settings-health', w, h)
      const shot = file.replace('.png', `-${scheme}.png`)
      writeFileSync(shot, Buffer.from((await send('Page.captureScreenshot', { format: 'png' }, page)).data, 'base64'))
      const m = await evaluate(HEALTH_CHECK)
      const ok = !m.error && m.line === 'Using defaults: link clicks, table look, icons' && m.tap >= 44 && m.inside && m.rows === 11 && m.rowsInside && !m.pageWide
      if (!ok) failed++
      console.log(`${ok ? 'PASS' : 'FAIL'}  settings-health at ${w}x${h}, ${scheme}: ${m.error ?? `"${m.line}", a ${m.tap}px tap ${m.inside ? 'inside' : 'OUTSIDE'}; ${m.rows} rows ${m.rowsInside ? 'inside' : 'OUTSIDE'}; page ${m.pageWide ? 'SCROLLS SIDEWAYS' : 'stays'}`}  ${shot}`)
    }
  }
  await send('Emulation.setEmulatedMedia', { features: [] }, page)
}
// YAZ-5564: the install screen of a browser tab (`#fixture=install-gate`, `install-gate-desktop`), light and dark, at
// 320 and 375 px: every line on the screen, nothing sideways, the Share picture drawn, the page's own background.
if (process.env.LAYOUT_GATE !== 'no') {
  const GATE = `(() => {
    const r = (el) => el.getBoundingClientRect()
    const lines = [...document.querySelectorAll('.install-gate h1, .install-gate p, .install-gate li')]
    const icon = document.querySelector('.install-gate svg[role=img]')
    return {
      lines: lines.length,
      inside: lines.every((el) => r(el).left >= 0 && r(el).right <= innerWidth + 0.5 && r(el).bottom <= innerHeight),
      icon: icon !== null && r(icon).width === 20,
      wide: document.scrollingElement.scrollWidth > innerWidth + 1,
      controls: document.querySelectorAll('input, button, form, a').length,
      bg: getComputedStyle(document.body).backgroundColor,
    }
  })()`
  for (const scheme of ['light', 'dark'] as const) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }, page)
    for (const name of ['install-gate', 'install-gate-desktop'])
      for (const [w, h] of [[320, 568], [375, 667]] as const) {
        const file = await open(name, w, h)
        const shot = file.replace('.png', `-${scheme}.png`)
        renameSync(file, shot)
        const m = await evaluate(GATE)
        const bg = scheme === 'dark' ? 'rgb(30, 30, 30)' : 'rgb(255, 255, 255)'
        const ok = m.lines === (name === 'install-gate' ? 5 : 6) && m.inside && m.icon && !m.wide && m.controls === 0 && m.bg === bg
        if (!ok) failed++
        console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${scheme} at ${w}x${h}: ${m.lines} lines ${m.inside ? 'on the screen' : 'CUT'}; Share picture ${m.icon ? 'drawn' : 'MISSING'}; ${m.wide ? 'SCROLLS SIDEWAYS' : 'nothing sideways'}; ${m.controls} controls; background ${m.bg}  ${shot}`)
      }
  }
  await send('Emulation.setEmulatedMedia', { features: [] }, page)
}
// YAZ-5565: Settings › Appearance, light and dark, at 375 px. System (the default) follows the iPhone; Dark and Light,
// chosen, win over it: the page's background, the bar colour (`theme-color`), the radio checked. The choice is saved
// in this profile's localStorage: each forced case removes it after.
if (process.env.LAYOUT_APPEARANCE !== 'no') {
  const LOOK = `(() => {
    const group = document.querySelector('[role=radiogroup][aria-label=Theme]')
    group?.scrollIntoView({ block: 'center' })
    const r = (el) => el.getBoundingClientRect()
    const rows = group ? [...group.querySelectorAll('label')] : []
    return {
      rows: rows.map((l) => l.textContent),
      checked: rows.find((l) => l.querySelector('input').checked)?.textContent ?? null,
      taps: rows.every((l) => r(l).height >= 44 && r(l).right <= innerWidth + 0.5),
      bg: getComputedStyle(document.body).backgroundColor,
      scheme: document.documentElement.dataset.scheme,
      bars: [...document.querySelectorAll('meta[name=theme-color]')].map((m) => m.content),
      wide: document.scrollingElement.scrollWidth > innerWidth + 1,
    }
  })()`
  const BG = { light: 'rgb(255, 255, 255)', dark: 'rgb(30, 30, 30)' }
  const BAR = { light: '#ffffff', dark: '#1e1e1e' }
  for (const system of ['light', 'dark'] as const) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: system }] }, page)
    for (const [name, look, chosen] of [['settings', system, 'System'], [`settings-${system === 'light' ? 'dark' : 'light'}`, system === 'light' ? 'dark' : 'light', system === 'light' ? 'Dark' : 'Light']] as const) {
      const file = await open(name, 375, 667)
      await wait(150)
      const m = await evaluate(LOOK)
      const shot = file.replace('.png', `-system-${system}.png`)
      writeFileSync(shot, Buffer.from((await send('Page.captureScreenshot', { format: 'png' }, page)).data, 'base64'))
      await evaluate(`localStorage.removeItem('notecard.appearance')`)
      const bars = chosen === 'System' ? [BAR.light, BAR.dark] : [BAR[look], BAR[look]]
      const ok = m.rows.join() === 'System,Light,Dark' && m.checked === chosen && m.taps && m.bg === BG[look] && m.scheme === look && m.bars.join() === bars.join() && !m.wide
      if (!ok) failed++
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}, the iPhone ${system}, ${chosen} checked: rows ${m.rows.join(' / ')}; checked ${m.checked}; taps ${m.taps ? '44+' : 'SMALL'}; page ${m.scheme} ${m.bg}; bars ${m.bars.join(' ')}${m.wide ? '; SCROLLS SIDEWAYS' : ''}  ${shot}`)
    }
  }
  await send('Emulation.setEmulatedMedia', { features: [] }, page)
}
chrome.kill()
server.close()
console.log(failed === 0 ? `\nAll layout checks pass. Pictures: ${out}` : `\n${failed} layout checks FAILED. Pictures: ${out}`)
process.exit(failed === 0 ? 0 : 1)
