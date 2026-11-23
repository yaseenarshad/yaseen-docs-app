/**
 * `board:set-fold-arrows` (YAZ-4277 D5, D18, D19): a drawing's own "Fold arrows" choice, written as
 * `"foldArrows": "hover"`, `"always"` or `"off"` in the board's `yaseendraw` block (`withBoardFoldArrows`); `'app'`
 * removes the key. The rules of the link
 * preview switch (`fs/boardHoverLinks.ts`): one read, one atomic write; a stale `expectedMtime` is `CONFLICT` with the
 * disk mtime and writes nothing; the same state again writes nothing.
 */
import { serializeBoard, withBoardFoldArrows } from '@shared/drawingAssets'
import { FOLD_ARROW_MODES, type BoardReadOnlyResponse, type FoldArrowMode } from '@shared/types'
import { boardTarget, mutateBoardFile } from './boardDocument'
import { parseScene } from './drawing'
import { BridgeFailure } from './fsUtils'

export async function setBoardFoldArrows(req: unknown): Promise<BoardReadOnlyResponse> {
  const { dir, file, body } = boardTarget(req, 'drawing')
  const { value, expectedMtime } = body
  if (value !== 'app' && !(FOLD_ARROW_MODES as readonly unknown[]).includes(value)) {
    throw new BridgeFailure('BAD_REQUEST', "'value' must be 'app', 'hover', 'always' or 'off'", { path: file })
  }
  return mutateBoardFile(dir, file, 'drawing', expectedMtime, (text, mtime) => {
    const { scene } = parseScene(text, file, 'IO_ERROR')
    const marked = withBoardFoldArrows(scene, value === 'app' ? null : (value as FoldArrowMode), mtime)
    return marked === scene ? text : serializeBoard(marked)
  })
}
