/**
 * What the surface hands the ENGINE (YAZ-3076 D2, YAZ-3120): the engine is a stand-in that records
 * its props, so the real surface runs and its view-mode rule is pinned as behaviour, not as source.
 * A read-only file forces the engine's own view mode (`viewModeEnabled: true`); an editable one
 * passes NO `viewModeEnabled` at all, because a defined prop turns off the engine's own ⌥R toggle
 * (`actionToggleViewMode.predicate` is `typeof appProps.viewModeEnabled === "undefined"`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const engine = vi.hoisted(() => ({ props: [] as Array<Record<string, unknown>> }))
vi.mock('./engine', () => {
  const Excalidraw = (props: Record<string, unknown>) => {
    engine.props.push(props)
    return null
  }
  const mod = {
    Excalidraw,
    restoreElements: (elements: unknown) => elements,
    CaptureUpdateAction: { IMMEDIATELY: 'IMMEDIATELY', NEVER: 'NEVER', EVENTUALLY: 'EVENTUALLY' },
    Fonts: { loadElementsFonts: async () => [] },
    restoreAppState: () => ({}),
    getSceneVersion: () => 0,
    serializeAsJSON: vi.fn((elements: unknown) => JSON.stringify({ elements, appState: { viewBackgroundColor: '#ffffff' } })),
    // YAZ-4277 D18: the fold switch point's save step; with folding on nothing is aside (`foldsOff.test.tsx` runs the real one)
    withFoldsPutBack: (elements: unknown) => elements,
  }
  const textEditor = { mount: () => ({ setSelection: () => undefined, focus: () => undefined, destroy: () => undefined }) }
  return {
    loadExcalidraw: async () => mod,
    loadTextBoxEditor: async () => ({ createTextBoxEditor: () => textEditor }),
    applyToolbarMode: () => undefined,
  }
})
vi.mock('katex/dist/katex.min.css', () => ({}))

import { ExcalidrawSurface, readOnlyHandle } from './ExcalidrawSurface'
import { imageStudioSession, resetImageStudioSession } from '../image-studio/imageStudioSession'
import { CANVAS_SIDEBAR } from './CanvasSidebar'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  engine.props = []
})

const SCENE = { elements: [], appState: {}, files: {} }

async function render(readOnly: boolean | undefined): Promise<void> {
  container ??= document.createElement('div')
  document.body.appendChild(container)
  root ??= createRoot(container)
  await act(async () => {
    root?.render(<ExcalidrawSurface scene={SCENE} theme="light" onSnapshot={() => undefined} onFailed={() => undefined} readOnly={readOnly} />)
  })
}

const last = (): Record<string, unknown> => engine.props.at(-1) ?? {}

describe('the text box editor (YAZ-4277 D1)', () => {
  it('passes the text box editor, made with the engine, to the canvas', async () => {
    await render(undefined)
    expect((last().textEditor as { mount?: unknown } | undefined)?.mount).toBeTypeOf('function')
    expect(engine.props.every((props) => props.textEditor === last().textEditor)).toBe(true)
  })
})

describe('the board`s right-click menu: Save to library… (YAZ-4157 demo 6L)', () => {
  async function renderWithPanel(readOnly: boolean): Promise<void> {
    container ??= document.createElement('div')
    document.body.appendChild(container)
    root ??= createRoot(container)
    await act(async () => {
      root?.render(<ExcalidrawSurface scene={SCENE} theme="light" onSnapshot={() => undefined} onFailed={() => undefined} readOnly={readOnly} onCanvasPanelChange={() => undefined} />)
    })
  }
  type Items = (type: 'canvas' | 'element') => Array<{ name: string; label: string; replaces?: string; perform: () => void }>

  it('takes the place of the engine`s "Add to library" on a selection, and asks the Add tab for its name form', async () => {
    resetImageStudioSession()
    await renderWithPanel(false)
    const items = last().hostContextMenuItems as Items
    expect(items('canvas')).toEqual([])
    const [save] = items('element')
    expect(save).toMatchObject({ name: 'saveToLibrary', label: 'Save to library…', replaces: 'addToLibrary' })
    const sidebar = () => (last().children as { props: { saveRequestPending: boolean } }).props
    expect(sidebar().saveRequestPending).toBe(false)
    await act(async () => save.perform())
    // Per surface (audit Must 1): the request rides THIS board's panel, never the window's shared session.
    expect(sidebar().saveRequestPending).toBe(true)
  })

  it('⌘F with the focus on no element (a click on the panel header) still puts the caret in the Add tab`s search (demo 6N)', async () => {
    await renderWithPanel(false)
    const surface = container!.querySelector<HTMLElement>('.drawing-surface')!
    // jsdom lays nothing out; the board is on screen.
    surface.getClientRects = () => [{}] as unknown as DOMRectList
    const sidebar = () => (last().children as { props: { searchFocusPending: boolean } }).props
    expect(sidebar().searchFocusPending).toBe(false)
    const press = new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', metaKey: true, bubbles: true, cancelable: true })
    await act(async () => void document.body.dispatchEvent(press))
    expect(press.defaultPrevented).toBe(true)
    expect(sidebar().searchFocusPending).toBe(true)
  })

  it('a board that is not on screen leaves ⌘F alone', async () => {
    await renderWithPanel(false)
    const press = new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', metaKey: true, bubbles: true, cancelable: true })
    await act(async () => void document.body.dispatchEvent(press))
    expect(press.defaultPrevented).toBe(false)
  })

  it('YAZ-6330: a hidden tab (visibility: hidden) and a background tab under .drawing-modal-overlay leave ⌘F alone', async () => {
    await renderWithPanel(false)
    const surface = container!.querySelector<HTMLElement>('.drawing-surface')!
    surface.getClientRects = () => [{}] as unknown as DOMRectList
    const sidebar = () => (last().children as { props: { searchFocusPending: boolean } }).props

    // Hidden tab (visibility: hidden on an ancestor or the surface itself).
    container!.style.visibility = 'hidden'
    const hiddenPress = new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', metaKey: true, bubbles: true, cancelable: true })
    await act(async () => void document.body.dispatchEvent(hiddenPress))
    expect(hiddenPress.defaultPrevented).toBe(false)
    expect(sidebar().searchFocusPending).toBe(false)
    container!.style.visibility = ''

    // Background tab while a .drawing-modal-overlay is open elsewhere in the DOM.
    const modal = document.createElement('div')
    modal.className = 'drawing-modal-overlay'
    document.body.appendChild(modal)
    try {
      const underModalPress = new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', metaKey: true, bubbles: true, cancelable: true })
      await act(async () => void document.body.dispatchEvent(underModalPress))
      expect(underModalPress.defaultPrevented).toBe(false)
      expect(sidebar().searchFocusPending).toBe(false)
    } finally {
      modal.remove()
    }
  })

  it('YAZ-6330: DrawingSurfaceApi.openAddSearch() opens the Add tab and requests search focus', async () => {
    let handle: import('./ExcalidrawSurface').DrawingSurfaceApi | null = null
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(<ExcalidrawSurface scene={SCENE} theme="light" onSnapshot={() => undefined} onFailed={() => undefined} onCanvasPanelChange={() => undefined} onApi={(a) => (handle = a)} />)
    })
    const toggleSidebar = vi.fn()
    const raw = { getAppState: () => ({ defaultSidebarDockedPreference: false }), toggleSidebar, updateFrameRendering: vi.fn(), updateScene: vi.fn() }
    await act(async () => (last().onExcalidrawAPI as (a: unknown) => void)(raw))
    const sidebar = () => (last().children as { props: { searchFocusPending: boolean } }).props
    expect(sidebar().searchFocusPending).toBe(false)
    await act(async () => handle!.openAddSearch())
    expect(sidebar().searchFocusPending).toBe(true)
    expect(toggleSidebar).toHaveBeenCalledWith({ name: CANVAS_SIDEBAR, tab: 'image-studio', force: true })
  })

  it('the panel`s edge: the arrow keys step 16 px, a drag stops at 260 and 720 px, and each stores the width (demo 6C)', async () => {
    const onCanvasPanelChange = vi.fn()
    container ??= document.createElement('div')
    document.body.appendChild(container)
    root ??= createRoot(container)
    await act(async () => {
      root?.render(<ExcalidrawSurface scene={SCENE} theme="light" onSnapshot={() => undefined} onFailed={() => undefined} onCanvasPanelChange={onCanvasPanelChange} />)
    })
    type Edge = { onResizeKey: (e: unknown) => void; onResizeStart: (e: unknown) => void }
    const edge = () => (last().children as { props: Edge }).props
    act(() => edge().onResizeKey({ key: 'ArrowRight', preventDefault: () => undefined }))
    expect(onCanvasPanelChange).toHaveBeenLastCalledWith(expect.objectContaining({ width: 318 }))
    act(() => edge().onResizeStart({ button: 0, clientX: 100, preventDefault: () => undefined }))
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 5000 }))
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: 5000 }))
    })
    expect(onCanvasPanelChange).toHaveBeenLastCalledWith(expect.objectContaining({ width: 720 }))
    act(() => edge().onResizeStart({ button: 0, clientX: 100, preventDefault: () => undefined }))
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: -5000 }))
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: -5000 }))
    })
    expect(onCanvasPanelChange).toHaveBeenLastCalledWith(expect.objectContaining({ width: 260 }))
  })

  describe('the keys on the board: ⌘F and ⌘C (D6, demo 6N)', () => {
    const fakeApi = (selected: Record<string, boolean>) => ({
      getAppState: () => ({ selectedElementIds: selected, defaultSidebarDockedPreference: false }),
      toggleSidebar: vi.fn(),
      updateFrameRendering: vi.fn(),
      updateScene: vi.fn(),
      getSceneElements: () => [],
      refresh: vi.fn(),
    })
    const press = async (key: string) => {
      const surface = container!.querySelector<HTMLElement>('.drawing-surface')!
      await act(async () => void surface.dispatchEvent(new KeyboardEvent('keydown', { key, code: `Key${key.toUpperCase()}`, metaKey: true, bubbles: true, cancelable: true })))
    }
    const openOn = async (tab: string | null) => {
      const onChange = last().onChange as (elements: unknown[], appState: unknown, files: unknown) => void
      await act(async () => onChange([], { openSidebar: tab === null ? null : { name: CANVAS_SIDEBAR, tab } }, {}))
    }
    const sidebar = () => (last().children as { props: { searchFocusPending: boolean } }).props

    it('⌘F with a selection on the board still goes to the Add search, and opens the tab', async () => {
      await renderWithPanel(false)
      const api = fakeApi({ a: true })
      await act(async () => (last().onExcalidrawAPI as (a: unknown) => void)(api))
      await press('f')
      expect(sidebar().searchFocusPending).toBe(true)
      expect(api.toggleSidebar).toHaveBeenCalledWith({ name: CANVAS_SIDEBAR, tab: 'image-studio', force: true })
    })

    it('⌘F with the Add tab already open keeps it open and asks for the caret again', async () => {
      await renderWithPanel(false)
      const api = fakeApi({})
      await act(async () => (last().onExcalidrawAPI as (a: unknown) => void)(api))
      await openOn('image-studio')
      await press('f')
      expect(api.toggleSidebar).not.toHaveBeenCalled()
      expect(sidebar().searchFocusPending).toBe(true)
    })

    it('⌘C opens the Add tab on its Components chip; a second ⌘C there closes the panel; a selection keeps ⌘C as Copy', async () => {
      resetImageStudioSession()
      await renderWithPanel(false)
      const api = fakeApi({})
      await act(async () => (last().onExcalidrawAPI as (a: unknown) => void)(api))
      await press('c')
      expect(imageStudioSession.getState().chip).toBe('components')
      expect(api.toggleSidebar).toHaveBeenLastCalledWith({ name: CANVAS_SIDEBAR, tab: 'image-studio', force: true })
      await openOn('image-studio')
      await press('c')
      expect(api.toggleSidebar).toHaveBeenLastCalledWith({ name: CANVAS_SIDEBAR, tab: 'image-studio', force: false })
      const copying = fakeApi({ a: true })
      await act(async () => (last().onExcalidrawAPI as (a: unknown) => void)(copying))
      await press('c')
      expect(copying.toggleSidebar).not.toHaveBeenCalled()
    })
  })

  it('a board with no panel, or read only, adds nothing to the menu', async () => {
    await render(false)
    expect(last().hostContextMenuItems).toBeUndefined()
    act(() => root?.unmount())
    root = null
    await renderWithPanel(true)
    expect(last().hostContextMenuItems).toBeUndefined()
  })
})

describe('the engine’s view mode (YAZ-3076 D2, YAZ-3120)', () => {
  it('an editable drawing passes NO viewModeEnabled, so the engine’s own ⌥R still toggles its view mode', async () => {
    await render(false)
    expect(engine.props.length).toBeGreaterThan(0)
    expect(last().viewModeEnabled).toBeUndefined()
    await render(undefined)
    expect(last().viewModeEnabled).toBeUndefined()
  })

  it('a read-only drawing forces it on, and "Allow edits" hands it back to the engine', async () => {
    await render(true)
    expect(last().viewModeEnabled).toBe(true)
    await render(false)
    expect(last().viewModeEnabled).toBeUndefined()
  })
})

describe('a woken drawing keeps its pan and zoom (YAZ-3737 D13)', () => {
  const BOX = { elements: [{ id: 'a', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 }], appState: { viewBackgroundColor: '#fff' }, files: {} }
  const mount = async (startCanvas?: { scrollX: number; scrollY: number; zoom: number }, onApi?: (api: { canvas(): unknown }) => void): Promise<void> => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(<ExcalidrawSurface scene={BOX} startCanvas={startCanvas} theme="light" onSnapshot={() => undefined} onFailed={() => undefined} onApi={onApi} />)
    })
  }

  it('a start view opens on its pan and zoom, over the file`s view and with no fit; none fits the whole scene', async () => {
    await mount({ scrollX: -300, scrollY: 75, zoom: 2.5 })
    const seeded = last().initialData as { appState: Record<string, unknown> }
    expect(seeded.appState).toMatchObject({ viewBackgroundColor: '#fff', scrollX: -300, scrollY: 75, zoom: { value: 2.5 } })
    expect(last().initialState).toBeUndefined()
    act(() => root?.unmount())
    root = null
    container?.remove()
    container = null
    await mount()
    expect((last().initialData as { appState: Record<string, unknown> }).appState).not.toHaveProperty('scrollX')
    expect(last().initialState).toEqual({ viewport: { target: BOX.elements, fit: 'scale-down' } })
  })

  it('the handle reads the engine`s pan and zoom now', async () => {
    let handle: { canvas(): unknown } | null = null
    await mount(undefined, (api) => {
      handle = api
    })
    const onExcalidrawAPI = last().onExcalidrawAPI as (api: unknown) => void
    act(() => onExcalidrawAPI({ getAppState: () => ({ scrollX: 12, scrollY: -8, zoom: { value: 0.5 } }), updateScene: () => undefined, updateFrameRendering: () => undefined }))
    expect(handle!.canvas()).toEqual({ scrollX: 12, scrollY: -8, zoom: 0.5 })
  })
})

describe('a reload from disk drops the images nothing shows (YAZ-3737 D14)', () => {
  it('replaceScene puts in the new scene and its files, THEN prunes the engine`s files', async () => {
    let handle: { replaceScene(scene: unknown): number } | null = null
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(<ExcalidrawSurface scene={SCENE} theme="light" onSnapshot={() => undefined} onFailed={() => undefined} onApi={(api) => (handle = api as never)} />)
    })
    const order: string[] = []
    const raw = { getAppState: () => ({}), getFiles: () => ({ held: {} }), updateFrameRendering: () => undefined, updateScene: vi.fn(() => void order.push('scene')), addFiles: vi.fn(() => void order.push('files')), pruneFiles: vi.fn(() => void order.push('prune')) }
    act(() => (last().onExcalidrawAPI as (api: unknown) => void)(raw))
    const file = { id: 'img', mimeType: 'image/png', dataURL: 'data:image/png;base64,AA==', created: 1 }
    // YAZ-4279 item 5: a picture the engine holds is not handed again (an id is its bytes').
    handle!.replaceScene({ elements: [], appState: {}, files: { img: file, held: { ...file, id: 'held' } } })
    expect(raw.addFiles).toHaveBeenCalledExactlyOnceWith([file])
    expect(raw.pruneFiles).toHaveBeenCalledOnce()
    expect(order).toEqual(['scene', 'files', 'prune'])
  })

  it('YAZ-4279: the file\'s scene never joins ⌘Z: a reload and a merge both go in with `captureUpdate: NEVER`', async () => {
    let handle: { replaceScene(scene: unknown): number; mergeScene(base: unknown, disk: unknown): unknown } | null = null
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(<ExcalidrawSurface scene={SCENE} theme="light" onSnapshot={() => undefined} onFailed={() => undefined} onApi={(api) => (handle = api as never)} />)
    })
    const box = { id: 'b', type: 'rectangle', x: 0, version: 1 }
    const raw = { getAppState: () => ({}), getFiles: () => ({}), getSceneElementsIncludingDeleted: () => [box], updateFrameRendering: () => undefined, updateScene: vi.fn(), addFiles: vi.fn(), pruneFiles: vi.fn() }
    act(() => (last().onExcalidrawAPI as (api: unknown) => void)(raw))
    handle!.replaceScene({ elements: [box], appState: {}, files: {} })
    expect(raw.updateScene).toHaveBeenLastCalledWith(expect.objectContaining({ captureUpdate: 'NEVER' }))
    // The board's own settings in the file come in with the reload: the next save must not write the old background back.
    handle!.replaceScene({ elements: [box], appState: { viewBackgroundColor: '#000' }, files: {} })
    expect(raw.updateScene).toHaveBeenLastCalledWith(expect.objectContaining({ appState: { viewBackgroundColor: '#000' } }))
    const merged = handle!.mergeScene({ elements: [box], appState: {} }, { elements: [{ ...box, strokeColor: 'red' }], appState: {}, files: {} })
    expect(merged).toMatchObject({ version: expect.any(Number) })
    expect(raw.updateScene).toHaveBeenLastCalledWith(expect.objectContaining({ captureUpdate: 'NEVER', elements: [expect.objectContaining({ id: 'b', strokeColor: 'red', version: 2 })] }))
  })
})

/**
 * The canvas panel's handle on a read-only drawing (YAZ-3076 D2, S26): the panel can still look
 * and present, but its inserts, its slide reorder and its slide rename change nothing.
 */
describe('readOnlyHandle', () => {
  const engineApi = () => ({ insertElements: vi.fn(), addFiles: vi.fn(), pruneFiles: vi.fn(), updateScene: vi.fn(), getSceneElements: vi.fn(() => []), setViewport: vi.fn() })

  it('shuts every door that changes the scene, and leaves the views open', () => {
    const raw = engineApi()
    const api = readOnlyHandle(raw as never) as unknown as ReturnType<typeof engineApi>
    api.insertElements([] as never)
    api.addFiles([] as never)
    api.pruneFiles()
    api.updateScene({ elements: [] } as never)
    expect(raw.insertElements).not.toHaveBeenCalled()
    expect(raw.addFiles).not.toHaveBeenCalled()
    expect(raw.pruneFiles).not.toHaveBeenCalled()
    expect(raw.updateScene).not.toHaveBeenCalled()
    // A view, a tool or a dialog is not an edit of the file's elements.
    api.updateScene({ appState: { openDialog: { name: 'imageExport' } } } as never)
    expect(raw.updateScene).toHaveBeenCalledExactlyOnceWith({ appState: { openDialog: { name: 'imageExport' } } })
    api.getSceneElements()
    api.setViewport({} as never)
    expect(raw.getSceneElements).toHaveBeenCalled()
    expect(raw.setViewport).toHaveBeenCalled()
  })
})

/**
 * YAZ-3943 D14 and D6 at the seam: only File › Export Excalidraw Drawing… (`exportScene`) gets the standard
 * fonts; the board's own save (`serialize`, a tab's and the popup's) keeps the board's. And
 * the PDF button reaches the engine only when the host gives `onExportPdf`.
 */
describe('the exported copy and the board itself (YAZ-3943)', () => {
  const ELEMENTS = [{ id: 't', type: 'text', fontFamily: 10 }, { id: 'm', type: 'text', fontFamily: 14 }]
  const fontsOf = (json: string) => (JSON.parse(json) as { elements: { fontFamily: number }[] }).elements.map((e) => e.fontFamily)

  it('exportScene swaps 10 → 6 and 14 → 8; serialize keeps 10 and 14', async () => {
    let handle: import('./ExcalidrawSurface').DrawingSurfaceApi | null = null
    let snapshot: import('./ExcalidrawSurface').DrawingSnapshot | null = null
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(<ExcalidrawSurface scene={{ elements: ELEMENTS, appState: {}, files: {} }} theme="light" onSnapshot={(s) => (snapshot = s)} onFailed={() => undefined} onApi={(a) => (handle = a)} />)
    })
    const api = { getSceneElements: () => ELEMENTS, getAppState: () => ({}), getFiles: () => ({}), refresh: () => undefined, updateScene: () => undefined, updateFrameRendering: () => undefined }
    act(() => (last().onExcalidrawAPI as (a: unknown) => void)(api))
    expect(fontsOf(await handle!.exportScene())).toEqual([6, 8])
    // The mount's baseline snapshot: what a save writes, in a tab and in the page's popup.
    expect(fontsOf(snapshot!.serialize().json)).toEqual([10, 14])
  })

  it('the engine gets `onExportPdf` only from a host that gives it, and the click reaches the host', async () => {
    await render(false)
    expect(last().onExportPdf).toBeUndefined()
    act(() => root?.unmount())
    root = null
    const onExportPdf = vi.fn()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(<ExcalidrawSurface scene={SCENE} theme="light" onSnapshot={() => undefined} onFailed={() => undefined} onExportPdf={onExportPdf} />)
    })
    void (last().onExportPdf as (svg: string, size: unknown) => void)('<svg/>', { width: 1, height: 2 })
    expect(onExportPdf).toHaveBeenCalledWith('<svg/>', { width: 1, height: 2 })
  })
})

/** YAZ-4404 4H and YAZ-4406 4J: the two Settings › Drawings switches reach the engine as props, never as appState. */
describe('the engine props of the round 1 switches', () => {
  const mountWith = async (canvasPrefs?: import('@shared/types').CanvasPrefs): Promise<void> => {
    container ??= document.createElement('div')
    document.body.appendChild(container)
    root ??= createRoot(container)
    await act(async () => {
      root?.render(<ExcalidrawSurface scene={SCENE} theme="light" canvasPrefs={canvasPrefs} onSnapshot={() => undefined} onFailed={() => undefined} />)
    })
  }

  it('both are on by default; each Off reaches the engine at once, and neither goes into the initial appState', async () => {
    const { DEFAULT_CANVAS_PREFS } = await import('@shared/types')
    await mountWith(undefined)
    expect(last()).toMatchObject({ fillSetsTextColor: true, newShapesMatchZoom: true })
    const appState = (last().initialData as { appState: Record<string, unknown> }).appState
    expect(appState).not.toHaveProperty('fillSetsTextColor')
    expect(appState).not.toHaveProperty('newShapesMatchZoom')
    await mountWith({ ...DEFAULT_CANVAS_PREFS, fillSetsTextColor: false })
    expect(last()).toMatchObject({ fillSetsTextColor: false, newShapesMatchZoom: true })
    await mountWith({ ...DEFAULT_CANVAS_PREFS, fillSetsTextColor: false, newShapesMatchZoom: false })
    expect(last()).toMatchObject({ fillSetsTextColor: false, newShapesMatchZoom: false })
  })

  it('YAZ-4469 4B: "Hover outline" is the board value over the app value; no board value follows the app; never appState', async () => {
    const { DEFAULT_CANVAS_PREFS } = await import('@shared/types')
    await mountWith(undefined)
    expect(last().hoverOutline).toBe(true)
    expect((last().initialData as { appState: Record<string, unknown> }).appState).not.toHaveProperty('hoverOutline')
    await mountWith({ ...DEFAULT_CANVAS_PREFS, hoverOutline: false })
    expect(last().hoverOutline).toBe(false)
    for (const [app, board, expected] of [[true, false, false], [false, true, true], [false, undefined, false], [true, undefined, true]] as const) {
      await act(async () => {
        root?.render(<ExcalidrawSurface scene={SCENE} theme="light" canvasPrefs={{ ...DEFAULT_CANVAS_PREFS, hoverOutline: app }} hoverOutline={board} onSnapshot={() => undefined} onFailed={() => undefined} />)
      })
      expect(last().hoverOutline, `app ${app}, board ${board}`).toBe(expected)
    }
  })

  it('YAZ-5771: "Double-click a text box edge" reaches the engine as its prop: Only shrink by default, Fit the text when picked; never appState', async () => {
    const { DEFAULT_CANVAS_PREFS } = await import('@shared/types')
    await mountWith(undefined)
    expect(last().textEdgeDoubleClick).toBe('shrink')
    expect((last().initialData as { appState: Record<string, unknown> }).appState).not.toHaveProperty('textEdgeDoubleClick')
    await mountWith({ ...DEFAULT_CANVAS_PREFS, textEdgeDoubleClick: 'fit' })
    expect(last().textEdgeDoubleClick).toBe('fit')
  })
})

describe('YAZ-4279 UI/UX: ResizeObserver refresh, scrollToElements, repairScene, keepBothScene', () => {
  it('item 3: schedules a single requestAnimationFrame calling api.refresh() when .drawing-surface resizes, and cleans up on unmount', async () => {
    let resizeCb: ResizeObserverCallback | null = null
    const observe = vi.fn()
    const disconnect = vi.fn()
    const origRO = globalThis.ResizeObserver
    const origRAF = globalThis.requestAnimationFrame
    const origCancelRAF = globalThis.cancelAnimationFrame
    const rafCallbacks: FrameRequestCallback[] = []
    globalThis.ResizeObserver = class {
      constructor(cb: ResizeObserverCallback) {
        resizeCb = cb
      }
      observe = observe
      unobserve = vi.fn()
      disconnect = disconnect
    } as unknown as typeof ResizeObserver
    globalThis.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
      rafCallbacks.push(cb)
      return rafCallbacks.length
    })
    globalThis.cancelAnimationFrame = vi.fn()

    try {
      await render(undefined)
      const refresh = vi.fn()
      const fakeApi = {
        refresh,
        getAppState: () => ({}),
        getSceneElements: () => [],
        getSceneElementsIncludingDeleted: () => [],
        getSceneElementsMapIncludingDeleted: () => new Map(),
        getFiles: () => ({}),
        updateScene: vi.fn(),
        updateFrameRendering: vi.fn(),
        addFiles: vi.fn(),
        pruneFiles: vi.fn(),
        setViewport: vi.fn(),
      }
      await act(async () => {
        ;(last().onExcalidrawAPI as (api: unknown) => void)(fakeApi)
      })
      expect(observe).toHaveBeenCalledTimes(1)
      expect(resizeCb).not.toBeNull()

      // Multiple resize notifications coalesce into a single rAF.
      resizeCb!([], {} as ResizeObserver)
      resizeCb!([], {} as ResizeObserver)
      expect(globalThis.requestAnimationFrame).toHaveBeenCalledTimes(1)
      expect(refresh).not.toHaveBeenCalled()

      rafCallbacks[0](16)
      expect(refresh).toHaveBeenCalledTimes(1)

      // Schedule another resize and unmount before rAF fires: observer disconnects and rAF cancels.
      resizeCb!([], {} as ResizeObserver)
      act(() => root?.unmount())
      root = null
      expect(disconnect).toHaveBeenCalledTimes(1)
      expect(globalThis.cancelAnimationFrame).toHaveBeenCalledTimes(1)
    } finally {
      globalThis.ResizeObserver = origRO
      globalThis.requestAnimationFrame = origRAF
      globalThis.cancelAnimationFrame = origCancelRAF
    }
  })

  it('item 10: scrollToElements calls api.setViewport with matching element ids', async () => {
    let handle: import('./ExcalidrawSurface').DrawingSurfaceApi | null = null
    container ??= document.createElement('div')
    document.body.appendChild(container)
    root ??= createRoot(container)
    await act(async () => {
      root?.render(<ExcalidrawSurface scene={SCENE} theme="light" onSnapshot={() => undefined} onFailed={() => undefined} onApi={(a) => (handle = a)} />)
    })
    const setViewport = vi.fn()
    const elA = { id: 'a', type: 'rectangle' }
    const elB = { id: 'b', type: 'rectangle' }
    await act(async () => {
      ;(last().onExcalidrawAPI as (api: unknown) => void)({
        refresh: vi.fn(),
        getAppState: () => ({}),
        getSceneElements: () => [elA, elB],
        getSceneElementsIncludingDeleted: () => [elA, elB],
        getSceneElementsMapIncludingDeleted: () => new Map(),
        getFiles: () => ({}),
        updateScene: vi.fn(),
        updateFrameRendering: vi.fn(),
        addFiles: vi.fn(),
        pruneFiles: vi.fn(),
        setViewport,
      })
    })
    handle!.scrollToElements!(['b'])
    expect(setViewport).toHaveBeenCalledWith({ target: [elB], fit: 'contain', animation: true, offsets: { ui: true } })
  })

  it('item 11: repairScene drops tombstones, deduplicates ids, fixes broken bindings and originalText, and updates immediately', async () => {
    let handle: import('./ExcalidrawSurface').DrawingSurfaceApi | null = null
    container ??= document.createElement('div')
    document.body.appendChild(container)
    root ??= createRoot(container)
    await act(async () => {
      root?.render(<ExcalidrawSurface scene={SCENE} theme="light" onSnapshot={() => undefined} onFailed={() => undefined} onApi={(a) => (handle = a)} />)
    })
    const updateScene = vi.fn()
    const rawElements = [
      { id: 'dead', type: 'rectangle', isDeleted: true, version: 1 },
      { id: 'box', type: 'rectangle', version: 2, boundElements: [{ id: 'missing-arrow', type: 'arrow' }, { id: 'lbl', type: 'text' }] },
      { id: 'box', type: 'rectangle', version: 3, boundElements: [{ id: 'missing-arrow', type: 'arrow' }, { id: 'lbl', type: 'text' }] },
      { id: 'lbl', type: 'text', version: 1, text: 'Hello', originalText: 'Old', containerId: 'ghost-box', frameId: 'ghost-frame' },
    ]
    await act(async () => {
      ;(last().onExcalidrawAPI as (api: unknown) => void)({
        refresh: vi.fn(),
        getAppState: () => ({}),
        getSceneElements: () => rawElements.filter((e) => !e.isDeleted),
        getSceneElementsIncludingDeleted: () => rawElements,
        getSceneElementsMapIncludingDeleted: () => new Map(),
        getFiles: () => ({}),
        updateScene,
        updateFrameRendering: vi.fn(),
        addFiles: vi.fn(),
        pruneFiles: vi.fn(),
        setViewport: vi.fn(),
      })
    })
    const result = handle!.repairScene!()
    expect(result.removedDeleted).toBe(1)
    expect(result.repairedCount).toBeGreaterThanOrEqual(2)
    expect(updateScene).toHaveBeenCalledWith(expect.objectContaining({ captureUpdate: 'IMMEDIATELY' }))
    const updatedElements = updateScene.mock.calls[0][0].elements as Array<Record<string, unknown>>
    expect(updatedElements.map((e) => e.id)).toEqual(['box', 'lbl'])
    expect(updatedElements[0].boundElements).toEqual([{ id: 'lbl', type: 'text' }])
    expect(updatedElements[0].version).toBe(4)
    expect(updatedElements[1].containerId).toBeNull()
    expect(updatedElements[1].frameId).toBeNull()
    expect(updatedElements[1].originalText).toBe('Hello')
  })

  it('item 12: keepBothScene duplicates clashing disk elements at +40,+40 with fresh ids', async () => {
    let handle: import('./ExcalidrawSurface').DrawingSurfaceApi | null = null
    container ??= document.createElement('div')
    document.body.appendChild(container)
    root ??= createRoot(container)
    await act(async () => {
      root?.render(<ExcalidrawSurface scene={SCENE} theme="light" onSnapshot={() => undefined} onFailed={() => undefined} onApi={(a) => (handle = a)} />)
    })
    const updateScene = vi.fn()
    const baseEl = { id: 'r1', type: 'rectangle', x: 10, y: 20, width: 100, height: 50, version: 1 }
    const liveEl = { id: 'r1', type: 'rectangle', x: 10, y: 20, width: 120, height: 50, version: 2 }
    const diskEl = { id: 'r1', type: 'rectangle', x: 10, y: 20, width: 200, height: 50, version: 2 }
    await act(async () => {
      ;(last().onExcalidrawAPI as (api: unknown) => void)({
        refresh: vi.fn(),
        getAppState: () => ({}),
        getSceneElements: () => [liveEl],
        getSceneElementsIncludingDeleted: () => [liveEl],
        getSceneElementsMapIncludingDeleted: () => new Map([['r1', liveEl]]),
        getFiles: () => ({}),
        updateScene,
        updateFrameRendering: vi.fn(),
        addFiles: vi.fn(),
        pruneFiles: vi.fn(),
        setViewport: vi.fn(),
      })
    })
    const res = handle!.keepBothScene!({ elements: [baseEl], appState: {} }, { elements: [diskEl], appState: {}, files: {} }, 'until-checked')
    expect(res.duplicated).toBe(1)
    const updatedElements = updateScene.mock.calls[0][0].elements as Array<Record<string, unknown>>
    expect(updatedElements).toHaveLength(2)
    expect(updatedElements[0]).toMatchObject({ id: 'r1', width: 120 })
    expect(updatedElements[1].id).not.toBe('r1')
    expect(updatedElements[1]).toMatchObject({ x: 50, y: 60, width: 200 })
  })
})
