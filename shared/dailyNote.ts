/**
 * The daily note's name (YAZ-3607 D4): a style of tokens, read on the Mac's own day (local time). `[text]` stays as
 * typed, so `[Daily] YYYY-MM-DD` is "Daily 2026-10-28" and `MM_DD- ddd` is "10_16- Fri".
 */

/** The ready styles of Settings › Files & Links › Daily notes › Name style, in order. "Custom…" is any other style. */
export const DAILY_NOTE_STYLES = ['YYYY-MM-DD', 'MM_DD', 'MMM D, YYYY', 'YYYY-MM-DD ddd'] as const
export const DEFAULT_DAILY_NOTE_FORMAT = 'YYYY-MM-DD'

/** The tokens, for the custom style's hint: what each one gives on Friday 16 October 2026. */
export const DAILY_NOTE_TOKENS: ReadonlyArray<{ token: string; example: string }> = [
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

/** The name of `day`'s note in `format`. Text that is no token stays as it is. */
export function dailyNoteName(format: string, day: Date): string {
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
 * Why `format` cannot be a style, or null when it can. It must name a new note each day (a `D` or `DD`), and a file
 * must be able to hold the name: not empty, no `/`, no NUL, and no leading `.` (a hidden file, the `newNoteFolder` rule).
 */
export function dailyNoteFormatProblem(format: string): string | null {
  if (!(format.match(TOKENS) ?? []).some((t) => t === 'D' || t === 'DD')) return 'Add D or DD, so each day gets its own note'
  const name = dailyNoteName(format, new Date(2000, 0, 1)).trim()
  if (name === '') return 'The name is empty'
  if (name.includes('/')) return 'A name cannot contain "/"'
  if (name.includes('\0')) return 'The name contains an invalid character'
  if (name.startsWith('.')) return 'Names starting with "." are hidden'
  return null
}

export const isValidDailyNoteFormat = (format: string): boolean => dailyNoteFormatProblem(format) === null
