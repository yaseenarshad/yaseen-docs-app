import { describe, expect, it } from 'vitest'
import { IDS_FILE, NOTE_ID_KEY, canonicalNoteId, defaultIdLetters, holdsId, idLettersOf, idsAnswer, isIdLetters, isNoteId, isNumberId, isVaultNumberId, noteIdNumber, numberId, vaultNoteId } from '@shared/noteId'

describe('note ids (YAZ-2293 D2, YAZ-2677 D3)', () => {
  it('the frontmatter key is `id`', () => {
    expect(NOTE_ID_KEY).toBe('id')
  })

  it('an old ID is still an ID: 12 lowercase characters with a digit (R3)', () => {
    expect(isNoteId('k3m9x2pq7abc')).toBe(true)
    expect(isNoteId('strengthened')).toBe(false) // 12 allowed letters, but a real word: no digit
    expect(isNoteId('K3M9X2PQ7ABC')).toBe(false) // uppercase
    expect(isNoteId('k3m9x2pq7ab')).toBe(false) // 11
    expect(isNoteId('k3m9x2pq7abcd')).toBe(false) // 13
    expect(isNoteId('k3m9x2pq7abi')).toBe(false) // `i` is not in the alphabet
    expect(isNoteId('k3m9 2pq7abc')).toBe(false)
    expect(isNoteId(42)).toBe(false)
    expect(isNoteId(null)).toBe(false)
    expect(isNoteId(undefined)).toBe(false)
    expect(isNumberId('k3m9x2pq7abc')).toBe(false)
  })

  it('a number ID is 2 to 5 letters, a hyphen and a number with no leading zero, in any case (R1)', () => {
    for (const id of ['YAZ-12', 'yaz-12', 'Yaz-12', 'AB-1', 'ABCDE-2648', 'YAZ-100000']) {
      expect(isNoteId(id)).toBe(true)
      expect(isNumberId(id)).toBe(true)
    }
    // S24: a leading zero and zero itself are no number.
    for (const id of ['YAZ-012', 'YAZ-0', 'A-1', 'ABCDEF-1', 'YAZ-', 'YAZ12', 'YAZ 12', 'YAZ-1a', 'Y4Z-1', 'YAZ--1', ' YAZ-1', 'YAZ-1 ', 'ÝAZ-1']) {
      expect(isNoteId(id)).toBe(false)
      expect(isNumberId(id)).toBe(false)
    }
  })

  it('a number that JavaScript cannot count exactly is no ID: 15 digits at most', () => {
    expect(isNoteId('YAZ-999999999999999')).toBe(true)
    expect(isNoteId('YAZ-1000000000000000')).toBe(false)
  })

  it('is written with capital letters; an old ID stays as it is (R2)', () => {
    expect(canonicalNoteId('yaz-12')).toBe('YAZ-12')
    expect(canonicalNoteId('YAZ-12')).toBe('YAZ-12')
    expect(canonicalNoteId('k3m9x2pq7abc')).toBe('k3m9x2pq7abc')
    expect(numberId('YAZ', 43)).toBe('YAZ-43')
  })

  it('the number of an ID; an old ID has none (S20)', () => {
    expect(noteIdNumber('YAZ-12')).toBe(12)
    expect(noteIdNumber('yaz-2648')).toBe(2648)
    expect(noteIdNumber('k3m9x2pq7abc')).toBeUndefined()
    expect(noteIdNumber('GPT 4')).toBeUndefined()
    expect(noteIdNumber(undefined)).toBeUndefined()
  })
})

describe('an ID of this vault (YAZ-2677 R5, R6, R7)', () => {
  const letters = ['YAZ', 'OLD']

  it('has the letters of the vault, in any case, and reads in capitals', () => {
    expect(vaultNoteId('YAZ-12', letters)).toBe('YAZ-12')
    expect(vaultNoteId('yaz-12', letters)).toBe('YAZ-12')
  })

  it('or letters the vault had before: it reads with the current letters (S77, S82)', () => {
    expect(vaultNoteId('OLD-12', letters)).toBe('YAZ-12')
    expect(vaultNoteId('old-12', letters)).toBe('YAZ-12')
  })

  it('other LETTERS-NUMBER text is not an ID of this vault (S21, S22, S23)', () => {
    expect(vaultNoteId('GPT-4', letters)).toBeUndefined()
    expect(vaultNoteId('BUS-12', letters)).toBeUndefined()
    expect(vaultNoteId('YAZ-012', letters)).toBeUndefined()
    expect(vaultNoteId('YAZ-12', [])).toBeUndefined()
  })

  it('an old ID is an ID of each vault (R3, S19)', () => {
    expect(vaultNoteId('k3m9x2pq7abc', letters)).toBe('k3m9x2pq7abc')
    expect(vaultNoteId('k3m9x2pq7abc', [])).toBe('k3m9x2pq7abc')
  })

  it('nothing else is', () => {
    for (const value of [undefined, null, 12, '', 'Home', ['YAZ-12']]) expect(vaultNoteId(value, letters)).toBeUndefined()
  })

  it('an ID the door could have given has the CURRENT letters, in capitals', () => {
    expect(isVaultNumberId('YAZ-12', letters)).toBe(true)
    expect(isVaultNumberId('yaz-12', letters)).toBe(false)
    expect(isVaultNumberId('OLD-12', letters)).toBe(false)
    expect(isVaultNumberId('k3m9x2pq7abc', letters)).toBe(false)
    expect(isVaultNumberId(12, letters)).toBe(false)
  })
})

describe("a vault's answer to IDs, and its letters (YAZ-2523 V1, YAZ-2677 R9, R11)", () => {
  it('is kept in `ids.json`', () => {
    expect(IDS_FILE).toBe('ids.json')
  })

  it('is the `enabled` boolean of the file; a missing file, a file that says nothing, or one that says something else is not answered', () => {
    expect(idsAnswer({ enabled: true })).toBe(true)
    expect(idsAnswer({ enabled: false })).toBe(false)
    expect(idsAnswer({ enabled: true, letters: 'YAZ', was: ['OLD'] })).toBe(true)
    for (const config of [null, undefined, {}, { enabled: 'yes' }, { enabled: 1 }, { enabled: null }, [], 'true', true]) expect(idsAnswer(config)).toBeUndefined()
  })

  it('the default letters: first three letters A to Z of the folder name, in capitals; DOC when the name has fewer than two (R11)', () => {
    expect(defaultIdLetters('yaseen-docs-vault')).toBe('YAS')
    expect(defaultIdLetters('My Vault')).toBe('MYV')
    expect(defaultIdLetters('a1b')).toBe('AB')
    expect(defaultIdLetters('2024 q3')).toBe('DOC')
    expect(defaultIdLetters('é1')).toBe('DOC')
    expect(defaultIdLetters('7')).toBe('DOC')
    expect(defaultIdLetters('')).toBe('DOC')
  })

  it('the letters of a vault: its `letters`, then each entry of `was`, in capitals (R9)', () => {
    expect(idLettersOf({ enabled: true, letters: 'YAZ', was: ['OLD', 'abc'] }, 'vault')).toEqual({ letters: ['YAZ', 'OLD', 'ABC'], saved: true })
    expect(idLettersOf({ enabled: true, letters: 'yaz' }, 'vault')).toEqual({ letters: ['YAZ'], saved: true })
  })

  it('a config with no valid `letters` uses the default, and says that it is not saved (R11)', () => {
    expect(idLettersOf({ enabled: true }, 'yaseen-docs-vault')).toEqual({ letters: ['YAS'], saved: false })
    expect(idLettersOf(null, 'My Vault')).toEqual({ letters: ['MYV'], saved: false })
    expect(idLettersOf({ letters: 'TOOLONG' }, '7')).toEqual({ letters: ['DOC'], saved: false })
    expect(idLettersOf({ letters: 12 }, 'ab')).toEqual({ letters: ['AB'], saved: false })
  })

  it('an entry of `was` that is no letters, or is the current letters, is dropped', () => {
    expect(idLettersOf({ letters: 'YAZ', was: ['YAZ', 'OLD', 'old', 7, 'X', 'TOOLONG', null] }, 'v')).toEqual({ letters: ['YAZ', 'OLD'], saved: true })
    expect(idLettersOf({ letters: 'YAZ', was: 'OLD' }, 'v')).toEqual({ letters: ['YAZ'], saved: true })
  })

  it('2 to 5 letters A to Z, in any case, are ID letters (D2)', () => {
    for (const value of ['YA', 'YAZ', 'yaz', 'Docs', 'ABCDE']) expect(isIdLetters(value)).toBe(true)
  })

  it('nothing, 1 letter, 6 letters, a digit, a space, a hyphen and a letter outside A to Z are not (S6)', () => {
    for (const value of ['', 'Y', 'ABCDEF', 'YA1', '12', 'YA Z', ' YAZ', 'YAZ ', 'YAZ\n', 'YA-Z', 'YÄZ', 12, null, undefined]) expect(isIdLetters(value)).toBe(false)
  })
})

describe('an ID in the text of the search box (YAZ-2677 D9)', () => {
  const held = (text: string, id: string, was?: readonly string[]): boolean => holdsId(text)?.(id, was) ?? false

  it('a bare number finds the note of that number, whatever the letters (S69, S70)', () => {
    expect(held('12', 'YAZ-12')).toBe(true)
    expect(held(' 12 ', 'BUS-12')).toBe(true)
  })

  it('the ID with a hyphen, with no hyphen or with a space, in any case (S71)', () => {
    for (const text of ['YAZ-12', 'yaz-12', 'yaz12', 'yaz 12', 'Yaz-12']) expect(held(text, 'YAZ-12')).toBe(true)
  })

  it('an ID matches whole (S72, S73)', () => {
    for (const text of ['yaz-12', 'yaz12', '12']) {
      expect(held(text, 'YAZ-1')).toBe(false)
      expect(held(text, 'YAZ-120')).toBe(false)
      expect(held(text, 'YAZ-112')).toBe(false)
    }
    expect(held('1', 'YAZ-1')).toBe(true)
    expect(held('1', 'YAZ-10')).toBe(false)
    expect(held('012', 'YAZ-12')).toBe(false)
  })

  it('the letters must be the note\'s: `yaz-12` does not find `BUS-12`', () => {
    expect(held('yaz-12', 'BUS-12')).toBe(false)
    expect(held('bus 12', 'BUS-12')).toBe(true)
  })

  it('letters that the vault had before find the note (S77)', () => {
    expect(held('OLD-12', 'YAZ-12', ['OLD'])).toBe(true)
    expect(held('old12', 'YAZ-12', ['OLD'])).toBe(true)
    expect(held('OLD-12', 'YAZ-12')).toBe(false)
    expect(held('OLD-12', 'YAZ-12', ['XYZ'])).toBe(false)
  })

  it('a link, a file name and a whole path hold the ID (S74)', () => {
    expect(held('[[YAZ-12]]', 'YAZ-12')).toBe(true)
    expect(held('[[yaz-12|the plan]]', 'YAZ-12')).toBe(true)
    expect(held('plan-yaz-12.md', 'YAZ-12')).toBe(true)
    expect(held('/Users/me/vault/work/plan-yaz-12.md', 'YAZ-12')).toBe(true)
    expect(held('plan-yaz-12.md', 'YAZ-1')).toBe(false)
    expect(held('plan-yaz-120.md', 'YAZ-12')).toBe(false)
  })

  it('a number in a longer text is no bare number', () => {
    expect(held('meeting 2024', 'YAZ-2024')).toBe(false)
    expect(held('chapter 12', 'YAZ-12')).toBe(false)
    expect(held('12 angry men', 'YAZ-12')).toBe(false)
    expect(held('v12', 'YAZ-12')).toBe(false)
  })

  it('letters that are part of a longer word are not the letters of an ID', () => {
    expect(held('topaz-12', 'PAZ-12')).toBe(false)
    expect(held('topaz-12', 'AZ-12')).toBe(false)
    expect(held('yaz-12b', 'YAZ-12')).toBe(false)
  })

  it('an old ID is held anywhere in the text, as before (S75, YAZ-2420 D32)', () => {
    expect(held('k3m9x2pq7abc', 'k3m9x2pq7abc')).toBe(true)
    expect(held('[[K3M9X2PQ7ABC]]', 'k3m9x2pq7abc')).toBe(true)
    expect(held('/vault/home-k3m9x2pq7abc.md', 'k3m9x2pq7abc')).toBe(true)
    expect(held('k3m9x2pq7ab', 'k3m9x2pq7abc')).toBe(false)
  })

  it('a text that can hold no ID gives no test at all, so a search by title costs nothing more (S78)', () => {
    for (const text of ['', 'plan', 'meeting notes', 'q3', 'a-1', 'abcdef-12']) expect(holdsId(text)).toBeNull()
  })
})
