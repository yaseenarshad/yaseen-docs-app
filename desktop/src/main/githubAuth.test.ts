import { describe, expect, it, vi } from 'vitest'
import { createGithubAuth, GITHUB_APP_AUTH_SECRET, GITHUB_APP_CLIENT_ID, isGithubAuthCallback, WORKER_CALLBACK_URI, WORKER_ORIGIN } from './githubAuth'
import type { Secrets } from './secrets'

function memorySecrets(): Secrets {
  const map = new Map<string, string>()
  return {
    async read(name) {
      return map.get(name) ?? null
    },
    async has(name) {
      return map.has(name)
    },
    async set(name, value) {
      if (value === null) map.delete(name)
      else map.set(name, value)
    },
  }
}

const jsonRes = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

describe('isGithubAuthCallback', () => {
  it('matches yaseendocs://auth/callback and rejects file links', () => {
    expect(isGithubAuthCallback('yaseendocs://auth/callback?code=1&state=mac.abc')).toBe(true)
    expect(isGithubAuthCallback('yaseendocs:///Users/me/vault/Note.md')).toBe(false)
    expect(isGithubAuthCallback('https://docs.yaseenarshad.com/auth/callback')).toBe(false)
  })
})

describe('createGithubAuth', () => {
  it('completes PKCE sign-in, stores token pair in secrets, and reports signedIn status', async () => {
    const secrets = memorySecrets()
    let openedUrl = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === `${WORKER_ORIGIN}/api/github/token`) {
        expect(new Headers(init?.headers).get('origin')).toBe(WORKER_ORIGIN)
        return jsonRes(200, { accessToken: 'ghu_abc', expiresIn: 28800, refreshToken: 'ghr_xyz', refreshExpiresIn: 15897600 })
      }
      if (url === 'https://api.github.com/user') {
        return jsonRes(200, { login: 'yaseenarshad', id: 43793164 })
      }
      return jsonRes(404, {})
    }) as unknown as typeof globalThis.fetch

    const auth = createGithubAuth({
      secrets,
      openExternal: (u) => {
        openedUrl = u
      },
      fetch: fetchMock,
      now: () => 1_000_000,
    })

    const started = await auth.startSignIn()
    expect(started.pending).toBe(true)
    const parsedOpen = new URL(openedUrl)
    expect(parsedOpen.searchParams.get('client_id')).toBe(GITHUB_APP_CLIENT_ID)
    expect(parsedOpen.searchParams.get('redirect_uri')).toBe(WORKER_CALLBACK_URI)
    const state = parsedOpen.searchParams.get('state')!
    expect(state.startsWith('mac.')).toBe(true)

    const done = await auth.handleCallback(`yaseendocs://auth/callback?code=goodcode&state=${encodeURIComponent(state)}`)
    expect(done).toEqual({ signedIn: true, login: 'yaseenarshad', hasManualToken: false })

    const valid = await auth.getValidAuth()
    expect(valid).toEqual({
      token: 'ghu_abc',
      login: 'yaseenarshad',
      email: '43793164+yaseenarshad@users.noreply.github.com',
    })
  })

  it('rejects mismatched state and access_denied without storing tokens', async () => {
    const secrets = memorySecrets()
    const auth = createGithubAuth({ secrets, openExternal: () => undefined, now: () => 1_000_000 })
    await auth.startSignIn()

    const denied = await auth.handleCallback('yaseendocs://auth/callback?error=access_denied&state=mac.wrong')
    expect(denied.signedIn).toBe(false)
    expect(denied.error).toContain('did not allow')
    expect(await secrets.read(GITHUB_APP_AUTH_SECRET)).toBeNull()
  })

  it('serializes concurrent refreshes through one single-use refresh call (Extra #6)', async () => {
    const secrets = memorySecrets()
    let t = 1_000_000
    await secrets.set(
      GITHUB_APP_AUTH_SECRET,
      JSON.stringify({
        login: 'yaseenarshad',
        userId: 42,
        accessToken: 'ghu_old',
        accessEndsAt: t + 60_000, // within 5 min refresh margin
        refreshToken: 'ghr_once',
        refreshEndsAt: t + 10_000_000,
      }),
    )

    let refreshCalls = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === `${WORKER_ORIGIN}/api/github/refresh`) {
        refreshCalls++
        await new Promise((r) => setTimeout(r, 10))
        return jsonRes(200, { accessToken: 'ghu_new', expiresIn: 28800, refreshToken: 'ghr_next', refreshExpiresIn: 15897600 })
      }
      return jsonRes(404, {})
    }) as unknown as typeof globalThis.fetch

    const auth = createGithubAuth({ secrets, openExternal: () => undefined, fetch: fetchMock, now: () => t })
    const [a, b, c] = await Promise.all([auth.getValidAuth(), auth.getValidAuth(), auth.getValidAuth()])
    expect(refreshCalls).toBe(1)
    expect(a?.token).toBe('ghu_new')
    expect(b?.token).toBe('ghu_new')
    expect(c?.token).toBe('ghu_new')
  })

  it('clears auth and notifies when refresh token is revoked (bad_refresh_token)', async () => {
    const secrets = memorySecrets()
    const events: unknown[] = []
    await secrets.set(
      GITHUB_APP_AUTH_SECRET,
      JSON.stringify({
        login: 'yaseenarshad',
        userId: 42,
        accessToken: 'ghu_expired',
        accessEndsAt: 500,
        refreshToken: 'ghr_dead',
        refreshEndsAt: 1000,
      }),
    )
    const fetchMock = vi.fn(async () => jsonRes(400, { error: 'bad_refresh_token' })) as unknown as typeof globalThis.fetch
    const auth = createGithubAuth({ secrets, openExternal: () => undefined, fetch: fetchMock, now: () => 2000, onChange: (s) => events.push(s) })
    expect(await auth.getValidAuth()).toBeNull()
    expect(await secrets.read(GITHUB_APP_AUTH_SECRET)).toBeNull()
    expect(events.length).toBeGreaterThan(0)
  })

  it('checks installed repos and classifies allowed vs not-allowed (Extra #5)', async () => {
    const secrets = memorySecrets()
    await secrets.set(
      GITHUB_APP_AUTH_SECRET,
      JSON.stringify({ login: 'yaseenarshad', userId: 42, accessToken: 'ghu_ok', accessEndsAt: 9_000_000, refreshToken: 'ghr_ok', refreshEndsAt: 9_000_000 }),
    )
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('https://api.github.com/user/installations?')) return jsonRes(200, { installations: [{ id: 7 }] })
      if (url.startsWith('https://api.github.com/user/installations/7/repositories?')) {
        return jsonRes(200, { repositories: [{ full_name: 'yaseenarshad/vault-a', private: true, default_branch: 'main' }] })
      }
      return jsonRes(404, {})
    }) as unknown as typeof globalThis.fetch

    const auth = createGithubAuth({ secrets, openExternal: () => undefined, fetch: fetchMock, now: () => 1000 })
    expect(await auth.listInstalledRepos()).toEqual([{ fullName: 'yaseenarshad/vault-a', private: true, defaultBranch: 'main' }])
    expect(await auth.isRepoAllowed('yaseenarshad/vault-a')).toBe('allowed')
    expect(await auth.isRepoAllowed('yaseenarshad/other-repo')).toBe('not-allowed')
  })

  it('revokes token at Worker and clears secrets on signOut', async () => {
    const secrets = memorySecrets()
    await secrets.set(
      GITHUB_APP_AUTH_SECRET,
      JSON.stringify({ login: 'yaseenarshad', userId: 42, accessToken: 'ghu_ok', accessEndsAt: 9_000_000, refreshToken: 'ghr_ok', refreshEndsAt: 9_000_000 }),
    )
    let revoked = false
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === `${WORKER_ORIGIN}/api/github/revoke`) {
        revoked = true
        return jsonRes(200, { revoked: true })
      }
      return jsonRes(404, {})
    }) as unknown as typeof globalThis.fetch
    const auth = createGithubAuth({ secrets, openExternal: () => undefined, fetch: fetchMock })
    const out = await auth.signOut()
    expect(revoked).toBe(true)
    expect(out.signedIn).toBe(false)
    expect(await secrets.read(GITHUB_APP_AUTH_SECRET)).toBeNull()
  })

  it('does not re-save refreshed tokens if signOut runs while refresh is in flight', async () => {
    const secrets = memorySecrets()
    await secrets.set(
      GITHUB_APP_AUTH_SECRET,
      JSON.stringify({ login: 'yaseenarshad', userId: 42, accessToken: 'ghu_old', accessEndsAt: 1000, refreshToken: 'ghr_once', refreshEndsAt: 9_000_000 }),
    )
    let resolveRefresh!: (res: Response) => void
    let markStarted!: () => void
    const started = new Promise<void>((r) => {
      markStarted = r
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === `${WORKER_ORIGIN}/api/github/refresh`) {
        markStarted()
        return new Promise<Response>((resolve) => {
          resolveRefresh = resolve
        })
      }
      return jsonRes(200, { revoked: true })
    }) as unknown as typeof globalThis.fetch

    const auth = createGithubAuth({ secrets, openExternal: () => undefined, fetch: fetchMock, now: () => 900 })
    const refreshPromise = auth.getValidAuth()
    await started
    await auth.signOut()
    resolveRefresh(jsonRes(200, { accessToken: 'ghu_stale', expiresIn: 28800, refreshToken: 'ghr_stale', refreshExpiresIn: 15897600 }))
    expect(await refreshPromise).toBeNull()
    expect(await secrets.read(GITHUB_APP_AUTH_SECRET)).toBeNull()
  })
})
