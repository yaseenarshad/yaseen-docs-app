/**
 * A BOARD'S HOVER PICTURE (Draw's YAZ-1800, ported by YAZ-3028 D11): the whole drawing, drawn in the renderer the first time the
 * mouse rests on its sidebar row and kept IN MEMORY only — nothing is written to the vault, and
 * userData holds only main's preview-sized copies of the images (🔒 YAZ-2073 D6), never a board's
 * picture. The key carries the board's mtime, the applied theme and the dark-mode colour setting
 * (🔒 YAZ-1802 D16), so any write, a theme flip or a setting change is simply a new key; the old
 * picture ages out of the bounded cache.
 *
 * An EMPTY board answers `''` — a settled answer, not a failure — so the panel can say "Empty
 * board" instead of "Preview unavailable". A board that cannot be read or drawn is the cache's
 * `null`.
 */
import { isDiagram } from '@shared/fileKind'
import { api } from '../api'
import { renderDiagramPreview } from '../diagrams/renderDiagram'
import { createScenePreviewPng, visibleElements, type PreviewBounds } from '../lib/scenePreview'
import { parseSceneText } from '../drawings/drawingScene'
import { loadExcalidraw } from '../drawings/engine'
import { createPreviewCache } from '../lib/previewCache'
import { parseKey } from './boardPreviewKey'

export { boardPreviewKey } from './boardPreviewKey'

/** Bigger than a component tile: the panel is most of the window, and a retina screen doubles it. */
export const BOARD_PREVIEW_BOUNDS: PreviewBounds = { maxWidth: 1200, maxHeight: 800, padding: 16 }
/** Pictures in a board no bigger than they can appear in its preview, made once in main (🔒 YAZ-2073 D6). */
const IMAGE_MAX_PX = Math.max(BOARD_PREVIEW_BOUNDS.maxWidth, BOARD_PREVIEW_BOUNDS.maxHeight)

/**
 * Read the board, restore it the way the canvas would, and draw it; `''` when nothing is visible.
 * A DIAGRAM goes through its own door and draw.io's own viewer instead (🔒 YAZ-1802 D9): its first
 * page, same bounds, same theme, same `''` for an empty page.
 */
async function drawBoardPreview(key: string): Promise<string> {
  const { root, path, theme, darkColors } = parseKey(key)
  if (isDiagram(path)) return renderDiagramPreview((await api.diagram.load({ root, path })).xml, theme, darkColors, BOARD_PREVIEW_BOUNDS)
  const [res, engine] = await Promise.all([api.drawing.load({ root, path, imageMaxPx: IMAGE_MAX_PX }), loadExcalidraw()])
  const parsed = parseSceneText(res.json)
  const elements = visibleElements(engine.restoreElements(parsed.elements as never, null))
  if (elements.length === 0) return ''
  // The image map exactly as the editor builds it (`DrawingEditor`'s `toDocument`).
  const files: Record<string, unknown> = {}
  const created = Date.now()
  for (const [id, entry] of Object.entries(res.files)) files[id] = { id, mimeType: entry.mimeType, dataURL: entry.dataURL, created }
  // The file's own appState (its background colour) with the APP's theme on top: the panel sits in the app's chrome.
  return createScenePreviewPng(engine, { elements, appState: { ...parsed.appState, theme }, files }, BOARD_PREVIEW_BOUNDS)
}

/** The sidebar's one board-picture cache; 32 settled pictures, least recently seen out first. */
export const boardPreviews = createPreviewCache(drawBoardPreview, { limit: 32 })
