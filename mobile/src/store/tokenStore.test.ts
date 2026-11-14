import 'fake-indexeddb/auto'
import { IDBKeyRange, indexedDB } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { idbBackend } from './idbBackend'
import { memoryBackend, newMemoryDisk } from './memoryBackend'
import type { Backend } from './backend'
import { TOKEN_STATE, tokenStoreOn } from './tokenStore'
import { PHONE, openVaultStore } from './vaultStore'

const TOKEN_A = 'github_pat_11AAAAAAA0aaaaaaaaaaaa_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const TOKEN_B = 'github_pat_11BBBBBBB0bbbbbbbbbbbb_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

let dbCount = 0
const backends: [string, () => Backend][] = [
  ['memory', () => memoryBackend()],
  ['IndexedDB', () => idbBackend({ name: `token-test-${dbCount++}`, factory: indexedDB, keyRange: IDBKeyRange })],
]

describe.each(backends)('TokenStore on %s (one token for each vault, decision 7)', (_, make) => {
  it('reads null when the vault has no token (row F1)', async () => {
    const tokens = tokenStoreOn(make())
    expect(await tokens.read('a/one@main')).toBeNull()
  })

  it('keeps one token for each vault, and a write replaces the old one (row N6: sign in again)', async () => {
    const tokens = tokenStoreOn(make())
    await tokens.write('a/one@main', TOKEN_A)
    await tokens.write('b/two@main', TOKEN_B)
    expect(await tokens.read('a/one@main')).toBe(TOKEN_A)
    expect(await tokens.read('b/two@main')).toBe(TOKEN_B)
    await tokens.write('a/one@main', TOKEN_B)
    expect(await tokens.read('a/one@main')).toBe(TOKEN_B)
  })

  it('clear removes the token of one vault only', async () => {
    const tokens = tokenStoreOn(make())
    await tokens.write('a/one@main', TOKEN_A)
    await tokens.write('b/two@main', TOKEN_B)
    await tokens.clear('a/one@main')
    expect(await tokens.read('a/one@main')).toBeNull()
    expect(await tokens.read('b/two@main')).toBe(TOKEN_B)
  })

  it('clearAll removes every token (row N7)', async () => {
    const tokens = tokenStoreOn(make())
    await tokens.write('a/one@main', TOKEN_A)
    await tokens.write('b/two@main', TOKEN_B)
    await tokens.clearAll()
    expect(await tokens.read('a/one@main')).toBeNull()
    expect(await tokens.read('b/two@main')).toBeNull()
  })

  it('a token is never readable as phone-only state, and phone-only state never sees it', async () => {
    const backend = make()
    const store = await openVaultStore(backend)
    const tokens = tokenStoreOn(backend)
    await tokens.write('a/one@main', TOKEN_A)
    await store.setState('a/one@main', 'answers', [1])
    await expect(store.getState('a/one@main', TOKEN_STATE)).rejects.toThrow(/TokenStore/)
    await expect(store.setState('a/one@main', TOKEN_STATE, 'x')).rejects.toThrow(/TokenStore/)
    await expect(store.removeState('a/one@main', TOKEN_STATE)).rejects.toThrow(/TokenStore/)
    expect(await store.getState('a/one@main', 'answers')).toEqual([1])
    // "Reset local copy" (P5) keeps the token: the vault stays signed in.
    await store.resetCopy('a/one@main')
    expect(await tokens.read('a/one@main')).toBe(TOKEN_A)
    // eraseAll (N7) of the store removes the tokens too, as they are on the same phone.
    await store.eraseAll()
    expect(await tokens.read('a/one@main')).toBeNull()
    expect(await store.getState(PHONE, 'vaults')).toBeUndefined()
  })

  it('removing a vault from the phone removes its token', async () => {
    const backend = make()
    const store = await openVaultStore(backend)
    const tokens = tokenStoreOn(backend)
    await tokens.write('a/one@main', TOKEN_A)
    await tokens.write('b/two@main', TOKEN_B)
    await store.removeVault('a/one@main')
    expect(await tokens.read('a/one@main')).toBeNull()
    expect(await tokens.read('b/two@main')).toBe(TOKEN_B)
  })
})

describe('TokenStore on a phone that starts again', () => {
  it('a token written before a restart is read after it', async () => {
    const disk = newMemoryDisk()
    await tokenStoreOn(memoryBackend(disk)).write('a/one@main', TOKEN_A)
    expect(await tokenStoreOn(memoryBackend(disk)).read('a/one@main')).toBe(TOKEN_A)
  })

  it('a format change (row P3) keeps the tokens: the vaults stay signed in', async () => {
    const disk = newMemoryDisk()
    await openVaultStore(memoryBackend(disk), { format: 1 })
    await tokenStoreOn(memoryBackend(disk)).write('a/one@main', TOKEN_A)
    const again = await openVaultStore(memoryBackend(disk), { format: 2 })
    expect(again.formatReset).toBe(true)
    expect(await tokenStoreOn(memoryBackend(disk)).read('a/one@main')).toBe(TOKEN_A)
  })
})
