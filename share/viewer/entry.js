/**
 * THE VIEWER'S SCRIPT (YAZ-1799) for an Excalidraw drawing — a draw.io diagram's is `diagram.js`
 * (🔒 YAZ-1802 D11) — bundled by `tools/buildShareViewer.mjs` into
 * `share/dist/assets/viewer.js` + `viewer.css` — React and the SAME vendored Excalidraw fork the
 * desktop app draws with — and served by the Worker from its own static assets. Nothing is
 * fetched from a third-party CDN at view time: the fonts come from `/assets/fonts/` too.
 */
// First import, so the asset path is set before Excalidraw's modules evaluate (the page may run no inline script).
import './assetPath.js'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { DEFAULT_FOLD_ARROW_PREFS, Excalidraw, exportToBlob, restoreElements, takeFoldsAside } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import { BOARD_META_KEY, boardFoldArrowsOf } from '../../shared/drawingAssets'
import { board, loadBoard, page, safeName, save, wireDownload } from './board.js'

const { allowDownload, name } = board
const PNG_SCALE = 2

async function main() {
  const text = await loadBoard('drawing')
  if (text === null) return
  const scene = JSON.parse(text)
  const live = (scene.elements ?? []).filter((el) => !el.isDeleted)
  // YAZ-4277 D5, D18: the board's own "Fold arrows", as the app reads it. Off: every folded box opens to all its lines
  // (the engine's fold switch point), here and in the PNG; the `.excalidraw` download is the file, folds and all.
  const foldMode = boardFoldArrowsOf(scene[BOARD_META_KEY])
  const elements = foldMode === 'off' ? takeFoldsAside(restoreElements(live, null)).elements : live
  const foldArrows = foldMode === null ? undefined : { ...DEFAULT_FOLD_ARROW_PREFS, openArrows: foldMode }
  const files = scene.files ?? {}
  const viewBackgroundColor = scene.appState?.viewBackgroundColor ?? '#ffffff'

  if (allowDownload) {
    wireDownload(document.getElementById('dl-excalidraw'), 'excalidraw', 'drawing')
    const pngButton = document.getElementById('dl-png')
    pngButton.disabled = elements.length === 0
    pngButton.title = elements.length === 0 ? 'This drawing is empty' : ''
    pngButton.onclick = async () => {
      pngButton.disabled = true
      try {
        // 2× for real: `exportScale` in appState is ignored by exportToBlob; getDimensions is what sizes the canvas.
        const blob = await exportToBlob({
          elements,
          files,
          mimeType: 'image/png',
          exportPadding: 24,
          appState: { exportBackground: true, viewBackgroundColor, exportWithDarkMode: false },
          getDimensions: (width, height) => ({ width: width * PNG_SCALE, height: height * PNG_SCALE, scale: PNG_SCALE }),
        })
        save(blob, `${safeName}.png`)
      } catch (err) {
        alert(`Could not make a PNG of this drawing: ${err?.message ?? err}`)
      } finally {
        pngButton.disabled = false
      }
    }
  }

  page.remove()
  createRoot(document.getElementById('canvas')).render(
    React.createElement(Excalidraw, {
      initialData: { elements, files, appState: { viewBackgroundColor, theme: 'light' }, scrollToContent: true },
      viewModeEnabled: true,
      zenModeEnabled: false,
      gridModeEnabled: false,
      foldArrows,
      name,
      // Open fitted to the drawing (never past 100%), like the desktop app does.
      onExcalidrawAPI: (api) => fit(api, elements),
      UIOptions: { canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, clearCanvas: false, changeViewBackgroundColor: false, toggleTheme: false }, tools: { image: false } },
    }),
  )
}

let fitted = false
function fit(api, elements) {
  if (fitted || api === null || elements.length === 0) return
  fitted = true
  requestAnimationFrame(() => {
    api.scrollToContent(undefined, { fitToContent: true, animate: false })
    if (api.getAppState().zoom.value > 1) {
      api.updateScene({ appState: { zoom: { value: 1 } } })
      api.scrollToContent(undefined, { animate: false })
    }
  })
}

void main()
