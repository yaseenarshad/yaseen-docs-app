/**
 * THE DRAWING MODAL (YAZ-879, fourth build unit of the Excalidraw embed YAZ-852): click a preview
 * → the scene opens full-size → edit → the modal AUTOSAVES the sidecar (YAZ-3528) → close, and
 * every preview of that target re-renders.
 *
 * 🔒 A MODAL, NEVER A NODE VIEW. The embed stays plain markdown text under decorations (rule 27),
 * so there is no node to host an editor in — and a full drawing canvas inside a text column would
 * fight the caret for every key it owns. This is React beside the editor, the `FolderView`
 * / `PageTitle` precedent: `Editor`'s `CrepeHost` holds `openDrawing`, the preview's click sets it
 * (`drawingPreview.onOpenDrawing`), and this renders over the window.
 *
 * 🔒 CHROME ONLY. Everything about the ENGINE — the canvas, what "changed" means, how a scene
 * serializes — lives behind `ExcalidrawSurface`, and nothing in this file imports the package or
 * anything that does. Since YAZ-3028 a drawing TAB (`DrawingEditor`) shares that one surface; the
 * modal saves its `standalone()` scene (the images inside it), as it always has.
 * `DrawingModal.test.tsx` pins the boundary.
 *
 * ⚡ KEYS ARE THE OVERLAY'S, NEVER `window`'s (the YAZ-888 lesson, learned by `ConfirmRename` and
 * paid for in e2e): React flushes a component's mount effects INSIDE the dispatch of the event
 * that opened it, so a `window` listener installed on mount hears that very keystroke or click.
 * The preview opens this on a CLICK, and a `window` mousedown listener would have closed it in the
 * same tick. Bound to the overlay, it only ever hears what happens inside itself — and the overlay
 * takes focus on mount so Esc reaches it before the canvas exists.
 *
 * AUTOSAVE ON THE VERSION, NOT THE BYTES (YAZ-3528 D1, the tab's rule): `Autosave<number>` is fed
 * the surface's cheap version and serializes ONCE, inside `write`, 500 ms after the last change.
 * The FIRST snapshot is the clean baseline, so a drawing opened and not touched is never written.
 * Only the save STATUS is state, so a drag costs at most one render here (Saved → Unsaved), never
 * one per pointer move. The quit handshake (`window.onFlush`) and an unmount both save what is
 * pending. A read-only drawing gets no autosave at all.
 *
 * LEAVING (YAZ-3528 D3): Esc / click-away / ✕ are one gesture — save what is left, poke the
 * previews once if anything landed, close. Only a save that FAILED, or one a conflict blocks,
 * raises the inline strip below the title bar — deliberately not a second sheet stacked over this
 * one, which is a modal over a modal for a one-line question. Discard then writes nothing more.
 *
 * A CONFLICT (YAZ-3044 A4) — the same drawing saved from a tab since this modal read it — shows the
 * tab's own `ConflictBar` under the title bar and blocks the autosave: Reload opens the disk's
 * version here (this canvas's edits are dropped), Keep mine writes this canvas over it. The modal
 * never wins in silence.
 *
 * FAILURES are inline and never a dialog: a sidecar that is missing, unreadable or not a scene
 * opens as the error state (message + close, nothing to save), and a failed write leaves the modal
 * open with its error line and the canvas untouched — a save that failed must not eat the drawing.
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { HotkeyOverrides } from '@shared/hotkeyBindings'
import type { HotkeyAside } from '@shared/keys'
import { api } from '../api'
import { setPlaceOverTab } from '../keys/keySheetRequest'
import { ConflictBar } from '../documents/ConflictBar'
import { SaveIndicator } from '../editor/SaveIndicator'
import { Autosave, SaveConflict, type SaveStatus } from '../lib/autosave'
import type { MutableDrawingFeed } from './drawingFeed'
import { openDrawing, type LoadedDrawing } from './drawingScene'
import type { DrawingSnapshot } from './ExcalidrawSurface'
import { saveDrawing, saveErrorMessage } from './saveDrawing'
import './drawingModal.css'

/**
 * The ONE canvas, in its own chunk (YAZ-3028): since a drawing tab shares it, it carries Draw's engine
 * options (canvas prefs, fit-on-open, the toolbar mode), and a note that is only being read never
 * needs them. It arrives with the first open, beside the engine it loads anyway.
 */
const ExcalidrawSurface = lazy(() => import('./ExcalidrawSurface').then((m) => ({ default: m.ExcalidrawSurface })))

/** What a sidecar that will not open says — the modal's twin of the preview's broken chip. */
export const BROKEN_DRAWING_MESSAGE = "This drawing can't be opened: its file is missing or is not a scene."

/** The inline confirm's copy (an in-modal strip, not a sheet), asked only when a save failed or a conflict blocks it. */
export const DISCARD_PROMPT = 'Changes are not saved. Discard them?'

interface DrawingModalProps {
  /** Vault root; with the target it is all `openDrawing` needs. */
  root: string
  /** The embed's raw target, exactly as the note spells it — the resolution rule is the pipe's. */
  target: string
  /** The app's resolved appearance, handed straight to the surface. */
  theme: 'light' | 'dark'
  /** Poked on close when a save landed, so every preview of this target re-reads (YAZ-878's feed). */
  feed?: MutableDrawingFeed
  /** Close: the host drops the modal (it is unmounted, never hidden). */
  onClose: () => void
  /** `settings.hotkeys` (YAZ-3564 K5): the drawing keys as the user set them. Omitted = the defaults. */
  hotkeys?: HotkeyOverrides
  /** `settings.hotkeysAside` (YAZ-3564 K9): with a switch off, the drawing lets that App key go to the menu. */
  hotkeysAside?: HotkeyAside
}

export function DrawingModal({ root, target, theme, feed, onClose, hotkeys, hotkeysAside }: DrawingModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const [loaded, setLoaded] = useState<LoadedDrawing | null>(null)
  const loadedRef = useRef<LoadedDrawing | null>(null)
  loadedRef.current = loaded
  /** The latest snapshot; read only when a save fires (see the module doc). */
  const snapshot = useRef<DrawingSnapshot | null>(null)
  /** Made by the surface's FIRST snapshot, the clean baseline; null until then and after a Reload. */
  const autosave = useRef<Autosave<number> | null>(null)
  const [status, setStatus] = useState<SaveStatus>('saved')
  /** The status and the conflict as the close reads them right after its own flush (state lags a render). */
  const statusRef = useRef<SaveStatus>('saved')
  const conflictRef = useRef<number | null>(null)
  /** The disk moved under the previews (a save landed, or Reload read a newer scene): close pokes them once. */
  const stale = useRef(false)
  /** A close is saving: a second Esc / ✕ / click-away while it does is the same close, not another. */
  const closing = useRef(false)
  /** The modal has left (closed or discarded): a close still saving must not leave it a second time. */
  const left = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  /** The disk's mtime while the conflict bar is up (YAZ-3044 A4); null when there is no conflict. */
  const [conflict, setConflict] = useState<number | null>(null)
  /** Bumped by Reload so the surface remounts on the disk's scene (it reads `scene` once, on mount). */
  const [generation, setGeneration] = useState(0)
  /** The canvas that may report: a snapshot from the canvas a Reload replaced must not become the new baseline. */
  const generationRef = useRef(0)

  /** A save's status: a save that lands answers the failed-save strip too (the label beside it says Saved). */
  const onStatus = useCallback((next: SaveStatus) => {
    statusRef.current = next
    setStatus(next)
    if (next === 'saved') setConfirming(false)
  }, [])

  /** A conflict raises the bar; the bar says what is wrong now, so an older error line goes. */
  const onConflict = useCallback((diskMtime: number) => {
    conflictRef.current = diskMtime
    setConflict(diskMtime)
    setError(null)
  }, [])

  const clearConflict = (): void => {
    conflictRef.current = null
    setConflict(null)
    setConfirming(false)
  }

  useEffect(() => {
    let live = true
    void openDrawing(root, target).then(
      (drawing) => {
        if (live) setLoaded(drawing)
      },
      // Missing, unreadable, not a scene: ONE state, exactly like the preview's chip.
      () => {
        if (live) setError(BROKEN_DRAWING_MESSAGE)
      },
    )
    return () => {
      live = false
    }
  }, [root, target])

  // Focus lands here on mount so Esc works before the canvas exists (and stays inside afterwards).
  useEffect(() => overlayRef.current?.focus(), [])

  // A drawing is in front of the note while this is open (YAZ-3564 K9, K11): main's menu lets it keep ⌘D, and the
  // key sheet lists its keys. Best effort: a failed send only leaves the note's menu keys.
  useEffect(() => {
    setPlaceOverTab('drawing')
    void api.hotkeys.drawingInFront(true).catch(() => undefined)
    return () => {
      setPlaceOverTab(null)
      void api.hotkeys.drawingInFront(false).catch(() => undefined)
    }
  }, [])

  /** The drawing's own file says read only (YAZ-3076 D2, S28): the engine's view mode, and nothing to save. */
  const readOnly = loaded?.scene.readOnly === true

  /** One guarded write of the live scene; `Autosave` calls it once per save, never once per change. */
  const write = useCallback(
    async (_version: number, expectedMtime: number): Promise<{ mtime: number }> => {
      const current = snapshot.current
      const drawing = loadedRef.current
      if (current === null || drawing === null) throw new Error('nothing to save')
      try {
        const mtime = await saveDrawing({ root, target, path: drawing.path, content: current.standalone(), expectedMtime })
        stale.current = true
        setError(null)
        return { mtime }
      } catch (err) {
        // A conflict raises the bar (`onConflict`); anything else is the inline error line.
        if (!(err instanceof SaveConflict)) setError(saveErrorMessage(err))
        throw err
      }
    },
    [root, target],
  )

  const onSnapshot = useCallback(
    (next: DrawingSnapshot) => {
      if (generation !== generationRef.current) return
      snapshot.current = next
      const drawing = loadedRef.current
      // Read only: never an edit, so there is nothing to autosave.
      if (drawing === null || drawing.scene.readOnly === true) return
      const a = autosave.current
      // The first snapshot IS the clean baseline (the surface restored the disk scene first).
      if (a === null) autosave.current = new Autosave<number>({ content: next.version, mtime: drawing.mtime, delayMs: 500, save: write, onStatus, onConflict })
      else a.update(next.version)
    },
    [write, onStatus, onConflict, generation],
  )

  // The close/quit handshake (GRO-2160): main holds the window open until this settles (5s cap in main).
  // Unmounted any other way (the note closed under it): save what is pending, then never write again.
  useEffect(() => {
    const offFlush = api.window.onFlush(async () => {
      await autosave.current?.flush()
    })
    return () => {
      offFlush()
      const a = autosave.current
      if (a !== null) {
        void a.flush()
        a.dispose()
      }
      autosave.current = null
    }
  }, [])

  /** Esc, click-away and ✕ are ONE gesture: save what is left, then leave. Ask only when that save failed. */
  const requestClose = async (): Promise<void> => {
    if (closing.current) return
    const a = autosave.current
    if (a !== null) {
      closing.current = true
      await a.flush()
      // A change made while that save ran is pending, not failed: save it too.
      const failed = (): boolean => statusRef.current === 'error' || conflictRef.current !== null
      if (a.dirty && !failed()) await a.flush()
      closing.current = false
      if (left.current) return
      // A failed write or a conflict keeps it pending: the error line or the conflict bar says why.
      if (a.dirty) {
        setConfirming(true)
        return
      }
    }
    left.current = true
    if (stale.current) feed?.poke(target)
    onClose()
  }

  /** Discard: what failed to save stays off disk — disposed first, so the unmount flush writes nothing. */
  const discard = (): void => {
    if (left.current) return
    left.current = true
    autosave.current?.dispose()
    if (stale.current) feed?.poke(target)
    onClose()
  }

  /** Keep mine: this canvas over the disk's version, guarded by the mtime the conflict reported. */
  const keepMine = (): void => {
    if (conflict === null) return
    clearConflict()
    void autosave.current?.adopt(conflict)
  }

  /**
   * Reload: the disk's version replaces this canvas. The surface remounts on it, clean. A read that
   * fails keeps the bar up (Keep mine still works) and says why: it must never strand the edits.
   */
  const reload = async (): Promise<void> => {
    setError(null)
    try {
      const drawing = await openDrawing(root, target)
      clearConflict()
      generationRef.current += 1
      autosave.current?.dispose()
      // The remounted surface's first snapshot is the new baseline.
      autosave.current = null
      snapshot.current = null
      stale.current = true
      onStatus('saved')
      setLoaded(drawing)
      setGeneration(generationRef.current)
    } catch {
      setError(BROKEN_DRAWING_MESSAGE)
    }
  }

  const onKeyDown = (e: ReactKeyboardEvent): void => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    // While the strip is up, Esc answers IT — a second Esc must not skip the question.
    if (confirming) setConfirming(false)
    else void requestClose()
  }

  return (
    <div ref={overlayRef} className="drawing-modal-overlay" tabIndex={-1} onMouseDown={() => void requestClose()} onKeyDown={onKeyDown}>
      <div className="drawing-modal" role="dialog" aria-modal="true" aria-label={`Drawing ${target}`} onMouseDown={(e) => e.stopPropagation()}>
        <header className="drawing-modal__bar">
          <span className="drawing-modal__title" title={target}>
            {target}
          </span>
          {loaded !== null && !readOnly && <SaveIndicator status={status} />}
          <button type="button" className="drawing-modal__btn drawing-modal__close" aria-label="Close drawing" onClick={() => void requestClose()}>
            ✕
          </button>
        </header>
        {confirming && (
          <div className="drawing-modal__confirm" role="alert">
            <span>{DISCARD_PROMPT}</span>
            <button type="button" className="drawing-modal__btn" onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button type="button" className="drawing-modal__btn" onClick={discard}>
              Discard
            </button>
          </div>
        )}
        {conflict !== null && <ConflictBar onReload={() => void reload()} onKeepMine={keepMine} />}
        {error !== null && (
          <p className="drawing-modal__error" role="alert">
            {error}
          </p>
        )}
        <div className="drawing-modal__canvas">
          {loaded !== null && (
            <Suspense fallback={null}>
              <ExcalidrawSurface key={generation} scene={loaded.scene} theme={theme} onSnapshot={onSnapshot} onFailed={setError} readOnly={readOnly} hotkeys={hotkeys} hotkeysAside={hotkeysAside} />
            </Suspense>
          )}
        </div>
      </div>
    </div>
  )
}
