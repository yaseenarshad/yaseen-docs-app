/**
 * The Mac's background stats sender (YAZ-6219), wired to the Cloudflare Worker + D1 Friends API
 * (`@shared/friendsApi`). Counts open vaults (from the live index) and known closed vaults (via
 * `countWorker.ts` / `closedVaults.ts`), throttles counts and sends to at most once every 5 minutes,
 * skips unchanged counts, backs off on failed counts, and calls `client.sendStats(...)`.
 *
 * Quiet failure: offline, rate-limited, or signed-out states update `FriendsSendView` for Settings
 * without throwing or showing dialogs. Stored state (`friends-send.json`) holds no tokens and no card text.
 */
import { createHash } from 'node:crypto'
import { FriendsApiError, type FriendsApiClient } from '@shared/friendsApi'
import { PUBLISH_EVERY_MS, emptyBudget, numbersFor, numbersKey, type GistBudget, type SendReason } from '@shared/friendSend'
import { dayIn, type FriendStats, type FriendVault } from '@shared/friendStatsFormat'
import type { FriendsSendStatus, FriendsSendView } from '@shared/types'
import type { ClosedVault } from './closedVaults'
import { COUNT_LIMIT_MS, ClosedVaultsUnreadable, countPayloadSliced } from './countJob'

/** What the Mac keeps between starts (`<userData>/friends-send.json`): no token, no card text. */
export interface MacSendSaved {
  lastSentAt: number | null
  /** A hash of the last numbers sent (`numbersKey`), so the file holds no numbers and no name. */
  lastKey: string | null
  budget: GistBudget
  /** Friends and groups at the last read, for the Settings summary line. */
  friends: number
  groups: number
  /** Legacy field kept for on-disk schema compatibility. */
  refused: boolean
  /** The GitHub login that this state belongs to. A state of another account starts over. */
  account?: string | null
  /** The time of the last count, and a hash of what it counted (the cards and the local day). */
  lastCountAt?: number | null
  lastInput?: string | null
  /** Consecutive failed counts and backoff timestamp. */
  countFails?: number
  countFailedAt?: number | null
  countUnreadable?: number
  /** Local vault paths excluded from Friends counting on this Mac (YAZ-6275). */
  excludedVaults?: string[]
}

export interface MacClock {
  now(): number
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export interface MacSenderDeps {
  readToken(): Promise<string | null>
  client: Pick<FriendsApiClient, 'board' | 'sendStats' | 'clearSession'>
  /** The vaults open on this Mac, by repo (`owner/name`, lower case) → root. */
  vaults(): Promise<Map<string, string>>
  /** One vault's index records and review settings. */
  count(root: string): Promise<FriendVault>
  /** Count worker (`countJob.ts`). `zone`: the person's home time zone; null = this Mac's zone. */
  stats(text: string, now: number, closed: readonly ClosedVault[], zone: string | null): Promise<Omit<FriendStats, 'login' | 'name' | 'avatar'>>
  /** Closed vaults on this Mac that are in the user's configured vaults list (`closedVaults.ts`). */
  closed?(wanted: ReadonlySet<string>): Promise<Map<string, ClosedVault>>
  /** Vault paths or repo slugs excluded from Friends counting on this Mac (YAZ-6275). */
  excludedVaults?(): Promise<ReadonlySet<string>> | ReadonlySet<string>
  state: { load(): Promise<MacSendSaved | null>; save(saved: MacSendSaved): Promise<void> }
  clock?: MacClock
}

export interface MacSender {
  /** One try now (a change of a file with cards, the app's start, or a timer at `retryAt`). Never throws. */
  attempt(reason: SendReason): Promise<FriendsSendView>
  view(): FriendsSendView
  /** The token was saved, refreshed for a new account, or removed: forget cached session/state. */
  tokenChanged(): void
  stop(): Promise<void>
}

const nodeClock: MacClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => {
    const t = setTimeout(fn, ms)
    t.unref?.()
    return t
  },
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
}
const MAX_TIMER_MS = 60 * 60_000

/** Backoff wait after `fails` consecutive failed counts: 5 minutes, doubled each time, capped at 1 hour. */
export const failWait = (fails: number): number => Math.min(MAX_TIMER_MS, PUBLISH_EVERY_MS * 2 ** Math.max(0, fails - 1))
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const fresh = (): MacSendSaved => ({ lastSentAt: null, lastKey: null, budget: emptyBudget(), friends: 0, groups: 0, refused: false, lastCountAt: null, lastInput: null })
const turn = () => new Promise<void>((done) => setImmediate(done))

async function hashSliced(head: string, text: string): Promise<string> {
  const h = createHash('sha256').update(head)
  const SLICE = 1 << 20
  for (let i = 0; i < text.length; ) {
    let end = Math.min(text.length, i + SLICE)
    if (end < text.length && /[\uDC00-\uDFFF]/.test(text[end])) end++
    h.update(text.slice(i, end))
    i = end
    await turn()
  }
  return h.digest('hex')
}

export function createMacSender(deps: MacSenderDeps): MacSender {
  const clock = deps.clock ?? nodeClock
  let view: FriendsSendView = { status: 'idle', lastSentAt: null, retryAt: null, friends: 0, groups: 0, missing: 0 }
  let stopped = false
  let timer: unknown = null
  let chain: Promise<unknown> = Promise.resolve()
  let saved: MacSendSaved | null = null
  let tokenEpoch = 0

  const set = (status: FriendsSendStatus, patch: Partial<FriendsSendView> = {}) => {
    const { behind: _behind, unreadable: _unreadable, ...rest } = view
    view = { ...rest, retryAt: null, missing: 0, login: null, home: null, status, ...patch }
    return view
  }

  const failedView = (unreadable: number, retryAt: number) =>
    unreadable > 0 ? set('missing-vaults', { missing: unreadable, unreadable, retryAt }) : set('failed', { retryAt })

  const schedule = (at: number) => {
    if (stopped) return
    if (timer !== null) clock.clearTimeout(timer)
    timer = clock.setTimeout(() => {
      timer = null
      void attempt('timer')
    }, Math.min(MAX_TIMER_MS, Math.max(1000, at - clock.now())))
  }

  const store = async (patch: Partial<MacSendSaved>) => {
    saved = { ...(saved ?? fresh()), ...patch }
    if (!stopped) await deps.state.save(saved)
  }

  function withLimit<T>(work: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const limit = clock.setTimeout(() => reject(new Error('the count did not answer in time')), COUNT_LIMIT_MS + 5_000)
      work.then(
        (v) => {
          clock.clearTimeout(limit)
          resolve(v)
        },
        (err: unknown) => {
          clock.clearTimeout(limit)
          reject(err)
        },
      )
    })
  }

  async function run(_reason: SendReason): Promise<FriendsSendView> {
    if (stopped) return view
    const now = clock.now()
    saved ??= (await deps.state.load()) ?? fresh()
    const s = saved
    view = { ...view, lastSentAt: s.lastSentAt, friends: s.friends, groups: s.groups }
    const epoch = tokenEpoch
    const token = await deps.readToken()
    if (token === null) return set('no-token')

    if (s.budget.blockedUntil !== null && now < s.budget.blockedUntil) {
      schedule(s.budget.blockedUntil)
      return set('slowed', { retryAt: s.budget.blockedUntil })
    }

    const lastTry = Math.max(s.lastSentAt ?? -Infinity, s.lastCountAt ?? -Infinity)
    if (Number.isFinite(lastTry)) {
      const at = lastTry + PUBLISH_EVERY_MS
      if (now < at) {
        schedule(at)
        return set('waiting', { retryAt: at })
      }
    }

    if ((s.countFails ?? 0) > 0 && s.countFailedAt != null) {
      const at = s.countFailedAt + failWait(s.countFails ?? 0)
      if (now < at) {
        schedule(at)
        return failedView(s.countUnreadable ?? 0, at)
      }
    }

    try {
      const board = await deps.client.board()
      if (epoch !== tokenEpoch) return view

      if (s.account !== board.me.login) {
        Object.assign(s, fresh(), { account: board.me.login })
        await store({ ...fresh(), account: board.me.login })
      }

      const friends = board.friends.length
      const groups = board.groups.length
      await store({ friends, groups })
      view = { ...view, friends, groups }

      if (friends === 0 && groups === 0) return set('no-friends')

      const excluded = new Set<string>(s.excludedVaults ?? [])
      const extraExcluded = deps.excludedVaults ? await deps.excludedVaults() : null
      if (extraExcluded) for (const v of extraExcluded) excluded.add(v)
      const isExcluded = (repo: string, root?: string) => excluded.has(repo) || (root !== undefined && excluded.has(root))

      const rawHeld = await deps.vaults()
      const held = new Map<string, string>()
      for (const [repo, root] of rawHeld) {
        if (!isExcluded(repo, root)) held.set(repo, root)
      }
      const configuredVaults = board.me.vaults.map((v) => v.toLowerCase()).filter((v) => !isExcluded(v, rawHeld.get(v)))
      const targetRepos = configuredVaults.length > 0 ? configuredVaults : [...held.keys()]
      if (targetRepos.length === 0) return set('missing-vaults', { missing: 0 })

      const notOpen = new Set(targetRepos.filter((v) => !held.has(v)))
      const rawClosed = notOpen.size > 0 ? ((await deps.closed?.(notOpen)) ?? new Map<string, ClosedVault>()) : new Map<string, ClosedVault>()
      const closedOnMac = new Map<string, ClosedVault>()
      const excludedClosedRepos = new Set<string>()
      for (const [repo, cv] of rawClosed) {
        if (isExcluded(repo, cv.root)) excludedClosedRepos.add(repo)
        else closedOnMac.set(repo, cv)
      }
      const effectiveTargetRepos = targetRepos.filter((v) => !excludedClosedRepos.has(v))
      if (effectiveTargetRepos.length === 0) return set('missing-vaults', { missing: 0 })
      const effectiveNotOpen = [...notOpen].filter((v) => !excludedClosedRepos.has(v))
      const behind = effectiveNotOpen.filter((v) => closedOnMac.get(v)?.behind === true).length
      const missing = effectiveNotOpen.filter((v) => !closedOnMac.has(v) || closedOnMac.get(v)!.behind === true).length
      if (missing > 0) return set('missing-vaults', { missing, ...(behind > 0 && { behind }) })

      const counted: FriendVault[] = []
      const closed: ClosedVault[] = []
      for (const repo of effectiveTargetRepos) {
        const root = held.get(repo)
        if (root !== undefined) counted.push(await deps.count(root))
        else closed.push(closedOnMac.get(repo)!)
      }

      const text = await countPayloadSliced(counted, turn)
      const zone = board.me.zone ?? null
      const input = await hashSliced(`${dayIn(now, zone)}\n${zone ?? ''}\n${board.me.nickname ?? ''}\n${closed.map((c) => `${c.root}\t${c.key}`).join('\n')}\n`, text)
      if (input === s.lastInput) {
        await store({ lastCountAt: now })
        return set('unchanged')
      }

      let countedStats: Awaited<ReturnType<MacSenderDeps['stats']>>
      try {
        countedStats = await withLimit(deps.stats(text, now, closed, zone))
      } catch (err) {
        const fails = (s.countFails ?? 0) + 1
        const unreadable = err instanceof ClosedVaultsUnreadable ? err.vaults.length : 0
        await store({ countFails: fails, countFailedAt: now, countUnreadable: unreadable })
        const at = now + failWait(fails)
        schedule(at)
        return failedView(unreadable, at)
      }

      if ((s.countFails ?? 0) > 0) await store({ countFails: 0, countFailedAt: null, countUnreadable: 0 })

      const numbers = numbersFor(
        countedStats,
        { login: board.me.login, name: board.me.name, avatar: board.me.avatarUrl ?? '', nickname: board.me.nickname ?? null },
        now,
      )
      const key = hash(numbersKey(numbers))
      if (key === s.lastKey) {
        await store({ lastCountAt: now, lastInput: input })
        return set('unchanged')
      }

      await deps.client.sendStats(numbers, zone)
      if (epoch !== tokenEpoch) return view
      await store({ lastSentAt: now, lastKey: key, lastCountAt: now, lastInput: input })
      return set('sent', { lastSentAt: now })
    } catch (err) {
      if (err instanceof FriendsApiError) {
        if (err.status === 401) {
          return set(err.code === 'signed_out' ? 'no-token' : 'sign-in-again')
        }
        if (err.status === 429) {
          const at = now + 60_000
          await store({ budget: { ...s.budget, blockedUntil: at } })
          schedule(at)
          return set('slowed', { retryAt: at })
        }
        if (err.status >= 500) return set('offline')
        return set('failed')
      }
      if (err instanceof TypeError) return set('offline')
      return set('failed')
    }
  }

  function attempt(reason: SendReason): Promise<FriendsSendView> {
    const next = chain.then(() => run(reason)).catch(() => set('failed'))
    chain = next
    return next
  }

  return {
    attempt,
    view: () => view,
    tokenChanged() {
      tokenEpoch++
      deps.client.clearSession()
      if (view.status === 'no-gists' || view.status === 'no-token' || view.status === 'sign-in-again') {
        view = { ...view, status: 'idle' }
      }
      chain = chain.then(async () => {
        saved ??= (await deps.state.load()) ?? fresh()
        if (saved.refused) await store({ refused: false })
      })
    },
    async stop() {
      stopped = true
      if (timer !== null) clock.clearTimeout(timer)
      timer = null
      await chain.catch(() => undefined)
    },
  }
}
