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
}

export const CACHE_PREFIX = 'notecards-shell-'
export const META_CACHE = 'notecards-meta'
const ACTIVE_KEY = '/__notecards/active'
export const cacheName = (version: string) => `${CACHE_PREFIX}${version}`
/** The message from the page: "take over now" (the page decided it is a safe moment). */
export const SKIP_WAITING = 'notecards:skip-waiting'

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
  clients: { claim(): Promise<void> }
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
    if (path === '/friend' || path === '/friend/' || path === '/friend.html') return { kind: 'shell', key: '/friend' }
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

/** The answer to a shell request: the kept copy; with none (an install still running), the network. */
export async function respond(scope: Pick<SwScope, 'caches' | 'fetch'>, build: ShellBuild, key: string, request: RequestLike): Promise<Response> {
  return (await kept(scope.caches, build.version, key)) ?? scope.fetch(request)
}

/** A copy with no `redirected` flag: a redirected answer may not answer a page open (Safari and Chrome refuse it). */
async function plain(response: Response): Promise<Response> {
  if (!response.redirected) return response
  return new Response(await response.blob(), { status: response.status, statusText: response.statusText, headers: response.headers })
}

const expectedType = (path: string): RegExp | null =>
  path.endsWith('.js') ? /javascript/ : path.endsWith('.css') ? /text\/css/ : path === '/' || path === '/friend' ? /text\/html/ : null

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
      if (type && !type.test(response.headers.get('content-type') ?? '')) throw new InstallError(`${path}: answered ${response.headers.get('content-type')}`)
      got.push([path, await plain(response)])
    }
    const page = got.find(([path]) => path === '/')
    if (page && !(await page[1].clone().text()).includes(build.entry)) throw new InstallError(`the page is of another version (it does not name ${build.entry})`)
    const cache = await scope.caches.open(name)
    for (const [path, response] of got) await cache.put(path, response)
  } catch (err) {
    await scope.caches.delete(name)
    throw err
  }
}

/** Activate: this version and the one it replaces stay; every older shell cache goes. */
export async function activate(caches: CacheStorageLike, build: ShellBuild): Promise<void> {
  const meta = await caches.open(META_CACHE)
  const before = await (await meta.match(ACTIVE_KEY))?.text()
  const keep = new Set([cacheName(build.version)])
  if (before && before !== build.version) keep.add(cacheName(before))
  for (const name of await caches.keys()) if (name.startsWith(CACHE_PREFIX) && !keep.has(name)) await caches.delete(name)
  await meta.put(ACTIVE_KEY, new Response(build.version))
}

/** The worker: its four events. */
export function wire(scope: SwScope, build: ShellBuild): void {
  scope.addEventListener('install', (event) => event.waitUntil(install(scope, build)))
  scope.addEventListener('activate', (event) => event.waitUntil(activate(scope.caches, build).then(() => scope.clients.claim())))
  scope.addEventListener('fetch', (event) => {
    const r = route(event.request, scope.location.origin, build)
    if (r.kind === 'pass') return // not ours: the browser does the request as if there were no worker
    event.respondWith(respond(scope, build, r.key, event.request))
  })
  scope.addEventListener('message', (event) => {
    if (typeof event.data === 'object' && event.data !== null && (event.data as { type?: unknown }).type === SKIP_WAITING) event.waitUntil(scope.skipWaiting())
  })
}
