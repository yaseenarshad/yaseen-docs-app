import type { EntryKind } from '@shared/friendGists'
import { WHAT_FRIENDS_SEE, type FriendRow, type PasteResult } from '@shared/friendsList'
import { numbersFor } from '@shared/friendSend'
import { parseFriendStats, type FriendMark, type FriendStats } from '@shared/friendStats'
import {
  DEFAULT_FRIENDS_ORIGIN,
  FriendsApiError,
  createFriendsApiClient,
  type FriendsApiClient,
  type FriendsBoardPayload,
  type GroupBoardItem,
  type SharedCardItem,
  type SharedCardStatus,
  type SharedFolderItem,
} from '@shared/friendsApi'
import { buildAcceptedCardFile, parseInviteInput } from '@shared/friendsShare'
import { deviceZone } from '@shared/timeZone'
import { localFriends, type FriendsPort, type FriendsSettings } from '../../app/friendsPort'
import { loadAccount } from '../../auth/account'
import { githubClient, type FetchLike } from '../../github/client'
import { PHONE, loadVaultList, vaultId, type TokenStore, type VaultStore } from '../../store'
import type { SyncEngine } from '../../sync/engine'
import { githubRemote, type Change } from '../../sync/githubRemote'
import { createOwnNumbers, type OwnNumbers } from '../ownNumbers'
import type { ShareResult, Unavailable } from '../list'
import type { FriendsSendState } from '../sender'
import { addDays, avatarUrl, gistText, localDay, type SeenMark } from './board'
import type { GroupMemberRow, GroupView, GroupsPort, JoinRequest, JoinResult } from './groups'
import { HAS_FRIENDS_STATE } from './lazy'
import type { MarkKind, MarkSend, OutMark } from './marks'

/**
 * What the Friends screens use: wired directly to Cloudflare D1 (`@shared/friendsApi`),
 * using the existing GitHub App token from `TokenStore`. No Gist API calls.
 */
export interface Me {
  name: string
  avatar: string | null
  stats: FriendStats | null
}

export interface FriendEntry {
  theirs: string
  mine: string
  name: string
  avatar: string | null
  state: FriendRow['state']
  label: string | null
  sendBack: string | null
  stats: FriendStats | null
  updatedAt: number | null
  mark: FriendMark | undefined
  /** D1 fields (YAZ-6218). */
  userId?: number
  login?: string
  since?: string
  sharedCardCount?: number
  incomingMarkMessage?: string | null
  outgoingMark?: { kind: MarkKind; message?: string | null; at: string } | null
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
      offline: boolean
      sending?: FriendsSendState
      newlyPaired?: string[]
      /** D1 fields (YAZ-6218). */
      incomingCards?: SharedCardItem[]
      d1Groups?: GroupBoardItem[]
    }
  | Unavailable

export type PasteAnswer = PasteResult | JoinResult | JoinRequest | Unavailable

export interface FriendsService {
  board(): Promise<Board>
  share(): Promise<ShareResult | Unavailable>
  paste(text: string): Promise<PasteAnswer>
  remove(mine: string, asked?: EntryKind): Promise<{ kind: 'done' } | { kind: 'paused'; why: string; retryAt: number | null } | { kind: 'not-found' } | Unavailable>
  restart?(vault: string): Promise<{ kind: 'done' } | { kind: 'home-is-there' } | { kind: 'too-many-gists' } | Unavailable>
  mark(mine: string, kind: MarkKind, message?: string): Promise<MarkSend>
  see(marks: readonly { theirs: string; mark: FriendMark }[]): Promise<void>
  groups: GroupsPort | null
  whatFriendsSee: string
  /** D1 card/folder sharing & group management (YAZ-6218). */
  shareCards?(input: {
    groupId?: string
    toUserIds?: number[]
    folderName?: string
    cards: { title: string; markdown: string; note?: string | null }[]
  }): Promise<{ ok: true; count: number } | { ok: false; error: string }>
  setCardState?(cardId: string, status: SharedCardStatus): Promise<{ ok: true } | { ok: false; error: string }>
  setFolderState?(folderId: string, status: SharedCardStatus): Promise<{ ok: true } | { ok: false; error: string }>
  deleteSharedCard?(cardId: string): Promise<{ ok: true } | { ok: false; error: string }>
  approveMember?(groupId: string, userId: number): Promise<{ ok: true } | { ok: false; error: string }>
  rotateGroupInvite?(groupId: string): Promise<{ ok: true; inviteCode: string; link: string } | { ok: false; error: string }>
  vaultFolders?(): Promise<string[]>
  acceptCardToVault?(input: {
    card: SharedCardItem
    folder: string
    upNext?: boolean
  }): Promise<{ ok: true; path: string } | { ok: false; error: string }>
  importFolderToVault?(input: {
    folder: SharedFolderItem
    targetDir: string
    upNext?: boolean
  }): Promise<{ ok: true; paths: string[] } | { ok: false; error: string }>
  deleteMe?(): Promise<{ ok: true; deleted: true } | { ok: false; error: string }>
}

export interface FriendsServices extends FriendsPort {
  service(): Promise<FriendsService>
  stop(): Promise<void>
}

const BOARD_COPY = 'friendsBoardCopy'
const SEEN_STATE = 'friendsSeenMarks'

type BoardCopy = {
  friends: FriendEntry[]
  shared: Extract<Board, { kind: 'ok' }>['shared']
  groups: GroupView[]
  incomingCards?: SharedCardItem[]
  d1Groups?: GroupBoardItem[]
}

export interface ServiceOptions {
  store: VaultStore
  tokens: TokenStore
  fetch?: FetchLike
  now?: () => number
  origin?: string
  engine?: Promise<SyncEngine>
  sleep?: (ms: number) => Promise<void>
  numbers?: OwnNumbers
  lock?: <T>(name: string, fn: () => Promise<T>) => Promise<T>
}

function generateCardId(): string {
  const bytes = new Uint8Array(4)
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < 4; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  const n = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0
  return `SH-${(n % 899_999) + 100_000}`
}

function mapApiError(err: unknown): Unavailable {
  if (err instanceof FriendsApiError) {
    if (err.status === 401) return { kind: 'unauthorized' }
    if (err.status === 429) return { kind: 'rate-limited' }
    return { kind: 'failed' }
  }
  return { kind: 'offline' }
}

/** Computes consecutive days (ending today or yesterday) where every active member finished due cards. */
function computeGroupStreak(g: GroupBoardItem, myStats: FriendStats | null, nowMs: number): number {
  const today = localDay(nowMs)
  const memberStats: (FriendStats | null)[] = g.members.map((m) => m.stats ?? (m.id === g.adminId && g.isAdmin ? myStats : null))
  if (memberStats.length === 0) return 0
  const allDone = (day: string) =>
    memberStats.every((s) => s !== null && s.days.some((d) => d.day === day && d.done === true))
  let streak = 0
  let offset = allDone(today) ? 0 : -1
  while (offset > -365) {
    const day = addDays(today, offset)
    if (!allDone(day)) break
    streak++
    offset--
  }
  return streak
}

function toGroupView(g: GroupBoardItem, myId: number, myStats: FriendStats | null, nowMs: number): GroupView {
  if (g.myStatus === 'pending') {
    return {
      kind: 'waiting',
      group: g.id,
      name: gistText(g.name, 30) || 'Group',
      sendToAdmin: '',
    }
  }
  const members: GroupMemberRow[] = g.members.map((m) => {
    const isMe = m.id === myId
    const stats = isMe ? myStats ?? m.stats : m.stats
    return {
      pointer: String(m.id),
      login: gistText(m.login),
      name: gistText(m.name || m.login) || 'Member',
      me: isMe,
      admin: m.id === g.adminId,
      mark: null,
      state: 'ok',
      label: null,
      read: stats
        ? {
            kind: 'ok',
            stats,
            pointer: { v: 1, stats: '' },
            updatedAt: m.statsAt ? Date.parse(m.statsAt) : null,
          }
        : null,
    }
  })
  return {
    kind: 'ok',
    group: g.id,
    name: gistText(g.name, 30) || 'Group',
    admin: String(g.adminId),
    iAmAdmin: g.isAdmin,
    streak: computeGroupStreak(g, myStats, nowMs),
    members,
    firstSeen: false,
  }
}

export function isFriendsDemo(): boolean {
  if (typeof globalThis.location?.search !== 'string') return false
  return new URLSearchParams(globalThis.location.search).get('friendsDemo') === '1'
}

function makeDemoStats(nowMs: number, login: string, name: string, todayCards: number, todayMins: number, doneToday: boolean, streak: number): FriendStats {
  const today = localDay(nowMs)
  const days = Array.from({ length: 7 }, (_, idx) => {
    const offset = -idx
    const isToday = offset === 0
    return {
      day: addDays(today, offset),
      cards: isToday ? todayCards : Math.max(10, todayCards - idx * 3),
      seconds: (isToday ? todayMins : Math.max(5, todayMins - idx * 2)) * 60,
      remembered: isToday ? Math.max(0, todayCards - 2) : 18,
      forgot: isToday ? Math.min(2, todayCards) : 1,
      newCards: isToday ? Math.min(8, todayCards) : 4,
      done: isToday ? doneToday : idx < streak,
    }
  })
  return {
    v: 1,
    login,
    name,
    avatar: '',
    days,
    totals: {
      cards: 1420,
      inReview: 980,
      newLeft: 440,
      mature: 610,
      dueLeft: doneToday ? 0 : 7,
      addedThisWeek: 24,
      streak,
      bestStreak: Math.max(streak, 21),
      bestDay: Math.max(todayCards, 72),
      bestWeek: 310,
    },
    at: new Date(nowMs).toISOString(),
  }
}

function createDemoFriendsApiClient(origin: string, now: () => number): FriendsApiClient {
  const t = now()
  const iso = new Date(t).toISOString()
  let seq = 1
  const state: FriendsBoardPayload = {
    me: {
      id: 1,
      login: 'yaseen',
      name: 'Yaseen',
      nickname: null,
      avatarUrl: null,
      zone: 'America/Denver',
      vaults: [],
      stats: makeDemoStats(t, 'yaseen', 'Yaseen', 42, 18, true, 14),
      statsAt: iso,
    },
    friends: [
      {
        id: 2,
        login: 'maya',
        name: 'Maya',
        avatarUrl: null,
        since: new Date(t - 30 * 86_400_000).toISOString(),
        stats: makeDemoStats(t, 'maya', 'Maya', 25, 12, true, 21),
        statsAt: new Date(t - 15 * 60_000).toISOString(),
        incomingMark: null,
        outgoingMark: null,
        sharedCardCount: 12,
      },
      {
        id: 3,
        login: 'sam',
        name: 'Sam',
        avatarUrl: null,
        since: new Date(t - 10 * 86_400_000).toISOString(),
        stats: makeDemoStats(t, 'sam', 'Sam', 58, 31, false, 9),
        statsAt: new Date(t - 40 * 60_000).toISOString(),
        incomingMark: { kind: 'cheer', message: 'cheered your 14-day streak! 🔥', at: new Date(t - 20 * 60_000).toISOString(), seenAt: null },
        outgoingMark: null,
        sharedCardCount: 4,
      },
    ],
    invites: [],
    groups: [
      {
        id: 'grp_demo_med',
        name: 'Med Study',
        adminId: 1,
        isAdmin: true,
        myStatus: 'active',
        inviteCode: 'medstudy26',
        members: [
          { id: 1, login: 'yaseen', name: 'Yaseen', avatarUrl: null, since: iso, stats: makeDemoStats(t, 'yaseen', 'Yaseen', 42, 18, true, 14), statsAt: iso },
          { id: 2, login: 'maya', name: 'Maya', avatarUrl: null, since: iso, stats: makeDemoStats(t, 'maya', 'Maya', 25, 12, true, 21), statsAt: iso },
          { id: 3, login: 'sam', name: 'Sam', avatarUrl: null, since: iso, stats: makeDemoStats(t, 'sam', 'Sam', 58, 31, false, 9), statsAt: iso },
        ],
        pending: [{ id: 4, login: 'nina', name: 'Nina', avatarUrl: null }],
        sharedFolders: [
          {
            id: 'fld_demo_biochem',
            name: 'Biochem',
            senderId: 2,
            senderLogin: 'maya',
            createdAt: iso,
            cards: [
              { id: 'sc_b1', folderId: 'fld_demo_biochem', senderId: 2, senderLogin: 'maya', title: 'ATP Synthase', markdown: 'Which complex synthesizes ATP?\n---\nComplex V (ATP synthase)', note: 'High-yield!', attachments: [], status: 'pending', createdAt: iso },
              { id: 'sc_b2', folderId: 'fld_demo_biochem', senderId: 2, senderLogin: 'maya', title: 'PFK-1 Regulation', markdown: 'Rate-limiting enzyme of glycolysis?\n---\nPhosphofructokinase-1 (PFK-1)', note: null, attachments: [], status: 'pending', createdAt: iso },
              { id: 'sc_b3', folderId: 'fld_demo_biochem', senderId: 2, senderLogin: 'maya', title: 'Michaelis-Menten Km', markdown: 'What does Km represent?\n---\nSubstrate concentration at 1/2 Vmax', note: null, attachments: [], status: 'pending', createdAt: iso },
            ],
          },
        ],
        sharedCards: [
          { id: 'sc_g1', folderId: null, senderId: 3, senderLogin: 'sam', title: 'Krebs Cycle Mnemonic', markdown: 'Citrate Is Krebs Starting Substrate For Making Oxaloacetate', note: 'Saved me on the quiz', attachments: [], status: 'pending', createdAt: iso },
          { id: 'sc_g2', folderId: null, senderId: 2, senderLogin: 'maya', title: 'Beta-Oxidation Location', markdown: 'Where does beta-oxidation occur?\n---\nMitochondrial matrix', note: null, attachments: [], status: 'dismissed', createdAt: iso },
        ],
      },
    ],
    incomingCards: [
      { id: 'sc_inc1', folderId: null, senderId: 2, senderLogin: 'maya', title: 'Henderson-Hasselbalch', markdown: 'pH = pKa + log([A-]/[HA])', note: 'Good formula card', attachments: [], status: 'pending', createdAt: iso },
    ],
  }

  const allCards = (): SharedCardItem[] => [
    ...state.incomingCards,
    ...state.groups.flatMap((g) => [...g.sharedCards, ...g.sharedFolders.flatMap((f) => f.cards)]),
  ]

  return {
    async ensureSession() {
      return 'demo-session'
    },
    clearSession() {},
    async board() {
      return structuredClone(state)
    },
    async sendStats(stats) {
      state.me.stats = stats
      state.me.statsAt = new Date(now()).toISOString()
      return { ok: true, statsAt: state.me.statsAt }
    },
    async updatePrefs(prefs) {
      if (prefs.vaults !== undefined) state.me.vaults = prefs.vaults
      if (prefs.zone !== undefined) state.me.zone = prefs.zone
      if (prefs.nickname !== undefined) state.me.nickname = prefs.nickname
      return { ok: true, vaults: state.me.vaults, zone: state.me.zone, nickname: state.me.nickname }
    },
    async createInvite() {
      const code = `demo${String(seq++).padStart(6, '0')}`
      const createdAt = new Date(now()).toISOString()
      const expiresAt = new Date(now() + 7 * 86_400_000).toISOString()
      state.invites.push({ code, expiresAt, createdAt })
      return { code, link: `${origin}/friend#${code}`, expiresAt }
    },
    async acceptInvite(_code) {
      return { kind: 'friend', friendId: 2 }
    },
    async removeFriend(userId) {
      state.friends = state.friends.filter((f) => f.id !== userId)
      return { ok: true }
    },
    async sendMark(toUserId, kind, message) {
      const at = new Date(now()).toISOString()
      const f = state.friends.find((x) => x.id === toUserId)
      if (f) f.outgoingMark = { kind, message: message ?? null, at }
      return { ok: true, kind, message: message ?? null, at }
    },
    async markSeen(fromUserIds) {
      const at = new Date(now()).toISOString()
      for (const f of state.friends) {
        if (f.incomingMark && (!fromUserIds || fromUserIds.includes(f.id))) f.incomingMark.seenAt = at
      }
      return { ok: true }
    },
    async createGroup(name) {
      const id = `grp_demo_${seq++}`
      const inviteCode = `grp${String(seq++).padStart(7, '0')}`
      state.groups.push({
        id,
        name,
        adminId: 1,
        isAdmin: true,
        myStatus: 'active',
        inviteCode,
        members: [{ id: 1, login: 'yaseen', name: 'Yaseen', avatarUrl: null, since: iso, stats: state.me.stats, statsAt: state.me.statsAt }],
        pending: [],
        sharedFolders: [],
        sharedCards: [],
      })
      return { id, name, inviteCode, link: `${origin}/group#${inviteCode}` }
    },
    async approveMember(groupId, userId) {
      const g = state.groups.find((x) => x.id === groupId)
      if (g) {
        const p = g.pending.find((x) => x.id === userId)
        if (p) {
          g.pending = g.pending.filter((x) => x.id !== userId)
          g.members.push({ ...p, since: new Date(now()).toISOString(), stats: null, statsAt: null })
        }
      }
      return { ok: true }
    },
    async removeMember(groupId, userId) {
      const g = state.groups.find((x) => x.id === groupId)
      if (g) {
        if (userId === undefined) state.groups = state.groups.filter((x) => x.id !== groupId)
        else {
          g.members = g.members.filter((m) => m.id !== userId)
          g.pending = g.pending.filter((m) => m.id !== userId)
        }
      }
      return { ok: true }
    },
    async rotateGroupInvite(groupId) {
      const inviteCode = `rot${String(seq++).padStart(7, '0')}`
      const g = state.groups.find((x) => x.id === groupId)
      if (g) g.inviteCode = inviteCode
      return { inviteCode, link: `${origin}/group#${inviteCode}` }
    },
    async shareCards(input) {
      return { ok: true, folderId: null, cardIds: input.cards.map((_, i) => `demo_sent_${seq++}_${i}`), count: input.cards.length }
    },
    async setCardState(cardId, status) {
      const c = allCards().find((x) => x.id === cardId)
      if (c) c.status = status
      return { ok: true, status }
    },
    async setFolderState(folderId, status) {
      let count = 0
      for (const g of state.groups) {
        const f = g.sharedFolders.find((x) => x.id === folderId)
        if (f) {
          for (const c of f.cards) {
            c.status = status
            count++
          }
        }
      }
      return { ok: true, status, count }
    },
    async deleteSharedCard(cardId) {
      state.incomingCards = state.incomingCards.filter((c) => c.id !== cardId)
      for (const g of state.groups) g.sharedCards = g.sharedCards.filter((c) => c.id !== cardId)
      return { ok: true }
    },
    async deleteMe() {
      state.friends = []
      state.groups = []
      state.invites = []
      state.incomingCards = []
      return { ok: true, deleted: true }
    },
  }
}

export function createFriendsService(options: ServiceOptions): FriendsService & {
  port: FriendsPort
  stop(): Promise<void>
  api: FriendsApiClient
} {
  const { store, tokens } = options
  const now = options.now ?? Date.now
  const local = localFriends(store)
  const demoMode = isFriendsDemo()
  const origin =
    options.origin ??
    (typeof globalThis.location?.origin === 'string' && /^https:\/\//.test(globalThis.location.origin)
      ? globalThis.location.origin
      : DEFAULT_FRIENDS_ORIGIN)

  async function getGithubToken(): Promise<string | null> {
    const phone = await loadVaultList(store)
    const ids = [
      ...(phone.open ? [phone.open] : []),
      ...phone.vaults.map(vaultId).filter((id) => id !== phone.open),
    ]
    for (const id of ids) {
      const tok = await tokens.read(id)
      if (tok) return tok
    }
    const accounts = await tokens.githubAccounts()
    for (const login of accounts) {
      const tok = await tokens.accessFor(login)
      if (tok) return tok
    }
    return null
  }

  const api = demoMode
    ? createDemoFriendsApiClient(origin, now)
    : createFriendsApiClient({
        origin,
        getGithubToken,
        fetch: options.fetch as ((url: string, init?: RequestInit) => Promise<Response>) | undefined,
        now,
      })

  const own: OwnNumbers = options.numbers ?? createOwnNumbers(store)
  let stopped = false
  let lastSentJson: string | null = null
  let lastSentAt: number | null = null
  let sendStatus: FriendsSendState['status'] = 'idle'
  let unfollow: (() => void) | null = null
  let unsubEngine: (() => void) | null = null
  let syncEngine: SyncEngine | null = null

  async function computeMyStats(settings: FriendsSettings): Promise<{ name: string; avatar: string | null; stats: FriendStats | null }> {
    const phone = await loadVaultList(store)
    const primaryVault = phone.open ?? (phone.vaults[0] ? vaultId(phone.vaults[0]) : null)
    const profile = primaryVault === null ? undefined : await loadAccount(store, primaryVault)
    const name = gistText(settings.nickname ?? profile?.name ?? profile?.login ?? '') || 'You'
    const ids = settings.vaults ?? phone.vaults.map(vaultId)
    const repos = phone.vaults.filter((v) => ids.includes(vaultId(v))).map((v) => v.repo.toLowerCase())
    const counted = await own.counted(repos, now(), settings.zone)
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

  async function pushMyStats(): Promise<void> {
    if (stopped) return
    const settings = await local.settings()
    const { stats } = await computeMyStats(settings)
    if (stats === null) return
    const payload = JSON.stringify({ days: stats.days, totals: stats.totals })
    if (payload === lastSentJson) return
    try {
      await api.sendStats(stats, settings.zone ?? deviceZone())
      lastSentJson = payload
      lastSentAt = now()
      sendStatus = 'sent'
    } catch {
      sendStatus = 'offline'
    }
  }

  const onHidden = () => {
    if (document.visibilityState === 'hidden') void pushMyStats()
  }

  void options.engine?.then((engine) => {
    if (stopped) return
    syncEngine = engine
    unfollow = own.follow(engine)
    unsubEngine = engine.subscribe((e) => {
      if (e.type === 'state' && e.state.status === 'synced') void pushMyStats()
    })
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onHidden)
  })

  async function loadSeen(): Promise<Record<string, SeenMark>> {
    return (await store.getState<Record<string, SeenMark>>(PHONE, SEEN_STATE)) ?? {}
  }

  async function saveCopy(copy: BoardCopy): Promise<void> {
    if ((await loadVaultList(store)).vaults.length === 0) return
    await (await store.session(PHONE)).setState(PHONE, BOARD_COPY, copy).catch(() => undefined)
  }

  async function loadCopy(): Promise<BoardCopy | null> {
    const copy = await store.getState<BoardCopy>(PHONE, BOARD_COPY)
    if (copy === undefined || copy === null || !Array.isArray(copy.friends)) return null
    const friends = copy.friends.map((f) => {
      const read = f.stats === null ? null : parseFriendStats(JSON.stringify(f.stats))
      return { ...f, stats: read !== null && read.ok ? read.value : null }
    })
    return {
      friends,
      shared: copy.shared ?? [],
      groups: Array.isArray(copy.groups) ? copy.groups : [],
      incomingCards: Array.isArray(copy.incomingCards) ? copy.incomingCards : [],
      d1Groups: Array.isArray(copy.d1Groups) ? copy.d1Groups : [],
    }
  }

  const groups = {
    async all() {
      try {
        const payload = await api.board()
        const settings = await local.settings()
        const myLocal = await computeMyStats(settings)
        return payload.groups.map((g) => toGroupView(g, payload.me.id, myLocal.stats ?? payload.me.stats, now()))
      } catch (err) {
        return mapApiError(err)
      }
    },
    async create(name: string) {
      const clean = name.replace(/\s+/g, ' ').trim()
      if (!clean) return { kind: 'bad-name' as const }
      try {
        const res = await api.createGroup(clean)
        return {
          kind: 'ok' as const,
          group: res.id,
          link: res.link,
          title: 'Yaseen Docs group link',
          text: `Join my group ${clean} on Yaseen Docs.`,
        }
      } catch (err) {
        return mapApiError(err)
      }
    },
    async add(_group: string, _text: string) {
      return { kind: 'done' }
    },
    async remove(group: string, pointer: string) {
      try {
        await api.removeMember(group, Number(pointer))
        return { kind: 'done' }
      } catch (err) {
        return mapApiError(err)
      }
    },
    async leave(group: string) {
      try {
        await api.removeMember(group)
        return { kind: 'done' as const }
      } catch (err) {
        return mapApiError(err)
      }
    },
    async delete(group: string) {
      try {
        await api.removeMember(group)
        return { kind: 'done' as const }
      } catch (err) {
        return mapApiError(err)
      }
    },
  } as unknown as GroupsPort

  async function deleteMe(): Promise<{ ok: true; deleted: true } | { ok: false; error: string }> {
    try {
      const res = await api.deleteMe()
      await store.setState(PHONE, HAS_FRIENDS_STATE, false).catch(() => undefined)
      await store.removeState(PHONE, BOARD_COPY).catch(() => undefined)
      await store.removeState(PHONE, SEEN_STATE).catch(() => undefined)
      lastSentJson = null
      lastSentAt = null
      return res
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'delete_failed' }
    }
  }

  const port: FriendsPort = {
    async hasFriends() {
      const fact = await store.getState<boolean>(PHONE, HAS_FRIENDS_STATE)
      return fact === true
    },
    settings: () => local.settings(),
    async saveSettings(next: FriendsSettings) {
      await local.saveSettings(next)
      await api
        .updatePrefs({
          vaults: next.vaults ?? [],
          zone: next.zone ?? null,
          nickname: next.nickname ?? null,
        })
        .catch(() => undefined)
    },
    deleteMe,
  }

  async function commitToOpenVault(
    changes: Change[],
    message: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (demoMode) return { ok: true }
    const phone = await loadVaultList(store)
    const openId = phone.open ?? (phone.vaults[0] ? vaultId(phone.vaults[0]) : null)
    const vault = phone.vaults.find((v) => vaultId(v) === openId)
    if (!vault || !openId) return { ok: false, error: 'No open vault on this phone.' }
    const tok = await tokens.read(openId)
    if (!tok) return { ok: false, error: 'Sign in again to add cards to your vault.' }
    const remote = githubRemote(githubClient(tok, { fetch: options.fetch, now }), vault.repo, vault.branch)
    const head = await remote.head()
    if (head === 'unchanged') return { ok: false, error: 'Could not read vault branch head.' }
    await remote.commit(head.sha, changes, message)
    // Also mirror locally so the file appears before the next sync pass.
    for (const c of changes) {
      if (!('delete' in c) && typeof c.content === 'string') {
        await store.write(openId, c.path, c.content).catch(() => undefined)
      }
    }
    if (syncEngine) void syncEngine.syncNow().catch(() => undefined)
    return { ok: true }
  }

  return {
    api,
    groups,
    whatFriendsSee: WHAT_FRIENDS_SEE,
    port,
    async board() {
      const settings = await local.settings()
      const [myLocal, seen] = await Promise.all([computeMyStats(settings), loadSeen()])
      try {
        const payload = await api.board()
        const meStats = myLocal.stats ?? payload.me.stats
        const me: Me = {
          name: gistText(payload.me.nickname ?? payload.me.name ?? payload.me.login) || myLocal.name,
          avatar: avatarUrl(payload.me.avatarUrl) ?? myLocal.avatar,
          stats: meStats,
        }
        const friends: FriendEntry[] = payload.friends.map((m) => ({
          theirs: String(m.id),
          mine: String(m.id),
          userId: m.id,
          login: m.login,
          since: m.since,
          sharedCardCount: m.sharedCardCount,
          name: gistText(m.name || m.login) || 'Friend',
          avatar: avatarUrl(m.avatarUrl),
          state: 'ok',
          label: null,
          sendBack: null,
          stats: m.stats,
          updatedAt: m.statsAt ? Date.parse(m.statsAt) : null,
          mark: m.incomingMark ? { kind: m.incomingMark.kind, at: m.incomingMark.at } : undefined,
          incomingMarkMessage: m.incomingMark?.message ?? null,
          outgoingMark: m.outgoingMark,
        }))
        const outbox: Record<string, OutMark> = {}
        for (const m of payload.friends) {
          if (m.outgoingMark) {
            outbox[String(m.id)] = {
              mark: { kind: m.outgoingMark.kind, at: m.outgoingMark.at },
              state: 'sent',
            }
          }
        }
        const shared = payload.invites.map((inv) => ({
          mine: inv.code,
          link: `${origin}/friend#${inv.code}`,
          at: inv.createdAt,
        }))
        const groupViews = payload.groups.map((g) => toGroupView(g, payload.me.id, meStats, now()))
        const hasAny = friends.length > 0 || payload.groups.length > 0
        await (await store.session(PHONE)).setState(PHONE, HAS_FRIENDS_STATE, hasAny).catch(() => undefined)
        await saveCopy({
          friends,
          shared,
          groups: groupViews,
          incomingCards: payload.incomingCards,
          d1Groups: payload.groups,
        })
        return {
          kind: 'ok',
          me,
          friends,
          shared,
          groups: groupViews,
          seen,
          outbox,
          offline: false,
          ...(lastSentAt !== null && { sending: { status: sendStatus, lastSentAt, retryAt: null } as FriendsSendState }),
          incomingCards: payload.incomingCards,
          d1Groups: payload.groups,
        }
      } catch (err) {
        const mapped = mapApiError(err)
        if (mapped.kind === 'offline' || mapped.kind === 'rate-limited') {
          const copy = await loadCopy()
          if (copy !== null) {
            return {
              kind: 'ok',
              me: myLocal,
              ...copy,
              seen,
              outbox: {},
              offline: true,
              ...(lastSentAt !== null && { sending: { status: sendStatus, lastSentAt, retryAt: null } as FriendsSendState }),
            }
          }
        }
        return mapped
      }
    },
    async share() {
      try {
        const inv = await api.createInvite()
        return {
          kind: 'ok',
          mine: inv.code,
          link: inv.link,
          title: 'Yaseen Docs friend link',
          text: 'Add me as a friend on Yaseen Docs.',
          whatFriendsSee: WHAT_FRIENDS_SEE,
        }
      } catch (err) {
        return mapApiError(err)
      }
    },
    async paste(text: string): Promise<PasteAnswer> {
      const parsed = parseInviteInput(text)
      if (parsed === null) return { kind: 'not-a-link' }
      try {
        const res = await api.acceptInvite(parsed.code)
        if (res.kind === 'friend') {
          return { kind: 'added', name: 'Your friend', paired: true, sendBack: null } as unknown as PasteAnswer
        }
        return { kind: 'joined', name: gistText(res.name, 30) || 'Group', group: res.groupId, sendToAdmin: '' } as unknown as PasteAnswer
      } catch (err) {
        if (err instanceof FriendsApiError) {
          if (err.code === 'invite_not_found' || err.code === 'invite_expired') return { kind: 'not-found' }
          if (err.code === 'cannot_add_self') return { kind: 'own-link' }
          if (err.code === 'already_friends') return { kind: 'already', name: 'This person' }
          if (err.code === 'already_member') return { kind: 'already', name: 'this group' }
        }
        return mapApiError(err)
      }
    },
    async remove(mine: string) {
      const id = Number(mine)
      if (!Number.isFinite(id)) return { kind: 'done' }
      try {
        await api.removeFriend(id)
        return { kind: 'done' }
      } catch (err) {
        return mapApiError(err)
      }
    },
    async mark(mine: string, kind: MarkKind, message?: string): Promise<MarkSend> {
      try {
        const res = await api.sendMark(Number(mine), kind, message)
        return { kind: 'sent', mark: { kind: res.kind, at: res.at } }
      } catch (err) {
        if (err instanceof FriendsApiError) {
          if (err.status === 401) return { kind: 'unauthorized' }
          if (err.status === 404) return { kind: 'gone' }
          if (err.status === 429) return { kind: 'already', mark: { kind, at: new Date(now()).toISOString() } }
        }
        return { kind: 'failed' }
      }
    },
    async see(marks) {
      if (marks.length === 0) return
      const current = await loadSeen()
      const next = { ...current }
      const ids: number[] = []
      const t = now()
      for (const m of marks) {
        if (next[m.theirs]?.at !== m.mark.at) {
          next[m.theirs] = { at: m.mark.at, seenAt: t }
          const n = Number(m.theirs)
          if (Number.isFinite(n)) ids.push(n)
        }
      }
      await (await store.session(PHONE)).setState(PHONE, SEEN_STATE, next).catch(() => undefined)
      if (ids.length > 0) await api.markSeen(ids).catch(() => undefined)
    },
    async shareCards(input) {
      try {
        const res = await api.shareCards(input)
        return { ok: true, count: res.count }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'share_failed' }
      }
    },
    async setCardState(cardId, status) {
      try {
        await api.setCardState(cardId, status)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'state_failed' }
      }
    },
    async setFolderState(folderId, status) {
      try {
        await api.setFolderState(folderId, status)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'state_failed' }
      }
    },
    async deleteSharedCard(cardId) {
      try {
        await api.deleteSharedCard(cardId)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'delete_failed' }
      }
    },
    async approveMember(groupId, userId) {
      try {
        await api.approveMember(groupId, userId)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'approve_failed' }
      }
    },
    async rotateGroupInvite(groupId) {
      try {
        const res = await api.rotateGroupInvite(groupId)
        return { ok: true, inviteCode: res.inviteCode, link: res.link }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'rotate_failed' }
      }
    },
    async vaultFolders() {
      if (demoMode) return ['Biochem', 'Spanish', 'Shared Cards']
      const phone = await loadVaultList(store)
      const openId = phone.open ?? (phone.vaults[0] ? vaultId(phone.vaults[0]) : null)
      if (!openId) return []
      const files = await store.list(openId)
      const dirs = new Set<string>()
      for (const f of files) {
        const parts = f.path.split('/')
        if (parts.length <= 1) continue
        if (parts[0].startsWith('.')) continue
        let acc = ''
        for (let i = 0; i < parts.length - 1; i++) {
          acc = acc ? `${acc}/${parts[i]}` : parts[i]
          dirs.add(acc)
        }
      }
      return [...dirs].sort((a, b) => a.localeCompare(b))
    },
    async acceptCardToVault({ card, folder, upNext }) {
      try {
        const cleanDir = folder.replace(/^\/+|\/+$/g, '')
        const built = buildAcceptedCardFile({
          title: card.title,
          markdown: card.markdown,
          senderLogin: card.senderLogin,
          newId: generateCardId(),
          nowMs: now(),
          upNext,
        })
        const path = cleanDir ? `${cleanDir}/${built.filename}` : built.filename
        const committed = await commitToOpenVault([{ path, content: built.content }], `friends: accept "${card.title}" from @${card.senderLogin}`)
        if (!committed.ok) return committed
        await api.setCardState(card.id, 'accepted')
        return { ok: true, path }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'accept_failed' }
      }
    },
    async importFolderToVault({ folder, targetDir, upNext }) {
      try {
        const cleanBase = targetDir.replace(/^\/+|\/+$/g, '')
        const safeSub = folder.name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'Shared folder'
        const dir = cleanBase ? `${cleanBase}/${safeSub}` : safeSub
        const pending = folder.cards.filter((c) => c.status !== 'accepted')
        const toImport = pending.length > 0 ? pending : folder.cards
        if (toImport.length === 0) return { ok: true, paths: [] }
        const changes: Change[] = []
        const paths: string[] = []
        for (const card of toImport) {
          const built = buildAcceptedCardFile({
            title: card.title,
            markdown: card.markdown,
            senderLogin: card.senderLogin,
            newId: generateCardId(),
            nowMs: now(),
            upNext,
          })
          const path = `${dir}/${built.filename}`
          changes.push({ path, content: built.content })
          paths.push(path)
        }
        const committed = await commitToOpenVault(changes, `friends: import folder "${folder.name}" (${changes.length} cards)`)
        if (!committed.ok) return committed
        await api.setFolderState(folder.id, 'accepted')
        return { ok: true, paths }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'import_failed' }
      }
    },
    deleteMe,
    async stop() {
      stopped = true
      unfollow?.()
      unsubEngine?.()
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onHidden)
      api.clearSession()
    },
  }
}
