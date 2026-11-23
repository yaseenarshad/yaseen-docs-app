/**
 * `board:set-read-only` (YAZ-3076 D1): the human's read-only switch, written IN a drawing or a
 * diagram (`shared/readOnly.ts`), so it moves with the file. A page's switch is a frontmatter key and
 * goes through `transformFile` like any property; a board has no such door, so it gets this one.
 *
 * ONE READ, ONE WRITE (S17). The board doors' bounded read gives the bytes and the mtime in one
 * snapshot; a stale `expectedMtime` is refused with `CONFLICT` and the disk mtime, before anything is
 * written (S13) — the tab flushes its autosave first, so a mismatch is another writer. The same value
 * again writes nothing and answers the mtime unmoved (S11). The write is `atomicWrite` (tmp + fsync +
 * rename): a crash leaves the old file or the new one, never half of either.
 *
 * A drawing is parsed and serialized once (`parseScene`, `serializeBoard`), like a save; a diagram is
 * text, and only its root tag changes. A file the board doors would not open is refused with
 * `IO_ERROR` and left alone: this door never writes over a document the editor could not show.
 */
import { diagramDocumentError } from '@shared/diagramFile'
import { serializeBoard } from '@shared/drawingAssets'
import { fileKind } from '@shared/fileKind'
import { setDiagramReadOnly, withDrawingReadOnly } from '@shared/readOnly'
import type { BoardKind, BoardReadOnlyResponse } from '@shared/types'
import { boardTarget, mutateBoardFile } from './boardDocument'
import { parseScene } from './pictureStore'
import { BridgeFailure } from './fsUtils'
import { requireRequest } from './validate'

/** The kind by the request path's extension (`fileKind`, as `createBoard` reads it); any other file has no switch of the board doors. */
export function boardKindOf(raw: unknown): BoardKind {
  const rel = requireRequest(raw).path
  const kind = typeof rel === 'string' ? fileKind(rel) : null
  if (kind === 'drawing' || kind === 'diagram') return kind
  // A missing or empty path is `boardTarget`'s BAD_REQUEST, which comes first.
  if (typeof rel !== 'string' || rel.trim() === '') return 'drawing'
  throw new BridgeFailure('UNSUPPORTED_EXTENSION', 'only .excalidraw and .drawio files have this read-only switch; a page keeps it in its frontmatter', { path: rel })
}

export async function setBoardReadOnly(req: unknown): Promise<BoardReadOnlyResponse> {
  const kind = boardKindOf(req)
  const { dir, file, body } = boardTarget(req, kind)
  const { on, expectedMtime } = body
  if (typeof on !== 'boolean') throw new BridgeFailure('BAD_REQUEST', "'on' must be a boolean", { path: file })
  return mutateBoardFile(dir, file, kind, expectedMtime, (text, mtime) => {
    if (kind === 'drawing') {
      const { scene } = parseScene(text, file, 'IO_ERROR')
      const marked = withDrawingReadOnly(scene, on, mtime)
      return marked === scene ? text : serializeBoard(marked)
    }
    const problem = diagramDocumentError(text)
    if (problem !== null) throw new BridgeFailure('IO_ERROR', problem, { path: file })
    return setDiagramReadOnly(text, on)
  })
}
