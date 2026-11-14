import type { FriendsPort } from '../app/friendsPort'
import { localFriends } from '../app/friendsPort'
import { IDLE, type ShellSync, type ShellSyncEvent, type ShellSyncState } from '../app/syncPort'
import { ScanError, type ScanProblem, type Scanner } from '../scan/scanner'
import { vaultId, type PhoneVault, type VaultStore } from '../store'

/**
 * Fakes of the shell's services, for the tests and the screen fixtures (`fixtures.tsx`). They never touch the network,
 * the camera or the clock. Only tests and the `--mode fixtures` build reach this file.
 */

export interface FakeSync extends ShellSync {
  /** Every `open` call, in order. */
  opened: (PhoneVault | null)[]
  syncNowCalls: number
  /** A pass that "runs": `idle()` waits for it. Tests set it and resolve it. */
  running: Promise<void> | null
  /** Changes the state and tells the listeners, as 3B's engine does. */
  set(next: Partial<ShellSyncState>): void
  emit(event: ShellSyncEvent): void
}

/**
 * `download: false` (default): a vault opens ready (a whole copy on the phone). `download: true`: a vault opens with its first
 * download running (row F2); the test moves it with `set`.
 */
export function fakeSync(options: { download?: boolean } = {}): FakeSync {
  let state: ShellSyncState = IDLE
  const listeners = new Set<(event: ShellSyncEvent) => void>()
  const sync: FakeSync = {
    opened: [],
    syncNowCalls: 0,
    running: null,
    state: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    async open(vault) {
      sync.opened.push(vault)
      if (vault === null) sync.set(IDLE)
      else if (options.download) sync.set({ status: 'syncing', vault: vaultId(vault), problem: null, retryAt: null, progress: null, ready: false })
      else sync.set({ status: 'synced', vault: vaultId(vault), problem: null, retryAt: null, progress: null, ready: true })
    },
    async syncNow() {
      sync.syncNowCalls++
    },
    idle: () => sync.running ?? Promise.resolve(),
    set(next) {
      state = { ...state, ...next }
      sync.emit({ type: 'state', state })
    },
    emit(event) {
      for (const listener of [...listeners]) listener(event)
    },
  }
  return sync
}

export interface FakeScanner extends Scanner {
  /** The camera is on (started, not stopped). */
  on: boolean
  /** The camera "reads" a code with this text. */
  read(text: string): void
  /** The next start fails with this problem. */
  failWith: ScanProblem | null
}

export function fakeScanner(): FakeScanner {
  let onText: ((text: string) => void) | null = null
  const scanner: FakeScanner = {
    on: false,
    failWith: null,
    async start(_video, listener) {
      if (scanner.failWith !== null) throw new ScanError(scanner.failWith)
      onText = listener
      scanner.on = true
      return {
        stop() {
          scanner.on = false
          onText = null
        },
      }
    },
    read(text) {
      onText?.(text)
    },
  }
  return scanner
}

/** Friends with the settings on the phone, and `hasFriends` as given (decision 21's two cases). */
export function fakeFriends(store: VaultStore, hasFriends: boolean): FriendsPort {
  return { ...localFriends(store), hasFriends: async () => hasFriends }
}
