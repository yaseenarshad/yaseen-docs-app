/**
 * The board documents' IPC (YAZ-3028 D2, Draw's 🔒 YAZ-1810 / YAZ-1802 D6): `fs/drawing.ts`,
 * `fs/diagram.ts`, `fs/createBoard.ts` and the read-only switch (`fs/boardReadOnly.ts`, YAZ-3076 D1)
 * behind the standard envelope, and nothing else.
 *
 * NO STORE REPAIR AND NO BROADCAST: repair and the pushes exist for paths that MOVE or GO, and a
 * save does neither — it changes bytes at a path every window already knows. A window with the
 * same board open learns of the change from the shared watcher, like any edit made outside the
 * app, and decides for itself (reload when clean, the conflict bar when dirty). A create is an
 * `add` on the same watcher, as a new note is.
 */
import path from 'node:path'
import { CONTRACT } from '@shared/ipc'
import { createThumbs, THUMBS_DIR, type Thumbs } from '../drawings/thumbs'
import { boardHead } from '../fs/boardHead'
import { setBoardReadOnly } from '../fs/boardReadOnly'
import { createBoard } from '../fs/createBoard'
import { loadDiagram, saveDiagram } from '../fs/diagram'
import { loadDrawing, saveDrawing } from '../fs/drawing'
import { handle } from './envelope'

/**
 * `userData` holds the hover preview's thumbnail cache (YAZ-3028 D11, Draw's 🔒 YAZ-2073 D6):
 * `<userData>/thumbs`, made with the doors (YAZ-3044 A15: `registerIpc` already has the folder).
 * Without it — in tests — a preview gets each image's own bytes.
 */
export function registerBoardIpc(userData?: string): void {
  const thumbs: Thumbs | null = userData === undefined ? null : createThumbs(path.join(userData, THUMBS_DIR))
  handle(CONTRACT.createBoard, createBoard)
  handle(CONTRACT.boardHead, boardHead)
  // Only a request with `imageMaxPx` — a picture of the scene, never an editor — reaches the cache.
  handle(CONTRACT.drawing.load, (req: unknown) => loadDrawing(req, thumbs === null ? undefined : (files, elements, px) => thumbs.fit(files, elements, px)))
  handle(CONTRACT.drawing.save, saveDrawing)
  handle(CONTRACT.diagram.load, loadDiagram)
  handle(CONTRACT.diagram.save, saveDiagram)
  handle(CONTRACT.setBoardReadOnly, setBoardReadOnly)
}
