import { describe, expect, it } from 'vitest'
import { githubClient } from '../github/client'
import type { PhoneVault } from '../store'
import { POLL_MS, SEND_AFTER_MS } from './cadence'
import { createSyncEngine, type SyncEvent, type SyncEngineOptions } from './engine'
import { githubRemote } from './githubRemote'
import { BRANCH, REPO, TOKEN, VAULT, fakeClock, pageText, syncSetup, type SyncSetup } from './testing'

const VAULT_ROW: PhoneVault = { repo: REPO, branch: BRANCH, addedAt: 0 }

async function setup(files: Record<string, string | Uint8Array> = { 'a.md': pageText('A', 'NC-1', ['NC-2']) }, extra: Partial<SyncEngineOptions> = {}) {
  const s = await syncSetup(files)
  const clock = fakeClock()
  const events: SyncEvent[] = []
  const engine = createSyncEngine({
    store: s.store,
    tokens: s.tokens,
    clock,
    yieldToUi: async () => {},
    makeRemote: (vault, token) => githubRemote(githubClient(token, { fetch: s.github.fetch, now: clock.now }), vault.repo, vault.branch),
    ...extra,
  })
  engine.subscribe((e) => events.push(e))
  /** Moves the clock, then waits for the pass that a timer started. */
  const tick = async (ms: number) => {
    clock.advance(ms)
    await engine.idle()
  }
  return { s, clock, engine, events, tick, refs: () => s.count('ref') }
}
const statuses = (events: SyncEvent[]) => events.filter((e) => e.type === 'state').map((e) => (e.type === 'state' ? e.state.status : ''))

describe('cadence (decision 4, October decision 6)', () => {
  it('the numbers', () => {
    expect(POLL_MS).toBe(15_000)
    expect(SEND_AFTER_MS).toBe(5_000)
  })
})

describe('the sync engine: when a pass runs', () => {
  it('on open: one pass at once; then each POLL_MS while visible; a 304 is all a quiet poll costs', async () => {
    const t = await setup()
    await t.engine.open(VAULT_ROW)
    await t.engine.idle()
    expect(t.engine.state()).toMatchObject({ status: 'synced', vault: VAULT, problem: null })
    expect(t.engine.index()!.records['a.md'].title).toBe('A')
    expect(t.refs()).toBe(1)
    await t.tick(POLL_MS - 1)
    expect(t.refs()).toBe(1)
    await t.tick(1)
    expect(t.refs()).toBe(2)
    await t.tick(POLL_MS)
    expect(t.refs()).toBe(3)
    expect(t.s.count('tree')).toBe(1)
  })

  it('open reads the stored index first, so the screens show the vault before any network (N1)', async () => {
    const t = await setup()
    await t.engine.open(VAULT_ROW)
    await t.engine.idle()
    const again = await setup()
    void again
    t.s.github.offline = true
    t.engine.stop()
    const second = createSyncEngine({ store: t.s.store, tokens: t.s.tokens, clock: t.clock, yieldToUi: async () => {}, makeRemote: (v, tok) => githubRemote(githubClient(tok, { fetch: t.s.github.fetch }), v.repo, v.branch) })
    const seen: SyncEvent[] = []
    second.subscribe((e) => seen.push(e))
    await second.open(VAULT_ROW)
    expect(second.index()!.records['a.md'].title).toBe('A')
    await second.idle()
    expect(second.state()).toMatchObject({ status: 'off', problem: 'OFFLINE' })
    expect(seen.some((e) => e.type === 'changed')).toBe(true)
  })

  it('R2 and R3: a change on GitHub reaches the phone at the next poll; the event names the changed files', async () => {
    const t = await setup()
    await t.engine.open(VAULT_ROW)
    await t.engine.idle()
    await t.s.git.push({ 'a.md': pageText('A2', 'NC-1') })
    await t.tick(POLL_MS)
    const changed = t.events.filter((e) => e.type === 'changed').at(-1)
    expect(changed).toMatchObject({ type: 'changed', vault: VAULT, diff: { changed: ['a.md'] } })
    expect(t.engine.index()!.records['a.md'].title).toBe('A2')
  })

  it('R9 and R10: no poll while hidden; one pass at once when the app comes back', async () => {
    const t = await setup()
    await t.engine.open(VAULT_ROW)
    await t.engine.idle()
    t.engine.setVisible(false)
    await t.tick(POLL_MS * 10)
    expect(t.refs()).toBe(1)
    expect(t.clock.pending()).toBe(0)
    t.engine.setVisible(true)
    await t.engine.idle()
    expect(t.refs()).toBe(2)
  })

  it('pull to refresh during a pass joins that pass (one pass at a time)', async () => {
    const t = await setup()
    await t.engine.open(VAULT_ROW)
    const a = t.engine.syncNow()
    const b = t.engine.syncNow()
    await Promise.all([a, b])
    expect(t.refs()).toBe(1)
    await t.engine.syncNow()
    expect(t.refs()).toBe(2)
  })

  it('only the open vault polls (decision 7); a switch moves the polling', async () => {
    const t = await setup()
    await t.engine.open(VAULT_ROW)
    await t.engine.idle()
    await t.s.tokens.write('yaseen/other@main', TOKEN)
    await t.engine.open({ repo: 'yaseen/other', branch: 'main', addedAt: 1 })
    await t.engine.idle()
    const before = t.s.github.calls.length
    await t.tick(POLL_MS)
    const polled = t.s.github.calls.slice(before).map((c) => c.url)
    expect(polled.every((u) => u.includes('/yaseen/other/'))).toBe(true)
    await t.engine.open(null)
    const after = t.s.github.calls.length
    await t.tick(POLL_MS * 3)
    expect(t.s.github.calls.length).toBe(after)
  })

  it('progress events during the first download (4A\'s progress bar); syncing, then synced', async () => {
    const files = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`p${i}.md`, `x${i}`]))
    const t = await setup(files)
    await t.engine.open(VAULT_ROW)
    await t.engine.idle()
    const progress = t.events.flatMap((e) => (e.type === 'state' && e.state.progress ? [e.state.progress] : []))
    expect(progress.at(-1)).toEqual({ done: 5, total: 5 })
    expect(statuses(t.events)).toContain('syncing')
    expect(t.engine.state().status).toBe('synced')
    expect(t.engine.state().lastSyncedAt).toBe(t.clock.now())
  })
})

describe('the sync engine: failures and the status for 4D', () => {
  it('N1, N2, N5: no connection or GitHub down: grey "off", the local copy stays, it retries at the next tick, no throw', async () => {
    const t = await setup()
    await t.engine.open(VAULT_ROW)
    await t.engine.idle()
    t.s.github.offline = true
    await t.tick(POLL_MS)
    expect(t.engine.state()).toMatchObject({ status: 'off', problem: 'OFFLINE' })
    t.s.github.offline = false
    t.s.github.down = true
    await t.tick(POLL_MS)
    expect(t.engine.state()).toMatchObject({ status: 'off', problem: 'GITHUB_DOWN' })
    t.s.github.down = false
    await t.tick(POLL_MS)
    expect(t.engine.state()).toMatchObject({ status: 'synced', problem: null })
    expect(t.engine.index()!.records['a.md']).toBeDefined()
  })

  it('the connection comes back: one pass at once', async () => {
    const t = await setup()
    await t.engine.open(VAULT_ROW)
    await t.engine.idle()
    t.engine.online()
    await t.engine.idle()
    expect(t.refs()).toBe(2)
  })

  it('N4: the hourly limit: amber "slowed" until the reset time; no call before it; then it tries again', async () => {
    const t = await setup()
    await t.engine.open(VAULT_ROW)
    await t.engine.idle()
    const reset = Math.floor(t.clock.now() / 1000) + 600
    t.s.github.rateLimitedUntil = reset
    await t.tick(POLL_MS)
    expect(t.engine.state()).toMatchObject({ status: 'slowed', problem: 'RATE_LIMITED', retryAt: reset * 1000 })
    const calls = t.s.github.calls.length
    await t.tick(POLL_MS * 4)
    t.engine.setVisible(false)
    t.engine.setVisible(true)
    await t.engine.idle()
    expect(t.s.github.calls.length).toBe(calls)
    t.s.github.rateLimitedUntil = null
    await t.tick(reset * 1000 - t.clock.now())
    expect(t.s.github.calls.length).toBe(calls + 1)
    expect(t.engine.state().status).toBe('synced')
  })

  it('round 10 item 20: GitHub\'s "slow down" with Retry-After waits that long', async () => {
    const t = await setup()
    await t.engine.open(VAULT_ROW)
    await t.engine.idle()
    t.s.github.interrupt = () => new Response(JSON.stringify({ message: 'You have exceeded a secondary rate limit.' }), { status: 429, headers: { 'retry-after': '90' } })
    await t.tick(POLL_MS)
    expect(t.engine.state()).toMatchObject({ status: 'slowed', retryAt: t.clock.now() + 90_000 })
    t.s.github.interrupt = null
    const calls = t.s.github.calls.length
    await t.tick(89_999)
    expect(t.s.github.calls.length).toBe(calls)
    await t.tick(1)
    expect(t.engine.state().status).toBe('synced')
  })

  it('N6: a cancelled token: red "attention", sync stops, the local copy stays readable', async () => {
    const t = await setup()
    await t.engine.open(VAULT_ROW)
    await t.engine.idle()
    t.s.github.revoke(TOKEN)
    await t.tick(POLL_MS)
    expect(t.engine.state()).toMatchObject({ status: 'attention', problem: 'UNAUTHORIZED' })
    const calls = t.s.github.calls.length
    await t.tick(POLL_MS * 5)
    expect(t.s.github.calls.length).toBe(calls)
    expect(t.engine.index()!.records['a.md']).toBeDefined()
    expect(await t.s.tokens.read(VAULT)).toBe(TOKEN) // 4A calls signInAgain; the engine never clears the token
  })

  it('R12: the branch or repo is gone: red "attention", NOT_FOUND; the local copy stays', async () => {
    const t = await setup()
    await t.engine.open(VAULT_ROW)
    await t.engine.idle()
    t.s.git.branches.delete(BRANCH)
    await t.tick(POLL_MS)
    expect(t.engine.state()).toMatchObject({ status: 'attention', problem: 'NOT_FOUND' })
    expect(t.engine.index()).not.toBeNull()
  })

  it('no token for the open vault: attention NO_TOKEN, no call', async () => {
    const t = await setup()
    await t.s.tokens.clear(VAULT)
    await t.engine.open(VAULT_ROW)
    await t.engine.idle()
    expect(t.engine.state()).toMatchObject({ status: 'attention', problem: 'NO_TOKEN' })
    expect(t.s.github.calls).toHaveLength(0)
  })

  it('F6 in the engine: a cut-short list is attention TREE_TRUNCATED, and no vault shows', async () => {
    const t = await setup()
    t.s.git.truncateOver = 0
    await t.engine.open(VAULT_ROW)
    await t.engine.idle()
    expect(t.engine.state()).toMatchObject({ status: 'attention', problem: 'TREE_TRUNCATED' })
    expect(t.engine.index()).toBeNull()
  })

  it('no event or state ever holds the token', async () => {
    const t = await setup()
    await t.engine.open(VAULT_ROW)
    await t.engine.idle()
    t.s.github.revoke(TOKEN)
    await t.tick(POLL_MS)
    expect(JSON.stringify(t.events)).not.toContain(TOKEN)
    expect(JSON.stringify(t.engine.state())).not.toContain(TOKEN)
  })
})

describe('the sync engine: P4, on demand, and the lane for 3C', () => {
  it('P4: each pass holds the vault\'s lock, so two tabs never sync at once; the second tab then gets a free 304 and reads the new index from the store', async () => {
    const t = await setup()
    const held: string[] = []
    let busy = Promise.resolve()
    const lock = <T>(name: string, fn: () => Promise<T>): Promise<T> => {
      const run = busy.then(async () => {
        held.push(name)
        return fn()
      })
      busy = run.then(() => undefined, () => undefined)
      return run
    }
    const mk = () => createSyncEngine({ store: t.s.store, tokens: t.s.tokens, clock: t.clock, lock, yieldToUi: async () => {}, makeRemote: (v, tok) => githubRemote(githubClient(tok, { fetch: t.s.github.fetch }), v.repo, v.branch) })
    const tabA = mk()
    const tabB = mk()
    await Promise.all([tabA.open(VAULT_ROW), tabB.open(VAULT_ROW)])
    await Promise.all([tabA.idle(), tabB.idle()])
    expect(held).toEqual([`notecards-sync:${VAULT}`, `notecards-sync:${VAULT}`])
    expect(t.s.count('tree')).toBe(1)
    expect(t.s.count('blob')).toBe(1)
    expect(tabB.index()!.records['a.md'].title).toBe('A')
    tabA.stop()
    tabB.stop()
  })

  it('file(path): a picture shows for the first time: fetched by the checkpoint\'s SHA, then kept', async () => {
    const t = await setup({ 'a.md': 'A', 'p.png': new Uint8Array([7, 7]) })
    await t.engine.open(VAULT_ROW)
    await t.engine.idle()
    expect(await t.s.store.read(VAULT, 'p.png')).toBeNull()
    expect((await t.engine.file('p.png'))!.content).toEqual(new Uint8Array([7, 7]))
    const blobs = t.s.count('blob')
    await t.engine.file('p.png')
    expect(t.s.count('blob')).toBe(blobs)
    expect(await t.engine.file('nope.png')).toBeNull()
  })

  it('lane(fn): 3C\'s send runs between passes with the same remote, then a pass picks up the new head', async () => {
    const t = await setup()
    await t.engine.open(VAULT_ROW)
    await t.engine.idle()
    const sha = await t.engine.lane(async (remote) => {
      const head = await remote.head()
      if (head === 'unchanged') throw new Error('no')
      return remote.commit(head.sha, [{ path: 'a.md', content: pageText('From phone', 'NC-1') }], 'sync (phone): a.md')
    })
    expect(t.s.git.branches.get(BRANCH)).toBe(sha)
    await t.engine.syncNow()
    expect(t.engine.index()!.records['a.md'].title).toBe('From phone')
  })
})

describe('the lane for 3C (YAZ-5073): a pass inside it, and one thing at a time with no Web Lock', () => {
  it('lane(fn) gives fn a pass that runs in the lane and tells the screens, as a pass of the engine does', async () => {
    const t = await setup()
    await t.engine.open(VAULT_ROW)
    await t.engine.idle()
    await t.s.git.push({ 'b.md': pageText('B', 'NC-4') })
    t.events.length = 0
    const result = await t.engine.lane(async (_remote, pass) => pass())
    expect(result).toMatchObject({ kind: 'synced' })
    expect(t.engine.index()!.records['b.md'].title).toBe('B')
    const changed = t.events.find((e) => e.type === 'changed')
    expect(changed).toMatchObject({ type: 'changed', diff: { added: ['b.md'] } })
    expect(t.engine.state()).toMatchObject({ status: 'synced', lastSyncedAt: t.clock.now() })
  })

  it('a pass that the timer starts while a lane runs waits for the lane to end (the default lock is none in this test)', async () => {
    const t = await setup()
    await t.engine.open(VAULT_ROW)
    await t.engine.idle()
    const log: string[] = []
    let release: () => void = () => {}
    const lane = t.engine.lane(async () => {
      log.push('lane start')
      await new Promise<void>((r) => (release = r))
      log.push('lane end')
    })
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0))
    const refs = t.refs()
    t.clock.advance(POLL_MS)
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0))
    expect(t.refs()).toBe(refs) // the poll waits
    release()
    await lane
    await t.engine.idle()
    expect(t.refs()).toBe(refs + 1)
    expect(log).toEqual(['lane start', 'lane end'])
  })
})

describe('followPage: the page events', () => {
  it('hidden stops the polling, visible runs a pass at once, online runs a pass at once; the undo removes the listeners', async () => {
    const { followPage } = await import('./pageEvents')
    const t = await setup()
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState })
    const win = new EventTarget()
    const undo = followPage(t.engine, doc as unknown as Document, win as unknown as Window)
    await t.engine.open(VAULT_ROW)
    await t.engine.idle()
    doc.visibilityState = 'hidden'
    doc.dispatchEvent(new Event('visibilitychange'))
    await t.tick(POLL_MS * 3)
    expect(t.refs()).toBe(1)
    doc.visibilityState = 'visible'
    doc.dispatchEvent(new Event('visibilitychange'))
    await t.engine.idle()
    expect(t.refs()).toBe(2)
    win.dispatchEvent(new Event('online'))
    await t.engine.idle()
    expect(t.refs()).toBe(3)
    undo()
    win.dispatchEvent(new Event('online'))
    await t.engine.idle()
    expect(t.refs()).toBe(3)
  })

  it('file(path) gives null for a page over the size limit (metadata only, F7)', async () => {
    const t = await setup({ 'a.md': 'A' })
    await t.engine.open(VAULT_ROW)
    await t.engine.idle()
    await t.s.store.remove(VAULT, 'a.md')
    expect(await t.engine.file('a.md')).toBeNull()
  })
})

describe('YAZ-5072 round 1 fixes', () => {
  it('hidden while a pass runs: the pass ends, and NO poll is planned while hidden (R9); visible again polls at once', async () => {
    const t = await setup()
    await t.engine.open(VAULT_ROW) // the first pass is running now
    t.engine.setVisible(false)
    await t.engine.idle()
    expect(t.engine.state().status).toBe('synced')
    expect(t.clock.pending()).toBe(0)
    await t.tick(POLL_MS * 4)
    expect(t.refs()).toBe(1)
    // The same after a pass that fails (off) while hidden.
    t.engine.setVisible(true)
    await t.engine.idle()
    t.s.github.offline = true
    const failing = t.engine.syncNow()
    t.engine.setVisible(false)
    await failing
    expect(t.engine.state().status).toBe('off')
    expect(t.clock.pending()).toBe(0)
  })

  it('YAZ-5174: a "slow down" with retry-after: 0 plans the next try at least 60 s later, not at once', async () => {
    const t = await setup()
    await t.engine.open(VAULT_ROW)
    await t.engine.idle()
    t.s.github.interrupt = () => new Response(JSON.stringify({ message: 'You have exceeded a secondary rate limit.' }), { status: 403, headers: { 'retry-after': '0' } })
    await t.engine.syncNow()
    expect(t.engine.state().status).toBe('slowed')
    expect(t.engine.state().retryAt! - t.clock.now()).toBeGreaterThanOrEqual(60_000)
    const calls = t.s.github.calls.length
    await t.tick(59_999)
    expect(t.s.github.calls.length).toBe(calls)
  })

  it('YAZ-5169: "slow down" again and again: the wait grows (backoff) up to a ceiling, and never under the floor', async () => {
    const t = await setup()
    await t.engine.open(VAULT_ROW)
    await t.engine.idle()
    t.s.github.interrupt = () => new Response(JSON.stringify({ message: 'You have exceeded a secondary rate limit.' }), { status: 403, headers: { 'retry-after': '60' } })
    const waits: number[] = []
    for (let i = 0; i < 9; i++) {
      await t.engine.syncNow()
      waits.push(t.engine.state().retryAt! - t.clock.now())
    }
    expect(waits.slice(0, 4)).toEqual([60_000, 120_000, 240_000, 480_000])
    expect(Math.max(...waits)).toBe(3_600_000)
    t.s.github.interrupt = null
    await t.engine.syncNow()
    expect(t.engine.state().status).toBe('synced')
    // After a good pass, the next "slow down" starts from the floor again.
    t.s.github.interrupt = () => new Response(JSON.stringify({ message: 'You have exceeded a secondary rate limit.' }), { status: 403, headers: { 'retry-after': '60' } })
    await t.engine.syncNow()
    expect(t.engine.state().retryAt! - t.clock.now()).toBe(60_000)
  })
})
