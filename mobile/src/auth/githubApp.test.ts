import { describe, expect, it } from 'vitest'
import { fakeGithub, type FakeRepo } from '../github/testing'
import { memoryBackend, tokenStoreOn } from '../store'
import { PENDING_MS } from '../store/tokenStore'
import { finishGithubSignIn, githubSignInMessage, listInstalledRepos, pkceChallenge, repoStanding, startGithubSignIn } from './githubApp'
import type { FetchLike } from '../github/client'
import { GITHUB_APP_CLIENT_ID } from './githubAppConfig'
import { fakeOauth } from './githubApp.testing'
import { renewAtWorker } from './githubWorker'

/** YAZ-5645 slice 1: the web sign-in flow (PKCE + state), through the REAL Worker, against a fake GitHub. */

const SITE = 'https://docs.yaseenarshad.com'
const ACCESS = 'ghu_' + 'a'.repeat(36)
const ACCESS2 = 'ghu_' + 'b'.repeat(36)
const NOW = Date.UTC(2026, 10, 15, 12)

function setup(repos: FakeRepo[] = [{ fullName: 'yaseen/vault' }], installations = [{ id: 7, account: 'yaseen', repos: repos.map((r) => r.fullName) }]) {
  const api = fakeGithub({
    tokens: {
      [ACCESS]: { login: 'yaseen', repos: Object.fromEntries(repos.map((r) => [r.fullName, 'write' as const])), installations },
      [ACCESS2]: { login: 'yaseen', repos: {}, installations },
    },
    repos,
  })
  const oauth = fakeOauth(SITE, api.fetch)
  oauth.codes.set('the-code', { access: ACCESS, refresh: 'ghr_one' })
  const clock = { t: NOW }
  const tokens = tokenStoreOn(memoryBackend(), { now: () => clock.t, renew: renewAtWorker(oauth.fetch, () => clock.t, SITE) })
  const deps = { tokens, fetch: oauth.fetch, now: () => clock.t, origin: SITE }
  return { api, oauth, clock, tokens, deps }
}

const back = (q: Record<string, string>) => new URL(`${SITE}/auth/callback?${new URLSearchParams(q)}`)

describe('startGithubSignIn', () => {
  it("GitHub's address: the client ID, this site's callback, the state and the S256 challenge; no token; the pending sign-in is kept", async () => {
    const { tokens, deps } = setup()
    const url = new URL(await startGithubSignIn({ kind: 'first' }, deps))
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize')
    expect(url.searchParams.get('client_id')).toBe(GITHUB_APP_CLIENT_ID)
    expect(url.searchParams.get('redirect_uri')).toBe(`${SITE}/auth/callback`)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.has('prompt')).toBe(false)
    const pending = (await tokens.takePending())!
    expect(url.searchParams.get('state')).toBe(pending.state)
    expect(url.searchParams.get('code_challenge')).toBe(await pkceChallenge(pending.verifier))
    expect(pending.verifier.length).toBeGreaterThanOrEqual(43)
    expect(url.href).not.toContain(pending.verifier)
  })

  it('"Another GitHub account" asks GitHub for its account picker', async () => {
    const { deps } = setup()
    expect(new URL(await startGithubSignIn({ kind: 'add' }, deps, true)).searchParams.get('prompt')).toBe('select_account')
  })

  it('PKCE S256 matches RFC 7636 (appendix B)', async () => {
    expect(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })
})

describe('finishGithubSignIn', () => {
  it('the round trip: the Worker swaps the code with the verifier and the secret; the pair is kept; /user names the account', async () => {
    const { tokens, oauth, deps } = setup()
    const url = new URL(await startGithubSignIn({ kind: 'add' }, deps))
    const out = await finishGithubSignIn(back({ code: 'the-code', state: url.searchParams.get('state')! }), deps)
    expect(out).toEqual({ ok: true, login: 'yaseen', purpose: { kind: 'add' } })
    expect(await tokens.accessFor('yaseen')).toBe(ACCESS)
    expect(await pkceChallenge(oauth.verifiers[0])).toBe(url.searchParams.get('code_challenge'))
    expect(oauth.workerCalls).toEqual(['/api/github/token'])
  })

  it('then refreshes by itself through the Worker 5 minutes before the 8 hours end', async () => {
    const { tokens, oauth, clock, deps } = setup()
    oauth.refreshes.set('ghr_one', { access: ACCESS2, refresh: 'ghr_two' })
    const url = new URL(await startGithubSignIn({ kind: 'first' }, deps))
    await finishGithubSignIn(back({ code: 'the-code', state: url.searchParams.get('state')! }), deps)
    await tokens.link('yaseen/vault@main', 'yaseen')
    clock.t = NOW + 8 * 3_600_000 - 4 * 60_000
    expect(await tokens.read('yaseen/vault@main')).toBe(ACCESS2)
    expect(oauth.workerCalls).toEqual(['/api/github/token', '/api/github/refresh'])
    // The used refresh token is gone at GitHub; a second refresh with it would fail. The store has the new one.
    clock.t += 8 * 3_600_000
    expect(await tokens.read('yaseen/vault@main')).toBeNull()
  })

  it('"no" on GitHub: denied, nothing kept', async () => {
    const { tokens, deps } = setup()
    const url = new URL(await startGithubSignIn({ kind: 'first' }, deps))
    expect(await finishGithubSignIn(back({ error: 'access_denied', state: url.searchParams.get('state')! }), deps)).toEqual({ ok: false, error: { kind: 'denied' }, purpose: { kind: 'first' } })
    expect(await tokens.githubAccounts()).toEqual([])
  })

  it('a wrong state, or no sign-in started here: the code is not used (edge case 2)', async () => {
    const { oauth, deps } = setup()
    await startGithubSignIn({ kind: 'first' }, deps)
    expect((await finishGithubSignIn(back({ code: 'the-code', state: 'forged' }), deps)).ok).toBe(false)
    // The pending sign-in was taken by that try: the real state is no good now either (one use).
    expect(await finishGithubSignIn(back({ code: 'the-code', state: 'any' }), deps)).toEqual({ ok: false, error: { kind: 'no-sign-in' }, purpose: null })
    expect(oauth.workerCalls).toEqual([])
  })

  it('more than 10 minutes on GitHub: "too long" (edge case 3), no call', async () => {
    const { clock, oauth, deps } = setup()
    const url = new URL(await startGithubSignIn({ kind: 'first' }, deps))
    clock.t += PENDING_MS + 1
    expect((await finishGithubSignIn(back({ code: 'the-code', state: url.searchParams.get('state')! }), deps)).ok).toBe(false)
    expect(oauth.workerCalls).toEqual([])
  })

  it('GitHub refuses the code (used, old): "refused the sign-in code"; the Worker unreachable: offline', async () => {
    const { deps, oauth } = setup()
    let url = new URL(await startGithubSignIn({ kind: 'first' }, deps))
    expect(await finishGithubSignIn(back({ code: 'unknown', state: url.searchParams.get('state')! }), deps)).toMatchObject({ ok: false, error: { kind: 'bad-code' } })
    url = new URL(await startGithubSignIn({ kind: 'first' }, deps))
    const offline = { ...deps, fetch: async () => Promise.reject(new TypeError('Load failed')) }
    expect(await finishGithubSignIn(back({ code: 'the-code', state: url.searchParams.get('state')! }), offline)).toMatchObject({ ok: false, error: { kind: 'offline' } })
    expect(oauth.workerCalls).toEqual(['/api/github/token'])
  })
})

describe('finishGithubSignIn says WHAT failed (YAZ-5645 GHF: "GitHub did not finish the sign-in" hid a Worker with no secret)', () => {
  const run = async (opts: { secret?: string } | null, code = 'the-code', worker?: FetchLike) => {
    const { api, deps } = setup()
    const oauth = opts === null ? null : fakeOauth(SITE, api.fetch, opts)
    oauth?.codes.set('the-code', { access: ACCESS, refresh: 'ghr_one' })
    const fetch = worker ?? oauth!.fetch
    const url = new URL(await startGithubSignIn({ kind: 'first' }, { ...deps, fetch }))
    const back = await finishGithubSignIn(new URL(`${SITE}/auth/callback?${new URLSearchParams({ code, state: url.searchParams.get('state')! })}`), { ...deps, fetch })
    if (back.ok) throw new Error('signed in')
    return { kind: back.error.kind, message: githubSignInMessage(back.error) }
  }
  const answer = (status: number, body: unknown): FetchLike => async () => new Response(JSON.stringify(body), { status })

  it("the Worker has no client secret: \"not set up\", and the way out is a token", async () => {
    const got = await run({ secret: undefined })
    expect(got.kind).toBe('not-set-up')
    expect(got.message).toMatch(/sign-in server is not set up/)
    expect(got.message).toMatch(/Use a token instead/)
  })

  it('GitHub does not know the Worker\'s key: "GitHub refused the app\'s key"', async () => {
    const got = await run({ secret: 'not-the-key' })
    expect(got.kind).toBe('bad-key')
    expect(got.message).toMatch(/GitHub refused the app's key/)
  })

  it('a used or unknown code: "GitHub refused the sign-in code"', async () => {
    const got = await run({}, 'unknown')
    expect(got.kind).toBe('bad-code')
    expect(got.message).toMatch(/GitHub refused the sign-in code/)
  })

  it('the return address: "GitHub refused the return address"; GitHub down: "could not reach GitHub"', async () => {
    expect((await run(null, 'x', answer(400, { error: 'redirect_uri_mismatch' }))).kind).toBe('bad-return')
    expect((await run(null, 'x', answer(400, { error: 'bad_redirect' }))).message).toMatch(/GitHub refused the return address/)
    const down = await run(null, 'x', answer(502, { error: 'github_unreachable' }))
    expect(down.kind).toBe('github-unreachable')
    expect(down.message).toMatch(/could not reach GitHub/)
  })

  it('the sign-in server not reachable: says so; a page that is not the Worker: says so', async () => {
    const off = await run(null, 'x', async () => Promise.reject(new TypeError('Load failed')))
    expect(off.kind).toBe('offline')
    expect(off.message).toMatch(/could not reach the sign-in server/i)
    const html: FetchLike = async () => new Response('<html>', { status: 404 })
    expect((await run(null, 'x', html)).message).toMatch(/sign-in server gave an answer Yaseen Docs does not know/)
  })

  it('no message is the vague "Try again in a few minutes" of before', async () => {
    for (const kind of ['denied', 'no-sign-in', 'too-late', 'offline', 'not-set-up', 'github-unreachable', 'bad-key', 'bad-return', 'bad-code', 'no-account', 'refused'] as const)
      expect([kind, githubSignInMessage({ kind })]).not.toEqual([kind, expect.stringMatching(/did not finish/)])
  })
})

describe('listInstalledRepos (edge cases 4, 17)', () => {
  it('the repos of every installation, page by page, newest push first', async () => {
    const many: FakeRepo[] = Array.from({ length: 130 }, (_, i) => ({ fullName: `yaseen/r-${String(i).padStart(3, '0')}`, pushedAt: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString() }))
    const { api } = setup([...many, { fullName: 'team/notes' }], [
      { id: 1, account: 'yaseen', repos: many.map((r) => r.fullName) },
      { id: 2, account: 'team', repos: ['team/notes'] },
    ])
    const out = await listInstalledRepos(ACCESS, { fetch: api.fetch })
    if (!out.ok) throw new Error('listed')
    expect(out.repos).toHaveLength(131)
    expect(out.repos[0].fullName).toBe('yaseen/r-129')
    expect(api.calls.map((c) => new URL(c.url).pathname)).toEqual(['/user/installations', '/user/installations/1/repositories', '/user/installations/1/repositories', '/user/installations/2/repositories'])
  })

  it('no installation, or none with a repo: "Choose repos on GitHub", never an empty list', async () => {
    for (const installations of [[], [{ id: 3, account: 'yaseen', repos: [] }]]) {
      const { api } = setup([{ fullName: 'yaseen/vault' }], installations)
      expect(await listInstalledRepos(ACCESS, { fetch: api.fetch })).toEqual({ ok: false, error: { kind: 'no-installed-repos' } })
    }
  })
})

describe('repoStanding (YAZ-5645 slice 2, edge case 5)', () => {
  const VAULT = 'yaseen/vault@main'
  it('removed: the account no longer lists the repo, or has no installation left; listed: still chosen', async () => {
    const { api, tokens, deps } = setup([{ fullName: 'yaseen/vault' }, { fullName: 'yaseen/other' }])
    await tokens.savePair({ login: 'yaseen', access: ACCESS, accessEndsAt: null, refresh: null, refreshEndsAt: null })
    await tokens.link(VAULT, 'yaseen')
    expect(await repoStanding(VAULT, 'Yaseen/Vault', deps)).toBe('listed')
    api.takeOff(ACCESS, 'yaseen/vault')
    expect(await repoStanding(VAULT, 'yaseen/vault', deps)).toBe('removed')
    api.takeOff(ACCESS, 'yaseen/other')
    expect(await repoStanding(VAULT, 'yaseen/vault', deps)).toBe('removed')
  })

  it('unknown: a pasted token, a signed-out account, or GitHub not answering', async () => {
    const { api, tokens, deps } = setup()
    await tokens.write(VAULT, 'github_pat_11' + 'x'.repeat(80))
    expect(await repoStanding(VAULT, 'yaseen/vault', deps)).toBe('unknown')
    await tokens.link(VAULT, 'yaseen')
    expect(await repoStanding(VAULT, 'yaseen/vault', deps)).toBe('unknown')
    await tokens.savePair({ login: 'yaseen', access: ACCESS, accessEndsAt: null, refresh: null, refreshEndsAt: null })
    api.offline = true
    expect(await repoStanding(VAULT, 'yaseen/vault', deps)).toBe('unknown')
  })
})
