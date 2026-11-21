import { describe, expect, it } from 'vitest'
import { PAGE_READY, SKIP_WAITING } from './swCore'
import { CHECK_EVERY_MS, SW_URL, createUpdates, updateAddress, withoutUpdateMark, type SwContainerLike, type SwRegistrationLike, type SwWorkerLike } from './updates'

/** The page side of the update (YAZ-5087): the worker is registered, a new version is noticed, and it takes over only when the page says so. */

type Fn = () => void
const on = () => {
  const fns = new Map<string, Fn[]>()
  return {
    addEventListener: (type: string, fn: Fn) => fns.set(type, [...(fns.get(type) ?? []), fn]),
    emit: (type: string) => (fns.get(type) ?? []).forEach((f) => f()),
  }
}

function worker(state = 'installed') {
  const e = on()
  const sent: unknown[] = []
  const w: SwWorkerLike & { sent: unknown[]; to(state: string): void } = {
    state,
    sent,
    postMessage: (m) => void sent.push(m),
    addEventListener: e.addEventListener,
    to(s) {
      w.state = s
      e.emit('statechange')
    },
  }
  return w
}

function container(opts: { controller?: boolean; waiting?: SwWorkerLike | null } = {}) {
  const e = on()
  const reg: SwRegistrationLike & { emit(type: string): void; updates: number } = {
    waiting: opts.waiting ?? null,
    installing: null,
    updates: 0,
    update: async () => void reg.updates++,
    addEventListener: (type, fn) => e.addEventListener(`reg:${type}`, fn),
    emit: (type) => e.emit(`reg:${type}`),
  }
  const registered: { url: string; options: unknown }[] = []
  const c: SwContainerLike & { registered: typeof registered; change(): void; reg: typeof reg } = {
    controller: opts.controller === false ? null : {},
    registered,
    reg,
    getRegistration: async () => reg,
    register: async (url, options) => {
      registered.push({ url, options })
      return reg
    },
    addEventListener: (type, fn) => e.addEventListener(type, fn),
    change: () => e.emit('controllerchange'),
  }
  return c
}

describe('YAZ-5555: nothing takes over at the start', () => {
  it('a waiting worker at the start: no message to it, no reload; the line is ready', async () => {
    const waiting = worker()
    const c = container({ waiting })
    let reloads = 0
    const u = createUpdates({ container: c, reload: () => reloads++, now: () => 0 })
    await u.start()
    expect(waiting.sent).toEqual([])
    expect(reloads).toBe(0)
    expect(u.ready()).toBe(true)
  })

  it('the browser activated the new version at a cold start (the worker still serves the chosen one): ready; apply loads it, once', async () => {
    const c = container()
    let reloads = 0
    const u = createUpdates({ container: c, reload: () => reloads++, now: () => 0, readState: async () => ({ active: 'v2', chosen: 'v1' }) })
    await u.start()
    expect(reloads).toBe(0)
    expect(u.ready()).toBe(true)
    u.apply()
    u.apply()
    expect(reloads).toBe(1)
  })

  it('the state is read again at each check (a return): a version chosen meanwhile, or an older worker that says nothing, is not ready', async () => {
    let state: { active: string; chosen: string } | null = { active: 'v2', chosen: 'v1' }
    const u = createUpdates({ container: container(), reload: () => {}, now: () => 0, readState: async () => state })
    await u.start()
    expect(u.ready()).toBe(true)
    state = { active: 'v2', chosen: 'v2' }
    await u.check()
    expect(u.ready()).toBe(false)
    state = null
    await u.check()
    expect(u.ready()).toBe(false)
  })

  it('the Restart address carries the update mark; the app removes it at its start', () => {
    const to = updateAddress('https://notecards.test/some/route?x=1#top')
    expect(to).toBe('https://notecards.test/some/route?x=1&notecards-update=1#top')
    expect(withoutUpdateMark(to)).toBe('https://notecards.test/some/route?x=1#top')
    expect(withoutUpdateMark('https://notecards.test/')).toBeNull()
  })
})

describe('while the app runs', () => {
  it(`registers ${SW_URL} for the whole site, and the browser never takes the worker file from its HTTP cache`, async () => {
    const c = container()
    await createUpdates({ container: c, reload: () => {}, now: () => 0 }).start()
    expect(c.registered).toEqual([{ url: '/sw.js', options: { scope: '/', updateViaCache: 'none' } }])
  })

  it('YAZ-5303: a started page tells its worker so (the page it replaced is gone)', async () => {
    const c = container()
    const sent: unknown[] = []
    c.controller = { postMessage: (m: unknown) => void sent.push(m) }
    await createUpdates({ container: c, reload: () => {}, now: () => 0 }).start()
    expect(sent).toEqual([{ type: PAGE_READY }])
  })

  it('a new version is ready only when it is whole (installed) and an old one runs the page', async () => {
    const c = container()
    const u = createUpdates({ container: c, reload: () => {}, now: () => 0 })
    const seen: boolean[] = []
    u.subscribe(() => seen.push(u.ready()))
    await u.start()
    expect(u.ready()).toBe(false)
    const next = worker('installing')
    c.reg.installing = next
    c.reg.emit('updatefound')
    expect(u.ready()).toBe(false) // still downloading
    c.reg.waiting = next
    next.to('installed')
    expect(u.ready()).toBe(true)
    expect(seen).toContain(true)
  })

  it('a failed install (redundant) is never ready', async () => {
    const c = container()
    const u = createUpdates({ container: c, reload: () => {}, now: () => 0 })
    await u.start()
    const next = worker('installing')
    c.reg.installing = next
    c.reg.emit('updatefound')
    next.to('redundant')
    expect(u.ready()).toBe(false)
  })

  it('the first install (no old version) shows no line', async () => {
    const c = container({ controller: false })
    const u = createUpdates({ container: c, reload: () => {}, now: () => 0 })
    await u.start()
    const next = worker('installing')
    c.reg.installing = next
    c.reg.emit('updatefound')
    next.to('installed')
    expect(u.ready()).toBe(false)
  })

  it('a version that already waited at start (the start swap timed out) is ready', async () => {
    const c = container({ waiting: worker() })
    const u = createUpdates({ container: c, reload: () => {}, now: () => 0 })
    await u.start()
    expect(u.ready()).toBe(true)
  })

  it('apply: the waiting worker takes over, then ONE reload', async () => {
    let reloads = 0
    const waiting = worker()
    const c = container({ waiting })
    const u = createUpdates({ container: c, reload: () => reloads++, now: () => 0 })
    await u.start()
    u.apply()
    expect(waiting.sent).toEqual([{ type: SKIP_WAITING }])
    expect(reloads).toBe(0) // not before the new worker runs the page
    c.change()
    c.change()
    expect(reloads).toBe(1)
  })

  it('the first install takes the page (clients.claim): no reload, no line', async () => {
    let reloads = 0
    const c = container({ controller: false })
    const u = createUpdates({ container: c, reload: () => reloads++, now: () => 0 })
    await u.start()
    c.change()
    expect(reloads).toBe(0)
    expect(u.ready()).toBe(false)
  })

  it('a takeover the page did not ask for (another tab): ready, no reload', async () => {
    let reloads = 0
    const c = container()
    const u = createUpdates({ container: c, reload: () => reloads++, now: () => 0 })
    await u.start()
    expect(u.ready()).toBe(false)
    c.change()
    expect(reloads).toBe(0)
    expect(u.ready()).toBe(true)
  })

  it(`asks for a new version when the app comes back, at most each ${CHECK_EVERY_MS / 60_000} minutes`, async () => {
    let t = 0
    const c = container()
    const u = createUpdates({ container: c, reload: () => {}, now: () => t })
    await u.start()
    expect(c.reg.updates).toBe(1) // the start asks
    await u.check()
    expect(c.reg.updates).toBe(1) // not again so soon
    t = CHECK_EVERY_MS
    await u.check()
    await u.check()
    expect(c.reg.updates).toBe(2)
  })
})
