/**
 * Test help (YAZ-5086): the fake gist world of `shared/friendGistsFake.ts` behind a `fetch`, so the Mac's real HTTP
 * adapter (`gistsHttp.ts`) runs against it. `GET /user` answers from `users`. No test calls the real GitHub.
 */
import type { FakeGistWorld } from '@shared/friendGistsFake'
import { GITHUB_API, type FetchLike } from './gistsHttp'

export interface SeenRequest {
  method: string
  url: string
  authorization: string | null
  /** The body as it went on the wire (the byte-level privacy tests read it). */
  body: string | null
}

export function worldFetch(world: FakeGistWorld, users: Record<string, { login: string; name: string | null; avatar_url: string }> = {}): { fetch: FetchLike; requests: SeenRequest[] } {
  const requests: SeenRequest[] = []
  return {
    requests,
    async fetch(url, init = {}) {
      const method = (init.method ?? 'GET').toUpperCase()
      const headers = new Headers(init.headers)
      const body = typeof init.body === 'string' ? init.body : null
      requests.push({ method, url, authorization: headers.get('authorization'), body })
      if (!url.startsWith(`${GITHUB_API}/`)) throw new TypeError('the fake answers api.github.com only')
      const address = new URL(url)
      const token = headers.get('authorization')?.replace(/^Bearer /, '') ?? null
      if (address.pathname === '/user') {
        if (world.offline) throw new TypeError('fetch failed')
        const user = token === null ? undefined : users[token]
        return new Response(JSON.stringify(user ?? { message: 'Bad credentials' }), { status: user === undefined ? 401 : 200, headers: { 'content-type': 'application/json' } })
      }
      const answer = await world.http(method, address.pathname, address.searchParams, token, body === null ? undefined : (JSON.parse(body) as unknown), headers.get('if-none-match'))
      if (answer === undefined) throw new TypeError('fetch failed')
      const noBody = answer.status === 204 || answer.status === 304
      return new Response(noBody ? null : JSON.stringify(answer.body), { status: answer.status, headers: { 'content-type': 'application/json', ...answer.headers } })
    },
  }
}
