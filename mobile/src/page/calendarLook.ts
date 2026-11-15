import type { TableDimPast, TableNowMark } from '@shared/types'

/**
 * THE LOOK OF A CALENDAR TABLE ON THE PHONE. On the Mac these are app settings (Settings › Editor › Calendar
 * tables; `shared/types.ts`): Mark the current time (`tableNowMark`), Now button (`tableNowButton`), Dim past rows
 * (`tableDimPast`), Shade darkness (`tableShadeDarkness`) and Calendar day (`tableDayStart`, `tableDayEnd`). The phone
 * has no settings for them: it uses the Mac's DEFAULTS, read here and only here (`tableCalendar.ts` asks this function).
 * YAZ-5487 moves them into the vault (a settings file); that file's values then come in as `from`, each one checked,
 * and a value that is missing or wrong falls back to the Mac's default.
 *
 * The Calendar day is not part of the drawing on the Mac either: it is where a NEW calendar table starts and ends ("Fill
 * the calendar day"). The phone never makes a table, so it only carries it, for the day it does.
 */
export interface CalendarLook {
  nowMark: TableNowMark
  nowButton: boolean
  dimPast: TableDimPast
  /** The past rows' shade, a percent of the text colour (`TABLE_SHADE_MIN`..`MAX`, steps of `TABLE_SHADE_STEP`). */
  shadeDarkness: number
  /** Minutes from midnight, on the half hour. */
  dayStart: number
  dayEnd: number
  /** YAZ-5541, Shade the next time slot: the row after the now row gets `table-next-row`, a tint at the now tint's strength. */
  nextShade: boolean
  /** Its colour as CSS (`nextColour` of the vault's `tableNextColour`), or null for the now mark's red. */
  nextColour: string | null
}

/** The Mac's defaults (`DEFAULT_SETTINGS` in `shared/types.ts`; `calendarLook.test.ts` holds them equal). */
export const MAC_CALENDAR_LOOK: Readonly<CalendarLook> = Object.freeze({
  nowMark: 'line',
  nowButton: true,
  dimPast: 'shade',
  shadeDarkness: 6,
  dayStart: 5 * 60,
  dayEnd: 22 * 60,
  nextShade: false,
  nextColour: null,
})

/** The Mac's bounds of Shade darkness (`TABLE_SHADE_MIN`, `TABLE_SHADE_MAX`). */
export const SHADE_MIN = 2
export const SHADE_MAX = 30

const NOW_MARKS: readonly unknown[] = ['line', 'tint', 'both']
const DIM_PASTS: readonly unknown[] = ['off', 'text', 'shade']
const halfHour = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1440 && v % 30 === 0

/** The calendar look: the Mac's defaults, or what `from` (later: the vault's settings file) says, each value checked. */
export function calendarLook(from: Partial<Record<keyof CalendarLook, unknown>> | null = null): CalendarLook {
  const d = MAC_CALENDAR_LOOK
  if (from === null) return { ...d }
  const shade = from.shadeDarkness
  const start = halfHour(from.dayStart) ? from.dayStart : d.dayStart
  const end = halfHour(from.dayEnd) ? from.dayEnd : d.dayEnd
  // The Mac: a start not before the end is the default day.
  const day = start < end ? { dayStart: start, dayEnd: end } : { dayStart: d.dayStart, dayEnd: d.dayEnd }
  return {
    nowMark: NOW_MARKS.includes(from.nowMark) ? (from.nowMark as TableNowMark) : d.nowMark,
    nowButton: typeof from.nowButton === 'boolean' ? from.nowButton : d.nowButton,
    dimPast: DIM_PASTS.includes(from.dimPast) ? (from.dimPast as TableDimPast) : d.dimPast,
    shadeDarkness: typeof shade === 'number' && Number.isFinite(shade) ? Math.min(SHADE_MAX, Math.max(SHADE_MIN, Math.round(shade))) : d.shadeDarkness,
    ...day,
    nextShade: typeof from.nextShade === 'boolean' ? from.nextShade : d.nextShade,
    nextColour: typeof from.nextColour === 'string' && from.nextColour !== '' ? from.nextColour : d.nextColour,
  }
}
