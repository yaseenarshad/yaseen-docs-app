import './drawing.css'

/**
 * A DRAWING IN A PAGE: the box the reader draws for `![[board.excalidraw]]`, with no engine. It holds the
 * file's path (`data-vault-drawing`) and a soft placeholder; `watchDrawings` draws the picture into it when it comes
 * near the screen. YAZ-5533: a plain draw.io file (`![[flow.drawio]]`) gets the same box, and draw.io's own read-only
 * viewer draws it (`diagram/drawDiagram.ts`), in place of the old "Open it on the Mac". A `.drawio.svg` is a picture
 * already: the reader shows it as one (`<img>`).
 */

/** The words of a drawing that the phone does not draw now. */
export const onMacWords = (name: string): string => `Drawing · ${name} · Open it on the Mac`

/** The words of a diagram when draw.io's viewer is not on the phone yet and there is no signal. */
export const firstTimeWords = (name: string): string => `Diagram · ${name} · Diagrams need the internet the first time; then they work offline`

/** Is `path` a plain draw.io diagram (`.drawio`, not a `.drawio.svg` picture)? draw.io's viewer draws it. */
export const isPlainDiagram = (path: string): boolean => /\.drawio$/i.test(path)

/** Is `path` a drawing the phone draws? An Excalidraw drawing or a plain draw.io diagram. */
export const isPhoneDrawing = (path: string): boolean => /\.excalidraw$/i.test(path) || isPlainDiagram(path)

/** Is `path` a draw.io diagram saved as a picture (`.drawio.svg`, `.drawio.png`)? It shows as a picture. */
export const isDiagramPicture = (path: string): boolean => /\.drawio\.(svg|png)$/i.test(path)

/** The box for drawing `path` (`name`: its file name); null when the phone does not draw this kind. */
export function drawingBox(path: string | null, name: string): HTMLElement | null {
  if (path === null && isPhoneDrawing(name)) {
    // A drawing the vault does not have: the reader's "Missing …" line.
    const missing = document.createElement('span')
    missing.className = 'page-media page-media--missing'
    missing.textContent = `Missing ${isPlainDiagram(name) ? 'diagram' : 'drawing'} · ${name}`
    return missing
  }
  if (path === null || !isPhoneDrawing(path)) return null
  const box = document.createElement('figure')
  box.className = 'page-drawing page-drawing--wait'
  box.dataset.vaultDrawing = path
  box.setAttribute('role', 'img')
  const kind = isPlainDiagram(path) ? 'Diagram' : 'Drawing'
  box.setAttribute('aria-label', `${kind} · ${name}`)
  const wait = document.createElement('span')
  wait.className = 'page-drawing__wait'
  wait.textContent = `${kind} · ${name}`
  box.append(wait)
  return box
}
