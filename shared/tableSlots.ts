import type { TableSlotTime } from './tableLook'
import { readTime } from './timeFormat'

/*
 * THE TIME SLOTS OF A CALENDAR TABLE (YAZ-4162), ONE rule for the Mac (`client/src/editor/table/tableCalendar.ts`, on a
 * ProseMirror table) and the phone (`mobile/src/page/tableCalendar.ts`, on the drawn table). Pure: column A's texts in,
 * times and the place of now out.
 *
 * A body row whose column A reads as a time starts a slot; the slot runs to the next row with a time, and the last one
 * is one slot length long. A row with no time has no slot. A time earlier than the one above it is on the next day
 * (`11:30 pm`, `12:00 am` run on). A row that a merged time cell covers has no time of its own (its text is `null` or
 * empty), so the merged cell is one slot as long as its rows.
 */

/** Minutes from midnight of `date`, local time. */
export const minutesOf = (date: Date): number => date.getHours() * 60 + date.getMinutes()

/** Where now is in a calendar table: its now row (an index of the table's rows, the header row 0), how far down its slot, and the first row that is not past. */
export interface NowPlace {
  row: number | null
  fraction: number
  /** The now row's slot, in minutes from today's midnight (YAZ-5602): its time, and the next row's time (one slot length on for the last row); 0 and 0 with no now row. */
  start: number
  end: number
  /** Body rows before this index are past. */
  pastEnd: number
}

/** Each row's time from the first day's midnight (a time earlier than the one above is a day on), or `null`; `texts[0]` is the header row's. */
export function rowTimes(texts: ReadonlyArray<string | null>): Array<number | null> {
  const out: Array<number | null> = []
  let day = 0
  let last = -1
  texts.forEach((text, r) => {
    if (r === 0) return void out.push(null)
    const time = text === null ? null : readTime(text)
    if (time !== null && time < last) day += 1440
    if (time !== null) last = time
    out.push(time === null ? null : time + day)
  })
  return out
}

/** Now among `times` (`rowTimes`) at `minutes` from midnight with slots `slot` long; `null` when there is no slot or no time. */
export function nowPlace(times: ReadonlyArray<number | null>, slot: number, minutes: number): NowPlace | null {
  if (!(slot > 0)) return null
  const starts = times.flatMap((start, row) => (row === 0 || start === null ? [] : [{ row, start }]))
  if (starts.length === 0) return null
  const slots = starts.map(({ row, start }, i) => ({ row, start, end: starts[i + 1]?.start ?? start + slot }))
  // Today's minute first, then the same minute tomorrow (a row after midnight).
  for (const at of [minutes, minutes + 1440]) {
    const now = slots.find(({ start, end }) => start <= at && at < end)
    if (now !== undefined) return { row: now.row, fraction: (at - now.start) / (now.end - now.start), pastEnd: now.row, start: now.start - (at - minutes), end: now.end - (at - minutes) }
  }
  const next = slots.find(({ start }) => start > minutes)
  return { row: null, fraction: 0, pastEnd: next?.row ?? times.length, start: 0, end: 0 }
}

/*
 * TIME IN SLOT (YAZ-5602, YAZ-5606): ONE copy of what the pill on the now line says, for the Mac (`tableCalendar.ts`,
 * the vault's `look.slotTime` and `look.slotSeconds`) and the phone (`mobile/src/page/tableCalendar.ts`).
 */

/** Two digits. */
const two = (n: number): string => String(n).padStart(2, '0')

/**
 * What the Time in slot pill says (YAZ-5602) for the slot `start`–`end` (minutes from today's midnight) at `seconds`
 * from today's midnight: the time left (`down`) or since the slot started (`up`), with seconds (`19:14 left`,
 * `1:19:14 left` from an hour) or in minutes (`20 min left`, `1 h 20 min left`). The count down rounds up, so the last
 * minute reads `1 min left`, never `0 min left`; the count up rounds down. Kept inside the slot.
 */
export function slotTimeLabel(mode: 'down' | 'up', withSeconds: boolean, start: number, end: number, seconds: number): string {
  const total = Math.max(0, Math.min((end - start) * 60, mode === 'down' ? end * 60 - seconds : seconds - start * 60))
  const word = mode === 'down' ? 'left' : 'in'
  if (withSeconds) {
    // A count down rounds up, as a timer does: 19:13.8 left reads 19:14; a count up rounds down.
    const s = mode === 'down' ? Math.ceil(total) : Math.floor(total)
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    return `${h > 0 ? `${h}:${two(m)}` : m}:${two(s % 60)} ${word}`
  }
  const mins = mode === 'down' ? Math.ceil(total / 60) : Math.floor(total / 60)
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${h > 0 ? `${h} h${m > 0 ? ` ${m} min` : ''}` : `${m} min`} ${word}`
}

/** Seconds from today's midnight, local time. */
export const secondsOf = (date: Date): number => date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds() + date.getMilliseconds() / 1000

/** The widest text of the pill in a slot `start`–`end`, in characters (its full length: a count down at the start, a count up at the end); 0 when off. */
export function slotPillChars(mode: TableSlotTime, withSeconds: boolean, start: number, end: number): number {
  if (mode === 'off') return 0
  return slotTimeLabel(mode, withSeconds, start, end, mode === 'down' ? start * 60 : end * 60).length
}

