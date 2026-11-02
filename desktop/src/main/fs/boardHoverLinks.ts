/**
 * `board:set-hover-links` (YAZ-3943 demo 2): a drawing's own "Link preview on hover" switch, written as
 * `"hoverLinks": false` in the board's `yaseendraw` block (`withHoverLinks`), so it moves with the file like
 * the read-only switch (`fs/boardReadOnly.ts`, whose rules this copies): one read, one atomic write; a stale
 * `expectedMtime` is `CONFLICT` with the disk mtime and writes nothing; the same state again writes nothing.
 */
import { serializeBoard, withHoverLinks } from '@shared/drawingAssets'
import type { BoardReadOnlyResponse } from '@shared/types'
import { BOARDS, boardTarget } from './boardDocument'
import { readBoundedRegularFile } from './boundedRead'
import { parseScene } from './drawing'
import { atomicWrite, BridgeFailure, fsCall, requireDir } from './fsUtils'

export async function setBoardHoverLinks(req: unknown): Promise<BoardReadOnlyResponse> {
  const { dir, file, body } = boardTarget(req, 'drawing')
  const { on, expectedMtime } = body
  if (typeof on !== 'boolean') throw new BridgeFailure('BAD_REQUEST', "'on' must be a boolean", { path: file })
  if (typeof expectedMtime !== 'number') throw new BridgeFailure('BAD_REQUEST', "'expectedMtime' must be a number", { path: file })
  await requireDir(dir)
  const snap = await readBoundedRegularFile(file, BOARDS.drawing.max, BOARDS.drawing.tooLarge)
  if (snap.mtime !== expectedMtime) throw new BridgeFailure('CONFLICT', `${BOARDS.drawing.noun} changed on disk since last read`, { path: file, mtime: snap.mtime })
  const text = snap.data.toString('utf8')
  const { scene } = parseScene(text, file, 'IO_ERROR')
  const marked = withHoverLinks(scene, on, snap.mtime)
  if (marked === scene) return { path: file, mtime: snap.mtime, size: snap.size }
  const next = serializeBoard(marked)
  if (Buffer.byteLength(next, 'utf8') > BOARDS.drawing.max) throw new BridgeFailure('TOO_LARGE', BOARDS.drawing.tooLarge, { path: file })
  const { mtime, size } = await fsCall(file, () => atomicWrite(file, next))
  return { path: file, mtime, size }
}
