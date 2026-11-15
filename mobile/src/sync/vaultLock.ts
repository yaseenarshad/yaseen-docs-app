/*
 * The lock of a stored list (the answer list, the comment list), ONE copy. Its own small module: the
 * answer list is in the first load, and nothing more of the sync code comes with it.
 */

const pageQueues = new Map<string, Promise<unknown>>()

/**
 * `fn` under the Web Lock `<prefix>:<vault>`: one change of the list at a time, in every tab. Where Web Locks are
 * missing, one queue for each name in this page does it (two lists of one vault in one page, and the tests).
 */
export function vaultLock<T>(prefix: string, vault: string, fn: () => Promise<T>): Promise<T> {
  const name = `${prefix}:${vault}`
  const locks = (globalThis as { navigator?: { locks?: { request(name: string, fn: () => Promise<T>): Promise<T> } } }).navigator?.locks
  if (locks !== undefined) return locks.request(name, fn)
  const run = (pageQueues.get(name) ?? Promise.resolve()).then(fn, fn)
  const settled = run.catch(() => undefined)
  pageQueues.set(name, settled)
  void settled.then(() => {
    if (pageQueues.get(name) === settled) pageQueues.delete(name)
  })
  return run
}
