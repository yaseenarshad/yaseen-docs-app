import type { FakeGistWorld } from '@shared/friendGistsFake'
import { GITHUB_API, type FetchLike } from '../github/client'

/**
 * Test help (YAZ-5082): the fake gist world of `shared/friendGistsFake.ts` behind a `fetch`, so the phone's real client
 * (3E) and `gistsApi` run against it. No test calls the real API. `requests` logs each call as the client sent it.
 */
export interface GistsFetch {
  fetch: FetchLike
  requests: { method: string; url: string; authorization: string | null; body: unknown }[]
}

export function gistsFetch(world: FakeGistWorld): GistsFetch {
  const requests: GistsFetch['requests'] = []
  return {
    requests,
    async fetch(url, init) {
      const method = (init.method ?? 'GET').toUpperCase()
      const headers = new Headers(init.headers)
      const body = typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined
      requests.push({ method, url, authorization: headers.get('authorization'), body })
      if (!url.startsWith(`${GITHUB_API}/`)) throw new TypeError('the fake answers api.github.com only')
      const address = new URL(url)
      const token = headers.get('authorization')?.replace(/^Bearer /, '') ?? null
      const answer = await world.http(method, address.pathname, address.searchParams, token, body, headers.get('if-none-match'))
      if (answer === undefined) throw new TypeError('Load failed')
      const noBody = answer.status === 204 || answer.status === 304
      return new Response(noBody ? null : JSON.stringify(answer.body), { status: answer.status, headers: { 'content-type': 'application/json', ...answer.headers } })
    },
  }
}
