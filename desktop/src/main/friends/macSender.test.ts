/**
 * YAZ-5086 (4E5): the Mac sends the numbers too (decision 16). The Mac's sender runs the SHARED rules
 * (`shared/friendSend.ts`, `shared/friendGists.ts`, `shared/friendStats.ts`) on the Mac's HTTP adapter, against the fake
 * gist world. No real GitHub, no real secrets file, no real vault: the vaults are made-up index records.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CardRecord } from '@shared/cardLine'
import { INDEX_FILE, NUMBERS_FILE, emptyNumbers, ensureFriendsFiles, findFriendsIndex, makePointer, writeFriendsIndex, type GistsApi, type WriteOptions } from '@shared/friendGists'
import { fakeGistWorld, type FakeGistWorld } from '@shared/friendGistsFake'
import { PUBLISH_EVERY_MS, reserveFor } from '@shared/friendSend'
import { friendStats, type FriendStats, type FriendVault } from '@shared/friendStats'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'
import { macGistsApi, readProfile } from './gistsHttp'
import { createMacSender, type MacSendSaved, type MacSender } from './macSender'
import { worldFetch } from './testing'

const TZ = process.env.TZ
beforeAll(() => void (process.env.TZ = 'America/New_York'))
afterAll(() => void (process.env.TZ = TZ))

const START = Date.parse('2026-11-14T15:00:00Z')
const PHONE = 'github_pat_11MACSEND_phone00000000000000000000000000000000000000000000000000000000000'
const MAC = 'github_pat_11MACSEND_mac000000000000000000000000000000000000000000000000000000000000'
const NOGISTS = 'github_pat_11MACSEND_nogists0000000000000000000000000000000000000000000000000000000'
const OTHER = 'github_pat_11MACSEND_other00000000000000000000000000000000000000000000000000000000000'
/** The count on the test's own thread: the app gives the worker (`countJob.ts`); `stats` is required (YAZ-5277). */
const closedData = new Map<string, FriendVault>()
const countHere = async (text: string, now: number, closed: readonly { root: string }[] = []) =>
  friendStats([...(JSON.parse(text) as FriendVault[]), ...closed.map((c) => closedData.get(c.root)!)], now)
const opts: WriteOptions = { describe: (kind) => `notecards-test ${kind}`, sleep: async () => {} }

/** Made-up cards, answered `n` times today: private words in every field the index has, so a leak shows. */
const answered = (n: number, at = START): CardRecord[] =>
  Array.from({ length: n }, (_, i) => ({ id: `SECRETCARD-${i + 1}`, title: `Secret card text ${i + 1}`, off: false, next: false, reviews: [{ at: new Date(at - (i + 1) * 60_000).toISOString(), rating: 'good' as const, seconds: 5 }] }))
const vaultWith = (cards: CardRecord[]): FriendVault =>
  ({ pages: [{ path: '/Users/yaseen/Vaults/Private Notes/Secret Page Title.md', title: 'Secret Page Title', cards }], settings: DEFAULT_REVIEW_SETTINGS }) as unknown as FriendVault

interface Rig {
  world: FakeGistWorld
  wire: ReturnType<typeof worldFetch>
  phone: GistsApi
  saved: { value: MacSendSaved | null }
  token: { value: string | null }
  held: Map<string, string>
  cards: { value: CardRecord[] }
  sender: MacSender
  make(): MacSender
}

let rig: Rig
const consoleCalls: unknown[][] = []

function makeRig(accounts: Record<string, { login: string; gists?: boolean }> = { [PHONE]: { login: 'yaseen' }, [MAC]: { login: 'yaseen' }, [OTHER]: { login: 'someone' } }): Rig {
  const world = fakeGistWorld({ accounts, start: START })
  const users = Object.fromEntries(Object.entries(accounts).map(([t, a]) => [t, { login: a.login, name: 'Yaseen A', avatar_url: 'https://avatars.githubusercontent.com/u/7' }]))
  const wire = worldFetch(world, users)
  const r: Rig = {
    world,
    wire,
    phone: world.api(PHONE),
    saved: { value: null },
    token: { value: MAC },
    held: new Map([['yaseen/vault', '/Users/yaseen/Vaults/Private Notes']]),
    cards: { value: answered(3) },
    sender: undefined as unknown as MacSender,
    make: () =>
      createMacSender({
        readToken: async () => r.token.value,
        api: (token) => macGistsApi(token, wire.fetch, () => world.now()),
        profile: (token) => readProfile(token, wire.fetch),
        vaults: async () => new Map(r.held),
        count: async () => vaultWith(r.cards.value),
        state: { load: async () => r.saved.value, save: async (s) => void (r.saved.value = structuredClone(s)) },
        clock: { now: () => world.now(), setTimeout: () => 0, clearTimeout: () => undefined },
        sleep: async () => {},
        stats: countHere,
      }),
  }
  r.sender = r.make()
  return r
}

/** The phone made the friends files and added `friends` friends (4E2's calls), with the vaults that count. */
async function withFriends(r: Rig, friends = 1, vaults = ['yaseen/vault']) {
  const made = await ensureFriendsFiles(r.phone, { vaults, nickname: null }, opts)
  if (made.kind !== 'ok') throw new Error(made.kind)
  let handle = made.handle
  const list = [...handle.index.friends]
  for (let i = 0; i < friends; i++) list.push({ name: `Friend ${i}`, theirs: await makePointer(r.phone, handle.index.stats!, opts), mine: await makePointer(r.phone, handle.index.stats!, opts) })
  handle = await writeFriendsIndex(r.phone, handle, { ...handle.index, friends: list })
  return handle
}
const numbersOf = (r: Rig, statsId: string): FriendStats => JSON.parse(r.world.text(statsId, NUMBERS_FILE)!) as FriendStats
const macUpdates = (r: Rig) => r.wire.requests.filter((q) => q.method === 'PATCH').length
const macWrites = (r: Rig) => r.wire.requests.filter((q) => q.method !== 'GET').length

beforeEach(() => {
  consoleCalls.length = 0
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, level).mockImplementation((...args) => void consoleCalls.push(args))
  rig = makeRig()
})
afterEach(async () => {
  await rig.sender.stop()
  // Never a log line with the token or a gist ID, and no token or gist ID in the stored state.
  const logged = JSON.stringify(consoleCalls)
  const stored = JSON.stringify(rig.saved.value)
  for (const text of [logged, stored]) {
    expect(text).not.toContain('github_pat_')
    for (const g of rig.world.owned('yaseen')) expect(text).not.toContain(g.id)
  }
  vi.restoreAllMocks()
})

describe('the Mac sends the numbers too (YAZ-5086, decision 16)', () => {
  it('no token: nothing, and no call', async () => {
    rig.token.value = null
    expect((await rig.sender.attempt('pass')).status).toBe('no-token')
    expect(rig.wire.requests).toEqual([])
  })

  it('zero friends (no friends list): nothing is sent and no gist is made (decision 22)', async () => {
    expect((await rig.sender.attempt('pass')).status).toBe('no-list')
    expect(rig.world.owned('yaseen')).toEqual([])
    expect(macWrites(rig)).toBe(0)
  })

  it('a list with zero friends and zero groups: nothing is sent', async () => {
    await withFriends(rig, 0)
    expect((await rig.sender.attempt('pass')).status).toBe('no-friends')
    expect(macWrites(rig)).toBe(0)
  })

  it('one friend: ONE update of the numbers gist, with the shared numbers; the view says how many friends', async () => {
    const handle = await withFriends(rig, 2)
    const view = await rig.sender.attempt('pass')
    expect(view).toMatchObject({ status: 'sent', friends: 2, groups: 0, lastSentAt: START })
    expect(macUpdates(rig)).toBe(1)
    expect(macWrites(rig)).toBe(1)
    const numbers = numbersOf(rig, handle.index.stats!)
    expect(numbers).toMatchObject({ v: 1, login: 'yaseen', name: 'Yaseen A', avatar: 'https://avatars.githubusercontent.com/u/7' })
    expect(numbers.days[0]).toMatchObject({ day: '2026-11-14', cards: 3 })
  })

  it('privacy, byte by byte: the request bodies hold only numbers, login, name and avatar', async () => {
    await withFriends(rig, 1)
    await rig.sender.attempt('pass')
    const bodies = rig.wire.requests.map((q) => q.body ?? '').join('\n')
    for (const secret of ['Secret', 'SECRETCARD', 'card text', 'Page Title', 'Private Notes', '/Users/', 'yaseen/vault', 'vault', '.md', MAC]) expect(bodies).not.toContain(secret)
    const patch = rig.wire.requests.find((q) => q.method === 'PATCH')!
    const sent = JSON.parse(JSON.parse(patch.body!).files[NUMBERS_FILE].content) as Record<string, unknown>
    expect(Object.keys(sent).sort()).toEqual(['at', 'avatar', 'days', 'login', 'name', 'totals', 'v'])
    expect(Object.keys(JSON.parse(patch.body!))).toEqual(['files'])
    expect(Object.keys(JSON.parse(patch.body!).files)).toEqual([NUMBERS_FILE])
    // The addresses hold no repo, no vault and no token either.
    for (const q of rig.wire.requests) for (const secret of ['vault', 'Secret', MAC]) expect(q.url).not.toContain(secret)
  })

  it('the Mac does not hold every vault that counts: no send', async () => {
    await withFriends(rig, 1, ['yaseen/vault', 'yaseen/other'])
    expect(await rig.sender.attempt('pass')).toMatchObject({ status: 'missing-vaults', missing: 1 })
    expect(macWrites(rig)).toBe(0)
  })

  it('the vaults that count come from the friends list: a vault the Mac holds that does not count adds nothing', async () => {
    const handle = await withFriends(rig, 1, ['yaseen/vault'])
    rig.held.set('yaseen/private', '/Users/yaseen/Vaults/Private')
    const count = vi.fn(async (root: string) => vaultWith(root.endsWith('Private') ? answered(50) : rig.cards.value))
    const sender = createMacSender({ ...depsOf(rig), count })
    await sender.attempt('pass')
    expect(count.mock.calls.map(([root]) => root)).toEqual(['/Users/yaseen/Vaults/Private Notes'])
    expect(numbersOf(rig, handle.index.stats!).days[0].cards).toBe(3)
    await sender.stop()
  })

  it('at most one send each 5 minutes, and the rule holds after a restart (the stored state)', async () => {
    await withFriends(rig, 1)
    await rig.sender.attempt('pass')
    rig.cards.value = answered(4)
    rig.world.advance(60_000)
    expect((await rig.sender.attempt('pass')).status).toBe('waiting')
    await rig.sender.stop()
    rig.sender = rig.make() // the app started again
    expect((await rig.sender.attempt('pass')).status).toBe('waiting')
    expect(macUpdates(rig)).toBe(1)
    rig.world.advance(PUBLISH_EVERY_MS)
    expect((await rig.sender.attempt('pass')).status).toBe('sent')
    expect(macUpdates(rig)).toBe(2)
  })

  it('the same numbers again: no write (unchanged)', async () => {
    await withFriends(rig, 1)
    await rig.sender.attempt('pass')
    rig.world.advance(PUBLISH_EVERY_MS)
    expect((await rig.sender.attempt('pass')).status).toBe('unchanged')
    expect(macUpdates(rig)).toBe(1)
  })

  it('never lower: the phone sent more cards today; the Mac keeps the larger count', async () => {
    const handle = await withFriends(rig, 1)
    const phoneNumbers = { ...emptyNumbers(START), login: 'yaseen', name: 'Yaseen A', days: [{ day: '2026-11-14', cards: 9, seconds: 45, remembered: 9, forgot: 0, newCards: 0, done: true }] }
    await rig.phone.update(handle.index.stats!, { [NUMBERS_FILE]: JSON.stringify(phoneNumbers) })
    await rig.sender.attempt('pass')
    expect(numbersOf(rig, handle.index.stats!).days[0]).toMatchObject({ cards: 9, done: true })
  })

  it('a token with no Gists permission: "no-gists", stored; no call until the token changes', async () => {
    rig = makeRig({ [PHONE]: { login: 'yaseen' }, [MAC]: { login: 'yaseen', gists: false } })
    await withFriends(rig, 1)
    expect((await rig.sender.attempt('pass')).status).toBe('no-gists')
    const calls = rig.wire.requests.length
    rig.world.advance(PUBLISH_EVERY_MS * 2)
    rig.sender = rig.make()
    expect((await rig.sender.attempt('pass')).status).toBe('no-gists')
    expect(rig.wire.requests.length).toBe(calls)
    rig.sender.tokenChanged()
    expect((await rig.sender.attempt('pass')).status).toBe('no-gists') // the same account still has no Gists
    expect(rig.wire.requests.length).toBeGreaterThan(calls)
  })

  it('offline, rate limit, a cancelled token: quiet statuses, never a throw', async () => {
    await withFriends(rig, 1)
    rig.world.offline = true
    expect((await rig.sender.attempt('pass')).status).toBe('offline')
    rig.world.offline = false
    rig.world.failNext = ({ op }) => (op === 'update' ? 'RATE_LIMITED' : undefined)
    const slowed = await rig.sender.attempt('pass')
    expect(slowed.status).toBe('slowed')
    expect(slowed.retryAt).toBeGreaterThan(rig.world.now())
    expect((await rig.sender.attempt('pass')).status).toBe('slowed') // blocked until the reset: no call
    rig.world.revoke(MAC)
    rig.world.advance(60 * 60_000)
    expect((await rig.sender.attempt('pass')).status).toBe('sign-in-again')
  })

  it('a token of ANOTHER GitHub account finds no friends list: nothing is sent (round 13, item 4: one account)', async () => {
    await withFriends(rig, 1)
    rig.token.value = OTHER
    expect((await rig.sender.attempt('pass')).status).toBe('no-list')
    expect(macWrites(rig)).toBe(0)
  })
})

describe('the count runs at most once each 5 minutes (YAZ-5249)', () => {
  it('numbers that do not change: at most one count each 5 minutes', async () => {
    const count = vi.fn(async () => vaultWith(rig.cards.value))
    rig.sender = createMacSender({ ...depsOf(rig), count })
    await withFriends(rig, 1)
    await rig.sender.attempt('pass') // sent
    rig.world.advance(PUBLISH_EVERY_MS + 1)
    count.mockClear()
    for (let i = 0; i < 15; i++) {
      await rig.sender.attempt('pass')
      rig.world.advance(4_000)
    }
    expect(count.mock.calls.length).toBeLessThanOrEqual(1)
  })

  it('the same cards as at the last count, on the same day: no count at all, and no network', async () => {
    const stats = vi.fn(async (text: string, now: number) => friendStats(JSON.parse(text) as FriendVault[], now))
    rig.sender = createMacSender({ ...depsOf(rig), stats })
    await withFriends(rig, 1)
    await rig.sender.attempt('pass')
    expect(stats).toHaveBeenCalledTimes(1)
    rig.world.advance(PUBLISH_EVERY_MS + 1)
    const calls = rig.wire.requests.length
    expect((await rig.sender.attempt('pass')).status).toBe('unchanged')
    expect(stats).toHaveBeenCalledTimes(1)
    expect(rig.wire.requests.filter((q) => q.method !== 'GET').length).toBe(1)
    expect(rig.wire.requests.length - calls).toBeLessThanOrEqual(1) // at most the list's free 304
    rig.cards.value = answered(4)
    rig.world.advance(PUBLISH_EVERY_MS + 1)
    expect((await rig.sender.attempt('pass')).status).toBe('sent')
    expect(stats).toHaveBeenCalledTimes(2)
  })
})

describe('a token of another GitHub account (YAZ-5254)', () => {
  it('no friends list on that account: the view names the account', async () => {
    await withFriends(rig, 1)
    rig.token.value = OTHER
    expect(await rig.sender.attempt('pass')).toMatchObject({ status: 'no-list', login: 'someone' })
  })
})

describe('the count runs on the worker (YAZ-5277), and a count that never answers (YAZ-5278)', () => {
  it('the main-side sender has no count of its own: it imports no value of friendStats, and needs `stats`', () => {
    const source = readFileSync(join(__dirname, 'macSender.ts'), 'utf8')
    expect(source).not.toMatch(/^import \{[^}]*\bfriendStats\b[^}]*\} from '@shared\/friendStats'/m)
    expect(source).not.toMatch(/\bfriendStats\(/)
    expect(source).toMatch(/^\s+stats\(text: string, now: number, closed: readonly ClosedVault\[\]\)/m)
  })

  it("the app's sender counts on the worker thread: `stats` is the worker's count, with the built countWorker", () => {
    const source = readFileSync(join(__dirname, 'index.ts'), 'utf8')
    expect(source).toMatch(/^import countWorker from '\.\/countWorker\?modulePath'$/m)
    expect(source).toMatch(/const counter = makeCounter\(countWorker\)/)
    expect(source).toMatch(/stats: \(text, now, closed\) => counter\(text, now, closed\)/)
  })

  it('a count that never answers: that try ends as failed at the time limit, and the next try still runs', async () => {
    await withFriends(rig, 1)
    const timers: (() => void)[] = []
    const clock = { now: () => rig.world.now(), setTimeout: (fn: () => void) => (timers.push(fn), timers.length), clearTimeout: () => undefined }
    let hang = true
    const stats = vi.fn((text: string, now: number) => (hang ? new Promise<never>(() => undefined) : countHere(text, now)))
    rig.sender = createMacSender({ ...depsOf(rig), clock, stats })
    const first = rig.sender.attempt('pass')
    await vi.waitFor(() => expect(stats).toHaveBeenCalledTimes(1))
    for (const fire of timers.splice(0)) fire() // the time limit of the count
    expect((await first).status).toBe('failed')
    hang = false
    expect((await rig.sender.attempt('pass')).status).toBe('sent')
  })
})

describe('the stored state belongs to an account (YAZ-5279)', () => {
  it('a token of another account with its own friends list: the Mac sends to that list', async () => {
    const a = await withFriends(rig, 1)
    expect((await rig.sender.attempt('pass')).status).toBe('sent')
    // Account B ("someone") has its own list with one friend, and the same vault counts.
    const b = rig.world.api(OTHER)
    const made = await ensureFriendsFiles(b, { vaults: ['yaseen/vault'], nickname: null }, opts)
    if (made.kind !== 'ok') throw new Error(made.kind)
    const p = await makePointer(b, made.handle.index.stats!, opts)
    await writeFriendsIndex(b, made.handle, { ...made.handle.index, friends: [{ name: 'B friend', theirs: p, mine: p }] })
    rig.token.value = OTHER
    rig.sender.tokenChanged()
    rig.world.advance(PUBLISH_EVERY_MS + 1)
    expect((await rig.sender.attempt('pass')).status).toBe('sent')
    const numbers = JSON.parse(rig.world.text(made.handle.index.stats!, NUMBERS_FILE)!) as FriendStats
    expect(numbers.login).toBe('someone')
    expect(numbers.days[0].cards).toBe(3)
    expect(a.index.stats).not.toBe(made.handle.index.stats)
  })

  it('the stored state names its account, and a state of another account starts over (no wait, no hash, no budget)', async () => {
    await withFriends(rig, 1)
    await rig.sender.attempt('pass')
    expect(rig.saved.value?.account).toBe('yaseen')
    rig.saved.value = { ...rig.saved.value!, account: 'someone-else' }
    rig.sender = rig.make()
    rig.cards.value = answered(3)
    expect((await rig.sender.attempt('pass')).status).not.toBe('waiting')
  })
})

describe('a vault that counts and is closed on this Mac (YAZ-5252: "holds" means "on this Mac")', () => {
  beforeEach(() => closedData.clear())

  it('one open and one closed vault that count: the numbers are friendStats of both (as the phone counts them)', async () => {
    const handle = await withFriends(rig, 1, ['yaseen/vault', 'yaseen/cards'])
    closedData.set('/Users/yaseen/Vaults/Cards', vaultWith(answered(5, START - 30_000)))
    const closed = vi.fn(async () => new Map([['yaseen/cards', { root: '/Users/yaseen/Vaults/Cards', key: 'h1' }]]))
    rig.sender = createMacSender({ ...depsOf(rig), closed })
    expect((await rig.sender.attempt('pass')).status).toBe('sent')
    const expected = friendStats([vaultWith(rig.cards.value), closedData.get('/Users/yaseen/Vaults/Cards')!], START)
    expect(numbersOf(rig, handle.index.stats!).days).toEqual(expected.days)
    expect(numbersOf(rig, handle.index.stats!).totals).toEqual(expected.totals)
  })

  it('the closed vault changes on disk (a new HEAD): counted again after the next trigger; the same HEAD: no count', async () => {
    await withFriends(rig, 1, ['yaseen/vault', 'yaseen/cards'])
    closedData.set('/c', vaultWith(answered(2, START - 30_000)))
    let key = 'h1'
    const stats = vi.fn(countHere)
    rig.sender = createMacSender({ ...depsOf(rig), stats, closed: async () => new Map([['yaseen/cards', { root: '/c', key }]]) })
    await rig.sender.attempt('pass')
    rig.world.advance(PUBLISH_EVERY_MS + 1)
    expect((await rig.sender.attempt('pass')).status).toBe('unchanged')
    expect(stats).toHaveBeenCalledTimes(1)
    key = 'h2'
    closedData.set('/c', vaultWith(answered(6, START - 30_000)))
    rig.world.advance(PUBLISH_EVERY_MS + 1)
    expect((await rig.sender.attempt('pass')).status).toBe('sent')
    expect(stats).toHaveBeenCalledTimes(2)
    expect(stats.mock.calls[1][2]).toEqual([{ root: '/c', key: 'h2' }])
  })

  it('a vault that counts and is not on this Mac (never opened, folder gone, another remote): nothing is sent', async () => {
    await withFriends(rig, 1, ['yaseen/vault', 'yaseen/cards'])
    rig.sender = createMacSender({ ...depsOf(rig), closed: async () => new Map() })
    expect(await rig.sender.attempt('pass')).toMatchObject({ status: 'missing-vaults', missing: 1 })
    expect(macWrites(rig)).toBe(0)
  })
})

describe('the Mac changes nothing but its numbers (YAZ-5086: "The Mac only sends")', () => {
  it('a remove that waits in the list: the Mac sends nothing and writes nothing; the phone finishes it', async () => {
    const handle = await withFriends(rig, 1)
    await rig.phone.update(handle.id, { [INDEX_FILE]: JSON.stringify({ ...handle.raw, rekey: { old: handle.index.stats, drop: [], next: null, at: new Date(START).toISOString() } }) })
    expect((await rig.sender.attempt('pass')).status).toBe('phone-first')
    expect(macWrites(rig)).toBe(0)
  })

  it('the numbers gist was deleted on GitHub: the Mac makes nothing; the phone makes it again', async () => {
    const handle = await withFriends(rig, 1)
    await rig.phone.remove(handle.index.stats!)
    expect((await rig.sender.attempt('pass')).status).toBe('phone-first')
    expect(macWrites(rig)).toBe(0)
  })

  it('two lists (two devices made one at once): the Mac neither joins nor deletes them', async () => {
    await withFriends(rig, 1)
    rig.world.seed('yaseen', { [INDEX_FILE]: JSON.stringify({ v: 1, nickname: null, vaults: ['yaseen/vault'], stats: null, friends: [], groups: [] }) })
    const before = rig.world.owned('yaseen').length
    const view = await rig.sender.attempt('pass')
    expect(['phone-first', 'sent']).toContain(view.status)
    expect(rig.world.owned('yaseen').length).toBe(before)
    expect(rig.wire.requests.filter((q) => q.method === 'DELETE' || q.method === 'POST')).toEqual([])
  })

  it('a friends list this app cannot read: no write (YAZ-5191)', async () => {
    rig.world.seed('yaseen', { [INDEX_FILE]: '{ not json' })
    expect((await rig.sender.attempt('pass')).status).toBe('needs-repair')
    expect(macWrites(rig)).toBe(0)
  })
})

describe('the phone and the Mac in ONE hour: one account, 100 gist updates', () => {
  /** The phone made `phone` updates at the start of the hour; then the Mac gets a new number each minute for one hour. */
  async function hour(phone: number) {
    const handle = await withFriends(rig, 1)
    for (let i = 0; i < phone; i++) await rig.phone.update(handle.index.stats!, { [NUMBERS_FILE]: JSON.stringify({ ...emptyNumbers(START), at: String(i) }) })
    const before = rig.world.updates('yaseen')
    for (let minute = 0; minute < 60; minute++) {
      rig.cards.value = answered(minute + 1)
      await rig.sender.attempt('pass')
      rig.world.advance(60_000)
    }
    return { mac: rig.world.updates('yaseen') - before, total: rig.world.updates('yaseen') }
  }

  it('the phone made 80: the Mac learns the rest from GitHub on its first update and spreads its spare; the account stays under 100 less the reserve', async () => {
    const { mac, total } = await hour(80)
    expect(mac).toBeGreaterThan(1)
    expect(mac).toBeLessThanOrEqual(12) // never more than one each 5 minutes
    expect(total).toBeLessThanOrEqual(100 - reserveFor(1))
  })

  it('the phone made 90: the Mac slows to about one each 20 minutes', async () => {
    const { mac, total } = await hour(90)
    expect(mac).toBeLessThanOrEqual(4)
    expect(total).toBeLessThanOrEqual(100 - reserveFor(1))
  })
})

/** The rig's deps, for a sender with one dep changed. */
function depsOf(r: Rig) {
  return {
    readToken: async () => r.token.value,
    api: (token: string) => macGistsApi(token, r.wire.fetch, () => r.world.now()),
    profile: (token: string) => readProfile(token, r.wire.fetch),
    vaults: async () => new Map(r.held),
    count: async () => vaultWith(r.cards.value),
    state: { load: async () => r.saved.value, save: async (s: MacSendSaved) => void (r.saved.value = structuredClone(s)) },
    clock: { now: () => r.world.now(), setTimeout: () => 0, clearTimeout: () => undefined },
    sleep: async () => {},
    stats: countHere,
  }
}
void findFriendsIndex
