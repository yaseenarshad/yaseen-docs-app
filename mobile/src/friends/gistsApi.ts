import { isGistId, type GistDoc, type GistListItem, type GistRate, type GistsApi } from '@shared/friendGists'
import type { GithubClient, RateLimit } from '../github/client'

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

interface RawGist {
  id: string
  owner?: { login?: unknown } | null
  description: string | null
  created_at: string
  updated_at: string
  files: Record<string, { content?: unknown; truncated?: unknown } | null>
}

const asList = (data: unknown): RawGist[] => (Array.isArray(data) ? (data as RawGist[]).filter((g) => g !== null && typeof g === 'object' && typeof g.id === 'string') : [])

function toDoc(data: unknown, etag: string | null): GistDoc {
  const g = data as RawGist
  return {
    id: g.id,
    // YAZ-5239: GitHub's own owner of the gist; the only login the groups trust.
    owner: typeof g.owner?.login === 'string' ? g.owner.login : null,
    description: g.description ?? '',
    createdAt: g.created_at,
    updatedAt: g.updated_at,
    etag,
    files: Object.fromEntries(
      Object.entries(g.files ?? {}).map(([name, f]) => [name, { content: f !== null && typeof f.content === 'string' ? f.content : null, truncated: f?.truncated === true }]),
    ),
  }
}

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

const filesBody = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).map(([name, content]) => [name, { content }]))

export function gistsApi(client: GithubClient): GistsApi {
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
  return {
    serverTime: () => serverTime,
    async list(): Promise<GistListItem[]> {
      const out: GistListItem[] = []
      for (let page = 1; page <= MAX_PAGES; page++) {
        const answer = await request('/gists', { query: { per_page: String(PAGE), page: String(page) } })
        const items = asList(answer.data)
        out.push(...items.map((g) => ({ id: g.id, description: g.description ?? '', files: Object.keys(g.files ?? {}), createdAt: g.created_at, updatedAt: g.updated_at })))
        if (items.length < PAGE) break
      }
      return out
    },
    async read(id, etag) {
      const answer = await request(gistPath(id), etag ? { etag } : {})
      if (answer.status === 304) return 'unchanged'
      return toDoc(answer.data, answer.etag)
    },
    async create(description, files) {
      const answer = await request('/gists', { method: 'POST', body: { description, public: false, files: filesBody(files) } })
      return toDoc(answer.data, answer.etag)
    },
    async update(id, files) {
      const answer = await request(gistPath(id), { method: 'PATCH', body: { files: filesBody(files) } })
      return { gist: answer.data === null ? null : toDoc(answer.data, answer.etag), rate: gistRate(answer.rateLimit) }
    },
    async remove(id) {
      await request(gistPath(id), { method: 'DELETE' })
    },
  }
}
