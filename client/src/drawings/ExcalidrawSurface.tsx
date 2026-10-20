/**
 * THE ENGINE SEAM (YAZ-879; rebuilt for the drawing DOCUMENT in Draw's 🔒 YAZ-1810, merged back into
 * Docs by YAZ-3028 so the note embed's modal and a drawing TAB share it).
 *
 * 🔒 ONE FILE OWNS THE CANVAS. This is the only component that mounts `<Excalidraw>`, the only
 * one that knows how a scene serializes, and the only one that knows what "changed" means to the
 * engine. Its two hosts — `DrawingModal` (the note embed, rule 28) and `DrawingEditor` (a tab, with
 * the `useBoardDocument` chrome) — import this module's TYPES and this component and nothing
 * else. `DrawingModal.test.tsx` pins the boundary as source; `DrawingEditor.test.tsx` mocks this
 * one module and drives the host through it.
 *
 * LAZY: the engine arrives through `engine.ts`'s `loadExcalidraw()` — one dynamic import per
 * renderer, with the offline font pin and the export-source pin already applied, its stylesheet
 * riding the same load — so the entry chunk stays free of both.
 *
 * SNAPSHOTS, NOT A CONTROLLED SCENE: the surface stays UNCONTROLLED (the engine owns its undo,
 * selection and tool state) and reports outward through `onSnapshot`. A snapshot is a cheap
 * change KEY — `getSceneVersion`, the engine's own sum of element versions — plus two thunks that
 * cost nothing until a save fires. The FIRST snapshot is emitted at mount, from the loaded scene,
 * BEFORE the engine's own first `onChange`, so the host always has a baseline to call "clean".
 * That baseline runs the disk elements through the engine's own `restoreElements()` first:
 * restore is what the engine actually mounts (it bumps element `version` and materialises
 * rounding values — YAZ-929), so only a restore-then-compare baseline agrees with the engine's
 * first `onChange`, and an untouched drawing never reads as dirty.
 *
 * ⚡ `getSceneVersion` IS A SUM, and a sum is not an identity: an undo that returns to the same
 * total reads CLEAN. Accepted on Draw's YAZ-1775: the failure mode is "a redundant save was
 * skipped", not "an edit was lost".
 *
 * THE BOARD'S OWN appState COUNTS TOO (Draw's YAZ-2073 2E): the version adds `appStateEdits` — how
 * often a field the serializer writes (the canvas background, the grid size) has moved since the
 * engine's first `onChange` — so a canvas background change is an edit like any other.
 *
 * TWO SHAPES ON DISK, ONE WRITER: `serializeAsJSON(…, 'local')` is the library's own writer either
 * way, with `source` pinned (`engine.ts`) and a trailing newline.
 *  - `serialize()` is a TAB's save (Draw's 🔒 YAZ-1775 D3): the scene with an EMPTY files map, plus
 *    the engine's live images and the ids the scene still references, so the host can ship what
 *    the `assets/` store lacks (`unpersistedFiles`) without ever seeing an engine type.
 *  - `standalone()` is the scene with every image it uses INSIDE it: the note embed's own sidecar
 *    shape (rule 28, unchanged) and File › Export Drawing…'s file (`exportDrawing.ts`).
 *
 * ⚡ EVERY PROP HANDED TO THE ENGINE IS STABLE. `<Excalidraw>` is memoized and calls `onChange`
 * whenever it renders, so a prop rebuilt per render is a feedback loop (React error #185, caught
 * in e2e on the embed's first mount). Hence the module-level `UI_OPTIONS`, the ref-backed
 * callbacks, the once-only `initialData`, and the hosts memoizing what they pass in.
 *
 * CANVAS PREFS BOTH WAYS (Draw's 🔒 YAZ-1775 D9). `canvasPrefs` is the shell's copy
 * (`SettingsState.canvas`), and `appliedRef` is what the engine is believed to hold. Engine →
 * shell: every `onChange` reads the prefs slice off the engine's appState (`appStateToPrefs`) and,
 * ONLY when it differs from `appliedRef`, records it and reports it 300 ms later. Shell → engine: a
 * `canvasPrefs` prop that differs from `appliedRef` is pushed with `updateScene`, changed keys
 * only, with `toolLock` merged into the CURRENT tool and `framesVisible` applied through
 * `updateFrameRendering`. Both directions compare against that one ref — the anti-ping-pong rule.
 *
 * THE CHROME INSIDE THE ENGINE. `renderTopRightUI` is the tab's status chips (the slot the web
 * app's cloud status sat in). Draw's rail (`renderTopLeftUI`: the panel hamburger, Writing and
 * Frames) and its docked canvas panel (Images / Components / Present, the engine's one child, and
 * the ⌘F / ⌘C shortcuts that open it) are YAZ-3038's: they plug in beside `renderTopRight`.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { referencedFileIds, type DrawingFileData } from '@shared/drawingAssets'
import { appStateToPrefs, changedPrefKeys, prefsEqual, prefsToAppState, type EngineAppStateSlice } from '@shared/canvasPrefs'
import { DEFAULT_CANVAS_PREFS, type CanvasPrefs } from '@shared/types'
import { appStateEdits, boardAppStateKeys } from './boardAppState'
import { openViewport, type DrawingScene } from './drawingScene'
import { applyToolbarMode, loadExcalidraw, type ExcalidrawModule } from './engine'
import { assembleStandaloneScene } from './exportDrawing'
import { yaseenFormFactor } from './formFactor'
import { applyFramesVisibility } from './framesVisibility'

type ExcalidrawProps = ComponentProps<ExcalidrawModule['Excalidraw']>
type ChangeArgs = Parameters<NonNullable<ExcalidrawProps['onChange']>>
type ImperativeApi = NonNullable<Parameters<NonNullable<ExcalidrawProps['onExcalidrawAPI']>>[0]>
type EngineAppState = ChangeArgs[1]

/** What a host learns about the canvas; deliberately engine-free (a number and two thunks). */
export interface DrawingSnapshot {
  /** Cheap identity of the drawn content — elements and the board's own appState: equal to the baseline's = nothing to save. */
  readonly version: number
  /**
   * A TAB's save, computed once when the save timer fires: the scene in the lean form
   * (`files: {}`), the engine's live image map, and the ids the scene still references.
   */
  serialize(): { json: string; files: Record<string, DrawingFileData>; referenced: Set<string> }
  /** The scene with every image it uses embedded: the note embed's sidecar (rule 28). */
  standalone(): string
}

/** The engine-free handle a host gets; nothing in it names the package. */
export interface DrawingSurfaceApi {
  /** Re-measure the canvas — a tab hidden by `visibility` may have been laid out at the wrong size. */
  refresh(): void
  /** Put the keyboard in the canvas (Draw's 🔒 YAZ-1812): the HOST decides WHETHER (`mayTakeFocus`), this only does it. */
  focus(): void
  /** File › Export Image… (Draw's 🔒 YAZ-1775 D10): the engine's OWN export dialog, through its `appState.openDialog` door. */
  openImageExport(): void
  /** View › Canvas Background (Draw's 🔒 YAZ-1775 D10): `appState.viewBackgroundColor`, which the engine then writes into the file. */
  setCanvasBackground(color: string): void
  /** File › Export Drawing… (Draw's YAZ-1821): the canvas as a STANDALONE `.excalidraw`, the whole live files map embedded. */
  exportScene(): string
  /**
   * Replace what the canvas shows (the file changed on disk under a clean tab). Returns the
   * version the engine will report for it — the host's new clean baseline — computed from the
   * RESTORED elements handed in, never read back (a read-back races the engine's own commit).
   */
  replaceScene(scene: DrawingScene): number
}

export interface DrawingSurfaceProps {
  /** The scene as it came off disk; the canvas opens on it and never re-reads it. */
  scene: DrawingScene
  /** The app's resolved appearance, handed to the engine as-is (a prop change re-themes live). */
  theme: 'light' | 'dark'
  /**
   * The shell's canvas preferences (Draw's 🔒 YAZ-1775 D9). Seeded into `initialData.appState` at
   * mount — layered OVER the file's own appState, which overrides nothing of the drawing because
   * none of these keys are ones the engine exports into a file — and applied live whenever they
   * differ from what the engine is believed to hold. Omitted = the defaults.
   */
  canvasPrefs?: CanvasPrefs
  /** A pref the ENGINE changed. Reported only when a value actually moved, 300 ms debounced. */
  onCanvasPrefsChange?: (next: CanvasPrefs) => void
  /** Mount, then every engine change. The first call is the host's clean baseline. */
  onSnapshot: (snapshot: DrawingSnapshot) => void
  /** The engine itself failed to load — the host shows it and offers nothing but the message. */
  onFailed: (message: string) => void
  /** Called once the engine is mounted, with the handle above. */
  onApi?: (api: DrawingSurfaceApi) => void
  /** The status chips, in the engine's own top-right row; memoize it (see the prop-stability note). */
  renderTopRight?: () => ReactNode
  /**
   * Take the keyboard at mount. A TAB does (hidden layers are `visibility: hidden`, so only the
   * visible canvas can take it); the embed's MODAL does not — its overlay holds focus so Esc
   * reaches it first (rule 28).
   */
  autoFocus?: boolean
}

/** The one failure this seam can raise on its own (the file's own failures are the host's). */
export const ENGINE_LOAD_FAILED = "Can't open the drawing editor."

/** How long the engine's own toggles settle before the shell hears about them (Draw's 🔒 YAZ-1775 D9). */
const PREFS_DEBOUNCE_MS = 300

/**
 * The file belongs to its host's ONE writer (the tab's autosave, the modal's Save), so the engine's
 * own open, save-to-file and JSON-export doors stay shut — a second writer would race the first.
 * `clearCanvas` is off for the web app's own reason (a destructive action with no undo affordance
 * here). Image export is untouched: it writes somewhere else entirely. `getFormFactor` is Draw's
 * (⚡ YAZ-1775 R5): the canvas is a desktop editor whatever width the shell leaves it.
 */
const UI_OPTIONS = {
  canvasActions: { loadScene: false, saveToActiveFile: false, export: false, clearCanvas: false },
  getFormFactor: yaseenFormFactor,
} as const

/**
 * The file's own loose shape as the engine's arguments. `drawingScene.ts` validates only the
 * OUTLINE because the file is user data; the engine's `restore()` decides the rest.
 */
function engineScene(scene: DrawingScene, canvasAppState: Record<string, unknown>): { elements: ChangeArgs[0]; appState: EngineAppState; files: ChangeArgs[2] } {
  return {
    elements: scene.elements as ChangeArgs[0],
    appState: { ...scene.appState, ...canvasAppState } as unknown as EngineAppState,
    files: (scene.files ?? {}) as ChangeArgs[2],
  }
}

export function ExcalidrawSurface({ scene, theme, canvasPrefs = DEFAULT_CANVAS_PREFS, onCanvasPrefsChange, onSnapshot, onFailed, onApi, renderTopRight, autoFocus = false }: DrawingSurfaceProps) {
  const [engine, setEngine] = useState<ExcalidrawModule | null>(null)
  // Callbacks change identity on every host render; the load must run ONCE and `onChange` must
  // never change identity, so all of them go through refs.
  const engineRef = useRef<ExcalidrawModule | null>(null)
  /** The board's own appState edits (see the module doc), counted from the engine's first `onChange`. */
  const countEdits = useRef<ReturnType<typeof appStateEdits> | null>(null)
  const emitRef = useRef(onSnapshot)
  const failRef = useRef(onFailed)
  const apiRef = useRef(onApi)
  const prefsOutRef = useRef(onCanvasPrefsChange)
  /** The engine's raw handle; null until it has mounted. */
  const rawApiRef = useRef<ImperativeApi | null>(null)
  /** This seam's own element — the handle's `focus()` reaches the engine's container through it. */
  const rootRef = useRef<HTMLDivElement | null>(null)
  emitRef.current = onSnapshot
  failRef.current = onFailed
  apiRef.current = onApi
  prefsOutRef.current = onCanvasPrefsChange

  /** What the engine is believed to hold (see the anti-ping-pong note in the module doc). */
  const appliedRef = useRef<CanvasPrefs>(canvasPrefs)
  /** The engine → shell debounce: the latest value and its timer. */
  const pendingRef = useRef<{ prefs: CanvasPrefs; timer: ReturnType<typeof setTimeout> } | null>(null)
  const reportPrefs = useCallback((next: CanvasPrefs) => {
    if (pendingRef.current !== null) clearTimeout(pendingRef.current.timer)
    pendingRef.current = {
      prefs: next,
      timer: setTimeout(() => {
        pendingRef.current = null
        prefsOutRef.current?.(next)
      }, PREFS_DEBOUNCE_MS),
    }
  }, [])
  // Unmount: a change still on the timer is reported rather than lost.
  useEffect(
    () => () => {
      const pending = pendingRef.current
      if (pending === null) return
      clearTimeout(pending.timer)
      pendingRef.current = null
      prefsOutRef.current?.(pending.prefs)
    },
    [],
  )

  // Shell → engine (🔒 D9): a prop that differs from what was last applied is pushed, changed keys
  // only. `framesVisible` goes through `updateFrameRendering`; `toolLock` is merged into the tool
  // the engine is HOLDING, because a partial `activeTool` would wipe it.
  useEffect(() => {
    if (prefsEqual(canvasPrefs, appliedRef.current)) return
    const keys = changedPrefKeys(appliedRef.current, canvasPrefs)
    appliedRef.current = canvasPrefs
    const api = rawApiRef.current
    if (api === null) return
    const appState = prefsToAppState(
      canvasPrefs,
      keys.filter((k) => k !== 'toolLock' && k !== 'framesVisible'),
    )
    if (keys.includes('toolLock')) appState.activeTool = { ...api.getAppState().activeTool, locked: canvasPrefs.toolLock }
    if (Object.keys(appState).length > 0) api.updateScene({ appState: appState as unknown as EngineAppState })
    if (keys.includes('framesVisible')) applyFramesVisibility(api, canvasPrefs.framesVisible)
  }, [canvasPrefs])

  // The scene and the prefs are read ONCE, at mount, by the effect below; a ref keeps them out of
  // its dependency list without lying to the linter about what it uses.
  const openedOn = useRef({ scene, canvasPrefs })

  useEffect(() => {
    let live = true
    // KaTeX's stylesheet was global while Crepe's whole theme was imported; since the editor stopped
    // shipping it (YAZ-2184) it loads here, because the one thing left that renders `.katex` is this
    // surface's Mermaid dialog (`$$…$$` labels), which must keep exactly its old font and metrics.
    void import('katex/dist/katex.min.css')
    // ⚡ Draw's YAZ-1775 R4/R5: the engine reads its styles-panel mode out of localStorage at mount, so the
    // one mode this app ships lands there before every mount.
    applyToolbarMode()
    loadExcalidraw().then(
      (mod) => {
        if (!live) return
        engineRef.current = mod
        countEdits.current = appStateEdits(boardAppStateKeys(mod))
        setEngine(mod)
        // The baseline, before the engine has said anything — through the engine's own restore,
        // because restored elements are what it mounts (see the module doc).
        const { elements, appState, files } = engineScene(openedOn.current.scene, prefsToAppState(openedOn.current.canvasPrefs))
        emitRef.current(snapshotOf(mod, mod.restoreElements(elements, null) as ChangeArgs[0], appState, files, 0))
      },
      () => {
        if (live) failRef.current(ENGINE_LOAD_FAILED)
      },
    )
    return () => {
      live = false
    }
  }, [])

  // Built ONCE, from the mount-time scene and prefs: the engine reads `initialData` only at mount,
  // and a fresh identity on every settings write would re-render the memoized `<Excalidraw>` for
  // nothing (the #185 rule). The saved scene may sit far from the origin, so open on ALL of it
  // (Draw's 🔒 YAZ-1855 D1, fit-on-open) — `initialState.viewport`, resolved once the canvas is measured.
  const [initialData] = useState(() => engineScene(scene, prefsToAppState(canvasPrefs)))
  const [initialState] = useState(() => openViewport(scene) as ExcalidrawProps['initialState'])

  const onChange = useCallback(
    (elements: ChangeArgs[0], appState: EngineAppState, files: ChangeArgs[2]) => {
      const mod = engineRef.current
      const edits = countEdits.current
      if (mod !== null && edits !== null) emitRef.current(snapshotOf(mod, elements, appState, files, edits(appState as unknown as Record<string, unknown>)))
      // Engine → shell (🔒 D9): the prefs slice, compared before anything is written.
      const seen = appStateToPrefs(appState as unknown as EngineAppStateSlice, appliedRef.current)
      if (prefsEqual(seen, appliedRef.current)) return
      appliedRef.current = seen
      reportPrefs(seen)
    },
    [reportPrefs],
  )

  /** The imperative handle, wrapped once into the engine-free API the host sees. */
  const onExcalidrawAPI = useCallback((api: ImperativeApi | null) => {
    // The engine hands null on unmount; the host's ref keeps the last live handle, which it never
    // calls after its own unmount. `engineRef` is set before `<Excalidraw>` ever renders.
    if (api === null || engineRef.current === null) return
    const mod = engineRef.current
    rawApiRef.current = api
    // Frames are never appState (🔒 D9): applied the moment the engine can take them.
    applyFramesVisibility(api, appliedRef.current.framesVisible)
    apiRef.current?.({
      refresh: () => api.refresh(),
      // `focusContainer()` lives on the engine's App class, not on this handle — so do what it
      // does: focus the engine's own container, the element it gives `tabIndex` for exactly this.
      focus: () => rootRef.current?.querySelector<HTMLElement>('.excalidraw-container')?.focus(),
      openImageExport: () => api.updateScene({ appState: { openDialog: { name: 'imageExport' } } as unknown as EngineAppState }),
      setCanvasBackground: (color) => api.updateScene({ appState: { viewBackgroundColor: color } as unknown as EngineAppState }),
      // The FULL files map, straight off the engine: everything hydrated out of `assets/` at load
      // plus anything pasted since and not yet saved. The store's copy would be missing the second half.
      exportScene: () =>
        assembleStandaloneScene(mod, {
          elements: api.getSceneElements() as readonly unknown[],
          appState: api.getAppState() as unknown as Record<string, unknown>,
          files: api.getFiles() as unknown as Record<string, unknown>,
        }),
      replaceScene: (next) => {
        const restored = mod.restoreElements(next.elements as ChangeArgs[0], null)
        api.updateScene({ elements: restored })
        const entries = Object.values(next.files ?? {}) as Parameters<ImperativeApi['addFiles']>[0]
        if (entries.length > 0) api.addFiles(entries)
        return mod.getSceneVersion(restored)
      },
    })
  }, [])

  // The chips live in the engine's OWN top-right row rather than a strip above the canvas, so the
  // canvas starts directly under the tab bar and the chips can never cover the toolbar island.
  const renderTopRightUI = useMemo(
    () => (renderTopRight === undefined ? undefined : () => <div className="excalidraw-ui-top-right drawing-editor__top-right">{renderTopRight()}</div>),
    [renderTopRight],
  )

  // The frame held while the engine chunk is arriving; the host's canvas frame sizes it.
  if (engine === null) return <div className="drawing-surface__loading" />
  const { Excalidraw } = engine
  return (
    <div ref={rootRef} className="drawing-surface">
      <Excalidraw
        initialData={initialData}
        initialState={initialState}
        theme={theme}
        UIOptions={UI_OPTIONS}
        onChange={onChange}
        onExcalidrawAPI={onExcalidrawAPI}
        renderTopRightUI={renderTopRightUI}
        // The engine's own scroll listener is for a page that scrolls under it; neither host does.
        detectScroll={false}
        autoFocus={autoFocus}
      />
    </div>
  )
}

/** One snapshot from the engine's own utilities; the only place they are called. */
function snapshotOf(engine: ExcalidrawModule, elements: ChangeArgs[0], appState: EngineAppState, files: ChangeArgs[2], appStateEditCount: number): DrawingSnapshot {
  return {
    version: engine.getSceneVersion(elements) + appStateEditCount,
    serialize: () => {
      // The engine's map, flattened to the two fields that cross the bridge: its `created` /
      // `lastRetrieved` bookkeeping is about this session, not about the file.
      const live: Record<string, DrawingFileData> = {}
      for (const [id, entry] of Object.entries(files)) {
        if (typeof entry?.dataURL === 'string' && typeof entry.mimeType === 'string') live[id] = { mimeType: entry.mimeType, dataURL: entry.dataURL }
      }
      return {
        // Draw's 🔒 YAZ-1775 D3: an EMPTY files map on purpose — the scene names its images and never
        // carries them. A text file in a git vault ends with a newline, as a new drawing is written.
        json: `${engine.serializeAsJSON(elements, appState, {}, 'local')}\n`,
        files: live,
        referenced: referencedFileIds(elements),
      }
    },
    standalone: () => assembleStandaloneScene(engine, { elements, appState: appState as unknown as Record<string, unknown>, files: files as unknown as Record<string, unknown> }),
  }
}
