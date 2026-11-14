import { describe, expect, it } from 'vitest'
import { SKIP_WAITING } from './swCore'
import { CHECK_EVERY_MS, SW_URL, createUpdates, swapAtStart, type SwContainerLike, type SwRegistrationLike, type SwWorkerLike } from './updates'

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

describe('at the start: a version that waits starts now, before the app runs', () => {
  it('a waiting worker: it is told to take over, and the page loads again once (nothing of the app ran yet)', async () => {
    const waiting = worker()
    const c = container({ waiting })
    let reloads = 0
    const swapping = swapAtStart(c, () => reloads++, 3000)
    await Promise.resolve()
    expect(waiting.sent).toEqual([{ type: SKIP_WAITING }])
    c.change()
    expect(await swapping).toBe(true)
    expect(reloads).toBe(1)
  })

  it('nothing waits: the app starts at once, no reload', async () => {
    let reloads = 0
    expect(await swapAtStart(container(), () => reloads++, 3000)).toBe(false)
    expect(reloads).toBe(0)
  })

  it('the worker does not take over in time: the app starts with the old version (never a blank screen)', async () => {
    let reloads = 0
    expect(await swapAtStart(container({ waiting: worker() }), () => reloads++, 5)).toBe(false)
    expect(reloads).toBe(0)
  })

  it('no service worker in this browser: the app starts', async () => {
    expect(await swapAtStart(undefined, () => {}, 5)).toBe(false)
  })
})

describe('while the app runs', () => {
  it(`registers ${SW_URL} for the whole site, and the browser never takes the worker file from its HTTP cache`, async () => {
    const c = container()
    await createUpdates({ container: c, reload: () => {}, now: () => 0 }).start()
    expect(c.registered).toEqual([{ url: '/sw.js', options: { scope: '/', updateViaCache: 'none' } }])
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

  it('apply: the waiting worker takes over, then ONE reload; a takeover the page did not ask for (the first claim) reloads nothing', async () => {
    let reloads = 0
    const waiting = worker()
    const c = container({ waiting })
    const u = createUpdates({ container: c, reload: () => reloads++, now: () => 0 })
    await u.start()
    c.change()
    expect(reloads).toBe(0)
    u.apply()
    expect(waiting.sent).toEqual([{ type: SKIP_WAITING }])
    c.change()
    c.change()
    expect(reloads).toBe(1)
  })

  it(`asks for a new version when the app comes back, at most each ${CHECK_EVERY_MS / 60_000} minutes`, async () => {
    let t = 0
    const c = container()
    const u = createUpdates({ container: c, reload: () => {}, now: () => t })
    await u.start()
    await u.check()
    expect(c.reg.updates).toBe(0) // the start asked already
    t = CHECK_EVERY_MS
    await u.check()
    await u.check()
    expect(c.reg.updates).toBe(1)
  })
})
