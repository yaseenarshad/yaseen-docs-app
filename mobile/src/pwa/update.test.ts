import { describe, expect, it } from 'vitest'
import { CACHE_PREFIX, PAGE_READY, STATE_ASK, UPDATE_MARK, cacheName, chooseVersion, wire, type ShellBuild } from './swCore'
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

/**
 * The host of one deploy, a worker of that deploy, installed and active, on the phone's shared caches and pages. `chosen`
 * (the default): the person also tapped Restart for it (YAZ-5555: else page opens keep the version chosen before).
 */
async function deploy(v: string, caches: ReturnType<typeof fakeCaches>, windows: FakeWindow[], chosen = true) {
  const { files, build } = site(v)
  const sw = fakeScope(fakeServer(files, ORIGIN), caches, windows)
  wire(sw.scope, build)
  await sw.install()
  if (chosen) await chooseVersion(caches, v)
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

  it('the replaced page is often still there at the page open: the new page\'s "page ready" message removes its version then', async () => {
    const caches = fakeCaches()
    const windows: FakeWindow[] = []
    const sw1 = await deploy('v1', caches, windows)
    windows.push({ id: 'A', url: `${ORIGIN}/` })
    await sw1.request(`${ORIGIN}/`, { mode: 'navigate', resultingClientId: 'A' })
    const sw2 = await deploy('v2', caches, windows)
    // The tab opens the app again: at the page open, the old page A is still listed beside the new page B.
    windows.push({ id: 'B', url: `${ORIGIN}/` })
    await sw2.request(`${ORIGIN}/`, { mode: 'navigate', resultingClientId: 'B' })
    expect(await shells(caches)).toEqual([cacheName('v1'), cacheName('v2')])
    // Page B has started; A is gone.
    windows.splice(0, 1)
    await sw2.message({ type: PAGE_READY })
    expect(await shells(caches)).toEqual([cacheName('v2')])
  })

  it("an OLD worker that still gets a message never removes the cache of a newer version (installed, waiting)", async () => {
    const caches = fakeCaches()
    const windows: FakeWindow[] = []
    const sw1 = await deploy('v1', caches, windows)
    windows.push({ id: 'A', url: `${ORIGIN}/` })
    await sw1.request(`${ORIGIN}/`, { mode: 'navigate', resultingClientId: 'A' })
    // v2 installs and waits (not active yet).
    const { files, build } = site('v2')
    const sw2 = fakeScope(fakeServer(files, ORIGIN), caches, windows)
    wire(sw2.scope, build)
    await sw2.install()
    // The old page tells its (old) worker that it started.
    await sw1.message({ type: PAGE_READY })
    expect(await shells(caches)).toEqual([cacheName('v1'), cacheName('v2')])
    // v2 takes over; A still open: both stay.
    await sw2.activate()
    expect(await shells(caches)).toEqual([cacheName('v1'), cacheName('v2')])
  })
})

/**
 * YAZ-5555: NO SILENT SWITCH. The browser activates a waiting version by itself once no page of the old one is open (a
 * cold start); the page open still gets the version the person runs, until a tap on Restart (its load has
 * `UPDATE_MARK`) chooses the newest. The page asks `STATE_ASK` to show "A new version is ready".
 */
describe('YAZ-5555: a new version runs only after a tap on Restart', () => {
  const state = async (sw: Awaited<ReturnType<typeof deploy>>) => {
    const got: unknown[] = []
    await sw.message({ type: STATE_ASK }, [{ postMessage: (m: unknown) => void got.push(m) }])
    return got[0]
  }

  it('a cold start after the new version activated: the page is still the old one, and the state says a new one is ready', async () => {
    const caches = fakeCaches()
    await deploy('v1', caches, [])
    const sw2 = await deploy('v2', caches, [], false)
    const page = await sw2.request(`${ORIGIN}/`, { mode: 'navigate', resultingClientId: 'A' })
    expect(await page!.text()).toContain('index-v1.js')
    expect(await state(sw2)).toEqual({ active: 'v2', chosen: 'v1' })
    // Its chunks come from the kept copy; the chosen version's cache is never pruned while it is chosen.
    expect(await (await sw2.request(`${ORIGIN}/assets/service-v1.js`, { clientId: 'A' }))!.text()).toBe('service v1')
    expect(await shells(caches)).toEqual([cacheName('v1'), cacheName('v2')])
    // Another cold start: still v1.
    expect(await (await sw2.request(`${ORIGIN}/some/route`, { mode: 'navigate', resultingClientId: 'B' }))!.text()).toContain('index-v1.js')
  })

  it("Restart: the open with the update mark gets the new version and chooses it; later opens keep it; the old cache goes", async () => {
    const caches = fakeCaches()
    const windows: FakeWindow[] = []
    await deploy('v1', caches, windows)
    const sw2 = await deploy('v2', caches, windows, false)
    windows.push({ id: 'C', url: `${ORIGIN}/?${UPDATE_MARK}=1` })
    expect(await (await sw2.request(`${ORIGIN}/?${UPDATE_MARK}=1`, { mode: 'navigate', resultingClientId: 'C' }))!.text()).toContain('index-v2.js')
    expect(await state(sw2)).toEqual({ active: 'v2', chosen: 'v2' })
    expect(await (await sw2.request(`${ORIGIN}/`, { mode: 'navigate', resultingClientId: 'C' }))!.text()).toContain('index-v2.js')
    expect(await shells(caches)).toEqual([cacheName('v2')])
  })

  it('the first install (nothing chosen yet) runs itself; a chosen cache that is gone falls back to the active version', async () => {
    const caches = fakeCaches()
    const sw1 = await deploy('v1', caches, [], false)
    expect(await state(sw1)).toEqual({ active: 'v1', chosen: 'v1' })
    await chooseVersion(caches, 'v0-gone')
    expect(await (await sw1.request(`${ORIGIN}/`, { mode: 'navigate' }))!.text()).toContain('index-v1.js')
  })
})
