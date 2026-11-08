import { serializeFile } from './revision'
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
 *  - A move while a picture the board uses is found nowhere is refused (`NOT_FOUND`, YAZ-4074 6A item 2): it would
 *    stay behind in a folder the block stops naming. The cog says so before it asks.
 *
 * ONE READ, ONE WRITE, like `board:set-read-only`: a stale `expectedMtime` is `CONFLICT` with the disk
 * mtime and writes nothing; the result is one `atomicWrite`. NO WAY DELETES a picture file, in any folder
 * (two boards can share a picture; Docs has no orphan sweep). Moving bytes is not an edit, so the dates
 * stay as they are (the rule of Settings › Storage's shrink, `fs/shrink.ts`). The same state again writes
 * nothing. `folder` crosses IPC from a sandboxed renderer and is checked like a request body; one outside the
 * vault (absolute) must be on `approved` — the folders the user picked in the folder window — or it is refused:
 * only the user's own pick may make the app write outside the vault (`fs/picturesFolders.ts`).
 */
import { BOARD_META_KEY, isValidPicturesFolder, PICTURES_INSIDE_MAX_BYTES, picturesFolderOf, picturesMissingRefusal, referencedFileIds, serializeBoard, stripEmbeddedScene, withPicturesOut } from '@shared/drawingAssets'
import type { BoardPicturesResponse } from '@shared/types'
import { BOARDS, boardTarget, checkBoardRevision } from './boardDocument'
import { readBoundedRegularFile } from './boundedRead'
import { embedPictures, landAssets, liftEmbedded, parseScene } from './drawing'
import { atomicWrite, BridgeFailure, fsCall, requireDir } from './fsUtils'
import { landingFolder } from './picturesFolders'

/** What the refusal of "Keep pictures inside" says. */
export const TOO_BIG_INSIDE = 'The pictures stay in the assets folder: with them inside, the file would pass 50 MB.'
/** What the refusal of an outside folder the user never picked says (demo round 3). */
export const FOLDER_NOT_CHOSEN = 'Choose this folder with "Choose a folder…" first.'

export async function setBoardPictures(req: unknown, approved: readonly string[] = []): Promise<BoardPicturesResponse> {
  const { file } = boardTarget(req, 'drawing')
  return serializeFile(file, () => setBoardPicturesUnlocked(req, approved))
}

async function setBoardPicturesUnlocked(req: unknown, approved: readonly string[] = []): Promise<BoardPicturesResponse> {
  const { dir, file, body } = boardTarget(req, 'drawing')
  const { out, folder, expectedMtime } = body
  if (typeof out !== 'boolean') throw new BridgeFailure('BAD_REQUEST', "'out' must be a boolean", { path: file })
  if (folder !== undefined && !isValidPicturesFolder(folder)) throw new BridgeFailure('BAD_REQUEST', "'folder' must be a vault-relative or absolute folder path", { path: file })
  if (typeof expectedMtime !== 'number') throw new BridgeFailure('BAD_REQUEST', "'expectedMtime' must be a number", { path: file })
  await requireDir(dir)
  // An outside folder, or a vault folder whose real place is outside (6A item 4), must be one the user picked.
  if (folder !== undefined && (await landingFolder(dir, folder, approved)) !== folder) throw new BridgeFailure('BAD_REQUEST', FOLDER_NOT_CHOSEN, { path: file })
  const snap = await readBoundedRegularFile(file, BOARDS.drawing.max, BOARDS.drawing.tooLarge)
  checkBoardRevision(body, snap, file)
  if (snap.mtime !== expectedMtime) throw new BridgeFailure('CONFLICT', `${BOARDS.drawing.noun} changed on disk since last read`, { path: file, mtime: snap.mtime })
  const text = snap.data.toString('utf8')
  const { scene, elements } = parseScene(text, file, 'IO_ERROR')
  // Every picture the board uses, from wherever it is now: the file, the folder it names today, `assets/`.
  const files = await embedPictures(dir, elements, [stripEmbeddedScene(scene).embedded], scene, picturesFolderOf(scene[BOARD_META_KEY]))
  const next = out ? serializeBoard(withPicturesOut(liftEmbedded(scene, elements).lean, true, snap.mtime, Date.now(), folder ?? null)) : serializeBoard(withPicturesOut({ ...scene, files }, false, snap.mtime))
  if (next === text) return { path: file, mtime: snap.mtime, size: snap.size }
  // 6A item 2: a used picture found nowhere would stay behind, and the block would stop naming the folder it may come back to.
  const missing = referencedFileIds(elements).size - Object.keys(files).length
  if (missing > 0) throw new BridgeFailure('NOT_FOUND', picturesMissingRefusal(missing), { path: file })
  // Assets first, then the file that names them (`drawing.ts`); into the folder the file is about to name.
  if (out) await landAssets(dir, liftEmbedded({ ...scene, files }, elements).lifted, folder ?? null)
  else if (Buffer.byteLength(next, 'utf8') >= PICTURES_INSIDE_MAX_BYTES) throw new BridgeFailure('TOO_LARGE', TOO_BIG_INSIDE, { path: file })
  const { mtime, size } = await fsCall(file, () => atomicWrite(file, next))
  return { path: file, mtime, size }
}
