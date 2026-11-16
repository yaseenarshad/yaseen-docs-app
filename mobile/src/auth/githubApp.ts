import { GITHUB_API, GithubError, githubClient, type FetchLike } from '../github/client'
import type { PendingSignIn, TokenStore } from '../store/tokenStore'
import { PENDING_MS } from '../store/tokenStore'
import { fromGithub, signInMessage, type SignInError } from './check'
import { signInHelp, type Help } from '../app/help'
import { CALLBACK_PATH, GITHUB_APP_CLIENT_ID, GITHUB_AUTHORIZE } from './githubAppConfig'
import { exchangeCode } from './githubWorker'
import { REPO_LIST_CAP, REPO_PAGE_SIZE, orderRepos, type RepoList, type TokenRepo } from './repos'

/**
 * "Sign in with GitHub" (YAZ-5645, slice 1): the web sign-in flow of the GitHub App, with PKCE (S256) and state.
 * Its own chunk: it loads when the person taps the button, or when GitHub sends them back.
 * 1. `startGithubSignIn`: a random state and PKCE verifier, kept for 10 minutes (one use), then GitHub's address.
 *    The app goes there in the SAME window (no popup), so the Home Screen app keeps the sign-in (scope 2/3).
 * 2. GitHub sends the person back to `/auth/callback?code&state`. `finishGithubSignIn` checks the state FIRST, then the
 *    Worker swaps the code (plus the verifier and the secret) for the token pair, and `/user` names the account.
 * 3. The repos come from the app's installations (`listInstalledRepos`), not `/user/repos` (edge case 17).
 */

export type PendingPurpose = PendingSignIn['purpose']

/** What went wrong on the way back from GitHub (scope 3/3, edge cases 1–3). */
export type GithubSignInError =
  /** The person said no on GitHub. Nothing changed. */
  | { kind: 'denied' }
  /** No sign-in was started here, or the state does not match (an old tab, Safari instead of the app, a forged link). */
  | { kind: 'no-sign-in' }
  /** More than 10 minutes, or GitHub refused the code (it lasts 10 minutes, once). */
  | { kind: 'too-late' }
  | { kind: 'offline' }
  /** The Worker or GitHub refused for another reason. */
  | { kind: 'refused' }

export type GithubReturn = { ok: true; login: string; purpose: PendingPurpose } | { ok: false; error: GithubSignInError; purpose: PendingPurpose | null }

export interface GithubDeps {
  tokens: TokenStore
  fetch?: FetchLike
  now?: () => number
  /** The site's origin (`location.origin`); tests pass one. */
  origin?: string
  random?: (bytes: Uint8Array) => Uint8Array
}

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const randomText = (deps: GithubDeps, size: number) => base64url((deps.random ?? ((b) => crypto.getRandomValues(b)))(new Uint8Array(size)))

/** PKCE S256: base64url(SHA-256(verifier)). */
export async function pkceChallenge(verifier: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
}

/**
 * Keeps the pending sign-in and gives GitHub's address. `another`: "Add another GitHub account" (`prompt=select_account`).
 * The address holds no token: the client ID, the callback, the state and the PKCE challenge only.
 */
export async function startGithubSignIn(purpose: PendingPurpose, deps: GithubDeps, another = false): Promise<string> {
  const now = deps.now ?? Date.now
  const origin = deps.origin ?? location.origin
  const state = randomText(deps, 24)
  const verifier = randomText(deps, 48)
  const redirectUri = `${origin}${CALLBACK_PATH}`
  await deps.tokens.savePending({ state, verifier, redirectUri, startedAt: now(), purpose })
  const url = new URL(GITHUB_AUTHORIZE)
  url.searchParams.set('client_id', GITHUB_APP_CLIENT_ID)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', await pkceChallenge(verifier))
  url.searchParams.set('code_challenge_method', 'S256')
  if (another) url.searchParams.set('prompt', 'select_account')
  return url.href
}

/** The callback (`/auth/callback?…`): checks, swaps the code, keeps the pair, names the account. Never throws for GitHub. */
export async function finishGithubSignIn(callback: URL, deps: GithubDeps): Promise<GithubReturn> {
  const now = deps.now ?? Date.now
  // One use: the pending sign-in leaves storage before anything else, whatever happens next.
  const pending = await deps.tokens.takePending()
  const purpose = pending?.purpose ?? null
  const fail = (kind: GithubSignInError['kind']): GithubReturn => ({ ok: false, error: { kind } as GithubSignInError, purpose })
  const q = callback.searchParams
  if (q.get('error') === 'access_denied') return fail('denied')
  const code = q.get('code')
  const state = q.get('state')
  if (pending === null || code === null || state === null || state !== pending.state) return fail('no-sign-in')
  if (now() - pending.startedAt > PENDING_MS) return fail('too-late')

  const got = await exchangeCode(code, pending.verifier, pending.redirectUri, deps.fetch, now)
  if (!got.ok) return fail(got.error === 'offline' || got.error === 'github_unreachable' ? 'offline' : got.error === 'bad_verification_code' ? 'too-late' : 'refused')
  let login: string
  try {
    const user = (await githubClient(got.pair.access, { fetch: deps.fetch, now }).request('/user')).data as { login?: unknown }
    if (typeof user.login !== 'string') return fail('refused')
    login = user.login
  } catch (error) {
    return fail(error instanceof GithubError && error.code === 'OFFLINE' ? 'offline' : 'refused')
  }
  await deps.tokens.savePair({ ...got.pair, login })
  return { ok: true, login, purpose: pending.purpose }
}

/** The page of a `rel="next"` link, only when it points to `path` on api.github.com. */
function nextOf(link: string | null, path: string): number | null {
  for (const part of (link ?? '').split(',')) {
    const m = /<([^>]+)>\s*;\s*rel="next"/.exec(part)
    if (m === null) continue
    try {
      const url = new URL(m[1])
      if (url.origin !== GITHUB_API || url.pathname !== path) return null
      const page = Number(url.searchParams.get('page'))
      return Number.isInteger(page) && page > 1 ? page : null
    } catch {
      return null
    }
  }
  return null
}

/**
 * The repos the person chose for the app on GitHub: every installation this account reaches, and each one's repos,
 * page by page (at most `REPO_LIST_CAP`). No installation or no repo: `no-installed-repos` ("Choose repos on GitHub").
 */
export async function listInstalledRepos(token: string, deps: { fetch?: FetchLike; now?: () => number } = {}): Promise<RepoList> {
  const client = githubClient(token, { fetch: deps.fetch, now: deps.now })
  const seen = new Map<string, TokenRepo>()
  let capped = false
  const pages = async (path: string, key: string, each: (item: Record<string, unknown>) => void) => {
    for (let page: number | null = 1; page !== null; ) {
      const answer = await client.request(path, { query: { per_page: String(REPO_PAGE_SIZE), page: String(page) } })
      const list = (answer.data as Record<string, unknown> | null)?.[key]
      for (const item of Array.isArray(list) ? list : []) if (item !== null && typeof item === 'object') each(item as Record<string, unknown>)
      if (seen.size >= REPO_LIST_CAP) return void (capped = true)
      const next = nextOf(answer.headers.get('link'), path)
      page = next !== null && next > page ? next : null
    }
  }
  try {
    const ids: number[] = []
    await pages('/user/installations', 'installations', (i) => typeof i.id === 'number' && ids.push(i.id))
    for (const id of ids) {
      if (capped) break
      await pages(`/user/installations/${id}/repositories`, 'repositories', (r) => {
        if (typeof r.full_name !== 'string' || seen.has(r.full_name.toLowerCase()) || seen.size >= REPO_LIST_CAP) return
        const pushed = typeof r.pushed_at === 'string' ? Date.parse(r.pushed_at) : NaN
        seen.set(r.full_name.toLowerCase(), {
          fullName: r.full_name,
          private: r.private !== false,
          defaultBranch: typeof r.default_branch === 'string' ? r.default_branch : 'main',
          pushedAt: Number.isFinite(pushed) ? pushed : 0,
        })
      })
    }
  } catch (error) {
    if (!(error instanceof GithubError)) throw error
    return { ok: false, error: fromGithub(error) }
  }
  if (seen.size === 0) return { ok: false, error: { kind: 'no-installed-repos' } satisfies SignInError }
  return { ok: true, repos: orderRepos([...seen.values()], {}), capped }
}

/** Plain words for the way back from GitHub. */
export function githubSignInMessage(error: GithubSignInError): string {
  switch (error.kind) {
    case 'denied':
      return 'You did not allow Yaseen Docs on GitHub. Nothing changed.'
    case 'no-sign-in':
      return 'This sign-in did not start here. If you started it in the Home Screen app, go back to the app and try again there.'
    case 'too-late':
      return 'Sign-in took too long. Try again.'
    case 'offline':
      return 'No internet connection. Connect, then try again.'
    case 'refused':
      return 'GitHub did not finish the sign-in. Try again in a few minutes.'
  }
}

/**
 * YAZ-5645: the words and the way forward of a sign-in check that ran with a "Sign in with GitHub" token. There is no
 * token to make or edit: a repo the app cannot read or change is chosen on GitHub, and another account means signing
 * in as the right one. Any other result: `signInHelp`.
 */
export function githubHelp(error: SignInError): Help {
  switch (error.kind) {
    case 'no-installed-repos':
    case 'no-repos':
      return { message: signInMessage({ kind: 'no-installed-repos' }), forward: 'choose-repos' }
    case 'bad-token':
    case 'unauthorized':
      return { message: 'GitHub signed you out. Sign in again. Your vaults, unsent answers and settings stay.', forward: 'sign-in-github' }
    case 'repo-not-found':
    case 'no-access':
    case 'no-contents':
      return { message: `Yaseen Docs can't read ${error.repo}. On GitHub, choose it for Yaseen Docs.`, forward: 'choose-repos' }
    case 'read-only':
      return { message: `Yaseen Docs can read ${error.repo} but not change it. On GitHub, choose it for Yaseen Docs again, with Contents: Read and write.`, forward: 'choose-repos' }
    case 'other-account':
      return { message: `You signed in to GitHub as @${error.login}. This vault uses @${error.expected}. Sign in as @${error.expected}.`, forward: 'sign-in-github' }
  }
  return signInHelp(error)
}
