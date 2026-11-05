/**
 * The drawing document's chrome, with the ENGINE replaced by a stub (Draw's 🔒 YAZ-1810, ported by YAZ-3028).
 *
 * `ExcalidrawSurface` is mocked, which is the point: the seam says the host knows nothing about
 * `@excalidraw/excalidraw` beyond a version number, a `serialize()` thunk and two imperative
 * calls, and a test that can drive all of this without the package is that claim, proven. The
 * stub exposes the surface's three outward moves — emit a snapshot, hand over the API, fail —
 * so every drawing-side rule below (baseline, debounce, reload, the image bytes, the chips) runs
 * through the real `Autosave` and the real host. The rules both boards share — conflict, flush,
 * retire — are pinned once, in `documents/useDocumentHost.test.tsx`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_CANVAS_PREFS, type DrawingLoadResponse, type GithubSyncStatus } from '@shared/types'
import type { DrawingFileData } from '@shared/drawingAssets'
import type { DrawingSnapshot, DrawingSurfaceApi, DrawingSurfaceProps } from './ExcalidrawSurface'
import { requestBoardCommand, type BoardCommand } from '../documents/boardCommand'
import { fakeWatch, withRevealObserver } from '../documents/boardTestKit'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      drawing: { load: vi.fn(), save: vi.fn() },
      dialog: { saveDrawing: vi.fn(), savePdf: vi.fn() },
      setBoardPictures: vi.fn(),
      // YAZ-3943 demo 2 and round 3: the cog's hover switch, its folder pick, and this Mac's allowed folders.
      setBoardHoverLinks: vi.fn(),
      setBoardFoldArrows: vi.fn(),
      pickPicturesFolder: vi.fn(),
      pictureFolders: { list: vi.fn(async () => []), allow: vi.fn(async () => []) },
      app: { ...actual.api.app, home: vi.fn(async () => '/Users/me') },
    },
  }
})

// The link card's dwell: a spy that calls through, so a test can read whether hover is on for this board.
vi.mock('../tabs/cardPreview', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tabs/cardPreview')>()
  return { ...actual, useCardPreview: vi.fn(actual.useCardPreview) }
})

/** The engine stub: records what it was given and hands the host the two callbacks it owns. */
const surface = {
  props: null as DrawingSurfaceProps | null,
  emit: null as ((snapshot: DrawingSnapshot) => void) | null,
  fail: null as ((message: string) => void) | null,
  /** What `replaceScene` will report as the engine's settled version. */
  nextReplaceVersion: 0,
  replaced: [] as unknown[],
  refreshes: 0,
  /** What the application menu's three canvas items (🔒 YAZ-1775 D10 / 🔒 YAZ-1775 D3) reached this canvas as. */
  commands: [] as BoardCommand[],
  /** What `exportScene()` answers — the standalone bytes the save sheet is offered (🔒 YAZ-1775 D3). */
  exportedScene: '{"type":"excalidraw","elements":[],"files":{}}\n',
  /** What `pictures()` answers: the cog's size row (YAZ-3943 D5). */
  pictures: { bytes: 0, count: 0, missing: 0 },
  /** The pan and zoom the engine is on (YAZ-3737 D13). */
  canvas: { scrollX: 0, scrollY: 0, zoom: 1 },
}

vi.mock('./ExcalidrawSurface', async (importOriginal) => ({
  // The real constant, so a change to the seam's message cannot slip past this suite.
  ENGINE_LOAD_FAILED: ((await importOriginal()) as { ENGINE_LOAD_FAILED: string }).ENGINE_LOAD_FAILED,
  ExcalidrawSurface: (props: DrawingSurfaceProps) => {
    surface.props = props
    surface.emit = props.onSnapshot
    surface.fail = props.onFailed
    props.onApi?.({
      refresh: () => {
        surface.refreshes += 1
      },
      focus: () => {},
      replaceScene: (scene) => {
        surface.replaced.push(scene)
        return surface.nextReplaceVersion
      },
      openImageExport: () => {
        surface.commands.push({ kind: 'export-image' })
      },
      setCanvasBackground: (color) => {
        surface.commands.push({ kind: 'canvas-background', color })
      },
      exportScene: () => {
        surface.commands.push({ kind: 'export-drawing' })
        return Promise.resolve(surface.exportedScene)
      },
      pictures: () => surface.pictures,
      canvas: () => surface.canvas,
    } satisfies DrawingSurfaceApi)
    // The real engine renders this into its own top-right row; the stub just puts it on screen,
    // because WHERE the chips go is the surface's business and WHAT they say is the host's.
    return <div data-testid="surface">{props.renderTopRight?.()}</div>
  },
}))

import { api, BridgeRequestError } from '../api'
import { readPageView } from '../lib/pageView'
import { _resetRenameContinuity } from '../lib/renameContinuity'
import { createWikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { createWikilinkCandidateSource } from '../editor/wikilink/wikilinkPicker'
import { BROKEN_DRAWING_DOCUMENT, DrawingEditor, OUTSIDE_FOLDER_WARNING, picturesMoveAsk, picturesPlaceText } from './DrawingEditor'
import { ALLOW_FOLDER_TITLE, allowFolderBody } from './usePicturesFolderAllow'
import { useCardPreview } from '../tabs/cardPreview'
import { ENGINE_LOAD_FAILED } from './ExcalidrawSurface'

const load = vi.mocked(api.drawing.load)
const save = vi.mocked(api.drawing.save)
const saveDrawing = vi.mocked(api.dialog.saveDrawing)
const setBoardPictures = vi.mocked(api.setBoardPictures)
const savePdf = vi.mocked(api.dialog.savePdf)

const ROOT = '/vault'
const PATH = '/vault/Board.excalidraw'

function scene(elements: unknown[] = []): string {
  return `${JSON.stringify({ type: 'excalidraw', version: 2, elements, appState: {}, files: {} })}\n`
}

function loaded(over: Partial<DrawingLoadResponse> = {}): DrawingLoadResponse {
  return { path: PATH, json: scene(), mtime: 100, size: 42, files: {}, stored: [], ...over }
}

const { watch, watcherSaw } = fakeWatch()

let root: Root | null = null
let container: HTMLElement

function render(props: Partial<Parameters<typeof DrawingEditor>[0]> = {}): void {
  act(() => root?.render(<DrawingEditor root={ROOT} path={PATH} watch={watch} {...props} />))
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

/** Emit a snapshot whose `serialize()` answers `json` and, optionally, live engine files. */
function emit(version: number, json = scene([{ id: 'a' }]), files: Record<string, DrawingFileData> = {}, referenced = new Set(Object.keys(files))): void {
  act(() => surface.emit?.({ version, serialize: () => ({ json, files, referenced }) }))
}

const chips = (): string => container.textContent ?? ''

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  surface.props = null
  surface.emit = null
  surface.fail = null
  surface.replaced = []
  surface.refreshes = 0
  surface.nextReplaceVersion = 0
  surface.commands = []
  surface.pictures = { bytes: 0, count: 0, missing: 0 }
  Object.defineProperty(window, 'yaseenDocs', {
    configurable: true,
    writable: true,
    value: {
      window: {
        onFlush: () => () => {},
      },
    },
  })
  load.mockResolvedValue(loaded())
  save.mockResolvedValue({ path: PATH, mtime: 200, size: 50, persisted: [] })
  saveDrawing.mockReset().mockResolvedValue({ cancelled: true })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container.remove()
  _resetRenameContinuity()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('opening', () => {
  it('reads through drawing:load and opens the canvas on the scene it answered', async () => {
    load.mockResolvedValue(loaded({ json: scene([{ id: 'x', type: 'rectangle' }]) }))
    render()
    await flush()
    expect(load).toHaveBeenCalledWith({ root: ROOT, path: PATH })
    expect(surface.props?.scene.elements).toEqual([{ id: 'x', type: 'rectangle' }])
  })

  it('hands the images from the store to the engine in its own shape, keyed by id', async () => {
    load.mockResolvedValue(loaded({ files: { abc: { mimeType: 'image/png', dataURL: 'data:image/png;base64,aGk=' } }, stored: ['abc'] }))
    render()
    await flush()
    expect(surface.props?.scene.files).toMatchObject({ abc: { id: 'abc', mimeType: 'image/png', dataURL: 'data:image/png;base64,aGk=' } })
  })

  it('shows ONE readable message — never a blank pane — for a load failure and for bytes that are not a scene', async () => {
    load.mockRejectedValue(new Error('nope'))
    render()
    await flush()
    expect(chips()).toContain(BROKEN_DRAWING_DOCUMENT)

    load.mockResolvedValue(loaded({ json: '' }))
    render({ path: '/vault/Corrupt.excalidraw' })
    await flush()
    expect(chips()).toContain(BROKEN_DRAWING_DOCUMENT)
    expect(container.querySelector('[data-testid="surface"]')).toBeNull()
  })

  it('shows the engine`s own failure when the package will not load', async () => {
    render()
    await flush()
    act(() => surface.fail?.(ENGINE_LOAD_FAILED))
    expect(chips()).toContain(ENGINE_LOAD_FAILED)
  })
})

describe('autosave', () => {
  it('treats the FIRST snapshot as the clean baseline and never writes it back', async () => {
    render()
    await flush()
    emit(7)
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(save).not.toHaveBeenCalled()
    expect(chips()).toContain('Saved')
  })

  it('debounces a change by 500 ms, serialises ONCE when the timer fires, and guards on the load mtime', async () => {
    render()
    await flush()
    emit(7)
    const serialize = vi.fn(() => ({ json: scene([{ id: 'b' }]), files: {}, referenced: new Set<string>() }))
    act(() => surface.emit?.({ version: 8, serialize }))
    expect(chips()).toContain('Unsaved')
    act(() => surface.emit?.({ version: 9, serialize }))
    expect(save).not.toHaveBeenCalled()
    // The version moved twice; the scene is serialised once, when the save actually runs.
    expect(serialize).not.toHaveBeenCalled()
    await act(async () => {
      vi.advanceTimersByTime(500)
    })
    expect(serialize).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith({ root: ROOT, path: PATH, json: scene([{ id: 'b' }]), expectedMtime: 100, newFiles: [] })
    expect(chips()).toContain('Saved')
  })

  it('⌘S flushes immediately, without waiting for the debounce', async () => {
    render()
    await flush()
    emit(1)
    emit(2)
    await act(async () => {
      container.querySelector('.drawing-editor')?.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true }))
      await Promise.resolve()
    })
    expect(save).toHaveBeenCalledTimes(1)
  })
})

describe('external changes', () => {
  it('RELOADS a clean tab from disk and does not write the reloaded bytes back', async () => {
    render()
    await flush()
    emit(5)
    load.mockResolvedValue(loaded({ json: scene([{ id: 'fromDisk' }]), mtime: 400 }))
    surface.nextReplaceVersion = 11
    watcherSaw({ type: 'change', path: PATH, mtime: 400 })
    await flush()
    expect(surface.replaced).toHaveLength(1)
    expect((surface.replaced[0] as { elements: unknown[] }).elements).toEqual([{ id: 'fromDisk' }])
    // The engine answers `updateScene` with its own onChange; that snapshot is the new BASELINE.
    emit(11)
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(save).not.toHaveBeenCalled()
    expect(chips()).toContain('Saved')
  })

  it('an edit straight after a reload is guarded by the reloaded mtime, not the one before it (YAZ-2073 2F)', async () => {
    render()
    await flush()
    emit(5)
    load.mockResolvedValue(loaded({ mtime: 400 }))
    surface.nextReplaceVersion = 11
    watcherSaw({ type: 'change', path: PATH, mtime: 400 })
    await flush()
    emit(11) // the engine's answer to the reload: the baseline
    emit(12) // the user's first stroke
    await act(async () => {
      vi.advanceTimersByTime(500)
    })
    expect(save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ expectedMtime: 400 }))
    expect(chips()).not.toContain('File changed on disk.')
  })

  it('takes whatever version the engine settled on after a reload, even if it is not the one replaceScene predicted', async () => {
    render()
    await flush()
    emit(5)
    load.mockResolvedValue(loaded({ mtime: 400 }))
    surface.nextReplaceVersion = 11
    watcherSaw({ type: 'change', path: PATH, mtime: 400 })
    await flush()
    emit(12) // the engine disagreed; it is still the baseline, not an edit
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(save).not.toHaveBeenCalled()
  })
})

describe('🔒 YAZ-1775 D3 — which image bytes a save ships', () => {
  const png = (payload: string): DrawingFileData => ({ mimeType: 'image/png', dataURL: `data:image/png;base64,${payload}` })

  it('ships only the files the store lacks, and never ships one twice', async () => {
    load.mockResolvedValue(loaded({ files: { old: png('bw==') }, stored: ['old'] }))
    render()
    await flush()
    emit(1)
    save.mockResolvedValue({ path: PATH, mtime: 200, size: 50, persisted: ['fresh'] })
    emit(2, scene([{ type: 'image', fileId: 'old' }, { type: 'image', fileId: 'fresh' }]), { old: png('bw=='), fresh: png('Zg==') }, new Set(['old', 'fresh']))
    await act(async () => {
      vi.advanceTimersByTime(500)
    })
    // `old` came back from load as already stored; only `fresh` travels.
    expect(save.mock.calls[0][0].newFiles).toEqual([{ fileId: 'fresh', ...png('Zg==') }])

    // A later save in the same session must not ship `fresh` again: the receipt added it.
    emit(3, scene([{ type: 'image', fileId: 'fresh' }]), { old: png('bw=='), fresh: png('Zg==') }, new Set(['old', 'fresh']))
    await act(async () => {
      vi.advanceTimersByTime(500)
    })
    expect(save.mock.calls[1][0].newFiles).toEqual([])
  })

  it('YAZ-4074 6A item 1: on an inside board, delete, save, undo, save ships the picture again', async () => {
    load.mockResolvedValue(loaded({ json: scene([{ type: 'image', fileId: 'pic' }]), files: { pic: png('cA==') }, stored: ['pic'] }))
    render()
    await flush()
    emit(1)
    // The delete's save: main drops `pic` from the file and says the file now holds no picture.
    save.mockResolvedValueOnce({ path: PATH, mtime: 200, size: 50, persisted: [], inside: true })
    emit(2, scene([{ type: 'image', fileId: 'pic', isDeleted: true }]), { pic: png('cA==') }, new Set())
    await act(async () => {
      vi.advanceTimersByTime(500)
    })
    expect(save.mock.calls[0][0].newFiles).toEqual([])
    // ⌘Z: the canvas still has the bytes in memory, and the file does not, so they travel.
    emit(3, scene([{ type: 'image', fileId: 'pic' }]), { pic: png('cA==') }, new Set(['pic']))
    await act(async () => {
      vi.advanceTimersByTime(500)
    })
    expect(save.mock.calls[1][0].newFiles).toEqual([{ fileId: 'pic', ...png('cA==') }])
  })

  it('never ships a pasted-then-deleted image: only what the scene still references', async () => {
    render()
    await flush()
    emit(1)
    emit(2, scene(), { dropped: png('ZA==') }, new Set())
    await act(async () => {
      vi.advanceTimersByTime(500)
    })
    expect(save.mock.calls[0][0].newFiles).toEqual([])
  })

  it('a LEGACY embedded board comes back as not-stored, so its first save ships the bytes out', async () => {
    load.mockResolvedValue(loaded({ json: scene([{ type: 'image', fileId: 'emb' }]), files: { emb: png('ZQ==') }, stored: [] }))
    render()
    await flush()
    emit(1)
    emit(2, scene([{ type: 'image', fileId: 'emb' }]), { emb: png('ZQ==') }, new Set(['emb']))
    await act(async () => {
      vi.advanceTimersByTime(500)
    })
    expect(save.mock.calls[0][0].newFiles).toEqual([{ fileId: 'emb', ...png('ZQ==') }])
  })

  it('a save that moved the pictures out by the 50 MB rule shows the one notice (YAZ-3943 D5)', async () => {
    const onNotice = vi.fn()
    render({ onNotice })
    await flush()
    emit(1)
    save.mockResolvedValue({ path: PATH, mtime: 200, size: 50, persisted: ['big'], movedOut: true })
    emit(2, scene([{ type: 'image', fileId: 'big' }]), { big: png('Yg==') }, new Set(['big']))
    await act(async () => {
      vi.advanceTimersByTime(500)
    })
    expect(onNotice).toHaveBeenCalledWith("This board's pictures moved to the assets folder, because the file passed 50 MB.")
  })

  it('YAZ-4071 7H: "Keep mine" over a version that lacks a picture ships the picture again', async () => {
    load.mockResolvedValue(loaded({ json: scene([{ type: 'image', fileId: 'pic' }]), files: { pic: png('cA==') }, stored: ['pic'] }))
    render()
    await flush()
    emit(1)
    // A dirty edit; before it saves, another writer saves the board without `pic` (the popup, or the other Mac).
    emit(2, scene([{ type: 'image', fileId: 'pic' }, { id: 'x' }]), { pic: png('cA==') }, new Set(['pic']))
    watcherSaw({ type: 'change', path: PATH, mtime: 300 })
    await flush()
    expect(chips()).toContain('File changed on disk.')
    const keepMine = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Keep mine')!
    await act(async () => keepMine.click())
    await flush()
    expect(save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ expectedMtime: 300, newFiles: [{ fileId: 'pic', ...png('cA==') }] }))
  })

  it('YAZ-4071 7H: a save that moved the pictures out by the 50 MB rule replaces the persisted set, so a picture deleted in it ships again after an undo', async () => {
    load.mockResolvedValue(loaded({ json: scene([{ type: 'image', fileId: 'a' }, { type: 'image', fileId: 'b' }]), files: { a: png('YQ=='), b: png('Yg==') }, stored: ['a', 'b'] }))
    render()
    await flush()
    emit(1)
    // The save deletes `b` and crosses 50 MB: main moves `a` out and names the store's pictures now.
    save.mockResolvedValueOnce({ path: PATH, mtime: 200, size: 50, persisted: ['a'], movedOut: true })
    emit(2, scene([{ type: 'image', fileId: 'a' }, { type: 'image', fileId: 'b', isDeleted: true }]), { a: png('YQ=='), b: png('Yg==') }, new Set(['a']))
    await act(async () => {
      vi.advanceTimersByTime(500)
    })
    // ⌘Z: `b` is in neither the lean file nor the store, so its bytes travel.
    emit(3, scene([{ type: 'image', fileId: 'a' }, { type: 'image', fileId: 'b' }]), { a: png('YQ=='), b: png('Yg==') }, new Set(['a', 'b']))
    await act(async () => {
      vi.advanceTimersByTime(500)
    })
    expect(save.mock.calls[1][0].newFiles).toEqual([{ fileId: 'b', ...png('Yg==') }])
  })

  it('a reload resets the persisted set to what the disk now holds', async () => {
    render()
    await flush()
    emit(1)
    load.mockResolvedValue(loaded({ json: scene([{ type: 'image', fileId: 'disk' }]), files: { disk: png('ZA==') }, stored: ['disk'], mtime: 400 }))
    watcherSaw({ type: 'change', path: PATH, mtime: 400 })
    await flush()
    emit(0) // the engine's post-reload snapshot lands as the baseline
    emit(9, scene([{ type: 'image', fileId: 'disk' }]), { disk: png('ZA==') }, new Set(['disk']))
    await act(async () => {
      vi.advanceTimersByTime(500)
    })
    expect(save.mock.calls[0][0].newFiles).toEqual([])
  })
})

describe('chips and the canvas frame', () => {
  // YAZ-2073 5D: the chips read a store, so a save's status moves (unsaved → saving → saved) repaint
  // the chips alone — the host never re-renders the surface — and a sync change keeps the top-right
  // renderer's identity, which the surface hands straight to the memoized `<Excalidraw>`.
  it('a save and a sync change repaint the chips without a new top-right renderer', async () => {
    const onSyncNow = vi.fn()
    render({ sync: { state: 'pending', enabled: true } as GithubSyncStatus, onSyncNow })
    await flush()
    emit(7)
    const props = surface.props
    emit(8)
    expect(chips()).toContain('Unsaved')
    await act(async () => {
      vi.advanceTimersByTime(500)
    })
    expect(save).toHaveBeenCalledTimes(1)
    expect(chips()).toContain('Saved')
    expect(surface.props).toBe(props)

    render({ sync: { state: 'synced', enabled: true } as GithubSyncStatus, onSyncNow })
    expect(chips()).not.toContain('Pending')
    expect(surface.props?.renderTopRight).toBe(props?.renderTopRight)
  })

  it('re-measures the canvas when the tab becomes visible again (the reveal effect)', async () => {
    await withRevealObserver(async (reveal) => {
      render()
      await flush()
      reveal()
      expect(surface.refreshes).toBe(1)
    })
  })

  it('claims the application menu`s three canvas commands on its own section (🔒 YAZ-1775 D10, 🔒 YAZ-1775 D3)', async () => {
    // The container IS this tab's workspace layer, which is what `requestBoardCommand` selects.
    container.className = 'tabstack__layer'
    render()
    await flush()
    expect(requestBoardCommand({ kind: 'export-image' }, document.body)).toBe(true)
    expect(requestBoardCommand({ kind: 'canvas-background', color: '#fffce8' }, document.body)).toBe(true)
    expect(requestBoardCommand({ kind: 'export-drawing' }, document.body)).toBe(true)
    await flush()
    expect(surface.commands).toEqual([{ kind: 'export-image' }, { kind: 'canvas-background', color: '#fffce8' }, { kind: 'export-drawing' }])
  })

  it('Export Drawing… offers the canvas`s standalone bytes under the BOARD`s name (🔒 YAZ-1775 D3, YAZ-1821)', async () => {
    container.className = 'tabstack__layer'
    const onNotice = vi.fn()
    render({ onNotice })
    await flush()
    saveDrawing.mockResolvedValue({ path: '/Users/x/Desktop/Board.excalidraw' })
    requestBoardCommand({ kind: 'export-drawing' }, document.body)
    await flush()
    expect(saveDrawing).toHaveBeenCalledExactlyOnceWith({ defaultName: 'Board.excalidraw', content: surface.exportedScene })
    expect(onNotice).toHaveBeenCalledWith('Exported to Board.excalidraw')
    // 🔒 YAZ-1775 D3: the VAULT file is not touched — no save, no flush, nothing read back.
    expect(save).not.toHaveBeenCalled()
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('hands the surface the shell`s canvas prefs to seed the scene with (🔒 YAZ-1775 D9)', async () => {
    render({ canvasPrefs: { ...DEFAULT_CANVAS_PREFS, gridModeEnabled: true } })
    await flush()
    expect(surface.props?.canvasPrefs).toEqual({ ...DEFAULT_CANVAS_PREFS, gridModeEnabled: true })
  })
})

/** The tab and the embed's modal share ONE surface (YAZ-3028, rule 28): only the tab takes the keyboard at mount. */
describe('the pan and zoom a woken tab keeps (YAZ-3737 D13)', () => {
  it('the tab answers its page view with the canvas`s pan and zoom, and a start view`s canvas reaches the surface once', async () => {
    container.setAttribute('data-tab', 't1')
    surface.canvas = { scrollX: -120, scrollY: 48, zoom: 1.75 }
    render()
    await flush()
    expect(surface.props?.startCanvas).toBeUndefined()
    expect(readPageView('t1')).toEqual({ scrollTop: 0, zoomKey: null, folds: [], magnification: 100, canvas: { scrollX: -120, scrollY: 48, zoom: 1.75 } })
    // Asleep, then woken: the editor mounts again with the view it slept with.
    const slept = readPageView('t1')
    act(() => root?.unmount())
    root = createRoot(container)
    expect(readPageView('t1')).toBeUndefined()
    render({ startView: slept })
    await flush()
    expect(surface.props?.startCanvas).toEqual({ scrollX: -120, scrollY: 48, zoom: 1.75 })
  })
})

describe('the one engine seam', () => {
  it('mounts the shared surface with autoFocus, the modal`s does not', async () => {
    render()
    await flush()
    expect(surface.props?.autoFocus).toBe(true)
  })

  it('the tab ALWAYS turns the canvas panel on (YAZ-3038), and hands it the shell`s memory and door', async () => {
    render()
    await flush()
    expect(surface.props?.onCanvasPanelChange).toBeTypeOf('function')
    expect(surface.props?.canvasPanel).toBeUndefined()
    act(() => root?.unmount())
    root = createRoot(document.createElement('div'))
    const onCanvasPanelChange = vi.fn()
    render({ canvasPanel: { tab: 'presentation', docked: true }, onCanvasPanelChange })
    await flush()
    expect(surface.props?.canvasPanel).toEqual({ tab: 'presentation', docked: true })
    surface.props?.onCanvasPanelChange?.({ tab: 'image-studio', docked: true })
    expect(onCanvasPanelChange).toHaveBeenCalledExactlyOnceWith({ tab: 'image-studio', docked: true })
  })
})

describe('read only (YAZ-3076 D2)', () => {
  const LOCKED = `${JSON.stringify({ yaseendraw: { createdAt: 1, updatedAt: 2, readonly: true }, type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} })}\n`

  it('S26: a read-only file opens the canvas in the engine’s view mode; an editable one does not', async () => {
    render()
    await flush()
    expect(surface.props?.readOnly).toBe(false)
    load.mockResolvedValue(loaded({ json: LOCKED }))
    render({ path: '/vault/Locked.excalidraw' })
    await flush()
    expect(surface.props?.readOnly).toBe(true)
  })

  it('a change the view mode lets through is never saved, and "Allow edits" (here: an agent on disk) puts the disk back', async () => {
    load.mockResolvedValue(loaded({ json: LOCKED }))
    render()
    await flush()
    emit(7)
    emit(9)
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(save).not.toHaveBeenCalled()
    expect(chips()).toContain('Saved')
    // S15: the switch goes off on disk; the clean tab reloads, the canvas leaves view mode.
    load.mockResolvedValue(loaded({ mtime: 300 }))
    watcherSaw({ type: 'change', path: PATH, mtime: 300 })
    await flush()
    await flush()
    expect(surface.props?.readOnly).toBe(false)
    expect(surface.replaced.length).toBeGreaterThan(0)
  })

  it('S15: an agent turns the switch on — the open tab goes to view mode at once, and edits stop saving', async () => {
    render()
    await flush()
    emit(7)
    load.mockResolvedValue(loaded({ json: LOCKED, mtime: 300 }))
    surface.nextReplaceVersion = 7
    watcherSaw({ type: 'change', path: PATH, mtime: 300 })
    await flush()
    await flush()
    emit(7)
    expect(surface.props?.readOnly).toBe(true)
    emit(8)
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(save).not.toHaveBeenCalled()
  })
})

describe('page links (YAZ-4039)', () => {
  const linkSource = () => {
    const source = createWikilinkResolveSource()
    source.update((target) => (target === 'Known' ? '/vault/Known.md' : null))
    return source
  }
  const hit = { elementId: 't', inner: 'Known', start: 0, end: 9, rect: { left: 10, top: 10, right: 60, bottom: 30 } }

  it('gives the canvas no links with no resolve source: the pills stay text', async () => {
    render()
    await flush()
    expect(surface.props?.links).toBeUndefined()
  })

  it("right-click on a pill opens the note's link menu at the pointer, and ⌘-click opens the page behind", async () => {
    const onOpenLinkBackground = vi.fn()
    render({ wikilinks: linkSource(), onOpenLink: vi.fn(), onOpenLinkBackground })
    await flush()
    const links = surface.props!.links!
    expect(links.hostLinks.resolve('Known')).toEqual({ label: 'Known' })
    act(() => {
      links.hostLinks.onContextMenu?.(hit, new MouseEvent('contextmenu', { clientX: 40, clientY: 20 }))
    })
    const rows = [...container.querySelectorAll('.ctx-menu--editor .ctx-menu__item')].map((row) => row.textContent)
    expect(rows).toEqual(['Open', 'Open in new tab', 'Copy name', 'Copy path'])
    expect(links.hostLinks.onPointerDown?.(hit, new PointerEvent('pointerdown', { metaKey: true }))).toBe(true)
    expect(onOpenLinkBackground).toHaveBeenCalledWith('/vault/Known.md')
  })

  it('Edit link and Remove link change the link through the engine (YAZ-4068)', async () => {
    render({ wikilinks: linkSource(), onOpenLink: vi.fn(), onOpenLinkBackground: vi.fn() })
    await flush()
    const links = surface.props!.links!
    const replace = vi.fn()
    const menuRow = (label: string) => [...container.querySelectorAll<HTMLButtonElement>('.ctx-menu--editor .ctx-menu__item')].find((row) => row.textContent === label)
    const rightClick = () => act(() => void links.hostLinks.onContextMenu?.({ ...hit, replace }, new MouseEvent('contextmenu', { clientX: 40, clientY: 20 })))
    rightClick()
    act(() => menuRow('Remove link')!.click())
    expect(replace).toHaveBeenLastCalledWith('Known')
    rightClick()
    act(() => menuRow('Edit link')!.click())
    const input = container.querySelector<HTMLInputElement>('.drawing-link-edit input')!
    expect(input.value).toBe('Known')
    input.value = 'Other'
    act(() => void input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })))
    expect(replace).toHaveBeenLastCalledWith('[[Other]]')
  })

  it('a read-only board gives no Edit link or Remove link', async () => {
    const readOnly = `${JSON.stringify({ yaseendraw: { createdAt: 1, updatedAt: 2, readonly: true }, type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} })}\n`
    load.mockResolvedValue(loaded({ json: readOnly }))
    render({ wikilinks: linkSource(), onOpenLink: vi.fn(), onOpenLinkBackground: vi.fn() })
    await flush()
    act(() => void surface.props!.links!.hostLinks.onContextMenu?.({ ...hit, replace: vi.fn() }, new MouseEvent('contextmenu')))
    const rows = [...container.querySelectorAll('.ctx-menu--editor .ctx-menu__item')].map((row) => row.textContent)
    expect(rows).not.toContain('Edit link')
    expect(rows).not.toContain('Remove link')
  })

  it('a pasted page path becomes its [[ID]] link', async () => {
    const candidates = createWikilinkCandidateSource()
    candidates.update([{ name: 'Known', insert: 'YAS-7', label: 'Known', path: '/vault/Known.md' }])
    render({ wikilinks: linkSource(), wikilinkCandidates: candidates, onOpenLink: vi.fn(), onOpenLinkBackground: vi.fn() })
    await flush()
    expect(surface.props!.links!.hostLinks.pasteLink?.('/vault/Known.md')).toBe('[[YAS-7]]')
  })
})

describe('YAZ-3943 1B — the cog on a drawing: the pictures and the exports (D5, D13)', () => {
  const cog = () => container.querySelector<HTMLButtonElement>('.page-settings__trigger')!
  const rows = () => [...container.querySelectorAll<HTMLElement>('.page-settings__menu > button, .page-settings__menu > p')]
  const row = (label: string) => rows().find((r) => r.textContent === label) as HTMLButtonElement | undefined
  const MB = 1024 * 1024

  async function openCog(over: Partial<DrawingLoadResponse> = {}): Promise<void> {
    load.mockResolvedValue(loaded(over))
    render()
    await flush()
    emit(1)
    act(() => cog().click())
  }

  /** A board's text with its `yaseendraw` block. */
  const withBlock = (block: Record<string, unknown>) => `${JSON.stringify({ yaseendraw: { createdAt: 1, updatedAt: 2, ...block }, elements: [], appState: {}, files: {} })}\n`
  /** The confirm box: its words, and its two buttons. */
  const sheet = () => container.querySelector<HTMLElement>('.confirm__text')
  const sheetButton = (label: string) => [...container.querySelectorAll<HTMLButtonElement>('.confirm__btn')].find((b) => b.textContent === label)!

  it('in this order: Read only, Link preview on hover, the count and size of the pictures in words (YAZ-4110 5B), the moves to the other places, then the two exports', async () => {
    surface.pictures = { bytes: 3.3 * MB, count: 6, missing: 0 }
    await openCog()
    expect(rows().map((r) => r.textContent)).toEqual(['Read only', 'Link preview on hover✓', 'Fold arrows:', '6 pictures in this file (3.3 MB)', 'Move to the assets folder', 'Choose a folder…', 'Export Image or PDF…', 'Export Excalidraw Drawing…'])
    // YAZ-4277 D5: a line above the fold arrow rows too.
    expect(container.querySelectorAll('.page-settings__menu > .page-settings__divider')).toHaveLength(3)
    expect(row('6 pictures in this file (3.3 MB)')!.className).not.toContain('warn')
  })

  it('no picture: no size row and no move; from 20 MB the size is amber; a "pictures out" board says where they are: the assets folder, or its own folder by its last name with the whole path on hover', async () => {
    await openCog()
    expect(rows().map((r) => r.textContent)).toEqual(['Read only', 'Link preview on hover✓', 'Fold arrows:', 'Export Image or PDF…', 'Export Excalidraw Drawing…'])
    act(() => cog().click())
    surface.pictures = { bytes: 20 * MB, count: 2, missing: 0 }
    act(() => cog().click())
    expect(row('2 pictures in this file (20.0 MB)')!.className).toContain('page-settings__warn')
    act(() => root?.unmount())
    root = createRoot(container)

    surface.pictures = { bytes: 1000, count: 1, missing: 0 }
    await openCog({ json: withBlock({ pictures: 'assets' }) })
    expect(rows().map((r) => r.textContent)).toEqual(['Read only', 'Link preview on hover✓', 'Fold arrows:', '1 picture in the assets folder (1000 B)', 'Keep pictures inside', 'Choose a folder…', 'Export Image or PDF…', 'Export Excalidraw Drawing…'])
    act(() => root?.unmount())
    root = createRoot(container)

    await openCog({ json: withBlock({ pictures: 'assets', picturesFolder: 'Projects/Board pictures' }) })
    expect(rows().map((r) => r.textContent)).toEqual(['Read only', 'Link preview on hover✓', 'Fold arrows:', '1 picture in Board pictures (1000 B)', 'Keep pictures inside', 'Move to the assets folder', 'Choose a folder…', 'Export Image or PDF…', 'Export Excalidraw Drawing…'])
    expect(row('1 picture in Board pictures (1000 B)')!.title).toBe('Projects/Board pictures')
  })

  it('every move asks first in the confirm box, with the real count and size; Cancel writes nothing; the box\'s button writes beside the autosave, and the rows follow the new place', async () => {
    surface.pictures = { bytes: 1000, count: 1, missing: 0 }
    setBoardPictures.mockResolvedValue({ path: PATH, mtime: 300, size: 10 })
    await openCog()
    act(() => row('Move to the assets folder')!.click())
    expect(sheet()!.textContent).toBe(`Move pictures out of this board?${picturesMoveAsk('assets', { count: 1, bytes: 1000 }, "this board's file").body}`)
    act(() => sheetButton('Cancel').click())
    expect(sheet()).toBeNull()
    expect(setBoardPictures).not.toHaveBeenCalled()

    act(() => cog().click())
    act(() => row('Move to the assets folder')!.click())
    await act(async () => sheetButton('Move pictures').click())
    await flush()
    expect(setBoardPictures).toHaveBeenCalledWith({ root: ROOT, path: PATH, out: true, expectedMtime: 100 })
    act(() => cog().click())
    expect(rows().map((r) => r.textContent)).toContain('1 picture in the assets folder (1000 B)')
    act(() => row('Keep pictures inside')!.click())
    expect(sheet()!.textContent).toContain('Keep pictures inside this board?')
    expect(sheet()!.textContent).toContain("The copies in the vault's assets folder stay.")
    await act(async () => sheetButton('Keep inside').click())
    await flush()
    expect(setBoardPictures).toHaveBeenLastCalledWith({ root: ROOT, path: PATH, out: false, expectedMtime: 300 })
  })

  it('"Choose a folder…" opens the folder window on the board\'s folder first; a cancel does nothing; a refusal says why; a pick asks, with the outside warning, then writes the folder', async () => {
    const onNotice = vi.fn()
    const pick = vi.mocked(api.pickPicturesFolder)
    surface.pictures = { bytes: 2048, count: 2, missing: 0 }
    setBoardPictures.mockResolvedValue({ path: PATH, mtime: 300, size: 10 })
    load.mockResolvedValue(loaded({ json: withBlock({ pictures: 'assets', picturesFolder: 'Old pictures' }) }))
    render({ onNotice })
    await flush()
    emit(1)
    const choose = async () => {
      act(() => cog().click())
      await act(async () => row('Choose a folder…')!.click())
      await flush()
    }
    pick.mockResolvedValueOnce({ cancelled: true })
    await choose()
    expect(pick).toHaveBeenLastCalledWith({ root: ROOT, current: 'Old pictures' })
    expect(sheet()).toBeNull()

    pick.mockRejectedValueOnce(new BridgeRequestError('BAD_REQUEST', 'Pick a folder, not the vault itself.'))
    await choose()
    expect(onNotice).toHaveBeenLastCalledWith('Pick a folder, not the vault itself.', 'error')
    expect(sheet()).toBeNull()

    pick.mockResolvedValueOnce({ folder: '/Users/me/Pictures/Boards' })
    await choose()
    expect(sheet()!.textContent).toBe(`Move pictures to Boards?${picturesMoveAsk('folder', { count: 2, bytes: 2048 }, 'Old pictures', '/Users/me/Pictures/Boards', '/Users/me').body}`)
    expect(sheet()!.textContent).toContain(OUTSIDE_FOLDER_WARNING)
    expect(sheet()!.textContent).toContain('~/Pictures/Boards')
    expect(setBoardPictures).not.toHaveBeenCalled()
    await act(async () => sheetButton('Move pictures').click())
    await flush()
    expect(setBoardPictures).toHaveBeenCalledWith({ root: ROOT, path: PATH, out: true, folder: '/Users/me/Pictures/Boards', expectedMtime: 100 })
    act(() => cog().click())
    expect(row('2 pictures in Boards (2.0 KB)')!.title).toBe('~/Pictures/Boards')
  })

  it('Read only greys out every move and the hover switch (they write the file); a click does nothing; the exports still work', async () => {
    surface.pictures = { bytes: 1000, count: 1, missing: 0 }
    await openCog({ json: withBlock({ readonly: true }) })
    for (const label of ['Move to the assets folder', 'Choose a folder…', 'Link preview on hover✓']) {
      expect(row(label)!.disabled, label).toBe(true)
      act(() => row(label)!.click())
    }
    expect(row('Export Image or PDF…')!.disabled).toBe(false)
    expect(sheet()).toBeNull()
    expect(setBoardPictures).not.toHaveBeenCalled()
    expect(api.pickPicturesFolder).not.toHaveBeenCalled()
    expect(api.setBoardHoverLinks).not.toHaveBeenCalled()
  })

  it('YAZ-3943 1F: pictures in neither the file, its folder nor assets/ are an amber row after the size, with the moves after them; all missing: the row alone', async () => {
    surface.pictures = { bytes: 1000, count: 1, missing: 3 }
    await openCog()
    expect(rows().map((r) => r.textContent)).toEqual(['Read only', 'Link preview on hover✓', 'Fold arrows:', '1 picture in this file (1000 B)', '3 pictures are missing', 'Move to the assets folder', 'Choose a folder…', 'Export Image or PDF…', 'Export Excalidraw Drawing…'])
    expect(row('3 pictures are missing')!.className).toContain('page-settings__warn')
    act(() => cog().click())
    surface.pictures = { bytes: 0, count: 0, missing: 1 }
    act(() => cog().click())
    expect(rows().map((r) => r.textContent)).toEqual(['Read only', 'Link preview on hover✓', 'Fold arrows:', '1 picture is missing', 'Export Image or PDF…', 'Export Excalidraw Drawing…'])
  })

  it('YAZ-4074 6A item 2: with a used picture missing, a move says why and opens no box and no folder window', async () => {
    const onNotice = vi.fn()
    surface.pictures = { bytes: 1000, count: 1, missing: 1 }
    load.mockResolvedValue(loaded({ json: withBlock({ pictures: 'assets', picturesFolder: 'Old pictures' }) }))
    render({ onNotice })
    await flush()
    emit(1)
    for (const label of ['Keep pictures inside', 'Move to the assets folder', 'Choose a folder…']) {
      act(() => cog().click())
      await act(async () => row(label)!.click())
      await flush()
      expect(onNotice, label).toHaveBeenLastCalledWith('1 picture is missing. Find it before you move the pictures.', 'error')
      expect(sheet(), label).toBeNull()
    }
    expect(api.pickPicturesFolder).not.toHaveBeenCalled()
    expect(setBoardPictures).not.toHaveBeenCalled()
  })

  it('demo round 3: a board naming an outside folder this Mac has not allowed asks once when it opens; "Not now" allows nothing, and the cog shows the amber line with "Allow…", which asks again', async () => {
    const list = vi.mocked(api.pictureFolders.list)
    const allow = vi.mocked(api.pictureFolders.allow)
    list.mockResolvedValue([])
    surface.pictures = { bytes: 1000, count: 1, missing: 0 }
    load.mockResolvedValue(loaded({ json: withBlock({ pictures: 'assets', picturesFolder: '/Users/me/Pictures/Boards' }) }))
    render()
    await flush()
    emit(1)
    expect(sheet()!.textContent).toBe(`${ALLOW_FOLDER_TITLE}${allowFolderBody('~/Pictures/Boards')}`)
    act(() => sheetButton('Not now').click())
    expect(sheet()).toBeNull()
    expect(allow).not.toHaveBeenCalled()
    act(() => cog().click())
    expect(rows().map((r) => r.textContent)).toEqual(['Read only', 'Link preview on hover✓', 'Fold arrows:', '1 picture in Boards (1000 B)', 'Folder not allowed on this Mac', 'Allow…', 'Keep pictures inside', 'Move to the assets folder', 'Choose a folder…', 'Export Image or PDF…', 'Export Excalidraw Drawing…'])
    expect(row('Folder not allowed on this Mac')!.className).toContain('page-settings__warn')
    act(() => row('Allow…')!.click())
    await act(async () => sheetButton('Allow').click())
    await flush()
    expect(allow).toHaveBeenCalledWith('/Users/me/Pictures/Boards')
    act(() => cog().click())
    expect(row('Folder not allowed on this Mac')).toBeUndefined()
  })

  it('demo 2: "Link preview on hover" is the board\'s own switch: off writes beside the autosave and stops the link card; a board whose file says off opens with it off', async () => {
    const preview = vi.mocked(useCardPreview)
    vi.mocked(api.setBoardHoverLinks).mockResolvedValue({ path: PATH, mtime: 300, size: 10 })
    load.mockResolvedValue(loaded())
    render({ wikilinks: createWikilinkResolveSource(), onOpenLink: vi.fn(), onOpenLinkBackground: vi.fn(), hoverLinks: true })
    await flush()
    emit(1)
    expect(preview.mock.lastCall?.[0]).toBe(true)
    act(() => cog().click())
    await act(async () => row('Link preview on hover✓')!.click())
    await flush()
    expect(api.setBoardHoverLinks).toHaveBeenCalledWith({ root: ROOT, path: PATH, on: false, expectedMtime: 100 })
    expect(preview.mock.lastCall?.[0]).toBe(false)
    expect(row('Link preview on hover')!.getAttribute('aria-pressed')).toBe('false')
    act(() => root?.unmount())
    root = createRoot(container)

    load.mockResolvedValue(loaded({ json: withBlock({ hoverLinks: false }) }))
    render({ wikilinks: createWikilinkResolveSource(), onOpenLink: vi.fn(), onOpenLinkBackground: vi.fn(), hoverLinks: true })
    await flush()
    expect(preview.mock.lastCall?.[0]).toBe(false)
    // "Links in drawings" off (the app's setting) turns it off for every board, whatever the board says.
    act(() => root?.unmount())
    root = createRoot(container)
    load.mockResolvedValue(loaded())
    render({ wikilinks: createWikilinkResolveSource(), onOpenLink: vi.fn(), onOpenLinkBackground: vi.fn(), hoverLinks: false })
    await flush()
    expect(preview.mock.lastCall?.[0]).toBe(false)
  })

  /** The pills of the one "Fold arrows" row (YAZ-4402 3A): text, pressed, disabled, tooltip. */
  const pills = () => [...container.querySelectorAll<HTMLButtonElement>('.page-settings__menu .page-settings__choices button')]
  const pill = (label: string) => pills().find((b) => b.textContent === label)!

  it('YAZ-4277 D5: "Fold arrows" is the board\'s own choice: a pick writes beside the autosave and reaches the canvas; a board whose file says one opens with it', async () => {
    vi.mocked(api.setBoardFoldArrows).mockResolvedValue({ path: PATH, mtime: 300, size: 10 })
    load.mockResolvedValue(loaded())
    render()
    await flush()
    emit(1)
    expect(surface.props?.foldArrows).toBeUndefined()
    act(() => cog().click())
    await act(async () => pill('Always').click())
    await flush()
    expect(api.setBoardFoldArrows).toHaveBeenCalledWith({ root: ROOT, path: PATH, value: 'always', expectedMtime: 100 })
    expect(surface.props?.foldArrows).toBe('always')
    // YAZ-4402 3A: the menu stays open, the new choice pressed
    expect(pills().map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['App', 'false'], ['Hover', 'false'], ['Always', 'true'], ['Off', 'false']])
    act(() => root?.unmount())
    root = createRoot(container)

    load.mockResolvedValue(loaded({ json: withBlock({ foldArrows: 'hover' }) }))
    render()
    await flush()
    expect(surface.props?.foldArrows).toBe('hover')
  })

  it('YAZ-4402 3A: ONE "Fold arrows (app: …)" row with the pills App, Hover, Always and Off, each with its tooltip; the board\'s choice pressed; the label names the app\'s mode', async () => {
    load.mockResolvedValue(loaded())
    render({ canvasPrefs: { ...DEFAULT_CANVAS_PREFS, foldArrowsOpen: 'always' } })
    await flush()
    emit(1)
    act(() => cog().click())
    expect(rows().map((r) => r.textContent).filter((t) => t?.startsWith('Fold arrows'))).toEqual(['Fold arrows (app: always):'])
    expect(container.querySelector('.page-settings__choices')?.getAttribute('aria-label')).toBe('Fold arrows (app: always)')
    expect(pills().map((b) => [b.textContent, b.getAttribute('aria-pressed'), b.title])).toEqual([
      ['App', 'true', 'The app setting: Always'],
      ['Hover', 'false', 'Arrows show on hover'],
      ['Always', 'false', 'Arrows always show'],
      ['Off', 'false', 'No folding: every line shows, the folds stay saved'],
    ])
    act(() => root?.unmount())
    root = createRoot(container)
    // a board with its own "off" (YAZ-4401 2E): Off pressed; the app's own mode still named
    load.mockResolvedValue(loaded({ json: withBlock({ foldArrows: 'off' }) }))
    render({ canvasPrefs: { ...DEFAULT_CANVAS_PREFS, foldArrowsOpen: 'hover' } })
    await flush()
    emit(1)
    expect(surface.props?.foldArrows).toBe('off')
    act(() => cog().click())
    expect(rows().map((r) => r.textContent)).toContain('Fold arrows (app: hover):')
    expect(pills().filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent)).toEqual(['Off'])
  })

  it('YAZ-4401 2E, YAZ-4402 3A: the Off pill writes `off` to the board and the canvas gets `off`', async () => {
    vi.mocked(api.setBoardFoldArrows).mockResolvedValue({ path: PATH, mtime: 300, size: 10 })
    load.mockResolvedValue(loaded())
    render()
    await flush()
    emit(1)
    act(() => cog().click())
    await act(async () => pill('Off').click())
    await flush()
    expect(api.setBoardFoldArrows).toHaveBeenCalledWith({ root: ROOT, path: PATH, value: 'off', expectedMtime: 100 })
    expect(surface.props?.foldArrows).toBe('off')
    expect(pill('Off').getAttribute('aria-pressed')).toBe('true')
  })

  it('YAZ-4402 3A: Read only greys out every pill (a pick writes the file); a click writes nothing', async () => {
    await openCog({ json: withBlock({ readonly: true }) })
    expect(pills().map((b) => b.disabled)).toEqual([true, true, true, true])
    for (const b of pills()) act(() => b.click())
    await flush()
    expect(api.setBoardFoldArrows).not.toHaveBeenCalled()
    expect(container.querySelector('.page-settings__menu')).not.toBeNull()
  })

  it('YAZ-3943 1F: a board whose pictures are missing says so once when it opens, and not again on a reload; a board with all its pictures says nothing', async () => {
    const onNotice = vi.fn()
    const pictures = scene([{ id: 'i1', type: 'image', fileId: 'here' }, { id: 'i2', type: 'image', fileId: 'gone1' }, { id: 'i3', type: 'image', fileId: 'gone2' }, { id: 'i4', type: 'image', fileId: 'gone3', isDeleted: true }])
    load.mockResolvedValue(loaded({ json: pictures, files: { here: { mimeType: 'image/png', dataURL: 'data:image/png;base64,aGk=' } }, stored: ['here'] }))
    render({ onNotice })
    await flush()
    expect(onNotice.mock.calls).toEqual([['2 pictures of this board are missing', 'error']])
    // An edit made elsewhere reloads the board: no second notice.
    emit(1)
    load.mockResolvedValue(loaded({ json: pictures, mtime: 400 }))
    watcherSaw({ type: 'change', path: PATH, mtime: 400 })
    await flush()
    expect(surface.replaced).toHaveLength(1)
    expect(onNotice).toHaveBeenCalledTimes(1)
  })

  it('each export row calls the same handler as its key (⌘⇧E, ⌘⇧S), and closes the menu', async () => {
    container.className = 'tabstack__layer'
    await openCog()
    act(() => row('Export Image or PDF…')!.click())
    expect(container.querySelector('.page-settings__menu')).toBeNull()
    act(() => void requestBoardCommand({ kind: 'export-image' }, document.body))
    // Each one reached the engine's own export box the same way.
    expect(surface.commands).toEqual([{ kind: 'export-image' }, { kind: 'export-image' }])

    act(() => cog().click())
    await act(async () => row('Export Excalidraw Drawing…')!.click())
    await flush()
    await act(async () => void requestBoardCommand({ kind: 'export-drawing' }, document.body))
    await flush()
    expect(saveDrawing.mock.calls).toEqual([[{ defaultName: 'Board.excalidraw', content: surface.exportedScene }], [{ defaultName: 'Board.excalidraw', content: surface.exportedScene }]])
  })
})

describe('YAZ-3943 1C — the PDF button of the export box (D6)', () => {
  it('the tab gives the engine `onExportPdf`; a press sends the SVG and its size to main\'s PDF sheet under the board\'s name, and the notice says where it landed', async () => {
    const onNotice = vi.fn()
    savePdf.mockReset().mockResolvedValue({ path: '/Users/y/Desktop/Board.pdf' })
    render({ onNotice })
    await flush()
    expect(surface.props?.onExportPdf).toBeTypeOf('function')
    await act(async () => {
      await surface.props!.onExportPdf!('<svg width="960" height="480"/>', { width: 960, height: 480 })
    })
    expect(savePdf).toHaveBeenCalledWith({ defaultName: 'Board.pdf', svg: '<svg width="960" height="480"/>', width: 960, height: 480 })
    expect(onNotice).toHaveBeenCalledWith('Exported to Board.pdf')
    // The vault file is not touched.
    expect(save).not.toHaveBeenCalled()
  })

  it('a failed print or write is the one error notice; a dismissed sheet is silent', async () => {
    const onNotice = vi.fn()
    render({ onNotice })
    await flush()
    savePdf.mockReset().mockResolvedValueOnce({ cancelled: true }).mockRejectedValueOnce(new Error('boom'))
    await act(async () => void (await surface.props!.onExportPdf!('<svg/>', { width: 1, height: 1 })))
    expect(onNotice).not.toHaveBeenCalled()
    await act(async () => void (await surface.props!.onExportPdf!('<svg/>', { width: 1, height: 1 })))
    expect(onNotice).toHaveBeenCalledWith("The PDF couldn't be exported.", 'error')
  })
})

describe('YAZ-3943 demo round 3 — what the confirm box before a picture move says (`picturesMoveAsk`)', () => {
  it('in plain words, with the real count, size and both places; one picture is singular', () => {
    expect(picturesMoveAsk('assets', { count: 3, bytes: 3 * 1024 * 1024 }, picturesPlaceText(false, null))).toEqual({
      title: 'Move pictures out of this board?',
      body: 'The 3 pictures (3.0 MB) move from this board\'s file to the vault\'s assets folder. The board file gets smaller. If you copy this board by itself, its pictures do not go with it. To bring them back, use "Keep pictures inside" in this menu.',
      confirm: 'Move pictures',
    })
    expect(picturesMoveAsk('inside', { count: 1, bytes: 1000 }, picturesPlaceText(true, 'Projects/Board pictures'))).toEqual({
      title: 'Keep pictures inside this board?',
      body: "The 1 picture (1000 B) is copied into this board's file. The board file gets bigger. The copies in Projects/Board pictures stay. The app never deletes picture files.",
      confirm: 'Keep inside',
    })
  })

  it('a folder in the vault says to keep it in the vault; a folder outside adds the one warning, and shows as ~/… under the home folder', () => {
    const inVault = picturesMoveAsk('folder', { count: 2, bytes: 2048 }, picturesPlaceText(true, null), 'Projects/Board pictures', '/Users/me')
    expect(inVault.title).toBe('Move pictures to Board pictures?')
    // YAZ-4074 6A item 14: from a folder, the move copies; the old copies stay, and the board file keeps its size.
    expect(inVault.body).toBe("The 2 pictures (2.0 KB) move from the vault's assets folder to Projects/Board pictures. The copies in the vault's assets folder stay. The app never deletes picture files. If you copy this board by itself, its pictures do not go with it. Keep this folder in the vault. If you rename it in Finder or delete it, the board shows missing pictures.")
    expect(inVault.body).not.toContain(OUTSIDE_FOLDER_WARNING)
    const outside = picturesMoveAsk('folder', { count: 2, bytes: 2048 }, picturesPlaceText(true, '/Users/me/Old', '/Users/me'), '/Users/me/Pictures/Boards', '/Users/me')
    expect(outside.title).toBe('Move pictures to Boards?')
    expect(outside.body).toBe(`The 2 pictures (2.0 KB) move from ~/Old to ~/Pictures/Boards. The copies in ~/Old stay. The app never deletes picture files. If you copy this board by itself, its pictures do not go with it. Keep this folder. If you rename it in Finder or delete it, the board shows missing pictures. ${OUTSIDE_FOLDER_WARNING}`)
    expect(picturesMoveAsk('assets', { count: 1, bytes: 1000 }, picturesPlaceText(true, 'Projects/Board pictures')).body).toBe(
      'The 1 picture (1000 B) moves from Projects/Board pictures to the vault\'s assets folder. The copies in Projects/Board pictures stay. The app never deletes picture files. If you copy this board by itself, its pictures do not go with it. To bring them back, use "Keep pictures inside" in this menu.',
    )
    expect(OUTSIDE_FOLDER_WARNING).toBe('This folder is outside the vault. Your other Macs, Version history and copies of the vault will not have these pictures unless you sync this folder yourself.')
    // A folder outside the home folder shows its whole path.
    expect(picturesMoveAsk('folder', { count: 1, bytes: 1 }, 'x', '/Volumes/Disk/pics', '/Users/me').body).toContain('to /Volumes/Disk/pics.')
  })
})
