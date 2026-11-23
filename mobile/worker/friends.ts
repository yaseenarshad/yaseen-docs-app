/**
 * Friends API routes on docs.yaseenarshad.com (YAZ-6200 D1, D2, D4, D7, D9, Items 1–10).
 *
 * Routes:
 * - POST   /api/friends/session               Exchange GitHub App access token for 8h HMAC friendsToken
 * - GET    /api/friends/board                 Full board payload (ETag / 304 Not Modified)
 * - PUT    /api/friends/stats                 Save FriendStats JSON (two-device never-lower today guard)
 * - PUT    /api/friends/prefs                 Save vaults, zone, nickname (works with 0 friends)
 * - POST   /api/friends/invites               Create 1-step friend invite code (7d expiry, 20/day limit)
 * - POST   /api/friends/invites/accept        Accept friend invite code OR join group invite code
 * - DELETE /api/friends/friend/:id            Unlink friend (optional ?block=1)
 * - POST   /api/friends/groups                Create group with reusable invite code
 * - PATCH  /api/friends/groups/:id            Admin renames group
 * - POST   /api/friends/groups/:id/remove     Admin removes member, member leaves, or admin deletes group
 * - POST   /api/friends/groups/:id/ban        Admin bans member from group
 * - POST   /api/friends/groups/:id/unban      Admin unbans member from group
 * - POST   /api/friends/groups/:id/rotate-invite  Admin rotates group invite code
 * - POST   /api/friends/cards/share           Share 1 card or a folder of cards to friends/group
 * - POST   /api/friends/cards/:id/state       Set per-member state ('accepted' | 'dismissed' | 'pending')
 * - POST   /api/friends/folders/:id/state     1-shot set state for all cards in a shared folder
 * - DELETE /api/friends/cards/:id             Sender or group admin removes shared card
 * - DELETE /api/friends/me                    Delete user's Friends data cleanly
 */
import { CALLBACK_ORIGINS } from '../src/auth/githubAppConfig'
import type { D1Database } from './d1Types'
import { cardFileTitle } from '../../shared/cardFileFormat'
import { computeBuddyStreak, displayNameFor } from '../../shared/friendsBoard'
import type { DeckShareMode, FriendFinishedMode } from '../../shared/friendsApi'
import { extractRelativeAssetPaths, sanitizeSharedMarkdown } from '../../shared/friendsShare'
import { FRIENDS_TOKEN_TTL_S, fetchGithubProfile, signFriendsToken, upsertUserProfile, verifyFriendsToken } from './friendsAuth'
import { mintReadOnlyRepoToken, verifyInstallationRepoOwnership } from './githubAppJwt'
import {
  notifyFriendInviteAccepted,
  notifyFriendsOnDoneTransition,
  notifySharedCardsRecipients,
  notifyUser,
  parseNotificationPrefsRow,
} from './pushNotify'
import { isValidPushEndpoint, isValidPushKeys } from './webPush'
import type { FriendDay, FriendStats } from '../../shared/friendStatsFormat'

export interface FriendsEnv {
  FRIENDS_TOKEN_SECRET?: string
  FRIENDS_DB?: D1Database
  GITHUB_APP_ID?: string
  GITHUB_APP_PRIVATE_KEY?: string
  VAPID_PUBLIC_KEY?: string
  VAPID_PRIVATE_KEY?: string
  VAPID_SUBJECT?: string
}

export interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void
}

function runInBackground(ctx: WorkerExecutionContext | undefined, work: Promise<unknown>): void {
  const safe = work.catch(() => {})
  if (ctx) ctx.waitUntil(safe)
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>

const HEADERS: Record<string, string> = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
}

const MAX_STATS_BYTES = 128 * 1024
const MAX_CARD_MD_BYTES = 64 * 1024
const MAX_CARD_ATTACH_BYTES = 512 * 1024
const MAX_AVATAR_BYTES = 50 * 1024
const ALLOWED_AVATAR_TYPES = new Set(['image/webp', 'image/jpeg', 'image/png'])
const MAX_FOLDER_CARDS = 200
const FRIEND_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const RATE_INVITES_PER_DAY = 20
const RATE_SHARES_PER_DAY = 60

const answer = (status: number, body: unknown, extraHeaders: Record<string, string> = {}) =>
  new Response(body === null ? null : JSON.stringify(body), { status, headers: { ...HEADERS, ...extraHeaders } })

const refuse = (status: number, error: string) => answer(status, { error })

const randomCode = (len = 10): string => {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
  const bytes = new Uint8Array(len)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length]
  return out
}

const randomId = (): string => crypto.randomUUID()

const canonicalPair = (a: number, b: number): [number, number] => (a < b ? [a, b] : [b, a])

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function sha256HexBytes(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function decodeBase64Bytes(raw: string): Uint8Array<ArrayBuffer> | null {
  const clean = raw.replace(/\s+/g, '')
  if (!clean || clean.length % 4 === 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) return null
  try {
    const bin = atob(clean)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

function matchesAvatarMagicBytes(contentType: string, bytes: Uint8Array): boolean {
  if (contentType === 'image/webp') {
    return (
      bytes.byteLength >= 12 &&
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    )
  }
  if (contentType === 'image/jpeg') {
    return bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  }
  if (contentType === 'image/png') {
    return bytes.byteLength >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  }
  return false
}

function toUint8Array(data: unknown): Uint8Array<ArrayBuffer> | null {
  if (data instanceof Uint8Array) {
    const out = new Uint8Array(data.byteLength)
    out.set(data)
    return out
  }
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (Array.isArray(data)) return new Uint8Array(data as number[])
  return null
}

/** Canonicalizes `owner/repo` (stripping any `@branch` suffix and lowercasing). */
export function normalizeRepoSlug(raw: string): string | null {
  const stripped = raw.trim().replace(/@[^/\s]+$/, '')
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(stripped)) return null
  return stripped.toLowerCase()
}

/** Validates a vault-relative file path, rejecting traversal (`..`), dotfiles/dotdirs, and `.yaseendocs/`. */
export function isSafeDeckPath(rawPath: string): string | null {
  const trimmed = rawPath.trim()
  if (!trimmed || trimmed.length > 500 || trimmed.startsWith('/') || trimmed.includes('\\') || trimmed.includes('\0')) {
    return null
  }
  const parts = trimmed.split('/')
  for (const part of parts) {
    if (!part || part === '.' || part === '..' || part.startsWith('.')) return null
  }
  return parts.join('/')
}

const encodeGithubPath = (path: string): string =>
  path
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')

function basenameOf(path: string, stripMd = false): string {
  const name = path.split('/').pop() ?? path
  return stripMd && name.toLowerCase().endsWith('.md') ? name.slice(0, -3) : name
}

function titleFromDeckMarkdown(raw: string, path: string): string {
  const cardTitle = cardFileTitle(raw).trim()
  if (cardTitle) return cardTitle
  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)
  if (fmMatch) {
    const titleLine = /^title:\s*(.+)$/m.exec(fmMatch[1])
    if (titleLine) {
      const val = titleLine[1].trim().replace(/^['"]|['"]$/g, '').trim()
      if (val) return val
    }
  }
  const heading = /^#\s+(.+)$/m.exec(raw)
  if (heading) {
    const val = heading[1].trim()
    if (val) return val
  }
  return basenameOf(path, true)
}

function safeAssetContentType(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  return 'application/octet-stream'
}

/**
 * Two-device "never lower counts or wipe past days" guard (YAZ-6200 Item 2, YAZ-6284):
 * - Today (`days[0]`): never lowers counts/seconds/answers and never overwrites `done: true` with `done: false`.
 * - Past days (`days[1..]`): merges overlapping days by `Math.max` on counts and `||` on `done` so partial-vault
 *   devices never wipe prior days' totals.
 */
export function mergeStatsNeverLower(prev: FriendStats | null, next: FriendStats): FriendStats {
  if (prev === null || !Array.isArray(prev.days) || prev.days.length === 0 || !Array.isArray(next.days) || next.days.length === 0) {
    return next
  }
  const prevByDay = new Map<string, FriendDay>()
  for (const d of prev.days) prevByDay.set(d.day, d)

  let changed = false
  const mergedDays = next.days.map((nd) => {
    const pd = prevByDay.get(nd.day)
    if (!pd) return nd
    const cards = Math.max(nd.cards, pd.cards)
    const seconds = Math.max(nd.seconds, pd.seconds)
    const remembered = Math.max(nd.remembered, pd.remembered)
    const forgot = Math.max(nd.forgot, pd.forgot)
    const newCards = Math.max(nd.newCards, pd.newCards)
    const done = nd.done || pd.done
    if (
      cards !== nd.cards ||
      seconds !== nd.seconds ||
      remembered !== nd.remembered ||
      forgot !== nd.forgot ||
      newCards !== nd.newCards ||
      done !== nd.done
    ) {
      changed = true
      return { ...nd, cards, seconds, remembered, forgot, newCards, done }
    }
    return nd
  })

  const nextDaySet = new Set(mergedDays.map((d) => d.day))
  const latestDay = mergedDays[0].day
  const extras: FriendDay[] = []
  for (const pd of prev.days) {
    if (!nextDaySet.has(pd.day) && pd.day < latestDay) extras.push(pd)
  }
  if (extras.length > 0) {
    changed = true
    mergedDays.push(...extras)
    mergedDays.sort((a, b) => (a.day > b.day ? -1 : a.day < b.day ? 1 : 0))
    if (mergedDays.length > 90) mergedDays.length = 90
  }

  if (!changed) return next
  const maxCards = mergedDays.reduce((m, d) => Math.max(m, d.cards), 0)
  return {
    ...next,
    days: mergedDays,
    totals: {
      ...next.totals,
      streak: Math.max(next.totals.streak, prev.totals.streak),
      bestStreak: Math.max(next.totals.bestStreak, prev.totals.bestStreak),
      bestDay: Math.max(next.totals.bestDay, prev.totals.bestDay, maxCards),
      bestWeek: Math.max(next.totals.bestWeek, prev.totals.bestWeek),
    },
  }
}

async function checkRateLimit(db: D1Database, userId: number, action: string, limit: number, windowMs: number, nowMs: number): Promise<boolean> {
  const cutoff = nowMs - windowMs
  await db.prepare('DELETE FROM rate_events WHERE user_id = ? AND action = ? AND at < ?').bind(userId, action, cutoff).run()
  const row = await db.prepare('SELECT COUNT(*) as cnt FROM rate_events WHERE user_id = ? AND action = ? AND at >= ?').bind(userId, action, cutoff).first<{ cnt: number }>()
  if ((row?.cnt ?? 0) >= limit) return false
  await db.prepare('INSERT INTO rate_events (user_id, action, at) VALUES (?, ?, ?)').bind(userId, action, nowMs).run()
  return true
}

function isOriginAllowed(request: Request, url: URL): boolean {
  const origin = request.headers.get('origin')
  // Native Electron Mac main process sends no Origin header; browser requests must match our site origins.
  if (origin === null) return true
  if (origin === url.origin) return true
  return (CALLBACK_ORIGINS as readonly string[]).includes(origin)
}

async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await request.json()
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

export async function handleFriends(
  request: Request,
  env: FriendsEnv,
  fetch: Fetch = (u, init) => globalThis.fetch(u, init),
  now: () => number = Date.now,
  ctx?: WorkerExecutionContext,
): Promise<Response> {
  const url = new URL(request.url)
  if (!isOriginAllowed(request, url)) return refuse(403, 'wrong_origin')

  const db = env.FRIENDS_DB
  const secret = env.FRIENDS_TOKEN_SECRET
  if (!db || !secret) return refuse(503, 'not_set_up')

  const path = url.pathname
  const method = request.method.toUpperCase()
  const nowMs = now()
  const nowIso = new Date(nowMs).toISOString()

  // 1. POST /api/friends/session — exchange GitHub token for 8h signed friendsToken
  if (path === '/api/friends/session') {
    if (method !== 'POST') return new Response(null, { status: 405, headers: { ...HEADERS, allow: 'POST' } })
    const body = await readJsonBody(request)
    const githubToken = typeof body?.githubToken === 'string' && body.githubToken.length > 0 && body.githubToken.length <= 512 ? body.githubToken : null
    if (!githubToken) return refuse(400, 'bad_request')

    const gh = await fetchGithubProfile(githubToken, fetch)
    if (!gh.ok) return refuse(gh.status, gh.error)

    await upsertUserProfile(db, gh.profile, nowIso)
    const exp = Math.floor(nowMs / 1000) + FRIENDS_TOKEN_TTL_S
    const token = await signFriendsToken({ v: 1, sub: gh.profile.id, login: gh.profile.login, exp }, secret)
    return answer(200, {
      token,
      expiresAt: exp * 1000,
      user: {
        id: gh.profile.id,
        login: gh.profile.login,
        name: gh.profile.name,
        avatarUrl: gh.profile.avatarUrl,
      },
    })
  }

  // 1b. GET /api/friends/avatar/:id — public custom avatar image (no auth header so <img src=...> works)
  const avatarGet = /^\/api\/friends\/avatar\/([^/]+)$/.exec(path)
  if (avatarGet) {
    if (method !== 'GET') return new Response(null, { status: 405, headers: { ...HEADERS, allow: 'GET' } })
    const rawId = avatarGet[1]
    if (!/^\d+$/.test(rawId)) return refuse(400, 'bad_request')
    const targetId = Number(rawId)
    if (!Number.isSafeInteger(targetId) || targetId <= 0) return refuse(400, 'bad_request')
    const row = await db
      .prepare('SELECT content_type, data, version FROM user_avatars WHERE github_id = ?')
      .bind(targetId)
      .first<{ content_type: string; data: unknown; version: string }>()
    if (!row) return refuse(404, 'not_found')
    const bytes = toUint8Array(row.data)
    if (!bytes || bytes.byteLength === 0) return refuse(404, 'not_found')
    const hasVersionParam = url.searchParams.has('v') && url.searchParams.get('v') !== ''
    return new Response(bytes, {
      status: 200,
      headers: {
        'content-type': String(row.content_type),
        'x-content-type-options': 'nosniff',
        'cache-control': hasVersionParam ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
        'referrer-policy': 'no-referrer',
        'content-security-policy': "default-src 'none'; sandbox",
      },
    })
  }

  // All remaining /api/friends/* routes require Bearer friendsToken
  const authHeader = request.headers.get('authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(authHeader)
  if (!match) return refuse(401, 'unauthorized')
  const claims = await verifyFriendsToken(match[1].trim(), secret, Math.floor(nowMs / 1000))
  if (!claims) return refuse(401, 'unauthorized')
  const meId = claims.sub

  // 2. GET /api/friends/board (with ETag / 304 Not Modified)
  if (path === '/api/friends/board') {
    if (method !== 'GET') return new Response(null, { status: 405, headers: { ...HEADERS, allow: 'GET' } })

    const meRow = await db
      .prepare('SELECT github_id, login, name, avatar_url, nickname, zone, vaults_json, stats_json, stats_at, updated_at FROM users WHERE github_id = ?')
      .bind(meId)
      .first<Record<string, unknown>>()
    if (!meRow) return refuse(401, 'unauthorized')

    // Friends
    const friendRows = await db
      .prepare(
        `SELECT u.github_id, u.login, u.name, u.avatar_url, u.nickname, u.stats_json, u.stats_at, u.deck_share_mode, f.created_at AS friend_since
         FROM friendships f
         JOIN users u ON u.github_id = CASE WHEN f.user_a = ? THEN f.user_b ELSE f.user_a END
         WHERE f.user_a = ? OR f.user_b = ?`,
      )
      .bind(meId, meId, meId)
      .all<Record<string, unknown>>()

    // Deck vaults & per-friend permissions for friends
    const vaultsByOwner = new Map<number, { repo: string; name: string }[]>()
    const allowedOwners = new Set<number>()
    if (friendRows.results.length > 0) {
      const friendIds = friendRows.results.map((r) => Number(r.github_id))
      const placeholders = friendIds.map(() => '?').join(', ')
      const vaultRows = await db
        .prepare(`SELECT owner_id, repo_slug, name FROM deck_vaults WHERE owner_id IN (${placeholders}) ORDER BY name ASC`)
        .bind(...friendIds)
        .all<Record<string, unknown>>()
      for (const v of vaultRows.results) {
        const oid = Number(v.owner_id)
        const list = vaultsByOwner.get(oid) ?? []
        list.push({ repo: String(v.repo_slug), name: String(v.name) })
        vaultsByOwner.set(oid, list)
      }
      const permRows = await db
        .prepare(`SELECT owner_id FROM deck_permissions WHERE friend_id = ? AND allowed = 1 AND owner_id IN (${placeholders})`)
        .bind(meId, ...friendIds)
        .all<Record<string, unknown>>()
      for (const p of permRows.results) allowedOwners.add(Number(p.owner_id))
    }

    // Shared card counts per friend (both directions)
    const sharedCounts = await db
      .prepare(
        `SELECT CASE WHEN sender_id = ? THEN to_user_id ELSE sender_id END AS other_id, COUNT(*) AS cnt
         FROM shared_cards
         WHERE group_id IS NULL AND (sender_id = ? OR to_user_id = ?)
         GROUP BY other_id`,
      )
      .bind(meId, meId, meId)
      .all<Record<string, unknown>>()
    const sharedCountBy = new Map<number, number>()
    for (const r of sharedCounts.results) {
      if (r.other_id != null) sharedCountBy.set(Number(r.other_id), Number(r.cnt))
    }

    // Active invites created by me (unexpired friend invites)
    const myInvites = await db
      .prepare("SELECT code, expires_at, created_at FROM invites WHERE creator_id = ? AND kind = 'friend' AND (expires_at IS NULL OR expires_at > ?)")
      .bind(meId, nowIso)
      .all<Record<string, unknown>>()

    // Groups I belong to (excluding groups I am banned from)
    const myGroups = await db
      .prepare(
        `SELECT g.id, g.name, g.admin_id, g.invite_code, g.created_at, gm.status AS my_status, gm.since AS my_since
         FROM group_members gm
         JOIN groups g ON g.id = gm.group_id
         WHERE gm.user_id = ? AND gm.status != 'banned'`,
      )
      .bind(meId)
      .all<Record<string, unknown>>()

    const allAvatarUserIds = new Set<number>([meId])
    for (const f of friendRows.results) allAvatarUserIds.add(Number(f.github_id))

    const groupsOut = []
    for (const g of myGroups.results) {
      const gid = String(g.id)
      const isAdmin = Number(g.admin_id) === meId
      const membersRes = await db
        .prepare(
          `SELECT u.github_id, u.login, u.name, u.avatar_url, u.nickname, u.stats_json, u.stats_at, gm.status, gm.since
           FROM group_members gm
           JOIN users u ON u.github_id = gm.user_id
           WHERE gm.group_id = ?`,
        )
        .bind(gid)
        .all<Record<string, unknown>>()

      const activeMembers = []
      const bannedMembers: { id: number; login: string; name: string }[] = []
      for (const m of membersRes.results) {
        const mid = Number(m.github_id)
        const mName = displayNameFor(m.nickname as string | null, m.name as string | null, String(m.login))
        if (m.status === 'active') {
          allAvatarUserIds.add(mid)
          activeMembers.push({
            id: mid,
            login: String(m.login),
            name: mName,
            avatarUrl: m.avatar_url ? String(m.avatar_url) : null,
            since: m.since ? String(m.since) : null,
            stats: m.stats_json ? safeParseJson(String(m.stats_json)) : null,
            statsAt: m.stats_at ? String(m.stats_at) : null,
          })
        } else if (isAdmin && m.status === 'banned') {
          bannedMembers.push({
            id: mid,
            login: String(m.login),
            name: mName,
          })
        }
      }

      // Group shared folders & cards (visible to active members, including late joiners!)
      const foldersOut: unknown[] = []
      const looseCardsOut: unknown[] = []
      if (g.my_status === 'active') {
        const gFolders = await db
          .prepare(
            `SELECT sf.id, sf.name, sf.sender_id, sf.created_at, u.login AS sender_login
             FROM shared_folders sf
             JOIN users u ON u.github_id = sf.sender_id
             WHERE sf.group_id = ?
             ORDER BY sf.created_at DESC`,
          )
          .bind(gid)
          .all<Record<string, unknown>>()

        const gCards = await db
          .prepare(
            `SELECT sc.id, sc.folder_id, sc.sender_id, sc.title, sc.markdown, sc.note, sc.attachments_json, sc.created_at,
                    u.login AS sender_login, COALESCE(scs.status, 'pending') AS member_status
             FROM shared_cards sc
             JOIN users u ON u.github_id = sc.sender_id
             LEFT JOIN shared_card_states scs ON scs.shared_card_id = sc.id AND scs.user_id = ?
             WHERE sc.group_id = ?
             ORDER BY sc.created_at DESC`,
          )
          .bind(meId, gid)
          .all<Record<string, unknown>>()

        const cardsByFolder = new Map<string, unknown[]>()
        for (const c of gCards.results) {
          const cardObj = {
            id: String(c.id),
            folderId: c.folder_id ? String(c.folder_id) : null,
            senderId: Number(c.sender_id),
            senderLogin: String(c.sender_login),
            title: String(c.title),
            markdown: String(c.markdown),
            note: c.note ? String(c.note) : null,
            attachments: c.attachments_json ? safeParseJson(String(c.attachments_json)) : [],
            status: String(c.member_status) as 'pending' | 'accepted' | 'dismissed',
            createdAt: String(c.created_at),
          }
          if (cardObj.folderId) {
            const arr = cardsByFolder.get(cardObj.folderId) ?? []
            arr.push(cardObj)
            cardsByFolder.set(cardObj.folderId, arr)
          } else {
            looseCardsOut.push(cardObj)
          }
        }
        for (const f of gFolders.results) {
          const fid = String(f.id)
          foldersOut.push({
            id: fid,
            name: String(f.name),
            senderId: Number(f.sender_id),
            senderLogin: String(f.sender_login),
            createdAt: String(f.created_at),
            cards: cardsByFolder.get(fid) ?? [],
          })
        }
      }

      groupsOut.push({
        id: gid,
        name: String(g.name),
        adminId: Number(g.admin_id),
        isAdmin,
        myStatus: String(g.my_status),
        inviteCode: isAdmin || g.my_status === 'active' ? String(g.invite_code) : null,
        createdAt: String(g.created_at),
        members: activeMembers,
        pending: [],
        banned: bannedMembers,
        sharedFolders: foldersOut,
        sharedCards: looseCardsOut,
      })
    }

    // Direct 1-on-1 incoming shared cards & folders
    const directCardsRes = await db
      .prepare(
        `SELECT sc.id, sc.folder_id, sc.sender_id, sc.title, sc.markdown, sc.note, sc.attachments_json, sc.created_at,
                u.login AS sender_login, COALESCE(scs.status, 'pending') AS member_status
         FROM shared_cards sc
         JOIN users u ON u.github_id = sc.sender_id
         LEFT JOIN shared_card_states scs ON scs.shared_card_id = sc.id AND scs.user_id = ?
         WHERE sc.group_id IS NULL AND sc.to_user_id = ?
         ORDER BY sc.created_at DESC
         LIMIT 50`,
      )
      .bind(meId, meId)
      .all<Record<string, unknown>>()

    const incomingCards = directCardsRes.results.map((c) => ({
      id: String(c.id),
      folderId: c.folder_id ? String(c.folder_id) : null,
      senderId: Number(c.sender_id),
      senderLogin: String(c.sender_login),
      title: String(c.title),
      markdown: String(c.markdown),
      note: c.note ? String(c.note) : null,
      attachments: c.attachments_json ? safeParseJson(String(c.attachments_json)) : [],
      status: String(c.member_status) as 'pending' | 'accepted' | 'dismissed',
      createdAt: String(c.created_at),
    }))

    // Batch-query custom avatars for me + all friends + all group members
    const avatarVersionByUser = new Map<number, string>()
    const avatarIds = [...allAvatarUserIds]
    for (let i = 0; i < avatarIds.length; i += 500) {
      const chunk = avatarIds.slice(i, i + 500)
      const placeholders = chunk.map(() => '?').join(', ')
      const avatarRows = await db
        .prepare(`SELECT github_id, version FROM user_avatars WHERE github_id IN (${placeholders})`)
        .bind(...chunk)
        .all<{ github_id: number; version: string }>()
      for (const r of avatarRows.results) {
        avatarVersionByUser.set(Number(r.github_id), String(r.version))
      }
    }
    const avatarUrlFor = (id: number, fallback: unknown): string | null => {
      const ver = avatarVersionByUser.get(id)
      if (ver) return `${url.origin}/api/friends/avatar/${id}?v=${ver}`
      return fallback ? String(fallback) : null
    }

    for (const g of groupsOut) {
      for (const m of g.members) {
        m.avatarUrl = avatarUrlFor(m.id, m.avatarUrl)
      }
    }

    const meStatsParsed = meRow.stats_json ? (safeParseJson(String(meRow.stats_json)) as FriendStats | null) : null

    const friendsOut = friendRows.results.map((f) => {
      const fid = Number(f.github_id)
      const sharedCount = sharedCountBy.get(fid) ?? 0
      const fStats = f.stats_json ? (safeParseJson(String(f.stats_json)) as FriendStats | null) : null
      const vaults = vaultsByOwner.get(fid) ?? []
      const shareMode = String(f.deck_share_mode ?? 'none')
      const canBrowseDeck = vaults.length > 0 && (shareMode === 'all' || (shareMode === 'selected' && allowedOwners.has(fid)))
      return {
        id: fid,
        login: String(f.login),
        name: displayNameFor(f.nickname as string | null, f.name as string | null, String(f.login)),
        avatarUrl: avatarUrlFor(fid, f.avatar_url),
        since: String(f.friend_since),
        stats: fStats,
        statsAt: f.stats_at ? String(f.stats_at) : null,
        sharedCardCount: sharedCount,
        buddyStreak: computeBuddyStreak(meStatsParsed?.days, fStats?.days, nowMs),
        canBrowseDeck,
        browsableVaults: canBrowseDeck ? vaults : [],
      }
    })

    const payload = {
      me: {
        id: Number(meRow.github_id),
        login: String(meRow.login),
        name: displayNameFor(meRow.nickname as string | null, meRow.name as string | null, String(meRow.login)),
        nickname: meRow.nickname ? String(meRow.nickname) : null,
        avatarUrl: avatarUrlFor(meId, meRow.avatar_url),
        hasCustomAvatar: avatarVersionByUser.has(meId),
        zone: meRow.zone ? String(meRow.zone) : null,
        vaults: (safeParseJson(String(meRow.vaults_json ?? '[]')) as string[] | null) ?? [],
        stats: meRow.stats_json ? safeParseJson(String(meRow.stats_json)) : null,
        statsAt: meRow.stats_at ? String(meRow.stats_at) : null,
      },
      friends: friendsOut,
      invites: myInvites.results.map((i) => ({ code: String(i.code), expiresAt: i.expires_at ? String(i.expires_at) : null, createdAt: String(i.created_at) })),
      groups: groupsOut,
      incomingCards,
    }

    const bodyText = JSON.stringify(payload)
    const etag = `"${(await sha256Hex(bodyText)).slice(0, 24)}"`
    if (request.headers.get('if-none-match') === etag) {
      return new Response(null, { status: 304, headers: { ...HEADERS, etag } })
    }
    return new Response(bodyText, { status: 200, headers: { ...HEADERS, etag } })
  }

  // 3. PUT /api/friends/stats (with two-device never-lower guard)
  if (path === '/api/friends/stats') {
    if (method !== 'PUT') return new Response(null, { status: 405, headers: { ...HEADERS, allow: 'PUT' } })
    const body = await readJsonBody(request)
    if (!body || !body.stats || typeof body.stats !== 'object') return refuse(400, 'bad_request')
    const rawStatsText = JSON.stringify(body.stats)
    if (rawStatsText.length > MAX_STATS_BYTES) return refuse(413, 'too_large')
    const incoming = body.stats as FriendStats
    if (incoming.v !== 1 || !Array.isArray(incoming.days) || typeof incoming.totals !== 'object') return refuse(400, 'bad_stats')

    const force = body.force === true
    const existing = await db
      .prepare('SELECT stats_json, nickname, name, login FROM users WHERE github_id = ?')
      .bind(meId)
      .first<{ stats_json: string | null; nickname: string | null; name: string | null; login: string | null }>()
    const prevStats = existing?.stats_json ? (safeParseJson(existing.stats_json) as FriendStats | null) : null
    const merged = force ? incoming : mergeStatsNeverLower(prevStats, incoming)

    const zone = typeof body.zone === 'string' && body.zone.length <= 64 ? body.zone : undefined
    const lastDone = merged.days.find((d) => d.done)?.day ?? null
    const stmts = [
      db
        .prepare(
          force
            ? 'UPDATE users SET stats_json = ?, stats_at = ?, zone = COALESCE(?, zone), streak_current = ?, streak_best = ?, last_done_day = ?, updated_at = ? WHERE github_id = ?'
            : 'UPDATE users SET stats_json = ?, stats_at = ?, zone = COALESCE(?, zone), streak_current = ?, streak_best = ?, last_done_day = COALESCE(?, last_done_day), updated_at = ? WHERE github_id = ?',
        )
        .bind(JSON.stringify(merged), nowIso, zone ?? null, merged.totals.streak, merged.totals.bestStreak, lastDone, nowIso, meId),
    ]
    if (force) {
      stmts.push(db.prepare('DELETE FROM daily_activity WHERE user_id = ?').bind(meId))
    }
    // Populate indexed daily_activity for recent 14 days (future cross-user communal queries, D13)
    for (const d of merged.days.slice(0, 14)) {
      stmts.push(
        db
          .prepare(
            force
              ? `INSERT INTO daily_activity (user_id, day, cards, seconds, done, streak)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON CONFLICT(user_id, day) DO UPDATE SET
                   cards = excluded.cards,
                   seconds = excluded.seconds,
                   done = excluded.done,
                   streak = excluded.streak`
              : `INSERT INTO daily_activity (user_id, day, cards, seconds, done, streak)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON CONFLICT(user_id, day) DO UPDATE SET
                   cards = MAX(daily_activity.cards, excluded.cards),
                   seconds = MAX(daily_activity.seconds, excluded.seconds),
                   done = MAX(daily_activity.done, excluded.done),
                   streak = MAX(daily_activity.streak, excluded.streak)`,
          )
          .bind(meId, d.day, d.cards, d.seconds, d.done ? 1 : 0, merged.totals.streak),
      )
    }
    // Log streak milestone event (7, 14, 30, 60, 100, 365)
    const milestones = [7, 14, 30, 60, 100, 365]
    if (milestones.includes(merged.totals.streak) && (prevStats?.totals.streak ?? 0) < merged.totals.streak) {
      stmts.push(
        db
          .prepare("INSERT INTO activity_events (id, user_id, group_id, kind, payload_json, created_at) VALUES (?, ?, NULL, 'streak_milestone', ?, ?)")
          .bind(randomId(), meId, JSON.stringify({ streak: merged.totals.streak }), nowIso),
      )
    }
    await db.batch(stmts)
    const meName = displayNameFor(existing?.nickname, existing?.name, String(existing?.login ?? claims.login))
    runInBackground(ctx, notifyFriendsOnDoneTransition(env, db, meId, meName, prevStats, merged, nowMs, fetch))
    return answer(200, { ok: true, statsAt: nowIso })
  }

  // 4. PUT /api/friends/prefs (vaults, zone, nickname — works even with 0 friends!)
  if (path === '/api/friends/prefs') {
    if (method !== 'PUT') return new Response(null, { status: 405, headers: { ...HEADERS, allow: 'PUT' } })
    const body = await readJsonBody(request)
    if (!body) return refuse(400, 'bad_request')

    const cur = await db.prepare('SELECT vaults_json, zone, nickname FROM users WHERE github_id = ?').bind(meId).first<Record<string, unknown>>()
    if (!cur) return refuse(401, 'unauthorized')

    let vaultsJson = String(cur.vaults_json ?? '[]')
    if (Array.isArray(body.vaults)) {
      const cleaned = [
        ...new Set(
          body.vaults
            .filter((v): v is string => typeof v === 'string')
            .map((v) => normalizeRepoSlug(v))
            .filter((v): v is string => v !== null),
        ),
      ].slice(0, 50)
      vaultsJson = JSON.stringify(cleaned)
    }
    const zone = body.zone === null ? null : typeof body.zone === 'string' && body.zone.length <= 64 ? body.zone : (cur.zone as string | null)
    const nickname =
      body.nickname === null
        ? null
        : typeof body.nickname === 'string'
          ? body.nickname.trim().slice(0, 40) || null
          : (cur.nickname as string | null)

    await db
      .prepare('UPDATE users SET vaults_json = ?, zone = ?, nickname = ?, updated_at = ? WHERE github_id = ?')
      .bind(vaultsJson, zone, nickname, nowIso, meId)
      .run()
    return answer(200, { ok: true, vaults: JSON.parse(vaultsJson), zone, nickname })
  }

  // 4b. PUT / DELETE /api/friends/avatar — upload or reset custom avatar (<= 50 KB)
  if (path === '/api/friends/avatar') {
    if (method === 'PUT') {
      const body = await readJsonBody(request)
      if (!body) return refuse(400, 'bad_request')
      const contentType = typeof body.contentType === 'string' ? body.contentType.trim().toLowerCase() : ''
      if (!ALLOWED_AVATAR_TYPES.has(contentType)) return refuse(400, 'bad_content_type')
      if (typeof body.dataBase64 !== 'string') return refuse(400, 'bad_avatar')
      const cleanedBase64 = body.dataBase64.replace(/\s+/g, '')
      if (cleanedBase64.length === 0) return refuse(400, 'bad_avatar')
      // Fast oversize guard before base64 decoding
      if (cleanedBase64.length > Math.ceil((MAX_AVATAR_BYTES * 4) / 3) + 4) return refuse(413, 'avatar_too_large')
      const bytes = decodeBase64Bytes(cleanedBase64)
      if (!bytes || bytes.byteLength === 0) return refuse(400, 'bad_avatar')
      if (bytes.byteLength > MAX_AVATAR_BYTES) return refuse(413, 'avatar_too_large')
      if (!matchesAvatarMagicBytes(contentType, bytes)) return refuse(400, 'bad_image_bytes')

      const version = (await sha256HexBytes(bytes)).slice(0, 12)
      await db
        .prepare(
          `INSERT INTO user_avatars (github_id, content_type, data, version, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(github_id) DO UPDATE SET
             content_type = excluded.content_type,
             data = excluded.data,
             version = excluded.version,
             updated_at = excluded.updated_at`,
        )
        .bind(meId, contentType, bytes, version, nowIso)
        .run()
      return answer(200, {
        ok: true,
        avatarUrl: `${url.origin}/api/friends/avatar/${meId}?v=${version}`,
        hasCustomAvatar: true,
      })
    }
    if (method === 'DELETE') {
      await db.prepare('DELETE FROM user_avatars WHERE github_id = ?').bind(meId).run()
      const userRow = await db.prepare('SELECT avatar_url FROM users WHERE github_id = ?').bind(meId).first<{ avatar_url?: string | null }>()
      const fallback = userRow?.avatar_url ? String(userRow.avatar_url) : null
      return answer(200, { ok: true, avatarUrl: fallback, hasCustomAvatar: false })
    }
    return new Response(null, { status: 405, headers: { ...HEADERS, allow: 'PUT, DELETE' } })
  }

  // 5. POST /api/friends/invites — 1-step single-use 7-day friend invite
  if (path === '/api/friends/invites') {
    if (method !== 'POST') return new Response(null, { status: 405, headers: { ...HEADERS, allow: 'POST' } })
    const allowed = await checkRateLimit(db, meId, 'invite', RATE_INVITES_PER_DAY, 24 * 60 * 60 * 1000, nowMs)
    if (!allowed) return refuse(429, 'rate_limited')

    const code = randomCode(10)
    const expiresAt = new Date(nowMs + FRIEND_INVITE_TTL_MS).toISOString()
    await db
      .prepare("INSERT INTO invites (code, kind, creator_id, group_id, expires_at, created_at) VALUES (?, 'friend', ?, NULL, ?, ?)")
      .bind(code, meId, expiresAt, nowIso)
      .run()
    return answer(200, { code, link: `https://docs.yaseenarshad.com/friend#${code}`, expiresAt })
  }

  // 6. POST /api/friends/invites/accept — accept friend invite OR join group invite
  if (path === '/api/friends/invites/accept') {
    if (method !== 'POST') return new Response(null, { status: 405, headers: { ...HEADERS, allow: 'POST' } })
    const body = await readJsonBody(request)
    const code = typeof body?.code === 'string' ? body.code.trim().toLowerCase() : ''
    if (!/^[a-z0-9]{6,32}$/.test(code)) return refuse(400, 'bad_code')

    // First check single-use friend invite
    const inv = await db.prepare('SELECT code, kind, creator_id, expires_at FROM invites WHERE code = ?').bind(code).first<Record<string, unknown>>()
    if (inv && inv.kind === 'friend') {
      if (inv.expires_at && String(inv.expires_at) <= nowIso) {
        await db.prepare('DELETE FROM invites WHERE code = ?').bind(code).run()
        return refuse(410, 'invite_expired')
      }
      const otherId = Number(inv.creator_id)
      if (otherId === meId) return refuse(400, 'self_invite')
      const blocked = await db
        .prepare('SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)')
        .bind(meId, otherId, otherId, meId)
        .first()
      if (blocked) return refuse(403, 'blocked')

      const [a, b] = canonicalPair(meId, otherId)
      await db.batch([
        db.prepare('INSERT OR IGNORE INTO friendships (user_a, user_b, created_at) VALUES (?, ?, ?)').bind(a, b, nowIso),
        db.prepare('DELETE FROM invites WHERE code = ?').bind(code),
      ])
      runInBackground(
        ctx,
        (async () => {
          const meUser = await db
            .prepare('SELECT nickname, name, login FROM users WHERE github_id = ?')
            .bind(meId)
            .first<{ nickname: string | null; name: string | null; login: string | null }>()
          const meName = displayNameFor(meUser?.nickname, meUser?.name, String(meUser?.login ?? claims.login))
          await notifyFriendInviteAccepted(env, db, otherId, meId, meName, fetch, nowMs)
        })(),
      )
      return answer(200, { kind: 'friend', friendId: otherId })
    }

    // Next check reusable group invite code
    const grp = await db.prepare('SELECT id, name, admin_id FROM groups WHERE invite_code = ?').bind(code).first<Record<string, unknown>>()
    if (grp) {
      const gid = String(grp.id)
      const adminId = Number(grp.admin_id)
      const blocked = await db
        .prepare('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?')
        .bind(adminId, meId)
        .first()
      if (blocked) return refuse(403, 'blocked')

      const existing = await db.prepare('SELECT status FROM group_members WHERE group_id = ? AND user_id = ?').bind(gid, meId).first<{ status: string }>()
      if (existing?.status === 'banned') return refuse(403, 'banned')
      if (existing?.status === 'active') return answer(200, { kind: 'group', groupId: gid, status: 'active', name: String(grp.name) })

      await db
        .prepare(
          `INSERT INTO group_members (group_id, user_id, status, since, created_at)
           VALUES (?, ?, 'active', ?, ?)
           ON CONFLICT(group_id, user_id) DO UPDATE SET status = 'active', since = excluded.since`,
        )
        .bind(gid, meId, nowIso, nowIso)
        .run()
      return answer(200, { kind: 'group', groupId: gid, status: 'active', name: String(grp.name) })
    }

    return refuse(404, 'invite_not_found')
  }

  // 7. DELETE /api/friends/friend/:id (unlink, optional ?block=1)
  const friendDel = /^\/api\/friends\/friend\/(\d+)$/.exec(path)
  if (friendDel) {
    if (method !== 'DELETE') return new Response(null, { status: 405, headers: { ...HEADERS, allow: 'DELETE' } })
    const otherId = Number(friendDel[1])
    const [a, b] = canonicalPair(meId, otherId)
    const stmts = [
      db.prepare('DELETE FROM friendships WHERE user_a = ? AND user_b = ?').bind(a, b),
      db.prepare('DELETE FROM deck_permissions WHERE (owner_id = ? AND friend_id = ?) OR (owner_id = ? AND friend_id = ?)').bind(meId, otherId, otherId, meId),
    ]
    if (url.searchParams.get('block') === '1') {
      stmts.push(db.prepare('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)').bind(meId, otherId, nowIso))
    }
    await db.batch(stmts)
    return answer(200, { ok: true })
  }

  // 8. POST /api/friends/groups — create group
  if (path === '/api/friends/groups') {
    if (method !== 'POST') return new Response(null, { status: 405, headers: { ...HEADERS, allow: 'POST' } })
    const body = await readJsonBody(request)
    const name = typeof body?.name === 'string' ? body.name.replace(/\s+/g, ' ').trim().slice(0, 60) : ''
    if (!name) return refuse(400, 'bad_name')

    const id = randomId()
    const inviteCode = randomCode(10)
    await db.batch([
      db.prepare('INSERT INTO groups (id, name, admin_id, invite_code, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, name, meId, inviteCode, nowIso),
      db.prepare("INSERT INTO group_members (group_id, user_id, status, since, created_at) VALUES (?, ?, 'active', ?, ?)").bind(id, meId, nowIso, nowIso),
    ])
    return answer(200, { id, name, inviteCode, link: `https://docs.yaseenarshad.com/group#${inviteCode}` })
  }

  // 8b. PATCH /api/friends/groups/:id — admin renames group (YAZ-6277)
  const groupPatch = /^\/api\/friends\/groups\/([^/]+)$/.exec(path)
  if (groupPatch) {
    if (method !== 'PATCH') return new Response(null, { status: 405, headers: { ...HEADERS, allow: 'PATCH' } })
    const gid = decodeURIComponent(groupPatch[1])
    const grp = await db.prepare('SELECT id, admin_id FROM groups WHERE id = ?').bind(gid).first<{ id: string; admin_id: number }>()
    if (!grp) return refuse(404, 'group_not_found')
    if (grp.admin_id !== meId) return refuse(403, 'not_admin')
    const body = await readJsonBody(request)
    const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 80) : ''
    if (!name) return refuse(400, 'name_required')
    await db.prepare('UPDATE groups SET name = ? WHERE id = ?').bind(name, gid).run()
    return answer(200, { ok: true, name })
  }

  // 9. Group member actions: remove/leave, rotate-invite, ban, unban
  const groupAct = /^\/api\/friends\/groups\/([^/]+)\/(remove|rotate-invite|ban|unban)$/.exec(path)
  if (groupAct) {
    if (method !== 'POST') return new Response(null, { status: 405, headers: { ...HEADERS, allow: 'POST' } })
    const gid = decodeURIComponent(groupAct[1])
    const action = groupAct[2]
    const grp = await db.prepare('SELECT id, admin_id FROM groups WHERE id = ?').bind(gid).first<{ id: string; admin_id: number }>()
    if (!grp) return refuse(404, 'group_not_found')

    if (action === 'ban') {
      if (grp.admin_id !== meId) return refuse(403, 'not_admin')
      const body = await readJsonBody(request)
      const userId = typeof body?.userId === 'number' && Number.isInteger(body.userId) ? body.userId : null
      if (!userId || userId === grp.admin_id) return refuse(400, 'bad_request')
      await db
        .prepare(
          `INSERT INTO group_members (group_id, user_id, status, since, created_at)
           VALUES (?, ?, 'banned', NULL, ?)
           ON CONFLICT(group_id, user_id) DO UPDATE SET status = 'banned', since = NULL`,
        )
        .bind(gid, userId, nowIso)
        .run()
      return answer(200, { ok: true })
    }

    if (action === 'unban') {
      if (grp.admin_id !== meId) return refuse(403, 'not_admin')
      const body = await readJsonBody(request)
      const userId = typeof body?.userId === 'number' && Number.isInteger(body.userId) ? body.userId : null
      if (!userId) return refuse(400, 'bad_request')
      await db.prepare("DELETE FROM group_members WHERE group_id = ? AND user_id = ? AND status = 'banned'").bind(gid, userId).run()
      return answer(200, { ok: true })
    }

    if (action === 'rotate-invite') {
      if (grp.admin_id !== meId) return refuse(403, 'not_admin')
      const nextCode = randomCode(10)
      await db.prepare('UPDATE groups SET invite_code = ? WHERE id = ?').bind(nextCode, gid).run()
      return answer(200, { inviteCode: nextCode, link: `https://docs.yaseenarshad.com/group#${nextCode}` })
    }

    // remove / leave / delete group
    const body = await readJsonBody(request)
    const targetId = typeof body?.userId === 'number' && Number.isInteger(body.userId) ? body.userId : meId
    if (targetId !== meId && grp.admin_id !== meId) return refuse(403, 'not_admin')
    if (targetId === grp.admin_id) {
      // Admin leaving deletes the group and its shared library
      await db.batch([
        db.prepare('DELETE FROM shared_card_states WHERE shared_card_id IN (SELECT id FROM shared_cards WHERE group_id = ?)').bind(gid),
        db.prepare('DELETE FROM shared_cards WHERE group_id = ?').bind(gid),
        db.prepare('DELETE FROM shared_folders WHERE group_id = ?').bind(gid),
        db.prepare('DELETE FROM group_members WHERE group_id = ?').bind(gid),
        db.prepare('DELETE FROM groups WHERE id = ?').bind(gid),
      ])
      return answer(200, { ok: true, deleted: true })
    }
    await db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').bind(gid, targetId).run()
    return answer(200, { ok: true })
  }

  // 12. POST /api/friends/cards/share — share 1 card OR a whole folder of cards to friends/group
  if (path === '/api/friends/cards/share') {
    if (method !== 'POST') return new Response(null, { status: 405, headers: { ...HEADERS, allow: 'POST' } })
    const allowed = await checkRateLimit(db, meId, 'share', RATE_SHARES_PER_DAY, 24 * 60 * 60 * 1000, nowMs)
    if (!allowed) return refuse(429, 'rate_limited')

    const body = await readJsonBody(request)
    if (!body) return refuse(400, 'bad_request')
    const groupId = typeof body.groupId === 'string' && body.groupId.length > 0 ? body.groupId : null
    const toUserIds = Array.isArray(body.toUserIds) ? body.toUserIds.filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n !== meId) : []
    const folderName = typeof body.folderName === 'string' && body.folderName.trim() !== '' ? body.folderName.trim().slice(0, 80) : null
    const cardsIn = Array.isArray(body.cards) ? body.cards : []
    if ((!groupId && toUserIds.length === 0) || cardsIn.length === 0 || cardsIn.length > MAX_FOLDER_CARDS) return refuse(400, 'bad_request')

    // Validate membership / friendship
    if (groupId) {
      const mem = await db.prepare("SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ? AND status = 'active'").bind(groupId, meId).first()
      if (!mem) return refuse(403, 'not_member')
    }
    for (const uid of toUserIds) {
      const [a, b] = canonicalPair(meId, uid)
      const f = await db.prepare('SELECT 1 FROM friendships WHERE user_a = ? AND user_b = ?').bind(a, b).first()
      if (!f) return refuse(403, 'not_friends')
    }

    // Validate cards
    const cleanCards: { title: string; markdown: string; note: string | null; attachmentsJson: string | null }[] = []
    for (const raw of cardsIn) {
      if (!raw || typeof raw !== 'object') return refuse(400, 'bad_card')
      const c = raw as Record<string, unknown>
      const title = typeof c.title === 'string' ? c.title.trim().slice(0, 120) : ''
      const markdown = typeof c.markdown === 'string' ? c.markdown : ''
      if (!markdown.trim() || markdown.length > MAX_CARD_MD_BYTES) return refuse(400, 'bad_card')
      const note = typeof c.note === 'string' && c.note.trim() !== '' ? c.note.trim().slice(0, 200) : null
      let attachmentsJson: string | null = null
      if (Array.isArray(c.attachments) && c.attachments.length > 0) {
        const serialized = JSON.stringify(c.attachments)
        if (serialized.length > MAX_CARD_ATTACH_BYTES) return refuse(413, 'attachments_too_large')
        attachmentsJson = serialized
      }
      cleanCards.push({ title: title || 'Shared card', markdown, note, attachmentsJson })
    }

    const stmts = []
    const createdCardIds: string[] = []
    let createdFolderId: string | null = null

    if (groupId) {
      if (folderName) {
        createdFolderId = randomId()
        stmts.push(
          db
            .prepare('INSERT INTO shared_folders (id, group_id, to_user_id, sender_id, name, created_at) VALUES (?, ?, NULL, ?, ?, ?)')
            .bind(createdFolderId, groupId, meId, folderName, nowIso),
        )
      }
      for (const c of cleanCards) {
        const cid = randomId()
        createdCardIds.push(cid)
        stmts.push(
          db
            .prepare(
              'INSERT INTO shared_cards (id, group_id, to_user_id, folder_id, sender_id, title, markdown, note, attachments_json, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)',
            )
            .bind(cid, groupId, createdFolderId, meId, c.title, c.markdown, c.note, c.attachmentsJson, nowIso),
        )
        // Sender already has the card, so mark accepted for sender
        stmts.push(
          db
            .prepare("INSERT INTO shared_card_states (user_id, shared_card_id, status, updated_at) VALUES (?, ?, 'accepted', ?)")
            .bind(meId, cid, nowIso),
        )
      }
    }

    for (const uid of toUserIds) {
      let directFolderId: string | null = null
      if (folderName) {
        directFolderId = randomId()
        stmts.push(
          db
            .prepare('INSERT INTO shared_folders (id, group_id, to_user_id, sender_id, name, created_at) VALUES (?, NULL, ?, ?, ?, ?)')
            .bind(directFolderId, uid, meId, folderName, nowIso),
        )
      }
      for (const c of cleanCards) {
        const cid = randomId()
        createdCardIds.push(cid)
        stmts.push(
          db
            .prepare(
              'INSERT INTO shared_cards (id, group_id, to_user_id, folder_id, sender_id, title, markdown, note, attachments_json, created_at) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)',
            )
            .bind(cid, uid, directFolderId, meId, c.title, c.markdown, c.note, c.attachmentsJson, nowIso),
        )
      }
    }

    await db.batch(stmts)
    runInBackground(
      ctx,
      (async () => {
        const recipientIds = [...toUserIds]
        if (groupId) {
          const members = await db
            .prepare("SELECT user_id FROM group_members WHERE group_id = ? AND status = 'active' AND user_id != ?")
            .bind(groupId, meId)
            .all<{ user_id: number }>()
          for (const m of members.results) recipientIds.push(Number(m.user_id))
        }
        if (recipientIds.length === 0) return
        const meUser = await db
          .prepare('SELECT nickname, name, login FROM users WHERE github_id = ?')
          .bind(meId)
          .first<{ nickname: string | null; name: string | null; login: string | null }>()
        const meName = displayNameFor(meUser?.nickname, meUser?.name, String(meUser?.login ?? claims.login))
        await notifySharedCardsRecipients(
          env,
          db,
          recipientIds,
          meName,
          folderName,
          cleanCards.map((c) => c.title),
          fetch,
          nowMs,
        )
      })(),
    )
    return answer(200, { ok: true, folderId: createdFolderId, cardIds: createdCardIds, count: createdCardIds.length })
  }

  // 13. POST /api/friends/cards/:id/state — accept, dismiss, or undo-dismiss ('pending')
  const cardState = /^\/api\/friends\/cards\/([^/]+)\/state$/.exec(path)
  if (cardState) {
    if (method !== 'POST') return new Response(null, { status: 405, headers: { ...HEADERS, allow: 'POST' } })
    const cid = decodeURIComponent(cardState[1])
    const body = await readJsonBody(request)
    const status = body?.status
    if (status !== 'accepted' && status !== 'dismissed' && status !== 'pending') return refuse(400, 'bad_status')

    if (status === 'pending') {
      await db.prepare('DELETE FROM shared_card_states WHERE user_id = ? AND shared_card_id = ?').bind(meId, cid).run()
    } else {
      await db
        .prepare(
          `INSERT INTO shared_card_states (user_id, shared_card_id, status, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(user_id, shared_card_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`,
        )
        .bind(meId, cid, status, nowIso)
        .run()
    }
    return answer(200, { ok: true, status })
  }

  // 14. POST /api/friends/folders/:id/state — 1-shot accept/dismiss all cards in a shared folder
  const folderState = /^\/api\/friends\/folders\/([^/]+)\/state$/.exec(path)
  if (folderState) {
    if (method !== 'POST') return new Response(null, { status: 405, headers: { ...HEADERS, allow: 'POST' } })
    const fid = decodeURIComponent(folderState[1])
    const body = await readJsonBody(request)
    const status = body?.status
    if (status !== 'accepted' && status !== 'dismissed' && status !== 'pending') return refuse(400, 'bad_status')

    const cards = await db.prepare('SELECT id FROM shared_cards WHERE folder_id = ?').bind(fid).all<{ id: string }>()
    if (cards.results.length === 0) return refuse(404, 'folder_not_found')

    if (status === 'pending') {
      await db.batch(cards.results.map((c) => db.prepare('DELETE FROM shared_card_states WHERE user_id = ? AND shared_card_id = ?').bind(meId, c.id)))
    } else {
      await db.batch(
        cards.results.map((c) =>
          db
            .prepare(
              `INSERT INTO shared_card_states (user_id, shared_card_id, status, updated_at)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(user_id, shared_card_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`,
            )
            .bind(meId, c.id, status, nowIso),
        ),
      )
    }
    return answer(200, { ok: true, status, count: cards.results.length })
  }

  // 15. DELETE /api/friends/cards/:id — sender or group admin deletes shared card from library
  const cardDel = /^\/api\/friends\/cards\/([^/]+)$/.exec(path)
  if (cardDel) {
    if (method !== 'DELETE') return new Response(null, { status: 405, headers: { ...HEADERS, allow: 'DELETE' } })
    const cid = decodeURIComponent(cardDel[1])
    const card = await db.prepare('SELECT id, sender_id, group_id FROM shared_cards WHERE id = ?').bind(cid).first<{ id: string; sender_id: number; group_id: string | null }>()
    if (!card) return refuse(404, 'not_found')
    let allowed = card.sender_id === meId
    if (!allowed && card.group_id) {
      const grp = await db.prepare('SELECT admin_id FROM groups WHERE id = ?').bind(card.group_id).first<{ admin_id: number }>()
      allowed = grp?.admin_id === meId
    }
    if (!allowed) return refuse(403, 'forbidden')
    await db.batch([
      db.prepare('DELETE FROM shared_card_states WHERE shared_card_id = ?').bind(cid),
      db.prepare('DELETE FROM shared_cards WHERE id = ?').bind(cid),
    ])
    return answer(200, { ok: true })
  }

  // 16. GET / PUT /api/friends/decks/settings — manage shared deck browsing permissions & vaults
  if (path === '/api/friends/decks/settings') {
    if (method === 'GET') {
      const userRow = await db.prepare('SELECT deck_share_mode FROM users WHERE github_id = ?').bind(meId).first<{ deck_share_mode?: string }>()
      if (!userRow) return refuse(401, 'unauthorized')
      const modeRaw = userRow.deck_share_mode ?? 'none'
      const mode: DeckShareMode = modeRaw === 'all' || modeRaw === 'selected' ? modeRaw : 'none'
      const vaultRows = await db
        .prepare('SELECT repo_slug, installation_id, name FROM deck_vaults WHERE owner_id = ? ORDER BY name ASC')
        .bind(meId)
        .all<{ repo_slug: string; installation_id: number; name: string }>()
      const permRows = await db
        .prepare('SELECT friend_id FROM deck_permissions WHERE owner_id = ? AND allowed = 1 ORDER BY friend_id ASC')
        .bind(meId)
        .all<{ friend_id: number }>()
      return answer(200, {
        mode,
        vaults: vaultRows.results.map((v) => ({
          repo: String(v.repo_slug),
          installationId: Number(v.installation_id),
          name: String(v.name),
        })),
        allowedFriendIds: permRows.results.map((p) => Number(p.friend_id)),
      })
    }
    if (method === 'PUT') {
      const body = await readJsonBody(request)
      if (!body) return refuse(400, 'bad_request')
      const mode = body.mode
      if (mode !== 'none' && mode !== 'all' && mode !== 'selected') return refuse(400, 'bad_mode')

      const vaultsIn = Array.isArray(body.vaults) ? body.vaults : []
      const cleanVaultMap = new Map<string, { repo: string; installationId: number; name: string }>()
      for (const raw of vaultsIn) {
        if (!raw || typeof raw !== 'object') return refuse(400, 'bad_vault')
        const v = raw as Record<string, unknown>
        const repo = typeof v.repo === 'string' ? normalizeRepoSlug(v.repo) : null
        const installationId = typeof v.installationId === 'number' && Number.isInteger(v.installationId) && v.installationId > 0 ? v.installationId : null
        const name = typeof v.name === 'string' ? v.name.replace(/\s+/g, ' ').trim().slice(0, 80) : ''
        if (!repo || installationId === null) return refuse(400, 'bad_vault')
        const fallbackName = repo.split('/')[1] ?? repo
        cleanVaultMap.set(repo, { repo, installationId, name: name || fallbackName })
      }
      const cleanVaults = [...cleanVaultMap.values()].slice(0, 50)

      // YAZ-6290: Verify with GitHub that the signed-in user actually owns each installation + repo
      if (cleanVaults.length > 0) {
        const meRow = await db.prepare('SELECT login FROM users WHERE github_id = ?').bind(meId).first<{ login?: string }>()
        if (!meRow?.login) return refuse(401, 'unauthorized')
        for (const v of cleanVaults) {
          const verified = await verifyInstallationRepoOwnership(
            env,
            v.installationId,
            v.repo,
            meId,
            String(meRow.login),
            fetch,
            Math.floor(nowMs / 1000),
          )
          if (!verified.ok) return refuse(verified.status, verified.error)
        }
      }

      const allowedIdsIn = Array.isArray(body.allowedFriendIds) ? body.allowedFriendIds : []
      const cleanAllowedIds = [
        ...new Set(allowedIdsIn.filter((id): id is number => typeof id === 'number' && Number.isInteger(id) && id > 0 && id !== meId)),
      ].slice(0, 500)

      const stmts = [
        db.prepare('UPDATE users SET deck_share_mode = ?, updated_at = ? WHERE github_id = ?').bind(mode, nowIso, meId),
        db.prepare('DELETE FROM deck_vaults WHERE owner_id = ?').bind(meId),
        db.prepare('DELETE FROM deck_permissions WHERE owner_id = ?').bind(meId),
      ]
      for (const v of cleanVaults) {
        stmts.push(
          db
            .prepare('INSERT INTO deck_vaults (owner_id, repo_slug, installation_id, name, updated_at) VALUES (?, ?, ?, ?, ?)')
            .bind(meId, v.repo, v.installationId, v.name, nowIso),
        )
      }
      for (const fid of cleanAllowedIds) {
        stmts.push(
          db
            .prepare('INSERT INTO deck_permissions (owner_id, friend_id, allowed, updated_at) VALUES (?, ?, 1, ?)')
            .bind(meId, fid, nowIso),
        )
      }
      await db.batch(stmts)
      return answer(200, { ok: true, mode, vaults: cleanVaults, allowedFriendIds: cleanAllowedIds })
    }
    return new Response(null, { status: 405, headers: { ...HEADERS, allow: 'GET, PUT' } })
  }

  // 17. GET /api/friends/decks/:ownerId/(tree|file|asset) — read-only shared deck proxy
  const deckRoute = /^\/api\/friends\/decks\/(\d+)\/(tree|file|asset)$/.exec(path)
  if (deckRoute) {
    if (method !== 'GET') return new Response(null, { status: 405, headers: { ...HEADERS, allow: 'GET' } })
    const ownerId = Number(deckRoute[1])
    const kind = deckRoute[2]
    const rawRepo = url.searchParams.get('repo') ?? ''
    const repoSlug = normalizeRepoSlug(rawRepo)
    if (!repoSlug) return refuse(400, 'bad_repo')

    // Verify friendship + deck sharing permission (owner can also preview own shared vault if configured)
    if (ownerId !== meId) {
      const [a, b] = canonicalPair(meId, ownerId)
      const friendship = await db.prepare('SELECT 1 FROM friendships WHERE user_a = ? AND user_b = ?').bind(a, b).first()
      if (!friendship) return refuse(403, 'forbidden')
      const ownerRow = await db.prepare('SELECT deck_share_mode FROM users WHERE github_id = ?').bind(ownerId).first<{ deck_share_mode?: string }>()
      const mode = ownerRow?.deck_share_mode ?? 'none'
      if (mode === 'none') return refuse(403, 'forbidden')
      if (mode === 'selected') {
        const perm = await db
          .prepare('SELECT allowed FROM deck_permissions WHERE owner_id = ? AND friend_id = ? AND allowed = 1')
          .bind(ownerId, meId)
          .first()
        if (!perm) return refuse(403, 'forbidden')
      } else if (mode !== 'all') {
        return refuse(403, 'forbidden')
      }
    }

    const vaultRow = await db
      .prepare('SELECT repo_slug, installation_id, name FROM deck_vaults WHERE owner_id = ? AND repo_slug = ?')
      .bind(ownerId, repoSlug)
      .first<{ repo_slug: string; installation_id: number; name: string }>()
    if (!vaultRow) return refuse(403, 'forbidden')

    const [repoOwner, repoName] = String(vaultRow.repo_slug).split('/')
    const installationId = Number(vaultRow.installation_id)
    const vaultName = String(vaultRow.name)

    if (kind === 'tree') {
      const minted = await mintReadOnlyRepoToken(env, installationId, repoName, fetch, Math.floor(nowMs / 1000))
      if (!minted.ok) return refuse(minted.status, minted.error)

      const ghHeaders: Record<string, string> = {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${minted.token}`,
        'user-agent': 'yaseen-docs-worker',
        'x-github-api-version': '2022-11-28',
      }
      const inm = request.headers.get('if-none-match')
      if (inm) ghHeaders['if-none-match'] = inm

      let gh: Response
      try {
        gh = await fetch(
          `https://api.github.com/repos/${encodeURIComponent(repoOwner)}/${encodeURIComponent(repoName)}/git/trees/HEAD?recursive=1`,
          { method: 'GET', headers: ghHeaders },
        )
      } catch {
        return refuse(502, 'github_unreachable')
      }
      const ghEtag = gh.headers.get('etag')
      if (gh.status === 304) {
        return new Response(null, { status: 304, headers: { ...HEADERS, ...(ghEtag ? { etag: ghEtag } : {}) } })
      }
      if (gh.status === 404) return refuse(404, 'not_found')
      if (!gh.ok) return refuse(502, 'github_error')

      let data: { tree?: unknown }
      try {
        data = (await gh.json()) as { tree?: unknown }
      } catch {
        return refuse(502, 'github_error')
      }
      const rawTree = Array.isArray(data?.tree) ? data.tree : []
      const files: { path: string; title: string; kind: 'md' | 'asset' }[] = []
      for (const entry of rawTree) {
        if (!entry || typeof entry !== 'object') continue
        const item = entry as { path?: unknown; type?: unknown }
        if (item.type !== 'blob' || typeof item.path !== 'string') continue
        const safePath = isSafeDeckPath(item.path)
        if (!safePath) continue
        const isMd = safePath.toLowerCase().endsWith('.md')
        files.push({
          path: safePath,
          title: basenameOf(safePath, isMd),
          kind: isMd ? 'md' : 'asset',
        })
      }
      return answer(200, { repo: String(vaultRow.repo_slug), name: vaultName, files }, ghEtag ? { etag: ghEtag } : {})
    }

    const safePath = isSafeDeckPath(url.searchParams.get('path') ?? '')
    if (!safePath) return refuse(400, 'bad_path')

    const minted = await mintReadOnlyRepoToken(env, installationId, repoName, fetch, Math.floor(nowMs / 1000))
    if (!minted.ok) return refuse(minted.status, minted.error)

    let gh: Response
    try {
      gh = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(repoOwner)}/${encodeURIComponent(repoName)}/contents/${encodeGithubPath(safePath)}`,
        {
          method: 'GET',
          headers: {
            accept: 'application/vnd.github.raw+json',
            authorization: `Bearer ${minted.token}`,
            'user-agent': 'yaseen-docs-worker',
            'x-github-api-version': '2022-11-28',
          },
        },
      )
    } catch {
      return refuse(502, 'github_unreachable')
    }
    if (gh.status === 404) return refuse(404, 'not_found')
    if (!gh.ok) return refuse(502, 'github_error')

    if (kind === 'file') {
      const raw = await gh.text()
      const title = titleFromDeckMarkdown(raw, safePath)
      const markdown = sanitizeSharedMarkdown(raw)
      const assetPaths = extractRelativeAssetPaths(markdown, safePath)
      return answer(200, { path: safePath, title, markdown, assetPaths })
    }

    // kind === 'asset'
    const bytes = await gh.arrayBuffer()
    return new Response(bytes, {
      status: 200,
      headers: {
        'content-type': safeAssetContentType(safePath),
        'cache-control': 'private, max-age=300',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
        'content-security-policy': "default-src 'none'; sandbox",
      },
    })
  }

  // 17b. Web Push routes: config, subscribe, unsubscribe, prefs, test
  if (path === '/api/friends/push/config') {
    if (method !== 'GET') return new Response(null, { status: 405, headers: { ...HEADERS, allow: 'GET' } })
    const vapidPublicKey = env.VAPID_PUBLIC_KEY?.trim() || null
    return answer(200, { vapidPublicKey })
  }

  if (path === '/api/friends/push/subscribe') {
    if (method !== 'POST') return new Response(null, { status: 405, headers: { ...HEADERS, allow: 'POST' } })
    const body = await readJsonBody(request)
    if (!body) return refuse(400, 'bad_request')
    const endpoint = typeof body.endpoint === 'string' ? body.endpoint.trim() : ''
    const keys = body.keys && typeof body.keys === 'object' && !Array.isArray(body.keys) ? (body.keys as Record<string, unknown>) : null
    const p256dh = typeof keys?.p256dh === 'string' ? keys.p256dh.trim() : ''
    const auth = typeof keys?.auth === 'string' ? keys.auth.trim() : ''
    if (!isValidPushEndpoint(endpoint)) return refuse(400, 'bad_endpoint')
    if (!isValidPushKeys({ p256dh, auth })) return refuse(400, 'bad_keys')

    const ua = request.headers.get('user-agent')?.slice(0, 256) ?? null
    await db
      .prepare(
        `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET
           user_id = excluded.user_id,
           p256dh = excluded.p256dh,
           auth = excluded.auth,
           user_agent = excluded.user_agent,
           updated_at = excluded.updated_at`,
      )
      .bind(randomId(), meId, endpoint, p256dh, auth, ua, nowIso, nowIso)
      .run()
    return answer(200, { ok: true })
  }

  if (path === '/api/friends/push/unsubscribe') {
    if (method !== 'POST') return new Response(null, { status: 405, headers: { ...HEADERS, allow: 'POST' } })
    const body = await readJsonBody(request)
    const endpoint = typeof body?.endpoint === 'string' ? body.endpoint.trim() : ''
    if (!endpoint || endpoint.length > 2048) return refuse(400, 'bad_endpoint')
    await db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').bind(meId, endpoint).run()
    return answer(200, { ok: true })
  }

  if (path === '/api/friends/push/prefs') {
    if (method === 'GET') {
      const prefRow = await db
        .prepare('SELECT daily_reminder, reminder_hour, friend_finished_mode, friend_finished_ids_json, buddy_streak, shared_cards FROM notification_prefs WHERE user_id = ?')
        .bind(meId)
        .first<Record<string, unknown>>()
      const subCountRow = await db
        .prepare('SELECT COUNT(*) AS cnt FROM push_subscriptions WHERE user_id = ?')
        .bind(meId)
        .first<{ cnt: number }>()
      return answer(200, {
        prefs: parseNotificationPrefsRow(prefRow),
        subscribedCount: Number(subCountRow?.cnt ?? 0),
      })
    }
    if (method === 'PUT') {
      const body = await readJsonBody(request)
      if (!body) return refuse(400, 'bad_request')
      const curRow = await db
        .prepare('SELECT daily_reminder, reminder_hour, friend_finished_mode, friend_finished_ids_json, buddy_streak, shared_cards FROM notification_prefs WHERE user_id = ?')
        .bind(meId)
        .first<Record<string, unknown>>()
      const cur = parseNotificationPrefsRow(curRow)

      let dailyReminder = cur.dailyReminder
      if (body.dailyReminder !== undefined) {
        if (typeof body.dailyReminder !== 'boolean') return refuse(400, 'bad_request')
        dailyReminder = body.dailyReminder
      }

      let reminderHour = cur.reminderHour
      if (body.reminderHour !== undefined) {
        if (typeof body.reminderHour !== 'number' || !Number.isInteger(body.reminderHour) || body.reminderHour < 0 || body.reminderHour > 23) {
          return refuse(400, 'bad_reminder_hour')
        }
        reminderHour = body.reminderHour
      }

      let friendFinishedMode: FriendFinishedMode = cur.friendFinishedMode
      if (body.friendFinishedMode !== undefined) {
        if (body.friendFinishedMode !== 'off' && body.friendFinishedMode !== 'all' && body.friendFinishedMode !== 'selected') {
          return refuse(400, 'bad_mode')
        }
        friendFinishedMode = body.friendFinishedMode
      }

      let friendFinishedIds = cur.friendFinishedIds
      if (body.friendFinishedIds !== undefined) {
        if (!Array.isArray(body.friendFinishedIds)) return refuse(400, 'bad_request')
        friendFinishedIds = [
          ...new Set(body.friendFinishedIds.filter((id): id is number => typeof id === 'number' && Number.isInteger(id) && id > 0 && id !== meId)),
        ].slice(0, 500)
      }

      let buddyStreak = cur.buddyStreak
      if (body.buddyStreak !== undefined) {
        if (typeof body.buddyStreak !== 'boolean') return refuse(400, 'bad_request')
        buddyStreak = body.buddyStreak
      }

      let sharedCards = cur.sharedCards
      if (body.sharedCards !== undefined) {
        if (typeof body.sharedCards !== 'boolean') return refuse(400, 'bad_request')
        sharedCards = body.sharedCards
      }

      await db
        .prepare(
          `INSERT INTO notification_prefs (user_id, daily_reminder, reminder_hour, friend_finished_mode, friend_finished_ids_json, buddy_streak, shared_cards, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET
             daily_reminder = excluded.daily_reminder,
             reminder_hour = excluded.reminder_hour,
             friend_finished_mode = excluded.friend_finished_mode,
             friend_finished_ids_json = excluded.friend_finished_ids_json,
             buddy_streak = excluded.buddy_streak,
             shared_cards = excluded.shared_cards,
             updated_at = excluded.updated_at`,
        )
        .bind(
          meId,
          dailyReminder ? 1 : 0,
          reminderHour,
          friendFinishedMode,
          JSON.stringify(friendFinishedIds),
          buddyStreak ? 1 : 0,
          sharedCards ? 1 : 0,
          nowIso,
        )
        .run()

      const prefs = { dailyReminder, reminderHour, friendFinishedMode, friendFinishedIds, buddyStreak, sharedCards }
      return answer(200, { ok: true, prefs })
    }
    return new Response(null, { status: 405, headers: { ...HEADERS, allow: 'GET, PUT' } })
  }

  if (path === '/api/friends/push/test') {
    if (method !== 'POST') return new Response(null, { status: 405, headers: { ...HEADERS, allow: 'POST' } })
    const body = await readJsonBody(request)
    let onlyEndpoint: string | undefined
    if (body && body.endpoint !== undefined) {
      if (typeof body.endpoint !== 'string') return refuse(400, 'bad_endpoint')
      const trimmed = body.endpoint.trim()
      if (!trimmed || trimmed.length > 2048) return refuse(400, 'bad_endpoint')
      onlyEndpoint = trimmed
    }
    const res = await notifyUser(
      env,
      db,
      meId,
      { title: 'Yaseen Docs', body: 'Push notifications are working!', url: '/friends', tag: 'push-test' },
      fetch,
      nowMs,
      onlyEndpoint,
    )
    return answer(200, {
      ok: true,
      sent: res.sent,
      failed: res.failed,
      ...(res.failedStatuses.length > 0 ? { failedStatuses: res.failedStatuses } : {}),
    })
  }

  // 18. DELETE /api/friends/me — Delete my Friends data cleanly (Item 10)
  if (path === '/api/friends/me') {
    if (method !== 'DELETE') return new Response(null, { status: 405, headers: { ...HEADERS, allow: 'DELETE' } })
    await db.batch([
      db.prepare('DELETE FROM push_deliveries WHERE user_id = ?').bind(meId),
      db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').bind(meId),
      db.prepare('DELETE FROM notification_prefs WHERE user_id = ?').bind(meId),
      db.prepare('DELETE FROM friendships WHERE user_a = ? OR user_b = ?').bind(meId, meId),
      db.prepare('DELETE FROM deck_permissions WHERE owner_id = ? OR friend_id = ?').bind(meId, meId),
      db.prepare('DELETE FROM deck_vaults WHERE owner_id = ?').bind(meId),
      db.prepare('DELETE FROM invites WHERE creator_id = ? OR group_id IN (SELECT id FROM groups WHERE admin_id = ?)').bind(meId, meId),
      db.prepare('DELETE FROM shared_card_states WHERE user_id = ? OR shared_card_id IN (SELECT id FROM shared_cards WHERE group_id IN (SELECT id FROM groups WHERE admin_id = ?))').bind(meId, meId),
      db.prepare('DELETE FROM shared_cards WHERE sender_id = ? OR to_user_id = ? OR group_id IN (SELECT id FROM groups WHERE admin_id = ?)').bind(meId, meId, meId),
      db.prepare('DELETE FROM shared_folders WHERE sender_id = ? OR to_user_id = ? OR group_id IN (SELECT id FROM groups WHERE admin_id = ?)').bind(meId, meId, meId),
      db.prepare('DELETE FROM group_members WHERE user_id = ? OR group_id IN (SELECT id FROM groups WHERE admin_id = ?)').bind(meId, meId),
      db.prepare('DELETE FROM groups WHERE admin_id = ?').bind(meId),
      db.prepare('DELETE FROM blocks WHERE blocker_id = ? OR blocked_id = ?').bind(meId, meId),
      db.prepare('DELETE FROM rate_events WHERE user_id = ?').bind(meId),
      db.prepare('DELETE FROM daily_activity WHERE user_id = ?').bind(meId),
      db.prepare('DELETE FROM activity_events WHERE user_id = ?').bind(meId),
      db.prepare('DELETE FROM user_avatars WHERE github_id = ?').bind(meId),
      db.prepare('DELETE FROM users WHERE github_id = ?').bind(meId),
    ])
    return answer(200, { ok: true, deleted: true })
  }

  return refuse(404, 'not_found')
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
