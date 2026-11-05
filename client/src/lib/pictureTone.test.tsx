/**
 * The tile background that suits each picture (YAZ-4443, under 4B YAZ-4285): a picture's brightness is measured once
 * from its loaded thumbnail, cached by its key, and a dark picture gets a light tile, a light picture a dark tile.
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { classifyPixels, clearToneMemo, createToneCache, knownTone, PictureTile, tileClass, toneOf } from './pictureTone'

/** `count` pixels of one RGBA colour, as `getImageData` gives them. */
const pixels = (count: number, [r, g, b, a]: [number, number, number, number]): Uint8ClampedArray => {
  const data = new Uint8ClampedArray(count * 4)
  for (let i = 0; i < data.length; i += 4) data.set([r, g, b, a], i)
  return data
}
const join = (...parts: Uint8ClampedArray[]): Uint8ClampedArray => {
  const data = new Uint8ClampedArray(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const part of parts) {
    data.set(part, at)
    at += part.length
  }
  return data
}

describe('classifyPixels', () => {
  it('calls black line art on a transparent ground dark, whatever the empty pixels hold', () => {
    // Transparent white around the lines must not lift the average: only the opaque pixels count.
    expect(classifyPixels(join(pixels(40, [0, 0, 0, 255]), pixels(536, [255, 255, 255, 0])))).toBe('dark')
  })

  it('calls a white icon light, and a mid grey mid', () => {
    expect(classifyPixels(pixels(576, [255, 255, 255, 255]))).toBe('light')
    expect(classifyPixels(pixels(576, [130, 130, 130, 255]))).toBe('mid')
  })

  it('weighs each pixel by its alpha: faint light edges do not outvote solid dark lines', () => {
    expect(classifyPixels(join(pixels(50, [0, 0, 0, 255]), pixels(200, [255, 255, 255, 30])))).toBe('dark')
  })

  it('has no tone for a fully transparent picture (the theme tile stays)', () => {
    expect(classifyPixels(pixels(576, [0, 0, 0, 0]))).toBeNull()
  })
})

describe('createToneCache', () => {
  it('keeps at most `limit` tones, the least recently seen out first', () => {
    const cache = createToneCache(2)
    cache.set('a', 'dark')
    cache.set('b', 'light')
    expect(cache.get('a')).toBe('dark') // a is now the most recent
    cache.set('c', 'mid')
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('a')).toBe('dark')
    expect(cache.get('c')).toBe('mid')
  })

  it('remembers "no tone" (null) apart from "not measured" (undefined)', () => {
    const cache = createToneCache(5)
    cache.set('tainted', null)
    expect(cache.get('tainted')).toBeNull()
    expect(cache.get('never')).toBeUndefined()
  })
})

describe('toneOf', () => {
  beforeEach(() => clearToneMemo())

  it('reads a picture once: the second ask is answered from the cache', () => {
    const read = vi.fn(() => pixels(576, [0, 0, 0, 255]))
    expect(toneOf('iconify:mdi:arrow', read)).toBe('dark')
    expect(toneOf('iconify:mdi:arrow', read)).toBe('dark')
    expect(read).toHaveBeenCalledTimes(1)
    expect(knownTone('iconify:mdi:arrow')).toBe('dark')
  })

  it('falls back to the theme tile, with no error, when a cross-origin picture taints the canvas', () => {
    const read = vi.fn(() => {
      throw new DOMException('The canvas has been tainted by cross-origin data.', 'SecurityError')
    })
    expect(toneOf('pixabay:1', read)).toBeNull()
    // Known as "no tone", so scrolling back never tries the tainted read again.
    expect(toneOf('pixabay:1', read)).toBeNull()
    expect(read).toHaveBeenCalledTimes(1)
  })
})

describe('tileClass', () => {
  it('gives a dark picture a light tile, a light picture a dark tile, and the rest the theme tile', () => {
    expect(tileClass('dark')).toBe('is-light-tile')
    expect(tileClass('light')).toBe('is-dark-tile')
    expect(tileClass('mid')).toBe('')
    expect(tileClass(null)).toBe('')
  })
})

describe('PictureTile', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  let getContext: { mockRestore(): void } | undefined
  let drawn: number

  /** The canvas jsdom lacks: it answers `getImageData` with `data`, and counts the draws. */
  const stubCanvas = (data: () => Uint8ClampedArray) => {
    drawn = 0
    getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () =>
        ({
          clearRect: () => {},
          drawImage: () => {
            drawn += 1
          },
          getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: data(), width: w, height: h }),
        }) as never,
    )
  }
  /** jsdom never loads an image: this makes `img` look loaded and fires its load. */
  const load = (img: HTMLImageElement) => {
    Object.defineProperty(img, 'naturalWidth', { configurable: true, value: 240 })
    Object.defineProperty(img, 'complete', { configurable: true, value: true })
    img.dispatchEvent(new Event('load'))
  }

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    clearToneMemo()
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    getContext?.mockRestore()
  })

  const render = (toneKey: string | undefined) =>
    act(() =>
      root.render(
        <PictureTile className="image-studio__preview" toneKey={toneKey}>
          <img src="data:image/png;base64,AAAA" alt="" />
        </PictureTile>,
      ),
    )
  const tile = () => host.querySelector('.image-studio__preview') as HTMLElement

  it('gives a tile with dark line art a light tile once its picture loads', () => {
    stubCanvas(() => pixels(576, [10, 10, 10, 255]))
    render('excalidraw:arrows')
    expect(tile().className).toBe('image-studio__preview')
    act(() => load(host.querySelector('img') as HTMLImageElement))
    expect(tile().className).toBe('image-studio__preview is-light-tile')
  })

  it('gives a white icon a dark tile', () => {
    stubCanvas(() => pixels(576, [250, 250, 250, 255]))
    render('iconify:white')
    act(() => load(host.querySelector('img') as HTMLImageElement))
    expect(tile().className).toBe('image-studio__preview is-dark-tile')
  })

  it('paints a measured picture on its first render after a re-mount, and never draws it again', () => {
    stubCanvas(() => pixels(576, [10, 10, 10, 255]))
    render('excalidraw:arrows')
    act(() => load(host.querySelector('img') as HTMLImageElement))
    expect(drawn).toBe(1)
    act(() => root.render(<div />))
    render('excalidraw:arrows')
    expect(tile().className).toBe('image-studio__preview is-light-tile')
    act(() => load(host.querySelector('img') as HTMLImageElement))
    expect(drawn).toBe(1)
  })

  it('keeps the theme tile, with no error, when the picture taints the canvas', () => {
    getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () =>
        ({
          clearRect: () => {},
          drawImage: () => {},
          getImageData: () => {
            throw new DOMException('tainted', 'SecurityError')
          },
        }) as never,
    )
    render('pixabay:2')
    expect(() => act(() => load(host.querySelector('img') as HTMLImageElement))).not.toThrow()
    expect(tile().className).toBe('image-studio__preview')
  })

  it('measures a picture with no key (the save step) without caching it', () => {
    stubCanvas(() => pixels(576, [10, 10, 10, 255]))
    render(undefined)
    act(() => load(host.querySelector('img') as HTMLImageElement))
    expect(tile().className).toBe('image-studio__preview is-light-tile')
  })
})
