import { afterEach, describe, expect, it } from 'vitest'
import type { CardRecord } from '@shared/cardLine'
import { groupStreak, localDay } from '@shared/friendGroups'
import { mergeNeverLower, numbersFor } from '@shared/friendSend'
import { friendStats, type FriendDay, type FriendStats, type FriendVault } from '@shared/friendStats'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'

// CHECKER round 4 (YAZ-5251 B3, YAZ-5084 B8): my own cases, not the builder's.
const TZ = process.env.TZ
afterEach(() => {
  process.env.TZ = TZ
})
const profile = { login: 'ali', name: 'Ali', avatar: '', nickname: null }
const at = (iso: string, n: number, gapMin = 1): CardRecord[] =>
  Array.from({ length: n }, (_, i) => ({ id: `K${iso}${i}`, off: false, next: false, reviews: [{ at: new Date(Date.parse(iso) + i * gapMin * 60_000).toISOString().slice(0, 16) + ':00.000Z', rating: 'good' as const }] }))
const vault = (cards: CardRecord[]): FriendVault => ({ pages: [{ cards }], settings: DEFAULT_REVIEW_SETTINGS })
const sum = (s: Pick<FriendStats, 'days'>) => s.days.reduce((n, d) => n + d.cards, 0)
const withCards = (s: Pick<FriendStats, 'days'>) => s.days.filter((d) => d.cards > 0).map((d) => [d.day, d.cards])
function count(deviceTz: string, cards: CardRecord[], now: number, zone: string | null) {
  process.env.TZ = deviceTz
  return numbersFor(friendStats([vault(cards)], now, zone), profile, now)
}

describe('B3: one home zone', () => {
  // 10 answers, 23:55 to 00:04 in New York (20:55 to 21:04 in Los Angeles). The phone (LA) made the list: home = LA.
  const cards = at('2026-11-15T04:55:00Z', 10)
  const NOW = Date.parse('2026-11-15T06:00:00Z')
  it('a phone in Los Angeles and a Mac in New York, 10 answers around New York midnight, home LA: one day, 10', () => {
    const phone = count('America/Los_Angeles', cards, NOW, 'America/Los_Angeles')
    const mac = count('America/New_York', cards, NOW, 'America/Los_Angeles')
    const merged = mergeNeverLower(mergeNeverLower(null, mac).file, phone).file as unknown as FriendStats
    expect(phone.days).toEqual(mac.days)
    expect(withCards(merged)).toEqual([['2026-11-14', 10]])
    expect(merged.totals.cards).toBe(phone.totals.cards)
  })
  it('the same 10 answers around LOS ANGELES midnight: 5 and 5, the same on both devices; never 20', () => {
    const c = at('2026-11-15T07:55:00Z', 10) // 23:55 to 00:04 in LA
    const now = Date.parse('2026-11-15T09:00:00Z')
    const phone = count('America/Los_Angeles', c, now, 'America/Los_Angeles')
    const mac = count('America/New_York', c, now, 'America/Los_Angeles')
    const merged = mergeNeverLower(mergeNeverLower(null, phone).file, mac).file as unknown as FriendStats
    expect(withCards(merged)).toEqual([['2026-11-15', 5], ['2026-11-14', 5]])
    expect(sum(merged)).toBe(10)
  })
  // OPEN, for Yaseen (round 4 verdict, "For Yaseen: Home zone change"): the builder's choice is to accept it (the
  // change day counts twice for friends while it is in the numbers). Not one of this unit's bugs; it stays red until
  // Yaseen picks the other option, so it is marked as a known failure here.
  it.fails('a zone change mid-week (LA to Tokyo, Wednesday evening): the answers already sent are counted again on the new day', () => {
    // Wednesday 18 November, 19:00 to 19:09 in LA = Thursday 19 November, 12:00 in Tokyo.
    const c = at('2026-11-19T03:00:00Z', 10)
    const sendAt = Date.parse('2026-11-19T03:30:00Z')
    const before = count('America/Los_Angeles', c, sendAt, 'America/Los_Angeles')
    expect(withCards(before)).toEqual([['2026-11-18', 10]])
    // The person sets "Home time zone" to Tokyo; the next send counts the same 10 answers in Tokyo.
    const after = count('America/Los_Angeles', c, sendAt + 10 * 60_000, 'Asia/Tokyo')
    const merged = mergeNeverLower(mergeNeverLower(null, before).file, after).file as unknown as FriendStats
    // Round 13: "The numbers can be too low for a time. They are never too high."
    expect({ sum: sum(merged), days: withCards(merged) }).toEqual({ sum: 10, days: withCards(merged) }) // fails: 20 (Wed 10 kept, Thu 10 new)
  })
})

describe('B8: a new member counts in the group streak from the next day, by their own days', () => {
  const day = (d: string, done: boolean): FriendDay => ({ day: d, cards: done ? 5 : 1, seconds: 10, remembered: 1, forgot: 0, newCards: 0, done })
  const span = (from: string, to: string, done = true): FriendDay[] => {
    const out: FriendDay[] = []
    for (let t = Date.parse(`${to}T00:00:00Z`); t >= Date.parse(`${from}T00:00:00Z`); t -= 86_400_000) out.push(day(new Date(t).toISOString().slice(0, 10), done))
    return out
  }
  it('same zone: the join day does not change today\'s streak; from tomorrow the member counts', () => {
    process.env.TZ = 'America/Los_Angeles'
    const admin = { days: span('2026-11-05', '2026-11-15') }
    const since = '2026-11-15T20:00:00Z' // 12:00 in LA on 15 November
    const today = localDay(Date.parse('2026-11-15T23:00:00Z'))
    expect(groupStreak([admin], today)).toBe(11)
    expect(groupStreak([admin, { days: [], since }], today)).toBe(11)
    expect(groupStreak([admin, { days: [day('2026-11-15', false)], since }], today)).toBe(11)
    // Next day: the member finishes 16 November; the streak goes on.
    const admin2 = { days: span('2026-11-05', '2026-11-16') }
    expect(groupStreak([admin2, { days: [day('2026-11-16', true), day('2026-11-15', false)], since }], '2026-11-16')).toBe(12)
  })
  it('a member in Tokyo, the reader in Los Angeles: the member\'s own join day must not break the streak', () => {
    process.env.TZ = 'America/Los_Angeles' // the reader
    // The admin adds Kenji at 2026-11-14T20:00:00.000Z: 12:00 on 14 November in LA, 05:00 on 15 November in Tokyo (his join day).
    const since = '2026-11-14T20:00:00Z'
    const admin = { days: span('2026-11-07', '2026-11-17') } // the admin (LA) finished every day
    // Kenji's own days (Tokyo): his join day 15 November not finished; 16 and 17 November finished.
    const kenji = { days: [day('2026-11-17', true), day('2026-11-16', true), day('2026-11-15', false)], since }
    const today = '2026-11-17'
    expect(groupStreak([admin], today)).toBe(11)
    expect(groupStreak([admin, kenji], today)).toBe(11) // fails: 2 (his join day 15 Nov is counted: the reader's join day is 14 Nov)
  })
})
