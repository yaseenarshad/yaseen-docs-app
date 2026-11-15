/**
 * The table look (YAZ-5487): the vault's table-look.json (`shared/tableLook.ts`), its CSS variables, and the editor's
 * script reading the look of the vault that holds it (`tableLook.ts`), two vaults side by side. Made-up values.
 */
import { afterEach, describe, expect, it } from 'vitest'
import cardTableCss from './cardTable.css?inline'
import editorTableCss from './table.css?inline'
import { TABLE_LOOK_DEFAULTS, TABLE_LOOK_SETTINGS, appTableLook, sanitizeTableLook, tableLookFile, tableLookOf, tableLookSettings } from '@shared/tableLook'
import {
  BLOCK_WIDTH_MAX,
  BLOCK_WIDTH_MIN,
  CELL_NOTE_TEMPLATE_MAX,
  DEFAULT_SETTINGS,
  HEADER_ROW_CHOICES,
  TABLE_BAND_STRENGTH_MAX,
  TABLE_BAND_STRENGTH_MIN,
  TABLE_CELL_BULLET_GAP_MAX,
  TABLE_CELL_BULLET_GAP_MIN,
  TABLE_CELL_BULLET_INDENT_MAX,
  TABLE_CELL_BULLET_INDENT_MIN,
  TABLE_SHADE_MAX,
  TABLE_SHADE_MIN,
  TABLE_SHADE_STEP,
} from '@shared/types'
import { headerRowVars, onTableLookSlot, setAppTableLook, setVaultTableLook, tableLookAt, tableLookKey, tableLookOfRoot, tableLookVars } from './tableLook'
import { calendarDaySetting, headerRowSetting, slotTimeSetting, stickyHeaderSetting, textInCellsSetting, timeFormatSetting } from './timeFormatSetting'
/** The Mac's table look as it loads: `cardTable.css`, then `table.css` (`tableStyle.ts`). */
const tableCss = cardTableCss + editorTableCss

afterEach(() => {
  setAppTableLook(TABLE_LOOK_DEFAULTS)
  setVaultTableLook('/a', null)
  setVaultTableLook('/b', null)
})

describe('table-look.json (shared/tableLook.ts)', () => {
  it('the defaults and ranges are the app\'s (DEFAULT_SETTINGS, types.ts), written out for the phone', () => {
    // YAZ-5602 round 2: Time in slot and Show seconds are the vault's only (no app setting): off, with seconds.
    const app = TABLE_LOOK_SETTINGS.filter((k) => k !== 'tableSlotTime' && k !== 'tableSlotSeconds')
    expect(TABLE_LOOK_DEFAULTS).toEqual({ ...Object.fromEntries(app.map((k) => [k, DEFAULT_SETTINGS[k]])), tableSlotTime: 'off', tableSlotSeconds: true })
    expect(TABLE_LOOK_SETTINGS).toHaveLength(25)
    expect(Object.hasOwn(DEFAULT_SETTINGS, 'tableSlotTime') || Object.hasOwn(DEFAULT_SETTINGS, 'tableSlotSeconds')).toBe(false)
    const ok = (look: object) => Object.keys(sanitizeTableLook({ look }).look ?? {}).length === 1
    expect([ok({ bandStrength: TABLE_BAND_STRENGTH_MIN }), ok({ bandStrength: TABLE_BAND_STRENGTH_MAX }), ok({ bandStrength: TABLE_BAND_STRENGTH_MAX + 1 })]).toEqual([true, true, false])
    expect([ok({ width: BLOCK_WIDTH_MIN }), ok({ width: BLOCK_WIDTH_MAX }), ok({ width: BLOCK_WIDTH_MIN - 1 })]).toEqual([true, true, false])
    expect([ok({ cellBulletIndent: TABLE_CELL_BULLET_INDENT_MIN }), ok({ cellBulletIndent: TABLE_CELL_BULLET_INDENT_MAX + 1 })]).toEqual([true, false])
    expect([ok({ cellBulletGap: TABLE_CELL_BULLET_GAP_MAX }), ok({ cellBulletGap: TABLE_CELL_BULLET_GAP_MIN - 1 })]).toEqual([true, false])
    expect([ok({ shadeDarkness: TABLE_SHADE_MIN }), ok({ shadeDarkness: TABLE_SHADE_MAX }), ok({ shadeDarkness: TABLE_SHADE_MIN + TABLE_SHADE_STEP / 2 })]).toEqual([true, true, false])
    for (const [part, choices] of Object.entries(HEADER_ROW_CHOICES)) for (const c of choices) expect(sanitizeTableLook({ look: { headerRow: { [part]: c } } }).look?.headerRow).toEqual({ [part]: c })
    expect(sanitizeTableLook({ newTables: { cellNoteTemplate: 'x'.repeat(CELL_NOTE_TEMPLATE_MAX + 1) } })).toEqual({})
  })

  it('the sanitiser keeps each field that reads and drops each one that does not, alone', () => {
    expect(
      sanitizeTableLook({
        version: 1,
        look: { headerRow: { color: 'blue', strength: 'loud', text: null }, rowBand: 'calendar', bandColour: '#aa3399', textInCells: 'squash', position: 'center', nowMark: 'both', future: 1 },
        newTables: { style: 'super', timeFormat: 'HH:mm', dayStart: 375, dayEnd: 1200, cellNoteTemplate: '- ' },
        later: true,
      }),
    ).toEqual({ look: { headerRow: { color: 'blue', text: null }, rowBand: 'calendar', bandColour: '#aa3399', position: 'center', nowMark: 'both' }, newTables: { style: 'super', timeFormat: 'HH:mm', dayEnd: 1200, cellNoteTemplate: '- ' } })
    expect(sanitizeTableLook('nope')).toEqual({})
    expect(sanitizeTableLook({ look: [], newTables: { timeFormat: 'qq' } })).toEqual({})
  })

  it('the file holds only what differs from the defaults; read back, it gives the same 21 settings (the key-by-key resolve)', () => {
    const app = { ...DEFAULT_SETTINGS, tableRowBand: 'off' as const, tableSubheaderRow: { ...DEFAULT_SETTINGS.tableSubheaderRow, text: null }, tableWidth: 900, tableDayEnd: 20 * 60 }
    const look = tableLookOf(app)
    expect(look).toEqual({ look: { subheaderRow: { text: null }, rowBand: 'off', width: 900 }, newTables: { dayEnd: 1200 } })
    expect(tableLookFile(look)).toEqual({ version: 1, ...look })
    expect(tableLookSettings(look)).toEqual(appTableLook(app))
    expect(tableLookOf(DEFAULT_SETTINGS)).toEqual({})
    expect(tableLookSettings({})).toEqual(TABLE_LOOK_DEFAULTS)
    // Each key falls back alone: a part of a header row, a day whose end is not after its start (the default day).
    expect(tableLookSettings({ look: { headerRow: { weight: 'regular' } } }).tableHeaderRow).toEqual({ ...DEFAULT_SETTINGS.tableHeaderRow, weight: 'regular' })
    expect(tableLookSettings({ newTables: { dayStart: 1200, dayEnd: 600 } })).toMatchObject({ tableDayStart: DEFAULT_SETTINGS.tableDayStart, tableDayEnd: DEFAULT_SETTINGS.tableDayEnd })
    // A value an older main process did not send, or a wrong one, is the default.
    expect(appTableLook({ ...DEFAULT_SETTINGS, tableRowBand: 'loud' as never, tableHeaderRow: undefined as never })).toEqual(TABLE_LOOK_DEFAULTS)
  })
})

describe('the next time slot in table-look.json (YAZ-5541)', () => {
  it('Off and red by default; only what differs is written, as `nextShade` and `nextColour`; read back, the same settings', () => {
    expect([DEFAULT_SETTINGS.tableNextShade, DEFAULT_SETTINGS.tableNextColour]).toEqual([false, 'red'])
    expect(tableLookOf({ ...DEFAULT_SETTINGS, tableNextShade: true })).toEqual({ look: { nextShade: true } })
    const both = { ...DEFAULT_SETTINGS, tableNowMark: 'tint' as const, tableNextShade: true, tableNextColour: '#22aa55' }
    const look = tableLookOf(both)
    expect(look).toEqual({ look: { nowMark: 'tint', nextShade: true, nextColour: '#22aa55' } })
    expect(tableLookFile(look)).toEqual({ version: 1, look: { nowMark: 'tint', nextShade: true, nextColour: '#22aa55' } })
    expect(tableLookSettings(look)).toEqual(appTableLook(both))
    expect(tableLookSettings(look)).toMatchObject({ tableNextShade: true, tableNextColour: '#22aa55' })
    expect(tableLookSettings({})).toMatchObject({ tableNextShade: false, tableNextColour: 'red' })
  })

  it('sanitised as the band colour: the accent, a table colour or #rrggbb; a boolean; each wrong key dropped alone, an unknown one not read', () => {
    for (const colour of ['accent', 'red', 'teal', 'grey', 'brown', '#A1b2C3']) expect(sanitizeTableLook({ look: { nextColour: colour } })).toEqual({ look: { nextColour: colour } })
    expect(sanitizeTableLook({ version: 1, look: { nextShade: 'yes', nextColour: 'crimson', nowMark: 'both', nextBlink: true } })).toEqual({ look: { nowMark: 'both' } })
    expect(sanitizeTableLook({ look: { nextShade: false, nextColour: '#123' } })).toEqual({ look: { nextShade: false } })
    expect(appTableLook({ ...DEFAULT_SETTINGS, tableNextShade: 1 as never, tableNextColour: 'nope' })).toEqual(TABLE_LOOK_DEFAULTS)
  })

  it('the variables: `--table-next-shade` on or off, `--table-next-colour` a table colour\'s TEXT colour (red is the now mark\'s red)', () => {
    expect(tableLookVars(TABLE_LOOK_DEFAULTS)).toMatchObject({ '--table-next-shade': 'off', '--table-next-colour': 'var(--table-text-red)' })
    expect(tableLookVars({ ...TABLE_LOOK_DEFAULTS, tableNextShade: true, tableNextColour: 'accent' }, true)).toMatchObject({ '--table-next-shade': 'on', '--table-next-colour': 'var(--accent)' })
    expect(tableLookVars({ ...TABLE_LOOK_DEFAULTS, tableNextColour: '#22aa55' })['--table-next-colour']).toBe('#22aa55')
  })
})

describe('the table look as CSS variables (tableLook.ts)', () => {
  it('`.app` (the app\'s look): what were attributes are variables; only the set ones', () => {
    const vars = tableLookVars(TABLE_LOOK_DEFAULTS)
    expect(vars).toMatchObject({ '--table-row-band': 'all', '--table-band-bold': 'on', '--table-now-mark': 'line', '--table-dim-past': 'shade', '--table-text': 'wrap', '--table-sticky-subheaders': 'on', '--table-width-set': 'off', '--table-header-aligned': 'off', '--cell-bullet-indent': '20px', '--table-past-shade': '6%' })
    expect(Object.values(vars)).not.toContain('initial')
    // A vault's surface: whole, `initial` where it sets none, so nothing of `.app`'s leaks in.
    const whole = tableLookVars({ ...TABLE_LOOK_DEFAULTS, tableWidth: 900, tablePosition: 'center' }, true)
    expect(whole).toMatchObject({ '--table-width': '900px', '--table-width-set': 'on', '--page-table-inline': 'auto', '--table-header-hue': 'initial' })
  })

  it('a header row\'s parts are the variables of table.css\'s `data-table-header-*` rules', () => {
    const css = tableCss.replace(/\s+/g, ' ')
    for (const color of HEADER_ROW_CHOICES.color) {
      const v = headerRowVars({ ...DEFAULT_SETTINGS.tableHeaderRow, color }, 'header')
      expect(css).toContain(`[data-table-header-color='${color}'] { --table-header-hue: ${v['--table-header-hue']}; --table-header-scale: ${v['--table-header-scale']}; }`)
    }
    for (const strength of HEADER_ROW_CHOICES.strength) expect(css).toContain(`[data-table-subheader-strength='${strength}'] { --table-subheader-strength: ${headerRowVars({ ...DEFAULT_SETTINGS.tableSubheaderRow, strength }, 'subheader')['--table-subheader-strength']}; }`)
    expect(headerRowVars({ ...DEFAULT_SETTINGS.tableHeaderRow, text: 'teal', align: 'right' }, 'header')).toMatchObject({ '--table-header-ink': 'var(--table-text-teal)', '--table-header-align': 'right', '--table-header-aligned': 'on' })
  })
})

describe('two vaults side by side: the editor reads the look of the vault that holds it (tableLookAt)', () => {
  const surface = (root: string | null): HTMLElement => {
    const layer = document.createElement('div')
    if (root !== null) layer.style.setProperty('--table-look', tableLookKey(root))
    const dom = document.createElement('div')
    layer.append(dom)
    document.body.append(layer)
    return dom
  }

  it('each surface its own vault\'s; a vault with no file, and a place outside every surface, the app\'s', () => {
    setAppTableLook({ ...TABLE_LOOK_DEFAULTS, tableTimeFormat: 'HH:mm' })
    setVaultTableLook('/a', tableLookSettings({ look: { stickyHeader: false, textInCells: 'clip', headerRow: { color: 'red' } }, newTables: { dayStart: 420, timeFormat: 'h:mma' } }))
    const a = surface('/a')
    const b = surface('/b')
    const view = { dom: a }
    expect([stickyHeaderSetting(view), textInCellsSetting(a), headerRowSetting(a).color, calendarDaySetting(a).start, timeFormatSetting(a)]).toEqual([false, 'clip', 'red', 420, 'h:mma'])
    expect([stickyHeaderSetting(b), textInCellsSetting(b), headerRowSetting(b).color, calendarDaySetting(b).start, timeFormatSetting(b)]).toEqual([true, 'wrap', 'gray', 300, 'HH:mm'])
    expect(timeFormatSetting()).toBe('HH:mm')
    expect(tableLookAt(surface(null)).tableTimeFormat).toBe('HH:mm')
    expect(tableLookOfRoot('/a').tableStickyHeader).toBe(false)
    expect(tableLookOfRoot(null).tableStickyHeader).toBe(true)
    // The file goes: the app's again.
    setVaultTableLook('/a', null)
    expect(stickyHeaderSetting(a)).toBe(true)
  })
})

describe('Time in slot in table-look.json (YAZ-5602 round 2)', () => {
  it('off and with seconds by default; only what differs is written, as `slotTime` and `slotSeconds`; read back, the same', () => {
    expect([TABLE_LOOK_DEFAULTS.tableSlotTime, TABLE_LOOK_DEFAULTS.tableSlotSeconds]).toEqual(['off', true])
    for (const mode of ['down', 'up'] as const) {
      const look = tableLookOf({ ...TABLE_LOOK_DEFAULTS, tableSlotTime: mode, tableSlotSeconds: false })
      expect(look).toEqual({ look: { slotTime: mode, slotSeconds: false } })
      expect(tableLookFile(look)).toEqual({ version: 1, look: { slotTime: mode, slotSeconds: false } })
      expect(tableLookSettings(look)).toMatchObject({ tableSlotTime: mode, tableSlotSeconds: false })
    }
    expect(tableLookOf({ ...TABLE_LOOK_DEFAULTS, tableSlotTime: 'off', tableSlotSeconds: true })).toEqual({})
    // The app's settings have none: the app's look is off, with seconds.
    expect(appTableLook(DEFAULT_SETTINGS)).toMatchObject({ tableSlotTime: 'off', tableSlotSeconds: true })
  })

  it('a save keeps them: a file with slotTime and slotSeconds read, then saved again, holds them still, beside the rest of its look', () => {
    const file = sanitizeTableLook({ version: 1, look: { slotTime: 'up', slotSeconds: false, nextShade: true, nowMark: 'both' } })
    expect(tableLookFile(tableLookOf(tableLookSettings(file)))).toEqual({ version: 1, look: { slotTime: 'up', slotSeconds: false, nextShade: true, nowMark: 'both' } })
    // Another setting changed and saved: the slot keys stay.
    expect(tableLookOf({ ...tableLookSettings(file), tableRowBand: 'off' }).look).toMatchObject({ slotTime: 'up', slotSeconds: false, rowBand: 'off' })
  })

  it('sanitised like nextShade: one of off, down, up; a boolean; each wrong key dropped alone', () => {
    expect(sanitizeTableLook({ look: { slotTime: 'up', slotSeconds: true } })).toEqual({ look: { slotTime: 'up', slotSeconds: true } })
    expect(sanitizeTableLook({ look: { slotTime: 'sideways', slotSeconds: 'yes', nowMark: 'both' } })).toEqual({ look: { nowMark: 'both' } })
  })

  it('the clock reads the look of the vault that holds it; a change of a vault\'s Time in slot tells the clocks', () => {
    const told: number[] = []
    const off = onTableLookSlot(() => told.push(1))
    const holder = document.createElement('div')
    holder.style.setProperty('--table-look', tableLookKey('/a'))
    const inside = document.createElement('p')
    holder.appendChild(inside)
    setVaultTableLook('/a', { ...TABLE_LOOK_DEFAULTS, tableSlotTime: 'down', tableSlotSeconds: false })
    expect(slotTimeSetting(inside)).toEqual({ mode: 'down', seconds: false })
    expect(slotTimeSetting()).toEqual({ mode: 'off', seconds: true })
    expect(told).toHaveLength(1)
    setVaultTableLook('/a', { ...TABLE_LOOK_DEFAULTS, tableSlotTime: 'down', tableSlotSeconds: false, tableRowBand: 'off' })
    expect(told).toHaveLength(1)
    off()
  })
})
