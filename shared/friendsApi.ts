/**
 * Typed client for the Cloudflare Worker + D1 Friends API (YAZ-6200 D1, D2, D4, D7).
 * Shared by both Phone (`mobile/`) and Desktop (`desktop/src/main/friends/`).
 * Pure fetch — no DOM, no Node-only APIs.
 */
import type { FriendStats } from './friendStatsFormat'

export const DEFAULT_FRIENDS_ORIGIN = 'https://docs.yaseenarshad.com'

export type MarkKind = 'cheer' | 'nudge'
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

export interface FriendBoardMember {
  id: number
  login: string
  name: string
  avatarUrl: string | null
  since: string
  stats: FriendStats | null
  statsAt: string | null
  incomingMark: { kind: MarkKind; message?: string | null; at: string; seenAt: string | null } | null
  outgoingMark: { kind: MarkKind; message?: string | null; at: string } | null
  sharedCardCount: number
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
  members: GroupBoardMember[]
  pending: { id: number; login: string; name: string; avatarUrl: string | null }[]
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
  sendStats(stats: FriendStats, zone?: string | null): Promise<{ ok: true; statsAt: string }>
  updatePrefs(prefs: { vaults?: string[]; zone?: string | null; nickname?: string | null }): Promise<{ ok: true; vaults: string[]; zone: string | null; nickname: string | null }>
  createInvite(): Promise<{ code: string; link: string; expiresAt: string }>
  acceptInvite(code: string): Promise<{ kind: 'friend'; friendId: number } | { kind: 'group'; groupId: string; status: string; name: string }>
  removeFriend(userId: number, block?: boolean): Promise<{ ok: true }>
  sendMark(toUserId: number, kind: MarkKind, message?: string): Promise<{ ok: true; kind: MarkKind; message?: string | null; at: string }>
  markSeen(fromUserIds?: number[]): Promise<{ ok: true }>
  createGroup(name: string): Promise<{ id: string; name: string; inviteCode: string; link: string }>
  approveMember(groupId: string, userId: number): Promise<{ ok: true }>
  removeMember(groupId: string, userId?: number): Promise<{ ok: true; deleted?: boolean }>
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
    async sendStats(stats, zone) {
      const res = await authed<{ ok: true; statsAt: string }>('/api/friends/stats', {
        method: 'PUT',
        body: JSON.stringify({ stats, ...(zone !== undefined && { zone }) }),
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
    async sendMark(toUserId, kind, message) {
      const res = await authed<{ ok: true; kind: MarkKind; message?: string | null; at: string }>('/api/friends/marks', {
        method: 'POST',
        body: JSON.stringify({ toUserId, kind, ...(message ? { message } : {}) }),
      })
      cachedEtag = null
      return res.data!
    },
    async markSeen(fromUserIds) {
      const res = await authed<{ ok: true }>('/api/friends/marks/seen', {
        method: 'POST',
        body: JSON.stringify({ fromUserIds: fromUserIds ?? [] }),
      })
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
    async approveMember(groupId, userId) {
      const res = await authed<{ ok: true }>(`/api/friends/groups/${encodeURIComponent(groupId)}/approve`, {
        method: 'POST',
        body: JSON.stringify({ userId }),
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
