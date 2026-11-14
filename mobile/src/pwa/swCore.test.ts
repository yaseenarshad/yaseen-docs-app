import { describe, expect, it } from 'vitest'
import { CACHE_PREFIX, SKIP_WAITING, cacheName, route, wire, type ShellBuild } from './swCore'
import { fakeCaches, fakeScope, fakeServer, type FakeFile } from './testing'

/**
 * The service worker (YAZ-5087), as pure logic over fake `caches`, `fetch` and events. It keeps the app's own files
 * (the shell) so the app opens with no signal; it never touches a call to another origin (GitHub: no cache, no retry,
 * no replay); a new version is complete before it can take over; the old version's lazy chunks still load.
 */

const ORIGIN = 'https://notecards.test'

function site(v: string, extra: Record<string, FakeFile> = {}) {
  const entry = `/assets/index-${v}.js`
  const landing = `/assets/friend-${v}.js`
  const page = (title: string) => ({ body: `<!doctype html><title>${title}</title><script type="module" src="${landing}"></script>` })
  const files: Record<string, FakeFile> = {
    '/': { body: `<!doctype html><script type="module" src="${entry}"></script>` },
    '/friend': page('Friend'),
    '/group': page('Group'),
    '/join': page('Join'),
    [landing]: { body: 'landing()' },
    [entry]: { body: `console.log('${v}')` },
    [`/assets/engine-${v}.js`]: { body: `export const engine = '${v}'` },
    '/assets/qrDecode-same.js': { body: 'export const qr = 1' },
    [`/assets/index-${v}.css`]: { body: 'body{}' },
    '/manifest.webmanifest': { body: '{"name":"Notecards"}' },
    '/icons/icon-192.png': { body: 'png' },
    ...extra,
  }
  const build: ShellBuild = { version: v, entry, files: Object.keys(files), pages: { '/': entry, '/friend': landing, '/group': landing, '/join': landing } }
  return { files, build }
}

async function installed(v: string, caches = fakeCaches()) {
  const { files, build } = site(v)
  const server = fakeServer(files, ORIGIN)
  const sw = fakeScope(server, caches)
  wire(sw.scope, build)
  await sw.install()
  await sw.activate()
  return { sw, server, build, caches }
}

describe('which requests the worker takes', () => {
  const { build } = site('v1')
  const at = (url: string, method = 'GET', mode = 'cors') => route({ url, method, mode }, ORIGIN, build)

  it('never another origin: GitHub (the API, a raw file, a gist), the avatar host, anything', () => {
    for (const url of [
      'https://api.github.com/repos/a/b/git/blobs/1',
      'https://api.github.com/gists/abc',
      'https://raw.githubusercontent.com/a/b/main/x.md',
      'https://gist.githubusercontent.com/a/abc/raw/x',
      'https://avatars.githubusercontent.com/u/1?v=4',
      'https://notecards.test.evil.example/',
    ]) {
      expect([url, at(url).kind]).toEqual([url, 'pass'])
      expect([url, at(url, 'GET', 'navigate').kind]).toEqual([url, 'pass'])
    }
  })

  it('never a write, and never the worker file itself', () => {
    expect(at(`${ORIGIN}/assets/index-v1.js`, 'POST').kind).toBe('pass')
    expect(at(`${ORIGIN}/`, 'PUT', 'navigate').kind).toBe('pass')
    expect(at(`${ORIGIN}/sw.js`).kind).toBe('pass')
  })

  it("the shell files, and any hashed file (an older version's lazy chunk)", () => {
    expect(at(`${ORIGIN}/assets/index-v1.js`)).toEqual({ kind: 'shell', key: '/assets/index-v1.js' })
    expect(at(`${ORIGIN}/manifest.webmanifest`)).toEqual({ kind: 'shell', key: '/manifest.webmanifest' })
    expect(at(`${ORIGIN}/assets/engine-OLD.js`)).toEqual({ kind: 'shell', key: '/assets/engine-OLD.js' })
    expect(at(`${ORIGIN}/assets/index-v1.js?x=1`)).toEqual({ kind: 'shell', key: '/assets/index-v1.js' })
  })

  it('a page open: the app (single-page), or the friend landing page', () => {
    expect(at(`${ORIGIN}/`, 'GET', 'navigate')).toEqual({ kind: 'shell', key: '/' })
    expect(at(`${ORIGIN}/some/route`, 'GET', 'navigate')).toEqual({ kind: 'shell', key: '/' })
    expect(at(`${ORIGIN}/friend`, 'GET', 'navigate')).toEqual({ kind: 'shell', key: '/friend' })
    expect(at(`${ORIGIN}/friend/`, 'GET', 'navigate')).toEqual({ kind: 'shell', key: '/friend' })
    // YAZ-5290: the group and join links have their landing page too.
    expect(at(`${ORIGIN}/group`, 'GET', 'navigate')).toEqual({ kind: 'shell', key: '/group' })
    expect(at(`${ORIGIN}/join/`, 'GET', 'navigate')).toEqual({ kind: 'shell', key: '/join' })
  })

  it('other same-origin files that are not the shell go to the network untouched (the splash pictures)', () => {
    expect(at(`${ORIGIN}/splash/dark-1179x2556.png`).kind).toBe('pass')
    expect(at(`${ORIGIN}/robots.txt`).kind).toBe('pass')
  })
})

describe('the worker in its events', () => {
  it('a call to GitHub is not touched: no respondWith, no fetch of its own, nothing cached', async () => {
    const { sw, server, caches } = await installed('v1')
    const before = server.calls.length
    for (const method of ['GET', 'POST', 'PATCH']) {
      expect(await sw.request('https://api.github.com/repos/a/b/git/refs/heads/main', { method })).toBeNull()
    }
    expect(await sw.request('https://avatars.githubusercontent.com/u/1?v=4')).toBeNull()
    expect(server.calls.length).toBe(before)
    expect(JSON.stringify(caches.dump())).not.toContain('github')
  })

  it('install keeps every shell file; with no signal the app, its chunks and the friend page still open', async () => {
    const { sw, server, build } = await installed('v1')
    server.state.offline = true
    const page = await sw.request(`${ORIGIN}/`, { mode: 'navigate' })
    expect(await page!.text()).toContain(build.entry)
    expect(await (await sw.request(`${ORIGIN}/some/route`, { mode: 'navigate' }))!.text()).toContain(build.entry)
    expect(await (await sw.request(`${ORIGIN}/assets/engine-v1.js`))!.text()).toContain('v1')
    expect(await (await sw.request(`${ORIGIN}/friend`, { mode: 'navigate' }))!.text()).toContain('Friend')
  })

  it('install does not take over by itself: only the message from the page does (the safe moment is the page\'s)', async () => {
    const { sw } = await installed('v1')
    expect(sw.log).not.toContain('skipWaiting')
    await sw.message({ type: 'other' })
    expect(sw.log).not.toContain('skipWaiting')
    await sw.message({ type: SKIP_WAITING })
    expect(sw.log).toContain('skipWaiting')
  })

  it('activate takes the open pages (first install: offline at once, with no reload)', async () => {
    const { sw } = await installed('v1')
    expect(sw.log).toContain('claim')
  })
})

describe('YAZ-5283: a chunk that no kept version has', () => {
  it('the host answers the app page (200 text/html, the single-page fallback): the page gets a 404, never HTML as a script', async () => {
    const { sw, server } = await installed('v1')
    const answer = await sw.request(`${ORIGIN}/assets/late-X.js`)
    expect(answer!.status).toBe(404)
    expect(server.calls).toContain('/assets/late-X.js')
  })

  it('it is asked again at each try (no HTTP cache answer): the try after the file exists gets the script', async () => {
    const { files, build } = site('v1')
    const server = fakeServer(files, ORIGIN)
    const inits: (RequestInit | undefined)[] = []
    const sw = fakeScope({ ...server, fetch: (input: any, init?: RequestInit) => (inits.push(init), server.fetch(input)) })
    wire(sw.scope, build)
    await sw.install()
    await sw.activate()
    inits.length = 0
    expect((await sw.request(`${ORIGIN}/assets/late-X.js`))!.status).toBe(404)
    files['/assets/late-X.js'] = { body: 'export const x = 1' }
    const again = await sw.request(`${ORIGIN}/assets/late-X.js`)
    expect(again!.status).toBe(200)
    expect(await again!.text()).toContain('export')
    expect(inits.every((i) => i?.cache === 'no-cache')).toBe(true)
  })
})

describe('a new version', () => {
  async function update(v2files: (files: Record<string, FakeFile>) => void, caches = fakeCaches()) {
    const one = await installed('v1', caches)
    const { files, build } = site('v2')
    v2files(files)
    const server = fakeServer(files, ORIGIN)
    const sw = fakeScope(server, caches)
    wire(sw.scope, build)
    return { one, sw, server, build, caches }
  }

  it('a broken deploy (a file missing) does not install; the old shell keeps working, whole', async () => {
    const { sw, one, caches } = await update((f) => (f['/assets/engine-v2.js'] = { body: 'gone', status: 404 }))
    await expect(sw.install()).rejects.toThrow(/engine-v2/)
    expect(Object.keys(caches.dump())).not.toContain(cacheName('v2'))
    one.server.state.offline = true
    expect(await (await one.sw.request(`${ORIGIN}/`, { mode: 'navigate' }))!.text()).toContain(one.build.entry)
  })

  it('a chunk that the host answers with the app page (the single-page fallback, 200 text/html) does not install', async () => {
    const { sw } = await update((f) => (f['/assets/engine-v2.js'] = { body: '<!doctype html>', type: 'text/html' }))
    await expect(sw.install()).rejects.toThrow(/engine-v2/)
  })

  it('YAZ-5286: a landing page that is another HTML page (it does not name its own script) does not install', async () => {
    const { sw } = await update((f) => (f['/friend'] = { body: '<!doctype html><title>Wi-Fi login</title>' }))
    await expect(sw.install()).rejects.toThrow(/\/friend/)
  })

  it('YAZ-5286: an icon or the manifest answered with HTML does not install', async () => {
    const icon = await update((f) => (f['/icons/icon-192.png'] = { body: '<!doctype html>', type: 'text/html' }))
    await expect(icon.sw.install()).rejects.toThrow(/icon-192/)
    const manifest = await update((f) => (f['/manifest.webmanifest'] = { body: '<!doctype html>', type: 'text/html' }))
    await expect(manifest.sw.install()).rejects.toThrow(/manifest/)
  })

  it('the version check: an index.html of another deploy (it names another entry) does not install', async () => {
    const { sw } = await update((f) => (f['/'] = { body: '<script type="module" src="/assets/index-v3.js"></script>' }))
    await expect(sw.install()).rejects.toThrow(/version/)
  })

  it('a half-finished install (the signal stops): nothing changes; the next try finishes it', async () => {
    const { sw, server, caches, one } = await update(() => {})
    server.state.failAfter = 2
    await expect(sw.install()).rejects.toThrow()
    expect(Object.keys(caches.dump()).sort()).toEqual([cacheName('v1'), 'notecards-meta'].sort())
    one.server.state.offline = true
    expect(await (await one.sw.request(`${ORIGIN}/`, { mode: 'navigate' }))!.text()).toContain(one.build.entry)
    server.state.failAfter = Infinity
    await sw.install()
    expect(caches.dump()[cacheName('v2')]).toEqual([...site('v2').build.files].sort())
  })

  it('only new files are downloaded: a hashed file the phone already has is taken from the old cache', async () => {
    const { sw, server } = await update(() => {})
    await sw.install()
    expect(server.calls).not.toContain('/assets/qrDecode-same.js')
    expect(server.calls).toContain('/assets/engine-v2.js')
    expect(server.calls).toContain('/') // never kept across versions: the page and the manifest are fetched again
  })

  it("after the update the OLD version's lazy chunks still load (a page that was open before), even when the host no longer has them", async () => {
    const { sw, server, one } = await update(() => {})
    // A page that v1 opened is still open (YAZ-5303: v1 stays while a page of it is open).
    await one.sw.request(`${ORIGIN}/`, { mode: 'navigate', resultingClientId: 'A' })
    sw.windows.push({ id: 'A', url: `${ORIGIN}/` })
    await sw.install()
    await sw.activate()
    const oldChunk = await sw.request(`${ORIGIN}/assets/engine-v1.js`)
    expect(server.calls).not.toContain('/assets/engine-v1.js')
    expect(await oldChunk!.text()).toContain('v1')
  })

  it('activate with no page open: only this version stays (YAZ-5303: a version goes when no page of it is left)', async () => {
    const caches = fakeCaches()
    for (const v of ['v1', 'v2', 'v3']) await installed(v, caches)
    const names = (await caches.keys()).filter((n) => n.startsWith(CACHE_PREFIX)).sort()
    expect(names).toEqual([cacheName('v3')])
  })
})
