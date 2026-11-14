/**
 * The phone's one way to talk to GitHub (3E builds it; 3B adds the sync calls on top). Every call goes through
 * `request`, which:
 * - sends to `https://api.github.com` only: it takes a path, never an address, so the token cannot go elsewhere;
 * - puts the token in the Authorization header only, never in an address, an error or a log;
 * - turns each failure into one typed `GithubError` code.
 * Tests pass a fake `fetch` (`github/testing.ts`), so no test calls the real API.
 */

export const GITHUB_API = 'https://api.github.com'
/** The REST API version the phone is written against. */
export const API_VERSION = '2022-11-28'

/** The part of `fetch` the client uses. The app passes the browser's; tests pass a fake. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

/**
 * - `UNAUTHORIZED`: 401, the token is wrong, expired or cancelled (rows F3, N6). Red status, "Sign in again".
 * - `NO_ACCESS`: 403 on a read: the token may not read this.
 * - `READ_ONLY`: 403 on a write: the token can read but not write (the row "only read access"; an archived repo).
 * - `NOT_FOUND`: 404. For a private repo GitHub also answers 404 when the token may not see it (row F4, R12).
 * - `RATE_LIMITED`: the hourly limit, or GitHub's "slow down"; `resetAt` says when to try again (N4, round 10 item 20).
 * - `OFFLINE`: no answer at all (N1, N2).
 * - `GITHUB_DOWN`: a 5xx answer (N5).
 * - `UNEXPECTED`: any other status, with GitHub's message in `said`.
 * - `STALE_HEAD` (3B, `GithubRemote.commit`): the branch moved past the commit's parent. The ref `PATCH` with
 *   `force: false` answered 422 "Update is not a fast forward" (proof 1B). Read the head again and repeat (3C).
 * - `TREE_TRUNCATED` (3B, `GithubRemote.tree`): GitHub cut the recursive file list short (row F6).
 * Real codes (proof 1B): a bad token 401; a wrong repo, a wrong branch, a private repo with no access 404.
 */
export type GithubErrorCode = 'UNAUTHORIZED' | 'NO_ACCESS' | 'READ_ONLY' | 'NOT_FOUND' | 'RATE_LIMITED' | 'OFFLINE' | 'GITHUB_DOWN' | 'UNEXPECTED' | 'STALE_HEAD' | 'TREE_TRUNCATED'

/** GitHub's advice for its secondary limit when the answer has no `Retry-After`: wait at least one minute. */
export const SECONDARY_LIMIT_WAIT_MS = 60_000
/**
 * The floor and the ceiling of every rate-limit wait (YAZ-5174, YAZ-5169). GitHub's headers can give 0 s, less than 0 s
 * (`x-ratelimit-reset` is GitHub's clock; a fast phone clock puts it in the past) or years. Without a floor the app asks
 * again at once, in a loop; over 2^31-1 ms a browser timer fires at once. The floor is GitHub's advice (1 minute); the
 * ceiling is one hour, as GitHub's hourly limit resets within the hour.
 */
export const MIN_RATE_WAIT_MS = SECONDARY_LIMIT_WAIT_MS
export const MAX_RATE_WAIT_MS = 60 * 60_000
/** A request with no answer (no status, no error) stops after this (YAZ-5173), and reads as `OFFLINE`. */
export const REQUEST_TIMEOUT_MS = 30_000

/** When to try again: `until` (ms since 1970, or null: not said) held between the floor and the ceiling from `now`. */
export function rateLimitedUntil(until: number | null, now: number): number {
  const wait = until === null || !Number.isFinite(until) ? MIN_RATE_WAIT_MS : until - now
  return now + Math.min(MAX_RATE_WAIT_MS, Math.max(MIN_RATE_WAIT_MS, wait))
}

/**
 * GitHub's count for one resource, from the `x-ratelimit-*` headers (all of them are visible to a web page).
 * `resource` names the count: `core` for most calls, and `gist_update` for `PATCH /gists/{id}`, which has its own
 * 100 an hour for the account (proof 1C). Writes can carry a count of their own (proof 1B): read `resource`.
 */
export interface RateLimit {
  resource: string | null
  limit: number | null
  remaining: number | null
  used: number | null
  /** ms since 1970. */
  resetAt: number | null
}

export class GithubError extends Error {
  constructor(
    readonly code: GithubErrorCode,
    /** The HTTP status, or null when no answer came. */
    readonly status: number | null,
    message: string,
    /** For `RATE_LIMITED`: when to try again (ms since 1970), or null when GitHub did not say. */
    readonly resetAt: number | null = null,
    /**
     * GitHub's own `message`, with the token taken out. 3B matches it: a moved branch is 422 with
     * "Update is not a fast forward" (proof 1B) — `STALE_HEAD`.
     */
    readonly said: string = '',
    readonly rateLimit: RateLimit | null = null,
  ) {
    super(message)
    this.name = 'GithubError'
  }
}

export type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

export interface RequestOptions {
  method?: Method
  /** Sent as JSON. */
  body?: unknown
  /** The ETag of the last answer: sent as `If-None-Match`, so an unchanged answer is a free 304. */
  etag?: string
  /** The Accept header; the default is GitHub's JSON. 3B uses `application/vnd.github.raw+json` for a blob. */
  accept?: string
  /** Read the answer as bytes, not JSON. */
  raw?: boolean
  /**
   * Statuses (other than 2xx and 304) that come back as an answer, with the JSON body in `data`, not as a
   * `GithubError`. A rate limit is never allowed: it always throws `RATE_LIMITED`.
   */
  allow?: readonly number[]
  /** The query, encoded by the client (a path may not hold `?`). Never put the token here. */
  query?: Record<string, string>
}

export interface GithubResponse {
  status: number
  headers: Headers
  etag: string | null
  /** Parsed JSON; bytes with `raw`; null for a 304 or an empty body. */
  data: unknown
  /** The rate numbers of this answer, or null when it has none. */
  rateLimit: RateLimit | null
}

export interface GithubClient {
  /** One call to `api.github.com`. `path` starts with `/`, as `/user` or `repoPath(…)`. */
  request(path: string, options?: RequestOptions): Promise<GithubResponse>
}

export interface ClientOptions {
  fetch?: FetchLike
  /** The clock for `resetAt` from `Retry-After`. */
  now?: () => number
  /** The time limit of one request, ms (default REQUEST_TIMEOUT_MS). */
  timeoutMs?: number
}

/** A path on the API, never an address: it starts with one `/`, and has no host, no `..`, no `@`, no query. */
const SAFE_PATH = /^\/(?!\/)[A-Za-z0-9\-._~%/]*$/

/** `/repos/{owner}/{name}/…parts`, each part encoded. A branch keeps its slashes (`feat/phone`), as GitHub reads it. */
export function repoPath(repo: string, ...parts: string[]): string {
  const [owner, name, extra] = repo.split('/')
  if (!owner || !name || extra !== undefined) throw new Error('A repo is owner/name')
  const encode = (part: string) => part.split('/').map(encodeURIComponent).join('/')
  return ['', 'repos', encodeURIComponent(owner), encodeURIComponent(name), ...parts.map(encode)].join('/')
}

export function githubClient(token: string, options: ClientOptions = {}): GithubClient {
  const fetch = options.fetch ?? ((url: string, init: RequestInit) => globalThis.fetch(url, init))
  const now = options.now ?? Date.now
  /** GitHub's own message, with the token taken out, in case an answer ever quotes it. */
  const scrub = (text: string) => (token === '' ? text : text.split(token).join('[token]'))

  return {
    async request(path, opts = {}) {
      if (!SAFE_PATH.test(path) || path.split('/').includes('..')) throw new Error('This is not a GitHub API path')
      const method = opts.method ?? 'GET'
      const headers = new Headers({
        Accept: opts.accept ?? 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': API_VERSION,
      })
      if (opts.etag !== undefined) headers.set('If-None-Match', opts.etag)
      if (opts.body !== undefined) headers.set('Content-Type', 'application/json')

      let response: Response
      try {
        const query = opts.query === undefined ? '' : `?${new URLSearchParams(opts.query).toString()}`
        response = await fetch(`${GITHUB_API}${path}${query}`, {
          method,
          headers,
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
          // No cookies. No browser cache: the ETag is ours (3B), and answers made with the token stay off the disk.
          credentials: 'omit',
          // A request with no answer stops after REQUEST_TIMEOUT_MS (YAZ-5173). The abort reads as OFFLINE below.
          signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS) : undefined,
          cache: 'no-store',
          referrerPolicy: 'no-referrer',
        })
      } catch {
        // The fetch error is not kept: it can name the request. A CORS refusal looks the same as no network.
        throw new GithubError('OFFLINE', null, 'No connection to GitHub')
      }

      const etag = response.headers.get('etag')
      const rateLimit = readRateLimit(response.headers)
      if (response.status === 304) return { status: 304, headers: response.headers, etag, data: null, rateLimit }
      if (response.status >= 200 && response.status < 300) {
        const data = await offlineOnError(() => (opts.raw ? response.arrayBuffer().then((b) => new Uint8Array(b)) : readJson(response)))
        return { status: response.status, headers: response.headers, etag, data, rateLimit }
      }
      const body = await offlineOnError(() => readJson(response))
      const said = body !== null && typeof body === 'object' && typeof (body as { message?: unknown }).message === 'string' ? (body as { message: string }).message : ''
      const error = failure(response, method, scrub(said), now(), rateLimit)
      // A status in `allow` comes back as an answer (its JSON body in `data`), but a rate limit never does: a probe
      // that allows 403 must not read GitHub's "slow down" as "no access" (YAZ-5166).
      if (error.code !== 'RATE_LIMITED' && (opts.allow ?? []).includes(response.status))
        return { status: response.status, headers: response.headers, etag, data: body, rateLimit }
      throw error
    },
  }
}

/** A body that stops mid-way (no network, or the time limit's abort) is OFFLINE, as a request with no answer is. */
async function offlineOnError<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read()
  } catch {
    throw new GithubError('OFFLINE', null, 'No connection to GitHub')
  }
}

function readRateLimit(headers: Headers): RateLimit | null {
  const num = (name: string) => {
    const value = headers.get(name)
    const n = value === null ? NaN : Number(value)
    return Number.isFinite(n) ? n : null
  }
  const rate: RateLimit = {
    resource: headers.get('x-ratelimit-resource'),
    limit: num('x-ratelimit-limit'),
    remaining: num('x-ratelimit-remaining'),
    used: num('x-ratelimit-used'),
    resetAt: num('x-ratelimit-reset') === null ? null : num('x-ratelimit-reset')! * 1000,
  }
  return Object.values(rate).every((v) => v === null) ? null : rate
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text === '') return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function failure(response: Response, method: Method, said: string, now: number, rateLimit: RateLimit | null): GithubError {
  const { status, headers } = response
  const message = `GitHub answered ${status}${said ? `: ${said}` : ''}`
  const make = (code: GithubErrorCode, resetAt: number | null = null) => new GithubError(code, status, message, resetAt, said, rateLimit)
  // Each wait goes through `rateLimitedUntil`: never under 1 minute, never over 1 hour (YAZ-5174). An empty
  // `retry-after` is no `retry-after` (`Number('')` is 0); an HTTP date is not a number and falls through.
  const retryHeader = headers.get('retry-after')?.trim() ?? ''
  const retryAfter = retryHeader === '' ? NaN : Number(retryHeader)
  if ((status === 403 || status === 429) && Number.isFinite(retryAfter)) return make('RATE_LIMITED', rateLimitedUntil(now + retryAfter * 1000, now))
  if ((status === 403 || status === 429) && headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(headers.get('x-ratelimit-reset'))
    return make('RATE_LIMITED', rateLimitedUntil(Number.isFinite(reset) && reset > 0 ? reset * 1000 : null, now))
  }
  // GitHub's secondary limit ("slow down", round 10 item 20) can come with no Retry-After and with requests left. It is
  // not a missing permission: wait one minute, as GitHub advises, instead of reading it as NO_ACCESS or READ_ONLY.
  if ((status === 403 || status === 429) && /secondary rate limit|abuse detection/i.test(said)) return make('RATE_LIMITED', rateLimitedUntil(null, now))
  if (status === 429) return make('RATE_LIMITED', rateLimitedUntil(null, now))
  if (status === 401) return make('UNAUTHORIZED')
  if (status === 403) return make(method === 'GET' ? 'NO_ACCESS' : 'READ_ONLY')
  if (status === 404) return make('NOT_FOUND')
  if (status >= 500) return make('GITHUB_DOWN')
  return make('UNEXPECTED')
}
