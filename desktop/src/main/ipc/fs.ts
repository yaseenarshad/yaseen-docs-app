import path from 'node:path'
import { CONTRACT } from '@shared/ipc'
import type { RenameFileResponse } from '@shared/types'
import * as favorites from '../favorites'
import { fileClip } from '../fileClip'
import { readAsset, writeAsset } from '../fs/assets'
import { copyEntry, pasteEntries } from '../fs/copy'
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
import { retitle } from '../fs/retitle'
import { revealItem } from '../fs/reveal'
import { tree } from '../fs/tree'
import type { Store } from '../store'
import { getColdStartDiff, getIndex } from '../vaultIndex'
import type { WindowLookup } from '../windows'
import { broadcastAll, rootsOf } from './broadcast'
import { handle, handleWithEvent } from './envelope'

/**
 * The favorites.json repair (YAZ-1766 6A, D13) rides the SAME handlers as the store repair below,
 * but never fails the file op or skips the broadcast: a corrupt or unwritable favorites.json is
 * warned about and the rename/delete stands.
 */
const repairFavorites = (p: Promise<void>): Promise<void> => p.catch((err: unknown) => console.warn(`[favorites] repair failed: ${String(err)}`))

/** The fs half of `window.yaseenDocs` (`dialog:pick-folder` lives in `./dialog`). */
export function registerFsIpc(store: Store, windows: WindowLookup): void {
  handle(CONTRACT.tree, tree)
  handle(CONTRACT.readFile, readFile)
  handle(CONTRACT.readPdf, readPdf)
  handle(CONTRACT.readImage, readImage)
  handle(CONTRACT.writeFile, writeFile)
  handle(CONTRACT.createDir, createDir)
  handle(CONTRACT.createFile, createFile)
  handle(CONTRACT.index, getIndex)
  // The cold-start reconcile diff (Links E1c, GRO-2242): the client's rename detector reads it
  // AFTER the first fs:index for the root. Null before the first build (and again once idle
  // eviction drops the entry); the index cache's honest-miss semantics ride through untouched —
  // consumers gate on cacheStatus === 'hit'.
  handle(CONTRACT.coldDiff, async (root: unknown) => (typeof root === 'string' ? (getColdStartDiff(root) ?? null) : null))
  handle(CONTRACT.readAsset, readAsset)
  // The asset write (YAZ-876 drawings, YAZ-1661 image bytes): no store repair and no broadcast
  // — repair and the pushes exist for paths that MOVE or GO, and a write does neither. A
  // `.excalidraw` is not a vault file, so nothing points at it; a pasted image is a NEW file
  // the tree learns of from the watcher, like any add made outside the app.
  handle(CONTRACT.writeAsset, writeAsset)
  // Reveal in Finder (GRO-2274): read-only, so no store repair and no broadcast — but still
  // enveloped like every other handler so a stale row's NOT_FOUND reaches the renderer as a
  // passive notice instead of vanishing (showItemInFolder is silent on a missing path).
  handle(CONTRACT.shell.reveal, revealItem)
  // Open in VS Code (YAZ-963): reveal's twin in every respect — read-only, nothing to repair,
  // nothing to broadcast, and enveloped for the same NOT_FOUND notice.
  handle(CONTRACT.shell.openVsCode, openInVsCode)
  // Open in default app (YAZ-1577): third of the read-only OS verbs — same envelope, same NOT_FOUND notice.
  handle(CONTRACT.shell.openDefault, openInDefaultApp)
  // Standard Markdown links: main owns protocol/path validation and the Electron shell boundary.
  handle(CONTRACT.shell.openLink, openLink)
  // In-app rename/move (Links E1 GRO-2194, E1b GRO-2241). The SAME handler repairs the
  // store — every stored path at or under the renamed entry follows (window roots/files/
  // tabs, recents, folder state) — and then pushes `file:renamed` to EVERY window so open
  // tabs remap in place (a `dir` event remaps by prefix). The vault index needs no push:
  // the shared watcher's unlink+add echo already heals it (no double-processing).
  const afterRename = async (res: RenameFileResponse): Promise<RenameFileResponse> => {
    store.renamePath(res.oldPath, res.newPath)
    await repairFavorites(favorites.renamePath(rootsOf(store.get()), res.oldPath, res.newPath))
    broadcastAll(CONTRACT.file.onRenamed.channel, { oldPath: res.oldPath, newPath: res.newPath, kind: res.kind })
    return res
  }
  handleWithEvent(CONTRACT.file.rename, async (e, req: unknown) => {
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
    return afterRename(await renameFile(req))
  })
  // A title edit (YAZ-2420 🔒 D16): `retitle` writes the title and renames; a path that changed
  // then takes the rename handler's downstream (`afterRename`). One that kept its name moved
  // nothing, so there is nothing to repair or push: the index reads the new title off the watcher.
  handleWithEvent(CONTRACT.file.retitle, async (e, req: unknown) => {
    const senderId = windows.idFor(e.sender)
    const root = store.get().windows.find((w) => w.id === senderId)?.root
    if (root == null) throw new BridgeFailure('BAD_REQUEST', 'no vault is open in this window')
    const res = await retitle(root, req)
    return res.newPath === res.oldPath ? res : afterRename(res)
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
  // layer, so the watcher reports it exactly like any other move out of the root; pinned by
  // watchConformance.ts, YAZ-2192).
  handleWithEvent(CONTRACT.file.delete, async (e, req: unknown) => {
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
    await repairFavorites(favorites.removePath(rootsOf(store.get()), res.path))
    broadcastAll(CONTRACT.file.onDeleted.channel, { path: res.path, kind: res.kind })
    return res
  })
  // External-rename repair (Links E1c, GRO-2242): the entry ALREADY moved on disk (an external
  // mover), the user confirmed the banner's hypothesis, so there is no fs work — validate the
  // claim (repairRename: newPath exists, oldPath does not) and reuse E1's ENTIRE downstream:
  // the same store repair and the same file:renamed push (tab remap, editor continuity,
  // title/hash). No vault-root guard here — nothing moves, and a window rooted at a repaired
  // folder is exactly what store.renamePath heals.
  handle(CONTRACT.file.repairRename, async (req: unknown) => {
    const res = await repairRename(req)
    store.renamePath(res.oldPath, res.newPath)
    await repairFavorites(favorites.renamePath(rootsOf(store.get()), res.oldPath, res.newPath))
    broadcastAll(CONTRACT.file.onRenamed.channel, { oldPath: res.oldPath, newPath: res.newPath, kind: res.kind })
    return res
  })
  // File clipboard (YAZ-1674, D1): the ONE app-wide clipboard lives in main (`fileClip`), so a
  // paste in any window takes what any window cut or copied — within a vault or across two.
  // Every change is pushed to EVERY window as `clip:changed` (the github status posture):
  // that is how a menu on vault B learns "Paste 3 items" after a cut on vault A.
  // Subscribed once for the process's life — `registerFsIpc` runs once, so there is nothing to unsubscribe.
  fileClip.onChange((state) => broadcastAll(CONTRACT.file.onClipChanged.channel, state))
  // Cut / Copy is a pure clipboard write: nothing on disk is touched or even stat'ed, so there
  // is no store repair and no file push here — a path that goes stale before the paste is
  // reported per entry BY the paste. No vault-root guard either: Cut/Copy is offered on ROWS
  // only, never on blank space, and a window's own root is never a row of its tree (D5/D6; see CONTRACTS).
  handle(CONTRACT.file.clip, async (req: unknown) => {
    fileClip.set(req)
  })
  // A window opened AFTER a clip missed the push: it reads the current state once on mount,
  // then `clip:changed` carries the rest (the same catch-up read `github.status` offers).
  handle(CONTRACT.file.clipState, async () => fileClip.state())
  // Paste (D2–D4). Per entry, in clipboard order, and one bad entry never stops the rest:
  //  - a COPY is `copyEntry` (a note or a folder under its own built name, YAZ-2420 🔒 D21; any
  //    other file `fs.cp` under Finder's next free name, D3/D4) with deliberately NO
  //    store repair and NO broadcast — nothing moved and nothing went, so there is nothing to
  //    remap or retire; the tree learns of the new entry from the watcher's add/addDir echo,
  //    exactly like any add made outside the app, and the client's refresh() is idempotent;
  //  - a CUT is the EXISTING rename pipeline above, verbatim — `renameFile`, then
  //    `store.renamePath`, then `file:renamed` to every window — once PER ENTRY, so open tabs
  //    on a moved file remap as they would for a drag-drop move. Across volumes `fs.rename`
  //    cannot move (EXDEV); that entry fails `IO_ERROR` rather than copy-then-delete.
  // A cut pastes ONCE: the clipboard clears when at least one entry landed (a cut whose every
  // entry failed stays, so the user can fix the cause and paste again); a copy is kept and
  // pastes again and again (D2).
  handle(CONTRACT.file.paste, async (req: unknown) => {
    const clip = fileClip.get()
    if (clip === null) throw new BridgeFailure('BAD_REQUEST', 'nothing to paste')
    const res = await pasteEntries(clip, req, {
      copy: copyEntry,
      move: async (from, to) => {
        const r = await renameFile({ oldPath: from, newPath: to })
        store.renamePath(r.oldPath, r.newPath)
        await repairFavorites(favorites.renamePath(rootsOf(store.get()), r.oldPath, r.newPath))
        broadcastAll(CONTRACT.file.onRenamed.channel, { oldPath: r.oldPath, newPath: r.newPath, kind: r.kind })
        return r
      },
    })
    if (clip.op === 'cut' && res.pasted.length > 0) fileClip.clear()
    return res
  })
}
