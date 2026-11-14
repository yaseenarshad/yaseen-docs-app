import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { CardRecord } from '@shared/cardLine'
import { INDEX_FILE, NUMBERS_FILE, POINTER_FILE, ensureFriendsFiles, makePointer, parseFriendsIndex, writeFriendsIndex, type WriteOptions } from '@shared/friendGists'
import { fakeGistWorld, type FakeGistWorld } from '@shared/friendGistsFake'
import { PUBLISH_EVERY_MS, reserveFor } from '@shared/friendSend'
import type { FriendDay } from '@shared/friendStats'
import type { IndexRecord } from '@shared/types'
import { loadAccount, saveAccount } from '../auth/account'
import { githubClient } from '../github/client'
import { memoryBackend, openVaultStore, saveVaultList, tokenStoreOn, type PhoneVault, type TokenStore, type VaultStore } from '../store'
import { vaultId } from '../store/vaults'
import type { SyncEvent, SyncState } from '../sync/engine'
import { INDEX_STATE } from '../sync/phoneIndex'
import { fakeClock, type FakeClock } from '../sync/testing'
import { gistsApi } from './gistsApi'
import { createFriendsSender, type FriendsSender } from './sender'
import { gistsFetch } from './testing'

/**
 * YAZ-5082 (4E1): the phone's send of the numbers. A fake gist API (`gistsFetch` on `fakeGistWorld`), a fake clock and
 * a fake sync engine. No real GitHub call. Each test names the rule it checks.
 */
const TZ = process.env.TZ
beforeAll(() => {
  process.env.TZ = 'America/New_York'
})
afterAll(() => {
  process.env.TZ = TZ
})

const START = Date.parse('2026-11-14T15:00:00Z') // 10:00 in New York
const PHONE_TOKEN = 'github_pat_11SENDERTEST_phone000000000000000000000000000000000000000000000000000000000'
const MAC_TOKEN = 'github_pat_11SENDERTEST_mac00000000000000000000000000000000000000000000000000000000000'
const IPAD_TOKEN = 'github_pat_11SENDERTEST_ipad0000000000000000000000000000000000000000000000000000000000'
const NOGISTS_TOKEN = 'github_pat_11SENDERTEST_nogists000000000000000000000000000000000000000000000000000000'
const REPO = 'yaseen/vault'
const opts: WriteOptions = { describe: (kind) => `notecards-test ${kind}`, sleep: async () => {} }

/** A made-up card answered `n` times today, one minute apart: n cards in today's numbers. */
const answered = (n: number, at = START): CardRecord[] =>
  Array.from({ length: n }, (_, i) => ({ id: `C-${i + 1}`, off: false, next: false, reviews: [{ at: new Date(at - (i + 1) * 60_000).toISOString(), rating: 'good' as const, seconds: 5 }] }))

interface FakeSync {
  subscribe(listener: (event: SyncEvent) => void): () => void
  pass(): void
  listeners: Set<(event: SyncEvent) => void>
}
function fakeSync(clock: FakeClock): FakeSync {
  const listeners = new Set<(event: SyncEvent) => void>()
  let commit = 0
  return {
    listeners,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    /** One sync pass: the index changed (if it did), then the state says synced. */
    pass() {
      const state: SyncState = { status: 'synced', vault: `${REPO}@main`, problem: null, retryAt: null, progress: null, lastSyncedAt: clock.now(), ready: true }
      for (const l of listeners) l({ type: 'changed', vault: `${REPO}@main`, commit: `c${++commit}`, diff: { added: [], changed: [], removed: [], renamed: [] } as never, settings: [], index: { commit: `c${commit}`, records: {} } })
      for (const l of listeners) l({ type: 'state', state })
    },
  }
}

interface Phone {
  store: VaultStore
  tokens: TokenStore
  sender: FriendsSender
  sync: FakeSync
  /** Sets the stored index to `cards` (as a sync pass would), then runs a pass. */
  review(cards: CardRecord[], repo?: string): Promise<void>
}

async function phone(world: FakeGistWorld, clock: FakeClock, token: string, options: { repos?: string[]; login?: string } = {}): Promise<Phone> {
  const backend = memoryBackend()
  const store = await openVaultStore(backend, { now: clock.now })
  const tokens = tokenStoreOn(backend)
  const repos = options.repos ?? [REPO]
  const vaults: PhoneVault[] = repos.map((repo, i) => ({ repo, branch: 'main', addedAt: START + i }))
  await saveVaultList(store, { vaults, open: vaultId(vaults[0]) })
  for (const v of vaults) {
    await tokens.write(vaultId(v), token)
    await saveAccount(store, vaultId(v), { login: options.login ?? 'yaseen', name: 'Yaseen Arshad', avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4', gists: 'yes', expiresAt: null, checkedAt: START })
  }
  const http = gistsFetch(world)
  const sync = fakeSync(clock)
  const sender = createFriendsSender({ store, tokens, sync, clock, fetch: http.fetch, sleep: async () => {} })
  const review = async (cards: CardRecord[], repo = REPO) => {
    const record = { path: 'cards.md', cards } as unknown as IndexRecord
    await store.setState(vaultId({ repo, branch: 'main' }), INDEX_STATE, { commit: 'c', records: { 'cards.md': record } })
    sync.pass()
    await sender.idle()
  }
  return { store, tokens, sender, sync, review }
}

/** The person's friends files on the fake GitHub: the index, the numbers gist, and `friends` pointers. */
async function friendsOf(world: FakeGistWorld, token: string, friends: number, groups = 0, vaults = [REPO]) {
  const api = gistsApi(githubClient(token, { fetch: gistsFetch(world).fetch, now: world.now }))
  const made = await ensureFriendsFiles(api, { vaults, nickname: null }, opts)
  if (made.kind !== 'ok') throw new Error('no index')
  const stats = made.handle.index.stats!
  const pointers: string[] = []
  for (let i = 0; i < friends + groups; i++) pointers.push(await makePointer(api, stats, opts))
  const handle = await writeFriendsIndex(api, made.handle, {
    ...made.handle.index,
    friends: pointers.slice(0, friends).map((mine, i) => ({ name: `Friend ${i}`, theirs: `abc${i}`, mine })),
    groups: pointers.slice(friends).map((mine, i) => ({ name: `Group ${i}`, group: `def${i}`, mine, admin: false })),
  })
  return { api, stats, pointers, index: handle.id }
}

const setup = (more: Record<string, { login: string; gists?: boolean }> = {}) => {
  const clock = fakeClock(START)
  const world = fakeGistWorld({
    accounts: { [PHONE_TOKEN]: { login: 'yaseen' }, [MAC_TOKEN]: { login: 'yaseen' }, [IPAD_TOKEN]: { login: 'yaseen' }, [NOGISTS_TOKEN]: { login: 'yaseen', gists: false }, ...more },
    now: clock.now,
  })
  return { clock, world }
}
const numbers = (world: FakeGistWorld, id: string) => JSON.parse(world.text(id, NUMBERS_FILE) ?? 'null') as { login: string; name: string; days: FriendDay[] } | null
const patches = (world: FakeGistWorld) => world.calls.filter((c) => c.op === 'update')

const consoleCalls: unknown[][] = []
afterEach(() => {
  vi.restoreAllMocks()
  consoleCalls.length = 0
})

describe('createFriendsSender (YAZ-5082)', () => {
  it('no send before a sync pass; after it, ONE update of the numbers gist for 6 friends and 2 groups', async () => {
    const { clock, world } = setup()
    const { stats, pointers } = await friendsOf(world, PHONE_TOKEN, 6, 2)
    const p = await phone(world, clock, PHONE_TOKEN)
    const before = patches(world).length
    await p.store.setState(`${REPO}@main`, INDEX_STATE, { commit: 'c', records: { 'cards.md': { cards: answered(3) } } })
    await p.sender.attempt('background')
    expect(p.sender.state().status).toBe('no-pass')
    expect(patches(world).length).toBe(before)

    await p.review(answered(3))
    expect(patches(world).length - before).toBe(1)
    expect(patches(world).at(-1)!.id).toBe(stats)
    expect(numbers(world, stats)!.days[0]).toMatchObject({ day: '2026-11-14', cards: 3 })
    expect(numbers(world, stats)).toMatchObject({ login: 'yaseen', name: 'Yaseen Arshad' })
    for (const pointer of pointers) expect(JSON.parse(world.text(pointer, POINTER_FILE)!)).toEqual({ v: 1, stats })
    expect(p.sender.state()).toMatchObject({ status: 'sent', lastSentAt: START })
  })

  it('never sends with zero friends: no gist is made and none is written (decision 22)', async () => {
    const { clock, world } = setup()
    const p = await phone(world, clock, PHONE_TOKEN)
    await p.review(answered(3))
    await p.sender.attempt('background')
    expect(world.owned('yaseen')).toHaveLength(0)
    expect(p.sender.state().status).toBe('no-friends')

    // An index with no friend and no group: still nothing to send.
    await friendsOf(world, PHONE_TOKEN, 0)
    const n = patches(world).length
    clock.advance(PUBLISH_EVERY_MS)
    await p.review(answered(4))
    await p.sender.attempt('background')
    expect(patches(world).length).toBe(n)
    expect(p.sender.state().status).toBe('no-friends')
  })

  it('at most one send each 5 minutes while reviewing; the waiting change goes at the 5 minutes', async () => {
    const { clock, world } = setup()
    const { stats } = await friendsOf(world, PHONE_TOKEN, 1)
    const p = await phone(world, clock, PHONE_TOKEN)
    const n = patches(world).length
    await p.review(answered(1))
    const calls = world.calls.length
    clock.advance(60_000)
    await p.review(answered(2, clock.now()))
    clock.advance(60_000)
    await p.review(answered(3, clock.now()))
    expect(patches(world).length - n).toBe(1)
    // While it waits, it asks GitHub nothing and does not count (the count costs about 200 ms on a large vault).
    expect(world.calls.length).toBe(calls)
    expect(p.sender.state()).toMatchObject({ status: 'waiting', retryAt: START + PUBLISH_EVERY_MS })
    clock.advance(PUBLISH_EVERY_MS - 2 * 60_000)
    await p.sender.idle()
    expect(patches(world).length - n).toBe(2)
    expect(numbers(world, stats)!.days[0].cards).toBe(3)
  })

  it('YAZ-5192: leaving the app sends at once only when 5 minutes have passed; within them the change waits for the timer', async () => {
    const { clock, world } = setup()
    const { stats } = await friendsOf(world, PHONE_TOKEN, 1)
    const p = await phone(world, clock, PHONE_TOKEN)
    await p.review(answered(1))
    clock.advance(90_000)
    await p.review(answered(5, clock.now()))
    await p.sender.background()
    expect(numbers(world, stats)!.days[0].cards).toBe(1)
    expect(p.sender.state()).toMatchObject({ status: 'waiting', retryAt: START + PUBLISH_EVERY_MS })
    clock.advance(PUBLISH_EVERY_MS - 90_000)
    await p.sender.idle()
    expect(numbers(world, stats)!.days[0].cards).toBe(5)
    // A leave after 5 quiet minutes with a new change: sent at once, with no pass.
    clock.advance(PUBLISH_EVERY_MS)
    await p.store.setState(`${REPO}@main`, INDEX_STATE, { commit: 'c', records: { 'cards.md': { path: 'cards.md', cards: answered(8, clock.now()) } } })
    await p.sender.background()
    expect(numbers(world, stats)!.days[0].cards).toBe(8)
  })

  it('YAZ-5192: the last send time survives a restart: a new app within 5 minutes does not send again', async () => {
    const { clock, world } = setup()
    const { stats } = await friendsOf(world, PHONE_TOKEN, 1)
    const p = await phone(world, clock, PHONE_TOKEN)
    await p.review(answered(2))
    p.sender.stop()
    clock.advance(60_000)
    const n = patches(world).length
    const again = createFriendsSender({ store: p.store, tokens: p.tokens, sync: p.sync, clock, fetch: gistsFetch(world).fetch, sleep: async () => {} })
    p.sync.pass()
    await again.idle()
    await again.background()
    expect(patches(world).length).toBe(n)
    expect(again.state()).toMatchObject({ status: 'waiting', retryAt: START + PUBLISH_EVERY_MS })
    expect(numbers(world, stats)!.days[0].cards).toBe(2)
    again.stop()
  })

  it('background sends also slow down: leaving the app each 61 s for 1 hour does not use most of the 100', async () => {
    const { clock, world } = setup()
    await friendsOf(world, PHONE_TOKEN, 3)
    const p = await phone(world, clock, PHONE_TOKEN)
    const n = patches(world).length
    for (let i = 1; i <= 60; i++) {
      await p.review(answered(i, clock.now()))
      await p.sender.background()
      clock.advance(61_000)
    }
    expect(patches(world).length - n).toBeLessThanOrEqual(24) // now: 60
  })

  it('unchanged numbers are not sent again (each send costs 1 of 100 an hour)', async () => {
    const { clock, world } = setup()
    await friendsOf(world, PHONE_TOKEN, 1)
    const p = await phone(world, clock, PHONE_TOKEN)
    await p.review(answered(2))
    const n = patches(world).length
    for (let i = 0; i < 4; i++) {
      clock.advance(PUBLISH_EVERY_MS)
      await p.review(answered(2))
      await p.sender.background()
    }
    expect(patches(world).length).toBe(n)
  })

  it('a burst of reviews for 2 hours: at most one update each 5 minutes, and never into the reserve', async () => {
    const { clock, world } = setup()
    const { stats } = await friendsOf(world, PHONE_TOKEN, 3)
    const p = await phone(world, clock, PHONE_TOKEN)
    const n = patches(world).length
    for (let t = 0; t < 2 * 3600_000; t += 20_000) {
      await p.review(answered(1 + Math.floor(t / 20_000) % 200, clock.now()))
      clock.advance(20_000)
      await p.sender.idle()
    }
    const mine = patches(world).slice(n).filter((c) => c.token === PHONE_TOKEN)
    expect(mine.length).toBeLessThanOrEqual(2 * 12 + 1)
    expect(mine.length).toBeGreaterThanOrEqual(2 * 12 - 1)
    const times = mine.map((c) => c.at)
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(PUBLISH_EVERY_MS)
    expect(mine.every((c) => c.id === stats)).toBe(true)
  })

  it('slows down when the Mac and cheers used most of the 100: it keeps the reserve for a remove', async () => {
    const { clock, world } = setup()
    const { stats } = await friendsOf(world, PHONE_TOKEN, 8)
    const mac = gistsApi(githubClient(MAC_TOKEN, { fetch: gistsFetch(world).fetch, now: world.now }))
    const used = world.updates('yaseen')
    for (let i = used; i < 80; i++) await mac.update(stats, { [NUMBERS_FILE]: world.text(stats, NUMBERS_FILE)! })
    const p = await phone(world, clock, PHONE_TOKEN)
    const n = patches(world).length
    for (let t = 0; t < 3600_000 - 60_000; t += 20_000) {
      await p.review(answered(1 + t / 20_000, clock.now()))
      clock.advance(20_000)
      await p.sender.idle()
    }
    // 20 were left; the reserve for 8 friends is 13. The phone used at most the 7 spare, spread over the hour.
    expect(world.updates('yaseen')).toBeLessThanOrEqual(100 - reserveFor(8))
    const mine = patches(world).slice(n).filter((c) => c.token === PHONE_TOKEN)
    expect(mine.every((c) => c.id === stats)).toBe(true)
    expect(mine.length).toBeGreaterThanOrEqual(3)
    for (let i = 1; i < mine.length; i++) expect(mine[i].at - mine[i - 1].at).toBeGreaterThan(PUBLISH_EVERY_MS)
  })

  it('a refused gist write (no Gists permission) calls recordGistsRefused; then no more sends', async () => {
    const { clock, world } = setup()
    await friendsOf(world, PHONE_TOKEN, 1)
    const p = await phone(world, clock, NOGISTS_TOKEN)
    await p.review(answered(2))
    expect(p.sender.state().status).toBe('no-gists')
    expect((await loadAccount(p.store, `${REPO}@main`))!.gists).toBe('no')
    const n = world.calls.length
    clock.advance(PUBLISH_EVERY_MS)
    await p.review(answered(3))
    expect(world.calls.length).toBe(n)
  })

  it('offline: quiet, and it sends at the next chance', async () => {
    const { clock, world } = setup()
    const { stats } = await friendsOf(world, PHONE_TOKEN, 1)
    const p = await phone(world, clock, PHONE_TOKEN)
    world.offline = true
    await p.review(answered(2))
    expect(p.sender.state().status).toBe('offline')
    world.offline = false
    clock.advance(60_000)
    await p.review(answered(2))
    expect(numbers(world, stats)!.days[0].cards).toBe(2)
    expect(p.sender.state().status).toBe('sent')
  })

  it('rate-limited: quiet, waits until the reset, then sends', async () => {
    const { clock, world } = setup()
    const { stats } = await friendsOf(world, PHONE_TOKEN, 1)
    const p = await phone(world, clock, PHONE_TOKEN)
    world.failNext = (call) => (call.op === 'update' ? 'RATE_LIMITED' : undefined)
    await p.review(answered(2))
    const state = p.sender.state()
    expect(state.status).toBe('slowed')
    expect(state.retryAt).toBeGreaterThan(clock.now())
    clock.advance(state.retryAt! - clock.now())
    await p.sender.idle()
    expect(numbers(world, stats)!.days[0].cards).toBe(2)
  })

  it('the phone does not hold all the vaults that count: no send (round 12, item 3)', async () => {
    const { clock, world } = setup()
    await friendsOf(world, PHONE_TOKEN, 1, 0, [REPO, 'yaseen/second'])
    const p = await phone(world, clock, PHONE_TOKEN)
    const n = patches(world).length
    await p.review(answered(2))
    expect(p.sender.state().status).toBe('missing-vaults')
    expect(patches(world).length).toBe(n)
  })

  it('counts every vault that counts, and only those', async () => {
    const { clock, world } = setup()
    const { stats } = await friendsOf(world, PHONE_TOKEN, 1, 0, [REPO, 'yaseen/second'])
    const p = await phone(world, clock, PHONE_TOKEN, { repos: [REPO, 'yaseen/second', 'yaseen/private'] })
    await p.store.setState('yaseen/second@main', INDEX_STATE, { commit: 'c', records: { 'x.md': { cards: answered(4).map((c) => ({ ...c, id: `S${c.id}` })) } } })
    await p.store.setState('yaseen/private@main', INDEX_STATE, { commit: 'c', records: { 'x.md': { cards: answered(50).map((c) => ({ ...c, id: `P${c.id}` })) } } })
    await p.review(answered(2))
    expect(numbers(world, stats)!.days[0].cards).toBe(6)
  })

  it('the numbers gist was deleted on GitHub: a new one, each pointer and the index updated, then the send', async () => {
    const { clock, world } = setup()
    const { api, stats, pointers, index } = await friendsOf(world, PHONE_TOKEN, 3, 1)
    await api.remove(stats)
    const p = await phone(world, clock, PHONE_TOKEN)
    await p.review(answered(2))
    const read = parseFriendsIndex(world.text(index, INDEX_FILE)!)
    if (read.kind !== 'ok') throw new Error('index')
    const fresh = read.value.stats!
    expect(fresh).not.toBe(stats)
    expect(numbers(world, fresh)!.days[0].cards).toBe(2)
    for (const pointer of pointers) expect(JSON.parse(world.text(pointer, POINTER_FILE)!).stats).toBe(fresh)
    expect(p.sender.state()).toMatchObject({ status: 'sent', remade: true })
  })

  it('two devices of one person: the gist keeps the larger count of each day', async () => {
    const { clock, world } = setup()
    const { stats } = await friendsOf(world, PHONE_TOKEN, 1)
    const a = await phone(world, clock, PHONE_TOKEN)
    const b = await phone(world, clock, IPAD_TOKEN)
    await a.review(answered(5))
    await b.review(answered(3)) // the iPad has not synced the phone's answers yet
    expect(numbers(world, stats)!.days[0].cards).toBe(5)
    clock.advance(PUBLISH_EVERY_MS)
    await b.review(answered(7, clock.now()))
    expect(numbers(world, stats)!.days[0].cards).toBe(7)
  })

  it('two devices that start at the same time share one numbers gist (the senders find it by the index)', async () => {
    const { clock, world } = setup()
    await friendsOf(world, PHONE_TOKEN, 2)
    const a = await phone(world, clock, PHONE_TOKEN)
    const b = await phone(world, clock, IPAD_TOKEN)
    world.shuffle(5)
    await Promise.all([a.review(answered(2)), b.review(answered(2))])
    expect(world.owned('yaseen').filter((g) => NUMBERS_FILE in g.files)).toHaveLength(1)
    expect(world.owned('yaseen').filter((g) => INDEX_FILE in g.files)).toHaveLength(1)
  })

  it('a numbers file from a newer app: no write, "needs a newer app"', async () => {
    const { clock, world } = setup()
    const { api, stats } = await friendsOf(world, PHONE_TOKEN, 1)
    await api.update(stats, { [NUMBERS_FILE]: JSON.stringify({ v: 2, more: true }) })
    const p = await phone(world, clock, PHONE_TOKEN)
    const n = patches(world).length
    await p.review(answered(2))
    expect(p.sender.state().status).toBe('needs-newer-app')
    expect(patches(world).length).toBe(n)
  })

  it('a wrong or cancelled token: quiet, "sign-in-again" (the sync dot shows it); the token is kept', async () => {
    const { clock, world } = setup()
    await friendsOf(world, PHONE_TOKEN, 1)
    const p = await phone(world, clock, PHONE_TOKEN)
    world.revoke(PHONE_TOKEN)
    await p.review(answered(2))
    expect(p.sender.state().status).toBe('sign-in-again')
  })

  it('the day turns while the app is open: a new day entry starts', async () => {
    const { clock, world } = setup()
    const { stats } = await friendsOf(world, PHONE_TOKEN, 1)
    const p = await phone(world, clock, PHONE_TOKEN)
    await p.review(answered(2))
    clock.advance(Date.parse('2026-11-15T05:30:00Z') - clock.now()) // 00:30 on the 15th in New York
    await p.review(answered(2, Date.parse('2026-11-14T15:00:00Z')))
    expect(numbers(world, stats)!.days.slice(0, 2).map((d) => [d.day, d.cards])).toEqual([
      ['2026-11-15', 0],
      ['2026-11-14', 2],
    ])
  })

  it('stops: no timer is left, and later events do nothing', async () => {
    const { clock, world } = setup()
    await friendsOf(world, PHONE_TOKEN, 1)
    const p = await phone(world, clock, PHONE_TOKEN)
    await p.review(answered(1))
    clock.advance(60_000)
    await p.review(answered(2, clock.now()))
    expect(clock.pending()).toBeGreaterThan(0)
    p.sender.stop()
    expect(clock.pending()).toBe(0)
    expect(p.sync.listeners.size).toBe(0)
  })

  it('the token is never in an address, a log, the stored state or the gists', async () => {
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void consoleCalls.push(args))
    const { clock, world } = setup()
    await friendsOf(world, PHONE_TOKEN, 2)
    const http = gistsFetch(world)
    const p = await phone(world, clock, PHONE_TOKEN)
    await p.review(answered(2))
    world.offline = true
    clock.advance(PUBLISH_EVERY_MS)
    await p.review(answered(3))
    world.offline = false
    for (const call of world.calls) expect(call.url ?? '').not.toContain(PHONE_TOKEN)
    for (const g of world.owned('yaseen')) expect(JSON.stringify(g)).not.toContain(PHONE_TOKEN)
    expect(JSON.stringify(await p.store.getState('', 'friendsSend'))).not.toContain(PHONE_TOKEN)
    expect(JSON.stringify(consoleCalls)).not.toContain(PHONE_TOKEN)
    void http
  })
})
