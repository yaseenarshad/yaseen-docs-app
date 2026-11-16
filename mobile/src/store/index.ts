/** The phone's storage (YAZ-5071 3A). Screens and the sync import from here; only this folder touches browser storage. */
import { idbBackend, type CallWatcher } from './idbBackend'
import { tokenStoreOn, type TokenStore, type TokenStoreOptions } from './tokenStore'
import { openVaultStore, type VaultStore } from './vaultStore'

export * from './vaultStore'
export * from './vaults'
export { askToKeepStorage, type KeepStorage } from './persist'
export { memoryBackend, newMemoryDisk } from './memoryBackend'
export { tokenStoreOn, type GithubPair, type TokenStore, type TokenStoreOptions } from './tokenStore'
export { StorageTimeoutError, isStorageTimeout } from './backend'

/** The app's store and its tokens (3E), on ONE IndexedDB connection, so "Sign out and erase" clears both. */
export async function openPhoneStorage(onCall?: CallWatcher, tokenOptions?: TokenStoreOptions): Promise<{ store: VaultStore; tokens: TokenStore }> {
  const backend = idbBackend({ onCall })
  return { store: await openVaultStore(backend), tokens: tokenStoreOn(backend, tokenOptions) }
}
