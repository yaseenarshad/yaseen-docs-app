// @vitest-environment jsdom
/**
 * YAZ-5440: a drawing's picture on the phone, through the REAL engine (the Mac's own picture code), in jsdom. jsdom has
 * no canvas: it measures text as 6 px a letter, as the Mac's engine test does (`boardPictures.engine.test.ts`).
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { GARDEN_PICTURE_ID, GARDEN_SCENE } from '../dev/drawingVault'
import { SUN_PNG } from '../dev/readerVault'
import { drawPicture } from './engine/drawPicture'

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => ({ font: '', measureText: (t: string) => ({ width: t.length * 6 }) })) as never
  ;(globalThis as Record<string, unknown>).FontFace = class {
    constructor(readonly family: string) {}
    load() {
      return Promise.resolve(this)
    }
  }
})

const sunUrl = `data:image/png;base64,${btoa(String.fromCharCode(...SUN_PNG))}`

describe('a drawing`s picture on the phone (YAZ-5440)', () => {
  it('is the engine`s SVG: the picture inside from assets/, the fonts inside as data, no address of another host', async () => {
    const asked: Array<[string, string | null]> = []
    const drawn = await drawPicture({
      text: JSON.stringify(GARDEN_SCENE),
      theme: 'light',
      picture: async (id, folder) => (asked.push([id, folder]), id === GARDEN_PICTURE_ID ? { mimeType: 'image/png', dataURL: sunUrl } : null),
    })
    if (drawn === 'empty') throw new Error('empty')
    expect(asked).toEqual([[GARDEN_PICTURE_ID, null]])
    expect(drawn.svg).toMatch(/^<svg /)
    expect(drawn.svg).toContain('Tomatoes')
    expect(drawn.svg).toContain(sunUrl.slice(0, 60))
    expect(drawn.svg).toMatch(/@font-face \{ font-family: "Excalifont"; src: url\(data:font\/woff2;base64,/)
    // The page's CSP loads nothing from another host, and an `<img>` would not: no address in the picture.
    expect(drawn.svg).not.toMatch(/https?:\/\/(?!www\.w3\.org)/)
    expect(drawn.width).toBeGreaterThan(500)
  }, 60_000)

  it('dark follows the app; a drawing with nothing in it is empty; a file that is not a drawing throws', async () => {
    const light = await drawPicture({ text: JSON.stringify(GARDEN_SCENE), theme: 'light', picture: async () => null })
    const dark = await drawPicture({ text: JSON.stringify(GARDEN_SCENE), theme: 'dark', picture: async () => null })
    if (light === 'empty' || dark === 'empty') throw new Error('empty')
    // The same drawing in the engine's dark colours: a different picture of the same size.
    expect(dark.svg).not.toBe(light.svg)
    expect([dark.width, dark.height]).toEqual([light.width, light.height])
    expect(light.svg).toContain('#ffffff')
    expect(await drawPicture({ text: JSON.stringify({ type: 'excalidraw', elements: [{ type: 'rectangle', id: 'x', x: 0, y: 0, width: 1, height: 1, isDeleted: true }] }), theme: 'light', picture: async () => null })).toBe('empty')
    await expect(drawPicture({ text: '{ not a drawing', theme: 'light', picture: async () => null })).rejects.toThrow()
    await expect(drawPicture({ text: '{"elements": 3}', theme: 'light', picture: async () => null })).rejects.toThrow()
  }, 60_000)

  it('a board with its own pictures folder asks there first (the Mac`s rule)', async () => {
    const asked: Array<string | null> = []
    await drawPicture({ text: JSON.stringify({ ...GARDEN_SCENE, yaseendraw: { createdAt: 1, updatedAt: 1, pictures: 'assets', picturesFolder: 'Garden/pictures' } }), theme: 'light', picture: async (_id, folder) => (asked.push(folder), null) })
    expect(asked).toEqual(['Garden/pictures'])
  }, 60_000)
})
