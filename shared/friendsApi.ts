/**
 * Typed client for the Cloudflare Worker + D1 Friends API (YAZ-6200 D1, D2, D4, D7).
 * Shared by both Phone (`mobile/`) and Desktop (`desktop/src/main/friends/`).
 * Pure fetch — no DOM, no Node-only APIs.
 */
import type { FriendStats } from './friendStatsFormat'

export const DEFAULT_FRIENDS_ORIGIN = 'https://docs.yaseenarshad.com'

export type SharedCardStatus = 'pending' | 'accepted' | 'dismissed'

export interface SharedCardAttachment {
  name: string
  mime: string
  dataBase64: string
}

export interface SharedCardItem {
  id: string
  folderId: string | null
  senderId: number
  senderLogin: string
  title: string
  markdown: string
  note: string | null
  attachments: SharedCardAttachment[]
  status: SharedCardStatus
  createdAt: string
}

export interface SharedFolderItem {
  id: string
  name: string
  senderId: number
  senderLogin: string
  createdAt: string
  cards: SharedCardItem[]
}

export type DeckShareMode = 'none' | 'all' | 'selected'

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
  keys: {
    p256dh: string
    auth: string
  }
}

export interface DeckVaultConfig {
  repo: string
  installationId: number
  name: string
}

export interface DeckSettingsPayload {
  mode: DeckShareMode
  vaults: DeckVaultConfig[]
  allowedFriendIds: number[]
}

export interface BrowsableVault {
  repo: string
  name: string
}

export interface DeckTreeFile {
  path: string
  title: string
  kind: 'md' | 'asset'
}

export interface DeckTreePayload {
  repo: string
  name: string
  files: DeckTreeFile[]
}

export interface DeckFilePayload {
  path: string
  title: string
  markdown: string
  assetPaths: string[]
}

export interface FriendBoardMember {
  id: number
  login: string
  name: string
  avatarUrl: string | null
  since: string
  stats: FriendStats | null
  statsAt: string | null
  sharedCardCount: number
  buddyStreak?: number
  canBrowseDeck?: boolean
  browsableVaults?: BrowsableVault[]
}

export interface GroupBoardMember {
  id: number
  login: string
  name: string
  avatarUrl: string | null
  since: string | null
  stats: FriendStats | null
  statsAt: string | null
}

export interface GroupBoardItem {
  id: string
  name: string
  adminId: number
  isAdmin: boolean
  myStatus: 'pending' | 'active'
  inviteCode: string | null
  createdAt?: string
  members: GroupBoardMember[]
  pending: { id: number; login: string; name: string; avatarUrl: string | null }[]
  banned?: { id: number; login: string; name: string }[]
  sharedFolders: SharedFolderItem[]
  sharedCards: SharedCardItem[]
}

export interface FriendsBoardPayload {
  me: {
    id: number
    login: string
    name: string
    nickname: string | null
    avatarUrl: string | null
    hasCustomAvatar?: boolean
    zone: string | null
    vaults: string[]
    stats: FriendStats | null
    statsAt: string | null
  }
  friends: FriendBoardMember[]
  invites: { code: string; expiresAt: string | null; createdAt: string }[]
  groups: GroupBoardItem[]
  incomingCards: SharedCardItem[]
}

export class FriendsApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(`Friends API ${status}: ${code}`)
    this.name = 'FriendsApiError'
  }
}

export interface FriendsApiClientOptions {
  origin?: string
  getGithubToken: () => Promise<string | null>
  fetch?: (url: string, init?: RequestInit) => Promise<Response>
  now?: () => number
}

export interface FriendsApiClient {
  ensureSession(): Promise<string>
  clearSession(): void
  board(force?: boolean): Promise<FriendsBoardPayload>
  sendStats(stats: FriendStats, zone?: string | null, opts?: { force?: boolean }): Promise<{ ok: true; statsAt: string }>
  updatePrefs(prefs: { vaults?: string[]; zone?: string | null; nickname?: string | null }): Promise<{ ok: true; vaults: string[]; zone: string | null; nickname: string | null }>
  uploadAvatar(payload: { contentType: string; dataBase64: string }): Promise<{ ok: true; avatarUrl: string; hasCustomAvatar: true }>
  deleteAvatar(): Promise<{ ok: true; avatarUrl: string | null; hasCustomAvatar: false }>
  getDeckSettings(): Promise<DeckSettingsPayload>
  saveDeckSettings(input: DeckSettingsPayload): Promise<{ ok: true } & DeckSettingsPayload>
  getDeckTree(ownerId: number, repo: string): Promise<DeckTreePayload>
  getDeckFile(ownerId: number, repo: string, path: string): Promise<DeckFilePayload>
  getDeckAssetBytes(ownerId: number, repo: string, path: string): Promise<{ bytes: Uint8Array; contentType: string }>
  createInvite(): Promise<{ code: string; link: string; expiresAt: string }>
  acceptInvite(code: string): Promise<{ kind: 'friend'; friendId: number } | { kind: 'group'; groupId: string; status: string; name: string }>
  removeFriend(userId: number, block?: boolean): Promise<{ ok: true }>
  createGroup(name: string): Promise<{ id: string; name: string; inviteCode: string; link: string }>
  renameGroup(groupId: string, name: string): Promise<{ ok: true; name: string }>
  removeMember(groupId: string, userId?: number): Promise<{ ok: true; deleted?: boolean }>
  banGroupMember(groupId: string, userId: number): Promise<{ ok: true }>
  unbanGroupMember(groupId: string, userId: number): Promise<{ ok: true }>
  rotateGroupInvite(groupId: string): Promise<{ inviteCode: string; link: string }>
  shareCards(input: {
    groupId?: string
    toUserIds?: number[]
    folderName?: string
    cards: { title: string; markdown: string; note?: string | null; attachments?: SharedCardAttachment[] }[]
  }): Promise<{ ok: true; folderId: string | null; cardIds: string[]; count: number }>
  setCardState(cardId: string, status: SharedCardStatus): Promise<{ ok: true; status: SharedCardStatus }>
  setFolderState(folderId: string, status: SharedCardStatus): Promise<{ ok: true; status: SharedCardStatus; count: number }>
  deleteSharedCard(cardId: string): Promise<{ ok: true }>
  getPushConfig(): Promise<{ vapidPublicKey: string | null }>
  subscribePush(sub: PushSubscriptionInput): Promise<{ ok: true }>
  unsubscribePush(endpoint: string): Promise<{ ok: true }>
  getNotificationPrefs(): Promise<{ prefs: NotificationPrefs; subscribedCount: number }>
  updateNotificationPrefs(patch: Partial<NotificationPrefs>): Promise<{ ok: true; prefs: NotificationPrefs }>
  sendTestPush(endpoint?: string): Promise<{ ok: true; sent: number; failed: number; failedStatuses?: number[] }>
  deleteMe(): Promise<{ ok: true; deleted: true }>
}

export function createFriendsApiClient(opts: FriendsApiClientOptions): FriendsApiClient {
  const base = (opts.origin ?? DEFAULT_FRIENDS_ORIGIN).replace(/\/+$/, '')
  const doFetch = opts.fetch ?? ((u: string, init?: RequestInit) => globalThis.fetch(u, init))
  const now = opts.now ?? Date.now

  let sessionToken: string | null = null
  let sessionExpMs = 0
  let cachedEtag: string | null = null
  let cachedBoard: FriendsBoardPayload | null = null

  async function ensureSession(forceRefresh = false): Promise<string> {
    if (!forceRefresh && sessionToken && now() + 60_000 < sessionExpMs) return sessionToken
    const ghToken = await opts.getGithubToken()
    if (!ghToken) throw new FriendsApiError(401, 'signed_out')
    const res = await doFetch(`${base}/api/friends/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ githubToken: ghToken }),
    })
    if (!res.ok) {
      const errBody = (await res.json().catch(() => null)) as { error?: string } | null
      throw new FriendsApiError(res.status, errBody?.error ?? 'session_failed')
    }
    const data = (await res.json()) as { token: string; expiresAt: number }
    sessionToken = data.token
    sessionExpMs = data.expiresAt
    return sessionToken
  }

  async function authed<T>(path: string, init: RequestInit = {}, retry = true): Promise<{ status: number; data: T | null; etag: string | null }> {
    const token = await ensureSession()
    const headers = new Headers(init.headers)
    headers.set('authorization', `Bearer ${token}`)
    if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
    const res = await doFetch(`${base}${path}`, { ...init, headers })
    if (res.status === 401 && retry) {
      sessionToken = null
      sessionExpMs = 0
      return authed<T>(path, init, false)
    }
    if (res.status === 304) return { status: 304, data: null, etag: res.headers.get('etag') }
    if (!res.ok) {
      const errBody = (await res.json().catch(() => null)) as { error?: string } | null
      throw new FriendsApiError(res.status, errBody?.error ?? 'request_failed')
    }
    const data = (await res.json()) as T
    return { status: res.status, data, etag: res.headers.get('etag') }
  }

  return {
    ensureSession: () => ensureSession(false),
    clearSession() {
      sessionToken = null
      sessionExpMs = 0
      cachedEtag = null
      cachedBoard = null
    },
    async board(force = false) {
      const headers: Record<string, string> = {}
      if (!force && cachedEtag && cachedBoard) headers['if-none-match'] = cachedEtag
      const res = await authed<FriendsBoardPayload>('/api/friends/board', { method: 'GET', headers })
      if (res.status === 304 && cachedBoard) return cachedBoard
      if (res.etag) cachedEtag = res.etag
      cachedBoard = res.data!
      return cachedBoard
    },
    async sendStats(stats, zone, opts) {
      const res = await authed<{ ok: true; statsAt: string }>('/api/friends/stats', {
        method: 'PUT',
        body: JSON.stringify({ stats, ...(zone !== undefined && { zone }), ...(opts?.force === true && { force: true }) }),
      })
      cachedEtag = null
      return res.data!
    },
    async updatePrefs(prefs) {
      const res = await authed<{ ok: true; vaults: string[]; zone: string | null; nickname: string | null }>('/api/friends/prefs', {
        method: 'PUT',
        body: JSON.stringify(prefs),
      })
      cachedEtag = null
      return res.data!
    },
    async uploadAvatar(payload) {
      const res = await authed<{ ok: true; avatarUrl: string; hasCustomAvatar: true }>('/api/friends/avatar', {
        method: 'PUT',
        body: JSON.stringify(payload),
      })
      cachedEtag = null
      return res.data!
    },
    async deleteAvatar() {
      const res = await authed<{ ok: true; avatarUrl: string | null; hasCustomAvatar: false }>('/api/friends/avatar', {
        method: 'DELETE',
      })
      cachedEtag = null
      return res.data!
    },
    async getDeckSettings() {
      const res = await authed<DeckSettingsPayload>('/api/friends/decks/settings', { method: 'GET' })
      return res.data!
    },
    async saveDeckSettings(input) {
      const res = await authed<{ ok: true } & DeckSettingsPayload>('/api/friends/decks/settings', {
        method: 'PUT',
        body: JSON.stringify(input),
      })
      cachedEtag = null
      return res.data!
    },
    async getDeckTree(ownerId, repo) {
      const q = new URLSearchParams({ repo }).toString()
      const res = await authed<DeckTreePayload>(`/api/friends/decks/${ownerId}/tree?${q}`, { method: 'GET' })
      return res.data!
    },
    async getDeckFile(ownerId, repo, path) {
      const q = new URLSearchParams({ repo, path }).toString()
      const res = await authed<DeckFilePayload>(`/api/friends/decks/${ownerId}/file?${q}`, { method: 'GET' })
      return res.data!
    },
    async getDeckAssetBytes(ownerId, repo, path) {
      const q = new URLSearchParams({ repo, path }).toString()
      const run = async (retry: boolean): Promise<{ bytes: Uint8Array; contentType: string }> => {
        const token = await ensureSession()
        const res = await doFetch(`${base}/api/friends/decks/${ownerId}/asset?${q}`, {
          method: 'GET',
          headers: { authorization: `Bearer ${token}` },
        })
        if (res.status === 401 && retry) {
          sessionToken = null
          sessionExpMs = 0
          return run(false)
        }
        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as { error?: string } | null
          throw new FriendsApiError(res.status, errBody?.error ?? 'request_failed')
        }
        const buf = await res.arrayBuffer()
        return {
          bytes: new Uint8Array(buf),
          contentType: res.headers.get('content-type') ?? 'application/octet-stream',
        }
      }
      return run(true)
    },
    async createInvite() {
      const res = await authed<{ code: string; link: string; expiresAt: string }>('/api/friends/invites', { method: 'POST' })
      cachedEtag = null
      return res.data!
    },
    async acceptInvite(code) {
      const res = await authed<{ kind: 'friend'; friendId: number } | { kind: 'group'; groupId: string; status: string; name: string }>('/api/friends/invites/accept', {
        method: 'POST',
        body: JSON.stringify({ code }),
      })
      cachedEtag = null
      return res.data!
    },
    async removeFriend(userId, block = false) {
      const res = await authed<{ ok: true }>(`/api/friends/friend/${userId}${block ? '?block=1' : ''}`, { method: 'DELETE' })
      cachedEtag = null
      return res.data!
    },
    async createGroup(name) {
      const res = await authed<{ id: string; name: string; inviteCode: string; link: string }>('/api/friends/groups', {
        method: 'POST',
        body: JSON.stringify({ name }),
      })
      cachedEtag = null
      return res.data!
    },
    async renameGroup(groupId, name) {
      const res = await authed<{ ok: true; name: string }>(`/api/friends/groups/${encodeURIComponent(groupId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      })
      cachedEtag = null
      return res.data!
    },
    async removeMember(groupId, userId) {
      const res = await authed<{ ok: true; deleted?: boolean }>(`/api/friends/groups/${encodeURIComponent(groupId)}/remove`, {
        method: 'POST',
        body: JSON.stringify(userId !== undefined ? { userId } : {}),
      })
      cachedEtag = null
      return res.data!
    },
    async banGroupMember(groupId, userId) {
      const res = await authed<{ ok: true }>(`/api/friends/groups/${encodeURIComponent(groupId)}/ban`, {
        method: 'POST',
        body: JSON.stringify({ userId }),
      })
      cachedEtag = null
      return res.data!
    },
    async unbanGroupMember(groupId, userId) {
      const res = await authed<{ ok: true }>(`/api/friends/groups/${encodeURIComponent(groupId)}/unban`, {
        method: 'POST',
        body: JSON.stringify({ userId }),
      })
      cachedEtag = null
      return res.data!
    },
    async rotateGroupInvite(groupId) {
      const res = await authed<{ inviteCode: string; link: string }>(`/api/friends/groups/${encodeURIComponent(groupId)}/rotate-invite`, { method: 'POST' })
      cachedEtag = null
      return res.data!
    },
    async shareCards(input) {
      const res = await authed<{ ok: true; folderId: string | null; cardIds: string[]; count: number }>('/api/friends/cards/share', {
        method: 'POST',
        body: JSON.stringify(input),
      })
      cachedEtag = null
      return res.data!
    },
    async setCardState(cardId, status) {
      const res = await authed<{ ok: true; status: SharedCardStatus }>(`/api/friends/cards/${encodeURIComponent(cardId)}/state`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      })
      cachedEtag = null
      return res.data!
    },
    async setFolderState(folderId, status) {
      const res = await authed<{ ok: true; status: SharedCardStatus; count: number }>(`/api/friends/folders/${encodeURIComponent(folderId)}/state`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      })
      cachedEtag = null
      return res.data!
    },
    async deleteSharedCard(cardId) {
      const res = await authed<{ ok: true }>(`/api/friends/cards/${encodeURIComponent(cardId)}`, { method: 'DELETE' })
      cachedEtag = null
      return res.data!
    },
    async getPushConfig() {
      const res = await authed<{ vapidPublicKey: string | null }>('/api/friends/push/config', { method: 'GET' })
      return res.data!
    },
    async subscribePush(sub) {
      const res = await authed<{ ok: true }>('/api/friends/push/subscribe', {
        method: 'POST',
        body: JSON.stringify(sub),
      })
      return res.data!
    },
    async unsubscribePush(endpoint) {
      const res = await authed<{ ok: true }>('/api/friends/push/unsubscribe', {
        method: 'POST',
        body: JSON.stringify({ endpoint }),
      })
      return res.data!
    },
    async getNotificationPrefs() {
      const res = await authed<{ prefs: NotificationPrefs; subscribedCount: number }>('/api/friends/push/prefs', { method: 'GET' })
      return res.data!
    },
    async updateNotificationPrefs(patch) {
      const res = await authed<{ ok: true; prefs: NotificationPrefs }>('/api/friends/push/prefs', {
        method: 'PUT',
        body: JSON.stringify(patch),
      })
      return res.data!
    },
    async sendTestPush(endpoint) {
      const res = await authed<{ ok: true; sent: number; failed: number; failedStatuses?: number[] }>(
        '/api/friends/push/test',
        {
          method: 'POST',
          ...(endpoint ? { body: JSON.stringify({ endpoint }) } : {}),
        },
      )
      return res.data!
    },
    async deleteMe() {
      const res = await authed<{ ok: true; deleted: true }>('/api/friends/me', { method: 'DELETE' })
      sessionToken = null
      sessionExpMs = 0
      cachedEtag = null
      cachedBoard = null
      return res.data!
    },
  }
}
