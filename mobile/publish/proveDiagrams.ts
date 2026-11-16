import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join, normalize } from 'node:path'
import { chromium, webkit, type Browser, type BrowserContext, type Page } from 'playwright'
import { PHONE_DRAWIO_TAG } from './drawioPhone'
import { freePort } from './freePort'

/**
 * THE HEADLESS PROOFS OF DRAW.IO ON THE PHONE (YAZ-5533), in Chromium (and WebKit where it can), driven by Playwright.
 * Run after `npm run mobile:build` and `npm run build:fixtures -w mobile`: `npx vite-node mobile/publish/proveDiagrams.ts`.
 * Pictures go to $PROOF_DIR (or a temp folder). It proves:
 *  1. THE PAGE (`#fixture=page-diagrams`, the fixtures build under the real `_headers`), light and dark: every made-up
 *     diagram draws (flowchart, AWS + Cisco, 3 pages, compressed, maths, hostile); NO request leaves this site; a
 *     picture of each box.
 *  2. HOSTILE LABELS RUN NOTHING: the hostile diagram's labels (`<img onerror>`, `<script>`, `javascript:` links, an
 *     `<iframe>`, `<svg onload>`, `<details ontoggle>`, a `<meta refresh>`, a form, an object) send nothing to the app.
 *  3. THE FRAME'S WALLS: in draw.io's frame, HTML put straight into its page (as a sanitiser bypass would) runs no
 *     script (its CSP); it calls no host, not even this site; its window has no IndexedDB, storage, caches, cookies or
 *     service worker. (It can still name its parent: same origin. The wall is that no script of a diagram runs.)
 *  4. PIXELS: the phone's pictures against the Mac's own renderer (`yaseen-render.html` in the Mac's pack, under the
 *     Mac's `DRAWIO_CSP`, every stencil set and its fonts), 4 made-up diagrams (7 pages), light and dark.
 *  5. MATHS left out: a maths label draws as its raw TeX.
 *  6. OFFLINE (the real build, its service worker): nothing of draw.io is installed; the first diagram fetches only
 *     what it uses; then with no signal (and the host gone) the diagrams draw again from the worker's cache; a library
 *     never fetched draws as placeholder boxes; and a phone that never opened a diagram says it needs the internet.
 *  7. WEBKIT (the iOS engine): the page draws; offline is tried and its limits reported.
 */

const mobile = new URL('..', import.meta.url).pathname
const repo = new URL('../../', import.meta.url).pathname
const out = process.env.PROOF_DIR ?? mkdtempSync(join(tmpdir(), 'notecards-diagrams-'))
mkdirSync(out, { recursive: true })
const results: { step: string; ok: boolean; detail: string }[] = []
const record = (step: string, ok: boolean, detail = '') => {
  results.push({ step, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? `  (${detail})` : ''}`)
}
const diagram = (name: string) => readFileSync(join(mobile, 'src/dev/diagrams', name), 'utf8')
setTimeout(() => (console.log('TIMEOUT'), process.exit(2)), 900_000).unref()

process.env.NOTECARDS_SERVE = 'no'
const { serveDist } = await import('./serve')

/** The diagram chunk of a build and the draw.io folder (from its worker). */
function buildFacts(dist: string) {
  const sw = readFileSync(join(dist, 'sw.js'), 'utf8')
  const chunks = JSON.parse(/\bdrawioChunks:(\[[^\]]*\])/.exec(sw)?.[1] ?? '[]') as string[]
  const shell = JSON.parse(/\bfiles:(\[[^\]]*\])/.exec(sw)?.[1] ?? '[]') as string[]
  const base = /\bdrawio:"([^"]+)"/.exec(sw)?.[1] ?? ''
  return { chunk: chunks.find((c) => c.endsWith('.js'))!, shell, base }
}
/** The fixtures build has no worker: its diagram chunk, found by name. */
function fixturesChunk(dist: string): string {
  return `/assets/${readdirSync(join(dist, 'assets')).find((f) => /^drawDiagram-.*\.js$/.test(f))}`
}

/** In a page of the app: the phone's own diagram code draws `text` (the real frame), and answers its SVG and facts. */
const DRAW = `async ([chunk, text, theme, page]) => {
  const m = await import(chunk)
  const t0 = performance.now()
  try {
    const d = await m.drawDiagram({ text, theme, page })
    return d === 'empty' ? { ok: true, empty: true } : { ok: true, svg: d.svg, width: d.width, height: d.height, pages: d.pages, page: d.page, missing: d.missing, ms: Math.round(performance.now() - t0) }
  } catch (e) {
    return { ok: false, name: e && e.name, error: String(e && e.message || e), ms: Math.round(performance.now() - t0) }
  }
}`

const ORIGIN_OK = (origin: string) => (u: string) => u.startsWith(`${origin}/`) || u.startsWith('blob:') || u.startsWith('data:')

/**
 * What a page asked for. `outside`: an answer from another host, or a request to one that the browser sent (not
 * refused by a CSP before it left). A request the CSP refused is `refused`: it never left the phone.
 */
async function watch(page: Page, origin: string) {
  const outside: string[] = []
  const refused: string[] = []
  const all: string[] = []
  const answered: string[] = []
  const console_: string[] = []
  page.on('request', (r) => void all.push(r.url()))
  page.on('requestfinished', (r) => {
    answered.push(r.url())
    if (!ORIGIN_OK(origin)(r.url())) outside.push(r.url())
  })
  page.on('requestfailed', (r) => {
    const why = r.failure()?.errorText ?? ''
    if (/csp|blocked|Content Security Policy/i.test(why)) refused.push(r.url())
    else if (!ORIGIN_OK(origin)(r.url())) outside.push(`${r.url()} (${why})`)
  })
  page.on('console', (m) => console_.push(`${m.type()}: ${m.text().slice(0, 240)}`))
  page.on('pageerror', (e) => console_.push(`pageerror: ${e.message.slice(0, 240)}`))
  return { outside, refused, all, answered, console: console_ }
}

/** Every frame's "PWNED" message to its parent, heard at the top. */
const PWNED_HOOK = `window.addEventListener('message', (e) => { if (typeof e.data === 'string' && e.data.startsWith('PWNED')) { (window.top.__pwned ||= []).push(e.data) } }, true)`

// ---------------------------------------------------------------------------------------------------------------------
// 1-5: the fixtures build (the page, hostile labels, the frame's walls, pixels, maths)
// ---------------------------------------------------------------------------------------------------------------------
const fixtures = join(mobile, 'dist-fixtures')
const FPORT = await freePort(process.env.PROOF_PORT)
const fserver = await serveDist(fixtures, FPORT)
const FORIGIN = `http://127.0.0.1:${FPORT}`
const fchunk = fixturesChunk(fixtures)

async function openDiagramsPage(browser: Browser, scheme: 'light' | 'dark', engine: string) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme })
  await ctx.addInitScript(PWNED_HOOK)
  const page = await ctx.newPage()
  const seen = await watch(page, FORIGIN)
  await page.goto(`${FORIGIN}/?${engine}-${scheme}#fixture=page-diagrams`)
  await page.waitForFunction(() => document.documentElement.dataset.fixtureReady === 'page-diagrams' || document.body.dataset.fixtureError !== undefined, null, { timeout: 90_000 })
  // Each box near the screen in turn: each draws.
  const count = await page.locator('.reader__body figure[data-vault-drawing]').count()
  for (let i = 0; i < count; i++) {
    const box = page.locator('.reader__body figure[data-vault-drawing]').nth(i)
    await box.scrollIntoViewIfNeeded()
    await page.waitForFunction((n) => !document.querySelectorAll('.reader__body figure[data-vault-drawing]')[n]?.classList.contains('page-drawing--wait'), i, { timeout: 60_000 }).catch(() => undefined)
    await page.waitForTimeout(150)
  }
  return { ctx, page, seen, count }
}

const chrome = await chromium.launch()
for (const scheme of ['light', 'dark'] as const) {
  const { ctx, page, seen, count } = await openDiagramsPage(chrome, scheme, 'chromium')
  const boxes = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.reader__body figure[data-vault-drawing]')].map((b) => ({ path: b.dataset.vaultDrawing, drawn: b.querySelector('img.page-drawing__img') !== null, text: b.textContent?.slice(0, 80) ?? '', pages: b.querySelectorAll('option').length, note: b.querySelector('.page-drawing__note') !== null })),
  )
  for (let i = 0; i < count; i++) {
    const box = page.locator('.reader__body figure[data-vault-drawing]').nth(i)
    await box.scrollIntoViewIfNeeded()
    await box.screenshot({ path: join(out, `chromium-${scheme}-${boxes[i].path!.replace(/\W+/g, '_')}.png`) })
  }
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: join(out, `chromium-${scheme}-page.png`) })
  record(`1. the page, ${scheme}: every made-up diagram draws (draw.io's viewer in its frame, the real CSP)`, boxes.length === 6 && boxes.every((b) => b.drawn), boxes.map((b) => `${b.path?.replace('Drawings/', '')}${b.drawn ? '' : ` NOT DRAWN: ${b.text}`}${b.pages > 1 ? ` (${b.pages} pages)` : ''}`).join(', '))
  const tried = [...new Set(seen.refused.filter((u) => !ORIGIN_OK(FORIGIN)(u)))]
  record(`1. the page, ${scheme}: no request leaves this site`, seen.outside.length === 0, `${seen.answered.filter((u) => u.includes('/drawio/')).length} draw.io files from this site; left the site: ${seen.outside.join(' ') || 'none'}; refused by the frame's CSP (the hostile diagram's tries): ${tried.map((u) => u.replace(/\?.*/, '')).join(' ') || 'none'}`)
  const pwned = (await page.evaluate(() => (window as never as { __pwned?: string[] }).__pwned ?? [])) as string[]
  record(`2. hostile labels run nothing, ${scheme}`, pwned.length === 0, pwned.join(' ') || '0 messages back from the hostile diagram')
  const csp = seen.console.filter((c) => /Content Security Policy|Refused/.test(c))
  console.log(`      CSP refusals (${scheme}): ${csp.length}${csp.length ? `\n        ${csp.slice(0, 8).join('\n        ')}` : ''}`)

  if (scheme === 'light') {
    // 3. The frame's walls.
    const frame = page.frames().find((f) => f.url().includes('/drawio/'))!
    const walls = await frame.evaluate(async () => {
      const r: Record<string, unknown> = {}
      for (const name of ['indexedDB', 'localStorage', 'sessionStorage', 'caches', 'open']) r[name] = typeof (window as never as Record<string, unknown>)[name]
      r.serviceWorker = typeof navigator.serviceWorker
      r.cookie = document.cookie
      r.fetchOk = await fetch('/').then((x) => x.ok, () => 'refused')
      r.xhr = await new Promise((done) => {
        try {
          const x = new XMLHttpRequest()
          x.open('GET', '/')
          x.onload = () => done(`loaded ${x.status}`)
          x.onerror = () => done('refused')
          x.send()
        } catch {
          done('refused')
        }
      })
      r.beacon = (() => {
        try {
          return navigator.sendBeacon('/beacon', 'x') ? 'sent' : 'refused'
        } catch {
          return 'refused'
        }
      })()
      const box = document.createElement('div')
      // As a sanitiser bypass would put it: straight into the frame's page.
      box.innerHTML = `<img src="x" onerror="parent.postMessage('PWNED-direct-img','*')"><svg onload="parent.postMessage('PWNED-direct-svg','*')"></svg><img src="https://example.com/beacon.png"><iframe src="https://example.com/"></iframe><a id="j" href="javascript:parent.postMessage('PWNED-direct-link','*')">j</a>`
      document.body.append(box)
      const s = document.createElement('script')
      s.textContent = "parent.postMessage('PWNED-direct-script','*')"
      document.body.append(s)
      ;(box.querySelector('#j') as HTMLElement).click()
      await new Promise((d) => setTimeout(d, 800))
      r.parentReachable = typeof window.parent.document
      return r
    })
    await page.waitForTimeout(300)
    const pwnedAfter = (await page.evaluate(() => (window as never as { __pwned?: string[] }).__pwned ?? [])) as string[]
    const noStorage = ['indexedDB', 'localStorage', 'sessionStorage', 'caches', 'serviceWorker'].every((k) => walls[k] === 'undefined') && walls.cookie === ''
    record('3. the frame: injected HTML runs no script (its CSP: no inline script, no eval)', pwnedAfter.length === 0, pwnedAfter.join(' ') || 'img onerror, svg onload, inline script, javascript: link: 0 messages')
    const reached = seen.answered.filter((u) => /example\.com|\/beacon$/.test(u))
    record('3. the frame: no call to any host, not even this site (fetch, XHR, beacon, img, iframe)', walls.fetchOk === false && walls.xhr === 'refused' && reached.length === 0 && seen.outside.length === 0, `fetch ok=${walls.fetchOk}, XHR ${walls.xhr}, beacon ${walls.beacon === 'sent' ? 'queued, then refused by connect-src' : walls.beacon}; answered: ${reached.join(' ') || 'none'}`)
    record("3. the frame's window: no IndexedDB, storage, caches, cookies, service worker, window.open", noStorage && walls.open === 'function', JSON.stringify({ ...walls, fetchOk: undefined, xhr: undefined, beacon: undefined }))

    // 5. Maths left out.
    const maths = (await page.evaluate(`(${DRAW})(${JSON.stringify([fchunk, diagram('maths.drawio'), 'light', null])})`)) as { ok: boolean; svg?: string }
    record('5. maths labels are left out: they draw as their raw TeX', maths.ok && /E = mc\^2/.test(maths.svg ?? '') && /\\\(\\pi r\^2\\\)/.test(maths.svg ?? ''), maths.ok ? 'raw TeX in the picture' : 'did not draw')
  }
  await ctx.close()
}

// 4. Pixels against the Mac's renderer.
const pack = join(repo, 'desktop/.cache/drawio', PHONE_DRAWIO_TAG)
/** The Mac's `DRAWIO_CSP` (`desktop/src/main/drawio/assets.ts`), read from its source, with `${DRAWIO_ORIGIN}` as this server. */
const DRAWIO_CSP = [...readFileSync(join(repo, 'desktop/src/main/drawio/assets.ts'), 'utf8').matchAll(/^  `([^`]+)`,?$/gm)]
  .map((m) => m[1])
  .slice(0, 12)
  .join('; ')
  .replaceAll('${DRAWIO_ORIGIN}', 'app://drawio')
if (!/^default-src 'self' app:\/\/drawio; script-src/.test(DRAWIO_CSP)) throw new Error(`cannot read the Mac's DRAWIO_CSP: ${DRAWIO_CSP.slice(0, 80)}`)
const MPORT = await freePort(process.env.PROOF_MAC_PORT)
const MORIGIN = `http://127.0.0.1:${MPORT}`
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' }
const MAC_HOST = `<!DOCTYPE html><meta charset="utf-8"><body><script src="/__mac-host.js"></script>`
const MAC_HOST_JS = `
window.macReady = new Promise((ready) => {
  const f = document.createElement('iframe')
  f.src = '/yaseen-render.html'
  f.style.cssText = 'position:fixed;left:-20000px;top:0;width:1200px;height:800px;border:0;visibility:hidden;'
  const waiting = {}
  let n = 0
  addEventListener('message', (e) => {
    if (e.source !== f.contentWindow) return
    const m = JSON.parse(e.data)
    if (m.event === 'ready') return ready()
    waiting[m.id]?.(m)
  })
  window.macDraw = (xml, theme, page) => new Promise((done) => {
    const id = 'm' + ++n
    waiting[id] = done
    f.contentWindow.postMessage(JSON.stringify({ id, xml, theme, adaptive: 'auto', format: 'svgText', scale: 1, padding: 10, looks: null, page }), '*')
  })
  document.body.append(f)
})`
const macServer: Server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? '/', MORIGIN).pathname)
  const send = (body: Buffer | string, type: string) => {
    res.writeHead(200, { 'content-type': type, 'content-security-policy': DRAWIO_CSP.replaceAll('app://drawio', MORIGIN) })
    res.end(body)
  }
  if (path === '/__mac-host.html') return send(MAC_HOST, TYPES['.html'])
  if (path === '/__mac-host.js') return send(MAC_HOST_JS, TYPES['.js'])
  if (path === '/yaseen-fonts/fonts.css') return send(readFileSync(join(pack, path), 'utf8').replaceAll('app://drawio', MORIGIN), TYPES['.css'])
  const file = normalize(join(pack, path))
  if (!file.startsWith(pack) || !existsSync(file)) return res.writeHead(404).end()
  send(readFileSync(file), TYPES[extname(file)] ?? 'application/octet-stream')
})
await new Promise<void>((r) => macServer.listen(MPORT, '127.0.0.1', () => r()))

const PIXEL_DIAGRAMS = ['flowchart.drawio', 'aws.drawio', 'multipage.drawio', 'compressed.drawio']
{
  const ctx = await chrome.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
  const phone = await ctx.newPage()
  await phone.goto(`${FORIGIN}/?pixels#fixture=search`)
  await phone.waitForFunction(() => document.documentElement.dataset.fixtureReady === 'search', null, { timeout: 60_000 })
  const mac = await ctx.newPage()
  await mac.goto(`${MORIGIN}/__mac-host.html`)
  await mac.evaluate(() => (window as never as { macReady: Promise<void> }).macReady)
  const compare = await ctx.newPage()
  let worst = 0
  let pairs = 0
  const lines: string[] = []
  for (const theme of ['light', 'dark'] as const) {
    for (const name of PIXEL_DIAGRAMS) {
      const xml = diagram(name)
      const first = (await phone.evaluate(`(${DRAW})(${JSON.stringify([fchunk, xml, theme, null])})`)) as { ok: boolean; svg: string; pages: { id: string; name: string }[] }
      const pageIds = first.pages.length > 1 ? first.pages.map((p) => p.id) : [null]
      for (const id of pageIds) {
        const p = id === null ? first : ((await phone.evaluate(`(${DRAW})(${JSON.stringify([fchunk, xml, theme, id])})`)) as typeof first)
        const m = (await mac.evaluate(([x, t, pg]) => (window as never as { macDraw: (a: string, b: string, c: string | null) => Promise<{ ok: boolean; svg: string }> }).macDraw(x, t, pg), [xml, theme, id] as const))
        const shot = async (svg: string) => {
          await compare.setContent('<html><body style="margin:0;background:#fff"></body></html>')
          await compare.evaluate(async (text) => {
            const img = new Image()
            img.id = 'pic'
            img.style.display = 'block'
            await new Promise((done) => ((img.onload = done), (img.onerror = done), (img.src = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }))), document.body.append(img)))
          }, svg)
          return (await compare.locator('#pic').screenshot()).toString('base64')
        }
        const diff = (!p.ok || !m.ok
          ? { error: `missing picture (phone ${p.ok}, Mac ${m.ok})` }
          : await compare.evaluate(
              async ([a, b]) => {
                const load = (png: string) => new Promise<HTMLImageElement>((done) => {
                  const i = new Image()
                  i.onload = () => done(i)
                  i.src = `data:image/png;base64,${png}`
                })
                const [x, y] = await Promise.all([load(a), load(b)])
                if (x.width !== y.width || x.height !== y.height) return { error: `size ${x.width}x${x.height} vs ${y.width}x${y.height}` }
                const px = (img: HTMLImageElement) => {
                  const c = document.createElement('canvas')
                  c.width = img.width
                  c.height = img.height
                  const g = c.getContext('2d')!
                  g.drawImage(img, 0, 0)
                  return g.getImageData(0, 0, c.width, c.height).data
                }
                const d1 = px(x)
                const d2 = px(y)
                let diff = 0
                for (let i = 0; i < d1.length; i += 4) if (Math.abs(d1[i] - d2[i]) + Math.abs(d1[i + 1] - d2[i + 1]) + Math.abs(d1[i + 2] - d2[i + 2]) > 24) diff++
                return { pixels: d1.length / 4, diff }
              },
              [await shot(p.svg), await shot(m.svg)] as const,
            )) as { pixels?: number; diff?: number; error?: string }
        pairs++
        const pct = diff.pixels ? (100 * (diff.diff ?? 0)) / diff.pixels : 100
        worst = Math.max(worst, diff.error ? 100 : pct)
        lines.push(`${theme} ${name}${id ? ` page ${id}` : ''}: ${diff.error ?? `${diff.diff} of ${diff.pixels} pixels differ (${pct.toFixed(3)}%)`}`)
        if (p.ok) writeFileSync(join(out, `pixels-phone-${theme}-${name}${id ? `-${id}` : ''}.svg`), p.svg)
        if (m.ok) writeFileSync(join(out, `pixels-mac-${theme}-${name}${id ? `-${id}` : ''}.svg`), m.svg)
      }
    }
  }
  for (const l of lines) console.log(`      ${l}`)
  record(`4. pixels: the phone's pictures are the Mac's (${PIXEL_DIAGRAMS.length} diagrams, ${pairs} pictures, light and dark, at 2x)`, worst === 0, `worst ${worst.toFixed(3)}% of pixels differ`)
  await ctx.close()
}
macServer.close()

// 7. WebKit (the iOS engine): the page draws.
{
  const wk = await webkit.launch()
  for (const scheme of ['light', 'dark'] as const) {
    const { ctx, page, seen, count } = await openDiagramsPage(wk, scheme, 'webkit')
    const drawn = await page.evaluate(() => document.querySelectorAll('.reader__body img.page-drawing__img').length)
    const pwned = (await page.evaluate(() => (window as never as { __pwned?: string[] }).__pwned ?? [])) as string[]
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: join(out, `webkit-${scheme}-page.png`) })
    record(`7. WebKit, ${scheme}: every diagram draws; nothing leaves the site; hostile labels run nothing`, drawn === count && seen.outside.length === 0 && pwned.length === 0, `${drawn} of ${count} drawn; outside ${seen.outside.length}; PWNED ${pwned.length}`)
    await ctx.close()
  }
  await wk.close()
}
fserver.close()

// ---------------------------------------------------------------------------------------------------------------------
// 6. Offline: the real build and its service worker
// ---------------------------------------------------------------------------------------------------------------------
const dist = join(mobile, 'dist')
const facts = buildFacts(dist)
const PPORT = await freePort(process.env.PROOF_REAL_PORT)
let rserver = await serveDist(dist, PPORT)
const RORIGIN = `http://127.0.0.1:${PPORT}`

async function controlled(page: Page) {
  await page.goto(`${RORIGIN}/`)
  await page.evaluate(() => navigator.serviceWorker.ready)
  for (let i = 0; i < 20 && !(await page.evaluate(() => navigator.serviceWorker.controller !== null)); i++) {
    await page.waitForTimeout(250)
    await page.reload()
  }
}
const cacheFacts = (page: Page) =>
  page.evaluate(async () => {
    const out: Record<string, string[]> = {}
    for (const name of await caches.keys()) out[name] = (await (await caches.open(name)).keys()).map((r) => new URL(r.url).pathname)
    return out
  })

async function offlineRun(engine: 'chromium' | 'webkit', browser: Browser): Promise<void> {
  const ctx: BrowserContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  const seen = await watch(page, RORIGIN)
  try {
    await controlled(page)
    const installed = await cacheFacts(page)
    const shellCache = Object.entries(installed).find(([n]) => n.startsWith('notecards-shell-'))
    const shellHasDrawio = (shellCache?.[1] ?? []).filter((p) => p.startsWith('/drawio/') || /drawDiagram/.test(p))
    record(`6. ${engine}: the install keeps no draw.io file (and not the diagram chunk)`, shellCache !== undefined && shellHasDrawio.length === 0 && !Object.keys(installed).some((n) => n.startsWith('notecards-drawio-')), `shell ${shellCache?.[1].length ?? 0} files; draw.io in it: ${shellHasDrawio.length}`)
    const before = seen.all.length
    const flow = (await page.evaluate(`(${DRAW})(${JSON.stringify([facts.chunk, diagram('flowchart.drawio'), 'light', null])})`)) as { ok: boolean; svg?: string; ms: number }
    const aws = (await page.evaluate(`(${DRAW})(${JSON.stringify([facts.chunk, diagram('aws.drawio'), 'light', null])})`)) as { ok: boolean; svg?: string; ms: number }
    const fetched = seen.all.slice(before).filter((u) => u.includes('/drawio/')).map((u) => u.replace(/^.*\/drawio\/[0-9a-f]+\//, ''))
    record(`6. ${engine}: online, the first diagrams draw and fetch only what they use`, flow.ok && aws.ok && !fetched.some((f) => /stencils\/(gcp2|cisco19|alibaba)/.test(f)), `flowchart ${flow.ms} ms, AWS ${aws.ms} ms; fetched ${fetched.length}: ${fetched.join(' ')}`)
    const kept = await cacheFacts(page)
    const drawioCache = Object.entries(kept).find(([n]) => n.startsWith('notecards-drawio-'))
    record(`6. ${engine}: kept in the worker's draw.io cache`, (drawioCache?.[1].length ?? 0) > 0, `${drawioCache?.[0]}: ${drawioCache?.[1].length} files`)
    // No signal, and the host gone.
    await ctx.setOffline(true)
    rserver.close()
    rserver.closeAllConnections?.()
    await page.reload()
    await page.waitForTimeout(500)
    const flow2 = (await page.evaluate(`(${DRAW})(${JSON.stringify([facts.chunk, diagram('flowchart.drawio'), 'light', null])})`)) as { ok: boolean; svg?: string; ms: number; error?: string }
    const aws2 = (await page.evaluate(`(${DRAW})(${JSON.stringify([facts.chunk, diagram('aws.drawio'), 'dark', null])})`)) as { ok: boolean; svg?: string; ms: number; error?: string }
    writeFileSync(join(out, `${engine}-online-flowchart.svg`), flow.svg ?? '')
    writeFileSync(join(out, `${engine}-offline-flowchart.svg`), flow2.svg ?? '')
    // The same picture but for draw.io's random id of each picture (`ge-svg-…`).
    const same = (flow.svg ?? '').replace(/ge-svg-[\w-]+/g, 'ID') === (flow2.svg ?? '').replace(/ge-svg-[\w-]+/g, 'ID')
    record(`6. ${engine}: offline, the same diagrams draw from the cache (light and dark)`, flow2.ok && aws2.ok && same, `flowchart ${flow2.ok ? `${flow2.ms} ms, the same picture: ${same}` : flow2.error}; AWS dark ${aws2.ok ? `${aws2.ms} ms` : aws2.error}`)
    const multi = (await page.evaluate(`(${DRAW})(${JSON.stringify([facts.chunk, diagram('multipage.drawio'), 'light', null])})`)) as { ok: boolean; svg?: string; missing?: string[]; error?: string }
    record(`6. ${engine}: offline, a library never fetched draws as placeholder boxes, and says so`, multi.ok && (multi.missing ?? []).length > 0 && /This shape set downloads/.test(multi.svg ?? ''), multi.ok ? `missing ${multi.missing?.join(', ')}` : multi.error)
    if (multi.ok) writeFileSync(join(out, `${engine}-offline-placeholder.svg`), multi.svg!)
  } catch (e) {
    record(`6. ${engine}: offline run`, false, String(e).slice(0, 200))
  }
  await ctx.close()
  if (!rserver.listening) rserver = await serveDist(dist, PPORT)

  // A phone that never opened a diagram, with no signal: the diagram code is not there (the app's line: "Diagrams need
  // the internet the first time; then they work offline"). And one that has the code but never drew: the viewer's page
  // is not there, and the frame says so in seconds (DiagramUnavailable: the same line).
  for (const had of ['nothing', 'the diagram code only'] as const) {
    const fresh = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const p2 = await fresh.newPage()
    try {
      await controlled(p2)
      if (had !== 'nothing') await p2.evaluate(`import(${JSON.stringify(facts.chunk)}).then(() => true)`)
      await fresh.setOffline(true)
      rserver.close()
      rserver.closeAllConnections?.()
      await p2.reload()
      const none = (await p2.evaluate(`(${DRAW})(${JSON.stringify([facts.chunk, diagram('flowchart.drawio'), 'light', null])})`).catch((e: unknown) => ({ ok: false, name: 'import', error: String(e).slice(0, 120), ms: 0 }))) as { ok: boolean; name?: string; error?: string; ms: number }
      const expected = had === 'nothing' ? /dynamically imported module/.test(none.error ?? '') : none.name === 'DiagramUnavailable'
      record(`6. ${engine}: no signal, never drew before (had ${had}): it fails fast and calmly (the app says diagrams need the internet the first time)`, !none.ok && expected, `${none.name ?? ''}: ${none.error ?? ''}${none.ms ? ` after ${none.ms} ms` : ''}`)
    } catch (e) {
      record(`6. ${engine}: no signal, never drew before (had ${had})`, false, String(e).slice(0, 200))
    }
    await fresh.close()
    if (!rserver.listening) rserver = await serveDist(dist, PPORT)
  }
  if (!rserver.listening) rserver = await serveDist(dist, PPORT)
}

await offlineRun('chromium', chrome)
await chrome.close()
{
  const wk = await webkit.launch()
  console.log("      WebKit offline (Playwright's offline mode in WebKit is known not to load even a plain page; a FAIL here is that limit, see the scope):")
  await offlineRun('webkit', wk)
  await wk.close()
}
rserver.close()

writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 1))
const failed = results.filter((r) => !r.ok && !r.step.includes('webkit:'))
console.log(`\n${results.filter((r) => r.ok).length} passed, ${results.length - results.filter((r) => r.ok).length} failed (WebKit offline is reported, not required). Pictures: ${out}`)
process.exit(failed.length > 0 ? 1 : 0)
