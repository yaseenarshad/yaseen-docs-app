#!/usr/bin/env node
/**
 * USAGE: node tools/perf/sidebarLinesRecalc.mjs [--rows 10200] [--rounds 20] [--css <file>] [--only <case,…>] [--budget 7.3]
 *
 * The style and layout cost of the sidebar's level lines and thread (YAZ-3309, bug YAZ-3329), at the scale
 * of a fully open 10,000-note vault. Headless Chromium (Playwright): no window opens, so it is safe on a Mac
 * that someone is using. Local only, not in CI: timings depend on the machine. Run `npm run build` first.
 *
 * It loads the shipped CSS (`desktop/out/renderer/assets/index-*.css`, or `--css`) and builds the DOM of
 * `Tree.tsx` by hand: a small open top folder, then two open top folders of about 5,100 rows each (100
 * folders, each with an open subfolder of 50 notes and 50 notes of its own). Each folder row carries
 * `tree__row--sticky`, as in Tree.tsx (YAZ-3440 D1). The page also runs the real
 * `client/src/sidebar/levelLinesHover.ts` (built with esbuild), as `Sidebar.tsx` does for "On hover", and the
 * real `client/src/sidebar/stickyFolders.ts`, which writes `data-sticky-levels` on the list (D2).
 *
 * First it checks the behavior that jsdom cannot show, in real Chromium, and exits non-zero if one fails:
 * the mouse in and out of the list sets and clears `data-mouse-in` (D3); a Tab into a row sets
 * `data-key-focus` and shows the lines (S2); a mouse click on a row does not, and the lines go when the
 * mouse leaves (S3); "Always show" and "Never" write nothing; the keys draw no thread (D11); and a folder
 * in inline rename draws no coloured chevron (bug YAZ-3342).
 *
 * The sticky folder rows (YAZ-3440 D1, D2, D3, D10), when the CSS has them (a build before YAZ-3440 has
 * none, and these checks are skipped): in the middle of a folder, its three open folders stick as one stack
 * that starts flush at the top of the list, one row per level; `elementFromPoint` at points of each stuck
 * row (the level lines' and the thread's x included, with every line pseudo-element made a hit target)
 * finds the row itself, so no line paints on top of it; each stuck row has an opaque backing with the thin
 * line under it, and a row that is not stuck has none; at the end of a folder, the next row pushes its
 * row away; `data-sticky-levels` cuts the stack (written by hand, and by `stickyFolders.ts` itself on a
 * short list); a 9-level chain sticks 7 levels at most, or the setting's 5, 3 or 0. D3's click: the page
 * cannot run React's handler, so it runs the same rects logic as Tree.tsx's folder row (stuck = the row
 * stands below its li's top; then `li.scrollIntoView({ block: 'start' })`), and checks that the folder
 * lands at its own place, below the rows stuck above it (`scroll-margin-top`). The e2e spec
 * `desktop/e2e/stickyFolders.spec.ts` clicks the real row.
 *
 * Then each action is measured through CDP as the change of `RecalcStyleDuration` and `LayoutDuration`,
 * averaged per action, after a frame:
 *   inout    the mouse goes into the list, then out of it
 *   frame    the same, frame by frame for 300 ms after each move (a fade runs over several frames):
 *            the worst single frame / the whole fade, style only
 *   key      Tab moves the keyboard focus to the next row
 *   click    a mouse click on a row
 *   row      the mouse moves to the next row inside one folder
 *   cross    the mouse moves between a row of the small top folder and a row of a big one
 *   expand   a folder of 50 notes opens (its list goes into the DOM), then closes
 *   scroll   the mouse in the list, the list scrolls 2 rows a frame for `rounds` × 15 frames, through about 6
 *            ends of folders (YAZ-3440): style and layout of each frame, the worst frame and the mean. The
 *            worst frame (style + layout) must stay at or under `--budget` ms (7.3, the YAZ-3329 budget).
 * for each case: the Show setting (hover / always / off) × the Style (plain / thread).
 */
import { transformSync } from 'esbuild'
import { createRequire } from 'node:module'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const { chromium } = createRequire(path.join(repo, 'package.json'))('playwright')
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}
const rounds = Number(arg('rounds', 20))
const bigFolders = Math.max(1, Math.round((Number(arg('rows', 10200)) - 6) / 102 / 2))
const assets = path.join(repo, 'desktop/out/renderer/assets')
const cssFile = arg('css', null) ?? readdirSync(assets).filter((f) => /^index-.*\.css$/.test(f)).map((f) => path.join(assets, f)).find((f) => readFileSync(f, 'utf8').includes('tree-depth'))
if (cssFile === undefined) throw new Error('No built CSS with the level lines: run `npm run build` first, or give --css')
const css = readFileSync(cssFile, 'utf8')
const only = arg('only', null)?.split(',')
const budget = Number(arg('budget', 7.3))
/** The CSS has the sticky folder rows (YAZ-3440): a build from before has not, and their checks are skipped. */
const sticky = css.includes('tree__row--sticky')

// ---------- the DOM of Tree.tsx ----------
const file = (depth, name) => `<li role="treeitem" aria-selected="false"><button type="button" class="tree__row tree__row--file" style="padding-left:${8 + depth * 14 + 14}px" data-path="${name}"><span class="tree__label">${name}</span></button></li>`
const dir = (depth, name, children) =>
  `<li role="treeitem" aria-expanded="${children !== null}" aria-selected="false"><button type="button" class="tree__row tree__row--dir tree__row--sticky" style="padding-left:${8 + depth * 14}px" data-path="${name}"><span class="tree__chevron${children !== null ? ' tree__chevron--open' : ''}"></span><span class="tree__label">${name}</span></button>${children === null ? '' : `<ul class="tree" role="group" style="--tree-depth:${depth + 1}">${children}</ul>`}</li>`
const notes = (depth, prefix, n) => Array.from({ length: n }, (_, k) => file(depth, `${prefix}/n${k}`)).join('')
const big = (name) => dir(0, name, Array.from({ length: bigFolders }, (_, f) => dir(1, `${name}/d${f}`, dir(2, `${name}/d${f}/s`, notes(3, `${name}/d${f}/s`, 50)) + notes(2, `${name}/d${f}`, 50))).join(''))
const tree = dir(0, 'Z', notes(1, 'Z', 4)) + big('A') + big('B')
/** 9 open folders, each in the one before, each with 30 notes after its subfolder: deeper than the 7-level cap. */
const chain = (depth) => dir(depth, `L${depth}`, (depth < 8 ? chain(depth + 1) : '') + notes(depth + 1, `L${depth}`, 30))

const script = (file, globalName) => transformSync(readFileSync(path.join(repo, file), 'utf8'), { loader: 'ts', format: 'iife', globalName }).code
/**
 * The real listeners of "On hover" (`levelLinesHover`) and the real level cap (`stickyFolders`, the setting's 7 at
 * zoom 1), as scripts: the page has no bundle. Attached as Sidebar.tsx attaches them.
 */
const listeners = `${script('client/src/sidebar/levelLinesHover.ts', 'lines')}
  ${script('client/src/sidebar/stickyFolders.ts', 'sticky')}
  const body = document.querySelector('.sidebar__body')
  if (document.querySelector('.app').dataset.sidebarLines === 'hover') lines.levelLinesHover(body)
  window.stickyStop = sticky.stickyFolders(body, 7, 1)
`
/**
 * The probes of the sticky checks (YAZ-3440), in the page. Each y is from the top edge of the list.
 *   stuckRows()  the stuck folder rows, top to bottom: Tree.tsx's rule (the row stands below its li's top), and on screen
 *   hits()       the points of each stuck row where `elementFromPoint` finds something that is not the row or in it;
 *                `probe` makes every pseudo-element in the list a hit target, so a line on top of a row would be found
 *   backing(p)   the fill and shadow of a folder row's `::before`: the block of a stuck row (D10)
 *   goTo(p)      D3's click on the folder row's name, by the rects logic of Tree.tsx: whether the row was stuck
 *   place(p)     where a folder's row and its li are
 */
const probes = `
  const list = () => document.querySelector('.sidebar__body')
  const edge = () => list().getBoundingClientRect().top + list().clientTop
  const rowOf = (p) => document.querySelector('.tree__row--dir[data-path="' + p + '"]')
  const round = (n) => Math.round(n * 100) / 100
  const stuck = () => [...list().querySelectorAll('.tree__row--sticky')].filter((row) => {
    const r = row.getBoundingClientRect()
    return row.closest('[role="treeitem"]').getBoundingClientRect().top < r.top - 1 && r.bottom > edge() + 0.5
  })
  window.stuckRows = () => stuck().map((row) => ({ path: row.dataset.path, top: round(row.getBoundingClientRect().top - edge()) }))
  window.hits = () => {
    const probe = document.head.appendChild(document.createElement('style'))
    probe.textContent = '.sidebar__body *::before, .sidebar__body *::after { pointer-events: auto !important; }'
    const b = list().getBoundingClientRect()
    const right = b.left + list().clientWidth - 2
    // The edges and the middle; each level's grey line (depth × 14 + 1) and its thread arrow (depth × 14 + 12, 7px wide).
    const xs = [b.left + 2, b.left + 120, right]
    for (let d = 0; d <= 9; d++) xs.push(b.left + d * 14 + 1.5, b.left + d * 14 + 15.5)
    const misses = []
    for (const row of stuck()) {
      const r = row.getBoundingClientRect()
      for (const x of new Set(xs.filter((x) => x <= right)))
        for (const y of [r.top + 1.5, (r.top + r.bottom) / 2, r.bottom - 1.5]) {
          const hit = document.elementFromPoint(x, y)
          if (!row.contains(hit)) misses.push(row.dataset.path + ' at (' + round(x - b.left) + ', ' + round(y - edge()) + '): ' + (hit?.tagName ?? 'none') + ' ' + (hit?.dataset?.path ?? hit?.closest?.('[role="treeitem"]')?.firstElementChild?.dataset?.path ?? ''))
        }
    }
    probe.remove()
    return misses
  }
  window.backing = (p) => {
    const s = getComputedStyle(rowOf(p), '::before')
    return { fill: s.content === 'none' ? 'none' : s.backgroundColor, shadow: s.content === 'none' ? 'none' : s.boxShadow }
  }
  window.goTo = (p) => {
    const row = rowOf(p)
    const item = row.closest('[role="treeitem"]')
    const wasStuck = item.getBoundingClientRect().top < row.getBoundingClientRect().top - 1
    if (wasStuck) item.scrollIntoView({ block: 'start' })
    return wasStuck
  }
  window.place = (p) => ({ row: round(rowOf(p).getBoundingClientRect().top - edge()), item: round(rowOf(p).closest('[role="treeitem"]').getBoundingClientRect().top - edge()) })
  // Scrolls the list so the row of p stands y px below the top edge.
  window.scrollRowTo = (p, y) => { list().scrollTop += document.querySelector('[data-path="' + p + '"]').getBoundingClientRect().top - edge() - y }
`
const page = (lines, style, content = tree) => `<!doctype html><html><head><style>${css}</style></head><body style="margin:0">
<div class="app" data-sidebar-lines="${lines}" data-sidebar-line-style="${style}" style="--thread-width:2px;display:flex;height:800px">
<aside class="sidebar" style="width:260px;display:flex;flex-direction:column"><div class="sidebar__body" style="overflow:auto"><ul class="tree" role="tree">${content}</ul></div></aside>
<main id="main" tabindex="-1" style="flex:1">note</main></div><script>${listeners}${probes}</script></body></html>`

const browser = await chromium.launch({ headless: true })
const frame = (p) => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
const ROW = 25.5 // 13px * 1.5 + 2 * 3px
const results = []
const failures = []
/** One behavior check: `got` must equal `want`. */
const check = (name, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
}
/** `got` with each number within 0.5px of `want`'s taken as `want`'s: the list's scroll offset snaps to whole px, and the rows stand at n × 25.5px. */
const near = (got, want) =>
  typeof got === 'number' && typeof want === 'number' ? (Math.abs(got - want) <= 0.5 ? want : got)
  : Array.isArray(got) && Array.isArray(want) ? got.map((g, i) => near(g, want[i]))
  : got !== null && want !== null && typeof got === 'object' && typeof want === 'object' ? Object.fromEntries(Object.entries(got).map(([k, g]) => [k, near(g, want[k])]))
  : got
/** `check` up to the scroll offset's whole-px snap (`near`); a failure shows the numbers as they are. */
const checkNear = (name, got, want) => {
  if (JSON.stringify(near(got, want)) !== JSON.stringify(want)) failures.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)} (±0.5px)`)
}
for (const [lines, style] of [['hover', 'plain'], ['always', 'plain'], ['off', 'plain'], ['hover', 'thread'], ['always', 'thread']]) {
  const name = `${lines}/${style}`
  if (only !== undefined && !only.includes(name)) continue
  const p = await browser.newPage({ viewport: { width: 900, height: 800 } })
  const cdp = await p.context().newCDPSession(p)
  await cdp.send('Performance.enable')
  await p.setContent(page(lines, style))
  await p.waitForTimeout(300)
  const read = async () => {
    const { metrics } = await cdp.send('Performance.getMetrics')
    const of = (key) => metrics.find((m) => m.name === key).value * 1000
    return [of('RecalcStyleDuration'), of('LayoutDuration')]
  }
  /** The average style and layout ms of one action, over `n` calls of `act`. */
  const measure = async (n, act) => {
    const [s0, l0] = await read()
    for (let k = 0; k < n; k++) {
      await act(k)
      await frame(p)
    }
    const [s1, l1] = await read()
    return { style: (s1 - s0) / n, layout: (l1 - l0) / n }
  }
  const at = async (selector) => (await p.locator(selector).boundingBox())
  const out = { x: 700, y: 300 }

  // ---------- behavior, in real Chromium ----------
  const marks = () => p.evaluate(() => ['data-mouse-in', 'data-key-focus'].filter((a) => document.querySelector('.sidebar__body').hasAttribute(a)))
  /** The opacity of a level's grey line, of a row's thread piece and of a folder's coloured chevron, after the fades. */
  const look = async (folder, note) => {
    await p.waitForTimeout(400)
    return p.evaluate(([f, n]) => {
      const li = (path) => document.querySelector(`[data-path="${path}"]`).parentElement
      // A pseudo-element with no `content` is not drawn: 'none', whatever its opacity reads.
      const drawn = (el, pseudo) => (getComputedStyle(el, pseudo).content === 'none' ? 'none' : getComputedStyle(el, pseudo).opacity)
      return { line: drawn(li(f).querySelector(':scope > ul'), '::before'), thread: drawn(li(n), '::before'), chevron: drawn(li(f), '::after') }
    }, [folder, note])
  }
  const hover = lines === 'hover'
  const shows = lines === 'off' ? '0' : '1'
  await p.mouse.move(out.x, out.y)
  await p.mouse.move(100, 300)
  check(`${name}: the mouse in the list`, await marks(), hover ? ['data-mouse-in'] : [])
  await p.mouse.move(out.x, out.y)
  check(`${name}: the mouse out of the list`, await marks(), [])
  // S2: Tab from the note into the tree, the mouse away. D11: the keys draw no thread.
  await p.focus('#main')
  await p.keyboard.press('Tab')
  check(`${name}: a Tab into a row (S2)`, await marks(), hover ? ['data-key-focus'] : [])
  const keys = await look('Z', 'Z/n0')
  check(`${name}: the lines with the keyboard (S2, D11)`, [keys.line, keys.thread], [shows, style === 'thread' ? '0' : 'none'])
  // S3: a mouse click on a row is no keyboard focus; the mouse leaves, and the lines go with "On hover".
  await p.mouse.click(150, (await at('[data-path="Z/n1"]')).y + ROW / 2)
  check(`${name}: a mouse click on a row (S3)`, await marks(), hover ? ['data-mouse-in'] : [])
  await p.mouse.move(out.x, out.y)
  check(`${name}: the mouse leaves after a click (S3)`, await marks(), [])
  check(`${name}: the lines after a click and the mouse out (S3)`, (await look('Z', 'Z/n1')).line, lines === 'always' ? '1' : '0')
  if (style === 'thread') {
    // D7: the mouse rests on a note: the thread and the coloured chevron of its folder show.
    await p.mouse.move(150, (await at('[data-path="Z/n2"]')).y + ROW / 2)
    check(`${name}: the thread on a resting mouse (D7)`, await look('Z', 'Z/n2'), { line: '1', thread: '1', chevron: '1' })
    // Bug YAZ-3342: the same folder in inline rename draws no coloured chevron.
    await p.evaluate(() => document.querySelector('[data-path="Z"]').parentElement.setAttribute('data-renaming', ''))
    check(`${name}: no coloured chevron on a folder in rename (YAZ-3342)`, (await look('Z', 'Z/n2')).chevron, 'none')
    await p.evaluate(() => document.querySelector('[data-path="Z"]').parentElement.removeAttribute('data-renaming'))
    await p.mouse.move(out.x, out.y)
  }
  await p.evaluate(() => document.activeElement?.blur())

  // ---------- the sticky folder rows (YAZ-3440), in real Chromium ----------
  if (sticky) {
    // A scroll's stuck state shows in the frame after it: two frames, twice.
    const settle = async () => {
      await frame(p)
      await frame(p)
    }
    const ask = (fn, a) => p.evaluate(fn, a)
    const midway = async () => {
      await ask(() => window.scrollRowTo('A/d3/s/n20', 3 * 25.5))
      await settle()
    }
    // D1, D10: in the middle of A/d3/s its three folders stick, one row per level, flush at the top of the list.
    await midway()
    check(`${name}: the stuck stack in a folder, flush at the top (D1, D10)`, await ask(() => window.stuckRows()), [{ path: 'A', top: 0 }, { path: 'A/d3', top: ROW }, { path: 'A/d3/s', top: 2 * ROW }])
    check(`${name}: the top edge of the list is the first stuck row (D10)`, await ask(() => document.elementFromPoint(120, document.querySelector('.sidebar__body').getBoundingClientRect().top + 0.5)?.closest('.tree__row')?.dataset.path), 'A')
    check(`${name}: no line or row paints on a stuck row (D10)`, await ask(() => window.hits()), [])
    // The block of a stuck row: an opaque fill and the thin line under it. A row that is not stuck has none.
    const blocks = await ask(() => ['A', 'A/d3', 'A/d3/s', 'A/d4'].map((f) => window.backing(f)))
    check(`${name}: an opaque block and the line under each stuck row, none on a row not stuck (D10)`, blocks.map((b) => /^rgb\(/.test(b.fill) && b.shadow !== 'none'), [true, true, true, false])
    // D1: at the end of A/d3 the next row pushes its row up, under A's.
    await ask(() => window.scrollRowTo('A/d3/n49', 15))
    await settle()
    checkNear(`${name}: the end of a folder pushes its stuck row away (D1)`, await ask(() => window.stuckRows()), [{ path: 'A', top: 0 }, { path: 'A/d3', top: 15 }])
    // D2: the cap on the list cuts the stack, written by hand here.
    await midway()
    const capped = []
    for (const levels of ['2', '1', '0']) {
      await ask((l) => document.querySelector('.sidebar__body').setAttribute('data-sticky-levels', l), levels)
      await settle()
      capped.push((await ask(() => window.stuckRows())).map((r) => r.path))
    }
    await ask(() => document.querySelector('.sidebar__body').setAttribute('data-sticky-levels', '7'))
    check(`${name}: data-sticky-levels 2, 1 and 0 cut the stack (D2)`, capped, [['A', 'A/d3'], ['A'], []])
    // D2: stickyFolders.ts itself, on a list 150px tall: floor(0.4 × 150 / 25.5) = 2 levels.
    await ask(() => (document.querySelector('.app').style.height = '150px'))
    await settle()
    await midway()
    check(`${name}: a short list sticks 2 levels (D2, stickyFolders.ts)`, [await ask(() => document.querySelector('.sidebar__body').dataset.stickyLevels), (await ask(() => window.stuckRows())).map((r) => r.path)], ['2', ['A', 'A/d3']])
    await ask(() => (document.querySelector('.app').style.height = '800px'))
    await settle()
    check(`${name}: a list 800px tall sticks 7 levels (D2, stickyFolders.ts)`, await ask(() => document.querySelector('.sidebar__body').dataset.stickyLevels), '7')
    // D3: a click on a stuck row's name scrolls its folder to its own place, below the rows stuck above it.
    const landed = []
    for (const f of ['A/d3/s', 'A/d3', 'A']) {
      await midway()
      const wasStuck = await ask((x) => window.goTo(x), f)
      await settle()
      landed.push({ f, wasStuck, ...(await ask((x) => window.place(x), f)), stuckAfter: await ask((x) => window.goTo(x), f) })
    }
    checkNear(`${name}: a click on a stuck row's name lands its folder at its place (D3)`, landed, [
      { f: 'A/d3/s', wasStuck: true, row: 2 * ROW, item: 2 * ROW, stuckAfter: false },
      { f: 'A/d3', wasStuck: true, row: ROW, item: ROW, stuckAfter: false },
      { f: 'A', wasStuck: true, row: 0, item: 0, stuckAfter: false },
    ])
    await ask(() => (document.querySelector('.sidebar__body').scrollTop = 0))
    await settle()
    // D2: a chain 9 folders deep sticks 7 levels at most, and the setting's 5, 3 or 0.
    const deep = await browser.newPage({ viewport: { width: 900, height: 800 } })
    await deep.setContent(page(lines, style, chain(0)))
    const levels = []
    for (const n of [7, 5, 3, 0]) {
      await deep.evaluate((x) => {
        window.stickyStop()
        window.stickyStop = window.sticky.stickyFolders(document.querySelector('.sidebar__body'), x, 1)
        window.scrollRowTo('L8/n10', 300)
      }, n)
      await frame(deep)
      await frame(deep)
      levels.push((await deep.evaluate(() => window.stuckRows())).map((r) => r.top / ROW))
    }
    check(`${name}: 9 open levels stick 7, or the setting's 5, 3 and 0 (D2)`, levels, [[0, 1, 2, 3, 4, 5, 6], [0, 1, 2, 3, 4], [0, 1, 2], []])
    await deep.evaluate(() => {
      window.stickyStop()
      window.stickyStop = window.sticky.stickyFolders(document.querySelector('.sidebar__body'), 7, 1)
      window.scrollRowTo('L8/n10', 300)
    })
    await frame(deep)
    await frame(deep)
    check(`${name}: no line or row paints on a stack 7 levels deep (D10)`, await deep.evaluate(() => window.hits()), [])
    await deep.close()
  }

  // ---------- cost ----------
  const row = {}
  await p.mouse.move(out.x, out.y)
  row.inout = await measure(rounds * 2, (k) => (k % 2 === 0 ? p.mouse.move(100, 300) : p.mouse.move(out.x, out.y)))
  // Frame by frame: the worst frame after an entry or an exit, and the sum of all of its frames.
  let worst = 0
  let sum = 0
  for (let k = 0; k < rounds; k++) {
    // The move's own recalc runs while Chromium handles the input, so the first frame counts from before it.
    let [last] = await read()
    await (k % 2 === 0 ? p.mouse.move(100, 300) : p.mouse.move(out.x, out.y))
    const end = Date.now() + 300
    while (Date.now() < end) {
      await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())))
      const [now] = await read()
      worst = Math.max(worst, now - last)
      sum += now - last
      last = now
    }
  }
  row.frame = { worst, whole: sum / rounds }
  await p.mouse.move(out.x, out.y)
  await p.waitForTimeout(400)
  await p.focus('#main')
  await p.keyboard.press('Tab')
  await p.waitForTimeout(400)
  row.key = await measure(rounds, () => p.keyboard.press('Tab'))
  // A click is measured with the mouse already in the list: its entry is `inout`.
  await p.mouse.move(100, 160)
  await p.waitForTimeout(400)
  row.click = await measure(rounds, (k) => p.mouse.click(100, 160 + (k % 10) * ROW))
  // Inside one folder: the rows of A/d0/s, one after the other.
  const first = await at('[data-path="A/d0/s/n0"]')
  row.row = await measure(rounds * 2, (k) => p.mouse.move(150, first.y + ROW / 2 + (k % 10) * ROW))
  // Across top folders: a note of Z, then the first note of A (A holds about half the tree).
  const z = await at('[data-path="Z/n3"]')
  const a = await at('[data-path="A/d0"]')
  row.cross = await measure(rounds * 2, (k) => p.mouse.move(150, (k % 2 === 0 ? z : a).y + ROW / 2))
  await p.mouse.move(out.x, out.y)
  await p.waitForTimeout(400)
  // Open and close a folder of 50 notes: its list goes into the DOM and out, as React mounts it.
  row.expand = await measure(rounds * 2, (k) =>
    p.evaluate((open) => {
      const li = document.querySelector('[data-path="A/d1/s"]').parentElement
      if (open) li.insertAdjacentHTML('beforeend', window.held)
      else {
        window.held = li.querySelector(':scope > ul').outerHTML
        li.querySelector(':scope > ul').remove()
      }
    }, k % 2 === 1),
  )
  // Scroll (YAZ-3440): the mouse rests in the list, as it does for a wheel or trackpad scroll, and the list moves 2 rows
  // a frame from A/d0, through about 6 ends of folders. Each frame: set scrollTop, then read after that frame's
  // rendering (a task posted from its rAF callback runs after it).
  await p.mouse.move(100, 300)
  await p.evaluate(() => window.scrollRowTo('A/d0', 0))
  await p.waitForTimeout(400)
  const frames = rounds * 15
  const scroll = { frames, worst: { style: 0, layout: 0 }, style: 0, layout: 0 }
  let [s0, l0] = await read()
  for (let k = 0; k < frames; k++) {
    await p.evaluate((dy) => new Promise((r) => {
      document.querySelector('.sidebar__body').scrollTop += dy
      requestAnimationFrame(() => setTimeout(r))
    }), 2 * ROW)
    const [s1, l1] = await read()
    if (s1 - s0 + (l1 - l0) > scroll.worst.style + scroll.worst.layout) scroll.worst = { style: s1 - s0, layout: l1 - l0 }
    scroll.style += (s1 - s0) / frames
    scroll.layout += (l1 - l0) / frames
    ;[s0, l0] = [s1, l1]
  }
  row.scroll = scroll
  if (scroll.worst.style + scroll.worst.layout > budget) failures.push(`${name}: the worst scroll frame is ${(scroll.worst.style + scroll.worst.layout).toFixed(2)} ms, over the ${budget} ms budget (YAZ-3329)`)
  results.push({ name, ...row })
  await p.close()
}
await browser.close()

const rowsInTree = 4 + 1 + 2 * (1 + bigFolders * 102)
console.log(`${rowsInTree} rows, ${rounds} rounds, CSS ${path.relative(repo, cssFile)}; ms per action, style recalc + layout (frame: the worst single frame / the whole fade, style only)`)
const actions = ['inout', 'frame', 'key', 'click', 'row', 'cross', 'expand']
const cell = (r, a) => (a === 'frame' ? `${r.frame.worst.toFixed(2)} / ${r.frame.whole.toFixed(2)}` : `${r[a].style.toFixed(2)} + ${r[a].layout.toFixed(2)}`)
console.log(['case'.padEnd(14), ...actions.map((a) => a.padStart(14))].join(''))
for (const r of results) console.log([r.name.padEnd(14), ...actions.map((a) => cell(r, a).padStart(14))].join(''))
console.log(`\nscroll: ${results[0]?.scroll.frames} frames of 2 rows each; ms per frame, style recalc + layout (budget: worst frame <= ${budget} ms)`)
console.log(['case'.padEnd(14), 'worst frame'.padStart(24), 'mean frame'.padStart(24)].join(''))
const split = (f) => `${(f.style + f.layout).toFixed(2)} (${f.style.toFixed(2)} + ${f.layout.toFixed(2)})`
for (const r of results) console.log([r.name.padEnd(14), split(r.scroll.worst).padStart(24), split(r.scroll).padStart(24)].join(''))
if (!sticky) console.log('\nThe CSS has no sticky folder rows (a build from before YAZ-3440): their checks are skipped.')
if (failures.length > 0) {
  console.error(`\n${failures.length} behavior check(s) failed:\n${failures.map((f) => `  - ${f}`).join('\n')}`)
  process.exitCode = 1
} else console.log(`\nAll behavior checks pass (D3, S2, S3, D7, D11, YAZ-3342${sticky ? '; sticky folders YAZ-3440 D1, D2, D3, D10' : ''}).`)
