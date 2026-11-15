import { describe, expect, it } from 'vitest'
import { fakeGistWorld } from '@shared/friendGistsFake'
import { LIST_PATH, listErrorCode } from '@shared/friendListStore'
import { githubClient } from '../github/client'
import { listRepo } from './listRepo'
import { gistsFetch } from './testing'

/**
 * YAZ-5492 (nit, round 8): the SECOND phone's answer of a first commit into an EMPTY vault (YAZ-5464) maps to "read
 * again" (`STALE_HEAD`), never to an error the person sees. Two phones make the list at the same moment: both see no
 * commit, both `PUT contents/.yaseendocs/friends.json` with no `sha`; GitHub takes the first, and answers the second
 * 422 `"sha" wasn't supplied` (the strict fake answers as GitHub does). Made-up data; no real GitHub call.
 */
const TOKEN = 'github_pat_11FRIENDSTEST_0000000000000000000000000000000000000000000000000000000000000'

function setup() {
  const world = fakeGistWorld({ accounts: { [TOKEN]: { login: 'ali' } }, start: Date.parse('2026-11-14T06:00:00Z') })
  world.repos!.remove('ali/vault')
  world.repos!.createEmpty('ali/vault', 'ali')
  const http = gistsFetch(world)
  const port = () => listRepo(githubClient(TOKEN, { fetch: http.fetch, now: world.now }), 'ali/vault', 'main')
  return { world, http, port }
}

describe('listRepo: the first commit of an empty vault (YAZ-5464, YAZ-5492)', () => {
  it("the second phone's 422 \"sha wasn't supplied\" is STALE_HEAD (read again); the first phone's list stays", async () => {
    const { world, http, port } = setup()
    const [one, two] = [port(), port()]
    expect(await one.head()).toEqual({ sha: null, etag: null })
    expect(await two.head()).toEqual({ sha: null, etag: null })
    const made = await one.commit(null, LIST_PATH, '{"first":true}', 'friends (phone): friends.json')
    expect(made).toMatch(/^[0-9a-f]{40}$/)
    const err = await two.commit(null, LIST_PATH, '{"second":true}', 'friends (phone): friends.json').catch((e: unknown) => e)
    expect(http.requests.at(-1)).toMatchObject({ method: 'PUT' })
    expect(listErrorCode(err)).toBe('STALE_HEAD')
    expect(world.repos!.file('ali/vault', LIST_PATH)).toBe('{"first":true}')
    // Read again: the second phone now sees the first phone's commit and its list.
    const head = await two.head()
    expect(head).toMatchObject({ sha: made })
    expect(await two.read(made, LIST_PATH)).toBe('{"first":true}')
  })

  it('a 409 "does not match" (a file written meanwhile, with an old sha) is STALE_HEAD too; any other 422 is an error', async () => {
    const { port, http } = setup()
    const p = port()
    const fetch = http.fetch
    const answer = (status: number, message: string) => async (url: string, init: RequestInit) =>
      (init.method ?? 'GET').toUpperCase() === 'PUT' ? new Response(JSON.stringify({ message }), { status, headers: { 'content-type': 'application/json' } }) : fetch(url, init)
    const via = (f: ReturnType<typeof answer>) => listRepo(githubClient(TOKEN, { fetch: f }), 'ali/vault', 'main')
    expect(listErrorCode(await via(answer(409, '.yaseendocs/friends.json does not match abc')).commit(null, LIST_PATH, '{}', 'm').catch((e: unknown) => e))).toBe('STALE_HEAD')
    const other = await via(answer(422, 'Invalid request.\n\nFor \'properties/content\', nil is not a string.')).commit(null, LIST_PATH, '{}', 'm').catch((e: unknown) => e)
    expect(listErrorCode(other)).toBeNull()
    expect(other).toMatchObject({ code: 'UNEXPECTED' })
    expect(p.repo).toBe('ali/vault')
  })
})
