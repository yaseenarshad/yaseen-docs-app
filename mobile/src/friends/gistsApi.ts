import { gistDoc, gistFilesBody, gistListItems, isGistId, POINTER_FILE, type GistListItem, type GistRate, type GistsApi } from '@shared/friendGists'
import type { RepoPort } from '@shared/friendListStore'
import { GithubError, type GithubClient, type RateLimit } from '../github/client'

/**
 * The gist calls (YAZ-5082) on the ONE GitHub client of 3E (`github/client.ts`): the token goes in the Authorization
 * header only, to `api.github.com` only, and each failure is a typed `GithubError` (`READ_ONLY` for a write with no
 * Gists permission, `NOT_FOUND`, `RATE_LIMITED`, `OFFLINE`, …). The shared friends logic reads the same codes.
 * Proof 1C: `GET /gists` lists the user's own secret gists with file names (no text); `GET /gists/{id}` reads any
 * gist by its ID; an ETag read of an unchanged gist is a free 304; each `PATCH` counts on `gist_update`.
 */
const PAGE = 100
/** 1000 gists at most: a person with more has the friends files in the newest ones (GitHub lists the newest first). */
const MAX_PAGES = 10
/** A PATCH that GitHub refused with 409 (another write of the same gist at that moment) is sent again this often. */
const CONFLICT_RETRIES = 2
const CONFLICT_WAIT_MS = 1000

/** GitHub's `gist_update` count from an answer's `x-ratelimit-*` headers (3E reads them into `rateLimit`). */
export function gistRate(rate: RateLimit | null): GistRate | null {
  if (rate === null || rate.resource !== 'gist_update') return null
  return { remaining: rate.remaining, limit: rate.limit, resetAt: rate.resetAt }
}

/** A gist ID goes into a path: anything but hex is refused before a call (a friend's pointer is untrusted). */
function gistPath(id: string): string {
  if (!isGistId(id)) throw new Error('This is not a gist ID')
  return `/gists/${id.toLowerCase()}`
}

/** `repos` (YAZ-5083): this phone's vaults on the friends account, where the friends list can live. */
export function gistsApi(client: GithubClient, repos?: () => Promise<readonly RepoPort[]>, repo?: (full: string) => Promise<RepoPort>): GistsApi {
  /** YAZ-5238: GitHub's time at its last answer (the `Date` header, or a lower bound from the core reset). */
  let serverTime: number | null = null
  const request: GithubClient['request'] = async (path, options) => {
    const answer = await client.request(path, options)
    const date = Date.parse(answer.headers.get('date') ?? '')
    const reset = answer.rateLimit?.resource === 'core' && answer.rateLimit.resetAt !== null ? answer.rateLimit.resetAt - 60 * 60_000 : null
    const known = [date, reset ?? NaN].filter((t) => Number.isFinite(t))
    if (known.length > 0) serverTime = Math.max(...known)
    return answer
  }
  /**
   * `GET /gists`, page by page. `all` (YAZ-5464): more than `max` pages is `TOO_MANY_GISTS`. YAZ-5492 (nit): a full
   * last page may be the end (exactly 3,000 gists): one more page tells; only a gist on it is too many.
   */
  async function pages(max: number, all: boolean): Promise<GistListItem[]> {
    const out: GistListItem[] = []
    for (let page = 1; page <= max + (all ? 1 : 0); page++) {
      const answer = await request('/gists', { query: { per_page: String(PAGE), page: String(page) } })
      const items = gistListItems(answer.data)
      if (page > max) {
        if (items.length === 0) return out
        throw Object.assign(new Error(`You have more than ${max * PAGE} gists on GitHub: the app cannot see them all`), { code: 'TOO_MANY_GISTS' })
      }
      out.push(...items)
      if (items.length < PAGE) return out
    }
    return out
  }
  return {
    ...(repos !== undefined && { repos }),
    ...(repo !== undefined && { repo }),
    serverTime: () => serverTime,
    list: () => pages(MAX_PAGES, false),
    listAll: (maxPages) => pages(maxPages, true),
    async read(id, etag) {
      const answer = await request(gistPath(id), etag ? { etag } : {})
      if (answer.status === 304) return 'unchanged'
      return gistDoc(answer.data, answer.etag)
    },
    async create(description, files) {
      const answer = await request('/gists', { method: 'POST', body: { description, public: false, files: gistFilesBody(files) } })
      return gistDoc(answer.data, answer.etag)
    },
    async update(id, files, again) {
      // YAZ-5312 (proved live): two PATCHes of one gist at the same moment, on DIFFERENT files, can get 409 for one of
      // them. GitHub refused that whole write, so it may be sent again: up to 2 more times, after a wait.
      // YAZ-5516 (N9-1): but never the SAME body blind: the other write may be newer (a pointer moved to the newest
      // generation). Read the gist again and work out the change again on it (`again`). A pointer write with no way to
      // work it out again is not sent again: the other write stands (`superseded`).
      let body = files
      for (let attempt = 0; ; attempt++) {
        try {
          const answer = await request(gistPath(id), { method: 'PATCH', body: { files: gistFilesBody(body) } })
          return { gist: answer.data === null ? null : gistDoc(answer.data, answer.etag), rate: gistRate(answer.rateLimit) }
        } catch (err) {
          if (!(err instanceof GithubError && err.status === 409)) throw err
          // Round 4, Nit 3: still refused after the retries: quiet ("try again later"), never an exception on a screen.
          if (attempt >= CONFLICT_RETRIES) throw new GithubError('GITHUB_DOWN', 409, 'GitHub answered 409: the gist is being written', null, err.said, err.rateLimit)
          await new Promise((r) => setTimeout(r, CONFLICT_WAIT_MS * (attempt + 1)))
          if (again === undefined && !(POINTER_FILE in body)) continue
          const read = await request(gistPath(id))
          const fresh = gistDoc(read.data, read.etag)
          const next = again === undefined ? null : again(fresh)
          if (next === null) return { gist: fresh, rate: null, superseded: true }
          body = next
        }
      }
    },
    async remove(id) {
      await request(gistPath(id), { method: 'DELETE' })
    },
  }
}
