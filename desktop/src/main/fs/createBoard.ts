/**
 * `fs:create-board` (YAZ-3028 D9): "New Excalidraw drawing" and "New draw.io diagram" in the folder
 * menu. A board is born with its EMPTY content inside it, in ONE durable never-overwrite create —
 * no create-then-write race, and never a zero-byte board, which a tab calls the corrupt case.
 *
 * MAIN PICKS THE CONTENT by the kind of `path` (`EMPTY_SCENE_JSON` or `EMPTY_DIAGRAM_XML`); the
 * renderer sends none, so this door can only ever make an empty board. `fs:create-file` stays
 * Markdown-only (YAZ-1289, D2). The board is born STAMPED (Draw's 🔒 YAZ-1834 D3, YAZ-1802 D7): its
 * two dates, both "now", go first, so no board this app creates ever exists without them. No page
 * ID, in any vault: IDs are for pages only (D9).
 *
 * `createDurable` never writes over anything: an existing name rejects EEXIST, which
 * `toBridgeFailure` maps to ALREADY_EXISTS and the caller answers with the next free name. The
 * parent folder must exist (`NOT_FOUND`), the same as a page's.
 */
import { stat } from 'node:fs/promises'
import type { BoardKind, CreateBoardResponse, NewBoardPictures } from '@shared/types'
import { EMPTY_SCENE_JSON, newBoardScene, stampBoardMeta } from '@shared/drawingAssets'
import { EMPTY_DIAGRAM_XML, stampDiagramMeta } from '@shared/diagramFile'
import { fileKind } from '@shared/fileKind'
import { resolveBoard } from './boardDocument'
import { BridgeFailure, createDurable, fsCall, requireAbsPath } from './fsUtils'
import { requireRequest } from './validate'

/**
 * The bytes a new board of `kind` is born with, stamped with `now`. YAZ-3943 demo 2: a drawing follows
 * Settings › Files & Links › "New boards keep pictures" (`newBoardScene`).
 */
export function emptyBoard(kind: BoardKind, now: number, pictures: NewBoardPictures = 'inside', folder = ''): string {
  const at = { createdAt: now, updatedAt: now }
  if (kind !== 'drawing') return stampDiagramMeta(EMPTY_DIAGRAM_XML, at)
  return newBoardScene(stampBoardMeta(EMPTY_SCENE_JSON, at), pictures, folder, now)
}

export async function createBoard(req: unknown, pictures: NewBoardPictures = 'inside', folder = ''): Promise<CreateBoardResponse> {
  // Crosses IPC from a sandboxed renderer: shape-checked like a request body.
  const body = requireRequest(req)
  const dir = requireAbsPath(body.root, 'root')
  const raw = typeof body.path === 'string' ? body.path : ''
  const kind = fileKind(raw)
  if (kind !== 'drawing' && kind !== 'diagram') throw new BridgeFailure('UNSUPPORTED_EXTENSION', 'only .excalidraw and .drawio files are created as boards', { path: raw })
  const file = resolveBoard(dir, requireAbsPath(raw, 'path'), kind)
  const content = emptyBoard(kind, Date.now(), pictures, folder)
  return fsCall(file, async () => {
    await createDurable(file, content)
    const st = await stat(file)
    return { path: file, mtime: st.mtimeMs, size: st.size }
  })
}
