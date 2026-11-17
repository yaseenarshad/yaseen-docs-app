import { rm } from 'node:fs/promises'
import path from 'node:path'
import { LIST_PATH } from '@shared/friendListStore'
import { git } from './exec'

/**
 * THE FRIENDS LIST FILE NEVER BLOCKS A VAULT'S SYNC (YAZ-5083 round 5). `.yaseendocs/friends.json` has ONE writer: the
 * phone's compare-and-swap commit through GitHub's API. The copy on this Mac is only a copy, so for this one path the
 * REMOTE ALWAYS WINS:
 * - a local change of the file (a hand edit, an editor that formats it, a restore) is DROPPED before the pass commits:
 *   the file is put back as HEAD has it, and a file that HEAD does not have is taken away (it would block the pull of
 *   the remote's file). It is never committed, never merged and never kept as a conflict copy;
 * - a rebase that stops on the file takes GitHub's side (`resolve.ts`);
 * - a local commit that changed it anyway (an older build, a commit by hand) is undone on top of GitHub's by one commit,
 *   so the push never carries a list that the phone did not write.
 * The rest of the vault syncs as before.
 */
export const FRIENDS_LIST = LIST_PATH
const spec = `:(literal)${FRIENDS_LIST}`

/** Puts the file back as HEAD has it (or takes it away when HEAD has none). Answers whether it changed anything. */
export async function dropLocalListChange(bin: string, root: string): Promise<boolean> {
  const inHead = (await git(bin, root, ['cat-file', '-e', `HEAD:${FRIENDS_LIST}`])).code === 0
  if (inHead) {
    // `diff HEAD` compares the index and the working tree with HEAD: an edit, a delete, a staged change.
    if ((await git(bin, root, ['diff', '--quiet', 'HEAD', '--', spec])).code === 0) return false
    return (await git(bin, root, ['checkout', 'HEAD', '--', spec])).code === 0
  }
  const known = (await git(bin, root, ['ls-files', '-z', '--cached', '--others', '--', spec])).stdout
  if (known === '') return false
  await git(bin, root, ['rm', '-q', '--cached', '--ignore-unmatch', '--', spec])
  await rm(path.join(root, ...FRIENDS_LIST.split('/')), { force: true })
  return true
}

/**
 * After a rebase and before a push: HEAD's file must be GitHub's (`@{u}`). When a local commit changed it, ONE commit puts
 * GitHub's back. No upstream: nothing to follow. Answers whether it committed.
 */
export async function followRemoteList(bin: string, root: string): Promise<boolean> {
  if ((await git(bin, root, ['rev-parse', '--verify', '-q', '@{u}'])).code !== 0) return false
  if ((await git(bin, root, ['diff', '--quiet', '@{u}', 'HEAD', '--', spec])).code === 0) return false
  const upstream = (await git(bin, root, ['cat-file', '-e', `@{u}:${FRIENDS_LIST}`])).code === 0
  const put = upstream ? await git(bin, root, ['checkout', '@{u}', '--', spec]) : await git(bin, root, ['rm', '-q', '--', spec])
  if (put.code !== 0) return false
  return (await git(bin, root, ['commit', '-q', '-m', 'sync: the friends list follows GitHub', '--', spec])).code === 0
}
