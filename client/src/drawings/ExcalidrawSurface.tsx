/**
 * THE ENGINE SEAM (YAZ-879; rebuilt for the drawing DOCUMENT in Draw's 🔒 YAZ-1810, merged back into
 * Docs by YAZ-3028 so the note embed's modal and a drawing TAB share it).
 *
 * 🔒 ONE FILE OWNS THE CANVAS. This is the only component that mounts `<Excalidraw>`, the only
 * one that knows how a scene serializes, and the only one that knows what "changed" means to the
 * engine. Its two hosts — `DrawingModal` (the note embed, rule 28) and `DrawingEditor` (a tab, with
 * the `useDocumentHost` chrome) — import this module's TYPES and this component and nothing
 * else. `DrawingModal.test.tsx` pins the boundary as source; `DrawingEditor.test.tsx` mocks this
 * one module and drives the host through it.
 *
 * LAZY: the engine arrives through `engine.ts`'s `loadExcalidraw()` — one dynamic import per
 * renderer, with the offline font pin and the export-source pin already applied, its stylesheet
 * riding the same load — so the entry chunk stays free of both.
 *
 * SNAPSHOTS, NOT A CONTROLLED SCENE: the surface stays UNCONTROLLED (the engine owns its undo,
 * selection and tool state) and reports outward through `onSnapshot`. A snapshot is a cheap
 * change KEY — the sum of element versions, each the version at which that element's CONTENT last
 * moved (`contentVersion.ts`: the engine also bumps on writes that change nothing) — plus two thunks that
 * cost nothing until a save fires. The FIRST snapshot is emitted at mount, from the loaded scene,
 * BEFORE the engine's own first `onChange`, so the host always has a baseline to call "clean".
 * That baseline runs the disk elements through the engine's own `restoreElements()` first:
 * restore is what the engine actually mounts (it bumps element `version` and materialises
 * rounding values — YAZ-929), so only a restore-then-compare baseline agrees with the engine's
 * first `onChange`, and an untouched drawing never reads as dirty.
 *
 * ⚡ THE KEY IS A SUM, and a sum is not an identity: an undo that returns to the same
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
 * app's cloud status sat in). THE CANVAS PANEL (YAZ-3038, ported from Draw's 🔒 YAZ-1775 D8 / D10) is the
 * TAB's only: a host that passes `onCanvasPanelChange` gets Draw's rail (`renderTopLeftUI`:
 * `LauncherRail.tsx`, the panel hamburger plus the Writing / Frames toggles), the docked panel
 * (`CanvasSidebar.tsx`, Images / Components / Present, the engine's one child), the ⌘F / ⌘C keys that
 * open it — bound on THIS component's own element in the capture phase, never `window`, because
 * several tabs each mount an engine — and the presentation player. The note embed's modal passes
 * none of it: it keeps the engine's own menu at top-left, and a note's drawing has no library
 * (rule 28). Which mode a surface is in is read ONCE, at mount.
 */
import { requestKeySheet } from '../keys/keySheetRequest'
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { referencedFileIds, type DrawingFileData } from '@shared/drawingAssets'
import { appStateToPrefs, changedPrefKeys, prefsEqual, prefsToAppState, type EngineAppStateSlice } from '@shared/canvasPrefs'
import { DEFAULT_CANVAS_PANEL, DEFAULT_CANVAS_PREFS, type CanvasPanelState, type CanvasPanelTab, type CanvasPrefs } from '@shared/types'
import type { HotkeyOverrides } from '@shared/hotkeyBindings'
import type { HotkeyAside } from '@shared/keys'
import { namingTab } from '../lib/focusHandoff'
import { appStateEdits, boardAppStateKeys } from './boardAppState'
import { contentVersion } from './contentVersion'
import { CANVAS_SIDEBAR, CanvasSidebar, openCanvasTab } from './CanvasSidebar'
import { openViewport, type DrawingScene } from './drawingScene'
import { applyToolbarMode, loadExcalidraw, type ExcalidrawModule } from './engine'
import { assembleStandaloneScene } from './exportDrawing'
import { yaseenFormFactor } from './formFactor'
import { applyFramesVisibility } from './framesVisibility'
import { drawingKeyBindings, drawingKeysKey, pressed } from './drawingKeys'
import { createLauncherStore, LauncherRail } from './LauncherRail'
import { PresentationPlayer } from './presentation/PresentationPlayer'

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
  /** A pref the ENGINE or the rail changed. Reported only when a value actually moved, 300 ms debounced. */
  onCanvasPrefsChange?: (next: CanvasPrefs) => void
  /** What the canvas panel remembers (YAZ-3038): the tab the hamburger opens on, and the dock preference. */
  canvasPanel?: CanvasPanelState
  /**
   * A panel choice to remember. PASSING IT IS WHAT TURNS THE CANVAS PANEL ON (YAZ-3038): the drawing TAB
   * passes it; the note embed's modal does not, and gets no rail, no panel, no ⌘F / ⌘C and no player.
   */
  onCanvasPanelChange?: (next: CanvasPanelState) => void
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
  /**
   * The file says read only (YAZ-3076 D2): the engine's own view mode — pan, zoom, select-free
   * viewing, Export Image and Present; no tools. The canvas background command does nothing, and
   * the canvas panel gets a handle that cannot change the scene (no insert, no slide reorder or
   * rename). Live: a change of the prop switches the engine in place.
   */
  readOnly?: boolean
  /**
   * `settings.hotkeys` (YAZ-3564 K5): the drawing keys the user changed reach the engine as its `keyBindings`, live,
   * and the canvas panel's ⌘F / ⌘C follow them. Omitted = the defaults.
   */
  hotkeys?: HotkeyOverrides
  /** `settings.hotkeysAside` (YAZ-3564 K9): with a switch off, the drawing lets that App key go to the menu. */
  hotkeysAside?: HotkeyAside
}

/**
 * The engine's handle with its scene-changing doors shut (YAZ-3076 D2): `insertElements` and
 * `addFiles` do nothing, and `updateScene` passes only what is not the scene's elements (a view,
 * a dialog, a tool), so the canvas panel can still present and look but never edit a read-only drawing.
 */
export function readOnlyHandle(api: ImperativeApi): ImperativeApi {
  return {
    ...api,
    insertElements: () => undefined,
    addFiles: () => undefined,
    updateScene: (scene) => {
      if (scene.elements === undefined) api.updateScene(scene)
    },
  }
}

/** The one failure this seam can raise on its own (the file's own failures are the host's). */
export const ENGINE_LOAD_FAILED = "Can't open the drawing editor."

/** How long the engine's own toggles settle before the shell hears about them (Draw's 🔒 YAZ-1775 D9). */
const PREFS_DEBOUNCE_MS = 300

/**
 * The file belongs to its host's ONE writer (the tab's autosave, the modal's autosave), so the engine's
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

export function ExcalidrawSurface({
  scene,
  theme,
  canvasPrefs = DEFAULT_CANVAS_PREFS,
  onCanvasPrefsChange,
  canvasPanel = DEFAULT_CANVAS_PANEL,
  onCanvasPanelChange,
  onSnapshot,
  onFailed,
  onApi,
  renderTopRight,
  autoFocus = false,
  readOnly = false,
  hotkeys,
  hotkeysAside,
}: DrawingSurfaceProps) {
  const [engine, setEngine] = useState<ExcalidrawModule | null>(null)
  /** The canvas panel is the tab's (see the module doc); read once, so a surface never changes mode. */
  const [withPanel] = useState(() => onCanvasPanelChange !== undefined)
  // Callbacks change identity on every host render; the load must run ONCE and `onChange` must
  // never change identity, so all of them go through refs.
  const engineRef = useRef<ExcalidrawModule | null>(null)
  /** The board's own appState edits (see the module doc), counted from the engine's first `onChange`. */
  const countEdits = useRef<ReturnType<typeof appStateEdits> | null>(null)
  /** The elements' share of the key: a version bump that moved no content is not counted (YAZ-3210). */
  const countVersion = useRef(contentVersion())
  const emitRef = useRef(onSnapshot)
  const failRef = useRef(onFailed)
  const apiRef = useRef(onApi)
  const prefsOutRef = useRef(onCanvasPrefsChange)
  const panelOutRef = useRef(onCanvasPanelChange)
  const panelRef = useRef(canvasPanel)
  /** The engine's raw handle, for the rail and the shortcuts; null until it has mounted. */
  const rawApiRef = useRef<ImperativeApi | null>(null)
  /**
   * The same handle as STATE, because the panel's tabs are children of `<Excalidraw>` that have to
   * re-render when it arrives (Draw's YAZ-1818) — a ref alone would leave the Images tab's insert disabled.
   */
  const [imperativeApi, setImperativeApi] = useState<ImperativeApi | null>(null)
  /**
   * ⌘F's one-shot request to focus the Images tab's search field (Draw's 🔒 YAZ-1990). A flag the tab
   * clears; per surface, so a hidden drawing tab can never consume it.
   */
  const [searchFocusPending, setSearchFocusPending] = useState(false)
  const onSearchFocused = useCallback(() => setSearchFocusPending(false), [])
  /** Whether the canvas holds a selection — the Components tab's "Save selection" gate (Draw's YAZ-1819). */
  const [hasSelection, setHasSelection] = useState(false)
  /** This seam's own element — the handle's `focus()` reaches the engine's container through it. */
  const rootRef = useRef<HTMLDivElement | null>(null)
  /**
   * The presentation, if one is running (Draw's YAZ-1820): the player is a SIBLING of `<Excalidraw>`, not a
   * child of the Present tab, because a tab's body is unmounted the moment the panel closes and
   * closing the panel must not end a presentation. It covers this pane and no other.
   */
  const [presenting, setPresenting] = useState<{ initialFrameId: string | null } | null>(null)
  emitRef.current = onSnapshot
  failRef.current = onFailed
  apiRef.current = onApi
  prefsOutRef.current = onCanvasPrefsChange
  panelOutRef.current = onCanvasPanelChange
  panelRef.current = canvasPanel
  /** Read by the handle's background command, which is made once (see `onExcalidrawAPI`). */
  const readOnlyRef = useRef(readOnly)
  readOnlyRef.current = readOnly
  /** Read by the panel keys below, which are bound once. */
  const hotkeysRef = useRef(hotkeys)
  hotkeysRef.current = hotkeys
  // The engine's `keyBindings` (YAZ-3564 K5), rebuilt only when a DRAWING key moved: a fresh identity on every
  // settings write would re-render the memoized `<Excalidraw>` for nothing (the #185 rule).
  const drawingKeys = drawingKeysKey(hotkeys, hotkeysAside)
  const keyBindings = useMemo(() => JSON.parse(drawingKeys) as ReturnType<typeof drawingKeyBindings>, [drawingKeys])

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

  /** Remember a panel choice (Draw's 🔒 YAZ-1775 D10); a value that did not move is not a write. */
  const rememberPanel = useCallback((patch: Partial<CanvasPanelState>) => {
    const next = { ...panelRef.current, ...patch }
    if (next.tab === panelRef.current.tab && next.docked === panelRef.current.docked) return
    panelRef.current = next
    panelOutRef.current?.(next)
  }, [])

  /** THE one door that closes the canvas panel — the hamburger, the ✕ and Play. */
  const closePanel = useCallback(() => rawApiRef.current?.toggleSidebar({ name: null, force: false }), [])

  // The rail's store, made ONCE: the hamburger drives the engine's sidebar, the two toggles write
  // the PREF and let the round trip apply it. Every action reads the refs above, so the store — and
  // therefore `renderTopLeftUI` — never changes identity.
  const rail = useMemo(() => {
    const flip = (key: 'writingMode' | 'framesVisible') => prefsOutRef.current?.({ ...appliedRef.current, [key]: !appliedRef.current[key] })
    const store = createLauncherStore(
      {
        // Open on the last-used tab (Components until then); pressing again closes.
        togglePanel: () => {
          if (store.getState().activeTab !== null) closePanel()
          else rawApiRef.current?.toggleSidebar({ name: CANVAS_SIDEBAR, tab: panelRef.current.tab, force: true })
        },
        // The web app's rule: open on the tab; the ACTIVE tab's own shortcut closes the panel.
        openTab: (tab) => rawApiRef.current?.toggleSidebar({ name: CANVAS_SIDEBAR, tab, force: store.getState().activeTab !== tab }),
        toggleWriting: () => flip('writingMode'),
        toggleFrames: () => flip('framesVisible'),
      },
      { ready: false, activeTab: null, writingMode: canvasPrefs.writingMode, framesVisible: canvasPrefs.framesVisible },
    )
    return store
    // Mount-only by contract: the initial values are read once (`closePanel` is stable), and every
    // later value arrives through `set` from the effect below.
  }, [closePanel])

  // Play (Draw's YAZ-1820): the panel closes, because it would otherwise sit on top of the deck.
  const startPresentation = useCallback(
    (initialFrameId: string | null) => {
      closePanel()
      setPresenting({ initialFrameId })
    },
    [closePanel],
  )
  const endPresentation = useCallback(() => setPresenting(null), [])
  /** The player hid the frame outlines to present; this puts back what the user's `framesVisible` pref says. */
  const restoreFrames = useCallback(() => {
    const api = rawApiRef.current
    if (api !== null) applyFramesVisibility(api, appliedRef.current.framesVisible)
  }, [])
  const onDock = useCallback((docked: boolean) => rememberPanel({ docked }), [rememberPanel])

  /**
   * ? opens the app's "Keys of this tab" (YAZ-3564 K11) in place of the engine's own help dialog, which shows only the
   * engine's defaults. A bare ?, outside a text field and with no text being edited; true when it took the key.
   */
  const onHelpKey = useCallback((event: ReactKeyboardEvent): boolean => {
    if (event.key !== '?' || event.metaKey || event.ctrlKey || event.altKey || event.repeat || event.nativeEvent.isComposing) return false
    const target = event.target
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return false
    if (target instanceof HTMLElement && (target.isContentEditable || target.closest("[contenteditable='true']") !== null)) return false
    if ((rawApiRef.current?.getAppState() as unknown as Record<string, unknown> | undefined)?.editingTextElement) return false
    event.preventDefault()
    event.stopPropagation()
    requestKeySheet()
    return true
  }, [])

  /**
   * ⌘C → Components and ⌘F → Images (Draw's port of the web app's `c` / `f`, `AppSidebar.tsx:983-1078`; the keys
   * as the user set them, YAZ-3564),
   * with its guards: the primary modifier alone, no repeat, no IME composition, no editable target, no
   * live text selection, and — asked of the engine itself — no element being drawn, dragged, resized,
   * rotated or cropped, no text being edited, no dialog open and nothing selected. Those gates are why
   * ⌘C still copies a selection. Bound on THIS element in the capture phase, in the tab only.
   */
  const onKeyDownCapture = useCallback(
    (event: ReactKeyboardEvent) => {
      if (onHelpKey(event)) return
      const api = rawApiRef.current
      if (api === null) return
      const keys = hotkeysRef.current
      const tab: CanvasPanelTab | null = pressed(event, 'drawing.componentsPanel', keys) ? 'components' : pressed(event, 'drawing.imagesPanel', keys) ? 'image-studio' : null
      if (tab === null || event.repeat || event.nativeEvent.isComposing) return
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest("[contenteditable='true']") !== null)) return
      const selection = window.getSelection()
      if (selection !== null && !selection.isCollapsed) return
      const appState = api.getAppState() as unknown as Record<string, unknown>
      const busy = BUSY_APP_STATE_KEYS.some((k) => Boolean(appState[k]))
      if (busy || appState.cursorButton === 'down' || Object.keys((appState.selectedElementIds ?? {}) as Record<string, unknown>).length > 0) return
      event.preventDefault()
      event.stopPropagation()
      // ⌘F puts the caret in the search field too — only when this press OPENS the tab: the active
      // tab's own shortcut closes the panel, and must leave nothing pending behind.
      if (tab === 'image-studio' && rail.getState().activeTab !== tab) setSearchFocusPending(true)
      rail.openTab(tab)
    },
    [rail, onHelpKey],
  )

  // Shell → engine (🔒 D9): a prop that differs from what was last applied is pushed, changed keys
  // only. `framesVisible` goes through `updateFrameRendering`; `toolLock` is merged into the tool
  // the engine is HOLDING, because a partial `activeTool` would wipe it.
  useEffect(() => {
    rail.set({ writingMode: canvasPrefs.writingMode, framesVisible: canvasPrefs.framesVisible })
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
  }, [canvasPrefs, rail])

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
        emitRef.current(snapshotOf(countVersion.current, mod, mod.restoreElements(elements, null) as ChangeArgs[0], appState, files, 0))
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
      if (mod !== null && edits !== null) emitRef.current(snapshotOf(countVersion.current, mod, elements, appState, files, edits(appState as unknown as Record<string, unknown>)))
      if (withPanel) {
        // The canvas panel's open tab: the rail's emphasis, the triggers' opacity, and the memory
        // the hamburger opens on next time; and the selection gate of "Save selection".
        setHasSelection(Object.keys((appState as unknown as { selectedElementIds?: Record<string, unknown> }).selectedElementIds ?? {}).length > 0)
        const activeTab = openCanvasTab((appState as unknown as { openSidebar?: { name?: string; tab?: string } | null }).openSidebar)
        if (activeTab !== null) rememberPanel({ tab: activeTab })
        rail.set({ activeTab })
      }
      // Engine → shell (🔒 D9): the prefs slice, compared before anything is written.
      const seen = appStateToPrefs(appState as unknown as EngineAppStateSlice, appliedRef.current)
      if (prefsEqual(seen, appliedRef.current)) return
      appliedRef.current = seen
      rail.set({ writingMode: seen.writingMode, framesVisible: seen.framesVisible })
      reportPrefs(seen)
    },
    [withPanel, rail, rememberPanel, reportPrefs],
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
    if (withPanel) {
      setImperativeApi(api)
      // The dock preference the web app kept per cloud username, kept in the shell store here.
      const docked = panelRef.current.docked
      if (api.getAppState().defaultSidebarDockedPreference !== docked) api.updateScene({ appState: { defaultSidebarDockedPreference: docked } as unknown as EngineAppState })
      rail.set({ ready: true })
    }
    apiRef.current?.({
      refresh: () => api.refresh(),
      // `focusContainer()` lives on the engine's App class, not on this handle — so do what it
      // does: focus the engine's own container, the element it gives `tabIndex` for exactly this.
      focus: () => rootRef.current?.querySelector<HTMLElement>('.excalidraw-container')?.focus(),
      openImageExport: () => api.updateScene({ appState: { openDialog: { name: 'imageExport' } } as unknown as EngineAppState }),
      // A read-only drawing keeps its background: the colour is written into the file (YAZ-3076 S26).
      setCanvasBackground: (color) => {
        if (!readOnlyRef.current) api.updateScene({ appState: { viewBackgroundColor: color } as unknown as EngineAppState })
      },
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
        // A new scene, a new count: computed BEFORE the engine reports it, so its first `onChange` agrees.
        countVersion.current = contentVersion()
        const version = countVersion.current(restored)
        api.updateScene({ elements: restored })
        const entries = Object.values(next.files ?? {}) as Parameters<ImperativeApi['addFiles']>[0]
        if (entries.length > 0) api.addFiles(entries)
        return version
      },
    })
  }, [withPanel, rail])

  // The chips live in the engine's OWN top-right row rather than a strip above the canvas, so the
  // canvas starts directly under the tab bar and the chips can never cover the toolbar island.
  const renderTopRightUI = useMemo(
    () => (renderTopRight === undefined ? undefined : () => <div className="excalidraw-ui-top-right drawing-editor__top-right">{renderTopRight()}</div>),
    [renderTopRight],
  )

  // The rail rides the slot the web app's launchers did; its identity never changes (see above).
  const renderTopLeftUI = useMemo(() => (withPanel ? () => <LauncherRail store={rail} /> : undefined), [withPanel, rail])

  // The panel is re-created only when the open tab moves — its triggers' emphasis is the one
  // thing about it that depends on live state.
  const [activeTab, setActiveTab] = useState<CanvasPanelTab | null>(null)
  useEffect(() => rail.subscribe(() => setActiveTab(rail.getState().activeTab)), [rail])
  const canvasSidebar = useMemo(
    () =>
      engine === null || !withPanel ? null : (
        <CanvasSidebar
          engine={engine}
          activeTab={activeTab}
          onClose={closePanel}
          onDock={onDock}
          excalidrawAPI={imperativeApi === null || !readOnly ? imperativeApi : readOnlyHandle(imperativeApi)}
          searchFocusPending={searchFocusPending}
          onSearchFocused={onSearchFocused}
          hasSelection={hasSelection}
          onStartPresentation={startPresentation}
        />
      ),
    // `keyBindings` too: a new child is what re-renders the engine's toolbar, so its tooltips name a changed key at once (K12).
    [engine, withPanel, activeTab, closePanel, onDock, imperativeApi, readOnly, searchFocusPending, onSearchFocused, hasSelection, startPresentation, keyBindings],
  )

  // The frame held while the engine chunk is arriving; the host's canvas frame sizes it.
  if (engine === null) return <div className="drawing-surface__loading" />
  const { Excalidraw } = engine
  return (
    // The surface's own element, so ⌘F / ⌘C are heard here and nowhere else in the shell (the tab only).
    <div ref={rootRef} className="drawing-surface" onKeyDownCapture={withPanel ? onKeyDownCapture : onHelpKey}>
      <Excalidraw
        initialData={initialData}
        initialState={initialState}
        theme={theme}
        UIOptions={UI_OPTIONS}
        onChange={onChange}
        onExcalidrawAPI={onExcalidrawAPI}
        renderTopLeftUI={renderTopLeftUI}
        renderTopRightUI={renderTopRightUI}
        // The engine's own scroll listener is for a page that scrolls under it; neither host does.
        detectScroll={false}
        // The engine reads this once, at its mount, after its module loaded: by then a double
        // click may have opened the tab's name field, which keeps the caret (YAZ-3059).
        autoFocus={autoFocus && !namingTab(document.activeElement)}
        // Read only forces the engine's view mode; an editable drawing passes NONE, because a defined
        // prop — `false` too — turns off the engine's own ⌥R toggle (YAZ-3120). `true` → `undefined`
        // still leaves view mode: the engine sets it to `!!viewModeEnabled` when the prop changes.
        viewModeEnabled={readOnly ? true : undefined}
        keyBindings={keyBindings}
      >
        {canvasSidebar}
      </Excalidraw>
      {presenting !== null && imperativeApi !== null && (
        <PresentationPlayer engine={engine} excalidrawAPI={imperativeApi} initialFrameId={presenting.initialFrameId} onExit={endPresentation} onRestoreFrames={restoreFrames} />
      )}
    </div>
  )
}

/**
 * The web app's "a gesture is in flight" set (`AppSidebar.tsx:1011-1061`), as appState keys: any
 * one of them truthy means the keystroke could have meant something else.
 */
const BUSY_APP_STATE_KEYS = [
  'newElement',
  'multiElement',
  'selectionElement',
  'resizingElement',
  'selectedLinearElement',
  'editingFrame',
  'croppingElementId',
  'selectedElementsAreBeingDragged',
  'isResizing',
  'isRotating',
  'editingTextElement',
  'openDialog',
] as const

/** One snapshot from the engine's own utilities; the only place they are called. */
function snapshotOf(
  countVersion: ReturnType<typeof contentVersion>,
  engine: ExcalidrawModule,
  elements: ChangeArgs[0],
  appState: EngineAppState,
  files: ChangeArgs[2],
  appStateEditCount: number,
): DrawingSnapshot {
  return {
    version: countVersion(elements) + appStateEditCount,
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
