/**
 * The calendar view's date rules (YAZ-4540, YAZ-949): which columns it can show by, the day a note
 * goes on, the value a move writes, and the month grid. No date library: `expr/dates.ts` and the
 * native `Date` (D4).
 */
import type { IndexRecord, PropertiesResponse } from '@shared/types'
import type { Row } from './engine'
import { columnTyping } from './editorType'
import { formatDate, parseIsoDate } from './expr/dates'
import type { FolderSettings } from './folderSettings'
import { writableKey } from './readOnlyRows'
import { allPropertyKeys } from './view/properties'
import type { ViewDef, ViewSet } from './viewSchema'

/** A day as the grid and a write name it: `YYYY-MM-DD`. */
export type DayKey = string

/**
 * The day a raw value goes on (S3): the date part AS WRITTEN, so a time or a time zone never moves
 * a card to another day — `2026-12-03T23:30Z` is Dec 3 wherever the Mac is. A JS `Date` (a YAML
 * 1.1 timestamp: a bare date parses as UTC midnight) goes on its UTC date. Anything else: no day.
 */
export function dayOf(raw: unknown): DayKey | null {
  if (typeof raw === 'string') return parseIsoDate(raw) === null ? null : raw.trim().slice(0, 10)
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw.toISOString().slice(0, 10)
  return null
}

/**
 * What a move to `day` writes (D4): `YYYY-MM-DD`, and the time the value had, kept as written —
 * zone included. A `Date` keeps its UTC time; one at UTC midnight is a bare date and stays one.
 */
export function movedDate(prevRaw: unknown, day: DayKey): string {
  if (typeof prevRaw === 'string' && parseIsoDate(prevRaw) !== null) return day + prevRaw.trim().slice(10)
  if (prevRaw instanceof Date && !Number.isNaN(prevRaw.getTime())) {
    const iso = prevRaw.toISOString()
    return iso.endsWith('T00:00:00.000Z') ? day : day + iso.slice(10)
  }
  return day
}

/** The `HH:mm` a card shows before its title, as written in the value; null when it has no time. */
export function timeOf(raw: unknown): string | null {
  if (typeof raw !== 'string' || parseIsoDate(raw) === null) return null
  const time = raw.trim().slice(11, 16)
  return time === '' ? null : time
}

/** The rows on each day, in row order, and the "No date" tray: one pass (the view memoizes it). */
export function bucketByDay(rows: readonly Row[], key: string | null): { days: Map<DayKey, Row[]>; undated: Row[] } {
  const days = new Map<DayKey, Row[]>()
  const undated: Row[] = []
  for (const row of rows) {
    const day = key === null ? null : dayOf(row.record.properties[key])
    if (day === null) undated.push(row)
    else {
      const list = days.get(day)
      if (list === undefined) days.set(day, [row])
      else list.push(row)
    }
  }
  return { days, undated }
}

/** The weeks of `month` (0-based) in `year`, Monday first (D11), each a row of 7 day keys. */
export function monthWeeks(year: number, month: number): DayKey[][] {
  const lead = (new Date(year, month, 1).getDay() + 6) % 7
  const count = Math.ceil((lead + new Date(year, month + 1, 0).getDate()) / 7)
  return Array.from({ length: count }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => formatDate(new Date(year, month, 1 - lead + w * 7 + d).getTime(), 'YYYY-MM-DD')),
  )
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A day as a move's toast names it (YAZ-4541 S6): `Dec 9, 2026`. */
export const dayLabel = (day: DayKey): string => `${SHORT_MONTHS[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}, ${day.slice(0, 4)}`

/** Today, as a day key in local time: the day the grid rings (S7). */
export const todayKey = (): DayKey => formatDate(Date.now(), 'YYYY-MM-DD')

/**
 * Every column "Show by" offers (D4): a declared Date column, and a property whose values are ISO
 * dates. Canonical `note.x` keys, in the Properties order; a key a view may not write is left out.
 */
export function dateColumns(
  def: ViewSet,
  view: ViewDef,
  records: readonly IndexRecord[],
  properties: PropertiesResponse | null | undefined,
  settings: FolderSettings,
): string[] {
  return allPropertyKeys(def, view, records, settings.columns).flatMap((key) => {
    const bare = writableKey(key)
    const typing = columnTyping(key, records, properties, settings)
    if (bare === null || typing === null) return []
    return (typing.assigned ?? typing.dominant) === 'date' ? [`note.${bare}`] : []
  })
}

/** The bare key a calendar shows by: its own `dateProperty`, else the first date column; null = none. */
export function calendarDateKey(view: ViewDef, columns: readonly string[]): string | null {
  const chosen = typeof view.dateProperty === 'string' ? view.dateProperty : columns[0]
  return chosen === undefined ? null : writableKey(chosen)
}
