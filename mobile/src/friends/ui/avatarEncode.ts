/**
 * Client-side avatar encoder (YAZ-6300): center-crops an image Blob to 256×256 square
 * on an offscreen `<canvas>`, encodes as `image/webp` (falling back to `image/jpeg`),
 * and steps quality down until the encoded payload is <= 48 KB.
 */
export const AVATAR_SIZE = 256
export const AVATAR_MAX_BYTES = 48 * 1024

const QUALITY_STEPS = [0.85, 0.72, 0.6, 0.48, 0.36, 0.25] as const

export interface EncodedAvatar {
  contentType: 'image/webp' | 'image/jpeg'
  dataBase64: string
  bytes: number
}

function approxBase64Bytes(b64: string): number {
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding)
}

function parseDataUrl(url: string): { contentType: string; dataBase64: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/.exec(url)
  if (!match) return null
  return { contentType: match[1].toLowerCase(), dataBase64: match[2] }
}

async function decodeImageSource(file: Blob): Promise<{
  source: CanvasImageSource
  width: number
  height: number
  cleanup: () => void
}> {
  if (typeof globalThis.createImageBitmap === 'function') {
    const bmp = await globalThis.createImageBitmap(file)
    return {
      source: bmp,
      width: bmp.width,
      height: bmp.height,
      cleanup: () => {
        if (typeof bmp.close === 'function') bmp.close()
      },
    }
  }
  const objectUrl = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('Could not decode image.'))
      el.src = objectUrl
    })
    return {
      source: img,
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
      cleanup: () => URL.revokeObjectURL(objectUrl),
    }
  } catch (err) {
    URL.revokeObjectURL(objectUrl)
    throw err
  }
}

export async function encodeAvatarImage(file: Blob): Promise<EncodedAvatar> {
  const { source, width, height, cleanup } = await decodeImageSource(file)
  try {
    if (width <= 0 || height <= 0) {
      throw new Error('Could not read image dimensions.')
    }
    const canvas = document.createElement('canvas')
    canvas.width = AVATAR_SIZE
    canvas.height = AVATAR_SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas is not available on this device.')

    const side = Math.min(width, height)
    const sx = Math.floor((width - side) / 2)
    const sy = Math.floor((height - side) / 2)
    ctx.drawImage(source, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE)

    const formats: readonly ('image/webp' | 'image/jpeg')[] = ['image/webp', 'image/jpeg']
    for (const mime of formats) {
      for (const quality of QUALITY_STEPS) {
        const dataUrl = canvas.toDataURL(mime, quality)
        const parsed = parseDataUrl(dataUrl)
        if (!parsed) continue
        if (mime === 'image/webp' && parsed.contentType !== 'image/webp') {
          // Browser doesn't support WebP encoding; move to JPEG fallback.
          break
        }
        const bytes = approxBase64Bytes(parsed.dataBase64)
        if (bytes <= AVATAR_MAX_BYTES) {
          return {
            contentType: parsed.contentType === 'image/webp' ? 'image/webp' : 'image/jpeg',
            dataBase64: parsed.dataBase64,
            bytes,
          }
        }
      }
    }
    throw new Error('Photo is too large. Try a smaller image.')
  } finally {
    cleanup()
  }
}
