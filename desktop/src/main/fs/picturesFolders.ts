/**
 * A BOARD'S PICTURES FOLDER OUTSIDE THE VAULT (YAZ-3943 demo round 3): the two rules only main can apply. The
 * shape of a folder is `isValidPicturesFolder` (`shared/drawingAssets.ts`); this is what the Mac knows.
 *
 *  - BLOCKED folders, refused where a folder is picked (`ipc/dialog.ts`): `/` itself, the system folders, the home
 *    folder itself and `~/Library`, each with everything under it. A temp folder never is: the demo vault lives there.
 *  - WRITES only where the user picked (`landingFolder`): a board file can come from anyone, so a block alone never
 *    makes the app write outside the vault. An outside folder that is not on the store's approved list gets nothing;
 *    those pictures land in the vault's `assets/` instead, and a read (folder first, then `assets/`) still finds them.
 *    Reads are not limited: a board may read hash-named picture files from any folder its block names.
 */
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { picturesFolderOutside } from '@shared/drawingAssets'

const under = (p: string, base: string): boolean => p === base || p.startsWith(base.endsWith('/') ? base : `${base}/`)

/** Whether `abs` (a normalized absolute path) may never hold a board's pictures; `home` and `tmp` are seams for a test. */
export function blockedPicturesFolder(abs: string, home = homedir(), tmp = tmpdir()): boolean {
  // `tmpdir()` is `/var/folders/…` and its real place is `/private/var/folders/…`; `/tmp` is `/private/tmp`.
  if ([tmp, `/private${tmp}`, '/tmp', '/private/tmp'].some((t) => under(abs, t))) return false
  if (abs === '/' || abs === home) return true
  const roots = ['/System', '/Library', '/Applications', '/usr', '/bin', '/sbin', '/etc', '/var', '/private/etc', '/private/var', '/opt', path.join(home, 'Library')]
  return roots.some((r) => under(abs, r))
}

/** Where pictures land for a board whose block names `folder`: the folder itself, or null (the vault's `assets/`) for an outside folder the user has not picked. */
export function landingFolder(folder: string | null, approved: readonly string[]): string | null {
  return folder !== null && picturesFolderOutside(folder) && !approved.includes(folder) ? null : folder
}
