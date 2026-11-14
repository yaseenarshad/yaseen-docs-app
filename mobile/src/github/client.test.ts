import { describe, expect, it } from 'vitest'
import { GITHUB_API, GithubError, githubClient, repoPath, type FetchLike } from './client'

const TOKEN = 'github_pat_11SECRETSECRET0000000000_secretsecretsecretsecretsecretsecretsecretsecretsecretsecretsecret'

/** A fetch that answers every call with `answer`, and keeps what was asked. */
function recorder(answer: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init })
    return answer(url, init)
  }
  return { fetch, calls }
}
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

async function failure(promise: Promise<unknown>): Promise<GithubError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof GithubError) return error
    throw error
  }
  throw new Error('expected a GithubError')
}

describe('githubClient: the one way the phone talks to GitHub', () => {
  it('sends the token only to api.github.com, in the Authorization header, with no cookies and no cache', async () => {
    const { fetch, calls } = recorder(() => json(200, { login: 'yaseen' }))
    const res = await githubClient(TOKEN, { fetch }).request('/user')
    expect(res.status).toBe(200)
    expect(res.data).toEqual({ login: 'yaseen' })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`${GITHUB_API}/user`)
    const headers = new Headers(calls[0].init.headers)
    expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`)
    expect(headers.get('accept')).toBe('application/vnd.github+json')
    expect(headers.get('x-github-api-version')).toBe('2022-11-28')
    expect(calls[0].init.credentials).toBe('omit')
    expect(calls[0].init.cache).toBe('no-store')
    expect(calls[0].init.referrerPolicy).toBe('no-referrer')
    expect(calls[0].url).not.toContain(TOKEN)
  })

  it.each([
    'https://evil.example/user',
    '//evil.example/user',
    'user',
    '/\\evil.example',
    '/user@evil.example',
    '/repos/../../x',
    `/user?access_token=${TOKEN}`,
  ])('refuses a path that could leave api.github.com or carry the token: %s', async (path) => {
    const { fetch, calls } = recorder(() => json(200, {}))
    await expect(githubClient(TOKEN, { fetch }).request(path)).rejects.toThrow(/not a GitHub API path/)
    expect(calls).toHaveLength(0)
  })

  it('adds a query from `query`, encoded; a query cannot be written into the path', async () => {
    const { fetch, calls } = recorder(() => json(200, []))
    await githubClient(TOKEN, { fetch }).request('/repos/a/b/contents/.yaseendocs', { query: { ref: 'feat/phone #1' } })
    expect(calls[0].url).toBe(`${GITHUB_API}/repos/a/b/contents/.yaseendocs?ref=feat%2Fphone+%231`)
  })

  it('gives the rate numbers of each answer, with the resource (gist updates have their own 100 an hour)', async () => {
    const { fetch } = recorder(() =>
      json(200, {}, { 'x-ratelimit-limit': '100', 'x-ratelimit-remaining': '97', 'x-ratelimit-used': '3', 'x-ratelimit-reset': '1794571200', 'x-ratelimit-resource': 'gist_update' }),
    )
    const res = await githubClient(TOKEN, { fetch }).request('/gists/g1', { method: 'PATCH', body: {} })
    expect(res.rateLimit).toEqual({ resource: 'gist_update', limit: 100, remaining: 97, used: 3, resetAt: 1794571200_000 })
    const none = await githubClient(TOKEN, { fetch: recorder(() => json(200, {})).fetch }).request('/user')
    expect(none.rateLimit).toBeNull()
  })

  it("an error keeps GitHub's message and the rate numbers (3B: 422 \"Update is not a fast forward\" is STALE_HEAD)", async () => {
    const { fetch } = recorder(() => json(422, { message: 'Update is not a fast forward', status: '422' }, { 'x-ratelimit-resource': 'core', 'x-ratelimit-remaining': '4000' }))
    const error = await failure(githubClient(TOKEN, { fetch }).request('/repos/a/b/git/refs/heads/main', { method: 'PATCH', body: { sha: 'x', force: false } }))
    expect(error).toMatchObject({ code: 'UNEXPECTED', status: 422, said: 'Update is not a fast forward' })
    expect(error.rateLimit).toMatchObject({ resource: 'core', remaining: 4000 })
  })

  it('sends a JSON body with the method', async () => {
    const { fetch, calls } = recorder(() => json(201, { sha: 'abc' }))
    await githubClient(TOKEN, { fetch }).request('/repos/a/b/git/blobs', { method: 'POST', body: { content: 'x', encoding: 'utf-8' } })
    expect(calls[0].init.method).toBe('POST')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ content: 'x', encoding: 'utf-8' })
    expect(new Headers(calls[0].init.headers).get('content-type')).toBe('application/json')
  })

  it('a poll with an ETag sends If-None-Match and returns a 304 as a normal answer (3B: the free poll)', async () => {
    const { fetch, calls } = recorder(() => new Response(null, { status: 304, headers: { etag: '"e1"' } }))
    const res = await githubClient(TOKEN, { fetch }).request('/repos/a/b/branches/main', { etag: '"e1"' })
    expect(new Headers(calls[0].init.headers).get('if-none-match')).toBe('"e1"')
    expect(res.status).toBe(304)
    expect(res.etag).toBe('"e1"')
    expect(res.data).toBeNull()
  })

  it('returns bytes when asked for raw content (3B: a blob)', async () => {
    const { fetch, calls } = recorder(() => new Response(new Uint8Array([1, 2, 3]), { status: 200 }))
    const res = await githubClient(TOKEN, { fetch }).request('/repos/a/b/git/blobs/s1', { accept: 'application/vnd.github.raw+json', raw: true })
    expect(new Headers(calls[0].init.headers).get('accept')).toBe('application/vnd.github.raw+json')
    expect(res.data).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('returns a status from `allow` instead of throwing (the probes; 3B: the moved branch)', async () => {
    const { fetch } = recorder(() => json(422, { message: 'Validation Failed' }))
    const res = await githubClient(TOKEN, { fetch }).request('/gists', { method: 'POST', body: {}, allow: [422] })
    expect(res.status).toBe(422)
  })

  describe('typed failures', () => {
    const NOW = Date.UTC(2026, 10, 13, 12)
    const cases: [string, () => Response | Promise<Response>, string, Partial<GithubError>?][] = [
      ['401: a wrong, expired or cancelled token', () => json(401, { message: 'Bad credentials' }), 'UNAUTHORIZED'],
      ['403 on a read', () => json(403, { message: 'Resource not accessible by personal access token' }), 'NO_ACCESS'],
      ['404', () => json(404, { message: 'Not Found' }), 'NOT_FOUND'],
      ['403 with no requests left this hour', () => json(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(NOW / 1000 + 600) }), 'RATE_LIMITED', { resetAt: NOW + 600_000 }],
      ['429 with Retry-After (the secondary limit)', () => json(429, { message: 'slow down' }, { 'retry-after': '60' }), 'RATE_LIMITED', { resetAt: NOW + 60_000 }],
      ['403 with Retry-After (the secondary limit)', () => json(403, { message: 'You have exceeded a secondary rate limit' }, { 'retry-after': '30' }), 'RATE_LIMITED', { resetAt: NOW + 30_000 }],
      ['500', () => json(500, {}), 'GITHUB_DOWN'],
      ['503 with no body', () => new Response('<html>down</html>', { status: 503 }), 'GITHUB_DOWN'],
      ['no network (fetch rejects)', () => Promise.reject(new TypeError('Load failed')), 'OFFLINE'],
      ['418, a status nothing expects', () => json(418, {}), 'UNEXPECTED'],
    ]
    it.each(cases)('%s', async (_, answer, code, more) => {
      const { fetch } = recorder(answer)
      const error = await failure(githubClient(TOKEN, { fetch, now: () => NOW }).request('/user'))
      expect(error.code).toBe(code)
      if (more) expect(error).toMatchObject(more)
    })

    it('403 on a write is READ_ONLY: the token can read but not write (row "only read access")', async () => {
      const { fetch } = recorder(() => json(403, { message: 'Resource not accessible by personal access token' }))
      const error = await failure(githubClient(TOKEN, { fetch }).request('/repos/a/b/git/blobs', { method: 'POST', body: {} }))
      expect(error.code).toBe('READ_ONLY')
      expect(error.status).toBe(403)
    })

    it('an error never holds the token, even when the answer quotes it', async () => {
      const { fetch } = recorder(() => json(401, { message: `Bad credentials for ${TOKEN}` }))
      const error = await failure(githubClient(TOKEN, { fetch }).request('/user'))
      expect(error.message).not.toContain(TOKEN)
      expect(String(error.stack)).not.toContain(TOKEN)
      expect(JSON.stringify(error)).not.toContain(TOKEN)
      expect(JSON.stringify({ ...error })).not.toContain(TOKEN)
    })

    it('an offline error does not keep the fetch error object (it could hold the request)', async () => {
      const { fetch } = recorder(() => Promise.reject(new TypeError(`Failed: Bearer ${TOKEN}`)))
      const error = await failure(githubClient(TOKEN, { fetch }).request('/user'))
      expect(error.code).toBe('OFFLINE')
      expect(error.message).not.toContain(TOKEN)
      expect(error.cause).toBeUndefined()
    })
  })

  it('repoPath encodes each part, and keeps the slashes of a branch name', () => {
    expect(repoPath('Yaseen/My.Vault', 'branches', 'feat/phone #1')).toBe('/repos/Yaseen/My.Vault/branches/feat/phone%20%231')
    expect(() => repoPath('not a repo', 'x')).toThrow()
  })
})
