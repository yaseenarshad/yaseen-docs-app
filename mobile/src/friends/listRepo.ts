import { ListError, type RepoPort } from '@shared/friendListStore'
import { GithubError, repoPath, type GithubClient } from '../github/client'
import { githubRemote } from '../sync/githubRemote'

/**
 * The phone's repo calls of the friends list (YAZ-5083, the list in the vault repo). The commit is 3B's
 * `githubRemote.commit`, the SAME code that writes the answer list: blobs, a tree with `base_tree`, a commit, then the
 * ref `PATCH` with `force: false`; a moved branch is `STALE_HEAD`. Reads: the branch head with its ETag (a free 304),
 * and one file at one commit (`contents` with `ref`, raw: the file's bytes, never a base64 copy).
 * - 404 or 403 on the repo itself: `NO_LIST_ACCESS` (the token cannot read or write that vault).
 * - Every other failure keeps 3E's code (`OFFLINE`, `RATE_LIMITED`, `UNAUTHORIZED`, …), as the gist calls do.
 */
export function listRepo(client: GithubClient, repo: string, branch: string): RepoPort {
  const remote = githubRemote(client, repo, branch)
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
        return noAccess(err)
      }
    },
    async commit(parent, path, text, message) {
      try {
        // Never a delete: GitHub refuses `sha: null` for a path that the base tree does not have (round 5).
        return await remote.commit(parent, [{ path, content: text }], message)
      } catch (err) {
        if (err instanceof GithubError && err.code === 'STALE_HEAD') throw new ListError('STALE_HEAD', 'The branch moved')
        return noAccess(err)
      }
    },
  }
}
