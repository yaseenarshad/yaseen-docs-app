import { DESCRIPTIONS, INDEX_FILE, emptyNumbers, ensureFriendsFiles, findFriendsIndex, gistErrorCode, parseFriendsIndex, writeFriendsIndex, type GistsApi, type IndexHandle } from '@shared/friendGists'
import { emptyBudget, type GistBudget } from '@shared/friendSend'
import {
  WHAT_FRIENDS_SEE,
  finishRemove,
  newListCache,
  parseFriendLink,
  pasteLink,
  pendingRemove,
  readFriends,
  removeFriend,
  repairPairs,
  shareLink,
  shareText,
  type ListOptions,
  type ListRows,
  type PasteResult,
  type RemoveResult,
} from '@shared/friendsList'
import { localFriends, type FriendsPort, type FriendsSettings } from '../app/friendsPort'
import { recordGistsRefused } from '../auth/friends'
import { loadAccount } from '../auth/account'
import type { FetchLike } from '../github/client'
import { PHONE, VaultClosedError, loadVaultList, vaultId, type TokenStore, type VaultStore } from '../store'
import type { Clock } from '../sync/engine'
import { openFriendsApi } from './friendsApi'
import { friendsGuard } from './guard'
import { SEND_STATE } from './sender'

/**
 * The friends list on the phone (YAZ-5083, 4E2): "Share my link", "Paste a friend's link", Remove, the rows, and the
 * `FriendsPort` of 4A (`app/friendsPort.ts`) on the person's friends list gist (decision 15; round 12, item 3).
 * The logic is `shared/friendsList.ts`; this file adds the phone's account (3E, round 13 item 4), its stored state,
 * the lock that the sender (4E1) also takes, and the `gist_update` budget that the sender keeps. No screen: 4E4 draws.
 *
 * "Vaults that count" and "Name" (decision 22) lived on the phone (4A's `localFriends`) until the first friend. The
 * first share or paste makes the list and carries them over: 4A's "every vault" (`null`) becomes the phone's vaults on
 * the friends account; a vault id (`owner/name@branch`) becomes `owner/name` in lower case, as the Mac names it too.
 */
export type Unavailable =
  | { kind: 'no-gists' }
  | { kind: 'no-account' }
  | { kind: 'offline' }
  | { kind: 'rate-limited' }
  | { kind: 'unauthorized' }
  | { kind: 'newer-app' }
  /** My friends list on GitHub cannot be read: nothing is written to it (YAZ-5191). Show `LIST_NEEDS_REPAIR`. */
  | { kind: 'needs-repair' }
  | { kind: 'failed' }

export interface ShareResult {
  kind: 'ok'
  /** The link for the iOS share sheet (`navigator.share({ title, text, url: link })`). */
  link: string
  title: string
  text: string
  /** Decision 22: say one time what a friend sees. */
  whatFriendsSee: string
}

export interface FriendsList {
  share(): Promise<ShareResult | Unavailable>
  paste(text: string): Promise<PasteResult | Unavailable>
  /** Remove by my pointer for them (`FriendRow.mine`, a shared link's `mine`). `paused`: it finishes later by itself. */
  remove(mine: string): Promise<{ kind: 'done' } | { kind: 'paused'; why: string; retryAt: number | null } | { kind: 'not-found' } | Unavailable>
  /** The friends' rows and my shared links; reads each friend (ETags: an unchanged friend costs nothing). */
  rows(): Promise<({ kind: 'ok' } & ListRows) | Unavailable>
  /** 4A's port, on the list gist. */
  port: FriendsPort
  /** YAZ-5195: before "Sign out and erase this phone": aborts a running request; no friends call or write after it. */
  stop(): void
}

export interface FriendsListOptions {
  store: VaultStore
  tokens: TokenStore
  fetch?: FetchLike
  clock?: Clock
  sleep?: (ms: number) => Promise<void>
  lock?: <T>(name: string, fn: () => Promise<T>) => Promise<T>
  describe?: ListOptions['describe']
  /** YAZ-5195: the app's erase signal; aborted, the list stops as `stop()` does. */
  signal?: AbortSignal
}

/** Phone-only state: whether there is a friend or group (the opening tab, decision 21), and a copy of the settings. */
const HAS = 'friendsHas'
const COPY = 'friendsListCopy'
interface ListCopy {
  vaults: string[]
  nickname: string | null
}

function webLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks = (globalThis as { navigator?: { locks?: { request(name: string, fn: () => Promise<T>): Promise<T> } } }).navigator?.locks
  return locks === undefined ? fn() : locks.request(name, fn)
}

export function createFriendsList(options: FriendsListOptions): FriendsList {
  const { store, tokens } = options
  const now = () => (options.clock ?? { now: Date.now }).now()
  const lock = options.lock ?? webLock
  const opts: ListOptions = {
    describe: options.describe ?? ((kind) => DESCRIPTIONS[kind]),
    sleep: options.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms))),
    now,
  }
  const cache = newListCache()
  const guard = friendsGuard(store, options.fetch, options.signal)
  /** The phone-wide session of the running action (YAZ-5195). */
  let phoneStore: VaultStore = store
  let handle: IndexHandle | null = null
  const local = localFriends(store)

  /** The phone's vaults whose account is the friends login: what "every vault" means. */
  async function phoneRepos(login: string): Promise<string[]> {
    const list = await loadVaultList(store)
    const out: string[] = []
    for (const v of list.vaults) {
      const account = await loadAccount(store, vaultId(v))
      if (account !== undefined && account.login.toLowerCase() === login.toLowerCase()) out.push(v.repo.toLowerCase())
    }
    return [...new Set(out)]
  }
  async function idsToRepos(ids: string[] | null, login: string): Promise<string[]> {
    if (ids === null) return phoneRepos(login)
    const list = await loadVaultList(store)
    return [...new Set(list.vaults.filter((v) => ids.includes(vaultId(v))).map((v) => v.repo.toLowerCase()))]
  }
  async function reposToIds(repos: string[]): Promise<string[]> {
    const list = await loadVaultList(store)
    return list.vaults.filter((v) => repos.includes(v.repo.toLowerCase())).map(vaultId)
  }

  /** Remembers what the screens need offline: a friend or not, and the settings. */
  async function remember(h: IndexHandle | null): Promise<void> {
    handle = h
    if (h === null) return
    if (!(await guard.live())) return // YAZ-5195: nothing comes back after an erase
    await phoneStore.setState(PHONE, HAS, h.index.friends.length + h.index.groups.length > 0)
    await phoneStore.setState(PHONE, COPY, { vaults: h.index.vaults, nickname: h.index.nickname } satisfies ListCopy)
  }

  /** This session's copy of the list, read again with its ETag (a free 304 when nothing changed, also on another device). */
  async function refreshed(api: GistsApi, h: IndexHandle): Promise<IndexHandle | 'newer' | 'broken'> {
    try {
      const answer = await api.read(h.id, h.etag)
      if (answer === 'unchanged') return h
      const file = answer.files[INDEX_FILE]
      const read = parseFriendsIndex(file?.truncated ? null : file?.content)
      if (read.kind === 'newer') return 'newer'
      if (read.kind === 'unreadable') {
        handle = null
        return 'broken'
      }
      const next = { ...h, index: read.value, raw: read.raw, etag: answer.etag }
      await remember(next)
      return next
    } catch (err) {
      if (gistErrorCode(err) !== 'NOT_FOUND') throw err
      handle = null
      return h
    }
  }

  /** The list: this session's copy, or found by its file name; made (with the carried-over settings) when `make`. */
  async function list(api: GistsApi, login: string, make: boolean, vault = ''): Promise<IndexHandle | null | 'newer' | 'broken'> {
    if (handle !== null) return handle
    const found = await findFriendsIndex(api, opts)
    if (found.kind === 'newer') return 'newer'
    if (found.kind === 'broken') return 'broken'
    if (found.kind === 'ok') {
      await remember(found.handle)
      return found.handle
    }
    if (!make) return null
    const settings = await local.settings()
    // The first numbers file names the person at once (the sender fills the numbers after the next sync pass).
    const account = vault === '' ? undefined : await loadAccount(store, vault)
    const numbers = { ...emptyNumbers(now()), login, name: settings.nickname ?? account?.name ?? login, avatar: account?.avatarUrl ?? '' }
    const made = await ensureFriendsFiles(api, { vaults: await idsToRepos(settings.vaults, login), nickname: settings.nickname, numbers }, opts)
    if (made.kind !== 'ok') return made.kind
    await remember(made.handle)
    return made.handle
  }

  async function budget(): Promise<GistBudget> {
    return (await store.getState<{ budget?: GistBudget }>(PHONE, SEND_STATE))?.budget ?? emptyBudget()
  }
  async function saveBudget(b: GistBudget): Promise<void> {
    const saved = (await store.getState<Record<string, unknown>>(PHONE, SEND_STATE)) ?? { lastSentAt: null, lastKey: null, pointers: 0 }
    if (await guard.live()) await phoneStore.setState(PHONE, SEND_STATE, { ...saved, budget: b })
  }

  /** Runs `fn` with the friends account, under the lock the sender takes; a gist failure becomes plain state. */
  async function withApi<T>(fn: (api: GistsApi, login: string, vault: string) => Promise<T | Unavailable>): Promise<T | Unavailable> {
    if (!(await guard.live())) return { kind: 'no-account' }
    // YAZ-5195: the phone-wide session of this action; after an erase in any tab its writes throw VaultClosedError.
    phoneStore = await store.session(PHONE)
    const friends = await openFriendsApi(store, tokens, { fetch: guard.fetch, now })
    if (friends.kind !== 'ok') return { kind: friends.kind }
    return lock('notecards-friends', async () => {
      try {
        return await fn(friends.api, friends.account.login, friends.vault)
      } catch (err) {
        if (err instanceof VaultClosedError) return { kind: 'no-account' as const }
        switch (gistErrorCode(err)) {
          case 'READ_ONLY':
            if (await guard.live()) await recordGistsRefused(store, friends.vault)
            return { kind: 'no-gists' as const }
          case 'OFFLINE':
          case 'GITHUB_DOWN':
            return { kind: 'offline' as const }
          case 'RATE_LIMITED':
            return { kind: 'rate-limited' as const }
          case 'UNAUTHORIZED':
            return { kind: 'unauthorized' as const }
          case 'NOT_FOUND':
            handle = null
            return { kind: 'failed' as const }
          default:
            throw err
        }
      }
    })
  }

  const mapRemove = async (r: RemoveResult, vault: string) => {
    await saveBudget(r.budget)
    await remember(r.handle)
    if (r.kind === 'done') return { kind: 'done' as const }
    if (r.kind === 'not-found') return { kind: 'not-found' as const }
    if (r.why === 'needs-repair') return { kind: 'needs-repair' as const }
    if (r.why === 'refused') {
      if (await guard.live()) await recordGistsRefused(store, vault)
      return { kind: 'no-gists' as const }
    }
    return { kind: 'paused' as const, why: r.why, retryAt: r.retryAt }
  }

  const port: FriendsPort = {
    hasFriends: async () => (await store.getState<boolean>(PHONE, HAS)) ?? false,
    async settings(): Promise<FriendsSettings> {
      const copy = await store.getState<ListCopy>(PHONE, COPY)
      if (copy === undefined) return local.settings()
      return { vaults: await reposToIds(copy.vaults), nickname: copy.nickname }
    },
    async saveSettings(settings) {
      await local.saveSettings(settings)
      const copy = await store.getState<ListCopy>(PHONE, COPY)
      if (copy === undefined) return // no list yet: the first share or paste carries them over
      const result = await withApi(async (api, login) => {
        handle = null // read it again just before the write
        const fresh = await list(api, login, false)
        if (fresh === 'broken') return { kind: 'needs-repair' as const }
        if (fresh === null || fresh === 'newer') return { kind: 'failed' as const }
        const next = await writeFriendsIndex(api, fresh, { ...fresh.index, vaults: await idsToRepos(settings.vaults, login), nickname: settings.nickname })
        await remember(next)
        return { kind: 'ok' as const }
      })
      if (result.kind !== 'ok') throw new Error('The friends settings could not be saved to GitHub. Try again.')
    },
  }

  return {
    port,
    stop: () => guard.stop(),
    share: () =>
      withApi(async (api, login, vault) => {
        const h = await list(api, login, true, vault)
        if (h === 'broken') return { kind: 'needs-repair' as const }
        if (h === null || h === 'newer') return { kind: 'newer-app' as const }
        const shared = await shareLink(api, h, opts)
        await remember(shared.handle)
        return { kind: 'ok' as const, link: shared.link, ...shareText(shared.link), whatFriendsSee: WHAT_FRIENDS_SEE }
      }),
    async paste(text) {
      const link = parseFriendLink(text)
      if (link.kind !== 'ok') return link
      return withApi(async (api, login, vault) => {
        const h = await list(api, login, true, vault)
        if (h === 'broken') return { kind: 'needs-repair' as const }
        if (h === null || h === 'newer') return { kind: 'newer-app' as const }
        const result = await pasteLink(api, h, text, opts)
        if (result.kind === 'refused') {
          if (await guard.live()) await recordGistsRefused(store, vault)
          return { kind: 'no-gists' as const }
        }
        if (result.kind === 'added') await remember(result.handle)
        return result
      })
    },
    remove: (mine) =>
      withApi(async (api, login, vault) => {
        const h = await list(api, login, false)
        if (h === 'broken') return { kind: 'needs-repair' as const }
        if (h === null || h === 'newer') return { kind: 'not-found' as const }
        return mapRemove(await removeFriend(api, h, mine, await budget(), opts), vault)
      }),
    rows: () =>
      withApi(async (api, login, vault) => {
        let h = await list(api, login, false)
        if (h !== null && h !== 'newer' && h !== 'broken') {
          h = await refreshed(api, h)
          if (h !== 'newer' && h !== 'broken' && handle === null) h = await list(api, login, false)
        }
        if (h === 'broken') return { kind: 'needs-repair' as const }
        if (h === 'newer') return { kind: 'newer-app' as const }
        if (h === null) {
          if (await guard.live()) await phoneStore.setState(PHONE, HAS, false)
          return { kind: 'ok' as const, rows: [], shared: [], repairs: [] }
        }
        if (pendingRemove(h) !== null) {
          const r = await finishRemove(api, h, await budget(), opts)
          await mapRemove(r, vault)
          h = r.handle
        }
        const read = await readFriends(api, h, cache, now())
        if (read.repairs.length > 0) {
          await remember(await repairPairs(api, h, read.repairs, opts))
          return { kind: 'ok' as const, ...(await readFriends(api, handle!, cache, now())) }
        }
        return { kind: 'ok' as const, ...read }
      }),
  }
}
