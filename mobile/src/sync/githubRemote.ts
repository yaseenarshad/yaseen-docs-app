import { GithubError, repoPath, type GithubClient } from '../github/client'

/**
 * One change of a commit (3C makes these from the answer list). Text goes inline in the new tree; bytes go up as a
 * blob first; `delete` takes the path out. Stage one only changes card files and pages that hold cards (decision 2).
 */
export type Change = { path: string; content: string | Uint8Array } | { path: string; delete: true }

/**
 * The file list at one commit: path → blob SHA (folders are left out). `bytes` gives each file's size from the same
 * answer, so the pass can keep a page over the desktop's size limit as metadata only (row F7) without a download.
 * It IS a `Map<string, string>`, the pinned shape of round 2.
 */
export interface RemoteTree extends Map<string, string> {
  readonly bytes: ReadonlyMap<string, number>
}

/** The most blobs in one GraphQL query (YAZ-5929). GitHub's own limit on the nodes of one query is far above it. */
export const MAX_BATCH_FILES = 100

/** The phone's whole conversation with GitHub: seven calls, no git on the device. */
export interface GithubRemote {
  /** Branch head; passing the last `etag` makes an unchanged answer free (HTTP 304). */
  head(etag?: string): Promise<{ sha: string; etag: string } | 'unchanged'>
  /** Every path and its blob SHA at `commit`, in one request. Rejects `TREE_TRUNCATED` when GitHub cut it short (F6). */
  tree(commit: string): Promise<RemoteTree>
  blob(sha: string): Promise<Uint8Array>
  /**
   * YAZ-5929: the text of up to `MAX_BATCH_FILES` blobs in ONE GraphQL query, in the order of `shas`. Null for a blob
   * that GitHub calls binary, cut short (`isTruncated`), or does not give. The caller checks each text with
   * `gitBlobSha` and gets each null or wrong one with `blob(sha)`. A query that GitHub refuses as a whole (no access
   * to GraphQL, a missing repo, an odd answer) gives all null, so the pass works as before; a rate limit, no network,
   * a 5xx or a bad token throws, as `blob` does.
   */
  blobs(shas: readonly string[]): Promise<(string | null)[]>
  /**
   * One atomic commit; rejects `STALE_HEAD` when GitHub has moved past `parent`. Resolves with the new commit SHA.
   * `made` hears the new commit's SHA once GitHub made it, BEFORE the branch moves to it, and the move waits for it
   *: a caller keeps the SHA, so after a lost answer it can ask whether the branch took that commit
   * (`contains`).
   */
  commit(parent: string, changes: Change[], message: string, made?: (sha: string) => Promise<void>): Promise<string>
  /**
   * Does the history of `head` hold `commit` (the head itself, or one of its ancestors)? False for a commit
   * that never reached the branch, or that GitHub does not know. One request (`GET compare/{commit}...{head}`).
   */
  contains(commit: string, head: string): Promise<boolean>
}

/** GitHub's answer when the ref `PATCH` (force: false) is refused because the branch moved (proof 1B). */
export const NOT_FAST_FORWARD = 'Update is not a fast forward'
/**
 * Two ref `PATCH`es of one branch at the SAME moment: GitHub refuses one with 422 "Reference
 * cannot be updated" (not "not a fast forward"). The branch moved under it: the same answer as a stale head.
 */
export const REF_RACE = 'Reference cannot be updated'

interface TreeEntry {
  path: string
  type: string
  sha: string
  size?: number
}

/**
 * `GithubRemote` on the ONE client of 3E (`github/client.ts`): the token goes only to `api.github.com`, and every
 * failure is a typed `GithubError`. The calls are the ones proof 1B measured on the real API:
 * - head: `GET git/ref/heads/{branch}` with `If-None-Match` (a 304 did not lower the rate count);
 * - tree: `GET git/trees/{commit}?recursive=1` (the commit SHA works, so no `GET git/commits` first);
 * - blob: `GET git/blobs/{sha}` with the raw media type (bytes, not base64);
 * - blobs (YAZ-5929): `POST /graphql`, `repository(owner, name) { b0: object(oid: "…") { ... on Blob { text isBinary
 *   isTruncated } } … }`: up to 100 text files in one call, on GraphQL's own count, not the 5,000 REST calls an hour;
 * - contains: `GET compare/{commit}...{head}` (does the branch hold an answer's commit, after a lost answer);
 * - commit: `GET git/commits/{parent}` for its tree, `POST git/blobs` for bytes only, `POST git/trees` with
 *   `base_tree` (text inline: a Markdown commit is 3 writes, not 5), `POST git/commits`, then `PATCH git/refs/heads/
 *   {branch}` with `force: false`. GitHub refuses a moved branch with 422 "Update is not a fast forward": `STALE_HEAD`.
 */
export function githubRemote(client: GithubClient, repo: string, branch: string): GithubRemote {
  const git = (...parts: string[]) => repoPath(repo, 'git', ...parts)

  return {
    async head(etag) {
      const res = await client.request(git('ref', 'heads', branch), etag === undefined ? {} : { etag })
      if (res.status === 304) return 'unchanged'
      const sha = (res.data as { object?: { sha?: unknown } } | null)?.object?.sha
      if (typeof sha !== 'string') throw new GithubError('UNEXPECTED', res.status, 'GitHub gave no commit for the branch')
      return { sha, etag: res.etag ?? '' }
    },

    async tree(commit) {
      const res = await client.request(git('trees', commit), { query: { recursive: '1' } })
      const data = res.data as { tree?: TreeEntry[]; truncated?: boolean } | null
      if (data?.truncated === true) throw new GithubError('TREE_TRUNCATED', res.status, 'GitHub cut the file list short: the vault is too large to read in one list', null, '', res.rateLimit)
      if (!Array.isArray(data?.tree)) throw new GithubError('UNEXPECTED', res.status, 'GitHub gave no file list')
      const map = new Map<string, string>()
      const bytes = new Map<string, number>()
      for (const entry of data.tree) {
        if (entry.type !== 'blob') continue
        map.set(entry.path, entry.sha)
        bytes.set(entry.path, entry.size ?? 0)
      }
      return Object.assign(map, { bytes }) as RemoteTree
    },

    async blob(sha) {
      const res = await client.request(git('blobs', sha), { accept: 'application/vnd.github.raw+json', raw: true })
      return res.data as Uint8Array
    },

    async blobs(shas) {
      if (shas.length === 0) return []
      if (shas.length > MAX_BATCH_FILES) throw new Error(`At most ${MAX_BATCH_FILES} blobs in one query`)
      // A SHA goes into the query text: only hex (SHA-1 or SHA-256) is allowed, so nothing can change the query.
      if (shas.some((sha) => !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(sha))) throw new Error('A blob SHA is hex')
      const [owner, name] = repo.split('/')
      const fields = shas.map((sha, i) => `b${i}: object(oid: "${sha}") { ... on Blob { text isBinary isTruncated } }`).join(' ')
      const query = `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`
      type Blob = { text?: unknown; isBinary?: unknown; isTruncated?: unknown } | null
      let data: { repository?: Record<string, Blob> | null } | null
      try {
        data = (await client.graphql<{ repository?: Record<string, Blob> | null }>(query, { owner, name })).data
      } catch (error) {
        // GitHub refused the query itself: the one-file call gets each file, as before YAZ-5929.
        if (error instanceof GithubError && (error.code === 'UNEXPECTED' || error.code === 'NO_ACCESS' || error.code === 'NOT_FOUND')) return shas.map(() => null)
        throw error
      }
      const found = data?.repository ?? null
      return shas.map((_, i) => {
        const blob = found?.[`b${i}`] ?? null
        if (blob === null || blob.isBinary !== false || blob.isTruncated !== false || typeof blob.text !== 'string') return null
        return blob.text
      })
    },

    async contains(commit, head) {
      if (commit === head) return true
      const res = await client.request(repoPath(repo, 'compare', `${commit}...${head}`), { allow: [404] })
      if (res.status === 404) return false
      const status = (res.data as { status?: unknown } | null)?.status
      // `ahead`: head is ahead of the commit (holds it); `identical`: the same. `behind` / `diverged`: it does not.
      return status === 'ahead' || status === 'identical'
    },

    async commit(parent, changes, message, made) {
      if (changes.length === 0) throw new Error('A commit needs at least one change')
      const base = await client.request(git('commits', parent))
      const baseTree = (base.data as { tree?: { sha?: unknown } } | null)?.tree?.sha
      if (typeof baseTree !== 'string') throw new GithubError('UNEXPECTED', base.status, 'GitHub gave no tree for the parent commit')
      const entries: Record<string, unknown>[] = []
      for (const change of changes) {
        if ('delete' in change) entries.push({ path: change.path, mode: '100644', type: 'blob', sha: null })
        else if (typeof change.content === 'string') entries.push({ path: change.path, mode: '100644', type: 'blob', content: change.content })
        else {
          const blob = await client.request(git('blobs'), { method: 'POST', body: { content: toBase64(change.content), encoding: 'base64' } })
          entries.push({ path: change.path, mode: '100644', type: 'blob', sha: (blob.data as { sha: string }).sha })
        }
      }
      const tree = await client.request(git('trees'), { method: 'POST', body: { base_tree: baseTree, tree: entries } })
      const commit = await client.request(git('commits'), { method: 'POST', body: { message, tree: (tree.data as { sha: string }).sha, parents: [parent] } })
      const sha = (commit.data as { sha: string }).sha
      await made?.(sha)
      const moved = await client.request(git('refs', 'heads', branch), { method: 'PATCH', body: { sha, force: false }, allow: [409, 422] })
      if (moved.status === 422 || moved.status === 409) {
        const said = typeof (moved.data as { message?: unknown } | null)?.message === 'string' ? (moved.data as { message: string }).message : ''
        // Proof 1B: 422 and exactly this message (or, YAZ-5083, the race of two moves at once). Another 422 (a ref that
        // does not exist) is not a moved branch.
        if (said === NOT_FAST_FORWARD || said === REF_RACE) throw new GithubError('STALE_HEAD', moved.status, `GitHub answered ${moved.status}: ${said}`, null, said, moved.rateLimit)
        throw new GithubError('UNEXPECTED', moved.status, `GitHub answered ${moved.status}${said ? `: ${said}` : ''}`, null, said, moved.rateLimit)
      }
      return sha
    },
  }
}

function toBase64(bytes: Uint8Array): string {
  let raw = ''
  for (let i = 0; i < bytes.length; i += 0x8000) raw += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(raw)
}
