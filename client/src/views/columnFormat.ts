/**
 * A Number or Date column's display format (YAZ-4591 S21/S22): `PropertyDecl.format`, saved in the
 * folder's column declaration. It changes what a cell SHOWS and nothing else — the stored value,
 * the editor's draft, sorting, grouping and filters all read the raw value.
 */
import type { PropertyFormat, PropertyKind } from '@shared/types'
import { isRecord } from '@shared/guards'
import { relativeDate, startOfDay } from './expr/dates'
import type { ViewSet } from './viewSchema'
import { canonicalKey } from './view/keys'

export const NUMBER_STYLES = ['plain', 'grouped', 'currency', 'percent'] as const
export const DATE_STYLES = ['iso', 'medium', 'relative', 'custom'] as const
/** The currencies the editor offers; the reader takes any three-letter code. */
export const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'INR', 'CHF', 'CNY'] as const
export const MAX_DECIMALS = 4
export const MAX_DATE_PATTERN = 64

/** Built-in date columns whose Format picker writes `def.properties[key].format` (YAZ-6167). */
export const BUILTIN_DATE_KEYS: ReadonlySet<string> = new Set([
  'file.ctime',
  'file.mtime',
  'card.created',
  'card.nextReview',
  'card.lastReview',
])

const stylesOf = (kind: PropertyKind): readonly string[] => (kind === 'number' ? NUMBER_STYLES : kind === 'date' ? DATE_STYLES : [])

/** Whether a format belongs on a column of `kind`: a kind switch drops one that does not (`declarationForKind`). */
export const formatFits = (kind: PropertyKind, format: PropertyFormat): boolean => stylesOf(kind).includes(format.style)

/**
 * Read a saved date format off `def.properties[key]` (YAZ-6167), validating style and pattern so hand-edited
 * YAML in `properties` or `cardView.properties` never throws.
 */
export function propertyFormatOf(properties: ViewSet['properties'], key: string): PropertyFormat | undefined {
  if (properties === undefined) return undefined
  const c = canonicalKey(key)
  const raw = properties[c]?.format ?? properties[key]?.format
  if (!isRecord(raw) || typeof raw.style !== 'string' || !(DATE_STYLES as readonly string[]).includes(raw.style)) return undefined
  const out: PropertyFormat = { style: raw.style as PropertyFormat['style'] }
  if (out.style === 'custom' && typeof raw.pattern === 'string' && raw.pattern.trim() !== '' && raw.pattern.length <= MAX_DATE_PATTERN) {
    out.pattern = raw.pattern
  }
  return out
}

/**
 * Set or clear a built-in date column's display format on `d.properties[key]` (YAZ-6167).
 * Preserves `displayName`; deletes empty entries and an empty `properties` map (YAML default-deletes rule).
 */
export function setPropertyFormat(d: ViewSet, key: string, format: PropertyFormat | undefined): void {
  const k = canonicalKey(key)
  const props = { ...d.properties }
  const entry = { ...props[k] }
  if (format === undefined || format.style === 'iso') delete entry.format
  else entry.format = format
  if (Object.keys(entry).length) props[k] = entry
  else delete props[k]
  if (Object.keys(props).length) d.properties = props
  else delete d.properties
}

/**
 * `columns.<name>.format`, tolerant like the rest of `readColumns`: a bad map, a style the kind does
 * not have, or a bad `decimals` / `currency` / `pattern` is one problem line and that part is dropped.
 */
export function readFormat(kind: PropertyKind, raw: unknown, problems: string[], at: string): PropertyFormat | undefined {
  if (!isRecord(raw) || typeof raw.style !== 'string' || !stylesOf(kind).includes(raw.style)) {
    problems.push(`${at} is not a format a ${kind} column has — ignoring it`)
    return undefined
  }
  const format: PropertyFormat = { style: raw.style as PropertyFormat['style'] }
  if (raw.decimals !== undefined) {
    if (kind === 'number' && Number.isInteger(raw.decimals) && (raw.decimals as number) >= 0 && (raw.decimals as number) <= MAX_DECIMALS) format.decimals = raw.decimals as number
    else problems.push(`${at}.decimals must be a whole number from 0 to ${MAX_DECIMALS} — ignoring it`)
  }
  if (raw.currency !== undefined) {
    if (format.style === 'currency' && typeof raw.currency === 'string' && /^[A-Z]{3}$/.test(raw.currency)) format.currency = raw.currency
    else problems.push(`${at}.currency must be a three-letter currency code on a currency format — ignoring it`)
  }
  if (raw.pattern !== undefined) {
    if (format.style === 'custom' && typeof raw.pattern === 'string' && raw.pattern.trim() !== '' && raw.pattern.length <= MAX_DATE_PATTERN) format.pattern = raw.pattern
    else problems.push(`${at}.pattern must be non-empty text (up to ${MAX_DATE_PATTERN} characters) on a custom date format — ignoring it`)
  }
  return format
}

/** One `Intl.NumberFormat` per distinct format: the choices are few, and the cap keeps a hand-edited file from growing it. */
const numberFormats = new Map<string, Intl.NumberFormat>()
const MAX_NUMBER_FORMATS = 64

function numberFormat(format: PropertyFormat): Intl.NumberFormat {
  const id = `${format.style}|${format.decimals ?? ''}|${format.currency ?? ''}`
  let nf = numberFormats.get(id)
  if (nf !== undefined) return nf
  const digits = format.decimals === undefined ? {} : { minimumFractionDigits: format.decimals, maximumFractionDigits: format.decimals }
  nf = new Intl.NumberFormat('en-US', {
    ...(format.style === 'currency' ? { style: 'currency', currency: format.currency ?? 'USD' } : format.style === 'percent' ? { style: 'percent' } : {}),
    useGrouping: format.style !== 'plain',
    ...digits,
  })
  if (numberFormats.size >= MAX_NUMBER_FORMATS) numberFormats.clear()
  numberFormats.set(id, nf)
  return nf
}

/** A number as its column shows it. Plain with no decimals is the number as stored, as before; percent is Intl's (0.25 → 25%). */
export function formatNumber(n: number, format: PropertyFormat): string {
  if (format.style === 'plain' && format.decimals === undefined) return String(n)
  return numberFormat(format).format(n)
}

const MEDIUM_DATE = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' })
const MEDIUM_DATE_TIME = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' })
const DAY = 86_400_000

const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n))

type DateTokenFn = (d: Date) => string
type DateSegment = string | DateTokenFn

const DATE_TOKENS: Readonly<Record<string, DateTokenFn>> = {
  YYYY: (d) => String(d.getFullYear()).padStart(4, '0'),
  YY: (d) => pad2(((d.getFullYear() % 100) + 100) % 100),
  MMMM: (d) => MONTHS_LONG[d.getMonth()],
  MMM: (d) => MONTHS_SHORT[d.getMonth()],
  MM: (d) => pad2(d.getMonth() + 1),
  M: (d) => String(d.getMonth() + 1),
  DD: (d) => pad2(d.getDate()),
  D: (d) => String(d.getDate()),
  dddd: (d) => DAYS_LONG[d.getDay()],
  ddd: (d) => DAYS_SHORT[d.getDay()],
  HH: (d) => pad2(d.getHours()),
  H: (d) => String(d.getHours()),
  hh: (d) => pad2(d.getHours() % 12 || 12),
  h: (d) => String(d.getHours() % 12 || 12),
  mm: (d) => pad2(d.getMinutes()),
  ss: (d) => pad2(d.getSeconds()),
  A: (d) => (d.getHours() < 12 ? 'AM' : 'PM'),
  a: (d) => (d.getHours() < 12 ? 'am' : 'pm'),
}

const CUSTOM_DATE_RE = /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|H|hh|h|mm|ss|A|a/g
const customDateFormats = new Map<string, readonly DateSegment[]>()
const MAX_CUSTOM_DATE_FORMATS = 64

function compileDatePattern(pattern: string): readonly DateSegment[] {
  let compiled = customDateFormats.get(pattern)
  if (compiled !== undefined) return compiled
  const segments: DateSegment[] = []
  let last = 0
  CUSTOM_DATE_RE.lastIndex = 0
  for (let m = CUSTOM_DATE_RE.exec(pattern); m !== null; m = CUSTOM_DATE_RE.exec(pattern)) {
    if (m.index > last) segments.push(pattern.slice(last, m.index))
    if (m[1] !== undefined) segments.push(m[1])
    else segments.push(DATE_TOKENS[m[0]])
    last = m.index + m[0].length
  }
  if (last < pattern.length) segments.push(pattern.slice(last))
  if (customDateFormats.size >= MAX_CUSTOM_DATE_FORMATS) customDateFormats.clear()
  customDateFormats.set(pattern, segments)
  return segments
}

/**
 * Format `ms` (local time) with a custom token pattern (YAZ-6167): supports `YYYY`, `YY`, `MMMM`, `MMM`,
 * `MM`, `M`, `DD`, `D`, `dddd`, `ddd`, `HH`, `H`, `hh`, `h`, `mm`, `ss`, `A`, `a`, and `[literal]`.
 * Patterns are pre-compiled once and cached (capped at 64 entries).
 */
export function formatCustomDate(ms: number, pattern: string): string {
  if (!Number.isFinite(ms)) return ''
  const d = new Date(ms)
  const segments = compileDatePattern(pattern)
  let out = ''
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    out += typeof seg === 'string' ? seg : seg(d)
  }
  return out
}

/**
 * A date as its column shows it, or null for ISO (the caller's own rendering). Relative counts
 * calendar days — today, tomorrow, yesterday, in 3 days — and a time today in hours or minutes
 * (`relativeDate` of `expr/dates.ts`); a week or more away is `relativeDate` from the start of today.
 */
export function formatDateValue(ms: number, hasTime: boolean, format: PropertyFormat, now = Date.now()): string | null {
  if (format.style === 'custom') return typeof format.pattern === 'string' && format.pattern.trim() !== '' ? formatCustomDate(ms, format.pattern) : null
  if (format.style === 'medium') return (hasTime ? MEDIUM_DATE_TIME : MEDIUM_DATE).format(ms)
  if (format.style !== 'relative') return null
  const today = startOfDay(now)
  const days = Math.round((startOfDay(ms) - today) / DAY)
  if (days === 0) return hasTime ? relativeDate(ms, now) : 'today'
  if (days === 1) return 'tomorrow'
  if (days === -1) return 'yesterday'
  if (Math.abs(days) < 7) return days > 0 ? `in ${days} days` : `${-days} days ago`
  return relativeDate(startOfDay(ms), today)
}
