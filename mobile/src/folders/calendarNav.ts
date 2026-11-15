import type { Row } from '@client/views/engine'
import { addDays, monthStart, weekDays, weekLabel, type DayKey, type Span } from '@client/views/calendar'

/**
 * YAZ-5597: WHICH DAYS THE PHONE'S FOLDER CALENDAR LISTS, and how ‹ › and Today move it. The list is always the same
 * agenda (each day with pages under its month, the "No date" pages last); the mode picks what it holds:
 *  - Month: that month's days. Title "November 2026"; ‹ › the 1st of the month before or after (the Mac's `monthStart`).
 *  - Week: that week's 7 days, from the vault's week start (`weekStartsOn`, the Mac's `weekDays`). Title the Mac's
 *    `weekLabel`, "Nov 15 – Nov 21, 2026"; ‹ › a week back or on.
 *  - Rolling: every day, no range. It opens at today; ‹ › go to the month heading before or after; Today back to today.
 * The Mac (`CalendarView.tsx`) keeps one anchor day, today at first, and shows the period that holds it; its switch is
 * Month / Week (the view's `calendarScale`, Month by default). The phone starts on the view's own scale.
 */
export type CalendarMode = 'month' | 'week' | 'rolling'

/** The switch, in the Mac's order, Rolling after. */
export const MODES: readonly (readonly [CalendarMode, string])[] = [
  ['month', 'Month'],
  ['week', 'Week'],
  ['rolling', 'Rolling'],
]

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** The mode a view opens in: its `calendarScale` as the Mac reads it (`week`, else Month). */
export const modeOf = (scale: unknown): CalendarMode => (scale === 'week' ? 'week' : 'month')

/** The first and last day the mode lists, or null for every day (Rolling). */
export function periodOf(mode: CalendarMode, anchor: DayKey, sundayFirst: boolean): { start: DayKey; end: DayKey } | null {
  if (mode === 'rolling') return null
  if (mode === 'week') {
    const days = weekDays(anchor, sundayFirst)
    return { start: days[0], end: days[6] }
  }
  const start = monthStart(anchor, 0)
  return { start, end: addDays(monthStart(anchor, 1), -1) }
}

/** The anchor `by` periods on (Month and Week; Rolling's arrows go by the list's own month headings, `rollingMonth`). */
export function stepAnchor(mode: CalendarMode, anchor: DayKey, by: number): DayKey {
  return mode === 'week' ? addDays(anchor, 7 * by) : monthStart(anchor, by)
}

const monthTitle = (day: DayKey) => `${MONTHS[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`

/** The header's title: the week's days, else the month. */
export const periodTitle = (mode: CalendarMode, anchor: DayKey, sundayFirst: boolean): string =>
  mode === 'week' ? weekLabel(weekDays(anchor, sundayFirst)) : monthTitle(anchor)

/** The word in the arrows' names ("Previous month"), as the Mac's. */
export const periodUnit = (mode: CalendarMode): string => (mode === 'week' ? 'week' : 'month')

/** What an empty period says: "Nothing in November" (the year too when it is not this year's), "Nothing this week". */
export function emptyText(mode: CalendarMode, anchor: DayKey, today: DayKey, sundayFirst: boolean): string {
  if (mode === 'rolling') return 'No pages with a date.'
  const period = periodOf(mode, anchor, sundayFirst)!
  if (mode === 'week') return period.start <= today && today <= period.end ? 'Nothing this week' : `Nothing in ${periodTitle(mode, anchor, sundayFirst)}`
  const name = MONTHS[Number(anchor.slice(5, 7)) - 1]
  return `Nothing in ${anchor.slice(0, 4) === today.slice(0, 4) ? name : `${name} ${anchor.slice(0, 4)}`}`
}

/** An agenda line: a page, and for a page over several days its first (`from`, when that is before the line's day) and last day. */
export type AgendaItem = { row: Row; from?: DayKey; until?: DayKey }
export type AgendaDay = { day: DayKey; rows: AgendaItem[] }

/**
 * The days the list shows (the engine's `bucketByDay` in): each day with pages in `period`, in order, a page over
 * several days on its first day with its last. A page that began before the period and runs into it is on the
 * period's first day, first among that day's pages, with the day it began. Every day when `period` is null.
 */
export function agendaDays(days: ReadonlyMap<DayKey, readonly Row[]>, multi: readonly Span[], period: { start: DayKey; end: DayKey } | null): AgendaDay[] {
  const inside = (day: DayKey) => period === null || (period.start <= day && day <= period.end)
  const all = new Map<DayKey, AgendaItem[]>()
  const add = (day: DayKey, items: AgendaItem[], first = false) => all.set(day, first ? [...items, ...(all.get(day) ?? [])] : [...(all.get(day) ?? []), ...items])
  for (const [day, rows] of days) if (inside(day)) add(day, rows.map((row) => ({ row })))
  for (const span of multi) if (inside(span.start)) add(span.start, [{ row: span.row, until: span.end }])
  if (period !== null) {
    const running = multi.filter((s) => s.start < period.start && s.end >= period.start)
    if (running.length > 0) add(period.start, running.map((s) => ({ row: s.row, from: s.start, until: s.end })), true)
  }
  return [...all.keys()].sort().map((day) => ({ day, rows: all.get(day)! }))
}

/** Rolling's ‹ ›: the month heading (`YYYY-MM`) before or after `current` among the list's, or null at either end. */
export function rollingMonth(months: readonly string[], current: string, by: number): string | null {
  if (by < 0) return [...months].reverse().find((m) => m < current) ?? null
  return months.find((m) => m > current) ?? null
}

/** Rolling's day to show for `anchor`: the first listed day on or after it, else the last one. */
export const rollingTarget = (days: readonly DayKey[], anchor: DayKey): DayKey | null => days.find((d) => d >= anchor) ?? days.at(-1) ?? null
