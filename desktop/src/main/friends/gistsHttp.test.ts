/**
 * YAZ-5086 (4E5): the Mac's gist calls, in the main process, on the fake gist world of `shared/friendGistsFake.ts`.
 * The token goes in the Authorization header only, to api.github.com only; each failure is a `GistError` with the code
 * the shared send rules read; no message holds the token or a gist ID.
 */
import { describe, expect, it } from 'vitest'
import { GistError, NUMBERS_FILE } from '@shared/friendGists'
import { fakeGistWorld } from '@shared/friendGistsFake'
import { GITHUB_API, macGistsApi, readProfile } from './gistsHttp'
import { worldFetch } from './testing'

const TOKEN = 'github_pat_11MACTEST_mac000000000000000000000000000000000000000000000000000000000000000'
const NOGISTS = 'github_pat_11MACTEST_nogists00000000000000000000000000000000000000000000000000000000'

function setup() {
  const world = fakeGistWorld({ accounts: { [TOKEN]: { login: 'yaseen' }, [NOGISTS]: { login: 'other', gists: false } } })
  const wire = worldFetch(world, { [TOKEN]: { login: 'yaseen', name: 'Yaseen', avatar_url: 'https://avatars.githubusercontent.com/u/1' } })
  return { world, wire, api: macGistsApi(TOKEN, wire.fetch, () => world.now()) }
}

const failure = async (p: Promise<unknown>): Promise<GistError> => {
  try {
    await p
  } catch (err) {
    return err as GistError
  }
  throw new Error('no failure')
}

describe('macGistsApi (YAZ-5086)', () => {
  it('create, list, read with an ETag (304), update with the gist_update count, remove', async () => {
    const { api, world } = setup()
    const made = await api.create('notecards-test numbers', { [NUMBERS_FILE]: '{"v":1}' })
    expect(world.owned('yaseen')[0].public).toBe(false)
    expect((await api.list()).map((g) => [g.id, g.files])).toEqual([[made.id, [NUMBERS_FILE]]])
    const read = await api.read(made.id)
    if (read === 'unchanged') throw new Error('no ETag was sent')
    expect(read.files[NUMBERS_FILE].content).toBe('{"v":1}')
    expect(await api.read(made.id, read.etag)).toBe('unchanged')
    const { rate } = await api.update(made.id, { [NUMBERS_FILE]: '{"v":1,"x":2}' })
    expect(rate).toEqual({ remaining: 99, limit: 100, resetAt: expect.any(Number) })
    await api.remove(made.id)
    expect((await failure(api.read(made.id))).code).toBe('NOT_FOUND')
  })

  it('the token goes in the Authorization header only, and only to api.github.com', async () => {
    const { api, wire } = setup()
    await api.create('notecards-test numbers', { [NUMBERS_FILE]: '{}' })
    await api.list()
    for (const r of wire.requests) {
      expect(r.url.startsWith(`${GITHUB_API}/`)).toBe(true)
      expect(r.url).not.toContain(TOKEN)
      expect(r.body ?? '').not.toContain(TOKEN)
      expect(r.authorization).toBe(`Bearer ${TOKEN}`)
    }
  })

  it('a gist ID that is not hex is refused before a call', async () => {
    const { api, wire } = setup()
    expect((await failure(api.read('../user'))).code).toBe('UNEXPECTED')
    expect((await failure(api.update('a/b', {}))).code).toBe('UNEXPECTED')
    expect(wire.requests).toEqual([])
  })

  it.each([
    ['READ_ONLY', 'a write with no Gists permission (403)'],
    ['RATE_LIMITED', 'the hourly limit'],
    ['UNAUTHORIZED', 'a cancelled token'],
    ['GITHUB_DOWN', 'GitHub down'],
  ] as const)('%s: %s', async (code, _what) => {
    const { api, world } = setup()
    const made = await api.create('notecards-test numbers', { [NUMBERS_FILE]: '{}' })
    world.failNext = () => code
    const err = await failure(api.update(made.id, { [NUMBERS_FILE]: '{"a":1}' }))
    expect(err).toBeInstanceOf(GistError)
    expect(err.code).toBe(code)
    if (code === 'RATE_LIMITED') expect(err.resetAt).toBeGreaterThan(world.now())
    expect(err.message).not.toContain(made.id)
    expect(err.message).not.toContain(TOKEN)
  })

  it('a real 403 on a write from an account with no Gists permission is READ_ONLY', async () => {
    const world = fakeGistWorld({ accounts: { [NOGISTS]: { login: 'other', gists: false } } })
    const api = macGistsApi(NOGISTS, worldFetch(world).fetch)
    expect((await failure(api.create('notecards-test numbers', { [NUMBERS_FILE]: '{}' }))).code).toBe('READ_ONLY')
  })

  it('no connection is OFFLINE', async () => {
    const { api, world } = setup()
    world.offline = true
    expect((await failure(api.list())).code).toBe('OFFLINE')
  })

  it('readProfile: login, name and avatar from GET /user; a wrong token is UNAUTHORIZED', async () => {
    const { wire } = setup()
    expect(await readProfile(TOKEN, wire.fetch)).toEqual({ login: 'yaseen', name: 'Yaseen', avatar: 'https://avatars.githubusercontent.com/u/1' })
    expect((await failure(readProfile(NOGISTS, wire.fetch))).code).toBe('UNAUTHORIZED')
  })
})
