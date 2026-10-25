import { lstat, readdir, rename, stat } from 'node:fs/promises'
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
 * looked for by its own name first, and only then by a scan, which only Full Disk Access allows.
 */

/** How old an entry of the scan may be (D16): a move into the Trash sets its `ctime`, so the entry of this delete is newer. */
const RECENT_MS = 60_000

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

/** Is `dir` a Trash folder (D16): `~/.Trash`, or a `.Trashes/<uid>` of a disk. `fs:put-back` moves only an entry directly in one. */
const isTrashFolder = (dir: string): boolean =>
  dir === path.join(homedir(), '.Trash') || (path.basename(dir) === String(process.getuid?.() ?? 0) && path.basename(path.dirname(dir)) === '.Trashes')

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
 * usual case, and the one that works without Full Disk Access); then the names the Trash gives a clash
 * at the time of this delete (`since` to `now`), each by its exact name, which also works without it;
 * last each entry changed in the last minute, which only Full Disk Access lets the app list. Never
 * throws: a Trash that cannot be read is an entry not found (S61).
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
  const names = await readdir(folder).catch(() => [] as string[])
  for (const entry of names) {
    const p = path.join(folder, entry)
    const s = await lstat(p).catch(() => null)
    if (s !== null && now - s.ctimeMs <= RECENT_MS && same(s)) return p
  }
  return null
}

/**
 * `fs:put-back` (D16): the Trash entry `trashed` back to `path`, its old place. The guards of
 * `fs:rename`, where they transfer: the folder of `path` must exist; nothing is ever overwritten
 * (`ALREADY_EXISTS`, S60); a hidden name is refused. `trashed` must be directly in a Trash folder, so
 * this door moves nothing else; one that left the Trash fails `NOT_FOUND` on its own path (S59).
 * That `path` is in a vault of the calling window is `ipc/fs.ts`'s to check.
 */
export async function putBack(req: unknown): Promise<PutBackResponse> {
  const { trashed, path: to } = requireRequest(req)
  const from = requireAbsPath(trashed, 'trashed')
  const dest = requireAbsPath(to, 'path')
  if (!isTrashFolder(path.dirname(from))) throw new BridgeFailure('BAD_REQUEST', 'that is not an entry of the Trash', { path: from })
  if (isSkipped(path.basename(dest))) throw new BridgeFailure('BAD_REQUEST', 'hidden entries cannot be put back', { path: dest })
  return fsCall(from, async () => {
    const src = await lstat(from).catch(() => null)
    if (src === null) throw new BridgeFailure('NOT_FOUND', 'it is no longer in the Trash', { path: from })
    const parentP = path.dirname(dest)
    const parent = await stat(parentP).catch(() => null)
    if (parent === null) throw new BridgeFailure('NOT_FOUND', 'the target folder does not exist', { path: parentP })
    if (!parent.isDirectory()) throw new BridgeFailure('NOT_A_DIRECTORY', 'the target parent is not a folder', { path: parentP })
    await requireFreeTarget(src, dest)
    await rename(from, dest)
    return { path: dest, kind: src.isDirectory() ? 'dir' : 'file' }
  })
}
