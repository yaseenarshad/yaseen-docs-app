import { useUnit } from '../vault/unitWord'
import { lazy, memo, Suspense, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import { DEFAULT_SETTINGS, folderSettingsPath, rootOfPath, TOC_DEFAULT_W, type CanvasPanelState, type CanvasPrefs, type CommentsOrder, type DiagramDarkColors, type ContentWidth, type FileResponse, type GithubSyncStatus, type OutsideChangeGlow, type FindFolds, type PageView, type PropertiesResponse, type SettingsState, type TableOfContents as TableOfContentsMode, type TocSource } from '@shared/types'
import { fileKind } from '@shared/fileKind'
import type { HotkeyOverrides } from '@shared/hotkeyBindings'
import type { GestureAction, HotkeyAside } from '@shared/keys'
import { api } from '../api'
import { CommentsSection } from '../comments/CommentsSection'
import { createBoardForNote } from '../drawings/createDrawing'
import { DrawingModal } from '../drawings/DrawingModal'
import type { DrawingAppSettings } from '../drawings/ExcalidrawSurface'
import { ImageModal } from './image/ImageModal'
import type { GalleryImage } from './image/imageOptions'
import { FolderView } from '../views/FolderView'
import { FolderPageChips, type FolderPageTab } from '../views/FolderToolbar'
import { hrefPath, hrefTarget, vaultHref } from './pathPaste'
import { placeRows, type LinkActions } from './linkMenu'
import { redrawLinkPills } from './markdownLink'
import { editorViewCtx } from '@milkdown/kit/core'
import { takeNoteId } from '../views/scaffold'
import { createCrepe, editorViewOf, focusEditor, getCaretOf, getMarkdownForSave, getPlainText, getZoomKeyOf, getZoomLabelOf, moveCaretIntoZoom, placeCaret, setMarkdown, zoomPageTo } from './createCrepe'
import { applyExternalMarkdown } from './external/applyExternalMarkdown'
import { mergeExternalMarkdown } from './external/mergeExternal'
import { FindBar } from './find/FindBar'
import { createFindChannel } from './find/findChannel'
import { createOutsideChangesChannel } from './external/outsideChangesChannel'
import { readOutsideChanges, saveOutsideChanges } from './external/outsideChangesMemory'
import { OutsideChangesBar } from './external/OutsideChangesBar'
import { OutsideChangesList } from './external/OutsideChangesList'
import { TableOfContents } from './toc/TableOfContents'
import { createTocChannel } from './toc/tocChannel'
import { FrontmatterPanel } from './FrontmatterPanel'
import { PageTitle } from './PageTitle'
import { useNoteId } from '../search/showIds'
import type { WikilinkCandidateSource } from './wikilink/wikilinkPicker'
import { redrawWikilinks, type WikilinkResolveSource } from './wikilink/wikilinkPlugin'
import type { ViewOnlyLinkSource } from './wikilink/viewOnlyLinkSource'
import type { WikilinkHover } from './wikilink/wikilinkHover'
import { linkOpenHint } from './linkGesture'
import './outline/outlineFolding.css'
import './outline/headingFolding.css'
import './outline/foldLock.css'
import './outline/headingLevelTag.css'
import './outline/bullets.css'
import './outline/zoom.css'
import './outline/guideLines.css'
import './outline/bulletThreading.css'
import './outline/sectionIndent.css'
import './softBreaks.css'
import { splitFrontmatter } from '@shared/frontmatter'
import { CODE_WIDTH_KEY, noteBlockWidth, noteFindFolds, noteOutsideGlow, notePageSwitches, setNoteBlockWidth, setNoteFindFolds, setNoteOutsideGlow, setNotePageSwitch, TABLE_WIDTH_KEY, type PageSwitchKey } from '@shared/pageSwitches'
import { watchBlockRoom } from './blockRoom'
import { undo } from '@milkdown/kit/prose/history'
import { CODE_WIDTH_DRAGGED, codeBlockCount, codeWidthsToNote, type CodeWidthDragged } from './code/codeWidth'
import { VIEW_ONLY_CHANGE } from './readOnlyEdit'
import { isNoteReadOnly, setNoteReadOnly } from '@shared/readOnly'
import { stepZoomByKey } from './DocumentZoom'
import { FoldAllButton } from './FoldAllButton'
import { FOLDS_CHANGED_EVENT, nextDocumentFold, setAllDocumentFolds } from './outline/foldAllHotkeys'
import { FOLDING_OFF_NOTICE, showFolding } from './outline/foldingSwitch'
import { FOLD_LOCKED_NOTICE } from './outline/foldLock'
import { PageSettings } from './PageSettings'
import { StatusChips } from './StatusChips'
import { useTimedUnlock } from './useTimedUnlock'
import { NO_VAULT_READ_ONLY, VaultReadOnly, type VaultReadOnlyScope } from '../vault/readOnlyVault'
import { NoteMenu } from './noteMenu'
import { ZOOM_EVENT } from './zoomRequest'
import { onGoToNowRequest, takeGoToNow } from './table/goToNowRequest'
import { openCellNoteByLabel } from './table/cellNoteCard'
import { onCellNoteRequest, takeCellNoteRequest } from './table/cellNoteRequest'
import { goToNow } from './table/tableCalendar'
import { fileLines } from './lineNumbers/fileLines'
import { requestBlockLines, showLineNumbers } from './lineNumbers/lineNumbers'
import { showSectionIndent } from './outline/sectionIndent'
import type { FolderPagesSettings, ZoomStep } from '@shared/types'
import type { ZoomFrom } from '../workspace/useWorkspace'
import type { CodeSettingsPatch } from '../code/codeSettings'
import { useAutosave } from '../hooks/useAutosave'
import { useFile } from '../hooks/useFile'
import type { WatchSource } from '../hooks/useWatch'
import { BacklinksSection } from '../links/BacklinksSection'
import { isVaultRoot, pageLabel, usePathTitles, useTreeKind, type PathTitles } from '../lib/pageLabel'
import { namingTab } from '../lib/focusHandoff'
import { flushRenamedPath, takeRenameBuffer } from '../lib/renameContinuity'
import { isAnnouncedWrite, onTwinSave } from '../lib/twinEditors'
import { registerPageView } from '../lib/pageView'
import { appliedTheme } from '../lib/theme'
import { storage } from '../lib/storage'
import { transformFile } from '../views/writeProperty'
import { PdfViewer } from '../viewers/PdfViewer'
import { ImageViewer } from '../viewers/ImageViewer'
import type { Notice, NoticeKind, NoticeType } from '../lib/notice'
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
/** Up to 200 names (YAZ-2700): the same reason, and every one of its props is stable across a save. */
const MemoTableOfContents = memo(TableOfContents)

/** The user's key and click changes as they are now (YAZ-3936): a click on a link or a bullet dot reads its gesture then. */
const hotkeysNow = (): HotkeyOverrides | undefined => storage.getSettings()?.hotkeys

interface EditorProps {
  /** Open root folder; fold state is persisted per root + file. */
  root: string
  path: string
  watch: WatchSource
  /** A folder's views open their row links through this (GRO-2135); App passes `openFile`. */
  onOpenFile: (path: string) => void
  /** A folder's Table/Board actions open a note in the window's right panel. */
  onOpenFileRight?: (path: string) => void
  /** A folder page's Folder chips and ↗ open a subfolder's page in a new tab (YAZ-4564): App's `openKeptPage`. Only a folder page uses it. */
  onOpenFolderPage?: (path: string) => void
  /** The mini window's ↗ opens its note in a new tab (YAZ-3746 13I): App's `openNewTabPage`. Only a folder page uses it. */
  onOpenFileNewTab?: (path: string) => void
  /** A folder's table opens a row in a window with this editor (YAZ-4547): App's, stable. Only a folder page uses it. */
  renderNoteEditor?: (path: string) => ReactNode
  /** A folder table's "Delete note…" (YAZ-4592 S26): App's `trashMany`, the sidebar's delete. Only a folder page uses it. */
  onDeleteEntries?: (paths: readonly string[], asked?: boolean) => Promise<void>
  /**
   * ⌘-click on an editor wiki link (Links C, GRO-2192) opens a background tab; App passes
   * the tabs API's `openBackground`. Absent → wiki-link clicks stay plain editing.
   */
  onOpenFileBackground?: (path: string) => void
  /**
   * An open gesture on a link in the note (YAZ-3936): `where` its action says, this tab or a new tab. Only the note's
   * `[[links]]` and Markdown links use it; a row of a folder view, a backlink and a code jump open through
   * `onOpenFile`. Absent → `onOpenFile`.
   */
  onOpenLink?: (path: string, where?: GestureAction) => void
  /** "Open in a background tab" on a link in the note: a background tab whose Back returns to the note (YAZ-3644). Absent → `onOpenFileBackground`. */
  onOpenLinkBackground?: (path: string) => void
  /** "Open in Explore" on a note pill (YAZ-4936): App's `openExploreOn`, a reading layer. Absent → no row. */
  onOpenExplore?: (path: string) => void
  /** This vault's "Clicking a link" (YAZ-4936), read at each click: a plain click on a note pill opens it in Explore. */
  exploreOnClick?: () => boolean
  /** This vault's "Show IDs in the title" (YAZ-4940): the note's ID after its title, drawn off the index. Absent = off. */
  idInTitle?: boolean
  /** This vault's Read only (YAZ-4939): every page this editor draws opens read only, with a timed "Allow edits". Absent = off. */
  vaultReadOnly?: boolean
  /** The door a file action of a read-only vault asks through (YAZ-4939): App's sheet, true = go on. Absent = always. */
  onFileAction?: (root: string) => Promise<boolean>
  /**
   * The link menu's place rows (YAZ-3740): Show in sidebar, Focus and Favorites, "Open in ▸" — App's one object for
   * the window's life (a new one makes a new Crepe). Absent → no such rows.
   */
  linkActions?: LinkActions
  /** Wiki-link create failures surface here (passive link-notice style); App passes `notify`. A drawing's export says where its file landed. A folder view's move adds its Undo (YAZ-4541 S6). */
  onNotice?: (message: string, icon?: NoticeKind, type?: NoticeType, action?: Notice['action']) => void
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
  /** Settings › "Guide lines default" (YAZ-4094 D2): for a page that made no choice in its cog. Absent → on. */
  guideLinesOnByDefault?: boolean
  /** Settings › "Folding default" (YAZ-4094 F1): for a page that made no choice in its cog. Absent → on. */
  foldingOnByDefault?: boolean
  /** Settings › "Bullet threading default" (YAZ-4432): for a page that made no choice in its cog. Absent → off. */
  bulletThreadingOnByDefault?: boolean
  /** The content width setting: with the note's own width it decides whether `auto` shows names or lines. Absent → `narrow`, the default. */
  contentWidth?: ContentWidth
  /** The table of contents' own "Pin" / "Unpin" write the SETTING through this. */
  onChangeTableOfContents?: (mode: TableOfContentsMode) => void
  /** The width setting of the table of contents' names column (YAZ-2752), px. Absent → `TOC_DEFAULT_W`. */
  tableOfContentsWidth?: number
  /** A drag of the names column's edge writes the SETTING through this, once, on its release. */
  onChangeTableOfContentsWidth?: (width: number) => void
  /** The zoom of the table of contents (YAZ-3939 D9), percent. Absent → 100. */
  tocZoom?: number
  /** Its − and +, and ⌘+ / ⌘− / ⌘0 over it, write the SETTING through this. */
  onChangeTocZoom?: (percent: number) => void
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
  /** A board's link pills (YAZ-3943): their own "Preview on hover" row, "Links in drawings and diagrams". */
  hoverDrawingLinks?: boolean
  /** Settings › Preview on hover › Linked mentions (YAZ-3403): resting on an entry shows the linking note beside the list. */
  hoverBacklinks?: boolean
  /** Settings › Folder pages › Preview rows on hover (YAZ-3403): resting on a row or a card of a folder's view shows it beside the item. */
  hoverFolderViews?: boolean
  /** Settings › Folder pages › Preview links on hover (demo 13D): resting on a link pill in a cell shows the linked note. */
  hoverFolderLinks?: boolean
  /** Settings › Folder pages (YAZ-4585, D34): handed to a folder page's `ViewsPane`. */
  folderPages?: FolderPagesSettings
  /** What a hover panel needs of a page's vault (YAZ-3403): App's `boardPreviewScope`. Absent → no hover panel here. */
  previewScope?: (path: string) => PreviewScope
  /** `settings.hotkeys` (YAZ-3564): the keys the user changed, for the editors that follow them. Absent → the defaults. */
  hotkeys?: HotkeyOverrides
  /** `settings.hotkeysAside` (YAZ-3564 K9): with a switch off, the drawing lets that App key go to the menu. */
  hotkeysAside?: HotkeyAside
  /** Settings › Editor › Outside changes › Glow (YAZ-3704 D5): `settings.outsideChangeGlow`. Absent → until checked. */
  outsideChangeGlow?: SettingsState['outsideChangeGlow']
  /** Settings › Editor › Find › Folded bullets (YAZ-4787): `settings.findFolds`. A note's `find-folds` key wins. Absent → the one you are on. */
  findFolds?: SettingsState['findFolds']
  /** Settings › Editor › Outside changes › Pin default: `settings.outsideListPinned`. Absent → not pinned (the dropdown), as the table of contents. */
  outsideListPinned?: boolean
  /** The list's Pin and Unpin write the setting through this. */
  onChangeOutsideListPinned?: (pinned: boolean) => void
}

/** The vault's Read only (YAZ-4939) reaches every page the editor draws — a note, a board, a code tab, a folder page and its cells — through one context. */
export function Editor(props: EditorProps) {
  const { vaultReadOnly = false, onFileAction } = props
  const vault = useMemo((): VaultReadOnlyScope => ({ on: vaultReadOnly, allowFileAction: onFileAction ?? NO_VAULT_READ_ONLY.allowFileAction }), [vaultReadOnly, onFileAction])
  return (
    <VaultReadOnly.Provider value={vault}>
      <EditorBody {...props} />
    </VaultReadOnly.Provider>
  )
}

function EditorBody({ root, path, watch, onOpenFile, onOpenFileRight, onOpenFolderPage, onOpenFileNewTab, renderNoteEditor, onDeleteEntries, onOpenFileBackground, onOpenLink, onOpenLinkBackground, onOpenExplore, exploreOnClick, idInTitle, linkActions, onNotice, newNoteFolderFor, wikilinks, viewOnlyLinks, wikilinkCandidates, properties, onRetitle, sync, onSyncNow, commentsOrder, onChangeCommentsOrder, tableOfContents, tocOnByDefault, guideLinesOnByDefault, foldingOnByDefault, bulletThreadingOnByDefault, contentWidth, onChangeTableOfContents, tableOfContentsWidth, onChangeTableOfContentsWidth, tocZoom, onChangeTocZoom, onUserEdit, startView, viewKey, tabId, zoomKey, onZoom, onOpenBullet, canvasPrefs, onChangeCanvasPrefs, canvasPanel, onChangeCanvasPanel, diagramDarkColors = 'adapt', codeReadOnly, codeWrap, codeMinimap, onChangeCodeSettings, codeOutlineSort, codeOutlineHidden, codeOutlineLocals, hoverLinks = false, hoverDrawingLinks = false, hoverBacklinks = false, hoverFolderViews = false, hoverFolderLinks = false, folderPages, previewScope, hotkeys, hotkeysAside, outsideChangeGlow, findFolds, outsideListPinned, onChangeOutsideListPinned }: EditorProps) {
  const inTree = useTreeKind(root, path)
  // Kept from the first render: App drops its copy once this layer is mounted, and `CrepeHost` mounts later, after the file read.
  const startViewRef = useRef(startView)
  // YAZ-4436: the drawing settings, built once for a drawing tab and for a note's drawing popup, so they cannot drift
  const drawingSettings: DrawingAppSettings = { canvasPrefs, onCanvasPrefsChange: onChangeCanvasPrefs }
  // The folder itself is a tab (YAZ-2290 D3), and only the Files tree can say which path is one:
  // a folder may be named `Notes.md`. Until the tree for an in-root path is known, nothing is guessed.
  // The vault root is a folder too (YAZ-4921): its page lists the whole vault, and `useTreeKind` answers for it at once.
  const inRoot = path.startsWith(`${root.replace(/\/+$/, '')}/`) || isVaultRoot(root, path)
  if (inRoot) {
    if (inTree === null) return <section className="editor" />
    if (inTree === 'dir') {
      // The Page tab (YAZ-4584 D38): the note editor on the folder's `.folder.md`, with this tab's link, sync and page
      // props. No Back steps (`tabId`, `zoomKey`, `onZoom`) and no start view: those are the folder tab's.
      const renderPage = () => (
        <MarkdownEditor inFolderPage drawingSettings={drawingSettings} root={root} path={folderSettingsPath(path)} watch={watch} onOpenFile={onOpenFile} onOpenFileRight={onOpenFileRight} onOpenFileBackground={onOpenFileBackground} onOpenLink={onOpenLink} onOpenLinkBackground={onOpenLinkBackground} onOpenExplore={onOpenExplore} exploreOnClick={exploreOnClick} idInTitle={idInTitle} linkActions={linkActions} onNotice={onNotice} newNoteFolderFor={newNoteFolderFor} wikilinks={wikilinks} viewOnlyLinks={viewOnlyLinks} wikilinkCandidates={wikilinkCandidates} properties={properties} onRetitle={onRetitle} sync={sync} onSyncNow={onSyncNow} commentsOrder={commentsOrder} onChangeCommentsOrder={onChangeCommentsOrder} tableOfContents={tableOfContents} tocOnByDefault={tocOnByDefault} guideLinesOnByDefault={guideLinesOnByDefault} foldingOnByDefault={foldingOnByDefault} bulletThreadingOnByDefault={bulletThreadingOnByDefault} contentWidth={contentWidth} onChangeTableOfContents={onChangeTableOfContents} tableOfContentsWidth={tableOfContentsWidth} onChangeTableOfContentsWidth={onChangeTableOfContentsWidth} tocZoom={tocZoom} onChangeTocZoom={onChangeTocZoom} diagramDarkColors={diagramDarkColors} hoverLinks={hoverLinks} hoverDrawingLinks={hoverDrawingLinks} hoverBacklinks={hoverBacklinks} folderPages={folderPages} previewScope={previewScope} hotkeys={hotkeys} hotkeysAside={hotkeysAside} outsideChangeGlow={outsideChangeGlow} findFolds={findFolds} outsideListPinned={outsideListPinned} onChangeOutsideListPinned={onChangeOutsideListPinned} />
      )
      return (
        <section className="editor">
          <FolderView path={path} root={root} source={wikilinks} properties={properties} onOpenFile={onOpenFile} onOpenFileRight={onOpenFileRight} onOpenFileBackground={onOpenFileBackground} onOpenFolderPage={onOpenFolderPage} onOpenFileNewTab={onOpenFileNewTab} renderNoteEditor={renderNoteEditor} onDeleteEntries={onDeleteEntries} renderPage={renderPage} tabId={tabId} viewKey={viewKey} onNotice={onNotice} onRetitle={onRetitle} commentsOrder={commentsOrder} onChangeCommentsOrder={onChangeCommentsOrder} hoverPreview={hoverFolderViews} hoverLinks={hoverFolderLinks} folderPages={folderPages} previewScope={previewScope} diagramDarkColors={diagramDarkColors} sync={sync} onSyncNow={onSyncNow} />
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
        <DrawingEditor key={path} root={root} path={path} watch={watch} sync={sync} onSyncNow={onSyncNow} startView={startViewRef.current} {...drawingSettings} canvasPanel={canvasPanel} onCanvasPanelChange={onChangeCanvasPanel} onNotice={onNotice} hotkeys={hotkeys} hotkeysAside={hotkeysAside} wikilinks={wikilinks} viewOnlyLinks={viewOnlyLinks} wikilinkCandidates={wikilinkCandidates} onOpenLink={onOpenLink ?? onOpenFile} onOpenLinkBackground={onOpenLinkBackground ?? onOpenFileBackground} onOpenExplore={onOpenExplore} exploreOnClick={exploreOnClick} linkActions={linkActions} newNoteFolderFor={newNoteFolderFor} hoverLinks={hoverDrawingLinks} previewScope={previewScope} diagramDarkColors={diagramDarkColors} />
      </Suspense>
    )
  }
  if (kind === 'diagram') {
    return (
      <Suspense fallback={<section className="editor" />}>
        <DrawioEditor key={path} root={root} path={path} watch={watch} sync={sync} onSyncNow={onSyncNow} darkColors={diagramDarkColors} onNotice={onNotice} hotkeys={hotkeys} wikilinks={wikilinks} viewOnlyLinks={viewOnlyLinks} wikilinkCandidates={wikilinkCandidates} onOpenLink={onOpenLink ?? onOpenFile} onOpenLinkBackground={onOpenLinkBackground ?? onOpenFileBackground} onOpenExplore={onOpenExplore} exploreOnClick={exploreOnClick} linkActions={linkActions} newNoteFolderFor={newNoteFolderFor} hoverLinks={hoverDrawingLinks} previewScope={previewScope} />
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
  return <MarkdownEditor drawingSettings={drawingSettings} root={root} path={path} watch={watch} onOpenFile={onOpenFile} onOpenFileRight={onOpenFileRight} onOpenFileBackground={onOpenFileBackground} onOpenLink={onOpenLink} onOpenLinkBackground={onOpenLinkBackground} onOpenExplore={onOpenExplore} exploreOnClick={exploreOnClick} idInTitle={idInTitle} linkActions={linkActions} onNotice={onNotice} newNoteFolderFor={newNoteFolderFor} wikilinks={wikilinks} viewOnlyLinks={viewOnlyLinks} wikilinkCandidates={wikilinkCandidates} properties={properties} onRetitle={onRetitle} sync={sync} onSyncNow={onSyncNow} commentsOrder={commentsOrder} onChangeCommentsOrder={onChangeCommentsOrder} tableOfContents={tableOfContents} tocOnByDefault={tocOnByDefault} guideLinesOnByDefault={guideLinesOnByDefault} foldingOnByDefault={foldingOnByDefault} bulletThreadingOnByDefault={bulletThreadingOnByDefault} contentWidth={contentWidth} onChangeTableOfContents={onChangeTableOfContents} tableOfContentsWidth={tableOfContentsWidth} onChangeTableOfContentsWidth={onChangeTableOfContentsWidth} tocZoom={tocZoom} onChangeTocZoom={onChangeTocZoom} onUserEdit={onUserEdit} startView={startViewRef.current} tabId={tabId} zoomKey={zoomKey} onZoom={onZoom} onOpenBullet={onOpenBullet} diagramDarkColors={diagramDarkColors} hoverLinks={hoverLinks} hoverDrawingLinks={hoverDrawingLinks} hoverBacklinks={hoverBacklinks} folderPages={folderPages} previewScope={previewScope} hotkeys={hotkeys} hotkeysAside={hotkeysAside} outsideChangeGlow={outsideChangeGlow} findFolds={findFolds} outsideListPinned={outsideListPinned} onChangeOutsideListPinned={onChangeOutsideListPinned} />
}

/**
 * What the Page tab of a folder page changes (YAZ-4584 D38): the editor sits in the folder page, so it has no section,
 * scroller, title, properties, comments, mentions or toolbar of its own — the folder page has them. Its page
 * switches and save state go to the folder page's toolbar (`FolderPageChips`), and the folder's Read only locks it.
 */
interface FolderPageMode {
  inFolderPage?: boolean
}

/** Markdown-only owner: loading, Crepe, autosave, frontmatter, comments, and backlinks. */
function MarkdownEditor({ inFolderPage = false, drawingSettings, root, path, watch, onOpenFile, onOpenFileRight, onOpenFileBackground, onOpenLink, onOpenLinkBackground, onOpenExplore, exploreOnClick, idInTitle, linkActions, onNotice, newNoteFolderFor, wikilinks, viewOnlyLinks, wikilinkCandidates, properties, onRetitle, sync, onSyncNow, commentsOrder, onChangeCommentsOrder, tableOfContents, tocOnByDefault, guideLinesOnByDefault, foldingOnByDefault, bulletThreadingOnByDefault, contentWidth, onChangeTableOfContents, tableOfContentsWidth, onChangeTableOfContentsWidth, tocZoom, onChangeTocZoom, onUserEdit, startView, tabId, zoomKey, onZoom, onOpenBullet, diagramDarkColors = 'adapt', hoverLinks = false, hoverDrawingLinks = false, hoverBacklinks = false, folderPages, previewScope, hotkeys, hotkeysAside, outsideChangeGlow, findFolds, outsideListPinned, onChangeOutsideListPinned }: EditorProps & FolderPageMode & { drawingSettings: DrawingAppSettings }) {
  const state = useFile(path)
  const titles = usePathTitles(wikilinks)
  const file = state.status === 'ready' ? state.file : state.status === 'loading' ? state.prev : null
  const content = (
    <>
      {state.status === 'loading' && file === null && <p className="editor-msg">Loading…</p>}
      {state.status === 'error' && <p className="editor-msg editor-msg--error">{state.message}</p>}
      {file !== null && (
        <CrepeHost key={file.path} inFolderPage={inFolderPage} {...drawingSettings} root={root} file={file} titles={titles} watch={watch} onOpenFile={onOpenFile} onOpenFileRight={onOpenFileRight} onOpenFileBackground={onOpenFileBackground} onOpenLink={onOpenLink} onOpenLinkBackground={onOpenLinkBackground} onOpenExplore={onOpenExplore} exploreOnClick={exploreOnClick} idInTitle={idInTitle} linkActions={linkActions} onNotice={onNotice} newNoteFolderFor={newNoteFolderFor} wikilinks={wikilinks} viewOnlyLinks={viewOnlyLinks} wikilinkCandidates={wikilinkCandidates} properties={properties} onRetitle={onRetitle} sync={sync} onSyncNow={onSyncNow} commentsOrder={commentsOrder} onChangeCommentsOrder={onChangeCommentsOrder} tableOfContents={tableOfContents} tocOnByDefault={tocOnByDefault} guideLinesOnByDefault={guideLinesOnByDefault} foldingOnByDefault={foldingOnByDefault} bulletThreadingOnByDefault={bulletThreadingOnByDefault} contentWidth={contentWidth} onChangeTableOfContents={onChangeTableOfContents} tableOfContentsWidth={tableOfContentsWidth} onChangeTableOfContentsWidth={onChangeTableOfContentsWidth} tocZoom={tocZoom} onChangeTocZoom={onChangeTocZoom} onUserEdit={onUserEdit} startView={startView} tabId={tabId} zoomKey={zoomKey} onZoom={onZoom} onOpenBullet={onOpenBullet} diagramDarkColors={diagramDarkColors} hoverLinks={hoverLinks} hoverDrawingLinks={hoverDrawingLinks} hoverBacklinks={hoverBacklinks} folderPages={folderPages} previewScope={previewScope} hotkeys={hotkeys} hotkeysAside={hotkeysAside} outsideChangeGlow={outsideChangeGlow} findFolds={findFolds} outsideListPinned={outsideListPinned} onChangeOutsideListPinned={onChangeOutsideListPinned} />
      )}
    </>
  )
  // The Page tab's editor sits inside the folder page's own section (YAZ-4584 D38).
  return inFolderPage ? content : <section className="editor">{content}</section>
}

/** No store to follow: a note outside a folder page's Page tab. */
const noSubscribe = (): (() => void) => () => undefined

/** The setters of a mount that threads no table of contents setting: one identity, so the memoised table of contents never sees a new one. */
const noTableOfContentsChange = (): void => undefined

/** Mounts exactly one Crepe instance for `file`; remounted (via `key`) when the path changes. */
function CrepeHost({
  inFolderPage = false,
  root,
  file,
  titles,
  watch,
  onOpenFile,
  onOpenFileRight,
  onOpenFileBackground,
  onOpenLink = onOpenFile,
  onOpenLinkBackground = onOpenFileBackground,
  onOpenExplore,
  exploreOnClick,
  idInTitle,
  linkActions,
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
  guideLinesOnByDefault = DEFAULT_SETTINGS.guideLinesOnByDefault,
  foldingOnByDefault = DEFAULT_SETTINGS.foldingOnByDefault,
  bulletThreadingOnByDefault = DEFAULT_SETTINGS.bulletThreading,
  contentWidth = 'narrow',
  onChangeTableOfContents = noTableOfContentsChange,
  tableOfContentsWidth = TOC_DEFAULT_W,
  onChangeTableOfContentsWidth = noTableOfContentsChange,
  tocZoom = 100,
  onChangeTocZoom = noTableOfContentsChange,
  onUserEdit,
  startView,
  tabId,
  zoomKey,
  onZoom,
  onOpenBullet,
  diagramDarkColors,
  hoverLinks,
  hoverDrawingLinks,
  hoverBacklinks,
  folderPages,
  previewScope,
  hotkeys,
  hotkeysAside,
  outsideChangeGlow = DEFAULT_SETTINGS.outsideChangeGlow,
  findFolds = DEFAULT_SETTINGS.findFolds,
  outsideListPinned = DEFAULT_SETTINGS.outsideListPinned,
  onChangeOutsideListPinned,
  canvasPrefs,
  onCanvasPrefsChange,
}: DrawingAppSettings & FolderPageMode & {
  root: string
  file: FileResponse
  titles: PathTitles
  watch: WatchSource
  onOpenFile: (path: string) => void
  onOpenFileRight?: (path: string) => void
  onOpenFileBackground?: (path: string) => void
  onOpenLink?: (path: string, where?: GestureAction) => void
  onOpenLinkBackground?: (path: string) => void
  onOpenExplore?: (path: string) => void
  exploreOnClick?: () => boolean
  idInTitle?: boolean
  linkActions?: LinkActions
  onNotice?: (message: string, icon?: NoticeKind, type?: NoticeType, action?: Notice['action']) => void
  newNoteFolderFor?: (sourcePath: string) => string
  wikilinks?: WikilinkResolveSource
  viewOnlyLinks?: ViewOnlyLinkSource
  wikilinkCandidates?: WikilinkCandidateSource
  properties?: PropertiesResponse | null
  onRetitle: (path: string, title: string, kind: 'file' | 'dir') => void
  sync?: GithubSyncStatus | null
  onSyncNow?: () => void
  /** Settings › Folder pages: the properties panel reads "Show parent folders' columns" (YAZ-4713 C12). */
  folderPages?: FolderPagesSettings
  commentsOrder: CommentsOrder
  onChangeCommentsOrder: (order: CommentsOrder) => void
  tableOfContents?: TableOfContentsMode
  tocOnByDefault?: boolean
  guideLinesOnByDefault?: boolean
  foldingOnByDefault?: boolean
  bulletThreadingOnByDefault?: boolean
  contentWidth?: ContentWidth
  onChangeTableOfContents?: (mode: TableOfContentsMode) => void
  tableOfContentsWidth?: number
  onChangeTableOfContentsWidth?: (width: number) => void
  tocZoom?: number
  onChangeTocZoom?: (percent: number) => void
  onUserEdit?: (path: string) => void
  startView?: PageView
  tabId?: string
  zoomKey?: string | null
  onZoom?: (tabId: string, zoom: string | null, quiet: boolean, label: string | null, from?: ZoomFrom) => void
  onOpenBullet?: (tabId: string, zoom: string | null, background: boolean, label: string | null) => void
  diagramDarkColors: DiagramDarkColors
  hoverLinks: boolean
  /** The note popup's board pills follow "Links in drawings and diagrams" (YAZ-3943). */
  hoverDrawingLinks: boolean
  hoverBacklinks: boolean
  previewScope?: (path: string) => PreviewScope
  /** `settings.hotkeys` (YAZ-3564): an embedded drawing's keys as the user set them. */
  hotkeys?: HotkeyOverrides
  /** `settings.hotkeysAside` (YAZ-3564 K9): with a switch off, the drawing lets that App key go to the menu. */
  hotkeysAside?: HotkeyAside
  outsideChangeGlow?: SettingsState['outsideChangeGlow']
  /** Settings › Editor › Find › Folded bullets (YAZ-4787): `settings.findFolds`. A note's `find-folds` key wins. Absent → the one you are on. */
  findFolds?: SettingsState['findFolds']
  /** Settings › Editor › Outside changes › Pin default: `settings.outsideListPinned`. Absent → not pinned (the dropdown), as the table of contents. */
  outsideListPinned?: boolean
  /** The list's Pin and Unpin write the setting through this. */
  onChangeOutsideListPinned?: (pinned: boolean) => void
}) {
  const unit = useUnit()
  // A copied page starts at its source's text size (YAZ-2951 S5); after that it changes on its own.
  const [documentZoom, setDocumentZoom] = useState(startView?.magnification ?? 100)
  // Mirror for the ⌘ listener below, which is registered once (`[]`) and must read the live value.
  const documentZoomRef = useRef(documentZoom)
  documentZoomRef.current = documentZoom
  // Per page and never stored (YAZ-2643): it lives as long as this tab's editor does.
  const [lineNumbersOn, setLineNumbersOn] = useState(false)
  // The same kind of switch (YAZ-2700): every heading of THIS page says its level. Per page, never stored.
  const [headingLevelsOn, setHeadingLevelsOn] = useState(false)
  // What this page's table of contents is built from (YAZ-2700 D14). Stored with the note in the
  // app state, as its folds are, and `null` (Auto) is no entry.
  const [tocSource, setTocSource] = useState<TocSource | null>(() => storage.getTocSource(root, file.path))
  // The folded rows of the table of contents (YAZ-3939 D1), as saved for this note when it mounted.
  const [tocFolds] = useState(() => storage.getTocFolds(root, file.path))
  // Stable: the table of contents is memoised.
  const changeTocFolds = useCallback((keys: string[]) => storage.setTocFolds(root, file.path, keys), [root, file.path])
  const hostRef = useRef<HTMLDivElement>(null)
  // A copied page's start (YAZ-2940 D7, YAZ-2951 D1): a ref, so the create effect does not depend on it, and used once.
  const startViewRef = useRef(startView)
  // The hover panel of the note's [[links]] (YAZ-3403): the sidebar's own panel beside a resolved link. A hover's id is
  // its page: the plugin leaves one page before it hovers the next. The link's box is kept here; the dwell lives in the
  // panel's tiny store, so nothing of the note draws for it. The plugin is wired once, with the editor; the setting is
  // read live by the dwell.
  const linkAt = useRef<{ path: string; rect: AnchorRect; editable: boolean } | null>(null)
  const linkPreview = useCardPreview(hoverLinks, (path) => (linkAt.current?.path === path ? linkAt.current.rect : null))
  const [linkHover] = useState<WikilinkHover>(() => ({
    onHover: (path, rect, editable) => {
      linkAt.current = { path, rect, editable }
      linkPreview.hoverCard(path, path)
    },
    onLeave: () => {
      if (linkAt.current !== null) linkPreview.leaveCard(linkAt.current.path)
      linkAt.current = null
    },
  }))
  // The properties panel's link pills (YAZ-4544 4G): a note link's doors and this note's link card. Stable, for its memo.
  const panelLinks = useMemo(() => ({ open: { onOpenFile: onOpenLink, onOpenFileBackground: onOpenLinkBackground, onOpenFileRight }, hover: linkHover }), [onOpenLink, onOpenLinkBackground, onOpenFileRight, linkHover])
  // The card says how to open the link, as the gestures are now (YAZ-3879 point 9): "⌘-click to open"; a note pill while
  // the vault's "Clicking a link" is Explore: "Click to open in Explore", on a read-only note too (YAZ-4939).
  const linkCard = (_: string, path: string): { root: string | null; name: string; hint?: string } => ({ root: null, name: pageLabel(path, false, titles), hint: linkOpenHint(hotkeysNow(), linkAt.current?.editable ?? true, exploreOnClick?.() === true && fileKind(path) === 'markdown') })
  // This note owns ⌘+ / ⌘− / ⌘0 while focus is anywhere inside its section — title, properties,
  // body, comments, the zoom pill (YAZ-1710). Same ladder as the pill; ⌘0 is 100%; a wall is a no-op.
  useEffect(() => {
    // The folder page's zoom is its toolbar's, never the Page tab's (YAZ-4584 D38).
    const section = inFolderPage ? null : hostRef.current?.closest('.editor')
    if (!section) return
    const onZoom = (event: Event) => {
      event.preventDefault()
      const step = (event as CustomEvent<ZoomStep>).detail
      changeZoom(step === 0 ? 100 : stepZoomByKey(documentZoomRef.current, step) ?? documentZoomRef.current)
    }
    section.addEventListener(ZOOM_EVENT, onZoom)
    return () => section.removeEventListener(ZOOM_EVENT, onZoom)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- `inFolderPage` is fixed for the mount
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
    const scroller = inFolderPage ? null : hostRef.current?.closest<HTMLElement>('.editor-host')
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
    const scroller = inFolderPage ? null : hostRef.current?.closest('.editor-host')
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
  // The ID after the title (YAZ-4940 "In the title"), off the index: with the choice Off nothing is read or subscribed to.
  const noteId = useNoteId(idInTitle === true ? wikilinks : undefined, file.path)
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
  const { attach, markReloaded, reportConflict, absorbFrontmatterOnly, diskParts, onSaveRefused } = autosave
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
  const diskReadOnly = useMemo(() => isNoteReadOnly(disk), [disk])
  /**
   * The folder page's toolbar store, for the Page tab alone (YAZ-4584 D38): a note window inside a folder page sits
   * under the same context, and must not take the folder's toolbar.
   */
  const chipsHere = useContext(FolderPageChips)
  const folderChips = inFolderPage ? chipsHere : null
  /** A read-only folder page (YAZ-3746 D36) keeps its Page read only, whatever the `.folder.md` bytes say yet. */
  const folderLocked = useSyncExternalStore(folderChips?.subscribe ?? noSubscribe, () => folderChips?.getState().readOnly ?? false)
  /** The vault's Read only (YAZ-4939). A folder page's Page tab takes it through the folder's store above: one unlock for the whole tab. */
  const vaultScope = useContext(VaultReadOnly)
  const vaultLocked = vaultScope.on && !inFolderPage
  /** The read-only door at click time (YAZ-4985): a link to a missing page asks it before the page is made. */
  const fileDoor = useRef(vaultScope.allowFileAction)
  fileDoor.current = vaultScope.allowFileAction
  /** The page is under Read only: its own switch, its folder page's, or the vault's. The chip shows while this is true. */
  const lockedBase = diskReadOnly || folderLocked || vaultLocked
  /** The timed "Allow edits" of THIS tab (YAZ-4939): at zero the page saves, then locks again. */
  const unlock = useTimedUnlock(autosave.flushNow)
  const readOnly = lockedBase && unlock.until === null
  /**
   * Esc and ⌘↵ in the text lock this page again while its timed unlock runs (YAZ-4997): save, then lock, as Lock now.
   * Read at the key (the editor is built once); false with nothing to lock, so the keys keep their own meaning.
   */
  const lockAgainRef = useRef<() => boolean>(() => false)
  lockAgainRef.current = () => {
    if (!lockedBase || unlock.until === null) return false
    unlock.lock()
    return true
  }
  /**
   * The page cog's on/off rows (YAZ-4094 G4, G1): IN the note's frontmatter too, read off `disk` the same
   * way, so a toggle in another tab or window, or an agent's edit, shows here at once. A key that is absent
   * follows the app default; the page's own choice wins, also over Off (YAZ-3558 D1). Section indent's
   * default is off (YAZ-2709 D2).
   */
  const pageSwitches = useMemo(() => notePageSwitches(disk), [disk])
  const sectionIndentOn = pageSwitches['section-indent'] ?? false
  const tableOfContentsOn = pageSwitches.toc ?? tocOnByDefault
  const guideLinesOn = pageSwitches['guide-lines'] ?? guideLinesOnByDefault
  const foldingOn = pageSwitches.folding ?? foldingOnByDefault
  const threadingOn = pageSwitches['bullet-threading'] ?? bulletThreadingOnByDefault
  // This page's glow for outside changes (YAZ-4272 D2), else Settings'. Read when the note on disk changes, never per key.
  const pageGlow = useMemo(() => noteOutsideGlow(disk), [disk])
  /** This note's own ⌘F fold choice (YAZ-4787), else the app's. */
  const pageFindFolds = useMemo(() => noteFindFolds(disk), [disk])
  /**
   * This note's width for every code block and every table (YAZ-4783 layer 2): its `code-width` / `table-width` keys,
   * read off `disk` as the cog's other rows. On the editor's mount (`mountWidths`) they win over Settings' on `.app`;
   * absent, the note follows Settings. A block's own width wins over both (app.css).
   */
  const pageCodeWidth = useMemo(() => noteBlockWidth(disk, CODE_WIDTH_KEY), [disk])
  const pageTableWidth = useMemo(() => noteBlockWidth(disk, TABLE_WIDTH_KEY), [disk])
  // Read by the editor's mount (createCrepe), which must not re-run when the switch turns: the effect below sends the change.
  const foldingOnRef = useRef(foldingOn)
  foldingOnRef.current = foldingOn
  /** The chip's "Allow edits?" box is open (YAZ-3076 D4): this tab's own, and gone once read only is. */
  const [askingUnlock, setAskingUnlock] = useState(false)
  useEffect(() => {
    if (!lockedBase) setAskingUnlock(false)
  }, [lockedBase])
  /**
   * Counts the outside changes that landed in this editor (YAZ-2643): a reload, a frontmatter-only
   * absorb. `disk` cannot say it — it does not follow this editor's own saves, so a file put back
   * to the bytes `disk` still holds is no change to it.
   */
  const [diskLandings, diskLanded] = useReducer((count: number) => count + 1, 0)
  /**
   * The CMD+F wiring (YAZ-968/969), ONE per host, a holder the host makes: the engine binds
   * itself to this channel at view creation and the bar below drives it. Stable identity — a new
   * channel would remount the editor and leave the bar talking to nothing.
   */
  const findChannel = useMemo(() => createFindChannel(), [])
  /**
   * The outside changes wiring (YAZ-3704 D6), ONE per host on the find channel's terms: the change list binds
   * itself to it and the one-line note drives it. When Next zooms the page out (D9), the tab learns the real level,
   * as after any move the page made by itself.
   */
  const zoomedOutRef = useRef<() => void>(() => {})
  // A tab keeps the list of a page it leaves until it shows the page again (YAZ-3704 demo feedback); an editor outside a tab keeps none.
  const outsideChanges = useMemo(
    () =>
      createOutsideChangesChannel(
        () => zoomedOutRef.current(),
        tabId === undefined ? null : { save: (list) => saveOutsideChanges(tabId, file.path, list), read: () => readOutsideChanges(tabId, file.path) },
      ),
    [], // eslint-disable-line react-hooks/exhaustive-deps -- once per mount: the editor is keyed by its page
  )
  // The Glow setting goes through the channel, never the Crepe effect's deps: a change rebuilds no editor (D5).
  // Declared before that effect, so the first state already has it.
  useEffect(() => outsideChanges.setGlow(pageGlow ?? outsideChangeGlow), [outsideChanges, pageGlow, outsideChangeGlow])
  useEffect(() => findChannel.setFolds(pageFindFolds ?? findFolds), [findChannel, pageFindFolds, findFolds])
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
  /** The drawing whose modal is open, at its vault root ("Edit in a popup" sets it, close clears it): a board image may be in another vault (A11). */
  const [openDrawing, setOpenDrawing] = useState<{ root: string; target: string } | null>(null)
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
    let bulletFoldKeys: readonly string[] = startFolds.filter((k) => !k.startsWith('h:') && !k.startsWith('lock:'))
    let headingFoldKeys: readonly string[] = startFolds.filter((k) => k.startsWith('h:'))
    // Rows locked open (YAZ-4094 4A): `lock:` + the row's fold key, in the same bucket.
    let lockedKeys: readonly string[] = startFolds.filter((k) => k.startsWith('lock:'))
    // One bucket, two writers (D3): each plugin reports its own keys; the union write means neither
    // can wipe the other's. Heading keys are 'h:'-prefixed by the plugin itself, so they can't collide.
    // Locks first: the store keeps the first 500 keys, and a lock is a deliberate choice, a fold often is not (YAZ-4094 4A).
    const writeFolds = () => storage.setFolds(root, file.path, [...lockedKeys, ...bulletFoldKeys, ...headingFoldKeys])
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
      // Note cards (YAZ-4961): `/card` takes its ID from the vault's door at once; the card's open hook names this page.
      noteCards: { path: file.path, mintId: takeNoteId },
      // A calendar table's marker moves each minute here (YAZ-4162 D2, D9); a preview card starts no timer.
      calendarClock: true,
      // The table zoom pill on each table (YAZ-4091); the previews and the outline view have none (YAZ-4176).
      tableZoomPill: true,
      foldingOn: () => foldingOnRef.current,
      onFoldingBlocked: () => onNotice?.(FOLDING_OFF_NOTICE),
      foldLock: {
        seedLockedKeys: () => new Set(lockedKeys),
        onLockedKeysChange: (keys) => {
          lockedKeys = keys
          writeFolds()
        },
        onBlocked: () => onNotice?.(FOLD_LOCKED_NOTICE),
      },
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
        hotkeys: hotkeysNow,
        onOpen: tabRef.current.onOpenBullet === undefined ? undefined : (zoom, behind, label) => {
          const { tabId: id, onOpenBullet: open } = tabRef.current
          if (id !== undefined) open?.(id, zoom, behind, label)
        },
      },
      // Stable per window (App-owned): index updates flow INSIDE the sources, never remounting us.
      wikilinks,
      viewOnlyLinks,
      wikilinkCandidates,
      // Wiki-link navigation (Links C, GRO-2192): the open gestures of Settings › Hotkeys (YAZ-3936, read at each click)
      // open in this tab, a new tab or a background tab; unresolved → create (bare targets under `createFolder` — App's
      // `newNoteFolderFor` getter over the Files & Links location setting, C2- GRO-2240, bound to THIS file's path so
      // the page lands beside the editor the link was clicked in, YAZ-1643; absent → the vault root) then open. Wired
      // only when App threads the background opener — mounts without it keep clicks as plain editing.
      wikilinkNav:
        onOpenLinkBackground === undefined
          ? undefined
          : {
              ...linkActions,
              root,
              createFolder: () => newNoteFolderFor?.(file.path) ?? '',
              openCurrent: (path) => onOpenLink(path, 'thisTab'),
              openNewTab: (path) => onOpenLink(path, 'newTab'),
              openBackground: onOpenLinkBackground,
              // "Open in Explore" and the vault's "Clicking a link" (YAZ-4936).
              openExplore: onOpenExplore,
              exploreClick: exploreOnClick,
              hotkeys: hotkeysNow,
              onNotice: onNotice ?? (() => undefined),
              allowFileAction: (vault) => fileDoor.current(vault),
            },
      // The window's vaults by their ID letters (YAZ-3905 S23): an unresolved `[[INL-4]]` names its vault.
      vaultsOfLetters: (letters) => vaultLinks.current?.vaultsOfLetters?.(letters) ?? [],
      // The hover panel of a resolved [[link]] (YAZ-3403): this note editor's alone, never a read-only preview's.
      // A Markdown link pill previews its page too (YAZ-3609 D20): its address resolves as a click resolves it.
      wikilinkHover: { ...linkHover, markdownPath: (href) => (linkPlace === undefined ? null : hrefTarget(href, linkPlace)) },
      linkLook: { icon: (target, folder) => fileIconDecoration(icons.current, target, folder) },
      // Standard Markdown links (YAZ-1309) leave through one typed host boundary. The active
      // note path travels with the untouched href so main—not the renderer—owns relative-file
      // resolution, protocol validation, and the choice of OS API.
      markdownLinkNav: {
        ...linkActions,
        open: (href) => api.shell.openLink({ href, sourcePath: file.path }),
        // A link to a page or file of this vault opens in a tab, like a [[link]] (YAZ-3609 D8).
        inApp: (href) => (linkPlace === undefined ? null : hrefTarget(href, linkPlace)),
        openPath: (target, where) => (where === 'backgroundTab' ? (onOpenLinkBackground ?? onOpenLink)(target) : where === 'explore' ? (onOpenExplore ?? ((p: string) => onOpenLink(p, 'thisTab')))(target) : onOpenLink(target, where)),
        // A Markdown pill to a note follows the vault's "Clicking a link" as a [[link]] does (YAZ-4936).
        exploreClick: exploreOnClick,
        hotkeys: hotkeysNow,
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
      // "/drawing" and "/diagram" (YAZ-4831): the board is named after this note and goes where Settings say. The bare
      // name is the embed's target only when no other file of the vault has it.
      drawing: {
        create: (kind) =>
          createBoardForNote(
            {
              root,
              notePath: file.path,
              title: titleRef.current,
              nameTaken: (name) => {
                const resolve = viewOnlyLinks?.resolve ?? wikilinks?.resolve ?? null
                return resolve === null || resolve(name) !== null
              },
            },
            kind,
          ),
        onNotice,
      },
      // Board embeds (YAZ-4827): a window into each `![[x.drawio]]` / `![[x.excalidraw]]`. The window loads from this
      // root and refreshes from the watcher itself; "Edit in a popup" opens the drawing modal (D7, the old click path).
      boardEmbeds: { root, onEditInPopup: (target) => setOpenDrawing({ root, target }) },
      // First-class images (YAZ-1656): the root and THIS note's absolute path are what a relative
      // src resolves against (main's `app://vault/` protocol); double-click opens the lightbox
      // below, and a paste that could not be written rides the same passive notice.
      image: {
        root,
        notePath: file.path,
        onOpenImage: setOpenImage,
        onNotice,
        // A board in another vault of the window (YAZ-4828): `![name|640x360](../Other/x.drawio)` is a window, found as
        // the Markdown link pill finds its file, opened as it opens, with the same link rows.
        boards:
          linkPlace === undefined
            ? undefined
            : {
                place: (src) => {
                  const target = vaultHref(src, linkPlace)
                  if (target === null) return null
                  const own = rootOfPath([root], target) !== null
                  return { root: own ? root : (rootOfPath(vaultLinks.current?.roots ?? [], target) ?? root), path: target, vault: own ? null : (vaultLinks.current?.vaultOf(target) ?? null) }
                },
                icon: (target) => fileIconDecoration(icons.current, target, false),
                // A11: the drawing popup at the board's own vault, as a vault-relative target.
                onEditInPopup: (boardRoot, target) => setOpenDrawing({ root: boardRoot, target: target.startsWith(`${boardRoot}/`) ? target.slice(boardRoot.length + 1) : target }),
                open: (target, how) => (how === 'backgroundTab' ? (onOpenLinkBackground ?? onOpenLink)(target) : onOpenLink(target, how)),
                linkMenu: (target) => {
                  const notice = onNotice ?? (() => undefined)
                  return {
                    labels: [],
                    open: () => onOpenLink(target, 'thisTab'),
                    openNew: () => (onOpenLinkBackground ?? onOpenLink)(target),
                    ...placeRows(target, linkActions, notice),
                  }
                },
              },
      },
      find: findChannel,
      outsideChanges,
      toc: tocChannel,
      // A read-only note keeps its keyboard (YAZ-3125, YAZ-3127): this is a note editor, not a preview.
      readOnlyKeys: true,
      // The note keys as the user set them (YAZ-3564 K4): read as the note opens, so a change applies to the next one.
      hotkeys: storage.getSettings()?.hotkeys,
      // Without folded lines says what it left out (YAZ-3653); Settings › Notifications › "Copy, cut or paste" can turn it off.
      onCopyNotice: onNotice === undefined ? undefined : (text) => onNotice(text, 'copy', 'clipboard'),
      lockAgain: () => lockAgainRef.current(),
    })
    crepeRef.current = crepe
    zoomedOutRef.current = () => tellRealZoom(crepe, zoomKeyRef.current ?? null)
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
      // The caret it had (YAZ-3737 D3): a woken tab's, a copy's. Before the grab, which keeps it.
      if (start?.selection !== undefined) placeCaret(crepe, start.selection)
      const active = document.activeElement
      // A tab woken behind the page on show (YAZ-3737 S7) takes no caret and no keys: its layer is hidden.
      const behind = hostRef.current?.closest('.tabstack__layer--hidden') != null
      if (!(active instanceof HTMLElement && active.closest('.tree') !== null) && !namingTab(active) && !behind) focusEditor(crepe)
      // A copy starts where its source stood (YAZ-2940 D7) — after the caret grab, which may scroll,
      // and after the start drill-in, which the editor state already holds (YAZ-2951 S6).
      const scroller = hostRef.current?.closest('.editor-host')
      if (start !== undefined && scroller) scroller.scrollTop = start.scrollTop
      startViewRef.current = undefined
      // This tab's page view, read only when a copy action asks (YAZ-2951 D4): nothing runs per keystroke. The folder
      // page's scroller is the folder tab's, not the Page tab's (YAZ-4584 D38).
      if (scroller && !inFolderPage) {
        offPageView = registerPageView(scroller, () => ({
          scrollTop: scroller.scrollTop,
          zoomKey: getZoomKeyOf(crepe),
          folds: [...lockedKeys, ...bulletFoldKeys, ...headingFoldKeys],
          magnification: documentZoomRef.current,
          selection: getCaretOf(crepe),
        }))
      }
    })

    // An external/AI edit lands as a DIFF over the live state (YAZ-1347), so folds, caret and
    // scroll ride ProseMirror's position mapping instead of being rebuilt from scratch. Only a
    // whole-document rewrite falls back to `setMarkdown`, whose key-based reseed is the better
    // answer once mapping has nothing left to map.
    // `quiet`: the bytes are the user's own typing from a copy of this tab (YAZ-3704), so the change list is not told.
    const reload = async (quiet = false) => {
      const fresh = await api.readFile(file.path)
      if (cancelled) return
      const split = splitFrontmatter(fresh.content)
      // A rewrite rebuilds the note, so nothing can glow: the one-line note says the whole note changed (YAZ-3704).
      if (applyExternalMarkdown(crepe, split.body, quiet) === 'rebuilt' && !quiet) outsideChanges.markWholeNote()
      // A rebuild makes new plugin views, so the zoom's settle timer is gone: a bullet the rewrite removed is told here (YAZ-3676 F3).
      tellRealZoom(crepe, zoomKeyRef.current ?? null)
      markReloaded(() => getMarkdownForSave(crepe), fresh.mtime, split.frontmatter, split.body)
      setDisk(fresh.content)
      diskLanded()
    }
    // The bar's Reload drops the typing, the user's choice: the last saved body lands quietly first, so what
    // glows is what changed outside the app, never the typing that was dropped (YAZ-3704).
    reloadRef.current = () => {
      applyExternalMarkdown(crepe, diskParts().body, true)
      void reload()
    }

    // A change of this file on disk: from the watcher, at once from a copy of this tab that saved
    // (YAZ-2940 D4, S23 — `twinEditors.ts`; `quiet`, it is the user's own typing), or from a save of
    // this editor that the disk refused (YAZ-3704 D1). The echo check skips this editor's own save.
    const onDiskChange = (mtime: number, quiet = false) => {
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
        // The same write can be reported twice (the watcher AND a refused save): the first one landed it.
        if (fresh.mtime === c.mtime) return
        if (absorbFrontmatterOnly(fresh.content, fresh.mtime)) {
          setDisk(fresh.content) // the body is untouched; the panel still has to see the new properties
          diskLanded()
          return
        }
        // The listener plugin debounces markdownUpdated by 200ms, so pull the live content
        // before deciding whether in-progress typing would be lost by a silent reload.
        c.update(getMarkdownForSave(crepe))
        if (!c.dirty) return void reload(quiet)
        // Unsaved typing (YAZ-3704 D1): merge the outside edit over it. The bar only when it cannot be
        // placed (D2), and then nothing changed. A merge makes the new file the baseline, so the merged
        // note differs from it and the autosave writes it 500 ms later, against the new mtime.
        const split = splitFrontmatter(fresh.content)
        const merge = mergeExternalMarkdown(crepe, diskParts().body, split.body, quiet)
        if (merge === 'conflict') return reportConflict(mtime)
        // 'unchanged': the file already holds the typing, so the live note is the baseline and nothing saves.
        markReloaded(merge === 'unchanged' ? () => getMarkdownForSave(crepe) : () => split.body, fresh.mtime, split.frontmatter, split.body)
        c.update(getMarkdownForSave(crepe))
        setDisk(fresh.content)
        diskLanded()
      })
    }
    const unsubscribe = watch.subscribe((ev) => {
      // An app write of this note (`announcedWrite`: an Inbox answer) is told through the twin channel, quietly.
      if (ev.type === 'change' && ev.path === file.path && !isAnnouncedWrite(file.path, ev.mtime)) onDiskChange(ev.mtime)
    })
    const offTwin = onTwinSave(file.path, (mtime) => onDiskChange(mtime, true))
    const offRefused = onSaveRefused((mtime) => onDiskChange(mtime))

    return () => {
      cancelled = true
      crepeRef.current = null
      offPageView?.()
      unsubscribe()
      offTwin()
      offRefused()
      void ready.then(() => crepe.destroy()).finally(() => el.remove())
    }
  }, [root, file, watch, attach, markReloaded, reportConflict, absorbFrontmatterOnly, diskParts, onSaveRefused, wikilinks, viewOnlyLinks, wikilinkCandidates, onOpenFile, onOpenFileBackground, onOpenLink, onOpenLinkBackground, onOpenExplore, exploreOnClick, linkActions, onNotice, newNoteFolderFor, findChannel, outsideChanges, tocChannel, linkHover, reportZoom, tellRealZoom, inFolderPage])

  /**
   * The cog's "Read only" row and the chip's "Allow edits" (YAZ-3076 D1), and the cog's on/off rows
   * (YAZ-4094 G4): pending typing saves first (the pre-rewrite flush every editor on this path takes,
   * S12), then `transformFile` writes the one key against the fresh bytes. The bytes that landed are
   * adopted at once — the chip or the row shows without waiting for the watcher, and the watcher's echo
   * then carries this editor's mtime and is skipped: one read and one write for each click (S17). A
   * refusal is one passive notice; nothing changes.
   */
  const writeOwnKey = useCallback(
    async (transform: (content: string) => string, row: string): Promise<boolean> => {
      try {
        await flushRenamedPath(file.path)
        const landed = await transformFile(file.path, transform)
        if (absorbFrontmatterOnly(landed.content, landed.mtime)) {
          setDisk(landed.content)
          diskLanded()
        }
        return true
      } catch (err) {
        onNotice?.(`${row} could not change: ${err instanceof Error ? err.message : String(err)}`, 'error')
        return false
      }
    },
    [file.path, absorbFrontmatterOnly, onNotice],
  )
  const setReadOnly = useCallback((on: boolean) => writeOwnKey((content) => setNoteReadOnly(content, on), 'Read only'), [writeOwnKey])
  const setPageSwitch = useCallback((key: PageSwitchKey, row: string, on: boolean) => writeOwnKey((content) => setNotePageSwitch(content, key, on), row), [writeOwnKey])
  const toggleSectionIndent = () => void setPageSwitch('section-indent', 'Section indent', !sectionIndentOn)
  const toggleTableOfContents = () => void setPageSwitch('toc', 'Table of contents', !tableOfContentsOn)
  const toggleGuideLines = () => void setPageSwitch('guide-lines', 'Guide lines', !guideLinesOn)
  const toggleFolding = () => void setPageSwitch('folding', 'Folding', !foldingOn)
  const toggleThreading = () => void setPageSwitch('bullet-threading', 'Bullet threading', !threadingOn)
  const changeOutsideGlow = (glow: OutsideChangeGlow | null) => void writeOwnKey((content) => setNoteOutsideGlow(content, glow), 'Outside changes glow')
  /** The find bar's fold menu (YAZ-4787): this note's choice, or null to follow Settings again. */
  const findFoldsMenu = { own: pageFindFolds, app: findFolds, onChange: (folds: FindFolds | null) => void writeOwnKey((content) => setNoteFindFolds(content, folds), 'Find folded bullets') }
  /** The cog's "Code block width" / "Table width" (YAZ-4783 layer 2): this note's px, or null to follow Settings again. */
  const changeCodeWidth = (width: number | null) => void writeOwnKey((content) => setNoteBlockWidth(content, CODE_WIDTH_KEY, width), 'Code block width')
  const changeTableWidth = (width: number | null) => void writeOwnKey((content) => setNoteBlockWidth(content, TABLE_WIDTH_KEY, width), 'Table width')

  // Line numbers (YAZ-2643) count lines of the file ON DISK. So the gutter is rebuilt only when
  // the page and the disk agree: on turn-on, when a save settles, when an outside change lands.
  // A worker that fails shows one passive notice and is not asked again until the next of those three.
  // A vault that joins or leaves the window changes which links are pills (YAZ-3664), a renamed vault the "(Vault)"
  // on them (D22), and new file icons their icons (D13): draw them again, with no edit. Not on the first draw.
  const windowRoots = vaultLinksHere?.roots
  const windowNames = vaultLinksHere?.names
  // The vaults' ID letters landing with their indexes name an ID of another vault (YAZ-3905 S23).
  const windowLetters = vaultLinksHere?.letters
  const drawn = useRef<unknown[] | null>(null)
  useEffect(() => {
    if (readyCrepe === null || crepeRef.current !== readyCrepe) return
    const now = [readyCrepe, windowRoots, windowNames, iconsHere, windowLetters]
    const before = drawn.current
    drawn.current = now
    if (before === null || before[0] !== readyCrepe) return
    const view = readyCrepe.editor.ctx.get(editorViewCtx)
    if (before[1] !== windowRoots || before[2] !== windowNames || before[3] !== iconsHere) redrawLinkPills(view)
    if (before[3] !== iconsHere || before[2] !== windowNames || before[4] !== windowLetters) redrawWikilinks(view)
  }, [readyCrepe, windowRoots, windowNames, iconsHere, windowLetters])
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
  // "The note at now" (YAZ-4164 D11): a request for this note (the daily-note button, ⌘D) is taken once the editor is
  // ready and its tab shows — after the mount's caret and scroll — or at once by an editor that is open and in front.
  // A tab behind the page waits for its layer to show, so the tab in front never scrolls. A Linked mentions line in a
  // cell note asks the same way for that note's card (YAZ-3818, `cellNoteRequest.ts`).
  useEffect(() => {
    const host = hostRef.current
    if (readyCrepe === null || crepeRef.current !== readyCrepe || host === null) return
    const take = () => {
      if (host.closest('.tabstack__layer--hidden') !== null) return
      if (takeGoToNow(file.path)) goToNow(editorViewOf(readyCrepe))
      const label = takeCellNoteRequest(file.path)
      if (label !== null) openCellNoteByLabel(editorViewOf(readyCrepe), label)
    }
    take()
    const off = onGoToNowRequest(take)
    const offNote = onCellNoteRequest(take)
    const shown = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && take())
    shown?.observe(host)
    return () => {
      off()
      offNote()
      shown?.disconnect()
    }
  }, [readyCrepe, file.path])
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
  /**
   * The room a wide code block or table may take on the right (YAZ-4783, `blockRoom.ts`): `--block-room` on the mount,
   * measured when the scroller or the body changes width, and again when the zoom or the table of contents changes.
   * Never on a keystroke.
   */
  useEffect(() => {
    const mount = hostRef.current
    if (readyCrepe === null || crepeRef.current !== readyCrepe || mount === null) return
    return watchBlockRoom(mount, editorViewOf(readyCrepe).dom, documentZoom / 100).stop
  }, [readyCrepe, documentZoom, tableOfContentsOn, tableOfContents])
  /**
   * After a drag wrote ONE code block's width (YAZ-4783 layer 2, `CODE_WIDTH_DRAGGED`), in a note with another code
   * block: a toast offers "Use 900 px for all code blocks in this note". Its button takes every block's own width away
   * in ONE transaction (one ⌘Z), then writes `code-width: 900` to the note, so they all follow the note's width. A
   * write that fails takes the clear back.
   */
  useEffect(() => {
    const crepe = readyCrepe
    if (crepe === null || crepeRef.current !== crepe || onNotice === undefined) return
    const view = editorViewOf(crepe)
    const onDragged = (event: Event) => {
      const { width } = (event as CustomEvent<CodeWidthDragged>).detail
      if (codeBlockCount(view.state.doc) < 2) return
      // Short words (YAZ-4783 demo: "wow thats ugly"): the long button squeezed the message into a sliver.
      onNotice(`Code block: ${width} px`, 'info', undefined, {
        label: unit('Apply to all in this note'),
        fades: true,
        run: () => {
          if (crepeRef.current !== crepe || !view.editable) return
          // The blocks first, then the key (demo check): the key's write flushes the editor's text before it adds the
          // key, so the file gets the cleared blocks AND the key. The other order left a block's comment on disk when
          // the drag's own save was still in flight. A write that fails takes the clear back (one ⌘Z's worth).
          const tr = codeWidthsToNote(view.state)
          if (tr !== null) view.dispatch(tr)
          void writeOwnKey((content) => setNoteBlockWidth(content, CODE_WIDTH_KEY, width), 'Code block width').then((wrote) => {
            if (!wrote && tr !== null && crepeRef.current === crepe) undo(view.state, view.dispatch)
          })
        },
      })
    }
    view.dom.addEventListener(CODE_WIDTH_DRAGGED, onDragged)
    return () => view.dom.removeEventListener(CODE_WIDTH_DRAGGED, onDragged)
  }, [readyCrepe, onNotice, writeOwnKey])
  // A table section collapsed while the note is locked (YAZ-4939, `VIEW_ONLY_CHANGE`): a view change, so the live text
  // counts as saved and no flush writes it while locked. An unlocked note's next save writes it with the text.
  const keepAsSaved = autosave.keepAsSaved
  useEffect(() => {
    const crepe = readyCrepe
    if (crepe === null || crepeRef.current !== crepe) return
    const dom = editorViewOf(crepe).dom
    dom.addEventListener(VIEW_ONLY_CHANGE, keepAsSaved)
    return () => dom.removeEventListener(VIEW_ONLY_CHANGE, keepAsSaved)
  }, [readyCrepe, keepAsSaved])
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
  // The page's "Folding" switch (YAZ-4094 F1): one meta-only transaction, no remount. On again brings the saved folds back.
  useEffect(() => {
    const crepe = readyCrepe
    if (crepe !== null && crepeRef.current === crepe) showFolding(crepe, foldingOn)
  }, [foldingOn, readyCrepe])

  /**
   * The scroller's switches, as the editor CSS reads them on `.editor-host`. A note's own scroller wears them; on a
   * folder page the Page tab puts them on the folder page's scroller (YAZ-4584 D38), and takes them off as it goes.
   */
  const scrollerData = {
    'data-read-only': readOnly ? 'true' : undefined,
    'data-line-numbers': lineNumbersOn ? 'true' : undefined,
    'data-section-indent': sectionIndentOn ? 'true' : undefined,
    'data-guide-lines': pageSwitches['guide-lines'] === undefined ? undefined : pageSwitches['guide-lines'] ? 'on' : 'off',
    'data-folding': pageSwitches.folding === undefined ? undefined : pageSwitches.folding ? 'on' : 'off',
    'data-threading': pageSwitches['bullet-threading'] === undefined ? undefined : pageSwitches['bullet-threading'] ? 'on' : 'off',
    'data-heading-levels': headingLevelsOn ? 'true' : undefined,
  }
  const scrollerDataKey = JSON.stringify(scrollerData)
  useLayoutEffect(() => {
    const scroller = inFolderPage ? hostRef.current?.closest<HTMLElement>('.editor-host') : null
    if (!scroller) return
    const set = Object.entries(JSON.parse(scrollerDataKey) as Record<string, string>)
    for (const [name, value] of set) scroller.setAttribute(name, value)
    return () => {
      for (const [name] of set) scroller.removeAttribute(name)
    }
  }, [inFolderPage, scrollerDataKey])

  // Collapse all / Expand all (YAZ-3938 D1): the ⌘⇧U / ⌘⇧I command, left of the cog.
  // Folding off (YAZ-4094 F1): nothing on the page can fold, so the button goes.
  const foldAllButton = foldingOn && (
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
  )
  /** The cog's page switches: a note's own cog, or the folder page's for its Page tab (YAZ-4584 D38). */
  const cog: FolderPageTab['cog'] = { lineNumbers: lineNumbersOn, onToggleLineNumbers: () => setLineNumbersOn((on) => !on), sectionIndent: sectionIndentOn, onToggleSectionIndent: toggleSectionIndent, guideLines: guideLinesOn, onToggleGuideLines: toggleGuideLines, folding: foldingOn, onToggleFolding: toggleFolding, bulletThreading: threadingOn, onToggleBulletThreading: toggleThreading, headingLevels: headingLevelsOn, onToggleHeadingLevels: () => setHeadingLevelsOn((on) => !on), tableOfContents: tableOfContentsOn, onToggleTableOfContents: toggleTableOfContents, tocSource, onChangeTocSource: tableOfContentsOn ? changeTocSource : undefined, outsideGlow: pageGlow, appGlow: outsideChangeGlow, onChangeOutsideGlow: changeOutsideGlow, codeWidth: pageCodeWidth, onChangeCodeWidth: changeCodeWidth, tableWidth: pageTableWidth, onChangeTableWidth: changeTableWidth, readText: () => (readyCrepe !== null && crepeRef.current === readyCrepe ? getPlainText(readyCrepe) : '') }
  // The Page tab hands its switches, save state and fold-all button to the folder page's toolbar while it shows, again
  // on each render (a switch or the save state moved), and takes them back as it goes (YAZ-4584 D38, YAZ-3746 D35, 10D).
  // A render is a save cycle or a switch, never a keystroke.
  useEffect(() => {
    folderChips?.set({ page: { cog, save: autosave.status, foldAll: foldAllButton || null } })
  })
  useEffect(() => () => folderChips?.set({ page: null }), [folderChips])
  /** This note's widths on its editor's mount (YAZ-4783 layer 2): nearer than Settings' on `.app`, so they win (app.css). */
  const mountWidths = {
    'data-code-block-width': pageCodeWidth === null ? undefined : '',
    'data-table-width': pageTableWidth === null ? undefined : '',
    style: { ...(pageCodeWidth !== null && { '--code-block-width': `${pageCodeWidth}px` }), ...(pageTableWidth !== null && { '--table-width': `${pageTableWidth}px` }) } as CSSProperties,
  }

  return (
    <>
      {/* Document zoom stays local to this mounted editor; sync remains vault-wide. The toolbar a folder page shares
          (YAZ-3746 D35): this note's fold-all button and cog, then the shared chips. A folder's Page tab has none of its
          own: it hands its fold-all button, cog and save state to the folder page's toolbar (YAZ-4584 D38, 10D, below). */}
      {/* The chip's box (YAZ-4939): a time choice unlocks this tab; "Turn Read only off" writes the note's own switch, and is not there while the vault's lock would keep the page locked anyway. */}
      {!inFolderPage && (
        <StatusChips zoom={documentZoom} onZoom={changeZoom} readOnly={lockedBase ? { asking: askingUnlock, onAsk: () => setAskingUnlock(true), onAllow: (choice) => { setAskingUnlock(false); unlock.allow(choice) }, onCancel: () => setAskingUnlock(false), onTurnOff: diskReadOnly && !vaultLocked ? () => { setAskingUnlock(false); void setReadOnly(false) } : undefined, editingUntil: unlock.until, onLock: unlock.lock, lockKeys: true } : null} sync={sync} onSyncNow={onSyncNow} save={autosave.status}>
          {foldAllButton}
          {/* The cog's row reads the page's lock; a click while a timed unlock runs is "Lock now". */}
          <PageSettings readOnly={lockedBase} onToggleReadOnly={() => (lockedBase ? (unlock.until !== null ? unlock.lock() : setAskingUnlock(true)) : void setReadOnly(true))} {...cog} />
        </StatusChips>
      )}
      {/* The one-line note of outside changes (YAZ-3704 D6) takes the conflict bar's place and hides while it shows. */}
      {autosave.conflictMtime !== null ? (
        <div className="conflict-bar" role="alert">
          <span>File changed on disk.</span>
          <button type="button" onClick={() => reloadRef.current()}>
            Reload
          </button>
          <button type="button" onClick={autosave.keepMine}>
            Keep mine
          </button>
        </div>
      ) : (
        <OutsideChangesBar channel={outsideChanges} pinned={outsideListPinned} onPin={onChangeOutsideListPinned} onKeep={() => changeOutsideGlow('until-checked')} />
      )}
      {/* The scroller holds SIX stacked blocks, in this order. Block ZERO is the page title
          (⚡ YAZ-888) — the file's own name, React-side and never a ProseMirror node; block ONE is
          the properties panel (⚡ YAZ-883), the note's frontmatter as raw YAML; then the Crepe
          mount; then three blocks of the note's own: the comment stream (YAZ-1472, 🔒 D4 — always
          there, the composer being the door to the first comment), then "Linked mentions"
          (Links D, GRO-2193). All of it scrolls WITH
          the note, never in a panel. */}
      {inFolderPage ? (
        // The Page tab (YAZ-4584 D38): the body alone, in the folder page's scroller, where the view body would be.
        // Its CMD+F bar comes first, so it sticks to the top of the folder page's scroller as the reader goes down.
        <div className="folder-page-doc">
          <FindBar channel={findChannel} scope="page" hostRef={hostRef} folds={findFoldsMenu} />
          <div className="editor-mount" ref={hostRef} {...mountWidths} />
        </div>
      ) : (
        <div className="editor-host" data-page="note" {...scrollerData} style={{ '--document-zoom': documentZoom / 100 } as CSSProperties}>
          {/* Title and properties share ONE header row (YAZ-918): the panel sits to
              the title's right and wraps under it when the title runs long. */}
          <div className="page-header">
            <PageTitle
              path={file.path}
              titles={titles}
              readOnly={readOnly}
              id={noteId}
              onNotice={onNotice}
              onRetitle={(title) => onRetitle(file.path, title, 'file')}
              onArrowDown={() => {
                const crepe = crepeRef.current
                if (crepe !== null) focusEditor(crepe)
              }}
            />
            {/* Typed rows (⚡ YAZ-884) read the vault-wide declarations App also threads to the
                folder view — ONE registry, so a type declared in a row types the same column in
                every folder's views. */}
            <MemoFrontmatterPanel file={diskFile} root={root} properties={properties} wikilinks={wikilinks} readOnly={readOnly} links={panelLinks} inheritColumns={folderPages?.inheritColumns} onNotice={onNotice} />
          </div>
          <div className="editor-mount" ref={hostRef} {...mountWidths} />
          {/* Reads the same disk truth the properties panel does (🔒 D4): its own frontmatter-only
              writes come back through the watcher as `absorbFrontmatterOnly` → `setDisk`. */}
          <MemoCommentsSection file={diskFile} order={commentsOrder} onChangeOrder={onChangeCommentsOrder} root={root} />
          {wikilinks !== undefined && (
            <MemoBacklinksSection path={file.path} source={wikilinks} openCurrent={onOpenFile} openBackground={onOpenFileBackground} hoverPreview={hoverBacklinks} previewScope={previewScope} diagramDarkColors={diagramDarkColors} />
          )}
        </div>
      )}
      {/* CMD+F (YAZ-969) floats OVER that scroller rather than in it: `section.editor` is the
          positioned ancestor, so the bar holds its corner while the note scrolls under it. */}
      {!inFolderPage && <FindBar channel={findChannel} scope="note" hostRef={hostRef} folds={findFoldsMenu} />}
      {/* The note's own right-click menu (YAZ-3653), in the look of the tab and sidebar menus. */}
      <NoteMenu view={readyCrepe !== null && crepeRef.current === readyCrepe ? editorViewOf(readyCrepe) : null} />
      <CardPreviewHost store={linkPreview.store} cardOf={linkCard} scopeOf={previewScope} diagramDarkColors={diagramDarkColors} />
      {/* The table of contents (YAZ-2700) floats beside that scroller the same way: at the
          section's right edge, from the scroller's top to its bottom. It draws nothing for a note
          with fewer than two rows (its headings or its bullets), while this page shows none (its
          choice, else "Table of contents default", YAZ-3558), and while a bullet is zoomed. */}
      {/* The numbered list of outside changes (YAZ-3998) floats in the room LEFT of the note the same way. */}
      {outsideListPinned && <OutsideChangesList channel={outsideChanges} hostRef={hostRef} onPin={onChangeOutsideListPinned} />}
      <MemoTableOfContents channel={tocChannel} mode={tableOfContentsOn ? tableOfContents : 'off'} contentWidth={contentWidth} onChangeMode={onChangeTableOfContents} width={tableOfContentsWidth} onChangeWidth={onChangeTableOfContentsWidth} hostRef={hostRef} onReturnFocus={focusNote} folds={tocFolds} onChangeFolds={changeTocFolds} zoom={tocZoom} onChangeZoom={onChangeTocZoom} />
      {/* The drawing editor (YAZ-879) — a MODAL over the window, never a node view inside the
          note. Keyed by target so reopening a different drawing is a fresh canvas, and the
          appearance is App's already-resolved one, read once (`appliedTheme`). */}
      {openDrawing !== null && (
        <DrawingModal key={`${openDrawing.root}\n${openDrawing.target}`} root={openDrawing.root} target={openDrawing.target} theme={appliedTheme()} canvasPrefs={canvasPrefs} onCanvasPrefsChange={onCanvasPrefsChange} onClose={() => setOpenDrawing(null)} hotkeys={hotkeys} hotkeysAside={hotkeysAside} onNotice={onNotice} wikilinks={wikilinks} viewOnlyLinks={viewOnlyLinks} wikilinkCandidates={wikilinkCandidates} onOpenLink={onOpenLink} onOpenLinkBackground={onOpenLinkBackground} onOpenExplore={onOpenExplore} exploreOnClick={exploreOnClick} linkActions={linkActions} newNoteFolderFor={newNoteFolderFor} hoverLinks={hoverDrawingLinks} previewScope={previewScope} diagramDarkColors={diagramDarkColors} />
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
