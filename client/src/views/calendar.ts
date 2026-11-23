/**
 * The calendar view's date rules (YAZ-4540, YAZ-949): which columns it can show by, the day a page
 * goes on, the value a move writes, and the month grid. No date library: `expr/dates.ts` and the
 * native `Date` (D4).
 */
import { type ColorStrengthValue, type FolderPagesSettings, type IndexRecord, type PropertiesResponse, calLine, readColorStrength } from '@shared/types'
import type { Row } from './engine'
import { columnTyping } from './editorType'
import { formatDate, parseIsoDate, renderDate } from './expr/dates'
import type { FolderSettings } from './folderSettingsRead'
import { writableKey } from './readOnlyRows'
import { allPropertyKeys } from './view/properties'
import type { CalendarCardStyle, ViewDef, ViewSet } from './viewSchema'

/** The Calendar's scales (YAZ-4558 D22, YAZ-5588 Rolling) in the switch's order, with their words: the toolbar's switch and the View tab's "Opens in" share them. */
export type CalendarScale = FolderPagesSettings['calendarScale']
export const CALENDAR_SCALES: readonly (readonly [CalendarScale, string])[] = [
  ['month', 'Month'],
  ['week', 'Week'],
  ['rolling', 'Rolling'],
]
/** A view's scale as written (Settings' scale already filled in by the pane), Month for anything else. */
export const calendarScaleOf = (view: ViewDef): CalendarScale => CALENDAR_SCALES.find(([s]) => s === view.calendarScale)?.[0] ?? 'month'

/** A calendar's default card (pill) styles (YAZ-6331) in the switch's order, with their labels. */
export const CALENDAR_CARD_STYLES: readonly (readonly [CalendarCardStyle, string])[] = [
  ['accent', 'Soft Accent'],
  ['slate', 'Soft Slate'],
  ['bar', 'White + Bar'],
  ['plain', 'White'],
]
/** A view's default card style (Settings already filled in by the pane), Soft Accent (`accent`) for anything else. */
export const calendarCardStyleOf = (view: Pick<ViewDef, 'calendarCardStyle'>): CalendarCardStyle =>
  CALENDAR_CARD_STYLES.find(([s]) => s === view.calendarCardStyle)?.[0] ?? 'accent'

/** A calendar's default card colour and strength (YAZ-6344): stored `readColorStrength`, or `null` for the app's `--accent` at Light. */
export const calendarCardColorOf = (view: Pick<ViewDef, 'calendarCardColor'>): ColorStrengthValue | null => readColorStrength(view.calendarCardColor)

/**
 * The CSS custom properties for a calendar's default card colour and strength (YAZ-6344):
 * - Unset (`null`): `--accent` at Light (8% fill, 24% border, 48% hover border, solid `--accent` bar).
 * - Set (`ColorStrengthValue`): Fill Light 8% / Medium 14% / Strong 22%; Border 24% / 36% / 50%; Hover border 48% / 62% / 78%;
 *   accent swatch is `var(--fg-muted)` for `gray`, else `var(--table-fill-solid-<color>)`.
 */
export function calendarCardColorVars(value: ColorStrengthValue | null): Record<'--cal-card-accent' | '--cal-card-fill-wash' | '--cal-card-border-wash' | '--cal-card-hover-wash', string> {
  if (value === null) {
    return {
      '--cal-card-accent': 'var(--accent)',
      '--cal-card-fill-wash': '8%',
      '--cal-card-border-wash': '24%',
      '--cal-card-hover-wash': '48%',
    }
  }
  const accent = value.color === 'gray' ? 'var(--fg-muted)' : `var(--table-fill-solid-${value.color})`
  const fill = value.strength === 'light' ? '8%' : value.strength === 'medium' ? '14%' : '22%'
  const border = value.strength === 'light' ? '24%' : value.strength === 'medium' ? '36%' : '50%'
  const hover = value.strength === 'light' ? '48%' : value.strength === 'medium' ? '62%' : '78%'
  return {
    '--cal-card-accent': accent,
    '--cal-card-fill-wash': fill,
    '--cal-card-border-wash': border,
    '--cal-card-hover-wash': hover,
  }
}

/** A day as the grid and a write name it: `YYYY-MM-DD`. */
export type DayKey = string

/**
 * The day a raw value goes on (S3): the date part AS WRITTEN, so a time or a time zone never moves
 * a card to another day — `2026-12-03T23:30Z` is Dec 3 wherever the Mac is. A JS `Date` (a YAML
 * 1.1 timestamp: a bare date parses as UTC midnight) goes on its UTC date. Anything else: no day.
 * A date no calendar has, `2026-02-30`, is no day either (YAZ-4635 P6): it matches no grid day, so
 * its card goes to "No date" instead of nowhere. The check: the key reads back as itself.
 */
export function dayOf(raw: unknown): DayKey | null {
  if (typeof raw === 'string') {
    if (parseIsoDate(raw) === null) return null
    const key = raw.trim().slice(0, 10)
    return addDays(key, 0) === key ? key : null
  }
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

/**
 * The `HH:mm` a card shows before its title; null when the value has no time. It is the time the board and the table
 * show (`renderDate`, the app's local time, YAZ-4544): a value with a zone reads in the Mac's zone. Only the DAY keeps
 * the date part as written (`dayOf`, S3).
 */
export function timeOf(raw: unknown): string | null {
  const parsed = typeof raw === 'string' ? parseIsoDate(raw) : null
  return parsed === null || !parsed.hasTime ? null : renderDate(parsed.ms, true).slice(11, 16)
}

/** A card over several days (YAZ-4858): its row and its first and last day, `start < end`. */
export interface Span {
  row: Row
  start: DayKey
  end: DayKey
}

/**
 * A card's days (YAZ-4858): its start day and its end day (the `endKey` column's), the same day for a one-day card;
 * null for no day. A page with an end and no start goes on its end day (item 5); an end on or before the start is no
 * span, the card is a one-day card on its start.
 */
export function spanOf(properties: Readonly<Record<string, unknown>>, key: string | null, endKey: string | null): { start: DayKey; end: DayKey } | null {
  const start = key === null ? null : dayOf(properties[key])
  const end = endKey === null ? null : dayOf(properties[endKey])
  if (start === null) return end === null ? null : { start: end, end }
  return end !== null && end > start ? { start, end } : { start, end: start }
}

/** A card's days while one of its edges drags (YAZ-4858): `path` shows on `start`…`end` in place of its own. */
export interface SpanPreview {
  path: string
  start: DayKey
  end: DayKey
}

/**
 * The rows on each day, in row order, the cards over several days (`multi`, YAZ-4858, by their `endKey`), and the
 * "No date" tray: one pass (the view memoizes it). `preview` puts one card on the days an edge drag has reached.
 */
export function bucketByDay(rows: readonly Row[], key: string | null, endKey: string | null = null, preview: SpanPreview | null = null): { days: Map<DayKey, Row[]>; multi: Span[]; undated: Row[] } {
  const days = new Map<DayKey, Row[]>()
  const multi: Span[] = []
  const undated: Row[] = []
  for (const row of rows) {
    const span = preview?.path === row.record.path ? preview : endKey === null ? null : spanOf(row.record.properties, key, endKey)
    const day = span !== null ? span.start : key === null ? null : dayOf(row.record.properties[key])
    if (span !== null && span.end > span.start) multi.push({ row, start: span.start, end: span.end })
    else if (day === null) undated.push(row)
    else {
      const list = days.get(day)
      if (list === undefined) days.set(day, [row])
      else list.push(row)
    }
  }
  return { days, multi, undated }
}

/** A bar on one week row (YAZ-4858): its first column, how many columns it spans, its lane, and which ends the row cuts. */
export interface BarPlace {
  span: Span
  col: number
  cols: number
  lane: number
  /** The bar starts before this row's first shown day: that end is cut, square and with no edge. */
  cutStart: boolean
  /** The bar ends after this row's last shown day. */
  cutEnd: boolean
}

/**
 * The bars of one week row (YAZ-4858): each span that has a shown day in `days` (the row's days in order, with or
 * without its weekends), cut to those days, in lanes above the one-day cards. The bars take lanes one by one, each the
 * highest lane free over all its shown days on the row (a gap an earlier bar left is filled when a later bar fits it),
 * else a new lane; `bars` come in reading order (column, then lane). The order of placing (YAZ-5603): `sorted` (the view has a sort) = the rows' order, the view's sort, as the
 * one-day cards; else the bar that starts first, then the longer one, then row order. Pure.
 */
export function layoutWeek(days: readonly DayKey[], multi: readonly Span[], sorted = false): { bars: BarPlace[]; lanes: number } {
  const placed: Omit<BarPlace, 'lane'>[] = []
  if (days.length === 0) return { bars: [], lanes: 0 }
  const first = days[0]
  const last = days[days.length - 1]
  for (const span of multi) {
    if (span.end < first || span.start > last) continue
    const col = days.findIndex((d) => d >= span.start)
    let end = -1
    for (let i = days.length - 1; i >= 0; i--)
      if (days[i] <= span.end) {
        end = i
        break
      }
    if (col === -1 || end < col) continue
    placed.push({ span, col, cols: end - col + 1, cutStart: span.start < days[col], cutEnd: span.end > days[end] })
  }
  if (!sorted) placed.sort((a, b) => a.col - b.col || b.cols - a.cols)
  // Each lane's taken columns.
  const taken: boolean[][] = []
  const bars = placed.map((bar) => {
    const cols = Array.from({ length: bar.cols }, (_, i) => bar.col + i)
    let lane = taken.findIndex((used) => cols.every((c) => !used[c]))
    if (lane === -1) lane = taken.push(new Array<boolean>(days.length).fill(false)) - 1
    for (const c of cols) taken[lane][c] = true
    return { ...bar, lane }
  })
  // Reading order, for the DOM and the page window: by first column, then from the top lane.
  bars.sort((a, b) => a.col - b.col || a.lane - b.lane)
  return { bars, lanes: taken.length }
}

/** The days from `from` to `to` (negative when `to` is earlier): a bar's whole-card drag moves both its dates by it (YAZ-4858). */
export function daysBetween(from: DayKey, to: DayKey): number {
  return Math.round((localDay(to).getTime() - localDay(from).getTime()) / 86_400_000)
}

/**
 * A span as a move's question and toast name it (YAZ-4858): `Dec 3 – Dec 5` in this year (the question's chip cut the
 * year, YAZ-4866), else `Dec 3 – Dec 5, 2027`, and across two years each day with its year (`weekLabel`); one day as `dayLabel`.
 */
export function spanLabel(start: DayKey, end: DayKey): string {
  if (end <= start) return dayLabel(start)
  const year = String(new Date().getFullYear())
  return start.slice(0, 4) === year && end.slice(0, 4) === year ? `${monthDay(start)} – ${monthDay(end)}` : weekLabel([start, end])
}

/** A bar's hover (YAZ-5604 item 8): its days and how many, for example "Nov 12 – Nov 15 · 4 days". */
export function spanDays(start: DayKey, end: DayKey): string {
  const count = daysBetween(start, end) + 1
  return `${spanLabel(start, end)} · ${count} ${count === 1 ? 'day' : 'days'}`
}

/** The days from the week's first day to `date`: Monday first (D11), or Sunday first (Settings › Folder pages, YAZ-4585). */
const intoWeek = (date: Date, sundayFirst: boolean): number => (sundayFirst ? date.getDay() : (date.getDay() + 6) % 7)

/** The weeks of `month` (0-based) in `year`, Monday first (D11) unless `sundayFirst`, each a row of 7 day keys. */
export function monthWeeks(year: number, month: number, sundayFirst = false): DayKey[][] {
  const lead = intoWeek(new Date(year, month, 1), sundayFirst)
  const count = Math.ceil((lead + new Date(year, month + 1, 0).getDate()) / 7)
  return Array.from({ length: count }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => formatDate(new Date(year, month, 1 - lead + w * 7 + d).getTime(), 'YYYY-MM-DD')),
  )
}

/** A day key as a local `Date` at midnight, moved by `days` and `months`; `Date` rolls the overflow into the next month or year. */
const localDay = (day: DayKey, days = 0, months = 0): Date =>
  new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1 + months, Number(day.slice(8, 10)) + days)

/** The day `days` after `day` (before it when negative): the week view's ‹ › step 7 (YAZ-4558 D22). */
export const addDays = (day: DayKey, days: number): DayKey => formatDate(localDay(day, days).getTime(), 'YYYY-MM-DD')

/** The 1st of the month `months` after the month of `day`: the month grid's ‹ › (YAZ-4558 D22). */
export const monthStart = (day: DayKey, months: number): DayKey => formatDate(localDay(`${day.slice(0, 8)}01`, 0, months).getTime(), 'YYYY-MM-DD')

/** The same day `months` later (earlier when negative); a day the month does not have is its last day (Nov 30 for "Aug 31 + 3"). */
export function addMonths(day: DayKey, months: number): DayKey {
  const first = localDay(`${day.slice(0, 8)}01`, 0, months)
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  return formatDate(new Date(first.getFullYear(), first.getMonth(), Math.min(Number(day.slice(8, 10)), last)).getTime(), 'YYYY-MM-DD')
}

/** Months a Rolling calendar goes past its earliest and its latest dated card (YAZ-5609), and around today with none. */
export const ROLL_MARGIN_MONTHS = 3
export const ROLL_EMPTY_MONTHS = 12

/**
 * Rolling's ends (YAZ-5609): the first day of its first and of its last week. From the earliest dated day less
 * `ROLL_MARGIN_MONTHS` to the latest plus as many, or `ROLL_EMPTY_MONTHS` either side of today with no dated card;
 * today is always in.
 */
export function rollingEnds(dated: Iterable<DayKey>, today: DayKey, sundayFirst = false): { first: DayKey; last: DayKey } {
  let lo: DayKey | null = null
  let hi: DayKey | null = null
  for (const day of dated) {
    if (lo === null || day < lo) lo = day
    if (hi === null || day > hi) hi = day
  }
  const from = lo === null ? addMonths(today, -ROLL_EMPTY_MONTHS) : addMonths(lo, -ROLL_MARGIN_MONTHS)
  const to = hi === null ? addMonths(today, ROLL_EMPTY_MONTHS) : addMonths(hi, ROLL_MARGIN_MONTHS)
  return { first: weekDays(from < today ? from : today, sundayFirst)[0], last: weekDays(to > today ? to : today, sundayFirst)[0] }
}

/** A calendar's "Between months" width (YAZ-5608): its whole px 1–`MAX_CAL_LINE`, else 0 (Off, the default). */
export const monthLineOf = (view: Pick<ViewDef, 'monthLine'>): number => (view.monthLine === undefined ? 0 : calLine(view.monthLine) === view.monthLine ? view.monthLine : 0)
/** Its colour: the stored `blue light`, else Blue, Medium. */
export const monthLineColorOf = (view: Pick<ViewDef, 'monthLineColor'>): ColorStrengthValue => readColorStrength(view.monthLineColor) ?? { color: 'blue', strength: 'medium' }

/** Rolling's "Shade every other month" (YAZ-5608): every second month by its count from year 0, so the shade never moves as you scroll. */
export const shadedMonth = (day: DayKey): boolean => (Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) - 1) % 2 === 1

/** Rolling's alternating month shade colour and strength (YAZ-6331): stored `readColorStrength`, else Gray, Light. */
export const monthShadeColorOf = (view: Pick<ViewDef, 'monthShadeColor'>): ColorStrengthValue =>
  readColorStrength(view.monthShadeColor) ?? { color: 'gray', strength: 'light' }

/**
 * The CSS background for Rolling's alternating month shade (YAZ-6331):
 * - Gray: Light 2%, Medium 4%, Strong 7% of `--fg` over `--bg`.
 * - Other colours: Light 4%, Medium 8%, Strong 14% of `--table-fill-solid-<color>` over `--bg`.
 */
export function monthShadeCss({ color, strength }: ColorStrengthValue): string {
  if (color === 'gray') {
    const pct = strength === 'light' ? 2 : strength === 'medium' ? 4 : 7
    return `color-mix(in srgb, var(--fg) ${pct}%, var(--bg))`
  }
  const pct = strength === 'light' ? 4 : strength === 'medium' ? 8 : 14
  return `color-mix(in srgb, var(--table-fill-solid-${color}) ${pct}%, var(--bg))`
}

/**
 * Where "Between months" draws (YAZ-5608): a stepped line round each month's first days. A day whose day above (a week
 * earlier) is in another month has the line on its top; a day whose shown neighbour on the left is in another month
 * has it on its left. `left` is null in the first column.
 */
export function monthEdges(day: DayKey, left: DayKey | null): { top: boolean; left: boolean } {
  const month = day.slice(0, 7)
  return { top: addDays(day, -7).slice(0, 7) !== month, left: left !== null && left.slice(0, 7) !== month }
}

/** The 7 days, Monday first unless `sundayFirst` (YAZ-4585), of the week that holds `day` (YAZ-4558 D22). */
export function weekDays(day: DayKey, sundayFirst = false): DayKey[] {
  const first = addDays(day, -intoWeek(localDay(day), sundayFirst))
  return Array.from({ length: 7 }, (_, i) => addDays(first, i))
}

/** `Sat` or `Sun` for a weekend day, the mark its card wears on the Friday before (YAZ-4595 S33); null on a weekday. */
export function weekendOf(day: DayKey): 'Sat' | 'Sun' | null {
  const weekday = localDay(day).getDay()
  return weekday === 6 ? 'Sat' : weekday === 0 ? 'Sun' : null
}

/**
 * Whether `day` is the first SHOWN day of its month, the day that says the month (YAZ-5608): the 1st, or with Hide
 * weekends the first workday when the month starts on a Saturday or Sunday (YAZ-5648 #3).
 */
export function firstShownOfMonth(day: DayKey, hideWeekends: boolean): boolean {
  const date = Number(day.slice(8))
  if (date === 1) return true
  if (!hideWeekends || weekendOf(day) !== null) return false
  for (let d = 1; d < date; d++) if (weekendOf(`${day.slice(0, 8)}${String(d).padStart(2, '0')}`) === null) return false
  return true
}

/** "Hide weekends" (YAZ-4595 S33): the days of a week row without its Saturday and Sunday, by the weekday, not the column. */
export const withoutWeekends = (days: readonly DayKey[]): DayKey[] => days.filter((day) => weekendOf(day) === null)

/**
 * While weekends hide (YAZ-4595 S33): the weekend days each shown weekday of the grid takes, Saturday before Sunday.
 * One rule for the grid and the mini window's order (YAZ-4635 P3): a Saturday goes to the Friday before it; a Sunday
 * too, unless that Friday is off the grid — a Sunday-first grid opens on a Sunday — then to the Monday after it. So
 * every weekend card of the grid lands on a day that shows. `weeks` is the grid WITH its weekends.
 */
export function weekendHomes(weeks: readonly (readonly DayKey[])[]): Map<DayKey, DayKey[]> {
  const grid = new Set(weeks.flat())
  const homes = new Map<DayKey, DayKey[]>()
  for (const day of grid) {
    const weekend = weekendOf(day)
    if (weekend === null) continue
    const friday = addDays(day, weekend === 'Sat' ? -1 : -2)
    const home = grid.has(friday) ? friday : addDays(day, 1)
    const list = homes.get(home)
    if (list === undefined) homes.set(home, [day])
    else list.push(day)
  }
  return homes
}

/**
 * Settings › Folder pages › "Hide weekends" (YAZ-4595 S33): the default of a calendar with no `hideWeekends` key. The
 * one read of that setting, on the live `folderPages` that `ViewsPane` gets as a prop and hands on (`useViewDefaults`, YAZ-4585).
 */
export const hideWeekendsDefault = (folderPages: FolderPagesSettings): boolean => folderPages.hideWeekends

/** Whether a calendar hides its weekends (YAZ-4595 S33): its own `hideWeekends`, else the Settings default. */
export const hidesWeekends = (view: ViewDef, byDefault: boolean): boolean => (typeof view.hideWeekends === 'boolean' ? view.hideWeekends : byDefault)

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthDay = (day: DayKey): string => `${SHORT_MONTHS[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}`

/** A day as a move's toast names it (YAZ-4541 S6): `Dec 9, 2026`. */
export const dayLabel = (day: DayKey): string => `${monthDay(day)}, ${day.slice(0, 4)}`

/** A week's title (YAZ-4558 D22): `Nov 30 – Dec 6, 2026`; a week across two years names both. */
export function weekLabel(days: readonly DayKey[]): string {
  const first = days[0]
  const last = days[days.length - 1]
  return `${first.slice(0, 4) === last.slice(0, 4) ? monthDay(first) : dayLabel(first)} – ${dayLabel(last)}`
}

/**
 * A week day's cards (YAZ-4558 D22): the ones with a time first, in the order of the time they show
 * (`timeOf`, `HH:mm` sorts as text), then the rest in row order. The sort is stable, so equal times
 * keep the engine's order.
 */
export function timeFirst(rows: readonly Row[], key: string): Row[] {
  const timed: { row: Row; time: string }[] = []
  const rest: Row[] = []
  for (const row of rows) {
    const time = timeOf(row.record.properties[key])
    if (time === null) rest.push(row)
    else timed.push({ row, time })
  }
  timed.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0))
  return [...timed.map((t) => t.row), ...rest]
}

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
    const bare = writableKey(key, settings.columns)
    const typing = columnTyping(key, records, properties, settings)
    if (bare === null || typing === null) return []
    return (typing.assigned ?? typing.dominant) === 'date' ? [`note.${bare}`] : []
  })
}

/** A calendar's start column: its own `dateProperty`, else the first date column that is not its End date (YAZ-4866), else the first. */
export const calendarStartColumn = (view: ViewDef, columns: readonly string[]): string | undefined =>
  typeof view.dateProperty === 'string' ? view.dateProperty : (columns.find((key) => key !== view.endDateProperty) ?? columns[0])

/** The bare key a calendar shows by (`calendarStartColumn`); null = none. `decls`: the page's columns, so a Linked mentions column is never one. */
export function calendarDateKey(view: ViewDef, columns: readonly string[], decls: FolderSettings['columns']): string | null {
  const chosen = calendarStartColumn(view, columns)
  return chosen === undefined ? null : writableKey(chosen, decls)
}

/** The bare key of a calendar's End date (YAZ-4858): its own `endDateProperty`, never a default; null = none, or the start column itself. */
export function calendarEndKey(view: ViewDef, dateKey: string | null, decls: FolderSettings['columns']): string | null {
  if (typeof view.endDateProperty !== 'string') return null
  const key = writableKey(view.endDateProperty, decls)
  return key === dateKey ? null : key
}

/** A calendar line's colour (YAZ-4878): the stored `gray` / `blue light` (`readColorStrength`), else Gray, Medium: the app's line colour. */
export const calLineColor = (value: unknown): ColorStrengthValue => readColorStrength(value) ?? { color: 'gray', strength: 'medium' }

/**
 * The CSS colour a calendar line draws in (YAZ-4878). Gray is the app's line colour (`--border`): Medium is that line;
 * a Medium line wider than 1 px is a little darker, as the first build drew it; Light is half of it, Strong the darker
 * mix. A colour is its solid swatch at 35 %, 65 % or 100 %: a 1 px line needs more than a fill's wash to show. Black is
 * the same black in dark mode, as the header row's Black is (`table.css` has one `--table-fill-solid-black`).
 */
export function calLineCss({ color, strength }: ColorStrengthValue, width: number): string {
  if (color === 'gray') {
    if (strength === 'light') return 'color-mix(in srgb, var(--border) 50%, transparent)'
    return strength === 'strong' || width > 1 ? 'color-mix(in srgb, var(--border) 55%, var(--fg-muted))' : 'var(--border)'
  }
  const wash = strength === 'light' ? 35 : strength === 'medium' ? 65 : 100
  return `color-mix(in srgb, var(--table-fill-solid-${color}) ${wash}%, transparent)`
}
