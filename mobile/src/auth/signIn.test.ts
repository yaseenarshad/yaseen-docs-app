import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GITHUB_API, GithubError, githubClient } from '../github/client'
import { fakeGithub, type FakeGithub } from '../github/testing'
import { memoryBackend, newMemoryDisk } from '../store/memoryBackend'
import { tokenStoreOn, type TokenStore } from '../store/tokenStore'
import { PHONE, openVaultStore, type VaultStore } from '../store/vaultStore'
import { loadVaultList } from '../store/vaults'
import { loadAccount } from './account'
import { WRITE_PROBE, checkSignIn, signInMessage, type SignInError } from './check'
import { loadFriendsAccount, recordGistsRefused } from './friends'
import { forgetVaultAndToken, signIn, signInAgain, signOutAndErase, startState, type SignInDeps } from './signIn'

const NOW = Date.UTC(2026, 10, 13, 12)
const GOOD = 'github_pat_11GOODGOOD0goodgoodgood_' + 'g'.repeat(59)
const NO_GISTS = 'github_pat_11NOGISTS0nogistsnogists_' + 'n'.repeat(59)
const READ_ONLY = 'github_pat_11READONLY0readonlyreadonl_' + 'r'.repeat(59)
const OTHER_REPO = 'github_pat_11OTHERREPO0otherrepoother_' + 'o'.repeat(59)
const CLASSIC = 'ghp_' + 'c'.repeat(36)
const WORK = 'github_pat_11WORKWORK0workworkworkwo_' + 'w'.repeat(59)
const NO_CONTENTS = 'github_pat_11NOCONTENT0nocontentsnoconten_' + 'm'.repeat(59)
const WRONG = 'github_pat_11WRONGWRONG0wrongwrongwron_' + 'x'.repeat(59)
const ALL_TOKENS = [NO_CONTENTS, GOOD, NO_GISTS, READ_ONLY, OTHER_REPO, CLASSIC, WORK, WRONG]

let github: FakeGithub
let store: VaultStore
let tokens: TokenStore
let deps: SignInDeps
let keepStorage: ReturnType<typeof vi.fn>
let logged: unknown[][]

beforeEach(async () => {
  github = fakeGithub({
    tokens: {
      [GOOD]: { login: 'yaseen', name: 'Yaseen', repos: { 'yaseen/vault': 'write', 'yaseen/second': 'write', 'yaseen/code': 'write' }, gists: true, expires: '2026-12-31 00:00:00 UTC' },
      [NO_GISTS]: { login: 'yaseen', repos: { 'yaseen/vault': 'write' }, gists: false },
      [READ_ONLY]: { login: 'yaseen', repos: { 'yaseen/vault': 'read' }, gists: true },
      [OTHER_REPO]: { login: 'yaseen', repos: { 'yaseen/other': 'write' }, gists: true },
      [CLASSIC]: { login: 'yaseen', kind: 'classic', repos: { 'yaseen/vault': 'write' }, gists: true },
      [NO_CONTENTS]: { login: 'yaseen', repos: { 'yaseen/vault': 'none' }, gists: true },
      [WORK]: { login: 'yaseen-work', repos: { 'acme/pages': 'write' }, gists: true },
    },
    repos: [
      { fullName: 'yaseen/vault', branches: ['main', 'phone'] },
      { fullName: 'yaseen/second' },
      { fullName: 'yaseen/other' },
      { fullName: 'yaseen/public-pages', private: false },
      { fullName: 'acme/pages' },
      { fullName: 'yaseen/old', archived: true },
      { fullName: 'yaseen/code', vault: false },
    ],
  })
  store = await openVaultStore(memoryBackend())
  tokens = tokenStoreOn(memoryBackend())
  keepStorage = vi.fn(async () => 'kept' as const)
  deps = { store, tokens, fetch: github.fetch, now: () => NOW, keepStorage }
  logged = []
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const)
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logged.push(args))
})

afterEach(() => {
  // The token is never logged, never in an address, and sent to no host but api.github.com.
  const everything = JSON.stringify(logged)
  for (const token of ALL_TOKENS) expect(everything).not.toContain(token)
  for (const call of github.calls) {
    expect(call.url.startsWith(`${GITHUB_API}/`)).toBe(true)
    for (const token of ALL_TOKENS) expect(call.url).not.toContain(token)
  }
  for (const answer of github.answers) for (const token of ALL_TOKENS) expect(answer).not.toContain(token)
  vi.restoreAllMocks()
})

async function nothingStored() {
  expect(await loadVaultList(store)).toEqual({ vaults: [], open: null })
  expect(await tokens.read('yaseen/vault@main')).toBeNull()
  expect(await loadAccount(store, 'yaseen/vault@main')).toBeUndefined()
  expect(keepStorage).not.toHaveBeenCalled()
}

async function failsWith(input: Parameters<typeof signIn>[0], error: SignInError) {
  const result = await signIn(input, deps)
  expect(result).toEqual({ ok: false, error })
  expect(signInMessage(error)).not.toMatch(/github_pat_|ghp_/)
  await nothingStored()
}

describe('F1: first open, no token', () => {
  it('shows the sign-in screen and downloads nothing', async () => {
    expect(await startState(store, tokens)).toEqual({ kind: 'sign-in' })
    expect(github.calls).toEqual([])
  })
})

describe('a good token', () => {
  it('checks it (GET /user, then the repo, the branch and a write), then keeps the token, the account and the vault', async () => {
    const result = await signIn({ repo: 'Yaseen/Vault', token: ` ${GOOD}\n` }, deps)
    expect(result).toEqual({
      ok: true,
      vault: 'yaseen/vault@main',
      account: { login: 'yaseen', name: 'Yaseen', avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4', gists: 'yes', expiresAt: '2026-12-31T00:00:00.000Z', checkedAt: NOW },
    })
    expect(github.calls.map((c) => `${c.method} ${c.url.slice(GITHUB_API.length)}`)).toEqual([
      'GET /user',
      'GET /repos/Yaseen/Vault',
      'GET /repos/yaseen/vault/branches/main',
      'GET /repos/yaseen/vault/contents/.yaseendocs?ref=main',
      'POST /repos/yaseen/vault/git/blobs',
      'POST /gists',
    ])
    expect(await tokens.read('yaseen/vault@main')).toBe(GOOD)
    expect(await loadAccount(store, 'yaseen/vault@main')).toMatchObject({ login: 'yaseen', gists: 'yes' })
    const list = await loadVaultList(store)
    // The repo is stored as GitHub writes it, and the default branch when none is given.
    expect(list).toEqual({ vaults: [{ repo: 'yaseen/vault', branch: 'main', addedAt: NOW }], open: 'yaseen/vault@main' })
    expect(keepStorage).toHaveBeenCalledOnce()
    expect(await startState(store, tokens)).toEqual({ kind: 'ready', vault: 'yaseen/vault@main' })
  })

  it('the write probe stores one fixed blob, the same bytes each time (it changes no file); the Gists probe creates nothing', async () => {
    await signIn({ repo: 'yaseen/vault', token: GOOD }, deps)
    await signIn({ repo: 'yaseen/vault', branch: 'phone', token: GOOD }, deps)
    expect([...github.blobs]).toEqual([`yaseen/vault:${WRITE_PROBE}`])
    expect(github.answers.some((a) => a.includes('"id":"g1"'))).toBe(false)
  })

  it('takes a given branch', async () => {
    const result = await signIn({ repo: 'yaseen/vault', branch: 'phone', token: GOOD }, deps)
    expect(result).toMatchObject({ ok: true, vault: 'yaseen/vault@phone' })
  })

  it('a second vault with the same token is added; the first stays open (decision 7)', async () => {
    await signIn({ repo: 'yaseen/vault', token: GOOD }, deps)
    await signIn({ repo: 'yaseen/second', token: GOOD }, deps)
    const list = await loadVaultList(store)
    expect(list.vaults.map((v) => v.repo)).toEqual(['yaseen/vault', 'yaseen/second'])
    expect(list.open).toBe('yaseen/vault@main')
    expect(await tokens.read('yaseen/second@main')).toBe(GOOD)
  })

  it('the same vault two times: says it is already on the phone, and changes nothing', async () => {
    await signIn({ repo: 'yaseen/vault', token: GOOD }, deps)
    const result = await signIn({ repo: 'YASEEN/VAULT', token: NO_GISTS }, deps)
    expect(result).toEqual({ ok: false, error: { kind: 'already-added', repo: 'yaseen/vault', branch: 'main' } })
    expect(await tokens.read('yaseen/vault@main')).toBe(GOOD)
  })

  it('a classic token: the Gists permission is read from its scopes, with no probe', async () => {
    const result = await signIn({ repo: 'yaseen/vault', token: CLASSIC }, deps)
    expect(result).toMatchObject({ ok: true, account: { gists: 'yes', expiresAt: null } })
    expect(github.calls.some((c) => c.url.endsWith('/gists'))).toBe(false)
  })

  it('an end date from the Mac\'s code is kept when GitHub\'s header cannot be read (a browser hides it)', async () => {
    const result = await signIn({ repo: 'yaseen/vault', token: NO_GISTS, expiresAt: '2027-01-15T00:00:00.000Z' }, deps)
    expect(result).toMatchObject({ ok: true, account: { expiresAt: '2027-01-15T00:00:00.000Z' } })
  })
})

describe('F3: the token is wrong, expired or cancelled', () => {
  it('says so in plain words, stays on sign-in, and stores nothing', async () => {
    await failsWith({ repo: 'yaseen/vault', token: WRONG }, { kind: 'unauthorized' })
    expect(signInMessage({ kind: 'unauthorized' })).toMatch(/token/i)
    expect(github.calls).toHaveLength(1)
  })

  it('what is not a token or a repo is refused before any call', async () => {
    await failsWith({ repo: 'yaseen/vault', token: 'not a token' }, { kind: 'bad-token' })
    await failsWith({ repo: 'yaseen', token: GOOD }, { kind: 'bad-repo' })
    await failsWith({ repo: 'yaseen/vault', branch: 'a..b', token: GOOD }, { kind: 'bad-branch' })
    expect(github.calls).toEqual([])
  })
})

describe('F4: the token is valid but cannot read this repo', () => {
  it('names the repo that it cannot read', async () => {
    await failsWith({ repo: 'yaseen/vault', token: OTHER_REPO }, { kind: 'repo-not-found', repo: 'yaseen/vault' })
    expect(signInMessage({ kind: 'repo-not-found', repo: 'yaseen/vault' })).toContain('yaseen/vault')
  })

  it('a repo that is gone is the same answer: GitHub hides a private repo it does not let the token see', async () => {
    await failsWith({ repo: 'yaseen/deleted', token: GOOD }, { kind: 'repo-not-found', repo: 'yaseen/deleted' })
  })

  it('a branch that is not there is named', async () => {
    await failsWith({ repo: 'yaseen/vault', branch: 'gone', token: GOOD }, { kind: 'branch-not-found', repo: 'yaseen/vault', branch: 'gone' })
    expect(signInMessage({ kind: 'branch-not-found', repo: 'yaseen/vault', branch: 'gone' })).toContain('gone')
  })
})

describe('YAZ-5165: the token sees the repo but has no Contents permission (GitHub\'s default)', () => {
  it('names the permission to turn on, and stores nothing', async () => {
    await failsWith({ repo: 'yaseen/vault', token: NO_CONTENTS }, { kind: 'no-contents', repo: 'yaseen/vault' })
    const message = signInMessage({ kind: 'no-contents', repo: 'yaseen/vault' })
    expect(message).toContain('yaseen/vault')
    expect(message).toContain('Contents')
    expect(message).toMatch(/Read and write/)
  })

  it('a 403 on the branch read or on the .yaseendocs read is no-contents, never "unexpected"', async () => {
    for (const step of ['/branches/', '/contents/']) {
      const fetch: typeof github.fetch = async (url, init) =>
        url.includes(step) ? new Response(JSON.stringify({ message: 'Resource not accessible by personal access token' }), { status: 403 }) : github.fetch(url, init)
      expect(await signIn({ repo: 'yaseen/vault', token: GOOD }, { ...deps, fetch })).toEqual({ ok: false, error: { kind: 'no-contents', repo: 'yaseen/vault' } })
    }
    await nothingStored()
  })
})

describe('YAZ-5166: GitHub says "slow down" with no wait time', () => {
  it.each([
    ['the repo read', (m: string, p: string) => m === 'GET' && p === '/repos/yaseen/vault'],
    ['the branch read', (m: string, p: string) => p.includes('/branches/')],
    ['the write probe', (m: string, p: string) => m === 'POST' && p.endsWith('/git/blobs')],
  ])('on %s: rate-limited with a wait of 60 s, never no-access or read-only', async (_, match) => {
    github.slowDown = match
    await failsWith({ repo: 'yaseen/vault', token: GOOD }, { kind: 'rate-limited', resetAt: NOW + 60_000 })
  })

  it('on the Gists probe: sign-in works, Gists is unknown (checked again later)', async () => {
    github.slowDown = (m, p) => m === 'POST' && p === '/gists'
    expect(await signIn({ repo: 'yaseen/vault', token: GOOD }, deps)).toMatchObject({ ok: true, account: { gists: 'unknown' } })
  })
})

describe('round 16: a vault is the whole repo', () => {
  it('a repo with no vault at its top (no .yaseendocs folder) says so, and stores nothing', async () => {
    await failsWith({ repo: 'yaseen/code', token: GOOD }, { kind: 'no-vault', repo: 'yaseen/code', branch: 'main' })
    expect(signInMessage({ kind: 'no-vault', repo: 'yaseen/code', branch: 'main' })).toMatch(/yaseen\/code.*\.yaseendocs/s)
  })

  it('the vault list holds no folder', async () => {
    await signIn({ repo: 'yaseen/vault', token: GOOD }, deps)
    expect((await loadVaultList(store)).vaults[0]).not.toHaveProperty('folder')
  })
})

describe('new row: the token has only read access', () => {
  it('sign-in says the token must read AND write, and stores nothing', async () => {
    await failsWith({ repo: 'yaseen/vault', token: READ_ONLY }, { kind: 'read-only', repo: 'yaseen/vault' })
    expect(signInMessage({ kind: 'read-only', repo: 'yaseen/vault' })).toMatch(/read and write/i)
  })

  it("a public repo that is not in the token's list: it can be read, but not written", async () => {
    await failsWith({ repo: 'yaseen/public-pages', token: GOOD }, { kind: 'read-only', repo: 'yaseen/public-pages' })
  })

  it('an archived repo is read-only', async () => {
    github.calls.length = 0
    const fake = fakeGithub({ tokens: { [GOOD]: { login: 'yaseen', repos: { 'yaseen/old': 'write' } } }, repos: [{ fullName: 'yaseen/old', archived: true }] })
    const result = await checkSignIn({ repo: 'yaseen/old', token: GOOD }, { fetch: fake.fetch, now: () => NOW })
    expect(result).toEqual({ ok: false, error: { kind: 'read-only', repo: 'yaseen/old' } })
    expect(fake.calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('when the permission is taken away later, the first send fails with READ_ONLY (the red status)', async () => {
    await signIn({ repo: 'yaseen/vault', token: GOOD }, deps)
    const client = githubClient(GOOD, { fetch: readOnlyAfterSignIn(github), now: () => NOW })
    const error = await client.request('/repos/yaseen/vault/git/blobs', { method: 'POST', body: { content: 'x', encoding: 'utf-8' } }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(GithubError)
    expect((error as GithubError).code).toBe('READ_ONLY')
  })
})

describe("GitHub's order of checks for a write is not proven (403 before 422, or the body first)", () => {
  it('the write check does not depend on it: a read-only token is read-only in either order', async () => {
    github.bodyFirst = true
    await failsWith({ repo: 'yaseen/vault', token: READ_ONLY }, { kind: 'read-only', repo: 'yaseen/vault' })
    expect(await signIn({ repo: 'yaseen/vault', token: GOOD }, deps)).toMatchObject({ ok: true })
  })

  it('permission first: a token with no Gists permission is "no" at sign-in', async () => {
    expect(await signIn({ repo: 'yaseen/vault', token: NO_GISTS }, deps)).toMatchObject({ ok: true, account: { gists: 'no' } })
  })

  it('body first: the Gists probe says "yes" by mistake; the first refused gist write sets "no", and Friends says so', async () => {
    github.bodyFirst = true
    expect(await signIn({ repo: 'yaseen/vault', token: NO_GISTS }, deps)).toMatchObject({ ok: true, account: { gists: 'yes' } })
    expect(await loadFriendsAccount(store)).toMatchObject({ kind: 'ok' })
    // The friends sender (4E) writes its gist and gets 403: READ_ONLY on a write.
    const refused = await githubClient(NO_GISTS, { fetch: github.fetch })
      .request('/gists', { method: 'POST', body: { public: false, files: { 'notecards-friends.json': { content: '{}' } } } })
      .catch((e: unknown) => e as GithubError)
    expect((refused as GithubError).code).toBe('READ_ONLY')
    await recordGistsRefused(store, 'yaseen/vault@main')
    expect(await loadAccount(store, 'yaseen/vault@main')).toMatchObject({ gists: 'no' })
    expect(await loadFriendsAccount(store)).toEqual({ kind: 'no-gists', logins: ['yaseen'] })
  })
})

describe('new row: the token has no Gists permission', () => {
  it('sign-in works; the account says no Gists, so the Friends tab can tell how to add it', async () => {
    const result = await signIn({ repo: 'yaseen/vault', token: NO_GISTS }, deps)
    expect(result).toMatchObject({ ok: true, account: { gists: 'no' } })
    expect(await startState(store, tokens)).toEqual({ kind: 'ready', vault: 'yaseen/vault@main' })
  })

  it('when the Gists check cannot run, sign-in still works and the answer is unknown', async () => {
    const fetch = failGistsProbe(github)
    const result = await signIn({ repo: 'yaseen/vault', token: GOOD }, { ...deps, fetch })
    expect(result).toMatchObject({ ok: true, account: { gists: 'unknown' } })
  })
})

describe('no network, GitHub down, too many requests', () => {
  it('no network: says so, stores nothing', async () => {
    github.offline = true
    await failsWith({ repo: 'yaseen/vault', token: GOOD }, { kind: 'offline' })
    expect(signInMessage({ kind: 'offline' })).toMatch(/connection/i)
  })

  it('GitHub is down', async () => {
    github.down = true
    await failsWith({ repo: 'yaseen/vault', token: GOOD }, { kind: 'github-down' })
  })

  it('too many requests: says when to try again', async () => {
    github.rateLimitedUntil = NOW / 1000 + 900
    await failsWith({ repo: 'yaseen/vault', token: GOOD }, { kind: 'rate-limited', resetAt: NOW + 900_000 })
  })
})

describe('N6: the token is cancelled while in use', () => {
  it('GitHub answers UNAUTHORIZED; the local copy and the waiting answers stay; a new token signs in again', async () => {
    await signIn({ repo: 'yaseen/vault', token: GOOD }, deps)
    await store.write('yaseen/vault@main', 'Page.md', '# Page')
    await store.setCheckpoint('yaseen/vault@main', { commit: 'c0ffee', etag: '"e"', shas: { 'Page.md': 's1' } })
    await store.setState('yaseen/vault@main', 'answers', [{ kind: 'review', id: 'abc' }])

    github.revoke(GOOD)
    const error = await githubClient(GOOD, { fetch: github.fetch }).request('/repos/yaseen/vault/branches/main').catch((e: unknown) => e)
    expect((error as GithubError).code).toBe('UNAUTHORIZED')

    // A wrong new token changes nothing.
    expect(await signInAgain('yaseen/vault@main', WRONG, deps)).toEqual({ ok: false, error: { kind: 'unauthorized' } })
    // A token for another repo is refused for this vault.
    expect(await signInAgain('yaseen/vault@main', OTHER_REPO, deps)).toEqual({ ok: false, error: { kind: 'repo-not-found', repo: 'yaseen/vault' } })
    expect(await tokens.read('yaseen/vault@main')).toBe(GOOD)

    expect(await signInAgain('yaseen/vault@main', NO_GISTS, deps)).toMatchObject({ ok: true, vault: 'yaseen/vault@main', account: { gists: 'no' } })
    expect(await tokens.read('yaseen/vault@main')).toBe(NO_GISTS)
    expect((await store.read('yaseen/vault@main', 'Page.md'))?.content).toBe('# Page')
    expect(await store.checkpoint('yaseen/vault@main')).toMatchObject({ commit: 'c0ffee' })
    expect(await store.getState('yaseen/vault@main', 'answers')).toEqual([{ kind: 'review', id: 'abc' }])
    expect((await loadVaultList(store)).vaults).toHaveLength(1)
  })

  it('a vault whose token is missing asks to sign in again, with no call', async () => {
    await signIn({ repo: 'yaseen/vault', token: GOOD }, deps)
    await tokens.clear('yaseen/vault@main')
    github.calls.length = 0
    expect(await startState(store, tokens)).toEqual({ kind: 'sign-in-again', vault: 'yaseen/vault@main' })
    expect(github.calls).toEqual([])
  })

  it('signInAgain for a vault that is not on the phone is refused', async () => {
    await expect(signInAgain('x/y@main', GOOD, deps)).rejects.toThrow(/not on this phone/)
  })
})

describe('N7: sign out and erase this phone', () => {
  it('removes every token and every stored file, checkpoint and state', async () => {
    await signIn({ repo: 'yaseen/vault', token: GOOD }, deps)
    await signIn({ repo: 'acme/pages', token: WORK }, deps)
    await store.write('yaseen/vault@main', 'Page.md', '# Page')
    await store.setCheckpoint('yaseen/vault@main', { commit: 'c', etag: null, shas: {} })
    await signOutAndErase(store, tokens)
    expect(await tokens.read('yaseen/vault@main')).toBeNull()
    expect(await tokens.read('acme/pages@main')).toBeNull()
    expect(await store.list('yaseen/vault@main')).toEqual([])
    expect(await store.checkpoint('yaseen/vault@main')).toBeNull()
    expect(await store.getState(PHONE, 'vaults')).toBeUndefined()
    expect(await loadAccount(store, 'yaseen/vault@main')).toBeUndefined()
    expect(await startState(store, tokens)).toEqual({ kind: 'sign-in' })
  })

  it('the tokens go first: an erase that stops halfway leaves no token behind', async () => {
    await signIn({ repo: 'yaseen/vault', token: GOOD }, deps)
    const broken = { ...store, eraseAll: () => Promise.reject(new Error('the phone stopped')) }
    await expect(signOutAndErase(broken, tokens)).rejects.toThrow(/stopped/)
    expect(await tokens.read('yaseen/vault@main')).toBeNull()
  })

  it('removing one vault removes its token and keeps the others', async () => {
    await signIn({ repo: 'yaseen/vault', token: GOOD }, deps)
    await signIn({ repo: 'yaseen/second', token: GOOD }, deps)
    const list = await forgetVaultAndToken(store, tokens, await loadVaultList(store), 'yaseen/vault@main')
    expect(list).toEqual({ vaults: [expect.objectContaining({ repo: 'yaseen/second' })], open: 'yaseen/second@main' })
    expect(await tokens.read('yaseen/vault@main')).toBeNull()
    expect(await tokens.read('yaseen/second@main')).toBe(GOOD)
  })
})

describe('the token in storage', () => {
  it('the account facts on the phone do not hold the token', async () => {
    const disk = newMemoryDisk()
    const s = await openVaultStore(memoryBackend(disk))
    await signIn({ repo: 'yaseen/vault', token: GOOD }, { ...deps, store: s })
    const rows = JSON.stringify([...disk.get('state')!.values()])
    expect(rows).toContain('yaseen')
    expect(rows).not.toContain(GOOD)
  })
})

/** The fake, but writes to a repo answer 403 from now on: the Contents permission went down to read. */
function readOnlyAfterSignIn(fake: FakeGithub): typeof fake.fetch {
  return async (url, init) =>
    (init.method ?? 'GET') === 'GET' ? fake.fetch(url, init) : new Response(JSON.stringify({ message: 'Resource not accessible by personal access token' }), { status: 403 })
}

/** The fake, but the Gists probe meets a dropped connection. */
function failGistsProbe(fake: FakeGithub): typeof fake.fetch {
  return async (url, init) => (url.endsWith('/gists') ? Promise.reject(new TypeError('Load failed')) : fake.fetch(url, init))
}
