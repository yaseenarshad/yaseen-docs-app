/**
 * Times of day in a calendar table (YAZ-4162, YAZ-4159 D1 / D2): `readTime` reads column A's text. Shared, because
 * the time format setting (YAZ-4163, D15) must refuse a style that it cannot read back, and the main process checks
 * the stored setting too.
 */

/**
 * Minutes from midnight of a time of day, or `null`: `9:00 am`, `9:00am`, `9am`, `930am`, `9:00 AM` (12-hour, with
 * am / pm; the colon may go, the YAZ-4163 demo), `09:00` and `21:30` (24-hour, the colon and the minutes needed). A bare
 * number is no time (`9`, `930`), so a column of numbers is not one.
 */
export function readTime(text: string): number | null {
  const match = /^(\d{1,2})(?:(:)?([0-5]\d))?\s*(?:([ap])m)?$/i.exec(text.trim())
  if (match === null) return null
  const [, h, colon, mm, ap] = match
  const hour = Number(h)
  const minute = mm === undefined ? 0 : Number(mm)
  if (ap === undefined) return colon === undefined || hour > 23 ? null : hour * 60 + minute
  if (hour < 1 || hour > 12) return null
  return ((hour % 12) + (ap.toLowerCase() === 'p' ? 12 : 0)) * 60 + minute
}

/**
 * The time format (YAZ-4163, D15): the style new times are written in — a new calendar table, a new row in a table
 * with no times, and "Current time" (/time). A table with times keeps its own style (`detectTimeFormat`). Tokens:
 * `H` / `HH` the hour 0–23 (`HH` with a leading zero), `h` / `hh` the hour 1–12, `mm` the minutes, `a` / `A` am / AM;
 * `[text]` stays as typed; `(…)` shows only when the minutes are not 00, so `h(:mm)a` gives `9am` and `9:30am` (the
 * YAZ-4163 demo). The ready styles of Settings › Editor › Calendar tables › Time format, in order; "Custom…" is any other.
 */
export const TIME_FORMAT_STYLES = ['h:mm a', 'h:mma', 'h(:mm)a', 'HH:mm'] as const
/** `9:05 am`: Yaseen's own planning tables write times this way, and the approved settings picture shows it first (YAZ-4159 D15). */
export const DEFAULT_TIME_FORMAT = 'h:mm a'

/**
 * Settings › Editor › Calendar tables › Calendar day (YAZ-4163 demo): the first and the last time of a new calendar table, in
 * minutes from midnight, on the half hour. 5:00 am to 10:00 pm by default (Yaseen's call in the demo).
 */
export const DEFAULT_CALENDAR_DAY = { start: 5 * 60, end: 22 * 60 } as const

/** A time the Calendar day setting takes: a half hour from 12:00 am to 11:30 pm. */
export const isCalendarDayTime = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 24 * 60 && v % 30 === 0

/** The tokens, for the custom style's hint: what each one gives at 9:05 pm. */
export const TIME_TOKENS: ReadonlyArray<{ token: string; example: string }> = [
  { token: 'H', example: '21' },
  { token: 'HH', example: '21' },
  { token: 'h', example: '9' },
  { token: 'hh', example: '09' },
  { token: 'mm', example: '05' },
  { token: 'a', example: 'pm' },
  { token: 'A', example: 'PM' },
]

/** Longest first. A `[…]` run is literal text; a `(…)` run shows only when the minutes are not 00. */
const TIME_TOKEN = /\[[^\]]*\]|\([^)]*\)|HH|H|hh|h|mm|a|A/g

/** The tokens of `format`, those inside a `(…)` run too. */
const tokensOf = (format: string): string[] => (format.match(TIME_TOKEN) ?? []).flatMap((t) => (t.startsWith('(') ? tokensOf(t.slice(1, -1)) : [t]))

/** `minutes` from midnight (any day: 1500 is 1:00 am) in `format`. */
export function formatTime(format: string, minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440
  const hour = Math.floor(m / 60)
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  const p = (n: number) => String(n).padStart(2, '0')
  const value: Record<string, string> = {
    HH: p(hour),
    H: String(hour),
    hh: p(h12),
    h: String(h12),
    mm: p(m % 60),
    a: hour < 12 ? 'am' : 'pm',
    A: hour < 12 ? 'AM' : 'PM',
  }
  return format.replace(TIME_TOKEN, (t) => (t.startsWith('[') ? t.slice(1, -1) : t.startsWith('(') ? (m % 60 === 0 ? '' : formatTime(t.slice(1, -1), m)) : value[t]))
}

/** The times a style must read back: midnight, a morning, noon, after noon, the evening, the last minute. */
const CHECK_TIMES = [0, 5, 545, 720, 750, 1290, 1439]

/** Why `format` cannot be the time format, or null when it can: `readTime` must read each time back as written. */
export function timeFormatProblem(format: string): string | null {
  const tokens = tokensOf(format)
  if (!tokens.some((t) => /^[Hh]{1,2}$/.test(t)) || !tokens.includes('mm')) return 'Add the hour (H, HH, h or hh) and the minutes (mm)'
  if (tokens.some((t) => /^h{1,2}$/.test(t)) && !tokens.some((t) => t === 'a' || t === 'A')) return 'With h or hh, add a or A for am and pm'
  if (CHECK_TIMES.some((t) => readTime(formatTime(format, t)) !== t)) return 'The app cannot read this time back. Keep only the hour, a ":", the minutes and am / pm (24-hour needs the ":")'
  return null
}

export const isValidTimeFormat = (format: string): boolean => timeFormatProblem(format) === null

/**
 * The style of `texts` (column A of a table, in order), or `null` when none reads as a time: the first time decides
 * 12-hour (`h:mm a`, `h:mma`, `hh:mm a`, upper case `A`) or 24-hour; a 24-hour hour below 10 decides `H` or `HH` (no
 * such hour: `HH`). In 12-hour, a time with no minutes (`9am`) makes them `(…)`, and minutes with no colon (`930am`)
 * drop it (the YAZ-4163 demo): `9am, 9:30am` is `h(:mm)a`, `9am, 930am` is `h(mm)a`, `930am` is `hmma`.
 */
export function detectTimeFormat(texts: readonly string[]): string | null {
  const times = texts.map((text) => text.trim()).filter((text) => readTime(text) !== null)
  const first = times[0]
  if (first === undefined) return null
  const TWELVE = /^(\d{1,2})(?:(:?)(\d{2}))?(\s*)([ap])m$/i
  const twelve = TWELVE.exec(first)
  if (twelve !== null) {
    const [, hour, , , space, ap] = twelve
    const all = times.map((text) => TWELVE.exec(text)).filter((match) => match !== null)
    const minutes = all.some((match) => match[3] !== undefined && match[2] === '') ? 'mm' : ':mm'
    const optional = all.some((match) => match[3] === undefined)
    return `${hour.length === 2 && hour.startsWith('0') ? 'hh' : 'h'}${optional ? `(${minutes})` : minutes}${space === '' ? '' : ' '}${ap === ap.toLowerCase() ? 'a' : 'A'}`
  }
  const low = times.map((text) => /^(\d{1,2}):\d{2}$/.exec(text)?.[1]).find((hour) => hour !== undefined && Number(hour) < 10)
  return low !== undefined && low.length === 1 ? 'H:mm' : 'HH:mm'
}
