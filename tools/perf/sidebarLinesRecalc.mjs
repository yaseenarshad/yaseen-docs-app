#!/usr/bin/env node
/**
 * USAGE: node tools/perf/sidebarLinesRecalc.mjs [--rows 10200] [--rounds 20] [--css <file>] [--only <case,…>]
 *
 * The style and layout cost of the sidebar's level lines and thread (YAZ-3309, bug YAZ-3329), at the scale
 * of a fully open 10,000-note vault. Headless Chromium (Playwright): no window opens, so it is safe on a Mac
 * that someone is using. Local only, not in CI: timings depend on the machine. Run `npm run build` first.
 *
 * It loads the shipped CSS (`desktop/out/renderer/assets/index-*.css`, or `--css`) and builds the DOM of
 * `Tree.tsx` by hand: a small open top folder, then two open top folders of about 5,100 rows each (100
 * folders, each with an open subfolder of 50 notes and 50 notes of its own). The page also runs the real
 * `client/src/sidebar/levelLinesHover.ts` (built with esbuild), as `Sidebar.tsx` does for "On hover".
 *
 * First it checks the behavior that jsdom cannot show, in real Chromium, and exits non-zero if one fails:
 * the mouse in and out of the list sets and clears `data-mouse-in` (D3); a Tab into a row sets
 * `data-key-focus` and shows the lines (S2); a mouse click on a row does not, and the lines go when the
 * mouse leaves (S3); "Always show" and "Never" write nothing; the keys draw no thread (D11); and a folder
 * in inline rename draws no coloured chevron (bug YAZ-3342).
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

// ---------- the DOM of Tree.tsx ----------
const file = (depth, name) => `<li role="treeitem" aria-selected="false"><button type="button" class="tree__row tree__row--file" style="padding-left:${8 + depth * 14 + 14}px" data-path="${name}"><span class="tree__label">${name}</span></button></li>`
const dir = (depth, name, children) =>
  `<li role="treeitem" aria-expanded="${children !== null}" aria-selected="false"><button type="button" class="tree__row tree__row--dir" style="padding-left:${8 + depth * 14}px" data-path="${name}"><span class="tree__chevron${children !== null ? ' tree__chevron--open' : ''}"></span><span class="tree__label">${name}</span></button>${children === null ? '' : `<ul class="tree" role="group" style="--tree-depth:${depth + 1}">${children}</ul>`}</li>`
const notes = (depth, prefix, n) => Array.from({ length: n }, (_, k) => file(depth, `${prefix}/n${k}`)).join('')
const big = (name) => dir(0, name, Array.from({ length: bigFolders }, (_, f) => dir(1, `${name}/d${f}`, dir(2, `${name}/d${f}/s`, notes(3, `${name}/d${f}/s`, 50)) + notes(2, `${name}/d${f}`, 50))).join(''))
const tree = dir(0, 'Z', notes(1, 'Z', 4)) + big('A') + big('B')

/** The real listeners of "On hover" (`levelLinesHover`), as a script: the page has no bundle. Attached as Sidebar.tsx attaches them. */
const listeners = `${transformSync(readFileSync(path.join(repo, 'client/src/sidebar/levelLinesHover.ts'), 'utf8'), { loader: 'ts', format: 'iife', globalName: 'lines' }).code}
  const body = document.querySelector('.sidebar__body')
  if (document.querySelector('.app').dataset.sidebarLines === 'hover') lines.levelLinesHover(body)
`
const page = (lines, style) => `<!doctype html><html><head><style>${css}</style></head><body style="margin:0">
<div class="app" data-sidebar-lines="${lines}" data-sidebar-line-style="${style}" style="--thread-width:2px;display:flex;height:800px">
<aside class="sidebar" style="width:260px;display:flex;flex-direction:column"><div class="sidebar__body" style="overflow:auto"><ul class="tree" role="tree">${tree}</ul></div></aside>
<main id="main" tabindex="-1" style="flex:1">note</main></div><script>${listeners}</script></body></html>`

const browser = await chromium.launch({ headless: true })
const frame = (p) => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
const ROW = 25.5 // 13px * 1.5 + 2 * 3px
const results = []
const failures = []
/** One behavior check: `got` must equal `want`. */
const check = (name, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
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
if (failures.length > 0) {
  console.error(`\n${failures.length} behavior check(s) failed:\n${failures.map((f) => `  - ${f}`).join('\n')}`)
  process.exitCode = 1
} else console.log('\nAll behavior checks pass (D3, S2, S3, D7, D11, YAZ-3342).')
