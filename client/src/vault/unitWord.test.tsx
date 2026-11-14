// rename-note-to-page: skip-file (it tests the word choice "Note")
/**
 * The vault's unit word (YAZ-4938): the helper's forms, the file's sanitising (an old vault with no file reads as
 * "page"), the round trip through `.yaseendocs/unit-word.json`, and the per-root store a menu or a toast reads.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { VaultConfigChange } from '@shared/types'
import { DEFAULT_UNIT_WORD, PAGE_WORD, SAME_WORD, UNIT_WORD_FILE, UNIT_WORDS, cleanOwnWord, sanitizeUnitWord, unitTextOf, unitWordOf, useVaultUnitWord, vaultUnit, type UnitWordState } from './unitWord'

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
  const doc = unitTextOf(UNIT_WORDS.doc)

  it('gives each label its word in the form of its place', () => {
    expect(doc('New page')).toBe('New doc')
    expect(doc('Delete page…')).toBe('Delete doc…')
    expect(doc('Duplicate page')).toBe('Duplicate doc')
    expect(doc('12 pages')).toBe('12 docs')
    expect(doc('No pages yet')).toBe('No docs yet')
    expect(doc('Links in 2 pages will be updated.')).toBe('Links in 2 docs will be updated.')
    expect(doc('Page')).toBe('Doc')
    expect(doc('Pages you close show here.')).toBe('Docs you close show here.')
    expect(doc("This page's folder")).toBe("This doc's folder")
    expect(doc("Keep the pages' values")).toBe("Keep the docs' values")
  })

  it('leaves other words, code names and the word inside another alone', () => {
    expect(doc('Linked mentions')).toBe('Linked mentions')
    expect(doc('Noted. Notebook, footnote, pages.md')).toBe('Noted. Notebook, footnote, docs.md')
    expect(doc('page-window')).toBe('doc-window')
  })

  it('YAZ-5036: a page that is not the unit keeps its word: a folder page, the Start page, the New tab page, a Page tab', () => {
    expect(doc('Only in the pages. This folder page has no column for it.')).toBe('Only in the docs. This folder page has no column for it.')
    expect(doc('No folder pages here')).toBe('No folder pages here')
    expect(doc('Back to the Start page')).toBe('Back to the Start page')
    expect(doc('New tab page')).toBe('New tab page')
    expect(doc('Page tab')).toBe('Page tab')
  })

  it('YAZ-5036: "Note" is still a choice, for a vault that wants it', () => {
    const note = unitTextOf(UNIT_WORDS.note)
    expect(note('New page')).toBe('New note')
    expect(note('12 pages')).toBe('12 notes')
    expect(note('Page')).toBe('Note')
  })

  it('the default word is the identity, one object for the app, and a word that spells it too', () => {
    expect(unitTextOf(PAGE_WORD)).toBe(SAME_WORD)
    expect(unitTextOf({ one: 'page', many: 'pages' })).toBe(SAME_WORD)
    expect(SAME_WORD('New page')).toBe('New page')
  })

  it('an own word keeps its capitals as typed: "Entry" lowers mid-sentence, "SOP" stays', () => {
    const entry = unitTextOf(unitWordOf({ unit: 'own', own: { one: 'Entry', many: 'Entries' } }))
    expect(entry('New page')).toBe('New entry')
    expect(entry('Page')).toBe('Entry')
    expect(entry('Delete this page')).toBe('Delete this entry')
    expect(entry('12 pages')).toBe('12 entries')
    const sop = unitTextOf(unitWordOf({ unit: 'own', own: { one: 'SOP', many: 'SOPs' } }))
    expect(sop('New page')).toBe('New SOP')
    expect(sop('Delete this page')).toBe('Delete this SOP')
    expect(sop('12 pages')).toBe('12 SOPs')
  })
})

describe('the file', () => {
  it('an old vault (no file), junk, or an unknown unit reads as "page"', () => {
    expect(sanitizeUnitWord(null)).toEqual(DEFAULT_UNIT_WORD)
    expect(sanitizeUnitWord(undefined)).toEqual(DEFAULT_UNIT_WORD)
    expect(sanitizeUnitWord('card')).toEqual(DEFAULT_UNIT_WORD)
    // YAZ-5036: "Card" is no choice any more; a file that says it reads as the default.
    expect(sanitizeUnitWord({ unit: 'card' })).toEqual(DEFAULT_UNIT_WORD)
    expect(sanitizeUnitWord({ unit: 'slide' })).toEqual(DEFAULT_UNIT_WORD)
    expect(unitWordOf(sanitizeUnitWord(null))).toBe(PAGE_WORD)
  })

  it('the built-in words', () => {
    expect(unitWordOf(sanitizeUnitWord({ unit: 'note' }))).toEqual({ one: 'note', many: 'notes' })
    expect(unitWordOf(sanitizeUnitWord({ unit: 'doc' }))).toEqual({ one: 'doc', many: 'docs' })
    expect(unitWordOf(sanitizeUnitWord({ unit: 'page' }))).toEqual({ one: 'page', many: 'pages' })
  })

  it('an own word is one word; its plural defaults to word + s; an own choice with no word yet keeps, and reads as "page"', () => {
    expect(sanitizeUnitWord({ unit: 'own', own: { one: ' Entry ', many: 'Entries' } })).toEqual({ unit: 'own', own: { one: 'Entry', many: 'Entries' } })
    expect(sanitizeUnitWord({ unit: 'own', own: { one: 'Zettel' } })).toEqual({ unit: 'own', own: { one: 'Zettel', many: 'Zettels' } })
    expect(sanitizeUnitWord({ unit: 'own', own: { one: 'two words' } })).toEqual({ unit: 'own', own: { one: '', many: '' } })
    expect(sanitizeUnitWord({ unit: 'own', own: { one: '' } })).toEqual({ unit: 'own', own: { one: '', many: '' } })
    expect(unitWordOf(sanitizeUnitWord({ unit: 'own' }))).toBe(PAGE_WORD)
    expect(sanitizeUnitWord({ unit: 'doc', own: { one: 'Entry', many: 'two words' } })).toEqual({ unit: 'doc', own: { one: 'Entry', many: 'Entrys' } })
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

  it('no file: "page", the identity helper, nothing written; no vault: no read', async () => {
    await mount('/vault')
    expect(read).toHaveBeenCalledWith('/vault', UNIT_WORD_FILE)
    expect(state.settings).toEqual(DEFAULT_UNIT_WORD)
    expect(state.word).toBe(PAGE_WORD)
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
    await act(async () => state.save({ unit: 'doc', own: { one: '', many: '' } }))
    expect(write).toHaveBeenCalledWith('/vault', UNIT_WORD_FILE, { unit: 'doc', own: { one: '', many: '' } })
    expect(state.unit('New page')).toBe('New doc')
    expect(vaultUnit('/vault')('12 pages')).toBe('12 docs')
    expect(vaultUnit('/other')).toBe(SAME_WORD)
    expect(vaultUnit(null)).toBe(SAME_WORD)
    // The file read back from disk (an old vault, another Mac's sync): the word follows it, read once per change.
    read.mockResolvedValue({ unit: 'page' })
    await changed({ root: '/vault', name: UNIT_WORD_FILE })
    expect(state.unit('New page')).toBe('New page')
    expect(read).toHaveBeenCalledTimes(2)
    await changed({ root: '/elsewhere', name: UNIT_WORD_FILE })
    await changed({ root: '/vault', name: 'link-click.json' })
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('the slot that loses its vault empties the store', async () => {
    read.mockResolvedValue({ unit: 'doc' })
    await mount('/vault')
    expect(vaultUnit('/vault')('page')).toBe('doc')
    act(() => root?.unmount())
    root = null
    expect(vaultUnit('/vault')).toBe(SAME_WORD)
  })
})
