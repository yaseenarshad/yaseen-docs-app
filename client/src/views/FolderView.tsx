/**
 * The folder view (YAZ-2290): a real FOLDER, opened as a tab (D3), shown as views over its
 * notes. Its subject is a DIRECTORY, never a note.
 *
 *  - ROWS (D4): the notes under the folder, at any depth — never a subfolder itself — plus its
 *    SHORTCUTS (D2, `links/shortcuts.ts`). Their links resolve through the whole vault.
 *  - SETTINGS (D1/E2): the folder's hidden `.folder.md`. Born holding only the folder's id (D13),
 *    or missing where the vault does not use IDs: either way the defaults (`folderSettings`) until
 *    the first change, and opening writes NOTHING.
 *  - THE ADAPTER (🔒 D3, YAZ-819): ViewsPane stays ONE component. This host builds a def in memory
 *    from the settings' views and turns every def change back into ONE settings write
 *    (`writeFolderSettings`). Which view is active is session state, never written.
 *  - VALUES (D19): a folder's values for a note are in the NOTE, under `in`, in the block named by
 *    the folder's id (`shared/folderValues.ts`). This host is the one seam: the views get rows
 *    whose `properties` ARE this folder's block, and every value they write comes back through
 *    `writeValues` into it. A column is never stamped into a note (E1). That write is also where a
 *    note drops the values of the folders that no longer show it (D20). Where the vault does not
 *    use IDs (YAZ-2523 🔒 V6) there is no block: the rows are the notes' own properties, a value is
 *    written at the top of its note, and no column is deleted.
 *  - SUBFOLDERS AS ROWS (YAZ-4579 D31): each direct subfolder is a row too, for the views whose "Subfolders"
 *    switch asks for it — its `.folder.md`, read and written like a note: its values for this folder are in its
 *    block of `in`, or at its top level where the vault does not use IDs, and its first write creates the file.
 *  - THE PAGE AROUND THE VIEWS (D9/D10): the title (a commit renames the directory), the folder's
 *    OWN properties and comments, both stored in `.folder.md`, and its linked mentions — the
 *    components a note uses.
 *  - OTHER FILES (YAZ-4597, D43-D46): a tray under the views (`view/OtherFiles.tsx`): the folder's files that are not
 *    notes, then the notes moved there — `other_files` links in the settings, written through the one writer. A moved
 *    note leaves every view (the views' records). "Show Other files" in the cog (`show_other_files`) beats Settings ›
 *    Folder pages; with the tray off, every note shows in the views again and nothing moves.
 *
 * Feed: the window's ONE `WikilinkResolveSource`, so the view costs no fetch or watcher of its own.
 */
import { memo, type CSSProperties, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ColumnDecl } from './folderSettings'
import { stringify } from 'yaml'
import { folderValues, withFolderValues } from '@shared/folderValues'
import { DEFAULT_FOLDER_PAGES, folderSettingsPath, inFolder, type CommentsOrder, type DiagramDarkColors, type FileResponse, type FolderPagesSettings, type GithubSyncStatus, type PropertiesResponse, type ZoomStep } from '@shared/types'
import { HOVER_PREVIEW_KEY, SHOW_OTHER_FILES_KEY, SHOW_PAGE_FILE_KEY, hoverPreviewOf, showOtherFilesOf, showPageFileOf } from '@shared/folderPage'
import { exactLinkTarget } from '@shared/linkRewrite'
import { isReadOnlyProperties, READ_ONLY_KEY } from '@shared/readOnly'
import { api, BridgeRequestError } from '../api'
import { CommentsSection } from '../comments/CommentsSection'
import { FrontmatterPanel } from '../editor/FrontmatterPanel'
import { PageTitle } from '../editor/PageTitle'
import { usePathTitles } from '../lib/pageLabel'
import { absFrom, relTo } from '../lib/paths'
import { storage } from '../lib/storage'
import { createStore } from '../lib/store'
import { stepZoomByKey } from '../editor/DocumentZoom'
import { ZOOM_EVENT } from '../editor/zoomRequest'
import { useIndexFeed } from '../editor/wikilink/useIndexFeed'
import type { WikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { BacklinksSection } from '../links/BacklinksSection'
import { dropStaleFolderValues, folderId, folderRecord, folderRows, rowPage, subfolderRows } from '../links/shortcuts'
import { vaultDirs } from '../links/folderLinks'
import { FOLDER_SETTINGS_KEY } from '@shared/folderSettingsLinks'
import { type ParsedViews, type ViewDef, type ViewSet, parseViews } from './viewSchema'
import { ViewsPane, type FolderHost } from './ViewsPane'
import { folderSettings, writeFolderSettings, writeFolderColumn, type FolderSettings } from './folderSettings'
import { deleteColumn as deleteColumnEverywhere, notesHolding } from './deleteColumn'
import { renameNotice, renameOptionInFilters, renameOptionInNotes, restoreInPaths, type ValueHome } from './renameOption'
import { createNote } from './scaffold'
import { guardReadOnly, readOnlyPaths } from './readOnlyRows'
import { writeFolderValues, writeProperties, writeProperty } from './writeProperty'
import { FOLDER_READ_ONLY_TIP, FolderPageChips, FolderToolbar, type FolderChipsState } from './FolderToolbar'
import { ViewFolder } from './view/GroupHeader'
import { noteLinkOf } from './view/fills'
import { OtherFiles, trayBackTarget } from './view/OtherFiles'
import { OtherFilesMove } from './view/otherFilesMove'
import type { PreviewScope } from '../tabs/cardPreview'
import './views.css'
import './folderView.css'

/** As `Editor` holds them (YAZ-2196): the page's blocks re-render when their own inputs move, not on every index poke the views take. */
const MemoFrontmatterPanel = memo(FrontmatterPanel)
const MemoCommentsSection = memo(CommentsSection)
const MemoBacklinksSection = memo(BacklinksSection)

export interface FolderViewProps {
  /** The folder: the tab's identity IS its directory path (D3). */
  path: string
  root: string
  /** The window's link feed (`Editor`'s `wikilinks`): the snapshot, and the folder settings records riding it. */
  source: WikilinkResolveSource
  // The rest are `Editor`'s own props, threaded through as it hands them to a note (`EditorProps`).
  properties?: PropertiesResponse | null
  onOpenFile: (path: string) => void
  onOpenFileRight?: (path: string) => void
  onOpenFileBackground?: (path: string) => void
  /** A subfolder's page in a new tab (YAZ-4564 D26/D27): App's `openKeptPage`, the sidebar's "Open folder page" door. Handed to `ViewsPane` as `FolderHost.openFolderPage`. */
  onOpenFolderPage?: (path: string) => void
  /** A full editor on a note, for the table's note window (YAZ-4547): handed to `ViewsPane` as `FolderHost.renderNoteEditor`. */
  renderNoteEditor?: (path: string) => ReactNode
  /** App's `trashMany` (YAZ-4592 S26), the sidebar's delete: handed to `ViewsPane` as `FolderHost.trash`. */
  onDeleteEntries?: (paths: readonly string[]) => Promise<void>
  /** The Page tab's note editor on this folder's `.folder.md` (YAZ-4584 D38), built by `Editor`: handed to `ViewsPane` as `FolderHost.renderPage`. */
  renderPage?: () => ReactNode
  /** The app tab that shows this folder (`Editor`'s `tabId`): handed to `ViewsPane`, whose note window is that tab's (YAZ-4544). */
  tabId?: string
  /** The main tab's Back step (`Editor`'s `viewKey`): handed to `ViewsPane`, which shows the view tab this step left (YAZ-4544). */
  viewKey?: string
  /** App's `notify`; the views' moves give it their Undo (YAZ-4541 S6). */
  onNotice?: FolderHost['onNotice']
  /** A title commit — the FOLDER's own (D9), or a row's from a table's Name cell (YAZ-2420 🔒 D19) — through App's one rename door. */
  onRetitle: (path: string, title: string, kind: 'file' | 'dir') => void
  commentsOrder: CommentsOrder
  onChangeCommentsOrder: (order: CommentsOrder) => void
  /** Settings › Preview on hover › Folder views (YAZ-3403), with what its panel needs: handed to `ViewsPane`. */
  hoverPreview?: boolean
  previewScope?: (path: string) => PreviewScope
  diagramDarkColors?: DiagramDarkColors
  /** The vault's sync status and the chip's click (`Editor`'s `sync`, `onSyncNow`): the toolbar's sync chip (YAZ-3746 D35). */
  sync?: GithubSyncStatus | null
  onSyncNow?: () => void
  /** Settings › Folder pages (YAZ-4585, D34). Handed to `ViewsPane`. */
  folderPages?: FolderPagesSettings
}

/**
 * A `.folder.md` key the cog writes (YAZ-3746 D36, D37): shown at once, then the index's value again once the index
 * echoes the write, or the write fails.
 */
function useAheadKey<T>(indexed: T): [T, (next: T, write: Promise<unknown>) => void] {
  const [ahead, setAhead] = useState<{ value: T } | null>(null)
  useEffect(() => {
    if (ahead !== null && Object.is(ahead.value, indexed)) setAhead(null)
  }, [ahead, indexed])
  const set = (next: T, write: Promise<unknown>): void => {
    const mine = { value: next }
    setAhead(mine)
    write.catch(() => setAhead((now) => (now === mine ? null : now)))
  }
  return [ahead === null ? indexed : ahead.value, set]
}

/**
 * The def ViewsPane edits, built IN MEMORY from the settings' views (🔒 D3) — nothing on disk
 * stands behind it but the folder's settings file. The round trip through the ONE parser is deliberate: `ParsedViews`
 * carries the yaml Document every config edit is written into (`updateViews`), so it has to be a
 * real parse. No `filters` are ever put in: a folder's set IS what lives in it (D4).
 *
 * The settings' `formulas` come in beside them (YAZ-745): `formula.<name>` is a column, a sort and
 * a GROUPING LEVEL, all read off `def.formulas` — so a folder whose formulas stopped at the
 * settings could declare a level the engine could only answer `unknown formula` to. The column
 * LABELS ride in the same way (YAZ-1513): `def.properties` is what every header reads, and the
 * Properties menu's pencil and the table header's rename both edit it through `onUpdate`.
 */
function folderViewSet({ views, formulas, properties, defaultView }: FolderSettings, ids: boolean): ParsedViews {
  try {
    return parseViews(stringify({ formulas, properties, views, defaultView })) // `stringify` skips undefined keys
  } catch {
    // Report-don't-block: a hand-edited view YAML cannot take the folder's tab down with it —
    // the folder still renders, on the defaults it would have had with no settings at all.
    return parseViews(stringify({ views: folderSettings(undefined, ids).views }))
  }
}

/** A folder's own keys as a folder row's values where the vault does not use IDs (YAZ-4579 D31): its view settings are no column. */
const withoutSettings = ({ [FOLDER_SETTINGS_KEY]: _, ...values }: Record<string, unknown>): Record<string, unknown> => values

/** Order-insensitive identity for one declaration; a field that is undefined is one that is absent (YAZ-4637 M1), as on disk. */
const declStamp = (decl: ColumnDecl): string =>
  JSON.stringify(
    Object.entries(decl)
      .filter(([, value]) => value !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1)),
  )

/** Order-insensitive identity for a columns map: the index re-reads what we wrote, key order and all, but never trust that. */
const columnsStamp = (columns: Readonly<Record<string, ColumnDecl>>): string =>
  JSON.stringify(Object.keys(columns).sort().map((key) => [key, declStamp(columns[key])]))

/**
 * The columns a settings write states as ITS change (YAZ-4637 M1): `base` (the index's) with only the declarations the
 * caller changed between `from` (the live copy it edited) and `to`. The rebase then sees this page's real change and
 * nothing a stale live copy still holds — an outside delete or type change is kept, never put back.
 */
function columnsChanged(base: Readonly<Record<string, ColumnDecl>>, from: Readonly<Record<string, ColumnDecl>>, to: Readonly<Record<string, ColumnDecl>>): Record<string, ColumnDecl> {
  const out: Record<string, ColumnDecl> = { ...base }
  for (const key of new Set([...Object.keys(from), ...Object.keys(to)])) {
    if (!(key in to)) delete out[key]
    else if (!(key in from) || declStamp(from[key]) !== declStamp(to[key])) out[key] = to[key]
  }
  return out
}

/** The comparable tuple every stamp below is spelled as — everything `folderViewSet` builds: views, formulas, labels (YAZ-1513) and the saved START. */
const stampOf = (s: Pick<FolderSettings, 'views' | 'formulas' | 'properties' | 'defaultView'>): string =>
  JSON.stringify([s.views, s.formulas ?? null, s.properties ?? null, s.defaultView ?? null])

export function FolderView({
  path,
  root,
  source,
  properties = null,
  onOpenFile,
  onOpenFileRight,
  onOpenFileBackground,
  onOpenFolderPage,
  renderNoteEditor,
  onDeleteEntries,
  renderPage,
  tabId,
  viewKey,
  onNotice,
  onRetitle,
  commentsOrder,
  onChangeCommentsOrder,
  hoverPreview,
  previewScope,
  diagramDarkColors,
  sync,
  onSyncNow,
  folderPages,
}: FolderViewProps) {
  const feed = useIndexFeed(source)
  const titles = usePathTitles(source)
  /** Does the vault use IDs (YAZ-2523 🔒 V5)? Everything ID-only below asks this, and nothing under the host does. */
  const ids = source.ids

  /** Where the settings live (D1) — and the file every write below goes to, created by the first one. */
  const file = folderSettingsPath(path)
  /** The folder as the index names it: root-relative. */
  const folder = relTo(root, path)
  const record = useMemo(() => folderRecord(feed.folders, path), [feed.folders, path])
  /** null = no snapshot yet: a folder with no settings file is the defaults, so only the index can say which this is. */
  const indexed = feed.resolve !== null
  const settings = useMemo(() => (indexed ? folderSettings(record, ids) : null), [indexed, record, ids])
  const rows = useMemo(() => folderRows(feed.records, feed.folders, folder), [feed.records, feed.folders, folder])
  /** The folder's id: the name of its block in a note. None until its `.folder.md` holds one — then every value reads as empty. */
  const id = record?.id

  // ---------- Other files (YAZ-4597, D43-D46) ----------
  /** The folder's own "Show Other files": `undefined` follows Settings › Folder pages (default on). */
  const [showOtherFiles, setShowOtherFiles] = useAheadKey(record === undefined ? undefined : showOtherFilesOf(record.properties))
  const trayOn = showOtherFiles ?? (folderPages ?? DEFAULT_FOLDER_PAGES).showOtherFiles
  /** The `other_files` links AHEAD of the index, as `ahead` holds the columns: a move shows at once; null = the index leads. */
  const [aheadOther, setAheadOtherState] = useState<string[] | null>(null)
  const aheadOtherRef = useRef<string[] | null>(null)
  const setAheadOther = (next: string[] | null): void => {
    aheadOtherRef.current = next
    setAheadOtherState(next)
  }
  const indexOther = JSON.stringify(settings?.otherFiles ?? [])
  const otherLinks = aheadOther ?? settings?.otherFiles
  /**
   * The moved notes, note path → its link, in `other_files` order: a link that names a note of this folder (`rows`),
   * once. The next write keeps only these, so a deleted or moved-away note leaves the list then, as fills do (D44).
   * None while the tray is off.
   */
  const moved = useMemo(() => {
    const out = new Map<string, string>()
    const resolve = feed.resolve
    if (!trayOn || resolve === null || otherLinks === undefined) return out
    const here = new Set(rows.map((row) => row.path))
    for (const link of otherLinks) {
      const target = exactLinkTarget(link)
      const path = target === null ? null : resolve(target)
      if (path !== null && here.has(path) && !out.has(path)) out.set(path, link)
    }
    return out
  }, [trayOn, otherLinks, rows, feed.resolve])
  const trayNotes = useMemo(() => {
    const byPath = new Map(rows.map((row) => [row.path, row]))
    return [...moved.keys()].map((path) => byPath.get(path)!)
  }, [moved, rows])
  /** This render's moves, for the stable doors below and a toast's Undo, which runs later. */
  const latestTray = useRef<{ toTray: (path: string, undoable?: boolean) => void; back: (path: string, undoable?: boolean) => void } | null>(null)
  const moveToTray = useCallback((path: string) => latestTray.current?.toTray(path), [])
  const moveBack = useCallback((path: string) => latestTray.current?.back(path), [])

  /** The rows as the views read them (D19): each row's `properties` are THIS folder's values for the note — or, where the vault does not use IDs, the note's own. A note moved to Other files is in none of them. */
  const shown = useMemo(() => {
    const inViews = moved.size === 0 ? rows : rows.filter((row) => !moved.has(row.path))
    return ids ? inViews.map((row) => ({ ...row, properties: folderValues(row.properties, id) })) : inViews
  }, [rows, moved, id, ids])
  /**
   * The direct subfolders as rows (YAZ-4579 D31), off the Files tree — it knows a folder with no `.folder.md` — and the
   * settings records. A new resolver is the feed's word that the tree's folders moved (`WikilinkIndexBridge`).
   */
  const subfolders = useMemo(() => subfolderRows(root, folder, vaultDirs(root), feed.folders), [root, folder, feed.folders, feed.resolve])
  /** As the views read them, like `shown`: this folder's block, or the file's own keys less the view settings block (the views' own). */
  const shownSubfolders = useMemo(
    () => subfolders.map((row) => ({ ...row, properties: ids ? folderValues(row.properties, id) : withoutSettings(row.properties) })),
    [subfolders, id, ids],
  )
  /** The read-only notes (YAZ-3076 D6), read off each note's OWN properties before `shown` swaps in the folder's values; a folder row's off its `.folder.md` (D32). */
  const locked = useMemo(() => readOnlyPaths([...rows, ...subfolders]), [rows, subfolders])
  /** The folder's own properties panel opens its link pills as the cells do (YAZ-4544 4G); the cells' card is the views' own. */
  const panelLinks = useMemo(() => ({ open: { onOpenFile, onOpenFileBackground, onOpenFileRight } }), [onOpenFile, onOpenFileBackground, onOpenFileRight])

  // ---------- The toolbar (YAZ-3746 D35) ----------
  /** The toolbar's store: the save state of the folder's own writes, the Page tab's part, and the lock for the Page tab. */
  const [chips] = useState(() => createStore<FolderChipsState>({ save: 'saved', page: null, readOnly: false }))
  /** The folder page is read only (D36): `readonly: true` in its `.folder.md`. The notes inside keep their own rule. */
  const [pageLocked, setPageLocked] = useAheadKey(record !== undefined && isReadOnlyProperties(record.properties))
  /** The folder's own "Show folder page file" (D37): `undefined` follows Settings. */
  const [showPageFile, setShowPageFile] = useAheadKey(record === undefined ? undefined : showPageFileOf(record.properties))
  /** The folder's own "Preview on hover" (YAZ-4601 D51): `undefined` follows Settings; it rules the row and pill hovers here. */
  const [ownHover, setOwnHover] = useAheadKey(record === undefined ? undefined : hoverPreviewOf(record.properties))
  const [askingUnlock, setAskingUnlock] = useState(false)
  useEffect(() => {
    chips.set({ readOnly: pageLocked })
    if (!pageLocked) setAskingUnlock(false)
  }, [chips, pageLocked])
  /** Per app tab and never stored, as a note's (D35). */
  const [zoom, setZoom] = useState(100)
  /** The folder's writes in flight, and whether one of them failed: the save chip says 'saving' until all settle. */
  const writing = useRef({ count: 0, failed: false })
  const hostRef = useRef<HTMLDivElement>(null)
  const ready = feed.resolve !== null && settings !== null
  // This page owns ⌘+ / ⌘− / ⌘0 while focus is in its section, as a note does (YAZ-1710). A note inside it (the Page
  // tab) claims them first.
  useEffect(() => {
    const section = hostRef.current?.closest('.editor')
    if (!ready || !section) return
    const onZoomKey = (event: Event) => {
      if (event.defaultPrevented) return
      event.preventDefault()
      const step = (event as CustomEvent<ZoomStep>).detail
      setZoom((now) => (step === 0 ? 100 : stepZoomByKey(now, step) ?? now))
    }
    section.addEventListener(ZOOM_EVENT, onZoomKey)
    return () => section.removeEventListener(ZOOM_EVENT, onZoomKey)
  }, [ready])

  /**
   * The settings file's own BYTES (D9), which the properties panel and the comments read as a note's
   * do its `diskFile`: re-read whenever the index record moves — the watcher's word that the file
   * changed, our own writes included. A folder the index knows no settings file for is '' with
   * nothing read, and this page writes nothing until its first change creates it (`writeProperty.ts`).
   * null until the bytes are known: the comment stream decides its fold once, at mount.
   */
  const [disk, setDisk] = useState<Pick<FileResponse, 'path' | 'content' | 'mtime'> | null>(null)
  const revision = record?.mtime
  useEffect(() => {
    if (!indexed) return
    const missing = { path: file, content: '', mtime: 0 }
    if (revision === undefined) return setDisk(missing)
    let cancelled = false
    api.readFile(file).then(
      (fresh) => !cancelled && setDisk(fresh),
      () => !cancelled && setDisk(missing), // gone since the index saw it
    )
    return () => {
      cancelled = true
    }
  }, [file, indexed, revision])

  const [parsed, setParsed] = useState<ParsedViews | null>(() => (settings === null ? null : folderViewSet(settings, ids)))
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [columnError, setColumnError] = useState<string | null>(null)

  /**
   * The declarations AHEAD of the index (YAZ-1549) — `parsed`'s discipline for `views`, applied to
   * `columns`: every `setColumn` / `setColumns` write lands here first, a rejection puts back what
   * stood before it (and the banner says why), and the index echo that carries the same columns
   * clears it. Null = the index leads. `liveSettings` below is what every consumer reads — the menus'
   * spreads, the `base` a declaration write is checked against, the block every write states — so a
   * column added a moment ago can not be dropped by the next write.
   */
  const [ahead, setAheadState] = useState<Record<string, ColumnDecl> | null>(null)
  const aheadRef = useRef<Record<string, ColumnDecl> | null>(null)
  /** This render's host (YAZ-4591): a rename's Undo runs later, and writes through the host that is current then. */
  const latestHost = useRef<FolderHost | null>(null)
  const latestParsed = useRef<ParsedViews>(null as unknown as ParsedViews)
  /** This render's declaration door, for a rename's Undo (YAZ-4637 M5). */
  const latestDeclaration = useRef<(key: string, next: ColumnDecl, base: ColumnDecl | undefined, rename?: { from: string; to: string }) => Promise<unknown>>(() => Promise.resolve())
  const setAhead = (next: Record<string, ColumnDecl> | null): void => {
    aheadRef.current = next
    setAheadState(next)
  }
  const indexColumns = settings === null ? '' : columnsStamp(settings.columns)
  /**
   * The mtime the ahead writes settled at (YAZ-4637 M1): once every write that set an ahead copy has landed, the index
   * record at or past that mtime is disk WITH this page's write — so the copies clear then, whatever else disk holds
   * (an outside change rides in the same echo), and never stick on a stamp that can not match. Null while one is in flight.
   */
  const [landed, setLanded] = useState<number | null>(null)
  const aheadWrites = useRef({ count: 0, mtime: 0 })
  const aheadWrite = <T extends { mtime: number },>(write: Promise<T>): Promise<T> => {
    const w = aheadWrites.current
    if (w.count === 0) w.mtime = 0
    w.count += 1
    setLanded(null)
    const settle = (mtime: number | null) => {
      w.count -= 1
      if (mtime !== null) w.mtime = Math.max(w.mtime, mtime)
      if (w.count === 0) setLanded(w.mtime || null)
    }
    write.then(({ mtime }) => settle(mtime), () => settle(null))
    return write
  }
  useEffect(() => {
    const echoed = revision !== undefined && landed !== null && revision >= landed
    if (aheadRef.current !== null && (echoed || indexColumns === columnsStamp(aheadRef.current))) setAhead(null)
    if (aheadOtherRef.current !== null && (echoed || JSON.stringify(aheadOtherRef.current) === indexOther)) setAheadOther(null)
  }, [indexColumns, indexOther, revision, landed])
  const liveSettings = useMemo(
    () => (settings === null ? null : ahead === null && aheadOther === null ? settings : { ...settings, columns: ahead ?? settings.columns, otherFiles: aheadOther ?? settings.otherFiles }),
    [settings, ahead, aheadOther],
  )

  // Rebuilt when the FILE's own views move — an external edit, or our own write coming back
  // through the index (identical then, since `onChange` already applied it). JSON identity is the
  // honest comparison: every read hands back a fresh copy of the views. Both halves of what
  // `folderViewSet` builds, so an edited FORMULA rebuilds the def exactly as an edited view does.
  const stamp = settings === null ? '' : stampOf(settings)
  const seen = useRef(stamp) // what the state above was built from: no rebuild on mount
  /**
   * Stamps of `onChange` writes whose index echoes are still in flight (YAZ-1241). Echoes come
   * back in write order, so an arriving snapshot found in this queue is OUR OWN stale write —
   * `parsed` already holds a state at least as new, and rebuilding from it would hand a menu
   * mid-edit an older def to edit (the two-gestures-in-a-second data loss YAZ-1234 caught).
   * Consuming one drains everything before it, so a coalesced index emit still matches.
   */
  const pending = useRef<string[]>([])
  useEffect(() => {
    if (seen.current === stamp) return
    const echo = pending.current.indexOf(stamp)
    if (echo !== -1) {
      pending.current.splice(0, echo + 1)
      seen.current = stamp // a replayed emit of this state must no-op above, not read as external
      return
    }
    pending.current = [] // a real external edit outranks every unechoed local write: disk wins
    seen.current = stamp
    setParsed(settings === null ? null : folderViewSet(settings, ids))
  }, [stamp, settings])

  const resolveLink = feed.resolve
  if (resolveLink === null || settings === null || liveSettings === null || parsed === null) return null
  /** This render's def, for an Undo that runs later (YAZ-4637 M3). */
  latestParsed.current = parsed

  /** One of the folder's own writes (D35): the save chip says "Saving…" while any is in flight, then "Saved" or "Save failed". */
  const track = <T,>(write: Promise<T>): Promise<T> => {
    const w = writing.current
    w.count += 1
    chips.set({ save: 'saving' })
    const settle = (failed: boolean) => {
      w.count -= 1
      w.failed ||= failed
      if (w.count > 0) return
      chips.set({ save: w.failed ? 'error' : 'saved' })
      w.failed = false
    }
    write.then(() => settle(false), () => settle(true))
    return write
  }
  /** A key of the folder's own `.folder.md` that the cog sets (D36, D37); `undefined` removes it. */
  const writeOwnKey = (key: string, value: unknown): Promise<unknown> => {
    setSettingsError(null)
    const write = track(writeProperty(file, key, value))
    write.catch((err: unknown) => setSettingsError(err instanceof Error ? err.message : String(err)))
    return write
  }
  /** Read only refuses every settings write (D36): the banner says why. */
  const refuseLocked = (): boolean => {
    if (pageLocked) setSettingsError(FOLDER_READ_ONLY_TIP)
    return pageLocked
  }

  /**
   * The declarations' ONE write (YAZ-895/1549): ahead first, then disk; a refusal puts the ahead copy
   * back, shows the banner and REJECTS — so a caller that must not go on (a column delete's note
   * strips) does not.
   */
  /**
   * The block a settings write states (YAZ-4596 S38, YAZ-4637 M1): the index's — the base, disk as this page last heard
   * it — under the LIVE def (its own view writes still in flight ride again) and the caller's change. A part the caller
   * did not change is the base's, so the rebase leaves it to disk: a move to Other files in flight, or an outside
   * column change, is kept either way.
   */
  const block = (changes: Partial<Pick<FolderSettings, 'columns' | 'otherFiles' | 'views' | 'properties' | 'defaultView'>>): FolderSettings => ({
    ...settings,
    views: parsed.def.views,
    properties: parsed.def.properties,
    defaultView: parsed.def.defaultView,
    ...changes,
  })
  const commitSettings = (columns: Record<string, ColumnDecl>, views: ViewDef[], properties: ViewSet['properties']): Promise<void> => {
    if (refuseLocked()) return Promise.reject(new Error(FOLDER_READ_ONLY_TIP))
    setSettingsError(null)
    const before = aheadRef.current
    // The caller edited the live copy: what it changed there is this write's; the rest is disk's.
    const mine = columnsChanged(settings.columns, liveSettings.columns, columns)
    setAhead(columns)
    return track(aheadWrite(writeFolderSettings(file, block({ columns: mine, views, properties }), settings, ids))).then(
      () => undefined,
      (err: unknown) => {
        setAhead(before)
        setSettingsError(err instanceof Error ? err.message : String(err))
        throw err
      },
    )
  }

  /** Every config change (sort, columns, widths, summaries…) is ONE settings write (🔒 D3). `false`: read only refused it (YAZ-4644 E2). */
  const onChange = (next: ParsedViews): boolean => {
    if (refuseLocked()) return false
    setParsed(next)
    setSettingsError(null)
    // What this write will stamp as when the index returns it (YAZ-1241) — formulas ride unchanged;
    // the labels are the DEF's (YAZ-1513), since a rename is one of the edits that lands here.
    pending.current.push(stampOf({ views: next.def.views, formulas: settings.formulas, properties: next.def.properties, defaultView: next.def.defaultView }))
    // The columns are the base's (YAZ-4637 M1): this write changed none, so the rebase keeps disk's — a column added a
    // moment ago is on disk, or lands on it when that write retries after this one.
    track(writeFolderSettings(file, block({ views: next.def.views, properties: next.def.properties, defaultView: next.def.defaultView }), settings, ids)).catch((err: unknown) =>
      setSettingsError(err instanceof Error ? err.message : String(err)),
    )
    return true
  }

  /**
   * ONE declaration, ahead first (YAZ-1549): the panel sees it at once; a refusal puts back what stood before and
   * rejects to the caller, whose inline text is the report. With `rename`, the views' filters on the old label follow
   * it in the same write (YAZ-4637 M5). The host's `setColumn` and a rename's Undo both come through here.
   */
  const writeDeclaration = (key: string, next: ColumnDecl, base: ColumnDecl | undefined, rename?: { from: string; to: string }): Promise<{ mtime: number }> => {
    if (refuseLocked()) return Promise.reject(new Error(FOLDER_READ_ONLY_TIP))
    const before = aheadRef.current
    setAhead({ ...liveSettings.columns, [key]: next })
    const filters = rename === undefined ? undefined : (views: unknown) => renameOptionInFilters(views, key, rename.from, rename.to)
    return track(aheadWrite(writeFolderColumn(file, key, next, base, ids, filters))).catch((err: unknown) => {
      setAhead(before)
      throw err
    })
  }
  /**
   * S24 (YAZ-4591): the renamed option in every note that holds it — this folder's block of each indexed note
   * where the vault uses IDs (the notes `deleteColumn` reaches), the rows' own key where it does not — one
   * guarded write per note, read-only notes kept (YAZ-4637 M6: on disk too, wherever the note is). Then the toast,
   * whose Undo puts the declaration and the filters back through the LATEST host's door (its ahead copy is current)
   * and gives each changed note its exact previous value (M5).
   */
  const renameInNotes = async (key: string, next: ColumnDecl, base: ColumnDecl | undefined, { from, to }: { from: string; to: string }): Promise<void> => {
    if (ids && id === undefined) return // a folder with no id holds no values
    const home: ValueHome = ids ? { block: id! } : null
    const result = await track(renameOptionInNotes(ids ? [...feed.records, ...feed.folders] : [...rows, ...subfolders], home, key, from, to, locked))
    const undo = () => {
      const now = latestDeclaration.current
      if (base === undefined) return
      void now(key, base, next, { from: to, to: from }).then(
        () => track(restoreInPaths(result.changed, home, key)),
        (err: unknown) => onNotice?.(err instanceof Error ? err.message : String(err), 'error'),
      )
    }
    onNotice?.(renameNotice(from, to, result), 'info', 'undo', { label: 'Undo', run: undo, fades: true })
  }
  latestDeclaration.current = writeDeclaration

  /**
   * The `other_files` ONE write (YAZ-4597 D44), ahead first as `commitSettings` writes the columns: the list shows at
   * once, and a refusal puts back what stood before and shows the banner. Read only refuses it (D36).
   */
  const writeOtherFiles = (next: string[]): Promise<void> => {
    if (refuseLocked()) return Promise.reject(new Error(FOLDER_READ_ONLY_TIP))
    setSettingsError(null)
    const before = aheadOtherRef.current
    setAheadOther(next)
    return track(aheadWrite(writeFolderSettings(file, block({ otherFiles: next }), settings, ids))).then(
      () => undefined,
      (err: unknown) => {
        setAheadOther(before)
        setSettingsError(err instanceof Error ? err.message : String(err))
        throw err
      },
    )
  }
  // A move shows the S6 toast (YAZ-4541): its Undo moves the note the other way through the moves current then, with no toast.
  latestTray.current = {
    toTray: (path, undoable = true) => {
      const row = rows.find((r) => r.path === path)
      if (row === undefined || moved.has(path)) return
      writeOtherFiles([...moved.values(), noteLinkOf(row, resolveLink)]).then(
        () => undoable && onNotice?.('Moved to Other files', 'info', 'undo', { label: 'Undo', run: () => latestTray.current?.back(path, false), fades: true }),
        () => undefined,
      )
    },
    back: (path, undoable = true) => {
      if (!moved.has(path)) return
      writeOtherFiles([...moved].filter(([p]) => p !== path).map(([, link]) => link)).then(
        () => undoable && onNotice?.('Moved back to the table', 'info', 'undo', { label: 'Undo', run: () => latestTray.current?.toTray(path, false), fades: true }),
        () => undefined,
      )
    },
  }
  /** The tray takes moves while it shows and the page is not read only (D36). */
  const trayMoves = trayOn && !pageLocked

  const host: FolderHost = {
    settings: liveSettings,
    vaultRecords: feed.records,
    vaultFolders: feed.folders,
    vaultName: storage.vaultName(root),
    resolveLink,
    // A group "+" under group-by-Folder is born in that group's folder — a subfolder of this one; any other birth is here.
    // Wherever it is born, the seeded values are THIS folder's — its view is the one being satisfied — and a
    // folder with no id is given one first (`folderId`). It is titled `Untitled`, every time (YAZ-2420 🔒 D20: the
    // ids keep the files apart), unless the caller knows what it is called (YAZ-943's inline board add types one).
    // In a vault that does not use IDs (YAZ-2523 🔒 V3) the folder is given no id and a seeded value is the note's own
    // property; only the name keeps two notes apart, so an untyped one is `Untitled`, then `Untitled 2`, `Untitled 3`, …
    create: async (seed, name) => {
      const into = seed.folder !== undefined && inFolder(seed.folder, folder) ? seed.folder : folder
      const dir = into === folder ? path : absFrom(root, into)
      const block = !ids || Object.keys(seed.properties).length === 0 ? undefined : id ?? (await folderId(path))
      // No seed when the view seeds nothing: the note is then its folder's template as it is.
      const seeded =
        Object.keys(seed.properties).length === 0 && seed.tags === undefined
          ? undefined
          : (template: Record<string, unknown>): Record<string, unknown> => ({
              ...(block === undefined ? { ...template, ...seed.properties } : withFolderValues(template, block, seed.properties)),
              ...(seed.tags !== undefined && { tags: seed.tags }),
            })
      const typed = (name ?? '').trim()
      if (ids || typed !== '') return createNote(dir, typed === '' ? 'Untitled' : typed, ids, seeded)
      for (let n = 1; ; n += 1) {
        try {
          return await createNote(dir, n === 1 ? 'Untitled' : `Untitled ${n}`, false, seeded)
        } catch (err) {
          if (!(err instanceof BridgeRequestError && err.code === 'ALREADY_EXISTS')) throw err
        }
      }
    },
    // A folder with no id is given one first — the path its first shortcut uses (`folderId`) — then the value is written.
    // The same save drops the note's values for the folders that no longer show it (D20).
    // Where the vault does not use IDs the value is the note's own property, and that is all the write is.
    // A read-only note's write is refused here, the one door every view write passes (YAZ-3076 D6, S54).
    writeValues: guardReadOnly(locked, ids ? async (note, writes) => writeFolderValues(note, id ?? (await folderId(path)), writes, dropStaleFolderValues(root, note, feed.folders)) : writeProperties),
    // ONE declaration through `writeDeclaration`. An option rename (YAZ-4591 S24) goes on to the notes once the
    // declaration has landed: a refused declaration touches none.
    setColumn: (key, next, base, rename) => {
      const written = writeDeclaration(key, next, base, rename)
      return rename === undefined ? written : written.then(() => renameInNotes(key, next, base, rename))
    },
    // `settings` is the index SNAPSHOT, so it can be behind: `parsed` is rebuilt from it and is
    // otherwise ahead by unechoed local writes. Reading the def instead keeps an in-flight
    // default-view choice — or sort/filter edit, when the caller moves no `views` — from being
    // clobbered by the next column write (YAZ-1471 D4; YAZ-1234's two-gestures data loss). No
    // `pending` stamp: this echo must still read as "disk wins" and refresh `parsed` with the
    // `views` the caller moved.
    // The labels follow the same rule as the views: the caller's when it speaks, else the LIVE def's
    // (YAZ-1513). Fire-and-forget — the banner is the report; the delete below awaits the door itself.
    setColumns: (columns, views, labels) => {
      void commitSettings(columns, views ?? parsed.def.views, labels === undefined ? parsed.def.properties : labels.properties).catch(() => undefined)
    },
    // Delete column (YAZ-1513): the settings half is `commitSettings` — the same one door, the same
    // echo behaviour — AWAITED, so a refused write aborts before any note is touched; the
    // strips report into the column banner, no rollback. They reach every indexed note holding
    // the field in this folder's block. Not offered where the vault does not use IDs (YAZ-2523 🔒 V11):
    // a column there is the notes' own property, and is hidden instead.
    ...(ids && {
      deleteColumn: (key: string) =>
        deleteColumnEverywhere(key, {
          columns: liveSettings.columns,
          def: parsed.def,
          // A subfolder's `.folder.md` holds its values for this folder as a note does (YAZ-4579 D31): it is stripped too.
          records: [...feed.records, ...feed.folders],
          folderId: id,
          writeSettings: commitSettings,
          // The settings half offers Undo (YAZ-4608 C6): one settings write puts the column back; a refusal shows the banner as any settings write does.
          notice: (message, restore) => onNotice?.(message, 'info', 'undo', { label: 'Undo', run: () => void restore().catch(() => undefined), fades: true }),
          // The Undo runs later (YAZ-4637 M3): it inverts the delete on the live declarations and def current then.
          current: () => ({ columns: latestHost.current?.settings.columns ?? liveSettings.columns, def: latestParsed.current.def }),
        }).catch((err: unknown) => setColumnError(err instanceof Error ? err.message : String(err))),
    }),
    valueCount: (key: string) => notesHolding(feed.records, id, key).length + notesHolding(feed.folders, id, key).length,
    // A folder row's title is its folder's (YAZ-4579 D32): the folder is renamed, title and directory, as its page title does.
    retitle: (note, title) => {
      if (locked.has(note)) return
      if (rowPage(note) !== note) onRetitle(rowPage(note), title, 'dir')
      else onRetitle(note, title, 'file')
    },
    openRight: onOpenFileRight,
    openFolderPage: onOpenFolderPage,
    renderNoteEditor,
    openBackground: onOpenFileBackground,
    // "Delete note…" and "Duplicate note" (YAZ-4592 S26): the sidebar's delete, and a copy beside the note.
    trash: onDeleteEntries,
    duplicate: (note) =>
      void api.file.duplicate({ path: note }).catch((err: unknown) => onNotice?.(`Can't duplicate: ${err instanceof Error ? err.message : String(err)}`, 'error')),
    onNotice,
    wikilinks: source,
    // The Page's editor reads the file, so it waits for the index to know one (YAZ-4584): a "+ Page" on a folder with none creates it.
    renderPage: record === undefined ? undefined : renderPage,
  }
  latestHost.current = host
  const visibleError = settingsError ?? columnError

  return (
    // The note editor's own scroller and blocks in a note's order (D9) — title and properties, the
    // views where the body would be, the comments — so the page lines up with a note's column and
    // the table's sticky header finds the scroller it bridges to (YAZ-1151).
    <>
      <FolderToolbar
        store={chips}
        zoom={zoom}
        onZoom={setZoom}
        readOnly={pageLocked}
        // As a note's cog (YAZ-3076 D4): off turns it on at once; on opens the chip's "Allow edits?" box.
        onToggleReadOnly={() => (pageLocked ? setAskingUnlock(true) : setPageLocked(true, writeOwnKey(READ_ONLY_KEY, true)))}
        asking={askingUnlock}
        onAsk={() => setAskingUnlock(true)}
        onAllow={() => {
          setAskingUnlock(false)
          setPageLocked(false, writeOwnKey(READ_ONLY_KEY, undefined))
        }}
        onCancel={() => setAskingUnlock(false)}
        showPageFile={showPageFile}
        onChangeShowPageFile={(next) => setShowPageFile(next, writeOwnKey(SHOW_PAGE_FILE_KEY, next))}
        hoverPreview={ownHover}
        onChangeHoverPreview={(next) => setOwnHover(next, writeOwnKey(HOVER_PREVIEW_KEY, next))}
        showOtherFiles={showOtherFiles}
        onChangeShowOtherFiles={(next) => setShowOtherFiles(next, writeOwnKey(SHOW_OTHER_FILES_KEY, next))}
        sync={sync}
        onSyncNow={onSyncNow}
      />
      <div ref={hostRef} className="editor-host" style={{ '--document-zoom': zoom / 100 } as CSSProperties}>
        <div className="page-header">
          {/* Read only (D36) locks the title and the folder's own properties, as a note's does. */}
          <PageTitle path={path} kind="dir" titles={titles} readOnly={pageLocked} onRetitle={(title) => onRetitle(path, title, 'dir')} />
          {disk !== null && <MemoFrontmatterPanel file={disk} root={root} properties={properties} wikilinks={source} readOnly={pageLocked} links={panelLinks} />}
        </div>
        <section className="folder-view">
          {visibleError !== null && (
            <p className="views-pane__error" role="alert">
              Could not update the folder: {visibleError}
            </p>
          )}
          {/* The Page tab (10D) hands the toolbar its part through `FolderPageChips` (YAZ-3746 D35). */}
          <FolderPageChips.Provider value={chips}>
            {/* The skins mark a row that is here by a shortcut (D2): they are told which folder "here" is. */}
            <ViewFolder.Provider value={folder}>
              {/* The views' row menus and drags reach the tray through this door; a tray note dropped here moves back (YAZ-4597). */}
              <OtherFilesMove.Provider value={trayMoves ? moveToTray : null}>
              <div className="folder-view__views" {...trayBackTarget(trayMoves ? moveBack : null)}>
              <ViewsPane
                parsed={parsed}
                onChange={onChange}
                root={root}
                folderPath={path}
                tabId={tabId}
                viewKey={viewKey}
                records={shown}
                folderRows={shownSubfolders}
                readOnly={locked}
                properties={properties}
                onOpenFile={onOpenFile}
                folder={host}
                hoverPreview={ownHover ?? hoverPreview}
                previewScope={previewScope}
                diagramDarkColors={diagramDarkColors}
                folderPages={folderPages}
              />
              </div>
              </OtherFilesMove.Provider>
            </ViewFolder.Provider>
          </FolderPageChips.Provider>
          {trayOn && (
            <OtherFiles
              root={root}
              dir={path}
              notes={trayNotes}
              onOpen={onOpenFile}
              onOpenBackground={onOpenFileBackground}
              onNotice={onNotice}
              onMoveBack={trayMoves ? moveBack : null}
              onTakeRow={trayMoves ? (row) => latestTray.current?.toTray(row) : null}
            />
          )}
        </section>
        {disk !== null && <MemoCommentsSection file={disk} order={commentsOrder} onChangeOrder={onChangeCommentsOrder} />}
        {/* The notes and folders that link to the FOLDER (D10): its path is what such a link resolves to. */}
        <MemoBacklinksSection path={path} source={source} openCurrent={onOpenFile} openBackground={onOpenFileBackground} />
      </div>
    </>
  )
}
