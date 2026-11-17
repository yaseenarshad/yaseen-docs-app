import { describe, expect, it } from 'vitest'
import { wireKillSwitch } from './killSwitch'
import { DRAWIO_CACHE_PREFIX, cacheName, drawioCacheName, route, wire, type ShellBuild } from './swCore'
import { fakeCaches, fakeScope, fakeServer, type FakeFile } from './testing'

/**
 * YAZ-5533: draw.io on the phone and the service worker. Nothing about draw.io is in the install (Yaseen: nothing about
 * it may bloat the app): its files (`/drawio/<hash>/…`: the viewer, the renderer page, each shape library and font)
 * and the app's small diagram chunk are fetched from this site the first time a diagram asks, kept from then on in a
 * cache of their own, and served from it with no signal. The host's app page in a file's place is never kept.
 */

const ORIGIN = 'https://notecards.test'
const RENDER_PAGE = '<!DOCTYPE html><script src="phone-shim.js"></script><script src="yaseen-render.js"></script>'

function site(v: string, base = '/drawio/aaaaaaaaaaaa/') {
  const entry = `/assets/index-${v}.js`
  const files: Record<string, FakeFile> = {
    '/': { body: `<!doctype html><script type="module" src="${entry}"></script>` },
    [entry]: { body: `console.log('${v}')` },
    '/manifest.webmanifest': { body: '{"name":"Notecard"}' },
  }
  const build: ShellBuild = { version: v, entry, files: Object.keys(files), pages: { '/': entry }, drawio: base, drawioChunks: [`/assets/drawDiagram-${v}.js`, `/assets/drawDiagram-${v}.css`] }
  const drawio: Record<string, FakeFile> = {
    [`${base}render`]: { body: RENDER_PAGE, type: 'text/html' },
    [`${base}viewer-static.min.js`]: { body: 'viewer()' },
    [`${base}stencils/aws4.js`]: { body: 'aws4()' },
    [`${base}fonts/Inter.js`]: { body: 'inter()' },
    [`/assets/drawDiagram-${v}.js`]: { body: 'export const drawDiagram = 1' },
    [`/assets/drawDiagram-${v}.css`]: { body: '.page-drawing__note{}' },
  }
  return { files: { ...files, ...drawio }, build, drawio: Object.keys(drawio) }
}

async function installed(v: string, caches = fakeCaches(), base?: string) {
  const { files, build, drawio } = site(v, base)
  const server = fakeServer(files, ORIGIN)
  const sw = fakeScope(server, caches)
  wire(sw.scope, build)
  await sw.install()
  await sw.activate()
  return { sw, server, build, caches, drawio }
}

describe('YAZ-5533: draw.io is not in the install', () => {
  it('install downloads no draw.io file and not the diagram chunk: the shell cache holds the app only', async () => {
    const { caches, server, build } = await installed('v1')
    expect(caches.dump()[cacheName('v1')]).toEqual(build.files.slice().sort())
    expect(server.calls.filter((c) => c.startsWith('/drawio/') || c.includes('drawDiagram'))).toEqual([])
    expect(Object.keys(caches.dump()).filter((n) => n.startsWith(DRAWIO_CACHE_PREFIX))).toEqual([])
  })

  it('the worker takes every /drawio/ request (the frame page too) and the diagram chunk, and nothing else of the kind', () => {
    const { build } = site('v1')
    const at = (path: string, mode = 'no-cors') => route({ url: `${ORIGIN}${path}`, method: 'GET', mode }, ORIGIN, build)
    expect(at('/drawio/aaaaaaaaaaaa/render', 'navigate')).toEqual({ kind: 'drawio', key: '/drawio/aaaaaaaaaaaa/render' })
    expect(at('/drawio/aaaaaaaaaaaa/stencils/aws4.js')).toEqual({ kind: 'drawio', key: '/drawio/aaaaaaaaaaaa/stencils/aws4.js' })
    expect(at('/drawio/0ldf0ld3r000/render', 'navigate').kind).toBe('drawio')
    expect(at('/assets/drawDiagram-v1.js')).toEqual({ kind: 'drawio', key: '/assets/drawDiagram-v1.js' })
    expect(route({ url: `${ORIGIN}/drawio/aaaaaaaaaaaa/render`, method: 'POST', mode: 'cors' }, ORIGIN, build).kind).toBe('pass')
    expect(route({ url: 'https://viewer.diagrams.net/js/viewer-static.min.js', method: 'GET', mode: 'no-cors' }, ORIGIN, build).kind).toBe('pass')
  })
})

describe('YAZ-5533: kept on first use, then offline', () => {
  it('the first diagram fetches only what it asks for, keeps it, and with no signal it is served from the cache', async () => {
    const { sw, server, caches } = await installed('v1')
    const base = '/drawio/aaaaaaaaaaaa/'
    for (const path of [`${base}render`, `${base}viewer-static.min.js`, `${base}stencils/aws4.js`, '/assets/drawDiagram-v1.js', '/assets/drawDiagram-v1.css']) {
      const answer = await sw.request(path, { mode: path.endsWith('render') ? 'navigate' : 'no-cors' })
      expect([path, answer?.status]).toEqual([path, 200])
    }
    expect(caches.dump()[drawioCacheName(base)]).toEqual(['/assets/drawDiagram-v1.css', '/assets/drawDiagram-v1.js', `${base}render`, `${base}stencils/aws4.js`, `${base}viewer-static.min.js`])
    // The font of another diagram was never asked: never fetched.
    expect(server.calls).not.toContain(`${base}fonts/Inter.js`)
    server.state.offline = true
    const calls = server.calls.length
    expect(await (await sw.request(`${base}render`, { mode: 'navigate' }))!.text()).toBe(RENDER_PAGE)
    expect(await (await sw.request(`${base}stencils/aws4.js`))!.text()).toBe('aws4()')
    expect(server.calls.length).toBe(calls)
  })

  it('with no signal before the first use: 503 (the diagram says it needs the internet the first time), nothing kept', async () => {
    const { sw, server, caches } = await installed('v1')
    server.state.offline = true
    const answer = await sw.request('/drawio/aaaaaaaaaaaa/render', { mode: 'navigate' })
    expect(answer?.status).toBe(503)
    expect(caches.dump()[drawioCacheName('/drawio/aaaaaaaaaaaa/')] ?? []).toEqual([])
  })

  it("the host's app page in a file's place (the single-page fallback, 200 text/html) is a 404 and is never kept", async () => {
    const { sw, caches } = await installed('v1')
    // A library this build does not have, and a renderer page of a folder the host no longer has.
    for (const [path, mode] of [['/drawio/aaaaaaaaaaaa/stencils/nope.js', 'no-cors'], ['/drawio/0ldf0ld3r000/render', 'navigate']]) {
      expect([path, (await sw.request(path, { mode }))?.status]).toEqual([path, 404])
    }
    expect(caches.dump()[drawioCacheName('/drawio/aaaaaaaaaaaa/')] ?? []).toEqual([])
  })
})

describe('YAZ-5533: the draw.io cache across updates', () => {
  it('an app update with the same draw.io folder keeps the kept files (nothing downloads again)', async () => {
    const caches = fakeCaches()
    const one = await installed('v1', caches)
    await one.sw.request('/drawio/aaaaaaaaaaaa/viewer-static.min.js')
    const two = await installed('v2', caches)
    await two.sw.message({ type: 'notecards:page-ready' })
    expect(Object.keys(caches.dump()).filter((n) => n.startsWith(DRAWIO_CACHE_PREFIX))).toEqual([drawioCacheName('/drawio/aaaaaaaaaaaa/')])
    two.server.state.offline = true
    expect((await two.sw.request('/drawio/aaaaaaaaaaaa/viewer-static.min.js'))?.status).toBe(200)
  })

  it('a new draw.io folder: the old cache goes once no page of an older version is open; the frame of a page is no page', async () => {
    const caches = fakeCaches()
    const one = await installed('v1', caches)
    await one.sw.request('/drawio/aaaaaaaaaaaa/viewer-static.min.js')
    const { files, build } = site('v2', '/drawio/bbbbbbbbbbbb/')
    const server = fakeServer(files, ORIGIN)
    // An open page of v1, with its hidden draw.io frame.
    const sw = fakeScope(server, caches, [{ id: 'A', url: `${ORIGIN}/` }, { id: 'F', url: `${ORIGIN}/drawio/aaaaaaaaaaaa/render` }])
    await one.sw.request(`${ORIGIN}/`, { mode: 'navigate', resultingClientId: 'A' })
    wire(sw.scope, build)
    await sw.install()
    await sw.activate()
    expect(Object.keys(caches.dump())).toContain(drawioCacheName('/drawio/aaaaaaaaaaaa/'))
    // The v1 page closes (its frame with it): the old folder goes.
    sw.windows.splice(0)
    await sw.message({ type: 'notecards:page-ready' })
    expect(Object.keys(caches.dump()).filter((n) => n.startsWith(DRAWIO_CACHE_PREFIX))).toEqual([])
  })

  it('the kill switch deletes the draw.io caches too, and nothing else of the browser', async () => {
    const caches = fakeCaches()
    const one = await installed('v1', caches)
    await one.sw.request('/drawio/aaaaaaaaaaaa/viewer-static.min.js')
    await (await caches.open('someone-else')).put('/x', new Response('x'))
    const kill = fakeScope(fakeServer({}, ORIGIN), caches)
    wireKillSwitch(kill.scope)
    await kill.install()
    await kill.activate()
    expect(Object.keys(caches.dump())).toEqual(['someone-else'])
  })
})
