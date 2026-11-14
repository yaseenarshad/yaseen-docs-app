import { makeAssetResolver } from '@shared/assetLookup'
import { IDS_FILE, idLettersOf } from '@shared/pageId'
import { DEFAULT_REVIEW_SETTINGS, REVIEW_SETTINGS_FILE, sanitizeReviewSettings, type ReviewSettings } from '@shared/reviews'
import { VAULT_CONFIG_DIR } from '@shared/types'
import { GithubError, SECONDARY_LIMIT_WAIT_MS } from '../github/client'
import { StorageFullError, kindOnPhone, type Checkpoint, type VaultStore } from '../store'
import type { Clock, SyncEngine } from '../sync/engine'
import { isEager } from '../sync/plan'
import { uiSlicer, yieldToUi as defaultYield } from '../sync/yieldToUi'
import { aheadPlan, type DayNumbers } from './plan'
import { folderOf, mediaTarget } from './refs'

/**
 * MEDIA AHEAD OF TIME (YAZ-5074 3D, decision 6): after each sync pass, the phone downloads the pictures and sounds of
 * the cards due in the next `MEDIA_AHEAD_DAYS`, so a review works with no signal. Screens ask for one file with `show`.
 *
 * - WHEN: after a pass ends ("synced"), never during one. Each small group of downloads holds the vault's lock through
 *   `engine.lane`, so no pass runs (and no checkpoint is written) while a picture lands; between groups a pass can run.
 *   It uses the ONE engine; it never polls GitHub itself. Only the open vault (decision 7).
 * - WHAT: `aheadPlan` (the shared due rule and the shared asset lookup). A file over `MEDIA_AHEAD_MAX_BYTES` waits
 *   until it shows. The same file in many cards is one download; two paths with one blob SHA are one download too.
 * - RESUME: the store writes a file whole or not at all, and a file stored at the checkpoint's SHA is not fetched
 *   again. A closed app continues at the next pass. A changed file (new blob SHA) loses its kept copy in the pass
 *   (row R7), so the next round fetches it again.
 * - QUIET (decision 12): a failure never changes the sync dot. A 404 is skipped until the next commit; GitHub's
 *   "slow down" waits until the time GitHub gives; no signal waits for the next pass; a full phone waits for the next
 *   change. `state()` says why it waits.
 * - FULL PHONE (the coordinator's pick for the night, for Yaseen to confirm): the open vault's window files are
 *   protected (`VaultStore.protectMedia`). A write may drop the vault's other media and other vaults' media, oldest
 *   view first; never a window file, a page, a card file or the answer list.
 */

/** Why the media waits (none of these changes the sync dot). */
export type MediaWaiting = 'offline' | 'slowed' | 'full' | 'failed'

/** For 4A's first-download view: "pictures 12 of 40". */
export interface MediaState {
  vault: string | null
  /** The window's files that are on the phone. */
  done: number
  /** The window's files (within the size limit). */
  total: number
  /** The window's files over the size limit: they download when they show. */
  tooLarge: number
  /** A round downloads now. */
  running: boolean
  waiting: MediaWaiting | null
  /** For `slowed`: when the media tries again (ms since 1970). */
  retryAt: number | null
}

/** What `show` gives a screen: a URL for `<img>`, `<audio>` or the iPhone's own viewer (a PDF), or why there is none. */
export type MediaShow =
  | {
      status: 'ready'
      path: string
      /** An object URL of the bytes (`blob:`). Valid until the vault changes or `stop()`. */
      url: string
      /** The MIME type from the file name (`application/pdf` for a PDF: round 12, item 11). */
      type: string
      bytes: number
      /** Resolves true when the file is kept on the phone (C1), false when it is not (another vault opened, a new SHA). */
      kept: Promise<boolean>
    }
  | {
      status: 'missing'
      path: string | null
      /**
       * - `offline`: not stored and no signal (N3: the calm placeholder "needs a connection"; the text still shows).
       * - `slowed`: GitHub said "slow down". `gone`: GitHub has no such blob. `not-in-vault`: no file at that path or link.
       * - `no-vault`: no vault is open, or it has no token. `failed`: anything else.
       */
      why: 'offline' | 'slowed' | 'gone' | 'not-in-vault' | 'no-vault' | 'failed'
    }

export interface MediaAheadOptions {
  engine: SyncEngine
  store: VaultStore
  clock?: Clock
  yieldToUi?: () => Promise<void>
  /** Downloads at one time. Default 3: "a few", so a pass and a tap on the screen are never far behind. */
  parallel?: number
  /** Files for each hold of the vault's lock. Default 12. */
  chunk?: number
  /** This phone's two day numbers (decision 9; 3C keeps them). Default: none. */
  dayNumbers?: (vault: string) => DayNumbers | Promise<DayNumbers>
  /** Default `URL.createObjectURL`. */
  makeUrl?: (bytes: Uint8Array, type: string) => string
  revokeUrl?: (url: string) => void
}

export interface MediaAhead {
  state(): MediaState
  subscribe(listener: (state: MediaState) => void): () => void
  /** A round now (also when nothing changed), for example after "Reset local copy". */
  refresh(): Promise<void>
  /** Resolves when no round runs. */
  idle(): Promise<void>
  /** The vault path of a picture or sound link `src` written in `holder` (the file that holds the card or page), or null. */
  resolve(src: string, holder: string): string | null
  /** "Show this file": from storage first (then it counts as viewed), else from GitHub, then kept (C1). Never throws. */
  show(path: string): Promise<MediaShow>
  /** `resolve`, then `show`. */
  showLink(src: string, holder: string): Promise<MediaShow>
  /** The URL `show` made for `path`, or null: for a drawing that needs a URL at once (`CardLookPlace.src`). */
  urlNow(path: string): string | null
  /**
   * A screen no longer shows the URL that one `show` of `path` gave (its view closed, its element left the page:
   * YAZ-5200). Each ready `show` counts one user; when the last one lets go, the URL waits among the
   * `MEDIA_URL_IDLE_CAP` most recent idle ones (a quick show again), then is revoked. `url` (optional, YAZ-5221): the URL
   * that screen used, so a file that changed on GitHub meanwhile lets go of the right version.
   */
  releaseUrl(path: string, url?: string): void
  stop(): void
}

/** The phone-only state with the file sizes of the last pass (the tree's sizes are not in the checkpoint). */
export const MEDIA_STATE = 'media'
interface SizesState {
  commit: string
  sizes: Record<string, number>
}

/**
 * The failure memory (YAZ-5186): one small phone-only state row for each failed download, named this prefix and the
 * blob SHA (YAZ-5223: rows, written in batches of the changed ones only). Kept, so a restart does not try again at once.
 * A new SHA (the file changed on GitHub) has no row, so it is tried at once. Only the window's SHAs keep a row, and at
 * most `MEDIA_FAILURES_MAX`: about 60 bytes a row, so at most about 0.6 MB.
 */
export const MEDIA_FAILURE_PREFIX = 'mediaFailure:'
export const MEDIA_FAILURES_MAX = 10_000
/** The old single row of round 1 (YAZ-5186), removed when found. */
const OLD_FAILURES_STATE = 'mediaFailures'
export interface MediaFailure {
  /** Failures in a row. */
  tries: number
  /** Not before this time (ms since 1970). */
  nextAt: number
  /** An error that does not heal by waiting (403, a file GitHub will not give): only a new SHA or `show` tries again. */
  gaveUp: boolean
  /**
   * For a 404 (YAZ-5222): the head commit it was given for. A blob that the tree names normally exists, so a 404 holds
   * only for that tree: a new head commit tries again.
   */
  commit?: string
}
/** The second failure in a row waits this long; each next one doubles it, up to `MEDIA_RETRY_MAX_MS`. */
export const MEDIA_RETRY_BASE_MS = 2 * 60_000
export const MEDIA_RETRY_MAX_MS = 60 * 60_000

/**
 * What a failed download means for that file. The first failure that may heal (no answer in time, GitHub down) tries
 * again at the next pass: a short drop of the signal costs nothing. Each next failure in a row waits twice as long, up
 * to 1 hour. An answer that waiting does not change (403, 404, another 4xx such as "too large") gives up on this SHA.
 */
export function nextFailure(before: MediaFailure | undefined, error: GithubError, now: number, commit?: string): MediaFailure {
  const tries = (before?.tries ?? 0) + 1
  const status = error.status ?? 0
  const gaveUp = error.code === 'NO_ACCESS' || error.code === 'READ_ONLY' || error.code === 'NOT_FOUND' || (error.code === 'UNEXPECTED' && status >= 400 && status < 500)
  const wait = tries <= 1 ? 0 : Math.min(MEDIA_RETRY_MAX_MS, MEDIA_RETRY_BASE_MS * 2 ** (tries - 2))
  return { tries, nextAt: now + wait, gaveUp, ...(error.code === 'NOT_FOUND' && commit !== undefined && { commit }) }
}

/** Does the failure keep the file out of this round (at head `commit`, time `now`)? */
const holdsBack = (f: MediaFailure | undefined, commit: string, now: number): boolean =>
  f !== undefined && (f.gaveUp ? f.commit === undefined || f.commit === commit : f.nextAt > now)

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  bmp: 'image/bmp',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  pdf: 'application/pdf',
  md: 'text/markdown',
}
/** How many object URLs that no screen uses stay alive for a quick show again (YAZ-5200). */
export const MEDIA_URL_IDLE_CAP = 24

/** The MIME type of a file, from its extension. */
export function mediaType(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return (dot > 0 ? MIME[name.slice(dot + 1).toLowerCase()] : undefined) ?? 'application/octet-stream'
}

const browserClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
}

/** The local calendar day of `ms`: the window moves at local midnight. */
function localDay(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { ignoreBOM: true })
const bytesOf = (content: string | Uint8Array): Uint8Array => (typeof content === 'string' ? encoder.encode(content) : content)

class Stop extends Error {}

export function createMediaAhead(options: MediaAheadOptions): MediaAhead {
  const { engine, store } = options
  const clock = options.clock ?? browserClock
  const parallel = Math.max(1, options.parallel ?? 3)
  const chunkSize = Math.max(1, options.chunk ?? 12)
  const makeUrl = options.makeUrl ?? ((bytes, type) => URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type })))
  const revokeUrl = options.revokeUrl ?? ((url) => URL.revokeObjectURL(url))
  const listeners = new Set<(state: MediaState) => void>()

  let stopped = false
  /** Each vault change starts a new generation: work of an older one writes nothing more. */
  let generation = 0
  let state: MediaState = { vault: null, done: 0, total: 0, tooLarge: 0, running: false, waiting: null, retryAt: null }
  let plan: { key: string; commit: string; wanted: string[]; tooLarge: string[]; sizesKnown: boolean } | null = null
  /** The last round of this plan left nothing to do (or the phone was full): wait for a new plan. */
  let complete = false
  /** The failed downloads of the open vault, by blob SHA (YAZ-5186); loaded from its rows (`MEDIA_FAILURE_PREFIX`) at the plan. */
  let failures: Record<string, MediaFailure> | null = null
  /** The failure rows changed since they were last kept: SHA → its row, or undefined (the row goes). */
  const dirty = new Map<string, MediaFailure | undefined>()
  let sizesFromPass: { vault: string; commit: string; sizes: ReadonlyMap<string, number> } | null = null
  let resolver: { commit: string; resolve: (target: string, from?: string) => string | null } | null = null
  let settingsOf: { text: string | null; settings: ReviewSettings } | null = null
  /**
   * The object URLs of each shown file, oldest first, each with its own count of screens that use it (YAZ-5200,
   * YAZ-5221). The last one is the file's current version; an older one (the file changed on GitHub: R7) lives until its
   * last user lets go.
   */
  const urls = new Map<string, { sha: string | null; url: string; users: number }[]>()
  /** Paths whose current URL no screen uses, oldest first: revoked past `MEDIA_URL_IDLE_CAP`. */
  const idle = new Set<string>()
  let timer: unknown = null
  let round: Promise<void> | null = null
  let again = false

  const setState = (next: Partial<MediaState>) => {
    state = { ...state, ...next }
    for (const listener of [...listeners]) listener({ ...state })
  }
  const clearTimer = () => {
    if (timer !== null) clock.clearTimeout(timer)
    timer = null
  }
  const revokeAll = () => {
    for (const list of urls.values()) for (const { url } of list) revokeUrl(url)
    urls.clear()
    idle.clear()
  }

  function switchTo(vault: string | null) {
    generation++
    clearTimer()
    plan = null
    complete = false
    failures = null
    dirty.clear()
    resolver = null
    revokeAll()
    // YAZ-5188: the open vault's window as the last plan kept it, at once: the first pass of a session may need room
    // before this session's plan exists.
    void store.protectMedia(vault).catch(() => undefined)
    setState({ vault, done: 0, total: 0, tooLarge: 0, running: false, waiting: null, retryAt: null })
  }

  function kick(): Promise<void> {
    if (stopped) return Promise.resolve()
    if (round !== null) {
      again = true
      return round
    }
    round = (async () => {
      do {
        again = false
        await oneRound(generation).catch(() => setState({ running: false, waiting: 'failed' }))
      } while (again && !stopped)
    })().finally(() => {
      round = null
    })
    return round
  }

  const unsubscribe = engine.subscribe((event) => {
    if (stopped) return
    if (event.type === 'state') {
      if (event.state.vault !== state.vault) switchTo(event.state.vault)
      if (event.state.status === 'synced') void kick()
    } else if (event.vault === state.vault && event.sizes !== undefined) sizesFromPass = { vault: event.vault, commit: event.commit, sizes: event.sizes }
  })
  switchTo(engine.state().vault)

  async function readText(vault: string, path: string): Promise<string | null> {
    const file = await store.read(vault, path)
    return file === null ? null : typeof file.content === 'string' ? file.content : decoder.decode(file.content)
  }

  /**
   * The sizes at `commit`: from the pass that just ran, or kept from an earlier round, or (YAZ-5187: the app closed
   * between the checkpoint and the round, or the keep failed) from the file list again, with no lock. Null when they
   * cannot be known now: the plan then counts every size as unknown, so nothing downloads ahead past the size limit.
   */
  async function sizesAt(vault: string, commit: string): Promise<Record<string, number> | null> {
    let fresh: ReadonlyMap<string, number> | null = null
    if (sizesFromPass !== null && sizesFromPass.vault === vault && sizesFromPass.commit === commit) fresh = sizesFromPass.sizes
    else {
      const kept = await store.getState<SizesState>(vault, MEDIA_STATE)
      if (kept?.commit === commit) return kept.sizes
      const reader = await engine.reader().catch(() => null)
      if (reader === null || reader.vault !== vault) return null
      try {
        fresh = (await reader.remote.tree(commit)).bytes
      } catch {
        return null
      }
    }
    sizesFromPass = null
    const sizes: Record<string, number> = {}
    for (const [path, n] of fresh) if (!isEager(path)) sizes[path] = n
    await store.setState(vault, MEDIA_STATE, { commit, sizes } satisfies SizesState).catch(() => undefined)
    return sizes
  }

  const setFailure = (sha: string, f: MediaFailure | undefined) => {
    if (failures === null) return
    if (f === undefined) {
      if (failures[sha] === undefined) return
      delete failures[sha]
    } else {
      if (failures[sha] === undefined && Object.keys(failures).length >= MEDIA_FAILURES_MAX) return // bounded
      failures[sha] = f
    }
    dirty.set(sha, f)
  }
  /** Keeps the changed rows only, in one write (best effort: in memory they hold for this session anyway). */
  const keepFailures = (vault: string) => {
    if (dirty.size === 0) return
    const rows: Record<string, unknown> = {}
    for (const [sha, f] of dirty) rows[`${MEDIA_FAILURE_PREFIX}${sha}`] = f
    dirty.clear()
    void store.setStates(vault, rows).catch(() => undefined)
  }

  function resolverFor(checkpoint: Checkpoint) {
    if (resolver?.commit !== checkpoint.commit) resolver = { commit: checkpoint.commit, resolve: makeAssetResolver(Object.keys(checkpoint.shas)) }
    return resolver.resolve
  }

  async function oneRound(gen: number): Promise<void> {
    const vault = state.vault
    if (vault === null || stopped) return
    if (state.retryAt !== null && clock.now() < state.retryAt) return // GitHub said "slow down": the timer comes back
    const checkpoint = await store.checkpoint(vault)
    const index = engine.index()
    if (gen !== generation || checkpoint === null || index === null || index.commit !== checkpoint.commit) return
    resolverFor(checkpoint)
    const config = `${VAULT_CONFIG_DIR}/`
    const reviewText = await readText(vault, `${config}${REVIEW_SETTINGS_FILE}`)
    const idsText = await readText(vault, `${config}${IDS_FILE}`)
    const numbers = (await options.dayNumbers?.(vault)) ?? {}
    const now = clock.now()
    const key = [checkpoint.commit, localDay(now), reviewText, idsText, JSON.stringify(numbers)].join('\n')
    if (gen !== generation) return

    const slice = uiSlicer(options.yieldToUi ?? defaultYield)
    await slice()
    if (plan?.key !== key || !plan.sizesKnown) {
      const sizes = await sizesAt(vault, checkpoint.commit)
      await slice()
      // The same settings object while `review.json` does not change: the shared due cache is keyed by it, so a new
      // day or a new commit does not replay every card's reviews again.
      if (settingsOf?.text !== reviewText) {
        let settings: ReviewSettings = DEFAULT_REVIEW_SETTINGS
        try {
          if (reviewText !== null) settings = sanitizeReviewSettings(JSON.parse(reviewText))
        } catch {
          // A broken review.json reads as the defaults, as on the Mac.
        }
        settingsOf = { text: reviewText, settings }
      }
      const settings = settingsOf.settings
      let ids: unknown = {}
      try {
        if (idsText !== null) ids = JSON.parse(idsText)
      } catch {
        // No letters: an ID of any letters sorts by its number.
      }
      const repoName = vault.slice(vault.indexOf('/') + 1, vault.lastIndexOf('@'))
      const made = await aheadPlan({
        records: index.records,
        read: (path) => readText(vault, path),
        sizes: new Map(Object.keys(checkpoint.shas).map((path) => [path, sizes?.[path]])),
        settings,
        now,
        letters: idLettersOf(ids, repoName).letters,
        ...numbers,
        slice,
      })
      if (gen !== generation) return
      if (gen !== generation) return
      plan = { key, commit: checkpoint.commit, wanted: made.wanted.filter((p) => !isEager(p) && checkpoint.shas[p] !== undefined), tooLarge: made.tooLarge, sizesKnown: sizes !== null }
      complete = false
      await store.protectMedia(vault, plan.wanted).catch(() => undefined)
      // The failure memory: only the SHAs of this window stay in it (a changed file has a new SHA, and starts clean).
      if (failures === null) {
        const rows = await store.statesWith(vault, MEDIA_FAILURE_PREFIX)
        if (gen !== generation) return
        failures = {}
        for (const [name, f] of Object.entries(rows)) failures[name.slice(MEDIA_FAILURE_PREFIX.length)] = f as MediaFailure
        void store.removeState(vault, OLD_FAILURES_STATE).catch(() => undefined)
      }
      const window = new Set(plan.wanted.map((p) => checkpoint.shas[p]))
      for (const sha of Object.keys(failures)) if (!window.has(sha)) setFailure(sha, undefined)
      keepFailures(vault)
    }
    if (complete || plan === null) return
    const current = plan
    const failed = failures ?? {}

    const stored = new Set((await store.list(vault)).filter((e) => e.kind === 'media').map((e) => e.path))
    await slice()
    if (gen !== generation) return
    const missingFiles = current.wanted.filter((p) => !stored.has(p))
    const todo = missingFiles.filter((p) => {
      return !holdsBack(failed[checkpoint.shas[p]], checkpoint.commit, now)
    })
    setState({ total: current.wanted.length, done: current.wanted.length - missingFiles.length, tooLarge: current.tooLarge.length, running: todo.length > 0, waiting: null, retryAt: null })
    // One download for each blob SHA: two paths with the same bytes are fetched once.
    const bySha = new Map<string, string[]>()
    for (const path of todo) bySha.set(checkpoint.shas[path], [...(bySha.get(checkpoint.shas[path]) ?? []), path])
    const groups = [...bySha]

    try {
      for (let at = 0; at < groups.length; at += chunkSize) {
        await fetchChunk(vault, gen, groups.slice(at, at + chunkSize), slice)
        if (gen !== generation) return
      }
    } catch (error) {
      if (gen !== generation || error instanceof Stop) return
      if (error instanceof GithubError && error.code === 'RATE_LIMITED') {
        const retryAt = error.resetAt ?? clock.now() + SECONDARY_LIMIT_WAIT_MS
        setState({ running: false, waiting: 'slowed', retryAt })
        clearTimer()
        timer = clock.setTimeout(() => {
          timer = null
          setState({ retryAt: null })
          void kick()
        }, Math.max(0, retryAt - clock.now()))
      } else if (error instanceof StorageFullError) {
        complete = true // the next change (a new commit, a new day) tries again
        setState({ running: false, waiting: 'full' })
      } else if (error instanceof GithubError && (error.code === 'OFFLINE' || error.code === 'GITHUB_DOWN')) setState({ running: false, waiting: 'offline' })
      else setState({ running: false, waiting: 'failed' })
      planRetry(gen)
      return
    }
    complete = true
    setState({ running: false, waiting: null })
    planRetry(gen)
  }

  /**
   * A file that waits (its failure's `nextAt`) comes back on a timer at that time, not at each pass: the round of each
   * pass does nothing for it (YAZ-5186). A file that gave up comes back only with a new SHA or `show`.
   */
  function planRetry(gen: number) {
    if (gen !== generation || state.retryAt !== null) return
    const waits = Object.values(failures ?? {})
      .filter((f) => !f.gaveUp && f.nextAt > clock.now())
      .map((f) => f.nextAt)
    if (waits.length === 0) return
    complete = true
    clearTimer()
    timer = clock.setTimeout(() => {
      timer = null
      complete = false
      void kick()
    }, Math.max(0, Math.min(...waits) - clock.now()))
  }

  /**
   * One group: `parallel` downloads at a time with NO lock (YAZ-5186: a slow download never holds up a pass or the
   * answer list), then ONE hold of the vault's lock for the writes. Under the lock the checkpoint is read again: a
   * file whose SHA moved meanwhile is not written (its new version comes in a later round). A failure of one file is
   * kept in the failure memory; "slow down", no token, or no answer stops the round after the downloads in flight.
   */
  async function fetchChunk(vault: string, gen: number, chunk: [string, string[]][], slice: () => Promise<void>) {
    const live = () => gen === generation && !stopped && engine.state().vault === vault
    const reader = await engine.reader()
    if (reader === null || reader.vault !== vault || !live()) throw new Stop()
    const got: { sha: string; paths: string[]; bytes: Uint8Array }[] = []
    let next = 0
    let failure: { error: unknown } | null = null
    const commit = plan?.commit
    await Promise.all(
      Array.from({ length: Math.min(parallel, chunk.length) }, async () => {
        while (failure === null && next < chunk.length && live()) {
          const [sha, paths] = chunk[next++]
          try {
            got.push({ sha, paths, bytes: await reader.remote.blob(sha) })
          } catch (error) {
            if (error instanceof GithubError && error.code !== 'RATE_LIMITED' && error.code !== 'UNAUTHORIZED' && failures !== null) {
              const f = nextFailure(failures[sha], error, clock.now(), commit)
              setFailure(sha, f)
              // No answer in time, or GitHub down: the signal may be gone, so no new download starts in this round.
              if (!f.gaveUp) failure ??= { error }
            } else failure ??= { error }
          }
          await slice()
        }
      }),
    )
    if (got.length > 0 && live())
      await engine.lane(async (_remote, _pass, laneVault) => {
        if (laneVault !== vault || !live()) throw new Stop()
        const checkpoint = await store.checkpoint(vault)
        await slice()
        for (const { sha, paths, bytes } of got) {
          for (const path of paths) {
            if (checkpoint?.shas[path] !== sha) continue
            await store.write(vault, path, bytes)
            setState({ done: state.done + 1 })
          }
          setFailure(sha, undefined)
          await slice()
        }
      })
    // The rows this group changed, in one write: the bytes written grow with the failures, not with their square.
    keepFailures(vault)
    if (failure !== null) throw (failure as { error: unknown }).error
  }

  /** The URL for one more user of `path`: its current one (same SHA), or a new current one. An older URL is not touched. */
  function urlFor(path: string, sha: string | null, bytes: Uint8Array): string {
    const list = urls.get(path) ?? []
    const current = list.at(-1)
    if (current !== undefined && current.sha === sha) {
      current.users++
      idle.delete(path)
      return current.url
    }
    // A new version: the old current URL stays while a screen uses it; with no user it goes now.
    idle.delete(path)
    if (current !== undefined && current.users === 0) {
      revokeUrl(current.url)
      list.pop()
    }
    const url = makeUrl(bytes, mediaType(path))
    list.push({ sha, url, users: 1 })
    urls.set(path, list)
    return url
  }

  /**
   * One user of `path` lets go: of `url` when it says which (the watcher does), else of the OLDEST URL that has a user
   * (the screen that showed it first). An older version with no user goes at once; the current one waits among the
   * `MEDIA_URL_IDLE_CAP` most recent idle URLs.
   */
  function releaseUrl(path: string, url?: string) {
    const list = urls.get(path)
    if (list === undefined) return
    const held = url === undefined ? list.find((e) => e.users > 0) : list.find((e) => e.url === url)
    if (held === undefined || held.users === 0) return
    held.users--
    if (held.users > 0) return
    if (held !== list.at(-1)) {
      revokeUrl(held.url)
      list.splice(list.indexOf(held), 1)
      return
    }
    idle.add(path)
    for (const oldest of idle) {
      if (idle.size <= MEDIA_URL_IDLE_CAP) break
      idle.delete(oldest)
      const gone = urls.get(oldest)
      const last = gone?.at(-1)
      if (gone === undefined || last === undefined || last.users > 0) continue
      revokeUrl(last.url)
      gone.pop()
      if (gone.length === 0) urls.delete(oldest)
    }
  }

  /** Keeps a file that `show` downloaded: under the lock, only if the vault and the SHA did not change meanwhile. */
  function keep(vault: string, path: string, sha: string, bytes: Uint8Array): Promise<boolean> {
    if (kindOnPhone(path) !== 'media') return Promise.resolve(false)
    return engine
      .lane(async (_remote, _pass, laneVault) => {
        if (stopped || laneVault !== vault || engine.state().vault !== vault) return false
        if ((await store.checkpoint(vault))?.shas[path] !== sha) return false
        if ((await store.read(vault, path)) === null) await store.write(vault, path, bytes)
        return true
      })
      .catch(() => false)
  }

  async function show(path: string): Promise<MediaShow> {
    const vault = state.vault
    if (vault === null || stopped) return { status: 'missing', path, why: 'no-vault' }
    try {
      const checkpoint = await store.checkpoint(vault)
      const sha = checkpoint?.shas[path] ?? null
      const stored = await store.read(vault, path)
      if (stored !== null) {
        if (stored.kind === 'media') await store.markViewed(vault, path).catch(() => undefined)
        const bytes = bytesOf(stored.content)
        return { status: 'ready', path, url: urlFor(path, sha, bytes), type: mediaType(path), bytes: bytes.byteLength, kept: Promise.resolve(true) }
      }
      if (sha === null) return { status: 'missing', path, why: 'not-in-vault' }
      const reader = await engine.reader()
      if (reader === null || reader.vault !== vault) return { status: 'missing', path, why: 'no-vault' }
      const bytes = await reader.remote.blob(sha)
      if (state.vault !== vault) return { status: 'missing', path, why: 'no-vault' }
      // The person opened it: a file that gave up ahead (YAZ-5186) is in again.
      setFailure(sha, undefined)
      keepFailures(vault)
      return { status: 'ready', path, url: urlFor(path, sha, bytes), type: mediaType(path), bytes: bytes.byteLength, kept: keep(vault, path, sha, bytes) }
    } catch (error) {
      const code = error instanceof GithubError ? error.code : null
      const why = code === 'OFFLINE' || code === 'GITHUB_DOWN' ? 'offline' : code === 'RATE_LIMITED' ? 'slowed' : code === 'NOT_FOUND' ? 'gone' : 'failed'
      return { status: 'missing', path, why }
    }
  }

  function resolve(src: string, holder: string): string | null {
    const target = mediaTarget(src)
    return target === null || resolver === null ? null : resolver.resolve(target, folderOf(holder))
  }

  return {
    state: () => ({ ...state }),
    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    refresh() {
      complete = false
      return kick()
    },
    async idle() {
      while (round !== null) await round
    },
    resolve,
    show,
    async showLink(src, holder) {
      const vault = state.vault
      if (vault !== null && resolver === null) {
        const checkpoint = await store.checkpoint(vault)
        if (checkpoint !== null && state.vault === vault) resolverFor(checkpoint)
      }
      const path = resolve(src, holder)
      return path === null ? { status: 'missing', path: null, why: 'not-in-vault' } : show(path)
    },
    urlNow: (path) => urls.get(path)?.at(-1)?.url ?? null,
    releaseUrl,
    stop() {
      stopped = true
      generation++
      clearTimer()
      unsubscribe()
      revokeAll()
    },
  }
}
