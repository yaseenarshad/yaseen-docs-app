import { lazy, memo, Suspense, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type CSSProperties } from 'react'
import type { ReviewSettings } from '@shared/reviews'
import { DEFAULT_SETTINGS, rootOfPath, TOC_DEFAULT_W, type CanvasPanelState, type CanvasPrefs, type CommentsOrder, type DiagramDarkColors, type ContentWidth, type FileResponse, type GithubSyncStatus, type PageView, type PropertiesResponse, type SettingsState, type TableOfContents as TableOfContentsMode, type TocSource } from '@shared/types'
import { fileKind } from '@shared/fileKind'
import type { HotkeyOverrides } from '@shared/hotkeyBindings'
import type { HotkeyAside } from '@shared/keys'
import { api } from '../api'
import { CommentsSection } from '../comments/CommentsSection'
import { createDrawing } from '../drawings/createDrawing'
import { DrawingModal } from '../drawings/DrawingModal'
import { createDrawingFeed } from '../drawings/drawingFeed'
import { ImageModal } from './image/ImageModal'
import type { GalleryImage } from './image/imageOptions'
import { FolderView } from '../views/FolderView'
import { hrefPath, hrefTarget, vaultHref } from './pathPaste'
import { redrawLinkPills } from './markdownLink'
import { editorViewCtx } from '@milkdown/kit/core'
import { createCrepe, editorViewOf, focusEditor, getMarkdownForSave, getPlainText, getZoomKeyOf, getZoomLabelOf, moveCaretIntoZoom, setMarkdown, zoomPageTo } from './createCrepe'
import { applyExternalMarkdown } from './external/applyExternalMarkdown'
import { FindBar } from './find/FindBar'
import { createFindChannel } from './find/findChannel'
import { TableOfContents } from './toc/TableOfContents'
import { createTocChannel } from './toc/tocChannel'
import { FrontmatterPanel } from './FrontmatterPanel'
import { PageTitle } from './PageTitle'
import type { WikilinkCandidateSource } from './wikilink/wikilinkPicker'
import { redrawWikilinks, type WikilinkResolveSource } from './wikilink/wikilinkPlugin'
import type { ViewOnlyLinkSource } from './wikilink/viewOnlyLinkSource'
import type { WikilinkHover } from './wikilink/wikilinkHover'
import './outline/outlineFolding.css'
import './outline/headingFolding.css'
import './outline/headingLevelTag.css'
import './outline/bullets.css'
import './outline/zoom.css'
import './outline/guideLines.css'
import './outline/bulletThreading.css'
import './outline/sectionIndent.css'
import './softBreaks.css'
import { splitFrontmatter } from '@shared/frontmatter'
import { isNoteReadOnly, setNoteReadOnly } from '@shared/readOnly'
import { SaveIndicator } from './SaveIndicator'
import { SyncIndicator } from './SyncIndicator'
import { DocumentZoom, stepZoomByKey } from './DocumentZoom'
import { FoldAllButton } from './FoldAllButton'
import { FOLDS_CHANGED_EVENT, nextDocumentFold, setAllDocumentFolds } from './outline/foldAllHotkeys'
import { PageSettings } from './PageSettings'
import { ReadOnlyChip } from './ReadOnlyChip'
import { NoteMenu } from './noteMenu'
import { ZOOM_EVENT } from './zoomRequest'
import { fileLines } from './lineNumbers/fileLines'
import { requestBlockLines, showLineNumbers } from './lineNumbers/lineNumbers'
import { showSectionIndent } from './outline/sectionIndent'
import { usePageSwitch } from './usePageSwitch'
import type { ZoomStep } from '@shared/types'
import type { ZoomFrom } from '../workspace/useWorkspace'
import type { CodeSettingsPatch } from '../code/codeSettings'
import { useAutosave } from '../hooks/useAutosave'
import { useFile } from '../hooks/useFile'
import type { WatchSource } from '../hooks/useWatch'
import { BacklinksSection } from '../links/BacklinksSection'
import { ReviewsSection } from '../review/ReviewsSection'
import { pageLabel, usePathTitles, useTreeKind, type PathTitles } from '../lib/pageLabel'
import { namingTab } from '../lib/focusHandoff'
import { flushRenamedPath, takeRenameBuffer } from '../lib/renameContinuity'
import { onTwinSave } from '../lib/twinEditors'
import { registerPageView } from '../lib/pageView'
import { appliedTheme } from '../lib/theme'
import { storage } from '../lib/storage'
import { transformFile } from '../views/writeProperty'
import { PdfViewer } from '../viewers/PdfViewer'
import { ImageViewer } from '../viewers/ImageViewer'
import type { NoticeKind, NoticeType } from '../lib/notice'
import type { AnchorRect } from '../sidebar/previewPlacement'
import { fileIconDecoration, IconsContext } from '../sidebar/FileIcon'
import { VaultLinksContext } from '../links/vaultLinks'
import { CardPreviewHost, useCardPreview, type PreviewScope } from '../tabs/cardPreview'

/**
 * A drawing tab (YAZ-3028 D2): its chrome arrives with the first drawing a window opens, in its own
 * chunk, and the engine after it (`drawings/engine.ts`) — a window with no drawing tab loads neither.
 */
const DrawingEditor = lazy(() => import('../drawings/DrawingEditor').then((m) => ({ default: m.DrawingEditor })))
/** A diagram tab (YAZ-3028 D5): the same rule — its host in its own chunk, and draw.io in its own origin's iframe. */
const DrawioEditor = lazy(() => import('../diagrams/DrawioEditor').then((m) => ({ default: m.DrawioEditor })))
/** A code tab (YAZ-3448, D1/D2): the same rule — its host in its own chunk, and Monaco in the next (`code/monaco.ts`). */
const CodeEditor = lazy(() => import('../code/CodeEditor').then((m) => ({ default: m.CodeEditor })))

/**
 * A save flips the chip unsaved → saving → saved, and each flip re-renders CrepeHost; these sections
 * depend on none of it, yet each pass re-parsed the YAML and re-ran marked + DOMPurify per comment
 * (YAZ-2196). Memoised, they re-render only when their own inputs or subscriptions change.
 */
const MemoFrontmatterPanel = memo(FrontmatterPanel)
const MemoCommentsSection = memo(CommentsSection)
const MemoBacklinksSection = memo(BacklinksSection)
const MemoReviewsSection = memo(ReviewsSection)
/** Up to 200 names (YAZ-2700): the same reason, and every one of its props is stable across a save. */
const MemoTableOfContents = memo(TableOfContents)

interface EditorProps {
  /** Open root folder; fold state is persisted per root + file. */
  root: string
  path: string
  watch: WatchSource
  /** A folder's views open their row links through this (GRO-2135); App passes `openFile`. */
  onOpenFile: (path: string) => void
  /** A folder's Table/Board actions open a note in the window's right panel. */
  onOpenFileRight?: (path: string) => void
  /**
   * ⌘-click on an editor wiki link (Links C, GRO-2192) opens a background tab; App passes
   * the tabs API's `openBackground`. Absent → wiki-link clicks stay plain editing.
   */
  onOpenFileBackground?: (path: string) => void
  /**
   * A click on a link in the note (YAZ-3609 D11): where Settings › "Open a link in" says. Only the
   * note's `[[links]]` and Markdown links use it; a row of a folder view, a backlink and a code jump
   * open through `onOpenFile`. Absent → `onOpenFile`.
   */
  onOpenLink?: (path: string) => void
  /** ⌘-click on a link in the note: a background tab whose Back returns to the note (YAZ-3644). Absent → `onOpenFileBackground`. */
  onOpenLinkBackground?: (path: string) => void
  /** Wiki-link create failures surface here (passive link-notice style); App passes `notify`. A drawing's export says where its file landed. */
  onNotice?: (message: string, icon?: NoticeKind, type?: NoticeType) => void
  /**
   * Root-relative folder where a bare unresolved `[[link]]` creates its page (C2-, GRO-2240;
   * YAZ-1643): App passes a STABLE getter over the Files & Links setting (`newNoteBase`) that
   * takes the SOURCE page's path — this editor binds its own, so a right-panel editor or a
   * folder's outline creates beside itself, never beside the main tab. Absent → the vault root.
   */
  newNoteFolderFor?: (sourcePath: string) => string
  /** Wikilink resolve source (GRO-2190): App owns ONE per window, fed by WikilinkIndexBridge. */
  wikilinks: WikilinkResolveSource
  /** Separate navigation-only resolver for supported non-Markdown files. */
  viewOnlyLinks?: ViewOnlyLinkSource
  /** `[[` picker candidates (GRO-2191): same ownership and feed as `wikilinks`. */
  wikilinkCandidates?: WikilinkCandidateSource
  /** The vault's property declarations (YAZ-835), App-owned like `wikilinks`: typing rung 2 for a folder's views (YAZ-846). */
  properties?: PropertiesResponse | null
  /**
   * A title commit (⚡ YAZ-888, YAZ-2420 🔒 D16) goes to App's ONE rename door — the one the
   * sidebar's inline rename and drag-move reach, so the name-change confirm and every failure
   * notice come with it. A FOLDER's title (YAZ-2290 D9) says `dir`: the door counts and
   * rewrites links by kind. A table's Name cell commits through it too (🔒 D19).
   */
  onRetitle: (path: string, title: string, kind: 'file' | 'dir') => void
  /**
   * This vault's GitHub sync status (YAZ-1081 3A, 🔒 D5), App-owned like `wikilinks`: ONE
   * `useGithubSync` per window feeds every mounted tab. null while the first fetch is in
   * flight — and undefined for mounts with no sync at all — so the chip simply does not render.
   */
  sync?: GithubSyncStatus | null
  /** The chip's click (it IS the sync button); App passes `useGithubSync`'s `syncNow`. */
  onSyncNow?: () => void
  /** The comment stream's order (YAZ-1515): a setting threaded down like every other — the block never reads `storage` itself. */
  commentsOrder: CommentsOrder
  /** The block's own Oldest/Newest toggle writes the SETTING through this. */
  onChangeCommentsOrder: (order: CommentsOrder) => void
  /**
   * The table of contents setting (YAZ-2700), threaded down like the comments' order. Absent → `off`:
   * a mount that threads none of the six props below shows no table of contents.
   */
  tableOfContents?: TableOfContentsMode
  /** Settings › "Table of contents default" (YAZ-3558 D2): for a page that made no choice in its cog. Absent → the default, on (with `tableOfContents` absent, nothing shows anyway). */
  tocOnByDefault?: boolean
  /** The content width setting: with the note's own width it decides whether `auto` shows names or lines. Absent → `narrow`, the default. */
  contentWidth?: ContentWidth
  /** The table of contents' own "Pin" / "Unpin" write the SETTING through this. */
  onChangeTableOfContents?: (mode: TableOfContentsMode) => void
  /** The width setting of the table of contents' names column (YAZ-2752), px. Absent → `TOC_DEFAULT_W`. */
  tableOfContentsWidth?: number
  /** A drag of the names column's edge writes the SETTING through this, once, on its release. */
  onChangeTableOfContentsWidth?: (width: number) => void
  /** The vault's review settings (YAZ-2322): App owns the one `useReviewSettings`; the Reviews section computes its dates from them. */
  reviewSettings?: ReviewSettings
  /**
   * The user changed this note's text (YAZ-2648 D2): App keeps the preview tab that shows it. Said
   * when the note turns unsaved, so never for a change made outside the app. A main tab's editor
   * gets it; the right panel has no preview tab.
   */
  onUserEdit?: (path: string) => void
  /**
   * A copied page's start (YAZ-2951 D1): its source's drill-in, folds, scroll spot and text size.
   * Read at mount only; the scroll is applied once, when the first content lands (YAZ-2940 D7).
   */
  startView?: PageView
  /** A main tab's Back step (`step-<id>`, YAZ-3647 D1): a code tab keeps its cursor and scroll under it for Back (YAZ-3458). */
  viewKey?: string
  /** The main tab that shows this page (YAZ-3647 D2): the zoom callbacks name it. Absent: the right panel, a review. */
  tabId?: string
  /** The tab's zoom key (YAZ-3647 D2), null the whole page: the page starts there, and Back and Forward move it there. */
  zoomKey?: string | null
  /**
   * The page zoomed (YAZ-3647 D2): a Back step for tab `tabId`, unless `quiet` (the page started at that level). `label` is
   * the bullet's crumb text, for the Back list's menu and the tab's tooltip (E3, E4). Stable: App's one callback.
   */
  onZoom?: (tabId: string, zoom: string | null, quiet: boolean, label: string | null, from?: ZoomFrom) => void
  /**
   * "Open in new tab", ⌘- and ⇧-click on a bullet's dot or a crumb (YAZ-3646 D10, D11, YAZ-3647 E2): that level in a copy of
   * tab `tabId`; null is the whole page (the title crumb). Stable, as `onZoom`.
   */
  onOpenBullet?: (tabId: string, zoom: string | null, background: boolean, label: string | null) => void
  /** The canvas preferences every drawing shares (YAZ-3028, Draw's 🔒 YAZ-1775 D9): `SettingsState.canvas`. Absent → the defaults. */
  canvasPrefs?: CanvasPrefs
  /** A drawing's engine moved a pref: App writes the SETTING through this. */
  onChangeCanvasPrefs?: (next: CanvasPrefs) => void
  /** The drawing tab's canvas panel memory (YAZ-3038): `SettingsState.canvasPanel`, and App's door that writes it. */
  canvasPanel?: CanvasPanelState
  onChangeCanvasPanel?: (next: CanvasPanelState) => void
  /** How draw.io diagrams look in dark mode (YAZ-3028, Draw's 🔒 YAZ-1802 D16): `SettingsState.diagramDarkColors`. Absent → `adapt`. */
  diagramDarkColors?: DiagramDarkColors
  /** Settings › Code (YAZ-3449): the code tab's read only, wrap and minimap, one value for every code file, and App's door that writes them. */
  codeReadOnly?: boolean
  codeWrap?: boolean
  codeMinimap?: boolean
  onChangeCodeSettings?: (patch: CodeSettingsPatch) => void
  /** The code Outline's "…" menu (YAZ-3486): its sort and the kinds it hides, one value for every code file. */
  codeOutlineSort?: SettingsState['codeOutlineSort']
  codeOutlineHidden?: SettingsState['codeOutlineHidden']
  /** "…" › Show › "Variables inside functions" (YAZ-3507), one value for every code file. */
  codeOutlineLocals?: SettingsState['codeOutlineLocals']
  /** Settings › Preview on hover › Links in notes (YAZ-3403): resting on a resolved [[link]] shows the sidebar's panel beside it. */
  hoverLinks?: boolean
  /** Settings › Preview on hover › Linked mentions (YAZ-3403): resting on an entry shows the linking note beside the list. */
  hoverBacklinks?: boolean
  /** Settings › Preview on hover › Folder views (YAZ-3403): resting on a row or a card of a folder's view shows it beside the item. */
  hoverFolderViews?: boolean
  /** What a hover panel needs of a page's vault (YAZ-3403): App's `boardPreviewScope`. Absent → no hover panel here. */
  previewScope?: (path: string) => PreviewScope
  /** `settings.hotkeys` (YAZ-3564): the keys the user changed, for the editors that follow them. Absent → the defaults. */
  hotkeys?: HotkeyOverrides
  /** `settings.hotkeysAside` (YAZ-3564 K9): with a switch off, the drawing lets that App key go to the menu. */
  hotkeysAside?: HotkeyAside
}

export function Editor({ root, path, watch, onOpenFile, onOpenFileRight, onOpenFileBackground, onOpenLink, onOpenLinkBackground, onNotice, newNoteFolderFor, wikilinks, viewOnlyLinks, wikilinkCandidates, properties, onRetitle, sync, onSyncNow, commentsOrder, onChangeCommentsOrder, tableOfContents, tocOnByDefault, contentWidth, onChangeTableOfContents, tableOfContentsWidth, onChangeTableOfContentsWidth, reviewSettings, onUserEdit, startView, viewKey, tabId, zoomKey, onZoom, onOpenBullet, canvasPrefs, onChangeCanvasPrefs, canvasPanel, onChangeCanvasPanel, diagramDarkColors = 'adapt', codeReadOnly, codeWrap, codeMinimap, onChangeCodeSettings, codeOutlineSort, codeOutlineHidden, codeOutlineLocals, hoverLinks = false, hoverBacklinks = false, hoverFolderViews = false, previewScope, hotkeys, hotkeysAside }: EditorProps) {
  const inTree = useTreeKind(root, path)
  // Kept from the first render: App drops its copy once this layer is mounted, and `CrepeHost` mounts later, after the file read.
  const startViewRef = useRef(startView)
  // The folder itself is a tab (YAZ-2290 D3), and only the Files tree can say which path is one:
  // a folder may be named `Notes.md`. Until the tree for an in-root path is known, nothing is guessed.
  const inRoot = path.startsWith(`${root.replace(/\/+$/, '')}/`)
  if (inRoot) {
    if (inTree === null) return <section className="editor" />
    if (inTree === 'dir') {
      return (
        <section className="editor">
          <FolderView path={path} root={root} source={wikilinks} properties={properties} onOpenFile={onOpenFile} onOpenFileRight={onOpenFileRight} onOpenFileBackground={onOpenFileBackground} wikilinkCandidates={wikilinkCandidates} newNoteFolderFor={newNoteFolderFor} onNotice={onNotice} onRetitle={onRetitle} commentsOrder={commentsOrder} onChangeCommentsOrder={onChangeCommentsOrder} hoverPreview={hoverFolderViews} previewScope={previewScope} diagramDarkColors={diagramDarkColors} />
        </section>
      )
    }
  }
  const kind = fileKind(path)
  if (kind === 'text') {
    // The document host renders its own `section.editor editor--code`, as a board's does. The code
    // Outline (YAZ-3486) reads the note's table of contents setting and width.
    return (
      <Suspense fallback={<section className="editor" />}>
        <CodeEditor key={path} root={root} path={path} watch={watch} sync={sync} onSyncNow={onSyncNow} onNotice={onNotice} codeReadOnly={codeReadOnly} codeWrap={codeWrap} codeMinimap={codeMinimap} onChangeCodeSettings={onChangeCodeSettings} startView={startViewRef.current} onOpenFile={onOpenFile} viewKey={viewKey} tableOfContents={tableOfContents} tocOnByDefault={tocOnByDefault} onChangeTableOfContents={onChangeTableOfContents} tableOfContentsWidth={tableOfContentsWidth} onChangeTableOfContentsWidth={onChangeTableOfContentsWidth} codeOutlineSort={codeOutlineSort} codeOutlineHidden={codeOutlineHidden} codeOutlineLocals={codeOutlineLocals} />
      </Suspense>
    )
  }
  if (kind === 'pdf') {
    return (
      <section className="editor">
        <PdfViewer path={path} watch={watch} />
      </section>
    )
  }
  if (kind === 'image') {
    return (
      <section className="editor">
        <ImageViewer key={path} path={path} watch={watch} />
      </section>
    )
  }
  if (kind === 'drawing') {
    // The board host renders its own `section.editor editor--drawing` (the section the menu's board
    // commands are dispatched on), so nothing wraps it here.
    return (
      <Suspense fallback={<section className="editor" />}>
        <DrawingEditor key={path} root={root} path={path} watch={watch} sync={sync} onSyncNow={onSyncNow} canvasPrefs={canvasPrefs} onCanvasPrefsChange={onChangeCanvasPrefs} canvasPanel={canvasPanel} onCanvasPanelChange={onChangeCanvasPanel} onNotice={onNotice} hotkeys={hotkeys} hotkeysAside={hotkeysAside} />
      </Suspense>
    )
  }
  if (kind === 'diagram') {
    return (
      <Suspense fallback={<section className="editor" />}>
        <DrawioEditor key={path} root={root} path={path} watch={watch} sync={sync} onSyncNow={onSyncNow} darkColors={diagramDarkColors} onNotice={onNotice} />
      </Suspense>
    )
  }
  if (kind === null) {
    // A path the tree does not hold at all is a folder deleted outside the app: its tab stays open,
    // as a file's does, on the message a missing file gets (`useFile`).
    return (
      <section className="editor">
        <p className="editor-msg editor-msg--error">{inRoot && inTree === 'none' ? 'NOT_FOUND: path does not exist' : 'Unsupported file type.'}</p>
      </section>
    )
  }
  return <MarkdownEditor root={root} path={path} watch={watch} onOpenFile={onOpenFile} onOpenFileRight={onOpenFileRight} onOpenFileBackground={onOpenFileBackground} onOpenLink={onOpenLink} onOpenLinkBackground={onOpenLinkBackground} onNotice={onNotice} newNoteFolderFor={newNoteFolderFor} wikilinks={wikilinks} viewOnlyLinks={viewOnlyLinks} wikilinkCandidates={wikilinkCandidates} properties={properties} onRetitle={onRetitle} sync={sync} onSyncNow={onSyncNow} commentsOrder={commentsOrder} onChangeCommentsOrder={onChangeCommentsOrder} tableOfContents={tableOfContents} tocOnByDefault={tocOnByDefault} contentWidth={contentWidth} onChangeTableOfContents={onChangeTableOfContents} tableOfContentsWidth={tableOfContentsWidth} onChangeTableOfContentsWidth={onChangeTableOfContentsWidth} reviewSettings={reviewSettings} onUserEdit={onUserEdit} startView={startViewRef.current} tabId={tabId} zoomKey={zoomKey} onZoom={onZoom} onOpenBullet={onOpenBullet} diagramDarkColors={diagramDarkColors} hoverLinks={hoverLinks} hoverBacklinks={hoverBacklinks} previewScope={previewScope} hotkeys={hotkeys} hotkeysAside={hotkeysAside} />
}

/** Markdown-only owner: loading, Crepe, autosave, frontmatter, comments, and backlinks. */
function MarkdownEditor({ root, path, watch, onOpenFile, onOpenFileRight, onOpenFileBackground, onOpenLink, onOpenLinkBackground, onNotice, newNoteFolderFor, wikilinks, viewOnlyLinks, wikilinkCandidates, properties, onRetitle, sync, onSyncNow, commentsOrder, onChangeCommentsOrder, tableOfContents, tocOnByDefault, contentWidth, onChangeTableOfContents, tableOfContentsWidth, onChangeTableOfContentsWidth, reviewSettings, onUserEdit, startView, tabId, zoomKey, onZoom, onOpenBullet, diagramDarkColors = 'adapt', hoverLinks = false, hoverBacklinks = false, previewScope, hotkeys, hotkeysAside }: EditorProps) {
  const state = useFile(path)
  const titles = usePathTitles(wikilinks)
  const file = state.status === 'ready' ? state.file : state.status === 'loading' ? state.prev : null
  return (
    <section className="editor">
      {state.status === 'loading' && file === null && <p className="editor-msg">Loading…</p>}
      {state.status === 'error' && <p className="editor-msg editor-msg--error">{state.message}</p>}
      {file !== null && (
        <CrepeHost key={file.path} root={root} file={file} titles={titles} watch={watch} onOpenFile={onOpenFile} onOpenFileRight={onOpenFileRight} onOpenFileBackground={onOpenFileBackground} onOpenLink={onOpenLink} onOpenLinkBackground={onOpenLinkBackground} onNotice={onNotice} newNoteFolderFor={newNoteFolderFor} wikilinks={wikilinks} viewOnlyLinks={viewOnlyLinks} wikilinkCandidates={wikilinkCandidates} properties={properties} onRetitle={onRetitle} sync={sync} onSyncNow={onSyncNow} commentsOrder={commentsOrder} onChangeCommentsOrder={onChangeCommentsOrder} tableOfContents={tableOfContents} tocOnByDefault={tocOnByDefault} contentWidth={contentWidth} onChangeTableOfContents={onChangeTableOfContents} tableOfContentsWidth={tableOfContentsWidth} onChangeTableOfContentsWidth={onChangeTableOfContentsWidth} reviewSettings={reviewSettings} onUserEdit={onUserEdit} startView={startView} tabId={tabId} zoomKey={zoomKey} onZoom={onZoom} onOpenBullet={onOpenBullet} diagramDarkColors={diagramDarkColors} hoverLinks={hoverLinks} hoverBacklinks={hoverBacklinks} previewScope={previewScope} hotkeys={hotkeys} hotkeysAside={hotkeysAside} />
      )}
    </section>
  )
}

/** The setters of a mount that threads no table of contents setting: one identity, so the memoised table of contents never sees a new one. */
const noTableOfContentsChange = (): void => undefined

/** Mounts exactly one Crepe instance for `file`; remounted (via `key`) when the path changes. */
function CrepeHost({
  root,
  file,
  titles,
  watch,
  onOpenFile,
  onOpenFileRight,
  onOpenFileBackground,
  onOpenLink = onOpenFile,
  onOpenLinkBackground = onOpenFileBackground,
  onNotice,
  newNoteFolderFor,
  wikilinks,
  viewOnlyLinks,
  wikilinkCandidates,
  properties,
  onRetitle,
  sync,
  onSyncNow,
  commentsOrder,
  onChangeCommentsOrder,
  tableOfContents = 'off',
  tocOnByDefault = DEFAULT_SETTINGS.tocOnByDefault,
  contentWidth = 'narrow',
  onChangeTableOfContents = noTableOfContentsChange,
  tableOfContentsWidth = TOC_DEFAULT_W,
  onChangeTableOfContentsWidth = noTableOfContentsChange,
  reviewSettings,
  onUserEdit,
  startView,
  tabId,
  zoomKey,
  onZoom,
  onOpenBullet,
  diagramDarkColors,
  hoverLinks,
  hoverBacklinks,
  previewScope,
  hotkeys,
  hotkeysAside,
}: {
  root: string
  file: FileResponse
  titles: PathTitles
  watch: WatchSource
  onOpenFile: (path: string) => void
  onOpenFileRight?: (path: string) => void
  onOpenFileBackground?: (path: string) => void
  onOpenLink?: (path: string) => void
  onOpenLinkBackground?: (path: string) => void
  onNotice?: (message: string, icon?: NoticeKind, type?: NoticeType) => void
  newNoteFolderFor?: (sourcePath: string) => string
  wikilinks?: WikilinkResolveSource
  viewOnlyLinks?: ViewOnlyLinkSource
  wikilinkCandidates?: WikilinkCandidateSource
  properties?: PropertiesResponse | null
  onRetitle: (path: string, title: string, kind: 'file' | 'dir') => void
  sync?: GithubSyncStatus | null
  onSyncNow?: () => void
  commentsOrder: CommentsOrder
  onChangeCommentsOrder: (order: CommentsOrder) => void
  tableOfContents?: TableOfContentsMode
  tocOnByDefault?: boolean
  contentWidth?: ContentWidth
  onChangeTableOfContents?: (mode: TableOfContentsMode) => void
  tableOfContentsWidth?: number
  onChangeTableOfContentsWidth?: (width: number) => void
  reviewSettings?: ReviewSettings
  onUserEdit?: (path: string) => void
  startView?: PageView
  tabId?: string
  zoomKey?: string | null
  onZoom?: (tabId: string, zoom: string | null, quiet: boolean, label: string | null, from?: ZoomFrom) => void
  onOpenBullet?: (tabId: string, zoom: string | null, background: boolean, label: string | null) => void
  diagramDarkColors: DiagramDarkColors
  hoverLinks: boolean
  hoverBacklinks: boolean
  previewScope?: (path: string) => PreviewScope
  /** `settings.hotkeys` (YAZ-3564): an embedded drawing's keys as the user set them. */
  hotkeys?: HotkeyOverrides
  /** `settings.hotkeysAside` (YAZ-3564 K9): with a switch off, the drawing lets that App key go to the menu. */
  hotkeysAside?: HotkeyAside
}) {
  // A copied page starts at its source's text size (YAZ-2951 S5); after that it changes on its own.
  const [documentZoom, setDocumentZoom] = useState(startView?.magnification ?? 100)
  // Mirror for the ⌘ listener below, which is registered once (`[]`) and must read the live value.
  const documentZoomRef = useRef(documentZoom)
  documentZoomRef.current = documentZoom
  // Per page and never stored (YAZ-2643): it lives as long as this tab's editor does.
  const [lineNumbersOn, setLineNumbersOn] = useState(false)
  // Per page and saved with the note in the app state, on and off (YAZ-2709 D2): the page cog's "Section indent".
  const [sectionIndentOn, toggleSectionIndent] = usePageSwitch(root, file.path, storage.getSectionIndent, storage.setSectionIndent)
  // The same kind of switch (YAZ-2700): every heading of THIS page says its level. Per page, never stored.
  const [headingLevelsOn, setHeadingLevelsOn] = useState(false)
  // The table of contents follows Settings › "Table of contents default" until this page makes its own choice, which
  // wins, also over Off (YAZ-3558 D1). Saved with the note, as "Section indent" is (YAZ-2950, which replaces YAZ-2700 D15).
  const [tableOfContentsOn, toggleTableOfContents] = usePageSwitch(root, file.path, storage.getTocSwitch, storage.setTocSwitch, tocOnByDefault)
  // What this page's table of contents is built from (YAZ-2700 D14). Stored, as "Section indent"
  // above is: with the note in the app state, as its folds are, and `null` (Auto) is no entry.
  const [tocSource, setTocSource] = useState<TocSource | null>(() => storage.getTocSource(root, file.path))
  /** The folded rows of the table of contents (YAZ-3939 D1), as saved for this note when it mounted. */
  const [tocFolds] = useState(() => storage.getTocFolds(root, file.path))
  /** Stable: the table of contents is memoised. */
  const changeTocFolds = useCallback((keys: string[]) => storage.setTocFolds(root, file.path, keys), [root, file.path])
  const hostRef = useRef<HTMLDivElement>(null)
  // A copied page's start (YAZ-2940 D7, YAZ-2951 D1): a ref, so the create effect does not depend on it, and used once.
  const startViewRef = useRef(startView)
  // The hover panel of the note's [[links]] (YAZ-3403): the sidebar's own panel beside a resolved link. A hover's id is
  // its page: the plugin leaves one page before it hovers the next. The link's box is kept here; the dwell lives in the
  // panel's tiny store, so nothing of the note draws for it. The plugin is wired once, with the editor; the setting is
  // read live by the dwell.
  const linkAt = useRef<{ path: string; rect: AnchorRect } | null>(null)
  const linkPreview = useCardPreview(hoverLinks, (path) => (linkAt.current?.path === path ? linkAt.current.rect : null))
  const [linkHover] = useState<WikilinkHover>(() => ({
    onHover: (path, rect) => {
      linkAt.current = { path, rect }
      linkPreview.hoverCard(path, path)
    },
    onLeave: () => {
      if (linkAt.current !== null) linkPreview.leaveCard(linkAt.current.path)
      linkAt.current = null
    },
  }))
  const linkCard = (_: string, path: string): { root: string | null; name: string } => ({ root: null, name: pageLabel(path, false, titles) })
  // This note owns ⌘+ / ⌘− / ⌘0 while focus is anywhere inside its section — title, properties,
  // body, comments, the zoom pill (YAZ-1710). Same ladder as the pill; ⌘0 is 100%; a wall is a no-op.
  useEffect(() => {
    const section = hostRef.current?.closest('.editor')
    if (!section) return
    const onZoom = (event: Event) => {
      event.preventDefault()
      const step = (event as CustomEvent<ZoomStep>).detail
      changeZoom(step === 0 ? 100 : stepZoomByKey(documentZoomRef.current, step) ?? documentZoomRef.current)
    }
    section.addEventListener(ZOOM_EVENT, onZoom)
    return () => section.removeEventListener(ZOOM_EVENT, onZoom)
  }, [])
  // Zoom anchors on the caret (YAZ-1710 D11): the line being edited stays where it was on screen,
  // as in a design tool zooming around the cursor, so the eye never has to find it again. A caret
  // that was off screen (or none in this note) comes to the middle instead. The anchor is measured
  // BEFORE the zoom applies — every zoom change goes through `changeZoom` — and settled in a layout
  // effect after it. The scroller itself is unzoomed (D14), so screen px and `scrollTop` px agree.
  const caretAnchor = useRef<number | null>(null)
  const caretRect = (): DOMRect | null => {
    const section = hostRef.current?.closest('.editor')
    const selection = document.getSelection()
    const range = selection !== null && selection.rangeCount > 0 ? selection.getRangeAt(0) : null
    return section && range && section.contains(range.startContainer) ? range.getBoundingClientRect() : null
  }
  const changeZoom = (next: number) => {
    const scroller = hostRef.current?.closest('.editor-host')
    const rect = caretRect()
    const box = scroller?.getBoundingClientRect()
    const top = rect && box ? rect.top - box.top : null
    caretAnchor.current = top !== null && box && top >= 0 && top + rect!.height <= box.height ? top : null
    setDocumentZoom(next)
  }
  // Sideways slack (D15): the deepest bullet's indent at this zoom minus the same indent at 100% —
  // exactly the room needed to drag it back to where it would sit unzoomed. Re-measured when the
  // zoom changes and when the body grows or shrinks (typing a deeper bullet while zoomed).
  useEffect(() => {
    const scroller = hostRef.current?.closest<HTMLElement>('.editor-host')
    const body = hostRef.current?.querySelector('.ProseMirror')
    if (!scroller || !body) return
    const sync = () => {
      const zoom = documentZoomRef.current / 100
      // At 100% the slack is 0 by definition (deepest − deepest / 1): skip the per-bullet rect walk,
      // 5.7 ms per Enter on a 5k-line note (YAZ-2196).
      if (zoom === 1) {
        scroller.style.setProperty('--zoom-slack', '0px')
        return
      }
      const left = body.getBoundingClientRect().left
      let deepest = 0
      for (const el of body.querySelectorAll('.list-item > .children')) deepest = Math.max(deepest, el.getBoundingClientRect().left - left)
      scroller.style.setProperty('--zoom-slack', `${Math.round(deepest - deepest / zoom)}px`)
    }
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(body)
    return () => observer.disconnect()
  }, [documentZoom])

  useLayoutEffect(() => {
    const scroller = hostRef.current?.closest('.editor-host')
    const rect = caretRect()
    if (!scroller || !rect) return
    const box = scroller.getBoundingClientRect()
    // An off-screen caret comes to the middle: the caret itself, not its block. A block can be many
    // windows tall, and its middle is nowhere near the caret (YAZ-2691).
    const target = caretAnchor.current ?? (box.height - rect.height) / 2
    scroller.scrollTop += rect.top - box.top - target
  }, [documentZoom])
  // The live Crepe instance, for ArrowDown out of the title (⚡ YAZ-888) — the same
  // `focusEditor` the mount runs when the sidebar walk is not standing in the tree (YAZ-921),
  // so the caret lands where a click would put it.
  const crepeRef = useRef<ReturnType<typeof createCrepe> | null>(null)
  // The window's icons (YAZ-3609 D13), read when a link pill draws: a change of icon set needs no new editor.
  const iconsHere = useContext(IconsContext)
  const icons = useRef(iconsHere)
  icons.current = iconsHere
  // The window's vaults' picker rows (YAZ-3609 D14), read at a click or a paste: a vault added to the window needs no new editor.
  const vaultLinksHere = useContext(VaultLinksContext)
  const vaultLinks = useRef(vaultLinksHere)
  vaultLinks.current = vaultLinksHere
  const candidatesOf = (target: string) => vaultLinks.current?.candidatesOf(target) ?? null
  /**
   * The same instance, from the moment it can take an action (YAZ-2643): `crepeRef` is set BEFORE
   * `create()` settles, and an action on an editor that is not created yet throws. State, not a
   * ref, so the line-number effects run again when a recreated editor is ready. It is not cleared
   * when that editor goes: `crepeRef.current === readyCrepe` says whether it is still the live one.
   */
  const [readyCrepe, setReadyCrepe] = useState<ReturnType<typeof createCrepe> | null>(null)
  // The zoom breadcrumb's first crumb (YAZ-2420 🔒 D14), read as it draws: the Crepe below is made once.
  const titleRef = useRef('')
  titleRef.current = pageLabel(file.path, false, titles)
  // The tab's zoom level and its doors (YAZ-3647 D2, YAZ-3646 D10), read through refs too: the Crepe below is made once.
  const zoomKeyRef = useRef(zoomKey)
  zoomKeyRef.current = zoomKey
  const tabRef = useRef({ tabId, onZoom, onOpenBullet })
  tabRef.current = { tabId, onZoom, onOpenBullet }
  // A zoom of this page, to its tab (YAZ-3647 D2). A page with no tab (the right panel, a review) tells no one.
  // A quiet report names the key it replaces on this page (YAZ-3662 F6b): it may come after a Back, or as the page goes.
  const reportZoom = useCallback((zoom: string | null, quiet: boolean, label: string | null, from?: string | null) => {
    const { tabId: id, onZoom: tell } = tabRef.current
    if (id !== undefined) tell?.(id, zoom, quiet, label, from === undefined ? undefined : { path: file.path, key: from })
  }, [file.path])
  // The tab's key must match what the page shows (YAZ-3676 F3): after the page moved by itself (a start level, a
  // reload, a key Back could not find), the tab learns the real level quietly, as a change from `from`, the key it has.
  // The same level tells nothing, unless `always` (the mount report, which also teaches the bullet's label, E3).
  const tellRealZoom = useCallback((crepe: ReturnType<typeof createCrepe>, from: string | null, always = false) => {
    const now = getZoomKeyOf(crepe)
    if (always || now !== from) reportZoom(now, true, getZoomLabelOf(crepe), from)
  }, [reportZoom])
  const autosave = useAutosave(file.path)
  const { attach, markReloaded, reportConflict, absorbFrontmatterOnly, diskParts } = autosave
  // The user's own edit keeps a preview tab (YAZ-2648 D2), and the signal is the note turning
  // UNSAVED, never `onMarkdownUpdated`: that fires for a silent reload of an outside change too.
  // The autosave turns unsaved only when the editor's text differs from what it last read or
  // wrote, and a reload makes the reloaded text that baseline (`markReloaded`) before the listener
  // reports it — so an outside edit never says this. It costs nothing per keystroke: the effect
  // runs when the chip's status changes, once per save cycle. Outside the Crepe effect's deps, so
  // the callback's identity rebuilds no editor.
  const unsaved = autosave.status === 'unsaved'
  useEffect(() => {
    if (unsaved) onUserEdit?.(file.path)
  }, [unsaved, onUserEdit, file.path])
  const reloadRef = useRef<() => void>(() => {})
  /**
   * The whole-file bytes last seen on disk (YAZ-1356). `file.content` is frozen at mount — a fresh
   * `file` would remount Crepe — so the watcher path keeps THIS current and the frontmatter panel
   * follows it, exactly the "reloaded under us" case its snapshot was built for.
   */
  const [disk, setDisk] = useState(file.content)
  /** The disk-truth file both panels read: one identity per `disk`, so the memoised panels skip a save. */
  const diskFile = useMemo(() => ({ ...file, content: disk }), [file, disk])
  /**
   * The note's read-only switch (YAZ-3076 D1): `readonly: true` IN its frontmatter, so the disk truth
   * decides it — an agent's edit, another window's toggle or this one's all land through `disk`.
   * Parsed once per `disk`, never per keystroke or per save.
   */
  const readOnly = useMemo(() => isNoteReadOnly(disk), [disk])
  /** The chip's "Allow edits?" box is open (YAZ-3076 D4): this tab's own, and gone once read only is. */
  const [askingUnlock, setAskingUnlock] = useState(false)
  useEffect(() => {
    if (!readOnly) setAskingUnlock(false)
  }, [readOnly])
  /**
   * Counts the outside changes that landed in this editor (YAZ-2643): a reload, a frontmatter-only
   * absorb. `disk` cannot say it — it does not follow this editor's own saves, so a file put back
   * to the bytes `disk` still holds is no change to it.
   */
  const [diskLandings, diskLanded] = useReducer((count: number) => count + 1, 0)
  /**
   * The drawing wiring (YAZ-879), ONE per host: the preview plugin subscribes to this feed and the
   * modal pokes it on close after a save (YAZ-3528), so a scene written back re-renders every preview of it in this editor
   * without a remount. Stable identity — a new feed would silently orphan the subscription.
   */
  const drawingFeed = useMemo(() => createDrawingFeed(), [])
  /**
   * The CMD+F wiring (YAZ-968/969), ONE per host on the drawing feed's terms: the engine binds
   * itself to this channel at view creation and the bar below drives it. Stable identity — a new
   * channel would remount the editor and leave the bar talking to nothing.
   */
  const findChannel = useMemo(() => createFindChannel(), [])
  /**
   * The table of contents wiring (YAZ-2700), ONE per host on the same terms: the engine publishes
   * the note's rows (its headings or its bullets) to this channel and answers its jump and its
   * scroll spy; the table of contents below draws them. Stable identity, for the find channel's
   * reason.
   */
  const tocChannel = useMemo(() => {
    const channel = createTocChannel()
    // The saved source (the state above, as it was read at this mount) is in the channel BEFORE
    // the editor exists, so the engine's first scan is already by it: a note saved as Bullets
    // never shows its Auto list first.
    channel.setSource(tocSource)
    return channel
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- once per mount; a later choice goes through `changeTocSource`
  /** The reader chose in the cog: this page's state, the app state file, and the engine, which scans again at once. */
  const changeTocSource = (source: TocSource | null): void => {
    setTocSource(source)
    storage.setTocSource(root, file.path, source)
    tocChannel.setSource(source)
  }
  /** Esc in the table of contents hands the caret back to the note. Stable: the table of contents is memoised. */
  const focusNote = useCallback(() => {
    const crepe = crepeRef.current
    if (crepe !== null) focusEditor(crepe)
  }, [])
  /** The target whose modal is open; the preview's click sets it, close clears it. */
  const [openDrawing, setOpenDrawing] = useState<string | null>(null)
  /**
   * The lightbox's gallery (YAZ-1656): every image on the page and the one double-clicked; the
   * node view sets it, close clears it.
   */
  const [openImage, setOpenImage] = useState<{ images: GalleryImage[]; index: number } | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    // Own wrapper per instance so StrictMode's mount/unmount/mount never leaves two editors in the DOM.
    const el = document.createElement('div')
    el.className = 'editor-instance'
    host.appendChild(el)
    const { frontmatter, body } = splitFrontmatter(file.content)
    // A copied page starts with its source's LIVE folds (YAZ-2951 S2), never the ones another copy stored last.
    const start = startViewRef.current
    const startFolds = start?.folds ?? storage.getFolds(root, file.path)
    let bulletFoldKeys: readonly string[] = startFolds.filter((k) => !k.startsWith('h:'))
    let headingFoldKeys: readonly string[] = startFolds.filter((k) => k.startsWith('h:'))
    // One bucket, two writers (D3): each plugin reports its own keys; the union write means neither
    // can wipe the other's. Heading keys are 'h:'-prefixed by the plugin itself, so they can't collide.
    const writeFolds = () => storage.setFolds(root, file.path, [...bulletFoldKeys, ...headingFoldKeys])
    // Each plugin reports its keys once as the editor opens. From a page view that report is the
    // seed, not a change: it is not written until a fold changes in this copy (YAZ-2951 S10).
    let bulletSeedPending = start !== undefined
    let headingSeedPending = start !== undefined
    // Where this note's links and pasted paths are read from (YAZ-3609): its vault's `[[` picker rows, and the window's other vaults.
    const linkPlace = wikilinkCandidates === undefined ? undefined : { root, notePath: file.path, candidates: wikilinkCandidates, candidatesOf }
    const crepe = createCrepe({
      root: el,
      defaultValue: body,
      onMarkdownUpdated: (md) => controller?.update(md),
      folding: {
        seedCollapsedKeys: () => new Set(bulletFoldKeys),
        onCollapsedKeysChange: (keys) => {
          bulletFoldKeys = keys
          if (bulletSeedPending) {
            bulletSeedPending = false
            return
          }
          writeFolds()
        },
      },
      headingFolding: {
        seedCollapsedKeys: () => new Set(headingFoldKeys),
        onCollapsedKeysChange: (keys) => {
          headingFoldKeys = keys
          if (headingSeedPending) {
            headingSeedPending = false
            return
          }
          writeFolds()
        },
      },
      // The tab's level (YAZ-3647 D2): Back, a copy and a bullet's new tab start there, and each change goes to the tab.
      zoom: {
        title: () => titleRef.current,
        startKey: zoomKeyRef.current ?? start?.zoomKey,
        onZoom: reportZoom,
        onOpen: tabRef.current.onOpenBullet === undefined ? undefined : (zoom, behind, label) => {
          const { tabId: id, onOpenBullet: open } = tabRef.current
          if (id !== undefined) open?.(id, zoom, behind, label)
        },
      },
      // Stable per window (App-owned): index updates flow INSIDE the sources, never remounting us.
      wikilinks,
      viewOnlyLinks,
      wikilinkCandidates,
      // Wiki-link click navigation (Links C, GRO-2192): plain click → current tab, ⌘ → background
      // tab, unresolved → create (bare targets under `createFolder` — App's `newNoteFolderFor`
      // getter over the Files & Links location setting, C2- GRO-2240, bound to THIS file's path
      // so the page lands beside the editor the link was clicked in, YAZ-1643; absent → the
      // vault root) then open. Wired only when App threads the background opener — mounts
      // without it keep clicks as plain editing.
      wikilinkNav:
        onOpenLinkBackground === undefined
          ? undefined
          : { root, createFolder: () => newNoteFolderFor?.(file.path) ?? '', openCurrent: onOpenLink, openBackground: onOpenLinkBackground, onNotice: onNotice ?? (() => undefined) },
      // The hover panel of a resolved [[link]] (YAZ-3403): this note editor's alone, never a read-only preview's.
      // A Markdown link pill previews its page too (YAZ-3609 D20): its address resolves as a click resolves it.
      wikilinkHover: { ...linkHover, markdownPath: (href) => (linkPlace === undefined ? null : hrefTarget(href, linkPlace)) },
      linkLook: { icon: (target, folder) => fileIconDecoration(icons.current, target, folder) },
      // Standard Markdown links (YAZ-1309) leave through one typed host boundary. The active
      // note path travels with the untouched href so main—not the renderer—owns relative-file
      // resolution, protocol validation, and the choice of OS API.
      markdownLinkNav: {
        open: (href) => api.shell.openLink({ href, sourcePath: file.path }),
        // A link to a page or file of this vault opens in a tab, like a [[link]] (YAZ-3609 D8).
        inApp: (href) => (linkPlace === undefined ? null : hrefTarget(href, linkPlace)),
        openPath: (target, background) => (background ? onOpenLinkBackground ?? onOpenLink : onOpenLink)(target),
        // A link into a vault the app knows but this window does not show asks to add that vault (YAZ-3609 D21).
        elsewhere: (href, background) => {
          const target = hrefPath(href, file.path)
          return target !== null && (vaultLinks.current?.askToAdd(target, background) ?? false)
        },
        // A link into a vault of the window is a pill with its file's icon, like a [[link]] (YAZ-3609 D19).
        vaultPath: (href) => (linkPlace === undefined ? null : vaultHref(href, linkPlace)),
        icon: (target, folder) => fileIconDecoration(icons.current, target, folder),
        // A pill into another vault of the window names that vault after its text (YAZ-3609 D22).
        vaultTag: (target) => (rootOfPath([root], target) !== null ? null : (vaultLinks.current?.vaultOf(target) ?? null)),
        onNotice: onNotice ?? (() => undefined),
      },
      // Paste a path, get a link (YAZ-3609): this vault's `[[` picker rows spell it.
      pathPaste: linkPlace === undefined ? undefined : { ...linkPlace, onNotice },
      // The slash menu's Drawing row (YAZ-877): this window's root is the only thing the creator
      // needs; failures ride the same passive notice as a failed link create.
      drawing: { create: () => createDrawing(root), onNotice },
      // Drawing previews (YAZ-878): the root is all a preview needs — the embed's own target
      // carries the rest and `readAsset` resolves it. Both live wires are YAZ-879's: the feed
      // the modal pokes on close after a save, and the click that opens that modal.
      drawingPreview: { root, feed: drawingFeed, onOpenDrawing: setOpenDrawing },
      // First-class images (YAZ-1656): the root and THIS note's absolute path are what a relative
      // src resolves against (main's `app://vault/` protocol); double-click opens the lightbox
      // below, and a paste that could not be written rides the same passive notice.
      image: { root, notePath: file.path, onOpenImage: setOpenImage, onNotice },
      find: findChannel,
      toc: tocChannel,
      // A read-only note keeps its keyboard (YAZ-3125, YAZ-3127): this is a note editor, not a preview.
      readOnlyKeys: true,
      // The note keys as the user set them (YAZ-3564 K4): read as the note opens, so a change applies to the next one.
      hotkeys: storage.getSettings()?.hotkeys,
      // Without folded lines says what it left out (YAZ-3653); Settings › Notifications › "Copy, cut or paste" can turn it off.
      onCopyNotice: onNotice === undefined ? undefined : (text) => onNotice(text, 'copy', 'clipboard'),
    })
    crepeRef.current = crepe
    let controller: ReturnType<typeof attach> | null = null
    let cancelled = false
    let offPageView: (() => void) | null = null
    const ready = crepe.create().then(() => {
      if (cancelled) return
      controller = attach(() => getMarkdownForSave(crepe), file.mtime, frontmatter, body)
      setReadyCrepe(crepe)
      // An in-app rename carried another window's (or this window's) DIRTY buffer into this
      // path (Links E1, GRO-2194): apply it OVER the fresh disk baseline as an unsaved
      // change, so autosave writes it to the NEW path — the buffer survives the rename.
      const buf = takeRenameBuffer(file.path)
      if (buf !== null && buf.body !== body) {
        setMarkdown(crepe, buf.body)
        // A rebuilt state starts zoomed out: back to the tab's bullet, as a rebuild from disk does (E1). A rename keeps
        // its zoom (YAZ-3676 F3); a bullet the buffer does not have stays zoomed out, and the report below says so.
        const key = zoomKeyRef.current ?? start?.zoomKey ?? null
        if (key !== null) zoomPageTo(crepe, key)
        controller.update(getMarkdownForSave(crepe))
      }
      // A copy that starts drilled in (YAZ-2951 D1) has its caret in a hidden block: into the bullet
      // first, here, where every plugin view and `editorViewCtx` are ready, then the caret grab.
      // Its tab learns the level it really started at: the bullet may be gone, and then the page shows whole (YAZ-3647 D2).
      if (zoomKeyRef.current ?? start?.zoomKey) {
        moveCaretIntoZoom(crepe)
        tellRealZoom(crepe, zoomKeyRef.current ?? null, true)
      }
      // The mount's caret grab (⚡ YAZ-888) YIELDS to the sidebar walk (YAZ-921): a page opened
      // while focus stands on a tree row is a PREVIEW — stealing the caret would strand the
      // arrows mid-walk. It yields to a tab's name field too (YAZ-3059). Every other door (tabs,
      // wikilinks, boot) still lands in the text.
      const active = document.activeElement
      if (!(active instanceof HTMLElement && active.closest('.tree') !== null) && !namingTab(active)) focusEditor(crepe)
      // A copy starts where its source stood (YAZ-2940 D7) — after the caret grab, which may scroll,
      // and after the start drill-in, which the editor state already holds (YAZ-2951 S6).
      const scroller = hostRef.current?.closest('.editor-host')
      if (start !== undefined && scroller) scroller.scrollTop = start.scrollTop
      startViewRef.current = undefined
      // This tab's page view, read only when a copy action asks (YAZ-2951 D4): nothing runs per keystroke.
      if (scroller) {
        offPageView = registerPageView(scroller, () => ({
          scrollTop: scroller.scrollTop,
          zoomKey: getZoomKeyOf(crepe),
          folds: [...bulletFoldKeys, ...headingFoldKeys],
          magnification: documentZoomRef.current,
        }))
      }
    })

    // An external/AI edit lands as a DIFF over the live state (YAZ-1347), so folds, caret and
    // scroll ride ProseMirror's position mapping instead of being rebuilt from scratch. Only a
    // whole-document rewrite falls back to `setMarkdown`, whose key-based reseed is the better
    // answer once mapping has nothing left to map.
    const reload = async () => {
      const fresh = await api.readFile(file.path)
      if (cancelled) return
      const split = splitFrontmatter(fresh.content)
      applyExternalMarkdown(crepe, split.body)
      // A rebuild makes new plugin views, so the zoom's settle timer is gone: a bullet the rewrite removed is told here (YAZ-3676 F3).
      tellRealZoom(crepe, zoomKeyRef.current ?? null)
      markReloaded(() => getMarkdownForSave(crepe), fresh.mtime, split.frontmatter, split.body)
      setDisk(fresh.content)
      diskLanded()
    }
    reloadRef.current = () => void reload()

    // A change of this file on disk: from the watcher, or at once from a copy of this tab that
    // saved (YAZ-2940 D4, S23 — `twinEditors.ts`). The echo check skips this editor's own save.
    const onDiskChange = (mtime: number) => {
      if (controller === null) return
      const c = controller
      // On slow filesystems (e.g. NFS vaults) the watcher event for our own write can arrive
      // before the `writeFile` response carries the new mtime; settle the in-flight save first
      // so echo suppression compares against the mtime of the write that caused the event.
      void c.settled().then(async () => {
        if (cancelled) return
        if (mtime === c.mtime) return // echo of our own write
        // A base's property write (GRO-2141) rewrites only the frontmatter block; absorb it
        // silently so unsaved body edits and the caret survive (GRO-2186).
        const fresh = await api.readFile(file.path)
        if (cancelled) return
        if (absorbFrontmatterOnly(fresh.content, fresh.mtime)) {
          setDisk(fresh.content) // the body is untouched; the panel still has to see the new properties
          diskLanded()
          return
        }
        // The listener plugin debounces markdownUpdated by 200ms, so pull the live content
        // before deciding whether in-progress typing would be lost by a silent reload.
        c.update(getMarkdownForSave(crepe))
        if (c.dirty) reportConflict(mtime)
        else void reload()
      })
    }
    const unsubscribe = watch.subscribe((ev) => {
      if (ev.type === 'change' && ev.path === file.path) onDiskChange(ev.mtime)
    })
    const offTwin = onTwinSave(file.path, onDiskChange)

    return () => {
      cancelled = true
      crepeRef.current = null
      offPageView?.()
      unsubscribe()
      offTwin()
      void ready.then(() => crepe.destroy()).finally(() => el.remove())
    }
  }, [root, file, watch, attach, markReloaded, reportConflict, absorbFrontmatterOnly, wikilinks, viewOnlyLinks, wikilinkCandidates, onOpenFile, onOpenFileBackground, onOpenLink, onOpenLinkBackground, onNotice, newNoteFolderFor, drawingFeed, findChannel, tocChannel, linkHover, reportZoom, tellRealZoom])

  /**
   * The cog's "Read only" row and the chip's "Allow edits" (YAZ-3076 D1): pending typing saves first
   * (the pre-rewrite flush every editor on this path takes, S12), then `transformFile` writes the one
   * key against the fresh bytes. The bytes that landed are adopted at once — the chip shows without
   * waiting for the watcher, and the watcher's echo then carries this editor's mtime and is skipped:
   * one read and one write for each click (S17). A refusal is one passive notice; nothing changes.
   */
  const setReadOnly = useCallback(
    async (on: boolean): Promise<void> => {
      try {
        await flushRenamedPath(file.path)
        const landed = await transformFile(file.path, (content) => setNoteReadOnly(content, on))
        if (absorbFrontmatterOnly(landed.content, landed.mtime)) {
          setDisk(landed.content)
          diskLanded()
        }
      } catch (err) {
        onNotice?.(`Read only could not change: ${err instanceof Error ? err.message : String(err)}`, 'error')
      }
    },
    [file.path, absorbFrontmatterOnly, onNotice],
  )

  // Line numbers (YAZ-2643) count lines of the file ON DISK. So the gutter is rebuilt only when
  // the page and the disk agree: on turn-on, when a save settles, when an outside change lands.
  // A worker that fails shows one passive notice and is not asked again until the next of those three.
  // A vault that joins or leaves the window changes which links are pills (YAZ-3664), a renamed vault the "(Vault)"
  // on them (D22), and new file icons their icons (D13): draw them again, with no edit. Not on the first draw.
  const windowRoots = vaultLinksHere?.roots
  const windowNames = vaultLinksHere?.names
  const drawn = useRef<unknown[] | null>(null)
  useEffect(() => {
    if (readyCrepe === null || crepeRef.current !== readyCrepe) return
    const now = [readyCrepe, windowRoots, windowNames, iconsHere]
    const before = drawn.current
    drawn.current = now
    if (before === null || before[0] !== readyCrepe) return
    const view = readyCrepe.editor.ctx.get(editorViewCtx)
    if (before[1] !== windowRoots || before[2] !== windowNames || before[3] !== iconsHere) redrawLinkPills(view)
    if (before[3] !== iconsHere) redrawWikilinks(view)
  }, [readyCrepe, windowRoots, windowNames, iconsHere])
  useEffect(() => {
    const crepe = readyCrepe
    if (!lineNumbersOn || crepe === null || autosave.status !== 'saved') return
    let cancelled = false
    const { frontmatter, body } = diskParts()
    const { text, toFileLine } = fileLines(frontmatter, body)
    void requestBlockLines(text).then(
      ({ lines, ends, kinds }) => {
        if (!cancelled && crepeRef.current === crepe) showLineNumbers(crepe, { lines: lines.map(toFileLine), ends: ends.map(toFileLine), kinds })
      },
      () => {
        if (!cancelled) onNotice?.('Line numbers could not load.')
      },
    )
    return () => {
      cancelled = true
    }
  }, [lineNumbersOn, readyCrepe, autosave.status, diskLandings, diskParts, onNotice])
  // Back and Forward move a tab to a step's level (YAZ-3647 D2): the page follows its tab. The same level is no change.
  // A key that is no longer found shows the whole page, and the tab learns that, quietly (YAZ-3676 F3).
  useEffect(() => {
    if (readyCrepe === null || crepeRef.current !== readyCrepe || zoomKey === undefined) return
    zoomPageTo(readyCrepe, zoomKey)
    tellRealZoom(readyCrepe, zoomKey)
  }, [readyCrepe, zoomKey, tellRealZoom])
  // The fold-all button's chevrons (YAZ-3938 D9): it reads again after each fold change in this editor.
  const subscribeFolds = useCallback((changed: () => void) => {
    if (readyCrepe === null) return () => {}
    const dom = editorViewOf(readyCrepe).dom
    dom.addEventListener(FOLDS_CHANGED_EVENT, changed)
    return () => dom.removeEventListener(FOLDS_CHANGED_EVENT, changed)
  }, [readyCrepe])
  useEffect(() => {
    const crepe = readyCrepe
    if (!lineNumbersOn || crepe === null) return
    return () => {
      if (crepeRef.current === crepe) showLineNumbers(crepe, null)
    }
  }, [lineNumbersOn, readyCrepe])

  // Read only (YAZ-3076 D2): the body takes the disk truth's switch — typing, paste, drop, cut, undo,
  // the task boxes, the code blocks and the tables all ask `view.editable`. Find, copy, links, folds,
  // the table of contents, the zoom and line numbers are views and keep working (S25).
  // Said only while on, and taken back by the cleanup, as line numbers are: an editable note never pays for it.
  useEffect(() => {
    const crepe = readyCrepe
    if (!readOnly || crepe === null || crepeRef.current !== crepe) return
    crepe.setReadonly(true)
    return () => {
      if (crepeRef.current === crepe) crepe.setReadonly(false)
    }
  }, [readOnly, readyCrepe])

  // Section indent (YAZ-2709) reads only the page itself, so the editor is told once: when the
  // switch turns on, when a recreated editor is ready. An outside change that lands can rebuild
  // the whole editor state (`setMarkdown`), which starts off again, so each landing says it once
  // more. Off is said by the second effect, as line numbers do.
  useEffect(() => {
    const crepe = readyCrepe
    if (sectionIndentOn && crepe !== null && crepeRef.current === crepe) showSectionIndent(crepe, true)
  }, [sectionIndentOn, readyCrepe, diskLandings])
  useEffect(() => {
    const crepe = readyCrepe
    if (!sectionIndentOn || crepe === null) return
    return () => {
      if (crepeRef.current === crepe) showSectionIndent(crepe, false)
    }
  }, [sectionIndentOn, readyCrepe])

  return (
    <>
      {/* Document zoom stays local to this mounted editor; sync remains vault-wide. */}
      <div className="status-chips">
        {/* Collapse all / Expand all (YAZ-3938 D1): the ⌘⇧U / ⌘⇧I command, left of the cog. */}
        <FoldAllButton
          read={() => (readyCrepe !== null && crepeRef.current === readyCrepe ? nextDocumentFold(editorViewOf(readyCrepe).state) : 'none')}
          run={(collapse) => {
            if (readyCrepe === null || crepeRef.current !== readyCrepe) return
            const view = editorViewOf(readyCrepe)
            setAllDocumentFolds(collapse)(view.state, view.dispatch)
            focusEditor(readyCrepe)
          }}
          subscribe={subscribeFolds}
          keys={{ collapse: 'note.foldAll', expand: 'note.unfoldAll' }}
        />
        <PageSettings readOnly={readOnly} onToggleReadOnly={() => (readOnly ? setAskingUnlock(true) : void setReadOnly(true))} lineNumbers={lineNumbersOn} onToggleLineNumbers={() => setLineNumbersOn((on) => !on)} sectionIndent={sectionIndentOn} onToggleSectionIndent={toggleSectionIndent} headingLevels={headingLevelsOn} onToggleHeadingLevels={() => setHeadingLevelsOn((on) => !on)} tableOfContents={tableOfContentsOn} onToggleTableOfContents={toggleTableOfContents} tocSource={tocSource} onChangeTocSource={tableOfContentsOn ? changeTocSource : undefined} readText={() => (readyCrepe !== null && crepeRef.current === readyCrepe ? getPlainText(readyCrepe) : '')} />
        <DocumentZoom value={documentZoom} onChange={changeZoom} />
        {readOnly && <ReadOnlyChip asking={askingUnlock} onAsk={() => setAskingUnlock(true)} onAllow={() => { setAskingUnlock(false); void setReadOnly(false) }} onCancel={() => setAskingUnlock(false)} />}
        {sync != null && onSyncNow !== undefined && <SyncIndicator status={sync} onSyncNow={onSyncNow} />}
        <SaveIndicator status={autosave.status} />
      </div>
      {autosave.conflictMtime !== null && (
        <div className="conflict-bar" role="alert">
          <span>File changed on disk.</span>
          <button type="button" onClick={() => reloadRef.current()}>
            Reload
          </button>
          <button type="button" onClick={autosave.keepMine}>
            Keep mine
          </button>
        </div>
      )}
      {/* The scroller holds SIX stacked blocks, in this order. Block ZERO is the page title
          (⚡ YAZ-888) — the file's own name, React-side and never a ProseMirror node; block ONE is
          the properties panel (⚡ YAZ-883), the note's frontmatter as raw YAML; then the Crepe
          mount; then three blocks of the note's own: the comment stream (YAZ-1472, 🔒 D4 — always
          there, the composer being the door to the first comment), then "Linked mentions"
          (Links D, GRO-2193), then "Reviews" (YAZ-2322), which stays last. All of it scrolls WITH
          the note, never in a panel. */}
      <div className="editor-host" data-page="note" data-read-only={readOnly || undefined} data-line-numbers={lineNumbersOn || undefined} data-section-indent={sectionIndentOn || undefined} data-heading-levels={headingLevelsOn || undefined} style={{ '--document-zoom': documentZoom / 100 } as CSSProperties}>
        {/* Title and properties share ONE header row (YAZ-918): the panel sits to
            the title's right and wraps under it when the title runs long. */}
        <div className="page-header">
          <PageTitle
            path={file.path}
            titles={titles}
            readOnly={readOnly}
            onRetitle={(title) => onRetitle(file.path, title, 'file')}
            onArrowDown={() => {
              const crepe = crepeRef.current
              if (crepe !== null) focusEditor(crepe)
            }}
          />
          {/* Typed rows (⚡ YAZ-884) read the vault-wide declarations App also threads to the
              folder view — ONE registry, so a type declared in a row types the same column in
              every folder's views. */}
          <MemoFrontmatterPanel file={diskFile} root={root} properties={properties} wikilinks={wikilinks} readOnly={readOnly} />
        </div>
        <div className="editor-mount" ref={hostRef} />
        {/* Reads the same disk truth the properties panel does (🔒 D4): its own frontmatter-only
            writes come back through the watcher as `absorbFrontmatterOnly` → `setDisk`. */}
        <MemoCommentsSection file={diskFile} order={commentsOrder} onChangeOrder={onChangeCommentsOrder} />
        {wikilinks !== undefined && (
          <MemoBacklinksSection path={file.path} source={wikilinks} openCurrent={onOpenFile} openBackground={onOpenFileBackground} hoverPreview={hoverBacklinks} previewScope={previewScope} diagramDarkColors={diagramDarkColors} />
        )}
        {/* The log from the disk truth, the date from the index record: renders nothing until it has the settings and the record. */}
        <MemoReviewsSection file={diskFile} source={wikilinks} settings={reviewSettings} />
      </div>
      {/* CMD+F (YAZ-969) floats OVER that scroller rather than in it: `section.editor` is the
          positioned ancestor, so the bar holds its corner while the note scrolls under it. */}
      <FindBar channel={findChannel} scope="note" hostRef={hostRef} />
      {/* The note's own right-click menu (YAZ-3653), in the look of the tab and sidebar menus. */}
      <NoteMenu view={readyCrepe !== null && crepeRef.current === readyCrepe ? editorViewOf(readyCrepe) : null} />
      <CardPreviewHost store={linkPreview.store} cardOf={linkCard} scopeOf={previewScope} diagramDarkColors={diagramDarkColors} />
      {/* The table of contents (YAZ-2700) floats beside that scroller the same way: at the
          section's right edge, from the scroller's top to its bottom. It draws nothing for a note
          with fewer than two rows (its headings or its bullets), while this page shows none (its
          choice, else "Table of contents default", YAZ-3558), and while a bullet is zoomed. */}
      <MemoTableOfContents channel={tocChannel} mode={tableOfContentsOn ? tableOfContents : 'off'} contentWidth={contentWidth} onChangeMode={onChangeTableOfContents} width={tableOfContentsWidth} onChangeWidth={onChangeTableOfContentsWidth} hostRef={hostRef} onReturnFocus={focusNote} folds={tocFolds} onChangeFolds={changeTocFolds} />
      {/* The drawing editor (YAZ-879) — a MODAL over the window, never a node view inside the
          note. Keyed by target so reopening a different drawing is a fresh canvas, and the
          appearance is App's already-resolved one, read once (`appliedTheme`). */}
      {openDrawing !== null && (
        <DrawingModal key={openDrawing} root={root} target={openDrawing} theme={appliedTheme()} feed={drawingFeed} onClose={() => setOpenDrawing(null)} hotkeys={hotkeys} hotkeysAside={hotkeysAside} />
      )}
      {/* The image lightbox (YAZ-1656) — the same modal-beside-the-editor shape as the drawing
          modal, opened by the node view's double-click with the whole gallery (every image on
          the page, resolved srcs) and the index of the one clicked. */}
      {openImage !== null && (
        // Keyed on the clicked image so a reopen remounts with a fresh cursor.
        <ImageModal key={openImage.images[openImage.index].src} images={openImage.images} index={openImage.index} onClose={() => setOpenImage(null)} />
      )}
    </>
  )
}
