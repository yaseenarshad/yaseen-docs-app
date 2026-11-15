import type { Clock } from './engine'

/** The browser's clock and timers: what each part takes when its options give no `clock` (tests give a fake one). */
export const browserClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
}

type Locks = { request<T>(name: string, fn: () => Promise<T>): Promise<T> }
const locksOf = (): Locks | undefined => (globalThis as { navigator?: { locks?: Locks } }).navigator?.locks

/** `fn` under the Web Lock `name`: one at a time in every tab of the app. Where Web Locks are missing, no lock. */
export function webLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks = locksOf()
  return locks === undefined ? fn() : locks.request(name, fn)
}

/**
 * `fn` under the Web Lock `<prefix>:<vault>`, as `webLock`. Where Web Locks are missing, one queue for each name in
 * this page does it (two lists of one vault in one page, and the tests): a change of a stored list never runs beside
 * another one.
 */
const pageQueues = new Map<string, Promise<unknown>>()
export function vaultLock<T>(prefix: string, vault: string, fn: () => Promise<T>): Promise<T> {
  const name = `${prefix}:${vault}`
  const locks = locksOf()
  if (locks !== undefined) return locks.request(name, fn)
  const run = (pageQueues.get(name) ?? Promise.resolve()).then(fn, fn)
  const settled = run.catch(() => undefined)
  pageQueues.set(name, settled)
  void settled.then(() => {
    if (pageQueues.get(name) === settled) pageQueues.delete(name)
  })
  return run
}
