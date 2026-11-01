/**
 * THE DRAWING DOCUMENT (Draw's 🔒 YAZ-1810, ported by YAZ-3028 D2): a `.excalidraw` opened full-pane in a
 * tab. `Editor` dispatches `kind === 'drawing'` here, and this is the shell's ordinary document host — save
 * chip, sync chip, conflict bar, debounced autosave, the quit handshake, all from
 * `useDocumentHost` (YAZ-2073 🔒 D16) — with the canvas where a text editor would be.
 *
 * 🔒 CHROME ONLY. The ENGINE lives behind `ExcalidrawSurface` — the SAME surface the note embed's
 * modal mounts (rule 28) — and nothing in this file imports the package, or anything that does.
 * `DrawingEditor.test.tsx` mocks that one seam and pins the rest.
 *
 * AUTOSAVE ON THE VERSION, NOT THE BYTES. The engine reports a snapshot per pointer move. The
 * snapshot lives in a REF and autosave is fed only its cheap integer `version`, so a drag costs
 * one React render instead of hundreds — and serialising happens ONCE, inside `write`, when the
 * 500 ms timer fires. The FIRST snapshot is the surface's restore-then-compare baseline, so a
 * drawing that is opened and not touched is clean and is never written back.
 *
 * RELOADING MUST NOT WRITE. The engine answers `updateScene` with its own `onChange`, so a naive
 * reload looks like an edit and saves the freshly-read bytes straight back. Two guards, both
 * cheap: `replaceScene` returns the version computed from the elements it handed the engine (not
 * read back from it, which races its commit), and the first snapshot after a reload is consumed
 * as the new BASELINE rather than as a change.
 *
 * ⚡ KEYS ARE THE HOST'S, NEVER `window`'s. ⌘S is caught on this element in the CAPTURE phase —
 * before the engine's own keymap sees it — and flushes now. A `window` listener would fire for
 * every mounted tab at once, and the shell keeps several mounted. The surface applies the same
 * rule to ⌘F / ⌘C, and it is why the parity checklist drops `handleKeyboardGlobally`.
 *
 * THE CHIPS ARE THE ENGINE'S TOP-RIGHT ROW, not a strip above the canvas: the canvas starts
 * directly under the tab bar, and the chips sit where the web app's cloud status does.
 *
 * ON SAVE (🔒 YAZ-1775 D3, changed by YAZ-3943 D5). `unpersistedFiles` picks the canvas files main
 * does not have yet — referenced by a live image element, and not among what `drawing:load` called
 * `stored` plus what earlier saves reported back — and ships them as `newFiles`, beside the lean
 * scene. MAIN decides where the pictures go: inside the file (the default; every picture of the
 * board is `stored` at load), or out to `assets/` for a "pictures out" board, whose embedded bytes
 * come back from load as not-stored, so its next save is the shrink. The persisted set only ever
 * grows, so the same image is never shipped twice in one session. A save that moved the pictures
 * out by the 50 MB rule (`movedOut`) shows the one notice.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { CanvasPanelState, CanvasPrefs, DrawingLoadResponse } from '@shared/types'
import { unpersistedFiles } from '@shared/drawingAssets'
import type { HotkeyOverrides } from '@shared/hotkeyBindings'
import type { HotkeyAside } from '@shared/keys'
import { api, BridgeRequestError } from '../api'
import { DocumentShell } from '../documents/DocumentShell'
import { DocumentChips, exportWithNotice, useDocumentHost, type DocumentHostProps } from '../documents/useDocumentHost'
import type { NoticeKind } from '../lib/notice'
import { basename } from '../lib/paths'
import { formatBytes } from '../lib/format'
import { useAppliedTheme } from '../lib/theme'
import type { PageSwitch } from '../editor/PageSettings'
import { CardPreviewHost } from '../tabs/cardPreview'
import { exportFileName } from './exportDrawing'
import { parseSceneText, type DrawingScene } from './drawingScene'
import { ExcalidrawSurface, type DrawingSnapshot, type DrawingSurfaceApi } from './ExcalidrawSurface'
import { pressed } from './drawingKeys'
import { PICTURES_MOVED_OUT } from './saveDrawing'
import { useDrawingLinks, type DrawingLinkProps } from './useDrawingLinks'
import './drawingEditor.css'

/** What a document that will not open says — one message for its three causes (missing, corrupt, empty). */
export const BROKEN_DRAWING_DOCUMENT = "This Excalidraw drawing can't be opened: its file is missing or is not a scene."

/** YAZ-3943 D5: the size row turns amber from here, well before the 50 MB rule moves the pictures out. */
export const PICTURES_WARN_BYTES = 20 * 1024 * 1024

/**
 * The drawing's cog rows after "Read only" (YAZ-3943 D5, D13): the pictures' size and count, the button
 * that moves them out or back in, then the two exports. No picture: no size row and no button. The
 * button writes the file, so Read only greys it out; the exports write elsewhere and stay.
 */
export function drawingCogRows({ pictures, out, readOnly, onMovePictures, onExportImage, onExportDrawing }: {
  pictures: { bytes: number; count: number }
  out: boolean
  readOnly: boolean
  onMovePictures: () => void
  onExportImage: () => void
  onExportDrawing: () => void
}): PageSwitch[] {
  const rows: PageSwitch[] = []
  if (pictures.count > 0) {
    const where = out ? 'Pictures in the assets folder' : 'Pictures in this file'
    rows.push({ label: `${where}: ${formatBytes(pictures.bytes)} (${pictures.count})`, warn: !out && pictures.bytes >= PICTURES_WARN_BYTES, divider: true })
    rows.push({ label: out ? 'Keep pictures inside' : 'Move pictures out', onToggle: onMovePictures, disabled: readOnly })
  }
  rows.push({ label: 'Export Image or PDF…', onToggle: onExportImage, divider: true }, { label: 'Export Excalidraw Drawing…', onToggle: onExportDrawing })
  return rows
}

/** What File › Export Drawing… says when the save sheet or the write refused (🔒 YAZ-1775 D3, YAZ-1821). */
const EXPORT_FAILED = "The Excalidraw drawing couldn't be exported."
/** What the PDF button says when the sheet, the print or the write refused (YAZ-3943 D6). */
const PDF_FAILED = "The PDF couldn't be exported."

/** Page links in the board's text (YAZ-4039): the props a note's editor gets for its `[[links]]` (`useDrawingLinks`). */
export interface DrawingEditorProps extends DocumentHostProps, DrawingLinkProps {
  /**
   * The user-level canvas preferences (🔒 YAZ-1775 D9), App's copy of `SettingsState.canvas`: seeded into
   * the scene at mount and kept in step with the engine both ways. Omitted = the engine's defaults.
   */
  canvasPrefs?: CanvasPrefs
  /** The engine moved a pref: App writes it back to the one store every window reads. */
  onCanvasPrefsChange?: (next: CanvasPrefs) => void
  /** What the canvas panel remembers (YAZ-3038): App's copy of `SettingsState.canvasPanel`. Omitted = the default. */
  canvasPanel?: CanvasPanelState
  /** A panel choice (its tab, docked or not): App writes it back to the one store every window reads. */
  onCanvasPanelChange?: (next: CanvasPanelState) => void
  /** The window's ONE passive notice: where an export landed, or why it did not (🔒 YAZ-1775 D3, YAZ-1821). */
  onNotice?: (text: string, icon?: NoticeKind) => void
  /** `settings.hotkeys` (YAZ-3564): the drawing keys as the user set them, live. Omitted = the defaults. */
  hotkeys?: HotkeyOverrides
  /** `settings.hotkeysAside` (YAZ-3564 K9): with a switch off, the drawing lets that App key go to the menu. */
  hotkeysAside?: HotkeyAside
}

/** A loaded document: the scene the canvas opens on, and the mtime the first save guards with. */
interface LoadedDocument {
  scene: DrawingScene
  mtime: number
  /** The ids the store already holds — what the renderer must never ship again. */
  stored: string[]
}

/**
 * `drawing:load`'s answer as the engine wants it: the image map becomes `BinaryFileData`-shaped
 * entries keyed by id. Throws when the bytes are not a scene, which is the error pane.
 */
function toDocument(res: DrawingLoadResponse): LoadedDocument {
  const parsed = parseSceneText(res.json)
  const files: Record<string, unknown> = {}
  const created = Date.now()
  for (const [id, entry] of Object.entries(res.files)) files[id] = { id, mimeType: entry.mimeType, dataURL: entry.dataURL, created }
  return { scene: { ...parsed, files }, mtime: res.mtime, stored: res.stored }
}

const loadDocument = (req: { root: string; path: string }): Promise<LoadedDocument> => api.drawing.load(req).then(toDocument)
// Missing, unreadable, not a scene: ONE readable state, never a blank pane.
const brokenDocument = (): string => BROKEN_DRAWING_DOCUMENT

export function DrawingEditor(props: DrawingEditorProps) {
  return (
    <DocumentShell root={props.root} path={props.path} className="editor--drawing" load={loadDocument} errorText={brokenDocument}>
      {(loaded, onFailed) => <DrawingHost {...props} loaded={loaded} onFailed={onFailed} />}
    </DocumentShell>
  )
}

interface DrawingHostProps extends DrawingEditorProps {
  loaded: LoadedDocument
  onFailed: (message: string) => void
}

/** A tab ALWAYS has the canvas panel (YAZ-3038); with no host to remember its choices they are simply not kept. */
const FORGET_PANEL = (): void => undefined

/** Mounts exactly one canvas for `loaded`; its board document owns everything that writes. */
function DrawingHost({ root, path, loaded, watch, sync, onSyncNow, canvasPrefs, onCanvasPrefsChange, canvasPanel, onCanvasPanelChange = FORGET_PANEL, onNotice, hotkeys, hotkeysAside, onFailed, ...linkProps }: DrawingHostProps) {
  const theme = useAppliedTheme()
  /** The latest snapshot; read only when a save fires (see the module doc). */
  const snapshot = useRef<DrawingSnapshot | null>(null)
  const surface = useRef<DrawingSurfaceApi | null>(null)
  /** Set by a reload; the next snapshot is consumed as the new baseline, not as a change. */
  const reloadedTo = useRef<number | null>(null)
  /** Ids the store holds: load's `stored`, grown by every save's `persisted` (🔒 YAZ-1775 D3). */
  const persisted = useRef(new Set(loaded.stored))
  /** `"pictures": "assets"` as the file last said it (YAZ-3943 D5): the load, each reload, the 50 MB rule, the cog's button. */
  const [picturesOut, setPicturesOut] = useState(loaded.scene.picturesOut === true)

  // Fresh closures every render are fine: the hook reads them through its `engine` ref, never stale.
  const board = useDocumentHost({
    root,
    path,
    watch,
    sync,
    onSyncNow,
    readOnly: loaded.scene.readOnly === true,
    onNotice,
    write: async (expectedMtime) => {
      const current = snapshot.current
      if (current === null) throw new Error('nothing to save')
      const { json, files, referenced } = current.serialize()
      const newFiles = unpersistedFiles(files, referenced, persisted.current)
      const res = await api.drawing.save({ root, path, json, expectedMtime, newFiles })
      for (const id of res.persisted) persisted.current.add(id)
      if (res.movedOut === true) {
        setPicturesOut(true)
        onNotice?.(PICTURES_MOVED_OUT)
      }
      return res
    },
    reload: async (a) => {
      const s = surface.current
      if (s === null) return
      try {
        const doc = toDocument(await api.drawing.load({ root, path }))
        reloadedTo.current = doc.mtime
        persisted.current = new Set(doc.stored)
        setPicturesOut(doc.scene.picturesOut === true)
        a.reset(s.replaceScene(doc.scene), doc.mtime)
        return doc.scene.readOnly === true
      } catch (err) {
        reloadedTo.current = null
        throw err
      }
    },
    // The application menu's three canvas items (Draw's 🔒 YAZ-1775 D10; the items are YAZ-3037's); a
    // host whose engine has not handed its API over yet simply has nothing to do.
    onCommand: (command) => {
      const s = surface.current
      if (s === null) return
      if (command.kind === 'export-image') s.openImageExport()
      else if (command.kind === 'export-drawing') void exportDrawing()
      else s.setCanvasBackground(command.color)
    },
    // A tab back from `visibility: hidden` may have been laid out at the wrong size.
    onShown: () => surface.current?.refresh(),
    focus: () => surface.current?.focus(),
  })
  const { autosave, start, chips, readOnly, reload } = board
  const { links, linkPreview, linkCard } = useDrawingLinks({ root, theme, path, readOnly, hotkeys, onNotice, hostRef: board.hostRef, props: linkProps })
  /**
   * Read only (YAZ-3076 D2): the engine is in view mode, so nothing should change; a snapshot whose
   * version moves anyway (a door the view mode does not close) is kept off disk, and the canvas is
   * put back to the disk at "Allow edits". `lockedAt` is the version read only began on.
   */
  const readOnlyRef = useRef(readOnly)
  readOnlyRef.current = readOnly
  const lockedAt = useRef<number | null>(null)
  const strayWhileReadOnly = useRef(false)
  useEffect(() => {
    if (readOnly) {
      lockedAt.current = snapshot.current?.version ?? null
      return
    }
    if (!strayWhileReadOnly.current) return
    strayWhileReadOnly.current = false
    void reload()
  }, [readOnly, reload])

  const onSnapshot = useCallback(
    (next: DrawingSnapshot) => {
      snapshot.current = next
      const a = autosave.current
      // The first snapshot IS the clean baseline (the surface restored the disk elements first).
      if (a === null) {
        start(next.version, loaded.mtime)
        lockedAt.current = next.version
        return
      }
      const mtime = reloadedTo.current
      if (mtime !== null) {
        reloadedTo.current = null
        // Whatever the engine settled on after `replaceScene` IS the baseline; treating it as a
        // change would write the bytes we have just read straight back to disk.
        a.reset(next.version, mtime)
        lockedAt.current = next.version
        return
      }
      // Read only: never an edit (see `lockedAt`).
      if (readOnlyRef.current) {
        if (next.version !== lockedAt.current) strayWhileReadOnly.current = true
        return
      }
      a.update(next.version)
    },
    [autosave, start, loaded.mtime],
  )

  // The chips, as the engine's top-right slot content: ONE identity for the host's life (the surface
  // hands this straight to a memoized `<Excalidraw>`); what they say comes from the store.
  const renderTopRight = useCallback(() => <DocumentChips store={chips} className="drawing-editor__chips" />, [chips])

  const onApi = useCallback((a: DrawingSurfaceApi) => {
    surface.current = a
  }, [])

  /**
   * File › Export Drawing… (🔒 YAZ-1775 D3, YAZ-1821). The canvas assembles a STANDALONE scene — the whole
   * live files map, minus what only deleted elements name, embedded — and main's save sheet writes
   * it wherever the user points. THE VAULT FILE IS NOT TOUCHED: nothing here reads it, writes it or
   * flushes the autosave, so an export of a dirty board exports what is on the canvas and the
   * board's own save timer carries on as if nothing happened.
   */
  const exportDrawing = async (): Promise<void> => {
    const s = surface.current
    if (s === null || board.retired.current) return
    await exportWithNotice(async () => api.dialog.saveDrawing({ defaultName: exportFileName(basename(path)), content: await s.exportScene() }), EXPORT_FAILED, onNotice)
  }

  /**
   * The cog's "Move pictures out" / "Keep pictures inside" (YAZ-3943 D5): `board:set-pictures`, beside the
   * autosave as the Read only switch is (`writeBeside`: pending edits save first, then the one write, and
   * its mtime is adopted, so the watcher's echo reloads nothing). A file changed on disk first is refused.
   */
  const movePictures = async (out: boolean): Promise<void> => {
    const a = autosave.current
    if (a === null || board.retired.current) return
    try {
      await a.writeBeside((expectedMtime) => api.setBoardPictures({ root, path, out, expectedMtime }))
      setPicturesOut(out)
    } catch (err) {
      if (err instanceof BridgeRequestError && err.code === 'CONFLICT') {
        onNotice?.('The file changed on disk. Try again.', 'error')
        if (!a.dirty) void reload()
        return
      }
      onNotice?.(err instanceof BridgeRequestError && err.message !== '' ? err.message : "The pictures couldn't move.", 'error')
    }
  }

  // The cog's rows (YAZ-3943 D5, D13), set from here because `renderTopRight` is made once. The rows are
  // made while the cog is open, never on a keystroke; the clicks read this render's handlers through a ref.
  const cogActions = useRef({ movePictures, exportDrawing })
  cogActions.current = { movePictures, exportDrawing }
  useLayoutEffect(
    () =>
      chips.set({
        pageRows: () =>
          drawingCogRows({
            pictures: surface.current?.pictures() ?? { bytes: 0, count: 0 },
            out: picturesOut,
            readOnly,
            onMovePictures: () => void cogActions.current.movePictures(!picturesOut),
            // The same handlers as ⌘⇧E and ⌘⇧S (`onCommand`).
            onExportImage: () => surface.current?.openImageExport(),
            onExportDrawing: () => void cogActions.current.exportDrawing(),
          }),
      }),
    [chips, picturesOut, readOnly],
  )

  /**
   * The export box's PDF button (YAZ-3943 D6): main's PDF sheet, then one page printed from the engine's SVG.
   * Like Export Drawing…, the vault file is not touched. The notice says where the PDF landed, as today.
   */
  const exportPdf = async (svg: string, size: { width: number; height: number }): Promise<void> => {
    if (board.retired.current) return
    await exportWithNotice(() => api.dialog.savePdf({ defaultName: exportFileName(basename(path), 'pdf'), svg, width: size.width, height: size.height }), PDF_FAILED, onNotice)
  }

  /** ⌘S (or the user's key for it, YAZ-3564) flushes now — caught before the engine's own keymap, and never on `window`. */
  const onKeyDownCapture = (e: ReactKeyboardEvent): void => {
    if (pressed(e, 'drawing.saveNow', hotkeys)) {
      e.preventDefault()
      e.stopPropagation()
      board.flush()
    }
  }

  return (
    <div className="drawing-editor" ref={board.hostRef} onKeyDownCapture={onKeyDownCapture}>
      {board.conflictBar}
      <div className="drawing-editor__canvas">
        <ExcalidrawSurface
          scene={loaded.scene}
          theme={theme}
          canvasPrefs={canvasPrefs}
          onCanvasPrefsChange={onCanvasPrefsChange}
          canvasPanel={canvasPanel}
          onCanvasPanelChange={onCanvasPanelChange}
          onSnapshot={onSnapshot}
          onFailed={onFailed}
          onApi={onApi}
          renderTopRight={renderTopRight}
          readOnly={readOnly}
          hotkeys={hotkeys}
          hotkeysAside={hotkeysAside}
          autoFocus
          links={links}
          onExportPdf={exportPdf}
        />
      </div>
      <CardPreviewHost store={linkPreview.store} cardOf={linkCard} scopeOf={linkProps.previewScope} diagramDarkColors={linkProps.diagramDarkColors ?? 'adapt'} />
    </div>
  )
}
