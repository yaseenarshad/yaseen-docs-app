/**
 * Reading a drawing sidecar (YAZ-878): the base64 → UTF-8 → JSON path, the target that goes to
 * `readAsset` RAW, and the ONE rule for everything that is not a scene — throw, which upstream
 * is the preview's broken state.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api'
import { BridgeRequestError } from '../api'
import { EMPTY_SCENE_JSON } from './createDrawing'
import { isDrawingTarget, loadDrawingScene, parseScene } from './drawingScene'

vi.mock('../api', async (original) => ({
  ...(await original<typeof import('../api')>()),
  api: { readAsset: vi.fn() },
}))

const readAsset = vi.mocked(api.readAsset)

/** What the asset pipe hands back: the file's bytes, base64. */
const asset = (text: string) => ({
  path: `/v/assets/drawings/x.excalidraw`,
  mime: 'application/json',
  data: btoa(String.fromCharCode(...new TextEncoder().encode(text))),
  size: text.length,
})

beforeEach(() => {
  readAsset.mockReset()
})

describe('isDrawingTarget', () => {
  it('accepts only `.excalidraw` embeds, in any case and at any depth', () => {
    expect(isDrawingTarget('Sketch.excalidraw')).toBe(true)
    expect(isDrawingTarget('assets/drawings/Sketch.EXCALIDRAW')).toBe(true)
    expect(isDrawingTarget('img.png')).toBe(false)
    expect(isDrawingTarget('note')).toBe(false)
    expect(isDrawingTarget('excalidraw')).toBe(false)
  })
})

describe('parseScene', () => {
  it('decodes the empty scene YAZ-877 writes', () => {
    expect(parseScene(asset(EMPTY_SCENE_JSON).data)).toEqual({ elements: [], appState: {}, files: {} })
  })

  it('carries elements through and keeps non-ASCII text intact (UTF-8, not latin1)', () => {
    const scene = { type: 'excalidraw', elements: [{ type: 'text', text: 'héllo — 描' }], appState: { theme: 'dark' }, files: {} }
    expect(parseScene(asset(JSON.stringify(scene)).data)).toEqual({
      elements: [{ type: 'text', text: 'héllo — 描' }],
      appState: { theme: 'dark' },
      files: {},
    })
  })

  it('defaults the optional halves: no appState → {}, no files → null (what exportToSvg wants)', () => {
    expect(parseScene(asset('{"elements":[]}').data)).toEqual({ elements: [], appState: {}, files: null })
  })

  it('throws for anything that is not a scene — invalid JSON, a non-object, no elements array', () => {
    expect(() => parseScene(asset('not json at all').data)).toThrow()
    expect(() => parseScene(asset('[1,2,3]').data)).toThrow(/not an Excalidraw scene/)
    expect(() => parseScene(asset('"a string"').data)).toThrow(/not an Excalidraw scene/)
    expect(() => parseScene(asset('{"elements":{}}').data)).toThrow(/no elements/)
  })
})

describe('loadDrawingScene', () => {
  it('hands the target to readAsset RAW — resolution is the asset pipe`s rule, not ours', async () => {
    readAsset.mockResolvedValue(asset(EMPTY_SCENE_JSON))
    await expect(loadDrawingScene('/v', 'Sketch.excalidraw')).resolves.toEqual({ elements: [], appState: {}, files: {} })
    expect(readAsset).toHaveBeenCalledWith('/v', 'Sketch.excalidraw')
  })

  it('a missing sidecar rejects — the preview turns that into its broken state', async () => {
    readAsset.mockRejectedValue(new BridgeRequestError('NOT_FOUND', 'no such asset'))
    await expect(loadDrawingScene('/v', 'Gone.excalidraw')).rejects.toThrow('no such asset')
  })
})
