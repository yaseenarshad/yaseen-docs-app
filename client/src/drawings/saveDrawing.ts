/**
 * Writing a drawing back (YAZ-879). One guarded write, and on `CONFLICT` a question, not a second write.
 *
 * THE FIRST SAVE WINS (YAZ-3028 edge case, YAZ-3044 A4). Since YAZ-3028 the same drawing can be
 * open in a TAB and in this modal. The mtime guard catches the second save, and the second canvas
 * shows the conflict bar — the tab's own `ConflictBar`, with its two words: Reload takes the disk's
 * version, Keep mine overwrites it. Before, the modal refreshed the guard and wrote again in
 * silence, so the modal always won and a tab's save was lost without a question.
 *
 * So a `CONFLICT` becomes a `DrawingConflict` carrying the disk's mtime: the guard Keep mine
 * writes over. Two scenes still never merge — Keep mine writes the canvas's bytes as they are.
 *
 * The path is the ABSOLUTE one `openDrawing` resolved, never the embed's fuzzy target: `readAsset`
 * roams by basename, `writeAsset` never does (🔒 YAZ-876).
 */
import { api, BridgeRequestError } from '../api'

export interface SaveDrawingRequest {
  /** Vault root — the re-read's door, and the boundary the write is checked against. */
  root: string
  /** The embed's raw target; only a CONFLICT without a disk mtime re-reads it, for that mtime. */
  target: string
  /** Absolute path from the load (`LoadedDrawing.path`). */
  path: string
  /** The serialized scene, exactly as it goes to disk. */
  content: string
  /** The mtime the modal loaded at (or the conflict's, for Keep mine); a differing disk mtime is a CONFLICT. */
  expectedMtime: number
}

/** The drawing changed on disk since the modal read it. `mtime` is the disk's: Keep mine writes over it. */
export class DrawingConflict extends Error {
  constructor(readonly mtime: number) {
    super('The drawing changed on disk.')
    this.name = 'DrawingConflict'
  }
}

/** Writes the scene once; resolves the new mtime. A stale guard rejects with `DrawingConflict`, anything else as it came. */
export async function saveDrawing(req: SaveDrawingRequest): Promise<number> {
  const { root, target, path, content, expectedMtime } = req
  try {
    return (await api.writeAsset({ root, path, content, expectedMtime })).mtime
  } catch (err) {
    if (!(err instanceof BridgeRequestError) || err.code !== 'CONFLICT') throw err
    // The main process sends the disk mtime with a CONFLICT; the re-read is only the fallback for it.
    throw new DrawingConflict(err.mtime ?? (await api.readAsset(root, target)).mtime)
  }
}

/** What the modal's inline error line says; the bridge's own message when it has one. */
export function saveErrorMessage(err: unknown): string {
  const detail = err instanceof Error && err.message !== '' ? err.message : String(err)
  return `Can't save the drawing: ${detail}`
}
