/**
 * `board:set-hover-outline` (YAZ-4469 demo): a drawing's own "Hover outline" choice, written as `"hoverOutline": true`
 * or `false` in the board's `yaseendraw` block (`withBoardHoverOutline`); `'app'` removes the key. The rules of the fold
 * arrows choice (`fs/boardFoldArrows.ts`): one read, one atomic write; a stale `expectedMtime` is `CONFLICT` with the
 * disk mtime and writes nothing; the same state again writes nothing.
 */
import { serializeBoard, withBoardHoverOutline } from '@shared/drawingAssets'
import type { BoardReadOnlyResponse } from '@shared/types'
import { boardTarget, mutateBoardFile } from './boardDocument'
import { parseScene } from './drawing'
import { BridgeFailure } from './fsUtils'

export async function setBoardHoverOutline(req: unknown): Promise<BoardReadOnlyResponse> {
  const { dir, file, body } = boardTarget(req, 'drawing')
  const { value, expectedMtime } = body
  if (value !== 'app' && typeof value !== 'boolean') {
    throw new BridgeFailure('BAD_REQUEST', "'value' must be 'app', true or false", { path: file })
  }
  return mutateBoardFile(dir, file, 'drawing', expectedMtime, (text, mtime) => {
    const { scene } = parseScene(text, file, 'IO_ERROR')
    const marked = withBoardHoverOutline(scene, value === 'app' ? null : (value as boolean), mtime)
    return marked === scene ? text : serializeBoard(marked)
  })
}
