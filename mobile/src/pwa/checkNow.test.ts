import { describe, expect, it } from 'vitest'
import { VERSION_ASK, askServed, servedVersion, wire, type ServedVersion, type ShellBuild, type WorkerState } from './swCore'
import { fakeServer } from './testing'
import { createUpdates, type SwContainerLike, type SwRegistrationLike, type SwWorkerLike } from './updates'

/**
 * YAZ-5593, Settings › Check for updates: the page asks the host now (`update()`, and `/version.txt` read by the worker
 * with no cache) and says: the newest build, a new version ready (the line and Restart), or the server out of reach
 * (offline, or a host that no longer serves the app). It never reloads or applies anything by itself. Made-up builds.
 */

type Fn = () => void
function worker(state: string) {
  const fns: Fn[] = []
  const sent: unknown[] = []
  const w: SwWorkerLike & { sent: unknown[]; to(s: string): void } = {
    state,
    sent,
    postMessage: (m) => void sent.push(m),
    addEventListener: (_t, fn) => void fns.push(fn),
    to(s) {
      w.state = s
      fns.forEach((f) => f())
    },
  }
  return w
}

/** A registration whose `update()` does what the host would: nothing new, a new worker found, or no signal. */
function setup(opts: { onUpdate?: (reg: SwRegistrationLike) => void; offline?: boolean; served?: ServedVersion | null; state?: WorkerState; installMs?: number }) {
  const reg: SwRegistrationLike & { updates: number } = {
    waiting: null,
    installing: null,
    updates: 0,
    update: async () => {
      reg.updates++
      if (reg.updates > 1 && opts.offline) throw new TypeError('Failed to fetch')
      if (reg.updates > 1) opts.onUpdate?.(reg)
    },
    addEventListener: () => {},
  }
  const c: SwContainerLike = { controller: {}, getRegistration: async () => reg, register: async () => reg, addEventListener: () => {} }
  let reloads = 0
  let asked = 0
  const u = createUpdates({
    container: c,
    reload: () => reloads++,
    now: () => 1000,
    readState: async () => opts.state ?? { active: 'v-old', chosen: 'v-old' },
    askServed: async () => (asked++, opts.offline ? null : opts.served === undefined ? { commit: 'bb8a4aa30', worker: 'v-old' } : opts.served),
    commit: 'bb8a4aa30',
    installMs: opts.installMs ?? 1000,
  })
  return { u, reg, reloads: () => reloads, asked: () => asked }
}

describe('YAZ-5593: Check for updates (the page side)', () => {
  it('the host serves this build: "newest"; it asked the host now (update and version.txt), nothing reloads', async () => {
    const t = setup({})
    await t.u.start()
    expect(await t.u.checkNow!()).toBe('newest')
    // At the start, and again at the tap: the tap is never skipped for the 30 minutes of `check`.
    expect(t.reg.updates).toBe(2)
    expect(t.asked()).toBe(1)
    expect(t.reloads()).toBe(0)
  })

  it('the same worker version under another commit (a change outside the app): still "newest"', async () => {
    const t = setup({ served: { commit: 'c0ffee123', worker: 'v-old' } })
    await t.u.start()
    expect(await t.u.checkNow!()).toBe('newest')
  })

  it('a new version already waits: "ready" (the line and Restart show), and it is not applied', async () => {
    const waiting = worker('installed')
    const t = setup({ served: { commit: 'f00d00d42', worker: 'v-new' }, onUpdate: (reg) => void (reg.waiting = waiting) })
    await t.u.start()
    expect(await t.u.checkNow!()).toBe('ready')
    expect(t.u.ready()).toBe(true)
    expect(waiting.sent).toEqual([])
    expect(t.reloads()).toBe(0)
  })

  it('the host serves a new build: it waits (busy) until the new version is downloaded whole, then "ready"; nothing reloads', async () => {
    const installing = worker('installing')
    const t = setup({ served: { commit: 'f00d00d42', worker: 'v-new' }, onUpdate: (reg) => void (reg.installing = installing) })
    await t.u.start()
    let done: string | null = null
    const check = t.u.checkNow!().then((r) => (done = r))
    await new Promise((r) => setTimeout(r, 20))
    expect(done).toBeNull()
    t.reg.waiting = installing
    t.reg.installing = null
    installing.to('installed')
    await check
    expect(done).toBe('ready')
    expect(installing.sent).toEqual([])
    expect(t.reloads()).toBe(0)
  })

  it('the browser activated a new version at a cold start (not chosen): "ready"', async () => {
    const t = setup({ state: { active: 'v-new', chosen: 'v-old' }, served: { commit: 'f00d00d42', worker: 'v-new' } })
    await t.u.start()
    expect(await t.u.checkNow!()).toBe('ready')
    expect(t.reloads()).toBe(0)
  })

  it('offline (update fails, the worker cannot read version.txt): "unreachable"', async () => {
    const t = setup({ offline: true })
    await t.u.start()
    expect(await t.u.checkNow!()).toBe('unreachable')
    expect(t.reloads()).toBe(0)
  })

  it('the host no longer serves the app (an old preview Home Screen app): "unreachable"', async () => {
    const t = setup({ served: null })
    await t.u.start()
    expect(await t.u.checkNow!()).toBe('unreachable')
  })

  it('a new build whose download fails (or never ends): "unreachable", not "ready"', async () => {
    const installing = worker('installing')
    const t = setup({ served: { commit: 'f00d00d42', worker: 'v-new' }, onUpdate: (reg) => void (reg.installing = installing), installMs: 30 })
    await t.u.start()
    expect(await t.u.checkNow!()).toBe('unreachable')
    const failing = worker('installing')
    const t2 = setup({ served: { commit: 'f00d00d42', worker: 'v-new' }, onUpdate: (reg) => void (reg.installing = failing) })
    await t2.u.start()
    const check = t2.u.checkNow!()
    await new Promise((r) => setTimeout(r, 10))
    failing.to('redundant')
    expect(await check).toBe('unreachable')
  })

  it('no worker registered (no service worker here): "unreachable"', async () => {
    const u = createUpdates({ container: undefined, reload: () => {}, now: () => 0 })
    await u.start()
    expect(await u.checkNow!()).toBe('unreachable')
  })
})

describe("YAZ-5593: the worker reads /version.txt for the page (the page's CSP lets it fetch only GitHub)", () => {
  it("version.txt's two lines; anything else is not the app's file", () => {
    expect(servedVersion('bb8a4aa30\nv-abc123\n')).toEqual({ commit: 'bb8a4aa30', worker: 'v-abc123' })
    expect(servedVersion('bb8a4aa30-dirty\nkill-switch\n')).toEqual({ commit: 'bb8a4aa30-dirty', worker: 'kill-switch' })
    expect(servedVersion('<!doctype html><title>Not found</title>')).toBeNull()
    expect(servedVersion('')).toBeNull()
    expect(servedVersion('bb8a4aa30\nv1\nmore\n')).toBeNull()
  })

  it('reads it with no cache; offline or an error page: null', async () => {
    const server = fakeServer({ '/version.txt': { body: 'bb8a4aa30\nv-abc123\n', type: 'text/plain' } })
    const inits: (RequestInit | undefined)[] = []
    const served = await askServed({ fetch: (input, init) => (inits.push(init), server.fetch(input)) })
    expect(served).toEqual({ commit: 'bb8a4aa30', worker: 'v-abc123' })
    expect(inits).toEqual([{ cache: 'no-store' }])
    server.state.offline = true
    expect(await askServed(server)).toBeNull()
    // A host that answers with something else (its own app page for a missing file, a 404).
    expect(await askServed(fakeServer({ '/': { body: '<!doctype html><p>Another site</p>' } }))).toBeNull()
    expect(await askServed(fakeServer({}))).toBeNull()
  })

  it('answers VERSION_ASK on the port the page sent', async () => {
    const server = fakeServer({ '/version.txt': { body: 'bb8a4aa30\nv-abc123\n', type: 'text/plain' } })
    const build: ShellBuild = { version: 'v-abc123', files: ['/'], entry: '/assets/index-a.js', pages: { '/': '/assets/index-a.js' } }
    const listeners = new Map<string, (e: unknown) => void>()
    const answers: unknown[] = []
    const waits: Promise<unknown>[] = []
    wire({ ...scopeOf(server), addEventListener: (type: string, fn: (e: unknown) => void) => void listeners.set(type, fn) } as unknown as Parameters<typeof wire>[0], build)
    listeners.get('message')!({ data: { type: VERSION_ASK }, ports: [{ postMessage: (m: unknown) => void answers.push(m) }], waitUntil: (p: Promise<unknown>) => void waits.push(p) })
    await Promise.all(waits)
    expect(answers).toEqual([{ commit: 'bb8a4aa30', worker: 'v-abc123' }])
  })
})

function scopeOf(server: ReturnType<typeof fakeServer>) {
  return { location: { origin: server.origin }, caches: undefined, fetch: (input: string) => server.fetch(input), skipWaiting: async () => {}, clients: { claim: async () => {} } }
}
