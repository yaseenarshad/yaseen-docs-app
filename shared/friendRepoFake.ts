import { GistError } from './friendGists'
import { ListError, type RepoPort } from './friendListStore'

/**
 * TEST HELP ONLY (YAZ-5083): a fake GitHub repo (the git data calls) in memory, as STRICT as the real one, for the
 * friends list in the vault repo. The phone's tests put it behind `fetch` (with the fake gist world); the shared tests
 * and the Mac use `port(token, repo, branch)`.
 *
 * As GitHub (proof 1B, YAZ-5063, and its docs):
 * - a commit and a tree are immutable; a new tree with `base_tree` keeps every path it does not name; `sha: null`
 *   deletes a path; a tree or a commit that names an unknown object is 422;
 * - the ref `PATCH` with `force: false` from a parent that is not the head (the branch moved) is 422 "Update is not a
 *   fast forward"; the head moves only by a fast forward; a second move of one branch while one is in flight is 422
 *   "Reference cannot be updated" (seen live, YAZ-5083);
 * - the ref read has a weak ETag and a free 304; `contents` with `ref` and the raw media type gives the file's bytes, 404
 *   when the file is not there;
 * - only a token of the repo's owner (or one given access) reads; only one with write access writes (403 else). The
 *   owner's login is compared as written, so a test can give two accounts that differ only in letter case.
 * `observe` sees each ref move (the model checker's I4 and I7: every list write is a fast forward of what its writer read).
 */
export interface FakeRepoWorld {
  /** The repos (`owner/name`, lower case) that `login` owns or was given access to. */
  owned(login: string): string[]
  /** Makes a repo with one commit (the files given), owned by `owner`. */
  create(fullName: string, owner: string, files?: Record<string, string>, branch?: string): void
  /** Gives a token's login access to a repo of another owner. */
  grant(fullName: string, login: string, access: 'read' | 'write'): void
  head(fullName: string, branch?: string): string | null
  /** The text of a file at the branch head, or null. */
  file(fullName: string, path: string, branch?: string): string | null
  /** The text of a file at a commit, or null. */
  fileAt(fullName: string, commit: string, path: string): string | null
  /** The parents of a commit. */
  parents(fullName: string, commit: string): string[]
  /** A commit by another writer (a sync of the phone, the Mac's AutoSync push): moves the branch. */
  push(fullName: string, files: Record<string, string | null>, branch?: string, message?: string): string
  /** Each ref move, as it lands. */
  observe: ((move: { repo: string; branch: string; from: string; to: string; parent: string; token: string | null; path: string | null }) => void) | null
  /** Consulted on each call: a status makes THAT call fail so (then it clears itself). */
  failNext: ((call: { method: string; path: string }) => number | undefined) | null
  offline: boolean
  calls: { method: string; path: string; status: number }[]
  /** One call as GitHub's HTTP API answers it (path under `/repos/`). `undefined`: no answer (offline). */
  http(method: string, path: string, query: URLSearchParams, token: string | null, body: unknown, etag: string | null, accept: string | null): Promise<{ status: number; body: unknown; headers: Record<string, string>; raw?: string } | undefined>
  /** A list port on the in-memory calls (the codes of the phone's adapter). */
  port(token: string, fullName: string, branch?: string): RepoPort
}

interface Repo {
  owner: string
  access: Map<string, 'read' | 'write'>
  refs: Map<string, string>
  commits: Map<string, { tree: string; parents: string[]; message: string }>
  trees: Map<string, ReadonlyMap<string, string>>
  blobs: Map<string, string>
}

export function fakeRepoWorld(setup: { logins: (token: string) => string | null; now?: () => number; /** A repo `<login>/<name>` that its owner reads is made on the spot (the person's vaults exist on GitHub). */ autoRepos?: boolean }): FakeRepoWorld {
  const repos = new Map<string, Repo>()
  /** The branches with a ref move in flight. */
  const moving = new Set<string>()
  let n = 0
  const id = (kind: string) => {
    let h = (++n * 2654435761) >>> 0
    let out = ''
    for (let i = 0; i < 5; i++) {
      h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0
      out += h.toString(16).padStart(8, '0')
    }
    void kind
    return out.slice(0, 40)
  }
  const now = setup.now ?? Date.now
  const blob = (r: Repo, text: string) => {
    const sha = id('b')
    r.blobs.set(sha, text)
    return sha
  }
  const tree = (r: Repo, entries: Map<string, string>) => {
    const sha = id('t')
    r.trees.set(sha, new Map(entries))
    return sha
  }
  const commit = (r: Repo, treeSha: string, parents: string[], message: string) => {
    const sha = id('c')
    r.commits.set(sha, { tree: treeSha, parents: [...parents], message })
    return sha
  }
  const get = (full: string) => repos.get(full.toLowerCase())
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) => ({ status, body, headers: { date: new Date(now()).toUTCString(), ...headers } })
  const notFound = () => json(404, { message: 'Not Found', documentation_url: 'https://docs.github.com/rest' })
  const textAt = (r: Repo, c: string, path: string): string | null => {
    const cm = r.commits.get(c)
    if (cm === undefined) return null
    const b = r.trees.get(cm.tree)!.get(path)
    return b === undefined ? null : r.blobs.get(b)!
  }
  const ancestors = (r: Repo, sha: string) => {
    const seen = new Set<string>()
    for (const q = [sha]; q.length > 0; ) {
      const x = q.pop()!
      if (seen.has(x)) continue
      seen.add(x)
      q.push(...(r.commits.get(x)?.parents ?? []))
    }
    return seen
  }

  const world: FakeRepoWorld = {
    observe: null,
    failNext: null,
    offline: false,
    calls: [],
    create(full, owner, files = {}, branch = 'main') {
      const r: Repo = { owner, access: new Map(), refs: new Map(), commits: new Map(), trees: new Map(), blobs: new Map() }
      repos.set(full.toLowerCase(), r)
      const t = tree(r, new Map(Object.entries(files).map(([p, text]) => [p, blob(r, text)])))
      r.refs.set(branch, commit(r, t, [], 'first'))
    },
    grant(full, login, access) {
      get(full)!.access.set(login.toLowerCase(), access)
    },
    owned: (login) => [...repos].filter(([, r]) => r.owner === login || r.access.has(login.toLowerCase())).map(([full]) => full),
    head: (full, branch = 'main') => get(full)?.refs.get(branch) ?? null,
    file(full, path, branch = 'main') {
      const r = get(full)
      const h = r?.refs.get(branch)
      return r === undefined || h === undefined ? null : textAt(r, h, path)
    },
    fileAt(full, c, path) {
      const r = get(full)
      return r === undefined ? null : textAt(r, c, path)
    },
    parents: (full, c) => get(full)?.commits.get(c)?.parents ?? [],
    push(full, files, branch = 'main', message = 'push') {
      const r = get(full)!
      const head = r.refs.get(branch)!
      const entries = new Map(r.trees.get(r.commits.get(head)!.tree)!)
      for (const [p, text] of Object.entries(files)) {
        if (text === null) entries.delete(p)
        else entries.set(p, blob(r, text))
      }
      const c = commit(r, tree(r, entries), [head], message)
      r.refs.set(branch, c)
      world.observe?.({ repo: full.toLowerCase(), branch, from: head, to: c, parent: head, token: null, path: null })
      return c
    },
    async http(method, path, query, token, body, etag, accept) {
      await Promise.resolve()
      const record = (a: ReturnType<typeof json> & { raw?: string }) => {
        world.calls.push({ method, path, status: a.status })
        return a
      }
      if (world.offline) return undefined
      const forced = world.failNext?.({ method, path })
      if (forced !== undefined) {
        world.failNext = null
        return record(json(forced, { message: forced === 403 ? 'API rate limit exceeded' : 'forced' }, forced === 403 ? { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.ceil((now() + 600_000) / 1000)) } : {}))
      }
      const parts = path.split('/').filter(Boolean).map(decodeURIComponent)
      if (parts[0] !== 'repos' || parts.length < 3) return record(notFound())
      const full = `${parts[1]}/${parts[2]}`.toLowerCase()
      const login = token === null ? null : setup.logins(token)
      if (setup.autoRepos === true && login !== null && !repos.has(full) && parts[1].toLowerCase() === login.toLowerCase()) world.create(`${login}/${parts[2]}`, login, { 'a.md': '# A page\n' })
      const r = repos.get(full)
      if (token !== null && login === null) return record(json(401, { message: 'Bad credentials' }))
      const access = login === null ? undefined : login === r?.owner ? 'write' : r?.access.get(login.toLowerCase())
      if (r === undefined || access === undefined) return record(notFound())
      const rest = parts.slice(3)
      const b = (body ?? {}) as Record<string, unknown>
      if (method === 'GET' && rest.length === 0) return record(json(200, { full_name: full, private: true, default_branch: r.refs.has('main') ? 'main' : [...r.refs.keys()][0] }))
      if (method !== 'GET' && access !== 'write') return record(json(403, { message: 'Resource not accessible by personal access token' }))
      if (method === 'GET' && rest[0] === 'git' && rest[1] === 'ref' && rest[2] === 'heads') {
        const head = r.refs.get(rest.slice(3).join('/'))
        if (head === undefined) return record(notFound())
        const tag = `W/"${head.slice(0, 32)}"`
        if (etag === tag) return record(json(304, null, { etag: tag }))
        return record(json(200, { ref: `refs/heads/${rest.slice(3).join('/')}`, object: { sha: head, type: 'commit' } }, { etag: tag }))
      }
      if (method === 'GET' && rest[0] === 'contents') {
        const ref = query.get('ref') ?? r.refs.get('main') ?? ''
        const c = r.commits.has(ref) ? ref : r.refs.get(ref)
        if (c === undefined) return record(json(404, { message: `No commit found for the ref ${ref}` }))
        const text = textAt(r, c, rest.slice(1).join('/'))
        if (text === null) return record(notFound())
        if ((accept ?? '').includes('raw')) return record({ ...json(200, null), raw: text })
        return record(json(200, { type: 'file', encoding: 'base64', content: btoa(unescape(encodeURIComponent(text))) }))
      }
      if (method === 'GET' && rest[0] === 'git' && rest[1] === 'commits' && rest.length === 3) {
        const c = r.commits.get(rest[2])
        if (c === undefined) return record(notFound())
        return record(json(200, { sha: rest[2], tree: { sha: c.tree }, parents: c.parents.map((sha) => ({ sha })), message: c.message }))
      }
      if (method === 'POST' && rest[0] === 'git' && rest[1] === 'blobs') {
        if (typeof b.content !== 'string') return record(json(422, { message: 'Invalid request.' }))
        const text = b.encoding === 'base64' ? decodeURIComponent(escape(atob(b.content))) : b.content
        return record(json(201, { sha: blob(r, text) }))
      }
      if (method === 'POST' && rest[0] === 'git' && rest[1] === 'trees') {
        const base = typeof b.base_tree === 'string' ? r.trees.get(b.base_tree) : new Map<string, string>()
        if (base === undefined) return record(json(422, { message: 'Invalid tree info' }))
        const entries = new Map(base)
        for (const e of (b.tree ?? []) as { path: string; sha?: string | null; content?: string }[]) {
          if (typeof e.content === 'string') entries.set(e.path, blob(r, e.content))
          else if (e.sha === null) entries.delete(e.path)
          else if (typeof e.sha === 'string' && r.blobs.has(e.sha)) entries.set(e.path, e.sha)
          else return record(json(422, { message: 'Invalid tree info' }))
        }
        return record(json(201, { sha: tree(r, entries) }))
      }
      if (method === 'POST' && rest[0] === 'git' && rest[1] === 'commits') {
        if (typeof b.tree !== 'string' || !r.trees.has(b.tree)) return record(json(422, { message: 'Tree SHA does not exist' }))
        const parents = Array.isArray(b.parents) ? (b.parents as string[]) : []
        if (parents.some((p) => !r.commits.has(p))) return record(json(422, { message: 'Parent SHA does not exist or is not a commit object' }))
        const sha = commit(r, b.tree, parents, String(b.message ?? ''))
        return record(json(201, { sha, tree: { sha: b.tree }, parents: parents.map((p) => ({ sha: p })) }))
      }
      if (method === 'PATCH' && rest[0] === 'git' && rest[1] === 'refs' && rest[2] === 'heads') {
        const name = rest.slice(3).join('/')
        const head = r.refs.get(name)
        if (head === undefined) return record(json(422, { message: 'Reference does not exist' }))
        const sha = b.sha as string
        if (!r.commits.has(sha)) return record(json(422, { message: 'Object does not exist' }))
        // Proof 1B: a branch that moved past the parent answers 422 "Update is not a fast forward".
        if (b.force !== true && !ancestors(r, sha).has(head)) return record(json(422, { message: 'Update is not a fast forward', documentation_url: 'https://docs.github.com/rest/git/refs#update-a-reference', status: '422' }))
        // YAZ-5083 (live): a second move of the same branch while one is in flight: 422 "Reference cannot be updated".
        const key = `${full}:${name}`
        if (moving.has(key)) return record(json(422, { message: 'Reference cannot be updated', documentation_url: 'https://docs.github.com/rest/git/refs#update-a-reference', status: '422' }))
        moving.add(key)
        try {
          for (let i = 0; i < 3; i++) await Promise.resolve()
        } finally {
          moving.delete(key)
        }
        if (r.refs.get(name) !== head) return record(json(422, { message: 'Update is not a fast forward', status: '422' }))
        r.refs.set(name, sha)
        const cm = r.commits.get(sha)!
        const before = r.trees.get(r.commits.get(head)!.tree)!
        const after = r.trees.get(cm.tree)!
        const changed = [...new Set([...before.keys(), ...after.keys()])].filter((p) => before.get(p) !== after.get(p))
        world.observe?.({ repo: full, branch: name, from: head, to: sha, parent: cm.parents[0] ?? '', token, path: changed.length === 1 ? changed[0] : changed.join(',') })
        return record(json(200, { ref: `refs/heads/${name}`, object: { sha, type: 'commit' } }))
      }
      return record(notFound())
    },
    port(token, full, branch = 'main') {
      return memoryPort(world, token, full, branch)
    },
  }
  return world
}

/** The in-memory list port: the same codes as the phone's adapter (`mobile/src/friends/listRepo.ts`). */
function memoryPort(world: FakeRepoWorld, token: string, full: string, branch: string): RepoPort {
  const [owner, name] = full.split('/')
  const base = `/repos/${owner}/${name}`
  const call = async (method: string, path: string, query: Record<string, string> = {}, body?: unknown, etag: string | null = null, accept: string | null = null) => {
    const a = await world.http(method, path, new URLSearchParams(query), token, body, etag, accept)
    if (a === undefined) throw new GistError('OFFLINE', 'No connection to GitHub')
    return a
  }
  const fail = (status: number): never => {
    if (status === 404 || status === 403) throw new ListError('NO_LIST_ACCESS', `GitHub answered ${status}`)
    if (status === 401) throw new GistError('UNAUTHORIZED', 'GitHub answered 401')
    if (status >= 500) throw new GistError('GITHUB_DOWN', `GitHub answered ${status}`)
    throw new GistError('UNEXPECTED', `GitHub answered ${status}`)
  }
  return {
    repo: full.toLowerCase(),
    branch,
    async head(etag) {
      const a = await call('GET', `${base}/git/ref/heads/${branch}`, {}, undefined, etag ?? null)
      if (a.status === 304) return 'unchanged'
      if (a.status !== 200) return fail(a.status)
      return { sha: (a.body as { object: { sha: string } }).object.sha, etag: a.headers.etag ?? null }
    },
    async read(commit, path) {
      const a = await call('GET', `${base}/contents/${path}`, { ref: commit }, undefined, null, 'application/vnd.github.raw+json')
      if (a.status === 404) return null
      if (a.status !== 200) return fail(a.status)
      return a.raw ?? ''
    },
    async commit(parent, path, text, message) {
      const c = await call('GET', `${base}/git/commits/${parent}`)
      if (c.status !== 200) return fail(c.status)
      const t = await call('POST', `${base}/git/trees`, {}, { base_tree: (c.body as { tree: { sha: string } }).tree.sha, tree: [text === null ? { path, mode: '100644', type: 'blob', sha: null } : { path, mode: '100644', type: 'blob', content: text }] })
      if (t.status !== 201) return fail(t.status)
      const m = await call('POST', `${base}/git/commits`, {}, { message, tree: (t.body as { sha: string }).sha, parents: [parent] })
      if (m.status !== 201) return fail(m.status)
      const sha = (m.body as { sha: string }).sha
      const r = await call('PATCH', `${base}/git/refs/heads/${branch}`, {}, { sha, force: false })
      if (r.status === 422 && ['Update is not a fast forward', 'Reference cannot be updated'].includes((r.body as { message?: string }).message ?? '')) throw new ListError('STALE_HEAD', 'The branch moved')
      if (r.status !== 200) return fail(r.status)
      return sha
    },
  }
}
