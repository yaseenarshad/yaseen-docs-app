import { DESCRIPTIONS, INDEX_FILE, emptyNumbers, pointersOf, ensureFriendsFiles, findFriendsIndex, gistErrorCode, parseFriendsIndex, writeFriendsIndex, type GistsApi, type IndexHandle } from '@shared/friendGists'
import { emptyBudget, recordUpdate, type GistBudget } from '@shared/friendSend'
import {
  addMember,
  createGroup,
  deleteGroup,
  joinGroup,
  leaveGroup,
  markJoined,
  parseAnyLink,
  readGroup,
  readJoinRequest,
  removeMember,
  sweepOrphans,
  type GroupChange,
  type GroupView,
  type JoinRequest,
  type JoinResult,
  type LeaveResult,
} from '@shared/friendGroups'
import {
  WHAT_FRIENDS_SEE,
  dropHeldShares,
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
import { drainQueue, enqueueRemove, queuedMines } from './removeQueue'
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
  /** 4E3 (YAZ-5084): groups run by an admin. */
  groups: FriendsGroups
  /** One paste box for each kind of link: a friend link (`paste`), a group link (`groups.join`), a join request (`groups.request`). */
  pasteAny(text: string): Promise<PasteResult | JoinResult | JoinRequest | Unavailable>
}

type LeaveOutcome = { kind: 'done' } | { kind: 'paused'; why: string; retryAt: number | null } | { kind: 'admin-cannot-leave' } | { kind: 'not-found' }

/** 4E3 (YAZ-5084). The logic is `shared/friendGroups.ts`; each write counts on the sender's `gist_update` budget. */
export interface FriendsGroups {
  /** "New group": `link` for the share sheet (`navigator.share({ title, text, url: link })`). */
  create(name: string): Promise<{ kind: 'ok'; group: string; link: string; title: string; text: string } | { kind: 'bad-name' } | Unavailable>
  /** Join with a group link. After `joined`, send `sendToAdmin` to the admin. */
  join(text: string): Promise<JoinResult | Unavailable>
  /** The admin's view of a join link: who asks, for which group (before `add`). */
  request(text: string): Promise<JoinRequest | Unavailable>
  add(group: string, joinText: string): Promise<GroupChange | Unavailable>
  remove(group: string, pointer: string): Promise<GroupChange | Unavailable>
  leave(group: string): Promise<LeaveOutcome | Unavailable>
  /** The admin's "Leave": the group file goes too. */
  delete(group: string): Promise<LeaveOutcome | Unavailable>
  /**
   * One group as I see it (ETags: an unchanged group costs nothing). Round 14, by itself: the first `ok` marks "joined";
   * `removed` and `gone` make the app leave (the view says so one time, for the message).
   */
  read(group: string): Promise<GroupView | Unavailable>
  /** Each group of my list, read; also deletes gists that no list names (an hour after a stop). */
  all(): Promise<GroupView[] | Unavailable>
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

  const mapRemove = async (r: RemoveResult, vault: string, queue?: { mine: string; drop?: string[] }) => {
    await saveBudget(r.budget)
    await remember(r.handle)
    // YAZ-5236: GitHub refused the first write: the list does not hold the remove yet, so the phone keeps it.
    if (queue !== undefined && r.kind === 'paused' && pointersOf(r.handle.index).includes(queue.mine)) {
      await enqueueRemove(phoneStore, { ...queue, at: now() })
      return { kind: 'paused' as const, why: r.why, retryAt: r.retryAt }
    }
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

  /** "Paste a friend's link" (4E2). */
  async function pasteText(text: string): Promise<PasteResult | Unavailable> {
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
  }

  /** The list, read again with its ETag just before a group action (another device may have changed it). */
  async function current(api: GistsApi, login: string): Promise<IndexHandle | Unavailable> {
    const h = await list(api, login, false)
    if (h === 'broken') return { kind: 'needs-repair' }
    if (h === 'newer') return { kind: 'newer-app' }
    if (h === null) return { kind: 'failed' }
    const r = await refreshed(api, h)
    if (r === 'broken') return { kind: 'needs-repair' }
    if (r === 'newer') return { kind: 'newer-app' }
    return handle ?? r
  }
  const isHandle = (x: IndexHandle | Unavailable): x is IndexHandle => 'index' in x
  /** One `gist_update` made by a group action: counted on the budget the sender keeps. */
  async function counted(n = 1): Promise<void> {
    let b = await budget()
    for (let i = 0; i < n; i++) b = recordUpdate(b, now(), null)
    await saveBudget(b)
  }
  const leaveOutcome = async (r: LeaveResult, vault: string, queue?: { mine: string; drop?: string[] }): Promise<LeaveOutcome | Unavailable> =>
    r.kind === 'admin-cannot-leave' ? r : r.kind === 'not-found' && !('handle' in r) ? { kind: 'not-found' } : mapRemove(r as RemoveResult, vault, queue)
  let swept = false

  const groups: FriendsGroups = {
    create: (name) =>
      withApi(async (api, login, vault) => {
        const h = await list(api, login, true, vault)
        if (h === 'broken') return { kind: 'needs-repair' as const }
        if (h === null || h === 'newer') return { kind: 'newer-app' as const }
        const made = await createGroup(api, h, name, login, opts)
        if (made.kind === 'refused') {
          if (await guard.live()) await recordGistsRefused(store, vault)
          return { kind: 'no-gists' as const }
        }
        if (made.kind !== 'ok') return made.kind === 'bad-name' ? made : { kind: made.kind === 'not-found' ? ('failed' as const) : made.kind }
        await remember(made.handle)
        await counted()
        return { kind: 'ok' as const, group: made.group, link: made.link, title: 'Notecards group link', text: `Join my group ${made.handle.index.groups.find((g) => g.group === made.group)?.name ?? ''} on Notecards. Open this link, copy the code, then paste it in the app.` }
      }),
    join: (text) =>
      withApi(async (api, login, vault) => {
        const link = parseAnyLink(text)
        if (link.kind === 'empty' || link.kind === 'other-app' || link.kind === 'not-a-link') return link
        const h = await list(api, login, true, vault)
        if (h === 'broken') return { kind: 'needs-repair' as const }
        if (h === null || h === 'newer') return { kind: 'newer-app' as const }
        const joined = await joinGroup(api, h, text, opts)
        if (joined.kind === 'refused') {
          if (await guard.live()) await recordGistsRefused(store, vault)
          return { kind: 'no-gists' as const }
        }
        if (joined.kind === 'joined') {
          await remember(joined.handle)
          await counted()
        }
        return joined
      }),
    request: (text) =>
      withApi(async (api, login) => {
        const h = await current(api, login)
        return isHandle(h) ? readJoinRequest(api, h, text) : h
      }),
    add: (group, joinText) =>
      withApi(async (api, login) => {
        const h = await current(api, login)
        if (!isHandle(h)) return h
        const r = await addMember(api, h, group, joinText, opts)
        if (r.kind === 'done') await counted()
        return r
      }),
    remove: (group, pointer) =>
      withApi(async (api, login) => {
        const h = await current(api, login)
        if (!isHandle(h)) return h
        const r = await removeMember(api, h, group, pointer, opts)
        if (r.kind === 'done') await counted()
        return r
      }),
    leave: (group) =>
      withApi(async (api, login, vault) => {
        const h = await current(api, login)
        if (!isHandle(h)) return h
        const mine = h.index.groups.find((g) => g.group === group)?.mine
        return leaveOutcome(await leaveGroup(api, h, group, await budget(), opts), vault, mine === undefined ? undefined : { mine })
      }),
    delete: (group) =>
      withApi(async (api, login, vault) => {
        const h = await current(api, login)
        if (!isHandle(h)) return h
        const mine = h.index.groups.find((g) => g.group === group && g.admin)?.mine
        return leaveOutcome(await deleteGroup(api, h, group, await budget(), opts), vault, mine === undefined ? undefined : { mine, drop: [group] })
      }),
    read: (group) => withApi(async (api, login, vault) => readOne(api, login, vault, group)),
    all: () =>
      withApi(async (api, login, vault) => {
        const h = await current(api, login)
        if (!isHandle(h)) return h.kind === 'failed' ? [] : h
        if (!swept) {
          swept = true
          await sweepOrphans(api, h, now())
        }
        const out: GroupView[] = []
        for (const g of h.index.groups) {
          const view = await readOne(api, login, vault, g.group)
          if ('group' in view || view.kind === 'not-found') out.push(view as GroupView)
        }
        return out
      }),
  }

  /** Reads one group and does what round 14 says on the views `ok` (first time), `removed` and `gone`. */
  async function readOne(api: GistsApi, login: string, vault: string, group: string): Promise<GroupView | Unavailable> {
    const h = await current(api, login)
    if (!isHandle(h)) return h
    const entry = h.index.groups.find((g) => g.group === group)
    if (entry !== undefined && (await queuedMines(phoneStore)).has(entry.mine)) return { kind: 'removing' as const, group, name: entry.name }
    const view = await readGroup(api, h, group, cache, now())
    if (view.kind === 'ok' && view.firstSeen) {
      const marked = await markJoined(api, h, group, opts)
      if ('index' in marked) {
        await remember(marked)
        await counted()
      }
    }
    if (view.kind === 'removed' || view.kind === 'gone') await leaveOutcome(await leaveGroup(api, handle ?? h, group, await budget(), opts), vault)
    return view
  }

  return {
    port,
    groups,
    pasteAny: async (text) => {
      const link = parseAnyLink(text)
      if (link.kind === 'group') return groups.join(text)
      if (link.kind === 'join') return groups.request(text)
      if (link.kind === 'id') {
        // A bare ID: a group file or a friend's pointer. The join path reads it and tells which.
        const joined = await groups.join(text)
        return joined.kind === 'is-friend-link' ? pasteText(text) : joined
      }
      return pasteText(text)
    },
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
    paste: (text) => pasteText(text),
    remove: (mine) =>
      withApi(async (api, login, vault) => {
        const h = await list(api, login, false)
        if (h === 'broken') return { kind: 'needs-repair' as const }
        if (h === null || h === 'newer') return { kind: 'not-found' as const }
        return mapRemove(await removeFriend(api, h, mine, await budget(), opts), vault, { mine })
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
          return { kind: 'ok' as const, rows: [], shared: [], repairs: [], held: [] }
        }
        // YAZ-5236: the removes that wait on the phone run first, then a remove that waits in the list.
        const drained = await drainQueue(api, h, phoneStore, await budget(), opts)
        if (drained !== null) {
          await mapRemove(drained, vault)
          h = drained.handle
        }
        if (pendingRemove(h) !== null) {
          const r = await finishRemove(api, h, await budget(), opts)
          await mapRemove(r, vault)
          h = r.handle
        }
        const read = await readFriends(api, h, cache, now())
        const queued = await queuedMines(phoneStore)
        for (const row of read.rows) if (queued.has(row.mine)) Object.assign(row, { state: 'removing' as const, label: 'Removing…', sendBack: null })
        // YAZ-5235: my shared links that a friend holds but does not use are deleted.
        if (read.held.length > 0) {
          h = await dropHeldShares(api, h, read.held, opts)
          await remember(h)
          read.shared = read.shared.filter((x) => !read.held.includes(x.mine))
        }
        if (read.repairs.length > 0) {
          await remember(await repairPairs(api, h, read.repairs, opts))
          return { kind: 'ok' as const, ...(await readFriends(api, handle!, cache, now())) }
        }
        return { kind: 'ok' as const, ...read }
      }),
  }
}
