import { rename, stat } from 'node:fs/promises'
import path from 'node:path'
import type { RenameFileResponse } from '@shared/types'
import { fileKind } from '@shared/fileKind'
import { BridgeFailure, fsCall, requireAbsPath } from './fsUtils'

/**
 * In-app FILE rename (Links E1, GRO-2194 — decision E, GRO-2096: automatic link updates, no
 * prompt). v1 scope: same parent directory only, and the extension KIND is unchanged (md↔md,
 * base↔base — `.md` ↔ `.markdown` is one kind). E1b (folder rename + cross-directory move)
 * LIFTS those two guards; everything else here stays.
 *
 * Never-overwrite race posture: the target is pre-checked (→ `ALREADY_EXISTS`) because
 * `fs.rename` has no `wx` — it silently replaces an existing target. Pre-check + the app's
 * single-instance lock is the accepted posture (mirrors createFile's never-overwrite rule);
 * an external writer landing on the target in the microseconds between check and rename is
 * out of reach, exactly like any external edit. A case-only rename on a case-insensitive fs
 * stats the SOURCE at the target path — same inode is not a collision.
 */
export async function renameFile(req: unknown): Promise<RenameFileResponse> {
  if (typeof req !== 'object' || req === null) throw new BridgeFailure('BAD_REQUEST', 'request must be an object')
  const { oldPath, newPath } = req as Record<string, unknown>
  const oldP = requireAbsPath(oldPath, 'oldPath')
  const newP = requireAbsPath(newPath, 'newPath')
  const oldKind = fileKind(oldP)
  const newKind = fileKind(newP)
  if (oldKind === null) throw new BridgeFailure('UNSUPPORTED_EXTENSION', 'only .md/.markdown/.base files can be renamed', { path: oldP })
  if (newKind === null) throw new BridgeFailure('UNSUPPORTED_EXTENSION', 'the new name must keep a .md/.markdown/.base extension', { path: newP })
  if (oldKind !== newKind) throw new BridgeFailure('BAD_REQUEST', 'the extension kind cannot change (md↔md, base↔base)', { path: newP })
  if (oldP === newP) throw new BridgeFailure('BAD_REQUEST', 'the new path is the same as the old one', { path: newP })
  // Same-directory FILE rename only; E1b lifts this restriction.
  if (path.dirname(oldP) !== path.dirname(newP)) throw new BridgeFailure('BAD_REQUEST', 'rename cannot move a file between folders yet', { path: newP })
  return fsCall(oldP, async () => {
    const src = await stat(oldP) // missing source → ENOENT → NOT_FOUND
    if (!src.isFile()) throw new BridgeFailure('NOT_A_FILE', 'expected a file', { path: oldP })
    const dst = await stat(newP).catch(() => null)
    if (dst !== null && !(dst.ino === src.ino && dst.dev === src.dev)) {
      throw new BridgeFailure('ALREADY_EXISTS', 'a file with this name already exists', { path: newP })
    }
    await rename(oldP, newP)
    return { oldPath: oldP, newPath: newP }
  })
}
