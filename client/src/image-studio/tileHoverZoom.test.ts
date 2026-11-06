/**
 * The hover zoom's sizes and its sharp pictures (YAZ-4447 demo round 2): Small, Medium (the default) and Large, each
 * inside the window; a Pixabay tile's bigger picture swaps in after it loads, the last 40 stay, an icon asks nothing,
 * and a pointer that leaves first gets no swap.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type MediaZoomWidth } from '@shared/types'
import { attachTileHoverZoom, clearZoomCache, TILE_ZOOM_DWELL_MS, ZOOM_CACHE_LIMIT, zoomCacheSize, zoomPlacement, zoomWidthFor, type ZoomLoader } from './tileHoverZoom'

const TILE = { left: 700, top: 20, right: 780, bottom: 100 } // 80 px

describe('the three hover sizes', () => {
  it('Small is 3 times the tile (240 px at most), Medium 8 times (640), Large 12 times (960); Medium is the default', () => {
    const big = (size: 'small' | 'medium' | 'large') => zoomPlacement(TILE, 4000, 4000, size).size
    expect([big('small'), big('medium'), big('large')]).toEqual([240, 640, 960])
    const tiny = { left: 700, top: 20, right: 740, bottom: 60 } // 40 px
    expect([zoomPlacement(tiny, 4000, 4000, 'small').size, zoomPlacement(tiny, 4000, 4000, 'medium').size, zoomPlacement(tiny, 4000, 4000, 'large').size]).toEqual([120, 320, 480])
    expect(zoomPlacement(TILE, 4000, 4000).size).toBe(640)
    expect(DEFAULT_SETTINGS.mediaHoverZoomSize).toBe('medium')
  })

  it('every size stays inside the window', () => {
    for (const size of ['small', 'medium', 'large'] as const) {
      const box = zoomPlacement(TILE, 1024, 700, size)
      expect(box.left).toBeGreaterThanOrEqual(8)
      expect(box.top).toBeGreaterThanOrEqual(8)
      expect(box.left + box.size).toBeLessThanOrEqual(1024 - 8)
      expect(box.top + box.size).toBeLessThanOrEqual(700 - 8)
    }
    expect(zoomPlacement(TILE, 1024, 700, 'large').size).toBe(684)
  })

  it('asks the Pixabay width that fits the box, never more than 960', () => {
    expect([zoomWidthFor(240, 1), zoomWidthFor(640, 1), zoomWidthFor(684, 1), zoomWidthFor(240, 2), zoomWidthFor(640, 2), zoomWidthFor(960, 3)]).toEqual([340, 640, 960, 640, 960, 960])
  })
})

describe('the sharp picture of a Pixabay tile', () => {
  let list: HTMLElement
  let stop: (() => void) | null = null
  const zoomImg = () => document.querySelector<HTMLImageElement>('.image-studio__zoom img')
  const shown = () => document.querySelector<HTMLElement>('.image-studio__zoom')?.hidden === false

  /** A card as the panel draws one: `data-zoom` for a Pixabay item, its tile with a small picture. */
  function card(id: string | null, picture = 'data:image/png;base64,SMALL'): HTMLElement {
    const article = document.createElement('article')
    article.className = 'image-studio__card'
    if (id !== null) article.dataset.zoom = id
    const tile = document.createElement('span')
    tile.className = 'image-studio__preview'
    tile.getBoundingClientRect = () => ({ ...TILE, width: 80, height: 80, x: 700, y: 20, toJSON: () => ({}) })
    const img = document.createElement('img')
    img.src = picture
    tile.append(img)
    article.append(tile)
    list.append(article)
    return article
  }
  const flush = () => vi.advanceTimersByTimeAsync(0)
  async function hover(target: Element) {
    target.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }))
    await vi.advanceTimersByTimeAsync(TILE_ZOOM_DWELL_MS)
  }
  async function leave(target: Element) {
    target.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse', relatedTarget: document.body }))
    await flush()
  }

  beforeEach(() => {
    vi.useFakeTimers()
    clearZoomCache()
    list = document.createElement('div')
    document.body.append(list)
  })
  afterEach(() => {
    stop?.()
    stop = null
    list.remove()
    vi.useRealTimers()
  })

  it('shows the small picture at once, then the large one when it has loaded, in the same box', async () => {
    let answer: (dataURL: string) => void = () => undefined
    const load = vi.fn<ZoomLoader>(() => new Promise<string>((resolve) => (answer = resolve)))
    stop = attachTileHoverZoom(list, { load })
    const one = card('123')
    await hover(one)
    expect(shown()).toBe(true)
    expect(zoomImg()?.getAttribute('src')).toBe('data:image/png;base64,SMALL')
    expect(load).toHaveBeenCalledWith('123', 640 as MediaZoomWidth)
    const box = document.querySelector<HTMLElement>('.image-studio__zoom')!.style.cssText
    const before = zoomImg()
    answer('data:image/jpeg;base64,LARGE')
    await flush()
    expect(zoomImg()?.getAttribute('src')).toBe('data:image/jpeg;base64,LARGE')
    expect(zoomImg()).toBe(before) // the same <img>: no new element, no jump
    expect(document.querySelector<HTMLElement>('.image-studio__zoom')!.style.cssText).toBe(box)
  })

  it('a second hover of the same picture is instant and asks nothing', async () => {
    const load = vi.fn<ZoomLoader>(async () => 'data:image/jpeg;base64,LARGE')
    stop = attachTileHoverZoom(list, { load })
    const one = card('123')
    await hover(one)
    await flush()
    await leave(one)
    await hover(one)
    expect(zoomImg()?.getAttribute('src')).toBe('data:image/jpeg;base64,LARGE')
    expect(load).toHaveBeenCalledTimes(1)
  })

  it(`keeps the last ${ZOOM_CACHE_LIMIT}: past that the oldest goes, and asks again`, async () => {
    const load = vi.fn<ZoomLoader>(async (id) => `data:image/jpeg;base64,${id}`)
    stop = attachTileHoverZoom(list, { load })
    const cards = Array.from({ length: ZOOM_CACHE_LIMIT + 1 }, (_, i) => card(String(i)))
    for (const c of cards) {
      await hover(c)
      await flush()
      await leave(c)
    }
    expect(zoomCacheSize()).toBe(ZOOM_CACHE_LIMIT)
    load.mockClear()
    await hover(cards[ZOOM_CACHE_LIMIT])
    await leave(cards[ZOOM_CACHE_LIMIT])
    expect(load).not.toHaveBeenCalled()
    await hover(cards[0])
    await flush()
    expect(load).toHaveBeenCalledWith('0', 640)
    expect(zoomCacheSize()).toBe(ZOOM_CACHE_LIMIT)
  })

  it('an icon, a shape or a drawing (no data-zoom) asks nothing', async () => {
    const load = vi.fn<ZoomLoader>(async () => 'data:image/jpeg;base64,LARGE')
    stop = attachTileHoverZoom(list, { load })
    await hover(card(null, 'data:image/svg+xml;base64,ICON'))
    await flush()
    expect(shown()).toBe(true)
    expect(load).not.toHaveBeenCalled()
    expect(zoomImg()?.getAttribute('src')).toBe('data:image/svg+xml;base64,ICON')
  })

  it('a failed ask (offline) keeps the small picture, with no error', async () => {
    const load = vi.fn<ZoomLoader>(async () => Promise.reject(new Error('OFFLINE')))
    stop = attachTileHoverZoom(list, { load })
    await hover(card('123'))
    await flush()
    expect(shown()).toBe(true)
    expect(zoomImg()?.getAttribute('src')).toBe('data:image/png;base64,SMALL')
  })

  it('a pointer that leaves before the picture loads gets no swap, and the next zoom keeps its own picture', async () => {
    const answers: ((dataURL: string) => void)[] = []
    const load = vi.fn<ZoomLoader>(() => new Promise<string>((resolve) => answers.push(resolve)))
    stop = attachTileHoverZoom(list, { load })
    const one = card('1')
    const two = card('2', 'data:image/png;base64,SMALL2')
    await hover(one)
    await leave(one)
    expect(shown()).toBe(false)
    await hover(two)
    answers[0]('data:image/jpeg;base64,LARGE1')
    await flush()
    expect(zoomImg()?.getAttribute('src')).toBe('data:image/png;base64,SMALL2')
    answers[1]('data:image/jpeg;base64,LARGE2')
    await flush()
    expect(zoomImg()?.getAttribute('src')).toBe('data:image/jpeg;base64,LARGE2')
  })

  it('the size choice sets the box', async () => {
    stop = attachTileHoverZoom(list, { size: 'small' })
    await hover(card('1'))
    expect(document.querySelector<HTMLElement>('.image-studio__zoom')!.style.width).toBe('240px')
  })
})
