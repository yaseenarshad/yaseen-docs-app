/**
 * Friends session auth (YAZ-6200 D2): reuses the user's GitHub App access token once via
 * `POST /api/friends/session`, verifies `GET https://api.github.com/user`, lazily upserts
 * the user's row in D1 keyed by immutable `github_id`, and mints an 8-hour HMAC-SHA256
 * `friendsToken`. Subsequent `/api/friends/*` requests verify the HMAC locally in <1 ms
 * with zero GitHub API calls and zero separate password/account management.
 */
import type { D1Database } from './d1Types'

export const GITHUB_USER_URL = 'https://api.github.com/user'
export const FRIENDS_TOKEN_TTL_S = 8 * 60 * 60

export interface FriendsSessionClaims {
  v: 1
  sub: number // immutable GitHub numeric user id
  login: string
  exp: number // unix seconds
}

export interface GithubProfile {
  id: number
  login: string
  name: string | null
  avatarUrl: string | null
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>

const enc = new TextEncoder()
const dec = new TextDecoder()

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(str: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(str)) return null
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4))
  try {
    const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function signFriendsToken(claims: FriendsSessionClaims, secret: string): Promise<string> {
  const payload = toBase64Url(enc.encode(JSON.stringify(claims)))
  const key = await importHmacKey(secret)
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`v1.${payload}`)))
  return `v1.${payload}.${toBase64Url(sig)}`
}

export async function verifyFriendsToken(token: string, secret: string, nowSec: number = Math.floor(Date.now() / 1000)): Promise<FriendsSessionClaims | null> {
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== 'v1') return null
  const sig = fromBase64Url(parts[2])
  const payloadBytes = fromBase64Url(parts[1])
  if (sig === null || payloadBytes === null) return null
  const key = await importHmacKey(secret)
  const ok = await crypto.subtle.verify('HMAC', key, sig as BufferSource, enc.encode(`v1.${parts[1]}`))
  if (!ok) return null
  try {
    const parsed = JSON.parse(dec.decode(payloadBytes)) as Partial<FriendsSessionClaims>
    if (parsed.v !== 1 || typeof parsed.sub !== 'number' || !Number.isInteger(parsed.sub) || parsed.sub <= 0) return null
    if (typeof parsed.login !== 'string' || parsed.login.length === 0) return null
    if (typeof parsed.exp !== 'number' || parsed.exp <= nowSec) return null
    return { v: 1, sub: parsed.sub, login: parsed.login, exp: parsed.exp }
  } catch {
    return null
  }
}

export async function fetchGithubProfile(githubToken: string, fetch: Fetch): Promise<{ ok: true; profile: GithubProfile } | { ok: false; status: number; error: string }> {
  let res: Response
  try {
    res = await fetch(GITHUB_USER_URL, {
      method: 'GET',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${githubToken}`,
        'user-agent': 'yaseen-docs-worker',
        'x-github-api-version': '2022-11-28',
      },
    })
  } catch {
    return { ok: false, status: 502, error: 'github_unreachable' }
  }
  if (res.status === 401 || res.status === 403) return { ok: false, status: 401, error: 'unauthorized' }
  if (!res.ok) return { ok: false, status: 502, error: 'github_refused' }
  try {
    const data = (await res.json()) as Record<string, unknown>
    if (typeof data.id !== 'number' || !Number.isInteger(data.id) || data.id <= 0 || typeof data.login !== 'string' || data.login.length === 0) {
      return { ok: false, status: 502, error: 'github_refused' }
    }
    return {
      ok: true,
      profile: {
        id: data.id,
        login: data.login.slice(0, 80),
        name: typeof data.name === 'string' && data.name.trim() !== '' ? data.name.trim().slice(0, 100) : null,
        avatarUrl: typeof data.avatar_url === 'string' && data.avatar_url.startsWith('https://') ? data.avatar_url.slice(0, 300) : null,
      },
    }
  } catch {
    return { ok: false, status: 502, error: 'github_refused' }
  }
}

export async function upsertUserProfile(db: D1Database, profile: GithubProfile, nowIso: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO users (github_id, login, name, avatar_url, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(github_id) DO UPDATE SET
         login = excluded.login,
         name = excluded.name,
         avatar_url = excluded.avatar_url,
         updated_at = excluded.updated_at`,
    )
    .bind(profile.id, profile.login, profile.name, profile.avatarUrl, nowIso)
    .run()
}
