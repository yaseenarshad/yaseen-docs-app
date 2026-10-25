import { lstat, rename, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import type { PutBackResponse } from '@shared/types'
import { BridgeFailure, fsCall, isSkipped, requireAbsPath } from './fsUtils'
import { requireFreeTarget } from './rename'
import { requireRequest } from './validate'

/**
 * The Trash of an undone delete (YAZ-3268 D16). `shell.trashItem` answers nothing about where the
 * item went, and the Trash can give it a new name ("Plan 10.21.33.md") when it holds one of that
 * name. So `removeEntry` notes the item's file ID (`ino` + `dev`) before the move, and looks for the
 * entry with that ID after it, here. A move into the Trash keeps the ID: it is a rename on that disk.
 *
 * macOS protects `~/.Trash`: without Full Disk Access a `readdir` there fails `EPERM`, but a `stat`
 * or a `rename` of an entry by its exact name works (the finding on YAZ-3268). So the entry is
 * looked for only by exact names: its own, then the names the Trash gives a clash. The Trash is never
 * listed (YAZ-3270): a scan cost about 0.7 s for each item in a Trash of 10,000 entries, and D16b
 * offers no Undo when the name is not found.
 */

type DevOf = (p: string) => Promise<{ dev: number }>

/**
 * The Trash folder of the disk `dev` that held `p` (D16): `~/.Trash` on the disk of the home folder;
 * on another disk `<mount>/.Trashes/<uid>`. `<mount>` is the last folder up from `p`'s folder that
 * is still on `dev`: it is found by the `dev` of each folder, never guessed by the path's depth.
 */
export async function trashFolderOf(p: string, dev: number, devOf: DevOf = stat): Promise<string> {
  const home = homedir()
  if ((await devOf(home).catch(() => null))?.dev === dev) return path.join(home, '.Trash')
  let mount = path.dirname(p)
  for (let up = path.dirname(mount); up !== mount; up = path.dirname(mount)) {
    if ((await devOf(up).catch(() => null))?.dev !== dev) break
    mount = up
  }
  return path.join(mount, '.Trashes', String(process.getuid?.() ?? 0))
}

/** How far before the delete began, and after it ended, the Trash's time stamp of a clash may be. */
const STAMP_SLACK_MS = 1_000

/**
 * The names the Trash gives an entry whose name it already holds (YAZ-3268, the guided test):
 * `Plan.md 01-30-05-828.md` — the name, a space, the local time of the move to the millisecond, and
 * the extension again. One name per millisecond from `since` to `now`, with slack; an hour of 24 and
 * of 12 where they differ. The file ID decides which, if any, is the entry.
 */
function clashNames(name: string, since: number, now: number): string[] {
  const ext = path.extname(name)
  const two = (n: number) => String(n).padStart(2, '0')
  const names: string[] = []
  for (let t = since - STAMP_SLACK_MS; t <= now + STAMP_SLACK_MS; t++) {
    const d = new Date(t)
    const rest = `${two(d.getMinutes())}-${two(d.getSeconds())}-${String(d.getMilliseconds()).padStart(3, '0')}`
    for (const hour of new Set([d.getHours(), d.getHours() % 12 || 12])) names.push(`${name} ${two(hour)}-${rest}${ext}`)
  }
  return names
}

/**
 * The entry in `folder` with the file ID `ino` + `dev` (D16), or null. First `<folder>/<name>` (the
 * usual case); then the names the Trash gives a clash at the time of this delete (`since` to `now`).
 * Each is an exact-name `lstat`, which works without Full Disk Access. Nothing else: the folder is
 * never listed (YAZ-3270, D16b), so a big Trash costs nothing more. Never throws: a Trash that cannot
 * be read is an entry not found (S61).
 */
export async function findTrashed(
  folder: string,
  name: string,
  ino: number,
  dev: number,
  now: number = Date.now(),
  since: number = now,
): Promise<string | null> {
  const same = (s: { ino: number; dev: number } | null): boolean => s !== null && s.ino === ino && s.dev === dev
  const byName = path.join(folder, name)
  if (same(await lstat(byName).catch(() => null))) return byName
  for (const clash of clashNames(name, since, now)) {
    const p = path.join(folder, clash)
    if (same(await lstat(p).catch(() => null))) return p
  }
  return null
}

/**
 * `fs:put-back` (D16): the Trash entry `trashed` back to `path`, its old place. The guards of
 * `fs:rename`, where they transfer: the folder of `path` must exist; nothing is ever overwritten, not
 * even a broken link (`ALREADY_EXISTS`, S60, YAZ-3271); a hidden name is refused. `trashed` must be
 * directly in the Trash of the disk of `path`'s folder (`trashFolderOf`, YAZ-3268 nit 1), else
 * `BAD_REQUEST`, so this door moves nothing else; one that left the Trash fails `NOT_FOUND` on its own
 * path (S59).
 * That `path` is in a vault of the calling window is `ipc/fs.ts`'s to check.
 */
export async function putBack(req: unknown): Promise<PutBackResponse> {
  const { trashed, path: to } = requireRequest(req)
  const from = requireAbsPath(trashed, 'trashed')
  const dest = requireAbsPath(to, 'path')
  if (isSkipped(path.basename(dest))) throw new BridgeFailure('BAD_REQUEST', 'hidden entries cannot be put back', { path: dest })
  return fsCall(from, async () => {
    const parentP = path.dirname(dest)
    const parent = await stat(parentP).catch(() => null)
    if (parent === null) throw new BridgeFailure('NOT_FOUND', 'the target folder does not exist', { path: parentP })
    if (!parent.isDirectory()) throw new BridgeFailure('NOT_A_DIRECTORY', 'the target parent is not a folder', { path: parentP })
    // `dest`, not its folder: `trashFolderOf` starts the walk up at the folder of what it is given.
    if ((await trashFolderOf(dest, parent.dev)) !== path.dirname(from)) {
      throw new BridgeFailure('BAD_REQUEST', 'that is not an entry of the Trash of that disk', { path: from })
    }
    const src = await lstat(from).catch(() => null)
    if (src === null) throw new BridgeFailure('NOT_FOUND', 'it is no longer in the Trash', { path: from })
    await requireFreeTarget(src, dest)
    await rename(from, dest)
    return { path: dest, kind: src.isDirectory() ? 'dir' : 'file' }
  })
}
