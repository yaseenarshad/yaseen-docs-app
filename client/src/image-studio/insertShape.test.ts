/**
 * What an Image Studio click does to the scene (YAZ-1818). The engine is a stand-in with the four
 * methods an insert uses, so the shape path, the image path and the `assets/` handover (🔒 YAZ-1775 D3, the
 * YAZ-1811 save path) are all provable without mounting a canvas.
 */
import { describe, expect, it, vi } from 'vitest'
import { referencedFileIds, unpersistedFiles, type DrawingFileData } from '@shared/drawingAssets'
import { bytesFromDataUrl, extensionForMime, fileFromImport, IMAGE_STUDIO_INSERTION, insertImage, insertShape, type InsertEngine, type InsertTarget } from './insertShape'
import { BASIC_SHAPES } from './shapes'

/** The engine's two insert values; `convertToExcalidrawElements` stamps ids the way the real one does. */
function fakeEngine(): InsertEngine & { calls: unknown[][] } {
  const calls: unknown[][] = []
  return {
    calls,
    convertToExcalidrawElements: ((skeletons: unknown[]) => {
      calls.push(skeletons)
      return skeletons.map((skeleton, index) => ({ ...(skeleton as object), id: `new-${index}` }))
    }) as unknown as InsertEngine['convertToExcalidrawElements'],
    CaptureUpdateAction: { IMMEDIATELY: 'IMMEDIATELY' } as unknown as InsertEngine['CaptureUpdateAction'],
  }
}

/** The engine's imperative handle, reduced to what an insert touches, plus what it recorded. */
function fakeApi(existing: unknown[] = [], appStateOverrides: Record<string, unknown> = {}) {
  const scene: { elements: unknown[]; appState: Record<string, unknown>; files: Record<string, DrawingFileData> } = { elements: [...existing], appState: {}, files: {} }
  const updateScene = vi.fn((data: { elements?: unknown; appState?: unknown }) => {
    if (data.elements) scene.elements = data.elements as unknown[]
    if (data.appState) Object.assign(scene.appState, data.appState)
  })
  const insertImages = vi.fn(async (files: File[], _x?: number, _y?: number, options?: { viewportSizing?: unknown }) => {
    // What the engine does with an image: content-address the bytes, register them, and add an
    // element that NAMES the id. Both halves matter to the save path below.
    for (const file of files) {
      const fileId = `sha1-of-${file.name}`
      scene.files[fileId] = { mimeType: file.type, dataURL: `data:${file.type};base64,AAAA` }
      scene.elements = [...scene.elements, { type: 'image', id: `img-${fileId}`, fileId }]
    }
    return { options }
  })
  const api = {
    getAppState: () => ({ width: 1000, height: 800, zoom: { value: 2 }, scrollX: 100, scrollY: 50, ...appStateOverrides }),
    getSceneElementsIncludingDeleted: () => scene.elements,
    updateScene,
    insertImages,
  } as unknown as InsertTarget
  return { api, scene, updateScene, insertImages }
}

describe('inserting a shape', () => {
  it('puts it at the middle of what the user can see, scaled to the current zoom', () => {
    const engine = fakeEngine()
    const { api } = fakeApi()
    insertShape(engine, api, BASIC_SHAPES[0])
    // 1000/2/2 - 100 = 150 ; 800/2/2 - 50 = 150 ; at zoom 2 a 160x110 box scales to 80x55 centred on (150, 150).
    expect(engine.calls[0][0]).toMatchObject({ x: 150 - 40, y: 150 - 27.5, width: 80, height: 55, strokeWidth: 1, roughness: 0, customData: { styleScale: 2 } })
  })

  it('keeps sizeScale = 1 and omits styleScale at zoom 1 when viewport fits', () => {
    const engine = fakeEngine()
    const { api } = fakeApi([], { zoom: { value: 1 }, scrollX: 0, scrollY: 0 })
    insertShape(engine, api, BASIC_SHAPES[0])
    const [skeleton] = engine.calls[0] as [Record<string, unknown>]
    expect(skeleton).toMatchObject({ x: 500 - 80, y: 400 - 55, width: 160, height: 110, strokeWidth: 2, roughness: 0 })
    expect(skeleton.customData).toBeUndefined()
  })

  it('clamps sizeScale so the longest side never exceeds 55 % of a small viewport', () => {
    const engine = fakeEngine()
    // Small 300x200 viewport at zoom 1 → max side = 200 * 0.55 = 110; a 160x110 rectangle scales by 110/160.
    const { api } = fakeApi([], { width: 300, height: 200, zoom: { value: 1 }, scrollX: 0, scrollY: 0 })
    insertShape(engine, api, BASIC_SHAPES[0])
    const [skeleton] = engine.calls[0] as [{ width: number; height: number }]
    expect(skeleton.width).toBeCloseTo(110, 6)
    expect(skeleton.height).toBeCloseTo((110 * 110) / 160, 6)
  })

  it('inherits active board colors, fillStyle, roughness, and vector stroke width', () => {
    const engine = fakeEngine()
    const { api } = fakeApi([], {
      zoom: { value: 3 },
      scrollX: 0,
      scrollY: 0,
      currentItemStrokeColor: '#2f9e44',
      currentItemBackgroundColor: '#d3f9d8',
      currentItemFillStyle: 'hachure',
      currentItemVectorStrokeWidth: 4,
      currentItemRoughness: 2,
    })
    insertShape(engine, api, BASIC_SHAPES[0])
    expect(engine.calls[0][0]).toMatchObject({
      strokeColor: '#2f9e44',
      backgroundColor: '#d3f9d8',
      fillStyle: 'hachure',
      strokeWidth: Number((4 / 3).toPrecision(4)),
      roughness: 2,
      customData: { styleScale: 3 },
    })
  })

  it('leaves strokeWidth unscaled and omits styleScale when scaleStylesWithZoom is off', () => {
    const engine = fakeEngine()
    const { api } = fakeApi([], {
      zoom: { value: 2 },
      currentItemVectorStrokeWidth: 4,
    })
    insertShape(engine, api, BASIC_SHAPES[0], { scaleStylesWithZoom: false })
    const [skeleton] = engine.calls[0] as [Record<string, unknown>]
    expect(skeleton.strokeWidth).toBe(4)
    expect(skeleton.customData).toBeUndefined()
  })

  it('appends to the scene rather than replacing it, and selects only what it added', () => {
    const { api, scene, updateScene } = fakeApi([{ id: 'already-here' }])
    insertShape(fakeEngine(), api, BASIC_SHAPES[0])
    expect(scene.elements).toHaveLength(2)
    expect(updateScene.mock.calls[0][0]).toMatchObject({ appState: { selectedElementIds: { 'new-0': true } }, captureUpdate: 'IMMEDIATELY' })
  })

  it('commits immediately, so the insert is one step of undo', () => {
    const { api, updateScene } = fakeApi()
    insertShape(fakeEngine(), api, BASIC_SHAPES[6])
    expect((updateScene.mock.calls[0][0] as { captureUpdate: string }).captureUpdate).toBe('IMMEDIATELY')
  })

  it('touches no bytes at all — a shape is geometry', async () => {
    const { api, scene } = fakeApi()
    insertShape(fakeEngine(), api, BASIC_SHAPES[2])
    expect(scene.files).toEqual({})
  })
})

describe('turning imported bytes into a file', () => {
  it('names the extension after the mime, and falls back to jpg', () => {
    expect(extensionForMime('image/svg+xml')).toBe('svg')
    expect(extensionForMime('image/png')).toBe('png')
    expect(extensionForMime('image/webp')).toBe('webp')
    expect(extensionForMime('image/gif')).toBe('gif')
    expect(extensionForMime('image/jpeg')).toBe('jpg')
    expect(extensionForMime('application/octet-stream')).toBe('jpg')
  })

  it('decodes the dataURL main built, byte for byte', () => {
    expect([...bytesFromDataUrl(`data:image/png;base64,${btoa('PNGDATA')}`)]).toEqual([...new TextEncoder().encode('PNGDATA')])
  })

  it('flattens the colon in a provider id, so the name is a name', () => {
    const file = fileFromImport({ providerId: 'noto:money-bag' }, { mimeType: 'image/svg+xml', dataURL: `data:image/svg+xml;base64,${btoa('<svg/>')}` })
    expect(file.name).toBe('noto-money-bag.svg')
    expect(file.type).toBe('image/svg+xml')
    expect(file.size).toBe(6)
  })
})

describe('inserting an image', () => {
  it('asks the engine for Image Studio sizing — 320 px, capped at 55 % of the viewport', async () => {
    const { api, insertImages } = fakeApi()
    await insertImage(api, new File(['x'], 'a.png', { type: 'image/png' }))
    expect(IMAGE_STUDIO_INSERTION).toEqual({ targetScreenSize: 320, viewportFraction: 0.55 })
    expect(insertImages.mock.calls[0][3]).toEqual({ viewportSizing: IMAGE_STUDIO_INSERTION })
    // The engine picks the position, which is what makes it land where the user is looking.
    expect(insertImages.mock.calls[0][1]).toBeUndefined()
    expect(insertImages.mock.calls[0][2]).toBeUndefined()
  })

  /**
   * 🔒 YAZ-1775 D3 / YAZ-1811: the studio never writes to disk. What it does is leave the engine holding bytes the
   * store has not got — and THAT is what the save path picks up. This is the handover, asserted
   * with the very function `DrawingEditor` uses (`unpersistedFiles`) over the state the insert left.
   */
  it('leaves the inserted bytes reported as UNPERSISTED, which is how they become an assets/ file', async () => {
    const { api, scene } = fakeApi()
    const persisted = new Set<string>(['sha1-of-something-else'])

    await insertImage(api, fileFromImport({ providerId: 'noto:money-bag' }, { mimeType: 'image/svg+xml', dataURL: `data:image/svg+xml;base64,${btoa('<svg/>')}` }))

    const referenced = referencedFileIds(scene.elements)
    const pending = unpersistedFiles(scene.files, referenced, persisted)
    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({ fileId: 'sha1-of-noto-money-bag.svg', mimeType: 'image/svg+xml' })

    // And once the save has reported it back, the same picture is never shipped a second time.
    expect(unpersistedFiles(scene.files, referenced, new Set([...persisted, pending[0].fileId]))).toEqual([])
  })

  it('reports nothing when the inserted image has since been deleted from the scene', async () => {
    const { api, scene } = fakeApi()
    await insertImage(api, new File(['x'], 'a.png', { type: 'image/png' }))
    scene.elements = scene.elements.map((element) => ({ ...(element as object), isDeleted: true }))
    expect(unpersistedFiles(scene.files, referencedFileIds(scene.elements), new Set())).toEqual([])
  })
})
