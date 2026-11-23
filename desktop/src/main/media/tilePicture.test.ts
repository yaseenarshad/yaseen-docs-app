/**
 * A favorite's tile picture (YAZ-4385), with `nativeImage` faked: a PNG or JPEG "decodes" to the size its test bytes
 * name, and a resize answers that size. The real decode is Electron's; this checks the size rule and the type kept.
 */
import { describe, expect, it, vi } from 'vitest'

interface Fake {
  isEmpty(): boolean
  getSize(): { width: number; height: number }
  resize(o: { width?: number; height?: number }): Fake
  toPNG(): Buffer
  toJPEG(q: number): Buffer
}
const fake = (width: number, height: number): Fake => ({
  isEmpty: () => width === 0,
  getSize: () => ({ width, height }),
  resize: ({ width: w, height: h }) => (w !== undefined ? fake(w, Math.round((height * w) / width)) : fake(Math.round((width * h!) / height), h!)),
  toPNG: () => Buffer.from(`png ${width}x${height}`),
  toJPEG: (q) => Buffer.from(`jpeg ${width}x${height} q${q}`),
})
vi.mock('electron', () => ({
  nativeImage: {
    // The test bytes are "<width>x<height>", or anything else for a picture it cannot read.
    createFromBuffer: (bytes: Buffer) => {
      const m = /^(\d+)x(\d+)$/.exec(bytes.toString())
      return m === null ? fake(0, 0) : fake(Number(m[1]), Number(m[2]))
    },
  },
}))

const { tilePicture, TILE_PICTURE_PX } = await import('./tilePicture')
const picture = (mimeType: string, text: string) => ({ mimeType, dataURL: `data:${mimeType};base64,${Buffer.from(text).toString('base64')}` })
const text = (image: { dataURL: string } | null) => (image === null ? null : Buffer.from(image.dataURL.split(',')[1], 'base64').toString())

describe('tilePicture (YAZ-4385)', () => {
  it('a big photo becomes TILE_PICTURE_PX on its longest side, and a JPEG stays a JPEG', () => {
    const tile = tilePicture(picture('image/jpeg', '1280x853'))
    expect(tile?.mimeType).toBe('image/jpeg')
    expect(text(tile)).toBe(`jpeg ${TILE_PICTURE_PX}x171 q85`)
    expect(text(tilePicture(picture('image/png', '600x1200')))).toBe(`png 128x${TILE_PICTURE_PX}`)
  })

  it('a picture that is small already goes as it is; one it cannot read is null', () => {
    const icon = picture('image/png', '100x80')
    expect(tilePicture(icon)).toBe(icon)
    expect(tilePicture(picture('image/webp', 'not a picture'))).toBeNull()
  })
})
