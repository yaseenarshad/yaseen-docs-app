import { describe, expect, it } from 'vitest'
import { idsLetters, isIdLetters } from '@shared/noteId'

describe("a vault's ID letters (YAZ-2677 D2, R9)", () => {
  it('2 to 5 letters A to Z, in any case, are ID letters', () => {
    for (const value of ['YA', 'YAZ', 'yaz', 'Docs', 'ABCDE']) expect(isIdLetters(value)).toBe(true)
  })

  it('nothing, 1 letter, 6 letters, a digit, a space, a hyphen and a letter outside A to Z are not (S6)', () => {
    for (const value of ['', 'Y', 'ABCDEF', 'YA1', '12', 'YA Z', ' YAZ', 'YAZ ', 'YAZ\n', 'YA-Z', 'YÄZ']) expect(isIdLetters(value)).toBe(false)
  })

  it('the letters in a parsed `ids.json` are read in capitals', () => {
    expect(idsLetters({ enabled: true, letters: 'YAZ', was: ['OLD'] })).toBe('YAZ')
    expect(idsLetters({ enabled: false, letters: 'yaz' })).toBe('YAZ')
  })

  it('a file with no letters, or with letters that are not valid, has none', () => {
    for (const config of [null, undefined, 'YAZ', [], {}, { enabled: true }, { letters: 'X1' }, { letters: 'ABCDEF' }, { letters: 12 }, { letters: ['YAZ'] }]) expect(idsLetters(config)).toBeUndefined()
  })
})
