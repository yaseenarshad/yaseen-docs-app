import { describe, expect, it } from 'vitest'
import { GITHUB_APP_CLIENT_ID } from '../src/auth/githubAppConfig'
import { GITHUB_TOKEN_URL, githubRevokeUrl, handle, type Env } from './index'

/** YAZ-5645 slice 1: the Worker's three routes, against a fake GitHub. No test calls the real one. */

const SITE = 'https://docs.yaseenarshad.com'
const SECRET = 'test-secret-not-real-0000'
const env = (more: Partial<Env> = {}): Env => ({ GITHUB_CLIENT_SECRET: SECRET, ...more })

interface Seen {
  url: string
  init: RequestInit
}
function fakeGithub(reply: (seen: Seen) => Response) {
  const calls: Seen[] = []
  const fetch = async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return reply({ url, init })
  }
  return { calls, fetch }
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const post = (path: string, body: unknown, headers: Record<string, string> = { origin: SITE }, site = SITE) =>
  new Request(`${site}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })

const PAIR = { access_token: 'ghu_access', expires_in: 28800, refresh_token: 'ghr_refresh', refresh_token_expires_in: 15897600, token_type: 'bearer', scope: '' }

describe('POST /api/github/token', () => {
  it('adds the secret and the client ID, sends the code and the PKCE verifier, and gives back only the pair', async () => {
    const gh = fakeGithub(() => json(200, PAIR))
    const res = await handle(post('/api/github/token', { code: 'c0de', codeVerifier: 'v'.repeat(43), redirectUri: `${SITE}/auth/callback` }), env(), gh.fetch)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ accessToken: 'ghu_access', expiresIn: 28800, refreshToken: 'ghr_refresh', refreshExpiresIn: 15897600 })
    expect(gh.calls).toHaveLength(1)
    expect(gh.calls[0].url).toBe(GITHUB_TOKEN_URL)
    const form = new URLSearchParams(String(gh.calls[0].init.body))
    expect(Object.fromEntries(form)).toEqual({ client_id: GITHUB_APP_CLIENT_ID, client_secret: SECRET, code: 'c0de', code_verifier: 'v'.repeat(43), redirect_uri: `${SITE}/auth/callback` })
  })

  it('never echoes the secret, even when GitHub quotes it', async () => {
    const gh = fakeGithub(() => json(200, { error: 'bad_verification_code', error_description: `the secret ${SECRET} is wrong` }))
    const res = await handle(post('/api/github/token', { code: 'old', codeVerifier: 'v'.repeat(43), redirectUri: `${SITE}/auth/callback` }), env(), gh.fetch)
    const text = await res.text()
    expect(res.status).toBe(400)
    expect(JSON.parse(text)).toEqual({ error: 'bad_verification_code' })
    expect(text).not.toContain(SECRET)
  })

  it('refuses another redirect address, a site GitHub does not know, and a missing field (no call to GitHub)', async () => {
    const gh = fakeGithub(() => json(200, PAIR))
    for (const [body, site] of [
      [{ code: 'c', codeVerifier: 'v', redirectUri: 'https://evil.example/auth/callback' }, SITE],
      [{ code: 'c', codeVerifier: 'v', redirectUri: `${SITE}/other` }, SITE],
      [{ code: 'c', codeVerifier: 'v', redirectUri: 'https://x.workers.dev/auth/callback' }, 'https://x.workers.dev'],
      [{ code: 'c', redirectUri: `${SITE}/auth/callback` }, SITE],
    ] as const) {
      const res = await handle(post('/api/github/token', body, { origin: site }, site), env(), gh.fetch)
      expect([body, res.status]).toEqual([body, 400])
    }
    expect(gh.calls).toHaveLength(0)
  })

  it('the dev server on a computer: localhost:5173 is a known callback (decision D8)', async () => {
    const gh = fakeGithub(() => json(200, PAIR))
    const local = 'http://localhost:5173'
    const res = await handle(post('/api/github/token', { code: 'c', codeVerifier: 'v'.repeat(43), redirectUri: `${local}/auth/callback` }, { origin: local }, local), env(), gh.fetch)
    expect(res.status).toBe(200)
  })
})

describe('POST /api/github/refresh', () => {
  it('sends grant_type=refresh_token with the secret and gives back the new pair', async () => {
    const gh = fakeGithub(() => json(200, { ...PAIR, access_token: 'ghu_new', refresh_token: 'ghr_new' }))
    const res = await handle(post('/api/github/refresh', { refreshToken: 'ghr_old' }), env(), gh.fetch)
    expect(await res.json()).toEqual({ accessToken: 'ghu_new', expiresIn: 28800, refreshToken: 'ghr_new', refreshExpiresIn: 15897600 })
    expect(Object.fromEntries(new URLSearchParams(String(gh.calls[0].init.body)))).toEqual({ client_id: GITHUB_APP_CLIENT_ID, client_secret: SECRET, grant_type: 'refresh_token', refresh_token: 'ghr_old' })
  })

  it('a dead refresh token: GitHub\'s one word, status 400', async () => {
    const gh = fakeGithub(() => json(200, { error: 'bad_refresh_token' }))
    const res = await handle(post('/api/github/refresh', { refreshToken: 'ghr_dead' }), env(), gh.fetch)
    expect([res.status, await res.json()]).toEqual([400, { error: 'bad_refresh_token' }])
  })

  it('GitHub cannot be reached: 502, so the app keeps its old pair', async () => {
    const res = await handle(post('/api/github/refresh', { refreshToken: 'ghr' }), env(), async () => {
      throw new TypeError('network')
    })
    expect([res.status, await res.json()]).toEqual([502, { error: 'github_unreachable' }])
  })
})

describe('POST /api/github/revoke', () => {
  it('asks GitHub to end the token with Basic auth (client ID and secret); 204 and 404 both mean signed out', async () => {
    for (const status of [204, 404]) {
      const gh = fakeGithub(() => new Response(null, { status }))
      const res = await handle(post('/api/github/revoke', { accessToken: 'ghu_x' }), env(), gh.fetch)
      expect([status, res.status, await res.json()]).toEqual([status, 200, { revoked: true }])
      expect(gh.calls[0].url).toBe(githubRevokeUrl(GITHUB_APP_CLIENT_ID))
      expect(gh.calls[0].init.method).toBe('DELETE')
      expect(new Headers(gh.calls[0].init.headers).get('authorization')).toBe(`Basic ${btoa(`${GITHUB_APP_CLIENT_ID}:${SECRET}`)}`)
      expect(JSON.parse(String(gh.calls[0].init.body))).toEqual({ access_token: 'ghu_x' })
    }
  })
})

describe('the rules of every route', () => {
  const gh = fakeGithub(() => json(200, PAIR))
  it('POST only', async () => {
    const res = await handle(new Request(`${SITE}/api/github/token`, { method: 'GET', headers: { origin: SITE } }), env(), gh.fetch)
    expect([res.status, res.headers.get('allow')]).toEqual([405, 'POST'])
  })
  it('this site only: another Origin, or none, is refused', async () => {
    for (const headers of [{ origin: 'https://evil.example' }, {}] as Record<string, string>[]) {
      const res = await handle(post('/api/github/refresh', { refreshToken: 'r' }, headers), env(), gh.fetch)
      expect(res.status).toBe(403)
    }
  })
  it('an unknown /api/github/ path is 404; no secret set up is 503 and calls nothing', async () => {
    expect((await handle(post('/api/github/other', {}), env(), gh.fetch)).status).toBe(404)
    const before = gh.calls.length
    expect((await handle(post('/api/github/refresh', { refreshToken: 'r' }), env({ GITHUB_CLIENT_SECRET: undefined }), gh.fetch)).status).toBe(503)
    expect(gh.calls.length).toBe(before)
  })
  it('a body that is not JSON, or a value that is not text, is 400', async () => {
    const bad = new Request(`${SITE}/api/github/refresh`, { method: 'POST', headers: { origin: SITE }, body: 'not json' })
    expect((await handle(bad, env(), gh.fetch)).status).toBe(400)
    expect((await handle(post('/api/github/refresh', { refreshToken: 12 }), env(), gh.fetch)).status).toBe(400)
  })
  it('every other path is the static files', async () => {
    const res = await handle(new Request(`${SITE}/auth/callback?code=x&state=y`), env({ ASSETS: { fetch: async () => new Response('app', { status: 200 }) } }), gh.fetch)
    expect(await res.text()).toBe('app')
  })
})
