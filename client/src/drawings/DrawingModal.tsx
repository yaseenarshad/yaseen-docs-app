/**
 * THE DRAWING MODAL (YAZ-879, fourth build unit of the Excalidraw embed YAZ-852): click a preview
 * → the scene opens full-size → edit → Save writes the sidecar back → every preview of that target
 * re-renders.
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
 * DIRTY: the surface reports a cheap version per change; the FIRST one is the baseline, so a
 * drawing opened and not touched is clean and Save is DISABLED. Esc / click-away / ✕ close a clean
 * modal outright; a dirty one raises the inline confirm strip below the title bar — deliberately
 * not a second sheet stacked over this one, which is a modal over a modal for a one-line question.
 *
 * A CONFLICT (YAZ-3044 A4) — the same drawing saved from a tab since this modal read it — shows the
 * tab's own `ConflictBar` under the title bar: Reload opens the disk's version here (this canvas's
 * edits are dropped), Keep mine writes this canvas over it. The modal never wins in silence.
 *
 * FAILURES are inline and never a dialog: a sidecar that is missing, unreadable or not a scene
 * opens as the error state (message + close, nothing to save), and a failed write leaves the modal
 * open with its error line and the canvas untouched — a save that failed must not eat the drawing.
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ConflictBar } from '../documents/ConflictBar'
import type { MutableDrawingFeed } from './drawingFeed'
import { openDrawing, type LoadedDrawing } from './drawingScene'
import type { DrawingSnapshot } from './ExcalidrawSurface'
import { DrawingConflict, saveDrawing, saveErrorMessage } from './saveDrawing'
import './drawingModal.css'

/**
 * The ONE canvas, in its own chunk (YAZ-3028): since a drawing tab shares it, it carries Draw's engine
 * options (canvas prefs, fit-on-open, the toolbar mode), and a note that is only being read never
 * needs them. It arrives with the first open, beside the engine it loads anyway.
 */
const ExcalidrawSurface = lazy(() => import('./ExcalidrawSurface').then((m) => ({ default: m.ExcalidrawSurface })))

/** What a sidecar that will not open says — the modal's twin of the preview's broken chip. */
export const BROKEN_DRAWING_MESSAGE = "This drawing can't be opened: its file is missing or is not a scene."

/** The inline confirm's LOCKED copy (an in-modal strip, not a sheet). */
export const DISCARD_PROMPT = 'Discard drawing changes?'

interface DrawingModalProps {
  /** Vault root; with the target it is all `openDrawing` needs. */
  root: string
  /** The embed's raw target, exactly as the note spells it — the resolution rule is the pipe's. */
  target: string
  /** The app's resolved appearance, handed straight to the surface. */
  theme: 'light' | 'dark'
  /** Poked after a successful save so every preview of this target re-reads (YAZ-878's feed). */
  feed?: MutableDrawingFeed
  /** Close: the host drops the modal (it is unmounted, never hidden). */
  onClose: () => void
}

export function DrawingModal({ root, target, theme, feed, onClose }: DrawingModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const [loaded, setLoaded] = useState<LoadedDrawing | null>(null)
  /**
   * The latest snapshot lives in a REF and only its VERSION is state: the engine reports a change
   * per pointer move, and re-rendering this component that often would re-render the canvas with
   * it. React bails out on an unchanged number, so a drag costs one render, not hundreds.
   */
  const snapshot = useRef<DrawingSnapshot | null>(null)
  const [version, setVersion] = useState<number | null>(null)
  /** The version the drawing opened on; set once, by the surface's mount snapshot. */
  const baseline = useRef<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  /** The disk's mtime while the conflict bar is up (YAZ-3044 A4); null when there is no conflict. */
  const [conflict, setConflict] = useState<number | null>(null)
  /** Bumped by Reload so the surface remounts on the disk's scene (it reads `scene` once, on mount). */
  const [generation, setGeneration] = useState(0)

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

  const onSnapshot = useCallback((next: DrawingSnapshot) => {
    snapshot.current = next
    baseline.current ??= next.version
    setVersion(next.version)
  }, [])

  const dirty = version !== null && baseline.current !== null && version !== baseline.current

  /** Esc, click-away and ✕ are ONE gesture: leave, asking first only when there is something to lose. */
  const requestClose = (): void => {
    if (dirty) setConfirming(true)
    else onClose()
  }

  /** One guarded write at `expectedMtime`: success pokes the previews and closes; a CONFLICT raises the bar. */
  const write = async (expectedMtime: number): Promise<void> => {
    const current = snapshot.current
    if (loaded === null || current === null || saving) return
    setSaving(true)
    setError(null)
    setConflict(null)
    try {
      await saveDrawing({ root, target, path: loaded.path, content: current.standalone(), expectedMtime })
      // The previews re-read from disk on this; the modal's own job is over.
      feed?.poke(target)
      onClose()
    } catch (err) {
      if (err instanceof DrawingConflict) setConflict(err.mtime)
      else setError(saveErrorMessage(err))
      setSaving(false)
    }
  }

  const save = async (): Promise<void> => {
    if (loaded === null || !dirty) return
    await write(loaded.mtime)
  }

  /** Keep mine: this canvas over the disk's version, guarded by the mtime the conflict reported. */
  const keepMine = (): void => {
    if (conflict !== null) void write(conflict)
  }

  /** Reload: the disk's version replaces this canvas. The surface remounts on it, clean. */
  const reload = async (): Promise<void> => {
    setConflict(null)
    setError(null)
    try {
      const drawing = await openDrawing(root, target)
      snapshot.current = null
      baseline.current = null
      setVersion(null)
      setLoaded(drawing)
      setGeneration((g) => g + 1)
      feed?.poke(target)
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
    else requestClose()
  }

  return (
    <div ref={overlayRef} className="drawing-modal-overlay" tabIndex={-1} onMouseDown={requestClose} onKeyDown={onKeyDown}>
      <div className="drawing-modal" role="dialog" aria-modal="true" aria-label={`Drawing ${target}`} onMouseDown={(e) => e.stopPropagation()}>
        <header className="drawing-modal__bar">
          <span className="drawing-modal__title" title={target}>
            {target}
          </span>
          <button type="button" className="drawing-modal__btn" onClick={() => void save()} disabled={!dirty || saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="drawing-modal__btn drawing-modal__close" aria-label="Close drawing" onClick={requestClose}>
            ✕
          </button>
        </header>
        {confirming && (
          <div className="drawing-modal__confirm" role="alert">
            <span>{DISCARD_PROMPT}</span>
            <button type="button" className="drawing-modal__btn" onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button type="button" className="drawing-modal__btn" onClick={onClose}>
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
              <ExcalidrawSurface key={generation} scene={loaded.scene} theme={theme} onSnapshot={onSnapshot} onFailed={setError} />
            </Suspense>
          )}
        </div>
      </div>
    </div>
  )
}
