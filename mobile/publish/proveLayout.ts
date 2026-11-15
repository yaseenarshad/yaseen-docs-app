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
 *  - the tables (`#fixture=page-tables`, `page-table-full`, YAZ-5471): words whole, the wide one scrolls in its box;
 *  - the frozen table (`#fixture=page-table-frozen`, `page-table-frozen-full`, YAZ-5480): while the page scrolls down
 *    and the table sideways, its two frozen rows stay at the top and its frozen column at the left; at the table's end
 *    the rows stop inside it; full screen too;
 *  - the table look (`#fixture=page-table-look`, YAZ-5482), light and dark: the merged cells span their rows and
 *    columns, the fills and text colours paint (a custom dark ink made readable in dark mode), a clipped cell is one
 *    line, no column is too narrow to read, the page never scrolls sideways.
 *  - the reading look (`#fixture=page-look`, YAZ-5458): every block, light and dark, at 375 px, screen by screen down
 *    the page; the page never scrolls sideways.
 *  - the Headings sheet (`#fixture=page-headings`, `page-headings-few`, `page-headings-alone`, YAZ-5497) and the properties
 *    panel (`page-properties`) at 375×667 and 390×844: the box inside the screen, and on top: `elementFromPoint` at its
 *    list's centre, its head and its bottom finds the sheet itself, and at the page arrows' and the tab bar's place too.
 * It writes a picture of each case. Run after `npm run build:fixtures -w mobile`:
 * `npx vite-node mobile/publish/proveLayout.ts` (LAYOUT_DIST: another build folder; PROOF_DIR: where the pictures go;
 * LAYOUT_ASKS=no, LAYOUT_PAGES=no, LAYOUT_LOOK=no, LAYOUT_SHEETS=no skip a part).
 */

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const mobile = new URL('..', import.meta.url).pathname
const DIST = process.env.LAYOUT_DIST ?? join(mobile, 'dist-fixtures')
const PORT = Number(process.env.PROOF_PORT ?? 8931)
const DEBUG = Number(process.env.PROOF_DEBUG ?? 9351)
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
    ...(process.env.LAYOUT_CARD_SHEETS === 'no' ? [] : [['card-headings', ON_TOP('.headings-sheet', '.headings-sheet__panel', '.headings-sheet__list, .headings-sheet__none', '.headings-sheet__title')]]),
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
chrome.kill()
server.close()
console.log(failed === 0 ? `\nAll layout checks pass. Pictures: ${out}` : `\n${failed} layout checks FAILED. Pictures: ${out}`)
process.exit(failed === 0 ? 0 : 1)
