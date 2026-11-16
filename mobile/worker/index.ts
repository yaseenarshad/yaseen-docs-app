import { CALLBACK_ORIGINS, CALLBACK_PATH, GITHUB_APP_CLIENT_ID, WORKER_REFRESH, WORKER_REVOKE, WORKER_TOKEN } from '../src/auth/githubAppConfig'

/**
 * THE WORKER OF docs.yaseenarshad.com (YAZ-5645, slice 1; decision D3): the app's static files, as before, plus three
 * POST routes for "Sign in with GitHub". GitHub's token address does not answer a browser (no CORS) and needs the
 * client secret for the first token and for each refresh, so these few lines do only this: add the secret, ask
 * GitHub, hand the answer back, keep nothing.
 * - `POST /api/github/token` `{ code, codeVerifier, redirectUri }`: the code from the callback (PKCE) for a token pair.
 * - `POST /api/github/refresh` `{ refreshToken }`: a new pair (GitHub uses each refresh token once).
 * - `POST /api/github/revoke` `{ accessToken }`: Sign out also ends the token on GitHub (decision D7).
 * Rules: POST only; this site only (`Origin` must be the address's own origin); the redirect address must be this
 * site's `/auth/callback`; every answer is `no-store`; no body is logged; nothing is stored. The answer is rebuilt from
 * the fields the app needs, so the secret can never be in it. `wrangler.jsonc` runs this script first only for
 * `/api/github/*` (`run_worker_first`); every other path is the static files.
 */

export interface Env {
  /** A Worker secret (`wrangler secret put GITHUB_CLIENT_SECRET`), or `.dev.vars` on a computer. Never in git. */
  GITHUB_CLIENT_SECRET?: string
  /** The static files (`assets.binding`). */
  ASSETS?: { fetch(request: Request): Promise<Response> }
}

/** GitHub's addresses. Tests pass a fake `fetch`. */
export const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token'
export const githubRevokeUrl = (clientId: string) => `https://api.github.com/applications/${clientId}/token`

type Fetch = (url: string, init: RequestInit) => Promise<Response>

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
}
const answer = (status: number, body: unknown) => new Response(body === null ? null : JSON.stringify(body), { status, headers: HEADERS })
/** `error`: one word the app reads (`auth/githubApp.ts`). Never GitHub's text, never a request's value. */
const refuse = (status: number, error: string) => answer(status, { error })

export async function handle(request: Request, env: Env, fetch: Fetch = (url, init) => globalThis.fetch(url, init)): Promise<Response> {
  const url = new URL(request.url)
  if (!url.pathname.startsWith('/api/github/')) return env.ASSETS ? env.ASSETS.fetch(request) : refuse(404, 'not_found')
  const route = url.pathname === WORKER_TOKEN ? 'token' : url.pathname === WORKER_REFRESH ? 'refresh' : url.pathname === WORKER_REVOKE ? 'revoke' : null
  if (route === null) return refuse(404, 'not_found')
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { ...HEADERS, allow: 'POST' } })
  // Only the app on this site: a browser always sends `Origin` on a POST; another site's page cannot fake it.
  if (request.headers.get('origin') !== url.origin) return refuse(403, 'wrong_origin')
  const secret = env.GITHUB_CLIENT_SECRET
  if (secret === undefined || secret === '') return refuse(503, 'not_set_up')

  let body: Record<string, unknown>
  try {
    const parsed: unknown = await request.json()
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return refuse(400, 'bad_request')
    body = parsed as Record<string, unknown>
  } catch {
    return refuse(400, 'bad_request')
  }
  const text = (name: string) => (typeof body[name] === 'string' && (body[name] as string).length > 0 && (body[name] as string).length <= 512 ? (body[name] as string) : null)

  if (route === 'revoke') {
    const accessToken = text('accessToken')
    if (accessToken === null) return refuse(400, 'bad_request')
    let gh: Response
    try {
      gh = await fetch(githubRevokeUrl(GITHUB_APP_CLIENT_ID), {
        method: 'DELETE',
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Basic ${btoa(`${GITHUB_APP_CLIENT_ID}:${secret}`)}`,
          'content-type': 'application/json',
          'user-agent': 'yaseen-docs-worker',
          'x-github-api-version': '2022-11-28',
        },
        body: JSON.stringify({ access_token: accessToken }),
      })
    } catch {
      return refuse(502, 'github_unreachable')
    }
    // 204: ended. 404: it was already gone (GitHub's answer for an unknown token). Both mean "signed out".
    return gh.status === 204 || gh.status === 404 ? answer(200, { revoked: true }) : refuse(502, 'github_refused')
  }

  const form = new URLSearchParams({ client_id: GITHUB_APP_CLIENT_ID, client_secret: secret })
  if (route === 'token') {
    const code = text('code')
    const codeVerifier = text('codeVerifier')
    const redirectUri = text('redirectUri')
    if (code === null || codeVerifier === null || redirectUri === null) return refuse(400, 'bad_request')
    // Only this site's callback, and only a site GitHub knows (decision D8).
    if (redirectUri !== `${url.origin}${CALLBACK_PATH}` || !(CALLBACK_ORIGINS as readonly string[]).includes(url.origin)) return refuse(400, 'bad_redirect')
    form.set('code', code)
    form.set('code_verifier', codeVerifier)
    form.set('redirect_uri', redirectUri)
  } else {
    const refreshToken = text('refreshToken')
    if (refreshToken === null) return refuse(400, 'bad_request')
    form.set('grant_type', 'refresh_token')
    form.set('refresh_token', refreshToken)
  }

  let gh: Response
  try {
    gh = await fetch(GITHUB_TOKEN_URL, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'yaseen-docs-worker' },
      body: form.toString(),
    })
  } catch {
    return refuse(502, 'github_unreachable')
  }
  let got: Record<string, unknown>
  try {
    got = (await gh.json()) as Record<string, unknown>
  } catch {
    return refuse(502, 'github_refused')
  }
  if (got === null || typeof got !== 'object') return refuse(502, 'github_refused')
  // GitHub answers 200 with `error` for a code that is wrong, used or older than 10 minutes, and for a dead refresh token.
  if (typeof got.error === 'string') return refuse(400, /^[a-z_]{1,64}$/.test(got.error) ? got.error : 'github_refused')
  const str = (v: unknown) => (typeof v === 'string' ? v : null)
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null)
  const pair = {
    accessToken: str(got.access_token),
    expiresIn: num(got.expires_in),
    refreshToken: str(got.refresh_token),
    refreshExpiresIn: num(got.refresh_token_expires_in),
  }
  if (pair.accessToken === null || !gh.ok) return refuse(502, 'github_refused')
  return answer(200, pair)
}

export default {
  fetch: (request: Request, env: Env) => handle(request, env),
}
