import { describe, expect, it } from 'vitest'
import { GITHUB_API } from '../github/client'
import { fakeGithub, type FakeRepo, type FakeToken } from '../github/testing'
import { REPO_LIST_CAP, listTokenRepos, lookForVault, orderRepos } from './repos'

/** YAZ-5408: the repos a token can reach, for the picker. A fake GitHub; no test calls the real API. */
const FINE = 'github_pat_11FINEFINE0finefinefinefi_' + 'f'.repeat(59)
const CLASSIC = 'ghp_' + 'c'.repeat(36)
const EMPTY = 'github_pat_11EMPTYEMPTY0emptyemptyempt_' + 'e'.repeat(59)
const NOW = Date.UTC(2026, 10, 14, 12)

const many = (n: number): FakeRepo[] => Array.from({ length: n }, (_, i) => ({ fullName: `demo/repo-${String(i).padStart(4, '0')}`, pushedAt: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(), vault: false }))

function setup(repos: FakeRepo[], tokens: Record<string, FakeToken> = {}) {
  return fakeGithub({
    tokens: {
      [FINE]: { login: 'demo', repos: Object.fromEntries(repos.map((r) => [r.fullName, 'write'])) },
      [CLASSIC]: { login: 'demo', kind: 'classic' },
      [EMPTY]: { login: 'demo', repos: {} },
      ...tokens,
    },
    repos,
  })
}

describe('listTokenRepos (YAZ-5408)', () => {
  it('lists the repos with owner/name, private, the default branch; recent pushes first', async () => {
    const gh = setup([
      { fullName: 'demo/old', pushedAt: '2025-01-01T00:00:00Z' },
      { fullName: 'demo/new', pushedAt: '2026-11-01T00:00:00Z', private: false, defaultBranch: 'trunk' },
    ])
    const out = await listTokenRepos(FINE, { fetch: gh.fetch, now: () => NOW })
    expect(out).toEqual({
      ok: true,
      capped: false,
      repos: [
        { fullName: 'demo/new', private: false, defaultBranch: 'trunk', pushedAt: Date.parse('2026-11-01T00:00:00Z') },
        { fullName: 'demo/old', private: true, defaultBranch: 'main', pushedAt: Date.parse('2025-01-01T00:00:00Z') },
      ],
    })
    // One call, to api.github.com, the token in the Authorization header only.
    expect(gh.calls.map((c) => c.url)).toEqual([`${GITHUB_API}/user/repos?per_page=100&page=1&sort=pushed`])
    expect(gh.calls.every((c) => c.token === FINE && !c.url.includes(FINE))).toBe(true)
  })

  it('follows the Link header page by page until the last page', async () => {
    const gh = setup(many(250))
    const out = await listTokenRepos(FINE, { fetch: gh.fetch })
    expect(out.ok && out.repos.length).toBe(250)
    expect(out.ok && out.capped).toBe(false)
    expect(gh.calls.map((c) => new URL(c.url).searchParams.get('page'))).toEqual(['1', '2', '3'])
    // No repo twice.
    expect(out.ok && new Set(out.repos.map((r) => r.fullName)).size).toBe(250)
  })

  it(`stops at ${REPO_LIST_CAP} repos (10 pages) and says so`, async () => {
    const gh = setup(many(1050))
    const out = await listTokenRepos(FINE, { fetch: gh.fetch })
    expect(gh.calls).toHaveLength(10)
    expect(out.ok && out.repos.length).toBe(1000)
    expect(out.ok && out.capped).toBe(true)
  })

  it('a classic token lists every repo of its user', async () => {
    const gh = setup([{ fullName: 'demo/a' }, { fullName: 'demo/b' }, { fullName: 'other/c' }])
    const out = await listTokenRepos(CLASSIC, { fetch: gh.fetch })
    expect(out.ok && out.repos.map((r) => r.fullName).sort()).toEqual(['demo/a', 'demo/b'])
  })

  it('a token that reaches no repo: no-repos', async () => {
    const gh = setup([{ fullName: 'demo/a' }])
    expect(await listTokenRepos(EMPTY, { fetch: gh.fetch })).toEqual({ ok: false, error: { kind: 'no-repos' } })
  })

  it('a wrong or ended token: unauthorized; not a token: bad-token, with no call', async () => {
    const gh = setup([{ fullName: 'demo/a' }])
    expect(await listTokenRepos('github_pat_11WRONG0' + 'x'.repeat(70), { fetch: gh.fetch })).toEqual({ ok: false, error: { kind: 'unauthorized' } })
    const before = gh.calls.length
    expect(await listTokenRepos('owner/wiki', { fetch: gh.fetch })).toEqual({ ok: false, error: { kind: 'bad-token' } })
    expect(gh.calls.length).toBe(before)
  })

  it('the rate limit gives its time; no signal: offline', async () => {
    const gh = setup([{ fullName: 'demo/a' }])
    gh.rateLimitedUntil = Date.UTC(2026, 10, 14, 13) / 1000
    expect(await listTokenRepos(FINE, { fetch: gh.fetch, now: () => NOW })).toEqual({ ok: false, error: { kind: 'rate-limited', resetAt: Date.UTC(2026, 10, 14, 13) } })
    gh.rateLimitedUntil = null
    gh.offline = true
    expect(await listTokenRepos(FINE, { fetch: gh.fetch })).toEqual({ ok: false, error: { kind: 'offline' } })
  })

  it('a stop on page 2 is a stop: no half list', async () => {
    const gh = setup(many(150))
    gh.interrupt = (call) => (new URL(call.url).searchParams.get('page') === '2' ? new Response('{}', { status: 503 }) : undefined)
    expect(await listTokenRepos(FINE, { fetch: gh.fetch })).toEqual({ ok: false, error: { kind: 'github-down' } })
  })

  it('a Link to another place is not followed', async () => {
    const gh = setup(many(3))
    gh.interrupt = () => new Response('[]', { status: 200, headers: { link: '<https://evil.example/user/repos?page=2>; rel="next"' } })
    const out = await listTokenRepos(FINE, { fetch: gh.fetch })
    expect(gh.calls).toHaveLength(1)
    expect(out).toEqual({ ok: false, error: { kind: 'no-repos' } })
  })
})

describe('lookForVault and orderRepos (YAZ-5408)', () => {
  it('a .yaseendocs folder at the top of the default branch: vault; none: not; no Contents: unknown', async () => {
    const gh = setup([{ fullName: 'demo/v' }, { fullName: 'demo/code', vault: false }, { fullName: 'demo/locked' }], {
      [FINE]: { login: 'demo', repos: { 'demo/v': 'write', 'demo/code': 'write', 'demo/locked': 'none' } },
    })
    const repo = (fullName: string) => ({ fullName, private: true, defaultBranch: 'main', pushedAt: 0 })
    expect(await lookForVault(FINE, repo('demo/v'), { fetch: gh.fetch })).toBe('vault')
    expect(await lookForVault(FINE, repo('demo/code'), { fetch: gh.fetch })).toBe('not')
    expect(await lookForVault(FINE, repo('demo/locked'), { fetch: gh.fetch })).toBe('unknown')
    gh.offline = true
    expect(await lookForVault(FINE, repo('demo/v'), { fetch: gh.fetch })).toBe('unknown')
    expect(gh.calls[0].url).toBe(`${GITHUB_API}/repos/demo/v/contents/.yaseendocs?ref=main`)
  })

  it('vaults first, then the most recent push, then the name', () => {
    const r = (fullName: string, pushedAt: number) => ({ fullName, private: true, defaultBranch: 'main', pushedAt })
    const out = orderRepos([r('a/old-vault', 1), r('a/new', 9), r('a/vault', 5), r('a/b', 9)], { 'a/old-vault': 'vault', 'a/vault': 'vault', 'a/new': 'not' })
    expect(out.map((x) => x.fullName)).toEqual(['a/vault', 'a/old-vault', 'a/b', 'a/new'])
  })
})
