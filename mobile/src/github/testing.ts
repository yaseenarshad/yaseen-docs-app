import { GITHUB_API, type FetchLike } from './client'

/**
 * Test help: a fake GitHub API behind a `fetch`, so no test calls the real one (3E, and 3B can add its routes).
 * It answers the calls of the sign-in check as GitHub does, by the token in the Authorization header. The status
 * codes are from GitHub's docs; proofs 1B and 1C confirm them on the real API.
 */
export interface FakeToken {
  login: string
  name?: string | null
  /** `fine` is a fine-grained token (`github_pat_…`); `classic` (`ghp_…`) says its scopes in `X-OAuth-Scopes`. */
  kind?: 'fine' | 'classic'
  /** Contents permission for each repo (`owner/name`, any case). A repo not listed: no access. */
  repos?: Record<string, 'read' | 'write'>
  /** The account permission "Gists" (write). For a classic token: the `gist` scope. */
  gists?: boolean
  /** The value of `github-authentication-token-expiration`, as GitHub writes it. */
  expires?: string
}

export interface FakeRepo {
  fullName: string
  private?: boolean
  defaultBranch?: string
  branches?: string[]
  archived?: boolean
  /** The repo has a vault at its top (a `.yaseendocs` folder). Default true. */
  vault?: boolean
}

export interface FakeCall {
  method: string
  url: string
  /** The token the call carried, or null. */
  token: string | null
}

export interface FakeGithub {
  fetch: FetchLike
  calls: FakeCall[]
  /** Every value the fake answered with, to check that none holds the token. */
  answers: string[]
  offline: boolean
  down: boolean
  /** Seconds since 1970 when the hourly limit resets, or null: no limit hit. */
  rateLimitedUntil: number | null
  revoke(token: string): void
}

export function fakeGithub(setup: { tokens: Record<string, FakeToken>; repos: FakeRepo[] }): FakeGithub {
  const tokens = new Map(Object.entries(setup.tokens))
  const repos = new Map(setup.repos.map((r) => [r.fullName.toLowerCase(), r]))
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) => {
    const text = JSON.stringify(body)
    fake.answers.push(text, JSON.stringify(headers))
    return new Response(text, { status, headers: { 'content-type': 'application/json', ...headers } })
  }
  const notFound = () => json(404, { message: 'Not Found', documentation_url: 'https://docs.github.com/rest' })
  const notAllowed = () => json(403, { message: 'Resource not accessible by personal access token' })

  const fake: FakeGithub = {
    calls: [],
    answers: [],
    offline: false,
    down: false,
    rateLimitedUntil: null,
    revoke: (token) => void tokens.delete(token),
    async fetch(url, init) {
      const method = (init.method ?? 'GET').toUpperCase()
      const auth = new Headers(init.headers).get('authorization')
      const token = auth?.replace(/^(Bearer|token) /, '') ?? null
      fake.calls.push({ method, url, token })
      if (fake.offline) throw new TypeError('Load failed')
      if (!url.startsWith(`${GITHUB_API}/`)) throw new TypeError('the fake answers api.github.com only')
      if (fake.down) return new Response('<html>Unicorn</html>', { status: 503 })
      if (fake.rateLimitedUntil !== null)
        return json(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(fake.rateLimitedUntil) })

      const who = token === null ? undefined : tokens.get(token)
      if (who === undefined) return json(401, { message: 'Bad credentials' })
      const path = new URL(url).pathname.split('/').map(decodeURIComponent)
      const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {}

      if (method === 'GET' && path[1] === 'user' && path.length === 2) {
        const headers: Record<string, string> = {}
        if (who.kind === 'classic') headers['x-oauth-scopes'] = ['repo', ...(who.gists ? ['gist'] : [])].join(', ')
        if (who.expires) headers['github-authentication-token-expiration'] = who.expires
        return json(200, { login: who.login, id: 1, name: who.name ?? null, avatar_url: `https://avatars.githubusercontent.com/u/1?v=4` }, headers)
      }

      if (path[1] === 'gists' && path.length === 2 && method === 'POST') {
        if (!who.gists) return notAllowed()
        const files = body.files as Record<string, unknown> | undefined
        if (!files || Object.keys(files).length === 0) return json(422, { message: 'Validation Failed', errors: [{ resource: 'Gist', code: 'missing_field', field: 'files' }] })
        return json(201, { id: 'g1' })
      }

      if (path[1] === 'repos' && path.length >= 4) {
        const full = `${path[2]}/${path[3]}`.toLowerCase()
        const repo = repos.get(full)
        const access = Object.entries(who.repos ?? {}).find(([r]) => r.toLowerCase() === full)?.[1]
        if (repo === undefined || (access === undefined && repo.private !== false)) return notFound()
        const rest = path.slice(4)
        if (method === 'GET' && rest.length === 0) {
          const ownerIsUser = repo.fullName.split('/')[0].toLowerCase() === who.login.toLowerCase()
          // As GitHub: `permissions` is the USER's role in the repo, not what this token may do.
          return json(200, {
            full_name: repo.fullName,
            private: repo.private !== false,
            archived: repo.archived ?? false,
            default_branch: repo.defaultBranch ?? 'main',
            permissions: { admin: ownerIsUser, push: ownerIsUser, pull: true },
          })
        }
        if (method === 'GET' && rest[0] === 'branches' && rest.length >= 2) {
          const branch = rest.slice(1).join('/')
          if (!(repo.branches ?? [repo.defaultBranch ?? 'main']).includes(branch)) return json(404, { message: 'Branch not found' })
          return json(200, { name: branch, commit: { sha: 'c0ffee' } })
        }
        if (method === 'GET' && rest[0] === 'contents') {
          const branch = new URL(url).searchParams.get('ref') ?? repo.defaultBranch ?? 'main'
          if (!(repo.branches ?? [repo.defaultBranch ?? 'main']).includes(branch)) return json(404, { message: `No commit found for the ref ${branch}` })
          if (rest.slice(1).join('/') === '.yaseendocs' && repo.vault !== false)
            return json(200, [{ name: 'review.json', path: '.yaseendocs/review.json', type: 'file' }])
          return notFound()
        }
        if (method === 'POST' && rest.join('/') === 'git/blobs') {
          if (access !== 'write') return notAllowed()
          if (repo.archived) return json(403, { message: 'Repository was archived so is read-only.' })
          if (typeof body.content !== 'string') return json(422, { message: 'Invalid request.\n\n"content" wasn\'t supplied.' })
          return json(201, { sha: 'b10b' })
        }
      }
      return notFound()
    },
  }
  return fake
}
