import { describe, expect, it } from 'vitest'
import { READER_FILES, READER_ID, seedReaderVault } from '../dev/readerVault'
import { memoryBackend, openVaultStore, tokenStoreOn } from '../store'
import { INDEX_STATE } from '../sync/phoneIndex'
import { INDEX_STATE_NAME, loadVaultData } from './vaultData'

describe("what Search and the reader read of the open vault (YAZ-5079)", () => {
  it("reads 3B's stored index by 3B's own name", () => {
    expect(INDEX_STATE_NAME).toBe(INDEX_STATE)
  })

  it('pages and card files by path, the folder records apart, every file of the checkpoint, the letters, Review on', async () => {
    const backend = memoryBackend()
    const store = await openVaultStore(backend)
    await seedReaderVault(store, tokenStoreOn(backend), { ...READER_FILES, 'folder/.folder.md': '---\ntitle: A folder\n---\n' })
    const data = await loadVaultData(store, READER_ID, 'vault')
    expect(Object.keys(data.byPath)).toContain('cards/capital-of-spain-demo-40.md')
    expect(data.folders.map((f) => f.path)).toEqual(['folder/.folder.md'])
    expect(data.files).toContain('assets/plaza.png')
    expect(data.letters[0]).toBe('DEMO')
    expect(data.ids).toBe(true)
    expect(data.review.enabled).toBe(true)
  })

  it('no stored index yet (before the first download ends): no records, no error', async () => {
    const store = await openVaultStore(memoryBackend())
    const data = await loadVaultData(store, READER_ID, 'vault')
    expect(data.records).toEqual([])
    expect(data.commit).toBeNull()
    // No review.json: Review is on, as on the Mac.
    expect(data.review.enabled).toBe(true)
  })
})
