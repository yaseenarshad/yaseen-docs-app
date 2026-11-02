/**
 * Writing a drawing back from the note's popup (YAZ-879). One guarded write, and on `CONFLICT` a question, not a second write.
 *
 * THE TAB'S DOOR (YAZ-3943 1A1). The popup saves through `drawing:save`, as a drawing tab does: the
 * small scene (`files: {}`) plus only the pictures main does not have yet (`newFiles`). Main puts the
 * pictures inside the file (D5), applies the 50 MB rule, keeps the `yaseendraw` block and guards the
 * mtime. So a popup and a tab write the same file the same way, and a board past 10 MiB (the asset
 * pipe's cap, `writeAsset`) still saves. A note embed's own sidecar in `assets/drawings/` takes the
 * same door: it is a drawing with its pictures inside, which is what main writes by default.
 *
 * THE FIRST SAVE WINS (YAZ-3028 edge case, YAZ-3044 A4). Since YAZ-3028 the same drawing can be
 * open in a TAB and in this modal. The mtime guard catches the second save, and the second canvas
 * shows the conflict bar — the tab's own `ConflictBar`, with its two words: Reload takes the disk's
 * version, Keep mine overwrites it. Before, the modal refreshed the guard and wrote again in
 * silence, so the modal always won and a tab's save was lost without a question.
 *
 * So a `CONFLICT` becomes a `SaveConflict` (the autosave's own, YAZ-3528) carrying the disk's mtime:
 * the autosave blocks on it, and it is the guard Keep mine writes over. Two scenes still never
 * merge — Keep mine writes the canvas's bytes as they are.
 *
 * The path is the ABSOLUTE one `openDrawing` resolved, never the embed's fuzzy target: `readAsset`
 * roams by basename, a write never does (🔒 YAZ-876).
 */
import type { DrawingNewFile, DrawingSaveResponse } from '@shared/types'
import { api, BridgeRequestError } from '../api'
import { SaveConflict } from '../lib/autosave'

/** YAZ-3943 D5, the 50 MB rule: a save moved the board's pictures out (a tab and the popup say the same). */
export const PICTURES_MOVED_OUT = "This board's pictures moved to the assets folder, because the file passed 50 MB."

export interface SaveDrawingRequest {
  /** Vault root — the re-read's door, and the boundary the write is checked against. */
  root: string
  /** The embed's raw target; only a CONFLICT without a disk mtime re-reads it, for that mtime. */
  target: string
  /** Absolute path from the load (`LoadedDrawing.path`). */
  path: string
  /** The small scene (`DrawingSnapshot.serialize().json`). */
  json: string
  /** The pictures main does not have yet (`unpersistedFiles`). */
  newFiles: DrawingNewFile[]
  /** The mtime the modal loaded at (or the conflict's, for Keep mine); a differing disk mtime is a CONFLICT. */
  expectedMtime: number
}

/** Writes the scene once; resolves main's answer. A stale guard rejects with `SaveConflict`, anything else as it came. */
export async function saveDrawing(req: SaveDrawingRequest): Promise<DrawingSaveResponse> {
  const { root, target, path, json, newFiles, expectedMtime } = req
  try {
    return await api.drawing.save({ root, path, json, newFiles, expectedMtime })
  } catch (err) {
    if (!(err instanceof BridgeRequestError) || err.code !== 'CONFLICT') throw err
    // The main process sends the disk mtime with a CONFLICT; the re-read is only the fallback for it.
    throw new SaveConflict(err.mtime ?? (await api.readAsset(root, target)).mtime)
  }
}

/** What the modal's inline error line says; the bridge's own message when it has one. */
export function saveErrorMessage(err: unknown): string {
  const detail = err instanceof Error && err.message !== '' ? err.message : String(err)
  return `Can't save the drawing: ${detail}`
}
