import { EMPTY_REPO, FILE_THERE, ListError, type RepoPort } from '@shared/friendListStore'
import { GithubError, repoPath, type GithubClient } from '../github/client'
import { githubRemote } from '../sync/githubRemote'

/**
 * The phone's repo calls of the friends list (YAZ-5083, the list in the vault repo). The commit is 3B's
 * `githubRemote.commit`, the SAME code that writes the answer list: blobs, a tree with `base_tree`, a commit, then the
 * ref `PATCH` with `force: false`; a moved branch is `STALE_HEAD`. Reads: the branch head with its ETag (a free 304),
 * and one file at one commit (`contents` with `ref`, raw: the file's bytes, never a base64 copy).
 * - 404 or 403 on the repo itself: `NO_LIST_ACCESS` (the token cannot read or write that vault).
 * - YAZ-5464: a repo with NO commit (GitHub's 409 "Git Repository is empty", `EMPTY_REPO`): its head is
 *   `sha: null` and its list file is not there; the first commit is a `PUT contents/<path>` with no `sha` (the git
 *   data calls all answer 409 there), which writes only while the file is missing (else `STALE_HEAD`).
 * - Every other failure keeps 3E's code (`OFFLINE`, `RATE_LIMITED`, `UNAUTHORIZED`, …), as the gist calls do.
 */
export function listRepo(client: GithubClient, repo: string, branch: string): RepoPort {
  const remote = githubRemote(client, repo, branch)
  // YAZ-5464: GitHub's 409 "Git Repository is empty" (and only that 409; the client gives it as `UNEXPECTED`).
  const empty = (err: unknown): boolean => err instanceof GithubError && err.status === 409 && EMPTY_REPO.test(err.said)
  const noAccess = (err: unknown): never => {
    // YAZ-5399: a 404 on the repo is "gone" (deleted, or this token has no access at all: GitHub hides a private repo).
    if (err instanceof GithubError && err.code === 'NOT_FOUND') throw Object.assign(new ListError('NO_LIST_ACCESS', 'The vault of the friends list is not on GitHub for this token'), { gone: true })
    if (err instanceof GithubError && (err.code === 'NO_ACCESS' || err.code === 'READ_ONLY')) throw new ListError('NO_LIST_ACCESS', 'The token cannot use the vault of the friends list')
    throw err
  }
  return {
    repo: repo.toLowerCase(),
    branch,
    async head(etag) {
      try {
        return await remote.head(etag ?? undefined)
      } catch (err) {
        if (empty(err)) return { sha: null, etag: null }
        return noAccess(err)
      }
    },
    async read(commit, path) {
      try {
        const res = await client.request(repoPath(repo, 'contents', path), { query: { ref: commit }, accept: 'application/vnd.github.raw+json', raw: true })
        return new TextDecoder().decode(res.data as Uint8Array)
      } catch (err) {
        // YAZ-5398: GitHub's 404 "No commit found" is a commit its replica does not have yet (a stale read), not a missing file.
        if (err instanceof GithubError && err.code === 'NOT_FOUND' && /^No commit found/.test(err.said)) throw new ListError('STALE_READ', 'GitHub does not have that commit yet')
        // The file is not there at that commit (the commit itself was just read: the repo is there).
        if (err instanceof GithubError && err.code === 'NOT_FOUND') return null
        if (empty(err)) return null
        return noAccess(err)
      }
    },
    async canonical() {
      try {
        // `fetch` follows GitHub's redirect of a renamed or transferred repo: the answer names the repo as it is now.
        const res = await client.request(repoPath(repo))
        const name = (res.data as { full_name?: unknown } | null)?.full_name
        return typeof name === 'string' && name.includes('/') ? name.toLowerCase() : repo.toLowerCase()
      } catch (err) {
        return noAccess(err)
      }
    },
    async commit(parent, path, text, message) {
      if (parent === null) return firstCommit(path, text, message)
      try {
        // Never a delete: GitHub refuses `sha: null` for a path that the base tree does not have (round 5).
        return await remote.commit(parent, [{ path, content: text }], message)
      } catch (err) {
        if (err instanceof GithubError && err.code === 'STALE_HEAD') throw new ListError('STALE_HEAD', 'The branch moved')
        return noAccess(err)
      }
    },
  }

  /** YAZ-5464: the first commit of an empty repo, by the Contents API (it makes the branch); only while `path` is missing. */
  async function firstCommit(path: string, text: string, message: string): Promise<string> {
    try {
      const bytes = new TextEncoder().encode(text)
      let raw = ''
      for (let i = 0; i < bytes.length; i += 0x8000) raw += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      const res = await client.request(repoPath(repo, 'contents', path), { method: 'PUT', body: { message, content: btoa(raw), branch }, allow: [409, 422] })
      const said = (res.data as { message?: unknown } | null)?.message
      // The file is there by now (another device, or a push): read again (the CAS rule of every list write).
      if (res.status === 409 || res.status === 422) {
        if (typeof said === 'string' && FILE_THERE.test(said)) throw new ListError('STALE_HEAD', 'The list file is there by now')
        throw new GithubError('UNEXPECTED', res.status, `GitHub answered ${res.status}`, null, typeof said === 'string' ? said : '')
      }
      const sha = (res.data as { commit?: { sha?: unknown } } | null)?.commit?.sha
      if (typeof sha !== 'string') throw new GithubError('UNEXPECTED', res.status, 'GitHub gave no commit for the new file')
      return sha
    } catch (err) {
      return noAccess(err)
    }
  }
}
