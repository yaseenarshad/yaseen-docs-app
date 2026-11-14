import { describe, expect, it } from 'vitest'
import { memoryBackend, openVaultStore } from '../store'
import { UNIT_WORD_PATH, readUnitWord } from './unitWord'

describe("readUnitWord: the vault's word for page, with the Mac's own helper (round 15, item 5)", () => {
  const V = 'yaseen/vault@main'
  const withFile = async (content: string | null) => {
    const store = await openVaultStore(memoryBackend())
    if (content !== null) await store.write(V, UNIT_WORD_PATH, content)
    return readUnitWord(store, V)
  }

  it('reads .yaseendocs/unit-word.json', () => {
    expect(UNIT_WORD_PATH).toBe('.yaseendocs/unit-word.json')
  })

  it('"page" with no file, a file that does not parse, or the default word', async () => {
    for (const content of [null, '{oops', JSON.stringify({ unit: 'page' })]) expect((await withFile(content))('Open page · 3 pages')).toBe('Open page · 3 pages')
  })

  it('Doc, Note and an own word, in every form; "card" never changes', async () => {
    expect((await withFile(JSON.stringify({ unit: 'doc' })))('Open page · Search pages · New card')).toBe('Open doc · Search docs · New card')
    expect((await withFile(JSON.stringify({ unit: 'own', own: { one: 'Entry', many: 'Entries' } })))('Pages: one page')).toBe('Entries: one entry')
  })
})
