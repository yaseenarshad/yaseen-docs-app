import { isRecord } from './guards'
import { isValidTimeFormat } from './timeFormat'
import type { HeaderRow, HeaderRowOwn, SettingsState } from './types'

/**
 * A vault's table look and new-table defaults (YAZ-5487, scoping B3, section 7 row 5): the 21 table settings that were
 * the Mac's app settings (YAZ-4167, YAZ-3818, YAZ-4774, YAZ-4899, YAZ-4900, YAZ-4163 …: no vault decision) belong to
 * the vault, so a vault's tables read the same on every Mac and on the phone, and two vaults can differ. It lives in
 * `<vault>/.yaseendocs/table-look.json`, through the generic `vaultConfig` door, as `card-look.json`. Pure: no React, no
 * fs; the phone imports it too (from its page chunk).
 *
 * The file holds only what differs from the defaults, beside a version:
 * `{ "version": 1, "look": { "rowBand": "calendar", "headerRow": { "color": "blue" } }, "newTables": { "dayStart": 360 } }`.
 * A key left out is the default. A vault with NO file reads the app's values (the Mac's settings, the fallback, also for
 * a window with no vault); the one-time move (`TABLE_LOOK_MOVE`) writes them into each vault once. The phone, which has
 * no app values, reads the defaults then.
 *
 * The table HABITS stay this Mac's (scoping C): `tableBandRows`, `tableNowButton`, `tableCellNoteButton`,
 * `tableCellNotePinned`, `tableAllNotesOpensAt`.
 */

export const TABLE_LOOK_FILE = 'table-look.json'
export const TABLE_LOOK_VERSION = 1
/** The keys this build's writer owns: every other key of the file (a later version's) is kept on a save. */
export const TABLE_LOOK_KEYS: readonly string[] = ['version', 'look', 'newTables']

/** A header row's parts as the file holds them: only the parts that differ from that row's default. */
export type TableLookRow = Partial<Omit<HeaderRowOwn, 'text'>> & { text?: NonNullable<HeaderRowOwn['text']> | null }

/** How the vault's tables look (the file's `look`). */
export interface TableLookLook {
  headerRow?: TableLookRow
  subheaderRow?: TableLookRow
  stickyHeader?: boolean
  stickySubheaders?: boolean
  rowBand?: SettingsState['tableRowBand']
  bandColour?: string
  bandStrength?: number
  bandBold?: boolean
  textInCells?: SettingsState['tableTextInCells']
  position?: SettingsState['tablePosition']
  width?: number
  cellBulletIndent?: number
  cellBulletGap?: number
  dimPast?: SettingsState['tableDimPast']
  shadeDarkness?: number
  nowMark?: SettingsState['tableNowMark']
}

/** How a new table of the vault starts (the file's `newTables`). */
export interface TableLookNew {
  style?: SettingsState['tableNewStyle']
  timeFormat?: string
  dayStart?: number
  dayEnd?: number
  cellNoteTemplate?: string
}

/** Only what differs from the defaults (`tableLookOf`). */
export interface TableLook {
  look?: TableLookLook
  newTables?: TableLookNew
}

/** The 21 settings, by their app names (`SettingsState`). */
export const TABLE_LOOK_SETTINGS = [
  'tableHeaderRow',
  'tableSubheaderRow',
  'tableStickyHeader',
  'tableStickySubheaders',
  'tableRowBand',
  'tableBandColour',
  'tableBandStrength',
  'tableBandBold',
  'tableTextInCells',
  'tablePosition',
  'tableWidth',
  'tableCellBulletIndent',
  'tableCellBulletGap',
  'tableDimPast',
  'tableShadeDarkness',
  'tableNowMark',
  'tableNewStyle',
  'tableTimeFormat',
  'tableDayStart',
  'tableDayEnd',
  'tableCellNoteTemplate',
] as const
export type TableLookSettings = Pick<SettingsState, (typeof TABLE_LOOK_SETTINGS)[number]>

/**
 * The defaults: `DEFAULT_SETTINGS`', written out, as the ranges below are (the `cardLook.ts` rule: an import of
 * `types.ts` values would add exports to the phone's first load). `tableLook.test.ts` checks they are the same.
 */
export const TABLE_LOOK_DEFAULTS: Readonly<TableLookSettings> = /*#__PURE__*/ Object.freeze({
  tableHeaderRow: Object.freeze({ color: 'gray', strength: 'light', weight: 'bold', text: null, align: 'follow' }) as HeaderRow,
  tableSubheaderRow: Object.freeze({ color: 'gray', strength: 'medium', weight: 'bold', text: 'full', align: 'follow' }) as HeaderRow,
  tableStickyHeader: true,
  tableStickySubheaders: true,
  tableRowBand: 'all',
  tableBandColour: 'accent',
  tableBandStrength: 10,
  tableBandBold: true,
  tableTextInCells: 'wrap',
  tablePosition: 'left',
  tableWidth: null,
  tableCellBulletIndent: 20,
  tableCellBulletGap: 4,
  tableDimPast: 'shade',
  tableShadeDarkness: 6,
  tableNowMark: 'line',
  tableNewStyle: 'plain',
  tableTimeFormat: 'h:mm a',
  tableDayStart: 5 * 60,
  tableDayEnd: 22 * 60,
  tableCellNoteTemplate: '',
})

const whole = (v: unknown, min: number, max: number, step = 1): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max && v % step === 0
const oneOf = <T extends string>(list: readonly T[]) => (v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v)
const bool = (v: unknown): v is boolean => typeof v === 'boolean'
const COLOURS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'] as const
const halfHour = (v: unknown): v is number => whole(v, 0, 24 * 60 - 1, 30)

/** A header row's choices (`HEADER_ROW_CHOICES` in `types.ts`, written out). */
const ROW_OK: { [K in keyof TableLookRow]-?: (v: unknown) => boolean } = {
  color: oneOf(['gray', ...COLOURS, 'black']),
  strength: oneOf(['off', 'light', 'medium', 'strong']),
  weight: oneOf(['bold', 'regular']),
  text: (v) => v === null || oneOf(['muted', 'full', 'white', ...COLOURS])(v),
  align: oneOf(['follow', 'left', 'center', 'right']),
}

/** Each `look` field's check: the store's (`desktop/src/main/store.ts`) and `types.ts`' ranges. */
const LOOK_OK: { [K in Exclude<keyof TableLookLook, 'headerRow' | 'subheaderRow'>]-?: (v: unknown) => boolean } = {
  stickyHeader: bool,
  stickySubheaders: bool,
  rowBand: oneOf(['off', 'calendar', 'all']),
  // `isBandColour`: the accent, a table colour, or `#rrggbb`.
  bandColour: (v) => typeof v === 'string' && (v === 'accent' || oneOf([...COLOURS, 'grey', 'brown'])(v) || /^#[0-9a-f]{6}$/i.test(v)),
  // TABLE_BAND_STRENGTH_MIN–MAX
  bandStrength: (v) => whole(v, 1, 60),
  bandBold: bool,
  textInCells: oneOf(['wrap', 'clip']),
  position: oneOf(['left', 'center']),
  // BLOCK_WIDTH_MIN–MAX
  width: (v) => whole(v, 240, 4000),
  // TABLE_CELL_BULLET_INDENT_MIN–MAX, TABLE_CELL_BULLET_GAP_MIN–MAX
  cellBulletIndent: (v) => whole(v, 8, 32),
  cellBulletGap: (v) => whole(v, 2, 12),
  dimPast: oneOf(['off', 'text', 'shade']),
  // TABLE_SHADE_MIN–MAX, steps of TABLE_SHADE_STEP
  shadeDarkness: (v) => whole(v, 2, 30, 2),
  nowMark: oneOf(['line', 'tint', 'both']),
}

const NEW_OK: { [K in keyof TableLookNew]-?: (v: unknown) => boolean } = {
  style: oneOf(['plain', 'super']),
  timeFormat: (v) => typeof v === 'string' && isValidTimeFormat(v),
  dayStart: halfHour,
  dayEnd: halfHour,
  // CELL_NOTE_TEMPLATE_MAX
  cellNoteTemplate: (v) => typeof v === 'string' && v.length <= 2000,
}

function pick<T extends object>(raw: unknown, ok: Record<string, (v: unknown) => boolean>): T | undefined {
  if (!isRecord(raw)) return undefined
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(ok)) if (Object.hasOwn(raw, key) && ok[key](raw[key])) out[key] = raw[key]
  return Object.keys(out).length > 0 ? (out as T) : undefined
}

/** The file (or a hand edit), cleaned: each field that does not read is dropped alone, so the others stay. */
export function sanitizeTableLook(raw: unknown): TableLook {
  if (!isRecord(raw)) return {}
  const out: TableLook = {}
  const look = pick<TableLookLook>(raw.look, LOOK_OK) ?? {}
  if (isRecord(raw.look)) {
    const header = pick<TableLookRow>(raw.look.headerRow, ROW_OK)
    const subheader = pick<TableLookRow>(raw.look.subheaderRow, ROW_OK)
    if (header !== undefined) look.headerRow = header
    if (subheader !== undefined) look.subheaderRow = subheader
  }
  if (Object.keys(look).length > 0) out.look = look
  const fresh = pick<TableLookNew>(raw.newTables, NEW_OK)
  if (fresh !== undefined) out.newTables = fresh
  return out
}

const rowOf = (own: TableLookRow | undefined, d: HeaderRow): HeaderRow => ({ ...d, ...own })

/** What a vault's file says, as the 21 settings: each key it leaves out is the default. A day that does not end after it starts is the default day. */
export function tableLookSettings(file: TableLook): TableLookSettings {
  const d = TABLE_LOOK_DEFAULTS
  const l = file.look ?? {}
  const n = file.newTables ?? {}
  const start = n.dayStart ?? d.tableDayStart
  const end = n.dayEnd ?? d.tableDayEnd
  const day = start < end ? { tableDayStart: start, tableDayEnd: end } : { tableDayStart: d.tableDayStart, tableDayEnd: d.tableDayEnd }
  return {
    tableHeaderRow: rowOf(l.headerRow, d.tableHeaderRow),
    tableSubheaderRow: rowOf(l.subheaderRow, d.tableSubheaderRow),
    tableStickyHeader: l.stickyHeader ?? d.tableStickyHeader,
    tableStickySubheaders: l.stickySubheaders ?? d.tableStickySubheaders,
    tableRowBand: l.rowBand ?? d.tableRowBand,
    tableBandColour: l.bandColour ?? d.tableBandColour,
    tableBandStrength: l.bandStrength ?? d.tableBandStrength,
    tableBandBold: l.bandBold ?? d.tableBandBold,
    tableTextInCells: l.textInCells ?? d.tableTextInCells,
    tablePosition: l.position ?? d.tablePosition,
    tableWidth: l.width ?? d.tableWidth,
    tableCellBulletIndent: l.cellBulletIndent ?? d.tableCellBulletIndent,
    tableCellBulletGap: l.cellBulletGap ?? d.tableCellBulletGap,
    tableDimPast: l.dimPast ?? d.tableDimPast,
    tableShadeDarkness: l.shadeDarkness ?? d.tableShadeDarkness,
    tableNowMark: l.nowMark ?? d.tableNowMark,
    tableNewStyle: n.style ?? d.tableNewStyle,
    tableTimeFormat: n.timeFormat ?? d.tableTimeFormat,
    ...day,
    tableCellNoteTemplate: n.cellNoteTemplate ?? d.tableCellNoteTemplate,
  }
}

/** A header row's parts that differ from `d` (a part that does not read is left out). */
function rowDiff(row: unknown, d: HeaderRow): TableLookRow | undefined {
  if (!isRecord(row)) return undefined
  const out: Record<string, unknown> = {}
  for (const part of Object.keys(ROW_OK) as (keyof TableLookRow)[]) if (Object.hasOwn(row, part) && row[part] !== d[part]) out[part] = row[part]
  return pick<TableLookRow>(out, ROW_OK)
}

/** The 21 settings as the file holds them: only what differs from the defaults (a value that does not read is left out). */
export function tableLookOf(s: Partial<TableLookSettings>): TableLook {
  const d = TABLE_LOOK_DEFAULTS
  const differs = <K extends keyof TableLookSettings>(k: K): boolean => s[k] !== undefined && s[k] !== d[k]
  const header = rowDiff(s.tableHeaderRow, d.tableHeaderRow)
  const subheader = rowDiff(s.tableSubheaderRow, d.tableSubheaderRow)
  return sanitizeTableLook({
    look: {
      ...(header !== undefined && { headerRow: header }),
      ...(subheader !== undefined && { subheaderRow: subheader }),
      ...(differs('tableStickyHeader') && { stickyHeader: s.tableStickyHeader }),
      ...(differs('tableStickySubheaders') && { stickySubheaders: s.tableStickySubheaders }),
      ...(differs('tableRowBand') && { rowBand: s.tableRowBand }),
      ...(differs('tableBandColour') && { bandColour: s.tableBandColour }),
      ...(differs('tableBandStrength') && { bandStrength: s.tableBandStrength }),
      ...(differs('tableBandBold') && { bandBold: s.tableBandBold }),
      ...(differs('tableTextInCells') && { textInCells: s.tableTextInCells }),
      ...(differs('tablePosition') && { position: s.tablePosition }),
      ...(differs('tableWidth') && { width: s.tableWidth }),
      ...(differs('tableCellBulletIndent') && { cellBulletIndent: s.tableCellBulletIndent }),
      ...(differs('tableCellBulletGap') && { cellBulletGap: s.tableCellBulletGap }),
      ...(differs('tableDimPast') && { dimPast: s.tableDimPast }),
      ...(differs('tableShadeDarkness') && { shadeDarkness: s.tableShadeDarkness }),
      ...(differs('tableNowMark') && { nowMark: s.tableNowMark }),
    },
    newTables: {
      ...(differs('tableNewStyle') && { style: s.tableNewStyle }),
      ...(differs('tableTimeFormat') && { timeFormat: s.tableTimeFormat }),
      ...(differs('tableDayStart') && { dayStart: s.tableDayStart }),
      ...(differs('tableDayEnd') && { dayEnd: s.tableDayEnd }),
      ...(differs('tableCellNoteTemplate') && { cellNoteTemplate: s.tableCellNoteTemplate }),
    },
  })
}

/** The 21 settings of `s` (the app's), each missing or wrong one the default (a main process older than a field). */
export const appTableLook = (s: Partial<TableLookSettings>): TableLookSettings => tableLookSettings(tableLookOf(s))

/** What a writer writes: the version, then only what differs from the defaults. */
export function tableLookFile(look: TableLook): { version: number } & TableLook {
  return { version: TABLE_LOOK_VERSION, ...sanitizeTableLook(look) }
}
