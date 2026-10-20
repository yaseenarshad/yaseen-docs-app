/**
 * drawio (Draw's YAZ-1802 scenario, ported by YAZ-3044 A19 under YAZ-3028 D5): click a `.drawio` in
 * the tree → draw.io's `load` answer, i.e. the diagram is on screen in the real app. The mark is the
 * scenario's own: a `message` listener in the page sets `window.__drawioLoad` on the first
 * `"event":"load"` draw.io posts, so the app carries no perf code. The window opens on a small note
 * first (every session waits for a painted note), then the row is clicked.
 *
 * Ceiling: `perf["drawio.drawioOpenMs"]` in budget.json (Draw's 760 ms, D5).
 */
import fs from 'node:fs'
import path from 'node:path'
import { writeNote } from '../genVault.mjs'
import { row, session } from '../lib/session.mjs'
import { sleep } from '../lib/app.mjs'

/** A draw.io file of `n` rounded boxes in a 6-wide grid, each joined to the one before (Draw's fixture). */
export function flowDiagram(n) {
  const cells = []
  for (let i = 0; i < n; i++) {
    cells.push(`<mxCell id="v${i}" value="Step ${i + 1}" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="${(i % 6) * 180}" y="${Math.floor(i / 6) * 120}" width="140" height="60" as="geometry"/></mxCell>`)
    if (i > 0) cells.push(`<mxCell id="e${i}" style="edgeStyle=orthogonalEdgeStyle;html=1;" edge="1" parent="1" source="v${i - 1}" target="v${i}"><mxGeometry relative="1" as="geometry"/></mxCell>`)
  }
  return `<mxfile host="yaseen-docs-perf"><diagram id="perf" name="Page-1"><mxGraphModel grid="0" page="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells.join('')}</root></mxGraphModel></diagram></mxfile>\n`
}

export function setup(dir) {
  const vault = path.join(dir, 'vault')
  const small = writeNote(vault, 'Small', 'bullets', 20)
  const flow = path.join(vault, 'Flow.drawio')
  fs.writeFileSync(flow, flowDiagram(30))
  return { profile: path.join(dir, 'profile'), vault, small, flow }
}

export function run(app, { profile, vault, small, flow }) {
  return session(app, { profile, wins: [{ id: 'w1', root: vault, tabs: [small] }], doc: 'Small' }, async ({ page }) => {
    await sleep(1000)
    await page.ev(`window.addEventListener('message', (e) => { if (typeof e.data === 'string' && e.data.includes('"event":"load"')) window.__drawioLoad ??= performance.now() })`)
    const clickedAt = await page.ev(`(() => { const t = performance.now(); document.querySelector(${JSON.stringify(row(flow))}).click(); return t })()`)
    await page.waitFor('window.__drawioLoad', 30_000)
    return { drawioOpenMs: (await page.ev('window.__drawioLoad')) - clickedAt }
  })
}
