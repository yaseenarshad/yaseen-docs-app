/**
 * THE MAC SENDS THE NUMBERS TOO (YAZ-5086, 4E5; decision 16), in the main process. It runs the SHARED rules of the
 * phone (4E1, 4E2), with no second copy of them: `sendGate`, `numbersFor`, `numbersKey`, `sendNumbers` (never lower,
 * the `gist_update` budget and its reserve) from `shared/friendSend.ts`; `findFriendsIndex`, `parseFriendsIndex`,
 * `pointersOf` from `shared/friendGists.ts`; `pendingRemove` from `shared/friendsList.ts`; `friendStats` from
 * `shared/friendStats.ts`. The Mac supplies only its edges: the gist calls with the stored token (`gistsHttp.ts`), the
 * open vaults and their counts, the stored budget, and the trigger (`cardTrigger.ts`).
 *
 * THE MAC ONLY SENDS (YAZ-5086: "The Mac only sends"). Its one write is the `PATCH` of the numbers gist. It never makes,
 * joins or edits the friends list, a pointer or a numbers gist: a remove that waits, a numbers gist to make again, or
 * two lists to join is `phone-first` (the phone does it, 4E1 and 4E2), and the Mac sends nothing meanwhile.
 * YAZ-5083: the list is in the person's home vault repo (`.yaseendocs/friends.json`). The Mac READS it there, in the
 * main process, with the shared reader (`findFriendsIndex`, `latestList`) on a read-only port (`repoHttp.ts`). A list
 * not moved yet (an old gist list) is read as before; the phone moves it. A list in a vault this Mac does not have:
 * `list-elsewhere`.
 *
 * The rules, as on the phone:
 * - only with at least one friend or group (decision 22): with none, no call writes and no gist is made;
 * - only when this Mac holds every vault of `FriendsIndex.vaults` (round 12, item 3; YAZ-5252: open, or closed and known,
 *   not behind GitHub's copy, and readable), counting only those;
 * - a count that fails waits before the next one (YAZ-5389: 5 minutes, doubled each time, at most 1 hour);
 * - only when the numbers changed; at most once each 5 minutes, longer near GitHub's limit (`sendGap`);
 * - no sync pass to wait for: the Mac's vault IS the files on disk, and the card lines sync with them (round 13, item 7:
 *   "It needs no signal from GitHub AutoSync").
 * Quiet failure: offline, a rate limit, a token with no Gists permission (stored until the token changes) give a status
 * for Settings; never a dialog, a throw or a log line. The stored state holds no token and no gist ID.
 */
import { createHash } from 'node:crypto'
import { gistErrorCode, gistErrorResetAt, pointersOf, readListGist, type GistsApi, type IndexHandle, type WriteOptions } from '@shared/friendGists'
import { BrokenList, NewerList, findFriendsIndex, latestList, listErrorCode } from '@shared/friendListHome'
import { ListError, type RepoPort } from '@shared/friendListStore'
import { PUBLISH_EVERY_MS, emptyBudget, numbersFor, numbersKey, reserveFor, sendGap, sendGate, sendNumbers, type GistBudget, type SendReason } from '@shared/friendSend'
import { dayIn, type FriendStats, type FriendVault } from '@shared/friendStatsFormat'
import type { ClosedVault } from './closedVaults'
import { COUNT_LIMIT_MS, ClosedVaultsUnreadable, countPayloadSliced } from './countJob'
import { pendingRemove } from '@shared/friendsList'
import type { FriendsSendStatus, FriendsSendView } from '@shared/types'

/** What the Mac keeps between starts (`<userData>/friends-send.json`): no token, no gist ID, no card text. */
export interface MacSendSaved {
  lastSentAt: number | null
  /** A hash of the last numbers sent (`numbersKey`), so the file holds no numbers and no name. */
  lastKey: string | null
  budget: GistBudget
  /** Friends and groups at the last read: the reserve before the list is read again, and the Settings line. */
  friends: number
  groups: number
  /** GitHub refused a write: the token has no Gists permission. No call until the token changes. */
  refused: boolean
  /** YAZ-5279: the GitHub login that this state belongs to. A state of another account starts over. */
  account?: string | null
  /** YAZ-5249: the time of the last count, and a hash of what it counted (the cards and the local day). */
  lastCountAt?: number | null
  lastInput?: string | null
  /**
   * YAZ-5389: the counts that failed in a row, and the time of the last one. The next count waits `failWait(countFails)`
   * (5 minutes, doubled each time, at most 1 hour); a count that works sets it back to 0. `countUnreadable`: how many
   * closed vaults the last failed count could not read (the view of the wait says so).
   */
  countFails?: number
  countFailedAt?: number | null
  countUnreadable?: number
}

export interface MacClock {
  now(): number
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export interface MacSenderDeps {
  readToken(): Promise<string | null>
  api(token: string): GistsApi
  profile(token: string): Promise<{ login: string; name: string | null; avatar: string }>
  /** The vaults open on this Mac, by repo (`owner/name`, lower case) → root. */
  vaults(): Promise<Map<string, string>>
  /**
   * YAZ-5083: the READ-ONLY port of the friends list in one vault repo: an open vault (`root`, its branch), or a repo the
   * note names that is not open here (`root` null: its default branch). Absent: the Mac reads only an old gist list.
   */
  repo?(token: string, repo: string, root: string | null): Promise<RepoPort | null>
  /** One vault's index records and review settings. */
  count(root: string): Promise<FriendVault>
  /**
   * The count of the packed cards (`countPayload`). YAZ-5250, YAZ-5277: the app runs it on a worker thread
   * (`countJob.ts`), so the main thread only packs and waits. Required: this file has no count of its own.
   */
  /** `zone`: the person's home time zone from the friends list (YAZ-5251); null: this Mac's own zone. */
  stats(text: string, now: number, closed: readonly ClosedVault[], zone: string | null): Promise<Omit<FriendStats, 'login' | 'name' | 'avatar'>>
  /**
   * YAZ-5252: the vaults that count and are CLOSED on this Mac, by repo (`closedVaults.ts`): counted from their files,
   * in the same worker. `wanted`: the vaults that count and are not open. Absent: only open vaults count.
   */
  closed?(wanted: ReadonlySet<string>): Promise<Map<string, ClosedVault>>
  state: { load(): Promise<MacSendSaved | null>; save(saved: MacSendSaved): Promise<void> }
  clock?: MacClock
  sleep?: (ms: number) => Promise<void>
}

export interface MacSender {
  /** One try now (a change of a file with cards, the app's start, or a timer at `retryAt`). Never throws. */
  attempt(reason: SendReason): Promise<FriendsSendView>
  view(): FriendsSendView
  /** The token was saved or removed: forget the account facts and the refusal. */
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
/**
 * YAZ-5389: the wait after `fails` counts that failed in a row: 5 minutes (the count's own rule, YAZ-5249), doubled
 * each time, at most 1 hour (the longest timer here). A count that fails (a vault too large, a file that cannot be read)
 * would fail again at once, so each card change must not start it again.
 */
export const failWait = (fails: number): number => Math.min(MAX_TIMER_MS, PUBLISH_EVERY_MS * 2 ** Math.max(0, fails - 1))
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const fresh = (): MacSendSaved => ({ lastSentAt: null, lastKey: null, budget: emptyBudget(), friends: 0, groups: 0, refused: false, lastCountAt: null, lastInput: null })
const turn = () => new Promise<void>((done) => setImmediate(done))
/** YAZ-5252: the hash of `head` and `text` (several MB), in slices of 1 MB with a turn between: the same as `hash(head + text)`. */
async function hashSliced(head: string, text: string): Promise<string> {
  const h = createHash('sha256').update(head)
  const SLICE = 1 << 20
  for (let i = 0; i < text.length; ) {
    let end = Math.min(text.length, i + SLICE)
    // Never cut a pair of UTF-16 halves: each slice is valid text, so the bytes are the bytes of the whole text.
    if (end < text.length && /[\uDC00-\uDFFF]/.test(text[end])) end++
    h.update(text.slice(i, end))
    i = end
    await turn()
  }
  return h.digest('hex')
}

/** The list for writes the Mac never makes: `findFriendsIndex` may join two lists; the Mac leaves that to the phone. */
class PhoneFirst extends Error {}
const readOnly = (api: GistsApi, repos?: () => Promise<readonly RepoPort[]>, repo?: (full: string) => Promise<RepoPort>): GistsApi => ({
  ...(repos !== undefined && { repos }),
  ...(repo !== undefined && { repo }),
  list: () => api.list(),
  read: (id, etag) => api.read(id, etag),
  create: async () => {
    throw new PhoneFirst()
  },
  update: async () => {
    throw new PhoneFirst()
  },
  remove: async () => {
    throw new PhoneFirst()
  },
})

export function createMacSender(deps: MacSenderDeps): MacSender {
  const clock = deps.clock ?? nodeClock
  const writeOptions: WriteOptions = { describe: () => '', sleep: deps.sleep ?? ((ms) => new Promise((done) => clock.setTimeout(done, ms))), now: () => clock.now() }
  let view: FriendsSendView = { status: 'idle', lastSentAt: null, retryAt: null, friends: 0, groups: 0, missing: 0 }
  let stopped = false
  let timer: unknown = null
  let chain: Promise<unknown> = Promise.resolve()
  /** For this run of the app only: the account facts and the list with its ETag (a 304 is free). */
  let profile: { token: string; value: Awaited<ReturnType<MacSenderDeps['profile']>> } | null = null
  let index: IndexHandle | null = null
  let saved: MacSendSaved | null = null
  let tokenEpoch = 0

  const set = (status: FriendsSendStatus, patch: Partial<FriendsSendView> = {}) => {
    const { behind: _behind, unreadable: _unreadable, ...rest } = view
    view = { ...rest, retryAt: null, missing: 0, login: null, home: null, status, ...patch }
    return view
  }
  /** YAZ-5389: the view while the wait after a failed count holds. */
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

  /** YAZ-5278: a count that never answers ends this try as `failed`; the next try runs. */
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

  /** The account facts of the token (`GET /user`), once per token in a run of the app. */
  async function account(token: string) {
    if (profile === null || profile.token !== token) profile = { token, value: await deps.profile(token) }
    return profile.value
  }

  async function readList(api: GistsApi, token: string): Promise<IndexHandle | 'none' | 'newer' | 'broken' | { elsewhere: string }> {
    if (index !== null) {
      try {
        // YAZ-5083: a list in the vault repo: an ETag read of the branch (free when nothing changed).
        if (index.store !== undefined) return (index = await latestList(index))
        const answer = await api.read(index.id, index.etag)
        if (answer === 'unchanged') return index
        // YAZ-5312: the list is the head and one file for each entry: read the whole gist.
        const read = readListGist(answer)
        if (read.kind === 'newer') return 'newer'
        // An old list that was moved meanwhile (its head is the note now) is found again below.
        if (read.kind === 'ok') return (index = { ...index, index: read.value, raw: read.raw, etag: answer.etag, files: read.files, state: read.list })
      } catch (err) {
        if (err instanceof NewerList) return 'newer'
        if (!(err instanceof BrokenList) && listErrorCode(err) === null && gistErrorCode(err) !== 'NOT_FOUND') throw err
      }
      index = null
    }
    const repos = async (): Promise<readonly RepoPort[]> => {
      if (deps.repo === undefined) return []
      const out: RepoPort[] = []
      for (const [repo, root] of await deps.vaults()) {
        const port = await deps.repo(token, repo, root)
        if (port !== null) out.push(port)
      }
      return out
    }
    const repo = async (full: string): Promise<RepoPort> => {
      const root = (await deps.vaults()).get(full) ?? null
      const port = deps.repo === undefined ? null : await deps.repo(token, full, root)
      if (port === null) throw new ListError('NO_LIST_ACCESS', 'No port for the vault of the friends list')
      return port
    }
    const found = await findFriendsIndex(readOnly(api, repos, deps.repo === undefined ? undefined : repo), writeOptions)
    if (found.kind === 'none' || found.kind === 'no-vault') return 'none'
    if (found.kind === 'elsewhere') return { elsewhere: found.home }
    if (found.kind === 'newer' || found.kind === 'broken') return found.kind
    // YAZ-5399: the home vault repo is gone on GitHub: the Mac sends nothing (the phone offers the way out).
    if (found.kind === 'home-gone') throw new ListError('NO_LIST_ACCESS', 'The vault of the friends list is gone')
    return (index = found.handle)
  }

  async function run(reason: SendReason): Promise<FriendsSendView> {
    if (stopped) return view
    const now = clock.now()
    saved ??= (await deps.state.load()) ?? fresh()
    const s = saved
    view = { ...view, lastSentAt: s.lastSentAt, friends: s.friends, groups: s.groups }
    const epoch = tokenEpoch
    const token = await deps.readToken()
    if (token === null) return set('no-token')
    if (s.refused) return set('no-gists')
    // YAZ-5279: the stored state belongs to one account. Once per token (the account facts are kept for the run of the
    // app), check whose it is: a token of another account starts over, with no 5-minute wait, no numbers hash and no
    // budget of the other account. GitHub that does not answer: the check waits for the next try.
    if (profile === null || profile.token !== token) {
      const login = await account(token).then((p) => p.login, () => null)
      if (login !== null && s.account !== login) {
        Object.assign(s, fresh(), { account: login })
        await store({ ...fresh(), account: login })
      }
    }
    // The cheap checks first: no network and no count while the 5-minute rule or a rate limit holds.
    const reserve = reserveFor(s.friends + s.groups)
    if (s.budget.blockedUntil !== null && now < s.budget.blockedUntil) {
      schedule(s.budget.blockedUntil)
      return set('slowed', { retryAt: s.budget.blockedUntil })
    }
    // YAZ-5249: the 5-minute rule holds for each count, not only for each send: numbers that stay the same also wait.
    const lastTry = Math.max(s.lastSentAt ?? -Infinity, s.lastCountAt ?? -Infinity)
    if (Number.isFinite(lastTry)) {
      const at = lastTry + sendGap(s.budget, now, reserve)
      if (now < at) {
        schedule(at)
        return set('waiting', { retryAt: at })
      }
    }
    // YAZ-5389: after a count that failed, the next count waits (5 minutes, doubled each time, at most 1 hour).
    if ((s.countFails ?? 0) > 0 && s.countFailedAt != null) {
      const at = s.countFailedAt + failWait(s.countFails ?? 0)
      if (now < at) {
        schedule(at)
        return failedView(s.countUnreadable ?? 0, at)
      }
    }
    const api = deps.api(token)
    try {
      const list = await readList(api, token)
      if (list === 'none') {
        await store({ friends: 0, groups: 0 })
        // YAZ-5254: no friends list on THIS token's account. Name the account: friends use one GitHub account (round
        // 13, item 4), and the phone app's account may be another one.
        const login = await account(token).then((p) => p.login, () => null)
        return set('no-list', { friends: 0, groups: 0, login })
      }
      if (list === 'newer') return set('needs-newer-app')
      if (list === 'broken') return set('needs-repair')
      // YAZ-5083: the list is in a vault this Mac does not have open: say which, and send nothing.
      if ('elsewhere' in list) return set('list-elsewhere', { home: list.elsewhere })
      const friends = list.index.friends.length
      const groups = list.index.groups.length
      const pointers = pointersOf(list.index).length
      await store({ friends, groups })
      view = { ...view, friends, groups }
      if (pendingRemove(list) !== null || list.index.stats === null) return set('phone-first')
      const held = await deps.vaults()
      // YAZ-5252: "holds" means "on this Mac": an open vault, or a closed one that the app knows (its remote matches).
      const notOpen = new Set(list.index.vaults.filter((v) => !held.has(v)))
      const closedOnMac = notOpen.size > 0 ? ((await deps.closed?.(notOpen)) ?? new Map<string, ClosedVault>()) : new Map<string, ClosedVault>()
      // YAZ-5391: a closed copy older than the newest the Mac knows (behind its remote-tracking branch) is not counted.
      const behind = [...notOpen].filter((v) => closedOnMac.get(v)?.behind === true).length
      const missing = [...notOpen].filter((v) => !closedOnMac.has(v) || closedOnMac.get(v)!.behind === true).length
      const gate = sendGate({ pointers, passSeen: true, holdsAll: list.index.vaults.length > 0 && missing === 0, lastSentAt: s.lastSentAt, now, reason, budget: s.budget })
      if (!gate.go) {
        if (gate.why === 'wait' || gate.why === 'budget') {
          schedule(gate.retryAt!)
          return set(gate.why === 'wait' ? 'waiting' : 'slowed', { retryAt: gate.retryAt! })
        }
        if (gate.why === 'missing-vaults') return set('missing-vaults', { missing, ...(behind > 0 && { behind }) })
        return set('no-friends')
      }
      // Only the vaults that count, as the phone counts them (round 12, item 3).
      const counted: FriendVault[] = []
      const closed: ClosedVault[] = []
      for (const repo of list.index.vaults) {
        const root = held.get(repo)
        if (root !== undefined) counted.push(await deps.count(root))
        else closed.push(closedOnMac.get(repo)!)
      }
      // YAZ-5249: the same cards on the same local day as at the last count: the numbers cannot change. No count.
      // YAZ-5252: packed in slices, so main is never held long (the same text as `countPayload`).
      const text = await countPayloadSliced(counted, turn)
      // YAZ-5251: the days are the person's HOME zone's (the list keeps it; the Mac never writes it). No zone yet: this
      // Mac's own, as before. The zone is in the hash, so a new zone counts the same cards again.
      const zone = list.index.zone ?? null
      const input = await hashSliced(`${dayIn(now, zone)}\n${zone ?? ''}\n${list.index.nickname ?? ''}\n${closed.map((c) => `${c.root}\t${c.key}`).join('\n')}\n`, text)
      if (input === s.lastInput) {
        await store({ lastCountAt: now })
        return set('unchanged')
      }
      const p = await account(token)
      let countedStats: Awaited<ReturnType<MacSenderDeps['stats']>>
      try {
        countedStats = await withLimit(deps.stats(text, now, closed, zone))
      } catch (err) {
        // YAZ-5389: a count that failed starts a wait (doubled each time, at most 1 hour), stored for a restart too.
        // YAZ-5388: a closed vault that could not be read is named in the view ("could not be read").
        const fails = (s.countFails ?? 0) + 1
        const unreadable = err instanceof ClosedVaultsUnreadable ? err.vaults.length : 0
        await store({ countFails: fails, countFailedAt: now, countUnreadable: unreadable })
        const at = now + failWait(fails)
        schedule(at)
        return failedView(unreadable, at)
      }
      if ((s.countFails ?? 0) > 0) await store({ countFails: 0, countFailedAt: null, countUnreadable: 0 })
      const numbers = numbersFor(countedStats, { login: p.login, name: p.name, avatar: p.avatar, nickname: list.index.nickname }, now)
      const key = hash(numbersKey(numbers))
      if (key === s.lastKey) {
        await store({ lastCountAt: now, lastInput: input })
        return set('unchanged')
      }
      // YAZ-5391: a closed vault's files can be older than the gist's numbers (the app syncs only open vaults): with one
      // in the count, no total goes lower than the gist's (the days never do). The phone's next send sets them again.
      // YAZ-5401: "never lower" is for a copy that MAY be stale, not for a real drop. A closed copy whose HEAD equals its
      // remote-tracking branch is the newest the Mac knows: with only such copies (and open vaults), a total may go
      // down (a broken streak, archived cards, due cards finished). A copy behind is not counted at all (above).
      const { outcome, budget } = await sendNumbers(api, { statsId: list.index.stats, fresh: numbers, budget: s.budget, reserve: reserveFor(pointers), now, totalsNeverLower: closed.some((c) => c.current !== true) })
      if (epoch !== tokenEpoch) return view // the token changed meanwhile: this answer is of the old token
      switch (outcome.kind) {
        case 'sent':
          await store({ lastSentAt: now, lastKey: key, budget, lastCountAt: now, lastInput: input })
          return set('sent', { lastSentAt: now })
        case 'unchanged':
          await store({ lastKey: key, budget, lastCountAt: now, lastInput: input })
          return set('unchanged')
        case 'numbers-gone':
          index = null
          return set('phone-first')
        case 'newer-app':
          return set('needs-newer-app')
        case 'budget':
        case 'rate-limited':
          await store({ budget })
          schedule(outcome.retryAt)
          return set('slowed', { retryAt: outcome.retryAt })
        case 'refused':
          await store({ refused: true })
          return set('no-gists')
        case 'offline':
          return set('offline')
        case 'unauthorized':
          return set('sign-in-again')
        default:
          return set('failed')
      }
    } catch (err) {
      if (err instanceof PhoneFirst) return set('phone-first')
      if (listErrorCode(err) === 'NO_LIST_ACCESS') return set('no-list-access')
      switch (gistErrorCode(err)) {
        case 'OFFLINE':
        case 'GITHUB_DOWN':
          return set('offline')
        case 'UNAUTHORIZED':
          return set('sign-in-again')
        case 'READ_ONLY':
          await store({ refused: true })
          return set('no-gists')
        case 'RATE_LIMITED': {
          const at = Math.max(now + 60_000, gistErrorResetAt(err) ?? 0)
          await store({ budget: { ...s.budget, blockedUntil: at } })
          schedule(at)
          return set('slowed', { retryAt: at })
        }
        default:
          return set('failed')
      }
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
      profile = null
      index = null
      if (view.status === 'no-gists' || view.status === 'no-token' || view.status === 'sign-in-again') view = { ...view, status: 'idle' }
      // In the chain, so the next try reads the state with the refusal gone.
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
