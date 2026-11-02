/**
 * `board:set-pictures` (YAZ-3943 D5): the cog's "Move to the assets folder", "Choose a folder…" and "Keep
 * pictures inside" on a drawing, written as `"pictures": "assets"` — and, for a folder of the board's own
 * (YAZ-3943 demo round 3), `"picturesFolder": "<vault-relative>"` — in the board's `yaseendraw` block
 * (`withPicturesOut`), so it moves with the file like the read-only switch (`fs/boardReadOnly.ts`, whose
 * rules this copies).
 *
 *  - OUT lands every picture the board USES in the destination — `folder` when given, else `assets/` — read
 *    from wherever it is now (the file, the old folder, `assets/`: `embedPictures`, then `liftEmbedded` +
 *    `landAssets`, the save's own extraction), then writes the lean file with the flag and the folder. A
 *    switch of folder is therefore a COPY: the old copies stay.
 *  - INSIDE reads the pictures the board uses from its folder or `assets/` (`embedPictures`), writes them
 *    into `files`, and removes the flag and the folder. A board that would be 50 MB or more with them
 *    inside is refused (`TOO_LARGE`): its next save would move them out again (the 50 MB rule).
 *
 * ONE READ, ONE WRITE, like `board:set-read-only`: a stale `expectedMtime` is `CONFLICT` with the disk
 * mtime and writes nothing; the result is one `atomicWrite`. NO WAY DELETES a picture file, in any folder
 * (two boards can share a picture; Docs has no orphan sweep). Moving bytes is not an edit, so the dates
 * stay as they are (the rule of Settings › Storage's shrink, `fs/shrink.ts`). The same state again writes
 * nothing. `folder` crosses IPC from a sandboxed renderer and is checked like a request body; one outside the
 * vault (absolute) must be on `approved` — the folders the user picked in the folder window — or it is refused:
 * only the user's own pick may make the app write outside the vault (`fs/picturesFolders.ts`).
 */
import { BOARD_META_KEY, isValidPicturesFolder, PICTURES_INSIDE_MAX_BYTES, picturesFolderOf, picturesFolderOutside, serializeBoard, stripEmbeddedScene, withPicturesOut } from '@shared/drawingAssets'
import type { BoardPicturesResponse } from '@shared/types'
import { BOARDS, boardTarget } from './boardDocument'
import { readBoundedRegularFile } from './boundedRead'
import { embedPictures, landAssets, liftEmbedded, parseScene } from './drawing'
import { atomicWrite, BridgeFailure, fsCall, requireDir } from './fsUtils'

/** What the refusal of "Keep pictures inside" says. */
export const TOO_BIG_INSIDE = 'The pictures stay in the assets folder: with them inside, the file would pass 50 MB.'
/** What the refusal of an outside folder the user never picked says (demo round 3). */
export const FOLDER_NOT_CHOSEN = 'Choose this folder with "Choose a folder…" first.'

export async function setBoardPictures(req: unknown, approved: readonly string[] = []): Promise<BoardPicturesResponse> {
  const { dir, file, body } = boardTarget(req, 'drawing')
  const { out, folder, expectedMtime } = body
  if (typeof out !== 'boolean') throw new BridgeFailure('BAD_REQUEST', "'out' must be a boolean", { path: file })
  if (folder !== undefined && !isValidPicturesFolder(folder)) throw new BridgeFailure('BAD_REQUEST', "'folder' must be a vault-relative or absolute folder path", { path: file })
  if (folder !== undefined && picturesFolderOutside(folder) && !approved.includes(folder)) throw new BridgeFailure('BAD_REQUEST', FOLDER_NOT_CHOSEN, { path: file })
  if (typeof expectedMtime !== 'number') throw new BridgeFailure('BAD_REQUEST', "'expectedMtime' must be a number", { path: file })
  await requireDir(dir)
  const snap = await readBoundedRegularFile(file, BOARDS.drawing.max, BOARDS.drawing.tooLarge)
  if (snap.mtime !== expectedMtime) throw new BridgeFailure('CONFLICT', `${BOARDS.drawing.noun} changed on disk since last read`, { path: file, mtime: snap.mtime })
  const text = snap.data.toString('utf8')
  const { scene, elements } = parseScene(text, file, 'IO_ERROR')
  // Every picture the board uses, from wherever it is now: the file, the folder it names today, `assets/`.
  const files = await embedPictures(dir, elements, [stripEmbeddedScene(scene).embedded], scene, picturesFolderOf(scene[BOARD_META_KEY]))
  let next: string
  if (out) {
    const { lean } = liftEmbedded(scene, elements)
    next = serializeBoard(withPicturesOut(lean, true, snap.mtime, Date.now(), folder ?? null))
    if (next === text) return { path: file, mtime: snap.mtime, size: snap.size }
    // Assets first, then the file that names them (`drawing.ts`); into the folder the file is about to name.
    await landAssets(dir, liftEmbedded({ ...scene, files }, elements).lifted, folder ?? null)
  } else {
    next = serializeBoard(withPicturesOut({ ...scene, files }, false, snap.mtime))
    if (next === text) return { path: file, mtime: snap.mtime, size: snap.size }
    if (Buffer.byteLength(next, 'utf8') >= PICTURES_INSIDE_MAX_BYTES) throw new BridgeFailure('TOO_LARGE', TOO_BIG_INSIDE, { path: file })
  }
  const { mtime, size } = await fsCall(file, () => atomicWrite(file, next))
  return { path: file, mtime, size }
}
