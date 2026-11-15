/**
 * The vault's unit word (YAZ-4938): the helper's forms, the file's sanitising (an old vault with no file reads as
 * "note"), the round trip through `.yaseendocs/unit-word.json`, and the per-root store a menu or a toast reads.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { VaultConfigChange } from '@shared/types'
import { DEFAULT_UNIT_WORD, NOTE_WORD, SAME_WORD, UNIT_WORD_FILE, UNIT_WORDS, cleanOwnWord, sanitizeUnitWord, unitTextOf, unitWordOf, useVaultUnitWord, vaultUnit, type UnitWordState } from './unitWord'

let listeners: Array<(c: VaultConfigChange) => void> = []

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: {
    vaultConfig: {
      read: vi.fn(),
      write: vi.fn(),
      onChange: vi.fn((l: (c: VaultConfigChange) => void) => {
        listeners.push(l)
        return () => (listeners = listeners.filter((x) => x !== l))
      }),
    },
  },
}))

import { api } from '../api'

const read = vi.mocked(api.vaultConfig.read)
const write = vi.mocked(api.vaultConfig.write)

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

describe('the helper', () => {
  const card = unitTextOf(UNIT_WORDS.card)

  it('gives each label its word in the form of its place', () => {
    expect(card('New note')).toBe('New card')
    expect(card('Delete note…')).toBe('Delete card…')
    expect(card('Duplicate note')).toBe('Duplicate card')
    expect(card('12 notes')).toBe('12 cards')
    expect(card('No notes yet')).toBe('No cards yet')
    expect(card('Links in 2 notes will be updated.')).toBe('Links in 2 cards will be updated.')
    expect(card('Note')).toBe('Card')
    expect(card('Notes you close show here.')).toBe('Cards you close show here.')
    expect(card("This note's folder")).toBe("This card's folder")
    expect(card("Keep the notes' values")).toBe("Keep the cards' values")
  })

  it('leaves other words, code names and the word inside another alone', () => {
    expect(card('Linked mentions')).toBe('Linked mentions')
    expect(card('Noted. Notebook, footnote, notes.md')).toBe('Noted. Notebook, footnote, cards.md')
    expect(card('note-window')).toBe('card-window')
  })

  it('the default word is the identity, one object for the app, and a word that spells it too', () => {
    expect(unitTextOf(NOTE_WORD)).toBe(SAME_WORD)
    expect(unitTextOf({ one: 'note', many: 'notes' })).toBe(SAME_WORD)
    expect(SAME_WORD('New note')).toBe('New note')
  })

  it('an own word keeps its capitals as typed: "Entry" lowers mid-sentence, "SOP" stays', () => {
    const entry = unitTextOf(unitWordOf({ unit: 'own', own: { one: 'Entry', many: 'Entries' } }))
    expect(entry('New note')).toBe('New entry')
    expect(entry('Note')).toBe('Entry')
    expect(entry('Delete this note')).toBe('Delete this entry')
    expect(entry('12 notes')).toBe('12 entries')
    const sop = unitTextOf(unitWordOf({ unit: 'own', own: { one: 'SOP', many: 'SOPs' } }))
    expect(sop('New note')).toBe('New SOP')
    expect(sop('Delete this note')).toBe('Delete this SOP')
    expect(sop('12 notes')).toBe('12 SOPs')
  })
})

describe('the file', () => {
  it('an old vault (no file), junk, or an unknown unit reads as "note"', () => {
    expect(sanitizeUnitWord(null)).toEqual(DEFAULT_UNIT_WORD)
    expect(sanitizeUnitWord(undefined)).toEqual(DEFAULT_UNIT_WORD)
    expect(sanitizeUnitWord('card')).toEqual(DEFAULT_UNIT_WORD)
    expect(sanitizeUnitWord({ unit: 'slide' })).toEqual(DEFAULT_UNIT_WORD)
    expect(unitWordOf(sanitizeUnitWord(null))).toBe(NOTE_WORD)
  })

  it('the built-in words', () => {
    expect(unitWordOf(sanitizeUnitWord({ unit: 'card' }))).toEqual({ one: 'card', many: 'cards' })
    expect(unitWordOf(sanitizeUnitWord({ unit: 'doc' }))).toEqual({ one: 'doc', many: 'docs' })
    expect(unitWordOf(sanitizeUnitWord({ unit: 'page' }))).toEqual({ one: 'page', many: 'pages' })
  })

  it('an own word is one word; its plural defaults to word + s; an own choice with no word yet keeps, and reads as "note"', () => {
    expect(sanitizeUnitWord({ unit: 'own', own: { one: ' Entry ', many: 'Entries' } })).toEqual({ unit: 'own', own: { one: 'Entry', many: 'Entries' } })
    expect(sanitizeUnitWord({ unit: 'own', own: { one: 'Zettel' } })).toEqual({ unit: 'own', own: { one: 'Zettel', many: 'Zettels' } })
    expect(sanitizeUnitWord({ unit: 'own', own: { one: 'two words' } })).toEqual({ unit: 'own', own: { one: '', many: '' } })
    expect(sanitizeUnitWord({ unit: 'own', own: { one: '' } })).toEqual({ unit: 'own', own: { one: '', many: '' } })
    expect(unitWordOf(sanitizeUnitWord({ unit: 'own' }))).toBe(NOTE_WORD)
    expect(sanitizeUnitWord({ unit: 'card', own: { one: 'Entry', many: 'two words' } })).toEqual({ unit: 'card', own: { one: 'Entry', many: 'Entrys' } })
    expect(cleanOwnWord('a'.repeat(25))).toBe('')
    expect(cleanOwnWord('a'.repeat(24))).toBe('a'.repeat(24))
    expect(cleanOwnWord('to-do')).toBe('to-do')
    expect(cleanOwnWord('[[x]]')).toBe('')
  })
})

describe('useVaultUnitWord', () => {
  let root: Root | null = null
  let state: UnitWordState

  function Probe({ vault }: { vault: string | null }) {
    state = useVaultUnitWord(vault)
    return null
  }

  async function mount(vault: string | null): Promise<void> {
    root = createRoot(document.createElement('div'))
    await act(async () => root?.render(<Probe vault={vault} />))
  }

  const changed = (change: VaultConfigChange) => act(async () => listeners.forEach((l) => l(change)))

  beforeEach(() => {
    listeners = []
    read.mockReset().mockResolvedValue(null)
    write.mockReset().mockResolvedValue(undefined)
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = null
  })

  it('no file: "note", the identity helper, nothing written; no vault: no read', async () => {
    await mount('/vault')
    expect(read).toHaveBeenCalledWith('/vault', UNIT_WORD_FILE)
    expect(state.settings).toEqual(DEFAULT_UNIT_WORD)
    expect(state.word).toBe(NOTE_WORD)
    expect(state.unit).toBe(SAME_WORD)
    expect(write).not.toHaveBeenCalled()
    act(() => root?.unmount())
    read.mockClear()
    await mount(null)
    expect(read).not.toHaveBeenCalled()
    expect(state.unit).toBe(SAME_WORD)
  })

  it('the round trip: save writes the clean file, the helper follows, and the store answers for the root', async () => {
    await mount('/vault')
    await act(async () => state.save({ unit: 'card', own: { one: '', many: '' } }))
    expect(write).toHaveBeenCalledWith('/vault', UNIT_WORD_FILE, { unit: 'card', own: { one: '', many: '' } })
    expect(state.unit('New note')).toBe('New card')
    expect(vaultUnit('/vault')('12 notes')).toBe('12 cards')
    expect(vaultUnit('/other')).toBe(SAME_WORD)
    expect(vaultUnit(null)).toBe(SAME_WORD)
    // The file read back from disk (an old vault, another Mac's sync): the word follows it, read once per change.
    read.mockResolvedValue({ unit: 'page' })
    await changed({ root: '/vault', name: UNIT_WORD_FILE })
    expect(state.unit('New note')).toBe('New page')
    expect(read).toHaveBeenCalledTimes(2)
    await changed({ root: '/elsewhere', name: UNIT_WORD_FILE })
    await changed({ root: '/vault', name: 'link-click.json' })
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('the slot that loses its vault empties the store', async () => {
    read.mockResolvedValue({ unit: 'doc' })
    await mount('/vault')
    expect(vaultUnit('/vault')('note')).toBe('doc')
    act(() => root?.unmount())
    root = null
    expect(vaultUnit('/vault')).toBe(SAME_WORD)
  })
})
