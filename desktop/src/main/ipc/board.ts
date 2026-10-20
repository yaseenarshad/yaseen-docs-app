/**
 * The board documents' IPC (YAZ-3028 D2, Draw's 🔒 YAZ-1810 / YAZ-1802 D6): `fs/drawing.ts`,
 * `fs/diagram.ts` and `fs/createBoard.ts` behind the standard envelope, and nothing else.
 *
 * NO STORE REPAIR AND NO BROADCAST: repair and the pushes exist for paths that MOVE or GO, and a
 * save does neither — it changes bytes at a path every window already knows. A window with the
 * same board open learns of the change from the shared watcher, like any edit made outside the
 * app, and decides for itself (reload when clean, the conflict bar when dirty). A create is an
 * `add` on the same watcher, as a new note is.
 */
import { CONTRACT } from '@shared/ipc'
import { createBoard } from '../fs/createBoard'
import { loadDiagram, saveDiagram } from '../fs/diagram'
import { loadDrawing, saveDrawing } from '../fs/drawing'
import { handle } from './envelope'

export function registerBoardIpc(): void {
  handle(CONTRACT.createBoard, createBoard)
  handle(CONTRACT.drawing.load, (req: unknown) => loadDrawing(req))
  handle(CONTRACT.drawing.save, saveDrawing)
  handle(CONTRACT.diagram.load, loadDiagram)
  handle(CONTRACT.diagram.save, saveDiagram)
}
