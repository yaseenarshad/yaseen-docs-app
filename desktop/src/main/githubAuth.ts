import { createHash, randomBytes } from 'node:crypto'
import { GITHUB_TOKEN_SECRET, type GithubAuthStatus, type GithubInstalledRepo } from '@shared/types'
import type { Secrets } from './secrets'

/**
 * Mac GitHub App sign-in (YAZ-6190, D1 + Extra #5/#6): reuses the `yaseen-docs` GitHub App and
 * `docs.yaseenarshad.com` Cloudflare Worker. Tokens live only in `secrets.json` (mode 0600,
 * main-only key `githubAppAuth`) and never cross IPC to any renderer.
 *
 * Flow:
 * 1. `startSignIn()` creates a 10-minute one-use PKCE S256 verifier + `state = mac.<random>`,
 *    and opens `github.com/login/oauth/authorize` in the system browser.
 * 2. GitHub redirects to `https://docs.yaseenarshad.com/auth/callback?code&state=mac.*`.
 * 3. The Worker bounces `mac.*` state to `yaseendocs://auth/callback?code&state=mac.*`.
 * 4. `handleCallback()` validates state, exchanges code+verifier at `/api/github/token`, fetches
 *    `/user` for `login` + `id`, saves to `secrets.json`, and notifies renderers.
 * 5. `getValidAuth()` refreshes expiring tokens through one shared in-flight promise (Extra #6),
 *    so concurrent vaults never race on GitHub's single-use refresh token.
 */

export const GITHUB_APP_CLIENT_ID = 'Iv23liJoJKth4kXFlH6a'
export const GITHUB_APP_SLUG = 'yaseen-docs'
export const WORKER_ORIGIN = 'https://docs.yaseenarshad.com'
export const WORKER_CALLBACK_URI = `${WORKER_ORIGIN}/auth/callback`
export const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize'
export const GITHUB_CHOOSE_REPOS_URL = `https://github.com/apps/${GITHUB_APP_SLUG}/installations/new`
export const GITHUB_API_URL = 'https://api.github.com'

/** Main-only key in `secrets.json`. Not in `RENDERER_WRITABLE_SECRETS`. */
export const GITHUB_APP_AUTH_SECRET = 'githubAppAuth'

const PENDING_TTL_MS = 10 * 60_000
const REFRESH_MARGIN_MS = 5 * 60_000
const REPO_LIST_CAP = 200
const DEAD_REFRESH_ERRORS = new Set(['bad_refresh_token'])

interface StoredAppAuth {
  login: string
  userId: number | null
  accessToken: string
  accessEndsAt: number | null
  refreshToken: string | null
  refreshEndsAt: number | null
}

interface PendingSignIn {
  state: string
  verifier: string
  startedAt: number
}

export interface ValidGithubAuth {
  token: string
  login: string
  /** `<id>+<login>@users.noreply.github.com` (or `<login>@users.noreply.github.com` if id absent). */
  email: string
}

export interface GithubAuthDeps {
  secrets: Pick<Secrets, 'read' | 'set' | 'has'>
  openExternal: (url: string) => Promise<void> | void
  onChange?: (status: GithubAuthStatus) => void
  fetch?: typeof globalThis.fetch
  now?: () => number
  random?: (size: number) => Buffer
}

export interface GithubAuthManager {
  status(): Promise<GithubAuthStatus>
  startSignIn(): Promise<GithubAuthStatus>
  handleCallback(rawUrl: string): Promise<GithubAuthStatus>
  signOut(): Promise<GithubAuthStatus>
  manageRepos(): Promise<void>
  /** Returns a fresh access token + GitHub identity, auto-refreshing if needed. Null when signed out. */
  getValidAuth(): Promise<ValidGithubAuth | null>
  /** Lists repos installed on the `yaseen-docs` GitHub App for the signed-in account. */
  listInstalledRepos(): Promise<GithubInstalledRepo[]>
  /** Checks whether `repoFullName` (owner/repo) is granted to the `yaseen-docs` GitHub App (Extra #5). */
  isRepoAllowed(repoFullName: string): Promise<'allowed' | 'not-allowed' | 'unknown'>
}

const base64url = (buf: Buffer): string => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export function pkceChallenge(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest())
}

/** True when `rawUrl` is our desktop OAuth callback (`yaseendocs://auth/callback?...`). */
export function isGithubAuthCallback(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl)
    return parsed.protocol === 'yaseendocs:' && parsed.hostname === 'auth' && parsed.pathname === '/callback'
  } catch {
    return false
  }
}

function parseStored(raw: string | null): StoredAppAuth | null {
  if (raw === null) return null
  try {
    const v = JSON.parse(raw) as Partial<StoredAppAuth> | null
    if (v === null || typeof v !== 'object' || typeof v.login !== 'string' || v.login === '' || typeof v.accessToken !== 'string' || v.accessToken === '') return null
    return {
      login: v.login,
      userId: typeof v.userId === 'number' && Number.isFinite(v.userId) ? v.userId : null,
      accessToken: v.accessToken,
      accessEndsAt: typeof v.accessEndsAt === 'number' && Number.isFinite(v.accessEndsAt) ? v.accessEndsAt : null,
      refreshToken: typeof v.refreshToken === 'string' && v.refreshToken !== '' ? v.refreshToken : null,
      refreshEndsAt: typeof v.refreshEndsAt === 'number' && Number.isFinite(v.refreshEndsAt) ? v.refreshEndsAt : null,
    }
  } catch {
    return null
  }
}

function noreplyEmail(login: string, userId: number | null): string {
  return userId !== null ? `${userId}+${login}@users.noreply.github.com` : `${login}@users.noreply.github.com`
}

function callbackErrorMessage(code: string): string {
  switch (code) {
    case 'access_denied':
      return 'You did not allow Yaseen Docs on GitHub. Nothing changed.'
    case 'offline':
      return 'Yaseen Docs could not reach the sign-in server. Check your internet connection and try again.'
    case 'not_set_up':
      return 'The sign-in server is missing its GitHub app key. Use a token instead for now.'
    case 'github_unreachable':
      return 'GitHub could not be reached. Try again in a moment.'
    case 'bad_verification_code':
    case 'incorrect_verification_code':
    case 'invalid_grant':
      return 'GitHub refused the sign-in code. Try signing in again.'
    default:
      return 'GitHub sign-in did not finish. Try again.'
  }
}

export function createGithubAuth(deps: GithubAuthDeps): GithubAuthManager {
  const fetchFn = deps.fetch ?? globalThis.fetch
  const now = deps.now ?? Date.now
  const rand = deps.random ?? ((n: number) => randomBytes(n))

  let pending: PendingSignIn | null = null
  let lastError: string | undefined
  /** Extra #6: one shared refresh promise so concurrent vaults never race on a single-use refresh token. */
  let refreshInFlight: Promise<StoredAppAuth | null> | null = null

  async function readStored(): Promise<StoredAppAuth | null> {
    return parseStored(await deps.secrets.read(GITHUB_APP_AUTH_SECRET))
  }

  async function writeStored(auth: StoredAppAuth | null): Promise<void> {
    await deps.secrets.set(GITHUB_APP_AUTH_SECRET, auth === null ? null : JSON.stringify(auth))
  }

  async function buildStatus(): Promise<GithubAuthStatus> {
    const [stored, hasManualToken] = await Promise.all([readStored(), deps.secrets.has(GITHUB_TOKEN_SECRET)])
    const activePending = pending !== null && now() - pending.startedAt <= PENDING_TTL_MS
    return {
      signedIn: stored !== null,
      ...(stored !== null ? { login: stored.login } : {}),
      hasManualToken,
      ...(activePending ? { pending: true } : {}),
      ...(lastError !== undefined ? { error: lastError } : {}),
    }
  }

  async function emit(): Promise<GithubAuthStatus> {
    const current = await buildStatus()
    deps.onChange?.(current)
    return current
  }

  async function callWorker(path: string, body: Record<string, string>): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
    let res: Response
    try {
      res = await fetchFn(`${WORKER_ORIGIN}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: WORKER_ORIGIN,
        },
        body: JSON.stringify(body),
      })
    } catch {
      return { ok: false, error: 'offline' }
    }
    let data: Record<string, unknown> = {}
    try {
      data = (await res.json()) as Record<string, unknown>
    } catch {
      // non-JSON response
    }
    if (!res.ok) return { ok: false, error: typeof data.error === 'string' ? data.error : res.status >= 500 ? 'github_unreachable' : 'github_refused' }
    return { ok: true, data }
  }

  function pairFromWorker(data: Record<string, unknown>, at: number): Omit<StoredAppAuth, 'login' | 'userId'> | null {
    if (typeof data.accessToken !== 'string' || data.accessToken === '') return null
    const ends = (v: unknown) => (typeof v === 'number' && v > 0 ? at + v * 1000 : null)
    return {
      accessToken: data.accessToken,
      accessEndsAt: ends(data.expiresIn),
      refreshToken: typeof data.refreshToken === 'string' && data.refreshToken !== '' ? data.refreshToken : null,
      refreshEndsAt: ends(data.refreshExpiresIn),
    }
  }

  async function refreshLocked(current: StoredAppAuth): Promise<StoredAppAuth | null> {
    if (current.refreshToken === null) return null
    if (refreshInFlight !== null) return refreshInFlight
    refreshInFlight = (async () => {
      try {
        const res = await callWorker('/api/github/refresh', { refreshToken: current.refreshToken! })
        if (!res.ok) {
          if (DEAD_REFRESH_ERRORS.has(res.error)) {
            await writeStored(null)
            lastError = 'GitHub signed you out. Sign in again.'
            await emit()
            return null
          }
          return null
        }
        const pair = pairFromWorker(res.data, now())
        if (pair === null) return null
        const updated: StoredAppAuth = { login: current.login, userId: current.userId, ...pair }
        await writeStored(updated)
        return updated
      } finally {
        refreshInFlight = null
      }
    })()
    return refreshInFlight
  }

  async function githubGet(token: string, apiPath: string): Promise<{ ok: boolean; status: number; data: unknown; link: string | null }> {
    const res = await fetchFn(`${GITHUB_API_URL}${apiPath}`, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'user-agent': 'yaseen-docs-desktop',
        'x-github-api-version': '2022-11-28',
      },
    })
    let data: unknown = null
    try {
      data = await res.json()
    } catch {
      // ignore non-JSON
    }
    return { ok: res.ok, status: res.status, data, link: res.headers.get('link') }
  }

  async function fetchInstalledRepos(token: string): Promise<{ ok: true; repos: GithubInstalledRepo[]; capped: boolean } | { ok: false }> {
    const seen = new Map<string, GithubInstalledRepo>()
    let capped = false
    const nextOf = (link: string | null, expectedPath: string): number | null => {
      for (const part of (link ?? '').split(',')) {
        const m = /<([^>]+)>\s*;\s*rel="next"/.exec(part)
        if (m === null) continue
        try {
          const u = new URL(m[1])
          if (u.origin !== GITHUB_API_URL || u.pathname !== expectedPath) return null
          const p = Number(u.searchParams.get('page'))
          return Number.isInteger(p) && p > 1 ? p : null
        } catch {
          return null
        }
      }
      return null
    }
    const walk = async (apiPath: string, key: string, each: (item: Record<string, unknown>) => void): Promise<boolean> => {
      for (let page: number | null = 1; page !== null; ) {
        const res = await githubGet(token, `${apiPath}?per_page=100&page=${page}`)
        if (!res.ok) return false
        const list = (res.data as Record<string, unknown> | null)?.[key]
        if (Array.isArray(list)) {
          for (const item of list) {
            if (item !== null && typeof item === 'object') each(item as Record<string, unknown>)
          }
        }
        if (seen.size >= REPO_LIST_CAP) {
          capped = true
          return true
        }
        const next = nextOf(res.link, apiPath)
        page = next !== null && next > page ? next : null
      }
      return true
    }

    try {
      const ids: number[] = []
      if (!(await walk('/user/installations', 'installations', (i) => typeof i.id === 'number' && ids.push(i.id)))) return { ok: false }
      for (const id of ids) {
        if (capped) break
        if (
          !(await walk(`/user/installations/${id}/repositories`, 'repositories', (r) => {
            if (typeof r.full_name !== 'string' || seen.size >= REPO_LIST_CAP) return
            const k = r.full_name.toLowerCase()
            if (seen.has(k)) return
            seen.set(k, {
              fullName: r.full_name,
              private: r.private !== false,
              defaultBranch: typeof r.default_branch === 'string' && r.default_branch !== '' ? r.default_branch : 'main',
            })
          }))
        ) {
          return { ok: false }
        }
      }
    } catch {
      return { ok: false }
    }
    return { ok: true, repos: [...seen.values()].sort((a, b) => a.fullName.localeCompare(b.fullName)), capped }
  }

  return {
    status: () => buildStatus(),

    async startSignIn() {
      const state = `mac.${base64url(rand(24))}`
      const verifier = base64url(rand(48))
      pending = { state, verifier, startedAt: now() }
      lastError = undefined
      const url = new URL(GITHUB_AUTHORIZE_URL)
      url.searchParams.set('client_id', GITHUB_APP_CLIENT_ID)
      url.searchParams.set('redirect_uri', WORKER_CALLBACK_URI)
      url.searchParams.set('state', state)
      url.searchParams.set('code_challenge', pkceChallenge(verifier))
      url.searchParams.set('code_challenge_method', 'S256')
      await deps.openExternal(url.href)
      return emit()
    },

    async handleCallback(rawUrl) {
      const currentPending = pending
      pending = null
      let parsed: URL
      try {
        parsed = new URL(rawUrl)
      } catch {
        lastError = callbackErrorMessage('bad_url')
        return emit()
      }
      const err = parsed.searchParams.get('error')
      if (err === 'access_denied') {
        lastError = callbackErrorMessage('access_denied')
        return emit()
      }
      const code = parsed.searchParams.get('code')
      const state = parsed.searchParams.get('state')
      if (currentPending === null || code === null || state === null || state !== currentPending.state) {
        lastError = 'This sign-in link does not match an active sign-in. Try signing in again.'
        return emit()
      }
      if (now() - currentPending.startedAt > PENDING_TTL_MS) {
        lastError = 'Sign-in took more than 10 minutes. Try signing in again.'
        return emit()
      }

      const exchanged = await callWorker('/api/github/token', {
        code,
        codeVerifier: currentPending.verifier,
        redirectUri: WORKER_CALLBACK_URI,
      })
      if (!exchanged.ok) {
        lastError = callbackErrorMessage(exchanged.error)
        return emit()
      }
      const pair = pairFromWorker(exchanged.data, now())
      if (pair === null) {
        lastError = callbackErrorMessage('bad_pair')
        return emit()
      }

      let login: string
      let userId: number | null = null
      try {
        const userRes = await githubGet(pair.accessToken, '/user')
        const u = userRes.data as { login?: unknown; id?: unknown } | null
        if (!userRes.ok || typeof u?.login !== 'string' || u.login === '') {
          lastError = 'GitHub signed you in, but did not return your username. Try again.'
          return emit()
        }
        login = u.login
        userId = typeof u.id === 'number' && Number.isFinite(u.id) ? u.id : null
      } catch {
        lastError = callbackErrorMessage('offline')
        return emit()
      }

      await writeStored({ login, userId, ...pair })
      lastError = undefined
      return emit()
    },

    async signOut() {
      const stored = await readStored()
      pending = null
      lastError = undefined
      if (stored !== null) {
        await callWorker('/api/github/revoke', { accessToken: stored.accessToken }).catch(() => undefined)
      }
      await writeStored(null)
      return emit()
    },

    async manageRepos() {
      await deps.openExternal(GITHUB_CHOOSE_REPOS_URL)
    },

    async getValidAuth() {
      let stored = await readStored()
      if (stored === null) return null
      if (stored.accessEndsAt !== null && stored.accessEndsAt - now() <= REFRESH_MARGIN_MS) {
        const refreshed = await refreshLocked(stored)
        if (refreshed !== null) stored = refreshed
        else if (stored.accessEndsAt <= now()) return null
      }
      return { token: stored.accessToken, login: stored.login, email: noreplyEmail(stored.login, stored.userId) }
    },

    async listInstalledRepos() {
      const auth = await this.getValidAuth()
      if (auth === null) return []
      const res = await fetchInstalledRepos(auth.token)
      return res.ok ? res.repos : []
    },

    async isRepoAllowed(repoFullName) {
      const auth = await this.getValidAuth()
      if (auth === null) return 'unknown'
      const res = await fetchInstalledRepos(auth.token)
      if (!res.ok) return 'unknown'
      const needle = repoFullName.toLowerCase()
      if (res.repos.some((r) => r.fullName.toLowerCase() === needle)) return 'allowed'
      return res.capped ? 'unknown' : 'not-allowed'
    },
  }
}
