/** The phone's storage (YAZ-5071 3A). Screens and the sync import from here; only this folder touches browser storage. */
import { idbBackend } from './idbBackend'
import { tokenStoreOn, type TokenStore } from './tokenStore'
import { openVaultStore, type VaultStore } from './vaultStore'

export * from './vaultStore'
export * from './vaults'
export { askToKeepStorage, type KeepStorage } from './persist'
export { memoryBackend, newMemoryDisk } from './memoryBackend'
export { tokenStoreOn, type TokenStore } from './tokenStore'

/** The app's store: IndexedDB in this browser. */
export function openPhoneStore(): Promise<VaultStore> {
  return openVaultStore(idbBackend())
}

/** The app's store and its tokens (3E), on ONE IndexedDB connection, so "Sign out and erase" clears both. */
export async function openPhoneStorage(): Promise<{ store: VaultStore; tokens: TokenStore }> {
  const backend = idbBackend()
  return { store: await openVaultStore(backend), tokens: tokenStoreOn(backend) }
}
