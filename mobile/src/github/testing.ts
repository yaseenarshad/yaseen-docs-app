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
  /**
   * Contents permission for each repo (`owner/name`, any case). A repo not listed: no access. `none`: the repo is
   * selected, but Contents is "No access" (GitHub's default): Metadata lets the token see the repo, not its files.
   */
  repos?: Record<string, 'none' | 'read' | 'write'>
  /** The account permission "Gists" (write). For a classic token: the `gist` scope. */
  gists?: boolean
  /** The value of `github-authentication-token-expiration`, as GitHub writes it. */
  expires?: string
  /**
   * YAZ-5645: a GitHub App user token (`ghu_…`) sees the repos of the app's installations it can reach: each
   * installation (an account that installed the app) and the repos chosen there. `GET /user/installations` lists them.
   */
  installations?: { id: number; account: string; repos: string[] }[]
}

export interface FakeRepo {
  fullName: string
  private?: boolean
  defaultBranch?: string
  branches?: string[]
  archived?: boolean
  /** The repo has a vault at its top (a `.yaseendocs` folder). Default true. */
  vault?: boolean
  /** `pushed_at` in `GET /user/repos` (ISO). Default: 2026-01-01. */
  pushedAt?: string
  /** The repo's files and history, for the git calls of 3B (`fakeGit`). Without it, the git reads answer 404. */
  git?: FakeGit
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
  /**
   * Answers a call before the routes do (3B): return a `Response` to answer with it, throw to act as a lost
   * connection, or return undefined to let the routes answer. For "slow down", a dropped download, a 5xx in the middle.
   */
  interrupt: ((call: FakeCall) => Response | undefined) | null
  revoke(token: string): void
  /**
   * YAZ-5645 slice 2: the person takes `repo` off the app's list on GitHub ("Manage repos", or the app removed). The
   * user token no longer reaches it (404) and no installation lists it. This fake's copy only: the shared setup stays.
   */
  takeOff(token: string, repo: string): void
  /**
   * GitHub's order of checks for a write is not proven: the permission first (403), or the body first (422). With
   * true, the fake checks the body first, so a token with too little access gets 422 for a wrong body.
   */
  bodyFirst: boolean
  /** When set, the next calls that match get GitHub's "slow down" answer (403, no retry-after, requests left). */
  slowDown: ((method: string, path: string) => boolean) | null
  /** The blobs the fake stored, by content: a blob with the same bytes is stored once, as in git. */
  blobs: Set<string>
  /** YAZ-5929: how `POST /graphql` answers the blob query (`object(oid:) { ... on Blob { text isBinary isTruncated } }`). */
  graphql: FakeGraphql
}

export interface FakeGraphql {
  /** Blob SHAs GitHub calls binary: `text: null, isBinary: true`. */
  binary: Set<string>
  /** Blob SHAs whose text GitHub cuts short: half the text, `isTruncated: true`. */
  truncated: Set<string>
  /** Blob SHAs answered with another text (and `isTruncated: false`): the phone's SHA check must catch it. */
  wrong: Set<string>
  /**
   * Seconds since 1970 when GraphQL's count resets, or null. While set, a query gets GitHub's answer for a used-up
   * count: HTTP 200, `errors: [{ type: 'RATE_LIMITED' }]`, `x-ratelimit-remaining: 0`.
   */
  limitedUntil: number | null
  /** The queries answered, with the number of blobs each one asked for. */
  queries: number[]
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
    interrupt: null,
    bodyFirst: false,
    slowDown: null,
    blobs: new Set(),
    graphql: { binary: new Set(), truncated: new Set(), wrong: new Set(), limitedUntil: null, queries: [] },
    revoke: (token) => void tokens.delete(token),
    takeOff(token, repo) {
      const who = tokens.get(token)
      if (who === undefined) return
      const off = (r: string) => r.toLowerCase() !== repo.toLowerCase()
      tokens.set(token, {
        ...who,
        repos: Object.fromEntries(Object.entries(who.repos ?? {}).filter(([r]) => off(r))),
        installations: (who.installations ?? []).map((i) => ({ ...i, repos: i.repos.filter(off) })),
      })
    },
    async fetch(url, init) {
      const method = (init.method ?? 'GET').toUpperCase()
      const auth = new Headers(init.headers).get('authorization')
      const token = auth?.replace(/^(Bearer|token) /, '') ?? null
      fake.calls.push({ method, url, token })
      if (fake.offline) throw new TypeError('Load failed')
      if (!url.startsWith(`${GITHUB_API}/`)) throw new TypeError('the fake answers api.github.com only')
      if (fake.interrupt !== null) {
        const answer = fake.interrupt({ method, url, token })
        if (answer !== undefined) return answer
      }
      if (fake.down) return new Response('<html>Unicorn</html>', { status: 503 })
      if (fake.rateLimitedUntil !== null)
        return json(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(fake.rateLimitedUntil) })

      if (fake.slowDown?.(method, new URL(url).pathname))
        return json(403, { message: 'You have exceeded a secondary rate limit. Please wait a few minutes before you try again.' }, { 'x-ratelimit-remaining': '4990' })
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

      // YAZ-5408: the repos this token can reach, as GitHub pages them (`per_page`, `page`, the `Link` header). A
      // fine-grained token lists the repos it was given; a classic token lists every repo of its user.
      if (method === 'GET' && path[1] === 'user' && path[2] === 'repos' && path.length === 3) {
        const query = new URL(url).searchParams
        const size = Math.min(100, Number(query.get('per_page') ?? 30))
        const page = Math.max(1, Number(query.get('page') ?? 1))
        const given = (r: FakeRepo) => Object.keys(who.repos ?? {}).some((k) => k.toLowerCase() === r.fullName.toLowerCase())
        const mine = (r: FakeRepo) => r.fullName.split('/')[0].toLowerCase() === who.login.toLowerCase()
        const all = setup.repos.filter((r) => given(r) || (who.kind === 'classic' && mine(r)))
        const last = Math.max(1, Math.ceil(all.length / size))
        const link = (n: number, rel: string) => `<${GITHUB_API}/user/repos?per_page=${size}&page=${n}>; rel="${rel}"`
        const links = [...(page < last ? [link(page + 1, 'next'), link(last, 'last')] : []), ...(page > 1 ? [link(1, 'first'), link(page - 1, 'prev')] : [])]
        const body = all.slice((page - 1) * size, page * size).map((r) => ({
          full_name: r.fullName,
          name: r.fullName.split('/')[1],
          owner: { login: r.fullName.split('/')[0] },
          private: r.private !== false,
          archived: r.archived ?? false,
          default_branch: r.defaultBranch ?? 'main',
          pushed_at: r.pushedAt ?? '2026-01-01T00:00:00Z',
        }))
        return json(200, body, links.length > 0 ? { link: links.join(', ') } : {})
      }

      // YAZ-5645: the app's installations this user token reaches, and each one's chosen repos, paged as GitHub does.
      if (method === 'GET' && path[1] === 'user' && path[2] === 'installations') {
        const query = new URL(url).searchParams
        const size = Math.min(100, Number(query.get('per_page') ?? 30))
        const page = Math.max(1, Number(query.get('page') ?? 1))
        const paged = <T,>(all: T[], key: string, base: string, map: (x: T) => unknown) => {
          const last = Math.max(1, Math.ceil(all.length / size))
          const link: Record<string, string> = page < last ? { link: `<${GITHUB_API}${base}?per_page=${size}&page=${page + 1}>; rel="next", <${GITHUB_API}${base}?per_page=${size}&page=${last}>; rel="last"` } : {}
          return json(200, { total_count: all.length, [key]: all.slice((page - 1) * size, page * size).map(map) }, link)
        }
        const mine = who.installations ?? []
        if (path.length === 3) return paged(mine, 'installations', '/user/installations', (i) => ({ id: i.id, account: { login: i.account }, app_slug: 'yaseen-docs' }))
        const inst = mine.find((i) => String(i.id) === path[3])
        if (inst === undefined || path[4] !== 'repositories' || path.length !== 5) return notFound()
        const list = inst.repos.map((name) => repos.get(name.toLowerCase())).filter((r): r is FakeRepo => r !== undefined)
        return paged(list, 'repositories', `/user/installations/${inst.id}/repositories`, (r) => ({
          full_name: r.fullName,
          private: r.private !== false,
          default_branch: r.defaultBranch ?? 'main',
          pushed_at: r.pushedAt ?? '2026-01-01T00:00:00Z',
        }))
      }

      if (method === 'POST' && path[1] === 'graphql' && path.length === 2) return graphqlRoute(fake.graphql, body, who, repos, json)

      if (path[1] === 'gists' && path.length === 2 && method === 'POST') {
        const files = body.files as Record<string, unknown> | undefined
        const badBody = !files || Object.keys(files).length === 0
        const invalid = () => json(422, { message: 'Validation Failed', errors: [{ resource: 'Gist', code: 'missing_field', field: 'files' }] })
        if (badBody && fake.bodyFirst) return invalid()
        if (!who.gists) return notAllowed()
        if (badBody) return invalid()
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
        if (rest.length > 0 && access === 'none' && repo.private !== false) return notAllowed()
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
          const invalid = () => json(422, { message: 'Invalid request.\n\n"content" wasn\'t supplied.' })
          if (typeof body.content !== 'string' && fake.bodyFirst) return invalid()
          if (access !== 'write') return notAllowed()
          if (repo.archived) return json(403, { message: 'Repository was archived so is read-only.' })
          if (typeof body.content !== 'string') return invalid()
          fake.blobs.add(`${full}:${body.content}`)
          if (repo.git === undefined) return json(201, { sha: 'b10b' })
          const bytes = body.encoding === 'base64' ? fromBase64(body.content) : new TextEncoder().encode(body.content)
          return json(201, { sha: await repo.git.addBlob(bytes) })
        }
        // YAZ-5514: `compare/{base}...{head}`, as GitHub answers it: `status` is how `head` stands to `base`.
        if (method === 'GET' && rest[0] === 'compare' && rest.length === 2 && repo.git !== undefined) {
          const [base, head] = rest[1].split('...')
          const git = repo.git
          if (!git.commits.has(base) || !git.commits.has(head)) return json(404, { message: 'Not Found', documentation_url: 'https://docs.github.com/rest/commits/commits#compare-two-commits' })
          const ancestors = (from: string) => {
            const seen = new Set<string>()
            for (const queue = [from]; queue.length > 0; ) {
              const next = queue.pop()!
              if (seen.has(next)) continue
              seen.add(next)
              queue.push(...(git.commits.get(next)?.parents ?? []))
            }
            return seen
          }
          const status = base === head ? 'identical' : ancestors(head).has(base) ? 'ahead' : ancestors(base).has(head) ? 'behind' : 'diverged'
          return json(200, { status })
        }
        if (rest[0] === 'git' && repo.git !== undefined) return gitRoute(repo.git, method, rest.slice(1), access, init, body, url, json)
      }
      return notFound()
    },
  }
  return fake
}

/**
 * YAZ-5929: GitHub's GraphQL for the one query the phone sends: `repository(owner: $owner, name: $name) { b0:
 * object(oid: "…") { ... on Blob { text isBinary isTruncated } } … }`. As GitHub: a repo the token cannot see is
 * `repository: null` with a `NOT_FOUND` error; an unknown SHA is `null`; a used-up count is HTTP 200 with a
 * `RATE_LIMITED` error. More than 100 objects is refused (the phone never asks for more).
 */
function graphqlRoute(g: FakeGraphql, body: Record<string, unknown>, who: FakeToken, repos: Map<string, FakeRepo>, json: Json): Response {
  const rate = (remaining: number, reset: number) => ({ 'x-ratelimit-resource': 'graphql', 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': String(remaining), 'x-ratelimit-reset': String(reset) })
  if (g.limitedUntil !== null) return json(200, { errors: [{ type: 'RATE_LIMITED', code: 'graphql_rate_limit', message: 'API rate limit already exceeded for user ID 1.' }] }, rate(0, g.limitedUntil))
  const query = typeof body.query === 'string' ? body.query : ''
  const variables = (body.variables ?? {}) as { owner?: string; name?: string }
  const asked = [...query.matchAll(/(\w+): object\(oid: "([0-9a-f]+)"\) \{ \.\.\. on Blob \{ text isBinary isTruncated \} \}/g)].map((m) => ({ alias: m[1], sha: m[2] }))
  if (!/repository\(owner: \$owner, name: \$name\)/.test(query) || asked.length === 0) return json(200, { errors: [{ message: 'Parse error' }] }, rate(4999, 0))
  if (asked.length > 100) return json(200, { errors: [{ type: 'MAX_NODE_LIMIT_EXCEEDED', message: 'too many objects' }] }, rate(4999, 0))
  g.queries.push(asked.length)
  const full = `${variables.owner}/${variables.name}`.toLowerCase()
  const repo = repos.get(full)
  const access = Object.entries(who.repos ?? {}).find(([r]) => r.toLowerCase() === full)?.[1]
  if (repo?.git === undefined || ((access === undefined || access === 'none') && repo.private !== false))
    return json(200, { data: { repository: null }, errors: [{ type: 'NOT_FOUND', path: ['repository'], message: `Could not resolve to a Repository with the name '${full}'.` }] }, rate(4999, 0))
  const answer: Record<string, unknown> = {}
  for (const { alias, sha } of asked) {
    const bytes = repo.git.blobs.get(sha)
    if (bytes === undefined) answer[alias] = null
    else if (g.binary.has(sha)) answer[alias] = { text: null, isBinary: true, isTruncated: false }
    else {
      const text = new TextDecoder().decode(bytes)
      if (g.truncated.has(sha)) answer[alias] = { text: text.slice(0, Math.floor(text.length / 2)), isBinary: false, isTruncated: true }
      else if (g.wrong.has(sha)) answer[alias] = { text: `${text} (not the file)`, isBinary: false, isTruncated: false }
      else answer[alias] = { text, isBinary: false, isTruncated: false }
    }
  }
  return json(200, { data: { repository: answer } }, rate(4999, 0))
}

/**
 * Test help for 3B: a repo's git data, driven by a list of commits. Each `push` is one commit that moves the branch.
 * Blob SHAs are real git SHAs (`blob <size>\0<bytes>`, SHA-1), so the phone's own check of a stored file matches.
 * The routes answer as GitHub did in proof 1B (YAZ-5063): a ref with a weak ETag and a free 304; the recursive tree
 * by commit SHA with `truncated`; raw blobs; the write chain; and 422 "Update is not a fast forward".
 */
export interface FakeGit {
  /** Branch → head commit. */
  branches: Map<string, string>
  commits: Map<string, { tree: string; parents: string[]; message: string }>
  trees: Map<string, Map<string, string>>
  blobs: Map<string, Uint8Array>
  /** A tree answer with more files than this is cut short and says `truncated: true` (row F6). */
  truncateOver: number | null
  /** One commit on `branch` (default: the first branch): `null` deletes a path. Returns the commit SHA. */
  push(files: Record<string, string | Uint8Array | null>, branch?: string): Promise<string>
  /** A force push: the branch gets a new commit with exactly `files`, not built on the old head (row R11). */
  forcePush(files: Record<string, string | Uint8Array>, branch?: string): Promise<string>
  /** The files at a commit, as text. */
  filesAt(commit: string): Promise<Record<string, string>>
  addBlob(bytes: Uint8Array): Promise<string>
}

const hexOf = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
async function sha1(bytes: Uint8Array): Promise<string> {
  return hexOf(await crypto.subtle.digest('SHA-1', bytes as Uint8Array<ArrayBuffer>))
}
function fromBase64(text: string): Uint8Array {
  const raw = atob(text.replace(/\s/g, ''))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}
function toBase64(bytes: Uint8Array): string {
  let raw = ''
  for (const b of bytes) raw += String.fromCharCode(b)
  return btoa(raw)
}

export async function fakeGit(files: Record<string, string | Uint8Array> = {}, branch = 'main'): Promise<FakeGit> {
  let made = 0
  const git: FakeGit = {
    branches: new Map(),
    commits: new Map(),
    trees: new Map(),
    blobs: new Map(),
    truncateOver: null,
    async addBlob(bytes) {
      const head = new TextEncoder().encode(`blob ${bytes.byteLength}\0`)
      const all = new Uint8Array(head.byteLength + bytes.byteLength)
      all.set(head)
      all.set(bytes, head.byteLength)
      const sha = await sha1(all)
      git.blobs.set(sha, bytes)
      return sha
    },
    async push(changes, on = [...git.branches.keys()][0] ?? branch) {
      const parent = git.branches.get(on)
      const tree = new Map(parent === undefined ? [] : git.trees.get(git.commits.get(parent)!.tree)!)
      for (const [path, content] of Object.entries(changes)) {
        if (content === null) tree.delete(path)
        else tree.set(path, await git.addBlob(typeof content === 'string' ? new TextEncoder().encode(content) : content))
      }
      return commitTree(tree, parent === undefined ? [] : [parent], 'push', on)
    },
    async forcePush(all, on = [...git.branches.keys()][0] ?? branch) {
      const tree = new Map<string, string>()
      for (const [path, content] of Object.entries(all)) tree.set(path, await git.addBlob(typeof content === 'string' ? new TextEncoder().encode(content) : content))
      return commitTree(tree, [], 'force', on)
    },
    async filesAt(commit) {
      const tree = git.trees.get(git.commits.get(commit)!.tree)!
      return Object.fromEntries([...tree].map(([path, sha]) => [path, new TextDecoder().decode(git.blobs.get(sha))]))
    },
  }
  async function newTree(tree: Map<string, string>): Promise<string> {
    const sha = await sha1(new TextEncoder().encode(`tree ${made++} ${JSON.stringify([...tree])}`))
    git.trees.set(sha, tree)
    return sha
  }
  async function commitTree(tree: Map<string, string>, parents: string[], message: string, on: string | null): Promise<string> {
    const treeSha = await newTree(tree)
    const sha = await sha1(new TextEncoder().encode(`commit ${made++} ${treeSha}`))
    git.commits.set(sha, { tree: treeSha, parents, message })
    if (on !== null) git.branches.set(on, sha)
    return sha
  }
  ;(git as FakeGit & { _commit: typeof commitTree; _tree: typeof newTree })._commit = commitTree
  ;(git as FakeGit & { _commit: typeof commitTree; _tree: typeof newTree })._tree = newTree
  await git.push(files, branch)
  return git
}

type Json = (status: number, body: unknown, headers?: Record<string, string>) => Response

async function gitRoute(git: FakeGit, method: string, rest: string[], access: 'none' | 'read' | 'write' | undefined, init: RequestInit, body: Record<string, unknown>, url: string, json: Json): Promise<Response> {
  const inner = git as FakeGit & { _commit(tree: Map<string, string>, parents: string[], message: string, on: string | null): Promise<string>; _tree(tree: Map<string, string>): Promise<string> }
  const notFound = () => json(404, { message: 'Not Found', documentation_url: 'https://docs.github.com/rest/git' })
  const write = method !== 'GET'
  if (write && access !== 'write') return json(403, { message: 'Resource not accessible by personal access token' })
  const headers = new Headers(init.headers)

  if (method === 'GET' && rest[0] === 'ref' && rest[1] === 'heads') {
    const head = git.branches.get(rest.slice(2).join('/'))
    if (head === undefined) return notFound()
    const etag = `W/"${head.slice(0, 32)}"`
    if (headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { etag } })
    return json(200, { ref: `refs/heads/${rest.slice(2).join('/')}`, object: { sha: head, type: 'commit' } }, { etag, 'cache-control': 'private, max-age=60, s-maxage=60' })
  }
  if (method === 'GET' && rest[0] === 'trees' && rest.length === 2) {
    const commit = git.commits.get(rest[1])
    const treeSha = commit?.tree ?? rest[1]
    const tree = git.trees.get(treeSha)
    if (tree === undefined) return notFound()
    const folders = new Set<string>()
    for (const path of tree.keys()) for (let i = path.indexOf('/'); i > 0; i = path.indexOf('/', i + 1)) folders.add(path.slice(0, i))
    let entries = [
      ...[...folders].map((path) => ({ path, mode: '040000', type: 'tree', sha: 'f'.repeat(40) })),
      ...[...tree].map(([path, sha]) => ({ path, mode: '100644', type: 'blob', sha, size: git.blobs.get(sha)!.byteLength, url: `https://api.github.com/repos/x/y/git/blobs/${sha}` })),
    ].sort((a, b) => (a.path < b.path ? -1 : 1))
    const truncated = git.truncateOver !== null && entries.length > git.truncateOver
    if (truncated) entries = entries.slice(0, git.truncateOver!)
    void url
    return json(200, { sha: treeSha, url: '', tree: entries, truncated })
  }
  if (method === 'GET' && rest[0] === 'blobs' && rest.length === 2) {
    const bytes = git.blobs.get(rest[1])
    if (bytes === undefined) return notFound()
    if ((headers.get('accept') ?? '').includes('raw')) return new Response(bytes as Uint8Array<ArrayBuffer>, { status: 200, headers: { 'content-type': 'application/octet-stream' } })
    return json(200, { sha: rest[1], size: bytes.byteLength, encoding: 'base64', content: toBase64(bytes) })
  }
  if (method === 'GET' && rest[0] === 'commits' && rest.length === 2) {
    const commit = git.commits.get(rest[1])
    if (commit === undefined) return notFound()
    return json(200, { sha: rest[1], tree: { sha: commit.tree }, parents: commit.parents.map((sha) => ({ sha })), message: commit.message })
  }
  if (method === 'POST' && rest[0] === 'trees' && rest.length === 1) {
    const base = typeof body.base_tree === 'string' ? git.trees.get(body.base_tree) : new Map<string, string>()
    if (base === undefined) return json(422, { message: 'Invalid tree info' })
    const tree = new Map(base)
    for (const entry of body.tree as { path: string; sha?: string | null; content?: string }[]) {
      if (typeof entry.content === 'string') tree.set(entry.path, await git.addBlob(new TextEncoder().encode(entry.content)))
      else if (entry.sha === null) tree.delete(entry.path)
      else if (typeof entry.sha === 'string' && git.blobs.has(entry.sha)) tree.set(entry.path, entry.sha)
      else return json(422, { message: 'Invalid tree info' })
    }
    return json(201, { sha: await inner._tree(tree) })
  }
  if (method === 'POST' && rest[0] === 'commits' && rest.length === 1) {
    if (typeof body.tree !== 'string' || !git.trees.has(body.tree)) return json(422, { message: 'Tree SHA does not exist' })
    const parents = (body.parents as string[]) ?? []
    if (parents.some((p) => !git.commits.has(p))) return json(422, { message: 'Parent SHA does not exist or is not a commit object' })
    const tree = git.trees.get(body.tree)!
    const sha = await inner._commit(tree, parents, String(body.message ?? ''), null)
    return json(201, { sha, tree: { sha: git.commits.get(sha)!.tree }, parents: parents.map((p) => ({ sha: p })) })
  }
  if (method === 'PATCH' && rest[0] === 'refs' && rest[1] === 'heads') {
    const name = rest.slice(2).join('/')
    const head = git.branches.get(name)
    if (head === undefined) return json(422, { message: 'Reference does not exist' })
    const sha = body.sha as string
    if (!git.commits.has(sha)) return json(422, { message: 'Object does not exist' })
    const ancestors = new Set<string>()
    for (const queue = [sha]; queue.length > 0; ) {
      const next = queue.pop()!
      if (ancestors.has(next)) continue
      ancestors.add(next)
      queue.push(...(git.commits.get(next)?.parents ?? []))
    }
    // Proof 1B: a branch that moved past the parent answers 422 "Update is not a fast forward", status as a string.
    if (body.force !== true && !ancestors.has(head)) return json(422, { message: 'Update is not a fast forward', documentation_url: 'https://docs.github.com/rest/git/refs#update-a-reference', status: '422' })
    git.branches.set(name, sha)
    return json(200, { ref: `refs/heads/${name}`, object: { sha, type: 'commit' } })
  }
  return notFound()
}
