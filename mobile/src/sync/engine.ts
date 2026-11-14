import { GithubError, SECONDARY_LIMIT_WAIT_MS, githubClient, type GithubErrorCode } from '../github/client'
import { StorageFullError, vaultId, type PhoneVault, type StoredFile, type TokenStore, type VaultStore } from '../store'
import { POLL_MS } from './cadence'
import { githubRemote, type GithubRemote } from './githubRemote'
import { syncPass, type PassProgress } from './pass'
import { INDEX_STATE, type PhoneIndex } from './phoneIndex'
import { isEager, type TreeDiff } from './plan'
import { yieldToUi as defaultYield } from './yieldToUi'

/** The timers the engine uses. The app passes the browser's; tests pass a fake clock. */
export interface Clock {
  now(): number
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

/**
 * The engine's status, for the dot of 4D (decision 12; round 10 item 20):
 * - `idle`: no vault is open.
 * - `syncing`: a pass runs (blue). During a first download, `progress` has files done of files to get (4A).
 * - `synced`: the last pass ended well (green).
 * - `off`: no connection, or GitHub is down (grey, N1, N2, N5). It tries again at the next tick. No pop-up.
 * - `slowed`: GitHub said "slow down" (the hourly limit, or the secondary limit). It waits until `retryAt` (amber, N4).
 * - `attention`: it cannot sync until the person acts (red): the token is wrong or cancelled (N6), the repo or branch is
 *   gone (R12), the file list is cut short (F6), the phone is full, or no token. Polling stops; the local copy stays.
 * The answer list's amber "waiting" state is 3C's (`pending`); 4D combines both.
 */
export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'off' | 'slowed' | 'attention'

/** Why the status is not green. A `GithubErrorCode`, or one of the engine's own. Never a message with a secret. */
export type SyncProblem = GithubErrorCode | 'NO_TOKEN' | 'STORAGE_FULL' | 'FAILED'

export interface SyncState {
  status: SyncStatus
  /** The open vault's id, or null. */
  vault: string | null
  problem: SyncProblem | null
  /** For `slowed`: when the engine tries again (ms since 1970). */
  retryAt: number | null
  /** For `syncing`: the files of this pass. Null when nothing is to get. */
  progress: PassProgress | null
  /** The end of the last pass that reached GitHub (a 304 counts), from the clock. Null before the first. */
  lastSyncedAt: number | null
  /** The vault has a full copy on the phone. False until the first download ends (4A shows the progress screen). */
  ready: boolean
}

export type SyncEvent =
  | { type: 'state'; state: SyncState }
  /**
   * The open vault's files or index changed. `diff` names the files (R2–R6); `settings` the settings files (R13).
   * `diff` is null when the engine only loaded the stored index (on open, or another tab synced): read it all again.
   */
  | { type: 'changed'; vault: string; commit: string; diff: TreeDiff | null; settings: string[]; index: PhoneIndex }

export interface SyncEngineOptions {
  store: VaultStore
  tokens: TokenStore
  clock?: Clock
  /** The remote for a vault and its token. Default: `githubRemote` on 3E's `githubClient`. */
  makeRemote?: (vault: PhoneVault, token: string) => GithubRemote
  /**
   * Runs `fn` while this tab holds the named lock (row P4: one tab syncs at a time). Default: the Web Locks API
   * (`navigator.locks`), else no lock.
   */
  lock?: <T>(name: string, fn: () => Promise<T>) => Promise<T>
  yieldToUi?: () => Promise<void>
  /** 3D's hook, passed to each pass. */
  alsoEager?: (path: string) => boolean
}

export interface SyncEngine {
  state(): SyncState
  /** The open vault's index, or null when it has none yet. */
  index(): PhoneIndex | null
  subscribe(listener: (event: SyncEvent) => void): () => void
  /** Opens a vault (or none): its stored index first, then one pass at once. Only the open vault polls (decision 7). */
  open(vault: PhoneVault | null): Promise<void>
  /** The page became visible or hidden. Hidden: no polling (R9). Visible: one pass at once (R10). */
  setVisible(visible: boolean): void
  /** The connection came back: one pass at once. */
  online(): void
  /** Pull to refresh, and the app's own calls: a pass now, or the running pass (a request during a pass joins it). */
  syncNow(): Promise<void>
  /** Resolves when no pass runs. */
  idle(): Promise<void>
  /**
   * A file of the open vault: the stored copy, or, the first time it shows, a download by the checkpoint's SHA that is
   * then kept (a picture or a sound: decision 6). Null when the vault has no such file.
   */
  file(path: string): Promise<StoredFile | null>
  /**
   * Runs `fn` with the open vault's remote, between passes and under the same lock (3C: the send of the answer list).
   * After `fn`, call `syncNow()` to take in the new head.
   */
  lane<T>(fn: (remote: GithubRemote) => Promise<T>): Promise<T>
  /** Stops the timers and the polling. */
  stop(): void
}

const browserClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
}

function webLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks = (globalThis as { navigator?: { locks?: { request(name: string, fn: () => Promise<T>): Promise<T> } } }).navigator?.locks
  return locks === undefined ? fn() : locks.request(name, fn)
}

/** The lock name of a vault: two tabs of the app share it, so only one of them runs a pass of that vault at a time. */
export const lockName = (vault: string) => `notecards-sync:${vault}`

const ATTENTION: readonly SyncProblem[] = ['UNAUTHORIZED', 'NOT_FOUND', 'NO_ACCESS', 'READ_ONLY', 'TREE_TRUNCATED', 'NO_TOKEN', 'STORAGE_FULL']

/**
 * The sync engine of the open vault (October 2E; decisions 4, 6, 7; round 10 items 8 and 20). It decides WHEN a pass
 * runs, runs one at a time, keeps the status for 4D, and tells the screens what changed. The pass itself is `syncPass`.
 */
export function createSyncEngine(options: SyncEngineOptions): SyncEngine {
  const { store, tokens } = options
  const clock = options.clock ?? browserClock
  const lock = options.lock ?? webLock
  const makeRemote = options.makeRemote ?? ((vault, token) => githubRemote(githubClient(token), vault.repo, vault.branch))
  const listeners = new Set<(event: SyncEvent) => void>()

  let vault: PhoneVault | null = null
  /** Each `open` starts a new generation; a pass of an older one tells nobody and plans nothing. */
  let generation = 0
  let visible = true
  let current: PhoneIndex | null = null
  let running: Promise<void> | null = null
  let timer: unknown = null
  let state: SyncState = { status: 'idle', vault: null, problem: null, retryAt: null, progress: null, lastSyncedAt: null, ready: false }

  const emit = (event: SyncEvent) => {
    for (const listener of [...listeners]) listener(event)
  }
  const setState = (next: Partial<SyncState>) => {
    state = { ...state, ...next }
    emit({ type: 'state', state: { ...state } })
  }
  const clearTimer = () => {
    if (timer !== null) clock.clearTimeout(timer)
    timer = null
  }
  /** The next pass: at `at`, or after POLL_MS. Only while a vault is open and the page is visible. */
  const plan = (at?: number) => {
    clearTimer()
    if (vault === null || !visible) return
    const delay = Math.max(0, (at ?? clock.now() + POLL_MS) - clock.now())
    timer = clock.setTimeout(() => {
      timer = null
      void syncNow()
    }, delay)
  }

  async function loadIndex(id: string, gen: number) {
    const saved = await store.getState<PhoneIndex>(id, INDEX_STATE)
    const checkpoint = await store.checkpoint(id)
    if (gen !== generation) return
    // The stored index counts only with its checkpoint: a first download that stopped shows no partial vault (F5, F6).
    if (saved === undefined || checkpoint === null || saved.commit !== checkpoint.commit) return
    if (current?.commit === saved.commit) return
    current = saved
    setState({ ready: true })
    emit({ type: 'changed', vault: id, commit: saved.commit, diff: null, settings: [], index: saved })
  }

  async function runPass(gen: number) {
    const open = vault!
    const id = vaultId(open)
    const token = await tokens.read(id)
    if (gen !== generation) return
    if (token === null) {
      setState({ status: 'attention', problem: 'NO_TOKEN', retryAt: null, progress: null })
      return
    }
    setState({ status: 'syncing', progress: null })
    try {
      const result = await lock(lockName(id), () =>
        syncPass({
          remote: makeRemote(open, token),
          store,
          vault: id,
          now: clock.now,
          yieldToUi: options.yieldToUi ?? defaultYield,
          alsoEager: options.alsoEager,
          onProgress: (progress) => {
            if (gen === generation) setState({ progress })
          },
        }),
      )
      if (gen !== generation) return
      if (result.kind === 'synced') {
        current = result.index
        setState({ ready: true })
        emit({ type: 'changed', vault: id, commit: result.commit, diff: result.diff, settings: result.settings, index: result.index })
      } else await loadIndex(id, gen) // another tab may have synced this vault (P4)
      setState({ status: 'synced', problem: null, retryAt: null, progress: null, lastSyncedAt: clock.now() })
      plan()
    } catch (error) {
      if (gen !== generation) return
      const problem: SyncProblem = error instanceof GithubError ? error.code : error instanceof StorageFullError ? 'STORAGE_FULL' : 'FAILED'
      if (problem === 'RATE_LIMITED') {
        const retryAt = (error as GithubError).resetAt ?? clock.now() + SECONDARY_LIMIT_WAIT_MS
        setState({ status: 'slowed', problem, retryAt, progress: null })
        plan(retryAt)
      } else if (ATTENTION.includes(problem)) {
        setState({ status: 'attention', problem, retryAt: null, progress: null })
        clearTimer() // sync stops until the person acts (sign in again: 4A), or pulls to refresh
      } else {
        setState({ status: 'off', problem, retryAt: null, progress: null })
        plan()
      }
    }
  }

  function syncNow(): Promise<void> {
    if (running !== null) return running
    if (vault === null) return Promise.resolve()
    clearTimer()
    const gen = generation
    running = runPass(gen).finally(() => {
      running = null
    })
    return running
  }

  /** A pass at once, unless GitHub asked to wait: then at the time it gave. */
  const nowOrWhenAllowed = () => {
    if (state.status === 'slowed' && state.retryAt !== null && state.retryAt > clock.now()) plan(state.retryAt)
    else void syncNow()
  }

  return {
    state: () => ({ ...state }),
    index: () => current,
    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    async open(next) {
      generation++
      clearTimer()
      vault = next
      current = null
      const gen = generation
      // A pass of the vault that was open goes on to its end (its writes are its own vault's); nobody hears of it.
      if (running !== null) await running.catch(() => undefined)
      if (gen !== generation) return
      running = null
      setState({ status: next === null ? 'idle' : state.status === 'idle' ? 'syncing' : state.status, vault: next === null ? null : vaultId(next), problem: null, retryAt: null, progress: null, lastSyncedAt: null, ready: false })
      if (next === null) return
      await loadIndex(vaultId(next), gen)
      if (gen === generation) void syncNow()
    },
    setVisible(next) {
      visible = next
      if (!next) clearTimer()
      else if (vault !== null && state.status !== 'attention') nowOrWhenAllowed()
    },
    online() {
      if (vault !== null && state.status !== 'attention') nowOrWhenAllowed()
    },
    syncNow,
    async idle() {
      while (running !== null) await running
    },
    async file(path) {
      if (vault === null) return null
      const id = vaultId(vault)
      const stored = await store.read(id, path)
      if (stored !== null) return stored
      // An eager file that is not stored is over the size limit (F7): metadata only, as on the Mac.
      if (isEager(path)) return null
      const sha = (await store.checkpoint(id))?.shas[path]
      const token = await tokens.read(id)
      if (sha === undefined || token === null) return null
      const bytes = await makeRemote(vault, token).blob(sha)
      await store.write(id, path, bytes)
      return store.read(id, path)
    },
    async lane(fn) {
      if (vault === null) throw new Error('No vault is open')
      const open = vault
      await this.idle()
      const token = await tokens.read(vaultId(open))
      if (token === null) throw new GithubError('UNAUTHORIZED', null, 'This vault has no token')
      return lock(lockName(vaultId(open)), () => fn(makeRemote(open, token)))
    },
    stop() {
      generation++
      clearTimer()
      vault = null
    },
  }
}
