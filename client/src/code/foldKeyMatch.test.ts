/** The one table of fold keys (YAZ-3478) and its matcher: a code tab folds with exactly the keys a note does. */
import { describe, expect, it } from 'vitest'
import { FOLD_KEYS } from '../editor/outline/foldKeys'
import { foldKeyHint, foldKeyOf, keyMatches } from './foldKeyMatch'

const press = (init: Partial<{ key: string; code: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }>) => ({ key: '', code: '', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...init })

describe('FOLD_KEYS', () => {
  it("holds the note's keys: ⌘⇧U, ⌘⇧I, ⌘↑, ⌘↓", () => {
    expect(FOLD_KEYS).toEqual({ foldAll: 'Mod-Shift-u', unfoldAll: 'Mod-Shift-i', foldHere: 'Mod-ArrowUp', unfoldHere: 'Mod-ArrowDown' })
  })

  it('on a Mac, Mod is ⌘; elsewhere it is Ctrl', () => {
    expect(foldKeyOf(press({ key: 'U', code: 'KeyU', metaKey: true, shiftKey: true }), true)).toBe('foldAll')
    expect(foldKeyOf(press({ key: 'U', code: 'KeyU', metaKey: true, shiftKey: true }), false)).toBeNull()
    expect(foldKeyOf(press({ key: 'U', code: 'KeyU', ctrlKey: true, shiftKey: true }), false)).toBe('foldAll')
    expect(foldKeyOf(press({ key: 'ArrowUp', code: 'ArrowUp', metaKey: true }), true)).toBe('foldHere')
    expect(foldKeyOf(press({ key: 'ArrowDown', code: 'ArrowDown', metaKey: true }), true)).toBe('unfoldHere')
    expect(foldKeyOf(press({ key: 'I', code: 'KeyI', metaKey: true, shiftKey: true }), true)).toBe('unfoldAll')
  })

  it('needs the exact modifiers: no more, no less', () => {
    expect(keyMatches(press({ key: 'u', code: 'KeyU', metaKey: true }), FOLD_KEYS.foldAll, true)).toBe(false)
    expect(keyMatches(press({ key: 'U', code: 'KeyU', metaKey: true, shiftKey: true, altKey: true }), FOLD_KEYS.foldAll, true)).toBe(false)
    expect(keyMatches(press({ key: 'ArrowUp', code: 'ArrowUp', metaKey: true, shiftKey: true }), FOLD_KEYS.foldHere, true)).toBe(false)
    expect(keyMatches(press({ key: 'ArrowUp', code: 'ArrowUp' }), FOLD_KEYS.foldHere, true)).toBe(false)
  })

  it('a letter also matches by its code (another layout gives another `key`)', () => {
    expect(keyMatches(press({ key: 'Г', code: 'KeyU', metaKey: true, shiftKey: true }), FOLD_KEYS.foldAll, true)).toBe(true)
  })

  it('names a key as a Mac menu does', () => {
    expect(foldKeyHint(FOLD_KEYS.foldAll)).toBe('⌘⇧U')
    expect(foldKeyHint(FOLD_KEYS.unfoldAll)).toBe('⌘⇧I')
    expect(foldKeyHint(FOLD_KEYS.foldHere)).toBe('⌘↑')
  })
})
