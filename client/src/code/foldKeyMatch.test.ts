/** The one table of fold keys (YAZ-3478), matched by the note's own keymap: a code tab folds with exactly the keys a note does. */
import { describe, expect, it } from 'vitest'
import { FOLD_KEYS } from '../editor/outline/foldKeys'
import { foldKeyHint, foldKeyOf } from './foldKeyMatch'

// ProseMirror's keymap reads the platform once, when it loads: `Mod` is ⌘ on a Mac, Ctrl elsewhere (jsdom: elsewhere).
const MOD = /Mac/.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true }
const press = (init: KeyboardEventInit): KeyboardEvent => new KeyboardEvent('keydown', init)

describe('FOLD_KEYS', () => {
  it("holds the note's keys: ⌘⇧U, ⌘⇧I, ⌘↑, ⌘↓", () => {
    expect(FOLD_KEYS).toEqual({ foldAll: 'Mod-Shift-u', unfoldAll: 'Mod-Shift-i', foldHere: 'Mod-ArrowUp', unfoldHere: 'Mod-ArrowDown' })
  })

  it('reads each key as the note does', () => {
    expect(foldKeyOf(press({ key: 'U', code: 'KeyU', keyCode: 85, shiftKey: true, ...MOD }))).toBe('foldAll')
    expect(foldKeyOf(press({ key: 'I', code: 'KeyI', keyCode: 73, shiftKey: true, ...MOD }))).toBe('unfoldAll')
    expect(foldKeyOf(press({ key: 'ArrowUp', code: 'ArrowUp', keyCode: 38, ...MOD }))).toBe('foldHere')
    expect(foldKeyOf(press({ key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, ...MOD }))).toBe('unfoldHere')
  })

  it('needs the exact modifiers: no more, no less', () => {
    expect(foldKeyOf(press({ key: 'u', code: 'KeyU', keyCode: 85, ...MOD }))).toBeNull()
    expect(foldKeyOf(press({ key: 'U', code: 'KeyU', keyCode: 85, shiftKey: true, altKey: true, ...MOD }))).toBeNull()
    expect(foldKeyOf(press({ key: 'ArrowUp', code: 'ArrowUp', keyCode: 38, shiftKey: true, ...MOD }))).toBeNull()
    expect(foldKeyOf(press({ key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 }))).toBeNull()
  })

  it('a letter also matches by its key code (another layout gives another `key`)', () => {
    expect(foldKeyOf(press({ key: 'Г', code: 'KeyU', keyCode: 85, shiftKey: true, ...MOD }))).toBe('foldAll')
  })

  it('names a key as a Mac menu does', () => {
    expect(foldKeyHint(FOLD_KEYS.foldAll)).toBe('⌘⇧U')
    expect(foldKeyHint(FOLD_KEYS.unfoldAll)).toBe('⌘⇧I')
    expect(foldKeyHint(FOLD_KEYS.foldHere)).toBe('⌘↑')
  })
})
