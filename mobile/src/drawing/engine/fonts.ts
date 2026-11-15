import { facesFor, fontFaceCss, textUse } from '../fontFaces'
import { FONT_FILES } from './fontFiles'

/**
 * The engine's font files as chunks of this app (YAZ-5440): each file is a small chunk of its own whose one value is
 * the file as a `data:` URL, loaded only when a picture's text needs it. A chunk is a script of this site
 * (`script-src 'self'`), so no font is fetched and no other host is asked; the service worker keeps them as it keeps
 * every chunk. The CJK fallback is not here (`fontFiles.ts`).
 */
const FILES = import.meta.glob<string>(['../../../../engine/packages/excalidraw/fonts/*/*.woff2', '!**/Xiaolai/**'], { query: '?inline', import: 'default' })
const PREFIX = '../../../../engine/packages/excalidraw/fonts/'

/** Puts the fonts that `svg`'s text draws with into its `<style class="style-fonts">` (the engine's own place). */
export async function inlineFonts(svg: SVGSVGElement): Promise<void> {
  const faces = facesFor(textUse(svg), FONT_FILES)
  if (faces.length === 0) return
  const rules = await Promise.all(
    faces.map(async (face) => {
      const load = FILES[`${PREFIX}${face.file}`]
      return load === undefined ? '' : fontFaceCss(face, await load())
    }),
  )
  let style = svg.querySelector('style.style-fonts')
  if (style === null) {
    style = svg.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'style')
    style.classList.add('style-fonts')
    let defs = svg.querySelector('defs')
    if (defs === null) svg.prepend((defs = svg.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'defs')))
    defs.append(style)
  }
  style.textContent = rules.filter((r) => r !== '').join('\n      ')
}
