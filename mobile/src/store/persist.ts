/** What the browser said when the app asked it to keep this site's storage. */
export type KeepStorage = 'kept' | 'not-kept' | 'unsupported'

/**
 * Asks the browser not to clear the stored vaults when the phone needs space: `navigator.storage.persist()`.
 * The app calls it at sign-in (3E). iOS has it since 15.2 and decides by its own rules (an app on the Home
 * Screen is one of them), so "not-kept" is a normal answer, and the app works the same. Never throws.
 */
export async function askToKeepStorage(storage: StorageManager | undefined = globalThis.navigator?.storage): Promise<KeepStorage> {
  if (typeof storage?.persist !== 'function') return 'unsupported'
  try {
    if (typeof storage.persisted === 'function' && (await storage.persisted())) return 'kept'
    return (await storage.persist()) ? 'kept' : 'not-kept'
  } catch {
    return 'unsupported'
  }
}
