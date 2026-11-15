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
    if (now !== undefined) return { row: now.row, fraction: (at - now.start) / (now.end - now.start), pastEnd: now.row }
  }
  const next = slots.find(({ start }) => start > minutes)
  return { row: null, fraction: 0, pastEnd: next?.row ?? times.length }
}
