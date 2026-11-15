/**
 * THE MAC READS THE FRIENDS LIST (YAZ-5083, the list in the vault repo), in the MAIN process, never a renderer: the
 * `RepoPort` of `shared/friendListStore.ts` on Node's `fetch`, with the token of the app's one secrets store. The shared
 * reader (`findFriendsIndex`, `latestList`) runs on it unchanged.
 * - READ ONLY: the Mac never writes the list (YAZ-5086, "the Mac only sends"). `commit` refuses before any call.
 * - The token goes in the Authorization header only, to `api.github.com` only. A redirect is followed only when it
 *   stays on `api.github.com` (a renamed or transferred repo, YAZ-5399); never to another host.
 * - 404 or 403 on the repo: `NO_LIST_ACCESS`. A missing list file at a commit: null. YAZ-5464: a repo with no commit
 *   (409 "Git Repository is empty"): a head of `sha: null`, and no file. Other failures (other 409s too): the gist codes.
 * - A message holds the status only: never the token, a repo name or an address.
 */
import { GistError, type GistErrorCode } from '@shared/friendGists'
import { EMPTY_REPO, ListError, NO_COMMIT, type RepoPort } from '@shared/friendListStore'
import { GITHUB_API, REQUEST_TIMEOUT_MS, type FetchLike } from './gistsHttp'

const REPO_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/
const enc = (part: string) => part.split('/').map(encodeURIComponent).join('/')

export class MacNeverWrites extends Error {
  constructor() {
    super('The Mac never writes the friends list')
  }
}

/** How many redirects of GitHub's own API a read follows (a renamed or transferred repo: YAZ-5399). */
const MAX_REDIRECTS = 3

/**
 * One GET. YAZ-5399: a RENAMED or TRANSFERRED repo answers 301 (or 302, 307, 308) with the repo's new address
 * (`https://api.github.com/repositories/<id>/…`). The read follows it by itself, and ONLY to `api.github.com`: the token
 * never leaves GitHub's API (a `Location` on another host is a failure).
 */
async function call(token: string, fetch: FetchLike, path: string, init: { accept?: string; etag?: string | null } = {}): Promise<Response> {
  let at = `${GITHUB_API}${path}`
  for (let hop = 0; ; hop++) {
    const res = await callOnce(token, fetch, at, init)
    if (![301, 302, 307, 308].includes(res.status) || hop >= MAX_REDIRECTS) return res
    const where = res.headers.get('location')
    let next: URL
    try {
      next = new URL(where ?? '', at)
    } catch {
      return res
    }
    if (next.origin !== new URL(GITHUB_API).origin) return res
    at = next.toString()
  }
}

async function callOnce(token: string, fetch: FetchLike, url: string, init: { accept?: string; etag?: string | null }): Promise<Response> {
  const headers: Record<string, string> = {
    accept: init.accept ?? 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'x-github-api-version': '2022-11-28',
    'user-agent': 'YaseenDocs',
  }
  if (init.etag) headers['if-none-match'] = init.etag
  try {
    return await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), redirect: 'manual' })
  } catch {
    throw new GistError('OFFLINE', 'No connection to GitHub')
  }
}

/** YAZ-5464: GitHub's 409 "Git Repository is empty" (a repo with no commit), and only that 409. */
async function isEmptyRepo(res: Response): Promise<boolean> {
  if (res.status !== 409) return false
  const said = ((await res.clone().json().catch(() => null)) as { message?: unknown } | null)?.message
  return typeof said === 'string' && EMPTY_REPO.test(said)
}

function failure(response: Response): Error {
  const { status, headers } = response
  const code: GistErrorCode =
    (status === 403 || status === 429) && headers.get('x-ratelimit-remaining') === '0' ? 'RATE_LIMITED' : status === 401 ? 'UNAUTHORIZED' : status >= 500 ? 'GITHUB_DOWN' : status === 429 ? 'RATE_LIMITED' : 'UNEXPECTED'
  if (status === 403 && code !== 'RATE_LIMITED') return new ListError('NO_LIST_ACCESS', `GitHub answered ${status}`)
  // YAZ-5399: a 404 on the repo is "gone" (deleted, or no access at all).
  if (status === 404) return Object.assign(new ListError('NO_LIST_ACCESS', `GitHub answered ${status}`), { gone: true })
  const reset = Number(headers.get('x-ratelimit-reset'))
  return new GistError(code, `GitHub answered ${status}`, code === 'RATE_LIMITED' && Number.isFinite(reset) && reset > 0 ? reset * 1000 : null)
}

/**
 * The read-only list port of one vault repo on this Mac: on `branch` (the branch this Mac syncs), or with null on the
 * repo's default branch (a vault that is not open on this Mac: one more read, once).
 */
export function macRepoPort(token: string, fetch: FetchLike, repo: string, branch: string | null): RepoPort {
  if (!REPO_RE.test(repo)) throw new Error('A repo is owner/name')
  const [owner, name] = repo.split('/')
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
  let known = branch
  const branchNow = async (): Promise<string> => {
    if (known !== null) return known
    const res = await call(token, fetch, base)
    if (res.status !== 200) throw failure(res)
    const b = ((await res.json().catch(() => null)) as { default_branch?: unknown } | null)?.default_branch
    known = typeof b === 'string' && b !== '' ? b : 'main'
    return known
  }
  return {
    repo: repo.toLowerCase(),
    get branch() {
      return known ?? ''
    },
    async head(etag) {
      const res = await call(token, fetch, `${base}/git/ref/heads/${enc(await branchNow())}`, { etag })
      if (res.status === 304) return 'unchanged'
      // YAZ-5464: a repo with no commit has no list file (the shared reader takes it as "missing").
      if (await isEmptyRepo(res)) return { sha: null, etag: null }
      if (res.status !== 200) throw failure(res)
      const data = (await res.json().catch(() => null)) as { object?: { sha?: unknown } } | null
      const sha = data?.object?.sha
      if (typeof sha !== 'string') throw new GistError('UNEXPECTED', 'GitHub gave no commit for the branch')
      return { sha, etag: res.headers.get('etag') }
    },
    async read(commit, path) {
      const res = await call(token, fetch, `${base}/contents/${enc(path)}?ref=${encodeURIComponent(commit)}`, { accept: 'application/vnd.github.raw+json' })
      if (res.status === 404) {
        // YAZ-5398: a commit GitHub's replica does not have yet, not a missing file.
        const said = ((await res.json().catch(() => null)) as { message?: unknown } | null)?.message
        if (typeof said === 'string' && NO_COMMIT.test(said)) throw new ListError('STALE_READ', 'GitHub does not have that commit yet')
        return null
      }
      if (await isEmptyRepo(res)) return null
      if (res.status !== 200) throw failure(res)
      return res.text()
    },
    async canonical() {
      const res = await call(token, fetch, base)
      if (res.status !== 200) throw failure(res)
      const name = ((await res.json().catch(() => null)) as { full_name?: unknown } | null)?.full_name
      return typeof name === 'string' && name.includes('/') ? name.toLowerCase() : repo.toLowerCase()
    },
    async commit() {
      throw new MacNeverWrites()
    },
  }
}
