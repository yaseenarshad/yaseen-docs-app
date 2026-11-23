/**
 * THE TILE THAT SUITS ITS PICTURE (YAZ-4443, under 4B YAZ-4285; Yaseen's round 2 choice "Auto per picture"). In dark
 * mode, black line art on the dark tile was hard to see; in light mode, a white icon vanished on the white tile. So each
 * picture's brightness is measured ONCE, from the thumbnail the tile already loaded (no network): it is drawn to a 24×24
 * canvas and its opaque pixels averaged. A dark picture gets a light tile, a light picture a dark tile, a mid one keeps
 * the theme's tile. The answer is cached by the picture's key, so a re-mount (scrolling, a filter keystroke) paints the
 * right tile on its first render and never measures again.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'

export type PictureTone = 'dark' | 'light' | 'mid'

/** Below this average brightness (0 black … 1 white) a picture is dark; at or above `LIGHT_FROM` it is light. */
export const DARK_BELOW = 0.45
export const LIGHT_FROM = 0.6
/** The side of the canvas a picture is measured at: enough for an average, 2304 bytes to read. */
const SAMPLE = 24
/** How many tones are kept: more than a full panel of tiles, and a few bytes each. */
const TONE_LIMIT = 500

/**
 * The tone of RGBA pixels (as `getImageData` gives them): the alpha-weighted average of each pixel's brightness, so
 * the transparent ground of an icon does not count. Brightness is the sRGB luma (on the encoded values, which follow
 * what the eye sees better than linear light). Null when less than one pixel's worth is opaque: the theme tile stays.
 */
export function classifyPixels(data: ArrayLike<number>): PictureTone | null {
  let sum = 0
  let weight = 0
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3]
    if (alpha === 0) continue
    sum += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) * alpha
    weight += alpha
  }
  if (weight < 255) return null
  const brightness = sum / weight / 255
  return brightness < DARK_BELOW ? 'dark' : brightness >= LIGHT_FROM ? 'light' : 'mid'
}

export interface ToneCache {
  /** The tone of `key`; null when it has none (transparent, tainted); undefined when it was never measured. */
  get(key: string): PictureTone | null | undefined
  set(key: string, tone: PictureTone | null): void
  clear(): void
}

/** A bounded map, least recently seen out first (Map keeps insertion order, so a hit is re-set to the back). */
export function createToneCache(limit: number): ToneCache {
  const tones = new Map<string, PictureTone | null>()
  return {
    get: (key) => {
      if (!tones.has(key)) return undefined
      const tone = tones.get(key) as PictureTone | null
      tones.delete(key)
      tones.set(key, tone)
      return tone
    },
    set: (key, tone) => {
      tones.delete(key)
      tones.set(key, tone)
      for (const oldest of tones.keys()) {
        if (tones.size <= limit) break
        tones.delete(oldest)
      }
    },
    clear: () => tones.clear(),
  }
}

const tones = createToneCache(TONE_LIMIT)
export const knownTone = (key: string) => tones.get(key)
export const clearToneMemo = () => tones.clear()

/**
 * The tone of the picture at `key`, from the cache or by one `read` of its pixels. A read that throws (a cross-origin
 * picture taints the canvas) is "no tone": no error, and it is cached so it is never tried again.
 */
export function toneOf(key: string | undefined, read: () => ArrayLike<number>): PictureTone | null {
  const known = key === undefined ? undefined : tones.get(key)
  if (known !== undefined) return known
  let tone: PictureTone | null
  try {
    tone = classifyPixels(read())
  } catch {
    tone = null
  }
  if (key !== undefined) tones.set(key, tone)
  return tone
}

let canvas: HTMLCanvasElement | null = null
/** A loaded picture's pixels at 24×24, on one shared offscreen canvas. Throws when the picture taints it. */
function readThumbnail(img: HTMLImageElement): ArrayLike<number> {
  canvas ??= Object.assign(document.createElement('canvas'), { width: SAMPLE, height: SAMPLE })
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (context === null) throw new Error('No 2D canvas')
  context.clearRect(0, 0, SAMPLE, SAMPLE)
  context.drawImage(img, 0, 0, SAMPLE, SAMPLE)
  return context.getImageData(0, 0, SAMPLE, SAMPLE).data
}

/** The tile's class for a tone: a dark picture's tile is light, a light picture's tile is dark. */
export function tileClass(tone: PictureTone | null): string {
  return tone === 'dark' ? 'is-light-tile' : tone === 'light' ? 'is-dark-tile' : ''
}

/**
 * The tile around a picture: `className` plus the tile class of the `<img>` inside, once it has loaded. `toneKey` is
 * the picture's cache key; without one (the save step's one-off picture) the picture is measured and not kept.
 */
export function PictureTile({ className, toneKey, children }: { className: string; toneKey?: string; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [tone, setTone] = useState<PictureTone | null>(() => (toneKey === undefined ? null : (tones.get(toneKey) ?? null)))
  useEffect(() => {
    const known = toneKey === undefined ? undefined : tones.get(toneKey)
    setTone(known ?? null)
    if (known !== undefined) return
    const tile = ref.current
    if (tile === null) return
    const measure = (img: HTMLImageElement) => {
      if (!img.complete || img.naturalWidth === 0) return
      setTone(toneOf(toneKey, () => readThumbnail(img)))
    }
    const img = tile.querySelector('img')
    if (img !== null) measure(img)
    // `load` does not bubble, but it is seen on the way down: this hears the picture that replaces the placeholder.
    const loaded = (event: Event) => {
      if (event.target instanceof HTMLImageElement) measure(event.target)
    }
    tile.addEventListener('load', loaded, true)
    return () => tile.removeEventListener('load', loaded, true)
  }, [toneKey])
  const tile = tileClass(tone)
  return (
    <span ref={ref} className={tile === '' ? className : `${className} ${tile}`}>
      {children}
    </span>
  )
}
