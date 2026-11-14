import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CardRecord } from '@shared/cardLine'
import { NUMBERS_FILE, ensureFriendsFiles, makePointer, type WriteOptions } from '@shared/friendGists'
import { fakeGistWorld } from '@shared/friendGistsFake'
import {
  BACKGROUND_GAP_MS,
  GIST_UPDATES_PER_HOUR,
  PUBLISH_EVERY_MS,
  budgetLeft,
  emptyBudget,
  mayUpdate,
  mergeNeverLower,
  noteUpdate,
  numbersFor,
  numbersKey,
  reserveFor,
  sendGap,
  sendGate,
  sendNumbers,
  type GistBudget,
} from '@shared/friendSend'
import { friendStats, type FriendDay, type FriendStats } from '@shared/friendStats'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'

/**
 * YAZ-5082 (4E1): the send of the numbers, as pure logic the phone and the Mac (4E5) share. A fake gist API and a fake
 * clock; no real GitHub call. The rules: decisions 14 (round 16), 16, 22, 23; round 12 item 2 ("never lower" covers the
 * days; the totals are the newest count); proof 1C (100 gist updates an hour for the account).
 */
const TZ = process.env.TZ
beforeAll(() => {
  process.env.TZ = 'America/New_York'
})
afterAll(() => {
  process.env.TZ = TZ
})

const NOW = Date.parse('2026-11-14T16:00:00Z') // 11:00 in New York
const HOUR = 3600_000
const day = (d: string, n: number, done = true): FriendDay => ({ day: d, cards: n, seconds: n * 10, remembered: n, forgot: 0, newCards: 0, done })
const totals = (cards: number): FriendStats['totals'] => ({ cards, inReview: cards, newLeft: 0, mature: 0, dueLeft: 0, addedThisWeek: 0, streak: 1, bestStreak: 1, bestDay: 1, bestWeek: 1 })
const file = (days: FriendDay[], cards = 10, more: Partial<FriendStats> = {}): FriendStats => ({
  v: 1,
  login: 'yaseen',
  name: 'Yaseen',
  avatar: 'https://avatars.githubusercontent.com/u/1',
  days,
  totals: totals(cards),
  at: new Date(NOW).toISOString(),
  ...more,
})
const opts: WriteOptions = { describe: (kind) => `notecards-test ${kind}`, sleep: async () => {} }

describe('never lower a day (round 12, item 2)', () => {
  it('each day number keeps the larger count; `done` stays true; the totals are the sender`s newest', () => {
    const remote = file([day('2026-11-14', 9, true), day('2026-11-13', 30)], 50)
    const fresh = file([{ ...day('2026-11-14', 4, false), seconds: 900 }, day('2026-11-13', 20)], 40)
    const { file: merged, changed } = mergeNeverLower(remote, fresh)
    expect(changed).toBe(true)
    expect(merged.days).toEqual([{ ...day('2026-11-14', 9, true), seconds: 900 }, day('2026-11-13', 30)])
    expect(merged.totals).toEqual(totals(40))
  })

  it('keeps the days only the gist holds (another device`s), adds new days, newest first, 90 at most', () => {
    const remote = file([day('2026-11-12', 7), ...Array.from({ length: 89 }, (_, i) => day(new Date(Date.UTC(2026, 10, 11 - i)).toISOString().slice(0, 10), 1))])
    const fresh = file([day('2026-11-14', 3), day('2026-11-13', 2)])
    const { file: merged } = mergeNeverLower(remote, fresh)
    const days = merged.days as FriendDay[]
    expect(days.slice(0, 3).map((d) => d.day)).toEqual(['2026-11-14', '2026-11-13', '2026-11-12'])
    expect(days).toHaveLength(90)
  })

  it('no change when the gist already holds the same or more: nothing to write', () => {
    const remote = file([day('2026-11-14', 9)])
    expect(mergeNeverLower(remote, file([day('2026-11-14', 9)], 10, { at: '2026-11-14T17:00:00.000Z' })).changed).toBe(false)
    expect(mergeNeverLower(remote, file([day('2026-11-14', 5)])).changed).toBe(false)
  })

  it('keeps the fields that this app does not know (an older app never drops a newer one`s data)', () => {
    const remote = { ...file([{ ...day('2026-11-14', 1), extra: 1 } as FriendDay]), later: 'x', totals: { ...totals(10), more: 3 } }
    const { file: merged } = mergeNeverLower(remote, file([day('2026-11-14', 2)]))
    expect(merged).toMatchObject({ v: 1, later: 'x', totals: { more: 3 }, days: [{ day: '2026-11-14', cards: 2, extra: 1 }] })
  })

  it('a broken file on GitHub is replaced by the fresh numbers', () => {
    expect(mergeNeverLower('{oops', file([day('2026-11-14', 2)])).file).toEqual(file([day('2026-11-14', 2)]))
    expect(mergeNeverLower(null, file([day('2026-11-14', 2)])).changed).toBe(true)
  })

  it('the key of a file ignores `at`', () => {
    expect(numbersKey(file([day('2026-11-14', 2)]))).toBe(numbersKey(file([day('2026-11-14', 2)], 10, { at: '2020-01-01T00:00:00.000Z' })))
    expect(numbersKey(file([day('2026-11-14', 2)]))).not.toBe(numbersKey(file([day('2026-11-14', 3)])))
  })

  it('the profile: the nickname replaces the name; a null name is the login', () => {
    const counted = friendStats([], NOW)
    expect(numbersFor(counted, { login: 'y', name: null, avatar: 'a', nickname: null }, NOW)).toMatchObject({ v: 1, login: 'y', name: 'y', avatar: 'a', at: new Date(NOW).toISOString() })
    expect(numbersFor(counted, { login: 'y', name: 'Yaseen', avatar: 'a', nickname: 'Yas' }, NOW).name).toBe('Yas')
  })
})

describe('a time-zone change (decision 9: day numbers per device; round 10 item 21: accepted)', () => {
  it('each device counts its own local days; after a move the old days keep their counts and new days use the new zone', () => {
    const cards: CardRecord[] = [
      { id: 'A-1', off: false, next: false, reviews: [{ at: '2026-11-14T03:30Z', rating: 'good' }] }, // 22:30 on the 13th in New York
      { id: 'A-2', off: false, next: false, reviews: [{ at: '2026-11-14T15:00Z', rating: 'good' }] },
    ]
    const vaults = [{ pages: [{ cards }], settings: DEFAULT_REVIEW_SETTINGS }]
    const profile = { login: 'y', name: 'Y', avatar: 'a', nickname: null }
    const ny = numbersFor(friendStats(vaults, NOW), profile, NOW)
    expect(ny.days.map((d) => [d.day, d.cards])).toEqual([
      ['2026-11-14', 1],
      ['2026-11-13', 1],
    ])
    process.env.TZ = 'Asia/Tokyo'
    try {
      const tokyo = numbersFor(friendStats(vaults, NOW), profile, NOW)
      expect(tokyo.days.map((d) => [d.day, d.cards])).toEqual([
        ['2026-11-15', 1],
        ['2026-11-14', 1],
      ])
      // The gist holds the New York days; never lower keeps them. The behaviour is recorded, not hidden: the
      // numbers can show one answer on two days after a move. Each device keeps its own local days (decision 9).
      const merged = mergeNeverLower(ny, tokyo).file.days as FriendDay[]
      expect(merged.map((d) => [d.day, d.cards])).toEqual([
        ['2026-11-15', 1],
        ['2026-11-14', 1],
        ['2026-11-13', 1],
      ])
    } finally {
      process.env.TZ = 'America/New_York'
    }
  })

  it('the day turns while the app is open: a new day entry starts', () => {
    const cards: CardRecord[] = [{ id: 'A-1', off: false, next: false, reviews: [{ at: '2026-11-14T15:00Z', rating: 'good' }] }]
    const vaults = [{ pages: [{ cards }], settings: DEFAULT_REVIEW_SETTINGS }]
    const profile = { login: 'y', name: 'Y', avatar: 'a', nickname: null }
    const before = numbersFor(friendStats(vaults, Date.parse('2026-11-15T04:59:00Z')), profile, NOW)
    const after = numbersFor(friendStats(vaults, Date.parse('2026-11-15T05:01:00Z')), profile, NOW)
    expect(before.days[0].day).toBe('2026-11-14')
    expect(after.days.map((d) => [d.day, d.cards])).toEqual([
      ['2026-11-15', 0],
      ['2026-11-14', 1],
    ])
    expect(numbersKey(after)).not.toBe(numbersKey(before))
  })
})

describe('the gist_update budget (proof 1C: 100 an hour for the account)', () => {
  it('the reserve is one update for each pointer (a remove, 4E2) plus 5 for cheers and nudges', () => {
    expect(reserveFor(0)).toBe(5)
    expect(reserveFor(8)).toBe(13)
  })

  it('counts my own updates in the last hour, and GitHub`s number when it is newer and lower', () => {
    let b = emptyBudget()
    expect(budgetLeft(b, NOW)).toBe(GIST_UPDATES_PER_HOUR)
    b = noteUpdate(b, NOW, null)
    b = noteUpdate(b, NOW + 1000, null)
    expect(budgetLeft(b, NOW + 2000)).toBe(98)
    // The Mac and the cheers use the same 100: GitHub says 30 are left.
    b = noteUpdate(b, NOW + 3000, { remaining: 30, limit: 100, resetAt: NOW + 40 * 60_000 })
    expect(budgetLeft(b, NOW + 4000)).toBe(30)
    // An hour on, my own updates are out of the window, and GitHub's number is out of date.
    expect(budgetLeft(b, NOW + HOUR + 4000)).toBe(GIST_UPDATES_PER_HOUR)
  })

  it('never spends the reserve on a send; a remove may use it', () => {
    const b = noteUpdate(emptyBudget(), NOW, { remaining: 14, limit: 100, resetAt: NOW + HOUR })
    expect(mayUpdate(b, NOW, 1, reserveFor(8))).toBe(true)
    const low = noteUpdate(emptyBudget(), NOW, { remaining: 13, limit: 100, resetAt: NOW + HOUR })
    expect(mayUpdate(low, NOW, 1, reserveFor(8))).toBe(false)
    expect(mayUpdate(low, NOW, 9, 0)).toBe(true)
  })

  it('slows down before the limit: the gap between sends grows as the spare updates shrink', () => {
    const at = (remaining: number) => sendGap(noteUpdate(emptyBudget(), NOW, { remaining, limit: 100, resetAt: NOW + HOUR }), NOW, 5)
    expect(at(95)).toBe(PUBLISH_EVERY_MS)
    expect(at(17)).toBe(5 * 60_000) // 12 spare in the hour: one each 5 minutes
    expect(at(11)).toBe(10 * 60_000) // 6 spare: one each 10 minutes
    expect(at(5)).toBe(HOUR) // nothing spare: wait for the reset
  })

  it('a rate-limit answer blocks the budget until its reset time', () => {
    const b: GistBudget = { ...emptyBudget(), blockedUntil: NOW + 10 * 60_000 }
    expect(mayUpdate(b, NOW, 1, 0)).toBe(false)
    expect(mayUpdate(b, NOW + 10 * 60_000, 1, 0)).toBe(true)
  })
})

describe('the send gate (decisions 14 and 22; round 12 item 3)', () => {
  const base = { pointers: 2, passSeen: true, holdsAll: true, lastSentAt: null, lastKey: null, now: NOW, reason: 'pass' as const, budget: emptyBudget() }
  it('never with zero friends and groups; never before a sync pass; never without all the vaults that count', () => {
    expect(sendGate({ ...base, pointers: 0 })).toMatchObject({ go: false, why: 'no-friends' })
    expect(sendGate({ ...base, passSeen: false })).toMatchObject({ go: false, why: 'no-pass' })
    expect(sendGate({ ...base, holdsAll: false })).toMatchObject({ go: false, why: 'missing-vaults' })
    expect(sendGate(base)).toEqual({ go: true })
  })

  it('at most once each 5 minutes while reviewing; the background send does not wait the 5 minutes', () => {
    const sent = { ...base, lastSentAt: NOW - 60_000 }
    expect(sendGate(sent)).toEqual({ go: false, why: 'wait', retryAt: NOW - 60_000 + PUBLISH_EVERY_MS })
    expect(sendGate({ ...sent, reason: 'background' })).toEqual({ go: true })
    expect(sendGate({ ...sent, reason: 'background', lastSentAt: NOW - 10_000 })).toEqual({ go: false, why: 'wait', retryAt: NOW - 10_000 + BACKGROUND_GAP_MS })
  })

  it('the budget comes first, also for the background send', () => {
    const b = noteUpdate(emptyBudget(), NOW - HOUR / 2, { remaining: 7, limit: 100, resetAt: NOW + HOUR / 2 })
    expect(sendGate({ ...base, reason: 'background', budget: b })).toMatchObject({ go: false, why: 'budget' })
  })
})

describe('sendNumbers: ONE update of the numbers gist, for any number of friends', () => {
  async function setup(pointers = 7) {
    const w = fakeGistWorld({ accounts: { phone: { login: 'yaseen' }, mac: { login: 'yaseen' }, ro: { login: 'yaseen', gists: false } }, start: NOW })
    const api = w.api('phone')
    const made = await ensureFriendsFiles(api, { vaults: ['yaseen/vault'], nickname: null }, opts)
    if (made.kind !== 'ok') throw new Error('no index')
    const statsId = made.handle.index.stats!
    for (let i = 0; i < pointers; i++) await makePointer(api, statsId, opts)
    return { w, api, statsId }
  }

  it('one PATCH of the numbers gist; the pointers are not written', async () => {
    const { w, api, statsId } = await setup(7)
    const before = w.updates('yaseen')
    const sent = await sendNumbers(api, { statsId, fresh: file([day('2026-11-14', 3)]), budget: emptyBudget(), reserve: reserveFor(7), now: NOW })
    expect(sent.outcome).toEqual({ kind: 'sent' })
    expect(w.updates('yaseen') - before).toBe(1)
    expect(w.calls.filter((c) => c.op === 'update').at(-1)!.id).toBe(statsId)
    expect(JSON.parse(w.text(statsId, NUMBERS_FILE)!).days[0].cards).toBe(3)
    expect(budgetLeft(sent.budget, NOW)).toBeLessThan(GIST_UPDATES_PER_HOUR)
  })

  it('reads the gist first and never lowers it; equal numbers write nothing', async () => {
    const { w, api, statsId } = await setup(1)
    await w.api('mac').update(statsId, { [NUMBERS_FILE]: JSON.stringify(file([day('2026-11-14', 9)])) })
    const n = w.updates('yaseen')
    const sent = await sendNumbers(api, { statsId, fresh: file([day('2026-11-14', 4)]), budget: emptyBudget(), reserve: 6, now: NOW })
    expect(sent.outcome).toEqual({ kind: 'unchanged' })
    expect(w.updates('yaseen')).toBe(n)
  })

  it('two devices of one person: the gist ends with the larger count of each day', async () => {
    const { w, api, statsId } = await setup(1)
    const mac = w.api('mac')
    w.shuffle(1)
    await Promise.all([
      sendNumbers(api, { statsId, fresh: file([day('2026-11-14', 4), day('2026-11-13', 20)]), budget: emptyBudget(), reserve: 6, now: NOW }),
      sendNumbers(mac, { statsId, fresh: file([day('2026-11-14', 6), day('2026-11-13', 11)]), budget: emptyBudget(), reserve: 6, now: NOW }),
    ])
    // With no lock on GitHub, the last writer may lower a day for a time; the next send of the other device repairs it.
    await sendNumbers(api, { statsId, fresh: file([day('2026-11-14', 4), day('2026-11-13', 20)]), budget: emptyBudget(), reserve: 6, now: NOW + PUBLISH_EVERY_MS })
    await sendNumbers(mac, { statsId, fresh: file([day('2026-11-14', 6), day('2026-11-13', 11)]), budget: emptyBudget(), reserve: 6, now: NOW + PUBLISH_EVERY_MS })
    const days = JSON.parse(w.text(statsId, NUMBERS_FILE)!).days as FriendDay[]
    expect(days.map((d) => [d.day, d.cards])).toEqual([
      ['2026-11-14', 6],
      ['2026-11-13', 20],
    ])
  })

  it('a deleted numbers gist: "numbers-gone", and nothing is made here (the caller makes it again with the list)', async () => {
    const { w, api, statsId } = await setup(1)
    await api.remove(statsId)
    const sent = await sendNumbers(api, { statsId, fresh: file([day('2026-11-14', 4)]), budget: emptyBudget(), reserve: 6, now: NOW })
    expect(sent.outcome).toEqual({ kind: 'numbers-gone' })
    expect(w.calls.filter((c) => c.op === 'create')).toHaveLength(3)
  })

  it('a numbers file from a newer app is not written', async () => {
    const { w, api, statsId } = await setup(1)
    await api.update(statsId, { [NUMBERS_FILE]: JSON.stringify({ v: 2 }) })
    const n = w.updates('yaseen')
    expect((await sendNumbers(api, { statsId, fresh: file([day('2026-11-14', 4)]), budget: emptyBudget(), reserve: 6, now: NOW })).outcome).toEqual({ kind: 'newer-app' })
    expect(w.updates('yaseen')).toBe(n)
  })

  it('a token with no Gists permission: "refused"', async () => {
    const { w, statsId } = await setup(1)
    expect((await sendNumbers(w.api('ro'), { statsId, fresh: file([day('2026-11-14', 4)]), budget: emptyBudget(), reserve: 6, now: NOW })).outcome).toEqual({ kind: 'refused' })
  })

  it('offline and rate-limited are quiet outcomes with a time to try again', async () => {
    const { w, api, statsId } = await setup(1)
    const input = { statsId, fresh: file([day('2026-11-14', 4)]), budget: emptyBudget(), reserve: 6, now: NOW }
    w.offline = true
    expect((await sendNumbers(api, input)).outcome).toEqual({ kind: 'offline' })
    w.offline = false
    w.failNext = (call) => (call.op === 'update' ? 'RATE_LIMITED' : undefined)
    const limited = await sendNumbers(api, input)
    expect(limited.outcome).toMatchObject({ kind: 'rate-limited', retryAt: expect.any(Number) })
    expect(mayUpdate(limited.budget, NOW + 1000, 1, 0)).toBe(false)
  })

  it('holds the reserve: no update when only the reserve is left', async () => {
    const { w, api, statsId } = await setup(8)
    const mac = w.api('mac')
    // The Mac and cheers used 88 of the 100.
    for (let i = 0; i < 87; i++) await mac.update(statsId, { [NUMBERS_FILE]: JSON.stringify(file([day('2026-11-14', i % 3)])) })
    let budget = emptyBudget()
    const sent = await sendNumbers(api, { statsId, fresh: file([day('2026-11-14', 50)]), budget, reserve: reserveFor(8), now: NOW })
    expect(sent.outcome).toEqual({ kind: 'sent' })
    budget = sent.budget
    expect(budgetLeft(budget, NOW)).toBe(12)
    const next = await sendNumbers(api, { statsId, fresh: file([day('2026-11-14', 51)]), budget, reserve: reserveFor(8), now: NOW + PUBLISH_EVERY_MS })
    expect(next.outcome).toMatchObject({ kind: 'budget' })
    expect(w.updates('yaseen')).toBe(88)
  })
})
