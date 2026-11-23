/**
 * INLINE EXCALIDRAW DRAWING IN ITS OWN TAB (YAZ-6134): opens the `index`-th ```` ```excalidraw ````
 * block of a Markdown page full-pane in a tab, reusing `useDocumentHost` + `<ExcalidrawSurface>`
 * (the exact same canvas, autosave, conflict bar, rename continuity, and export commands as a
 * standalone `.excalidraw` tab).
 *
 * - Load/reload: reads the `.md` via `api.readFile(path)`, extracts block `#index` via
 *   `findInlineDrawings`, and resolves `<vault>/assets/` images via `openInlineDrawing`.
 * - Save: lands `unpersistedFiles` into `<vault>/assets/` via `api.drawing.landAssets`, compacts
 *   JSON via `compactInlineScene`, splices block `#index` back into the `.md` (preserving
 *   frontmatter, line endings, indent, and `<!-- drawing: … -->`), and writes via compare-and-set
 *   `api.writeFile({ path, content, expectedMtime, quiet: true })` wrapped in `announcedWrite` so
 *   a sibling tab of the same `.md` page updates quietly without conflict.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { CanvasPanelState, CanvasPrefs, FoldArrowMode, PageView } from '@shared/types'
import { missingPicturesNotice, picturesSize, unpersistedFiles } from '@shared/drawingAssets'
import { splitFrontmatter } from '@shared/frontmatter'
import { compactInlineScene, drawingTitleOf, findInlineDrawings, inlineDrawingBlock, withDrawingTitle } from '@shared/inlineDrawing'
import { lineEnds } from '@shared/lineEnds'
import { isPageReadOnly } from '@shared/readOnly'
import type { HotkeyOverrides } from '@shared/hotkeyBindings'
import type { HotkeyAside } from '@shared/keys'
import { api } from '../api'
import { DocumentShell } from '../documents/DocumentShell'
import { DocumentChips, exportWithNotice, useDocumentHost, type DocumentHostProps } from '../documents/useDocumentHost'
import type { NoticeKind } from '../lib/notice'
import { basename } from '../lib/paths'
import { registerPageView } from '../lib/pageView'
import { useAppliedTheme } from '../lib/theme'
import { announcedWrite } from '../lib/twinEditors'
import { trackFileWrite } from '../views/writeProperty'
import { CardPreviewHost } from '../tabs/cardPreview'
import { vaultUnit } from '../vault/unitWord'
import { drawingCogRows } from './DrawingEditor'
import { openInlineDrawing, type DrawingScene } from './drawingScene'
import { exportFileName } from './exportDrawing'
import { ExcalidrawSurface, type DrawingSnapshot, type DrawingSurfaceApi } from './ExcalidrawSurface'
import { pressed } from './drawingKeys'
import { useDrawingLinks, type DrawingLinkProps } from './useDrawingLinks'
import './drawingEditor.css'

const EXPORT_FAILED = "The drawing couldn't be exported."
const PDF_FAILED = "The PDF couldn't be exported."
const FORGET_PANEL = (): void => undefined

/** Splices `compactJson` (and optional `title`) into the `index`-th inline drawing block of `pageContent`, preserving indent, line endings, and `<!-- drawing: … -->`. */
export function replaceInlineDrawingBlock(pageContent: string, index: number, compactJson: string, title?: string): string {
  const { text, back } = lineEnds(pageContent)
  const { frontmatter, body } = splitFrontmatter(text)
  const blocks = findInlineDrawings(body)
  const block = blocks[index]
  if (block === undefined) throw new Error('This inline drawing is no longer in the file.')
  const drawingLine = title === undefined ? block.drawingLine : withDrawingTitle(block.drawingLine, title)
  const rendered = inlineDrawingBlock(compactJson, drawingLine)
  const indented =
    block.indent === ''
      ? rendered
      : rendered
          .split('\n')
          .map((l) => (l === '' ? '' : `${block.indent}${l}`))
          .join('\n')
  const lines = body.split('\n')
  const end = block.lineAt ?? block.close
  lines.splice(block.open, end - block.open + 1, indented)
  return back(frontmatter + lines.join('\n'))
}

interface LoadedInlineDocument {
  scene: DrawingScene
  mtime: number
  stored: readonly string[]
  readOnly: boolean
  pageContent: string
  title: string
}

async function loadInlineDocument(root: string, path: string, index: number): Promise<LoadedInlineDocument> {
  const file = await api.readFile(path)
  const blocks = findInlineDrawings(splitFrontmatter(file.content).body)
  const block = blocks[index]
  if (block === undefined) throw new Error('missing inline drawing')
  const loaded = await openInlineDrawing(root, block.json, path)
  return {
    scene: loaded.scene,
    mtime: file.mtime,
    stored: loaded.stored,
    readOnly: isPageReadOnly(file.content),
    pageContent: file.content,
    title: drawingTitleOf(block.drawingLine),
  }
}

export interface InlineDrawingTabProps extends DocumentHostProps, DrawingLinkProps {
  /** 0-based index of the ```` ```excalidraw ```` block in `path`. */
  index: number
  canvasPrefs?: CanvasPrefs
  onCanvasPrefsChange?: (next: CanvasPrefs) => void
  canvasPanel?: CanvasPanelState
  onCanvasPanelChange?: (next: CanvasPanelState) => void
  onNotice?: (text: string, icon?: NoticeKind) => void
  hotkeys?: HotkeyOverrides
  hotkeysAside?: HotkeyAside
  startView?: PageView
}

export function InlineDrawingTab(props: InlineDrawingTabProps) {
  const { index } = props
  const load = useCallback((req: { root: string; path: string }) => loadInlineDocument(req.root, req.path, index), [index])
  const errorText = useCallback(() => vaultUnit(props.root)('This inline drawing is no longer in the page.'), [props.root])
  return (
    <DocumentShell root={props.root} path={props.path} className="editor--drawing" load={load} errorText={errorText}>
      {(loaded, onFailed) => <InlineDrawingHost {...props} loaded={loaded} onFailed={onFailed} />}
    </DocumentShell>
  )
}

interface InlineDrawingHostProps extends InlineDrawingTabProps {
  loaded: LoadedInlineDocument
  onFailed: (message: string) => void
}

function InlineDrawingHost({
  root,
  path,
  index,
  loaded,
  watch,
  sync,
  onSyncNow,
  canvasPrefs,
  onCanvasPrefsChange,
  canvasPanel,
  onCanvasPanelChange = FORGET_PANEL,
  onNotice,
  hotkeys,
  hotkeysAside,
  onFailed,
  startView,
  ...linkProps
}: InlineDrawingHostProps) {
  const theme = useAppliedTheme()
  const snapshot = useRef<DrawingSnapshot | null>(null)
  const surface = useRef<DrawingSurfaceApi | null>(null)
  const reloadedTo = useRef<number | null>(null)
  const persisted = useRef(new Set(loaded.stored))
  const pageContentRef = useRef(loaded.pageContent)
  const keepMineRef = useRef(false)
  const [drawingTitle, setDrawingTitle] = useState(loaded.title)
  const drawingTitleRef = useRef(loaded.title)
  drawingTitleRef.current = drawingTitle
  const titleVersionRef = useRef(0)
  const [hoverLinksOff, setHoverLinksOff] = useState(loaded.scene.hoverLinksOff === true)
  const [boardFoldArrows, setBoardFoldArrows] = useState<FoldArrowMode | undefined>(loaded.scene.foldArrows)
  const [boardHoverOutline, setBoardHoverOutline] = useState<boolean | undefined>(loaded.scene.hoverOutline)
  const settingsRef = useRef({ hoverLinksOff, foldArrows: boardFoldArrows, hoverOutline: boardHoverOutline })
  settingsRef.current = { hoverLinksOff, foldArrows: boardFoldArrows, hoverOutline: boardHoverOutline }

  useEffect(() => {
    const fallback = `${basename(path).replace(/\.md$/i, '')} · Drawing`
    document.title = drawingTitle !== '' ? drawingTitle : fallback
    window.dispatchEvent(new CustomEvent('mdapp:inline-drawing-title', { detail: { path, index, title: drawingTitle } }))
  }, [path, index, drawingTitle])

  const board = useDocumentHost({
    root,
    path,
    watch,
    sync,
    onSyncNow,
    readOnly: loaded.readOnly,
    readOnlySwitch: false,
    onNotice,
    write: async (expectedMtime) => {
      const current = snapshot.current
      if (current === null) throw new Error('nothing to save')
      const { json, files, referenced } = current.serialize()
      const newFiles = unpersistedFiles(files, referenced, persisted.current)
      if (newFiles.length > 0) {
        const landed = await api.drawing.landAssets({ root, newFiles })
        for (const id of landed.persisted) persisted.current.add(id)
      }
      const { json: compactJson } = compactInlineScene(json, settingsRef.current)
      let baseContent = pageContentRef.current
      if (keepMineRef.current) {
        keepMineRef.current = false
        baseContent = (await api.readFile(path)).content
      }
      const nextPage = replaceInlineDrawingBlock(baseContent, index, compactJson, drawingTitleRef.current)
      const res = await trackFileWrite(
        announcedWrite(path, () => api.writeFile({ path, content: nextPage, expectedMtime, quiet: true })),
      )
      pageContentRef.current = nextPage
      return res
    },
    onKeepMine: () => {
      persisted.current = new Set()
      keepMineRef.current = true
    },
    reload: async (a) => {
      const s = surface.current
      if (s === null) return
      try {
        const doc = await loadInlineDocument(root, path, index)
        reloadedTo.current = doc.mtime
        persisted.current = new Set(doc.stored)
        pageContentRef.current = doc.pageContent
        drawingTitleRef.current = doc.title
        setDrawingTitle(doc.title)
        const nextSettings = { hoverLinksOff: doc.scene.hoverLinksOff === true, foldArrows: doc.scene.foldArrows, hoverOutline: doc.scene.hoverOutline }
        settingsRef.current = nextSettings
        setHoverLinksOff(nextSettings.hoverLinksOff)
        setBoardFoldArrows(nextSettings.foldArrows)
        setBoardHoverOutline(nextSettings.hoverOutline)
        a.reset(s.replaceScene(doc.scene) + titleVersionRef.current, doc.mtime)
        return doc.readOnly
      } catch (err) {
        reloadedTo.current = null
        throw err
      }
    },
    onCommand: (command) => {
      const s = surface.current
      if (s === null) return
      if (command.kind === 'export-image') s.openImageExport()
      else if (command.kind === 'export-drawing') void exportDrawing()
      else s.setCanvasBackground(command.color)
    },
    onShown: () => surface.current?.refresh(),
    focus: () => surface.current?.focus(),
  })
  const { autosave, start, chips, readOnly, reload } = board
  const { links, linkPreview, linkCard } = useDrawingLinks({ root, theme, path, readOnly, hotkeys, onNotice, hostRef: board.hostRef, props: { ...linkProps, hoverLinks: linkProps.hoverLinks === true && !hoverLinksOff } })

  const toldMissing = useRef(false)
  useEffect(() => {
    if (toldMissing.current) return
    toldMissing.current = true
    const { missing } = picturesSize(loaded.scene.elements, loaded.scene.files ?? {})
    if (missing > 0) onNotice?.(missingPicturesNotice(missing), 'error')
  }, [loaded, onNotice])

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
      const combined = next.version + titleVersionRef.current
      const a = autosave.current
      if (a === null) {
        start(combined, loaded.mtime)
        lockedAt.current = combined
        return
      }
      const mtime = reloadedTo.current
      if (mtime !== null) {
        reloadedTo.current = null
        a.reset(combined, mtime)
        lockedAt.current = combined
        return
      }
      if (readOnlyRef.current) {
        if (combined !== lockedAt.current) strayWhileReadOnly.current = true
        return
      }
      a.update(combined)
    },
    [autosave, start, loaded.mtime],
  )

  const onTitleInput = useCallback(
    (next: string) => {
      if (readOnlyRef.current) return
      drawingTitleRef.current = next
      setDrawingTitle(next)
      titleVersionRef.current += 1
      autosave.current?.update((snapshot.current?.version ?? 0) + titleVersionRef.current)
    },
    [autosave],
  )

  const renderTopRight = useCallback(() => <DocumentChips store={chips} className="drawing-editor__chips" />, [chips])
  const onApi = useCallback((a: DrawingSurfaceApi) => {
    surface.current = a
  }, [])

  useEffect(() => {
    const host = board.hostRef.current
    if (host === null) return
    return registerPageView(host, () => ({ scrollTop: 0, zoomKey: null, folds: [], magnification: 100, ...(surface.current !== null && { canvas: surface.current.canvas() }) }))
  }, [board.hostRef])

  const exportDrawing = async (): Promise<void> => {
    const s = surface.current
    if (s === null || board.retired.current) return
    const base = drawingTitle !== '' ? `${drawingTitle}.excalidraw` : basename(path)
    await exportWithNotice(async () => api.dialog.saveDrawing({ defaultName: exportFileName(base), content: await s.exportScene() }), EXPORT_FAILED, onNotice)
  }

  const bumpSetting = useCallback(() => {
    titleVersionRef.current += 1
    autosave.current?.update((snapshot.current?.version ?? 0) + titleVersionRef.current)
    board.flush()
  }, [autosave, board])

  const setHoverLinks = useCallback(
    (on: boolean) => {
      if (readOnlyRef.current) return
      const nextOff = !on
      settingsRef.current = { ...settingsRef.current, hoverLinksOff: nextOff }
      setHoverLinksOff(nextOff)
      bumpSetting()
    },
    [bumpSetting],
  )

  const setFoldArrows = useCallback(
    (value: 'app' | FoldArrowMode) => {
      if (readOnlyRef.current) return
      const next = value === 'app' ? undefined : value
      settingsRef.current = { ...settingsRef.current, foldArrows: next }
      setBoardFoldArrows(next)
      bumpSetting()
    },
    [bumpSetting],
  )

  const setHoverOutline = useCallback(
    (value: 'app' | boolean) => {
      if (readOnlyRef.current) return
      const next = value === 'app' ? undefined : value
      settingsRef.current = { ...settingsRef.current, hoverOutline: next }
      setBoardHoverOutline(next)
      bumpSetting()
    },
    [bumpSetting],
  )

  const appFoldArrowsRef = useRef(canvasPrefs?.foldArrowsOpen)
  appFoldArrowsRef.current = canvasPrefs?.foldArrowsOpen
  const appHoverOutlineRef = useRef(canvasPrefs?.hoverOutline)
  appHoverOutlineRef.current = canvasPrefs?.hoverOutline
  const cogActions = useRef({ exportDrawing, setHoverLinks, setFoldArrows, setHoverOutline })
  cogActions.current = { exportDrawing, setHoverLinks, setFoldArrows, setHoverOutline }
  useLayoutEffect(
    () =>
      chips.set({
        pageRows: () =>
          drawingCogRows({
            includeReadOnly: false,
            pictures: { bytes: 0, count: 0 },
            out: false,
            readOnly,
            onMovePictures: () => undefined,
            onExportImage: () => surface.current?.openImageExport(),
            onExportDrawing: () => void cogActions.current.exportDrawing(),
            hoverLinks: !hoverLinksOff,
            onHoverLinks: () => cogActions.current.setHoverLinks(hoverLinksOff),
            foldArrows: boardFoldArrows ?? 'app',
            onFoldArrows: (value) => cogActions.current.setFoldArrows(value),
            appFoldArrows: appFoldArrowsRef.current,
            hoverOutline: boardHoverOutline ?? 'app',
            onHoverOutline: (value) => cogActions.current.setHoverOutline(value),
            appHoverOutline: appHoverOutlineRef.current,
          }),
      }),
    [chips, readOnly, hoverLinksOff, boardFoldArrows, boardHoverOutline],
  )

  const exportPdf = async (svg: string, size: { width: number; height: number }): Promise<void> => {
    if (board.retired.current) return
    const base = drawingTitle !== '' ? `${drawingTitle}.excalidraw` : basename(path)
    await exportWithNotice(() => api.dialog.savePdf({ defaultName: exportFileName(base, 'pdf'), svg, width: size.width, height: size.height }), PDF_FAILED, onNotice)
  }

  const onKeyDownCapture = (e: ReactKeyboardEvent): void => {
    if (pressed(e, 'drawing.saveNow', hotkeys)) {
      e.preventDefault()
      e.stopPropagation()
      board.flush()
    }
  }

  return (
    <div className="drawing-editor" ref={board.hostRef} onKeyDownCapture={onKeyDownCapture}>
      <div
        className="inline-drawing-tab__bar"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '6px 14px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg)',
          flexShrink: 0,
        }}
      >
        <input
          type="text"
          className="inline-drawing-tab__title"
          value={drawingTitle}
          placeholder="Untitled drawing"
          aria-label="Drawing title"
          readOnly={readOnly}
          onChange={(e) => onTitleInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'Escape') {
              e.preventDefault()
              e.currentTarget.blur()
              surface.current?.focus()
            }
            e.stopPropagation()
          }}
          style={{
            flex: 1,
            minWidth: 0,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            color: 'var(--fg)',
            fontSize: '13px',
            fontWeight: 500,
            padding: '2px 0',
          }}
        />
      </div>
      {board.conflictBar}
      <div className="drawing-editor__canvas">
        <ExcalidrawSurface
          scene={loaded.scene}
          startCanvas={startView?.canvas}
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
          foldArrows={boardFoldArrows}
          hoverOutline={boardHoverOutline}
        />
      </div>
      <CardPreviewHost store={linkPreview.store} cardOf={linkCard} scopeOf={linkProps.previewScope} diagramDarkColors={linkProps.diagramDarkColors ?? 'adapt'} />
    </div>
  )
}
