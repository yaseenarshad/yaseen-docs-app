import type { CacheLike, CacheStorageLike, RequestLike, SwScope } from './swCore'

/** Test help (YAZ-5087): the browser's `caches`, a server behind `fetch`, and a service worker scope, all in memory. */

export function fakeCaches(): CacheStorageLike & { dump(): Record<string, string[]> } {
  const all = new Map<string, Map<string, Response>>()
  const cacheOf = (name: string): CacheLike => {
    let entries = all.get(name)
    if (!entries) all.set(name, (entries = new Map()))
    const map = entries
    return {
      async match(key) {
        const hit = map.get(key)
        return hit?.clone()
      },
      async put(key, response) {
        map.set(key, response.clone())
      },
    }
  }
  return {
    async open(name) {
      return cacheOf(name)
    },
    async keys() {
      return [...all.keys()]
    },
    async delete(name) {
      return all.delete(name)
    },
    async has(name) {
      return all.has(name)
    },
    dump() {
      return Object.fromEntries([...all].map(([name, m]) => [name, [...m.keys()].sort()]))
    },
  }
}

export interface FakeFile {
  body: string
  type?: string
  status?: number
}

const typeOf = (path: string) =>
  path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.png') ? 'image/png' : path.endsWith('.webmanifest') ? 'application/manifest+json' : 'text/html'

/**
 * A static site as Cloudflare serves it: each path of `files`, and the single-page fallback (index.html with 200) for
 * any other path, as `not_found_handling: single-page-application` does. `offline` makes every call fail.
 */
export function fakeServer(files: Record<string, FakeFile>, origin = 'https://notecards.test') {
  const calls: string[] = []
  const state = { offline: false, failAfter: Infinity }
  const fetch = async (input: string | RequestLike): Promise<Response> => {
    const raw = typeof input === 'string' ? input : input.url
    const url = new URL(raw, origin)
    calls.push(url.origin === origin ? url.pathname : url.href)
    if (state.offline || calls.length > state.failAfter) throw new TypeError('Failed to fetch')
    if (url.origin !== origin) return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    const file = files[url.pathname] ?? files['/']
    if (file === undefined) return new Response('not found', { status: 404 })
    const path = files[url.pathname] ? url.pathname : '/'
    return new Response(file.body, { status: file.status ?? 200, headers: { 'content-type': file.type ?? typeOf(path) } })
  }
  return { fetch, calls, state, files, origin }
}

type Listener = (event: any) => void

/** A service worker global scope with its events: `dispatch('fetch', …)` returns what the worker answered, or `null` (it did not touch it). */
export function fakeScope(server: ReturnType<typeof fakeServer>, caches = fakeCaches()) {
  const listeners = new Map<string, Listener[]>()
  const log: string[] = []
  const scope: SwScope = {
    location: { origin: server.origin },
    caches,
    fetch: (input) => server.fetch(input),
    skipWaiting: async () => void log.push('skipWaiting'),
    clients: { claim: async () => void log.push('claim') },
    addEventListener: (type: string, fn: Listener) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
  }
  const run = async (type: string, extra: Record<string, unknown>) => {
    const waits: Promise<unknown>[] = []
    let answered: Promise<Response> | null = null
    const event = { ...extra, waitUntil: (p: Promise<unknown>) => void waits.push(p), respondWith: (p: Promise<Response> | Response) => void (answered = Promise.resolve(p)) }
    for (const fn of listeners.get(type) ?? []) fn(event)
    await Promise.all(waits)
    return answered as Promise<Response> | null
  }
  return {
    scope,
    caches,
    log,
    install: () => run('install', {}),
    activate: () => run('activate', {}),
    message: (data: unknown) => run('message', { data }),
    /** The worker's answer to a request, or `null` when it let the request go to the network untouched. */
    async request(url: string, init: { method?: string; mode?: string } = {}): Promise<Response | null> {
      const request = { url: new URL(url, server.origin).href, method: init.method ?? 'GET', mode: init.mode ?? 'cors' }
      const answered = await run('fetch', { request })
      return answered === null ? null : await answered
    },
  }
}
