import { describe, expect, it } from 'vitest'
import { HOTKEY_COMMANDS } from '@shared/hotkeyBindings'
import { ALL_KEYS, blockersOf, clashesOf, isUsableFor, keyRow, keysOf, stepsAside, type KeyRow } from '@shared/keys'

/** YAZ-3564: every key in one list (K1), the changes by scoped id (K2), the clash rule (K3) and the step aside (K9). */
const row = (id: string, keys: string[], extra: Partial<KeyRow> = {}): KeyRow => ({ id, scope: id.split('.')[0] as KeyRow['scope'], label: id, keys, changeable: true, ...extra })
const goTo = row('app.goTo', ['CmdOrCtrl+D'], { stepsAsideIn: ['drawing', 'diagram', 'code'] })
const search = row('app.search', ['CmdOrCtrl+K'])
const quit = row('app.mac.quit', ['CmdOrCtrl+Q'], { changeable: false, macStandard: true })
const duplicate = row('drawing.duplicate', ['CmdOrCtrl+D'])
const link = row('drawing.link', ['CmdOrCtrl+K'])
const noteBold = row('note.bold', ['CmdOrCtrl+B'])
const trim = row('code.trim', ['CmdOrCtrl+K CmdOrCtrl+X'])
const ROWS = [goTo, search, quit, duplicate, link, noteBold, trim]

describe('the key list (K1)', () => {
  it('has one row per id, and every changeable App command is a row', () => {
    const ids = ALL_KEYS.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const c of HOTKEY_COMMANDS) expect(keyRow(`app.${c.id}`)?.changeable, c.id).toBe(true)
    // An old unscoped App id finds its row (K2).
    expect(keyRow('toggleSidebar')?.id).toBe('app.toggleSidebar')
  })

  it('reads a change by its scoped id, an old App change by its plain id, and null as no key', () => {
    expect(keysOf(noteBold, {})).toEqual(['CmdOrCtrl+B'])
    expect(keysOf(noteBold, { 'note.bold': 'CmdOrCtrl+Alt+B' })).toEqual(['CmdOrCtrl+Alt+B'])
    expect(keysOf(noteBold, { 'note.bold': null })).toEqual([])
    expect(keysOf(search, { search: 'CmdOrCtrl+J' })).toEqual(['CmdOrCtrl+J'])
    expect(keysOf(search, { 'app.search': 'CmdOrCtrl+L', search: 'CmdOrCtrl+J' })).toEqual(['CmdOrCtrl+L'])
  })
})

describe('the clash rule (K3) and the step aside (K9)', () => {
  it('two places never clash; the same place does', () => {
    const noteSame = row('note.same', ['CmdOrCtrl+Alt+D'])
    const drawingSame = row('drawing.same', ['CmdOrCtrl+Alt+D'])
    expect(clashesOf(noteSame, 'CmdOrCtrl+Alt+D', {}, {}, [...ROWS, noteSame, drawingSame])).toEqual([])
    // A note is no place an App key steps aside in: Go to your place blocks a note's ⌘D.
    expect(clashesOf(noteBold, 'CmdOrCtrl+D', {}, {}, ROWS).map((r) => r.id)).toEqual(['app.goTo'])
    expect(clashesOf(link, 'CmdOrCtrl+D', {}, {}, ROWS).map((r) => r.id)).toEqual(['drawing.duplicate'])
  })

  it('an App key blocks the same key in a place, unless it lets that place keep it', () => {
    // ⌘K: Search the vault fires first, so a drawing's Add link never works.
    expect(blockersOf(link, {}, {}, ROWS).map((r) => r.id)).toEqual(['app.search'])
    // ⌘D: Go to your place steps aside in drawings by default, so Duplicate keeps ⌘D there.
    expect(stepsAside(goTo, 'drawing', {})).toBe(true)
    expect(stepsAside(goTo, 'note', {})).toBe(false)
    expect(blockersOf(duplicate, {}, {}, ROWS)).toEqual([])
    // The switch off: ⌘D goes to your place everywhere, and Duplicate is blocked.
    expect(blockersOf(duplicate, {}, { 'app.goTo': false }, ROWS).map((r) => r.id)).toEqual(['app.goTo'])
    // The switch on for ⌘K: a drawing's Add link works again.
    expect(blockersOf(link, {}, { 'app.search': true }, ROWS)).toEqual([])
  })

  it('a two-step code key is blocked by an App key on its first step; an App key sees the two-step keys it blocks', () => {
    expect(blockersOf(trim, {}, {}, ROWS).map((r) => r.id)).toEqual(['app.search'])
    expect(clashesOf(search, 'CmdOrCtrl+K', {}, {}, ROWS).map((r) => r.id).sort()).toEqual(['code.trim', 'drawing.link'])
    // Moved to one step, it is free.
    expect(blockersOf(trim, { 'code.trim': 'CmdOrCtrl+Alt+T' }, {}, ROWS)).toEqual([])
  })

  it('a Mac standard key blocks every place, even one an App key would step aside for', () => {
    expect(clashesOf(duplicate, 'CmdOrCtrl+Q', {}, { 'app.mac.quit': true }, ROWS).map((r) => r.id)).toEqual(['app.mac.quit'])
  })

  it('takes a bare letter only for a drawing (its tools are letters); every other place needs ⌘, ⌃ or ⌥', () => {
    expect(isUsableFor(duplicate, 'R')).toBe(true)
    expect(isUsableFor(noteBold, 'R')).toBe(false)
    expect(isUsableFor(noteBold, 'Alt+R')).toBe(true)
    expect(isUsableFor(trim, 'CmdOrCtrl+K CmdOrCtrl+X')).toBe(true)
    expect(isUsableFor(trim, 'CmdOrCtrl+K X')).toBe(false)
  })
})
