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
 * makes — bytes, path, `expectedMtime`, and the CONFLICT bar's two answers — is the thing under
 * test. Timers are fake: the 500 ms quiet period is advanced by hand (`idle`). The S-numbers are
 * the approved scenarios on the YAZ-3528 working log.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { api, BridgeRequestError } from '../api'
import { createDrawingFeed } from './drawingFeed'
import { BROKEN_DRAWING_MESSAGE, DISCARD_PROMPT, DrawingModal } from './DrawingModal'
import type { DrawingSurfaceProps } from './ExcalidrawSurface'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../api', async (original) => ({
  ...(await original<typeof import('../api')>()),
  api: { readAsset: vi.fn(), writeAsset: vi.fn(), window: { onFlush: vi.fn() } },
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
const writeAsset = vi.mocked(api.writeAsset)
const onFlush = vi.mocked(api.window.onFlush)
/** The quit handshake's listener, as the modal registered it (main calls it before a window closes). */
let quitFlush: (() => Promise<void> | void) | null = null

const ROOT = '/v'
const TARGET = 'Sketch.excalidraw'
const PATH = '/v/assets/drawings/Sketch.excalidraw'
/** What the mocked seam's `standalone()` returns — the exact bytes a save must carry. */
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
  writeAsset.mockReset()
  writeAsset.mockResolvedValue({ path: PATH, mtime: 999, size: BYTES.length })
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
async function open(read: 'ok' | 'broken' = 'ok', mtime = 100): Promise<Mounted> {
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
    root?.render(<DrawingModal root={ROOT} target={TARGET} theme="light" feed={feed} onClose={onClose} />)
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
  act(() => seam.props?.onSnapshot({ version, serialize: () => ({ json: '', files: {}, referenced: new Set() }), standalone: () => BYTES }))
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

  it('S1: a drawing opened and not touched is CLEAN — the label says Saved (D2: no Save button), nothing is written, ✕ closes, the previews are not poked', async () => {
    const { onClose, poked } = await open()
    emit(7) // the surface's mount snapshot — the baseline, not an edit
    expect(label()).toBe('Saved')
    expect(byText('Save')).toBeUndefined()
    await idle(2000)
    expect(writeAsset).not.toHaveBeenCalled()
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
      root?.render(<DrawingModal root={ROOT} target={TARGET} theme="light" onClose={onClose} />)
    })
    expect(seam.props?.readOnly).toBe(true)
    expect(label()).toBeNull()
    emit(7)
    emit(8) // a version that moves anyway is never an edit
    await idle()
    await click(closeBtn())
    expect(writeAsset).not.toHaveBeenCalled()
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
    expect(writeAsset).not.toHaveBeenCalled()
    await idle(200)
    expect(writeAsset).toHaveBeenCalledTimes(1)
    expect(writeAsset).toHaveBeenCalledWith({ root: ROOT, path: PATH, content: BYTES, expectedMtime: 4242 })
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
    expect(writeAsset).toHaveBeenCalledTimes(2)
    expect(writeAsset).toHaveBeenLastCalledWith({ root: ROOT, path: PATH, content: BYTES, expectedMtime: 999 })
  })

  it('S17: back at the saved version before the quiet period ends writes nothing — the baseline is a value', async () => {
    await open()
    emit(7)
    emit(8)
    emit(7)
    expect(label()).toBe('Saved')
    await idle()
    expect(writeAsset).not.toHaveBeenCalled()
  })

  it('S6: a failed write is an INLINE error and the label says so; the canvas stays, and the next change tries again', async () => {
    const { onClose } = await open()
    emit(1)
    emit(2)
    writeAsset.mockRejectedValueOnce(new BridgeRequestError('IO_ERROR', 'disk is full'))
    await idle()
    expect(errorLine()).toContain('disk is full')
    expect(label()).toBe('Save failed')
    expect(onClose).not.toHaveBeenCalled()
    expect(container?.querySelector('.fake-surface')).not.toBeNull()
    emit(3)
    await idle()
    expect(writeAsset).toHaveBeenCalledTimes(2)
    expect(errorLine()).toBeNull()
    expect(label()).toBe('Saved')
  })

  it('S10 (YAZ-3044 A4): a CONFLICT never wins in silence — the bar shows and the autosave stops writing', async () => {
    const { onClose, poked } = await open('ok', 100)
    emit(1)
    emit(2)
    writeAsset.mockRejectedValueOnce(new BridgeRequestError('CONFLICT', 'drawing changed on disk', 555))
    await idle()
    expect(writeAsset).toHaveBeenCalledTimes(1)
    expect(conflictBar()).toBe('File changed on disk.ReloadKeep mine')
    expect(errorLine()).toBeNull()
    expect(label()).toBe('Unsaved')
    emit(3)
    await idle()
    expect(writeAsset).toHaveBeenCalledTimes(1)
    expect(poked).toEqual([])
    expect(onClose).not.toHaveBeenCalled()
  })

  it('S12: Keep mine writes this canvas over the disk mtime the conflict reported, and the autosave goes on', async () => {
    await open('ok', 100)
    emit(1)
    emit(2)
    writeAsset.mockRejectedValueOnce(new BridgeRequestError('CONFLICT', 'drawing changed on disk', 555))
    await idle()
    await click(byText('Keep mine'))
    expect(writeAsset).toHaveBeenCalledTimes(2)
    expect(writeAsset).toHaveBeenLastCalledWith({ root: ROOT, path: PATH, content: BYTES, expectedMtime: 555 })
    expect(conflictBar()).toBeNull()
    emit(3)
    await idle()
    expect(writeAsset).toHaveBeenLastCalledWith({ root: ROOT, path: PATH, content: BYTES, expectedMtime: 999 })
  })

  it('S11: Reload opens the disk\'s version in a fresh, clean canvas and writes nothing', async () => {
    const { onClose } = await open('ok', 100)
    emit(1)
    emit(2)
    writeAsset.mockRejectedValueOnce(new BridgeRequestError('CONFLICT', 'drawing changed on disk', 555))
    await idle()
    readAsset.mockResolvedValue(asset(555))
    const mounts = seam.mounts
    await click(byText('Reload'))
    expect(seam.mounts).toBeGreaterThan(mounts)
    expect(conflictBar()).toBeNull()
    emit(9) // the new surface's mount snapshot: the new baseline
    await idle()
    expect(label()).toBe('Saved')
    expect(writeAsset).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
    // A save after the reload is guarded by the disk's new mtime.
    emit(10)
    await idle()
    expect(writeAsset).toHaveBeenLastCalledWith({ root: ROOT, path: PATH, content: BYTES, expectedMtime: 555 })
  })

  it('S11: a Reload whose read FAILS keeps the bar up and says why — Keep mine still writes the edits', async () => {
    await open('ok', 100)
    emit(1)
    emit(2)
    writeAsset.mockRejectedValueOnce(new BridgeRequestError('CONFLICT', 'drawing changed on disk', 555))
    await idle()
    readAsset.mockRejectedValue(new BridgeRequestError('NOT_FOUND', 'no such asset'))
    await click(byText('Reload'))
    expect(conflictBar()).not.toBeNull()
    expect(errorLine()).toBe(BROKEN_DRAWING_MESSAGE)
    await click(byText('Keep mine'))
    expect(writeAsset).toHaveBeenLastCalledWith({ root: ROOT, path: PATH, content: BYTES, expectedMtime: 555 })
  })

  it('A4: a CONFLICT that carries no mtime re-reads the file for it — the read is only for the guard', async () => {
    await open('ok', 100)
    emit(1)
    emit(2)
    writeAsset.mockRejectedValueOnce(new BridgeRequestError('CONFLICT', 'drawing changed on disk'))
    readAsset.mockResolvedValue(asset(777))
    await idle()
    await click(byText('Keep mine'))
    expect(writeAsset).toHaveBeenLastCalledWith({ root: ROOT, path: PATH, content: BYTES, expectedMtime: 777 })
  })

  it('A4: a second CONFLICT on Keep mine shows the bar again — it never loops', async () => {
    const { onClose } = await open()
    emit(1)
    emit(2)
    writeAsset.mockRejectedValue(new BridgeRequestError('CONFLICT', 'drawing changed on disk', 7))
    await idle()
    await click(byText('Keep mine'))
    await idle(2000)
    expect(writeAsset).toHaveBeenCalledTimes(2)
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
    expect(writeAsset).toHaveBeenCalledTimes(1)
    expect(writeAsset).toHaveBeenCalledWith({ root: ROOT, path: PATH, content: BYTES, expectedMtime: 100 })
  })

  it('S19: an unmount for any other reason saves what is pending, then never writes again', async () => {
    await open()
    emit(1)
    emit(2)
    await act(async () => root?.unmount())
    root = null
    expect(writeAsset).toHaveBeenCalledTimes(1)
    expect(quitFlush).toBeNull()
    await idle(2000)
    expect(writeAsset).toHaveBeenCalledTimes(1)
  })
})

describe('leaving (YAZ-3528 D3)', () => {
  it('S4: ✕ with a change not yet saved saves it NOW, pokes the previews once, and closes — no question', async () => {
    const { onClose, poked } = await open('ok', 100)
    emit(1)
    emit(2)
    await click(closeBtn())
    expect(writeAsset).toHaveBeenCalledTimes(1)
    expect(strip()).toBeNull()
    expect(poked).toEqual([TARGET])
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a second ✕ while the close is still saving is the SAME close — one write, one poke, one onClose', async () => {
    const { onClose, poked } = await open()
    emit(1)
    emit(2)
    let land: (() => void) | null = null
    writeAsset.mockImplementationOnce(() => new Promise((resolve) => (land = () => resolve({ path: PATH, mtime: 999, size: BYTES.length }))))
    await click(closeBtn())
    await click(closeBtn())
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => land?.())
    expect(writeAsset).toHaveBeenCalledTimes(1)
    expect(poked).toEqual([TARGET])
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('S5: Esc after the autosave already saved closes at once — one write, one poke', async () => {
    const { overlay, onClose, poked } = await open()
    emit(1)
    emit(2)
    await idle()
    await escOn(overlay)
    expect(writeAsset).toHaveBeenCalledTimes(1)
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
    expect(writeAsset).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('S7/S8: ✕ after a failed save tries once more; when that fails too, the strip asks and Cancel stays put', async () => {
    const { onClose } = await open()
    emit(1)
    emit(2)
    writeAsset.mockRejectedValue(new BridgeRequestError('IO_ERROR', 'disk is full'))
    await idle()
    await click(closeBtn())
    expect(writeAsset).toHaveBeenCalledTimes(2)
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
    writeAsset.mockRejectedValue(new BridgeRequestError('IO_ERROR', 'disk is full'))
    await click(closeBtn())
    expect(strip()).toContain(DISCARD_PROMPT)
    await click(byText('Discard'))
    expect(onClose).toHaveBeenCalledTimes(1)
    await act(async () => root?.unmount())
    root = null
    await idle(2000)
    expect(writeAsset).toHaveBeenCalledTimes(1)
  })

  it('S13: ✕ while the conflict bar is up asks; Discard keeps the disk\'s version', async () => {
    const { onClose } = await open()
    emit(1)
    emit(2)
    writeAsset.mockRejectedValueOnce(new BridgeRequestError('CONFLICT', 'drawing changed on disk', 555))
    await idle()
    await click(closeBtn())
    expect(strip()).toContain(DISCARD_PROMPT)
    await click(byText('Discard'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(writeAsset).toHaveBeenCalledTimes(1)
  })

  it('Esc while the strip is up answers the STRIP, not the modal', async () => {
    const { overlay, onClose } = await open()
    emit(1)
    emit(2)
    writeAsset.mockRejectedValue(new BridgeRequestError('IO_ERROR', 'disk is full'))
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
    expect(writeAsset).not.toHaveBeenCalled()
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
