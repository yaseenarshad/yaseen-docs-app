/**
 * THE KEY TABLE (`shared/hotkeyBindings.ts`, YAZ-3397 D2): one way to read, compare, show and record a key.
 * Tested here because `shared/` has no test project of its own.
 */
import { describe, expect, it } from 'vitest'
import { HOTKEY_COMMANDS, drawioChordFor, fromKeyEvent, keyFor, sameKey, toDisplay, windowChordFor, withKey } from '@shared/hotkeyBindings'

const press = (key: string, code: string, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey', boolean>> = {}) => ({ key, code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods })

describe('toDisplay / fromKeyEvent', () => {
  it('writes a key the way the app does — ⌃⌥⌘⇧, then the key', () => {
    const cases: [string, string][] = [
      ['CmdOrCtrl+Shift+W', '⌘⇧W'],
      ['Control+Shift+Tab', '⌃⇧Tab'],
      ['CmdOrCtrl+,', '⌘,'],
      ['Alt+CmdOrCtrl+H', '⌥⌘H'],
      ['CmdOrCtrl+Shift+]', '⌘⇧]'],
      ['CmdOrCtrl+Plus', '⌘+'],
      ['CmdOrCtrl+-', '⌘−'],
      ['Command+Space', '⌘Space'],
      ['Control+Up', '⌃↑'],
      ['CmdOrCtrl+Backspace', '⌘⌫'],
    ]
    for (const [accelerator, shown] of cases) expect(toDisplay(accelerator)).toBe(shown)
    expect(toDisplay(null)).toBe('')
  })

  it('a keydown becomes the accelerator of its PHYSICAL key and exactly its modifiers; a lone modifier is nothing', () => {
    expect(fromKeyEvent(press('K', 'KeyK', { metaKey: true, shiftKey: true }))).toBe('CmdOrCtrl+Shift+K')
    // ⌥ changes `key` on a Mac; the code does not.
    expect(fromKeyEvent(press('∫', 'KeyB', { metaKey: true, altKey: true }))).toBe('CmdOrCtrl+Alt+B')
    expect(fromKeyEvent(press('?', 'Slash', { metaKey: true, shiftKey: true }))).toBe('CmdOrCtrl+Shift+/')
    expect(fromKeyEvent(press('Tab', 'Tab', { ctrlKey: true }))).toBe('Control+Tab')
    expect(fromKeyEvent(press('Meta', 'MetaLeft', { metaKey: true }))).toBeNull()
    expect(fromKeyEvent(press('Shift', 'ShiftLeft', { shiftKey: true }))).toBeNull()
    // Round trip: what the recorder writes is what the page shows.
    expect(toDisplay(fromKeyEvent(press('W', 'KeyW', { metaKey: true, shiftKey: true })))).toBe('⌘⇧W')
  })

  it('compares by the key, not the spelling: CmdOrCtrl is Command, the order of the modifiers does not count, Plus is ⇧=', () => {
    expect(sameKey('CmdOrCtrl+Shift+W', 'Shift+Command+W')).toBe(true)
    expect(sameKey('CmdOrCtrl+Plus', 'CmdOrCtrl+Shift+=')).toBe(true)
    expect(sameKey('CmdOrCtrl+W', 'CmdOrCtrl+Shift+W')).toBe(false)
    expect(sameKey(null, null)).toBe(false)
  })
})

describe('keyFor / withKey', () => {
  it('the default unless changed; null is "No key"; a key equal to the default is stored by deleting the change', () => {
    expect(keyFor('search', {})).toBe('CmdOrCtrl+K')
    expect(keyFor('search', { search: 'CmdOrCtrl+Shift+K' })).toBe('CmdOrCtrl+Shift+K')
    expect(keyFor('closeTab', { closeTab: null })).toBeNull()
    expect(keyFor('closeWindow', {})).toBeNull()
    expect(keyFor('search', undefined)).toBe('CmdOrCtrl+K')

    // A change is stored by its scoped id since YAZ-3564 (K2); an old unscoped one still reads, and a write replaces it.
    expect(keyFor('search', { 'app.search': 'CmdOrCtrl+Shift+K' })).toBe('CmdOrCtrl+Shift+K')
    expect(withKey({}, 'search', 'CmdOrCtrl+Shift+K')).toEqual({ 'app.search': 'CmdOrCtrl+Shift+K' })
    expect(withKey({ search: 'CmdOrCtrl+Shift+K' }, 'search', 'Command+K')).toEqual({})
    expect(withKey({ search: 'CmdOrCtrl+Shift+K' }, 'search', 'CmdOrCtrl+J')).toEqual({ 'app.search': 'CmdOrCtrl+J' })
    expect(withKey({}, 'closeTab', null)).toEqual({ 'app.closeTab': null })
    expect(withKey({ closeWindow: 'CmdOrCtrl+Alt+W' }, 'closeWindow', null)).toEqual({})
  })

  it('every default is a key the table reads, and no two commands ship with one key', () => {
    const keys = HOTKEY_COMMANDS.flatMap((c) => (c.key === null ? [] : [c.key]))
    for (const key of keys) expect(toDisplay(key), key).not.toBe(key)
    expect(new Set(keys.map((k) => toDisplay(k))).size).toBe(keys.length)
  })
})

describe('HOTKEY_COMMANDS (YAZ-3397 D2)', () => {
  it('ships these defaults, in this order, and says what the less plain ones do', () => {
    expect(HOTKEY_COMMANDS.map((c) => [c.id, toDisplay(c.key)])).toEqual([
      ['newTab', '⌘T'],
      ['newWindow', '⌘⇧N'],
      ['newFilesWindow', '⌘⇧W'],
      ['newItem', '⌘N'],
      ['goTo', '⌘D'],
      ['dailyNote', ''],
      ['closeTab', '⌘W'],
      ['closeWindow', ''],
      ['switchVault', '⌘O'],
      ['openFolder', '⌘⇧O'],
      ['search', '⌘K'],
      ['settings', '⌘,'],
      ['toggleSidebar', '⌘⇧B'],
      ['copyPath', '⌘⇧C'],
      ['tabOverview', '⌘⇧M'],
      ['nextTab', '⌃Tab'],
      ['prevTab', '⌃⇧Tab'],
      ['keySheet', ''],
    ])
    expect(HOTKEY_COMMANDS.filter((c) => c.macStandard === true).map((c) => c.id)).toEqual(['newTab', 'newWindow', 'newItem', 'closeTab', 'switchVault', 'settings'])
    // ⌘O (YAZ-1767 D8): the switcher's two verbs, filter then open — in a NEW window, never in place.
    expect(HOTKEY_COMMANDS.find((c) => c.id === 'switchVault')?.hint).toMatch(/filter.*new window/i)
    // ⌘⇧C (🔒 D4, YAZ-1338): the multi-selection FIRST, the open file as the fallback.
    expect(HOTKEY_COMMANDS.find((c) => c.id === 'copyPath')?.hint).toMatch(/selection.*else the open file/i)
    // A menu key since YAZ-3564 D10: it works inside every editor too.
    expect(HOTKEY_COMMANDS.find((c) => c.id === 'toggleSidebar')?.hint).toMatch(/note, a drawing, a diagram and code/i)
  })
})

describe('the renderer and draw.io follow the key (D2)', () => {
  it('windowChordFor: the key as it is now, or null for "No key"', () => {
    expect(windowChordFor('toggleSidebar', {})).toEqual({ key: 'b', shift: true, alt: false, ctrl: false, meta: true })
    expect(windowChordFor('copyPath', { copyPath: 'Control+Alt+P' })).toEqual({ key: 'p', shift: false, alt: true, ctrl: true, meta: false })
    expect(windowChordFor('toggleSidebar', { toggleSidebar: null })).toBeNull()
  })

  it('drawioChordFor: the keyCode draw.io reads, ⌘ or ⌃ as its `control`; a key with neither is no chord', () => {
    expect(drawioChordFor('CmdOrCtrl+K', true)).toEqual({ keyCode: 75, control: true, action: null })
    expect(drawioChordFor('CmdOrCtrl+Shift+W', true)).toEqual({ keyCode: 87, control: true, shift: true, action: null })
    expect(drawioChordFor('CmdOrCtrl+,', true)).toEqual({ keyCode: 188, control: true, action: null })
    expect(drawioChordFor('Alt+K', true)).toBeNull()
    expect(drawioChordFor(null, true)).toBeNull()
  })

  it('drawioChordFor (YAZ-3564 K15): on a Mac a ⌃ key clears nothing, since draw.io\'s `control` slot holds the ⌘ key too; off a Mac ⌃ is Ctrl', () => {
    expect(drawioChordFor('Control+D', true)).toBeNull()
    expect(drawioChordFor('CmdOrCtrl+Control+D', true)).toBeNull()
    expect(drawioChordFor('Control+D', false)).toEqual({ keyCode: 68, control: true, action: null })
  })
})
