/**
 * Permanent page creation date (YAZ-6150, YAZ-6165): frontmatter `created:` holds a UTC ISO 8601
 * timestamp (`cardTime(ms)`) stamped when a page is created or duplicated in an ID vault.
 * On read, any valid ISO 8601 timestamp, `YYYY-MM-DD` date, or `Date` object is accepted, with
 * real calendar-day validation so impossible dates like `2026-02-30` return null.
 */
export const CREATED_KEY = 'created'

const DATE_ONLY_RE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const ISO_TIME_RE =
  /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])[T ]([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d+))?)?(Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)?$/i

function isRealCalendarDay(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

/**
 * Parses a frontmatter `created` value (or card `created` ISO string) into epoch milliseconds,
 * or null when absent, wrong type, malformed, or not a real calendar day (`2026-02-30`).
 */
export function parseCreatedMs(value: unknown): number | null {
  if (value instanceof Date) {
    const ms = value.getTime()
    return Number.isFinite(ms) ? ms : null
  }
  if (typeof value !== 'string') return null
  const s = value.trim()
  if (s === '') return null
  const dateOnly = DATE_ONLY_RE.exec(s)
  if (dateOnly !== null) {
    const y = Number(dateOnly[1])
    const m = Number(dateOnly[2])
    const d = Number(dateOnly[3])
    const dt = new Date(y, m - 1, d)
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? dt.getTime() : null
  }
  const iso = ISO_TIME_RE.exec(s)
  if (iso === null) return null
  const y = Number(iso[1])
  const m = Number(iso[2])
  const d = Number(iso[3])
  if (!isRealCalendarDay(y, m, d)) return null
  const normalized = s
    .replace(' ', 'T')
    .replace(/z$/, 'Z')
    .replace(/([+-]\d{2})(\d{2})$/, '$1:$2')
    .replace(/(\.\d{3})\d+/, '$1')
  const ms = Date.parse(normalized)
  return Number.isFinite(ms) ? ms : null
}
