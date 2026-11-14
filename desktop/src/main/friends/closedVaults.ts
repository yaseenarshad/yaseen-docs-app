/**
 * A vault that counts for friends and is CLOSED on this Mac (YAZ-5252, Yaseen's delegation: "holds a vault" means "on
 * this Mac"). The Mac finds it among the vaults the app already knows (recent, open or keyed: `listVaults`), by its
 * GitHub remote `origin`. No path comes from a gist or a renderer.
 * - Only a real folder at the known place: a known path that is, or goes through, a symlink is not followed
 *   (`realpath` must be the path itself).
 * - Not a repo, no remote, a remote that is not on github.com: not this vault.
 * - The change key is the folder's git HEAD plus the files that git sees as changed. A closed vault changes by a pull
 *   (GitHub AutoSync) or by another app; both move one of the two. The same key: the last scan still holds.
 */
import { lstat, realpath } from 'node:fs/promises'
import path from 'node:path'
import { detectRepo } from '../git/detect'
import { git } from '../git/exec'
import { repoOfRemote } from '../phoneCode'

export interface ClosedVault {
  root: string
  /** HEAD and the changed files: a new key means the folder changed since the last scan. */
  key: string
}

export interface FolderFacts {
  remoteUrl: string | null
  head: string | null
  dirty: string[]
}

/** The closed vaults that the app knows, by repo (`owner/name`, lower case). The first known folder of a repo wins. */
export async function knownClosedVaults(paths: readonly string[], open: ReadonlySet<string>, facts: (root: string) => Promise<FolderFacts | null>): Promise<Map<string, ClosedVault>> {
  const out = new Map<string, ClosedVault>()
  for (const root of paths) {
    if (open.has(root) || !path.isAbsolute(root)) continue
    const st = await lstat(root).catch(() => null)
    if (st === null || st.isSymbolicLink() || !st.isDirectory()) continue
    if ((await realpath(root).catch(() => null)) !== path.resolve(root)) continue
    const f = await facts(root).catch(() => null)
    const repo = f?.remoteUrl ? repoOfRemote(f.remoteUrl)?.toLowerCase() : null
    if (f == null || repo == null || out.has(repo)) continue
    out.set(repo, { root, key: [f.head ?? '', ...[...f.dirty].sort()].join('\n') })
  }
  return out
}

/** The facts of a folder from git on this Mac (`detectRepo` and `rev-parse HEAD`); null when it is not a repo. */
export function gitFolderFacts(bin: string) {
  return async (root: string): Promise<FolderFacts | null> => {
    const facts = await detectRepo(bin, root)
    if (!facts.isRepo) return null
    const head = await git(bin, root, ['rev-parse', 'HEAD'])
    return { remoteUrl: facts.remoteUrl, head: head.code === 0 ? head.stdout.trim() : null, dirty: facts.dirtyFiles }
  }
}
