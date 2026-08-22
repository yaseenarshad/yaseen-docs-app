import path from 'node:path'
import { CH } from '../../channels'
import { readAsset } from '../fs/assets'
import { createDir, createFile } from '../fs/create'
import { readFile, writeFile } from '../fs/file'
import { BridgeFailure } from '../fs/fsUtils'
import { renameFile, repairRename } from '../fs/rename'
import { tree } from '../fs/tree'
import type { Store } from '../store'
import { getColdStartDiff, getIndex } from '../vaultIndex'
import type { WindowRegistry } from '../windows'
import { broadcastAll } from './broadcast'
import { handle, handleWithEvent } from './envelope'

/** The fs half of `window.yaseenDocs` (`dialog:pick-folder` lives in `./dialog`). */
export function registerFsIpc(store: Store, windows: WindowRegistry): void {
  handle(CH.fsTree, tree)
  handle(CH.fsRead, readFile)
  handle(CH.fsWrite, writeFile)
  handle(CH.fsCreateDir, createDir)
  handle(CH.fsCreateFile, createFile)
  handle(CH.fsIndex, getIndex)
  // The cold-start reconcile diff (Links E1c, GRO-2242): the client's rename detector reads it
  // AFTER the first fs:index for the root. Null before the first build (and again once idle
  // eviction drops the entry); the registry's honest-miss semantics ride through untouched —
  // consumers gate on cacheStatus === 'hit'.
  handle(CH.fsColdDiff, async (root: unknown) => (typeof root === 'string' ? (getColdStartDiff(root) ?? null) : null))
  handle(CH.fsReadAsset, readAsset)
  // In-app rename/move (Links E1 GRO-2194, E1b GRO-2241). The SAME handler repairs the
  // store — every stored path at or under the renamed entry follows (window roots/files/
  // tabs, recents, folder state) — and then pushes `file:renamed` to EVERY window so open
  // tabs remap in place (a `dir` event remaps by prefix). The vault index needs no push:
  // the shared watcher's unlink+add echo already heals it (no double-processing).
  handleWithEvent(CH.fsRename, async (e, req: unknown) => {
    // E1b: the calling window's own vault ROOT cannot be renamed — root identity is a
    // recents/vault-management question (which recents entry follows, what this window's
    // identity then means), out of E1b's scope. ANOTHER window rooted at a subfolder of
    // this vault is fine: `store.renamePath` below remaps its `WindowEntry.root`.
    const oldPath = typeof (req as { oldPath?: unknown } | null)?.oldPath === 'string' ? path.resolve((req as { oldPath: string }).oldPath) : null
    const senderId = windows.idFor(e.sender)
    const senderRoot = store.get().windows.find((w) => w.id === senderId)?.root
    if (oldPath !== null && senderRoot != null && senderRoot === oldPath) {
      throw new BridgeFailure('BAD_REQUEST', 'the vault root itself cannot be renamed', { path: oldPath })
    }
    const res = await renameFile(req)
    store.renamePath(res.oldPath, res.newPath)
    broadcastAll(CH.fileRenamed, { oldPath: res.oldPath, newPath: res.newPath, kind: res.kind })
    return res
  })
  // External-rename repair (Links E1c, GRO-2242): the entry ALREADY moved on disk (an external
  // mover), the user confirmed the banner's hypothesis, so there is no fs work — validate the
  // claim (repairRename: newPath exists, oldPath does not) and reuse E1's ENTIRE downstream:
  // the same store repair and the same file:renamed push (tab remap, editor continuity,
  // title/hash). No vault-root guard here — nothing moves, and a window rooted at a repaired
  // folder is exactly what store.renamePath heals.
  handle(CH.fileRepairRename, async (req: unknown) => {
    const res = await repairRename(req)
    store.renamePath(res.oldPath, res.newPath)
    broadcastAll(CH.fileRenamed, { oldPath: res.oldPath, newPath: res.newPath, kind: res.kind })
    return res
  })
}
