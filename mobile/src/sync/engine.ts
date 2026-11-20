import { slowedUntil } from '../github/backoff'
import { GithubError, MAX_RATE_WAIT_MS, REQUEST_TIMEOUT_MS, githubClient, uploadAllowanceMs, type GithubErrorCode } from '../github/client'
import { StorageFullError, vaultId, type PhoneVault, type StoredFile, type TokenStore, type VaultStore } from '../store'
import { browserClock } from './clock'
import { webLock } from './webLock'
import { POLL_MS } from './cadence'
import { githubRemote, type Change, type GithubRemote } from './githubRemote'
import { syncPass, type PassProgress, type PassResult } from './pass'
import { INDEX_STATE, ofTheseRules, rebuiltIndex, type PhoneIndex } from './phoneIndex'
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
  | {
      type: 'changed'
      vault: string
      commit: string
      diff: TreeDiff | null
      settings: string[]
      index: PhoneIndex
      /** From a pass: each file's size in bytes at `commit` (3D's size limit). Absent when only the stored index loaded. */
      sizes?: ReadonlyMap<string, number>
    }

export interface SyncEngineOptions {
  store: VaultStore
  tokens: TokenStore
  clock?: Clock
  /** The remote for a vault and its token. Default: `githubRemote` on 3E's `githubClient`. */
  /**
   * `onActivity`: give it to the client (`ClientOptions.onActivity`), so the engine's silence limit sees the bytes of a
   * slow download. Without it, only each call's end counts as activity.
   */
  makeRemote?: (vault: PhoneVault, token: string, onActivity?: () => void) => GithubRemote
  /**
   * Runs `fn` while this tab holds the named lock (row P4: one tab syncs at a time). Default: the Web Locks API
   * (`navigator.locks`), else no lock.
   */
  lock?: <T>(name: string, fn: () => Promise<T>) => Promise<T>
  yieldToUi?: () => Promise<void>
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
   * A pass of that vault never runs while `fn` runs, and `fn` never runs while a pass writes the store. `pass` runs ONE
   * sync pass inside the lane: it brings the stored copy to the newest head and tells the screens, as a pass of the
   * engine does. `vault` is the id of the vault the lane is for (the open vault when `lane` was called).
   */
  lane<T>(fn: (remote: GithubRemote, pass: () => Promise<PassResult>, vault: string) => Promise<T>): Promise<T>
  /**
   * 3D: the open vault's remote for a READ at once, with no lock and no wait for a pass (a picture that a
   * screen shows now). Null with no vault open or no token. A write to the store still goes through `lane`.
   */
  reader(): Promise<{ vault: string; remote: GithubRemote } | null>
  /** Stops the timers and the polling. */
  stop(): void
}


/**
 * YAZ-5596 (3): a pass with no step for this long is stuck (a storage call or a lock that never answers, as on iOS after
 * a wake). A new request (a return to the app, pull to refresh, the poll) drops it and starts a new pass, instead of
 * joining it. A step: an answer or a part of one from GitHub, a store call ended, a yield of the pass, its progress.
 */
export const STALL_MS = 30_000

/** The lock name of a vault: two tabs of the app share it, so only one of them runs a pass of that vault at a time. */
export const lockName = (vault: string) => `notecards-sync:${vault}`

const ATTENTION: readonly SyncProblem[] = ['UNAUTHORIZED', 'NOT_FOUND', 'NO_ACCESS', 'READ_ONLY', 'TREE_TRUNCATED', 'NO_TOKEN', 'STORAGE_FULL']

/** A pass of the engine: its vault's generation, and `dropped` when a new pass took the place of a stuck one. */
interface Pass {
  gen: number
  promise: Promise<void>
  dropped: boolean
  /** YAZ-5645: this pass already renewed a GitHub sign-in's token after a 401 (once only). */
  renewed?: true
}

/**
 * The sync engine of the open vault (October 2E; decisions 4, 6, 7; round 10 items 8 and 20). It decides WHEN a pass
 * runs, runs one at a time, keeps the status for 4D, and tells the screens what changed. The pass itself is `syncPass`.
 */
export function createSyncEngine(options: SyncEngineOptions): SyncEngine {
  const { store, tokens } = options
  const clock = options.clock ?? browserClock
  const lock = options.lock ?? webLock
  const makeRemote = options.makeRemote ?? ((vault, token, onActivity) => githubRemote(githubClient(token, { onActivity }), vault.repo, vault.branch))
  const listeners = new Set<(event: SyncEvent) => void>()

  let vault: PhoneVault | null = null
  /** "Slow down" answers in a row: each one doubles the wait, up to MAX_RATE_WAIT_MS. A good pass resets it. */
  let slowedInRow = 0
  /** Each `open` starts a new generation; a pass of an older one tells nobody and plans nothing. */
  let generation = 0
  let visible = true
  let current: PhoneIndex | null = null
  /**
   * The pass of the open vault. A pass of a vault that was open before goes on to its end in `passes`, but nobody
   * waits for it: opening another vault never waits for a download.
   */
  let running: Pass | null = null
  const passes = new Set<Promise<void>>()
  let timer: unknown = null
  /**
   * One pass or lane of a vault at a time in THIS tab, also where the Web Lock is missing (a timer's pass
   * must wait for 3C's send). One queue for each vault, so opening another vault never waits. The Web Lock
   * (`lock`) keeps other tabs out.
   */
  const turns = new Map<string, Promise<unknown>>()
  const exclusive = <T>(id: string, fn: () => Promise<T>): Promise<T> => {
    const run = (turns.get(id) ?? Promise.resolve()).then(fn, fn)
    const settled = run.catch(() => undefined)
    turns.set(id, settled)
    void settled.then(() => {
      if (turns.get(id) === settled) turns.delete(id)
    })
    return run
  }
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
    // Never more than the longest wait: a browser timer over 2^31-1 ms fires at once.
    const delay = Math.min(MAX_RATE_WAIT_MS, Math.max(0, (at ?? clock.now() + POLL_MS) - clock.now()))
    timer = clock.setTimeout(() => {
      timer = null
      void syncNow()
    }, delay)
  }

  /**
   * Each GitHub call of the engine has a SILENCE limit on the engine's clock, next to the client's
   * own silence limit for each request. `lastAnswer` is when the engine last heard from GitHub: an answer, or a part of
   * a body (`heard`, through the client's `onActivity`). A call fails only when nothing came for the limit, so a slow
   * but live download goes on to its end. A pull to refresh after a long silence does not join a pass that hangs.
   */
  const outstanding = new Set<(error: GithubError) => void>()
  let lastAnswer = clock.now()
  /** YAZ-5596 (3): the last step of the running pass (see `STALL_MS`). */
  let lastStep = clock.now()
  const step = () => {
    lastStep = clock.now()
  }
  const tooLate = () => new GithubError('OFFLINE', null, 'GitHub did not answer in time')
  const heard = () => {
    lastAnswer = clock.now()
    step()
  }
  const remoteOf = (open: PhoneVault, token: string) => timed(makeRemote(open, token, heard))
  function timed(remote: GithubRemote): GithubRemote {
    const call = <T>(work: () => Promise<T>, limit = REQUEST_TIMEOUT_MS): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        let timer: unknown = null
        const done = () => {
          outstanding.delete(fail)
          if (timer !== null) clock.clearTimeout(timer)
          lastAnswer = clock.now()
          step()
        }
        const fail = (error: GithubError) => {
          done()
          reject(error)
        }
        outstanding.add(fail)
        const started = clock.now()
        // Fails only after `limit` of silence: each time it fires, it waits again for what is left since the last sign.
        const check = () => {
          const quiet = clock.now() - Math.max(started, lastAnswer)
          if (quiet >= limit) fail(tooLate())
          else timer = clock.setTimeout(check, limit - quiet)
        }
        timer = clock.setTimeout(check, limit)
        work().then(
          (value) => {
            if (!outstanding.has(fail)) return
            done()
            resolve(value)
          },
          (error: unknown) => {
            if (!outstanding.has(fail)) return
            done()
            reject(error)
          },
        )
      })
    return {
      head: (etag) => call(() => remote.head(etag)),
      tree: (commit) => call(() => remote.tree(commit)),
      blob: (sha) => call(() => remote.blob(sha)),
      // YAZ-5929: one request for up to 100 files. Its answer is long, but each part of it is a sign (`onActivity`),
      // so only silence ends it, as for one large file.
      blobs: (shas) => call(() => remote.blobs(shas)),
      // A commit is up to 5 requests in a row, and its files go UP with no sign: the time they need at the
      // client's floor speed is added, as the client adds it for each request.
      commit: (parent, changes, message, made) => call(() => remote.commit(parent, changes, message, made), REQUEST_TIMEOUT_MS * 5 + uploadAllowanceMs(changeBytes(changes))),
      contains: (commit, head) => call(() => remote.contains(commit, head)),
    }
  }

  /** The bytes a commit sends up (text as UTF-8; JSON adds a little, the floor speed covers it). */
  const changeBytes = (changes: readonly Change[]): number => {
    let n = 0
    for (const c of changes) if (!('delete' in c)) n += typeof c.content === 'string' ? new TextEncoder().encode(c.content).byteLength : c.content.byteLength
    return n
  }

  async function loadIndex(id: string, gen: number) {
    const checkpoint = await store.checkpoint(id)
    if (gen !== generation) return
    // YAZ-5596 (4): the engine holds the index of the stored commit already (a poll that found nothing new): no read
    // of the whole stored index again.
    if (checkpoint !== null && current?.commit === checkpoint.commit && ofTheseRules(current)) return
    let saved = await store.getState<PhoneIndex>(id, INDEX_STATE)
    if (gen !== generation) return
    // The stored index counts only with its checkpoint: a first download that stopped shows no partial vault (F5, F6).
    if (saved === undefined || checkpoint === null || saved.commit !== checkpoint.commit) return
    if (current?.commit === saved.commit && ofTheseRules(current)) return
    // An index of an older build's rules (the card titles of before YAZ-5308) is built again from the stored
    // files before any screen reads it, and kept, so the next open reads it as it is.
    if (!ofTheseRules(saved)) {
      saved = await rebuiltIndex(store, id, saved)
      if (gen !== generation) return
      await store.setState(id, INDEX_STATE, saved)
      if (gen !== generation) return
    }
    current = saved
    setState({ ready: true })
    emit({ type: 'changed', vault: id, commit: saved.commit, diff: null, settings: [], index: saved })
  }

  /** A pass result of vault `id` taken in: the index, `ready`, and the screens told. */
  async function adopt(id: string, gen: number, result: PassResult) {
    if (gen !== generation) return
    if (result.kind === 'synced') {
      current = result.index
      setState({ ready: true })
      emit({ type: 'changed', vault: id, commit: result.commit, diff: result.diff, settings: result.settings, index: result.index, sizes: result.sizes })
    } else await loadIndex(id, gen) // another tab may have synced this vault (P4)
  }

  // `session`: the store bound to the vault's generation at the start of the work: after a clear of the
  // vault (in any tab), every write of this pass is refused, so it can never mark a file done for the next open.
  const yieldToUi = options.yieldToUi ?? defaultYield
  const passOptions = (open: PhoneVault, id: string, token: string, gen: number, session: VaultStore, me?: Pass) => ({
    remote: remoteOf(open, token),
    store: session,
    vault: id,
    now: clock.now,
    // Each yield of the pass is a step: a long pass that works is never taken for a stuck one.
    yieldToUi: () => {
      step()
      return yieldToUi()
    },
    onProgress: (progress: PassProgress) => {
      step()
      if (gen === generation && me?.dropped !== true) setState({ progress })
    },
  })

  async function runPass(me: Pass) {
    const { gen } = me
    const open = vault!
    const id = vaultId(open)
    lastAnswer = clock.now()
    step()
    /** This pass no longer speaks: another vault opened, or it was stuck and a new pass took its place. */
    const gone = () => gen !== generation || me.dropped
    try {
      // YAZ-5596 (3): `syncing` first, before any store read: a pass that hangs there shows blue, never a green
      // that is not true.
      setState({ status: 'syncing', progress: null })
      // Inside the `try`: a failed read of the token store (iOS: "connection lost") is a status, not a stop.
      const session = await store.session(id)
      step()
      const token = await tokens.read(id)
      step()
      if (gone()) return
      if (token === null) {
        setState({ status: 'attention', problem: 'NO_TOKEN', retryAt: null, progress: null })
        return
      }
      const result = await exclusive(id, () =>
        lock(lockName(id), () => {
          step()
          return syncPass(passOptions(open, id, token, gen, session, me))
        }),
      )
      if (gone()) return
      await adopt(id, gen, result)
      if (me.dropped) return
      slowedInRow = 0
      setState({ status: 'synced', problem: null, retryAt: null, progress: null, lastSyncedAt: clock.now() })
      plan()
    } catch (error) {
      if (gone()) return
      // YAZ-5645: a 401 with a GitHub sign-in's token: refresh once, then the same pass once more (a pasted token: no).
      if (error instanceof GithubError && error.code === 'UNAUTHORIZED' && me.renewed !== true && (await tokens.renew(id).catch(() => false))) {
        if (gone()) return
        me.renewed = true
        return runPass(me)
      }
      const problem: SyncProblem = error instanceof GithubError ? error.code : error instanceof StorageFullError ? 'STORAGE_FULL' : 'FAILED'
      if (problem === 'RATE_LIMITED') {
        // GitHub's time (the client holds it between 1 minute and 1 hour), or more: each "slow down" in a row doubles
        // the wait, up to 1 hour. Never under the floor, so a reset time in the past cannot loop.
        slowedInRow++
        const retryAt = slowedUntil(error as GithubError, slowedInRow, clock.now())
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
    if (running !== null && running.gen === generation) {
      // A pass that has heard nothing from GitHub for longer than the time limit hangs: end its calls (they
      // fail as OFFLINE), let it end, then start a new pass. Else the request joins the running pass.
      if (outstanding.size > 0 && clock.now() - lastAnswer >= REQUEST_TIMEOUT_MS) {
        for (const fail of [...outstanding]) fail(tooLate())
        return running.promise.then(() => syncNow())
      }
      // YAZ-5596 (3): no step for STALL_MS (a store call or a lock that never answered): the pass is dropped (it
      // tells nobody anything, and nobody waits for it) and a new one starts. Else the request joins the running pass.
      if (clock.now() - lastStep < STALL_MS) return running.promise
      running.dropped = true
      passes.delete(running.promise)
      running = null
      // Release the stuck per-vault turn so the replacement pass does not deadlock behind the dropped pass (YAZ-6024).
      if (vault !== null) turns.delete(vaultId(vault))
    }
    if (vault === null) return Promise.resolve()
    clearTimer()
    const me: Pass = { gen: generation, promise: Promise.resolve(), dropped: false }
    const promise = runPass(me).finally(() => {
      passes.delete(promise)
      if (running?.promise === promise) running = null
    })
    me.promise = promise
    passes.add(promise)
    running = me
    return promise
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
      slowedInRow = 0
      const gen = generation
      // A pass of the vault that was open goes on to its end (its writes are its own vault's, under its own lock);
      // nobody hears of it, and nobody waits for it: the new vault shows from storage at once (N1).
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
      while (passes.size > 0) await Promise.all([...passes])
    },
    async file(path) {
      if (vault === null) return null
      const open = vault
      const id = vaultId(open)
      const session = await store.session(id)
      const stored = await store.read(id, path)
      if (stored !== null) return stored
      // An eager file that is not stored is over the size limit (F7): metadata only, as on the Mac.
      if (isEager(path)) return null
      const token = await tokens.read(id)
      if (token === null) return null
      const remote = remoteOf(open, token)
      // The download runs with no lock (a pass need not wait for a slow picture). The WRITE runs under the vault's
      // lock, and only when the checkpoint still names the SHA that came down: a pass that changed the
      // picture meanwhile means "get the new one". So a stored file is always the checkpoint's version, and R7 holds.
      for (let tries = 0; tries < 3; tries++) {
        const sha = (await store.checkpoint(id))?.shas[path]
        if (sha === undefined) return null
        const bytes = await remote.blob(sha)
        const kept = await lock(lockName(id), async () => {
          if ((await store.checkpoint(id))?.shas[path] !== sha) return false
          await session.write(id, path, bytes)
          return true
        })
        if (kept) return store.read(id, path)
      }
      return null
    },
    async lane(fn) {
      if (vault === null) throw new Error('No vault is open')
      const open = vault
      const id = vaultId(open)
      const gen = generation
      await this.idle()
      const token = await tokens.read(id)
      if (token === null) throw new GithubError('UNAUTHORIZED', null, 'This vault has no token')
      const session = await store.session(id)
      const pass = async () => {
        const result = await syncPass(passOptions(open, id, token, gen, session))
        await adopt(id, gen, result)
        if (gen === generation) {
          slowedInRow = 0
          setState({ status: 'synced', problem: null, retryAt: null, progress: null, lastSyncedAt: clock.now() })
        }
        return result
      }
      return exclusive(id, () => lock(lockName(id), () => fn(remoteOf(open, token), pass, id)))
    },
    async reader() {
      if (vault === null) return null
      const open = vault
      const token = await tokens.read(vaultId(open))
      return token === null ? null : { vault: vaultId(open), remote: remoteOf(open, token) }
    },
    stop() {
      generation++
      clearTimer()
      vault = null
    },
  }
}
