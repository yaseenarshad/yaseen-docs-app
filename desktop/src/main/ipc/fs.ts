import { stat } from 'node:fs/promises'
import path from 'node:path'
import { nativeImage, screen, type IpcMainInvokeEvent } from 'electron'
import { CONTRACT } from '@shared/ipc'
import { BETWEEN_VAULTS, CLIP_CHANGED, rootOfPath, type FileWriteRequest, type FileWriteResponse, type ImportResponse, type RenameFileResponse } from '@shared/types'
import { dropLanded, rememberDragOut } from '../dragLanding'
import { whenMouseUp } from '../dragWatch'
import * as favorites from '../favorites'
import * as icons from '../icons'
import { fileClip, type FileClip } from '../fileClip'
import * as focus from '../focus'
import { readAsset, writeAsset } from '../fs/assets'
import { copyEntry, importCopy, isCrossDevice, pasteEntries, type PasteOps } from '../fs/copy'
import { createDir, createFile } from '../fs/create'
import { readFile, writeFile } from '../fs/file'
import { BridgeFailure, fsCall, isSkipped, requireAbsPath } from '../fs/fsUtils'
import { readHeads } from '../fs/heads'
import { readImage } from '../fs/image'
import { openInDefaultApp } from '../fs/openDefault'
import { openInVsCode } from '../fs/openInVsCode'
import { openLink } from '../fs/openLink'
import { clearOsFiles, readOsFiles, writeOsFiles } from '../osFileClipboard'
import { readPdf } from '../fs/pdf'
import { renameFile, repairRename } from '../fs/rename'
import { removeEntry } from '../fs/remove'
import { putBack } from '../fs/trash'
import { retitle } from '../fs/retitle'
import { revealItem } from '../fs/reveal'
import { tree } from '../fs/tree'
import { requireRequest, requireStringArray } from '../fs/validate'
import type { Store } from '../store'
import { changeLetters, checkDuplicates, getColdStartDiff, getIndex, giveIdsNow, giveOldIdsNumbers, idsState, indexMoved, indexWrote, onIdFixes, saveIdsAnswer } from '../vaultIndex'
import { givesIds } from '../vaultIndex/idSweep'
import { doorOf, type IdDoor } from '../vaultIndex/mint'
import type { WindowManager } from '../windows'
import { broadcastAll, loggedSave, rootsOf, senderRoots } from './broadcast'
import { handle, handleWithEvent } from './envelope'
import { repairShares, shareFsHooks } from '../share/fsHooks'

/**
 * The favorites.json repair (YAZ-1766 6A, D13) rides the SAME handlers as the store repair below,
 * but never fails the file op or skips the broadcast: a corrupt or unwritable favorites.json is
 * warned about and the rename/delete stands.
 */
const repairFavorites = (p: Promise<void>): Promise<void> => p.catch((err: unknown) => console.warn(`[favorites] repair failed: ${String(err)}`))
/** The focus list's repair (YAZ-2702 R10, R11), by the same rule: this Mac's focus file follows a rename and a delete, and a repair that fails is warned about and nothing more. */
const repairFocus = (p: Promise<void>): Promise<void> => p.catch((err: unknown) => console.warn(`[focus] repair failed: ${String(err)}`))
/** The vault's own icons (YAZ-3440 D8), by the same rule: a pick follows a rename or a move and leaves with a delete; a repair that fails is warned about. */
const repairIcons = (p: Promise<void>): Promise<void> => p.catch((err: unknown) => console.warn(`[icons] repair failed: ${String(err)}`))

/** The fs half of `window.yaseenDocs` (`dialog:pick-folder` lives in `./dialog`). */
export function registerFsIpc(store: Store, windows: Pick<WindowManager, 'idFor' | 'vaultNotice'>): void {
  handle(CONTRACT.tree, tree)
  handle(CONTRACT.readFile, readFile)
  // The pages of the tab board (YAZ-2648 D6): read-only, one call for every open tab.
  handle(CONTRACT.readHeads, readHeads)
  handle(CONTRACT.readPdf, readPdf)
  handle(CONTRACT.readImage, readImage)
  // A note's save goes in the save log (YAZ-3235 D1); a quiet tidy-up write (`FileWriteRequest.quiet`) does not.
  // The index takes a quiet write at once (YAZ-3258): the link rewrite of a move, read by a quick ⌘Z.
  const quiet = (req: unknown): boolean => (req as { quiet?: unknown } | null)?.quiet === true
  const save = async (req: FileWriteRequest): Promise<FileWriteResponse> => {
    const res = await writeFile(req)
    if (quiet(req)) await indexWrote(res.path)
    return res
  }
  handleWithEvent(CONTRACT.writeFile, loggedSave(store, windows, save, (req) => !quiet(req)))
  const rootsOfSender = (e: IpcMainInvokeEvent): readonly string[] => senderRoots(store, windows, e)
  /**
   * Does what `req` names get IDs (YAZ-2523 🔒 V5)? Only when a vault of the calling window holds
   * the path (YAZ-2602 S78) and that vault said yes: then this is that vault's door, which gives each
   * new ID (YAZ-2677 D4), and else null. A create and a paste each ask once, here.
   */
  const doorFor = async (e: IpcMainInvokeEvent, req: unknown, key = 'path'): Promise<IdDoor | null> => {
    const p = typeof req === 'string' ? req : (req as Record<string, unknown> | null)?.[key]
    const root = typeof p === 'string' ? rootOfPath(rootsOfSender(e), p) : null
    return root === null ? null : doorOf(root)
  }
  handleWithEvent(CONTRACT.createDir, async (e, req) => createDir(req, await doorFor(e, req)))
  handleWithEvent(CONTRACT.createFile, async (e, req) => createFile(req, await doorFor(e, req)))
  // The door, for the front end (YAZ-2677 R17): the next ID of the vault that holds `path`, saved
  // before it is answered (R18). The caller needs it BEFORE its note exists — the note's file name
  // holds it, and so does a link the `[[` picker writes — and hands it back in `createFile`'s `id`.
  // Null where no vault of the window holds the path, or that vault does not use IDs.
  handleWithEvent(CONTRACT.mintNoteId, async (e, p: unknown) => (await (await doorFor(e, requireAbsPath(p, 'path')))?.mint(1))?.[0] ?? null)
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
  // tabs remap in place (a `dir` event remaps by prefix). The vault index takes the move FIRST
  // (YAZ-3258), so a window that reads it after the push, and the next move of a gesture, see the
  // new paths; the shared watcher's unlink+add echo comes later and changes nothing.
  const afterRename = async (res: RenameFileResponse): Promise<RenameFileResponse> => {
    await indexMoved(res.oldPath, res.newPath, res.kind)
    store.renamePath(res.oldPath, res.newPath)
    await repairFavorites(favorites.renamePath(rootsOf(store.get()), res.oldPath, res.newPath))
    await repairFocus(focus.renamePath(rootsOf(store.get()), res.oldPath, res.newPath))
    await repairIcons(icons.renamePath(rootsOf(store.get()), res.oldPath, res.newPath))
    await repairShares(shareFsHooks.renamed(rootsOf(store.get()), res.oldPath, res.newPath))
    broadcastAll(CONTRACT.file.onRenamed.channel, { oldPath: res.oldPath, newPath: res.newPath, kind: res.kind })
    return res
  }
  /**
   * The paste's move verb, hoisted (YAZ-3253 D9A): one entry renamed on disk, then the rename
   * handler's whole downstream (store, favorites, focus and shares repair, `file:renamed` to every
   * window). A Paste of a Cut and a drop from Finder move through it alike.
   */
  const moveEntry = async (from: string, to: string): Promise<RenameFileResponse> => afterRename(await renameFile({ oldPath: from, newPath: to }))
  handleWithEvent(CONTRACT.file.rename, async (e, req: unknown) => {
    // E1b: the calling window's own vault ROOT cannot be renamed — root identity is a
    // recents/vault-management question (which recents entry follows, what this window's
    // identity then means), out of E1b's scope. ANOTHER window rooted at a subfolder of
    // this vault is fine: `store.renamePath` below remaps its `WindowEntry.root`.
    const oldPath = typeof (req as { oldPath?: unknown } | null)?.oldPath === 'string' ? path.resolve((req as { oldPath: string }).oldPath) : null
    // Any vault of the calling window (YAZ-2602 S47).
    if (oldPath !== null && rootsOfSender(e).includes(oldPath)) {
      throw new BridgeFailure('BAD_REQUEST', 'the vault root itself cannot be renamed', { path: oldPath })
    }
    return afterRename(await renameFile(req))
  })
  // A title edit (YAZ-2420 🔒 D16): `retitle` writes the title and renames; a path that changed
  // then takes the rename handler's downstream (`afterRename`). One that kept its name moved
  // nothing, so there is nothing to repair or push: the index reads the new title off the watcher.
  handleWithEvent(CONTRACT.file.retitle, async (e, req: unknown) => {
    // The vault of the calling window that holds the note (YAZ-2602 S78): its title rules build the name.
    const target = (req as { path?: unknown } | null)?.path
    const root = typeof target === 'string' ? rootOfPath(rootsOfSender(e), target) : null
    if (root === null) throw new BridgeFailure('BAD_REQUEST', 'no vault of this window holds that path')
    // Only a vault that uses IDs has titles (YAZ-2523 🔒 V3): where it does not, a name changes by `fs:rename`.
    if (!(await givesIds(root))) throw new BridgeFailure('BAD_REQUEST', 'this vault does not use IDs')
    const res = await retitle(root, req)
    return res.newPath === res.oldPath ? res : afterRename(res)
  })
  // A vault's IDs (YAZ-2677). Both doors act on a vault OF THE CALLING WINDOW (YAZ-2602 S78): any other folder is refused.
  const ownVault = (e: IpcMainInvokeEvent, root: unknown): string => {
    if (typeof root !== 'string' || !rootsOfSender(e).includes(root)) throw new BridgeFailure('BAD_REQUEST', 'no vault of this window is that folder')
    return root
  }
  // The switch in Settings (🔒 D2): the answer is saved here, in main, where one save waits for the
  // one before it. A yes is the user asking on THIS Mac, so the numbers come now (R32, S64) — not
  // awaited: a vault of many notes must not hold the switch. A Mac that sees the yes arrive waits (S65).
  handleWithEvent(CONTRACT.ids.set, async (e, root: unknown, enabled: unknown, letters: unknown) => {
    const vault = ownVault(e, root)
    await saveIdsAnswer(vault, enabled, letters)
    if (enabled === true) void giveIdsNow(vault)
  })
  // "Check for duplicates" (🔒 D7, S55 to S57): one line for the row in Settings.
  handleWithEvent(CONTRACT.ids.check, async (e, root: unknown) => checkDuplicates(ownVault(e, root)))
  // The rows "ID letters" and "Old IDs" (🔒 D5, D6): what they show, and the two changes of every ID
  // in the vault. A file that takes a new name takes the rename handler's downstream AT ONCE, so its
  // open tab, its favorite and its stored paths follow (S86) — also when the change stops later.
  const followed = (res: RenameFileResponse): Promise<unknown> => afterRename(res).catch(() => undefined)
  handleWithEvent(CONTRACT.ids.state, async (e, root: unknown) => idsState(ownVault(e, root)))
  // When either ends, done or stopped, each window of the vault reads its index at once: notes have
  // new paths, and the watcher's events would hold the read back until they settle (YAZ-3102).
  const thenTell = <T>(root: string, change: Promise<T>): Promise<T> => change.finally(() => broadcastAll(CONTRACT.ids.onChanged.channel, { root }))
  handleWithEvent(CONTRACT.ids.reletter, async (e, root: unknown, letters: unknown) => {
    const r = ownVault(e, root)
    return thenTell(r, changeLetters(r, letters, followed))
  })
  handleWithEvent(CONTRACT.ids.backfill, async (e, root: unknown) => {
    const r = ownVault(e, root)
    return thenTell(r, giveOldIdsNumbers(r, followed))
  })
  // A clash this Mac fixed (S45): a note whose file name followed its new ID (R26) takes the rename
  // handler's downstream, so its open tab, its favorite and its stored paths follow; then ONE
  // notice in each window that shows the vault. Set once: `registerFsIpc` runs once.
  onIdFixes((root, fixes, notice) => {
    for (const fix of fixes) if (fix.renamedFrom !== undefined) void afterRename({ oldPath: fix.renamedFrom, newPath: fix.path, kind: 'file' }).catch(() => undefined)
    if (notice !== null) windows.vaultNotice(root, notice)
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
    if (target !== null && rootsOfSender(e).includes(target)) {
      throw new BridgeFailure('BAD_REQUEST', 'the vault root itself cannot be deleted', { path: target })
    }
    const res = await removeEntry(req)
    store.removePath(res.path)
    await repairFavorites(favorites.removePath(rootsOf(store.get()), res.path))
    await repairFocus(focus.removePath(rootsOf(store.get()), res.path))
    await repairIcons(icons.removePath(rootsOf(store.get()), res.path))
    await repairShares(shareFsHooks.deleted(rootsOf(store.get()), res.path))
    broadcastAll(CONTRACT.file.onDeleted.channel, { path: res.path, kind: res.kind })
    return res
  })
  // The Undo of a delete (YAZ-3268 D16): the Trash entry back to its old place, which must be in a
  // vault of the calling window and never a vault itself. An ADD, and an add needs no store repair
  // (the delete removed the stored paths already) and no push: the watcher's `add`/`addDir` echo puts
  // it back in the tree, as for a copy. The index takes it at once (`indexMoved`, as a move does), so
  // a quick ⌘Z or ⌘⇧Z after it, and its links, read the item where it is.
  handleWithEvent(CONTRACT.file.putBack, async (e, req: unknown) => {
    const to = requireAbsPath(requireRequest(req).path, 'path')
    const home = rootOfPath(rootsOfSender(e), to)
    if (home === null || home === to) throw new BridgeFailure('BAD_REQUEST', 'no vault of this window holds that path', { path: to })
    const trashed = requireAbsPath(requireRequest(req).trashed, 'trashed')
    const res = await putBack(req)
    await indexMoved(trashed, res.path, res.kind)
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
    await repairFocus(focus.renamePath(rootsOf(store.get()), res.oldPath, res.newPath))
    await repairIcons(icons.renamePath(rootsOf(store.get()), res.oldPath, res.newPath))
    await repairShares(shareFsHooks.renamed(rootsOf(store.get()), res.oldPath, res.newPath))
    broadcastAll(CONTRACT.file.onRenamed.channel, { oldPath: res.oldPath, newPath: res.newPath, kind: res.kind })
    return res
  })
  // File clipboard (YAZ-1674, D1): the ONE app-wide clipboard lives in main (`fileClip`), so a
  // paste in any window takes what any window cut or copied — within a vault or across two.
  // Every change is pushed to EVERY window as `clip:changed` (the github status posture):
  // that is how a menu on vault B learns "Paste 3 items" after a cut on vault A.
  // Subscribed once for the process's life — `registerFsIpc` runs once, so there is nothing to unsubscribe.
  fileClip.onChange((state) => broadcastAll(CONTRACT.file.onClipChanged.channel, state))
  /** The paths the app last put on the system clipboard: still there, they are the app's own, never Finder's. */
  let wrote: readonly string[] = []
  const sameFiles = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((p) => b.includes(p))
  const sameOrder = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((p, i) => p === b[i])
  /** `fs:paste`'s `expect` (YAZ-3266): the verb and the paths the window confirmed. Required: a paste names the clip it is for. */
  const requireExpect = (v: unknown): { op: 'copy' | 'cut'; paths: string[] } => {
    const raw = typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null
    if (raw === null || (raw.op !== 'copy' && raw.op !== 'cut')) throw new BridgeFailure('BAD_REQUEST', "'expect' must be { op: 'copy' | 'cut', paths }")
    return { op: raw.op, paths: requireStringArray(raw.paths, 'expect.paths') }
  }
  // Cut / Copy is a pure clipboard write: nothing on disk is touched or even stat'ed, so there
  // is no store repair and no file push here — a path that goes stale before the paste is
  // reported per entry BY the paste. No vault-root guard either: Cut/Copy is offered on ROWS
  // only, never on blank space, and a window's own root is never a row of its tree (D5/D6; see CONTRACTS).
  // The app's Cut / Copy also goes on the macOS system clipboard (YAZ-3265 D13), so Finder's Paste
  // takes a copy of it. Finder cannot take a cut from another app: the cut still waits for an in-app paste.
  handle(CONTRACT.file.clip, async (req: unknown) => {
    fileClip.set(req)
    const set = fileClip.get()
    if (set !== null) {
      writeOsFiles(set.paths)
      wrote = set.paths
    }
  })
  /**
   * The clip a Paste takes NOW (YAZ-3265 D13): the newer of the app's own and the system clipboard's.
   * No files there (text copied since), or the files the app put there (they equal its clip, or a cut
   * that pasted already) → the app's clip, as before this issue. Other files, copied in Finder since →
   * those, as a COPY (D14). A hidden item is left out with no notice (the tree's rule, S20, S52).
   */
  const clipNow = (): { clip: FileClip; finder: boolean } | null => {
    const own = fileClip.get()
    const os = readOsFiles()
      .map((p) => path.resolve(p))
      .filter((p) => !isSkipped(path.basename(p)))
    if (os.length === 0 || sameFiles(os, wrote) || (own !== null && sameFiles(os, own.paths))) return own === null ? null : { clip: own, finder: false }
    return { clip: { op: 'copy', paths: [...new Set(os)] }, finder: true }
  }
  // A window opened AFTER a clip missed the push: it reads the current state once on mount,
  // then `clip:changed` carries the rest (the same catch-up read `github.status` offers). It reads
  // again on focus (YAZ-3265 D13): back from Finder, "Paste N items" counts Finder's files.
  handle(CONTRACT.file.clipState, async () => {
    const now = clipNow()
    return now === null ? null : { count: now.clip.paths.length, op: now.clip.op, paths: now.clip.paths }
  })
  // Paste (D2–D4) of the clip `clipNow` picks. Per entry, in clipboard order, and one bad entry never stops the rest:
  //  - a COPY is `copyEntry` (a note or a folder under its own built name, YAZ-2420 🔒 D21; any
  //    other file, and every entry where the target's vault does not use IDs (YAZ-2523 🔒 V3),
  //    `fs.cp` under Finder's next free name, D3/D4) with deliberately NO
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
  // Finder's files (`clipNow`, YAZ-3265 D14) paste as a COPY under their OWN names, a clash under
  // the next free one (`importCopy`, never `copyEntry`, which builds a note's name); a folder comes
  // with its contents. The originals stay in Finder, and the app's own clip is not touched.
  // The paste runs only the clip the window confirmed (`expect`, YAZ-3266): the system clipboard can change under the
  // window with no event (text copied in a note), so the window reads `clipState` fresh at paste time and sends that
  // answer. Another clip now — or none — pastes nothing and fails `CONFLICT`: the window's D21 sheet, D20 and undo
  // record were decided for the clip it confirmed, never for whatever is current.
  // The target must be a folder in a vault of the CALLING window, as `fs:import` and `fs:drag-out` check
  // theirs (the YAZ-3248 rulings): a door never writes where its window has no vault.
  handleWithEvent(CONTRACT.file.paste, async (e, req: unknown) => {
    const { targetDir, expect: confirmed } = requireRequest(req)
    const dir = requireAbsPath(targetDir, 'targetDir')
    if (rootOfPath(rootsOfSender(e), dir) === null) throw new BridgeFailure('BAD_REQUEST', 'no vault of this window holds that folder', { path: dir })
    const expected = requireExpect(confirmed)
    const now = clipNow()
    if (now === null || now.clip.op !== expected.op || !sameOrder(now.clip.paths, expected.paths)) throw new BridgeFailure('CONFLICT', CLIP_CHANGED)
    if (now.finder) return pasteEntries(now.clip, req, { copy: (from, toDir) => importCopy(from, toDir, { freeName: true }), move: moveEntry })
    const { clip } = now
    const ids = await doorFor(e, req, 'targetDir')
    const res = await pasteEntries(clip, req, { copy: (from, toDir) => copyEntry(from, toDir, ids), move: moveEntry })
    if (clip.op === 'cut' && res.pasted.length > 0) {
      fileClip.clear()
      // The cut is spent: its old paths leave the system clipboard too, unless something was copied there since.
      clearOsFiles(clip.paths)
    }
    return res
  })
  /**
   * A drop from Finder (YAZ-3253 D3, D9A): `pasteEntries` with an explicit list — the app clipboard
   * is never read or written. Per item, in order, and one bad item never stops the rest:
   *  - a hidden item (`isSkipped`: the tree's own rule) is left out with no row (S20);
   *  - an item inside another vault the app has open, in any window, fails "To move between
   *    vaults, use cut and paste" (S22; YAZ-2602 R11). One of the target's own vault is not
   *    refused here: the sidebar sends those through App's door, so links follow (S23);
   *  - a folder that holds a vault open in any window fails: one vault cannot be inside another;
   *  - the rest run as a CUT through `moveEntry` (S17, S24). An item that fails `EXDEV` (another
   *    disk) runs again as a COPY under its own name (`importCopy`), as Finder copies (S18).
   *    Only `EXDEV`: a copy after any other failure would leave a second copy nobody asked for.
   * The target must be a folder in a vault of the calling window.
   */
  handleWithEvent(CONTRACT.file.import, async (e, req: unknown): Promise<ImportResponse> => {
    const { paths, targetDir } = requireRequest(req)
    const dir = requireAbsPath(targetDir, 'targetDir')
    const home = rootOfPath(rootsOfSender(e), dir)
    if (home === null) throw new BridgeFailure('BAD_REQUEST', 'no vault of this window holds that folder', { path: dir })
    const items = requireStringArray(paths, 'paths')
      .map((p) => requireAbsPath(p, 'paths'))
      .filter((p) => !isSkipped(path.basename(p)))
    const open = rootsOf(store.get())
    const refused: ImportResponse['failed'] = []
    const free = items.filter((p) => {
      const owner = rootOfPath(open, p)
      // A folder that holds an open vault never moves in: one vault cannot be inside another (FEATURES).
      if (owner === null && open.some((root) => root.startsWith(`${p}${path.sep}`))) refused.push({ from: p, code: 'BAD_REQUEST', message: 'it holds a vault that is open' })
      else if (owner !== null && owner !== home) refused.push({ from: p, code: 'BAD_REQUEST', message: BETWEEN_VAULTS })
      else return true
      return false
    })
    const otherDisk: string[] = []
    const ops: PasteOps = {
      copy: importCopy,
      move: async (from, to) => {
        try {
          return await moveEntry(from, to)
        } catch (err) {
          if (isCrossDevice(err)) otherDisk.push(from)
          throw err
        }
      },
    }
    const cut = await pasteEntries({ op: 'cut', paths: free }, { targetDir: dir }, ops)
    const copy = otherDisk.length === 0 ? { pasted: [], failed: [] } : await pasteEntries({ op: 'copy', paths: otherDisk }, { targetDir: dir }, ops)
    const failed = [...refused, ...cut.failed.filter((f) => !otherDisk.includes(f.from)), ...copy.failed]
    return { moved: cut.pasted, copied: copy.pasted, failed: failed.sort((a, b) => items.indexOf(a.from) - items.indexOf(b.from)) }
  })
  /**
   * Rows dragged out to Finder (YAZ-3254 D4): every path absolute, there on disk, and inside a vault
   * of the CALLING window, never a vault itself; the pill (D6) a PNG data URL under 64 KB. Then the
   * OS drag, and Finder takes copies (the Finder test on YAZ-3248). The pill is drawn at the screen's
   * pixel ratio, so it is read at the scale of the display under the pointer, where the drag begins.
   * In the hidden e2e mode (`YASEEN_DOCS_E2E_HIDDEN`, YAZ-3028) the OS drag would take the real mouse
   * of the person at the Mac: the paths go on `globalThis.e2eDragOuts` for the e2e to read instead.
   * After the OS drag main watches the mouse button (YAZ-3294 D24, `../dragWatch`): at the release
   * the calling window hears `file:drag-ended` with the drag's paths, so its box asks at once.
   */
  handleWithEvent(CONTRACT.file.dragOut, async (e, req: unknown) => {
    const { paths, icon } = requireRequest(req)
    const files = requireStringArray(paths, 'paths').map((p) => requireAbsPath(p, 'paths'))
    if (files.length === 0) throw new BridgeFailure('BAD_REQUEST', 'nothing to drag')
    const roots = rootsOfSender(e)
    for (const file of files) {
      if (roots.includes(file) || rootOfPath(roots, file) === null) throw new BridgeFailure('BAD_REQUEST', 'no vault of this window holds that path', { path: file })
    }
    const PNG = 'data:image/png;base64,'
    if (typeof icon !== 'string' || !icon.startsWith(PNG) || icon.length >= 64 * 1024) throw new BridgeFailure('BAD_REQUEST', "'icon' must be a PNG data URL under 64 KB")
    for (const file of files) await fsCall(file, () => stat(file))
    // A drop of these paths in another window of the app tells this one (YAZ-3263): `fs:dropped-here`.
    rememberDragOut(e.sender, files)
    if (process.env.YASEEN_DOCS_E2E_HIDDEN === '1') {
      const e2e = globalThis as { e2eDragOuts?: string[][] }
      ;(e2e.e2eDragOuts ??= []).push(files)
      return
    }
    const { scaleFactor } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    e.sender.startDrag({ file: files[0], files, icon: nativeImage.createFromBuffer(Buffer.from(icon.slice(PNG.length), 'base64'), { scaleFactor }) })
    const sender = e.sender
    whenMouseUp(() => {
      if (!sender.isDestroyed()) sender.send(CONTRACT.file.onDragEnded.channel, { paths: files })
    })
  })
  /**
   * Files dropped anywhere in the calling window (YAZ-3263), reported when the drop fires: when they
   * are the last drag out of ANOTHER window, that window hears `file:drag-landed` and asks nothing.
   */
  handleWithEvent(CONTRACT.file.droppedHere, async (e, req: unknown) => {
    const { paths } = requireRequest(req)
    dropLanded(e.sender, requireStringArray(paths, 'paths').map((p) => requireAbsPath(p, 'paths')))
  })
}
