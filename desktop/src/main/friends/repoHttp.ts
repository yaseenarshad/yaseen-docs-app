/**
 * THE MAC READS THE FRIENDS LIST (YAZ-5083, the list in the vault repo), in the MAIN process, never a renderer: the
 * `RepoPort` of `shared/friendListStore.ts` on Node's `fetch`, with the token of the app's one secrets store. The shared
 * reader (`findFriendsIndex`, `latestList`) runs on it unchanged.
 * - READ ONLY: the Mac never writes the list (YAZ-5086, "the Mac only sends"). `commit` refuses before any call.
 * - The token goes in the Authorization header only, to `api.github.com` only, never along a redirect.
 * - 404 or 403 on the repo: `NO_LIST_ACCESS`. A missing list file at a commit: null. Other failures: the gist codes.
 * - A message holds the status only: never the token, a repo name or an address.
 */
import { GistError, type GistErrorCode } from '@shared/friendGists'
import { ListError, type RepoPort } from '@shared/friendListStore'
import { GITHUB_API, REQUEST_TIMEOUT_MS, type FetchLike } from './gistsHttp'

const REPO_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/
const enc = (part: string) => part.split('/').map(encodeURIComponent).join('/')

export class MacNeverWrites extends Error {
  constructor() {
    super('The Mac never writes the friends list')
  }
}

async function call(token: string, fetch: FetchLike, path: string, init: { accept?: string; etag?: string | null } = {}): Promise<Response> {
  const headers: Record<string, string> = {
    accept: init.accept ?? 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'x-github-api-version': '2022-11-28',
    'user-agent': 'YaseenDocs',
  }
  if (init.etag) headers['if-none-match'] = init.etag
  try {
    return await fetch(`${GITHUB_API}${path}`, { method: 'GET', headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), redirect: 'manual' })
  } catch {
    throw new GistError('OFFLINE', 'No connection to GitHub')
  }
}

function failure(response: Response): Error {
  const { status, headers } = response
  const code: GistErrorCode =
    (status === 403 || status === 429) && headers.get('x-ratelimit-remaining') === '0' ? 'RATE_LIMITED' : status === 401 ? 'UNAUTHORIZED' : status >= 500 ? 'GITHUB_DOWN' : status === 429 ? 'RATE_LIMITED' : 'UNEXPECTED'
  if (status === 403 && code !== 'RATE_LIMITED') return new ListError('NO_LIST_ACCESS', `GitHub answered ${status}`)
  if (status === 404) return new ListError('NO_LIST_ACCESS', `GitHub answered ${status}`)
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
      if (res.status !== 200) throw failure(res)
      const data = (await res.json().catch(() => null)) as { object?: { sha?: unknown } } | null
      const sha = data?.object?.sha
      if (typeof sha !== 'string') throw new GistError('UNEXPECTED', 'GitHub gave no commit for the branch')
      return { sha, etag: res.headers.get('etag') }
    },
    async read(commit, path) {
      const res = await call(token, fetch, `${base}/contents/${enc(path)}?ref=${encodeURIComponent(commit)}`, { accept: 'application/vnd.github.raw+json' })
      if (res.status === 404) return null
      if (res.status !== 200) throw failure(res)
      return res.text()
    },
    async commit() {
      throw new MacNeverWrites()
    },
  }
}
