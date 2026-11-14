import type { FetchLike } from '../github/client'
import { loadVaultList, type VaultStore } from '../store'

/**
 * The erase guard of the friends code (YAZ-5195). After "Sign out and erase this phone" (or a stop of the sender or
 * the list), no friends request starts, a running one is aborted, and nothing of the friends state is stored again:
 * the login, the name and the numbers must not come back to the phone (row N7).
 * - `stop()` aborts each request in flight (an `AbortSignal` on the request) and refuses the next ones. The app calls
 *   it, or aborts the `signal` it passed, BEFORE `eraseAll`.
 * - Without that call, `live()` still finds the erase: the vault list is gone. Then nothing is stored and no request
 *   starts. A write already in flight cannot be called back; its result is dropped.
 */
export interface FriendsGuard {
  fetch: FetchLike
  /** The phone is still signed in and the guard is not stopped: a write of friends state may go on. */
  live(): Promise<boolean>
  stop(): void
  readonly stopped: boolean
}

export function friendsGuard(store: VaultStore, base: FetchLike | undefined, signal?: AbortSignal): FriendsGuard {
  const controller = new AbortController()
  const send: FetchLike = base ?? ((url, init) => globalThis.fetch(url, init))
  const guard: FriendsGuard = {
    get stopped() {
      return controller.signal.aborted
    },
    stop: () => controller.abort(),
    async live() {
      if (controller.signal.aborted) return false
      try {
        return (await loadVaultList(store)).vaults.length > 0
      } catch {
        return false
      }
    },
    async fetch(url, init) {
      // A TypeError reads as "no connection" in the 3E client: quiet, and nothing is stored after it.
      if (!(await guard.live())) throw new TypeError('Friends stopped: the phone was erased or signed out')
      const signals = [init.signal, controller.signal].filter((s): s is AbortSignal => s instanceof AbortSignal)
      const both = signals.length > 1 && typeof AbortSignal.any === 'function' ? AbortSignal.any(signals) : controller.signal
      return send(url, { ...init, signal: both })
    },
  }
  if (signal !== undefined) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', () => controller.abort(), { once: true })
  }
  return guard
}
