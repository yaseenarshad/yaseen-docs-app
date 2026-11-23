import type { EntryKind } from '@shared/friendGists'
import { WHAT_FRIENDS_SEE, type FriendRow, type PasteResult } from '@shared/friendsList'
import { numbersFor } from '@shared/friendSend'
import { parseFriendStats, type FriendMark, type FriendStats } from '@shared/friendStats'
import {
  DEFAULT_FRIENDS_ORIGIN,
  FriendsApiError,
  createFriendsApiClient,
  type BrowsableVault,
  type DeckFilePayload,
  type DeckSettingsPayload,
  type DeckTreePayload,
  type FriendBoardMember,
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
  nickname?: string | null
  hasCustomAvatar?: boolean
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
  buddyStreak?: number
  canBrowseDeck?: boolean
  browsableVaults?: BrowsableVault[]
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

export type FriendFinishedMode = 'off' | 'all' | 'selected'

export interface NotificationPrefs {
  dailyReminder: boolean
  reminderHour: number
  friendFinishedMode: FriendFinishedMode
  friendFinishedIds: number[]
  buddyStreak: boolean
  sharedCards: boolean
}

export interface PushSubscriptionInput {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  dailyReminder: true,
  reminderHour: 20,
  friendFinishedMode: 'all',
  friendFinishedIds: [],
  buddyStreak: true,
  sharedCards: true,
}

type PushApiMethods = {
  getPushConfig?: () => Promise<{ vapidPublicKey: string | null }>
  subscribePush?: (sub: PushSubscriptionInput) => Promise<{ ok: true }>
  unsubscribePush?: (endpoint: string) => Promise<{ ok: true }>
  getNotificationPrefs?: () => Promise<{ prefs: NotificationPrefs; subscribedCount: number }>
  updateNotificationPrefs?: (patch: Partial<NotificationPrefs>) => Promise<{ ok: true; prefs: NotificationPrefs }>
  sendTestPush?: (endpoint?: string) => Promise<{ ok: true; sent: number; failed: number; failedStatuses?: number[] }>
}

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
  rotateGroupInvite?(groupId: string): Promise<{ ok: true; inviteCode: string; link: string } | { ok: false; error: string }>
  renameGroup?(groupId: string, name: string): Promise<{ ok: true; name: string } | { ok: false; error: string }>
  banGroupMember?(groupId: string, userId: number): Promise<{ ok: true } | { ok: false; error: string }>
  unbanGroupMember?(groupId: string, userId: number): Promise<{ ok: true } | { ok: false; error: string }>
  vaultFolders?(): Promise<string[]>
  acceptCardToVault?(input: {
    card: SharedCardItem
    folder: string
    upNext?: boolean
    assetFiles?: { path: string; bytes: Uint8Array }[]
    skipMarkAccepted?: boolean
  }): Promise<{ ok: true; path: string } | { ok: false; error: string }>
  importFolderToVault?(input: {
    folder: SharedFolderItem
    targetDir: string
    upNext?: boolean
  }): Promise<{ ok: true; paths: string[] } | { ok: false; error: string }>
  syncVaultExclusion?(): Promise<void>
  getDeckSettings?(): Promise<DeckSettingsPayload | null>
  saveDeckSettings?(input: DeckSettingsPayload): Promise<({ ok: true } & DeckSettingsPayload) | { ok: false; error: string }>
  findRepoInstallationId?(repo: string): Promise<number | null>
  browseDeckTree?(ownerId: number, repo: string): Promise<DeckTreePayload>
  browseDeckFile?(ownerId: number, repo: string, path: string): Promise<DeckFilePayload>
  browseDeckAsset?(ownerId: number, repo: string, path: string): Promise<{ bytes: Uint8Array; contentType: string }>
  updatePrefs?(prefs: {
    nickname?: string | null
    zone?: string | null
    vaults?: string[]
  }): Promise<{ ok: true; nickname: string | null } | { ok: false; error: string }>
  uploadAvatar?(payload: {
    contentType: string
    dataBase64: string
  }): Promise<{ ok: true; avatarUrl: string; hasCustomAvatar: true } | { ok: false; error: string }>
  deleteAvatar?(): Promise<{ ok: true; avatarUrl: string | null; hasCustomAvatar: false } | { ok: false; error: string }>
  deleteMe?(): Promise<{ ok: true; deleted: true } | { ok: false; error: string }>
  getPushConfig?(): Promise<{ vapidPublicKey: string | null }>
  subscribePush?(sub: PushSubscriptionInput): Promise<{ ok: true } | { ok: false; error: string }>
  unsubscribePush?(endpoint: string): Promise<{ ok: true } | { ok: false; error: string }>
  getNotificationPrefs?(): Promise<{ prefs: NotificationPrefs; subscribedCount: number } | null>
  updateNotificationPrefs?(patch: Partial<NotificationPrefs>): Promise<{ ok: true; prefs: NotificationPrefs } | { ok: false; error: string }>
  sendTestPush?(endpoint?: string): Promise<{ ok: true; sent: number; failed: number; failedStatuses?: number[] } | { ok: false; error: string }>
}

/** Strips any `@branch` suffix and lowercases to canonical `owner/repo`. */
export function canonicalVaultRepo(idOrRepo: string): string {
  return idOrRepo.split('@')[0].trim().toLowerCase()
}

export interface FriendsServices extends FriendsPort {
  service(): Promise<FriendsService>
  stop(): Promise<void>
}

const BOARD_COPY = 'friendsBoardCopy'
const SEEN_STATE = 'friendsSeenMarks'
const EXCLUDED_VAULTS_KEY = 'yaseendocs.friends.excludedVaults'

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

/** Computes consecutive days (ending today if both finished, else yesterday) where both users finished due cards. */
function computeBuddyStreakLocal(meStats: FriendStats | null, friendStats: FriendStats | null, nowMs: number): number {
  if (meStats === null || friendStats === null) return 0
  const today = localDay(nowMs)
  const bothDone = (day: string) =>
    meStats.days.some((d) => d.day === day && d.done === true) &&
    friendStats.days.some((d) => d.day === day && d.done === true)
  let streak = 0
  let offset = bothDone(today) ? 0 : -1
  while (offset > -365) {
    const day = addDays(today, offset)
    if (!bothDone(day)) break
    streak++
    offset--
  }
  return streak
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

function makeDemoStats(
  nowMs: number,
  login: string,
  name: string,
  todayCards: number,
  todayMins: number,
  doneToday: boolean,
  streak: number,
  doneHistoryDays: number = streak,
): FriendStats {
  const today = localDay(nowMs)
  const dayCount = Math.max(60, streak + 2, doneHistoryDays + 2)
  const seed = login.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  const days = Array.from({ length: dayCount }, (_, idx) => {
    const offset = -idx
    const isToday = offset === 0
    const done = isToday
      ? doneToday
      : idx <= doneHistoryDays
      ? true
      : idx === doneHistoryDays + 1
      ? false
      : (idx + seed) % 4 !== 0
    return {
      day: addDays(today, offset),
      cards: isToday ? todayCards : done ? Math.max(12, todayCards - (idx % 5) * 3) : 4,
      seconds: (isToday ? todayMins : done ? Math.max(6, todayMins - (idx % 5) * 2) : 2) * 60,
      remembered: isToday ? Math.max(0, todayCards - 2) : done ? 18 : 3,
      forgot: isToday ? Math.min(2, todayCards) : 1,
      newCards: isToday ? Math.min(8, todayCards) : done ? 4 : 0,
      done,
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

function demoPortraitSvg(bg: string, shirt: string, skin: string, hair: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="${bg}"/><circle cx="32" cy="25" r="11" fill="${skin}"/><path d="M21 24c0-7 5-12 11-12s11 5 11 12c-2-3-6-5-11-5s-9 2-11 5z" fill="${hair}"/><path d="M12 60c2-12 10-18 20-18s18 6 20 18z" fill="${shirt}"/></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

function firstNameOf(raw: string | null | undefined): string {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return ''
  return trimmed.split(/\s+/)[0] ?? ''
}

function createDemoFriendsApiClient(origin: string, now: () => number): FriendsApiClient {
  const t = now()
  const iso = new Date(t).toISOString()
  let seq = 1
  const demoGithubName = 'Yaseen Arshad'
  const avatars = {
    yaseen: demoPortraitSvg('#dbeafe', '#2563eb', '#e0ac69', '#1f2937'),
    maya: demoPortraitSvg('#fce7f3', '#db2777', '#c68642', '#292524'),
    samir: demoPortraitSvg('#dcfce7', '#16a34a', '#f1c27d', '#451a03'),
    elena: demoPortraitSvg('#fef3c7', '#d97706', '#ffdbac', '#78350f'),
    ali: demoPortraitSvg('#ede9fe', '#7c3aed', '#d19a66', '#18181b'),
    nina: demoPortraitSvg('#ffedd5', '#ea580c', '#8d5524', '#1c1917'),
  }
  const state: FriendsBoardPayload & { me: FriendsBoardPayload['me'] & { hasCustomAvatar?: boolean } } = {
    me: {
      id: 1,
      login: 'yaseen',
      name: firstNameOf(demoGithubName),
      nickname: null,
      avatarUrl: avatars.yaseen,
      hasCustomAvatar: false,
      zone: 'America/Denver',
      vaults: [],
      stats: makeDemoStats(t, 'yaseen', 'Yaseen', 42, 18, true, 14, 14),
      statsAt: iso,
    },
    friends: [
      {
        id: 2,
        login: 'maya',
        name: 'Maya',
        avatarUrl: avatars.maya,
        since: new Date(t - 30 * 86_400_000).toISOString(),
        stats: makeDemoStats(t, 'maya', 'Maya', 25, 12, true, 24, 24),
        statsAt: new Date(t - 15 * 60_000).toISOString(),
        sharedCardCount: 12,
        canBrowseDeck: true,
        browsableVaults: [{ repo: 'maya/med-notes', name: 'Med Notes' }],
      },
      {
        id: 3,
        login: 'samir',
        name: 'Samir',
        avatarUrl: avatars.samir,
        since: new Date(t - 10 * 86_400_000).toISOString(),
        stats: makeDemoStats(t, 'samir', 'Samir', 58, 31, false, 9, 5),
        statsAt: new Date(t - 40 * 60_000).toISOString(),
        sharedCardCount: 4,
      },
      {
        id: 4,
        login: 'elena',
        name: 'Elena',
        avatarUrl: avatars.elena,
        since: new Date(t - 20 * 86_400_000).toISOString(),
        stats: (() => {
          const s = makeDemoStats(t, 'elena', 'Elena', 18, 8, true, 16, 16)
          // Make prior month lower so Elena showcases the "Beat Oct" badge live in Demo
          const curMonthPrefix = localDay(t).slice(0, 8)
          let keptPrior = 0
          for (const d of s.days) {
            if (d.day < `${curMonthPrefix}01`) {
              if (keptPrior < 11) {
                d.done = true
                keptPrior++
              } else {
                d.done = false
              }
            }
          }
          return s
        })(),
        statsAt: new Date(t - 55 * 60_000).toISOString(),
        sharedCardCount: 2,
      },
      {
        id: 5,
        login: 'ali',
        name: 'Ali',
        avatarUrl: avatars.ali,
        since: new Date(t - 14 * 86_400_000).toISOString(),
        stats: makeDemoStats(t, 'ali', 'Ali', 12, 6, false, 4, 2),
        statsAt: new Date(t - 70 * 60_000).toISOString(),
        sharedCardCount: 1,
      },
      {
        id: 6,
        login: 'nina',
        name: 'Nina',
        avatarUrl: avatars.nina,
        since: new Date(t - 7 * 86_400_000).toISOString(),
        stats: makeDemoStats(t, 'nina', 'Nina', 0, 0, false, 2, 0),
        statsAt: new Date(t - 3 * 3600_000).toISOString(),
        sharedCardCount: 0,
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
        createdAt: new Date(t - 20 * 86_400_000).toISOString(),
        members: [
          { id: 1, login: 'yaseen', name: 'Yaseen', avatarUrl: avatars.yaseen, since: new Date(t - 20 * 86_400_000).toISOString(), stats: makeDemoStats(t, 'yaseen', 'Yaseen', 42, 18, true, 14), statsAt: iso },
          { id: 2, login: 'maya', name: 'Maya', avatarUrl: avatars.maya, since: new Date(t - 20 * 86_400_000).toISOString(), stats: makeDemoStats(t, 'maya', 'Maya', 25, 12, true, 21), statsAt: iso },
          { id: 3, login: 'samir', name: 'Samir', avatarUrl: avatars.samir, since: new Date(t - 10 * 86_400_000).toISOString(), stats: makeDemoStats(t, 'samir', 'Samir', 58, 31, false, 9, 6), statsAt: iso },
        ],
        pending: [],
        banned: [],
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
          { id: 'sc_g1', folderId: null, senderId: 3, senderLogin: 'samir', title: 'Krebs Cycle Mnemonic', markdown: 'Citrate Is Krebs Starting Substrate For Making Oxaloacetate', note: 'Saved me on the quiz', attachments: [], status: 'pending', createdAt: iso },
          { id: 'sc_g2', folderId: null, senderId: 2, senderLogin: 'maya', title: 'Beta-Oxidation Location', markdown: 'Where does beta-oxidation occur?\n---\nMitochondrial matrix', note: null, attachments: [], status: 'dismissed', createdAt: iso },
        ],
      },
      {
        id: 'grp_demo_spanish',
        name: 'Spanish Squad',
        adminId: 1,
        isAdmin: true,
        myStatus: 'active',
        inviteCode: 'spanish26',
        members: [
          { id: 1, login: 'yaseen', name: 'Yaseen', avatarUrl: avatars.yaseen, since: iso, stats: makeDemoStats(t, 'yaseen', 'Yaseen', 42, 18, true, 14), statsAt: iso },
          { id: 4, login: 'elena', name: 'Elena', avatarUrl: avatars.elena, since: iso, stats: makeDemoStats(t, 'elena', 'Elena', 18, 8, true, 7), statsAt: iso },
          { id: 5, login: 'ali', name: 'Ali', avatarUrl: avatars.ali, since: iso, stats: makeDemoStats(t, 'ali', 'Ali', 12, 6, false, 4, 3), statsAt: iso },
        ],
        pending: [],
        banned: [],
        sharedFolders: [],
        sharedCards: [],
      },
      {
        id: 'grp_demo_mcat',
        name: 'MCAT Grind',
        adminId: 1,
        isAdmin: true,
        myStatus: 'active',
        inviteCode: 'mcatgrind26',
        members: [
          { id: 1, login: 'yaseen', name: 'Yaseen', avatarUrl: avatars.yaseen, since: iso, stats: makeDemoStats(t, 'yaseen', 'Yaseen', 42, 18, true, 14), statsAt: iso },
          { id: 2, login: 'maya', name: 'Maya', avatarUrl: avatars.maya, since: iso, stats: makeDemoStats(t, 'maya', 'Maya', 25, 12, true, 21), statsAt: iso },
          { id: 3, login: 'samir', name: 'Samir', avatarUrl: avatars.samir, since: iso, stats: makeDemoStats(t, 'samir', 'Samir', 58, 31, false, 9, 11), statsAt: iso },
          { id: 4, login: 'elena', name: 'Elena', avatarUrl: avatars.elena, since: iso, stats: makeDemoStats(t, 'elena', 'Elena', 18, 8, true, 7, 11), statsAt: iso },
          { id: 6, login: 'nina', name: 'Nina', avatarUrl: avatars.nina, since: iso, stats: makeDemoStats(t, 'nina', 'Nina', 0, 0, false, 2, 11), statsAt: iso },
        ],
        pending: [],
        banned: [],
        sharedFolders: [],
        sharedCards: [],
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

  type DemoGroupExtras = {
    renameGroup(groupId: string, name: string): Promise<{ ok: true; name: string }>
    banGroupMember(groupId: string, userId: number): Promise<{ ok: true }>
    unbanGroupMember(groupId: string, userId: number): Promise<{ ok: true }>
    uploadAvatar(payload: { contentType: string; dataBase64: string }): Promise<{ ok: true; avatarUrl: string; hasCustomAvatar: true }>
    deleteAvatar(): Promise<{ ok: true; avatarUrl: string | null; hasCustomAvatar: false }>
    getPushConfig(): Promise<{ vapidPublicKey: string | null }>
    subscribePush(sub: PushSubscriptionInput): Promise<{ ok: true }>
    unsubscribePush(endpoint: string): Promise<{ ok: true }>
    getNotificationPrefs(): Promise<{ prefs: NotificationPrefs; subscribedCount: number }>
    updateNotificationPrefs(patch: Partial<NotificationPrefs>): Promise<{ ok: true; prefs: NotificationPrefs }>
    sendTestPush(): Promise<{ ok: true; sent: number; failed: number }>
  }

  let demoNotificationPrefs: NotificationPrefs = structuredClone(DEFAULT_NOTIFICATION_PREFS)
  const demoPushEndpoints = new Set<string>()

  let demoDeckSettings: DeckSettingsPayload = {
    mode: 'none',
    vaults: [],
    allowedFriendIds: [],
  }

  const demoDeckFiles: Record<string, DeckFilePayload> = {
    'Biochem/ATP Synthase.md': {
      path: 'Biochem/ATP Synthase.md',
      title: 'ATP Synthase',
      markdown:
        '# ATP Synthase (Complex V)\n\n> [!tip] High-yield\n> F₀F₁ ATP synthase uses the proton-motive force across the inner mitochondrial membrane to drive γ-subunit rotation and synthesize ATP from ADP + Pᵢ on the β subunits.\n\n```card\nWhich complex in the inner mitochondrial membrane synthesizes ATP from ADP + Pᵢ?\n---\n**Complex V (F₀F₁ ATP synthase)** — powered by the proton gradient from Complexes I, III, and IV.\n```\n\n## Related notes\n\n- [[PFK-1 Regulation]]\n- [[Henderson-Hasselbalch]]',
      assetPaths: [],
    },
    'Biochem/PFK-1 Regulation.md': {
      path: 'Biochem/PFK-1 Regulation.md',
      title: 'PFK-1 Regulation',
      markdown:
        '# PFK-1 Regulation\n\nWhat is the committed, rate-limiting enzyme of glycolysis?\n\n---\n\n**Phosphofructokinase-1 (PFK-1)**\n\n- **Activated by:** AMP, Fructose-2,6-bisphosphate\n- **Inhibited by:** ATP, Citrate\n\nSee also: [[ATP Synthase]]',
      assetPaths: [],
    },
    'Biochem/Henderson-Hasselbalch.md': {
      path: 'Biochem/Henderson-Hasselbalch.md',
      title: 'Henderson-Hasselbalch',
      markdown:
        '# Henderson-Hasselbalch Equation\n\nWrite the Henderson-Hasselbalch equation for buffer pH.\n\n---\n\n`pH = pKa + log([A-] / [HA])`\n\nWhen `[A-] = [HA]`, `pH = pKa`.',
      assetPaths: [],
    },
    'Spanish/Subjunctive Triggers.md': {
      path: 'Spanish/Subjunctive Triggers.md',
      title: 'Subjunctive Triggers',
      markdown:
        '# WEIRDO Subjunctive Triggers\n\nWhat does **WEIRDO** stand for in Spanish subjunctive?\n\n---\n\n- **W**ishes (`esperar que`)\n- **E**motions (`alegrarse de que`)\n- **I**mpersonal expressions (`es importante que`)\n- **R**ecommendations (`recomendar que`)\n- **D**oubt / Denial (`dudar que`)\n- **O**jalá',
      assetPaths: [],
    },
    'README.md': {
      path: 'README.md',
      title: 'Med Notes',
      markdown:
        '# Maya\'s Med Notes\n\nHigh-yield flashcards and summary pages for **Biochem** and **Spanish**.\n\n- [[ATP Synthase]]\n- [[PFK-1 Regulation]]\n- [[Subjunctive Triggers]]',
      assetPaths: [],
    },
  }

  return {
    async getDeckSettings() {
      return structuredClone(demoDeckSettings)
    },
    async saveDeckSettings(input) {
      demoDeckSettings = structuredClone(input)
      return { ok: true as const, ...structuredClone(demoDeckSettings) }
    },
    async getDeckTree(_ownerId, repo) {
      return {
        repo,
        name: 'Med Notes',
        files: Object.values(demoDeckFiles).map((f) => ({ path: f.path, title: f.title, kind: 'md' as const })),
      }
    },
    async getDeckFile(_ownerId, _repo, path) {
      const hit = demoDeckFiles[path]
      if (!hit) throw new FriendsApiError(404, 'file_not_found')
      return structuredClone(hit)
    },
    async getDeckAssetBytes() {
      return { bytes: new Uint8Array(), contentType: 'application/octet-stream' }
    },
    async renameGroup(groupId: string, name: string) {
      const g = state.groups.find((x) => x.id === groupId)
      const clean = name.replace(/\s+/g, ' ').trim().slice(0, 60)
      if (g && clean) g.name = clean
      return { ok: true as const, name: g?.name ?? clean }
    },
    async banGroupMember(groupId: string, userId: number) {
      const g = state.groups.find((x) => x.id === groupId) as (GroupBoardItem & { banned?: { id: number; login: string; name: string }[] }) | undefined
      if (g) {
        const m = g.members.find((x) => x.id === userId)
        g.members = g.members.filter((x) => x.id !== userId)
        if (!g.banned) g.banned = []
        if (m && !g.banned.some((b) => b.id === m.id)) g.banned.push({ id: m.id, login: m.login, name: m.name })
      }
      return { ok: true as const }
    },
    async unbanGroupMember(groupId: string, userId: number) {
      const g = state.groups.find((x) => x.id === groupId) as (GroupBoardItem & { banned?: { id: number; login: string; name: string }[] }) | undefined
      if (g && g.banned) {
        g.banned = g.banned.filter((b) => b.id !== userId)
      }
      return { ok: true as const }
    },
    async ensureSession() {
      return 'demo-session'
    },
    clearSession() {},
    async board() {
      return structuredClone(state)
    },
    async sendStats(stats) {
      // Never let an unreviewed local demo vault overwrite the populated demo stats.
      if (stats.days.some((d) => d.cards > 0)) {
        state.me.stats = stats
        state.me.statsAt = new Date(now()).toISOString()
      }
      return { ok: true, statsAt: state.me.statsAt ?? new Date(now()).toISOString() }
    },
    async updatePrefs(prefs) {
      if (prefs.vaults !== undefined) state.me.vaults = prefs.vaults
      if (prefs.zone !== undefined) state.me.zone = prefs.zone
      if (prefs.nickname !== undefined) {
        const clean = prefs.nickname ? prefs.nickname.replace(/\s+/g, ' ').trim().slice(0, 40) || null : null
        state.me.nickname = clean
        state.me.name = clean ?? firstNameOf(demoGithubName)
        for (const g of state.groups) {
          for (const m of g.members) {
            if (m.id === state.me.id) m.name = state.me.name
          }
        }
      }
      return { ok: true, vaults: state.me.vaults, zone: state.me.zone, nickname: state.me.nickname }
    },
    async uploadAvatar(payload: { contentType: string; dataBase64: string }) {
      const dataUrl = `data:${payload.contentType};base64,${payload.dataBase64}`
      state.me.avatarUrl = dataUrl
      state.me.hasCustomAvatar = true
      for (const g of state.groups) {
        for (const m of g.members) {
          if (m.id === state.me.id) m.avatarUrl = dataUrl
        }
      }
      return { ok: true as const, avatarUrl: dataUrl, hasCustomAvatar: true as const }
    },
    async deleteAvatar() {
      state.me.avatarUrl = avatars.yaseen
      state.me.hasCustomAvatar = false
      for (const g of state.groups) {
        for (const m of g.members) {
          if (m.id === state.me.id) m.avatarUrl = avatars.yaseen
        }
      }
      return { ok: true as const, avatarUrl: avatars.yaseen, hasCustomAvatar: false as const }
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
      demoPushEndpoints.clear()
      demoNotificationPrefs = structuredClone(DEFAULT_NOTIFICATION_PREFS)
      return { ok: true, deleted: true }
    },
    async getPushConfig() {
      return { vapidPublicKey: 'BDemoVapidPublicKeyForLocalFriendsDemoMode00000000000000000000000000000000000000000000000' }
    },
    async subscribePush(sub: PushSubscriptionInput) {
      if (sub.endpoint) demoPushEndpoints.add(sub.endpoint)
      return { ok: true as const }
    },
    async unsubscribePush(endpoint: string) {
      if (endpoint) demoPushEndpoints.delete(endpoint)
      else demoPushEndpoints.clear()
      return { ok: true as const }
    },
    async getNotificationPrefs() {
      return { prefs: structuredClone(demoNotificationPrefs), subscribedCount: demoPushEndpoints.size }
    },
    async updateNotificationPrefs(patch: Partial<NotificationPrefs>) {
      if (typeof patch.dailyReminder === 'boolean') demoNotificationPrefs.dailyReminder = patch.dailyReminder
      if (typeof patch.reminderHour === 'number' && Number.isInteger(patch.reminderHour) && patch.reminderHour >= 0 && patch.reminderHour <= 23) {
        demoNotificationPrefs.reminderHour = patch.reminderHour
      }
      if (patch.friendFinishedMode === 'off' || patch.friendFinishedMode === 'all' || patch.friendFinishedMode === 'selected') {
        demoNotificationPrefs.friendFinishedMode = patch.friendFinishedMode
      }
      if (Array.isArray(patch.friendFinishedIds)) {
        demoNotificationPrefs.friendFinishedIds = [...new Set(patch.friendFinishedIds.filter((id) => typeof id === 'number' && Number.isInteger(id)))]
      }
      if (typeof patch.buddyStreak === 'boolean') demoNotificationPrefs.buddyStreak = patch.buddyStreak
      if (typeof patch.sharedCards === 'boolean') demoNotificationPrefs.sharedCards = patch.sharedCards
      return { ok: true as const, prefs: structuredClone(demoNotificationPrefs) }
    },
    async sendTestPush() {
      return { ok: true as const, sent: demoPushEndpoints.size, failed: 0 }
    },
  } as FriendsApiClient & DemoGroupExtras
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
  const baseOrigin = origin.replace(/\/+$/, '')
  const allowedAvatarOrigins = new Set([baseOrigin, DEFAULT_FRIENDS_ORIGIN.replace(/\/+$/, '')])
  let forceNextBoard = false
  let stopped = false

  function safeAvatar(u: string | null | undefined): string | null {
    if (typeof u !== 'string' || u === '') return null
    if (demoMode && /^data:image\/(svg\+xml|webp|jpeg|png);/.test(u)) return u
    const gh = avatarUrl(u)
    if (gh !== null) return gh
    try {
      const parsed = new URL(u, origin)
      if (
        (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
        allowedAvatarOrigins.has(parsed.origin) &&
        parsed.pathname.startsWith('/api/friends/avatar/')
      ) {
        return parsed.href
      }
    } catch {
      return null
    }
    return null
  }
  let lastSentJson: string | null = null
  let lastSentAt: number | null = null
  let sendStatus: FriendsSendState['status'] = 'idle'
  let unfollow: (() => void) | null = null
  let unsubEngine: (() => void) | null = null
  let syncEngine: SyncEngine | null = null

  async function loadExcludedVaults(): Promise<Set<string>> {
    const saved = await store.getState<string[]>(PHONE, EXCLUDED_VAULTS_KEY).catch(() => undefined)
    if (!Array.isArray(saved)) return new Set()
    return new Set(saved.filter((s): s is string => typeof s === 'string').map((s) => s.toLowerCase()))
  }

  async function computeMyStats(settings: FriendsSettings): Promise<{ name: string; avatar: string | null; stats: FriendStats | null }> {
    const phone = await loadVaultList(store)
    const excluded = await loadExcludedVaults()
    const primaryVault = phone.open ?? (phone.vaults[0] ? vaultId(phone.vaults[0]) : null)
    const profile = primaryVault === null ? undefined : await loadAccount(store, primaryVault)
    const name = gistText(settings.nickname ?? (firstNameOf(profile?.name) || profile?.login || '')) || 'You'
    const ids = settings.vaults ?? phone.vaults.map(vaultId)
    const repos = phone.vaults
      .filter((v) => ids.includes(vaultId(v)) && !excluded.has(v.repo.toLowerCase()))
      .map((v) => v.repo.toLowerCase())
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

  async function computeCanonicalVaults(settings: FriendsSettings): Promise<string[]> {
    const phone = await loadVaultList(store)
    const excluded = await loadExcludedVaults()
    if (phone.vaults.length === 0) {
      return [...new Set((settings.vaults ?? []).map(canonicalVaultRepo).filter(Boolean))]
    }
    const ids = settings.vaults ?? phone.vaults.map(vaultId)
    return [
      ...new Set(
        phone.vaults
          .filter((v) => ids.includes(vaultId(v)) && !excluded.has(v.repo.toLowerCase()))
          .map((v) => canonicalVaultRepo(v.repo))
          .filter(Boolean),
      ),
    ]
  }

  async function pushMyStats(opts?: { force?: boolean }): Promise<void> {
    if (stopped) return
    const force = opts?.force === true
    const phone = await loadVaultList(store)
    const excluded = await loadExcludedVaults()
    const activeVault = phone.vaults.find((v) => vaultId(v) === phone.open) ?? phone.vaults[0]
    if (!force && activeVault && excluded.has(activeVault.repo.toLowerCase())) return
    const settings = await local.settings()
    const { stats } = await computeMyStats(settings)
    if (stats === null) return
    const payload = JSON.stringify({ days: stats.days, totals: stats.totals })
    if (!force && payload === lastSentJson) return
    try {
      await api.sendStats(stats, settings.zone ?? deviceZone(), force ? { force: true } : undefined)
      lastSentJson = payload
      lastSentAt = now()
      sendStatus = 'sent'
    } catch {
      sendStatus = 'offline'
    }
  }

  async function syncVaultExclusion(): Promise<void> {
    const settings = await local.settings()
    const vaults = await computeCanonicalVaults(settings)
    await api
      .updatePrefs({
        vaults,
        zone: settings.zone ?? null,
        nickname: settings.nickname ?? null,
      })
      .catch(() => undefined)
    await pushMyStats({ force: true })
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
        return payload.groups.map((g) => toGroupView(g, payload.me.id, payload.me.stats ?? myLocal.stats, now()))
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
      const vaults = await computeCanonicalVaults(next)
      await api
        .updatePrefs({
          vaults,
          zone: next.zone ?? null,
          nickname: next.nickname ?? null,
        })
        .catch(() => undefined)
      await pushMyStats({ force: true })
    },
    syncVaultExclusion,
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
      if (!('delete' in c)) {
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
        const force = forceNextBoard
        forceNextBoard = false
        const payload = await api.board(force)
        // Hydrate canonical vault preferences from D1 so Phone A, Phone B, and Desktop agree on which vaults count.
        if (!demoMode && Array.isArray(payload.me.vaults) && payload.me.vaults.length > 0) {
          const remoteSet = new Set(payload.me.vaults.map((v) => canonicalVaultRepo(v)).filter(Boolean))
          const phone = await loadVaultList(store)
          if (remoteSet.size > 0 && phone.vaults.length > 0) {
            const nextExcluded = phone.vaults
              .filter((v) => !remoteSet.has(canonicalVaultRepo(v.repo)))
              .map((v) => v.repo)
            const curExcluded = await loadExcludedVaults()
            const nextExcludedSet = new Set(nextExcluded.map((r) => r.toLowerCase()))
            const excludedChanged =
              curExcluded.size !== nextExcludedSet.size || [...nextExcludedSet].some((r) => !curExcluded.has(r))
            if (excludedChanged) {
              await store.setState(PHONE, EXCLUDED_VAULTS_KEY, nextExcluded).catch(() => undefined)
            }
            const matchedIds = phone.vaults.filter((v) => remoteSet.has(canonicalVaultRepo(v.repo))).map(vaultId)
            const nextVaults = matchedIds.length === phone.vaults.length ? null : matchedIds
            const curVaults = settings.vaults
            const vaultsChanged =
              (curVaults === null) !== (nextVaults === null) ||
              (curVaults !== null &&
                nextVaults !== null &&
                (curVaults.length !== nextVaults.length || curVaults.some((id, idx) => id !== nextVaults[idx])))
            if (vaultsChanged) {
              await local.saveSettings({ ...settings, vaults: nextVaults }).catch(() => undefined)
            }
          }
        }
        // Prefer D1's canonical `me.stats` when online so all devices show the exact same "Today complete" & numbers.
        const meStats = payload.me.stats ?? myLocal.stats
        const meRaw = payload.me as FriendsBoardPayload['me'] & { hasCustomAvatar?: boolean }
        const me: Me = {
          name: gistText(meRaw.nickname ?? meRaw.name ?? meRaw.login) || myLocal.name,
          avatar: safeAvatar(meRaw.avatarUrl) ?? myLocal.avatar,
          stats: meStats,
          nickname: meRaw.nickname ?? null,
          hasCustomAvatar: meRaw.hasCustomAvatar === true,
        }
        const nowMs = now()
        const friends: FriendEntry[] = payload.friends.map((m) => {
          const apiBuddy = (m as { buddyStreak?: number }).buddyStreak
          return {
            theirs: String(m.id),
            mine: String(m.id),
            userId: m.id,
            login: m.login,
            since: m.since,
            sharedCardCount: m.sharedCardCount,
            buddyStreak: typeof apiBuddy === 'number' ? apiBuddy : computeBuddyStreakLocal(meStats, m.stats, nowMs),
            canBrowseDeck: m.canBrowseDeck === true,
            browsableVaults: Array.isArray(m.browsableVaults) ? m.browsableVaults : [],
            name: gistText(m.name || m.login) || 'Friend',
            avatar: safeAvatar(m.avatarUrl),
            state: 'ok',
            label: null,
            sendBack: null,
            stats: m.stats,
            updatedAt: m.statsAt ? Date.parse(m.statsAt) : null,
            mark: undefined,
          }
        })
        const outbox: Record<string, OutMark> = {}
        const shared = payload.invites.map((inv) => ({
          mine: inv.code,
          link: `${origin}/friend#${inv.code}`,
          at: inv.createdAt,
        }))
        const d1GroupsNormalized = payload.groups.map((g) => ({
          ...g,
          members: g.members.map((m) => ({ ...m, avatarUrl: safeAvatar(m.avatarUrl) })),
        }))
        const groupViews = d1GroupsNormalized.map((g) => toGroupView(g, payload.me.id, meStats, now()))
        const hasAny = friends.length > 0 || d1GroupsNormalized.length > 0
        await (await store.session(PHONE)).setState(PHONE, HAS_FRIENDS_STATE, hasAny).catch(() => undefined)
        await saveCopy({
          friends,
          shared,
          groups: groupViews,
          incomingCards: payload.incomingCards,
          d1Groups: d1GroupsNormalized,
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
          d1Groups: d1GroupsNormalized,
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
    async mark(_mine: string, kind: MarkKind): Promise<MarkSend> {
      return { kind: 'sent', mark: { kind, at: new Date(now()).toISOString() } }
    },
    async see(_marks) {
      // Marks removed in YAZ-6222 (replaced by Buddy Streak).
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
    async rotateGroupInvite(groupId) {
      try {
        const res = await api.rotateGroupInvite(groupId)
        return { ok: true, inviteCode: res.inviteCode, link: res.link }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'rotate_failed' }
      }
    },
    async renameGroup(groupId, name) {
      try {
        const ext = api as FriendsApiClient & { renameGroup?: (id: string, n: string) => Promise<{ ok: true; name: string }> }
        if (!ext.renameGroup) return { ok: false, error: 'rename_unsupported' }
        const res = await ext.renameGroup(groupId, name)
        return { ok: true, name: res.name }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'rename_failed' }
      }
    },
    async banGroupMember(groupId, userId) {
      try {
        const ext = api as FriendsApiClient & { banGroupMember?: (id: string, uid: number) => Promise<{ ok: true }> }
        if (ext.banGroupMember) await ext.banGroupMember(groupId, userId)
        else await api.removeMember(groupId, userId)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'ban_failed' }
      }
    },
    async unbanGroupMember(groupId, userId) {
      try {
        const ext = api as FriendsApiClient & { unbanGroupMember?: (id: string, uid: number) => Promise<{ ok: true }> }
        if (ext.unbanGroupMember) await ext.unbanGroupMember(groupId, userId)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'unban_failed' }
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
    async acceptCardToVault({ card, folder, upNext, assetFiles, skipMarkAccepted }) {
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
        const changes: Change[] = [{ path, content: built.content }]
        if (Array.isArray(assetFiles)) {
          for (const asset of assetFiles) {
            const cleanAsset = asset.path.replace(/^\/+/, '')
            if (cleanAsset && !cleanAsset.includes('..') && !cleanAsset.startsWith('.')) {
              changes.push({ path: cleanAsset, content: asset.bytes })
            }
          }
        }
        const committed = await commitToOpenVault(changes, `friends: accept "${card.title}" from @${card.senderLogin}`)
        if (!committed.ok) return committed
        if (!skipMarkAccepted) await api.setCardState(card.id, 'accepted')
        return { ok: true, path }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'accept_failed' }
      }
    },
    syncVaultExclusion,
    async getDeckSettings() {
      try {
        return await api.getDeckSettings()
      } catch {
        return null
      }
    },
    async saveDeckSettings(input) {
      try {
        return await api.saveDeckSettings(input)
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'deck_settings_failed' }
      }
    },
    async findRepoInstallationId(repo: string) {
      if (demoMode) return 999001
      const target = canonicalVaultRepo(repo)
      const tok = await getGithubToken()
      if (!tok) return null
      try {
        const client = githubClient(tok, { fetch: options.fetch, now })
        const instRes = await client.request('/user/installations', { query: { per_page: '100' } })
        const installations = (instRes.data as { installations?: { id?: unknown }[] } | null)?.installations
        if (!Array.isArray(installations)) return null
        for (const inst of installations) {
          if (typeof inst?.id !== 'number') continue
          for (let page = 1; page <= 10; page++) {
            const repoRes = await client.request(`/user/installations/${inst.id}/repositories`, {
              query: { per_page: '100', page: String(page) },
            })
            const repos = (repoRes.data as { repositories?: { full_name?: unknown }[] } | null)?.repositories
            if (!Array.isArray(repos) || repos.length === 0) break
            if (repos.some((r) => typeof r?.full_name === 'string' && r.full_name.toLowerCase() === target)) {
              return inst.id
            }
            if (repos.length < 100) break
          }
        }
      } catch {
        return null
      }
      return null
    },
    async browseDeckTree(ownerId: number, repo: string) {
      return api.getDeckTree(ownerId, repo)
    },
    async browseDeckFile(ownerId: number, repo: string, path: string) {
      return api.getDeckFile(ownerId, repo, path)
    },
    async browseDeckAsset(ownerId: number, repo: string, path: string) {
      return api.getDeckAssetBytes(ownerId, repo, path)
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
    async updatePrefs(prefs) {
      try {
        const res = await api.updatePrefs(prefs)
        forceNextBoard = true
        return { ok: true, nickname: res.nickname }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'prefs_failed' }
      }
    },
    async uploadAvatar(payload) {
      try {
        const res = await api.uploadAvatar(payload)
        forceNextBoard = true
        const url = safeAvatar(res.avatarUrl)
        if (url === null) return { ok: false, error: 'invalid_avatar_url' }
        return { ok: true, avatarUrl: url, hasCustomAvatar: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'upload_failed' }
      }
    },
    async deleteAvatar() {
      try {
        const res = await api.deleteAvatar()
        forceNextBoard = true
        return { ok: true, avatarUrl: safeAvatar(res.avatarUrl), hasCustomAvatar: false }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'delete_failed' }
      }
    },
    deleteMe,
    async getPushConfig() {
      try {
        const ext = api as FriendsApiClient & PushApiMethods
        if (!ext.getPushConfig) return { vapidPublicKey: null }
        return await ext.getPushConfig()
      } catch {
        return { vapidPublicKey: null }
      }
    },
    async subscribePush(sub) {
      try {
        const ext = api as FriendsApiClient & PushApiMethods
        if (!ext.subscribePush) return { ok: false, error: 'push_unsupported' }
        return await ext.subscribePush(sub)
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'subscribe_failed' }
      }
    },
    async unsubscribePush(endpoint) {
      try {
        const ext = api as FriendsApiClient & PushApiMethods
        if (!ext.unsubscribePush) return { ok: false, error: 'push_unsupported' }
        return await ext.unsubscribePush(endpoint)
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'unsubscribe_failed' }
      }
    },
    async getNotificationPrefs() {
      try {
        const ext = api as FriendsApiClient & PushApiMethods
        if (!ext.getNotificationPrefs) return null
        return await ext.getNotificationPrefs()
      } catch {
        return null
      }
    },
    async updateNotificationPrefs(patch) {
      try {
        const ext = api as FriendsApiClient & PushApiMethods
        if (!ext.updateNotificationPrefs) return { ok: false, error: 'push_unsupported' }
        return await ext.updateNotificationPrefs(patch)
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'prefs_failed' }
      }
    },
    async sendTestPush(endpoint?: string) {
      try {
        const ext = api as FriendsApiClient & PushApiMethods
        if (!ext.sendTestPush) return { ok: false, error: 'push_unsupported' }
        return await ext.sendTestPush(endpoint)
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'test_push_failed' }
      }
    },
    async stop() {
      stopped = true
      unfollow?.()
      unsubEngine?.()
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onHidden)
      api.clearSession()
    },
  }
}
