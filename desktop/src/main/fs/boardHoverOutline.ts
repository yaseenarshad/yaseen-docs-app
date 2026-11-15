/**
 * `board:set-hover-outline` (YAZ-4469 demo): a drawing's own "Hover outline" choice, written as `"hoverOutline": true`
 * or `false` in the board's `yaseendraw` block (`withBoardHoverOutline`); `'app'` removes the key. The rules of the fold
 * arrows choice (`fs/boardFoldArrows.ts`): one read, one atomic write; a stale `expectedMtime` is `CONFLICT` with the
 * disk mtime and writes nothing; the same state again writes nothing.
 */
import { serializeBoard, withBoardHoverOutline } from '@shared/drawingAssets'
import type { BoardReadOnlyResponse } from '@shared/types'
import { BOARDS, boardTarget } from './boardDocument'
import { readBoundedRegularFile } from './boundedRead'
import { parseScene } from './drawing'
import { atomicWrite, BridgeFailure, fsCall, requireDir } from './fsUtils'

export async function setBoardHoverOutline(req: unknown): Promise<BoardReadOnlyResponse> {
  const { dir, file, body } = boardTarget(req, 'drawing')
  const { value, expectedMtime } = body
  if (value !== 'app' && typeof value !== 'boolean') {
    throw new BridgeFailure('BAD_REQUEST', "'value' must be 'app', true or false", { path: file })
  }
  if (typeof expectedMtime !== 'number') throw new BridgeFailure('BAD_REQUEST', "'expectedMtime' must be a number", { path: file })
  await requireDir(dir)
  const snap = await readBoundedRegularFile(file, BOARDS.drawing.max, BOARDS.drawing.tooLarge)
  if (snap.mtime !== expectedMtime) throw new BridgeFailure('CONFLICT', `${BOARDS.drawing.noun} changed on disk since last read`, { path: file, mtime: snap.mtime })
  const text = snap.data.toString('utf8')
  const { scene } = parseScene(text, file, 'IO_ERROR')
  const marked = withBoardHoverOutline(scene, value === 'app' ? null : (value as boolean), snap.mtime)
  if (marked === scene) return { path: file, mtime: snap.mtime, size: snap.size }
  const next = serializeBoard(marked)
  if (Buffer.byteLength(next, 'utf8') > BOARDS.drawing.max) throw new BridgeFailure('TOO_LARGE', BOARDS.drawing.tooLarge, { path: file })
  const { mtime, size } = await fsCall(file, () => atomicWrite(file, next))
  return { path: file, mtime, size }
}
