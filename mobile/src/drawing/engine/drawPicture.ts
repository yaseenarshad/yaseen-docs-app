import { exportToSvg, getCommonBounds, restoreElements } from '@excalidraw/excalidraw'
import { drawingSvg, restoreForPicture } from '@client/drawings/drawingPicture'
import { parseSceneText } from '@client/drawings/sceneText'
import { ASSETS_DIR, BOARD_META_KEY, fileIdOfAssetName, mimeForAssetExt, picturesFolderOf, referencedFileIds } from '@shared/drawingAssets'
import { isRecord } from '@shared/guards'
import { inlineFonts } from './fonts'

/**
 * THE DRAWING CHUNK (Yaseen's decision on the issue: "use the same system that we use on the computer"). The
 * ONE module of the phone that names the drawing engine (`@excalidraw/excalidraw`), so the engine is in this chunk and
 * nowhere else: a page with no drawing never loads it (`phoneImportGuard` lets only `mobile/src/drawing/engine/`
 * import it; `drawingWall.test.ts` proves it in the build).
 *
 * A drawing's picture is the Mac's embed picture (`boardPictures.ts` through `drawingPicture.ts`): the file's scene
 * restored as the sidebar's hover picture does it, then the engine's `exportToSvg` with the embed's padding, background
 * and dark mode. Pictures inside the drawing come from the vault's `assets/` (or the board's own folder) as on the Mac
 * (`resolveFiles` in `desktop/src/main/fs/drawing.ts`): the store first, the file's own copy after. The fonts are the
 * phone's (`fonts.ts`). Nothing is saved anywhere: the caller gets the SVG text and keeps it in memory only.
 */

// The engine falls back to a CDN for a font it cannot find at this path. The phone asks it for no font at all
// (`skipInliningFonts`), and this keeps any other font look-up on the app's own site.
;(window as { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = new URL('/', window.location.href).toString()

const ENGINE = { exportToSvg, getCommonBounds, restoreElements }

/** A picture inside the drawing, as the engine takes it. */
export interface PictureFile {
  mimeType: string
  dataURL: string
}

export interface DrawInput {
  /** The `.excalidraw` file's text. */
  text: string
  theme: 'light' | 'dark'
  /** Every file of the vault: where a picture inside the drawing is found (`picturePath`). */
  files: readonly string[]
  /** A vault file's bytes: the store first, then GitHub (`useDrawings`'s `storeFirst`). */
  read(path: string): Promise<{ bytes: Uint8Array } | { why: string }>
}

const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1)
const dirOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')))

/** The vault path of picture `id` of a drawing: in the board's own `folder` first, then `assets/` (the Mac's `storesOf`). */
export function picturePath(files: readonly string[], id: string, folder: string | null): string | null {
  for (const dir of folder === null ? [ASSETS_DIR] : [folder, ASSETS_DIR]) {
    const found = files.find((f) => dirOf(f) === dir && fileIdOfAssetName(nameOf(f)) === id && mimeForAssetExt(f.slice(f.lastIndexOf('.') + 1)) !== null)
    if (found !== undefined) return found
  }
  return null
}

function dataUrl(bytes: Uint8Array, mimeType: string): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `data:${mimeType};base64,${btoa(binary)}`
}

/** Picture `id`'s bytes as the engine takes them, or null. */
async function pictureOf(input: DrawInput, id: string, folder: string | null): Promise<PictureFile | null> {
  const path = picturePath(input.files, id, folder)
  const mimeType = path === null ? null : mimeForAssetExt(path.slice(path.lastIndexOf('.') + 1))
  if (path === null || mimeType === null) return null
  const got = await input.read(path)
  return 'bytes' in got ? { mimeType, dataURL: dataUrl(got.bytes, mimeType) } : null
}

export type Drawn = { svg: string; width: number; height: number; ms: number } | 'empty'

/** Draws the drawing; throws when the file is not a drawing (the caller's calm line). */
export async function drawPicture(input: DrawInput): Promise<Drawn> {
  const scene = parseSceneText(input.text)
  // The board's own pictures folder, from its `yaseendraw` block (a valid scene is an object: `parseSceneText` said so).
  const folder = picturesFolderOf((JSON.parse(input.text) as Record<string, unknown>)[BOARD_META_KEY])
  const elements = restoreForPicture(ENGINE, scene.elements)
  if (elements.length === 0) return 'empty'
  const embedded = scene.files ?? {}
  const files: Record<string, unknown> = {}
  const created = Date.now()
  for (const id of referencedFileIds(elements)) {
    // An outside folder (an absolute path on the Mac) is not in the vault: `assets/` only.
    const stored = await pictureOf(input, id, folder !== null && !folder.startsWith('/') ? folder : null)
    const own = embedded[id]
    if (stored !== null) files[id] = { id, mimeType: stored.mimeType, dataURL: stored.dataURL, created }
    else if (isRecord(own) && typeof own.dataURL === 'string') files[id] = own
  }
  const start = performance.now()
  const { svgEl } = await drawingSvg(ENGINE, { elements, appState: scene.appState, files }, input.theme, { skipInliningFonts: true })
  const ms = performance.now() - start
  await inlineFonts(svgEl)
  const [, , width, height] = (svgEl.getAttribute('viewBox') ?? '0 0 0 0').split(/\s+/).map(Number)
  return { svg: new XMLSerializer().serializeToString(svgEl), width, height, ms }
}
