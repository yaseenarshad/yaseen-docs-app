/**
 * A DRAWING'S PICTURE through the REAL engine (YAZ-4825 items 1, 25, 26): `exportToSvg` in jsdom, as the window gets it.
 * jsdom has no canvas and no FontFace: the canvas measures text as 6 px a letter, FontFace is a shell, and the font
 * files come from the engine package's own `fonts/` folder, as the app serves them from `excalidraw-assets/`.
 */
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../../api', () => ({
  api: {
    boardHead: vi.fn(async (path: string) => ({ path, mtime: 1, size: 1, meta: null })),
    drawing: { load: vi.fn() },
    watch: vi.fn(() => () => undefined),
  },
}))

import { api } from '../../api'
import { DRAWING_PADDING, loadPicture } from './boardPictures'

const ASSETS = 'http://assets.test/'
const FONTS = `${process.cwd()}/node_modules/@excalidraw/excalidraw/dist/prod/`
const blobs = new Map<string, Blob>()

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => ({ font: '', measureText: (t: string) => ({ width: t.length * 6 }) })) as never
  ;(globalThis as Record<string, unknown>).FontFace = class {
    constructor(readonly family: string) {}
    load() {
      return Promise.resolve(this)
    }
  }
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url)
    return u.startsWith(ASSETS) ? new Response(readFileSync(FONTS + decodeURIComponent(u.slice(ASSETS.length)))) : realFetch(url, init)
  }) as typeof fetch
  // `loadExcalidraw` sets the asset path from the page's URL; the fonts are fetched from this stand-in.
  Object.defineProperty(window, 'EXCALIDRAW_ASSET_PATH', { get: () => ASSETS, set: () => undefined, configurable: true })
  let n = 0
  URL.createObjectURL = ((blob: Blob) => {
    const url = `blob:${++n}`
    blobs.set(url, blob)
    return url
  }) as typeof URL.createObjectURL
  URL.revokeObjectURL = () => undefined
})

const scene = (elements: unknown[]) => ({ path: '/v/x.excalidraw', json: JSON.stringify({ type: 'excalidraw', version: 2, elements, appState: { viewBackgroundColor: '#ffffff' } }), mtime: 1, size: 1, files: {}, keepIds: [] })

describe('a drawing`s picture, real engine', () => {
  it('item 25: the fonts it draws with are inside the SVG as data; the bounds map the picture to the board; the frames come with it', async () => {
    vi.mocked(api.drawing.load).mockResolvedValueOnce(scene([
      { type: 'rectangle', id: 'r1', x: 100, y: 50, width: 200, height: 100 },
      { type: 'text', id: 't1', x: 120, y: 60, width: 80, height: 25, text: 'Hello', originalText: 'Hello', fontSize: 20, fontFamily: 5 },
      { type: 'frame', id: 'f1', x: 400, y: 300, width: 300, height: 200, name: 'Top' },
    ]) as never)
    const picture = (await loadPicture({ root: '/v', path: 'fonts.excalidraw' }, null))!
    expect(api.drawing.load).toHaveBeenCalledWith({ root: '/v', path: '/v/fonts.excalidraw', imageMaxPx: 2400 })
    const svg = await blobs.get(picture.url)!.text()
    expect(svg).toMatch(/@font-face \{ font-family: "Excalifont"; src: url\(data:font\/woff2;base64,/)
    expect(svg).not.toContain(ASSETS)
    // The board spans 100..700 × 50..500; the picture starts the padding before it.
    expect(picture.bounds).toEqual({ x: 100 - DRAWING_PADDING, y: 50 - DRAWING_PADDING, width: 600 + 2 * DRAWING_PADDING, height: 450 + 2 * DRAWING_PADDING })
    expect(svg).toContain('viewBox="0 0 620 470"')
    expect(picture.frames).toEqual([{ id: 'f1', name: 'Top', x: 400, y: 300, width: 300, height: 200 }])
  })

  it('item 26: a 10,000-element drawing, timed (posted on YAZ-4825)', async () => {
    const many = Array.from({ length: 10_000 }, (_, i) => ({ type: i % 3 === 0 ? 'text' : 'rectangle', id: `e${i}`, x: (i % 100) * 50, y: Math.floor(i / 100) * 50, width: 40, height: 30, text: `n${i}`, originalText: `n${i}`, fontSize: 12, fontFamily: 5 }))
    vi.mocked(api.drawing.load).mockResolvedValueOnce(scene(many) as never)
    const t0 = performance.now()
    const picture = (await loadPicture({ root: '/v', path: 'big.excalidraw' }, null))!
    const ms = performance.now() - t0
    console.info(`10,000 elements: ${ms.toFixed(0)} ms for the picture, ${(picture.bytes / 1e6).toFixed(1)} MB of SVG`)
    expect(picture.bounds).toEqual({ x: -10, y: -10, width: 4990 + 20, height: 4980 + 20 })
  }, 120_000)
})
