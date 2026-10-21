import { Buffer } from 'node:buffer'
import { open } from 'node:fs/promises'
import { BOARD_META_HEAD_BYTES, parseBoardMetaBlock, type BoardMetaBlock } from '@shared/drawingAssets'
import { parseDiagramMetaAttrs } from '@shared/diagramFile'
import type { BoardHeadResponse } from '@shared/types'
import { isBoard, isDiagram } from '@shared/fileKind'
import { BridgeFailure, fsCall, requireAbsPath } from './fsUtils'

export interface BoardHead {
  /** The `yaseendraw` block off the file head, extras included, or null when there is none to trust (🔒 YAZ-1834 D7). */
  block: BoardMetaBlock | null
  mtime: number
  size: number
}

/**
 * One open, one bounded read, one `fstat`: what the tree walk and the save door both need to
 * know about a board without reading it (🔒 YAZ-1834 D3/D6). The block is ~80 bytes and main
 * always writes it first, so `BOARD_META_HEAD_BYTES` is plenty; a longer head is never read.
 * A missing file, or a path that is not a regular file, answers null; any other failure
 * propagates for the caller to classify.
 *
 * A DIAGRAM's dates are the two `yaseendraw-*` attributes on its root `<mxfile>` instead of a
 * JSON block (🔒 YAZ-1802 D7); the same head, the same shape back.
 */
export async function readBoardHead(file: string): Promise<BoardHead | null> {
  let handle
  try {
    handle = await open(file, 'r')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  try {
    const st = await handle.stat()
    if (!st.isFile()) return null
    const buffer = Buffer.allocUnsafe(Math.min(st.size, BOARD_META_HEAD_BYTES))
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    const head = buffer.subarray(0, bytesRead).toString('utf8')
    return { block: isDiagram(file) ? parseDiagramMetaAttrs(head) : parseBoardMetaBlock(head), mtime: st.mtimeMs, size: st.size }
  } finally {
    await handle.close()
  }
}

/**
 * `fs:board-head` (YAZ-3028 D11): the Info popover's one read — what `readBoardHead` knows, as the
 * bridge answers it. A path that is no board is refused, a file that is gone is `NOT_FOUND`.
 */
export async function boardHead(raw: unknown): Promise<BoardHeadResponse> {
  const file = requireAbsPath(raw, 'path')
  if (!isBoard(file)) throw new BridgeFailure('UNSUPPORTED_EXTENSION', 'only .excalidraw and .drawio files have board info', { path: file })
  const head = await fsCall(file, () => readBoardHead(file))
  if (head === null) throw new BridgeFailure('NOT_FOUND', 'no such board', { path: file })
  const meta = head.block === null ? null : { createdAt: head.block.createdAt, updatedAt: head.block.updatedAt }
  return { path: file, mtime: head.mtime, size: head.size, meta }
}
