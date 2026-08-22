import path from 'node:path'
import { CH } from '../../channels'
import { readAsset } from '../fs/assets'
import { createDir, createFile } from '../fs/create'
import { readFile, writeFile } from '../fs/file'
import { BridgeFailure } from '../fs/fsUtils'
import { renameFile } from '../fs/rename'
import { tree } from '../fs/tree'
import type { Store } from '../store'
import { getIndex } from '../vaultIndex'
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
}
