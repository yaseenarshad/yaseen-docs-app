/**
 * A vault that counts for friends and is CLOSED on this Mac (YAZ-5252, Yaseen's delegation: "holds a vault" means "on
 * this Mac"). The Mac finds it among the vaults the app already knows (recent, open or keyed: `listVaults`), by its
 * GitHub remote `origin`. No path comes from a gist.
 * - Only a real folder at the known place: a known path that is, or goes through, a symlink is not followed
 *   (`realpath` must be the path itself). The worker checks it again when it reads (YAZ-5396, `scanVault.ts`).
 * - Not a repo, no remote, a remote that is not on github.com: not this vault.
 * - A renderer can add a path to the known vaults (`state.pushRecent`, `state.setFolder` with a key). That gives no new
 *   reach: a renderer can already open any folder as a vault (`window.open({ root })`), and a known path is read only
 *   when its own git remote is a vault that counts (YAZ-5252, checker's security note (c), confirmed).
 * - The change key (YAZ-5252 bugs): the HEAD, and each changed file (`git status`, every untracked file listed) with its
 *   time and size. A closed vault changes by a pull or by another app; a pull moves the HEAD, an edit moves a changed
 *   file's time. So a second edit of a file that was already changed moves the key too. Hashed: one short text.
 * - Behind (YAZ-5391): a HEAD behind its remote-tracking branch (`git status --branch`: the last fetch, no network call)
 *   is a copy older than the newest the Mac knows. It is found, marked `behind`, and not counted.
 * - Cheap on main: one git call (`remote get-url`) for each known folder, and one more (`status --porcelain=v2
 *   --branch`) only for a folder of a vault that counts. Each is a child process; main parses short text.
 */
import { createHash } from 'node:crypto'
import { lstat, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { git } from '../git/exec'
import { repoOfRemote } from '../phoneCode'

export interface ClosedVault {
  root: string
  /** HEAD and the changed files: a new key means the folder changed since the last scan. */
  key: string
  /** YAZ-5391: the HEAD is behind the remote-tracking branch: this copy is older than the newest the Mac knows. */
  behind?: boolean
}

/** What git says of a folder (`gitFolderFacts`; tests give their own). */
export interface FolderGit {
  /** The fetch URL of `origin`; null: not a repo here, or no `origin`. */
  remote(root: string): Promise<string | null>
  /** The HEAD, the changed files with their marks, and "behind"; null: not a repo. */
  state(root: string): Promise<{ head: string | null; dirty: string[]; behind: boolean } | null>
}

/** A test's made-up facts of a folder. */
export interface FolderFacts {
  remoteUrl: string | null
  head: string | null
  dirty: string[]
  behind?: boolean
}

/** The change key: one short text of the HEAD and the changed files (each with its marks). */
export const changeKey = (head: string | null, dirty: readonly string[]): string =>
  createHash('sha256').update([head ?? '', ...[...dirty].sort()].join('\n')).digest('hex').slice(0, 32)

/**
 * The closed vaults that the app knows, by repo (`owner/name`, lower case). The first known folder of a repo wins.
 * `wanted`: the vaults that count and are not open; a folder of another repo costs one git call.
 */
export async function knownClosedVaults(paths: readonly string[], open: ReadonlySet<string>, facts: FolderGit, wanted?: ReadonlySet<string>): Promise<Map<string, ClosedVault>> {
  const out = new Map<string, ClosedVault>()
  for (const root of paths) {
    if (open.has(root) || !path.isAbsolute(root)) continue
    const st = await lstat(root).catch(() => null)
    if (st === null || st.isSymbolicLink() || !st.isDirectory()) continue
    if ((await realpath(root).catch(() => null)) !== path.resolve(root)) continue
    const url = await facts.remote(root).catch(() => null)
    const repo = url ? repoOfRemote(url)?.toLowerCase() : null
    if (repo == null || out.has(repo) || (wanted !== undefined && !wanted.has(repo))) continue
    const s = await facts.state(root).catch(() => null)
    if (s == null) continue
    out.set(repo, { root, key: changeKey(s.head, s.dirty), behind: s.behind })
  }
  return out
}

/**
 * One `git status --porcelain=v2 --branch -z --untracked-files=all` answer: the HEAD, "behind", and the changed paths.
 * Entries: `1 XY … path`, `2 XY … path` (then the old path), `u XY … path`, `? path`; `#` lines are the branch facts.
 */
export function parseStatusV2(out: string): { head: string | null; behind: boolean; paths: string[] } {
  const parts = out.split('\0')
  let head: string | null = null
  let behind = false
  const paths: string[] = []
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i]
    if (e.startsWith('# branch.oid ')) {
      const oid = e.slice(13).trim()
      head = oid === '(initial)' ? null : oid
    } else if (e.startsWith('# branch.ab ')) {
      const m = / -(\d+)/.exec(e)
      behind = m !== null && Number(m[1]) > 0
    }
    else if (e.startsWith('1 ')) paths.push(e.split(' ').slice(8).join(' '))
    else if (e.startsWith('2 ')) {
      paths.push(e.split(' ').slice(9).join(' '))
      i++ // the old path of a rename or copy
    } else if (e.startsWith('u ')) paths.push(e.split(' ').slice(10).join(' '))
    else if (e.startsWith('? ')) paths.push(e.slice(2))
  }
  return { head, behind, paths }
}

/** The facts of a folder from git on this Mac. A `.git` entry must be AT the folder (as `detectRepo`). */
export function gitFolderFacts(bin: string): FolderGit {
  const isRepo = async (root: string) => (await stat(path.join(root, '.git')).catch(() => null)) !== null
  return {
    async remote(root) {
      if (!(await isRepo(root))) return null
      const r = await git(bin, root, ['remote', 'get-url', 'origin'])
      return r.code === 0 ? r.stdout.trim() || null : null
    },
    async state(root) {
      if (!(await isRepo(root))) return null
      const r = await git(bin, root, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all'])
      if (r.code !== 0) return null
      const s = parseStatusV2(r.stdout)
      // Each changed file with its time and size: a second edit of a changed file moves the key (no read of the file).
      const dirty = await Promise.all(
        s.paths.map(async (p) => {
          const st = await lstat(path.join(root, p)).catch(() => null)
          return st === null ? `${p}\tgone` : `${p}\t${st.mtimeMs}\t${st.size}`
        }),
      )
      return { head: s.head, dirty, behind: s.behind }
    },
  }
}
