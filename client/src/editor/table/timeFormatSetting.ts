/**
 * Settings › Tables › Calendar tables › Time format and Calendar day (YAZ-4163, YAZ-4159 D15, D19), as the editor reads them: App writes it on each
 * change, and "/Calendar table", "Time slots" and "Current time" read it at the click. A tiny module, as
 * `code/languageHelpers.ts` is, so no editor rebuilds for a change.
 */
import { DEFAULT_CALENDAR_DAY, DEFAULT_TIME_FORMAT, isCalendarDayTime, isValidTimeFormat } from '@shared/timeFormat'
import type { TableLookSettings } from '@shared/tableLook'
import type { HeaderRow, TableTextInCells } from '@shared/types'
import { appTableLookNow, onTableLookSticky, setAppTableLook, tableLookAt, type TableLookPlace } from './tableLook'

/*
 * YAZ-5487: the table look and the new-table defaults are the VAULT's (`table-look.json`, `tableLook.ts`). Each reader
 * takes where it reads (an editor's view or a node in the page) and reads the look of the vault that holds it; with
 * nothing given, the app's (the fallback). The setters of before are gone: App sets the app's and each vault's look
 * (`setAppTableLook`, `setVaultTableLook`).
 */

/** The doors of before, each one setting of the APP's look (the tests'; App sets the whole look with `setAppTableLook`). */
const setApp = (patch: Partial<TableLookSettings>): void => setAppTableLook({ ...appTableLookNow(), ...patch })
export const setTimeFormatSetting = (format: string): void => setApp({ tableTimeFormat: isValidTimeFormat(format) ? format : DEFAULT_TIME_FORMAT })
export const setCalendarDaySetting = (start: number, end: number): void =>
  setApp(isCalendarDayTime(start) && isCalendarDayTime(end) && start < end ? { tableDayStart: start, tableDayEnd: end } : { tableDayStart: DEFAULT_CALENDAR_DAY.start, tableDayEnd: DEFAULT_CALENDAR_DAY.end })
export const setHeaderRowSetting = (value: HeaderRow): void => setApp({ tableHeaderRow: value })
export const setSubheaderRowSetting = (value: HeaderRow): void => setApp({ tableSubheaderRow: value })
export const setStickySubheadersSetting = (on: boolean): void => setApp({ tableStickySubheaders: on })
export const setStickyHeaderSetting = (on: boolean): void => setApp({ tableStickyHeader: on })
export const setTextInCellsSetting = (value: TableTextInCells): void => setApp({ tableTextInCells: value === 'clip' ? 'clip' : 'wrap' })

/** "/Calendar table", "Time slots" and "Current time" read it at the click. */
export const timeFormatSetting = (at?: TableLookPlace): string => tableLookAt(at).tableTimeFormat

/**
 * Settings › Tables › Calendar tables › Calendar day (YAZ-4163 demo): "/Calendar table", "Time slots" on a table with
 * no times, and "Fill the calendar day" read it at the click. A day whose end is not after its start is the default day.
 */
export const calendarDaySetting = (at?: TableLookPlace): { start: number; end: number } => {
  const look = tableLookAt(at)
  return { start: look.tableDayStart, end: look.tableDayEnd }
}

/**
 * Settings › Tables › All tables › Header row (YAZ-4774): a page table's "Header row ›" and a folder table's View tab
 * read it when they open, to show what a table follows. The page itself reads it from its surface (`table.css`).
 */
export const headerRowSetting = (at?: TableLookPlace): HeaderRow => tableLookAt(at).tableHeaderRow

/** Settings › Tables › All tables › Subheader row (YAZ-4899): a table's "Subheader row ›" panel reads it when it opens. */
export const subheaderRowSetting = (at?: TableLookPlace): HeaderRow => tableLookAt(at).tableSubheaderRow

/** Sticky subheaders (YAZ-4899): a change of the default (the app's or a vault's) tells each sticky view at once. */
export const onStickySubheadersSetting = onTableLookSticky

export const stickySubheadersSetting = (at?: TableLookPlace): boolean => tableLookAt(at).tableStickySubheaders

/**
 * Settings › Tables › All tables › Sticky header row (YAZ-4899 round 2): the header row frozen unless a table says
 * otherwise (`tableFreeze.ts`); a change tells the frozen-row plugin of each editor, which draws again.
 */
export const onStickyHeaderSetting = onTableLookSticky

export const stickyHeaderSetting = (at?: TableLookPlace): boolean => tableLookAt(at).tableStickyHeader

/** Settings › Tables › All tables › Text in cells (YAZ-4900): a table's "Text in cells" reads it as its Default. */
export const textInCellsSetting = (at?: TableLookPlace): TableTextInCells => (tableLookAt(at).tableTextInCells === 'clip' ? 'clip' : 'wrap')

let noteButton = false

/**
 * Settings › Tables › Cell notes › Add button (YAZ-4790 demo: off by default), App's door: the cell note "+" shows on a
 * table that follows it, and a table's "Cell note button" reads it as its Default.
 */
export function setCellNoteButtonSetting(on: boolean): void {
  noteButton = on
}

export const cellNoteButtonSetting = (): boolean => noteButton
