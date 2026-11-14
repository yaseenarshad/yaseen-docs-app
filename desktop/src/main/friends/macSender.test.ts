/**
 * YAZ-5086 (4E5): the Mac sends the numbers too (decision 16). The Mac's sender runs the SHARED rules
 * (`shared/friendSend.ts`, `shared/friendGists.ts`, `shared/friendStats.ts`) on the Mac's HTTP adapter, against the fake
 * gist world. No real GitHub, no real secrets file, no real vault: the vaults are made-up index records.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CardRecord } from '@shared/cardLine'
import { INDEX_FILE, NUMBERS_FILE, ensureFriendsFiles, findFriendsIndex, makePointer, writeFriendsIndex, type GistsApi, type WriteOptions } from '@shared/friendGists'
import { fakeGistWorld, type FakeGistWorld } from '@shared/friendGistsFake'
import { PUBLISH_EVERY_MS, reserveFor } from '@shared/friendSend'
import type { FriendStats, FriendVault } from '@shared/friendStats'
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
    expect((await rig.sender.attempt('pass')).status).toBe('no-friends')
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
    const phoneNumbers = { v: 1, login: 'yaseen', name: 'Yaseen A', avatar: 'x', days: [{ day: '2026-11-14', cards: 9, seconds: 45, remembered: 9, forgot: 0, newCards: 0, done: true }], totals: {}, at: new Date(START).toISOString() }
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
    expect((await rig.sender.attempt('pass')).status).toBe('no-friends')
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
  it('the phone made 80 updates; the Mac learns the rest from GitHub on its first update and slows down; the account never passes 100 less the reserve', async () => {
    const handle = await withFriends(rig, 1)
    const reserve = reserveFor(1)
    for (let i = 0; i < 80; i++) await rig.phone.update(handle.index.stats!, { [NUMBERS_FILE]: JSON.stringify({ v: 1, login: 'yaseen', name: 'p', avatar: '', days: [], totals: {}, at: String(i) }) })
    const before = rig.world.updates('yaseen')
    // A new number each minute for one hour, a try each minute.
    for (let minute = 0; minute < 60; minute++) {
      rig.cards.value = answered(minute + 1)
      await rig.sender.attempt('pass')
      rig.world.advance(60_000)
    }
    const mac = rig.world.updates('yaseen') - before
    expect(mac).toBeGreaterThan(1)
    expect(rig.world.updates('yaseen')).toBeLessThanOrEqual(100 - reserve)
    // After the first update the Mac knew GitHub's count: the gaps grew beyond 5 minutes.
    const times = rig.wire.requests.filter((q) => q.method === 'PATCH').length
    expect(times).toBe(mac)
    expect(mac).toBeLessThan(12)
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
  }
}
void findFriendsIndex
