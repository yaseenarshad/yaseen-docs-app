/** The Web Locks of the browser; missing in an old browser and in Node (the tests). */
type Locks = { request<T>(name: string, fn: () => Promise<T>): Promise<T> }
const browserLocks = (): Locks | undefined => (globalThis as { navigator?: { locks?: Locks } }).navigator?.locks

/**
 * `fn` under the Web Lock `name`: one at a time in every tab of the app. Where Web Locks are missing, no lock. The ONE
 * copy for the sync engine and the friends code; the stored lists use `vaultLock` (`vaultLock.ts`).
 */
export function webLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks = browserLocks()
  return locks === undefined ? fn() : locks.request(name, fn)
}
