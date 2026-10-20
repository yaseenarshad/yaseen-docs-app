/**
 * Reading a drawing sidecar (YAZ-878): the base64 → UTF-8 → JSON path, the target that goes to
 * `readAsset` RAW, and the ONE rule for everything that is not a scene — throw, which upstream
 * is the preview's broken state.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api'
import { BridgeRequestError } from '../api'
import { EMPTY_SCENE_JSON } from './createDrawing'
import { isDrawingTarget, loadDrawingScene, openDrawing, openViewport, parseScene, parseSceneText } from './drawingScene'

vi.mock('../api', async (original) => ({
  ...(await original<typeof import('../api')>()),
  api: { readAsset: vi.fn(), drawing: { load: vi.fn() } },
}))

const readAsset = vi.mocked(api.readAsset)
const drawingLoad = vi.mocked(api.drawing.load)

/** What the asset pipe hands back: the file's bytes, base64, plus the save guard (YAZ-879). */
const asset = (text: string) => ({
  path: `/v/assets/drawings/x.excalidraw`,
  mime: 'application/json',
  data: btoa(String.fromCharCode(...new TextEncoder().encode(text))),
  size: text.length,
  mtime: 1234,
})

beforeEach(() => {
  readAsset.mockReset()
  drawingLoad.mockReset()
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

describe('openDrawing (YAZ-879)', () => {
  it('keeps the RESOLVED path and the read mtime — the two facts a save needs', async () => {
    readAsset.mockResolvedValue(asset(EMPTY_SCENE_JSON))
    // The target went in fuzzy (a bare basename); what comes back is the explicit path a write
    // takes, because writes are never fuzzy (YAZ-876).
    await expect(openDrawing('/v', 'Sketch.excalidraw')).resolves.toEqual({
      scene: { elements: [], appState: {}, files: {} },
      path: '/v/assets/drawings/x.excalidraw',
      mtime: 1234,
    })
  })
})

/**
 * A scene a drawing TAB saved is lean (YAZ-3028: its pictures in `assets/`); the embed reader fills
 * the pictures it names from the store, so a note preview and the modal never lose them.
 */
describe('a lean scene gets its pictures from the store (YAZ-3028)', () => {
  const image = (fileId: string, over: Record<string, unknown> = {}) => ({ id: `el-${fileId}`, type: 'image', fileId, ...over })
  const png = { mimeType: 'image/png', dataURL: 'data:image/png;base64,aGk=' }
  const stored = (files: Record<string, typeof png>) => ({ path: '/v/assets/drawings/x.excalidraw', json: '', mtime: 1, size: 1, files, stored: Object.keys(files) })

  it('a sidecar that carries its pictures never asks the store', async () => {
    readAsset.mockResolvedValue(asset(JSON.stringify({ elements: [image('a')], files: { a: { id: 'a', ...png } } })))
    const { scene } = await openDrawing('/v', 'x.excalidraw')
    expect(drawingLoad).not.toHaveBeenCalled()
    expect(scene.files).toEqual({ a: { id: 'a', ...png } })
  })

  it('fills each missing id from `drawing:load` at the RESOLVED path; an id found nowhere, or a deleted element, stays out', async () => {
    readAsset.mockResolvedValue(asset(JSON.stringify({ elements: [image('a'), image('gone'), image('old', { isDeleted: true })], files: {} })))
    drawingLoad.mockResolvedValue(stored({ a: png }))
    const scene = await loadDrawingScene('/v', 'x.excalidraw')
    expect(drawingLoad).toHaveBeenCalledWith({ root: '/v', path: '/v/assets/drawings/x.excalidraw' })
    expect(Object.keys(scene.files ?? {})).toEqual(['a'])
    expect(scene.files?.a).toMatchObject({ id: 'a', ...png })
  })

  it('a store read that fails keeps the scene as the sidecar said: a picture never costs the drawing', async () => {
    readAsset.mockResolvedValue(asset(JSON.stringify({ elements: [image('a')], files: {} })))
    drawingLoad.mockRejectedValue(new BridgeRequestError('IO_ERROR', 'disk went away'))
    await expect(loadDrawingScene('/v', 'x.excalidraw')).resolves.toMatchObject({ files: {} })
  })
})

/** A drawing TAB's scene text (Draw's YAZ-1810): every throw is a file a user can really hand it. */
describe('parseSceneText', () => {
  it('reads elements, appState and files; a missing or ARRAY appState / files is an empty object', () => {
    expect(parseSceneText(JSON.stringify({ elements: [{ id: 'a' }], appState: { gridSize: 20 }, files: { f: {} } }))).toEqual({ elements: [{ id: 'a' }], appState: { gridSize: 20 }, files: { f: {} } })
    expect(parseSceneText(JSON.stringify({ elements: [], appState: [], files: [] }))).toEqual({ elements: [], appState: {}, files: {} })
  })

  it.each([[''], ['{"elements": ['], ['[]'], ['null'], ['{}'], ['{"elements": {}}']])('throws on %j', (text) => {
    expect(() => parseSceneText(text)).toThrow()
  })
})

/** Fit-on-open (Draw's 🔒 YAZ-1855 D1): ALL live content, never past 100%; an empty drawing stays at 100%. */
describe('openViewport', () => {
  const scene = (elements: unknown[]) => ({ elements, appState: {}, files: {} })
  it('fits every live element, scaling down only, and has nothing to fit on an empty or all-deleted drawing', () => {
    const live = { id: 'live' }
    expect(openViewport(scene([{ id: 'gone', isDeleted: true }, live]))).toEqual({ viewport: { target: [live], fit: 'scale-down' } })
    expect(openViewport(scene([]))).toBeUndefined()
    expect(openViewport(scene([{ id: 'gone', isDeleted: true }]))).toBeUndefined()
  })
})
