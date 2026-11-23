import type { OutsideChangeGlow } from '@shared/types'
import type { Autosave } from '../lib/autosave'
import { parseSceneText, type DrawingScene } from './drawingScene'
import type { DrawingSurfaceApi } from './ExcalidrawSurface'
import type { SceneSide } from './mergeScene'

/** The shapes and the board settings alone: a merge's base never holds a file's pictures. */
export const sideOf = ({ elements, appState }: DrawingScene): SceneSide => ({ elements, appState })

/**
 * 'merged': the canvas holds the file (and any unsaved edits). 'conflict': nothing changed, and the bar shows.
 * 'reload': nothing is unsaved, but the file changed what only a reload brings in — its read-only switch, or a merge the
 * canvas refused — so the caller loads it as Reload does.
 */
export type TakeAnswer = 'merged' | 'conflict' | 'reload'

/**
 * EVERY OUTSIDE SAVE OF AN OPEN DRAWING (YAZ-4279 D1, D3, D6), for the tab and the note's popup alike (4A-11). The file is
 * MERGED into the canvas, with unsaved edits or none, so an edit made while the file loads is never dropped (4A-4), and a
 * clean canvas gets the same outlines and text measure as one with edits. It waits for a gesture to end. With nothing
 * unsaved when it lands, the merge is the new clean baseline at the file's mtime (`baselineAt`: the next snapshot is it, not
 * an edit); with edits, `rebase` keeps them pending against that mtime. A read-only switch the file changed is the user's to
 * settle when there are edits.
 */
export async function takeFromDisk(o: {
  surface: DrawingSurfaceApi
  autosave: Autosave<number> | null
  base: SceneSide | string
  disk: { scene: DrawingScene; mtime: number }
  readOnly: boolean
  glow: OutsideChangeGlow
  baselineAt: (mtime: number) => void
}): Promise<TakeAnswer> {
  const { surface, autosave, disk } = o
  if ((disk.scene.readOnly === true) !== o.readOnly) return autosave?.dirty === true ? 'conflict' : 'reload'
  // The canvas went while a gesture ran (a remount, a closed tab): there is nothing to take the file into.
  if (!(await surface.whenIdle())) return 'merged'
  // Read with the merge, after the load and the gesture: an edit made meanwhile counts.
  const dirty = autosave?.dirty === true
  const merged = surface.mergeScene(typeof o.base === 'string' ? parseSceneText(o.base) : o.base, disk.scene, o.glow)
  if ('conflicts' in merged) return dirty ? 'conflict' : 'reload'
  if (dirty) autosave?.rebase(disk.mtime)
  else {
    o.baselineAt(disk.mtime)
    autosave?.reset(merged.version, disk.mtime)
  }
  return 'merged'
}
