/**
 * The board documents' IPC (YAZ-3028 D2, Draw's 🔒 YAZ-1810 / YAZ-1802 D6): `fs/drawing.ts`,
 * `fs/diagram.ts`, `fs/createBoard.ts`, the read-only switch (`fs/boardReadOnly.ts`, YAZ-3076 D1) and
 * the pictures switch (`fs/boardPictures.ts`, YAZ-3943 D5) behind the standard envelope, and nothing else.
 *
 * NO STORE REPAIR AND NO PUSH: repair and the pushes exist for paths that MOVE or GO, and a
 * save does neither — it changes bytes at a path every window already knows. A save only goes in
 * the save log (YAZ-3235 D1), which reaches the windows with the app state. A window with the
 * same board open learns of the change from the shared watcher, like any edit made outside the
 * app, and decides for itself (reload when clean, the conflict bar when dirty). A create is an
 * `add` on the same watcher, as a new note is.
 */
import path from 'node:path'
import { CONTRACT } from '@shared/ipc'
import { createThumbs, THUMBS_DIR, type Thumbs } from '../drawings/thumbs'
import { boardHead } from '../fs/boardHead'
import { setBoardHoverLinks } from '../fs/boardHoverLinks'
import { setBoardPictures } from '../fs/boardPictures'
import { setBoardReadOnly } from '../fs/boardReadOnly'
import { createBoard } from '../fs/createBoard'
import { loadDiagram, saveDiagram } from '../fs/diagram'
import { loadDrawing, saveDrawing } from '../fs/drawing'
import { indexBoard } from '../vaultIndex'
import type { Store } from '../store'
import type { WindowManager } from '../windows'
import { loggedSave } from './broadcast'
import { handle, handleWithEvent } from './envelope'

/**
 * `userData` holds the hover preview's thumbnail cache (YAZ-3028 D11, Draw's 🔒 YAZ-2073 D6):
 * `<userData>/thumbs`, made with the doors (YAZ-3044 A15: `registerIpc` already has the folder).
 * Without it — in tests — a preview gets each image's own bytes.
 */
export function registerBoardIpc(store: Pick<Store, 'get' | 'addEdit' | 'approvePictureFolder'>, windows: Pick<WindowManager, 'idFor'>, userData?: string, picked: ReadonlySet<string> = new Set()): void {
  const thumbs: Thumbs | null = userData === undefined ? null : createThumbs(path.join(userData, THUMBS_DIR))
  // A new drawing keeps its pictures where Settings › Files & Links says (YAZ-3943 demo 2; its own folder, demo round 3), read at each create.
  handle(CONTRACT.createBoard, (req: unknown) => createBoard(req, store.get().settings.newBoardPictures, store.get().settings.newBoardPicturesFolder))
  handle(CONTRACT.boardHead, boardHead)
  // Only a request with `imageMaxPx` — a picture of the scene, never an editor — reaches the cache.
  handle(CONTRACT.drawing.load, (req: unknown) => loadDrawing(req, thumbs === null ? undefined : (files, elements, px) => thumbs.fit(files, elements, px)))
  // A drawing's and a diagram's save go in the save log, as a note's does (YAZ-3235 D1, S10).
  // A save that gave the board its ID (YAZ-3943 4C) tells the index at once: a `[[` pick right after it writes the ID.
  // A save writes to an outside pictures folder only when the user picked it (YAZ-3943 demo round 3, `approvedPictureFolders`).
  const save = async (req: unknown) => {
    const res = await saveDrawing(req, store.get().approvedPictureFolders)
    if (res.id !== undefined) indexBoard(res.path, res.id)
    return res
  }
  handleWithEvent(CONTRACT.drawing.save, loggedSave(store, windows, save))
  handle(CONTRACT.diagram.load, loadDiagram)
  handleWithEvent(CONTRACT.diagram.save, loggedSave(store, windows, saveDiagram))
  handle(CONTRACT.setBoardReadOnly, setBoardReadOnly)
  // `picked`: the outside folders the cog's folder window picked (`ipc/dialog.ts`). The move is the confirm, so its
  // folder joins the approved list only once the move landed (YAZ-4074 6A item 3).
  handle(CONTRACT.setBoardPictures, async (req: unknown) => {
    const res = await setBoardPictures(req, [...store.get().approvedPictureFolders, ...picked])
    const { folder } = req as { folder?: unknown }
    if (typeof folder === 'string' && picked.has(folder)) store.approvePictureFolder(folder)
    return res
  })
  handle(CONTRACT.setBoardHoverLinks, setBoardHoverLinks)
}
