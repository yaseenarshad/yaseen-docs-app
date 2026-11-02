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
 *  - REAL PLACES (YAZ-4074 6A item 4): both rules look through symbolic links (`realFolder`). A link to `/Library` is
 *    blocked. A vault folder that links out of the vault is an outside folder, and lands only when approved.
 */
import { realpath, stat } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { picturesFolderOutside } from '@shared/drawingAssets'

/** YAZ-4074 6A item 21: the most outside folders this Mac's list holds. An add past it is refused; no folder is dropped on its own, because that changes where pictures land. */
export const MAX_PICTURE_FOLDERS = 100
export const PICTURE_FOLDERS_FULL = `This Mac allows ${MAX_PICTURE_FOLDERS} picture folders at most. Remove one in Settings › Files & Links first.`

const under = (p: string, base: string): boolean => p === base || p.startsWith(base.endsWith('/') ? base : `${base}/`)

/** Whether `abs` (a normalized absolute path) may never hold a board's pictures; `home` and `tmp` are seams for a test. */
export function blockedPicturesFolder(abs: string, home = homedir(), tmp = tmpdir()): boolean {
  // `tmpdir()` is `/var/folders/…` and its real place is `/private/var/folders/…`; `/tmp` is `/private/tmp`.
  if ([tmp, `/private${tmp}`, '/tmp', '/private/tmp'].some((t) => under(abs, t))) return false
  if (abs === '/' || abs === home) return true
  const roots = ['/System', '/Library', '/Applications', '/usr', '/bin', '/sbin', '/etc', '/var', '/private/etc', '/private/var', '/opt', path.join(home, 'Library')]
  return roots.some((r) => under(abs, r))
}

/** The real place of the absolute `abs`, symbolic links resolved. A folder not made yet: its nearest existing parent's real place, plus the rest. */
export async function realFolder(abs: string): Promise<string> {
  try {
    return await realpath(abs)
  } catch {
    const parent = path.dirname(abs)
    return parent === abs ? abs : path.join(await realFolder(parent), path.basename(abs))
  }
}

/**
 * Where pictures land for a board in the vault `dir` whose block names `folder`: the folder itself, or null (the
 * vault's `assets/`). A vault folder lands while its real place is in the vault. Any other folder lands only when its
 * real place is the real place of an approved folder, and only while it is there: YAZ-4071 7G, an outside folder on a drive
 * that is not plugged in, or one that was deleted, gets nothing (a save would fail, or make an empty folder again). Only a
 * board with its own folder pays the `realpath` calls.
 */
export async function landingFolder(dir: string, folder: string | null, approved: readonly string[]): Promise<string | null> {
  if (folder === null) return null
  const outside = picturesFolderOutside(folder)
  const real = await realFolder(outside ? folder : path.join(dir, ...folder.split('/')))
  if (!outside && under(real, await realFolder(dir))) return folder
  if (!(await stat(real).then((s) => s.isDirectory(), () => false))) return null
  const reals = await Promise.all(approved.map(realFolder))
  return reals.includes(real) ? folder : null
}
