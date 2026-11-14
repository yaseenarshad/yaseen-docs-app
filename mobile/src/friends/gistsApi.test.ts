import { describe, expect, it } from 'vitest'
import { fakeGistWorld } from '@shared/friendGistsFake'
import { GithubError, githubClient } from '../github/client'
import { gistsApi } from './gistsApi'
import { gistsFetch } from './testing'

/**
 * YAZ-5082 (4E1): the gists calls on the ONE GitHub client of 3E (`github/client.ts`), with its typed errors. A fake
 * gist API behind `fetch`; no real GitHub call.
 */
const TOKEN = 'github_pat_11FRIENDSTEST_0000000000000000000000000000000000000000000000000000000000000'
const OTHER = 'github_pat_11FRIENDSTEST_1111111111111111111111111111111111111111111111111111111111111'
const NOGISTS = 'github_pat_11FRIENDSTEST_2222222222222222222222222222222222222222222222222222222222222'

function setup() {
  const world = fakeGistWorld({ accounts: { [TOKEN]: { login: 'yaseen' }, [OTHER]: { login: 'sam' }, [NOGISTS]: { login: 'yaseen', gists: false } }, start: Date.parse('2026-11-14T06:00:00Z') })
  const http = gistsFetch(world)
  const api = (token: string) => gistsApi(githubClient(token, { fetch: http.fetch, now: world.now }))
  return { world, http, api }
}

describe('gistsApi (YAZ-5082)', () => {
  it('create, read, update and delete a SECRET gist', async () => {
    const { world, http, api } = setup()
    const me = api(TOKEN)
    const made = await me.create('notecards-test numbers', { 'notecards-stats.json': '{"v":1}' })
    expect(made.id).toMatch(/^[0-9a-f]{32}$/)
    expect(world.owned('yaseen')[0].public).toBe(false)
    expect(http.requests.at(-1)).toMatchObject({ method: 'POST', body: { public: false, description: 'notecards-test numbers' } })
    const read = await me.read(made.id)
    expect(read).toMatchObject({ id: made.id, files: { 'notecards-stats.json': { content: '{"v":1}', truncated: false } } })
    const updated = await me.update(made.id, { 'notecards-stats.json': '{"v":1,"x":2}' })
    expect(updated.rate).toEqual({ remaining: 99, limit: 100, resetAt: expect.any(Number) })
    expect(world.text(made.id, 'notecards-stats.json')).toBe('{"v":1,"x":2}')
    await me.remove(made.id)
    await expect(me.read(made.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('an ETag read: an unchanged gist is a 304, "unchanged"', async () => {
    const { world, api } = setup()
    const me = api(TOKEN)
    const made = await me.create('x', { 'a.json': '{}' })
    const first = await me.read(made.id)
    if (first === 'unchanged') throw new Error('first read')
    expect(first.etag).toBeTruthy()
    expect(await me.read(made.id, first.etag)).toBe('unchanged')
    expect(world.calls.at(-1)!.answer).toBe(304)
    await me.update(made.id, { 'a.json': '{"b":1}' })
    expect(await me.read(made.id, first.etag)).not.toBe('unchanged')
  })

  it('anyone`s token reads a secret gist by its ID (proof 1C); only the owner writes', async () => {
    const { api } = setup()
    const made = await api(TOKEN).create('x', { 'a.json': '{}' })
    expect(await api(OTHER).read(made.id)).toMatchObject({ id: made.id })
    await expect(api(OTHER).update(made.id, { 'a.json': '{"x":1}' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(api(OTHER).remove(made.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('lists ALL my gists over pages of 100, with file names and no file text', async () => {
    const { world, http, api } = setup()
    for (let i = 0; i < 130; i++) world.seed('yaseen', { [`f${i}.json`]: '{}' })
    world.seed('sam', { 'notecards-friends.json': '{}' })
    const list = await api(TOKEN).list()
    expect(list).toHaveLength(130)
    expect(list[0]).toEqual({ id: expect.any(String), description: expect.any(String), files: [expect.stringMatching(/^f\d+\.json$/)], createdAt: expect.any(String), updatedAt: expect.any(String) })
    expect(http.requests.filter((r) => r.url.includes('/gists?'))).toHaveLength(2)
    expect(http.requests.at(-1)!.url).toContain('per_page=100')
  })

  it('typed errors from the 3E client: no Gists permission is READ_ONLY on a write; no network is OFFLINE', async () => {
    const { world, api } = setup()
    await expect(api(NOGISTS).create('x', { 'a.json': '{}' })).rejects.toMatchObject({ code: 'READ_ONLY' })
    world.offline = true
    await expect(api(TOKEN).list()).rejects.toMatchObject({ code: 'OFFLINE' })
    world.offline = false
    world.failNext = () => 'RATE_LIMITED'
    const err = await api(TOKEN).list().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(GithubError)
    expect(err).toMatchObject({ code: 'RATE_LIMITED', resetAt: expect.any(Number) })
  })

  it('a gist ID that is not hex is refused before any call (a friend`s pointer is untrusted)', async () => {
    const { http, api } = setup()
    for (const id of ['../user', 'abc/def', '', 'ab cd', 'https://evil.example/x', 'abc?x=1'])
      await expect(api(TOKEN).read(id)).rejects.toThrow('not a gist ID')
    expect(http.requests).toHaveLength(0)
  })

  it('the token is in the Authorization header only: never in an address or an error', async () => {
    const { world, http, api } = setup()
    const made = await api(TOKEN).create('x', { 'a.json': '{}' })
    await api(TOKEN).read(made.id)
    world.failNext = () => 'READ_ONLY'
    const err = await api(TOKEN).update(made.id, { 'a.json': '{}' }).catch((e: unknown) => e)
    for (const r of http.requests) {
      expect(r.url.startsWith('https://api.github.com/gists')).toBe(true)
      expect(r.url).not.toContain(TOKEN)
      expect(r.authorization).toBe(`Bearer ${TOKEN}`)
    }
    expect(JSON.stringify(err) + String(err) + (err as Error).stack).not.toContain(TOKEN)
  })
})
