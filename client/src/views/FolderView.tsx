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
 *  - COLUMNS (YAZ-4713 C2): the page's own columns and its parent folders' (`columnInheritance.ts`), the nearest
 *    declaration of a key first — unless "Show parent folders' columns" is off (the folder's ⚙, else Settings ›
 *    Folder pages). The views read them as `settings.columns`, and `columns` says which folder owns each.
 *  - VALUES (C1): a note's value for a column is the note's own top-level field, one per key, the same on every
 *    page. This host is the one seam: the views get rows whose `properties` are the note's fields less the app's
 *    keys, and every value they write comes back through `writeValues` (`writeRouted`). A column set to "Separate
 *    value for <folder>" (C3, vaults with IDs) reads and writes this folder's block of `in` instead
 *    (`shared/folderValues.ts`). A column is never stamped into a note (E1), and a write drops no value (C9). Where
 *    the vault does not use IDs (YAZ-2523 🔒 V6) no column is deleted.
 *  - SUBFOLDERS AS ROWS (YAZ-4579 D31): each direct subfolder is a row too, for the views whose "Subfolders"
 *    switch asks for it — its `.folder.md`, read and written like a note: its values are its own top-level keys
 *    (a separate column's, its block of `in`), and its first write creates the file.
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
import { useUnit } from '../vault/unitWord'
import { memo, type CSSProperties, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ColumnDecl } from './folderSettings'
import { withOrder } from './view/columnOrder'
import { canonicalKey } from './view/keys'
import { valueHistory } from './view/valueHistory'
import { stringify } from 'yaml'
import { folderValues, withFolderValues } from '@shared/folderValues'
import { DEFAULT_FOLDER_PAGES, folderSettingsPath, inFolder, type CommentsOrder, type DiagramDarkColors, type FileResponse, type FolderPagesSettings, type GithubSyncStatus, type IndexRecord, type PropertiesResponse, type ZoomStep } from '@shared/types'
import { COLUMN_MARKS_KEY, CONFIRM_CHANGES_KEY, HOVER_LINKS_KEY, HOVER_PREVIEW_KEY, HOVER_ROWS_KEY, INHERIT_COLUMNS_KEY, SHOW_NEW_BUTTONS_KEY, SHOW_OTHER_FILES_KEY, SHOW_PAGE_FILE_KEY, columnMarksOf, confirmChangesOf, hoverLinksOf, hoverPreviewOf, hoverRowsOf, inheritColumnsOf, showNewButtonsOf, showOtherFilesOf, showPageFileOf } from '@shared/folderPage'
import { exactLinkTarget } from '@shared/linkRewrite'
import { findKey, heldKey, keyFold, respell, spellings } from '@shared/propertyKeys'
import { isReadOnlyProperties, READ_ONLY_KEY } from '@shared/readOnly'
import { api, BridgeRequestError } from '../api'
import { CommentsSection } from '../comments/CommentsSection'
import { FrontmatterPanel } from '../editor/FrontmatterPanel'
import { PageTitle } from '../editor/PageTitle'
import { usePathTitles } from '../lib/pageLabel'
import { absFrom, dirname, relTo } from '../lib/paths'
import { storage } from '../lib/storage'
import { createStore } from '../lib/store'
import { stepZoomByKey } from '../editor/DocumentZoom'
import { ZOOM_EVENT } from '../editor/zoomRequest'
import { useIndexFeed } from '../editor/wikilink/useIndexFeed'
import type { WikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { BacklinksSection } from '../links/BacklinksSection'
import { alsoIn } from '@shared/alsoIn'
import { addShortcut, folderId, folderRecord, folderRows, isShortcut, removeShortcut, rowPage, setShortcutEntries, subfolderRows } from '../links/shortcuts'
import { ShortcutActions, type ShortcutDoors } from './view/shortcutDoors'
import { columnReservedKeys, reservedKeyText } from '../links/reservedKeys'
import { vaultDirs } from '../links/folderLinks'
import { type ParsedViews, type ViewDef, type ViewSet, parseViews, rewriteViews, serializeViews, updateViews } from './viewSchema'
import { ViewsPane, type FolderHost } from './ViewsPane'
import { folderSettings, moveFolderColumn, rewriteFolderViews, writeFolderSettings, writeFolderColumn, type FolderSettings } from './folderSettings'
import { deleteColumn as deleteColumnEverywhere, notesHolding } from './deleteColumn'
import { renameNotice, renameOptionInFilters, renameOptionInNotes, restoreInPaths, type ValueHome } from './renameOption'
import { createNote } from './scaffold'
import { propertyLabel, type RunOptions } from './engine'
import { mentionsColumns } from './mentionsColumn'
import { addTiedColumn, removeTiedColumn, tiedKeyFor, tiedKeyOf, writeTiedCell, type PairWritten } from './relationPair'
import { guardReadOnly, readOnlyPaths } from './readOnlyRows'
import { writeProperties, writeProperty, writeRouted, type PropertyWrite } from './writeProperty'
import { byFolder, declarationOf, folderName, foldersTaking, pageColumns, readOnlyRefusal, selfAndAncestors, takesFrom, withOwnerSwitch, type ColumnSources } from './columnInheritance'
import { mergeSeparateValues, restoreSeparateValues, separateCounts, separateHolders, type SeparateKeep } from './separateValues'
import { FOLDER_READ_ONLY_TIP, FolderPageChips, FolderToolbar, type FolderChipsState } from './FolderToolbar'
import { useTimedUnlock } from '../editor/useTimedUnlock'
import { VAULT_READ_ONLY_TIP, VaultReadOnly } from '../vault/readOnlyVault'
import { ViewFolder } from './view/GroupHeader'
import { noteLinkOf } from './view/fills'
import { OtherFiles, trayBackTarget } from './view/OtherFiles'
import { OtherFilesFolderMove, OtherFilesMove, type FolderTray } from './view/otherFilesMove'
import { ConfirmSheet } from '../components/ConfirmSheet'
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
  /** The mini window's ↗ (YAZ-3746 13I): App's `openNewTabPage`. Handed to `ViewsPane` as `FolderHost.openNewTab`. */
  onOpenFileNewTab?: (path: string) => void
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
  /** Settings › Folder pages › Preview rows on hover (YAZ-3403, `hoverOn(settings, 'folderViews')`), with what its panel needs: handed to `ViewsPane` and the Other files tray. */
  hoverPreview?: boolean
  /** Settings › Folder pages › Preview links on hover (demo 13D, `hoverOn(settings, 'folderLinks')`): the link pills in cells, handed to `ViewsPane`. */
  hoverLinks?: boolean
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
/** The two Other files lists as one write (YAZ-4747): `other_files`, and its folders that keep their notes. */
interface TrayLists {
  links: string[]
  keep: string[]
}

/** One render's tray moves: a note's, a folder's (YAZ-4747), and the folder door's questions. */
interface TrayMoves {
  toTray: (path: string, undoable?: boolean) => void
  /** Back to the table: a moved note, or a moved folder by its directory. */
  back: (path: string, undoable?: boolean) => void
  toTrayFolder: (dir: string, notes: boolean, undoable?: boolean) => void
  folderOf: FolderTray['folderOf']
  folderAt: FolderTray['folderAt']
  askFolder: (dir: string, shown: readonly string[]) => void
}

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

/** A row's values with each tied column's links on it (YAZ-4781 R2); the same object when the page has none. */
function withTied(properties: Record<string, unknown>, row: IndexRecord, tied: RunOptions['mentions']): Record<string, unknown> {
  if (tied === undefined) return properties
  const out = { ...properties }
  for (const key of tied.keys) out[key] = tied.of(row, key)
  return out
}

/**
 * A row's values as the views read them (YAZ-4713 C1/C3): its file's own fields less the keys no column may have
 * (`columnReservedKeys`: the app's, and a subfolder row's settings block, D31) — but the read-only switch, which a view
 * may still show (YAZ-3130) — and each separate column's value from this page's block. The same object when nothing changes.
 *
 * YAZ-4769 (one key, capitals ignored): each field whose key is a page column's in other capitals reads under the
 * column's spelling (`spell`, `respell`): a note's `dessert column` is the `Dessert Column` cell, so every view, filter,
 * sort, group, board and calendar reads it with no fold of its own. A note holding two spellings shows the column's;
 * the other stays in the file, and is no second column. The app's keys are never moved. A separate value is found in
 * the page's block in any capitals too.
 */
function rowValues(properties: Record<string, unknown>, reserved: ReadonlySet<string>, pageId: string | undefined, separate: ReadonlySet<string>, spell: ReadonlyMap<string, string>): Record<string, unknown> {
  const keys = Object.keys(properties)
  const kept = keys.some((key) => reserved.has(key) && key !== READ_ONLY_KEY) ? Object.fromEntries(keys.filter((key) => !reserved.has(key) || key === READ_ONLY_KEY).map((key) => [key, properties[key]])) : properties
  const own = respell(kept, spell, reserved)
  if (separate.size === 0) return own
  const block = folderValues(properties, pageId)
  const out = { ...own }
  for (const key of separate) {
    const held = heldKey(block, key)
    if (held !== undefined) out[key] = block[held]
    else delete out[key]
  }
  return out
}

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
/**
 * The ask's text under its title (YAZ-4747 OF2): how many of the folder's notes the table shows, with the subfolders
 * that hold some, and what each answer does to them.
 */
export function folderTrayMessage(count: number, inside: readonly string[]): string {
  const notes = `${count} ${count === 1 ? 'note' : 'notes'}`
  const where = inside.length === 0 ? '' : inside.length <= 2 ? `, with the ones in ${inside.join(' and ')}` : `, with the ones in its ${inside.length} subfolders`
  return `It holds ${notes}${where}. Move them with it, and they leave this table. Move the folder only, and they stay.`
}

const stampOf = (s: Pick<FolderSettings, 'views' | 'formulas' | 'properties' | 'defaultView'>): string =>
  JSON.stringify([s.views, s.formulas ?? null, s.properties ?? null, s.defaultView ?? null])

/** A folder page's writes land at once: nothing to save when its timed unlock ends (YAZ-4939). */
const noFlush = (): void => undefined

export function FolderView({
  path,
  root,
  source,
  properties = null,
  onOpenFile,
  onOpenFileRight,
  onOpenFileBackground,
  onOpenFolderPage,
  onOpenFileNewTab,
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
  hoverLinks,
  previewScope,
  diagramDarkColors,
  sync,
  onSyncNow,
  folderPages,
}: FolderViewProps) {
  const unit = useUnit()
  const feed = useIndexFeed(source)
  const titles = usePathTitles(source)
  /** Does the vault use IDs (YAZ-2523 🔒 V5)? Everything ID-only below asks this, and nothing under the host does. */
  const ids = source.ids

  /** Where the settings live (D1) — and the file every write below goes to, created by the first one. */
  const file = folderSettingsPath(path)
  /** The folder as the index names it: root-relative. */
  const folder = relTo(root, path)
  const record = useMemo(() => folderRecord(feed.folders, path), [feed.folders, path])
  /** The settings records by folder, once per snapshot: every owner, parent and subfolder lookup below reads it. */
  const folderMap = useMemo(() => byFolder(feed.folders), [feed.folders])
  const vaultName = storage.vaultName(root)
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
  /** The `other_files` and `other_files_keep_notes` links AHEAD of the index, as `ahead` holds the columns: a move shows at once; null = the index leads. */
  const [aheadOther, setAheadOtherState] = useState<TrayLists | null>(null)
  const aheadOtherRef = useRef<TrayLists | null>(null)
  const setAheadOther = (next: TrayLists | null): void => {
    aheadOtherRef.current = next
    setAheadOtherState(next)
  }
  const indexOther = JSON.stringify({ links: settings?.otherFiles ?? [], keep: settings?.otherFilesKeepNotes ?? [] })
  const otherLinks = aheadOther?.links ?? settings?.otherFiles
  const keepLinks = aheadOther?.keep ?? settings?.otherFilesKeepNotes
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
  /** This render's moves, for the stable doors below and a toast's Undo, which runs later. */
  const latestTray = useRef<TrayMoves | null>(null)
  const moveToTray = useCallback((path: string) => latestTray.current?.toTray(path), [])
  const moveBack = useCallback((path: string) => latestTray.current?.back(path), [])
  /** The views' door for a whole subfolder (YAZ-4747 OF1): stable, through this render's moves. */
  const folderDoor = useMemo<FolderTray>(
    () => ({
      folderOf: (rowPath) => latestTray.current?.folderOf(rowPath) ?? null,
      folderAt: (rel) => latestTray.current?.folderAt(rel) ?? null,
      move: (dir, shown) => latestTray.current?.askFolder(dir, shown ?? []),
    }),
    [],
  )
  /** The ask before a folder moves with notes the table shows (YAZ-4747 OF2). */
  const [folderAsk, setFolderAsk] = useState<{ dir: string; name: string; count: number; inside: string[] } | null>(null)
  /** A tied cell's replace ask (YAZ-4781 R2), open: its words and the answer's door. */
  const [pairAsk, setPairAsk] = useState<{ text: string; answer: (ok: boolean) => void } | null>(null)
  /** Each tied cell's last written list until the index shows it (R2): two quick edits diff against the first, not the stale snapshot. */
  const tiedSent = useRef(new Map<string, { resolve: unknown; value: unknown }>())

  /**
   * The direct subfolders as rows (YAZ-4579 D31), off the Files tree — it knows a folder with no `.folder.md` — and the
   * settings records. A new resolver is the feed's word that the tree's folders moved (`WikilinkIndexBridge`).
   */
  const subfolders = useMemo(() => subfolderRows(root, folder, vaultDirs(root), feed.folders), [root, folder, feed.folders, feed.resolve])
  /**
   * The subfolders moved to Other files (YAZ-4747 OF5), directory → its link and whether its notes go with it, in
   * `other_files` order: a link that names a direct subfolder of this page. A folder in `other_files_keep_notes` keeps
   * its notes in the views. None while the tray is off.
   */
  const movedFolders = useMemo(() => {
    const out = new Map<string, { link: string; notes: boolean; name: string }>()
    const resolve = feed.resolve
    if (!trayOn || resolve === null || otherLinks === undefined) return out
    const names = new Map(subfolders.map((row) => [rowPage(row.path), row.title]))
    const pathOf = (link: string): string | null => {
      const target = exactLinkTarget(link)
      return target === null ? null : resolve(target)
    }
    const keep = new Set((keepLinks ?? []).map(pathOf))
    for (const link of otherLinks) {
      const dir = pathOf(link)
      const name = dir === null ? undefined : names.get(dir)
      if (dir !== null && name !== undefined && !out.has(dir)) out.set(dir, { link, notes: !keep.has(dir), name })
    }
    return out
  }, [trayOn, otherLinks, keepLinks, subfolders, feed.resolve])
  /** The directories whose notes left the views with their folder: a note under one is in no view. */
  const goneDirs = useMemo(() => [...movedFolders].filter(([, f]) => f.notes).map(([dir]) => `${dir}/`), [movedFolders])
  const inGoneDir = useCallback((notePath: string) => goneDirs.some((prefix) => notePath.startsWith(prefix)), [goneDirs])
  /** The tray's moved notes: a note inside a folder that went with its notes shows under that folder, not on its own. */
  const trayNotes = useMemo(() => {
    const byPath = new Map(rows.map((row) => [row.path, row]))
    return [...moved.keys()].filter((p) => !inGoneDir(p)).map((p) => byPath.get(p)!)
  }, [moved, rows, inGoneDir])
  const trayFolders = useMemo(() => [...movedFolders].map(([dir, f]) => ({ dir, name: f.name })), [movedFolders])
  /** The vault's Read only (YAZ-4939), and this tab's timed "Allow edits": one unlock for the page, its settings and its cells. */
  const vault = useContext(VaultReadOnly)
  const unlock = useTimedUnlock(noFlush)
  const vaultLockedHere = vault.on && unlock.until === null
  /**
   * The read-only notes (YAZ-3076 D6), read off each note's OWN properties before `shown` swaps in the folder's values; a folder row's off its `.folder.md` (D32).
   * In a read-only vault (YAZ-4939) every row's cell is locked until this tab's unlock; each note's own switch then still holds.
   */
  const locked = useMemo(() => (vaultLockedHere ? new Set([...rows, ...subfolders].map((r) => r.path)) : readOnlyPaths([...rows, ...subfolders])), [rows, subfolders, vaultLockedHere])
  /**
   * The shortcut doors of this page's rows (YAZ-4797 demo): where a shortcut lives, Go to it, Remove the shortcut, Add one
   * to another folder. Vaults with IDs only (a shortcut names its folder by id). Each write is the sidebar's own
   * (`addShortcut` / `removeShortcut`), and its toast's Undo is the other one.
   */
  const shortcutDoors = useMemo((): ShortcutDoors | null => {
    if (!ids) return null
    const nameAt = (rel: string) => folderName(folderMap, rel, vaultName)
    const titleOf = (note: string) => rows.find((r) => r.path === note)?.title ?? note.slice(note.lastIndexOf('/') + 1)
    const fail = (err: unknown) => onNotice?.(err instanceof Error ? err.message : String(err), 'error')
    const pageName = nameAt(folder)
    // Each Undo takes back exactly what its action changed (checker 8E): never a folder under it, never one that was there before.
    const undo = (note: string, change: { drop?: readonly unknown[]; restore?: readonly unknown[] }) => () => void setShortcutEntries(note, change).catch(fail)
    const remove = (note: string): void =>
      void removeShortcut(path, note, feed.folders).then(
        (removed) => removed.length > 0 && onNotice?.(`Removed the shortcut to "${titleOf(note)}" from ${pageName}`, 'info', 'undo', { label: 'Undo', run: undo(note, { restore: removed }), fades: true }),
        fail,
      )
    const add = (note: string, dir: string): void =>
      void addShortcut(dir, note).then(
        (added) =>
          added === null
            ? onNotice?.(`"${titleOf(note)}" is already in ${nameAt(relTo(root, dir))}`, 'info')
            : onNotice?.(`Added a shortcut to "${titleOf(note)}" in ${nameAt(relTo(root, dir))}`, 'info', 'undo', { label: 'Undo', run: undo(note, { drop: [added] }), fades: true }),
        fail,
      )
    return {
      pageName,
      homeOf: (note) => {
        const record = rows.find((r) => r.path === note)
        return record === undefined || !isShortcut(record, folder) ? null : { dir: absFrom(root, record.folder), name: nameAt(record.folder) }
      },
      goHome: (dir) => onOpenFolderPage?.(dir),
      remove: (note) => remove(note),
      add: (note, dir) => add(note, dir),
      folders: () => vaultDirs(root).map((dir) => ({ dir, name: nameAt(relTo(root, dir)), path: relTo(root, dir) })),
      holders: (note) => {
        const record = rows.find((r) => r.path === note)
        if (record === undefined) return new Set([note.slice(0, note.lastIndexOf('/'))])
        const ids = new Set(alsoIn(record.properties))
        const shortcutDirs = [...folderMap].filter(([, f]) => f.id != null && ids.has(f.id)).map(([rel]) => absFrom(root, rel))
        return new Set([absFrom(root, record.folder), ...shortcutDirs])
      },
      locked: (note) => locked.has(note),
    }
  }, [ids, folderMap, vaultName, rows, folder, path, root, feed.folders, onNotice, onOpenFolderPage, locked])
  /** The folder's own properties panel opens its link pills as the cells do (YAZ-4544 4G); the cells' card is the views' own. */
  const panelLinks = useMemo(() => ({ open: { onOpenFile, onOpenFileBackground, onOpenFileRight } }), [onOpenFile, onOpenFileBackground, onOpenFileRight])

  // ---------- The toolbar (YAZ-3746 D35) ----------
  /** The toolbar's store: the save state of the folder's own writes, the Page tab's part, and the lock for the Page tab. */
  const [chips] = useState(() => createStore<FolderChipsState>({ save: 'saved', page: null, readOnly: false }))
  /** The folder page's own Read only (D36): `readonly: true` in its `.folder.md`. The notes inside keep their own rule. */
  const [pageLocked, setPageLocked] = useAheadKey(record !== undefined && isReadOnlyProperties(record.properties))
  /** The page is under Read only — its own switch or the vault's (YAZ-4939): the chip shows. Locked for real until this tab's unlock. */
  const pageBase = pageLocked || vault.on
  const pageEffective = pageBase && unlock.until === null
  /** The folder's own "Show folder page file" (D37): `undefined` follows Settings. */
  const [showPageFile, setShowPageFile] = useAheadKey(record === undefined ? undefined : showPageFileOf(record.properties))
  /** The folder's own "Preview rows on hover" and "Preview links on hover" (YAZ-4601 D51, split by demo 13D): `undefined` follows Settings. Each reads the legacy `hover_preview` where its own key is absent. */
  const [ownRows, setOwnRows] = useAheadKey(record === undefined ? undefined : hoverRowsOf(record.properties))
  const [ownLinks, setOwnLinks] = useAheadKey(record === undefined ? undefined : hoverLinksOf(record.properties))
  /** The folder's own "Confirm changes" (YAZ-3746 13AN): `undefined` follows Settings › Folder pages (on by default). */
  const [ownConfirm, setOwnConfirm] = useAheadKey(record === undefined ? undefined : confirmChangesOf(record.properties))
  /** The folder's own "Show New buttons" (YAZ-3746 13BL): `undefined` follows Settings › Folder pages (on by default). */
  const [ownNew, setOwnNew] = useAheadKey(record === undefined ? undefined : showNewButtonsOf(record.properties))
  /** The folder's own "Show parent folders' columns" (YAZ-4713 C12): `undefined` follows Settings › Folder pages (on by default). */
  const [ownInherit, setOwnInherit] = useAheadKey(record === undefined ? undefined : inheritColumnsOf(record.properties))
  const inheritOn = ownInherit ?? (folderPages ?? DEFAULT_FOLDER_PAGES).inheritColumns
  /** The folder's own "Show where columns come from" (C11): `undefined` follows Settings › Folder pages (on by default). */
  const [ownMarks, setOwnMarks] = useAheadKey(record === undefined ? undefined : columnMarksOf(record.properties))
  const marks = ownMarks ?? (folderPages ?? DEFAULT_FOLDER_PAGES).columnMarks
  const [askingUnlock, setAskingUnlock] = useState(false)
  useEffect(() => {
    chips.set({ readOnly: pageEffective })
    if (!pageBase) setAskingUnlock(false)
  }, [chips, pageEffective, pageBase])
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
  const latestParsed = useRef<ParsedViews>(null as unknown as ParsedViews)
  /** The newest render's settings door, for an Undo that runs later (YAZ-3746 13AY): an old door compares against old settings. */
  const latestCommit = useRef<((columns: Record<string, ColumnDecl>, views: ViewDef[], properties: ViewSet['properties']) => Promise<void>) | null>(null)
  /** The folder's own live declarations, for a delete's Undo that runs later (YAZ-4637 M3): the host's `settings` are the page's columns (YAZ-4713 C2). */
  const latestOwnColumns = useRef<Record<string, ColumnDecl>>({})
  /** This render's declaration door, for a rename's Undo (YAZ-4637 M5). */
  const latestDeclaration = useRef<(key: string, next: ColumnDecl, base: ColumnDecl | undefined, rename?: { from: string; to: string }, here?: boolean) => Promise<unknown>>(() => Promise.resolve())
  /**
   * Inherited declarations AHEAD of the index (YAZ-4713 C6): an edit written to the owner's `.folder.md` shows here at
   * once, as `ahead` does for the folder's own. An entry goes when the owner's record echoes it (the same declaration, or
   * a record at or past the write's mtime), and a refused write puts back what stood before.
   */
  const [aheadParents, setAheadParents] = useState<Readonly<Record<string, { owner: string; decl: ColumnDecl; mtime?: number }>>>({})
  useEffect(() => {
    const keys = Object.keys(aheadParents)
    if (keys.length === 0) return
    const gone = keys.filter((key) => {
      const { owner, decl, mtime } = aheadParents[key]
      const record = folderMap.get(owner)
      const onDisk = record === undefined ? undefined : folderSettings(record, ids).columns[key]
      // The page's copy never carries the owner's "Separate value" switch (C3), so the echo is compared without it.
      return (onDisk !== undefined && declStamp({ ...onDisk, separate: undefined }) === declStamp(decl)) || (mtime !== undefined && record?.mtime !== undefined && record.mtime >= mtime)
    })
    if (gone.length > 0) setAheadParents(Object.fromEntries(Object.entries(aheadParents).filter(([key]) => !gone.includes(key))))
  }, [aheadParents, folderMap, ids])
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
  /**
   * The settings block this page last wrote, until the index echoes its writes (YAZ-4741): the base of its next
   * settings write. Before the echo the index snapshot lacks this page's own write, so a change back to what the
   * snapshot holds — the Undo of a delete — would read as no change, and disk would keep the delete. Null: the index leads.
   */
  const sent = useRef<FolderSettings | null>(null)
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
    if (echoed) sent.current = null
    if (aheadRef.current !== null && (echoed || indexColumns === columnsStamp(aheadRef.current))) setAhead(null)
    if (aheadOtherRef.current !== null && (echoed || JSON.stringify(aheadOtherRef.current) === indexOther)) setAheadOther(null)
  }, [indexColumns, indexOther, revision, landed])
  const liveSettings = useMemo(
    () => (settings === null ? null : ahead === null && aheadOther === null ? settings : { ...settings, columns: ahead ?? settings.columns, otherFiles: aheadOther?.links ?? settings.otherFiles, otherFilesKeepNotes: aheadOther?.keep ?? settings.otherFilesKeepNotes }),
    [settings, ahead, aheadOther],
  )
  /** The page's columns (YAZ-4713 C2): its own live declarations over its parent folders', each with the folder that owns it. Once per snapshot. */
  const columns = useMemo(() => {
    if (liveSettings === null) return null
    const page = pageColumns(liveSettings.columns, folder, folderMap, ids, inheritOn)
    for (const [key, { owner, decl }] of Object.entries(aheadParents)) if (page[key]?.owner === owner) page[key] = { ...page[key], decl }
    return page
  }, [liveSettings, folder, folderMap, ids, inheritOn, aheadParents])
  /**
   * The keys the subfolders below define (C11, locked 2026-11-08): the names of the subfolders that define each, and
   * its definition when they all agree. Once per snapshot: a column edit on this page does not walk them again.
   */
  const definedBelow = useMemo(() => {
    const out: Record<string, { names: string[]; decl?: ColumnDecl }> = {}
    const stamps = new Map<string, Set<string>>()
    /** YAZ-4769: one key in any capitals, spelled as the first subfolder (in path order) spells it. */
    const spelled = new Map<string, string>()
    for (const record of [...feed.folders].sort((a, b) => (a.folder < b.folder ? -1 : 1))) {
      if (record.folder === folder || !inFolder(record.folder, folder)) continue
      const name = folderName(folderMap, record.folder, vaultName)
      for (const [declared, { separate: _own, ...decl }] of Object.entries(folderSettings(record, ids).columns)) {
        const fold = keyFold(declared)
        const key = spelled.get(fold) ?? declared
        spelled.set(fold, key)
        const entry = (out[key] ??= { names: [], decl })
        if (!entry.names.includes(name)) entry.names.push(name)
        stamps.set(key, (stamps.get(key) ?? new Set()).add(declStamp(decl)))
      }
    }
    for (const [key, seen] of stamps) if (seen.size > 1) delete out[key].decl
    return out
  }, [feed.folders, folderMap, folder, ids, vaultName])
  /**
   * Of those, the keys no folder on this page's chain defines (in any capitals, YAZ-4769): a view that shows such a key
   * through "Other properties" types it by the subfolders' agreed definition (none when they differ), and its header
   * says "From Desserts".
   */
  const belowColumns = useMemo(() => {
    if (columns === null) return {}
    const here = new Set(Object.keys(columns).map(keyFold))
    return Object.fromEntries(Object.entries(definedBelow).filter(([key]) => !here.has(keyFold(key))))
  }, [definedBelow, columns])
  /** What the views read (C2): the settings with the page's columns in place of the folder's own, and the subfolders' agreed definitions to type by (C11). Every write still states the folder's own. */
  const pageSettings = useMemo(() => {
    if (liveSettings === null || columns === null) return null
    const page: Record<string, ColumnDecl> = Object.fromEntries(Object.entries(columns).map(([key, { decl }]) => [key, decl]))
    const fromBelow = Object.keys(belowColumns).filter((key) => belowColumns[key].decl !== undefined)
    for (const key of fromBelow) page[key] = belowColumns[key].decl!
    return { ...liveSettings, columns: page, ...(fromBelow.length > 0 && { fromBelow }) }
  }, [liveSettings, columns, belowColumns])
  /** Edit column's two moves for an inherited column, as the newest render has them: the memoized `sources` calls through this. */
  const sourceMoves = useRef<Pick<ColumnSources, 'here' | 'useParent' | 'moveTo'>>({ here: () => Promise.resolve(), useParent: () => Promise.resolve(), moveTo: () => Promise.resolve() })
  /**
   * Where each column comes from (YAZ-4713 C6, C11), and Edit column's two moves for an inherited column. One object per
   * snapshot and column change, so the views' header marks are not worked out again on every render of this page.
   */
  const sources = useMemo((): ColumnSources | null => {
    if (columns === null) return null
    const nameOf = (dir: string): string => folderName(folderMap, dir, vaultName)
    return {
      folderName: nameOf(folder),
      marks,
      of: (key) => {
        const column = columns[key]
        if (column === undefined) return belowColumns[key] === undefined ? { loose: true } : { below: belowColumns[key].names.join(', ') }
        if (column.owner !== folder) return { from: nameOf(column.owner) }
        return column.over === undefined ? {} : { over: nameOf(column.over) }
      },
      here: (key) => sourceMoves.current.here(key),
      useParent: (key) => sourceMoves.current.useParent(key),
      // YAZ-4769: this folder and the ones above it — the vault root only for a root page, or when the root defines it.
      columnOn: (key) => {
        const column = columns[key]
        if (column === undefined || column.over !== undefined || column.decl.kind === 'mentions' || pageEffective || !inheritOn) return null
        const stored = column.owner === folder ? column.decl : folderSettings(folderMap.get(column.owner), ids).columns[key]
        if (stored?.separate === true) return null
        const up = selfAndAncestors(folder).filter((dir) => dir !== '' || folder === '' || column.owner === '')
        const below = [...folderMap.keys()].filter((dir) => dir !== folder && inFolder(dir, folder)).sort()
        const choices = [
          ...up.map((dir, i) => ({ dir, name: nameOf(dir), place: i === 0 ? ('here' as const) : ('above' as const) })),
          ...below.map((dir) => ({ dir, name: nameOf(dir), place: 'below' as const })),
        ]
        return choices.length < 2 ? null : { at: column.owner, choices }
      },
      moveTo: (key, to) => sourceMoves.current.moveTo(key, to),
    }
  }, [columns, belowColumns, folderMap, vaultName, folder, marks, pageEffective, inheritOn, ids])
  /**
   * The page's tied columns (YAZ-4781 R2): each row's value is the other side's links, off the snapshot's one mentions
   * map, put on the row as a field so its cells edit as a multi-link. Undefined when the page has none.
   */
  const tied = useMemo(() => {
    if (pageSettings === null || feed.resolve === null) return undefined
    const pairs = Object.fromEntries(Object.entries(pageSettings.columns).filter(([, decl]) => decl.kind === 'mentions' && decl.pair === true))
    return mentionsColumns(pairs, feed.records, feed.folders, feed.resolve)
  }, [pageSettings, feed.records, feed.folders, feed.resolve])
  /** The keys this page keeps its own value for (C3), as one string so a new settings object with the same switches remaps no row. Vaults with IDs only. */
  const separateKeys = ids && liveSettings !== null ? Object.keys(liveSettings.columns).filter((key) => liveSettings.columns[key].separate === true).join('\n') : ''
  const separate = useMemo(() => new Set(separateKeys === '' ? [] : separateKeys.split('\n')), [separateKeys])
  /** The keys no column may have (C1): never shown as a column, never written by a view. */
  const reserved = columnReservedKeys(ids)
  /**
   * The page's column spellings (YAZ-4769), the columns of its chain and its subfolders' (C11), as one string so a column
   * edit that changes no spelling remaps no row. A Linked mentions column holds no note value (YAZ-4738 L1), so a field
   * of its name is left as it is.
   */
  const spellKeys =
    columns === null
      ? ''
      : [...Object.keys(columns).filter((key) => columns[key].decl.kind !== 'mentions'), ...Object.keys(belowColumns).filter((key) => belowColumns[key].decl?.kind !== 'mentions')].join('\n')
  const spell = useMemo(() => spellings(spellKeys === '' ? [] : spellKeys.split('\n')), [spellKeys])
  /** The rows as the views read them (C1/C3, `rowValues`). A note moved to Other files is in none of them. */
  const shown = useMemo(() => {
    const inViews = moved.size === 0 && goneDirs.length === 0 ? rows : rows.filter((row) => !moved.has(row.path) && !inGoneDir(row.path))
    return inViews.map((row) => {
      const properties = withTied(rowValues(row.properties, reserved, id, separate, spell), row, tied)
      return properties === row.properties ? row : { ...row, properties }
    })
  }, [rows, moved, goneDirs.length, inGoneDir, reserved, id, separate, spell, tied])
  /** As the views read them, like `shown`: the `.folder.md`'s own keys, less its settings block (the views' own). The same row when nothing changes. */
  const shownSubfolders = useMemo(
    () =>
      // A subfolder moved to Other files (YAZ-4747) is no row.
      subfolders.flatMap((row) => {
        if (movedFolders.has(rowPage(row.path))) return []
        const properties = withTied(rowValues(row.properties, reserved, id, separate, spell), row, tied)
        return [properties === row.properties ? row : { ...row, properties }]
      }),
    [subfolders, movedFolders, reserved, id, separate, spell, tied],
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
  if (resolveLink === null || settings === null || liveSettings === null || columns === null || pageSettings === null || sources === null || parsed === null) return null
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
  /**
   * One of the two hover keys (demo 13D). While the page still holds the legacy `hover_preview`, the same write moves
   * its value onto the OTHER new key (where that one has no value of its own) and removes it: the page keeps meaning what
   * it meant, and from then on each switch stands alone.
   */
  const writeOwnHover = (key: typeof HOVER_ROWS_KEY | typeof HOVER_LINKS_KEY, value: boolean | undefined): Promise<unknown> => {
    const legacy = record === undefined ? undefined : hoverPreviewOf(record.properties)
    if (legacy === undefined) return writeOwnKey(key, value)
    const other = key === HOVER_ROWS_KEY ? HOVER_LINKS_KEY : HOVER_ROWS_KEY
    const otherOwn = record !== undefined && typeof record.properties[other] === 'boolean'
    setSettingsError(null)
    const write = track(writeProperties(file, [{ key: HOVER_PREVIEW_KEY, value: undefined }, ...(otherOwn ? [] : [{ key: other, value: legacy }]), { key, value }]))
    write.catch((err: unknown) => setSettingsError(err instanceof Error ? err.message : String(err)))
    return write
  }
  /** Read only refuses every settings write (D36): the banner says why. */
  const refuseLocked = (): boolean => {
    if (pageEffective) setSettingsError(FOLDER_READ_ONLY_TIP)
    return pageEffective
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
  const block = (base: FolderSettings, changes: Partial<Pick<FolderSettings, 'columns' | 'otherFiles' | 'otherFilesKeepNotes' | 'views' | 'properties' | 'defaultView'>>): FolderSettings => ({
    ...base,
    views: parsed.def.views,
    properties: parsed.def.properties,
    defaultView: parsed.def.defaultView,
    ...changes,
  })
  /**
   * ONE settings write, rebased (S38) on the newest of the index and this page's own unechoed write (`sent`, YAZ-4741):
   * `change` builds the block from that base. The block becomes the base of the next write; a refused write gives the
   * base back.
   */
  const sendSettings = (change: (base: FolderSettings) => FolderSettings): Promise<{ mtime: number }> => {
    const base = sent.current ?? settings
    const next = change(base)
    sent.current = next
    const write = aheadWrite(writeFolderSettings(file, next, base, ids))
    write.catch(() => {
      if (sent.current === next) sent.current = base === settings ? null : base
    })
    return track(write)
  }
  const commitSettings = (columns: Record<string, ColumnDecl>, views: ViewDef[], properties: ViewSet['properties']): Promise<void> => {
    if (refuseLocked()) return Promise.reject(new Error(FOLDER_READ_ONLY_TIP))
    setSettingsError(null)
    const before = aheadRef.current
    setAhead(columns)
    // The views this write states are the page's at once, as a view change's are (`onChange`): a view write before the
    // echo builds on them, and never puts back what this one took out (YAZ-4741).
    const def = parsed
    const shown = views === def.def.views && properties === def.def.properties ? null : folderViewSet({ ...settings, views, properties, formulas: def.def.formulas, defaultView: def.def.defaultView }, ids)
    if (shown !== null) {
      setParsed(shown)
      pending.current.push(stampOf({ views, formulas: settings.formulas, properties, defaultView: def.def.defaultView }))
    }
    // The caller edited the live copy: what it changed there is this write's; the rest is the base's, so disk's.
    return sendSettings((base) => block(base, { columns: columnsChanged(base.columns, liveSettings.columns, columns), views, properties })).then(
      () => undefined,
      (err: unknown) => {
        setAhead(before)
        if (shown !== null) setParsed((now) => (now === shown ? def : now))
        setSettingsError(err instanceof Error ? err.message : String(err))
        throw err
      },
    )
  }

  latestCommit.current = commitSettings
  latestOwnColumns.current = liveSettings.columns

  /**
   * Default view in the folder ⚙ (YAZ-4909): the same `defaultView` of the def, ONE settings write through the views'
   * door (`onChange`), and ONE step of the page's ⌘Z history (YAZ-4834 P20), as the View tab's row had; the undo and
   * the redo write on the def current then.
   */
  const setDefaultView = (next: string | undefined) => {
    const before = parsed.def.defaultView
    if (next === before) return
    const lay = (value: string | undefined) => () =>
      onChange(
        rewriteViews(latestParsed.current, (d) => {
          if (value === undefined) delete d.defaultView
          else d.defaultView = value
        }),
      )
    if (!lay(next)()) return
    valueHistory(path).push({ undo: lay(before), redo: lay(next) })
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
    sendSettings((base) => block(base, { views: next.def.views, properties: next.def.properties, defaultView: next.def.defaultView })).catch((err: unknown) =>
      setSettingsError(err instanceof Error ? err.message : String(err)),
    )
    return true
  }

  /**
   * ONE declaration, ahead first (YAZ-1549): the panel sees it at once; a refusal puts back what stood before and
   * rejects to the caller, whose inline text is the report. With `rename`, the views' filters on the old label follow
   * it in the same write (YAZ-4637 M5). The host's `setColumn` and a rename's Undo both come through here.
   */
  const writeDeclaration = (key: string, next: ColumnDecl, base: ColumnDecl | undefined, rename?: { from: string; to: string }, here = false): Promise<{ mtime: number }> => {
    if (refuseLocked()) return Promise.reject(new Error(FOLDER_READ_ONLY_TIP))
    const filters = rename === undefined ? undefined : (views: unknown) => renameOptionInFilters(views, key, rename.from, rename.to)
    // YAZ-4713 C6: an inherited column is its owner's — the edit goes to the owner's `.folder.md`, and every page under
    // the owner shows it — unless "Change on <folder> only" (`here`) declares it in this folder's own file.
    const owner = here ? folder : columns[key]?.owner ?? folder
    // A subfolder's column shown here (C11) is no column of this folder yet: the edit declares it here.
    const ownBase = key in columns ? base : undefined
    const written = owner === folder ? writeOwnDeclaration(key, next, ownBase, filters) : writeOwnerDeclaration(owner, key, next, base, filters)
    // An option rename follows the definition (C6): the filters of the pages below the owner that take this column from it too.
    return rename === undefined || separate.has(key) ? written : written.then(async (result) => {
      await renameFiltersBelow(owner, key, rename.from, rename.to)
      return result
    })
  }
  const writeOwnDeclaration = (key: string, next: ColumnDecl, base: ColumnDecl | undefined, filters: ((views: unknown) => unknown) | undefined): Promise<{ mtime: number }> => {
    const before = aheadRef.current
    setAhead({ ...liveSettings.columns, [key]: next })
    return track(aheadWrite(writeFolderColumn(file, key, next, base, ids, filters))).catch((err: unknown) => {
      setAhead(before)
      throw err
    })
  }
  /**
   * C6: the owner's file, ahead first (`aheadParents`). A read-only owner page refuses it, as its own page would (D36).
   * `next` and `base` are the page's copies; the owner's own "Separate value" switch (C3) rides back on both.
   */
  const writeOwnerDeclaration = (owner: string, key: string, next: ColumnDecl, base: ColumnDecl | undefined, filters: ((views: unknown) => unknown) | undefined): Promise<{ mtime: number }> => {
    const refusal = readOnlyRefusal(folderMap, owner, vaultName)
    if (refusal !== null) return Promise.reject(new Error(refusal))
    const stored = folderSettings(folderMap.get(owner), ids).columns[key]
    const before = aheadParents[key]
    setAheadParents((now) => ({ ...now, [key]: { owner, decl: next } }))
    const write = track(writeFolderColumn(folderSettingsPath(absFrom(root, owner)), key, withOwnerSwitch(next, stored), base === undefined ? undefined : withOwnerSwitch(base, stored), ids, filters))
    write.then(
      ({ mtime }) => setAheadParents((now) => (now[key]?.decl === next ? { ...now, [key]: { ...now[key], mtime } } : now)),
      () =>
        setAheadParents((now) => {
          const { [key]: _mine, ...rest } = now
          return before === undefined ? rest : { ...rest, [key]: before }
        }),
    )
    return write
  }
  /**
   * The renamed option in the filters of every `.folder.md` below `owner` whose page takes `key` from it (C6), less
   * read-only pages (D36), as a delete skips them. One quiet write each; a failure is the banner's.
   */
  const renameFiltersBelow = async (owner: string, key: string, from: string, to: string): Promise<void> => {
    const below = foldersTaking(folderMap, ids, owner, key)
    const results = await Promise.allSettled(below.map((r) => track(rewriteFolderViews(r.path, (views, labels) => ({ views: renameOptionInFilters(views, key, from, to), properties: labels })))))
    const failed = results.filter((r) => r.status === 'rejected').length
    if (failed > 0) setColumnError(`Could not rename "${from}" in the filters of ${failed} ${failed === 1 ? 'folder page' : 'folder pages'}`)
  }
  /** A folder's name as the UI says it (C6, C11): its title, else its directory's name; the vault's at the root. */
  const nameOf = (dir: string): string => folderName(folderMap, dir, vaultName)
  /**
   * The notes whose own field (C1) holds the value of `owner`'s column `key` (C6, C7, 7A 9): the notes under `owner`
   * (shortcuts too) and the subfolder `.folder.md`s below it (D31) — less those under a subfolder that defines the key
   * itself, whose page shows that definition. A subfolder row's value shows on its parent's page, so its `.folder.md`
   * asks from the folder above it. The one scope of an option rename and of a delete; read-only notes are in it.
   */
  const sharedHolders = (owner: string, key: string): IndexRecord[] => {
    const cache = new Map<string, boolean>()
    const takes = (dir: string) => takesFrom(folderMap, ids, dir, owner, key, cache)
    const notes = owner === folder ? rows : folderRows(feed.records, feed.folders, owner)
    return [...notes.filter((r) => takes(r.folder)), ...feed.folders.filter((r) => r.folder !== owner && inFolder(r.folder, owner) && takes(dirname(r.folder)))]
  }
  /**
   * S24 (YAZ-4591): the renamed option in every note that holds it — the note's own field (YAZ-4713 C1) in the column
   * owner's scope (`sharedHolders`); for a separate column (C3), this page's block of each indexed note — one guarded
   * write per note, read-only notes kept (YAZ-4637 M6: on disk too, wherever the note is).
   * Then the toast, whose Undo puts the declaration and the filters back through the LATEST host's door (its ahead copy
   * is current) and gives each changed note its exact previous value (M5).
   */
  const renameInNotes = async (key: string, next: ColumnDecl, base: ColumnDecl | undefined, { from, to }: { from: string; to: string }): Promise<void> => {
    const own = separate.has(key)
    if (own && id === undefined) return // a page with no id holds no values of its own
    const home: ValueHome = own ? { block: id! } : null
    const scope = own ? [...feed.records, ...feed.folders] : sharedHolders(columns[key]?.owner ?? folder, key)
    const result = await track(renameOptionInNotes(scope, home, key, from, to, readOnlyPaths(scope)))
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
   * "Separate value for <folder>" on or off (YAZ-4713 C3, 1B). On: this folder's declaration gains `separate: true` (an
   * inherited column is then declared here, with the definition the page shows). Nothing in the notes moves: the page
   * reads its block of `in`, which is empty for a new column, and shows at once any value an earlier separate column
   * left there (7A 19). Off: the declaration loses it first; then each note's page value moves into its own field and leaves the block
   * (`separateValues.ts`; `keep` says whose value stays where they differ), and the toast's Undo puts the declaration
   * and every changed note back. When the declaration, less the switch, is the parent's definition, Off removes it: the
   * page takes the parent's column again (C6), with no copy here that a later edit on the parent would miss.
   */
  const setSeparate = async (key: string, decl: ColumnDecl, on: boolean, keep: SeparateKeep): Promise<void> => {
    const { separate: _was, ...shared } = decl
    const base = liveSettings.columns[key]
    if (on) {
      await writeDeclaration(key, { ...shared, separate: true }, base, undefined, true)
      return
    }
    const parent = columns[key]?.over
    // YAZ-4769: the parent may spell the key in other capitals (`Dessert Column` over Desserts' `dessert column`).
    const parentDecl = parent === undefined ? undefined : declarationOf(folderMap, ids, parent, key)?.decl

    const toParent = parentDecl !== undefined && declStamp({ ...parentDecl, separate: undefined }) === declStamp(shared)
    if (toParent) {
      const { [key]: _gone, ...rest } = liveSettings.columns
      await commitSettings(rest, parsed.def.views, parsed.def.properties)
    } else await writeDeclaration(key, shared, base, undefined, true)
    const after = toParent ? undefined : shared
    if (id === undefined) return // a page with no id holds no values of its own
    const pageId = id
    const holders = separateHolders([...feed.records, ...feed.folders], pageId, key).filter((r) => !locked.has(r.path))
    const { changed, failed } = await track(mergeSeparateValues(holders.map((r) => r.path), pageId, key, keep))
    if (failed > 0) setColumnError(`Could not move the ${nameOf(folder)} value of "${propertyLabel(parsed.def, `note.${key}`)}" into ${failed} ${failed === 1 ? 'note' : 'notes'}`)
    const undo = () =>
      void latestDeclaration.current(key, { ...shared, separate: true }, after, undefined, true).then(
        () => track(restoreSeparateValues(changed, pageId, key)),
        (err: unknown) => onNotice?.(err instanceof Error ? err.message : String(err), 'error'),
      )
    onNotice?.(`${propertyLabel(parsed.def, `note.${key}`)} has one value per note again`, 'info', 'undo', { label: 'Undo', run: undo, fades: true })
  }

  /**
   * The `other_files` ONE write (YAZ-4597 D44), ahead first as `commitSettings` writes the columns: the list shows at
   * once, and a refusal puts back what stood before and shows the banner. Read only refuses it (D36).
   */
  const writeOtherFiles = (next: TrayLists): Promise<void> => {
    if (refuseLocked()) return Promise.reject(new Error(FOLDER_READ_ONLY_TIP))
    setSettingsError(null)
    const before = aheadOtherRef.current
    setAheadOther(next)
    return sendSettings((base) => block(base, { otherFiles: next.links, otherFilesKeepNotes: next.keep })).then(
      () => undefined,
      (err: unknown) => {
        setAheadOther(before)
        setSettingsError(err instanceof Error ? err.message : String(err))
        throw err
      },
    )
  }
  // A move shows the S6 toast (YAZ-4541): its Undo moves the note the other way through the moves current then, with no toast.
  // The lists as they stand, the moved notes then the moved folders; the next write keeps only these (D44).
  const noteLinks = [...moved.values()]
  const folderLinks = [...movedFolders.values()]
  const lists = (notes: string[], folders: { link: string; notes: boolean }[]): TrayLists => ({
    links: [...notes, ...folders.map((f) => f.link)],
    keep: folders.filter((f) => !f.notes).map((f) => f.link),
  })
  /** The subfolder directly under this page that holds `dir`, while it has not moved: its directory and name. */
  const directSubfolder = (dir: string): { dir: string; name: string } | null => {
    if (!dir.startsWith(`${path}/`)) return null
    const top = `${path}/${dir.slice(path.length + 1).split('/')[0]}`
    const row = subfolders.find((r) => rowPage(r.path) === top)
    return row === undefined || movedFolders.has(top) ? null : { dir: top, name: row.title }
  }
  const folderLabel = (name: string): string => `${name} (folder)`
  latestTray.current = {
    toTray: (notePath, undoable = true) => {
      const row = rows.find((r) => r.path === notePath)
      if (row === undefined || moved.has(notePath)) return
      writeOtherFiles(lists([...noteLinks, noteLinkOf(row, resolveLink)], folderLinks)).then(
        () => undoable && onNotice?.('Moved to Other files', 'info', 'undo', { label: 'Undo', run: () => latestTray.current?.back(notePath, false), fades: true }),
        () => undefined,
      )
    },
    back: (notePath, undoable = true) => {
      const folderMoved = movedFolders.get(notePath)
      if (folderMoved !== undefined) {
        writeOtherFiles(lists(noteLinks, folderLinks.filter((f) => f !== folderMoved))).then(
          () => undoable && onNotice?.(`Moved ${folderLabel(folderMoved.name)} back to the table`, 'info', 'undo', { label: 'Undo', run: () => latestTray.current?.toTrayFolder(notePath, folderMoved.notes, false), fades: true }),
          () => undefined,
        )
        return
      }
      if (!moved.has(notePath)) return
      writeOtherFiles(lists([...moved].filter(([p]) => p !== notePath).map(([, link]) => link), folderLinks)).then(
        () => undoable && onNotice?.('Moved back to the table', 'info', 'undo', { label: 'Undo', run: () => latestTray.current?.toTray(notePath, false), fades: true }),
        () => undefined,
      )
    },
    toTrayFolder: (dir, notes, undoable = true) => {
      const row = subfolders.find((r) => rowPage(r.path) === dir)
      if (row === undefined || movedFolders.has(dir)) return
      writeOtherFiles(lists(noteLinks, [...folderLinks, { link: noteLinkOf(row, resolveLink), notes }])).then(
        () => undoable && onNotice?.(`Moved ${folderLabel(row.title)} to Other files`, 'info', 'undo', { label: 'Undo', run: () => latestTray.current?.back(dir, false), fades: true }),
        () => undefined,
      )
    },
    folderOf: (rowPath) => directSubfolder(dirname(rowPath)),
    // A Folder group names one folder: only a subfolder directly under the page is offered, never Desserts for Cakes.
    folderAt: (rel) => {
      const target = rel === '' ? null : directSubfolder(absFrom(root, rel))
      return target !== null && target.dir === absFrom(root, rel) ? target : null
    },
    // The ask only when the answer changes what the table shows (OF2): the notes of the folder this view shows.
    askFolder: (dir, shown) => {
      const target = directSubfolder(dir)
      if (target === null) return
      const notes = shown.filter((p) => p.startsWith(`${dir}/`))
      if (notes.length === 0) return latestTray.current?.toTrayFolder(dir, true)
      const inside = [...new Set(notes.map((p) => dirname(p)).filter((d) => d !== dir).map((d) => d.slice(dir.length + 1).split('/')[0]))].sort()
      setFolderAsk({ dir, name: target.name, count: notes.length, inside })
    },
  }
  /** The tray takes moves while it shows and the page is not read only (D36). */
  const trayMoves = trayOn && !pageEffective

  /**
   * Whose value a delete of this folder's column clears, and where it is (YAZ-4713 C7). A shared column: the note's own
   * field (C1) in the notes under this folder (shortcuts too) and the subfolder `.folder.md`s (D31) — less those under a
   * subfolder that defines the key itself, whose page shows that definition. A separate column (C3): this page's block
   * in every indexed note. A read-only note is never cleared, and is not counted.
   */
  const valueScope = (key: string): { records: IndexRecord[]; home: ValueHome } => {
    // A Linked mentions column has no values in the notes (YAZ-4738 L1): its delete clears none, and a same-named field stays.
    if (columns[key]?.decl.kind === 'mentions') return { records: [], home: null }
    const writable = (r: IndexRecord) => !isReadOnlyProperties(r.properties)
    if (separate.has(key)) return { records: id === undefined ? [] : [...feed.records, ...feed.folders].filter(writable), home: { block: id ?? '' } }
    return { records: sharedHolders(folder, key).filter(writable), home: null }
  }

  sourceMoves.current = {
    // "Change on <folder> only": the definition the page shows becomes this folder's own; the note values stay one (C1).
    here: (key) => (columns[key] === undefined ? Promise.resolve() : writeDeclaration(key, columns[key].decl, liveSettings.columns[key], undefined, true)),
    // "Use <parent>'s": this folder's declaration goes; the views keep the column, which now shows the parent's definition.
    useParent: async (key) => {
      const mine = liveSettings.columns[key]
      const parent = columns[key]?.over
      if (mine === undefined || parent === undefined) return
      const { [key]: _gone, ...rest } = liveSettings.columns
      await commitSettings(rest, parsed.def.views, parsed.def.properties)
      const undo = () => void latestDeclaration.current(key, mine, undefined, undefined, true).catch((err: unknown) => onNotice?.(err instanceof Error ? err.message : String(err), 'error'))
      onNotice?.(`${propertyLabel(parsed.def, `note.${key}`)} uses ${nameOf(parent)}'s again`, 'info', 'undo', { label: 'Undo', run: undo, fades: true })
    },
    // "Column on" (YAZ-4769): the owner's stored definition goes to `to`, then off the owner; the Undo puts both back.
    moveTo: async (key, to) => {
      const from = columns[key]?.owner
      const decl = from === undefined ? undefined : columnsOf(from)[key]
      if (from === undefined || decl === undefined || from === to) return
      for (const dir of [to, from]) {
        const refusal = readOnlyRefusal(folderMap, dir, vaultName) ?? (dir === folder && pageEffective ? FOLDER_READ_ONLY_TIP : null)
        if (refusal !== null) throw new Error(refusal)
      }
      const side = (dir: string) => ({ path: dir === folder ? file : folderSettingsPath(absFrom(root, dir)), columns: columnsOf(dir) })
      const label = propertyLabel(parsed.def, `note.${key}`)
      const undo = await track(moveFolderColumn({ key, decl, from: side(from), to: side(to), ids }))
      const back = () => void track(undo()).catch((err: unknown) => onNotice?.(err instanceof Error ? err.message : String(err), 'error'))
      onNotice?.(`Moved "${label}" to ${nameOf(to)}`, 'info', 'undo', { label: 'Undo', run: back, fades: true })
    },
  }

  /** The folder a link names (a Relation's target, a tied column's `from.folder`, YAZ-4781), root-relative; null when it names none, or names a note. */
  const folderOfLink = (link: string | undefined): string | null => {
    if (link === undefined || link.trim() === '') return null
    const hit = resolveLink(exactLinkTarget(link) ?? link.trim())
    return hit === null || feed.records.some((r) => r.path === hit) ? null : relTo(root, hit)
  }
  /** A folder's own declarations as this page knows them: its live ones here, else the index's. */
  const columnsOf = (dir: string): Record<string, ColumnDecl> => (dir === folder ? liveSettings.columns : folderSettings(folderMap.get(dir), ids).columns)
  /** R1: the tied column of `owner`'s link column `key` on `target`, or undefined (One way). */
  const tiedOn = (target: string, key: string, owner: string): string | undefined =>
    tiedKeyOf(columnsOf(target), key, (link) => (link === undefined ? owner === '' : folderOfLink(link) === owner))
  /**
   * R2: one tied cell's write, as the link column's writes in the linking notes (`writeTiedCell`). The list before is
   * the snapshot's, or this page's last write of the cell while the index has not shown it.
   */
  const writeTied = async (note: string, { key, value }: PropertyWrite): Promise<PairWritten> => {
    const decl = pageSettings.columns[key]
    const column = decl.from?.column
    const owner = decl.from?.folder === undefined ? '' : folderOfLink(decl.from.folder)
    if (column === undefined || owner === null) throw new Error(`Can't find the folder of ${propertyLabel(parsed.def, `note.${key}`)}`)
    const row = rows.find((r) => r.path === note) ?? subfolders.find((r) => r.path === note)
    if (row === undefined || tied === undefined) throw new Error(`Can't find ${note.slice(note.lastIndexOf('/') + 1)}`)
    const at = `${note}\n${key}`
    const sent = tiedSent.current.get(at)
    const pageOf = (link: string) => resolveLink(exactLinkTarget(link) ?? link)
    const recordOf = (page: string) => feed.records.find((r) => r.path === page) ?? folderMap.get(relTo(root, page))
    const result = await writeTiedCell({
      unit,
      row,
      rowLink: noteLinkOf(row, resolveLink),
      column,
      owner: owner === '' ? root.replace(/\/+$/, '') : absFrom(root, owner),
      ownerName: nameOf(owner),
      multi: columnsOf(owner)[column]?.kind !== 'link',
      before: sent !== undefined && sent.resolve === resolveLink ? sent.value : tied.of(row, key),
      next: value,
      resolve: resolveLink,
      recordOf,
      ask: (text) => new Promise<boolean>((answer) => setPairAsk({ text, answer })),
      titleOf: (link) => {
        const page = pageOf(link)
        return (page === null ? undefined : recordOf(page)?.title) ?? exactLinkTarget(link) ?? link
      },
    })
    tiedSent.current.set(at, { resolve: resolveLink, value })
    return {
      undoPair: () => {
        tiedSent.current.delete(at)
        return result.undoPair()
      },
    }
  }
  /**
   * YAZ-4781 R1: a link column's other side. Both ways adds the tied Linked mentions column to the folder its Relation
   * names, One way takes it off: ONE write to that folder's `.folder.md` (a read-only one refuses, D36), no note value
   * changes, then a toast with Undo.
   */
  const relation: NonNullable<FolderHost['relation']> = {
    of: (key) => {
      const decl = pageSettings.columns[key]
      if (decl?.kind === 'mentions') {
        if (decl.pair !== true) return null
        const owner = decl.from?.folder === undefined ? '' : folderOfLink(decl.from.folder)
        return { tiedTo: `${owner === null ? decl.from?.folder : nameOf(owner)} › ${decl.from?.column}` }
      }
      const owner = columns[key]?.owner
      if ((decl?.kind !== 'link' && decl?.kind !== 'multi-link') || owner === undefined) return null
      const target = folderOfLink(decl.target)
      return target === null ? { shows: null } : { shows: nameOf(target), both: tiedOn(target, key, owner) !== undefined }
    },
    set: async (key, both) => {
      const decl = pageSettings.columns[key]
      const owner = columns[key]?.owner
      const target = decl === undefined ? null : folderOfLink(decl.target)
      if (owner === undefined || target === null) throw new Error('Name a folder in Relation first')
      const refusal = readOnlyRefusal(folderMap, target, vaultName) ?? (target === folder && pageEffective ? FOLDER_READ_ONLY_TIP : null)
      if (refusal !== null) throw new Error(refusal)
      const at = folderSettingsPath(absFrom(root, target))
      const report = (err: unknown) => onNotice?.(err instanceof Error ? err.message : String(err), 'error')
      const there = columnsOf(target)
      const existing = tiedOn(target, key, owner)
      if (both) {
        if (existing !== undefined) return
        const name = tiedKeyFor(`${nameOf(owner)} · ${key}`, there)
        const record = folderMap.get(owner)
        const from = owner === '' ? { column: key } : { column: key, folder: record === undefined ? `[[${owner}]]` : noteLinkOf(record, resolveLink) }
        const tiedDecl: ColumnDecl = { kind: 'mentions', from, pair: true }
        await track(addTiedColumn(at, name, tiedDecl, ids))
        onNotice?.(`Added ${name} to ${nameOf(target)}`, 'info', 'undo', { label: 'Undo', run: () => void track(removeTiedColumn(at, name, tiedDecl, null)).catch(report), fades: true })
        return
      }
      if (existing === undefined) return
      const keys = Object.keys(there)
      const undo = await track(removeTiedColumn(at, existing, there[existing], keys[keys.indexOf(existing) + 1] ?? null))
      onNotice?.(`Removed ${existing} from ${nameOf(target)}`, 'info', 'undo', { label: 'Undo', run: () => void track(undo()).catch(report), fades: true })
    },
  }

  const host: FolderHost = {
    settings: pageSettings,
    columns,
    sources,
    vaultRecords: feed.records,
    vaultFolders: feed.folders,
    vaultName,
    resolveLink,
    // A group "+" under group-by-Folder is born in that group's folder — a subfolder of this one; any other birth is here.
    // Wherever it is born, the seeded values are the note's own fields (YAZ-4713 C1) — a separate column's (C3) go to
    // THIS page's block, and a page with no id is given one first (`folderId`). It is titled `Untitled`, every time
    // (YAZ-2420 🔒 D20: the ids keep the files apart), unless the caller knows what it is called (YAZ-943's inline board
    // add types one). In a vault that does not use IDs (YAZ-2523 🔒 V3) only the name keeps two notes apart, so an
    // untyped one is `Untitled`, then `Untitled 2`, `Untitled 3`, …
    create: async (seed, name) => {
      // A new note in a read-only vault asks first (YAZ-4939); a refusal is the pane's one-line error.
      if (!(await vault.allowFileAction(root))) throw new Error(VAULT_READ_ONLY_TIP)
      const into = seed.folder !== undefined && inFolder(seed.folder, folder) ? seed.folder : folder
      const dir = into === folder ? path : absFrom(root, into)
      const pageSeed = Object.fromEntries(Object.entries(seed.properties).filter(([key]) => separate.has(key)))
      const block = Object.keys(pageSeed).length === 0 ? undefined : id ?? (await folderId(path))
      // No note holds a Linked mentions column, a tied one (YAZ-4781) neither: a seed of one is dropped.
      const fields = Object.fromEntries(Object.entries(seed.properties).filter(([key]) => !separate.has(key) && pageSettings.columns[key]?.kind !== 'mentions'))
      // No seed when the view seeds nothing: the note is then its folder's template as it is. A template field in other
      // capitals than a seeded column takes the column's spelling first (YAZ-4769), so the seed replaces it: one key.
      const seeded =
        Object.keys(seed.properties).length === 0 && seed.tags === undefined
          ? undefined
          : (shaped: Record<string, unknown>): Record<string, unknown> => {
              const template = respell(shaped, spellings(Object.keys(fields)), reserved)
              return {
                ...(block === undefined ? template : withFolderValues(template, block, pageSeed)),
                ...fields,
                ...(seed.tags !== undefined && { tags: seed.tags }),
              }
            }
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
    // ONE guarded write per note (YAZ-4713 C1): each value is the note's own field; a separate column's (C3) is this
    // page's block, and a page with no id is given one first — the path its first shortcut uses (`folderId`). No value
    // is dropped (C9). A key no column may have is refused, and so is a read-only note's write: this is the one door
    // every view write passes (YAZ-3076 D6, S54).
    writeValues: guardReadOnly(locked, async (note, asked) => {
      const refused = asked.find(({ key }) => reserved.has(key))
      if (refused !== undefined) throw new Error(reservedKeyText(refused.key))
      // YAZ-4769: a view key in other capitals than its column (a view that still names `Dessert Column`) writes the column.
      const writes = asked.map((write) => {
        const column = spell.get(keyFold(write.key))
        return column === undefined || column === write.key ? write : { ...write, key: column }
      })
      // The backstop of a Linked mentions column (YAZ-4738 L1): the app works it out, and no note holds it. The views'
      // columns, so a subfolder's Linked mentions column shown here (C11) is refused too.
      // A tied column (YAZ-4781 R2) is the exception: its write is the linking notes' writes, and this note holds none of it.
      const isTied = (key: string) => pageSettings.columns[key]?.pair === true
      const worked = writes.find(({ key }) => pageSettings.columns[key]?.kind === 'mentions' && !isTied(key))
      if (worked !== undefined) throw new Error(`${worked.key} is a Linked mentions column: the app works it out, and no note holds it`)
      const pairs = writes.filter(({ key }) => isTied(key))
      const own = pairs.length === 0 ? writes : writes.filter(({ key }) => !isTied(key))
      const undos: PairWritten[] = []
      for (const write of pairs) undos.push(await writeTied(note, write))
      // YAZ-4769: under the column's spelling; the note's other spellings of the key go in the same write, the app's keys never.
      const written = pairs.length > 0 && own.length === 0 ? undefined : await writeRouted(note, own, separate, own.some(({ key }) => separate.has(key)) ? id ?? (await folderId(path)) : undefined)
      // One Undo for the cell (R2): the table's ⌘Z step puts back exactly the notes this wrote.
      return pairs.length === 0 ? written : ({ undoPair: async () => { for (const undo of undos.reverse()) await undo.undoPair() } } satisfies PairWritten)
    }, unit),
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
    // The caller edits the page's columns (`settings.columns`, C2): only the keys it changed there become this folder's
    // own, so an inherited column is never copied into this folder's file.
    setColumns: (next, views, labels) => {
      void commitSettings(columnsChanged(liveSettings.columns, pageSettings.columns, next), views ?? parsed.def.views, labels === undefined ? parsed.def.properties : labels.properties).catch(() => undefined)
    },
    addColumn: (typed, decl, views, viewIndex, toast) => {
      // YAZ-4769: a name the page has a column of in other capitals is that column — its own copy here, over a parent's,
      // in the spelling the page uses — never a second one beside it.
      const key = findKey(Object.keys(columns), typed) ?? typed
      const column = `note.${key}`
      const failed = (err: unknown) => setColumnError(err instanceof Error ? err.message : String(err))
      // The Undo and the redo run later (YAZ-4637 M3): each lays the add on, or takes it off, on what is current then.
      const lay = (on: boolean) => () => {
        const own = { ...latestOwnColumns.current }
        if (on) own[key] = decl
        else delete own[key]
        const def = latestParsed.current.def
        const next = def.views.map((v, i) => {
          if (i !== viewIndex || v.order === undefined) return v
          const rest = v.order.filter((k) => canonicalKey(k) !== column)
          return withOrder(v, on ? [...rest, column] : rest)
        })
        void (latestCommit.current ?? commitSettings)(own, next, def.properties).catch(failed)
      }
      // The caller's views name the column as it was typed: they name it as the page spells it.
      const typedColumn = canonicalKey(typed)
      const named = key === typed ? views : views.map((v) => (v.order?.some((k) => canonicalKey(k) === typedColumn) ? withOrder(v, v.order.map((k) => (canonicalKey(k) === typedColumn ? column : k))) : v))
      commitSettings({ ...liveSettings.columns, [key]: decl }, named, parsed.def.properties).then(() => {
        const history = valueHistory(path)
        const step = { undo: lay(false), redo: lay(true) }
        history.push(step)
        onNotice?.(toast, 'info', 'undo', { label: 'Undo', run: () => void history.undoStep(step), fades: true })
      }, failed)
    },
    // Delete column (YAZ-1513): the settings half is `commitSettings` — the same one door, the same
    // echo behaviour — AWAITED, so a refused write aborts before any note is touched; the
    // strips report into the column banner, no rollback. They reach every indexed note holding
    // the field in this folder's block. Not offered where the vault does not use IDs (YAZ-2523 🔒 V11):
    // a column there is the notes' own property, and is hidden instead.
    ...(ids && {
      deleteColumn: (key: string, clear = true) =>
        deleteColumnEverywhere(key, {
          columns: liveSettings.columns,
          def: parsed.def,
          ...valueScope(key),
          below: foldersTaking(folderMap, ids, folder, key.replace(/^note\./, '')),
          writeSettings: commitSettings,
          // The settings half offers Undo (YAZ-4608 C6): one settings write puts the column back; a refusal shows the banner as any settings write does.
          // Its values back too (YAZ-3746 13AY); a note it could not write back is said in the column banner.
          notice: (message, restore) => onNotice?.(message, 'info', 'undo', { label: 'Undo', run: () => void restore().catch((err: unknown) => setColumnError(err instanceof Error ? err.message : String(err))), fades: true }),
          // The Undo runs later (YAZ-4637 M3): it inverts the delete on the live declarations and def current then.
          current: () => ({ columns: latestOwnColumns.current, def: latestParsed.current.def, writeSettings: latestCommit.current ?? commitSettings }),
        }, clear).catch((err: unknown) => setColumnError(err instanceof Error ? err.message : String(err))),
    }),
    valueCount: (key: string) => {
      const { records, home } = valueScope(key.replace(/^note\./, ''))
      return notesHolding(records, home, key).length
    },
    // "Separate value for <folder>" (YAZ-4713 C3): only where the vault uses IDs — the page's block is named by its id.
    ...(ids && {
      separate: {
        counts: (key: string) => separateCounts([...feed.records, ...feed.folders].filter((r) => !locked.has(r.path)), id, key),
        set: setSeparate,
      },
    }),
    // A folder row's title is its folder's (YAZ-4579 D32): the folder is renamed, title and directory, as its page title does.
    retitle: (note, title) => {
      if (locked.has(note)) return
      if (rowPage(note) !== note) onRetitle(rowPage(note), title, 'dir')
      else onRetitle(note, title, 'file')
    },
    openRight: onOpenFileRight,
    openFolderPage: onOpenFolderPage,
    openNewTab: onOpenFileNewTab,
    renderNoteEditor,
    openBackground: onOpenFileBackground,
    // "Delete note…" and "Duplicate note" (YAZ-4592 S26): the sidebar's delete, and a copy beside the note.
    trash: onDeleteEntries,
    duplicate: (note) =>
      void api.file.duplicate({ path: note }).catch((err: unknown) => onNotice?.(`Can't duplicate: ${err instanceof Error ? err.message : String(err)}`, 'error')),
    onNotice,
    relation,
    wikilinks: source,
    // The Page's editor reads the file, so it waits for the index to know one (YAZ-4584): a "+ Page" on a folder with none creates it.
    renderPage: record === undefined ? undefined : renderPage,
  }
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
        readOnly={pageBase}
        // As a note's cog (YAZ-3076 D4): off turns it on at once; on opens the chip's "Allow edits?" box; on while a timed unlock runs locks now (YAZ-4939).
        onToggleReadOnly={() => (pageBase ? (unlock.until !== null ? unlock.lock() : setAskingUnlock(true)) : setPageLocked(true, writeOwnKey(READ_ONLY_KEY, true)))}
        asking={askingUnlock}
        onAsk={() => setAskingUnlock(true)}
        // A time choice unlocks this tab (YAZ-4939); "Turn Read only off" writes the page's own switch, and is not there while the vault's lock would keep it locked anyway.
        onAllow={(choice) => {
          setAskingUnlock(false)
          unlock.allow(choice)
        }}
        onTurnOff={pageLocked && !vault.on ? () => {
          setAskingUnlock(false)
          setPageLocked(false, writeOwnKey(READ_ONLY_KEY, undefined))
        } : undefined}
        editingUntil={unlock.until}
        onLock={unlock.lock}
        onCancel={() => setAskingUnlock(false)}
        showPageFile={showPageFile}
        onChangeShowPageFile={(next) => setShowPageFile(next, writeOwnKey(SHOW_PAGE_FILE_KEY, next))}
        hoverRows={ownRows}
        onChangeHoverRows={(next) => setOwnRows(next, writeOwnHover(HOVER_ROWS_KEY, next))}
        confirmChanges={ownConfirm}
        onChangeConfirmChanges={(next) => setOwnConfirm(next, writeOwnKey(CONFIRM_CHANGES_KEY, next))}
        showNewButtons={ownNew}
        onChangeShowNewButtons={(next) => setOwnNew(next, writeOwnKey(SHOW_NEW_BUTTONS_KEY, next))}
        name={nameOf(folder)}
        hoverLinks={ownLinks}
        onChangeHoverLinks={(next) => setOwnLinks(next, writeOwnHover(HOVER_LINKS_KEY, next))}
        showOtherFiles={showOtherFiles}
        onChangeShowOtherFiles={(next) => setShowOtherFiles(next, writeOwnKey(SHOW_OTHER_FILES_KEY, next))}
        inheritColumns={ownInherit}
        onChangeInheritColumns={(next) => setOwnInherit(next, writeOwnKey(INHERIT_COLUMNS_KEY, next))}
        columnMarks={ownMarks}
        onChangeColumnMarks={(next) => setOwnMarks(next, writeOwnKey(COLUMN_MARKS_KEY, next))}
        views={parsed.def.views.map((v) => ({ name: v.name, type: v.type }))}
        defaultView={parsed.def.defaultView}
        onChangeDefaultView={setDefaultView}
        sync={sync}
        onSyncNow={onSyncNow}
      />
      <div ref={hostRef} className="editor-host" style={{ '--document-zoom': zoom / 100 } as CSSProperties}>
        <div className="page-header">
          {/* Read only (D36) locks the title and the folder's own properties, as a note's does. */}
          <PageTitle path={path} kind="dir" titles={titles} readOnly={pageEffective} onRetitle={(title) => onRetitle(path, title, 'dir')} />
          {disk !== null && <MemoFrontmatterPanel file={disk} root={root} properties={properties} wikilinks={source} readOnly={pageEffective} links={panelLinks} inheritColumns={folderPages?.inheritColumns} onNotice={onNotice} />}
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
              <OtherFilesFolderMove.Provider value={trayMoves ? folderDoor : null}>
              <ShortcutActions.Provider value={shortcutDoors}>
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
                hoverPreview={ownRows ?? hoverPreview}
                confirmChanges={ownConfirm ?? (folderPages ?? DEFAULT_FOLDER_PAGES).confirmChanges}
                onConfirmChangesOff={() => setOwnConfirm(false, writeOwnKey(CONFIRM_CHANGES_KEY, false))}
                showNewButtons={ownNew ?? (folderPages ?? DEFAULT_FOLDER_PAGES).showNewButtons}
                hoverLinks={ownLinks ?? hoverLinks}
                previewScope={previewScope}
                diagramDarkColors={diagramDarkColors}
                folderPages={folderPages}
              />
              </div>
              </ShortcutActions.Provider>
              </OtherFilesFolderMove.Provider>
              </OtherFilesMove.Provider>
            </ViewFolder.Provider>
          </FolderPageChips.Provider>
          {trayOn && (
            <OtherFiles
              root={root}
              dir={path}
              notes={trayNotes}
              folders={trayFolders}
              onOpen={onOpenFile}
              onOpenBackground={onOpenFileBackground}
              onNotice={onNotice}
              onMoveBack={trayMoves ? moveBack : null}
              onTakeRow={trayMoves ? (row) => latestTray.current?.toTray(row) : null}
              hoverPreview={(ownRows ?? hoverPreview) === true}
              previewScope={previewScope}
              diagramDarkColors={diagramDarkColors}
            />
          )}
        </section>
        {folderAsk !== null && (
          <ConfirmSheet
            labelId="confirm-folder-to-tray-text"
            text={
              <>
                <strong className="confirm__title">Move {folderAsk.name} (folder) to Other files?</strong>
                {folderTrayMessage(folderAsk.count, folderAsk.inside)}
              </>
            }
            confirmLabel={unit('Move the folder and its notes')}
            focusConfirm
            onConfirm={() => {
              setFolderAsk(null)
              latestTray.current?.toTrayFolder(folderAsk.dir, true)
            }}
            onCancel={() => setFolderAsk(null)}
            other={
              <button
                type="button"
                className="confirm__btn confirm__btn--other"
                onClick={() => {
                  setFolderAsk(null)
                  latestTray.current?.toTrayFolder(folderAsk.dir, false)
                }}
              >
                Move the folder only
              </button>
            }
          />
        )}
        {pairAsk !== null && (
          <ConfirmSheet
            labelId="confirm-pair-replace-text"
            text={pairAsk.text}
            confirmLabel="Replace"
            focusConfirm
            onConfirm={() => {
              setPairAsk(null)
              pairAsk.answer(true)
            }}
            onCancel={() => {
              setPairAsk(null)
              pairAsk.answer(false)
            }}
          />
        )}
        {disk !== null && <MemoCommentsSection file={disk} order={commentsOrder} onChangeOrder={onChangeCommentsOrder} root={root} />}
        {/* The notes and folders that link to the FOLDER (D10): its path is what such a link resolves to. */}
        <MemoBacklinksSection path={path} source={source} openCurrent={onOpenFile} openBackground={onOpenFileBackground} />
      </div>
    </>
  )
}
