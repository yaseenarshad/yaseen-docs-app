import { WHAT_FRIENDS_SEE, type FriendRow, type PasteResult } from '@shared/friendsList'
import { numbersFor } from '@shared/friendSend'
import { parseFriendStats, type FriendMark, type FriendStats } from '@shared/friendStats'
import type { FriendsPort } from '../../app/friendsPort'
import { loadAccount } from '../../auth/account'
import { loadFriendsAccount } from '../../auth/friends'
import type { FetchLike } from '../../github/client'
import { PHONE, loadVaultList, vaultId, type TokenStore, type VaultStore } from '../../store'
import type { SyncEngine } from '../../sync/engine'
import { createOwnNumbers, type OwnNumbers } from '../ownNumbers'
import { createFriendsList, type FriendsList, type ShareResult, type Unavailable } from '../list'
import { createFriendsSender, type FriendsSender } from '../sender'
import { avatarUrl, gistText, type SeenMark } from './board'
import type { GroupView, GroupsPort, JoinRequest, JoinResult } from './groups'
import { createMarks, type MarkKind, type MarkSend, type Marks, type OutMark } from './marks'

/**
 * What the Friends screens (4E4) use: 4E2's list (`createFriendsList`), 4E1's sender (`createFriendsSender`), the
 * cheers and nudges (`marks.ts`), my own numbers, and 4E3's groups when they are there. It is 4A's `FriendsPort` too
 * (`hasFriends` opens the app on Friends, decision 21; "Vaults that count" and "Name" are in the list gist).
 * The screens get it through `lazyFriends` (`lazy.ts`), so this file and the friends logic load as a chunk of their own.
 */
export interface Me {
  name: string
  avatar: string | null
  /** My numbers, counted on this phone with 2C's `friendStats` (what the next send writes). Null: the phone does not
   *  hold every vault that counts. */
  stats: FriendStats | null
}

export interface FriendEntry {
  theirs: string
  mine: string
  name: string
  avatar: string | null
  state: FriendRow['state']
  /** 4E2's words for a row that is not `ok` ("Waiting for Sam to add you", "No longer shares with you", …). */
  label: string | null
  /** My link to send back (a "Waiting…" row). */
  sendBack: string | null
  stats: FriendStats | null
  /** GitHub's time of their numbers gist. */
  updatedAt: number | null
  /** Their cheer or nudge for me, as their pointer holds it (the "seen" rule is the screen's, `markToShow`). */
  mark: FriendMark | undefined
}

export type Board =
  | {
      kind: 'ok'
      me: Me
      friends: FriendEntry[]
      shared: { mine: string; link: string; at: string }[]
      groups: GroupView[]
      seen: Record<string, SeenMark>
      outbox: Record<string, OutMark>
      /** No answer from GitHub this time: the numbers are the last ones read. */
      offline: boolean
      /** YAZ-5274: friends who added me back since the last read (their names): the tab says so one time. */
      newlyPaired?: string[]
    }
  | Unavailable

export type PasteAnswer = PasteResult | JoinResult | JoinRequest | Unavailable

export interface FriendsService {
  board(): Promise<Board>
  share(): Promise<ShareResult | Unavailable>
  paste(text: string): Promise<PasteAnswer>
  remove(mine: string): Promise<{ kind: 'done' } | { kind: 'paused'; why: string; retryAt: number | null } | { kind: 'not-found' } | Unavailable>
  mark(mine: string, kind: MarkKind): Promise<MarkSend>
  see(marks: readonly { theirs: string; mark: FriendMark }[]): Promise<void>
  groups: GroupsPort | null
  whatFriendsSee: string
}

/** 4A's port with the screens' service; `stop` before "Sign out and erase this phone" (YAZ-5195). */
export interface FriendsServices extends FriendsPort {
  service(): Promise<FriendsService>
  stop(): Promise<void>
}

const BOARD_COPY = 'friendsBoardCopy'
type BoardCopy = {
  friends: FriendEntry[]
  shared: Extract<Board, { kind: 'ok' }>['shared']
  groups: GroupView[]
}

export interface ServiceOptions {
  store: VaultStore
  tokens: TokenStore
  fetch?: FetchLike
  now?: () => number
  /** 3B's engine once it loads: the sender listens to its passes (4E1). Absent in tests. */
  engine?: Promise<SyncEngine>
  sleep?: (ms: number) => Promise<void>
  /** YAZ-5255: the kept count of my numbers (tests pass one to count the counts). */
  numbers?: OwnNumbers
  lock?: <T>(name: string, fn: () => Promise<T>) => Promise<T>
}

export function createFriendsService(options: ServiceOptions): FriendsService & {
  port: FriendsPort
  stop(): Promise<void>
  list: FriendsList
  marks: Marks
} {
  const { store, tokens } = options
  const now = options.now ?? Date.now
  const clock = {
    now,
    setTimeout: (fn: () => void, ms: number) => globalThis.setTimeout(fn, ms),
    clearTimeout: (h: unknown) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
  }
  const list = createFriendsList({
    store,
    tokens,
    fetch: options.fetch,
    clock,
    sleep: options.sleep,
    lock: options.lock,
  })
  const marks = createMarks({
    store,
    tokens,
    fetch: options.fetch,
    now,
    lock: options.lock,
  })
  // 4E3 (YAZ-5084): groups run by an admin, on the same list.
  const groups: GroupsPort = list.groups
  // YAZ-5255: my numbers, counted once for each change and kept; my row and the sender read the same count.
  const own: OwnNumbers = options.numbers ?? createOwnNumbers(store)

  let sender: FriendsSender | null = null
  /** My pointers at the last read (one remove-reserve update each), for a mark on a phone the sender has not counted yet. */
  let pointerCount = 0
  let stopped = false
  const onHidden = () => {
    if (document.visibilityState === 'hidden') void sender?.background()
  }
  let unfollow: (() => void) | null = null
  void options.engine?.then((engine) => {
    if (stopped) return
    unfollow = own.follow(engine)
    sender = createFriendsSender({
      numbers: own,
      store,
      tokens,
      sync: engine,
      fetch: options.fetch,
      clock,
      sleep: options.sleep,
      lock: options.lock,
    })
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onHidden)
  })

  /** My own row: my numbers as this phone counts them now (the same 2C function the send uses). */
  async function me(): Promise<Me> {
    const settings = await list.port.settings()
    const account = await loadFriendsAccount(store)
    const vault = account.kind === 'ok' || account.kind === 'two-accounts' ? account.vault : null
    const profile = vault === null ? undefined : await loadAccount(store, vault)
    const name = gistText(settings.nickname ?? profile?.name ?? profile?.login ?? '') || 'You'
    const phone = await loadVaultList(store)
    const ids = settings.vaults ?? phone.vaults.map(vaultId)
    const repos = phone.vaults.filter((v) => ids.includes(vaultId(v))).map((v) => v.repo.toLowerCase())
    const counted = await own.counted(repos, now())
    const stats =
      counted === null
        ? null
        : numbersFor(
            counted,
            {
              login: profile?.login ?? '',
              name: profile?.name ?? '',
              nickname: settings.nickname,
              avatar: profile?.avatarUrl ?? '',
            },
            now(),
          )
    return { name, avatar: avatarUrl(profile?.avatarUrl), stats }
  }

  const entryOf = (row: FriendRow): FriendEntry => {
    const ok = row.read !== null && row.read.kind === 'ok' ? row.read : null
    return {
      theirs: row.theirs,
      mine: row.mine,
      name: gistText(row.name) || 'Friend',
      avatar: avatarUrl(ok?.stats.avatar),
      state: row.state,
      // YAZ-5256: 4E2's words hold the raw name ("Waiting for <name> to add you"): the cleaned one goes in its place.
      label: row.label === null ? null : row.name === '' ? row.label : row.label.split(row.name).join(gistText(row.name) || 'your friend'),
      sendBack: row.sendBack,
      stats: ok?.stats ?? null,
      updatedAt: ok?.updatedAt ?? null,
      mark: ok?.pointer.mark,
    }
  }

  async function saveCopy(copy: BoardCopy) {
    if ((await loadVaultList(store)).vaults.length === 0) return
    await (await store.session(PHONE)).setState(PHONE, BOARD_COPY, copy).catch(() => undefined)
  }
  async function loadCopy(): Promise<BoardCopy | null> {
    const copy = await store.getState<BoardCopy>(PHONE, BOARD_COPY)
    if (copy === undefined || copy === null || !Array.isArray(copy.friends)) return null
    // Read again as a friend's file: a stored copy is checked as the gist was.
    const friends = copy.friends.map((f) => {
      const read = f.stats === null ? null : parseFriendStats(JSON.stringify(f.stats))
      return { ...f, stats: read !== null && read.ok ? read.value : null }
    })
    // YAZ-5259: the groups too, each member's numbers checked again as a friend's file.
    const groups = (Array.isArray(copy.groups) ? copy.groups : []).map((g): GroupView => {
      if (g.kind !== 'ok') return g
      return {
        ...g,
        members: g.members.map((m) => {
          if (m.read === null || m.read.kind !== 'ok') return m
          const read = parseFriendStats(JSON.stringify(m.read.stats))
          return read.ok ? { ...m, read: { ...m.read, stats: read.value } } : { ...m, read: null, state: 'unreadable' as const }
        }),
      }
    })
    return { friends, shared: copy.shared ?? [], groups }
  }

  return {
    list,
    marks,
    groups,
    whatFriendsSee: WHAT_FRIENDS_SEE,
    port: list.port,
    async board() {
      await marks.flush()
      const rows = await list.rows()
      const [mine, seen, outbox] = await Promise.all([me(), marks.seen(), marks.outbox()])
      if (rows.kind === 'ok') {
        const all = await groups.all()
        // YAZ-5259: a group that cannot be read now keeps its last view (its members' "updated … ago" say how old).
        const kept = Array.isArray(all) && all.every((g) => g.kind !== 'offline') ? [] : (await loadCopy())?.groups ?? []
        const last = (g: GroupView) => (g.kind === 'offline' ? kept.find((k) => k.kind === 'ok' && k.group === g.group) ?? g : g)
        const groupViews = Array.isArray(all) ? all.map(cleanGroup).map(last) : kept
        const friends = rows.rows.map(entryOf)
        pointerCount = rows.rows.length + rows.shared.length + groupViews.length
        const offline = rows.rows.some((r) => r.read?.kind === 'ok' && r.read.stale !== undefined) || rows.rows.some((r) => r.state === 'offline')
        await saveCopy({ friends, shared: rows.shared, groups: groupViews })
        return {
          kind: 'ok',
          me: mine,
          friends,
          shared: rows.shared,
          groups: groupViews,
          seen,
          outbox,
          offline,
          newlyPaired: rows.rows.filter((r) => rows.newlyPaired.includes(r.mine)).map((r) => gistText(r.name) || 'Your friend'),
        }
      }
      if (rows.kind === 'offline' || rows.kind === 'rate-limited') {
        const copy = await loadCopy()
        if (copy !== null) return { kind: 'ok', me: mine, ...copy, seen, outbox, offline: true }
      }
      return rows
    },
    share: () => list.share(),
    paste: async (text) => cleanAnswer(await list.pasteAny(text)),
    remove: (mine) => list.remove(mine),
    mark: (mine, kind) => marks.send(mine, kind, pointerCount),
    see: (seen) => marks.see(seen),
    async stop() {
      stopped = true
      unfollow?.()
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onHidden)
      list.stop()
      marks.stop()
      await sender?.stop()
    },
  }
}

/** YAZ-5256: each name and login of a group view from a gist, cleaned once (`gistText`). */
function cleanGroup(view: GroupView): GroupView {
  if (view.kind === 'not-found') return view
  const named = { ...view, name: gistText(view.name, 30) || 'Group' }
  if (named.kind !== 'ok') return named
  return { ...named, members: named.members.map((m) => ({ ...m, name: gistText(m.name) || gistText(m.login) || 'Member', login: gistText(m.login) })) }
}

/** YAZ-5256: the names in a paste answer (a friend, a group, a person who asks to join), cleaned before the words. */
function cleanAnswer(answer: PasteAnswer): PasteAnswer {
  const out = { ...answer } as Record<string, unknown>
  for (const field of ['name', 'groupName', 'login']) if (typeof out[field] === 'string') out[field] = gistText(out[field])
  return out as PasteAnswer
}
