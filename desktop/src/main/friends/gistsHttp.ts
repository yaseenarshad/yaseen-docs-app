/**
 * THE MAC'S GIST CALLS (YAZ-5086, 4E5), in the MAIN process: the `GistsApi` of `shared/friendGists.ts` on Node's
 * `fetch`, with the GitHub token from the app's one secrets store. The shared send rules run on it unchanged.
 * - The token goes in the Authorization header only, to `api.github.com` only, and never along a redirect. No renderer
 *   ever sees it.
 * - Each failure is a `GistError` with the codes of the phone's client (3E): `READ_ONLY` for a write with no Gists
 *   permission, `RATE_LIMITED` with `resetAt`, `OFFLINE`, `GITHUB_DOWN`, `UNAUTHORIZED`, `NOT_FOUND`, `NO_ACCESS`.
 * - A message holds the status only: never the token, a gist ID or an address.
 */
import { GistError, isGistId, type GistDoc, type GistErrorCode, type GistListItem, type GistRate, type GistsApi } from '@shared/friendGists'

export const GITHUB_API = 'https://api.github.com'
/** A request with no answer this long is OFFLINE. */
export const REQUEST_TIMEOUT_MS = 30_000
/** The floor and the ceiling of a rate-limit wait (as 3E: GitHub's advice, and its hourly reset). */
const MIN_RATE_WAIT_MS = 60_000
const MAX_RATE_WAIT_MS = 60 * 60_000
const PAGE = 100
const MAX_PAGES = 10

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal; redirect?: 'manual' }) => Promise<Response>

interface RawGist {
  id: string
  description: string | null
  created_at: string
  updated_at: string
  files: Record<string, { content?: unknown; truncated?: unknown } | null>
}

function toDoc(data: unknown, etag: string | null): GistDoc {
  const g = data as RawGist
  return {
    id: g.id,
    description: g.description ?? '',
    createdAt: g.created_at,
    updatedAt: g.updated_at,
    etag,
    files: Object.fromEntries(Object.entries(g.files ?? {}).map(([name, f]) => [name, { content: f !== null && typeof f.content === 'string' ? f.content : null, truncated: f?.truncated === true }])),
  }
}

/** GitHub's `gist_update` count from an answer's headers, or null for another resource. */
function gistRate(headers: Headers): GistRate | null {
  if (headers.get('x-ratelimit-resource') !== 'gist_update') return null
  const num = (name: string) => {
    const v = Number(headers.get(name))
    return headers.get(name) === null || !Number.isFinite(v) ? null : v
  }
  const reset = num('x-ratelimit-reset')
  return { remaining: num('x-ratelimit-remaining'), limit: num('x-ratelimit-limit'), resetAt: reset === null ? null : reset * 1000 }
}

const waitUntil = (at: number | null, now: number) => Math.min(now + MAX_RATE_WAIT_MS, Math.max(now + MIN_RATE_WAIT_MS, at ?? 0))

/** The failure of an answer, as the phone's client (3E) reads it. */
async function failure(response: Response, method: string, now: number): Promise<GistError> {
  const { status, headers } = response
  const said = await response.text().then(
    (t) => {
      try {
        const m = (JSON.parse(t) as { message?: unknown }).message
        return typeof m === 'string' ? m : ''
      } catch {
        return ''
      }
    },
    () => '',
  )
  const make = (code: GistErrorCode, resetAt: number | null = null) => new GistError(code, `GitHub answered ${status}`, resetAt, gistRate(headers))
  const retry = Number(headers.get('retry-after')?.trim() || NaN)
  if ((status === 403 || status === 429) && Number.isFinite(retry)) return make('RATE_LIMITED', waitUntil(now + retry * 1000, now))
  if ((status === 403 || status === 429) && headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(headers.get('x-ratelimit-reset'))
    return make('RATE_LIMITED', waitUntil(Number.isFinite(reset) && reset > 0 ? reset * 1000 : null, now))
  }
  if ((status === 403 || status === 429) && /secondary rate limit|abuse detection/i.test(said)) return make('RATE_LIMITED', waitUntil(null, now))
  if (status === 429) return make('RATE_LIMITED', waitUntil(null, now))
  if (status === 401) return make('UNAUTHORIZED')
  if (status === 403) return make(method === 'GET' ? 'NO_ACCESS' : 'READ_ONLY')
  if (status === 404) return make('NOT_FOUND')
  if (status >= 500) return make('GITHUB_DOWN')
  return make('UNEXPECTED')
}

interface Answer {
  status: number
  data: unknown
  etag: string | null
  rate: GistRate | null
}

/** One call to the API with the token. Throws a `GistError`, never an error that holds the token or the address. */
async function call(token: string, fetch: FetchLike, now: () => number, path: string, init: { method?: string; body?: unknown; etag?: string | null } = {}): Promise<Answer> {
  const method = init.method ?? 'GET'
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'x-github-api-version': '2022-11-28',
    'user-agent': 'YaseenDocs',
  }
  if (init.body !== undefined) headers['content-type'] = 'application/json'
  if (init.etag) headers['if-none-match'] = init.etag
  let response: Response
  try {
    // `manual`: a redirect is never followed, so the token never goes to another address (YAZ-5253). A 3xx is a failure.
    response = await fetch(`${GITHUB_API}${path}`, { method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), redirect: 'manual' })
  } catch {
    throw new GistError('OFFLINE', 'No connection to GitHub')
  }
  if (response.status === 304) return { status: 304, data: null, etag: init.etag ?? null, rate: gistRate(response.headers) }
  if (response.status < 200 || response.status >= 300) throw await failure(response, method, now())
  let data: unknown = null
  try {
    const text = await response.text()
    data = text === '' ? null : (JSON.parse(text) as unknown)
  } catch {
    throw new GistError('OFFLINE', 'The answer of GitHub stopped')
  }
  return { status: response.status, data, etag: response.headers.get('etag'), rate: gistRate(response.headers) }
}

/** A gist ID goes into a path: anything but hex is refused before a call (a friend's pointer is untrusted). */
function gistPath(id: string): string {
  if (!isGistId(id)) throw new GistError('UNEXPECTED', 'This is not a gist ID')
  return `/gists/${id.toLowerCase()}`
}

const filesBody = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).map(([name, content]) => [name, { content }]))

export function macGistsApi(token: string, fetch: FetchLike, now: () => number = Date.now): GistsApi {
  const go = (path: string, init?: Parameters<typeof call>[4]) => call(token, fetch, now, path, init)
  return {
    async list(): Promise<GistListItem[]> {
      const out: GistListItem[] = []
      for (let page = 1; page <= MAX_PAGES; page++) {
        const { data } = await go(`/gists?per_page=${PAGE}&page=${page}`)
        const items = (Array.isArray(data) ? data : []).filter((g): g is RawGist => g !== null && typeof g === 'object' && typeof (g as RawGist).id === 'string')
        out.push(...items.map((g) => ({ id: g.id, description: g.description ?? '', files: Object.keys(g.files ?? {}), createdAt: g.created_at, updatedAt: g.updated_at })))
        if (items.length < PAGE) break
      }
      return out
    },
    async read(id, etag) {
      const answer = await go(gistPath(id), { etag })
      return answer.status === 304 ? 'unchanged' : toDoc(answer.data, answer.etag)
    },
    async create(description, files) {
      const answer = await go('/gists', { method: 'POST', body: { description, public: false, files: filesBody(files) } })
      return toDoc(answer.data, answer.etag)
    },
    async update(id, files) {
      const answer = await go(gistPath(id), { method: 'PATCH', body: { files: filesBody(files) } })
      return { gist: answer.data === null ? null : toDoc(answer.data, answer.etag), rate: answer.rate }
    },
    async remove(id) {
      await go(gistPath(id), { method: 'DELETE' })
    },
  }
}

/** Who sends (`GET /user`): the login, the profile name, the picture. The same facts as the phone's (3E). */
export async function readProfile(token: string, fetch: FetchLike, now: () => number = Date.now): Promise<{ login: string; name: string | null; avatar: string }> {
  const { data } = await call(token, fetch, now, '/user')
  const u = (data ?? {}) as { login?: unknown; name?: unknown; avatar_url?: unknown }
  if (typeof u.login !== 'string') throw new GistError('UNEXPECTED', 'GitHub gave no login')
  return { login: u.login, name: typeof u.name === 'string' ? u.name : null, avatar: typeof u.avatar_url === 'string' ? u.avatar_url : '' }
}
