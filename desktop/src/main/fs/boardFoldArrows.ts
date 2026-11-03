/**
 * `board:set-fold-arrows` (YAZ-4277 D5): a drawing's own "Fold arrows" choice, written as `"foldArrows": "hover"` or
 * `"always"` in the board's `yaseendraw` block (`withBoardFoldArrows`); `'app'` removes the key. The rules of the link
 * preview switch (`fs/boardHoverLinks.ts`): one read, one atomic write; a stale `expectedMtime` is `CONFLICT` with the
 * disk mtime and writes nothing; the same state again writes nothing.
 */
import { serializeBoard, withBoardFoldArrows } from '@shared/drawingAssets'
import { FOLD_ARROW_MODES, type BoardReadOnlyResponse, type FoldArrowMode } from '@shared/types'
import { BOARDS, boardTarget } from './boardDocument'
import { readBoundedRegularFile } from './boundedRead'
import { parseScene } from './drawing'
import { atomicWrite, BridgeFailure, fsCall, requireDir } from './fsUtils'

export async function setBoardFoldArrows(req: unknown): Promise<BoardReadOnlyResponse> {
  const { dir, file, body } = boardTarget(req, 'drawing')
  const { value, expectedMtime } = body
  if (value !== 'app' && !(FOLD_ARROW_MODES as readonly unknown[]).includes(value)) {
    throw new BridgeFailure('BAD_REQUEST', "'value' must be 'app', 'hover' or 'always'", { path: file })
  }
  if (typeof expectedMtime !== 'number') throw new BridgeFailure('BAD_REQUEST', "'expectedMtime' must be a number", { path: file })
  await requireDir(dir)
  const snap = await readBoundedRegularFile(file, BOARDS.drawing.max, BOARDS.drawing.tooLarge)
  if (snap.mtime !== expectedMtime) throw new BridgeFailure('CONFLICT', `${BOARDS.drawing.noun} changed on disk since last read`, { path: file, mtime: snap.mtime })
  const text = snap.data.toString('utf8')
  const { scene } = parseScene(text, file, 'IO_ERROR')
  const marked = withBoardFoldArrows(scene, value === 'app' ? null : (value as FoldArrowMode), snap.mtime)
  if (marked === scene) return { path: file, mtime: snap.mtime, size: snap.size }
  const next = serializeBoard(marked)
  if (Buffer.byteLength(next, 'utf8') > BOARDS.drawing.max) throw new BridgeFailure('TOO_LARGE', BOARDS.drawing.tooLarge, { path: file })
  const { mtime, size } = await fsCall(file, () => atomicWrite(file, next))
  return { path: file, mtime, size }
}
