/**
 * `board:set-pictures` (YAZ-3943 D5): the cog's "Move pictures out" and "Keep pictures inside" on a
 * drawing, written as `"pictures": "assets"` in the board's `yaseendraw` block (`withPicturesOut`), so
 * it moves with the file like the read-only switch (`fs/boardReadOnly.ts`, whose rules this copies).
 *
 *  - OUT lands every picture the board carries in `assets/` (`liftEmbedded` + `landAssets`, the
 *    save's own extraction), then writes the lean file with the flag.
 *  - INSIDE reads the pictures the board uses from `assets/` (`embedPictures`), writes them into
 *    `files`, and removes the flag. A board that would be 50 MB or more with them inside is refused
 *    (`TOO_LARGE`): its next save would move them out again (the 50 MB rule).
 *
 * ONE READ, ONE WRITE, like `board:set-read-only`: a stale `expectedMtime` is `CONFLICT` with the disk
 * mtime and writes nothing; the result is one `atomicWrite`. Neither way deletes a file from
 * `assets/` (two boards can share a picture). Moving bytes is not an edit, so the dates stay as they
 * are (the rule of Settings › Storage's shrink, `fs/shrink.ts`). The same state again writes nothing.
 */
import { PICTURES_INSIDE_MAX_BYTES, serializeBoard, stripEmbeddedScene, withPicturesOut } from '@shared/drawingAssets'
import type { BoardPicturesResponse } from '@shared/types'
import { BOARDS, boardTarget } from './boardDocument'
import { readBoundedRegularFile } from './boundedRead'
import { embedPictures, landAssets, liftEmbedded, parseScene } from './drawing'
import { atomicWrite, BridgeFailure, fsCall, requireDir } from './fsUtils'

/** What the refusal of "Keep pictures inside" says. */
export const TOO_BIG_INSIDE = 'The pictures stay in the assets folder: with them inside, the file would pass 50 MB.'

export async function setBoardPictures(req: unknown): Promise<BoardPicturesResponse> {
  const { dir, file, body } = boardTarget(req, 'drawing')
  const { out, expectedMtime } = body
  if (typeof out !== 'boolean') throw new BridgeFailure('BAD_REQUEST', "'out' must be a boolean", { path: file })
  if (typeof expectedMtime !== 'number') throw new BridgeFailure('BAD_REQUEST', "'expectedMtime' must be a number", { path: file })
  await requireDir(dir)
  const snap = await readBoundedRegularFile(file, BOARDS.drawing.max, BOARDS.drawing.tooLarge)
  if (snap.mtime !== expectedMtime) throw new BridgeFailure('CONFLICT', `${BOARDS.drawing.noun} changed on disk since last read`, { path: file, mtime: snap.mtime })
  const text = snap.data.toString('utf8')
  const { scene, elements } = parseScene(text, file, 'IO_ERROR')
  let next: string
  if (out) {
    const { lean, lifted } = liftEmbedded(scene, elements)
    next = serializeBoard(withPicturesOut(lean, true, snap.mtime))
    if (next === text) return { path: file, mtime: snap.mtime, size: snap.size }
    // Assets first, then the file that names them (`drawing.ts`).
    await landAssets(dir, lifted)
  } else {
    const files = await embedPictures(dir, elements, [stripEmbeddedScene(scene).embedded], scene)
    next = serializeBoard(withPicturesOut({ ...scene, files }, false, snap.mtime))
    if (next === text) return { path: file, mtime: snap.mtime, size: snap.size }
    if (Buffer.byteLength(next, 'utf8') >= PICTURES_INSIDE_MAX_BYTES) throw new BridgeFailure('TOO_LARGE', TOO_BIG_INSIDE, { path: file })
  }
  const { mtime, size } = await fsCall(file, () => atomicWrite(file, next))
  return { path: file, mtime, size }
}
