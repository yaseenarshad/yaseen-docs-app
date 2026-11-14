import { GistError, type GistDoc, type GistErrorCode, type GistListItem, type GistRate, type GistsApi } from './friendGists'

/**
 * TEST HELP ONLY (YAZ-5082): a fake GitHub gist API in memory, so no test calls the real one. The phone's tests put it
 * behind `fetch` (`mobile/src/friends/testing.ts`); the shared tests and the Mac sender (4E5) use `api(token)`.
 *
 * It answers as GitHub did in proof 1C (YAZ-5064): secret gists; any token (or none) reads a gist by its ID; only the
 * owner writes; a write without the Gists permission is 403; a deleted gist is 404 at once (with a token); a weak ETag
 * and a free 304; `PATCH` counts on `gist_update`, 100 an hour for the ACCOUNT (all its tokens); a list holds file names,
 * not file text. IDs are 32 hex characters, not in the order of creation (as on GitHub), and `created_at` has whole
 * seconds, so two gists made in one second tie on time.
 */
export interface FakeGistAccount {
  login: string
  /** The account permission "Gists" (write). Default true. */
  gists?: boolean
}

export interface FakeGist {
  id: string
  owner: string
  description: string
  public: boolean
  files: Record<string, string>
  createdAt: number
  updatedAt: number
  version: number
}

export type FakeGistOp = 'list' | 'read' | 'create' | 'update' | 'remove'

export interface FakeGistCall {
  op: FakeGistOp
  id: string | null
  token: string | null
  /** The status of the answer, or 0 for no answer (offline). */
  answer: number
  /** The clock time of the call. */
  at: number
  /** The path and query of the call, as an address on the API. */
  url: string
}

export interface FakeHttpAnswer {
  status: number
  body: unknown
  headers: Record<string, string>
}

export interface FakeGistWorld {
  now(): number
  /** Moves the fake clock on (only when the world has its own clock: `start`). */
  advance(ms: number): void
  calls: FakeGistCall[]
  /** No answer at all: each call fails as a lost connection. */
  offline: boolean
  /** Consulted on each call; a code makes THAT call fail so, then it clears itself. */
  failNext: ((call: { op: FakeGistOp; id: string | null }) => GistErrorCode | undefined) | null
  /** From now on, each call waits 0 to 3 ms at random (seeded), so two devices interleave in many orders. */
  shuffle(seed: number): void
  revoke(token: string): void
  /** The gists of an account, oldest first. */
  owned(login: string): FakeGist[]
  /** A file's text, or null when the gist or the file is not there. */
  text(id: string, file: string): string | null
  /** All `PATCH` calls that the account made (GitHub's `gist_update`), ever. */
  updates(login: string): number
  /** Test only: replace all the files of a gist, with no count. */
  setFiles(id: string, files: Record<string, string>): void
  /** Test only: a gist of `login`, made with no call. */
  seed(login: string, files: Record<string, string>, description?: string): string
  /** One call as GitHub's HTTP API answers it. `undefined` for no answer (offline). */
  http(method: string, path: string, query: URLSearchParams, token: string | null, body: unknown, etag: string | null): Promise<FakeHttpAnswer | undefined>
  /** The gist API for one token, in memory (as an adapter on a real client gives it). */
  api(token: string): GistsApi
}

export const FAKE_GIST_LIMIT = 100
const HOUR = 3600_000

export function fakeGistWorld(setup: { accounts: Record<string, FakeGistAccount>; start?: number; now?: () => number }): FakeGistWorld {
  const accounts = new Map(Object.entries(setup.accounts))
  const gists = new Map<string, FakeGist>()
  const patchTimes = new Map<string, number[]>()
  const patchCount = new Map<string, number>()
  let clock = setup.start ?? Date.parse('2026-11-14T06:00:00Z')
  const now = setup.now ?? (() => clock)
  let made = 0
  let rng: (() => number) | null = null

  const newId = () => {
    // A mixed counter: unique, 32 hex, and not in the order of creation.
    let h = (++made * 2654435761) >>> 0
    let out = ''
    for (let i = 0; i < 4; i++) {
      h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0
      h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0
      out += h.toString(16).padStart(8, '0')
    }
    return out
  }
  const iso = (ms: number) => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z')
  const etagOf = (g: FakeGist) => `W/"${g.id.slice(0, 8)}${g.version.toString(16).padStart(8, '0')}"`
  const full = (g: FakeGist) => ({
    id: g.id,
    description: g.description,
    public: g.public,
    owner: { login: g.owner },
    created_at: iso(g.createdAt),
    updated_at: iso(g.updatedAt),
    files: Object.fromEntries(Object.entries(g.files).map(([name, content]) => [name, { filename: name, size: content.length, truncated: false, content, raw_url: `https://gist.githubusercontent.com/${g.owner}/${g.id}/raw/${g.version}/${name}` }])),
  })
  const window = (login: string) => {
    const t = now()
    const times = (patchTimes.get(login) ?? []).filter((at) => at > t - HOUR)
    patchTimes.set(login, times)
    return times
  }
  const gistRate = (login: string): Record<string, string> => {
    const times = window(login)
    const reset = times.length > 0 ? times[0] + HOUR : now() + HOUR
    return {
      'x-ratelimit-resource': 'gist_update',
      'x-ratelimit-limit': String(FAKE_GIST_LIMIT),
      'x-ratelimit-remaining': String(Math.max(0, FAKE_GIST_LIMIT - times.length)),
      'x-ratelimit-used': String(times.length),
      'x-ratelimit-reset': String(Math.ceil(reset / 1000)),
    }
  }
  // Each answer carries GitHub's time in `date` (YAZ-5238: the sweep measures age with it, never with a device clock).
  const answer = (status: number, body: unknown = null, headers: Record<string, string> = {}): FakeHttpAnswer => ({ status, body, headers: { date: new Date(now()).toUTCString(), ...headers } })
  const notFound = () => answer(404, { message: 'Not Found', documentation_url: 'https://docs.github.com/rest/gists/gists' })
  const refused = () => answer(403, { message: 'Resource not accessible by personal access token' })
  const failWith = (code: GistErrorCode, login: string | null): FakeHttpAnswer | undefined => {
    switch (code) {
      case 'OFFLINE':
        return undefined
      case 'RATE_LIMITED':
        return answer(403, { message: 'API rate limit exceeded' }, { ...(login ? gistRate(login) : {}), 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.ceil((now() + 10 * 60_000) / 1000)) })
      case 'NOT_FOUND':
        return notFound()
      case 'READ_ONLY':
      case 'NO_ACCESS':
        return refused()
      case 'UNAUTHORIZED':
        return answer(401, { message: 'Bad credentials' })
      case 'GITHUB_DOWN':
        return answer(503, null)
      default:
        return answer(422, { message: 'Validation Failed' })
    }
  }

  const world: FakeGistWorld = {
    now,
    advance(ms) {
      clock += ms
    },
    calls: [],
    offline: false,
    failNext: null,
    shuffle(seed) {
      let s = seed * 9301 + 49297
      rng = () => {
        s = (s * 9301 + 49297) % 233280
        return s / 233280
      }
    },
    revoke: (token) => void accounts.delete(token),
    owned: (login) => [...gists.values()].filter((g) => g.owner === login).sort((a, b) => a.createdAt - b.createdAt),
    text: (id, file) => gists.get(id)?.files[file] ?? null,
    updates: (login) => patchCount.get(login) ?? 0,
    setFiles(id, files) {
      const g = gists.get(id)
      if (!g) throw new Error('no such gist')
      g.files = { ...files }
      g.version++
    },
    seed(login, files, description = '') {
      const id = newId()
      gists.set(id, { id, owner: login, description, public: false, files: { ...files }, createdAt: now(), updatedAt: now(), version: 1 })
      return id
    },
    async http(method, path, query, token, body, etag) {
      if (rng !== null) await new Promise((done) => setTimeout(done, Math.floor(rng!() * 4)))
      else await Promise.resolve()
      const parts = path.split('/').filter(Boolean)
      const id = parts[0] === 'gists' && parts.length === 2 ? parts[1] : null
      const op: FakeGistOp = method === 'GET' ? (id === null ? 'list' : 'read') : method === 'POST' ? 'create' : method === 'PATCH' ? 'update' : 'remove'
      const call: FakeGistCall = { op, id, token, answer: 0, at: now(), url: `${path}${[...query].length > 0 ? `?${query}` : ''}` }
      world.calls.push(call)
      const done = (a: FakeHttpAnswer | undefined) => {
        call.answer = a?.status ?? 0
        if (a !== undefined && a.headers.date === undefined) a.headers = { date: new Date(now()).toUTCString(), ...a.headers }
        return a
      }
      if (world.offline) return done(undefined)
      const who = token === null ? undefined : accounts.get(token)
      const forced = world.failNext?.({ op, id })
      if (forced !== undefined) {
        world.failNext = null
        return done(failWith(forced, who?.login ?? null))
      }
      if (token !== null && who === undefined) return done(answer(401, { message: 'Bad credentials' }))
      if (parts[0] !== 'gists' || parts.length > 2) return done(notFound())

      if (op === 'list') {
        if (who === undefined) return done(answer(401, { message: 'Requires authentication' }))
        const perPage = Math.min(100, Number(query.get('per_page') ?? 30))
        const page = Math.max(1, Number(query.get('page') ?? 1))
        const mine = world.owned(who.login).reverse()
        const slice = mine.slice((page - 1) * perPage, page * perPage)
        return done(
          answer(
            200,
            slice.map((g) => {
              const f = full(g)
              return { ...f, files: Object.fromEntries(Object.entries(f.files).map(([name, file]) => [name, { filename: name, size: file.size, raw_url: file.raw_url }])) }
            }),
          ),
        )
      }
      if (op === 'read') {
        const g = gists.get(id!)
        if (g === undefined) return done(notFound())
        if (etag !== null && etag === etagOf(g)) return done(answer(304, null, { etag }))
        return done(answer(200, full(g), { etag: etagOf(g), 'cache-control': 'private, max-age=60, s-maxage=60' }))
      }
      if (who === undefined) return done(answer(401, { message: 'Requires authentication' }))
      const b = (body ?? {}) as { description?: unknown; public?: unknown; files?: Record<string, { content?: unknown } | null> }
      if (op === 'create') {
        if (!(who.gists ?? true)) return done(refused())
        const files = Object.entries(b.files ?? {}).filter(([, f]) => f !== null && typeof f.content === 'string')
        if (files.length === 0) return done(answer(422, { message: 'Validation Failed', errors: [{ resource: 'Gist', code: 'missing_field', field: 'files' }] }))
        const newOne: FakeGist = {
          id: newId(),
          owner: who.login,
          description: typeof b.description === 'string' ? b.description : '',
          public: b.public === true,
          files: Object.fromEntries(files.map(([name, f]) => [name, f!.content as string])),
          createdAt: now(),
          updatedAt: now(),
          version: 1,
        }
        gists.set(newOne.id, newOne)
        return done(answer(201, full(newOne), { etag: etagOf(newOne) }))
      }
      const g = gists.get(id!)
      if (g === undefined || g.owner !== who.login) return done(notFound())
      if (!(who.gists ?? true)) return done(refused())
      if (op === 'remove') {
        gists.delete(g.id)
        return done(answer(204))
      }
      // PATCH: GitHub's own count, 100 an hour for the account.
      if (window(who.login).length >= FAKE_GIST_LIMIT) return done(failWith('RATE_LIMITED', who.login))
      for (const [name, f] of Object.entries(b.files ?? {})) {
        if (f === null) delete g.files[name]
        else if (typeof f.content === 'string') g.files[name] = f.content
      }
      g.version++
      g.updatedAt = now()
      window(who.login).push(now())
      patchCount.set(who.login, (patchCount.get(who.login) ?? 0) + 1)
      return done(answer(200, full(g), { etag: etagOf(g), ...gistRate(who.login) }))
    },
    api(token) {
      return memoryApi(world, token)
    },
  }
  return world
}

/** The in-memory adapter: the same typed errors as the phone's client (3E). */
function memoryApi(world: FakeGistWorld, token: string): GistsApi {
  let serverTime: number | null = null
  const call = async (method: string, path: string, query: Record<string, string> = {}, body: unknown = undefined, etag: string | null = null) => {
    const a = await world.http(method, path, new URLSearchParams(query), token, body, etag)
    if (a === undefined) throw new GistError('OFFLINE', 'No connection to GitHub')
    const date = Date.parse(a.headers.date ?? '')
    if (Number.isFinite(date)) serverTime = date
    if (a.status === 304 || (a.status >= 200 && a.status < 300)) return a
    const rate = rateOf(a.headers)
    if ((a.status === 403 || a.status === 429) && a.headers['x-ratelimit-remaining'] === '0')
      throw new GistError('RATE_LIMITED', 'GitHub answered with its rate limit', Math.max(world.now() + 60_000, Number(a.headers['x-ratelimit-reset']) * 1000), rate)
    if (a.status === 401) throw new GistError('UNAUTHORIZED', 'GitHub answered 401')
    if (a.status === 403) throw new GistError(method === 'GET' ? 'NO_ACCESS' : 'READ_ONLY', 'GitHub answered 403')
    if (a.status === 404) throw new GistError('NOT_FOUND', 'GitHub answered 404')
    if (a.status >= 500) throw new GistError('GITHUB_DOWN', `GitHub answered ${a.status}`)
    throw new GistError('UNEXPECTED', `GitHub answered ${a.status}`)
  }
  return {
    async list() {
      const out: GistListItem[] = []
      for (let page = 1; page <= 10; page++) {
        const a = await call('GET', '/gists', { per_page: '100', page: String(page) })
        const items = a.body as RawGist[]
        out.push(...items.map(listItem))
        if (items.length < 100) break
      }
      return out
    },
    async read(id, etag) {
      const a = await call('GET', `/gists/${id}`, {}, undefined, etag ?? null)
      if (a.status === 304) return 'unchanged'
      return doc(a.body as RawGist, a.headers.etag ?? null)
    },
    async create(description, files) {
      const a = await call('POST', '/gists', {}, { description, public: false, files: Object.fromEntries(Object.entries(files).map(([n, c]) => [n, { content: c }])) })
      return doc(a.body as RawGist, a.headers.etag ?? null)
    },
    async update(id, files) {
      const a = await call('PATCH', `/gists/${id}`, {}, { files: Object.fromEntries(Object.entries(files).map(([n, c]) => [n, { content: c }])) })
      return { gist: doc(a.body as RawGist, a.headers.etag ?? null), rate: rateOf(a.headers) }
    },
    async remove(id) {
      await call('DELETE', `/gists/${id}`)
    },
    serverTime: () => serverTime,
  }
}

interface RawGist {
  id: string
  owner?: { login?: string }
  description: string | null
  created_at: string
  updated_at: string
  files: Record<string, { content?: string; truncated?: boolean }>
}
const listItem = (g: RawGist): GistListItem => ({ id: g.id, description: g.description ?? '', files: Object.keys(g.files), createdAt: g.created_at, updatedAt: g.updated_at })
const doc = (g: RawGist, etag: string | null): GistDoc => ({
  id: g.id,
  owner: g.owner?.login ?? null,
  description: g.description ?? '',
  createdAt: g.created_at,
  updatedAt: g.updated_at,
  etag,
  files: Object.fromEntries(Object.entries(g.files).map(([n, f]) => [n, { content: typeof f.content === 'string' ? f.content : null, truncated: f.truncated === true }])),
})
function rateOf(h: Record<string, string>): GistRate | null {
  if (h['x-ratelimit-resource'] !== 'gist_update') return null
  return { remaining: Number(h['x-ratelimit-remaining']), limit: Number(h['x-ratelimit-limit']), resetAt: Number(h['x-ratelimit-reset']) * 1000 }
}
