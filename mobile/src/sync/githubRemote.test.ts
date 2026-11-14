import { describe, expect, it } from 'vitest'
import { GithubError, githubClient } from '../github/client'
import { fakeGithub } from '../github/testing'
import { githubRemote } from './githubRemote'
import { BRANCH, REPO, TOKEN, syncSetup } from './testing'

async function failure(promise: Promise<unknown>): Promise<GithubError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof GithubError) return error
    throw error
  }
  throw new Error('expected a GithubError')
}
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

describe('GithubRemote: the four calls, on the one client of 3E', () => {
  it('head: the branch SHA and its ETag; with that ETag, "unchanged" (the free 304 of proof 1B, row R1)', async () => {
    const s = await syncSetup({ 'a.md': 'A' })
    const head = await s.remote.head()
    expect(head).toEqual({ sha: s.git.branches.get(BRANCH), etag: expect.stringMatching(/^W\//) })
    if (head === 'unchanged') throw new Error('no')
    expect(await s.remote.head(head.etag)).toBe('unchanged')
    await s.git.push({ 'b.md': 'B' })
    const moved = await s.remote.head(head.etag)
    expect(moved).not.toBe('unchanged')
    const calls = s.github.calls.filter((c) => c.url.includes('/git/ref/'))
    expect(calls.map((c) => c.url)).toEqual(Array(3).fill(`https://api.github.com/repos/yaseen/vault/git/ref/heads/main`))
  })

  it('head of a branch with slashes keeps them', async () => {
    const s = await syncSetup({ 'a.md': 'A' })
    await s.git.push({ 'b.md': 'B' }, 'feat/phone')
    const remote = githubRemote(githubClient(TOKEN, { fetch: s.github.fetch }), REPO, 'feat/phone')
    expect(await remote.head()).toMatchObject({ sha: s.git.branches.get('feat/phone') })
  })

  it('tree: every file and its blob SHA at a commit, in ONE request by the commit SHA; folders are left out; sizes kept', async () => {
    const s = await syncSetup({ 'a.md': 'A', 'f/b.md': 'BB', 'f/g/c.png': new Uint8Array([1, 2, 3]) })
    const tree = await s.remote.tree(s.git.branches.get(BRANCH)!)
    expect([...tree.keys()].sort()).toEqual(['a.md', 'f/b.md', 'f/g/c.png'])
    expect(tree.get('a.md')).toBe('8c7e5a667f1b771847fe88c01c3de34413a1b220') // git hash-object of "A"
    expect(tree.bytes.get('f/g/c.png')).toBe(3)
    expect(s.count('tree')).toBe(1)
    expect(s.github.calls.at(-1)!.url).toContain('?recursive=1')
  })

  it('tree: a list that GitHub cut short is TREE_TRUNCATED (row F6)', async () => {
    const s = await syncSetup({ 'a.md': 'A', 'b.md': 'B', 'c.md': 'C' })
    s.git.truncateOver = 2
    const error = await failure(s.remote.tree(s.git.branches.get(BRANCH)!))
    expect(error.code).toBe('TREE_TRUNCATED')
  })

  it('blob: the raw bytes, asked with the raw media type (no base64 on the wire)', async () => {
    const png = new Uint8Array([137, 80, 78, 71, 0, 255])
    const s = await syncSetup({ 'p.png': png })
    const tree = await s.remote.tree(s.git.branches.get(BRANCH)!)
    expect(await s.remote.blob(tree.get('p.png')!)).toEqual(png)
  })

  it('commit: text inline in the tree (3 writes), bytes as a blob, a delete; then the ref moves with force: false', async () => {
    const s = await syncSetup({ 'a.md': 'A', 'old.md': 'gone soon' })
    const parent = s.git.branches.get(BRANCH)!
    const sha = await s.remote.commit(parent, [{ path: 'a.md', content: 'A2' }, { path: 'p.png', content: new Uint8Array([9]) }, { path: 'old.md', delete: true }], 'sync (phone): a.md')
    expect(s.git.branches.get(BRANCH)).toBe(sha)
    expect(s.git.commits.get(sha)!.parents).toEqual([parent])
    expect(s.git.commits.get(sha)!.message).toBe('sync (phone): a.md')
    const files = await s.git.filesAt(sha)
    expect(Object.keys(files).sort()).toEqual(['a.md', 'p.png'])
    expect(files['a.md']).toBe('A2')
    const writes = s.github.calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${new URL(c.url).pathname.split('/git/')[1]}`)
    expect(writes).toEqual(['POST blobs', 'POST trees', 'POST commits', 'PATCH refs/heads/main'])
  })

  it('commit with text only is 3 writes and one read (proof 1B: content inline)', async () => {
    const s = await syncSetup({ 'a.md': 'A' })
    await s.remote.commit(s.git.branches.get(BRANCH)!, [{ path: 'a.md', content: 'A2' }], 'm')
    expect(s.count('write')).toBe(3)
  })

  it('commit on a parent that is not the head any more: STALE_HEAD, from the real answer 422 "Update is not a fast forward"; read again and repeat works', async () => {
    const s = await syncSetup({ 'a.md': 'A' })
    const parent = s.git.branches.get(BRANCH)!
    await s.git.push({ 'b.md': 'from the Mac' })
    const error = await failure(s.remote.commit(parent, [{ path: 'a.md', content: 'phone' }], 'm'))
    expect(error.code).toBe('STALE_HEAD')
    expect(error.status).toBe(422)
    expect(error.said).toBe('Update is not a fast forward')
    const head = await s.remote.head()
    if (head === 'unchanged') throw new Error('no')
    const sha = await s.remote.commit(head.sha, [{ path: 'a.md', content: 'phone' }], 'm')
    expect(await s.git.filesAt(sha)).toEqual({ 'a.md': 'phone', 'b.md': 'from the Mac' })
  })

  it('commit refuses an empty change list (no empty commit)', async () => {
    const s = await syncSetup({ 'a.md': 'A' })
    await expect(s.remote.commit(s.git.branches.get(BRANCH)!, [], 'm')).rejects.toThrow()
  })

  it('another 422 on the ref is not STALE_HEAD', async () => {
    const s = await syncSetup({ 'a.md': 'A' })
    s.github.interrupt = (c) => (c.method === 'PATCH' ? json(422, { message: 'Reference does not exist' }) : undefined)
    const error = await failure(s.remote.commit(s.git.branches.get(BRANCH)!, [{ path: 'a.md', content: 'x' }], 'm'))
    expect(error.code).toBe('UNEXPECTED')
  })
})

describe('typed failures, fed with the real answers of proof 1B', () => {
  it('a bad token: 401 "Bad credentials" is UNAUTHORIZED', async () => {
    const s = await syncSetup({ 'a.md': 'A' })
    const remote = githubRemote(githubClient('github_pat_wrong', { fetch: s.github.fetch }), REPO, BRANCH)
    expect((await failure(remote.head())).code).toBe('UNAUTHORIZED')
  })

  it('a repo that is gone, renamed, or that the token cannot see: 404 is NOT_FOUND (one state; GitHub hides a private repo)', async () => {
    const s = await syncSetup({ 'a.md': 'A' })
    const remote = githubRemote(githubClient(TOKEN, { fetch: s.github.fetch }), 'yaseen/other', BRANCH)
    expect((await failure(remote.head())).code).toBe('NOT_FOUND')
    const branch = githubRemote(githubClient(TOKEN, { fetch: s.github.fetch }), REPO, 'deleted')
    expect((await failure(branch.head())).code).toBe('NOT_FOUND')
  })

  it('a read-only token: 403 on the write is READ_ONLY', async () => {
    const s = await syncSetup({ 'a.md': 'A' }, { access: 'read' })
    const error = await failure(s.remote.commit(s.git.branches.get(BRANCH)!, [{ path: 'a.md', content: 'x' }], 'm'))
    expect(error.code).toBe('READ_ONLY')
  })

  it('no connection: OFFLINE', async () => {
    const s = await syncSetup({ 'a.md': 'A' })
    s.github.offline = true
    expect((await failure(s.remote.head())).code).toBe('OFFLINE')
  })

  it('the hourly limit: 403 with x-ratelimit-remaining 0 is RATE_LIMITED with the reset time', async () => {
    const s = await syncSetup({ 'a.md': 'A' })
    const reset = Math.floor(Date.now() / 1000) + 600
    s.github.rateLimitedUntil = reset
    const error = await failure(s.remote.head())
    expect(error.code).toBe('RATE_LIMITED')
    expect(error.resetAt).toBe(reset * 1000)
  })

  it('GitHub\'s secondary limit with Retry-After: RATE_LIMITED at that time, but never under 1 minute (YAZ-5174)', async () => {
    const now = 1_700_000_000_000
    const github = fakeGithub({ tokens: {}, repos: [] })
    github.interrupt = () => json(403, { message: 'You have exceeded a secondary rate limit. Please wait a few minutes before you try again.' }, { 'retry-after': '30' })
    const remote = githubRemote(githubClient(TOKEN, { fetch: github.fetch, now: () => now }), REPO, BRANCH)
    const error = await failure(remote.head())
    expect(error.code).toBe('RATE_LIMITED')
    expect(error.resetAt).toBe(now + 60_000)
  })

  it('the secondary limit with NO Retry-After is RATE_LIMITED too, one minute on (GitHub\'s advice), not NO_ACCESS', async () => {
    const now = 1_700_000_000_000
    const github = fakeGithub({ tokens: {}, repos: [] })
    github.interrupt = () => json(403, { message: 'You have exceeded a secondary rate limit. Please wait a few minutes before you try again.' }, { 'x-ratelimit-remaining': '4000' })
    const remote = githubRemote(githubClient(TOKEN, { fetch: github.fetch, now: () => now }), REPO, BRANCH)
    const error = await failure(remote.head())
    expect(error.code).toBe('RATE_LIMITED')
    expect(error.resetAt).toBe(now + 60_000)
  })

  it('GitHub down: 5xx is GITHUB_DOWN', async () => {
    const s = await syncSetup({ 'a.md': 'A' })
    s.github.down = true
    expect((await failure(s.remote.head())).code).toBe('GITHUB_DOWN')
  })

  it('every call goes to api.github.com, and no error or answer holds the token', async () => {
    const s = await syncSetup({ 'a.md': 'A' })
    const parent = s.git.branches.get(BRANCH)!
    await s.git.push({ 'b.md': 'B' })
    const error = await failure(s.remote.commit(parent, [{ path: 'a.md', content: 'x' }], 'm'))
    expect(JSON.stringify({ ...error, message: error.message })).not.toContain(TOKEN)
    expect(s.github.calls.every((c) => c.url.startsWith('https://api.github.com/'))).toBe(true)
    expect(s.github.answers.join('')).not.toContain(TOKEN)
  })
})
