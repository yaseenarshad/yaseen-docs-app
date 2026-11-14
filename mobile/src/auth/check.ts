import { VAULT_CONFIG_DIR } from '@shared/types'
import { GithubError, githubClient, repoPath, type FetchLike, type GithubClient } from '../github/client'
import type { GistsAccess, VaultAccount } from './account'
import { readTokenEnd } from './expiry'
import { cleanToken, isBranchName, parseRepo } from './input'

/**
 * The check on save (decision 13): is this token good for this repo and branch? It stores nothing; `signIn`
 * stores only after it passes. In order:
 * 1. `GET /user`: the token works, and whose it is (`login`, `name`, `avatar_url`). Needs no permission.
 * 2. `GET /repos/{repo}`: the repo is there and the token can read it. Gives the exact name and the default branch.
 * 3. `GET …/branches/{branch}`: the branch is there.
 * 3b. `GET …/contents/.yaseendocs?ref={branch}`: the repo has a vault at its top (round 16: a vault is the
 *    whole repo; no vault in a subfolder).
 * 4. Write probe: `POST …/git/blobs` with `WRITE_PROBE`, a VALID body: 201 means the token may write, 403 or 404
 *    means it may not. The body is valid, so the answer does not depend on GitHub's order of checks (permission
 *    first, or body first: not proven). The blob is the same bytes each time, so git stores it once; no file,
 *    commit or branch changes (proof 1B). `permissions.push` of step 2 is the user's role, not the token's, so it
 *    cannot answer this.
 * 5. Gists probe (decision 17): `POST /gists` with no files: 403 no, 422 yes. It creates nothing. If GitHub checks
 *    the body first, a token with no Gists permission gets 422 too, and this says "yes" by mistake; then the first
 *    gist write gets `READ_ONLY`, and the friends sender calls `recordGistsRefused` (friends.ts). A classic token
 *    says its scopes in `X-OAuth-Scopes` instead. If this step fails, sign-in still works (`gists: 'unknown'`).
 */

/** The write probe's blob: always these bytes, so GitHub keeps one copy for each repo. */
export const WRITE_PROBE = 'Notecards checks that this token may write to this repo. This blob is in no commit.\n'

export interface SignInInput {
  /** `owner/name`, or the repo's GitHub address. */
  repo: string
  /** The default branch of the repo when not given (the sign-in form has no branch field). */
  branch?: string
  token: string
  /** An end date from the Mac's code, used when GitHub's header cannot be read. */
  expiresAt?: string | null
}

export type SignInError =
  | { kind: 'bad-repo' }
  | { kind: 'bad-branch' }
  | { kind: 'bad-token' }
  /** Wrong, expired or cancelled (rows F3, N6). */
  | { kind: 'unauthorized' }
  /** Not there, or a private repo the token may not see: GitHub gives the same 404 for both (row F4). */
  | { kind: 'repo-not-found'; repo: string }
  /** The token may not read it (403). */
  | { kind: 'no-access'; repo: string }
  | { kind: 'branch-not-found'; repo: string; branch: string }
  /** The repo and branch have no vault at the top: no `.yaseendocs` folder (round 16). */
  | { kind: 'no-vault'; repo: string; branch: string }
  /** The token can read but not write (the row "only read access"), or the repo is archived. */
  | { kind: 'read-only'; repo: string }
  | { kind: 'already-added'; repo: string; branch: string }
  | { kind: 'offline' }
  | { kind: 'github-down' }
  | { kind: 'rate-limited'; resetAt: number | null }
  | { kind: 'unexpected'; status: number | null }

export interface CheckedVault {
  /** As GitHub writes it (`full_name`). */
  repo: string
  branch: string
  account: VaultAccount
}

export type CheckResult = { ok: true; token: string; vault: CheckedVault } | { ok: false; error: SignInError }

export interface CheckDeps {
  fetch?: FetchLike
  now?: () => number
}

export async function checkSignIn(input: SignInInput, deps: CheckDeps = {}): Promise<CheckResult> {
  const fail = (error: SignInError): CheckResult => ({ ok: false, error })
  const now = deps.now ?? Date.now
  const token = cleanToken(input.token)
  if (token === null) return fail({ kind: 'bad-token' })
  const repoName = parseRepo(input.repo)
  if (repoName === null) return fail({ kind: 'bad-repo' })
  if (input.branch !== undefined && !isBranchName(input.branch)) return fail({ kind: 'bad-branch' })
  const client = githubClient(token, { fetch: deps.fetch, now })

  try {
    const user = await client.request('/user')
    const u = user.data as { login: string; name: string | null; avatar_url: string }

    let repo = repoName.full
    let info: { full_name: string; default_branch: string; archived?: boolean }
    try {
      info = (await client.request(repoPath(repo))).data as typeof info
    } catch (error) {
      if (error instanceof GithubError && error.code === 'NOT_FOUND') return fail({ kind: 'repo-not-found', repo })
      if (error instanceof GithubError && error.code === 'NO_ACCESS') return fail({ kind: 'no-access', repo })
      throw error
    }
    repo = info.full_name
    const branch = input.branch ?? info.default_branch

    try {
      await client.request(repoPath(repo, 'branches', branch))
    } catch (error) {
      if (error instanceof GithubError && error.code === 'NOT_FOUND') return fail({ kind: 'branch-not-found', repo, branch })
      throw error
    }

    let top: unknown
    try {
      top = (await client.request(repoPath(repo, 'contents', VAULT_CONFIG_DIR), { query: { ref: branch } })).data
    } catch (error) {
      if (error instanceof GithubError && error.code === 'NOT_FOUND') return fail({ kind: 'no-vault', repo, branch })
      throw error
    }
    // A folder answers with a list; a FILE named `.yaseendocs` is no vault.
    if (!Array.isArray(top)) return fail({ kind: 'no-vault', repo, branch })

    if (info.archived === true) return fail({ kind: 'read-only', repo })
    const write = await client.request(repoPath(repo, 'git', 'blobs'), {
      method: 'POST',
      body: { content: WRITE_PROBE, encoding: 'utf-8' },
      allow: [403, 404],
    })
    if (write.status === 403 || write.status === 404) return fail({ kind: 'read-only', repo })

    const account: VaultAccount = {
      login: u.login,
      name: u.name ?? null,
      avatarUrl: u.avatar_url,
      gists: await gistsAccess(client, user.headers),
      expiresAt: readTokenEnd(user.headers) ?? input.expiresAt ?? null,
      checkedAt: now(),
    }
    return { ok: true, token, vault: { repo, branch, account } }
  } catch (error) {
    if (!(error instanceof GithubError)) throw error
    return fail(fromGithub(error))
  }
}

async function gistsAccess(client: GithubClient, userHeaders: Headers): Promise<GistsAccess> {
  const scopes = userHeaders.get('x-oauth-scopes')
  if (scopes !== null) return scopes.split(',').some((s) => s.trim() === 'gist') ? 'yes' : 'no'
  try {
    const probe = await client.request('/gists', { method: 'POST', body: { files: {} }, allow: [403, 404, 422] })
    return probe.status === 422 ? 'yes' : 'no'
  } catch {
    return 'unknown'
  }
}

function fromGithub(error: GithubError): SignInError {
  switch (error.code) {
    case 'UNAUTHORIZED':
      return { kind: 'unauthorized' }
    case 'OFFLINE':
      return { kind: 'offline' }
    case 'GITHUB_DOWN':
      return { kind: 'github-down' }
    case 'RATE_LIMITED':
      return { kind: 'rate-limited', resetAt: error.resetAt }
    default:
      return { kind: 'unexpected', status: error.status }
  }
}

/** Plain words for the sign-in screen (4A). None holds the token. */
export function signInMessage(error: SignInError): string {
  switch (error.kind) {
    case 'bad-repo':
      return 'Type the repo as owner/name, for example yaseen/vault.'
    case 'bad-branch':
      return 'That is not a valid branch name.'
    case 'bad-token':
      return 'That is not a GitHub token. Copy the whole token from GitHub and paste it again.'
    case 'unauthorized':
      return 'GitHub does not accept this token. It is wrong, it ended, or it was cancelled. Make a new token and paste it.'
    case 'repo-not-found':
      return `Can't find ${error.repo}, or your token can't read it. Check the name, and that the token includes this repo.`
    case 'no-access':
      return `Your token can't read ${error.repo}. Add this repo to the token on GitHub.`
    case 'branch-not-found':
      return `${error.repo} has no branch "${error.branch}".`
    case 'no-vault':
      return `${error.repo} has no Yaseen Docs vault at its top (no .yaseendocs folder on ${error.branch}). Use the repo that holds your vault.`
    case 'read-only':
      return `Your token can read ${error.repo} but not change it. Make a token with Contents: Read and write on this repo.`
    case 'already-added':
      return `${error.repo} (${error.branch}) is already on this phone.`
    case 'offline':
      return 'No internet connection. Connect, then try again.'
    case 'github-down':
      return 'GitHub is not answering right now. Try again in a few minutes.'
    case 'rate-limited':
      return error.resetAt === null
        ? 'GitHub asks us to slow down. Try again in a few minutes.'
        : `GitHub asks us to slow down. Try again after ${new Date(error.resetAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`
    case 'unexpected':
      return `GitHub gave an answer we did not expect${error.status === null ? '' : ` (${error.status})`}. Try again.`
  }
}
