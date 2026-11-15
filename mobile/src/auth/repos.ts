import { VAULT_CONFIG_DIR } from '@shared/types'
import { GITHUB_API, GithubError, githubClient, repoPath } from '../github/client'
import { fromGithub, type CheckDeps, type SignInError } from './check'
import { cleanToken } from './input'

/**
 * YAZ-5408: the repos a token can reach, for the repo picker. The person pastes only the token; the app lists the
 * repos; a tap runs the existing check on save (`checkSignIn`, unchanged).
 * - `GET /user/repos?per_page=100`: a fine-grained token lists the repos it was given; a classic token, every repo of
 *   its user. The app follows the `Link` header page by page, to at most `REPO_LIST_CAP` repos, and says when it stops.
 * - Every call goes through the one GitHub client: the token only in the Authorization header, only to api.github.com.
 * - The list is held by the screen, in memory. Nothing here stores, logs or sends it anywhere.
 */

export const REPO_PAGE_SIZE = 100
/** 10 pages. A person with more repos types the name (the fallback). */
export const REPO_LIST_CAP = 1000

export interface TokenRepo {
  /** `owner/name`, as GitHub writes it. */
  fullName: string
  private: boolean
  defaultBranch: string
  /** ms since 1970; 0 when GitHub gives none (an empty repo). */
  pushedAt: number
}

export type RepoList = { ok: true; repos: TokenRepo[]; capped: boolean } | { ok: false; error: SignInError }

/** The page of a `rel="next"` link, only when the link points to `GET /user/repos` on api.github.com. */
export function nextPage(link: string | null): number | null {
  for (const part of (link ?? '').split(',')) {
    const m = /<([^>]+)>\s*;\s*rel="next"/.exec(part)
    if (m === null) continue
    let url: URL
    try {
      url = new URL(m[1])
    } catch {
      return null
    }
    if (url.origin !== GITHUB_API || url.pathname !== '/user/repos') return null
    const page = Number(url.searchParams.get('page'))
    return Number.isInteger(page) && page > 1 ? page : null
  }
  return null
}

export async function listTokenRepos(text: string, deps: CheckDeps = {}): Promise<RepoList> {
  const token = cleanToken(text)
  if (token === null) return { ok: false, error: { kind: 'bad-token' } }
  const client = githubClient(token, { fetch: deps.fetch, now: deps.now })
  const seen = new Map<string, TokenRepo>()
  let capped = false
  try {
    for (let page: number | null = 1, n = 0; page !== null; n++) {
      if (n === REPO_LIST_CAP / REPO_PAGE_SIZE) {
        capped = true
        break
      }
      const answer = await client.request('/user/repos', { query: { per_page: String(REPO_PAGE_SIZE), page: String(page), sort: 'pushed' } })
      for (const raw of Array.isArray(answer.data) ? answer.data : []) {
        const r = raw as { full_name?: unknown; private?: unknown; default_branch?: unknown; pushed_at?: unknown }
        if (typeof r.full_name !== 'string' || seen.has(r.full_name.toLowerCase())) continue
        const pushed = typeof r.pushed_at === 'string' ? Date.parse(r.pushed_at) : NaN
        seen.set(r.full_name.toLowerCase(), {
          fullName: r.full_name,
          private: r.private !== false,
          defaultBranch: typeof r.default_branch === 'string' ? r.default_branch : 'main',
          pushedAt: Number.isFinite(pushed) ? pushed : 0,
        })
      }
      const next = nextPage(answer.headers.get('link'))
      page = next !== null && next > page ? next : null
    }
  } catch (error) {
    if (!(error instanceof GithubError)) throw error
    return { ok: false, error: fromGithub(error) }
  }
  if (seen.size === 0) return { ok: false, error: { kind: 'no-repos' } }
  return { ok: true, repos: orderRepos([...seen.values()], {}), capped }
}

/** `vault`: a `.yaseendocs` folder at the top of the default branch; `not`: none; `unknown`: the app cannot tell. */
export type VaultLook = 'vault' | 'not' | 'unknown'

/** One call. The pick still runs the full check; this only marks and orders the list. */
export async function lookForVault(token: string, repo: TokenRepo, deps: CheckDeps = {}): Promise<VaultLook> {
  try {
    const answer = await githubClient(token, { fetch: deps.fetch, now: deps.now }).request(repoPath(repo.fullName, 'contents', VAULT_CONFIG_DIR), {
      query: { ref: repo.defaultBranch },
      allow: [403, 404],
    })
    if (answer.status === 404) return 'not'
    if (answer.status === 403) return 'unknown'
    return Array.isArray(answer.data) ? 'vault' : 'not'
  } catch {
    return 'unknown'
  }
}

/** Likely vaults first, then the most recent push, then the name. */
export function orderRepos(repos: TokenRepo[], looks: Record<string, VaultLook | undefined>): TokenRepo[] {
  const vault = (r: TokenRepo) => (looks[r.fullName] === 'vault' ? 0 : 1)
  return [...repos].sort((a, b) => vault(a) - vault(b) || b.pushedAt - a.pushedAt || a.fullName.localeCompare(b.fullName))
}
