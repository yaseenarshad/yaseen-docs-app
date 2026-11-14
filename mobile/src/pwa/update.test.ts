import { describe, expect, it } from 'vitest'
import { CACHE_PREFIX, cacheName, wire, type ShellBuild } from './swCore'
import { fakeCaches, fakeScope, fakeServer, type FakeFile, type FakeWindow } from './testing'

/**
 * YAZ-5303: a page of an OLD version stays open while newer versions take over (one, or two in a row). Each chunk of
 * its version must come from the stored copy until the page is gone; the host no longer has it (its single-page
 * fallback answers the app page). A version's cache goes only when no page of that version is left.
 */
const ORIGIN = 'https://notecards.test'

function site(v: string): { files: Record<string, FakeFile>; build: ShellBuild } {
  const entry = `/assets/index-${v}.js`
  const files: Record<string, FakeFile> = {
    '/': { body: `<!doctype html><script type="module" src="${entry}"></script>` },
    [entry]: { body: `index ${v}` },
    [`/assets/service-${v}.js`]: { body: `service ${v}` },
    [`/assets/review-${v}.css`]: { body: `.r{} /* ${v} */` },
  }
  return { files, build: { version: v, entry, files: Object.keys(files), pages: { '/': entry } } }
}

/** The host of one deploy, a worker of that deploy, installed and active, on the phone's shared caches and pages. */
async function deploy(v: string, caches: ReturnType<typeof fakeCaches>, windows: FakeWindow[]) {
  const { files, build } = site(v)
  const sw = fakeScope(fakeServer(files, ORIGIN), caches, windows)
  wire(sw.scope, build)
  await sw.install()
  await sw.activate()
  return sw
}

const shells = async (caches: ReturnType<typeof fakeCaches>) => (await caches.keys()).filter((n) => n.startsWith(CACHE_PREFIX)).sort()

describe('an old page during an update (YAZ-5303)', () => {
  it('a page of the old version gets every one of its chunks from the stored copy while the new version takes over', async () => {
    const caches = fakeCaches()
    const windows: FakeWindow[] = []
    const sw1 = await deploy('v1', caches, windows)
    // Page A opens under v1.
    windows.push({ id: 'A', url: `${ORIGIN}/` })
    await sw1.request(`${ORIGIN}/`, { mode: 'navigate', resultingClientId: 'A' })
    // Two deploys in a row while A stays open (a phone that keeps the app open over a day).
    await deploy('v2', caches, windows)
    const sw3 = await deploy('v3', caches, windows)
    for (const chunk of ['/assets/index-v1.js', '/assets/service-v1.js', '/assets/review-v1.css']) {
      const answer = await sw3.request(`${ORIGIN}${chunk}`, { clientId: 'A' })
      expect([chunk, answer!.status, await answer!.text()]).toEqual([chunk, 200, expect.stringContaining('v1')])
    }
  })

  it('a version goes only when no page of it is left; then the next open clears every older version', async () => {
    const caches = fakeCaches()
    const windows: FakeWindow[] = []
    const sw1 = await deploy('v1', caches, windows)
    windows.push({ id: 'A', url: `${ORIGIN}/` })
    await sw1.request(`${ORIGIN}/`, { mode: 'navigate', resultingClientId: 'A' })
    const sw2 = await deploy('v2', caches, windows)
    expect(await shells(caches)).toEqual([cacheName('v1'), cacheName('v2')])
    // A closes; page B opens under v2: v1 has no page left.
    windows.splice(0, windows.length, { id: 'B', url: `${ORIGIN}/` })
    await sw2.request(`${ORIGIN}/`, { mode: 'navigate', resultingClientId: 'B' })
    expect(await shells(caches)).toEqual([cacheName('v2')])
  })

  it('a page that no worker knows (open since before this rule): every stored version stays', async () => {
    const caches = fakeCaches()
    const windows: FakeWindow[] = [{ id: 'old-page', url: `${ORIGIN}/` }]
    await deploy('v1', caches, windows)
    await deploy('v2', caches, windows)
    await deploy('v3', caches, windows)
    expect(await shells(caches)).toEqual([cacheName('v1'), cacheName('v2'), cacheName('v3')])
  })

  it('no page open: only the newest version stays', async () => {
    const caches = fakeCaches()
    for (const v of ['v1', 'v2', 'v3']) await deploy(v, caches, [])
    expect(await shells(caches)).toEqual([cacheName('v3')])
  })
})
