/**
 * THE DRAWING MODAL (YAZ-879, fourth build unit of the Excalidraw embed YAZ-852): click a preview
 * → the scene opens full-size → edit → the modal AUTOSAVES the sidecar (YAZ-3528) → close, and
 * every preview of that target re-renders.
 *
 * 🔒 A MODAL, NEVER A NODE VIEW. The embed stays plain markdown text under decorations (rule 27),
 * so there is no node to host an editor in — and a full drawing canvas inside a text column would
 * fight the caret for every key it owns. This is React beside the editor, the `FolderView`
 * / `PageTitle` precedent: `Editor`'s `CrepeHost` holds `openDrawing`, the board embed's
 * "Edit in a popup" row sets it (YAZ-4820 D7), and this renders over the window.
 *
 * 🔒 CHROME ONLY. Everything about the ENGINE — the canvas, what "changed" means, how a scene
 * serializes — lives behind `ExcalidrawSurface`, and nothing in this file imports the package or
 * anything that does. Since YAZ-3028 a drawing TAB (`DrawingEditor`) shares that one surface, and
 * since YAZ-3943 1A1 the modal saves as the tab does: the small scene plus the pictures main lacks,
 * through `drawing:save` (`saveDrawing.ts`), so a board past 10 MiB saves here too.
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
 * LEAVING (YAZ-3528 D3): Esc / click-away / ✕ are one gesture — save what is left, then close. Only a save that FAILED, or one a conflict blocks,
 * raises the inline strip below the title bar — deliberately not a second sheet stacked over this
 * one, which is a modal over a modal for a one-line question. Discard then writes nothing more.
 *
 * A CONFLICT (YAZ-3044 A4) — the same drawing saved from a tab since this modal read it — shows the
 * tab's own `ConflictBar` under the title bar and blocks the autosave: Reload opens the disk's
 * version here (this canvas's edits are dropped), Keep mine writes this canvas over it. The modal
 * never wins in silence.
 *
 * ⚡ AMENDED by YAZ-4279 (D6, item 6): the modal watches its file as a tab does. Every outside save, and a refused save, is
 * merged into the canvas (`takeFromDisk`, the tab's flow), with edits or none. The bar shows only for a clash, or a
 * read-only switch the file changed under edits.
 *
 * FAILURES are inline and never a dialog: a sidecar that is missing, unreadable or not a scene
 * opens as the error state (message + close, nothing to save), and a failed write leaves the modal
 * open with its error line and the canvas untouched — a save that failed must not eat the drawing.
 */
import { lazy, Suspense, useCallback, useContext, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { HotkeyOverrides } from '@shared/hotkeyBindings'
import type { OutsideChangeGlow, OutsideOutlineColors, OutsideOutlineThickness } from '@shared/types'
import type { HotkeyAside } from '@shared/keys'
import type { CanvasPanelState, FoldArrowMode } from '@shared/types'
import { splitFrontmatter } from '@shared/frontmatter'
import { api } from '../api'
import { setPlaceOverTab } from '../keys/keySheetRequest'
import { ConflictBar } from '../documents/ConflictBar'
import { exportWithNotice } from '../documents/useDocumentHost'
import { SaveIndicator } from '../editor/SaveIndicator'
import { registerPageUnlockFlush } from '../editor/pageUnlockStore'
import { Autosave, SaveConflict, type SaveStatus } from '../lib/autosave'
import { oneAtATime } from '../documents/oneAtATime'
import type { WatchSource } from '../hooks/useWatch'
import { basename } from '../lib/paths'
import { pressed } from './drawingKeys'
import { openDrawing, openInlineDrawing, type LoadedDrawing } from './drawingScene'
import { exportFileName } from './exportDrawing'
import type { DrawingAppSettings, DrawingSnapshot, DrawingSurfaceApi } from './ExcalidrawSurface'
import type { SceneSide } from './mergeScene'
import { sideOf, takeFromDisk, type TakeAnswer } from './takeFromDisk'
import { PICTURES_MOVED_OUT, saveDrawing, saveErrorMessage } from './saveDrawing'
import { missingPicturesNotice, picturesFolderOutside, picturesSize, unpersistedFiles } from '@shared/drawingAssets'
import { compactInlineScene, findInlineDrawings } from '@shared/inlineDrawing'
import type { NoticeKind } from '../lib/notice'
import { CardPreviewHost } from '../tabs/cardPreview'
import { VaultReadOnly } from '../vault/readOnlyVault'
import { useDrawingLinks, type DrawingLinkProps } from './useDrawingLinks'
import { useOutsideUpdateChip } from './useOutsideUpdateChip'
import { usePicturesFolderAllow } from './usePicturesFolderAllow'
import './drawingEditor.css'
import './drawingModal.css'

/**
 * The ONE canvas, in its own chunk (YAZ-3028): since a drawing tab shares it, it carries Draw's engine
 * options (canvas prefs, fit-on-open, the toolbar mode), and a page that is only being read never
 * needs them. It arrives with the first open, beside the engine it loads anyway.
 */
const ExcalidrawSurface = lazy(() => import('./ExcalidrawSurface').then((m) => ({ default: m.ExcalidrawSurface })))

/** What a sidecar that will not open says — the modal's twin of the preview's broken chip. */
export const BROKEN_DRAWING_MESSAGE = "This drawing can't be opened: its file is missing or is not a scene."

/** The inline confirm's copy (an in-modal strip, not a sheet), asked only when a save failed or a conflict blocks it. */
export const DISCARD_PROMPT = 'Changes are not saved. Discard them?'

const FORGET_PANEL = (): void => undefined
const EXPORT_FAILED = "The Excalidraw drawing couldn't be exported."
const PDF_FAILED = "The PDF couldn't be exported."
const INNER_ESCAPE_SELECTOR = '.sidebar:not(.sidebar--docked), .excalidraw-sidebar, .presentation-player, .Modal, .excalidraw .Dialog, .excalidraw-modal-container .Modal'
const PORTALED_ESCAPE_SELECTOR = '.excalidraw-modal-container .Modal, .excalidraw .Dialog'
const FOLD_ARROW_CHOICES: readonly { value: 'app' | FoldArrowMode; label: string; title: string }[] = [
  { value: 'app', label: 'App', title: 'The app setting' },
  { value: 'hover', label: 'Hover', title: 'Arrows show on hover' },
  { value: 'always', label: 'Always', title: 'Arrows always show' },
  { value: 'off', label: 'Off', title: 'No folding: every line shows, the folds stay saved' },
]
const HOVER_OUTLINE_CHOICES: readonly { value: 'app' | boolean; label: string; title: string }[] = [
  { value: 'app', label: 'App', title: 'The app setting' },
  { value: true, label: 'On', title: 'A faint outline shows what a click will pick' },
  { value: false, label: 'Off', title: 'No outline on hover' },
]

/** Inline mode (YAZ-5040): edits a ```` ```excalidraw ```` block inside a `.md` page instead of a standalone `.excalidraw` file. */
export interface InlineDrawingModalProps {
  json: string
  pagePath: string
  /** 0-based index of this inline drawing block in `pagePath`, used for live AI merge (YAZ-6407). */
  index?: number
  title?: string
  /** Focus and select the title input on mount (used when creating a new drawing via `/drawing`). */
  autoFocusTitle?: boolean
  onTitleChange?: (title: string) => void
  onSave: (compactJson: string) => void | Promise<void>
  onMoveToFile?: (compactJson: string) => Promise<void>
  onOpenInTab?: () => void | Promise<void>
}

/** Page links in the drawing's text (YAZ-4039): the props the page's own `[[links]]` get, as a drawing tab has them. */
export interface DrawingModalProps extends DrawingLinkProps, DrawingAppSettings {
  /** Vault root; with the target it is all `openDrawing` needs. */
  root: string
  /** The embed's raw target, exactly as the page spells it — the resolution rule is the pipe's. Omitted in inline mode. */
  target?: string
  /** Inline mode (YAZ-5040): when set, loads and saves an inline `.md` drawing instead of a `.excalidraw` file. */
  inline?: InlineDrawingModalProps
  /** Inline mode (YAZ-6460 item 13): parent page's effective read-only state (inherits timed page unlocks). Ignored for standalone modals. */
  inlineReadOnly?: boolean
  /** The app's resolved appearance, handed straight to the surface. */
  theme: 'light' | 'dark'
  /** Close: the host drops the modal (it is unmounted, never hidden). */
  onClose: () => void
  /** Opens the resolved `.excalidraw` file in a tab (standalone popup mode). */
  onOpenInTab?: (path: string) => void | Promise<void>
  /** What the canvas panel remembers (`SettingsState.canvasPanel`). */
  canvasPanel?: CanvasPanelState
  /** Persists canvas panel choices (`tab`, `docked`, `width`). */
  onCanvasPanelChange?: (next: CanvasPanelState) => void
  /** `settings.hotkeys` (YAZ-3564 K5): the drawing keys as the user set them. Omitted = the defaults. */
  hotkeys?: HotkeyOverrides
  /** `settings.hotkeysAside` (YAZ-3564 K9): with a switch off, the drawing lets that App key go to the menu. */
  hotkeysAside?: HotkeyAside
  /** The page's passive notice: what a link's open or a new page says, and missing pictures (an error). */
  onNotice?: (message: string, icon?: NoticeKind) => void
  /** The window's watcher (YAZ-4279 item 6): an outside save lands on this canvas. Absent: the modal sees it only when a save is refused. */
  watch?: WatchSource
  /** Settings › Outside changes › Glow (YAZ-4279 D5): how long a shape the file changed stays outlined. Absent → until checked. */
  outsideChangeGlow?: OutsideChangeGlow
  /** Settings › Outside changes › Board border thickness (YAZ-6398). */
  outsideOutlineThickness?: OutsideOutlineThickness
  /** Settings › Outside changes › Board border colors (YAZ-6398). */
  outsideOutlineColors?: OutsideOutlineColors
}

export function DrawingModal({ root, target = '', inline, inlineReadOnly, theme, onClose, onOpenInTab, hotkeys, hotkeysAside, onNotice, watch, outsideChangeGlow = 'until-checked', outsideOutlineThickness, outsideOutlineColors, canvasPrefs, onCanvasPrefsChange, canvasPanel, onCanvasPanelChange = FORGET_PANEL, ...linkProps }: DrawingModalProps) {
  const inlineRef = useRef(inline)
  inlineRef.current = inline
  const onOpenInTabRef = useRef(onOpenInTab)
  onOpenInTabRef.current = onOpenInTab
  const isInline = inline !== undefined
  const inlinePagePath = inline?.pagePath
  const overlayRef = useRef<HTMLDivElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const menuWrapRef = useRef<HTMLDivElement>(null)
  const surface = useRef<DrawingSurfaceApi | null>(null)
  const { onOutsideChange, clearChip: clearOutsideChip, chip: outsideChip } = useOutsideUpdateChip(surface, outsideChangeGlow)
  const onApi = useCallback((a: DrawingSurfaceApi) => {
    surface.current = a
  }, [])
  /** The sheet: the link menu, the Edit link box and the `[[` picker go in it, so a click on them is not a click-away. */
  const sheetRef = useRef<HTMLDivElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [loaded, setLoaded] = useState<LoadedDrawing | null>(null)
  const loadedRef = useRef<LoadedDrawing | null>(null)
  loadedRef.current = loaded
  /** The latest snapshot; read only when a save fires (see the module doc). */
  const snapshot = useRef<DrawingSnapshot | null>(null)
  /** The ids main holds: the load's `stored`, grown by every save's `persisted`, or replaced by an inside save's (the tab's rule, YAZ-3943 1A1). */
  const persisted = useRef(new Set<string>())
  /** Made by the surface's FIRST snapshot, the clean baseline; null until then and after a Reload. */
  const autosave = useRef<Autosave<number> | null>(null)
  const [status, setStatus] = useState<SaveStatus>('saved')
  /** The status and the conflict as the close reads them right after its own flush (state lags a render). */
  const statusRef = useRef<SaveStatus>('saved')
  const conflictRef = useRef<number | null>(null)
  /** A close is saving: a second Esc / ✕ / click-away while it does is the same close, not another. */
  const closing = useRef(false)
  /** The modal has left (closed or discarded): a close still saving must not leave it a second time. */
  const left = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [inlineTitle, setInlineTitle] = useState(inline?.title ?? '')
  const inlineTitleRef = useRef(inlineTitle)
  inlineTitleRef.current = inlineTitle
  const [hoverLinksOff, setHoverLinksOff] = useState(false)
  const [boardFoldArrows, setBoardFoldArrows] = useState<FoldArrowMode | undefined>(undefined)
  const [boardHoverOutline, setBoardHoverOutline] = useState<boolean | undefined>(undefined)
  const inlineSettingsRef = useRef<{ hoverLinksOff: boolean; foldArrows?: FoldArrowMode; hoverOutline?: boolean }>({ hoverLinksOff: false })
  inlineSettingsRef.current = { hoverLinksOff, foldArrows: boardFoldArrows, hoverOutline: boardHoverOutline }
  const metaVersionRef = useRef(0)
  useEffect(() => {
    setInlineTitle(inline?.title ?? '')
  }, [inline?.title])

  useEffect(() => {
    if (!menuOpen) return
    const onMouseDown = (e: MouseEvent) => {
      if (menuWrapRef.current !== null && e.target instanceof Node && menuWrapRef.current.contains(e.target)) return
      setMenuOpen(false)
    }
    window.addEventListener('mousedown', onMouseDown, true)
    return () => window.removeEventListener('mousedown', onMouseDown, true)
  }, [menuOpen])
  /** The disk's mtime while the conflict bar is up (YAZ-3044 A4); null when there is no conflict. */
  const [conflict, setConflict] = useState<number | null>(null)
  /** Bumped by Reload so the surface remounts on the disk's scene (it reads `scene` once, on mount). */
  const [generation, setGeneration] = useState(0)
  /** The canvas that may report: a snapshot from the canvas a Reload replaced must not become the new baseline. */
  const generationRef = useRef(0)
  /** The scene as this modal last loaded or saved it: a merge's base (D6). A save keeps its text, parsed only for a merge. */
  const base = useRef<SceneSide | string | null>(null)
  /** Set when the file came in on a clean canvas: the next snapshot is the baseline at this mtime (the tab's rule). */
  const tookAt = useRef<number | null>(null)

  /** A save's status: a save that lands answers the failed-save strip too (the label beside it says Saved). */
  const onStatus = useCallback((next: SaveStatus) => {
    statusRef.current = next
    setStatus(next)
    if (next === 'saved') setConfirming(false)
  }, [])

  const clearConflict = (): void => {
    conflictRef.current = null
    setConflict(null)
    setConfirming(false)
  }

  /** A file this modal now holds as its base: its pictures as the file says them. */
  const tookFile = (drawing: LoadedDrawing): void => {
    base.current = sideOf(drawing.scene)
    persisted.current = new Set(drawing.stored)
  }

  /** Reads the inline drawing block back from the markdown page on disk (YAZ-6407). */
  const readInlineFromDisk = async (): Promise<LoadedDrawing | null> => {
    const opts = inlineRef.current
    if (opts === undefined) return null
    const file = await api.readFile(opts.pagePath)
    const blocks = findInlineDrawings(splitFrontmatter(file.content).body)
    const block = blocks[opts.index ?? 0]
    if (block === undefined) return null
    const drawing = await openInlineDrawing(root, block.json, opts.pagePath)
    return { ...drawing, mtime: file.mtime }
  }

  /** YAZ-4279 D6, item 6 & YAZ-6407: the file merged into this canvas, edits or none (`takeFromDisk`, the tab's flow). */
  const mergeFile = async (): Promise<TakeAnswer> => {
    const s = surface.current
    const was = base.current
    if (s === null || was === null) return 'conflict'
    const drawing = isInline ? await readInlineFromDisk() : await openDrawing(root, target)
    if (left.current || drawing === null) return 'merged'
    const answer = await takeFromDisk({ surface: s, autosave: autosave.current, base: was, disk: drawing, readOnly: loadedRef.current?.scene.readOnly === true, glow: glowRef.current, baselineAt: (mtime) => (tookAt.current = mtime) })
    if (answer === 'merged') tookFile(drawing)
    return answer
  }
  const glowRef = useRef(outsideChangeGlow)
  glowRef.current = outsideChangeGlow
  const mergeRef = useRef(mergeFile)
  mergeRef.current = mergeFile

  /**
   * Every outside save and every refused save, one at a time (item 4): only a clash raises the bar, which says what is wrong
   * now, so an older error line goes. 'reload' remounts on the file, as Reload does: nothing is unsaved.
   */
  const [settle] = useState(() =>
    oneAtATime(async (diskMtime) => {
      const answer = await mergeRef.current().catch((err: unknown) => {
        console.error('merge', err)
        return 'conflict' as const
      })
      if (answer === 'reload') return reloadRef.current()
      if (answer === 'merged') {
        conflictRef.current = null
        setConflict(null)
        return
      }
      conflictRef.current = diskMtime
      setConflict(diskMtime)
      setError(null)
    }),
  )
  const onConflict = useCallback((diskMtime: number) => void settle(diskMtime), [settle])

  useEffect(() => {
    let live = true
    const loader = isInline ? openInlineDrawing(root, inlineRef.current!.json, inlinePagePath!) : openDrawing(root, target)
    void loader.then(
      (drawing) => {
        if (!live) return
        persisted.current = new Set(drawing.stored)
        base.current = sideOf(drawing.scene)
        const nextSettings = {
          hoverLinksOff: drawing.scene.hoverLinksOff === true,
          foldArrows: drawing.scene.foldArrows,
          hoverOutline: drawing.scene.hoverOutline,
        }
        inlineSettingsRef.current = nextSettings
        setHoverLinksOff(nextSettings.hoverLinksOff)
        setBoardFoldArrows(nextSettings.foldArrows)
        setBoardHoverOutline(nextSettings.hoverOutline)
        setLoaded(drawing)
      },
      // Missing, unreadable, not a scene: ONE state, exactly like the preview's chip.
      () => {
        if (live) setError(BROKEN_DRAWING_MESSAGE)
      },
    )
    return () => {
      live = false
    }
  }, [root, target, isInline, inlinePagePath])

  /**
   * The drawing's own file says read only (YAZ-3076 D2, S28), or the vault is (YAZ-4939): the engine's view mode, and
   * nothing to save. Standalone popups have no timed unlock (open in a tab to edit); inline drawings inherit their
   * parent page's effective lock state via `inlineReadOnly` (YAZ-6460 item 13), so a timed page unlock carries in.
   */
  const vaultLocked = useContext(VaultReadOnly).on
  const readOnly = isInline && inlineReadOnly !== undefined ? inlineReadOnly : loaded?.scene.readOnly === true || vaultLocked

  // Focus lands on the title input for a brand-new `/drawing` (`autoFocusTitle`), else on the overlay so Esc works immediately.
  useEffect(() => {
    if (inlineRef.current?.autoFocusTitle === true && !readOnly && titleInputRef.current !== null) {
      titleInputRef.current.focus()
      titleInputRef.current.select()
    } else {
      overlayRef.current?.focus()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- mount-only initial focus

  // A drawing is in front of the page while this is open (YAZ-3564 K9, K11): main's menu lets it keep ⌘D, and the
  // key sheet lists its keys. Best effort: a failed send only leaves the page's menu keys.
  useEffect(() => {
    setPlaceOverTab('drawing')
    void api.hotkeys.drawingInFront(true).catch(() => undefined)
    return () => {
      setPlaceOverTab(null)
      void api.hotkeys.drawingInFront(false).catch(() => undefined)
    }
  }, [])

  // When the parent page's timed unlock expires while this inline modal is open, flush pending edits before it relocks.
  useEffect(() => {
    if (!isInline || inlinePagePath === undefined) return
    return registerPageUnlockFlush(inlinePagePath, () => autosave.current?.flush())
  }, [isInline, inlinePagePath])
  // The drawing's page links (YAZ-4039), as in a drawing tab: pills, hover, the open gestures, the menu, the picker, paste.
  // The hover preview: "Links in drawings and diagrams" AND the board's own switch (YAZ-3943 demo 2), read from the file.
  const hoverLinks = linkProps.hoverLinks === true && !hoverLinksOff
  const { links, linkPreview, linkCard } = useDrawingLinks({ root, theme, path: loaded?.path ?? root, readOnly, hotkeys, onNotice, hostRef: sheetRef, props: { ...linkProps, hoverLinks } })
  // YAZ-3943 demo round 3: a board naming an outside pictures folder this Mac has not allowed asks once when it opens here too.
  const outsideFolder = loaded?.scene.picturesOut === true && loaded.scene.picturesFolder !== undefined && picturesFolderOutside(loaded.scene.picturesFolder) ? loaded.scene.picturesFolder : null
  const { sheet: allowSheet } = usePicturesFolderAllow(outsideFolder, onNotice)
  // YAZ-4074 6A item 12: the tab's notice for pictures in neither the file nor a store, once per open: a Reload says nothing.
  const toldMissing = useRef(false)
  useEffect(() => {
    if (loaded === null || toldMissing.current) return
    toldMissing.current = true
    const { missing } = picturesSize(loaded.scene.elements, loaded.scene.files ?? {})
    if (missing > 0) onNotice?.(missingPicturesNotice(missing), 'error')
  }, [loaded, onNotice])

  /** One guarded write of the live scene; `Autosave` calls it once per save, never once per change. */
  const write = useCallback(
    async (_version: number, expectedMtime: number): Promise<{ mtime: number }> => {
      const current = snapshot.current
      const drawing = loadedRef.current
      if (current === null || drawing === null) throw new Error('nothing to save')
      try {
        const { json, files, referenced } = current.serialize()
        const inlineOpts = inlineRef.current
        if (inlineOpts !== undefined) {
          const newFiles = unpersistedFiles(files, referenced, persisted.current)
          if (newFiles.length > 0) {
            const res = await api.drawing.landAssets({ root, newFiles })
            for (const id of res.persisted) persisted.current.add(id)
          }
          const { json: compactJson } = compactInlineScene(json, inlineSettingsRef.current)
          await inlineOpts.onSave(compactJson)
          base.current = json
          setError(null)
          return { mtime: Date.now() }
        }
        const res = await saveDrawing({ root, target, path: drawing.path, json, newFiles: unpersistedFiles(files, referenced, persisted.current), expectedMtime })
        // An inside save names every picture the file holds now; a deleted one is not there (6A item 1). So does a
        // save that moved them out by the 50 MB rule: the store holds exactly those (YAZ-4071 7H).
        if (res.inside === true || res.movedOut === true) persisted.current = new Set(res.persisted)
        else for (const id of res.persisted) persisted.current.add(id)
        if (res.movedOut === true) onNotice?.(PICTURES_MOVED_OUT)
        base.current = json
        setError(null)
        return { mtime: res.mtime }
      } catch (err) {
        // A conflict raises the bar (`onConflict`); anything else is the inline error line.
        if (!(err instanceof SaveConflict)) setError(saveErrorMessage(err))
        throw err
      }
    },
    [root, target, onNotice],
  )

  const onSnapshot = useCallback(
    (next: DrawingSnapshot) => {
      if (generation !== generationRef.current) return
      snapshot.current = next
      const drawing = loadedRef.current
      // Taken before the read-only return, so a stale one never waits for a later snapshot (4A-23).
      const took = tookAt.current
      tookAt.current = null
      // Read only (the file's switch, the vault's, or the parent page's lock): never an edit, so there is nothing to autosave.
      if (drawing === null || readOnly) return
      const combined = next.version + metaVersionRef.current
      const a = autosave.current
      // The first snapshot IS the clean baseline (the surface restored the disk scene first); so is the first after the file came in.
      if (a === null) autosave.current = new Autosave<number>({ content: combined, mtime: took ?? drawing.mtime, delayMs: 500, save: write, onStatus, onConflict })
      else if (took !== null) a.reset(combined, took)
      else a.update(combined)
    },
    [write, onStatus, onConflict, generation, readOnly],
  )

  // The close/quit handshake (GRO-2160): main holds the window open until this settles (5s cap in main).
  // It answers whether the drawing is clean (YAZ-3737 D2). Unmounted any other way (the page closed under it):
  // save what is pending, then never write again.
  useEffect(() => {
    const offFlush = api.window.onFlush(async () => {
      const a = autosave.current
      if (a === null) return true
      await a.flush()
      return a.isClean()
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
    onClose()
  }

  /** Discard: what failed to save stays off disk — disposed first, so the unmount flush writes nothing. */
  const discard = (): void => {
    if (left.current) return
    left.current = true
    autosave.current?.dispose()
    onClose()
  }

  /** Keep mine: this canvas over the disk's version, guarded by the mtime the conflict reported. */
  const keepMine = (): void => {
    if (conflict === null) return
    clearConflict()
    clearOutsideChip()
    surface.current?.clash([])
    // YAZ-4071 7H: the disk's version may lack a picture this canvas uses, so this save ships them all.
    persisted.current = new Set()
    void autosave.current?.adopt(conflict)
  }

  /**
   * Reload: the disk's version replaces this canvas. The surface remounts on it, clean. A read that
   * fails keeps the bar up (Keep mine still works) and says why: it must never strand the edits.
   */
  const reload = async (): Promise<void> => {
    setError(null)
    try {
      const drawing = isInline ? await readInlineFromDisk() : await openDrawing(root, target)
      if (drawing === null) throw new Error('missing inline drawing')
      tookFile(drawing)
      clearConflict()
      generationRef.current += 1
      autosave.current?.dispose()
      // The remounted surface's first snapshot is the new baseline.
      autosave.current = null
      snapshot.current = null
      onStatus('saved')
      const nextSettings = {
        hoverLinksOff: drawing.scene.hoverLinksOff === true,
        foldArrows: drawing.scene.foldArrows,
        hoverOutline: drawing.scene.hoverOutline,
      }
      inlineSettingsRef.current = nextSettings
      setHoverLinksOff(nextSettings.hoverLinksOff)
      setBoardFoldArrows(nextSettings.foldArrows)
      setBoardHoverOutline(nextSettings.hoverOutline)
      setLoaded(drawing)
      setGeneration(generationRef.current)
    } catch {
      setError(BROKEN_DRAWING_MESSAGE)
    }
  }

  const reloadRef = useRef(reload)
  reloadRef.current = reload

  // YAZ-4279 item 6 & YAZ-6407: an outside save of this file (or the page holding this inline drawing), once any save in flight has settled.
  const file = isInline ? (inlinePagePath ?? null) : (loaded?.path ?? null)
  useEffect(() => {
    if (watch === undefined || file === null) return
    return watch.subscribe((ev) => {
      if (ev.type !== 'change' || ev.path !== file || left.current) return
      const a = autosave.current
      void (a?.settled() ?? Promise.resolve()).then(() => {
        if (a !== null && ev.mtime === a.mtime) return // the echo of our own write
        void settle(ev.mtime)
      })
    })
  }, [watch, file, settle])

  const exportBaseName = useCallback((): string => {
    if (isInline) {
      const title = inlineTitleRef.current.trim()
      return title !== '' ? `${title}.excalidraw` : basename(inlinePagePath ?? 'drawing')
    }
    return basename(loadedRef.current?.path ?? target)
  }, [isInline, inlinePagePath, target])

  const exportDrawing = async (): Promise<void> => {
    const s = surface.current
    if (s === null || left.current) return
    await exportWithNotice(async () => api.dialog.saveDrawing({ defaultName: exportFileName(exportBaseName()), content: await s.exportScene() }), EXPORT_FAILED, onNotice)
  }

  const exportPdf = useCallback(
    async (svg: string, size: { width: number; height: number }): Promise<void> => {
      if (left.current) return
      await exportWithNotice(() => api.dialog.savePdf({ defaultName: exportFileName(exportBaseName(), 'pdf'), svg, width: size.width, height: size.height }), PDF_FAILED, onNotice)
    },
    [exportBaseName, onNotice],
  )

  /** Inline mode: flushes pending edits, serializes compact scene, and moves the inline drawing to its own `.excalidraw` file. */
  const moveToFile = async (): Promise<void> => {
    const onMoveToFile = inlineRef.current?.onMoveToFile
    if (onMoveToFile === undefined || closing.current || left.current) return
    closing.current = true
    try {
      const a = autosave.current
      if (a !== null) {
        await a.flush()
        const failed = (): boolean => statusRef.current === 'error' || conflictRef.current !== null
        if (a.dirty && !failed()) await a.flush()
        if (left.current) return
        if (a.dirty) {
          setConfirming(true)
          return
        }
      }
      let compactJson = inlineRef.current!.json
      const current = snapshot.current
      if (current !== null) {
        const { json, files, referenced } = current.serialize()
        const newFiles = unpersistedFiles(files, referenced, persisted.current)
        if (newFiles.length > 0) {
          const res = await api.drawing.landAssets({ root, newFiles })
          for (const id of res.persisted) persisted.current.add(id)
        }
        compactJson = compactInlineScene(json, inlineSettingsRef.current).json
      }
      await onMoveToFile(compactJson)
    } catch {
      // Host reports the failure notice; keep the modal open so edits are not lost.
    } finally {
      closing.current = false
    }
  }

  /** Flushes pending edits (same as closing), closes the modal, and opens the drawing in a tab (inline or standalone). */
  const openInTab = async (): Promise<void> => {
    const inlineOpen = inlineRef.current?.onOpenInTab
    const standaloneOpen = onOpenInTabRef.current
    const drawingPath = loadedRef.current?.path
    const run = isInline ? inlineOpen : standaloneOpen !== undefined && drawingPath !== undefined ? () => standaloneOpen(drawingPath) : undefined
    if (run === undefined || closing.current || left.current) return
    const a = autosave.current
    if (a !== null) {
      closing.current = true
      await a.flush()
      const failed = (): boolean => statusRef.current === 'error' || conflictRef.current !== null
      if (a.dirty && !failed()) await a.flush()
      closing.current = false
      if (left.current) return
      if (a.dirty) {
        setConfirming(true)
        return
      }
    }
    left.current = true
    onClose()
    await run()
  }

  const bumpInlineSetting = (): void => {
    metaVersionRef.current += 1
    const a = autosave.current
    if (a !== null) {
      a.update((snapshot.current?.version ?? 0) + metaVersionRef.current)
      void a.flush()
    }
  }

  const toggleInlineHoverLinks = (): void => {
    if (readOnly) return
    const nextOff = !hoverLinksOff
    inlineSettingsRef.current = { ...inlineSettingsRef.current, hoverLinksOff: nextOff }
    setHoverLinksOff(nextOff)
    bumpInlineSetting()
  }

  const setInlineFoldArrows = (value: 'app' | FoldArrowMode): void => {
    if (readOnly) return
    const next = value === 'app' ? undefined : value
    inlineSettingsRef.current = { ...inlineSettingsRef.current, foldArrows: next }
    setBoardFoldArrows(next)
    bumpInlineSetting()
  }

  const setInlineHoverOutline = (value: 'app' | boolean): void => {
    if (readOnly) return
    const next = value === 'app' ? undefined : value
    inlineSettingsRef.current = { ...inlineSettingsRef.current, hoverOutline: next }
    setBoardHoverOutline(next)
    bumpInlineSetting()
  }

  const onKeyDownCapture = (e: ReactKeyboardEvent): void => {
    if (pressed(e, 'drawing.saveNow', hotkeys)) {
      e.preventDefault()
      e.stopPropagation()
      void autosave.current?.flush()
      return
    }
    if (!e.repeat && !e.nativeEvent.isComposing && pressed(e, 'drawing.imagesPanel', hotkeys)) {
      const t = e.target
      const inPanel = t instanceof Element && t.closest('.sidebar, .canvas-panel') !== null
      if (!inPanel) {
        e.preventDefault()
        e.stopPropagation()
        surface.current?.openAddSearch()
        return
      }
    }
    if (!e.repeat && !e.nativeEvent.isComposing && pressed(e, 'drawing.componentsPanel', hotkeys)) {
      const t = e.target
      const inSurface = t instanceof Element && t.closest('.drawing-surface') !== null
      const editable =
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        t instanceof HTMLSelectElement ||
        (t instanceof HTMLElement && (t.isContentEditable || t.closest("[contenteditable='true']") !== null))
      const selection = window.getSelection()
      const hasTextSelection = selection !== null && !selection.isCollapsed
      if (!inSurface && !editable && !hasTextSelection) {
        e.preventDefault()
        e.stopPropagation()
        surface.current?.openComponentsPanel?.()
        return
      }
    }
  }

  const onKeyDown = (e: ReactKeyboardEvent): void => {
    if (e.key !== 'Escape') return
    if (menuOpen) {
      e.preventDefault()
      e.stopPropagation()
      setMenuOpen(false)
      return
    }
    // While the strip is up, Esc answers IT — a second Esc must not skip the question.
    if (confirming) {
      e.preventDefault()
      e.stopPropagation()
      setConfirming(false)
      return
    }
    if (e.defaultPrevented) return
    const target = e.target
    const inEditable =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && (target.isContentEditable || target.closest("[contenteditable='true']") !== null))
    const inInner = target instanceof Element && target.closest(INNER_ESCAPE_SELECTOR) !== null
    const hasInner = sheetRef.current?.querySelector(INNER_ESCAPE_SELECTOR) !== null || document.querySelector(PORTALED_ESCAPE_SELECTOR) !== null
    if (inEditable || inInner || hasInner) return
    e.preventDefault()
    e.stopPropagation()
    void requestClose()
  }

  const onTitleKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      e.currentTarget.blur()
      if (surface.current !== null) surface.current.focus()
      else overlayRef.current?.focus()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      e.currentTarget.blur()
      overlayRef.current?.focus()
    }
  }

  const canOpenInTab = isInline ? inline?.onOpenInTab !== undefined : onOpenInTab !== undefined
  const appFoldMode = FOLD_ARROW_CHOICES.find((choice) => choice.value === canvasPrefs?.foldArrowsOpen)?.label
  const appOutlineMode = HOVER_OUTLINE_CHOICES.find((choice) => choice.value === canvasPrefs?.hoverOutline)?.label

  return (
    <div ref={overlayRef} className="drawing-modal-overlay" tabIndex={-1} onMouseDown={() => void requestClose()} onKeyDownCapture={onKeyDownCapture} onKeyDown={onKeyDown}>
      <div ref={sheetRef} className="drawing-modal" role="dialog" aria-modal="true" aria-label={isInline ? (inlineTitle.trim() || 'Inline drawing') : `Drawing ${target}`} onMouseDown={(e) => e.stopPropagation()}>
        <header className="drawing-modal__bar">
          {isInline ? (
            <input
              ref={titleInputRef}
              type="text"
              className="drawing-modal__title-input"
              placeholder="Untitled drawing"
              aria-label="Drawing title"
              value={inlineTitle}
              readOnly={readOnly}
              onChange={(e) => {
                const next = e.target.value
                setInlineTitle(next)
                inlineRef.current?.onTitleChange?.(next)
              }}
              onKeyDown={onTitleKeyDown}
            />
          ) : (
            <span className="drawing-modal__title" title={target}>
              {target}
            </span>
          )}
          {loaded !== null && !readOnly && <SaveIndicator status={status} />}
          {loaded !== null && (
            <div ref={menuWrapRef} className="drawing-modal__more">
              <button
                type="button"
                className="drawing-modal__icon-btn"
                aria-label="Drawing actions"
                title="Drawing actions"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setMenuOpen((v) => !v)}
              >
                ⋯
              </button>
              {menuOpen && (
                <div className="drawing-modal__menu" role="menu">
                  {isInline && (
                    <>
                      <button
                        type="button"
                        className="drawing-modal__menu-item drawing-modal__menu-toggle"
                        role="menuitemcheckbox"
                        aria-checked={!hoverLinksOff}
                        disabled={readOnly}
                        onClick={toggleInlineHoverLinks}
                      >
                        <span className="drawing-modal__menu-check" aria-hidden="true">
                          {!hoverLinksOff ? '✓' : ''}
                        </span>
                        <span>Link preview on hover</span>
                      </button>
                      <div className="drawing-modal__menu-divider" role="separator" />
                      <div className="drawing-modal__menu-group">
                        <span className="drawing-modal__menu-label">
                          {appFoldMode === undefined ? 'Fold arrows' : `Fold arrows (app: ${appFoldMode.toLowerCase()})`}
                        </span>
                        <div className="drawing-modal__menu-choices" role="group" aria-label="Fold arrows">
                          {FOLD_ARROW_CHOICES.map(({ value, label, title }) => (
                            <button
                              key={String(value)}
                              type="button"
                              className="drawing-modal__menu-pill"
                              title={value === 'app' && appFoldMode !== undefined ? `${title}: ${appFoldMode}` : title}
                              aria-pressed={(boardFoldArrows ?? 'app') === value}
                              disabled={readOnly}
                              onClick={() => setInlineFoldArrows(value)}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="drawing-modal__menu-divider" role="separator" />
                      <div className="drawing-modal__menu-group">
                        <span className="drawing-modal__menu-label">
                          {appOutlineMode === undefined ? 'Hover outline' : `Hover outline (app: ${appOutlineMode.toLowerCase()})`}
                        </span>
                        <div className="drawing-modal__menu-choices" role="group" aria-label="Hover outline">
                          {HOVER_OUTLINE_CHOICES.map(({ value, label, title }) => (
                            <button
                              key={String(value)}
                              type="button"
                              className="drawing-modal__menu-pill"
                              title={value === 'app' && appOutlineMode !== undefined ? `${title}: ${appOutlineMode}` : title}
                              aria-pressed={(boardHoverOutline ?? 'app') === value}
                              disabled={readOnly}
                              onClick={() => setInlineHoverOutline(value)}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="drawing-modal__menu-divider" role="separator" />
                    </>
                  )}
                  <button
                    type="button"
                    className="drawing-modal__menu-item"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false)
                      surface.current?.openImageExport()
                    }}
                  >
                    Export Image or PDF…
                  </button>
                  <button
                    type="button"
                    className="drawing-modal__menu-item"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false)
                      void exportDrawing()
                    }}
                  >
                    Export Excalidraw Drawing…
                  </button>
                  {isInline && !readOnly && inline?.onMoveToFile !== undefined && (
                    <>
                      <div className="drawing-modal__menu-divider" role="separator" />
                      <button
                        type="button"
                        className="drawing-modal__menu-item"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false)
                          void moveToFile()
                        }}
                      >
                        Move to its own file
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
          {loaded !== null && canOpenInTab && (
            <button type="button" className="drawing-modal__icon-btn" aria-label="Open in tab" title="Open in tab" onClick={() => void openInTab()}>
              ↗
            </button>
          )}
          <button type="button" className="drawing-modal__icon-btn drawing-modal__close" aria-label="Close drawing" title="Close drawing" onClick={() => void requestClose()}>
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
        <div className="drawing-modal__canvas editor--drawing">
          {loaded !== null && (
            <Suspense fallback={null}>
              <ExcalidrawSurface key={generation} scene={loaded.scene} theme={theme} canvasPrefs={canvasPrefs} onCanvasPrefsChange={onCanvasPrefsChange} canvasPanel={canvasPanel} onCanvasPanelChange={onCanvasPanelChange} onSnapshot={onSnapshot} onFailed={setError} onApi={onApi} onExportPdf={exportPdf} readOnly={readOnly} hotkeys={hotkeys} hotkeysAside={hotkeysAside} links={links} foldArrows={boardFoldArrows} hoverOutline={boardHoverOutline} onOutsideChange={onOutsideChange} outsideOutlineThickness={outsideOutlineThickness} outsideOutlineColors={outsideOutlineColors} />
            </Suspense>
          )}
          {outsideChip}
        </div>
        <CardPreviewHost store={linkPreview.store} cardOf={linkCard} scopeOf={linkProps.previewScope} diagramDarkColors={linkProps.diagramDarkColors ?? 'adapt'} />
        {allowSheet}
      </div>
    </div>
  )
}
