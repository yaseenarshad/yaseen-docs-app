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
 *
 * The rules, as on the phone:
 * - only with at least one friend or group (decision 22): with none, no call writes and no gist is made;
 * - only when this Mac has every vault of `FriendsIndex.vaults` open (round 12, item 3), counting only those;
 * - only when the numbers changed; at most once each 5 minutes, longer near GitHub's limit (`sendGap`);
 * - no sync pass to wait for: the Mac's vault IS the files on disk, and the card lines sync with them (round 13, item 7:
 *   "It needs no signal from GitHub AutoSync").
 * Quiet failure: offline, a rate limit, a token with no Gists permission (stored until the token changes) give a status
 * for Settings; never a dialog, a throw or a log line. The stored state holds no token and no gist ID.
 */
import { createHash } from 'node:crypto'
import { findFriendsIndex, gistErrorCode, gistErrorResetAt, pointersOf, readListGist, type GistsApi, type IndexHandle, type WriteOptions } from '@shared/friendGists'
import { emptyBudget, numbersFor, numbersKey, reserveFor, sendGap, sendGate, sendNumbers, type GistBudget, type SendReason } from '@shared/friendSend'
import type { FriendStats, FriendVault } from '@shared/friendStats'
import { COUNT_LIMIT_MS, countPayload } from './countJob'
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
  /** One vault's index records and review settings. */
  count(root: string): Promise<FriendVault>
  /**
   * The count of the packed cards (`countPayload`). YAZ-5250, YAZ-5277: the app runs it on a worker thread
   * (`countJob.ts`), so the main thread only packs and waits. Required: this file has no count of its own.
   */
  stats(text: string, now: number): Promise<Omit<FriendStats, 'login' | 'name' | 'avatar'>>
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
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const fresh = (): MacSendSaved => ({ lastSentAt: null, lastKey: null, budget: emptyBudget(), friends: 0, groups: 0, refused: false, lastCountAt: null, lastInput: null })
/** The local day of `now`, as `friendStats` counts days: the same cards on another day can give other numbers. */
const localDay = (now: number) => {
  const d = new Date(now)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}
const turn = () => new Promise<void>((done) => setImmediate(done))

/** The list for writes the Mac never makes: `findFriendsIndex` may join two lists; the Mac leaves that to the phone. */
class PhoneFirst extends Error {}
const readOnly = (api: GistsApi): GistsApi => ({
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
    view = { ...view, retryAt: null, missing: 0, login: null, status, ...patch }
    return view
  }
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

  async function readList(api: GistsApi): Promise<IndexHandle | 'none' | 'newer' | 'broken'> {
    if (index !== null) {
      try {
        const answer = await api.read(index.id, index.etag)
        if (answer === 'unchanged') return index
        // YAZ-5312: the list is the head and one file for each entry: read the whole gist.
        const read = readListGist(answer)
        if (read.kind === 'newer') return 'newer'
        if (read.kind === 'ok') return (index = { ...index, index: read.value, raw: read.raw, etag: answer.etag, files: read.files, state: read.list })
      } catch (err) {
        if (gistErrorCode(err) !== 'NOT_FOUND') throw err
      }
      index = null
    }
    const found = await findFriendsIndex(readOnly(api), writeOptions)
    if (found.kind === 'none') return 'none'
    if (found.kind === 'newer' || found.kind === 'broken') return found.kind
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
    const api = deps.api(token)
    try {
      const list = await readList(api)
      if (list === 'none') {
        await store({ friends: 0, groups: 0 })
        // YAZ-5254: no friends list on THIS token's account. Name the account: friends use one GitHub account (round
        // 13, item 4), and the phone app's account may be another one.
        const login = await account(token).then((p) => p.login, () => null)
        return set('no-list', { friends: 0, groups: 0, login })
      }
      if (list === 'newer') return set('needs-newer-app')
      if (list === 'broken') return set('needs-repair')
      const friends = list.index.friends.length
      const groups = list.index.groups.length
      const pointers = pointersOf(list.index).length
      await store({ friends, groups })
      view = { ...view, friends, groups }
      if (pendingRemove(list) !== null || list.index.stats === null) return set('phone-first')
      const held = await deps.vaults()
      const missing = list.index.vaults.filter((v) => !held.has(v)).length
      const gate = sendGate({ pointers, passSeen: true, holdsAll: list.index.vaults.length > 0 && missing === 0, lastSentAt: s.lastSentAt, now, reason, budget: s.budget })
      if (!gate.go) {
        if (gate.why === 'wait' || gate.why === 'budget') {
          schedule(gate.retryAt!)
          return set(gate.why === 'wait' ? 'waiting' : 'slowed', { retryAt: gate.retryAt! })
        }
        if (gate.why === 'missing-vaults') return set('missing-vaults', { missing })
        return set('no-friends')
      }
      // Only the vaults that count, as the phone counts them (round 12, item 3).
      const counted: FriendVault[] = []
      for (const repo of list.index.vaults) counted.push(await deps.count(held.get(repo)!))
      // YAZ-5249: the same cards on the same local day as at the last count: the numbers cannot change. No count.
      const text = countPayload(counted)
      await turn()
      const input = hash(`${localDay(now)}\n${list.index.nickname ?? ''}\n${text}`)
      await turn()
      if (input === s.lastInput) {
        await store({ lastCountAt: now })
        return set('unchanged')
      }
      const p = await account(token)
      const numbers = numbersFor(await withLimit(deps.stats(text, now)), { login: p.login, name: p.name, avatar: p.avatar, nickname: list.index.nickname }, now)
      const key = hash(numbersKey(numbers))
      if (key === s.lastKey) {
        await store({ lastCountAt: now, lastInput: input })
        return set('unchanged')
      }
      const { outcome, budget } = await sendNumbers(api, { statsId: list.index.stats, fresh: numbers, budget: s.budget, reserve: reserveFor(pointers), now })
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
