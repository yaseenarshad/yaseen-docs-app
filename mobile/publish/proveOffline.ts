import { spawn } from 'node:child_process'
import type { Server } from 'node:http'
import { connect } from 'node:net'
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The headless check of the real build (YAZ-5087). Chrome with NO window (`--headless=new`), driven through the DevTools
 * protocol; the build served by `serve.ts` (the `_headers` rules, the single-page fallback). It proves:
 *  1. the app loads with zero CSP violations and zero errors, and the service worker installs and keeps the shell;
 *  2. the CSP is live (a call to another origin is refused);
 *  3. with the host gone, a second open still shows the app, a lazy chunk still loads, the friend page still opens;
 *     YAZ-5593: Check for updates' question (the worker reads `/version.txt` with no cache) names the served build
 *     online (2b) and says "no answer from the host" offline (3e), with no CSP violation;
 *  4. a new deploy installs in the background; it NEVER runs by itself (YAZ-5555): after the browser activated it, a
 *     cold open still runs the old version and the worker's state says a new one is ready; the Restart's load
 *     (`?notecards-update=1`) runs it, and from then on every open does;
 *  5. a broken deploy (a chunk missing) never installs; the last good version keeps working, also offline;
 *  6. dark mode paints the dark background.
 * YAZ-5644: every step runs in a plain browser tab (a computer's tab): the whole app runs there (1g: the sign-in, the worker,
 * the storage; no install wall, no install hint on a computer); 1h opens the same build as the Home Screen app.
 * Run after `npm run mobile:build`: `npx vite-node mobile/publish/proveOffline.ts`. Pictures go to $PROOF_DIR (or a temp folder).
 */

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const mobile = new URL('..', import.meta.url).pathname
const PORT = Number(process.env.PROOF_PORT ?? 8917)
const DEBUG = 9339
// PROOF_URL: check the LIVE site instead (read-only). Steps 1 to 3 and 6 run; "offline" is Chrome's own offline mode;
// the deploy steps (4, 5) need a host of our own and are skipped.
const LIVE = process.env.PROOF_URL?.replace(/\/+$/, '')
const ORIGIN = LIVE ?? `http://127.0.0.1:${PORT}`
const work = mkdtempSync(join(tmpdir(), 'notecards-proof-'))
const out = process.env.PROOF_DIR ?? mkdtempSync(join(tmpdir(), 'notecards-proof-pictures-'))
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const results: { step: string; ok: boolean; detail: string }[] = []
const record = (step: string, ok: boolean, detail = '') => {
  results.push({ step, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? `  (${detail})` : ''}`)
}

// ---- three deploys: v1 = the build; v2 = a new version; v3 = a broken deploy (one chunk missing) ----
const v1 = LIVE ? join(mobile, 'dist') : join(work, 'v1')
if (!LIVE) cpSync(join(mobile, 'dist'), v1, { recursive: true })
const swVersion = (dir: string) => /version:"([0-9a-z-]+)"/.exec(readFileSync(join(dir, 'sw.js'), 'utf8'))![1]
const deploy = (from: string, name: string, change: (dir: string) => void) => {
  const dir = join(work, name)
  cpSync(from, dir, { recursive: true })
  const sw = join(dir, 'sw.js')
  writeFileSync(sw, readFileSync(sw, 'utf8').replaceAll(swVersion(from), `${name}-proof`))
  change(dir)
  return dir
}
// The QR reader's chunk of v1 is NOT in v2 (as a deploy whose chunk names changed): an old page must still load it.
const qrChunk = readdirSync(join(mobile, 'dist', 'assets')).find((f) => f.startsWith('qrDecode-'))!
const v2 = LIVE ? '' : deploy(v1, 'v2', (dir) => {
  const sw = join(dir, 'sw.js')
  writeFileSync(sw, readFileSync(sw, 'utf8').replace(`"/assets/${qrChunk}",`, ''))
  unlinkSync(join(dir, 'assets', qrChunk))
  const html = join(dir, 'index.html')
  writeFileSync(html, readFileSync(html, 'utf8').replace('<title>', '<meta name="proof" content="v2" /><title>'))
})
// The worker file that the checked site serves (live: fetched; local: the build).
/** YAZ-5593: the page's question to the worker for "Check for updates" (`VERSION_ASK`), its answer as JSON. */
const ASK_SERVED = `new Promise((resolve) => {
  const channel = new MessageChannel()
  const timer = setTimeout(() => resolve('no answer'), 15000)
  channel.port1.onmessage = (event) => { clearTimeout(timer); resolve(JSON.stringify(event.data)) }
  navigator.serviceWorker.controller.postMessage({ type: 'notecards:version' }, [channel.port2])
})`
const swText = LIVE ? await fetch(`${LIVE}/sw.js`).then((r) => r.text()) : readFileSync(join(v1, 'sw.js'), 'utf8')
const shellList = JSON.parse(/\bfiles:(\[[^\]]*\])/.exec(swText)![1]) as string[]
const engine = shellList.find((f) => f.startsWith('/assets/engine-'))!.slice('/assets/'.length)
// A broken deploy: its worker lists a NEW chunk that the host does not have (a chunk the phone already has, by its
// hashed name, is copied from the kept version and is no fault).
const v3 = LIVE ? '' : deploy(v2, 'v3', (dir) => {
  const sw = join(dir, 'sw.js')
  writeFileSync(sw, readFileSync(sw, 'utf8').replace(`"/assets/${engine}"`, '"/assets/engine-NOTONHOST.js"'))
  unlinkSync(join(dir, 'assets', engine))
})

// The kill switch (YAZ-5285): the v2 deploy with `src/pwa/swKill.ts` as its worker (local only; never published here).
const vkill = LIVE ? '' : join(work, 'vkill')
if (!LIVE) {
  const { build } = await import('esbuild')
  cpSync(v2, vkill, { recursive: true })
  const out = await build({ entryPoints: [join(mobile, 'src/pwa/swKill.ts')], bundle: true, write: false, format: 'iife', minify: true, target: 'safari15' })
  writeFileSync(join(vkill, 'sw.js'), `// kill switch (proof)\n${out.outputFiles[0].text}`)
}

// ---- the host: serve.ts in this process (stopped for real: every open connection is cut) ----
process.env.NOTECARDS_SERVE = 'no'
const { serveDist } = await import('./serve')
let server: Server | null = null
// "Offline" must mean that NOTHING answers on the port: another program that listens on it (on any address) would
// answer while our host is down.
const portTaken = () =>
  new Promise<boolean>((resolve) => {
    const socket = connect({ host: '127.0.0.1', port: PORT }, () => (socket.destroy(), resolve(true)))
    socket.on('error', () => resolve(false))
  })
if (!LIVE && (await portTaken())) throw new Error(`port ${PORT} is taken by another program: set PROOF_PORT`)
async function host(dir: string | null) {
  if (LIVE) {
    await send('Network.emulateNetworkConditions', { offline: dir === null, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, page)
    return
  }
  if (server) {
    const s = server
    server = null
    s.closeAllConnections()
    await new Promise((r) => s.close(r))
  }
  if (dir !== null) server = await serveDist(dir, PORT)
  else if (await portTaken()) throw new Error(`something else answers on port ${PORT}`)
}

// ---- Chrome with no window, and a small DevTools client ----
// A watchdog: the whole check ends within 8 minutes.
setTimeout(() => {
  console.log('TIMEOUT', JSON.stringify(results.at(-1)), [...new Set(versions)].join(' '))
  process.exit(2)
}, 480_000).unref()
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${process.env.PROOF_PROFILE ?? join(work, 'profile')}`, '--no-first-run', '--no-default-browser-check', '--window-size=390,844', ...(process.env.PROOF_CHROME_ARGS ? process.env.PROOF_CHROME_ARGS.split(' ') : []), 'about:blank'], { stdio: 'ignore' })
let browserWs = ''
for (let i = 0; i < 50 && !browserWs; i++) {
  await wait(200)
  browserWs = await fetch(`http://127.0.0.1:${DEBUG}/json/version`).then((r) => r.json()).then((j) => j.webSocketDebuggerUrl, () => '')
}
const ws = new WebSocket(browserWs)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let seq = 0
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
const listeners: ((m: any) => void)[] = []
ws.addEventListener('message', (e) => {
  const m = JSON.parse(String(e.data))
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id)!
    pending.delete(m.id)
    if (m.error) p.reject(new Error(`${m.error.message}`))
    else p.resolve(m.result)
  } else listeners.forEach((l) => l(m))
})
const send = (method: string, params: object = {}, sessionId?: string): Promise<any> =>
  new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params, sessionId }))
  })

// Every message of the page and of the service worker: console, errors, CSP reports.
let page = ''
const versions: string[] = []
const log: { where: string; level: string; text: string }[] = []
listeners.push((m) => {
  const where = m.sessionId === page ? 'page' : 'worker'
  if (m.method === 'Runtime.consoleAPICalled' && process.env.PROOF_TRACE) console.log('  console:', m.params.args.map((a: any) => a.value ?? a.description).join(' '))
  if (m.method === 'Runtime.consoleAPICalled') log.push({ where, level: m.params.type, text: m.params.args.map((a: any) => a.value ?? a.description).join(' ') })
  if (m.method === 'Runtime.exceptionThrown') log.push({ where, level: 'exception', text: m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text })
  if (process.env.PROOF_TRACE && (m.method === 'Log.entryAdded' || m.method === 'Runtime.exceptionThrown')) console.log(`  ${new Date().toISOString().slice(14, 23)} [${where}] ${(m.params.entry?.text ?? m.params.exceptionDetails?.exception?.description ?? '').slice(0, 160)}`)
  if (m.method === 'Log.entryAdded') log.push({ where, level: m.params.entry.level, text: m.params.entry.text })
})
const csp = () => log.filter((l) => /Content Security Policy/i.test(l.text))
const errors = () => log.filter((l) => /error|exception/.test(l.level))

// The worker is NOT attached to DevTools: an attached worker is restarted and held by Chrome, which changes the very
// timing this check measures. Its errors still arrive through the page's ServiceWorker domain (below), and step 1c
// proves that its own fetches worked (the whole shell is kept).
const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
page = (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId
for (const domain of ['Page', 'Runtime', 'Log', 'Network']) await send(`${domain}.enable`, {}, page)
// The worker versions as Chrome sees them (installing, installed, activating, activated, redundant).
listeners.push((m) => {
  if (m.method === 'ServiceWorker.workerVersionUpdated')
    for (const v of m.params.versions) {
      versions.push(`${v.versionId}:${v.status}/${v.runningStatus}`)
      if (process.env.PROOF_TRACE) console.log(`  sw ${new Date().toISOString().slice(14, 23)} ${v.versionId}:${v.status}/${v.runningStatus}`)
    }
  if (m.method === 'ServiceWorker.workerErrorReported') log.push({ where: 'worker', level: 'error', text: m.params.errorMessage.errorMessage })
})
await send('ServiceWorker.enable', {}, page)
const docHeaders: Record<string, string>[] = []
// Every request URL the page makes (the friend code must never be in one).
const requested: string[] = []
listeners.push((m) => m.sessionId === page && m.method === 'Network.requestWillBeSent' && requested.push(m.params.request.url))
// Every chunk the page got as HTML (YAZ-5303), with who answered it (the worker or the host).
const htmlChunks: string[] = []
listeners.push((m) => {
  if (m.sessionId !== page || m.method !== 'Network.responseReceived') return
  const r = m.params.response
  if (/\/assets\/.+\.(js|css)$/.test(new URL(r.url).pathname) && /text\/html/.test(r.mimeType ?? '')) {
    htmlChunks.push(`${new URL(r.url).pathname} (${r.fromServiceWorker ? 'worker' : 'host'})`)
    if (process.env.PROOF_TRACE) console.log(`  ${new Date().toISOString().slice(14, 23)} HTML for ${new URL(r.url).pathname} from ${r.fromServiceWorker ? 'the worker' : 'the host'}`)
  }
})
// Trace only: the page's requests that are still open (a request the worker holds keeps the old worker busy).
const open_ = new Map<string, { url: string; t: number }>()
listeners.push((m) => {
  if (!process.env.PROOF_TRACE || m.sessionId !== page) return
  if (m.method === 'Network.requestWillBeSent') open_.set(m.params.requestId, { url: m.params.request.url, t: Date.now() })
  if (m.method === 'Network.loadingFinished' || m.method === 'Network.loadingFailed') open_.delete(m.params.requestId)
})
if (process.env.PROOF_TRACE) setInterval(() => open_.size && console.log('  still open:', [...open_.values()].map((v) => `${v.url} ${Date.now() - v.t} ms`).join(', ')), 3000).unref()
listeners.push((m) => m.sessionId === page && m.method === 'Network.responseReceived' && m.params.type === 'Document' && docHeaders.push(m.params.response.headers))

const evaluate = async (expression: string) => {
  const r = await Promise.race([send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, page), wait(10_000).then(() => { throw new Error(`no answer: ${expression}`) })])
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
  return r.result.value
}
const loaded = () => new Promise<void>((resolve) => listeners.push((m) => m.sessionId === page && m.method === 'Page.loadEventFired' && resolve()))
async function open(url: string) {
  const done = loaded()
  const t0 = Date.now()
  if (process.env.PROOF_TRACE) console.log(`  ${new Date().toISOString().slice(14, 23)} open ${url}`)
  const went = await Promise.race([send('Page.navigate', { url }, page).then(() => true), wait(15_000).then(() => false)])
  if (!went) console.log(`  (the open of ${url} had no answer in 15 s)`)
  if (process.env.PROOF_TRACE) console.log(`  navigate ${url}: ${Date.now() - t0} ms`)
  await Promise.race([done, wait(8000)])
  await wait(800)
}
async function until(expression: string, ms = 10_000) {
  for (const end = Date.now() + ms; Date.now() < end; await wait(200)) if (await evaluate(expression).catch(() => false)) return true
  return false
}
async function shot(name: string) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' }, page)
  writeFileSync(join(out, `${name}.png`), Buffer.from(data, 'base64'))
}
const text = () => evaluate('document.body.innerText')
/** Each next document is the Home Screen app (iOS's `navigator.standalone`) until `asTab` with the returned id. */
const asHomeScreenApp = async (): Promise<string> => (await send('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(Navigator.prototype, 'standalone', { configurable: true, get: () => true })` }, page)).identifier
const asTab = (id: string) => send('Page.removeScriptToEvaluateOnNewDocument', { identifier: id }, page)
const shellCaches = `caches.keys().then(ks => ks.filter(k => k.startsWith('notecards-shell-')).sort())`

try {
  // 0. LIVE with PROOF_EXPECT_UPDATE: this browser profile had the previous build. The new one must install, take over,
  // and run at a later open.
  if (LIVE && process.env.PROOF_EXPECT_UPDATE) {
    // The previous live build may be one that ran only as the Home Screen app.
    const asApp0 = await asHomeScreenApp()
    const liveEntry = /src="(\/assets\/index-[^"]+\.js)"/.exec(await fetch(`${ORIGIN}/`).then((r) => r.text()))![1]
    await open(`${ORIGIN}/`)
    // Which build runs: is the live worker's version stored yet? (An icon-only change keeps the entry's name.)
    const liveVersion = /version:"([0-9a-z-]+)"/.exec(swText)![1]
    const before = await evaluate(`Promise.all([navigator.serviceWorker.controller !== null, document.querySelector('script[src*="/assets/index-"]').getAttribute('src'), caches.has('notecards-shell-${liveVersion}')])`)
    if (process.env.PROOF_TRACE) console.log('  caches at 0a:', JSON.stringify(await evaluate(`caches.keys()`)))
  record('0a the profile runs the previous build from its worker', before[0] === true && before[2] === false, `page ${before[1]}; the live version ${liveVersion} ${before[2] ? 'IS already stored' : 'is not stored yet'}`)
    // The old app asks for a new version at its start; the new one installs and waits (the open page stays old).
    const waits = await until(`navigator.serviceWorker.getRegistration().then(r => !!r.waiting && r.waiting.state === 'installed')`, 30_000)
    record('0b the new build installs in the background and waits', waits)
    // The next open: Chrome activates the waiting version once no page of the old one is open.
    const t0 = Date.now()
    await open('about:blank')
    await open(`${ORIGIN}/`)
    const took = await until(`navigator.serviceWorker.getRegistration().then(r => !r.waiting && !r.installing && r.active.state === 'activated')`, 60_000)
    record('0c it activates at the next open (the old build stays kept)', took, `${((Date.now() - t0) / 1000).toFixed(1)} s`)
    // YAZ-5555: the Restart's load (from a worker of an older rule, the activation itself chose it).
    await open(`${ORIGIN}/?notecards-update=1`)
    const after = await evaluate(`document.querySelector('script[src*="/assets/index-"]').getAttribute('src')`)
    record('0d the open after that runs the new build', after === liveEntry, after)
    await asTab(asApp0)
  }

  // 1. Online, the first open.
  await host(v1)
  // YAZ-5644: a plain browser tab, as on a computer (no Home Screen app): the app runs here whole.
  await open(`${ORIGIN}/`)
  record('1a the app shows (sign-in)', (await until(`!!document.querySelector('input[name="token"]')`)), '')
  const h = docHeaders.at(-1) ?? {}
  record('1b the page has the CSP, no-referrer, nosniff, the camera rule', Boolean(h['content-security-policy']?.includes('connect-src https://api.github.com') && h['referrer-policy'] === 'no-referrer' && h['x-content-type-options'] === 'nosniff' && h['permissions-policy']?.includes('camera=(self)')))
  const active = await until(`navigator.serviceWorker.ready.then(r => r.active && r.active.state === 'activated')`)
  const controlled = await until(`navigator.serviceWorker.controller !== null`)
  const swVer = /version:"([0-9a-z-]+)"/.exec(swText)![1]
  const kept = await evaluate(`caches.has('notecards-shell-${swVer}').then(async has => has ? (await (await caches.open('notecards-shell-${swVer}')).keys()).length : 0)`)
  const expected = shellList.length
  record('1c the service worker installs, takes the page, keeps the whole shell', active && controlled && kept === expected, `${kept} of ${expected} files`)
  record('1d zero CSP violations, zero errors (page and worker)', csp().length === 0 && errors().length === 0, `${csp().length} CSP, ${errors().length} errors`)
  await shot('1-online-light')
  // 1g. YAZ-5644: that was a browser tab, and the whole app runs in it: the sign-in (1a), the worker (1c), and the
  // storage (the app's database is open). No install wall; no install hint on a computer.
  const tab = await evaluate(`Promise.all([navigator.standalone === undefined && !matchMedia('(display-mode: standalone)').matches, indexedDB.databases().then(d => d.map(x => x.name)), !document.body.innerText.includes('Install the app first'), !document.querySelector('section.install')])`)
  record('1g a browser tab runs the whole app: sign-in, worker, storage; no wall, no hint on a computer', tab[0] === true && tab[1].includes('notecards') && tab[2] && tab[3], `databases ${JSON.stringify(tab[1])}`)
  // 1h. The same build as the Home Screen app: the same start (the sign-in, under the worker), no hint.
  const app = await asHomeScreenApp()
  await open(`${ORIGIN}/`)
  const asApp = (await until(`!!document.querySelector('input[name="token"]') && navigator.standalone === true`)) && (await evaluate(`navigator.serviceWorker.controller !== null && !document.querySelector('section.install')`)) === true
  record('1h the Home Screen app opens the same app (sign-in, under the worker), with no hint', asApp)
  await asTab(app)

  // 1e. The friend link, online: the page shows the code; the code is in the fragment only, in no request.
  const CODE = 'bb5a315d61ae9438b18e'
  const sentBefore = requested.length
  await open(`${ORIGIN}/friend#${CODE}`)
  const shows = await until(`document.getElementById('code')?.value === '${CODE}'`)
  const leaked = requested.slice(sentBefore).filter((u) => u.includes(CODE))
  record('1e the friend page shows the code; no request carries it', shows && leaked.length === 0 && requested.length > sentBefore, `${requested.length - sentBefore} requests, ${leaked.length} with the code`)
  await open(`${ORIGIN}/`)

  // 1f. YAZ-5290: the group and join links have their landing page; the code stays in the fragment.
  for (const [path, code, shown] of [
    ['/group', CODE, CODE],
    ['/join', `${CODE}-${CODE}`, `${ORIGIN}/join#${CODE}-${CODE}`],
  ] as const) {
    const before = requested.length
    await open(`${ORIGIN}${path}#${code}`)
    const ok = await until(`document.getElementById('code')?.value === '${shown}' && !document.getElementById('has-code').hidden`)
    const leaked = requested.slice(before).filter((u) => u.includes(CODE))
    record(`1f ${path}#… shows its landing page and code; no request carries it`, ok && leaked.length === 0, `${requested.length - before} requests, ${leaked.length} with the code`)
  }
  await open(`${ORIGIN}/`)

  // 2. The CSP is live: a call to another origin is refused (this violation is on purpose).
  const before = csp().length
  const refused = await evaluate(`fetch('https://example.com/').then(() => 'allowed', () => 'refused')`)
  await wait(300)
  record('2 the CSP refuses a call to another origin', refused === 'refused' && csp().length > before, `${refused}`)
  const onPurpose = csp().length

  // 2b. YAZ-5593: Check for updates asks the worker what the host serves (the page's CSP lets it fetch only GitHub):
  // the worker reads /version.txt with no cache and names this build; no CSP violation.
  const servedText = LIVE ? await fetch(`${LIVE}/version.txt`, { cache: 'no-store' }).then((r) => r.text()) : readFileSync(join(v1, 'version.txt'), 'utf8')
  const servedOnline = await evaluate(ASK_SERVED)
  const [servedCommit, servedWorker] = servedText.trim().split('\n')
  record('2b Check for updates: the worker reads /version.txt (no cache) and names the served build', servedOnline === JSON.stringify({ commit: servedCommit, worker: servedWorker }) && csp().length === onPurpose, `${servedOnline}`)

  // 3. The host is gone: a second open.
  await host(null)
  await open(`${ORIGIN}/`)
  record('3a offline: the app opens from the worker', await until(`!!document.querySelector('input[name="token"]')`))
  const chunk = await evaluate(`import('/assets/${engine}').then(() => 'loaded', e => String(e))`)
  record('3b offline: the lazy sync engine chunk loads', chunk === 'loaded', String(chunk))
  await open(`${ORIGIN}/friend#aa5a315d61ae9438b18d`)
  record('3c offline: the friend page opens and shows the code', await until(`document.getElementById('code')?.value === 'aa5a315d61ae9438b18d' && document.body.innerText.includes('Copy this code. Open the app. Tap Paste.')`))
  await shot('3-friend-offline')
  await open(`${ORIGIN}/some/route`)
  record('3d offline: any other address opens the app (single-page)', await until(`!!document.querySelector('input[name="token"]')`))
  await shot('3-offline-app')
  // 3e. YAZ-5593: offline, the same question has no answer from the host (null): Settings says it cannot reach the
  // server; nothing reloads (the page is the same document after it).
  await evaluate(`window.__sameDocument = true`)
  const servedOffline = await evaluate(ASK_SERVED)
  record('3e offline: Check for updates finds no server (null), and the page does not reload', servedOffline === 'null' && (await evaluate(`window.__sameDocument === true`)) === true, `${servedOffline}`)

  if (process.env.PROOF_TRACE) console.log('versions so far:', versions.slice(-6).join(' '))
  if (!LIVE) {
  // 4. A new deploy.
  if (process.env.PROOF_TRACE) console.log('--- v2 up')
  await host(v2)
  await open(`${ORIGIN}/`)
  const waits = await until(`navigator.serviceWorker.getRegistration().then(r => !!r && !!r.waiting && r.waiting.state === 'installed')`, 15_000)
  const stillOld = !(await evaluate(`!!document.querySelector('meta[name=proof]')`))
  if (process.env.PROOF_TRACE) console.log('versions:', [...new Set(versions)].slice(-10).join(' '))
  record('4a the new version installs in the background; the open page stays on the old one', waits && stillOld)
  // YAZ-5555: nothing asks the waiting version to take over. Chrome activates it by itself once no page of the old one
  // is open (a cold start: the tab leaves the site, then opens it again). The open still runs the OLD version: the
  // worker keeps the chosen one; its state says a new one is ready (the app shows "A new version is ready" + Restart).
  const t0 = Date.now()
  let took = false
  for (let i = 0; i < 12 && !took; i++) {
    await open('about:blank')
    await wait(1000)
    await open(`${ORIGIN}/`)
    took = await until(`navigator.serviceWorker.getRegistration().then(r => !!r && !r.waiting && r.active.state === 'activated' && r.active.scriptURL.endsWith('/sw.js'))`, 5_000)
    if (took) took = (await evaluate(`new Promise((ok) => { const c = new MessageChannel(); c.port1.onmessage = (e) => ok(e.data); navigator.serviceWorker.controller.postMessage({ type: 'notecards:state' }, [c.port2]); setTimeout(() => ok(null), 2000) }).then(s => !!s && s.active.endsWith('v2-proof'))`).catch(() => false)) === true
  }
  const tookMs = Date.now() - t0
  await open('about:blank')
  await open(`${ORIGIN}/`)
  const stillV1 = (await until(`!!document.querySelector('input[name="token"]')`, 10_000)) && !(await evaluate(`!!document.querySelector('meta[name=proof]')`))
  const state = await evaluate(`new Promise((ok) => { const c = new MessageChannel(); c.port1.onmessage = (e) => ok(e.data); navigator.serviceWorker.controller.postMessage({ type: 'notecards:state' }, [c.port2]); setTimeout(() => ok(null), 2000) })`).catch(() => null)
  const told = state !== null && state.active !== state.chosen && String(state.active).endsWith('v2-proof')
  record('4b the browser activates the new version, yet a cold open still runs the old one; the state says a new one is ready', took && stillV1 && told, `activated ${(tookMs / 1000).toFixed(1)} s after the first open; state ${JSON.stringify(state)}`)
  // The tap on Restart loads the address with the update mark: the worker chooses the new version; the app drops the mark.
  await open(`${ORIGIN}/?notecards-update=1`)
  const restarted = (await until(`!!document.querySelector('meta[name=proof]') && !!document.querySelector('input[name="token"]')`, 10_000)) && (await evaluate(`location.search`)) === ''
  await open('about:blank')
  await open(`${ORIGIN}/`)
  const stays = await until(`!!document.querySelector('meta[name=proof]') && !!document.querySelector('input[name="token"]')`, 10_000)
  record('4c the Restart runs the new version (the mark leaves the address), and every later open does', restarted && stays)
  // 4d (YAZ-5303): no page of the old version is left now: the new page's "page ready" removes the old cache.
  await until(`caches.keys().then(ks => ks.filter(k => k.startsWith('notecards-shell-')).length === 1)`, 10_000)
  const left = await evaluate(shellCaches)
  record('4d with no page of the old version left, only the new version stays', left.length === 1 && left[0].endsWith('v2-proof'), JSON.stringify(left))

  // 5. A broken deploy.
  await host(v3)
  await open(`${ORIGIN}/`)
  await wait(3000)
  const reg = await evaluate(`navigator.serviceWorker.getRegistration().then(r => ({ waiting: !!r.waiting, installing: !!r.installing, active: r.active && r.active.scriptURL }))`)
  const v3cache = (await evaluate(shellCaches)).some((k: string) => k.includes('v3'))
  record('5a a deploy with a missing chunk never installs; nothing of it is kept', !reg.waiting && !reg.installing && !v3cache, JSON.stringify(reg))
  await open(`${ORIGIN}/`)
  record('5b the last good version keeps running', await until(`!!document.querySelector('meta[name=proof]') && !!document.querySelector('input[name="token"]')`))
  await host(null)
  await open(`${ORIGIN}/`)
  record('5c and offline too', await until(`!!document.querySelector('meta[name=proof]') && !!document.querySelector('input[name="token"]')`))

  }
  // 6. Dark mode.
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }, page)
  await open(`${ORIGIN}/`)
  const bg = await evaluate(`getComputedStyle(document.body).backgroundColor`)
  record('6 dark mode: the dark background', bg === 'rgb(30, 30, 30)', bg)
  await shot('6-offline-dark')

  if (!LIVE) {
    // 8. "Try again" (lazyScreen): a chunk that failed once loads on the next import, when the host has it again.
    await host(v2)
    await open(`${ORIGIN}/`)
    const late = 'late-proof.js'
    const first = await evaluate(`import('/assets/${late}').then(() => 'loaded', () => 'failed')`)
    writeFileSync(join(v2, 'assets', late), 'export const late = 1\n')
    const again = await evaluate(`import('/assets/${late}').then(() => 'loaded', () => 'failed')`)
    // What keeps a failure: the worker (a fetch through it), or the browser's module map (the same address imported again)?
    const fresh = await evaluate(`import('/assets/${late}?again').then(() => 'loaded', () => 'failed')`)
    record('8a after a failed chunk, the worker passes the next request to the host (it keeps no failure)', fresh === 'loaded', `the same file under a new address: ${fresh}`)
    // A finding, not a step of 5-: Chrome keeps a failed import of an address for the life of the page (the module map),
    // so a "Try again" that imports the same chunk again fails again until the page loads again.
    console.log(`NOTE  8b the SAME chunk address imported again after a failure: ${first}, then ${again}${again === 'failed' ? ' (the browser keeps the failure until a reload)' : ''}`)
    // 8c. YAZ-5300: with no worker in control (a first visit), a chunk's stylesheet that failed once has its rules after
    // Try again, which links it again (`relinkFailedStyles`, the same steps here: a NEW link to the same file).
    await send('Network.setBypassServiceWorker', { bypass: true }, page)
    const css = 'late-proof.css'
    const added = await evaluate(`new Promise(done => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/assets/${css}'; l.id = 'late-css'; l.onload = l.onerror = () => done(true); document.head.append(l) })`)
    writeFileSync(join(v2, 'assets', css), '.proof-late { color: rgb(1, 2, 3) }\n')
    const rules = await evaluate(`new Promise(done => { const old = document.getElementById('late-css'); const ok = (l) => { try { return l.sheet ? l.sheet.cssRules.length : -1 } catch { return -1 } }; const before = ok(old); const fresh = old.cloneNode(); fresh.onload = fresh.onerror = () => done([before, ok(fresh)]); old.replaceWith(fresh) })`)
    await send('Network.setBypassServiceWorker', { bypass: false }, page)
    record('8c a chunk stylesheet that failed once has its rules when it is linked again (Try again, no worker)', added === true && rules[0] <= 0 && rules[1] > 0, `rules before ${rules[0]}, after ${rules[1]}`)
    await host(null)
  }
  if (!LIVE) {
    // 9. The kill switch (YAZ-5285): a page with data in IndexedDB; the kill switch is published; the next open.
    await host(v2)
    await open(`${ORIGIN}/`)
    await evaluate(`new Promise((ok, no) => { const r = indexedDB.open('proof-kill', 1); r.onupgradeneeded = () => r.result.createObjectStore('s'); r.onsuccess = () => { const t = r.result.transaction('s', 'readwrite'); t.objectStore('s').put('answer', 'waiting'); t.oncomplete = () => { r.result.close(); ok(true) } }; r.onerror = () => no(r.error) })`)
    const shellBefore = (await evaluate(shellCaches)).length
    await host(vkill)
    await open(`${ORIGIN}/`)
    const cleared = await until(`caches.keys().then(ks => !ks.some(k => k.startsWith('notecards-')))`, 60_000)
    const unregistered = await until(`navigator.serviceWorker.getRegistrations().then(rs => rs.length === 0)`, 20_000)
    const data = await evaluate(`new Promise(ok => { const r = indexedDB.open('proof-kill', 1); r.onsuccess = () => { const g = r.result.transaction('s').objectStore('s').get('waiting'); g.onsuccess = () => { ok(g.result); r.result.close() } } })`)
    const shows = await until(`!!document.querySelector('input[name="token"]')`)
    record('9 the kill switch clears the shell caches, unregisters, and keeps IndexedDB; the app still opens', shellBefore > 0 && cleared && unregistered && data === 'answer' && shows, `${shellBefore} shell caches before; cleared ${cleared}; unregistered ${unregistered}; IndexedDB "${data}"`)
    await host(null)
  }
  const unexpected = csp().slice(onPurpose)
  record('7 no CSP violation in any later step', unexpected.length === 0, unexpected.map((l) => l.text).join(' | '))
  console.log('\nAll messages of the page and the worker:')
  for (const l of log) console.log(`  [${l.where} ${l.level}] ${l.text.slice(0, 200)}`)
} finally {
  await host(null)
  chrome.kill()
  ws.close()
  await wait(500)
  try {
    rmSync(work, { recursive: true, force: true })
    if (process.env.PROOF_PROFILE && !process.env.PROOF_KEEP_PROFILE) rmSync(process.env.PROOF_PROFILE, { recursive: true, force: true })
  } catch {
    // Chrome may still write its profile while it stops; the temp folder goes with the next restart.
  }
}
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length} of ${results.length} steps pass`)
process.exit(failed.length ? 1 : 0)
