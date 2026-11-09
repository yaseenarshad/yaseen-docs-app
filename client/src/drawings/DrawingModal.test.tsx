/**
 * The drawing modal (YAZ-879): open → edit → the modal AUTOSAVES the sidecar (YAZ-3528) → close
 * pokes the feed.
 *
 * The ENGINE is mocked and nothing else is: `ExcalidrawSurface` — the ONE seam that owns the
 * canvas — stands in as a component that hands its props back, so every rule pinned here is the
 * MODAL's own (the autosave, the failed-save strip, the key scope, the conflict bar) and none of
 * it depends on Excalidraw. The real package cannot load in jsdom anyway (it imports
 * `roughjs/bin/rough` extensionlessly), which is exactly why the seam is a component boundary.
 *
 * `api` is mocked one level down instead of `saveDrawing`, so the write the autosave actually
 * makes — `drawing:save`'s scene, new pictures, path, `expectedMtime` (YAZ-3943 1A1), and the CONFLICT bar's two answers — is the thing under
 * test. Timers are fake: the 500 ms quiet period is advanced by hand (`idle`). The S-numbers are
 * the approved scenarios on the YAZ-3528 working log.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { api, BridgeRequestError } from '../api'
import { placeOverTab } from '../keys/keySheetRequest'
import { createDrawingFeed } from './drawingFeed'
import { _resetRenameContinuity, carryEditorAcrossPane, carryEditorAcrossRename, dirtyPaths, flushRenamedPath, retireDeletedPath } from '../lib/renameContinuity'
import { createWikilinkCandidateSource } from '../editor/wikilink/wikilinkPicker'
import { createWikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { BROKEN_DRAWING_MESSAGE, DISCARD_PROMPT, DrawingModal } from './DrawingModal'
import { ALLOW_FOLDER_TITLE, allowFolderBody } from './usePicturesFolderAllow'
import type { DrawingAppSettings, DrawingSurfaceProps } from './ExcalidrawSurface'
import { DEFAULT_CANVAS_PREFS, type CanvasPrefs } from '@shared/types'

/** The app's drawing settings when a test sets none (YAZ-4436): the defaults, and no door that writes them. */
const NO_SETTINGS: DrawingAppSettings = { canvasPrefs: undefined, onCanvasPrefsChange: undefined }

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../api', async (original) => ({
  ...(await original<typeof import('../api')>()),
  // `app.home` and `pictureFolders` (YAZ-3943 demo round 3): the popup's ask for a board's outside pictures folder.
  api: { readAsset: vi.fn(), drawing: { save: vi.fn(), load: vi.fn() }, window: { onFlush: vi.fn() }, hotkeys: { drawingInFront: vi.fn(async () => undefined) }, app: { home: vi.fn(async () => '/Users/me') }, pictureFolders: { list: vi.fn(async () => []), allow: vi.fn(async () => []) } },
}))

/** The stand-in engine: it renders nothing and reports the props the modal handed it. */
const seam = vi.hoisted(() => ({ props: null as DrawingSurfaceProps | null, mounts: 0 }))
vi.mock('./ExcalidrawSurface', () => ({
  ENGINE_LOAD_FAILED: "Can't open the drawing editor.",
  ExcalidrawSurface: (props: DrawingSurfaceProps) => {
    seam.props = props
    seam.mounts += 1
    return <div className="fake-surface" />
  },
}))

const readAsset = vi.mocked(api.readAsset)
const drawingSave = vi.mocked(api.drawing.save)
const onFlush = vi.mocked(api.window.onFlush)
/** The quit handshake's listener, as the modal registered it (main calls it before a window closes). */
let quitFlush: (() => Promise<boolean | void> | boolean | void) | null = null

const ROOT = '/v'
const TARGET = 'Sketch.excalidraw'
const PATH = '/v/assets/drawings/Sketch.excalidraw'
/** What the mocked seam's `serialize().json` returns — the small scene a save must carry (YAZ-3943 1A1). */
const BYTES = '{"type":"excalidraw","elements":[1]}\n'

const asset = (mtime: number) => ({
  path: PATH,
  mime: 'application/json',
  data: btoa('{"type":"excalidraw","version":2,"elements":[],"appState":{},"files":{}}'),
  size: 10,
  mtime,
})

let root: Root | null = null
let container: HTMLElement | null = null
/** A node OUTSIDE the React root — the YAZ-888 lesson's probe. */
let outside: HTMLElement | null = null

beforeEach(() => {
  seam.props = null
  seam.mounts = 0
  readAsset.mockReset()
  drawingSave.mockReset()
  drawingSave.mockResolvedValue({ path: PATH, mtime: 999, size: BYTES.length, persisted: [] })
  quitFlush = null
  onFlush.mockReset()
  onFlush.mockImplementation((listener) => {
    quitFlush = listener
    return () => {
      if (quitFlush === listener) quitFlush = null
    }
  })
  vi.useFakeTimers()
})

afterEach(() => {
  act(() => root?.unmount())
  _resetRenameContinuity()
  vi.useRealTimers()
  root = null
  container?.remove()
  container = null
  outside?.remove()
  outside = null
})

interface Mounted {
  overlay: HTMLElement
  onClose: ReturnType<typeof vi.fn>
  feed: ReturnType<typeof createDrawingFeed>
  poked: string[]
}

/** Mounts the modal over a resolved (or rejected) read and flushes the load. */
async function open(read: 'ok' | 'broken' = 'ok', mtime = 100, linkProps: Partial<Parameters<typeof DrawingModal>[0]> = {}): Promise<Mounted> {
  if (read === 'ok') readAsset.mockResolvedValue(asset(mtime))
  else readAsset.mockRejectedValue(new BridgeRequestError('NOT_FOUND', 'no such asset'))
  const onClose = vi.fn()
  const feed = createDrawingFeed()
  const poked: string[] = []
  feed.subscribe((t) => poked.push(t))
  container = document.createElement('div')
  document.body.appendChild(container)
  outside = document.createElement('button')
  document.body.appendChild(outside)
  root = createRoot(container)
  await act(async () => {
    root?.render(<DrawingModal {...NO_SETTINGS} root={ROOT} target={TARGET} theme="light" feed={feed} onClose={onClose} {...linkProps} />)
  })
  const overlay = container.querySelector<HTMLElement>('.drawing-modal-overlay')
  if (overlay === null) throw new Error('missing .drawing-modal-overlay')
  return { overlay, onClose, feed, poked }
}

/** The save label in the title bar (D2: it stands where the Save button was); null when there is none. */
const label = () => container?.querySelector('.drawing-modal__bar .save-indicator')?.textContent ?? null
const closeBtn = (): HTMLButtonElement => {
  const btn = container?.querySelector<HTMLButtonElement>('.drawing-modal__close')
  if (btn === null || btn === undefined) throw new Error('missing ✕')
  return btn
}
const byText = (text: string): HTMLButtonElement | undefined =>
  Array.from(container?.querySelectorAll<HTMLButtonElement>('button') ?? []).find((b) => b.textContent === text)
const strip = () => container?.querySelector('.drawing-modal__confirm')?.textContent ?? null
const errorLine = () => container?.querySelector('.drawing-modal__error')?.textContent ?? null
const conflictBar = () => container?.querySelector('.conflict-bar')?.textContent ?? null

/** One snapshot from the stand-in engine; the FIRST is the modal's clean baseline. */
function emit(version: number): void {
  act(() => seam.props?.onSnapshot({ version, serialize: () => ({ json: BYTES, files: {}, referenced: new Set() }) }))
}

/** The autosave's quiet period passes (500 ms after the last change), and its write settles. */
async function idle(ms = 500): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

// Leaving is async (it saves first), so every gesture settles inside an async act.
const escOn = async (el: Node): Promise<void> => {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
}
const mousedownOn = async (el: Node): Promise<void> => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  })
}
const click = async (btn: HTMLButtonElement | undefined): Promise<void> => {
  await act(async () => btn?.click())
}

describe('opening', () => {
  it('loads the scene through the asset pipe and hands it to the ONE seam, with the app theme', async () => {
    await open()
    expect(readAsset).toHaveBeenCalledWith(ROOT, TARGET)
    expect(seam.mounts).toBe(1)
    expect(seam.props?.scene).toEqual({ elements: [], appState: {}, files: {} })
    expect(seam.props?.theme).toBe('light')
    expect(container?.querySelector('.fake-surface')).not.toBeNull()
  })

  it('YAZ-3564 K9, K11: while open, the drawing is in front of the note — main is told, and the key sheet lists drawing keys', async () => {
    await open()
    expect(api.hotkeys.drawingInFront).toHaveBeenLastCalledWith(true)
    expect(placeOverTab()).toBe('drawing')
    await act(async () => root?.unmount())
    root = null
    expect(api.hotkeys.drawingInFront).toHaveBeenLastCalledWith(false)
    expect(placeOverTab()).toBeNull()
  })

  it('S1: a drawing opened and not touched is CLEAN — the label says Saved (D2: no Save button), nothing is written, ✕ closes, the previews are not poked', async () => {
    const { onClose, poked } = await open()
    emit(7) // the surface's mount snapshot — the baseline, not an edit
    expect(label()).toBe('Saved')
    expect(byText('Save')).toBeUndefined()
    await idle(2000)
    expect(drawingSave).not.toHaveBeenCalled()
    await click(closeBtn())
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(poked).toEqual([])
  })
})

describe('read only (YAZ-3076 S28)', () => {
  it('S15: a drawing whose file says read only opens in view mode, shows no label, and never writes', async () => {
    readAsset.mockResolvedValue({ ...asset(100), data: btoa('{"yaseendraw":{"createdAt":1,"updatedAt":2,"readonly":true},"type":"excalidraw","elements":[]}') })
    const onClose = vi.fn()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(<DrawingModal {...NO_SETTINGS} root={ROOT} target={TARGET} theme="light" onClose={onClose} />)
    })
    expect(seam.props?.readOnly).toBe(true)
    expect(label()).toBeNull()
    emit(7)
    emit(8) // a version that moves anyway is never an edit
    await idle()
    await click(closeBtn())
    expect(drawingSave).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('an editable drawing does not', async () => {
    await open()
    expect(seam.props?.readOnly).toBe(false)
  })
})

describe('autosave (YAZ-3528 D1)', () => {
  it('S2/S3: saves ONCE, 500 ms after the LAST change, to the RESOLVED path with the loaded mtime', async () => {
    const { onClose, poked } = await open('ok', 4242)
    emit(1)
    emit(2)
    expect(label()).toBe('Unsaved')
    await idle(300)
    emit(3) // a change inside the quiet period restarts it
    await idle(300)
    expect(drawingSave).not.toHaveBeenCalled()
    await idle(200)
    expect(drawingSave).toHaveBeenCalledTimes(1)
    expect(drawingSave).toHaveBeenCalledWith({ root: ROOT, path: PATH, json: BYTES, newFiles: [], expectedMtime: 4242 })
    expect(label()).toBe('Saved')
    // The modal stays open, and the previews behind the scrim wait for the close.
    expect(onClose).not.toHaveBeenCalled()
    expect(poked).toEqual([])
  })

  it('the next save is guarded by the mtime the last one returned', async () => {
    await open('ok', 100)
    emit(1)
    emit(2)
    await idle()
    emit(3)
    await idle()
    expect(drawingSave).toHaveBeenCalledTimes(2)
    expect(drawingSave).toHaveBeenLastCalledWith({ root: ROOT, path: PATH, json: BYTES, newFiles: [], expectedMtime: 999 })
  })

  // S17 as corrected after the checker's round 1 (YAZ-3551): the real engine's version only grows,
  // so an UNDO is one harmless extra save (rule 36's own trade, `contentVersion.ts`). What the
  // baseline-as-a-value still buys is the engine reporting the saved version again (YAZ-3210).
  it('a snapshot back at the saved version before the quiet period ends writes nothing — the baseline is a value', async () => {
    await open()
    emit(7)
    emit(8)
    emit(7)
    expect(label()).toBe('Saved')
    await idle()
    expect(drawingSave).not.toHaveBeenCalled()
  })

  it('S6: a failed write is an INLINE error and the label says so; the canvas stays, and the next change tries again', async () => {
    const { onClose } = await open()
    emit(1)
    emit(2)
    drawingSave.mockRejectedValueOnce(new BridgeRequestError('IO_ERROR', 'disk is full'))
    await idle()
    expect(errorLine()).toContain('disk is full')
    expect(label()).toBe('Save failed')
    expect(onClose).not.toHaveBeenCalled()
    expect(container?.querySelector('.fake-surface')).not.toBeNull()
    emit(3)
    await idle()
    expect(drawingSave).toHaveBeenCalledTimes(2)
    expect(errorLine()).toBeNull()
    expect(label()).toBe('Saved')
  })

  it('S10 (YAZ-3044 A4): a CONFLICT never wins in silence — the bar shows and the autosave stops writing', async () => {
    const { onClose, poked } = await open('ok', 100)
    emit(1)
    emit(2)
    drawingSave.mockRejectedValueOnce(new BridgeRequestError('CONFLICT', 'drawing changed on disk', 555))
    await idle()
    expect(drawingSave).toHaveBeenCalledTimes(1)
    expect(conflictBar()).toBe('File changed on disk.ReloadKeep mine')
    expect(errorLine()).toBeNull()
    expect(label()).toBe('Unsaved')
    emit(3)
    await idle()
    expect(drawingSave).toHaveBeenCalledTimes(1)
    expect(poked).toEqual([])
    expect(onClose).not.toHaveBeenCalled()
    // The window's flush says not clean (YAZ-3737 D2): a reload would drop this canvas.
    expect(await act(async () => quitFlush?.())).toBe(false)
  })

  it('S12: Keep mine writes this canvas over the disk mtime the conflict reported, and the autosave goes on', async () => {
    await open('ok', 100)
    emit(1)
    emit(2)
    drawingSave.mockRejectedValueOnce(new BridgeRequestError('CONFLICT', 'drawing changed on disk', 555))
    await idle()
    await click(byText('Keep mine'))
    expect(drawingSave).toHaveBeenCalledTimes(2)
    expect(drawingSave).toHaveBeenLastCalledWith({ root: ROOT, path: PATH, json: BYTES, newFiles: [], expectedMtime: 555 })
    expect(conflictBar()).toBeNull()
    emit(3)
    await idle()
    expect(drawingSave).toHaveBeenLastCalledWith({ root: ROOT, path: PATH, json: BYTES, newFiles: [], expectedMtime: 999 })
  })

  it('S11: Reload opens the disk\'s version in a fresh, clean canvas and writes nothing', async () => {
    const { onClose } = await open('ok', 100)
    emit(1)
    emit(2)
    drawingSave.mockRejectedValueOnce(new BridgeRequestError('CONFLICT', 'drawing changed on disk', 555))
    await idle()
    readAsset.mockResolvedValue(asset(555))
    const mounts = seam.mounts
    await click(byText('Reload'))
    expect(seam.mounts).toBeGreaterThan(mounts)
    expect(conflictBar()).toBeNull()
    emit(9) // the new surface's mount snapshot: the new baseline
    await idle()
    expect(label()).toBe('Saved')
    expect(drawingSave).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
    // A save after the reload is guarded by the disk's new mtime.
    emit(10)
    await idle()
    expect(drawingSave).toHaveBeenLastCalledWith({ root: ROOT, path: PATH, json: BYTES, newFiles: [], expectedMtime: 555 })
  })

  it('S11: a Reload whose read FAILS keeps the bar up and says why — Keep mine still writes the edits', async () => {
    await open('ok', 100)
    emit(1)
    emit(2)
    drawingSave.mockRejectedValueOnce(new BridgeRequestError('CONFLICT', 'drawing changed on disk', 555))
    await idle()
    readAsset.mockRejectedValue(new BridgeRequestError('NOT_FOUND', 'no such asset'))
    await click(byText('Reload'))
    expect(conflictBar()).not.toBeNull()
    expect(errorLine()).toBe(BROKEN_DRAWING_MESSAGE)
    await click(byText('Keep mine'))
    expect(drawingSave).toHaveBeenLastCalledWith({ root: ROOT, path: PATH, json: BYTES, newFiles: [], expectedMtime: 555 })
  })

  it('YAZ-3552: Reload closes the strip with the bar it answers', async () => {
    await open('ok', 100)
    emit(1)
    emit(2)
    drawingSave.mockRejectedValueOnce(new BridgeRequestError('CONFLICT', 'drawing changed on disk', 555))
    await click(closeBtn())
    expect(strip()).toContain(DISCARD_PROMPT)
    readAsset.mockResolvedValue(asset(555))
    await click(byText('Reload'))
    expect(strip()).toBeNull()
    expect(conflictBar()).toBeNull()
  })

  it('a snapshot from the canvas a Reload replaced never starts the autosave', async () => {
    await open('ok', 100)
    emit(1)
    emit(2)
    drawingSave.mockRejectedValueOnce(new BridgeRequestError('CONFLICT', 'drawing changed on disk', 555))
    await idle()
    const oldCanvas = seam.props?.onSnapshot
    readAsset.mockResolvedValue(asset(555))
    await click(byText('Reload'))
    // The replaced canvas reports one more change on its way out: it must not become the baseline.
    act(() => oldCanvas?.({ version: 50, serialize: () => ({ json: BYTES, files: {}, referenced: new Set() }) }))
    emit(9) // the new canvas's mount snapshot: the real baseline
    await idle()
    expect(drawingSave).toHaveBeenCalledTimes(1)
    emit(10)
    await idle()
    expect(drawingSave).toHaveBeenLastCalledWith({ root: ROOT, path: PATH, json: BYTES, newFiles: [], expectedMtime: 555 })
  })

  it('Discard while a close is still retrying leaves ONCE', async () => {
    const { onClose } = await open()
    emit(1)
    emit(2)
    drawingSave.mockRejectedValueOnce(new BridgeRequestError('IO_ERROR', 'disk is full'))
    drawingSave.mockRejectedValueOnce(new BridgeRequestError('IO_ERROR', 'disk is full'))
    await idle()
    await click(closeBtn())
    expect(strip()).toContain(DISCARD_PROMPT)
    let land: (() => void) | null = null
    drawingSave.mockImplementationOnce(() => new Promise((resolve) => (land = () => resolve({ path: PATH, mtime: 999, size: BYTES.length, persisted: [] }))))
    await click(closeBtn()) // a retry starts
    await click(byText('Discard'))
    await act(async () => land?.())
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('A4: a CONFLICT that carries no mtime re-reads the file for it — the read is only for the guard', async () => {
    await open('ok', 100)
    emit(1)
    emit(2)
    drawingSave.mockRejectedValueOnce(new BridgeRequestError('CONFLICT', 'drawing changed on disk'))
    readAsset.mockResolvedValue(asset(777))
    await idle()
    await click(byText('Keep mine'))
    expect(drawingSave).toHaveBeenLastCalledWith({ root: ROOT, path: PATH, json: BYTES, newFiles: [], expectedMtime: 777 })
  })

  it('A4: a second CONFLICT on Keep mine shows the bar again — it never loops', async () => {
    const { onClose } = await open()
    emit(1)
    emit(2)
    drawingSave.mockRejectedValue(new BridgeRequestError('CONFLICT', 'drawing changed on disk', 7))
    await idle()
    await click(byText('Keep mine'))
    await idle(2000)
    expect(drawingSave).toHaveBeenCalledTimes(2)
    expect(conflictBar()).not.toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('S14: the quit handshake saves a change the quiet period has not reached yet', async () => {
    await open('ok', 100)
    emit(1)
    emit(2)
    expect(quitFlush).not.toBeNull()
    await act(async () => {
      await quitFlush?.()
    })
    expect(drawingSave).toHaveBeenCalledTimes(1)
    expect(drawingSave).toHaveBeenCalledWith({ root: ROOT, path: PATH, json: BYTES, newFiles: [], expectedMtime: 100 })
  })

  it('S19: an unmount for any other reason saves what is pending, then never writes again', async () => {
    await open()
    emit(1)
    emit(2)
    await act(async () => root?.unmount())
    root = null
    expect(drawingSave).toHaveBeenCalledTimes(1)
    expect(quitFlush).toBeNull()
    await idle(2000)
    expect(drawingSave).toHaveBeenCalledTimes(1)
  })
})

describe('leaving (YAZ-3528 D3)', () => {
  it('S4: ✕ with a change not yet saved saves it NOW, pokes the previews once, and closes — no question', async () => {
    const { onClose, poked } = await open('ok', 100)
    emit(1)
    emit(2)
    await click(closeBtn())
    expect(drawingSave).toHaveBeenCalledTimes(1)
    expect(strip()).toBeNull()
    expect(poked).toEqual([TARGET])
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a second ✕ while the close is still saving is the SAME close — one write, one poke, one onClose', async () => {
    const { onClose, poked } = await open()
    emit(1)
    emit(2)
    let land: (() => void) | null = null
    drawingSave.mockImplementationOnce(() => new Promise((resolve) => (land = () => resolve({ path: PATH, mtime: 999, size: BYTES.length, persisted: [] }))))
    await click(closeBtn())
    await click(closeBtn())
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => land?.())
    expect(drawingSave).toHaveBeenCalledTimes(1)
    expect(poked).toEqual([TARGET])
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('S5: Esc after the autosave already saved closes at once — one write, one poke', async () => {
    const { overlay, onClose, poked } = await open()
    emit(1)
    emit(2)
    await idle()
    await escOn(overlay)
    expect(drawingSave).toHaveBeenCalledTimes(1)
    expect(poked).toEqual([TARGET])
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('click-away is the same gesture — and a click INSIDE the sheet does nothing', async () => {
    const { overlay, onClose } = await open()
    emit(1)
    emit(2)
    await mousedownOn(overlay.querySelector('.drawing-modal') as Node)
    expect(onClose).not.toHaveBeenCalled()
    await mousedownOn(overlay)
    expect(drawingSave).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('YAZ-3552: the strip goes when the problem does — a later save that lands, or Keep mine', async () => {
    await open()
    emit(1)
    emit(2)
    drawingSave.mockRejectedValueOnce(new BridgeRequestError('IO_ERROR', 'disk is full'))
    await click(closeBtn())
    expect(strip()).toContain(DISCARD_PROMPT)
    emit(3)
    await idle()
    expect(label()).toBe('Saved')
    expect(strip()).toBeNull()

    emit(4)
    drawingSave.mockRejectedValueOnce(new BridgeRequestError('CONFLICT', 'drawing changed on disk', 555))
    await click(closeBtn())
    expect(strip()).toContain(DISCARD_PROMPT)
    await click(byText('Keep mine'))
    expect(strip()).toBeNull()
    expect(conflictBar()).toBeNull()
  })

  it('a conflict after a failed save shows the bar alone — the older error line goes', async () => {
    await open()
    emit(1)
    emit(2)
    drawingSave.mockRejectedValueOnce(new BridgeRequestError('IO_ERROR', 'disk is full'))
    await idle()
    expect(errorLine()).toContain('disk is full')
    emit(3)
    drawingSave.mockRejectedValueOnce(new BridgeRequestError('CONFLICT', 'drawing changed on disk', 555))
    await idle()
    expect(conflictBar()).not.toBeNull()
    expect(errorLine()).toBeNull()
  })

  it('a change made while the close is saving is saved too — no question, because nothing failed', async () => {
    const { onClose } = await open()
    emit(1)
    emit(2)
    let land: (() => void) | null = null
    drawingSave.mockImplementationOnce(() => new Promise((resolve) => (land = () => resolve({ path: PATH, mtime: 999, size: BYTES.length, persisted: [] }))))
    await click(closeBtn())
    emit(3)
    await act(async () => land?.())
    expect(drawingSave).toHaveBeenCalledTimes(2)
    expect(drawingSave).toHaveBeenLastCalledWith({ root: ROOT, path: PATH, json: BYTES, newFiles: [], expectedMtime: 999 })
    expect(strip()).toBeNull()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('S7/S8: ✕ after a failed save tries once more; when that fails too, the strip asks and Cancel stays put', async () => {
    const { onClose } = await open()
    emit(1)
    emit(2)
    drawingSave.mockRejectedValue(new BridgeRequestError('IO_ERROR', 'disk is full'))
    await idle()
    await click(closeBtn())
    expect(drawingSave).toHaveBeenCalledTimes(2)
    expect(strip()).toContain(DISCARD_PROMPT)
    expect(onClose).not.toHaveBeenCalled()
    await click(byText('Cancel'))
    expect(strip()).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    expect(container?.querySelector('.fake-surface')).not.toBeNull()
  })

  it('S9: Discard closes and writes nothing more — the unmount flush included', async () => {
    const { onClose } = await open()
    emit(1)
    emit(2)
    drawingSave.mockRejectedValue(new BridgeRequestError('IO_ERROR', 'disk is full'))
    await click(closeBtn())
    expect(strip()).toContain(DISCARD_PROMPT)
    await click(byText('Discard'))
    expect(onClose).toHaveBeenCalledTimes(1)
    await act(async () => root?.unmount())
    root = null
    await idle(2000)
    expect(drawingSave).toHaveBeenCalledTimes(1)
  })

  it('S13: ✕ while the conflict bar is up asks; Discard keeps the disk\'s version', async () => {
    const { onClose } = await open()
    emit(1)
    emit(2)
    drawingSave.mockRejectedValueOnce(new BridgeRequestError('CONFLICT', 'drawing changed on disk', 555))
    await idle()
    await click(closeBtn())
    expect(strip()).toContain(DISCARD_PROMPT)
    await click(byText('Discard'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(drawingSave).toHaveBeenCalledTimes(1)
  })

  it('Esc while the strip is up answers the STRIP, not the modal', async () => {
    const { overlay, onClose } = await open()
    emit(1)
    emit(2)
    drawingSave.mockRejectedValue(new BridgeRequestError('IO_ERROR', 'disk is full'))
    await escOn(overlay)
    expect(strip()).toContain(DISCARD_PROMPT)
    await escOn(overlay)
    expect(strip()).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })
})

/**
 * ⚡ THE YAZ-888 LESSON, pinned. React flushes mount effects inside the dispatch of the event that
 * opened the component, so a listener on `window` hears the very keystroke or click that opened
 * this modal. Bound to the overlay, a key from outside it is simply not ours.
 */
describe('key scope (⚡ the YAZ-888 lesson)', () => {
  it('an Escape dispatched OUTSIDE the overlay does nothing at all', async () => {
    const { onClose } = await open()
    emit(1)
    await escOn(outside as Node)
    await escOn(document.body)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('a mousedown OUTSIDE the overlay does nothing either', async () => {
    const { onClose } = await open()
    emit(1)
    await mousedownOn(outside as Node)
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('a sidecar that will not open', () => {
  it('S18: is the error state — a message, no canvas, no label, and no way to write', async () => {
    const { onClose } = await open('broken')
    expect(errorLine()).toBe(BROKEN_DRAWING_MESSAGE)
    expect(seam.mounts).toBe(0)
    expect(container?.querySelector('.fake-surface')).toBeNull()
    expect(label()).toBeNull()
    // Closing is all it offers, and it needs no confirm — there is nothing to discard.
    await click(closeBtn())
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(drawingSave).not.toHaveBeenCalled()
  })
})

/**
 * 🔒 THE ENGINE SEAM. `ExcalidrawSurface` is the one file YAZ-868 rewrites to swap in yaseendraw;
 * the modal must reach the canvas only through it. Read as SOURCE on purpose: a runtime assertion
 * would pass just as well with a second, hidden import of the package.
 */
describe('the engine seam (🔒 one file, YAZ-868 swaps it)', () => {
  const source = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8')

  it('DrawingModal names neither the engine nor its loader — only the seam', () => {
    const src = source('./DrawingModal.tsx')
    const imports = src.match(/^import .*$/gm) ?? []
    expect(imports.some((line) => line.includes("'./ExcalidrawSurface'"))).toBe(true)
    expect(imports.some((line) => line.includes('@excalidraw'))).toBe(false)
    expect(imports.some((line) => line.includes('renderScene'))).toBe(false)
  })

  it('the canvas element itself is mounted in the surface and nowhere else', () => {
    // `<ExcalidrawSurface …>` in the modal is the SEAM; `<Excalidraw …>` is the engine.
    const engineElement = /<Excalidraw(?!Surface)[\s/>]/
    expect(source('./ExcalidrawSurface.tsx')).toMatch(engineElement)
    expect(source('./DrawingModal.tsx')).not.toMatch(engineElement)
  })

  it('the modal has no canvas panel (YAZ-3038): it never passes the prop that turns it on', () => {
    expect(source('./DrawingModal.tsx')).not.toMatch(/onCanvasPanelChange|canvasPanel/)
    expect(source('./ExcalidrawSurface.tsx')).toMatch(/useState\(\(\) => onCanvasPanelChange !== undefined\)/)
  })
})

/** YAZ-4436 (3A1): the Settings › Drawings rows reach the note embed's popup, as they reach a drawing tab. */
describe('the app drawing settings in the popup', () => {
  it('hands the canvas the canvas prefs (fold arrows Off, fill and zoom rows, new shapes) and the door that writes them', async () => {
    const canvasPrefs: CanvasPrefs = { ...DEFAULT_CANVAS_PREFS, foldArrowsOpen: 'off', foldArrowSize: 150, foldArrowThickness: 'thin', foldArrowMinSize: 20, newElementStyle: 'keep', fillSetsTextColor: false, newShapesMatchZoom: false }
    const onCanvasPrefsChange = vi.fn()
    await open('ok', 100, { canvasPrefs, onCanvasPrefsChange })
    expect(seam.props?.canvasPrefs).toBe(canvasPrefs)
    // a pref the popup's engine moves (a tool lock, the grid) is the app's setting too, as in a tab
    const moved = { ...canvasPrefs, toolLock: !canvasPrefs.toolLock }
    seam.props?.onCanvasPrefsChange?.(moved)
    expect(onCanvasPrefsChange).toHaveBeenCalledWith(moved)
  })
})

/** YAZ-4039: the note embed's popup has the page links a drawing tab has (pills, hover, clicks, menu, picker, paste). */
describe('page links in the popup', () => {
  const linkSource = () => {
    const source = createWikilinkResolveSource()
    source.update((target) => (target === 'Known' ? '/v/Known.md' : null))
    return source
  }
  const hit = { elementId: 't', inner: 'Known', start: 0, end: 9, rect: { left: 10, top: 10, right: 60, bottom: 30 } }

  it('has no links with no resolve source: the pills stay text', async () => {
    await open()
    expect(seam.props?.links).toBeUndefined()
  })

  it('draws, opens and shows the menu of a pill, inside the sheet', async () => {
    const onOpenLinkBackground = vi.fn()
    const candidates = createWikilinkCandidateSource()
    candidates.update([{ name: 'Known', insert: 'V-7', label: 'Known', path: '/v/Known.md' }])
    const { overlay, onClose } = await open('ok', 100, { wikilinks: linkSource(), wikilinkCandidates: candidates, onOpenLink: vi.fn(), onOpenLinkBackground })
    const links = seam.props!.links!
    expect(links.hostLinks.resolve('Known')).toEqual({ label: 'Known' })
    expect(links.hostLinks.onPointerDown?.(hit, new PointerEvent('pointerdown', { metaKey: true }))).toBe(true)
    expect(onOpenLinkBackground).toHaveBeenCalledWith('/v/Known.md')
    expect(links.hostLinks.pasteLink?.('/v/Known.md')).toBe('[[V-7]]')
    act(() => void links.hostLinks.onContextMenu?.({ ...hit, replace: vi.fn() }, new MouseEvent('contextmenu', { clientX: 40, clientY: 20 })))
    const menu = overlay.querySelector('.drawing-modal .ctx-menu--editor')
    expect([...menu!.querySelectorAll('.ctx-menu__item')].map((row) => row.textContent)).toContain('Remove link')
    // a click on the menu is inside the sheet: not a click-away
    act(() => void menu!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(onClose).not.toHaveBeenCalled()
  })
})

/** YAZ-3943 1A1: the popup saves as a tab does — the small scene, only the pictures main lacks, and the 50 MB notice. */
describe('the popup saves through drawing:save (YAZ-3943 1A1)', () => {
  const png = (b64: string) => ({ mimeType: 'image/png', dataURL: `data:image/png;base64,${b64}` })
  const snap = (version: number, files: Record<string, { mimeType: string; dataURL: string }>) =>
    act(() => seam.props?.onSnapshot({ version, serialize: () => ({ json: BYTES, files, referenced: new Set(Object.keys(files)) }) }))

  it('ships only pictures main does not have: not the ones the board had at load, and each new one once', async () => {
    readAsset.mockResolvedValue({ ...asset(100), data: btoa(JSON.stringify({ elements: [{ type: 'image', fileId: 'old' }], files: { old: { id: 'old', ...png('b2xk') } } })) })
    const onNotice = vi.fn()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root?.render(<DrawingModal {...NO_SETTINGS} root={ROOT} target={TARGET} theme="light" onClose={() => undefined} onNotice={onNotice} />))
    snap(1, { old: png('b2xk') })
    drawingSave.mockResolvedValueOnce({ path: PATH, mtime: 200, size: 1, persisted: ['new', 'old'], movedOut: true })
    snap(2, { old: png('b2xk'), new: png('bmV3') })
    await idle()
    expect(drawingSave).toHaveBeenLastCalledWith({ root: ROOT, path: PATH, json: BYTES, newFiles: [{ fileId: 'new', ...png('bmV3') }], expectedMtime: 100 })
    expect(onNotice).toHaveBeenCalledWith("This board's pictures moved to the assets folder, because the file passed 50 MB.")
    snap(3, { old: png('b2xk'), new: png('bmV3') })
    await idle()
    expect(drawingSave).toHaveBeenLastCalledWith({ root: ROOT, path: PATH, json: BYTES, newFiles: [], expectedMtime: 200 })
  })

  it('YAZ-4071 7H: Keep mine ships every picture again: the version it overwrites may lack one', async () => {
    readAsset.mockResolvedValue({ ...asset(100), data: btoa(JSON.stringify({ elements: [{ type: 'image', fileId: 'pic' }], files: { pic: { id: 'pic', ...png('cGlj') } } })) })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root?.render(<DrawingModal {...NO_SETTINGS} root={ROOT} target={TARGET} theme="light" onClose={() => undefined} />))
    snap(1, { pic: png('cGlj') })
    drawingSave.mockRejectedValueOnce(new BridgeRequestError('CONFLICT', 'drawing changed on disk', 555))
    snap(2, { pic: png('cGlj') })
    await idle()
    expect(drawingSave).toHaveBeenLastCalledWith(expect.objectContaining({ newFiles: [] }))
    await click(byText('Keep mine'))
    expect(drawingSave).toHaveBeenLastCalledWith({ root: ROOT, path: PATH, json: BYTES, newFiles: [{ fileId: 'pic', ...png('cGlj') }], expectedMtime: 555 })
  })

  it('YAZ-4071 7H: a save that moved the pictures out by the 50 MB rule replaces the set, so a picture deleted in it ships again after an undo', async () => {
    readAsset.mockResolvedValue({ ...asset(100), data: btoa(JSON.stringify({ elements: [{ type: 'image', fileId: 'a' }, { type: 'image', fileId: 'b' }], files: { a: { id: 'a', ...png('YQ==') }, b: { id: 'b', ...png('Yg==') } } })) })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root?.render(<DrawingModal {...NO_SETTINGS} root={ROOT} target={TARGET} theme="light" onClose={() => undefined} />))
    snap(1, { a: png('YQ=='), b: png('Yg==') })
    drawingSave.mockResolvedValueOnce({ path: PATH, mtime: 200, size: 1, persisted: ['a'], movedOut: true })
    snap(2, { a: png('YQ==') })
    await idle()
    snap(3, { a: png('YQ=='), b: png('Yg==') })
    await idle()
    expect(drawingSave).toHaveBeenLastCalledWith({ root: ROOT, path: PATH, json: BYTES, newFiles: [{ fileId: 'b', ...png('Yg==') }], expectedMtime: 200 })
  })
})

/** YAZ-4074 6A item 12: the popup says what a tab says when a board's pictures are missing. */
describe('missing pictures in the popup', () => {
  it('says so once when it opens, as a drawing tab does', async () => {
    vi.mocked(api.drawing.load).mockRejectedValue(new Error('no store'))
    readAsset.mockResolvedValue({ ...asset(100), data: btoa(JSON.stringify({ elements: [{ type: 'image', fileId: 'gone' }, { type: 'image', fileId: 'lost' }, { type: 'image', fileId: 'here' }], files: { here: { id: 'here', mimeType: 'image/png', dataURL: 'data:image/png;base64,aGk=' } } })) })
    const onNotice = vi.fn()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root?.render(<DrawingModal {...NO_SETTINGS} root={ROOT} target={TARGET} theme="light" onClose={() => undefined} onNotice={onNotice} />))
    await act(async () => undefined)
    expect(onNotice).toHaveBeenCalledTimes(1)
    expect(onNotice).toHaveBeenCalledWith('2 pictures of this board are missing', 'error')
  })
})

/** YAZ-3943 demo round 3: a board naming an outside pictures folder this Mac has not allowed asks in the popup too. */
describe('the outside pictures folder in the popup', () => {
  const board = (block: Record<string, unknown>) => ({ ...asset(100), data: btoa(JSON.stringify({ yaseendraw: { createdAt: 1, updatedAt: 2, ...block }, elements: [], appState: {}, files: {} })) })

  it('asks once when it opens; "Not now" allows nothing; a board with its folder in the vault asks main nothing', async () => {
    const list = vi.mocked(api.pictureFolders.list)
    list.mockClear()
    readAsset.mockResolvedValue(board({ pictures: 'assets', picturesFolder: '/Users/me/Pictures/Boards' }))
    await act(async () => {
      container = document.createElement('div')
      document.body.appendChild(container)
      root = createRoot(container)
      root.render(<DrawingModal {...NO_SETTINGS} root={ROOT} target={TARGET} theme="light" feed={createDrawingFeed()} onClose={vi.fn()} />)
    })
    await act(async () => undefined)
    expect(container?.querySelector('.confirm__text')?.textContent).toBe(`${ALLOW_FOLDER_TITLE}${allowFolderBody('~/Pictures/Boards')}`)
    act(() => byText('Not now')!.click())
    expect(container?.querySelector('.confirm__text')).toBeNull()
    expect(api.pictureFolders.allow).not.toHaveBeenCalled()
    act(() => root?.unmount())
    container?.remove()

    list.mockClear()
    readAsset.mockResolvedValue(board({ pictures: 'assets', picturesFolder: 'Board pictures' }))
    await act(async () => {
      container = document.createElement('div')
      document.body.appendChild(container)
      root = createRoot(container)
      root.render(<DrawingModal {...NO_SETTINGS} root={ROOT} target={TARGET} theme="light" feed={createDrawingFeed()} onClose={vi.fn()} />)
    })
    expect(list).not.toHaveBeenCalled()
    expect(container?.querySelector('.confirm__text')).toBeNull()
  })
})

describe('rename and delete continuity (YAZ-4515)', () => {
  it('dirtyPaths() sees the modal\'s unsaved edits, and a save clears them', async () => {
    await open()
    emit(1)
    expect(dirtyPaths()).toEqual([])
    emit(2)
    expect(dirtyPaths()).toEqual([PATH])
    await idle()
    expect(dirtyPaths()).toEqual([])
  })

  it('a rename flushes the dirty canvas to the old path BEFORE the move, then closes the modal, which never writes the old path again', async () => {
    const { onClose } = await open()
    emit(1)
    emit(2)
    // The renaming window's step (a): the edits go to disk and travel with the file.
    await act(async () => { await flushRenamedPath(PATH) })
    expect(drawingSave).toHaveBeenCalledTimes(1)
    expect(drawingSave.mock.calls[0]![0]).toMatchObject({ path: PATH, json: BYTES })
    act(() => carryEditorAcrossRename(PATH, '/v/assets/drawings/Renamed.excalidraw'))
    expect(onClose).toHaveBeenCalledTimes(1)
    // A late change, the quiet period, the quit handshake and the unmount: none of them writes the old path.
    emit(3)
    await idle(2000)
    expect(await quitFlush?.()).not.toBe(false)
    await act(async () => root?.unmount())
    root = null
    expect(drawingSave).toHaveBeenCalledTimes(1)
    expect(dirtyPaths()).toEqual([])
  })

  it('a trash while the modal is dirty closes it and writes nothing, so the file is not recreated', async () => {
    const { onClose } = await open()
    emit(1)
    emit(2)
    act(() => retireDeletedPath(PATH))
    expect(onClose).toHaveBeenCalledTimes(1)
    await idle(2000)
    await act(async () => root?.unmount())
    root = null
    expect(drawingSave).not.toHaveBeenCalled()
  })

  it('a pane move of a tab of the same file leaves the modal open, dirty, and still saving', async () => {
    const { onClose } = await open()
    emit(1)
    emit(2)
    act(() => carryEditorAcrossPane(PATH))
    expect(onClose).not.toHaveBeenCalled()
    expect(dirtyPaths()).toEqual([PATH])
    expect(drawingSave).not.toHaveBeenCalled()
    await idle()
    expect(drawingSave).toHaveBeenCalledTimes(1)
  })
})
