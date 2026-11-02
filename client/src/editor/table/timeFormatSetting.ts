/**
 * Settings › Editor › Tables › Time format (YAZ-4163, YAZ-4159 D15), as the editor reads it: App writes it on each
 * change, and "/Calendar table", "Time slots" and "Current time" read it at the click. A tiny module, as
 * `code/languageHelpers.ts` is, so no editor rebuilds for a change.
 */
import { DEFAULT_CALENDAR_DAY, DEFAULT_TIME_FORMAT, isCalendarDayTime, isValidTimeFormat } from '@shared/timeFormat'

let current = DEFAULT_TIME_FORMAT

/** App's door: a style the reader cannot read back is the default. */
export function setTimeFormatSetting(format: string): void {
  current = isValidTimeFormat(format) ? format : DEFAULT_TIME_FORMAT
}

export const timeFormatSetting = (): string => current

let day: { start: number; end: number } = DEFAULT_CALENDAR_DAY

/**
 * Settings › Editor › Calendar tables › Calendar day (YAZ-4163 demo), App's door: "/Calendar table", "Time slots" on a
 * table with no times, and "Fill the calendar day" read it at the click. A day whose end is not after its start, or a
 * time off the half hour, is the default day.
 */
export function setCalendarDaySetting(start: number, end: number): void {
  day = isCalendarDayTime(start) && isCalendarDayTime(end) && start < end ? { start, end } : DEFAULT_CALENDAR_DAY
}

export const calendarDaySetting = (): { start: number; end: number } => day
