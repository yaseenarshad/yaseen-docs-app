import { describe, expect, it } from 'vitest'
import { DRAWIO_ORIGIN } from '@shared/drawio'
import { keysOfDisplay, sameKey } from '@shared/hotkeyBindings'
import { DIAGRAM_KEYS } from '@shared/keys/diagram'
import { DRAWIO_HOTKEYS } from '../settings/hotkeys'
import { drawioAdaptiveColors, drawioConfig, drawioFrameUrl, readDrawioMessage } from './drawioProtocol'

describe('drawioFrameUrl (🔒 YAZ-1802 D4)', () => {
  it('is the drawio origin in embed + JSON + configure mode, with every door to the network shut', () => {
    const url = new URL(drawioFrameUrl('light'))
    expect(`${url.protocol}//${url.host}${url.pathname}`).toBe(`${DRAWIO_ORIGIN}/index.html`)
    const p = Object.fromEntries(url.searchParams)
    expect(p).toMatchObject({ embed: '1', proto: 'json', configure: '1', noSaveBtn: '1', noExitBtn: '1', saveAndExit: '0' })
    expect(p).toMatchObject({ offline: '1', stealth: '1', lockdown: '1', plugins: '0', pwa: '0', gapi: '0', db: '0', od: '0', gh: '0', gl: '0', tr: '0' })
    expect(p).toMatchObject({ pv: '0', dark: '0' })
  })

  it('pins the English UI, the only language the bundled draw.io carries (🔒 YAZ-1802 D5)', () => {
    expect(new URL(drawioFrameUrl('light')).searchParams.get('lang')).toBe('en')
  })

  it('carries the app theme at mount', () => {
    expect(new URL(drawioFrameUrl('dark')).searchParams.get('dark')).toBe('1')
  })
})

describe('drawioAdaptiveColors (🔒 YAZ-1802 D16)', () => {
  it('is the dark-mode colour setting in draw.io’s own words: adapt → auto, keep → none', () => {
    expect(drawioAdaptiveColors('adapt')).toBe('auto')
    expect(drawioAdaptiveColors('keep')).toBe('none')
  })
})

describe('drawioConfig (🔒 YAZ-1802 D3 / D12a / D12b / D16)', () => {
  type Shortcut = { keyCode: string | number; control?: boolean; shift?: boolean; action: string | null }
  const config = drawioConfig('adapt') as { defaultFonts: string[]; presetColors: string[]; defaultColors: string[]; keyboardShortcuts: Shortcut[] }

  it('starts draw.io on the dark-mode colour setting', () => {
    expect(config).toMatchObject({ defaultAdaptiveColors: 'auto' })
    expect(drawioConfig('keep')).toMatchObject({ defaultAdaptiveColors: 'none' })
  })

  it('saves plain XML, page view and grid off, and leaves guides a per-diagram toggle', () => {
    expect(config).toMatchObject({ compressXml: false, defaultPageVisible: false, defaultGridEnabled: false, zoomWheel: false })
    expect(config).not.toHaveProperty('enablePositionGuides')
  })

  it('offers our fonts first and draws colours without a #', () => {
    expect(config.defaultFonts).toEqual(['Assistant', 'Inter', 'Roboto', 'IBM Plex Mono', 'Liberation Serif'])
    for (const colour of [...config.presetColors, ...config.defaultColors]) expect(colour).toMatch(/^(none|[0-9A-F]{6})$/)
  })

  it('lays the open-colour palette out as draw.io draws it, twelve to a row: a column per family, lightest first', () => {
    const column = (i: number) => [0, 1, 2, 3, 4].map((row) => config.defaultColors[row * 12 + i])
    expect(column(1)).toEqual(['FFF5F5', 'FFC9C9', 'FF8787', 'FA5252', 'E03131']) // red
    expect(column(11)).toEqual(['F8F1EE', 'EADDD7', 'D2BAB0', 'A18072', '846358']) // bronze
    expect(config.defaultColors.slice(60)).toEqual(['none', 'FFFFFF', '1E1E1E'])
  })

  it('binds the Excalidraw tool letters and clears draw.io’s clashing S and F — with nothing selected', () => {
    const bare = Object.fromEntries(config.keyboardShortcuts.filter((s) => typeof s.keyCode === 'string').map((s) => [s.keyCode, s.action]))
    expect(bare).toEqual({ R: 'insertRectangle', O: 'insertEllipse', T: 'insertText', A: 'insertEdge', D: 'insertEdge', L: 'insertEdge', W: 'insertFreehand', P: 'insertFreehand', S: null, F: null })
    expect(config.keyboardShortcuts).toContainEqual({ keyCode: 220, control: true, action: 'removeFormat' })
  })

  it('clears draw.io’s own bindings on every menu chord, so the app menu gets them on every platform', () => {
    const cleared = config.keyboardShortcuts.filter((s) => s.action === null && s.control === true)
    expect(cleared.filter((s) => s.shift !== true).map((s) => s.keyCode)).toEqual(expect.arrayContaining([75, 188, 48, 187, 189]))
    // ⌘⇧O Open Folder, ⌘⇧E Export Image, ⌘⇧L Share Link, ⌘⇧[ / ⌘⇧] tabs, ⌘⇧S (draw.io's Save As).
    const shifted = cleared.filter((s) => s.shift === true).map((s) => s.keyCode)
    expect(shifted).toEqual(expect.arrayContaining([79, 69, 76, 219, 221, 83]))
    // Docs' own (YAZ-3028): ⌘T ⌘W ⌘O, ⌘⇧N ⌘⇧W ⌘⇧M.
    expect(cleared.filter((s) => s.shift !== true).map((s) => s.keyCode)).toEqual(expect.arrayContaining([84, 87, 79]))
    expect(shifted).toEqual(expect.arrayContaining([78, 87, 77]))
  })
})

describe('the menu chords follow the user\'s keys (YAZ-3397 D2)', () => {
  it('a moved key is cleared where it is now, and its old chord is draw.io\'s again; the fixed chords stay', () => {
    type Shortcut = { keyCode: string | number; control?: boolean; shift?: boolean; action: string | null }
    const cleared = (hotkeys = {}) => (drawioConfig('adapt', hotkeys) as { keyboardShortcuts: Shortcut[] }).keyboardShortcuts.filter((s) => s.action === null && s.control === true).map((s) => `${s.shift === true ? '⇧' : ''}${s.keyCode}`)
    expect(cleared()).toContain('75')
    const moved = cleared({ search: 'CmdOrCtrl+Shift+J' })
    expect(moved).toContain('⇧74')
    expect(moved).not.toContain('75')
    expect(moved).toEqual(expect.arrayContaining(['48', '⇧69', '⇧83']))
    expect(cleared({ closeTab: null })).not.toContain('87')
  })
})

describe('the user\'s diagram keys reach draw.io at configure (YAZ-3564 K4, K9, K12, K15)', () => {
  type Entry = Record<string, unknown>
  const shortcuts = (hotkeys = {}, aside = {}, mac = true) => (drawioConfig('adapt', hotkeys, aside, mac) as { keyboardShortcuts: Entry[] }).keyboardShortcuts
  const at = (list: Entry[], entry: Entry) => list.findIndex((e) => JSON.stringify(e) === JSON.stringify(entry))

  it('every key of the old draw.io table on Settings › Hotkeys is a diagram row, and the rows have the keys it missed', () => {
    const rowKeys = DIAGRAM_KEYS.flatMap((r) => r.keys)
    const has = (key: string) => rowKeys.some((k) => sameKey(k, key))
    const shown = DRAWIO_HOTKEYS.flatMap((e) => keysOfDisplay(e.keys))
    expect(shown.length).toBeGreaterThan(10)
    for (const key of shown) expect(has(key), key).toBe(true)
    for (const key of ['C', 'CmdOrCtrl+D', 'CmdOrCtrl+G', 'CmdOrCtrl+L', 'CmdOrCtrl+R', 'CmdOrCtrl+E']) expect(has(key), key).toBe(true)
  })

  it('with no change binds nothing more, and takes the shown key off each action that has no key', () => {
    expect(shortcuts().filter((e) => typeof e.action === 'string' && typeof e.keyCode === 'number')).toEqual([
      { keyCode: 220, control: true, action: 'removeFormat' },
      { keyCode: 88, control: true, shift: true, action: 'yaseenStrikethrough' },
    ])
    // draw.io's S and R labels stayed on these after the app gave the letters away.
    expect(shortcuts().flatMap((e) => (typeof e.yaseenUnlabel === 'string' ? [e.yaseenUnlabel] : [])).sort()).toEqual(['editConnectionPoints', 'insertLink', 'insertNote', 'insertRhombus'])
  })

  it('a remapped key: the default is cleared, then the new key is bound to the action', () => {
    const list = shortcuts({ 'diagram.duplicate': 'CmdOrCtrl+Alt+D' })
    const clear = at(list, { keyCode: 68, control: true, action: null })
    const bind = at(list, { keyCode: 68, control: true, alt: true, action: 'duplicate' })
    expect(clear).toBeGreaterThanOrEqual(0)
    expect(bind).toBeGreaterThan(clear)
    // A tool letter: every default letter goes, the new key is the tool.
    const tools = shortcuts({ 'diagram.insertEdge': 'Alt+L' })
    for (const keyCode of [65, 68, 76, 67]) expect(tools).toContainEqual({ keyCode, action: null })
    expect(tools).toContainEqual({ keyCode: 76, alt: true, action: 'insertEdge' })
    // The other codes draw.io reads for the default key go with it.
    const zoom = shortcuts({ 'diagram.increaseFontSize': 'CmdOrCtrl+Alt+]' })
    expect(zoom).toContainEqual({ keyCode: 221, control: true, shift: true, action: null })
    expect(zoom).toContainEqual({ keyCode: 107, control: true, shift: true, action: null })
  })

  it('a cleared key: the default is cleared, nothing is bound, and the action loses its shown key', () => {
    const list = shortcuts({ 'diagram.duplicate': null })
    expect(list).toContainEqual({ keyCode: 68, control: true, action: null })
    expect(list).toContainEqual({ yaseenUnlabel: 'duplicate' })
    expect(list.filter((e) => e.action === 'duplicate')).toEqual([])
  })

  it('⌃ and ⌘ apart on a Mac: an App key on ⌃D leaves draw.io\'s ⌘D, and a diagram key on ⌃D goes to our own table', () => {
    const appOnCtrlD = { 'app.search': 'Control+D' }
    expect(shortcuts(appOnCtrlD)).not.toContainEqual({ keyCode: 68, control: true, action: null })
    expect(shortcuts(appOnCtrlD, {}, false)).toContainEqual({ keyCode: 68, control: true, action: null })
    const rowOnCtrlD = { 'diagram.bold': 'Control+D' }
    expect(shortcuts(rowOnCtrlD)).toContainEqual({ yaseenMacCtrl: true, keyCode: 68, action: 'bold' })
    expect(shortcuts(rowOnCtrlD).filter((e) => e.keyCode === 68 && e.action === 'bold' && e.yaseenMacCtrl !== true)).toEqual([])
    // Off a Mac ⌃ is Ctrl, draw.io's own `control`.
    expect(shortcuts(rowOnCtrlD, {}, false)).toContainEqual({ keyCode: 68, control: true, action: 'bold' })
  })

  it('an App key that lets diagrams keep it (K9) is not cleared: the menu drops it on a diagram tab', () => {
    expect(shortcuts()).toContainEqual({ keyCode: 75, control: true, action: null })
    expect(shortcuts({}, { 'app.search': true })).not.toContainEqual({ keyCode: 75, control: true, action: null })
  })
})

describe('readDrawioMessage — only THAT iframe, only the drawio origin (🔒 YAZ-1802 D4)', () => {
  const frame = {}
  const msg = (data: unknown, over: Partial<{ source: unknown; origin: string }> = {}) => readDrawioMessage({ source: frame, origin: DRAWIO_ORIGIN, data, ...over }, frame)

  it('reads the protocol events', () => {
    expect(msg('{"event":"yaseenReady"}')).toEqual({ event: 'yaseenReady' })
    expect(msg('{"event":"configure"}')).toEqual({ event: 'configure' })
    expect(msg('{"event":"init"}')).toEqual({ event: 'init' })
    expect(msg('{"event":"load","xml":"<mxfile/>","scale":1}')).toEqual({ event: 'load', xml: '<mxfile/>' })
    expect(msg('{"event":"autosave","xml":"<mxfile/>"}')).toEqual({ event: 'autosave', xml: '<mxfile/>' })
    expect(msg('{"event":"save","xml":"<mxfile/>","exit":false}')).toEqual({ event: 'save', xml: '<mxfile/>' })
  })

  it('reads no forwarded shortcut: Toggle sidebar is a menu key since YAZ-3564 D10, so no key has to come up from the frame', () => {
    expect(msg('{"event":"shortcut","command":"toggleSidebar"}')).toBeNull()
    expect(msg('{"event":"shortcut"}')).toBeNull()
  })

  it('ignores another window, another origin, a missing frame, non-strings, junk and unknown events', () => {
    expect(msg('{"event":"init"}', { source: {} })).toBeNull()
    expect(msg('{"event":"init"}', { origin: 'app://yaseen' })).toBeNull()
    expect(msg('{"event":"init"}', { origin: 'https://app.diagrams.net' })).toBeNull()
    expect(readDrawioMessage({ source: null, origin: DRAWIO_ORIGIN, data: '{"event":"init"}' }, null)).toBeNull()
    expect(msg({ event: 'init' })).toBeNull()
    expect(msg('not json')).toBeNull()
    expect(msg('{"event":"exit"}')).toBeNull()
    expect(msg('{"event":"autosave"}')).toBeNull()
    expect(msg('null')).toBeNull()
  })
})
