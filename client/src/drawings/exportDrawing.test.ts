/**
 * The standalone export's assembly (🔒 YAZ-1775 D3, YAZ-1821). `serializeAsJSON` is a stub — the engine's
 * own writer, which this module deliberately does not reimplement — so what is pinned here is
 * WHICH FILES are handed to it, which is the whole of what an export decides.
 */
import { describe, expect, it, vi } from 'vitest'
import { assembleExportCopy, assembleStandaloneScene, embeddedFiles, exportFileName, type ExportCopyEngine, type ExportEngine } from './exportDrawing'

const image = (id: string, fileId: string, over: Record<string, unknown> = {}) => ({ id, type: 'image', fileId, ...over })
const bytes = (id: string) => ({ mimeType: 'image/png', dataURL: `data:image/png;base64,${id}` })

/** Records what it was handed and answers something that is visibly the engine's own shape. */
function stubEngine() {
  const serializeAsJSON = vi.fn((elements: unknown, appState: unknown, files: unknown) => JSON.stringify({ type: 'excalidraw', version: 2, elements, appState, files }))
  return { engine: { serializeAsJSON } as unknown as ExportEngine, serializeAsJSON }
}

describe('embeddedFiles — what a standalone copy has to carry', () => {
  it('is exactly what a LIVE image element names', () => {
    const files = { f1: bytes('f1'), f2: bytes('f2') }
    expect(embeddedFiles([image('a', 'f1')], files)).toEqual({ f1: bytes('f1') })
  })

  it('EXCLUDES a file only a deleted element names — an undo must not post a deleted picture', () => {
    const files = { live: bytes('live'), undone: bytes('undone') }
    expect(embeddedFiles([image('a', 'live'), image('b', 'undone', { isDeleted: true })], files)).toEqual({ live: bytes('live') })
  })

  it('ignores bytes nothing on the canvas names at all', () => {
    expect(embeddedFiles([], { orphan: bytes('orphan') })).toEqual({})
  })

  it('tolerates a referenced id with no bytes — the board already draws a placeholder for it', () => {
    expect(embeddedFiles([image('a', 'missing')], {})).toEqual({})
  })
})

describe('assembleStandaloneScene', () => {
  it('hands the engine’s OWN writer the elements, the appState and the embedded files, as "local"', () => {
    const { engine, serializeAsJSON } = stubEngine()
    const elements = [image('a', 'f1')]
    const appState = { viewBackgroundColor: '#fffce8' }
    assembleStandaloneScene(engine, { elements, appState, files: { f1: bytes('f1'), gone: bytes('gone') } })
    expect(serializeAsJSON).toHaveBeenCalledExactlyOnceWith(elements, appState, { f1: bytes('f1') }, 'local')
  })

  it('the bytes CARRY the picture — an exported file opens anywhere with its images', () => {
    const { engine } = stubEngine()
    const json = assembleStandaloneScene(engine, { elements: [image('a', 'f1')], appState: {}, files: { f1: bytes('f1') } })
    const parsed = JSON.parse(json) as { files: Record<string, unknown> }
    expect(parsed.files).toEqual({ f1: bytes('f1') })
    // …and it ends with a newline, exactly as a file this app saves does.
    expect(json.endsWith('\n')).toBe(true)
  })

  it('a deleted element’s bytes never reach the file', () => {
    const { engine } = stubEngine()
    const json = assembleStandaloneScene(engine, {
      elements: [image('a', 'live'), image('b', 'undone', { isDeleted: true })],
      appState: {},
      files: { live: bytes('live'), undone: bytes('undone') },
    })
    // The element is still in the scene (the engine's own writer decides that); its BYTES are not.
    const parsed = JSON.parse(json) as { files: Record<string, unknown> }
    expect(Object.keys(parsed.files)).toEqual(['live'])
    expect(json).not.toContain('data:image/png;base64,undone')
  })

  it('a board with no images is just a scene', () => {
    const { engine, serializeAsJSON } = stubEngine()
    assembleStandaloneScene(engine, { elements: [{ id: 'r', type: 'rectangle' }], appState: {}, files: {} })
    expect(serializeAsJSON.mock.calls[0][2]).toEqual({})
  })
})

describe('exportFileName', () => {
  it('is the board’s own name with the extension it is getting back', () => {
    expect(exportFileName('Roadmap.excalidraw')).toBe('Roadmap.excalidraw')
    expect(exportFileName('Roadmap')).toBe('Roadmap.excalidraw')
    expect(exportFileName('03 Legacy embedded.excalidraw')).toBe('03 Legacy embedded.excalidraw')
  })

  it('falls back rather than offering a sheet a nameless file', () => {
    expect(exportFileName('.excalidraw')).toBe('Drawing.excalidraw')
    expect(exportFileName('   ')).toBe('Drawing.excalidraw')
  })
})

describe('standard fonts in an exported copy (YAZ-3943 D14)', () => {
  const textEl = (id: string, fontFamily: number, over: Record<string, unknown> = {}) => ({ id, type: 'text', fontFamily, ...over })
  const runs = [{ start: 0, end: 2, bold: true }]

  it('Export Excalidraw Drawing… sets the flag: 10-13 become Nunito (6), 14 becomes Comic Shanns (8), the rest and the text runs stay', () => {
    const { engine, serializeAsJSON } = stubEngine()
    const elements = [textEl('a', 10), textEl('b', 11), textEl('c', 12), textEl('d', 13, { textRuns: runs }), textEl('e', 14), textEl('f', 5), { id: 'g', type: 'rectangle' }]
    assembleStandaloneScene(engine, { elements, appState: { currentItemFontFamily: 14 }, files: {} }, { standardFonts: true })
    const [sent, appState] = serializeAsJSON.mock.calls[0] as unknown as [Array<Record<string, unknown>>, Record<string, unknown>]
    expect(sent.map((e) => e.fontFamily)).toEqual([6, 6, 6, 6, 8, 5, undefined])
    expect(sent[3].textRuns).toEqual(runs)
    expect(sent[6]).toBe(elements[6])
    expect(appState.currentItemFontFamily).toBe(8)
    // The board's own elements are not touched: only the copy changes.
    expect(elements.map((e) => (e as Record<string, unknown>).fontFamily)).toEqual([10, 11, 12, 13, 14, 5, undefined])
  })

  it('without the flag (the page embed\'s sidecar, Share Link) every element and the appState go to the writer as they are', () => {
    const { engine, serializeAsJSON } = stubEngine()
    const elements = [textEl('a', 10), textEl('e', 14)]
    const appState = { currentItemFontFamily: 11 }
    assembleStandaloneScene(engine, { elements, appState, files: {} })
    expect(serializeAsJSON.mock.calls[0][0]).toBe(elements)
    expect(serializeAsJSON.mock.calls[0][1]).toBe(appState)
  })
})

describe('the export copy is measured again in its new font (YAZ-3943 1D1)', () => {
  /** The engine's font loader and measure as stand-ins: the measure widens every text box it is handed. */
  function copyEngine(fontsLoad: 'ok' | 'fail' = 'ok') {
    const { engine, serializeAsJSON } = stubEngine()
    const loadElementsFonts = vi.fn(async () => {
      if (fontsLoad === 'fail') throw new Error('offline')
      return []
    })
    const restoreElements = vi.fn((elements: Array<Record<string, unknown>>, _existing: unknown, _opts: unknown) => elements.map((e) => (e.type === 'text' ? { ...e, width: 999 } : e)))
    return { engine: { ...engine, Fonts: { loadElementsFonts }, restoreElements } as unknown as ExportCopyEngine, serializeAsJSON, loadElementsFonts, restoreElements }
  }
  const textEl = (id: string, fontFamily: number) => ({ id, type: 'text', fontFamily, width: 10 })

  it('loads the new fonts, then the engine measures the swapped boxes (`refreshDimensions`), and the copy carries those sizes', async () => {
    const { engine, serializeAsJSON, loadElementsFonts, restoreElements } = copyEngine()
    await assembleExportCopy(engine, { elements: [textEl('a', 11), textEl('b', 5)], appState: {}, files: {} })
    expect(loadElementsFonts).toHaveBeenCalledWith([textEl('a', 6), textEl('b', 5)])
    expect(restoreElements).toHaveBeenCalledWith([textEl('a', 6), textEl('b', 5)], null, { refreshDimensions: true })
    expect((serializeAsJSON.mock.calls[0][0] as Array<Record<string, unknown>>).map((e) => [e.fontFamily, e.width])).toEqual([[6, 999], [5, 999]])
    expect(loadElementsFonts.mock.invocationCallOrder[0]).toBeLessThan(restoreElements.mock.invocationCallOrder[0])
  })

  it('a board with no font to swap is not measured; a font that will not load leaves the boxes as they were', async () => {
    const plain = copyEngine()
    await assembleExportCopy(plain.engine, { elements: [textEl('b', 5)], appState: {}, files: {} })
    expect(plain.loadElementsFonts).not.toHaveBeenCalled()
    expect(plain.restoreElements).not.toHaveBeenCalled()
    const offline = copyEngine('fail')
    await assembleExportCopy(offline.engine, { elements: [textEl('a', 12)], appState: {}, files: {} })
    expect(offline.restoreElements).not.toHaveBeenCalled()
    expect((offline.serializeAsJSON.mock.calls[0][0] as Array<Record<string, unknown>>).map((e) => [e.fontFamily, e.width])).toEqual([[6, 10]])
  })
})
