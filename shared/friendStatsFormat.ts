import type { CardRecord } from './cardLine'
import type { ReviewSettings } from './reviews'

/**
 * The friends numbers' shapes, days and file checks, with no `cardSchedule` (so no `ts-fsrs`) import (YAZ-5509). The
 * Mac's main process sends and reads these files but never counts (the count runs in `friends/countWorker.ts`), so it
 * imports from here and does not load the FSRS library at startup. `friendStats.ts` re-exports all of it and holds
 * the count. Only type imports above: keep it that way.
 */
/** What a person shares with friends and groups: numbers only, never card text. ONE file in ONE secret gist for the person (round 16). */
export interface FriendStats {
  v: 1
  login: string
  name: string
  avatar: string
  /** Local days, newest first, 90 at most. `done`: the due cards were finished that day (the streak rule). */
  days: FriendDay[]
  /** `inReview`: answered at least one time and not archived. `newLeft`: never answered and not archived. `mature`: next gap of 21 days or more. */
  totals: FriendTotals
  at: string
}

/** A cheer or a nudge (decision 24). The friend's app shows it until it was seen, then to the end of the next local day. */
export interface FriendMark {
  kind: 'cheer' | 'nudge'
  at: string
}

/**
 * One small gist for ONE friend, or for one group that the person is in (round 16 of YAZ-5057: GitHub allows 100 gist
 * updates an hour, so a send writes ONE numbers gist, not one for each friend). The friend's link is this gist's ID.
 */
export interface FriendPointer {
  v: 1
  /** The ID of the person's numbers gist (`FriendStats`). It changes when the person removes a friend. */
  stats: string
  /** The pointer gist that this person reads from that friend: the automatic pairing (round 12, item 5). Absent for a group. */
  reads?: string
  /** A cheer or a nudge for that friend (decision 24). Absent for a group. */
  mark?: FriendMark
}

/** One local day of `FriendStats.days`. */
export interface FriendDay {
  /** The local date, `2026-11-13`. */
  day: string
  /** Each card answered that day, new cards too (round 9). A card answered three times counts one time. */
  cards: number
  /** The seconds the day's answers took; an answer with no time counts 0. */
  seconds: number
  /** The answers that were not Forgot (`hard`, `good`, `easy`). Each answer counts, also one in the same-day steps. */
  remembered: number
  /** The answers that were Forgot (`again`). */
  forgot: number
  /** The cards whose first answer is that day. The day's due cards are `cards` minus `newCards`. */
  newCards: number
  /** The due cards were finished that day. A day with no due card is finished. */
  done: boolean
}

export interface FriendTotals {
  /** Every card in the vaults that count, archived cards too. */
  cards: number
  inReview: number
  newLeft: number
  mature: number
  /** The due cards of today that are not finished: with the cards that come back in the same session, no new card. */
  dueLeft: number
  /** The cards whose first answer is in this local week (Monday to Sunday). */
  addedThisWeek: number
  /** Finished days in a row up to today; today counts once it is finished, and an unfinished today does not stop it. */
  streak: number
  /** The longest run of finished days since the first answer. */
  bestStreak: number
  /** The most cards (`FriendDay.cards`) in one day since the first answer. */
  bestDay: number
  /** The most cards in one local week (Monday to Sunday), the sum of its days' `cards`. */
  bestWeek: number
}

/** The vaults that count (`FriendsIndex.vaults`): each one's index records and its own review settings (FSRS). */
export interface FriendVault {
  pages: readonly { cards?: readonly CardRecord[] }[]
  settings: ReviewSettings
}

/** `FriendStats.days` keeps this many days at most. */
export const FRIEND_DAYS = 90
/** A card is mature when the gap to its next review is this many days or more. */
export const MATURE_DAYS = 21
/** "Remembered %" and "days reviewed" look at this many days (round 12, item 1). */
export const RECENT_DAYS = 30

/** Internal to the friends numbers (`friendStats.ts` uses it). */
export const pad = (n: number): string => String(n).padStart(2, '0')
/** The local date of `d`, `2026-11-13`. */
const dayKey = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/**
 * YAZ-5251: the days of one time zone. `date` gives the date of an instant there; `start` the instant its day starts
 * (midnight, or the first instant of the day where a change of the clock skips midnight).
 */
interface Calendar {
  date(ms: number): { y: number; m: number; d: number }
  start(y: number, m: number, d: number): number
}

/** The device's own zone: JavaScript's local `Date`, the count as it was before YAZ-5251. */
const deviceCalendar: Calendar = {
  date: (ms) => {
    const t = new Date(ms)
    return { y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate() }
  },
  start: (y, m, d) => new Date(y, m - 1, d).getTime(),
}

/** An IANA time zone this runtime knows (`America/New_York`), or false. */
export function isTimeZone(zone: unknown): zone is string {
  if (typeof zone !== 'string' || zone.length === 0 || zone.length > 64) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

/** The device's own IANA time zone, or null when the runtime does not say. */
export function deviceZone(): string | null {
  const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone
  return isTimeZone(zone) ? zone : null
}

const calendars = new Map<string, Calendar>()
/** The calendar of `zone`; the device's own for no zone, or for a zone this runtime does not know. */
export function calendarOf(zone: string | null | undefined): Calendar {
  if (zone === null || zone === undefined || !isTimeZone(zone)) return deviceCalendar
  const known = calendars.get(zone)
  if (known !== undefined) return known
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
  const wall = (ms: number) => {
    const o: Record<string, number> = {}
    for (const p of parts.formatToParts(ms)) if (p.type !== 'literal') o[p.type] = Number(p.value)
    return o
  }
  /** The zone's offset at `ms` (ms): its wall clock read as UTC, less `ms`. */
  const offset = (ms: number) => {
    const w = wall(ms)
    return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(ms / 1000) * 1000
  }
  const date = (ms: number) => {
    const w = wall(ms)
    return { y: w.year, m: w.month, d: w.day }
  }
  const cal: Calendar = {
    date,
    start(y, m, d) {
      const utc = Date.UTC(y, m - 1, d)
      let t = utc - offset(utc)
      t = utc - offset(t)
      // A clock change at midnight: midnight is not there, or is there twice. The day starts at its first instant.
      const same = (x: number) => {
        const a = date(x)
        return a.y === y && a.m === m && a.d === d
      }
      while (!same(t)) t += 15 * 60_000
      while (same(t - 15 * 60_000)) t -= 15 * 60_000
      return t
    },
  }
  calendars.set(zone, cal)
  return cal
}

/** The date (`2026-11-13`) of the instant `ms` in `zone` (the device's own zone with none). */
export function dayIn(ms: number, zone?: string | null): string {
  const { y, m, d } = calendarOf(zone).date(ms)
  return `${y}-${pad(m)}-${pad(d)}`
}

/** The days of `days` (newest first) in the `RECENT_DAYS` days that end on the newest one. */
function recent(days: readonly FriendDay[]): FriendDay[] {
  if (days.length === 0) return []
  const [y, m, d] = days[0].day.split('-').map(Number)
  const from = dayKey(new Date(y, m - 1, d - (RECENT_DAYS - 1)))
  return days.filter((day) => day.day >= from)
}

/** "Remembered %" (round 12, item 1): the answers of the last 30 days that were not Forgot, 0 to 100; null with no answer. */
export function rememberedPercent(days: readonly FriendDay[]): number | null {
  let yes = 0
  let no = 0
  for (const day of recent(days)) {
    yes += day.remembered
    no += day.forgot
  }
  return yes + no === 0 ? null : Math.round((100 * yes) / (yes + no))
}

/** "Days reviewed of 30": the days of the last 30 with at least one card answered. */
export const daysReviewed = (days: readonly FriendDay[]): number => recent(days).filter((day) => day.cards > 0).length

/** A friend's gist file as read: the file in a clean copy (known fields only), or why it cannot be read. Never a throw. */
export type FriendFileRead<T> = { ok: true; value: T } | { ok: false; why: string }

/** The largest friend file read, in characters: a real numbers file is a few kilobytes. */
export const FRIEND_FILE_MAX_BYTES = 256 * 1024
/** The largest count a number in a friend file may hold. */
const MAX_COUNT = 1e9
const MAX_TEXT = 300
const GIST_ID_RE = /^[0-9a-f]{1,64}$/i
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/

/** Thrown inside the readers only, and caught there: the reason a file is unreadable. */
class Unreadable extends Error {}
const fail = (why: string): never => {
  throw new Unreadable(why)
}
const objectAt = (v: unknown, where: string): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : fail(`${where} is not an object`)
const countAt = (o: Record<string, unknown>, key: string, where: string): number => {
  const v = o[key]
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_COUNT ? v : fail(`${where}.${key} is not a count`)
}
const textAt = (o: Record<string, unknown>, key: string, where: string, max = MAX_TEXT): string => {
  const v = o[key]
  return typeof v === 'string' && v.length <= max ? v : fail(`${where}.${key} is not a text`)
}
const timeAt = (o: Record<string, unknown>, key: string, where: string): string => {
  const v = textAt(o, key, where, 40)
  return TIME_RE.test(v) && !Number.isNaN(Date.parse(v)) ? v : fail(`${where}.${key} is not a time`)
}
const gistIdAt = (o: Record<string, unknown>, key: string, where: string): string => {
  const v = o[key]
  return typeof v === 'string' && GIST_ID_RE.test(v) ? v : fail(`${where}.${key} is not a gist ID`)
}

/** `text` as JSON with `v: 1`, then `read` on it; any fault is "unreadable". */
function readFile<T>(text: unknown, read: (o: Record<string, unknown>) => T): FriendFileRead<T> {
  try {
    if (typeof text !== 'string') return { ok: false, why: 'the file is not text' }
    if (text.length > FRIEND_FILE_MAX_BYTES) return { ok: false, why: 'the file is too large' }
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      return { ok: false, why: 'the file is not JSON' }
    }
    const o = objectAt(raw, 'the file')
    if (o.v !== 1) return { ok: false, why: 'the file has another version' }
    return { ok: true, value: read(o) }
  } catch (err) {
    if (err instanceof Unreadable) return { ok: false, why: err.message }
    return { ok: false, why: 'the file cannot be read' }
  }
}

const DAY_COUNTS = ['cards', 'seconds', 'remembered', 'forgot', 'newCards'] as const
const TOTALS = ['cards', 'inReview', 'newLeft', 'mature', 'dueLeft', 'addedThisWeek', 'streak', 'bestStreak', 'bestDay', 'bestWeek'] as const

/** A friend's numbers file (`FriendStats`), from untrusted text: checked field by field, at most `FRIEND_DAYS` days. */
export const parseFriendStats = (text: string): FriendFileRead<FriendStats> =>
  readFile(text, (o) => {
    const rawDays = Array.isArray(o.days) ? o.days : fail('days is not a list')
    if (rawDays.length > FRIEND_DAYS) fail('days has too many days')
    const days = rawDays.map((d, i): FriendDay => {
      const where = `days[${i}]`
      const day = objectAt(d, where)
      const key = textAt(day, 'day', where, 10)
      if (!DAY_RE.test(key)) fail(`${where}.day is not a date`)
      if (typeof day.done !== 'boolean') fail(`${where}.done is not true or false`)
      const counts = Object.fromEntries(DAY_COUNTS.map((k) => [k, countAt(day, k, where)])) as Record<(typeof DAY_COUNTS)[number], number>
      return { day: key, ...counts, done: day.done as boolean }
    })
    const t = objectAt(o.totals, 'totals')
    const totals = Object.fromEntries(TOTALS.map((k) => [k, countAt(t, k, 'totals')])) as unknown as FriendTotals
    return { v: 1, login: textAt(o, 'login', 'the file', 100), name: textAt(o, 'name', 'the file'), avatar: textAt(o, 'avatar', 'the file', 2000), days, totals, at: timeAt(o, 'at', 'the file') }
  })

/** A friend's or a group's pointer file (`FriendPointer`), from untrusted text. */
export const parseFriendPointer = (text: string): FriendFileRead<FriendPointer> =>
  readFile(text, (o) => {
    const out: FriendPointer = { v: 1, stats: gistIdAt(o, 'stats', 'the file') }
    if (o.reads !== undefined) out.reads = gistIdAt(o, 'reads', 'the file')
    if (o.mark !== undefined) {
      const m = objectAt(o.mark, 'mark')
      if (m.kind !== 'cheer' && m.kind !== 'nudge') fail('mark.kind is not cheer or nudge')
      out.mark = { kind: m.kind as FriendMark['kind'], at: timeAt(m, 'at', 'mark') }
    }
    return out
  })
