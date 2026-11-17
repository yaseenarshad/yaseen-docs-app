/**
 * The daily page's name (YAZ-3607 D4): a style of tokens, read on the Mac's own day (local time). `[text]` stays as
 * typed, so `[Daily] YYYY-MM-DD` is "Daily 2026-10-28" and `MM_DD- ddd` is "10_16- Fri".
 */

/** The ready styles of Settings › Files & Links › Daily pages › Name style, in order. "Custom…" is any other style. */
export const DAILY_PAGE_STYLES = ['YYYY-MM-DD', 'MM_DD', 'MMM D, YYYY', 'YYYY-MM-DD ddd'] as const
export { DEFAULT_DAILY_PAGE_FORMAT } from './dailyPageDefault'

/** The tokens, for the custom style's hint: what each one gives on Friday 16 October 2026. */
export const DAILY_PAGE_TOKENS: ReadonlyArray<{ token: string; example: string }> = [
  { token: 'YYYY', example: '2026' },
  { token: 'MMMM', example: 'October' },
  { token: 'MMM', example: 'Oct' },
  { token: 'MM', example: '10' },
  { token: 'M', example: '10' },
  { token: 'DD', example: '16' },
  { token: 'D', example: '16' },
  { token: 'dddd', example: 'Friday' },
  { token: 'ddd', example: 'Fri' },
]

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
/** Longest first, so `MMMM` is never read as `MM` twice. A `[…]` run is literal text. */
const TOKENS = /\[[^\]]*\]|YYYY|MMMM|MMM|MM|M|dddd|ddd|DD|D/g

/** The name of `day`'s page in `format`. Text that is no token stays as it is. */
export function dailyPageName(format: string, day: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const value: Record<string, string> = {
    YYYY: String(day.getFullYear()),
    MMMM: MONTHS[day.getMonth()],
    MMM: MONTHS[day.getMonth()].slice(0, 3),
    MM: p(day.getMonth() + 1),
    M: String(day.getMonth() + 1),
    dddd: DAYS[day.getDay()],
    ddd: DAYS[day.getDay()].slice(0, 3),
    DD: p(day.getDate()),
    D: String(day.getDate()),
  }
  return format.replace(TOKENS, (t) => (t.startsWith('[') ? t.slice(1, -1) : value[t]))
}

/**
 * Why `format` cannot be a style, or null when it can. It must name a new page each day (a `D` or `DD`), and a file
 * must be able to hold the name: not empty, no `/`, no NUL, and no leading `.` (a hidden file, the `newPageFolder` rule).
 */
export function dailyPageFormatProblem(format: string): string | null {
  if (!(format.match(TOKENS) ?? []).some((t) => t === 'D' || t === 'DD')) return 'Add D or DD, so each day gets its own page'
  const name = dailyPageName(format, new Date(2000, 0, 1)).trim()
  if (name === '') return 'The name is empty'
  if (name.includes('/')) return 'A name cannot contain "/"'
  if (name.includes('\0')) return 'The name contains an invalid character'
  if (name.startsWith('.')) return 'Names starting with "." are hidden'
  return null
}

export const isValidDailyPageFormat = (format: string): boolean => dailyPageFormatProblem(format) === null

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const SHORT = (names: readonly string[]) => names.map((n) => n.slice(0, 3))
/** What each token matches in a name, the other way round from `dailyPageName`. */
const TOKEN_RE: Record<string, string> = {
  YYYY: '(\\d{4})',
  MMMM: `(${MONTHS.join('|')})`,
  MMM: `(${SHORT(MONTHS).join('|')})`,
  MM: '(\\d{2})',
  M: '(\\d{1,2})',
  dddd: `(${DAYS.join('|')})`,
  ddd: `(${SHORT(DAYS).join('|')})`,
  DD: '(\\d{2})',
  D: '(\\d{1,2})',
}

/**
 * The day a daily page's name stands for (YAZ-5470: the phone's Today button finds the latest daily page by the date in
 * its name, never by the file's time), or null when `name` is not a name of `format`. A style with no year
 * (`MM_DD- ddd`) is read as the latest such day on or before `today`; its weekday, when the style has one, picks the
 * year (up to 7 years back).
 */
export function dailyPageDate(format: string, name: string, today: Date): Date | null {
  const tokens: string[] = []
  let source = ''
  let at = 0
  const style = format.trim()
  for (const m of style.matchAll(TOKENS)) {
    source += escapeRe(style.slice(at, m.index))
    at = m.index + m[0].length
    if (m[0].startsWith('[')) source += escapeRe(m[0].slice(1, -1))
    else (tokens.push(m[0]), (source += TOKEN_RE[m[0]]))
  }
  source += escapeRe(style.slice(at))
  const found = new RegExp(`^${source}$`, 'i').exec(name.trim())
  if (found === null) return null
  let year: number | null = null
  let month: number | null = null
  let date: number | null = null
  let weekday: number | null = null
  const index = (names: readonly string[], v: string) => names.findIndex((n) => n.toLowerCase() === v.toLowerCase())
  tokens.forEach((t, i) => {
    const v = found[i + 1]
    if (t === 'YYYY') year = Number(v)
    else if (t === 'MMMM') month = index(MONTHS, v)
    else if (t === 'MMM') month = index(SHORT(MONTHS), v)
    else if (t === 'MM' || t === 'M') month = Number(v) - 1
    else if (t === 'dddd') weekday = index(DAYS, v)
    else if (t === 'ddd') weekday = index(SHORT(DAYS), v)
    else date = Number(v)
  })
  if (month === null || date === null) return null
  const real = (y: number): Date | null => {
    const d = new Date(y, month!, date!)
    return d.getFullYear() === y && d.getMonth() === month && d.getDate() === date ? d : null
  }
  if (year !== null) return real(year)
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).getTime()
  for (let y = today.getFullYear(); y >= today.getFullYear() - 7; y--) {
    const d = real(y)
    if (d !== null && d.getTime() < end && (weekday === null || d.getDay() === weekday)) return d
  }
  return null
}
