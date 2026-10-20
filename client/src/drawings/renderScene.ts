/**
 * Scene → SVG (YAZ-878): the note preview's one render. The engine itself — its name, its lazy
 * load and its two global pins (the offline font path and the export `source`) — lives in
 * `engine.ts` since YAZ-3028, which this file and the ONE canvas (`ExcalidrawSurface.tsx`) share,
 * so a preview and a canvas always load the same build exactly once.
 *
 * The export utility itself does the validating: a scene whose elements are malformed throws, and
 * every throw here is the preview's broken state.
 */
import type { DrawingScene } from './drawingScene'
import { loadExcalidraw, type ExcalidrawModule } from './engine'

type ExportArgs = Parameters<ExcalidrawModule['exportToSvg']>[0]

/** Renders one scene to a detached `<svg>`; the caller clones it per preview widget. */
export async function renderSceneToSvg(scene: DrawingScene): Promise<SVGSVGElement> {
  const { exportToSvg } = await loadExcalidraw()
  return exportToSvg({
    // The file is user data (`drawingScene.ts` validates only its outline) — exportToSvg's own
    // restore is what decides whether these elements are a scene.
    elements: scene.elements as ExportArgs['elements'],
    appState: scene.appState as ExportArgs['appState'],
    files: scene.files as ExportArgs['files'],
  })
}
