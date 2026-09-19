import path from 'node:path'
import { CH } from '../../channels'
import { readAsset, writeAsset } from '../fs/assets'
import { createDir, createFile } from '../fs/create'
import { readFile, writeFile } from '../fs/file'
import { BridgeFailure } from '../fs/fsUtils'
import { readImage } from '../fs/image'
import { openInDefaultApp } from '../fs/openDefault'
import { openInVsCode } from '../fs/openInVsCode'
import { openLink } from '../fs/openLink'
import { readPdf } from '../fs/pdf'
import { renameFile, repairRename } from '../fs/rename'
import { removeEntry } from '../fs/remove'
import { revealItem } from '../fs/reveal'
import { tree } from '../fs/tree'
import type { Store } from '../store'
import { getColdStartDiff, getIndex } from '../vaultIndex'
import type { WindowLookup } from '../windows'
import { broadcastAll } from './broadcast'
import { handle, handleWithEvent } from './envelope'

/** The fs half of `window.yaseenDocs` (`dialog:pick-folder` lives in `./dialog`). */
export function registerFsIpc(store: Store, windows: WindowLookup): void {
  handle(CH.fsTree, tree)
  handle(CH.fsRead, readFile)
  handle(CH.fsReadPdf, readPdf)
  handle(CH.fsReadImage, readImage)
  handle(CH.fsWrite, writeFile)
  handle(CH.fsCreateDir, createDir)
  handle(CH.fsCreateFile, createFile)
  handle(CH.fsIndex, getIndex)
  // The cold-start reconcile diff (Links E1c, GRO-2242): the client's rename detector reads it
  // AFTER the first fs:index for the root. Null before the first build (and again once idle
  // eviction drops the entry); the index cache's honest-miss semantics ride through untouched —
  // consumers gate on cacheStatus === 'hit'.
  handle(CH.fsColdDiff, async (root: unknown) => (typeof root === 'string' ? (getColdStartDiff(root) ?? null) : null))
  handle(CH.fsReadAsset, readAsset)
  // The asset write (YAZ-876 drawings, YAZ-1661 image bytes): no store repair and no broadcast
  // — repair and the pushes exist for paths that MOVE or GO, and a write does neither. A
  // `.excalidraw` is not a vault file, so nothing points at it; a pasted image is a NEW file
  // the tree learns of from the watcher, like any add made outside the app.
  handle(CH.fsWriteAsset, writeAsset)
  // Reveal in Finder (GRO-2274): read-only, so no store repair and no broadcast — but still
  // enveloped like every other handler so a stale row's NOT_FOUND reaches the renderer as a
  // passive notice instead of vanishing (showItemInFolder is silent on a missing path).
  handle(CH.shellReveal, revealItem)
  // Open in VS Code (YAZ-963): reveal's twin in every respect — read-only, nothing to repair,
  // nothing to broadcast, and enveloped for the same NOT_FOUND notice.
  handle(CH.shellOpenVsCode, openInVsCode)
  // Open in default app (YAZ-1577): third of the read-only OS verbs — same envelope, same NOT_FOUND notice.
  handle(CH.shellOpenDefault, openInDefaultApp)
  // Standard Markdown links: main owns protocol/path validation and the Electron shell boundary.
  handle(CH.shellOpenLink, openLink)
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
  // In-app delete (GRO-2272). Deliberately the SAME shape as the rename handler above —
  // fs work, then `store.removePath` repair, then one broadcast to every window — with two
  // differences that are the point of the feature:
  //  - it REMOVES rather than remaps, so a window whose active file went is left on an heir
  //    tab (store.removePath picks it with the workspace's own ladder);
  //  - there is NO link rewriting anywhere downstream (LOCKED decision C): notes referencing
  //    the deleted page stay byte-identical and their [[links]] simply go unresolved.
  // Like rename, the vault index needs no push: the watcher's unlink / unlinkDir echo heals
  // it (verified empirically in the GRO-2275 scope pass — trashItem is a MOVE at the fs
  // layer, so chokidar reports it exactly like any other move out of the root).
  handleWithEvent(CH.fsDelete, async (e, req: unknown) => {
    // The calling window's own vault ROOT cannot be deleted — same reasoning and the same
    // sender lookup as rename: root identity is a recents/vault-management question. ANOTHER
    // window rooted inside the deleted folder IS allowed; it falls through to that window's
    // existing onRootMissing probe, which also drops the dead MRU entry.
    const target = typeof (req as { path?: unknown } | null)?.path === 'string' ? path.resolve((req as { path: string }).path) : null
    const senderId = windows.idFor(e.sender)
    const senderRoot = store.get().windows.find((w) => w.id === senderId)?.root
    if (target !== null && senderRoot != null && senderRoot === target) {
      throw new BridgeFailure('BAD_REQUEST', 'the vault root itself cannot be deleted', { path: target })
    }
    const res = await removeEntry(req)
    store.removePath(res.path)
    broadcastAll(CH.fileDeleted, { path: res.path, kind: res.kind })
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
