import { afterEach, describe, expect, it } from 'vitest'
import type { CardRecord } from '@shared/cardLine'
import { mergeNeverLower, numbersFor } from '@shared/friendSend'
import { dayIn, friendStats, isTimeZone, type FriendStats, type FriendVault } from '@shared/friendStats'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'

/**
 * YAZ-5251 (option 1, Yaseen's choice): ONE home time zone for the person's numbers, kept in their own friends list.
 * Every device counts the days in it, so one answer is on one day. Device zones are set with `process.env.TZ`.
 */
const TZ = process.env.TZ
afterEach(() => {
  process.env.TZ = TZ
})

const HOME = 'America/New_York'
const profile = { login: 'yaseen', name: 'Yaseen', avatar: '', nickname: null }
/** `n` cards, each answered once at `at` (a UTC ms), one second apart. */
const answered = (n: number, at: number): CardRecord[] =>
  Array.from({ length: n }, (_, i) => ({ id: `C${i}`, off: false, next: false, reviews: [{ at: new Date(at + i * 1000).toISOString().slice(0, 16) + 'Z', rating: 'good' as const }] }))
const vaultWith = (cards: CardRecord[]): FriendVault => ({ pages: [{ cards }], settings: DEFAULT_REVIEW_SETTINGS })
const sum = (s: Pick<FriendStats, 'days'>) => s.days.reduce((n, d) => n + d.cards, 0)
const daysWithCards = (s: Pick<FriendStats, 'days'>) => s.days.filter((d) => d.cards > 0).map((d) => [d.day, d.cards])

/** 00:40 in New York on 15 November = 21:40 in Los Angeles on 14 November. */
const AT = Date.parse('2026-11-15T05:40:00Z')
const NOW = Date.parse('2026-11-15T06:00:00Z')

/** One device's numbers file: the count in the device's own zone (`TZ`), with the home zone as the input. */
function sendFrom(deviceTz: string, zone: string | null | undefined) {
  process.env.TZ = deviceTz
  return numbersFor(friendStats([vaultWith(answered(10, AT))], NOW, zone), profile, NOW)
}

describe('YAZ-5251: a phone and a Mac in two time zones', () => {
  it('a phone in Los Angeles and a Mac in New York, 10 answers around midnight: a friend sees 10, on one day', () => {
    const phone = sendFrom('America/Los_Angeles', HOME)
    const mac = sendFrom('America/New_York', HOME)
    const merged = mergeNeverLower(mergeNeverLower(null, phone).file, mac).file as unknown as FriendStats
    expect(sum(merged)).toBe(10)
    expect(daysWithCards(merged)).toEqual([['2026-11-15', 10]])
    expect(phone.days).toEqual(mac.days)
  })

  it('the root: with no home zone each device uses its own, and the same 10 answers are on two days (20)', () => {
    const phone = sendFrom('America/Los_Angeles', undefined)
    const mac = sendFrom('America/New_York', undefined)
    const merged = mergeNeverLower(mergeNeverLower(null, phone).file, mac).file as unknown as FriendStats
    expect(sum(merged)).toBe(20)
  })

  it('travel: "today" ends at midnight at home, not where the phone is', () => {
    // The phone is in Los Angeles at 22:30 on 14 November; at home (New York) it is 01:30 on 15 November.
    process.env.TZ = 'America/Los_Angeles'
    const now = Date.parse('2026-11-15T06:30:00Z')
    const s = friendStats([vaultWith([...answered(3, Date.parse('2026-11-15T04:30:00Z')), ...answered(2, Date.parse('2026-11-15T05:10:00Z'))])], now, HOME)
    // 23:30 New York (14 Nov) and 00:10 New York (15 Nov): two home days. Today is the home day 15 November.
    expect(s.days[0].day).toBe('2026-11-15')
    expect(daysWithCards(s)).toEqual([['2026-11-15', 2], ['2026-11-14', 3]])
    // The same answers on the phone's own clock are all on 14 November.
    expect(daysWithCards(friendStats([vaultWith([...answered(3, Date.parse('2026-11-15T04:30:00Z')), ...answered(2, Date.parse('2026-11-15T05:10:00Z'))])], now))).toEqual([['2026-11-14', 5]])
  })

  it('a zone change in Settings: the days already sent stay ("never lower"); the new days follow the new zone', () => {
    const before = sendFrom('America/New_York', HOME)
    const after = sendFrom('America/New_York', 'Asia/Tokyo') // 14:40 on 15 November in Tokyo: the same date
    const merged = mergeNeverLower(mergeNeverLower(null, before).file, after).file as unknown as FriendStats
    expect(daysWithCards(merged)).toEqual([['2026-11-15', 10]])
    const later = sendFrom('America/New_York', 'Pacific/Honolulu') // 19:40 on 14 November in Honolulu
    const merged2 = mergeNeverLower(merged, later).file as unknown as FriendStats
    // The day sent before stays at 10; the new zone's day is kept too. Too high for a time is the price of a change.
    expect(daysWithCards(merged2).find(([d]) => d === '2026-11-15')).toEqual(['2026-11-15', 10])
  })

  it('the old signature keeps working: no zone, or a zone this runtime does not know, is the device`s zone', () => {
    process.env.TZ = 'America/Los_Angeles'
    const cards = [vaultWith(answered(4, AT))]
    expect(friendStats(cards, NOW, 'Not/AZone')).toEqual(friendStats(cards, NOW))
    expect(friendStats(cards, NOW, null)).toEqual(friendStats(cards, NOW))
    expect(isTimeZone('Not/AZone')).toBe(false)
    expect(isTimeZone(HOME)).toBe(true)
  })

  it('a day where the clock changes at midnight starts at its first instant (America/Santiago, 6 September 2026)', () => {
    expect(dayIn(Date.parse('2026-09-06T04:00:00Z'), 'America/Santiago')).toBe('2026-09-06')
    const s = friendStats([vaultWith(answered(1, Date.parse('2026-09-06T04:00:00Z')))], Date.parse('2026-09-06T12:00:00Z'), 'America/Santiago')
    expect(daysWithCards(s)).toEqual([['2026-09-06', 1]])
  })
})
