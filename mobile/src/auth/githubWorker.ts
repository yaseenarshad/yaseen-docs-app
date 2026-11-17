import type { FetchLike } from '../github/client'
import type { GithubPair, Renewed } from '../store/tokenStore'
import { WORKER_REFRESH, WORKER_REVOKE, WORKER_TOKEN } from './githubAppConfig'

/**
 * The app's calls to its own Worker (YAZ-5645, `mobile/worker/index.ts`): this site only (`connect-src 'self'`), POST,
 * no cookies, no cache. The tokens go in the body only, never in an address or a log.
 */

export type WorkerAnswer = { ok: true; pair: Omit<GithubPair, 'login'> } | { ok: false; error: string }

async function call(path: string, body: Record<string, string>, fetch: FetchLike | undefined, now: () => number, origin?: string): Promise<WorkerAnswer> {
  const send = fetch ?? ((url: string, init: RequestInit) => globalThis.fetch(url, init))
  let res: Response
  try {
    res = await send(new URL(path, origin ?? location.origin).href, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    })
  } catch {
    return { ok: false, error: 'offline' }
  }
  let got: Record<string, unknown> = {}
  try {
    got = (await res.json()) as Record<string, unknown>
  } catch {
    // An answer that is not JSON (a proxy's page): "GitHub refused".
  }
  if (!res.ok || typeof got.accessToken !== 'string') return { ok: false, error: typeof got.error === 'string' ? got.error : res.status >= 500 ? 'github_unreachable' : 'github_refused' }
  const at = now()
  const ends = (s: unknown) => (typeof s === 'number' && s > 0 ? at + s * 1000 : null)
  return {
    ok: true,
    pair: { access: got.accessToken, accessEndsAt: ends(got.expiresIn), refresh: typeof got.refreshToken === 'string' ? got.refreshToken : null, refreshEndsAt: ends(got.refreshExpiresIn) },
  }
}

/** The code from GitHub's callback (with its PKCE verifier) for a token pair. */
export const exchangeCode = (code: string, codeVerifier: string, redirectUri: string, fetch?: FetchLike, now: () => number = Date.now) =>
  call(WORKER_TOKEN, { code, codeVerifier, redirectUri }, fetch, now, new URL(redirectUri).origin)

/**
 * GitHub's word for a refresh token that no longer works (revoked, unused 6 months, or already used): the account must
 * sign in again. Any other refusal (the Worker not set up, GitHub down) keeps the pair and tries again later.
 */
const DEAD = new Set(['bad_refresh_token'])

/** The token store's refresh (`tokenStoreOn(…, { renew })`). */
export function renewAtWorker(fetch?: FetchLike, now: () => number = Date.now, origin?: string): (refreshToken: string) => Promise<Renewed> {
  return async (refreshToken) => {
    const got = await call(WORKER_REFRESH, { refreshToken }, fetch, now, origin)
    if (got.ok) return got
    return { ok: false, reason: DEAD.has(got.error) ? 'ended' : 'offline' }
  }
}

/** Sign out ends the token on GitHub too (decision D7). False: it could not (offline); the phone forgets it anyway. */
export async function revokeAtWorker(accessToken: string, fetch?: FetchLike, origin?: string): Promise<boolean> {
  const send = fetch ?? ((url: string, init: RequestInit) => globalThis.fetch(url, init))
  try {
    const res = await send(new URL(WORKER_REVOKE, origin ?? location.origin).href, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessToken }),
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    })
    return res.ok
  } catch {
    return false
  }
}
