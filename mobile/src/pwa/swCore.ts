/**
 * THE SERVICE WORKER (YAZ-5087), hand-written and small. `sw.ts` wires it to the worker's events; the build
 * (`publish/pwaPlugin.ts`) puts this build's file list in it. The rules:
 *
 * - It keeps the app's SHELL only: the page, the hashed JS and CSS (every chunk, also the lazy ones: the sync engine
 *   and the QR reader), the friend page, the manifest and the icons. So the app opens with no signal (N1).
 * - It NEVER touches a request to another origin. A GitHub call (`api.github.com`) and an avatar picture go straight to
 *   the network: no `respondWith`, no cache, no retry, no replay. Pages, card files and media are kept by the app
 *   itself in IndexedDB (3A, 3D), never here. It never touches a write (a non-GET) either.
 * - A new version installs into a cache of its own, and only when it is WHOLE: each file answered 200 with the right
 *   type, and the page names this build's entry (the version check). A broken or mixed deploy fails the install; the
 *   old version keeps working, untouched.
 * - It never takes over by itself. The page sends `SKIP_WAITING` at a safe moment (`safeMoment.ts`).
 * - After a takeover it keeps the version before too, so a page that still runs the old version can load its lazy
 *   chunks, even when the host no longer has them. Older versions are deleted.
 *
 * The types here are the small parts of the worker's API that it uses, so the logic runs in Node tests with fakes.
 */

/** This build's shell: what the worker keeps. Written into `sw.js` by the build. */
export interface ShellBuild {
  /** A hash of every shell file: a new deploy has a new version, so a new `sw.js`, so the browser installs it. */
  version: string
  /** The served path of each shell file: `/` (index.html), `/friend` (friend.html), `/assets/…`, `/icons/…`. */
  files: string[]
  /** The page's entry script (`/assets/index-….js`). The version check: the page fetched at install must name it. */
  entry: string
  /**
   * YAZ-5286: each page of the shell and the script it must name (`/` its entry, `/friend` `/group` `/join` the landing
   * script). A page that does not name it is another page (a captive portal, another deploy): the install refuses it.
   */
  pages: Record<string, string>
}

export const CACHE_PREFIX = 'notecards-shell-'
export const META_CACHE = 'notecards-meta'
const ACTIVE_KEY = '/__notecards/active'
/** YAZ-5303: which version each open page runs ({ clientId: version }), kept across worker restarts and versions. */
const PAGES_KEY = '/__notecards/pages'
/** YAZ-5303: every version that was ever the active one: only such a version's cache may go (never a newer one). */
const RETIRED_KEY = '/__notecards/were-active'
export const cacheName = (version: string) => `${CACHE_PREFIX}${version}`
/** The message from the page: "take over now" (the page decided it is a safe moment). */
export const SKIP_WAITING = 'notecards:skip-waiting'
/**
 * YAZ-5303: the message of a page that has started: the page it replaced (in the same tab) is gone now, so a version
 * that no open page runs any more can go. At the page open itself, the replaced page is often still there.
 */
export const PAGE_READY = 'notecards:page-ready'

export interface CacheLike {
  match(key: string): Promise<Response | undefined>
  put(key: string, response: Response): Promise<void>
}
export interface CacheStorageLike {
  open(name: string): Promise<CacheLike>
  keys(): Promise<string[]>
  delete(name: string): Promise<boolean>
  has(name: string): Promise<boolean>
}
export interface RequestLike {
  url: string
  method: string
  mode: string
}
interface ExtendableEventLike {
  waitUntil(promise: Promise<unknown>): void
}
interface FetchEventLike extends ExtendableEventLike {
  request: RequestLike
  /** The page that a page open makes (its client ID); empty for other requests. */
  resultingClientId?: string
  respondWith(response: Promise<Response>): void
}
interface MessageEventLike extends ExtendableEventLike {
  data: unknown
}
export interface SwScope {
  location: { origin: string }
  caches: CacheStorageLike
  fetch(input: string | RequestLike, init?: RequestInit): Promise<Response>
  skipWaiting(): Promise<void>
  clients: { claim(): Promise<void>; matchAll?(options?: { type?: string; includeUncontrolled?: boolean }): Promise<{ id?: string; url: string; navigate(url: string): Promise<unknown> }[]> }
  /** The worker's own registration (the kill switch unregisters it). */
  registration?: { unregister(): Promise<boolean> }
  addEventListener(type: 'install' | 'activate', fn: (event: ExtendableEventLike) => void): void
  addEventListener(type: 'fetch', fn: (event: FetchEventLike) => void): void
  addEventListener(type: 'message', fn: (event: MessageEventLike) => void): void
}

/** A hashed build file: its name changes with its bytes, so a copy of it is right forever. */
const isHashed = (path: string) => path.startsWith('/assets/')

export type Route = { kind: 'pass' } | { kind: 'shell'; key: string }
const PASS: Route = { kind: 'pass' }

/** What the worker does with a request: `pass` (it does not touch it: the network answers) or `shell` (its kept copy). */
export function route(request: RequestLike, origin: string, build: ShellBuild): Route {
  if (request.method !== 'GET') return PASS
  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    return PASS
  }
  if (url.origin !== origin) return PASS
  const path = url.pathname
  if (path === '/sw.js') return PASS
  if (request.mode === 'navigate') {
    // The landing pages of the three shared links (YAZ-5290).
    const landing = /^\/(friend|group|join)(\/|\.html)?$/.exec(path)
    if (landing) return { kind: 'shell', key: `/${landing[1]}` }
    // Any other address of the site is the app (single-page), as the host's fallback does. A file name is not.
    return /\.[a-z0-9]+$/i.test(path) && path !== '/index.html' ? PASS : { kind: 'shell', key: '/' }
  }
  if (build.files.includes(path) || isHashed(path)) return { kind: 'shell', key: path }
  return PASS
}

/** The kept copy: this version's first, then any kept version (an old page's lazy chunk). Null: none. */
async function kept(caches: CacheStorageLike, version: string, key: string): Promise<Response | null> {
  const own = await (await caches.open(cacheName(version))).match(key)
  if (own) return own
  for (const name of await caches.keys()) {
    if (!name.startsWith(CACHE_PREFIX) || name === cacheName(version)) continue
    const hit = await (await caches.open(name)).match(key)
    if (hit) return hit
  }
  return null
}

/**
 * The answer to a shell request: the kept copy; with none (an install still running), the network.
 *
 * YAZ-5283: a hashed file that no kept version has goes to the host with `cache: 'no-cache'` (never an old HTTP-cache
 * answer), and the host's app page for it (Cloudflare's single-page fallback: 200 `text/html`) becomes a 404. So the
 * page sees a failed load, never HTML as a script, and the next try asks the host again.
 */
export async function respond(scope: Pick<SwScope, 'caches' | 'fetch'>, build: ShellBuild, key: string, request: RequestLike): Promise<Response> {
  const own = await kept(scope.caches, build.version, key)
  if (own) return own
  if (!isHashed(key)) return scope.fetch(request)
  const answer = await scope.fetch(new URL(key, request.url).href, { cache: 'no-cache', credentials: 'same-origin' })
  const type = expectedType(key)
  if (type && !type.test(answer.headers.get('content-type') ?? '')) return new Response('', { status: 404, statusText: 'Not Found' })
  return answer
}

/** A copy with no `redirected` flag: a redirected answer may not answer a page open (Safari and Chrome refuse it). */
async function plain(response: Response): Promise<Response> {
  if (!response.redirected) return response
  return new Response(await response.blob(), { status: response.status, statusText: response.statusText, headers: response.headers })
}

/** YAZ-5286: the type each kind of shell file must have. A file of another kind is not precached. */
const expectedType = (path: string): RegExp | null => {
  if (path.endsWith('.js')) return /javascript/
  if (path.endsWith('.css')) return /text\/css/
  if (path.endsWith('.png')) return /image\/png/
  if (path.endsWith('.svg')) return /image\/svg\+xml/
  if (path.endsWith('.webmanifest')) return /application\/(manifest\+)?json/
  if (/^\/(friend|group|join)?$/.test(path)) return /text\/html/
  return null
}

export class InstallError extends Error {}

/**
 * Install: every shell file into this version's own cache, or nothing. A hashed file the phone already has (in an
 * older version's cache) is copied, not downloaded again. Throws (and leaves no new cache) on any missing file, any
 * file of the wrong type (the host's single-page fallback answers a missing chunk with the page), or a page of another
 * deploy. The worker then stays uninstalled, and the old version keeps running.
 */
export async function install(scope: Pick<SwScope, 'caches' | 'fetch'>, build: ShellBuild): Promise<void> {
  const name = cacheName(build.version)
  try {
    const got: [string, Response][] = []
    for (const path of build.files) {
      const have = isHashed(path) ? await kept(scope.caches, build.version, path) : null
      if (have) {
        got.push([path, have])
        continue
      }
      // `no-cache`: ask the host again, so the files are this deploy's, not an older copy in the HTTP cache.
      const response = await scope.fetch(path, { cache: 'no-cache', credentials: 'same-origin' })
      if (!response.ok) throw new InstallError(`${path}: answered ${response.status}`)
      const type = expectedType(path)
      if (!type) throw new InstallError(`${path}: not a kind of file that the shell keeps`)
      if (!type.test(response.headers.get('content-type') ?? '')) throw new InstallError(`${path}: answered ${response.headers.get('content-type')}`)
      got.push([path, await plain(response)])
    }
    // The version check, for EVERY page: it must name its own script of this build.
    for (const [path, response] of got) {
      const script = path === '/' ? build.entry : build.pages?.[path]
      if (script === undefined || !expectedType(path)?.test('text/html')) continue
      if (!(await response.clone().text()).includes(script)) throw new InstallError(`${path}: the page is of another version (it does not name ${script})`)
    }
    const cache = await scope.caches.open(name)
    for (const [path, response] of got) await cache.put(path, response)
  } catch (err) {
    await scope.caches.delete(name)
    throw err
  }
}

async function readPages(caches: CacheStorageLike): Promise<Record<string, string>> {
  try {
    const stored = await (await caches.open(META_CACHE)).match(PAGES_KEY)
    const pages = stored ? ((await stored.json()) as unknown) : {}
    return typeof pages === 'object' && pages !== null ? (pages as Record<string, string>) : {}
  } catch {
    return {}
  }
}

/** YAZ-5303: a page open served by this version: that page runs this version. */
export async function notePage(caches: CacheStorageLike, clientId: string, version: string): Promise<void> {
  if (!clientId) return
  const pages = await readPages(caches)
  pages[clientId] = version
  await (await caches.open(META_CACHE)).put(PAGES_KEY, new Response(JSON.stringify(pages)))
}

/**
 * YAZ-5303: a version's cache goes only when no open page runs that version. Each page open notes the version that
 * served it (`notePage`). A page that no worker noted (open since before this rule, or the note was lost) keeps EVERY
 * stored version, because its version is not known. With no page open, only this version stays.
 */
export async function prune(scope: Pick<SwScope, 'caches' | 'clients'>, build: ShellBuild): Promise<void> {
  // Only the ACTIVE version prunes. An older worker that still gets a message must never touch the cache of a newer
  // version (it does not know it), and a waiting version has not taken over yet.
  const meta = await scope.caches.open(META_CACHE)
  if ((await (await meta.match(ACTIVE_KEY))?.text()) !== build.version) return
  const wereActive = new Set<string>(JSON.parse((await (await meta.match(RETIRED_KEY))?.text()) ?? '[]') as string[])
  const open = scope.clients.matchAll ? await scope.clients.matchAll({ type: 'window', includeUncontrolled: true }) : []
  const pages = await readPages(scope.caches)
  const keep = new Set([cacheName(build.version)])
  const alive: Record<string, string> = {}
  for (const page of open) {
    const version = page.id ? pages[page.id] : undefined
    if (version === undefined) return // a page of an unknown version: keep everything
    keep.add(cacheName(version))
    alive[page.id!] = version
  }
  // Only a version that was active before goes: a newer one (installed, waiting) is never removed here.
  for (const name of await scope.caches.keys()) {
    if (!name.startsWith(CACHE_PREFIX) || keep.has(name) || !wereActive.has(name.slice(CACHE_PREFIX.length))) continue
    await scope.caches.delete(name)
  }
  await meta.put(PAGES_KEY, new Response(JSON.stringify(alive)))
}

/** Activate: notes this version as the active one. No cache goes here: `prune` removes a version when no page runs it. */
export async function activate(caches: CacheStorageLike, build: ShellBuild): Promise<void> {
  const meta = await caches.open(META_CACHE)
  const before = await (await meta.match(ACTIVE_KEY))?.text()
  const noted = await (await meta.match(RETIRED_KEY))?.text()
  const wereActive = new Set<string>(JSON.parse(noted ?? '[]') as string[])
  if (before) wereActive.add(before)
  // The first activation under this rule (no note yet): each version stored now was active before.
  if (noted === undefined) for (const name of await caches.keys()) if (name.startsWith(CACHE_PREFIX) && name !== cacheName(build.version)) wereActive.add(name.slice(CACHE_PREFIX.length))
  wereActive.add(build.version)
  await meta.put(RETIRED_KEY, new Response(JSON.stringify([...wereActive])))
  await meta.put(ACTIVE_KEY, new Response(build.version))
}

/** The worker: its four events. */
export function wire(scope: SwScope, build: ShellBuild): void {
  scope.addEventListener('install', (event) => event.waitUntil(install(scope, build)))
  scope.addEventListener('activate', (event) =>
    event.waitUntil(
      activate(scope.caches, build)
        .then(() => scope.clients.claim())
        .then(() => prune(scope, build)),
    ),
  )
  scope.addEventListener('fetch', (event) => {
    const r = route(event.request, scope.location.origin, build)
    if (r.kind === 'pass') return // not ours: the browser does the request as if there were no worker
    event.respondWith(respond(scope, build, r.key, event.request))
    // A page open: the new page runs this version; then a version with no page left can go.
    if (event.request.mode === 'navigate' && event.resultingClientId) event.waitUntil(notePage(scope.caches, event.resultingClientId, build.version).then(() => prune(scope, build)))
  })
  scope.addEventListener('message', (event) => {
    const type = typeof event.data === 'object' && event.data !== null ? (event.data as { type?: unknown }).type : undefined
    if (type === SKIP_WAITING) event.waitUntil(scope.skipWaiting())
    if (type === PAGE_READY) event.waitUntil(prune(scope, build))
  })
}
