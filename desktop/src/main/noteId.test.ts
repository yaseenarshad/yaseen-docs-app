import { describe, expect, it } from 'vitest'
import { IDS_FILE, NOTE_ID_KEY, idsAnswer, isNoteId, mintNoteId } from '@shared/noteId'

describe('note ids (YAZ-2293 D2)', () => {
  it('the frontmatter key is `id`', () => {
    expect(NOTE_ID_KEY).toBe('id')
  })

  it('mints 12 lowercase characters that always pass isNoteId, and never the same twice', () => {
    const ids = Array.from({ length: 2000 }, () => mintNoteId())
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-hjkmnp-tv-z]{12}$/)
      expect(id).toMatch(/\d/)
      expect(isNoteId(id)).toBe(true)
    }
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('accepts only that shape', () => {
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
  })
})

describe("a vault's answer to IDs (YAZ-2523 V1)", () => {
  it('is kept in `ids.json`', () => {
    expect(IDS_FILE).toBe('ids.json')
  })

  it('is the `enabled` boolean of the file; a missing file, a file that says nothing, or one that says something else is not answered', () => {
    expect(idsAnswer({ enabled: true })).toBe(true)
    expect(idsAnswer({ enabled: false })).toBe(false)
    for (const config of [null, undefined, {}, { enabled: 'yes' }, { enabled: 1 }, { enabled: null }, [], 'true', true]) expect(idsAnswer(config)).toBeUndefined()
  })
})
