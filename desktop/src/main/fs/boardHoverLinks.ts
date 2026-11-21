/**
 * `board:set-hover-links` (YAZ-3943 demo 2): a board's own "Link preview on hover" switch, so it moves with the file like
 * the read-only switch (`fs/boardReadOnly.ts`, whose rules this copies): one read, one atomic write; a stale
 * `expectedMtime` is `CONFLICT` with the disk mtime and writes nothing; the same state again writes nothing.
 *  - a drawing: `"hoverLinks": false` in its `yaseendraw` block (`withHoverLinks`);
 *  - a diagram (YAZ-4748 D10): `yaseendraw-hoverlinks="0"` on its root `<mxfile>` (`setDiagramHoverLinksOff`); only
 *    that tag changes, and a file the diagram door would not open is refused with `IO_ERROR`.
 */
import { diagramDocumentError } from '@shared/diagramFile'
import { serializeBoard, withHoverLinks } from '@shared/drawingAssets'
import { setDiagramHoverLinksOff } from '@shared/readOnly'
import type { BoardReadOnlyResponse } from '@shared/types'
import { boardTarget, mutateBoardFile } from './boardDocument'
import { boardKindOf } from './boardReadOnly'
import { parseScene } from './drawing'
import { BridgeFailure } from './fsUtils'

export async function setBoardHoverLinks(req: unknown): Promise<BoardReadOnlyResponse> {
  const kind = boardKindOf(req)
  const { dir, file, body } = boardTarget(req, kind)
  const { on, expectedMtime } = body
  if (typeof on !== 'boolean') throw new BridgeFailure('BAD_REQUEST', "'on' must be a boolean", { path: file })
  return mutateBoardFile(dir, file, kind, expectedMtime, (text, mtime) => {
    if (kind === 'drawing') {
      const { scene } = parseScene(text, file, 'IO_ERROR')
      const marked = withHoverLinks(scene, on, mtime)
      return marked === scene ? text : serializeBoard(marked)
    }
    const problem = diagramDocumentError(text)
    if (problem !== null) throw new BridgeFailure('IO_ERROR', problem, { path: file })
    return setDiagramHoverLinksOff(text, !on)
  })
}
