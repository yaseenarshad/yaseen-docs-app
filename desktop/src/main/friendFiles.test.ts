import { describe, expect, it } from 'vitest'
import { FRIEND_FILE_MAX_BYTES, parseFriendPointer, parseFriendStats, type FriendPointer, type FriendStats } from '@shared/friendStats'

/**
 * YAZ-5069, round 16 of YAZ-5057: a friend's gists are untrusted text. The readers check each file and answer a typed
 * result: the file in a clean copy, or "unreadable" with the reason. They never throw.
 */
const STATS: FriendStats = {
  v: 1,
  login: 'sam',
  name: 'Sam',
  avatar: 'https://avatars.githubusercontent.com/u/1',
  days: [{ day: '2026-11-13', cards: 12, seconds: 300, remembered: 10, forgot: 2, newCards: 3, done: true }],
  totals: { cards: 400, inReview: 300, newLeft: 90, mature: 120, dueLeft: 0, addedThisWeek: 5, streak: 4, bestStreak: 9, bestDay: 60, bestWeek: 200 },
  at: '2026-11-13T20:00:00.000Z',
}
const POINTER: FriendPointer = { v: 1, stats: 'aa11bb22cc33dd44ee55ff6677889900', reads: '0123456789abcdef0123456789abcdef', mark: { kind: 'cheer', at: '2026-11-13T20:00:00.000Z' } }
const text = (x: unknown): string => JSON.stringify(x)

describe('parseFriendStats', () => {
  it('reads a good file, and keeps only the known fields', () => {
    expect(parseFriendStats(text(STATS))).toEqual({ ok: true, value: STATS })
    const extra = parseFriendStats(text({ ...STATS, mark: { kind: 'cheer', at: 'x' }, reads: 'abc', secret: 'card text', totals: { ...STATS.totals, more: 1 } }))
    expect(extra).toEqual({ ok: true, value: STATS })
  })

  it('a numbers file has no `mark` and no `reads` (round 16): they live in the pointer', () => {
    const r = parseFriendStats(text(STATS))
    expect(r.ok && ('mark' in r.value || 'reads' in r.value)).toBe(false)
  })

  it('answers "unreadable" and never throws for a bad file', () => {
    const bad: [string, unknown][] = [
      ['not JSON', '{'],
      ['not an object', [1, 2]],
      ['wrong version', { ...STATS, v: 2 }],
      ['no version', { ...STATS, v: undefined }],
      ['missing login', { ...STATS, login: undefined }],
      ['a number as text', { ...STATS, totals: { ...STATS.totals, streak: '4' } }],
      ['a negative count', { ...STATS, totals: { ...STATS.totals, cards: -1 } }],
      ['a fraction', { ...STATS, days: [{ ...STATS.days[0], cards: 1.5 }] }],
      ['an absurd count', { ...STATS, totals: { ...STATS.totals, bestWeek: 1e12 } }],
      ['a bad day', { ...STATS, days: [{ ...STATS.days[0], day: '13/11/2026' }] }],
      ['`done` not a boolean', { ...STATS, days: [{ ...STATS.days[0], done: 'yes' }] }],
      ['too many days', { ...STATS, days: Array.from({ length: 91 }, () => STATS.days[0]) }],
      ['a huge name', { ...STATS, name: 'x'.repeat(1000) }],
      ['a bad time', { ...STATS, at: 'soon' }],
    ]
    for (const [why, raw] of bad) {
      const r = parseFriendStats(typeof raw === 'string' ? raw : text(raw))
      expect([why, r.ok]).toEqual([why, false])
      if (!r.ok) expect(r.why).toMatch(/\S/)
    }
    expect(parseFriendStats('x'.repeat(FRIEND_FILE_MAX_BYTES + 1))).toMatchObject({ ok: false })
    expect(parseFriendStats(undefined as unknown as string)).toMatchObject({ ok: false })
  })
})

describe('parseFriendPointer', () => {
  it('reads a friend`s pointer, and a group`s (no `reads`, no `mark`)', () => {
    expect(parseFriendPointer(text(POINTER))).toEqual({ ok: true, value: POINTER })
    expect(parseFriendPointer(text({ v: 1, stats: POINTER.stats }))).toEqual({ ok: true, value: { v: 1, stats: POINTER.stats } })
    expect(parseFriendPointer(text({ ...POINTER, other: 1 }))).toEqual({ ok: true, value: POINTER })
  })

  it('answers "unreadable" for a bad pointer', () => {
    for (const raw of [
      { ...POINTER, v: 2 },
      { ...POINTER, stats: undefined },
      { ...POINTER, stats: '../../evil' },
      { ...POINTER, stats: 'a'.repeat(200) },
      { ...POINTER, reads: 7 },
      { ...POINTER, mark: { kind: 'taunt', at: POINTER.mark!.at } },
      { ...POINTER, mark: { kind: 'cheer' } },
      { ...POINTER, mark: 'cheer' },
    ]) {
      expect(parseFriendPointer(text(raw)).ok).toBe(false)
    }
    expect(parseFriendPointer('null').ok).toBe(false)
  })
})
