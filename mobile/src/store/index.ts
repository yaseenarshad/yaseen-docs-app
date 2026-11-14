/** The phone's storage (YAZ-5071 3A). Screens and the sync import from here; only this folder touches browser storage. */
import { idbBackend } from './idbBackend'
import { openVaultStore, type VaultStore } from './vaultStore'

export * from './vaultStore'
export * from './vaults'
export { askToKeepStorage, type KeepStorage } from './persist'
export { memoryBackend, newMemoryDisk } from './memoryBackend'

/** The app's store: IndexedDB in this browser. */
export function openPhoneStore(): Promise<VaultStore> {
  return openVaultStore(idbBackend())
}
