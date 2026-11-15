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
import { BOARDS, boardTarget } from './boardDocument'
import { boardKindOf } from './boardReadOnly'
import { readBoundedRegularFile } from './boundedRead'
import { parseScene } from './drawing'
import { atomicWrite, BridgeFailure, fsCall, requireDir } from './fsUtils'

export async function setBoardHoverLinks(req: unknown): Promise<BoardReadOnlyResponse> {
  const kind = boardKindOf(req)
  const { dir, file, body } = boardTarget(req, kind)
  const { on, expectedMtime } = body
  if (typeof on !== 'boolean') throw new BridgeFailure('BAD_REQUEST', "'on' must be a boolean", { path: file })
  if (typeof expectedMtime !== 'number') throw new BridgeFailure('BAD_REQUEST', "'expectedMtime' must be a number", { path: file })
  await requireDir(dir)
  const snap = await readBoundedRegularFile(file, BOARDS[kind].max, BOARDS[kind].tooLarge)
  if (snap.mtime !== expectedMtime) throw new BridgeFailure('CONFLICT', `${BOARDS[kind].noun} changed on disk since last read`, { path: file, mtime: snap.mtime })
  const text = snap.data.toString('utf8')
  let next: string
  if (kind === 'drawing') {
    const { scene } = parseScene(text, file, 'IO_ERROR')
    const marked = withHoverLinks(scene, on, snap.mtime)
    next = marked === scene ? text : serializeBoard(marked)
  } else {
    const problem = diagramDocumentError(text)
    if (problem !== null) throw new BridgeFailure('IO_ERROR', problem, { path: file })
    next = setDiagramHoverLinksOff(text, !on)
  }
  if (next === text) return { path: file, mtime: snap.mtime, size: snap.size }
  if (Buffer.byteLength(next, 'utf8') > BOARDS[kind].max) throw new BridgeFailure('TOO_LARGE', BOARDS[kind].tooLarge, { path: file })
  const { mtime, size } = await fsCall(file, () => atomicWrite(file, next))
  return { path: file, mtime, size }
}
