import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { wireKillSwitch } from './killSwitch'
import { cacheName, META_CACHE, wire, type ShellBuild } from './swCore'
import { fakeCaches, fakeScope, fakeServer } from './testing'

/**
 * YAZ-5285: the kill switch, the `sw.js` that a bad version is replaced with. It takes over with no page message,
 * deletes ONLY this app's shell caches, unregisters itself, and loads each open page again ONE time. It never touches
 * IndexedDB: the token, the vault copy and the waiting answers stay.
 */
const ORIGIN = 'https://notecards.test'
const files = { '/': { body: '<script src="/assets/index-v1.js"></script>' }, '/assets/index-v1.js': { body: 'x' } }
const build: ShellBuild = { version: 'v1', entry: '/assets/index-v1.js', files: Object.keys(files), pages: { '/': '/assets/index-v1.js' } }

describe('the kill switch', () => {
  it('takes over at install (no page message), clears only the shell caches and meta, unregisters, loads each open page again', async () => {
    const caches = fakeCaches()
    const server = fakeServer(files, ORIGIN)
    const good = fakeScope(server, caches)
    wire(good.scope, build)
    await good.install()
    await good.activate()
    await (await caches.open('other-app-cache')).put('/x', new Response('keep'))

    const kill = fakeScope(server, caches)
    kill.windows.push(`${ORIGIN}/`, `${ORIGIN}/friend#abc`)
    wireKillSwitch(kill.scope)
    await kill.install()
    expect(kill.log).toContain('skipWaiting')
    await kill.activate()
    expect(Object.keys(caches.dump())).toEqual(['other-app-cache'])
    expect(kill.log).toContain('unregister')
    expect(kill.log.filter((l) => l.startsWith('navigate'))).toEqual([`navigate ${ORIGIN}/`, `navigate ${ORIGIN}/friend#abc`])
    expect(caches.dump()[cacheName('v1')]).toBeUndefined()
    expect(caches.dump()[META_CACHE]).toBeUndefined()
  })

  it('with nothing to clear (the page registered it again), it unregisters and loads no page: no loop', async () => {
    const kill = fakeScope(fakeServer(files, ORIGIN))
    kill.windows.push(`${ORIGIN}/`)
    wireKillSwitch(kill.scope)
    await kill.install()
    await kill.activate()
    expect(kill.log).toContain('unregister')
    expect(kill.log.some((l) => l.startsWith('navigate'))).toBe(false)
  })

  it('answers no request (the network does), and never touches IndexedDB or sends Clear-Site-Data', async () => {
    const kill = fakeScope(fakeServer(files, ORIGIN))
    wireKillSwitch(kill.scope)
    expect(await kill.request(`${ORIGIN}/`, { mode: 'navigate' })).toBeNull()
    const code = readFileSync(new URL('./killSwitch.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
    expect(code).not.toMatch(/indexedDB|IDB|Clear-Site-Data|localStorage/)
  })
})
