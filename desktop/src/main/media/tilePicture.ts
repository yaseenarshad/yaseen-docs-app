/**
 * A FAVORITE'S TILE PICTURE (YAZ-4385): a favorite's copy is the provider's best picture, up to 20 MB (YAZ-4363), and an
 * add needs all of it. A tile in the Add panel does not: it gets the copy at most `TILE_PICTURE_PX` on its longest side,
 * so the Favorites section does not move whole photos over IPC or decode them on the UI thread.
 *
 * `nativeImage` reads PNG and JPEG. A JPEG stays a JPEG, anything else becomes a PNG (it may have alpha). A picture that
 * is small already is answered as it is. Null when `nativeImage` cannot read it (another type): the caller then uses the
 * provider's own preview. `providers.ts` keeps the answer in the media cache, so a tile is made once, not on each read.
 */
import { nativeImage } from 'electron'
import type { MediaPreviewResponse } from '@shared/types'
import { parseDataUrl } from '@shared/drawingAssets'

/** The longest side of a tile picture: twice a tile of the Add panel's four-column grid, for a Retina screen. */
export const TILE_PICTURE_PX = 256

/** The JPEG quality of a tile: a photo at 256 px is a few dozen KB. */
const TILE_JPEG_QUALITY = 85

export function tilePicture(image: MediaPreviewResponse, px = TILE_PICTURE_PX): MediaPreviewResponse | null {
  const data = parseDataUrl(image.dataURL)
  if (data === null) return null
  const picture = nativeImage.createFromBuffer(Buffer.from(data.base64, 'base64'))
  if (picture.isEmpty()) return null
  const { width, height } = picture.getSize()
  if (Math.max(width, height) <= px) return image
  const small = picture.resize(width >= height ? { width: px, quality: 'good' } : { height: px, quality: 'good' })
  const jpeg = image.mimeType === 'image/jpeg'
  const bytes = jpeg ? small.toJPEG(TILE_JPEG_QUALITY) : small.toPNG()
  const mimeType = jpeg ? 'image/jpeg' : 'image/png'
  return { mimeType, dataURL: `data:${mimeType};base64,${bytes.toString('base64')}` }
}
