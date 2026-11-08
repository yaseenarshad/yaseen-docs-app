/**
 * A Number or Date column's display format (YAZ-4591 S21/S22): `PropertyDecl.format`, saved in the
 * folder's column declaration. It changes what a cell SHOWS and nothing else — the stored value,
 * the editor's draft, sorting, grouping and filters all read the raw value.
 */
import type { PropertyFormat, PropertyKind } from '@shared/types'
import { isRecord } from '@shared/guards'
import { relativeDate, startOfDay } from './expr/dates'

export const NUMBER_STYLES = ['plain', 'grouped', 'currency', 'percent'] as const
export const DATE_STYLES = ['iso', 'medium', 'relative'] as const
/** The currencies the editor offers; the reader takes any three-letter code. */
export const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'INR', 'CHF', 'CNY'] as const
export const MAX_DECIMALS = 4

const stylesOf = (kind: PropertyKind): readonly string[] => (kind === 'number' ? NUMBER_STYLES : kind === 'date' ? DATE_STYLES : [])

/** Whether a format belongs on a column of `kind`: a kind switch drops one that does not (`declarationForKind`). */
export const formatFits = (kind: PropertyKind, format: PropertyFormat): boolean => stylesOf(kind).includes(format.style)

/**
 * `columns.<name>.format`, tolerant like the rest of `readColumns`: a bad map, a style the kind does
 * not have, or a bad `decimals` / `currency` is one problem line and that part is dropped.
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

/**
 * A date as its column shows it, or null for ISO (the caller's own rendering). Relative counts
 * calendar days — today, tomorrow, yesterday, in 3 days — and a time today in hours or minutes
 * (`relativeDate` of `expr/dates.ts`); a week or more away is `relativeDate` from the start of today.
 */
export function formatDateValue(ms: number, hasTime: boolean, format: PropertyFormat, now = Date.now()): string | null {
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
