import type { PhoneVault } from '../store'

/**
 * What the shell needs from the sync engine (3B, YAZ-5072). It is a structural subset of 3B's `SyncEngine`
 * (`mobile/src/sync/engine.ts`), so 3B's engine plugs in as it is (`lazySync.ts` loads it; `engineFits` checks the
 * fit). Tests pass `fakeSync` (`dev/fakes.ts`).
 */

/**
 * 3B's `SyncStatus`: `idle` no vault open, `syncing` a pass runs, `synced` green, `off` no connection, `slowed` GitHub
 * said "slow down" (until `retryAt`), `attention` the person must act (`problem` says why).
 */
export type ShellSyncStatus = 'idle' | 'syncing' | 'synced' | 'off' | 'slowed' | 'attention'

export interface ShellSyncState {
  status: ShellSyncStatus
  /** The open vault's id (`vaultId`), or null. */
  vault: string | null
  /** A `GithubErrorCode` (`UNAUTHORIZED`, `NOT_FOUND`, `NO_ACCESS`, `READ_ONLY`, `RATE_LIMITED`, `OFFLINE`, `GITHUB_DOWN`,
   *  `TREE_TRUNCATED`, …) or one of 3B's own (`NO_TOKEN`, `STORAGE_FULL`, `FAILED`). Never a message. */
  problem: string | null
  /** For `slowed`: when the engine tries again (ms since 1970). */
  retryAt: number | null
  /** For `syncing`: files done of files to get in this pass (round 10, item 8: the first-download bar). */
  progress: { done: number; total: number } | null
  /** The vault has a full copy on the phone. False until the first download ends: the shell shows the progress view. */
  ready: boolean
  /** The end of the last good pass (ms since 1970). A tap on the dot shows it (4D, decision 12). */
  lastSyncedAt?: number | null
}

/** The events the shell reads. 3B's `changed` event carries more (the diff, the index); the shell needs the settings files. */
export type ShellSyncEvent = { type: 'state'; state: ShellSyncState } | { type: 'changed'; vault: string; settings: string[] }

export interface ShellSync {
  state(): ShellSyncState
  subscribe(listener: (event: ShellSyncEvent) => void): () => void
  /** Opens a vault (or none). Only the open vault polls (decision 7). */
  open(vault: PhoneVault | null): Promise<void>
  /** A pass now ("Try again" on the download view). */
  syncNow(): Promise<void>
}

export const IDLE: ShellSyncState = Object.freeze({ status: 'idle', vault: null, problem: null, retryAt: null, progress: null, ready: false })
