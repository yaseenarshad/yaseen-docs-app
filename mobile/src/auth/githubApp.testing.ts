import { handle } from '../../worker/index'
import type { FetchLike } from '../github/client'

/**
 * Test help for "Sign in with GitHub" (YAZ-5645): the REAL Worker (`worker/index.ts`) in front of a fake GitHub sign-in.
 * A call to `<site>/api/github/*` goes to the Worker with this site's Origin; the Worker's call to GitHub's token address
 * goes to `oauth`; every other call (api.github.com) goes to `api` (`fakeGithub(…).fetch`). No test calls the real GitHub.
 */
export interface FakeOauth {
  /** code → the pair GitHub gives for it (once). */
  codes: Map<string, { access: string; refresh: string }>
  /** refresh token → the next pair (once; GitHub takes each refresh token once). */
  refreshes: Map<string, { access: string; refresh: string }>
  /** The PKCE verifier GitHub got with each code. */
  verifiers: string[]
  /** The access tokens the Worker asked GitHub to end. */
  revoked: string[]
  /** The calls to the Worker. */
  workerCalls: string[]
  fetch: FetchLike
}

export const TEST_SECRET = 'test-secret-only-0000'

/**
 * `secret`: the Worker's `GITHUB_CLIENT_SECRET`. Leave it out for the right one; `undefined` in `{ secret }` is a Worker
 * whose secret is not set (YAZ-5645 GHF: the live Worker lost it); another text is a key GitHub does not know.
 */
export function fakeOauth(site: string, api: FetchLike, opts: { secret?: string } = {}): FakeOauth {
  const secret = 'secret' in opts ? opts.secret : TEST_SECRET
  const oauth: FakeOauth = {
    codes: new Map(),
    refreshes: new Map(),
    verifiers: [],
    revoked: [],
    workerCalls: [],
    async fetch(url, init) {
      if (!url.startsWith(`${site}/api/github/`)) return api(url, init)
      oauth.workerCalls.push(new URL(url).pathname)
      const request = new Request(url, { method: init.method, headers: { ...Object.fromEntries(new Headers(init.headers)), origin: site }, body: init.body as BodyInit })
      return handle(request, { GITHUB_CLIENT_SECRET: secret }, async (to, sent) => {
        if (to.startsWith('https://api.github.com/applications/')) {
          oauth.revoked.push((JSON.parse(String(sent.body)) as { access_token: string }).access_token)
          return new Response(null, { status: 204 })
        }
        const form = new URLSearchParams(String(sent.body))
        if (form.get('client_secret') !== TEST_SECRET) return Response.json({ error: 'incorrect_client_credentials' })
        const give = (p: { access: string; refresh: string } | undefined, error: string) =>
          p === undefined ? Response.json({ error }) : Response.json({ access_token: p.access, expires_in: 28800, refresh_token: p.refresh, refresh_token_expires_in: 15897600, token_type: 'bearer', scope: '' })
        if (form.get('grant_type') === 'refresh_token') {
          const r = form.get('refresh_token') ?? ''
          const next = oauth.refreshes.get(r)
          oauth.refreshes.delete(r)
          return give(next, 'bad_refresh_token')
        }
        const code = form.get('code') ?? ''
        oauth.verifiers.push(form.get('code_verifier') ?? '')
        const got = oauth.codes.get(code)
        oauth.codes.delete(code)
        return give(got, 'bad_verification_code')
      })
    },
  }
  return oauth
}
