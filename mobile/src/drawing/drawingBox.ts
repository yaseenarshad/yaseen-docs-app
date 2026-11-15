import './drawing.css'

/**
 * A DRAWING IN A PAGE (YAZ-5440): the box the reader draws for `![[board.excalidraw]]`, with no engine. It holds the
 * file's path (`data-vault-drawing`) and a soft placeholder; `watchDrawings` draws the picture into it when it comes
 * near the screen. A plain draw.io file (`.drawio`) keeps the line "Open it on the Mac": the Mac draws it with draw.io's
 * own viewer, a whole web app (tens of MB) that runs in a frame on its own origin, which the phone's CSP does not allow
 * and its size does not fit. A `.drawio.svg` is a picture already: the reader shows it as one (`<img>`).
 */

/** The words of a drawing that the phone does not draw now. */
export const onMacWords = (name: string): string => `Drawing · ${name} · Open it on the Mac`

/** Is `path` an Excalidraw drawing the phone draws? The Mac's one drawing kind (`DRAWING_VIEW_EXTENSIONS`). */
export const isPhoneDrawing = (path: string): boolean => /\.excalidraw$/i.test(path)

/** Is `path` a draw.io diagram saved as a picture (`.drawio.svg`, `.drawio.png`)? It shows as a picture. */
export const isDiagramPicture = (path: string): boolean => /\.drawio\.(svg|png)$/i.test(path)

/** The box for drawing `path` (`name`: its file name); null when the phone does not draw this kind. */
export function drawingBox(path: string | null, name: string): HTMLElement | null {
  if (path === null && isPhoneDrawing(name)) {
    // A drawing the vault does not have: the reader's "Missing …" line.
    const missing = document.createElement('span')
    missing.className = 'page-media page-media--missing'
    missing.textContent = `Missing drawing · ${name}`
    return missing
  }
  if (path === null || !isPhoneDrawing(path)) return null
  const box = document.createElement('figure')
  box.className = 'page-drawing page-drawing--wait'
  box.dataset.vaultDrawing = path
  box.setAttribute('role', 'img')
  box.setAttribute('aria-label', `Drawing · ${name}`)
  const wait = document.createElement('span')
  wait.className = 'page-drawing__wait'
  wait.textContent = `Drawing · ${name}`
  box.append(wait)
  return box
}
