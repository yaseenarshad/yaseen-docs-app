// @vitest-environment jsdom
/**
 * YAZ-5440: a drawing's picture on the phone, through the REAL engine (the Mac's own picture code), in jsdom. jsdom has
 * no canvas: it measures text as 6 px a letter, as the Mac's engine test does (`boardPictures.engine.test.ts`).
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { GARDEN_PICTURE_ID, GARDEN_SCENE } from '../dev/drawingVault'
import { SUN_PNG } from '../dev/readerVault'
import { drawPicture, picturePath, type DrawInput } from './engine/drawPicture'

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
const nothing = { files: [], read: async () => ({ why: 'gone' }) }

describe('a drawing`s picture on the phone (YAZ-5440)', () => {
  it('is the engine`s SVG: the picture inside from assets/, the fonts inside as data, no address of another host', async () => {
    const asked: string[] = []
    const drawn = await drawPicture({
      text: JSON.stringify(GARDEN_SCENE),
      theme: 'light',
      files: ['garden.excalidraw', `assets/${GARDEN_PICTURE_ID}.png`],
      read: async (path) => (asked.push(path), path === `assets/${GARDEN_PICTURE_ID}.png` ? { bytes: SUN_PNG } : { why: 'gone' }),
    })
    if (drawn === 'empty') throw new Error('empty')
    expect(asked).toEqual([`assets/${GARDEN_PICTURE_ID}.png`])
    expect(drawn.svg).toMatch(/^<svg /)
    expect(drawn.svg).toContain('Tomatoes')
    expect(drawn.svg).toContain(sunUrl.slice(0, 60))
    expect(drawn.svg).toMatch(/@font-face \{ font-family: "Excalifont"; src: url\(data:font\/woff2;base64,/)
    // The page's CSP loads nothing from another host, and an `<img>` would not: no address in the picture.
    expect(drawn.svg).not.toMatch(/https?:\/\/(?!www\.w3\.org)/)
    expect(drawn.width).toBeGreaterThan(500)
  }, 60_000)

  it('dark follows the app; a drawing with nothing in it is empty; a file that is not a drawing throws', async () => {
    const light = await drawPicture({ text: JSON.stringify(GARDEN_SCENE), theme: 'light', ...nothing })
    const dark = await drawPicture({ text: JSON.stringify(GARDEN_SCENE), theme: 'dark', ...nothing })
    if (light === 'empty' || dark === 'empty') throw new Error('empty')
    // The same drawing in the engine's dark colours: a different picture of the same size.
    expect(dark.svg).not.toBe(light.svg)
    expect([dark.width, dark.height]).toEqual([light.width, light.height])
    expect(light.svg).toContain('#ffffff')
    expect(await drawPicture({ text: JSON.stringify({ type: 'excalidraw', elements: [{ type: 'rectangle', id: 'x', x: 0, y: 0, width: 1, height: 1, isDeleted: true }] }), theme: 'light', ...nothing })).toBe('empty')
    await expect(drawPicture({ text: '{ not a drawing', theme: 'light', ...nothing })).rejects.toThrow()
    await expect(drawPicture({ text: '{"elements": 3}', theme: 'light', ...nothing })).rejects.toThrow()
  }, 60_000)

  it('a picture inside: the board`s own pictures folder first, then assets/ (the Mac`s rule)', async () => {
    const files = ['assets/abc.png', 'Garden/pictures/abc.jpg', 'assets/abc.txt', 'other/abc.png']
    expect(picturePath(files, 'abc', null)).toBe('assets/abc.png')
    expect(picturePath(files, 'abc', 'Garden/pictures')).toBe('Garden/pictures/abc.jpg')
    expect(picturePath(files, 'zzz', null)).toBeNull()
    const asked: string[] = []
    const input: DrawInput = {
      text: JSON.stringify({ ...GARDEN_SCENE, yaseendraw: { createdAt: 1, updatedAt: 1, pictures: 'assets', picturesFolder: 'Garden/pictures' } }),
      theme: 'light',
      files: [`Garden/pictures/${GARDEN_PICTURE_ID}.png`, `assets/${GARDEN_PICTURE_ID}.png`],
      read: async (path) => (asked.push(path), { bytes: SUN_PNG }),
    }
    await drawPicture(input)
    expect(asked).toEqual([`Garden/pictures/${GARDEN_PICTURE_ID}.png`])
  }, 60_000)
})
