/**
 * Scene → SVG (YAZ-878): the ONE place `@excalidraw/excalidraw` is loaded.
 *
 * LAZY BY CONTRACT: the import is a dynamic `import()` fired on the FIRST preview render, so the
 * editor's main chunk never carries the package (it is ~250 transitive packages and megabytes of
 * fonts). A note with no drawing embed loads none of it.
 *
 * OFFLINE BY CONTRACT (🔒 locked): the renderer must NEVER reach a CDN. Excalidraw resolves its
 * font files against `window.EXCALIDRAW_ASSET_PATH` and only falls back to esm.sh when that URL
 * FAILS, so the path is set — to a copy of the package's own asset folder bundled into the app
 * under `app://yaseen/excalidraw-assets/` — BEFORE the module is imported. The copy is made at
 * build time by `desktop/electron.vite.config.ts` (`excalidrawAssets()`), never committed. Fonts
 * are fetched at all only for scenes that contain TEXT; a text-free scene never asks for one.
 *
 * The export utility itself does the validating: a scene whose elements are malformed throws, and
 * every throw here is the preview's broken state.
 */
import type { DrawingScene } from './drawingScene'

/** Bundle-relative home of the package's `fonts/…` tree (see `excalidrawAssets()` in the vite config). */
export const EXCALIDRAW_ASSET_DIR = 'excalidraw-assets/'

declare global {
  interface Window {
    /** Excalidraw's own hook for "where do my fonts live"; unset would mean its esm.sh default. */
    EXCALIDRAW_ASSET_PATH?: string | readonly string[]
  }
}

type Excalidraw = typeof import('@excalidraw/excalidraw')
type ExportArgs = Parameters<Excalidraw['exportToSvg']>[0]

/** The in-flight (then settled) module load; one per renderer, never re-imported. */
let loading: Promise<Excalidraw> | null = null

function excalidraw(): Promise<Excalidraw> {
  if (loading === null) {
    // Before the import, so the font machinery can never see the package's CDN default.
    window.EXCALIDRAW_ASSET_PATH = new URL(EXCALIDRAW_ASSET_DIR, window.location.href).toString()
    loading = import('@excalidraw/excalidraw')
  }
  return loading
}

/** Renders one scene to a detached `<svg>`; the caller clones it per preview widget. */
export async function renderSceneToSvg(scene: DrawingScene): Promise<SVGSVGElement> {
  const { exportToSvg } = await excalidraw()
  return exportToSvg({
    // The file is user data (`drawingScene.ts` validates only its outline) — exportToSvg's own
    // restore is what decides whether these elements are a scene.
    elements: scene.elements as ExportArgs['elements'],
    appState: scene.appState as ExportArgs['appState'],
    files: scene.files as ExportArgs['files'],
  })
}
