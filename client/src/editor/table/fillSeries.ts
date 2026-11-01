/**
 * Fill down series rules (YAZ-3765, YAZ-3696 🔒 S4): the source cells' text, in order, and the
 * number of cells to fill give the new text. Pure; `tableFill.ts` calls it once per column (down)
 * or per row (right).
 *
 * - Two or more cells of one kind continue their step, (last − first) / (count − 1): numbers
 *   (decimals keep their places), times `h:mm` (`04:00` keeps its 0; past 23:59 wraps),
 *   ISO dates `YYYY-MM-DD` (the app's date format, `views/expr/dates.ts`; the step is in days).
 * - Dates (by a day; YAZ-3789), weekday and month names (full or 3-letter, in the last cell's case
 *   style) and text that ends in a number (`Week 1`; the digit count stays) continue from one cell, by 1.
 * - Anything else, a mix of kinds, or one number / time: the source cells repeat in order.
 */

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const DAY_MS = 86_400_000

type Value =
  | { kind: 'number'; n: number; places: number }
  | { kind: 'time'; n: number; padded: boolean }
  | { kind: 'date'; n: number }
  | { kind: 'weekday' | 'month'; n: number; short: boolean; caseOf: string }
  | { kind: 'trailing'; n: number; prefix: string; digits: number }
  | { kind: 'text'; n: 0 }

function read(text: string): Value {
  const s = text.trim()
  let m = /^-?\d+(?:\.(\d+))?$/.exec(s)
  if (m) return { kind: 'number', n: Number(s), places: m[1]?.length ?? 0 }
  m = /^(\d{1,2}):([0-5]\d)$/.exec(s)
  if (m && Number(m[1]) < 24) return { kind: 'time', n: Number(m[1]) * 60 + Number(m[2]), padded: m[1]!.startsWith('0') }
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (m) {
    const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    if (new Date(ms).toISOString().slice(0, 10) === s) return { kind: 'date', n: ms / DAY_MS }
  }
  const lower = s.toLowerCase()
  for (const [kind, names] of [['weekday', WEEKDAYS], ['month', MONTHS]] as const) {
    const full = names.indexOf(lower)
    const short = lower.length === 3 ? names.findIndex((name) => name.startsWith(lower)) : -1
    if (full >= 0 || short >= 0) return { kind, n: full >= 0 ? full : short, short: full < 0, caseOf: s }
  }
  m = /^(.*\D)(\d+)$/.exec(s)
  if (m) return { kind: 'trailing', n: Number(m[2]), prefix: m[1]!, digits: m[2]!.length }
  return { kind: 'text', n: 0 }
}

/** A name in the case style of `like`: UPPER, lower or Title. */
function inCase(name: string, like: string): string {
  if (like.length > 1 && like === like.toUpperCase()) return name.toUpperCase()
  if (like === like.toLowerCase()) return name
  return name[0]!.toUpperCase() + name.slice(1)
}

const placesOf = (n: number) => (String(Number(n.toFixed(10))).split('.')[1] ?? '').length

/** The `i`-th new value after `last`, `step` apart, in `last`'s style. */
function write(last: Value, step: number, i: number): string {
  const n = last.n + step * (i + 1)
  switch (last.kind) {
    case 'number':
      return n.toFixed(Math.max(last.places, placesOf(step)))
    case 'time': {
      const minutes = ((Math.round(n) % 1440) + 1440) % 1440
      const hour = String(Math.floor(minutes / 60))
      return `${last.padded ? hour.padStart(2, '0') : hour}:${String(minutes % 60).padStart(2, '0')}`
    }
    case 'date':
      return new Date(Math.round(n) * DAY_MS).toISOString().slice(0, 10)
    case 'weekday':
    case 'month': {
      const names = last.kind === 'weekday' ? WEEKDAYS : MONTHS
      const name = names[((Math.round(n) % names.length) + names.length) % names.length]!
      return inCase(last.short ? name.slice(0, 3) : name, last.caseOf)
    }
    case 'trailing':
      return last.prefix + String(Math.round(n)).padStart(last.digits, '0')
    case 'text':
      return ''
  }
}

export function fillSeries(source: string[], count: number): string[] {
  const values = source.map(read)
  const first = values[0]!
  const last = values.at(-1)!
  const sameKind = values.every((v) => v.kind === first.kind && (v.kind !== 'trailing' || first.kind !== 'trailing' || v.prefix === first.prefix))
  const series = sameKind && (values.length > 1 ? first.kind !== 'text' : first.kind === 'date' || first.kind === 'weekday' || first.kind === 'month' || first.kind === 'trailing')
  if (!series) return Array.from({ length: count }, (_, i) => source[i % source.length]!)
  const size = last.kind === 'weekday' ? 7 : last.kind === 'month' ? 12 : 0
  // A name's step goes forward around the week or the year: `Sun, Mon` is +1, not −6.
  const step = values.length < 2 ? 1 : size > 0 ? (((values[1]!.n - first.n) % size) + size) % size : (last.n - first.n) / (values.length - 1)
  return Array.from({ length: count }, (_, i) => write(last, step, i))
}
