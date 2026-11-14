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

/** The phone's whole conversation with GitHub: four calls, no git on the device. */
export interface GithubRemote {
  /** Branch head; passing the last `etag` makes an unchanged answer free (HTTP 304). */
  head(etag?: string): Promise<{ sha: string; etag: string } | 'unchanged'>
  /** Every path and its blob SHA at `commit`, in one request. Rejects `TREE_TRUNCATED` when GitHub cut it short (F6). */
  tree(commit: string): Promise<RemoteTree>
  blob(sha: string): Promise<Uint8Array>
  /** One atomic commit; rejects `STALE_HEAD` when GitHub has moved past `parent`. Resolves with the new commit SHA. */
  commit(parent: string, changes: Change[], message: string): Promise<string>
}

/** GitHub's answer when the ref `PATCH` (force: false) is refused because the branch moved (proof 1B, YAZ-5063). */
export const NOT_FAST_FORWARD = 'Update is not a fast forward'

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

    async commit(parent, changes, message) {
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
      const made = await client.request(git('commits'), { method: 'POST', body: { message, tree: (tree.data as { sha: string }).sha, parents: [parent] } })
      const sha = (made.data as { sha: string }).sha
      const moved = await client.request(git('refs', 'heads', branch), { method: 'PATCH', body: { sha, force: false }, allow: [409, 422] })
      if (moved.status === 422 || moved.status === 409) {
        const said = typeof (moved.data as { message?: unknown } | null)?.message === 'string' ? (moved.data as { message: string }).message : ''
        // Proof 1B: 422 and exactly this message. Another 422 (a ref that does not exist) is not a moved branch.
        if (said === NOT_FAST_FORWARD) throw new GithubError('STALE_HEAD', moved.status, `GitHub answered ${moved.status}: ${said}`, null, said, moved.rateLimit)
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
