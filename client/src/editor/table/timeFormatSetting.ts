/**
 * Settings › Tables › Calendar tables › Time format and Calendar day (YAZ-4163, YAZ-4159 D15, D19), as the editor reads them: App writes it on each
 * change, and "/Calendar table", "Time slots" and "Current time" read it at the click. A tiny module, as
 * `code/languageHelpers.ts` is, so no editor rebuilds for a change.
 */
import { DEFAULT_CALENDAR_DAY, DEFAULT_TIME_FORMAT, isCalendarDayTime, isValidTimeFormat } from '@shared/timeFormat'
import { DEFAULT_HEADER_ROW, type HeaderRow } from '@shared/types'

let current = DEFAULT_TIME_FORMAT

/** App's door: a style the reader cannot read back is the default. */
export function setTimeFormatSetting(format: string): void {
  current = isValidTimeFormat(format) ? format : DEFAULT_TIME_FORMAT
}

export const timeFormatSetting = (): string => current

let day: { start: number; end: number } = DEFAULT_CALENDAR_DAY

/**
 * Settings › Tables › Calendar tables › Calendar day (YAZ-4163 demo), App's door: "/Calendar table", "Time slots" on a
 * table with no times, and "Fill the calendar day" read it at the click. A day whose end is not after its start, or a
 * time off the half hour, is the default day.
 */
export function setCalendarDaySetting(start: number, end: number): void {
  day = isCalendarDayTime(start) && isCalendarDayTime(end) && start < end ? { start, end } : DEFAULT_CALENDAR_DAY
}

export const calendarDaySetting = (): { start: number; end: number } => day

let headerRow: HeaderRow = DEFAULT_HEADER_ROW

/**
 * Settings › Tables › All tables › Header row (YAZ-4774), App's door: a note table's "Header row ›" and a folder table's
 * View tab read it when they open, to show what a table follows. The page itself reads it from `.app` (`table.css`).
 */
export function setHeaderRowSetting(value: HeaderRow): void {
  headerRow = value
}

export const headerRowSetting = (): HeaderRow => headerRow

let noteButton = false

/**
 * Settings › Tables › Cell notes › Add button (YAZ-4790 demo: off by default), App's door: the cell note "+" shows on a
 * table that follows it, and a table's "Cell note button" reads it as its Default.
 */
export function setCellNoteButtonSetting(on: boolean): void {
  noteButton = on
}

export const cellNoteButtonSetting = (): boolean => noteButton
