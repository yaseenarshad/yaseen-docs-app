import { boardOptionGroups } from './boardOptionGroups'
import { LinkFoldersContext } from './view/NotesFromPicker'
import { columnTyping, optionOrderFor, optionParentFor } from './editorType'
import { alsoIn } from '@shared/alsoIn'
import { type MouseEvent as ReactMouseEvent, type ReactNode, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { OtherFilesFolderMove, type FolderTray } from './view/otherFilesMove'
import { DEFAULT_FOLDER_PAGES, MAX_COLLAPSED_GROUP_KEYS, type DiagramDarkColors, type FolderPagesSettings, type IndexRecord, type PropertiesResponse } from '@shared/types'
import type { Notice, NoticeKind, NoticeType } from '../lib/notice'
import type { ResolveLink, WikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { pageResolver } from '../links/folderLinks'
import { isMentionsColumn, mentionsColumns } from './mentionsColumn'
import { absFrom, relTo } from '../lib/paths'
import { storage } from '../lib/storage'
import { type ViewSet, type ViewDef, type ParsedViews, folderColumnOf, groupDepthOf, hidesSubfolderNotes, parseViews, rewriteViews, serializeViews, showsFolderRows, updateViews } from './viewSchema'
import { type GroupLevelStepActions, type LevelNode, GroupLevelStepsContext, branchSteps, levelSteps } from './groupLevelSteps'
import { type Group, type Row, propertyKeys, propertyLabel, runView } from './engine'
import { equals, fromYaml, render } from './expr'
import { type ColumnDecl, type FolderSettings, pageColumnKeys, rebaseSettings } from './folderSettings'
import type { ColumnSources, PageColumn } from './columnInheritance'
import type { SeparateCounts, SeparateKeep } from './separateValues'
import { type NewNoteSeed, deriveSeed } from './newNote'
import type { PropertyWrite } from './writeProperty'
import { BoardView } from './view/BoardView'
import { CalendarView } from './view/CalendarView'
import { type DayKey, calendarDateKey, calendarEndKey, dateColumns, dayLabel, dayOf, hideWeekendsDefault, hidesWeekends, movedDate, spanLabel } from './calendar'
import { CardsView } from './view/CardsView'
import { canonicalKey } from './view/keys'
import { allPropertyKeys } from './view/properties'
import { declarationForKind } from './view/declarationForKind'
import type { CardNoteDoors } from './view/rowMenuItems'
import { type GroupDrop, type GroupSpot, type GroupSwap, type PendingMove, TOP_SPOT, applyMoves, chainLevels, childSpot, groupByKey, groupsByFolder, spotKey } from './view/groupDrag'
import { ListView } from './view/ListView'
import { TableView } from './view/TableView'
import { NoteWindow, type NoteWindowMemory, dropNoteWindow, keepNoteWindow, noteWindowKey, noteWindowLink, noteWindowMemory, openNoteWindow, renameNoteWindowView, saveNoteWindowBox, savedNoteWindowBox } from './view/NoteWindow'
import { onNoteWindowRequest } from './noteWindowRequest'
import { Toolbar } from './view/Toolbar'
import { type ViewTabsProps, viewTypeLabel } from './view/ViewTabs'
import { PAGE_VIEW_TYPE } from './pageView'
import { NO_READ_ONLY, writableKey } from './readOnlyRows'
import { type HistoryStep, noteRef, valueHistory } from './view/valueHistory'
import type { CardStyleWrite } from './view/CardStyleMenu'
import { columnReservedKeys } from '../links/reservedKeys'
import { CardPreviewHost, useCardPreview, type PreviewScope } from '../tabs/cardPreview'
import type { ViewHover } from './view/viewHover'
import { ColumnDecls, FolderPages, type FolderPagesValue, LinkPills } from './view/GroupHeader'
import { ImageVault } from './view/imageCell'
import { TextLinkPicker } from './view/EditableCell'
import { openByGesture } from '../lib/openGesture'
import { useDeleteNotes } from './view/deleteNotes'
import { directlyIn, isFolderRow, rowPage, rowsByFolder } from '../links/shortcuts'
import { onPageTabAsk, takePageTab } from './pageTabRequest'
import { pageViewIndex } from './pageView'
import { ViewDefaults, chooseOwn, withDefaults } from './viewDefaults'
import { csvName, downloadText, shownRows, toCsv, toTsv, viewTable } from './exportView'
import { copyText } from '../editor/linkMenu'
import { FindBar } from '../editor/find/FindBar'
import { ViewFind, useViewFind } from './view/viewFind'
import { CHANGE_CANCELLED, useConfirmChanges } from './confirmChanges'

/** What Edit column says of a column's other side (YAZ-4781 R1): a link column's Relation folder and choice, or the link column a tied column belongs to. */
export type RelationSide = { shows: string | null; both?: boolean; tiedTo?: undefined } | { tiedTo: string; shows?: undefined }

/**
 * The folder host's bundle (🔒 D3, YAZ-819). ViewsPane stays ONE component: the host (`FolderView`),
 * its only mount, hands it an in-memory def and this bundle.
 */
export interface FolderHost {
  /**
   * The folder's settings, with the PAGE's columns (YAZ-4713 C2): its own declarations over its parent folders', the
   * nearest of each key — the typing ladder's TOP rung. A column write hands this map back changed (`setColumns`), and
   * only the keys it changed become the folder's own.
   */
  settings: FolderSettings
  /** The same columns, each with the folder that owns its definition (root-relative, '' = the vault root): this folder's own, or a parent's. */
  columns: Readonly<Record<string, PageColumn>>
  /** Where each column comes from, named (YAZ-4713 C6, C11): Edit column's owner line and moves, the header icons, this folder's name. */
  sources: ColumnSources
  /**
   * "Separate value for <folder>" (YAZ-4713 C3): this folder's page keeps its own value of the column for each note. Only where
   * the vault uses IDs. `counts` is the turn-off ask's numbers; `set` turns it on or off (`decl` is the column as the
   * page shows it; off, `keep` says whose value stays where the page's and the note's differ) and rejects when the
   * declaration was refused.
   */
  separate?: {
    counts: (key: string) => SeparateCounts
    set: (key: string, decl: ColumnDecl, on: boolean, keep: SeparateKeep) => Promise<void>
  }
  /**
   * Two-way relations (YAZ-4781 R1). `of`: for a Link or Multi-link column, the name of the folder its Relation names
   * (`shows`, null when it names none) and whether Both ways is on; for a tied column, the link column it is the other
   * side of ("Recipes › Pairs with"); null for any other column. `set` turns Both ways on or off and rejects with the
   * refusal's words. Absent: Edit column shows no such row.
   */
  relation?: {
    of: (key: string) => RelationSide | null
    set: (key: string, both: boolean) => Promise<void>
  }
  /** The WHOLE index snapshot — `records` here carries only the folder's notes (YAZ-2290 D4), and link resolution plus the link pickers must still see the vault. */
  vaultRecords: readonly IndexRecord[]
  /** The same snapshot's folder settings records: a link column narrowed to a folder asks what that folder holds, shortcuts included. */
  vaultFolders: readonly IndexRecord[]
  /** What the app calls the vault (`storage.vaultName`): the name of the group a note living in the vault root is put under when a view groups by Folder (YAZ-2541). */
  vaultName: string
  /** The window's link resolver (`linkResolver`): a note first, then a folder. A link cell reads a folder's name through it, and a link column finds the folder its target names. */
  resolveLink: ResolveLink
  /**
   * Birth in the folder (YAZ-2290 D4): create a note from `seed` and resolve its path.
   * `Untitled` is the DEFAULT title (YAZ-2420 🔒 D20); the board's inline add (YAZ-943) already knows
   * what the card is called, and that typed title rides the optional argument.
   */
  create: (seed: NewNoteSeed, name?: string) => Promise<string>
  /**
   * Save one definition against the captured base; reject concurrent changes to that property. `rename`
   * (YAZ-4591 S24): an option renamed in the column editor — once the declaration lands, every note
   * holding `from` is rewritten to `to` (`views/renameOption.ts`), and a toast offers Undo.
   */
  setColumn: (key: string, next: ColumnDecl, base: ColumnDecl | undefined, rename?: { from: string; to: string }) => Promise<unknown>
  /**
   * Write the declarations (YAZ-895): ONE settings write, fire-and-forget — a failure shows in the
   * host's banner. `views` lets a caller move the columns AND `view.order` in that same write;
   * without it the host writes its live views, so a column write never clobbers an edit still in
   * flight. `labels`, when given, replaces the column labels (`undefined` inside it means none).
   * `settings.columns` is the host's ahead copy (YAZ-1549): the ONE map to spread or hand back as `base`.
   */
  setColumns: (columns: Record<string, ColumnDecl>, views?: ViewDef[], labels?: { properties: ViewSet['properties'] }) => void
  /**
   * "Add to <folder>" (YAZ-4713 C4A): `key` becomes this folder's own column (`decl`) and `views` show it, in ONE
   * settings write. Then a toast (`toast`) with Undo and ONE step of the page's ⌘Z history take both back in one write,
   * on the declarations and views current then; ⇧⌘Z adds it again. `viewIndex` is the view that shows it; -1 when the
   * view shows it already (Edit column's "Add to <folder>" on a ◌ field, YAZ-4772): the Undo then takes back the column only.
   */
  addColumn?: (key: string, decl: ColumnDecl, views: ViewDef[], viewIndex: number, toast: string) => void
  /**
   * "Delete column…" (YAZ-1513): the declaration, every view reference here and below (YAZ-4713 C7), the label AND —
   * with `clear` (the default), "Delete column and clear N values" — the value on every note under the folder holding
   * one — `views/deleteColumn.ts`, ONE function behind both menus. Only this folder's own column. Never rejects:
   * the host reports failures in its own banner. A host whose columns are the notes' own properties
   * has none (YAZ-2523 🔒 V11): the menus then offer no delete, and a column is hidden instead.
   */
  deleteColumn?: (key: string, clear?: boolean) => Promise<void>
  /** How many notes under the folder hold a value for a column (a separate one: this page's block) — the number that delete's confirm states. */
  valueCount: (key: string) => number
  /**
   * The ONE door a view writes a row's values through — a cell edit, a board or section drop — in
   * one guarded write of that note. `records` ARE the folder's values for each row, and only the
   * host knows where a note keeps them (D19: its block of `in`).
   */
  writeValues: (path: string, writes: readonly PropertyWrite[]) => Promise<unknown>
  /** A row's title edited in a table's Name cell (YAZ-2420 🔒 D19): the one title edit, through App's rename door. A folder row's renames its folder (YAZ-4579 D32). */
  retitle: (path: string, title: string) => void
  /** ⌘-click on a table row opens the page in a BACKGROUND tab (YAZ-820); absent → opens in place. */
  openBackground?: (path: string) => void
  /** Shared Table/Board action that opens the exact page in the window's right panel. */
  openRight?: (path: string) => void
  /** A folder's page in a new tab, by its absolute path (YAZ-4564 D26/D27): the sidebar's "Open folder page" door. Absent: the Folder chips and ↗ open nothing. */
  openFolderPage?: (dir: string) => void
  /** A note (or a folder row's page) in a NEW tab (YAZ-3746 13I): the mini window's ↗. Absent: ↗ opens in this tab. */
  openNewTab?: (path: string) => void
  /**
   * A full editor on a note, for the table's note window (YAZ-4547 D14): App's, the same editor a tab has. Stable.
   * Absent: the row menu has no "Open in mini window" (YAZ-4605 D57), and ⇧Enter opens nothing.
   */
  renderNoteEditor?: (path: string) => ReactNode
  /**
   * Passive notice surface for row actions that fail because a page moved or disappeared. App's
   * `notify`: a move's "Moved to … · Undo" (YAZ-4541 S6) rides its glyph, type and action too.
   */
  onNotice?: (message: string, icon?: NoticeKind, type?: NoticeType, action?: Notice['action']) => void
  /** The window's ONE resolve source: whether the vault uses IDs decides the reserved keys. */
  wikilinks: WikilinkResolveSource
  /**
   * The Page tab's body (YAZ-4584 D38): the note editor on the folder's `.folder.md`, built by `Editor`. Its page
   * switches and save state go to the folder page's toolbar (`FolderPageChips`). Absent while the folder has no
   * `.folder.md` yet: the Page then shows nothing.
   */
  renderPage?: () => ReactNode
  /**
   * The row menu's "Delete note…" (YAZ-4592 S26): App's own delete, the sidebar's (`trashMany`: the Trash, the
   * sound, the Undo toast). The pane asks first (`useDeleteNotes`). Absent: no such item.
   */
  trash?: (paths: readonly string[]) => Promise<void>
  /** The row menu's "Duplicate note" (YAZ-4592 S26): a copy beside the note (`file.duplicate`). Absent: no such item. */
  duplicate?: (path: string) => void
}

export interface ViewsPaneProps {
  parsed: ParsedViews
  /**
   * Every config change arrives here as `updateViews(parsed, …)`; the host turns it into a write. `false` says the host
   * refused it and kept its def (a read-only folder page, D36): the gesture's Undo toast then says nothing (YAZ-4644 E2).
   */
  onChange: (next: ParsedViews) => boolean | void
  /**
   * Vault root. It keys the view state persisted OUTSIDE the file (collapsed groups, GRO-2137)
   * AND roots the resolver (YAZ-846, closing the Engine entry's KNOWN GAP), so a link target
   * written as an absolute `<root>/…` path resolves here exactly as it does for the wikilink
   * surfaces.
   */
  root: string
  /** Absolute path of the folder the views belong to: it keys the collapse state. */
  folderPath: string
  /** The app tab that shows this folder page (`Editor`'s `tabId`): its note window is that tab's (YAZ-4544, D17). Absent in the right panel. */
  tabId?: string
  /** The main tab's Back step (`Editor`'s `viewKey`): the page that mounts again on that step shows the view tab it left (YAZ-4544). */
  viewKey?: string
  /** The notes the views query (YAZ-2290 D4) — the folder's own rows, never the whole vault — each with the FOLDER's values for it as its `properties` (D19). */
  records: IndexRecord[]
  /**
   * The folder's DIRECT subfolders as rows (YAZ-4579 D31), each its `.folder.md` with the folder's values for it as its
   * `properties`, like `records`. A view shows them when its "Subfolders" switch says As rows or Both. Absent = none.
   */
  folderRows?: IndexRecord[]
  /**
   * The read-only notes among `records` (YAZ-3076 D6): the host reads the switch off each note's OWN
   * properties (`readOnlyPaths`), because `records` carry the folder's values. Their cells open no
   * editor, their cards do not move, and the host refuses their writes. Absent = none.
   */
  readOnly?: ReadonlySet<string>
  /**
   * The vault-wide property declarations (5E, GRO-2217; `useProperties`) — typing rung 2, fed
   * App → `Editor` → `FolderView` since YAZ-846. null/absent until the fetch resolves; a
   * `properties.error` renders its own passive line and never blocks a row.
   */
  properties?: PropertiesResponse | null
  onOpenFile: (path: string) => void
  /** The folder's bundle (🔒 D3, YAZ-819): every edit of its views is ONE `update` through this adapter's one door. */
  folder: FolderHost
  /** "Preview rows on hover" (YAZ-3403; the page's key, else Settings › Folder pages): resting on an item shows the sidebar's panel beside it. */
  hoverPreview?: boolean
  /** "Preview links on hover" (demo 13D; the page's key, else Settings › Folder pages): resting on a link pill in a cell shows the linked page. */
  hoverLinks?: boolean
  /** "Confirm changes" (YAZ-3746 13AN; the page's key, else Settings › Folder pages): a change to a note asks first. */
  confirmChanges?: boolean
  /** The ask's "Don't ask on this page": the page's own key, Off. */
  onConfirmChangesOff?: () => void
  /** "Show New buttons" (YAZ-3746 13BL; the page's key, else Settings › Folder pages): off hides the toolbar's + New, a table's + New rows, a board's + New card and the group headers' "+". */
  showNewButtons?: boolean
  /** What the hover panel needs of a page's vault: App's `boardPreviewScope`. No scope, no hover panel. */
  previewScope?: (path: string) => PreviewScope
  diagramDarkColors?: DiagramDarkColors
  /** Settings › Folder pages (YAZ-4585, D34): what a view with no key of its own reads, the week start and the note window's pin. */
  folderPages?: FolderPagesSettings
}

/**
 * One group's own raw value into a new note's seed (5D, GRO-2144), for `key` = that group's LEVEL.
 * Fanned out (D4): seed THIS group's own element as a one-item list — the first row's raw value is
 * the neighbour's WHOLE list there, which would hand the new page someone else's values; `render()`
 * gives a link back its `[[…]]` form, the same one the picker writes — with NO resolver, so an id
 * link is seeded as its stored `[[<id>]]`, never the title its header shows (YAZ-2293 D8).
 */
function seedGroupValue(properties: Record<string, unknown>, group: Group, key: string | null): void {
  if (key === null || group.key === null) return
  const raw = group.fannedOut ? [render(group.key)] : group.rows[0]?.record.properties[key] ?? group.optionValue
  if (raw !== undefined) properties[key] = raw
}

/** One group into a new note's seed, for the group's LEVEL: grouped by Folder it is where the note is born, else its value (`seedGroupValue`). */
function seedGroup(seed: NewNoteSeed, group: Group, view: ViewDef, level: number, columns: Readonly<Record<string, ColumnDecl>>): void {
  if (!groupsByFolder(view, level)) seedGroupValue(seed.properties, group, groupByKey(view, level, columns))
  else if (typeof group.key === 'string') seed.folder = group.key
}

/**
 * One set of views (GRO-2135): the toolbar (view switcher, sort / properties menus, search,
 * count) over the body — the real table for `type: table` (GRO-2136), the board for
 * `type: board` (4D, GRO-2138), the card grid for `type: cards` (4E, GRO-2139), the list for
 * `type: list` (4F, GRO-2140), the folder's own document for `type: page` (YAZ-4584), the month grid for
 * `type: calendar` (YAZ-4540), a placeholder row list
 * for unknown view types. Only the active tab and the search text are component state —
 * everything else is the file.
 */
/** The first free name for a new view: `base`, `base 2`, `base 3`… (`taken` = the views' names). */
export function freeName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`
}

/**
 * The view tab each Back step of a folder page showed (YAZ-4544), by step and folder: a "+" that opens the new note
 * unmounts the page, and Back mounts it again on that view, as the code tab keeps its cursor (YAZ-3458). In memory
 * only, at most `MAX_BACK_VIEWS`, the oldest out.
 */
const backViews = new Map<string, string>()
const MAX_BACK_VIEWS = 200
/** A file at a new row's path born this long after the row is another note (YAZ-4637 T3): its Undo trashes nothing. */
const NEWER_FILE_MS = 60_000
function keepBackView(key: string, name: string): void {
  backViews.delete(key)
  backViews.set(key, name)
  if (backViews.size > MAX_BACK_VIEWS) backViews.delete(backViews.keys().next().value!)
}

const NO_FOLDER_ROWS: IndexRecord[] = []
/** The hover panel's id for the link pill under the pointer (YAZ-4601 D47): no path is it. */
const PILL_HOVER = '\u0000pill'
/** A folder row has no note to preview (YAZ-4579 D32): the hover panel is the notes', so its dwell never starts. */
const noHover = (): void => undefined

export function ViewsPane({ parsed, onChange, root, folderPath, tabId, viewKey, records: noteRecords, folderRows = NO_FOLDER_ROWS, readOnly = NO_READ_ONLY, properties = null, onOpenFile, folder, hoverPreview = false, hoverLinks = false, confirmChanges = false, onConfirmChangesOff, showNewButtons = true, previewScope, diagramDarkColors = 'adapt', folderPages: defaults = DEFAULT_FOLDER_PAGES }: ViewsPaneProps) {
  // The START may persist (YAZ-1104); which view is ACTIVE stays session state — switching still
  // writes nothing, and YAZ-1471 re-ruling 🔒 rule 4 (the tabs edit again) did not move that line:
  // only the def is written. A stale (or absent) saved name is -1 here, so it clamps to the first.
  // By app tab too: a tab with no Back step yet has step 0, as every other such tab has.
  const backKey = viewKey === undefined ? undefined : JSON.stringify([tabId ?? null, viewKey, folderPath])
  const [active, setActive] = useState(() => {
    const left = backKey === undefined ? undefined : backViews.get(backKey)
    const back = left === undefined ? -1 : parsed.def.views.findIndex((v) => v.name === left)
    return back !== -1 ? back : Math.max(0, parsed.def.views.findIndex((v) => v.name === parsed.def.defaultView))
  })
  const [search, setSearch] = useState<string | null>(null)
  /** Collapsed group keys per view, seeded from the store; a toggle replaces the entry here AND writes through storage. */
  const [collapsedByKey, setCollapsedByKey] = useState<Record<string, string[]>>({})
  /** Optimistic group moves (5C, GRO-2143) keyed by path, patched into the records the engine sees. */
  const [moves, setMoves] = useState<Record<string, PendingMove>>({})
  const [moveError, setMoveError] = useState<{ path: string; message: string } | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  // The hover panel (YAZ-3403): ONE dwell and ONE panel for every layout (`viewHover.ts`), beside the hovered item.
  // An item is found again by its path, the hovered copy first (a board can show a note twice). Nothing opens while an
  // inline editor is open: the dwell's end finds no item then. Two switches share the one dwell (demo 13D): `hoverPreview`
  // lets a row's or card's dwell start, `hoverLinks` a pill's; the hook runs while either is on.
  const paneRef = useRef<HTMLDivElement>(null)
  const itemHover = useCardPreview(hoverPreview || hoverLinks, (path) => {
    if (paneRef.current?.querySelector('[data-editing]') != null) return null
    // A picture under the pointer (YAZ-4802) shows its own bigger preview: the row's panel waits.
    if (paneRef.current?.querySelector('.image-thumb:hover') != null) return null
    if (path === PILL_HOVER) return pillAt.current?.isConnected === true ? pillAt.current : null
    const items = [...(paneRef.current?.querySelectorAll<HTMLElement>(`[data-hover-item="${CSS.escape(path)}"]`) ?? [])]
    return items.find((el) => el.matches(':hover')) ?? items[0] ?? null
  })
  const { hoverCard, leaveCard, close: closeItemHover } = itemHover
  /**
   * A link pill in a cell (YAZ-4601 D47) shows the LINKED page through the same dwell and panel: the pointer on a pill
   * takes the panel from its row, and off the pill, back on the row, the row's dwell starts again. Delegated: the pane's
   * own mouseover and mouseout, nothing per cell, nothing on scroll.
   */
  const pillAt = useRef<HTMLElement | null>(null)
  const pillOf = (target: EventTarget | null): HTMLElement | null => (target instanceof Element ? target.closest<HTMLElement>('[data-link-path]') : null)
  const onPillOver = (e: ReactMouseEvent) => {
    if (!hoverLinks) return
    const pill = pillOf(e.target)
    if (pill === null || pill === pillAt.current) return
    pillAt.current = pill
    hoverCard(PILL_HOVER, pill.dataset.linkPath!)
  }
  const onPillOut = (e: ReactMouseEvent) => {
    const pill = pillAt.current
    const to = e.relatedTarget instanceof Node ? e.relatedTarget : null
    if (pill === null || !pill.contains(e.target as Node) || (to !== null && pill.contains(to))) return
    pillAt.current = null
    leaveCard(PILL_HOVER)
    if (pillOf(to) !== null) return
    const item = to instanceof Element ? to.closest<HTMLElement>('[data-hover-item]') : null
    const path = item?.dataset.hoverItem
    if (hoverPreview && path !== undefined && paneRef.current?.contains(item!) === true && rowPage(path) === path) hoverCard(path, path)
  }
  // The note window (YAZ-4547): `opens` mounts a new card per open and renders each open and close; the link to the
  // table; the place, size and pin of the last card closed here, for the next open while this folder page is mounted.
  const [opens, setOpens] = useState(0)
  /** The header menu's "Open the filter panel…" (YAZ-4919): each ask opens the toolbar's Filter popover. */
  const [filterAsks, setFilterAsks] = useState(0)
  const openFilter = useCallback(() => setFilterAsks((n) => n + 1), [])
  const windowLink = useMemo(noteWindowLink, [])
  const lastWindow = useRef<NoteWindowMemory | null>(null)
  const itemProps = useCallback((path: string) => (rowPage(path) !== path || !hoverPreview ? { 'data-hover-item': path, onMouseEnter: noHover, onMouseLeave: noHover } : { 'data-hover-item': path, onMouseEnter: () => hoverCard(path, path), onMouseLeave: () => leaveCard(path) }), [hoverCard, leaveCard, hoverPreview])
  const viewHover = useMemo<ViewHover>(() => ({ itemProps }), [itemProps])
  // New records (a sync, another window's edit) can remove or move the item under the panel, and a removed item
  // fires no `mouseleave`: the panel goes.
  useEffect(() => closeItemHover(), [noteRecords, closeItemHover])
  // A switch turned off closes the panel of its own kind (demo 13D): the hook's own close waits for both to be off.
  useEffect(() => {
    const { id, by } = itemHover.store.getState()
    if (by === 'hover' && (id === PILL_HOVER ? !hoverLinks : !hoverPreview)) closeItemHover()
  }, [hoverPreview, hoverLinks, itemHover.store, closeItemHover])
  const { def } = parsed
  const views = def.views
  const index = Math.max(0, Math.min(active, views.length - 1))
  /**
   * NEVER undefined (YAZ-861): `views` cannot be empty — `folderSettings` and the one mount's
   * `folderViewSet` both fall back to `DEFAULT_VIEWS` — and `index` is clamped into that list.
   */
  const own = views[index]!
  // Settings › Folder pages (YAZ-4585, D34): every reader below sees the view's own keys, then Settings'. The menus
  // read `def.views[viewIndex]` for the view as written ("from Settings").
  const view = useMemo(() => withDefaults(own, defaults), [own, defaults])
  // "Subfolders: As rows / Both" (YAZ-4579 D30/D31): this view's records are the notes and a row per direct subfolder.
  // Every use below reads these — the engine, the menus' columns, a move's raw — so a folder row is a row like a note.
  const withFolders = showsFolderRows(view) && folderRows.length > 0
  const records = useMemo(() => (withFolders ? [...noteRecords, ...folderRows] : noteRecords), [withFolders, noteRecords, folderRows])
  // "Delete note…" (YAZ-4592 S26): the confirm sheet, unless Settings › Folder pages › Ask before deleting notes is off.
  const { confirmDeleteNotes, sheet: deleteSheet } = useDeleteNotes(defaults.askBeforeDelete, folder.trash, (path) => noteRecords.find((r) => r.path === path)?.title ?? path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, ''))
  useEffect(() => {
    if (backKey !== undefined) keepBackView(backKey, view.name)
  }, [backKey, view.name])
  // The sidebar's folder page row (YAZ-4587, D37) asks for the Page tab: the page of an app tab takes the ask as it
  // mounts, or at once while mounted, and shows its Page tab, else its start view. Before paint, so the mount shows no other view first.
  useLayoutEffect(() => {
    if (tabId === undefined) return
    const take = () => {
      if (!takePageTab(folderPath)) return
      const page = pageViewIndex(def.views)
      setActive(page !== -1 ? page : Math.max(0, def.views.findIndex((v) => v.name === def.defaultView)))
    }
    take()
    return onPageTabAsk(take)
  }, [tabId, folderPath, def])
  // The open card of this app tab, folder page and view tab is in a module map (`NoteWindow.tsx`, D17, YAZ-4544), so a
  // tab that sleeps and mounts again shows it again on the same note, and another tab on this folder has its own.
  const windowKey = noteWindowKey(tabId, folderPath, view.name)
  // The page's ⌘Z history of value changes (YAZ-4612 S41), and the toolbar's selection chip the table writes (S46).
  const history = useMemo(() => valueHistory(folderPath), [folderPath])
  const selectionChip = useRef<HTMLSpanElement>(null)
  const noteWindow = openNoteWindow(windowKey)
  const openWindow =
    folder.renderNoteEditor === undefined
      ? undefined
      : (path: string) => {
          const open = openNoteWindow(windowKey)
          const { pinned } = open ?? lastWindow.current ?? noteWindowMemory(path, defaults.keepWindowPinned)
          // The place and size: the open card's, else the page's last (YAZ-3746 13H, also from before a restart), else the default.
          const { placed, width, height } = open ?? savedNoteWindowBox(folderPath) ?? lastWindow.current ?? noteWindowMemory(path)
          keepNoteWindow(windowKey, { path, placed, width, height, pinned })
          setOpens((n) => n + 1)
        }
  const closeWindow = useCallback(() => {
    lastWindow.current = openNoteWindow(windowKey) ?? lastWindow.current
    dropNoteWindow(windowKey)
    setOpens((n) => n + 1)
  }, [windowKey])
  // "Open in mini window" from the explore stack (YAZ-2571 round 1): the page on screen takes the note into its card.
  const openWindowRef = useRef(openWindow)
  openWindowRef.current = openWindow
  useEffect(
    () =>
      onNoteWindowRequest((path) => {
        const open = openWindowRef.current
        if (open === undefined || selectionChip.current?.closest('.tabstack__layer--hidden') !== null) return false
        open(path)
        return true
      }),
    [],
  )
  // Re-parse after every edit: `doc.setIn` stores plain JS values, so a second edit inside a
  // collection a previous edit created would throw ("Expected YAML collection"). The round trip
  // through text keeps comments and rebuilds proper nodes.
  // An Undo runs after later renders (YAZ-4594 S29): it writes through the def and the door that are current then.
  const latest = useRef({ parsed, onChange, folder })
  latest.current = { parsed, onChange, folder }
  const write = (mutate: (def: ViewSet) => void): ViewSet | null => {
    const now = latest.current
    const next = rewriteViews(now.parsed, mutate)
    return now.onChange(next) === false ? null : next.def
  }
  /**
   * A gesture that takes something away says so with `undo` (S29): a toast with Undo (`fades`, the S6 pattern), which
   * inverts THAT gesture alone on the def current then (YAZ-4637 M3) — its change from `next` back to `before`, laid
   * on by the one rebase (`rebaseSettings`), so a later sort, another window's change or a view added since stays —
   * ONE settings write — then runs `after`. A gesture that changed nothing (No fill on a cell with none) or that the
   * host refused (a read-only page, YAZ-4644 E2) says nothing: no toast may offer to undo what did not happen.
   * Every gesture is also ONE step of the page's ⌘Z history (YAZ-3746 13N for fills; since 13AV every view change:
   * Wrap / Clip, alignment, a width, a sort, a group level, a hide, a freeze, a view tab), with a redo that lays the
   * change on again the same way; the toast's Undo is that step (T9e), so ⌘Z and the toast agree. `onHistory: false`
   * keeps a write off the history.
   */
  const update = (mutate: (def: ViewSet) => void, undo?: string, after?: () => void, onHistory = true) => {
    const before = latest.current.parsed.def
    const next = write(mutate)
    if ((undo === undefined && !onHistory) || next === null || JSON.stringify(next) === JSON.stringify(before)) return
    /** Lays the change from `from` to `to` onto the def current then: `restore` inverts the gesture, the redo repeats it. */
    const lay = (from: ViewSet, to: ViewSet) => () =>
      write((d) => {
        const put = structuredClone(rebaseSettings(from, to, d)) as ViewSet
        for (const k of Object.keys(d)) if (!Object.hasOwn(put, k)) delete d[k]
        Object.assign(d, put)
      })
    const restore = () => {
      lay(next, before)()
      after?.()
    }
    const step: HistoryStep | null = onHistory ? { undo: restore, redo: lay(before, next) } : null
    if (step !== null) history.push(step)
    if (undo !== undefined) folder.onNotice?.(undo, 'info', 'undo', { label: 'Undo', run: step === null ? restore : () => void history.undoStep(step), fades: true })
  }

  // 5B's clearing discipline: a pending move holds until the index refetch moves that key off the
  // raw it had at commit time (our write landing, or a concurrent writer winning) — never before.
  useEffect(() => {
    setMoves((m) => {
      const kept = Object.entries(m).filter(([path, mv]) => {
        const props = records.find((r) => r.path === path)?.properties
        // A two-write move is ONE unit (🔒 YAZ-745): it holds until the index has moved off BOTH raws.
        return mv.some((w) => JSON.stringify(props?.[w.key] ?? null) === JSON.stringify(w.prevRaw ?? null))
      })
      return kept.length === Object.keys(m).length ? m : Object.fromEntries(kept)
    })
  }, [records])

  // The page the views belong to, as the index names its folder (YAZ-2541).
  const pageFolder = relTo(root, folderPath)
  // "Subfolders: As rows / Hide" (YAZ-4579 D30, YAZ-4564 D25): this view keeps the notes directly in the folder and
  // its shortcuts — a folder row is directly in it — narrowing the folder's set as its filters do.
  const hideSubfolders = hidesSubfolderNotes(view)
  const inView = useMemo(() => (hideSubfolders ? records.filter((r) => directlyIn(r, pageFolder)) : records), [records, hideSubfolders, pageFolder])
  const shown = useMemo(() => (Object.keys(moves).length === 0 ? inView : applyMoves(inView, moves)), [inView, moves])
  // A whole subfolder's move to Other files (YAZ-4747 OF2) asks only about the notes THIS view shows: the door, again,
  // with them bound. Stable: the notes are read when the move runs.
  const folderTray = useContext(OtherFilesFolderMove)
  const shownRef = useRef(shown)
  shownRef.current = shown
  const viewFolderTray = useMemo<FolderTray | null>(
    () => (folderTray === null ? null : { ...folderTray, move: (dir) => folderTray.move(dir, shownRef.current.filter((r) => !isFolderRow(r)).map((r) => r.path)) }),
    [folderTray],
  )
  // YAZ-2290 D4: a folder's rows are the notes IN it, so the engine's own rows-are-the-vault
  // resolver would miss every link pointing outside them — inject the whole-vault one, WITH the
  // root (YAZ-846), so an absolute-path link target resolves, and with the folders behind the
  // notes (D10), so a link to a folder reads, sorts and groups as that folder's name.
  const vaultRecords = folder.vaultRecords
  const vaultFolders = folder.vaultFolders
  const resolve = useMemo(() => pageResolver(vaultRecords, vaultFolders, root, folder.resolveLink), [vaultRecords, vaultFolders, root, folder.resolveLink])
  /** The Page tab (YAZ-4584 D38) is the folder's DOCUMENT, not rows: the toolbar offers no Properties, Filter or Search. */
  const isPage = view.type === PAGE_VIEW_TYPE
  // A Folder level groups by the folders below the page (YAZ-2541), each headed by its title off the vault's folder records.
  // YAZ-4799: a note's shortcut folders, off the index's records (the rows the views get have `also_in` taken out).
  const alsoInOf = useMemo(() => {
    const byPath = new Map<string, readonly string[]>()
    for (const r of vaultRecords) {
      const ids = alsoIn(r.properties)
      if (ids.length > 0) byPath.set(r.path, ids)
    }
    return (path: string): readonly string[] => byPath.get(path) ?? []
  }, [vaultRecords])
  const page = useMemo(() => ({ folder: pageFolder, folders: vaultFolders, vault: folder.vaultName, alsoIn: alsoInOf }), [pageFolder, vaultFolders, folder.vaultName, alsoInOf])
  // The Folder column and the Folder group headers (YAZ-4564 D26/D27): a folder by the title its group shows (the engine's
  // `labelOf`), and its page through the host's door. One map per folder snapshot; nothing here runs on a keystroke.
  const openFolderPage = folder.openFolderPage
  // YAZ-4795 demo: every link-target control on this page (Edit column, Add column) is the "Notes from" folder picker.
  const linkFolders = useMemo(() => ({ folders: vaultFolders, resolveLink: folder.resolveLink }), [vaultFolders, folder.resolveLink])
  const folderPages = useMemo<FolderPagesValue>(() => {
    const titles = new Map<string, string>([...vaultFolders.map((f) => [f.folder, f.title] as const), ['', folder.vaultName]])
    return {
      folder: pageFolder,
      title: (dir) => titles.get(dir) ?? dir.slice(dir.lastIndexOf('/') + 1),
      open: openFolderPage === undefined ? undefined : (dir) => openFolderPage(absFrom(root, dir)),
      // A folder row's "N inside" (YAZ-4579 D32): what its own page shows, its notes below and its shortcuts (D4), off the snapshot's one map.
      inside: (dir) => rowsByFolder(vaultRecords, vaultFolders).get(dir)?.length ?? 0,
      folderColumn: folderColumnOf(view),
      folderIcons: view.folderIcons !== false,
      folderCounts: view.folderCounts !== false,
    }
  }, [vaultRecords, vaultFolders, folder.vaultName, pageFolder, openFolderPage, root, view])
  /**
   * A row's page through the door that fits it (YAZ-4579 D32): a folder row's is its folder, so a click opens it through
   * "Open folder page" (`FolderHost.openFolderPage`) and the other doors — a background tab, the right panel — take its
   * directory path, as a folder tab does (D3). A note's path passes through unchanged.
   */
  const openFolderRow = (dir: string) => (openFolderPage ?? onOpenFile)(dir)
  const openRow = (path: string) => (rowPage(path) !== path ? openFolderRow(rowPage(path)) : onOpenFile(path))
  const openBackground = folder.openBackground
  const openRowBackground = openBackground === undefined ? undefined : (path: string) => openBackground(rowPage(path))
  const openRight = folder.openRight
  const openRowRight = openRight === undefined ? undefined : (path: string) => openRight(rowPage(path))
  const openNewTab = folder.openNewTab
  const openRowNewTab = openNewTab === undefined ? undefined : (path: string) => openNewTab(rowPage(path))
  /**
   * A click on a link pill (YAZ-4601 D47) opens the LINKED page by the note links' rule (⌘ a background tab, ⌥ the right
   * panel) and nothing else: in the capture phase, so the cell under it neither selects nor edits and its card does not
   * open. A double-click on it edits nothing either; one on the cell's empty space still does.
   */
  const onPillClick = (e: ReactMouseEvent) => {
    const path = pillOf(e.target)?.dataset.linkPath
    if (path === undefined) return
    e.stopPropagation()
    e.preventDefault()
    if (e.type !== 'click') return
    closeItemHover()
    openByGesture(e, path, { onOpenFile, onOpenFileBackground: openBackground, onOpenFileRight: openRight })
  }
  const renderNoteEditor = folder.renderNoteEditor
  // A Select column's options in the column editor's order (YAZ-3940): its sorts and groups follow them. One typing
  // per key for these records (YAZ-4544): a run that the view's def starts reads no record for it again.
  const settings = folder.settings
  const optionOrder = useMemo(() => optionOrderFor(shown, properties, settings), [shown, properties, settings])
  // Option parents (YAZ-4799): a Select column's parent column and each option's parent there, off the page's columns.
  const optionParent = useMemo(() => optionParentFor(settings), [settings])
  // The page's Linked mentions columns (YAZ-4738): off the snapshot's one reverse map, built once per snapshot.
  const resolveLink = folder.resolveLink
  const mentions = useMemo(() => mentionsColumns(settings.columns, vaultRecords, vaultFolders, resolveLink), [settings, vaultRecords, vaultFolders, resolveLink])
  // An Image column sorts by the picture's file name (YAZ-4802).
  const byFileName = useMemo(() => (key: string) => settings.columns[key.startsWith('note.') ? key.slice(5) : key]?.kind === 'image', [settings])
  const result = useMemo(
    // The week's start for "is this week" (YAZ-4919); the clock is the run's own.
    () => runView(def, view, shown, { resolve, declared: pageColumnKeys(folder.settings), page, optionOrder, optionParent, mentions, byFileName, weekStartsOn: defaults.weekStartsOn }),
    [def, view, shown, resolve, page, optionOrder, optionParent, mentions, byFileName, defaults.weekStartsOn],
  )

  const configuredGroups = boardOptionGroups(result.groups, view, key => columnTyping(key, shown, properties, folder.settings), optionParent)
  // "Show empty groups" (YAZ-3940 S11): a Table keeps its empty option groups through a search, as the board does.
  const keepEmpty = (view.type === 'board' || view.type === 'table') && view.showEmptyColumns === true
  const needle = (search ?? '').trim().toLowerCase()
  // Search reads what the eye reads (YAZ-2293 D8): a row is found by the TITLE of a note it links to by id.
  // A folder row (YAZ-4595 S36) is found by its title too: its `file.name` is `.folder.md`, and a view may hide Name.
  const matches = (r: Row) =>
    (isFolderRow(r.record) && r.record.title.toLowerCase().includes(needle)) || Object.values(r.values).some((v) => render(v, resolve).toLowerCase().includes(needle))
  const rows = needle ? result.rows.filter(matches) : result.rows
  // 13BL: off leaves only the right-click doors (New row below, New note in this group); a view with no rows keeps its New buttons (NB4), so
  // an empty page always has a way to its first note.
  const newButtons = showNewButtons || rows.length === 0
  // Search filters WITHIN each group; a group with no matching rows disappears (4C, GRO-2137). A
  // nested group (YAZ-745, every level since YAZ-4531) narrows each branch the same way — emptied
  // children go, and `rows` stays the union of what is left beneath, so a group whose whole branch missed drops too.
  const narrow = (g: Group): Group => {
    if (g.children === undefined) return { ...g, rows: g.rows.filter(matches) }
    const children = g.children.map(narrow).filter((c) => keepEmpty || c.rows.length > 0)
    const direct = (g.direct ?? []).filter(matches)
    return { ...g, rows: [...direct, ...children.flatMap((c) => c.rows)], children, direct }
  }
  const groups = configuredGroups === null ? null : needle ? configuredGroups.map(narrow).filter((g) => keepEmpty || g.rows.length > 0) : configuredGroups

  // Collapse state lives per `<pagePath>::<viewName>` in the main-owned store — NEVER in the
  // page's own card, so toggling can not touch autosave.
  const collapseKey = `${folderPath}::${view.name}`
  const collapsed = collapsedByKey[collapseKey] ?? storage.getViewGroups(root, collapseKey)
  const writeCollapsed = (next: readonly string[]) => {
    setCollapsedByKey((m) => ({ ...m, [collapseKey]: [...next] }))
    storage.setViewGroups(root, collapseKey, next)
  }
  /**
   * The store is keyed by view NAME, and since YAZ-1471 a name changes in one gesture: a rename
   * carries the entry to the new key and a delete drops it — else the renamed view springs open,
   * the old key leaks, and a later view given the same name inherits a stranger's groups (YAZ-1493).
   */
  const moveCollapsed = (from: string, to: string | null) => {
    const fromKey = `${folderPath}::${from}`
    const kept = collapsedByKey[fromKey] ?? storage.getViewGroups(root, fromKey)
    const toKey = to === null || kept.length === 0 ? null : `${folderPath}::${to}`
    setCollapsedByKey((m) => {
      const next = { ...m }
      delete next[fromKey]
      if (toKey !== null) next[toKey] = kept
      return next
    })
    storage.setViewGroups(root, fromKey, [])
    if (toKey !== null) storage.setViewGroups(root, toKey, kept)
  }
  const onToggleGroup = (key: string) => {
    writeCollapsed(collapsed.includes(key) ? collapsed.filter((k) => k !== key) : [...collapsed, key])
  }
  // Collapse / expand all (YAZ-744): every group the VIEW has, not the search-narrowed `groups` —
  // a group hidden behind an active search must collapse with the rest. Nested levels (YAZ-745,
  // YAZ-4531) go in document order, each group before its children, and it is the KEY count that meets
  // the store's cap: above it the toggle hides rather than writing a list `setViewGroups` would truncate.
  const keysOf = (list: readonly Group[], at: GroupSpot): string[] =>
    list.flatMap((g) => [spotKey(g, at), ...keysOf(g.children ?? [], childSpot(g, at))])
  const groupKeys = configuredGroups === null ? [] : keysOf(configuredGroups, TOP_SPOT)
  const allGroupKeys = groupKeys.length > MAX_COLLAPSED_GROUP_KEYS ? [] : groupKeys
  // One level at a time (YAZ-3746 13AT, S8): offered while the view has two levels or more, and the store can hold its keys.
  const nodesOf = (list: readonly Group[], at: GroupSpot): LevelNode[] =>
    list.map((g) => ({ key: spotKey(g, at), ...(g.nested === true ? { nested: true as const } : {}), ...(g.children === undefined ? {} : { children: nodesOf(g.children, childSpot(g, at)) }) }))
  // A nested Folder level is levels too (YAZ-4918, `groupDepthOf`).
  const levelNodes = configuredGroups !== null && allGroupKeys.length > 0 && groupDepthOf(view) >= 2 ? nodesOf(configuredGroups, TOP_SPOT) : null
  const steps = levelNodes === null ? null : levelSteps(levelNodes, collapsed)
  const levelActions: GroupLevelStepActions | null =
    steps === null || levelNodes === null
      ? null
      : {
          ...(steps.collapseOne === null ? {} : { collapseOne: () => writeCollapsed(steps.collapseOne!) }),
          ...(steps.expandOne === null ? {} : { expandOne: () => writeCollapsed(steps.expandOne!) }),
          // A nested Folder group's "Expand all" / "Collapse all" (YAZ-4928): worked out when that header's menu opens.
          branch: (key) => {
            const b = branchSteps(levelNodes, key, collapsed)
            if (b === null) return undefined
            return {
              ...(b.expandAll === null ? {} : { expandAll: () => writeCollapsed(b.expandAll!) }),
              ...(b.collapseAll === null ? {} : { collapseAll: () => writeCollapsed(b.collapseAll!) }),
            }
          },
        }

  // ⌘F (YAZ-4613, D64): the note's find bar over the view's rows as shown, the search box's narrowing included. Read at
  // each search, never at render: the table matches cells, Board, List and Cards a card's fields, Calendar the titles of
  // the cards on screen (the note window's order). A jump into a collapsed group opens it.
  const find = useViewFind(
    paneRef,
    {
      source: () => {
        const kind = view.type === 'table' ? 'table' : view.type === 'calendar' ? 'titles' : ['board', 'list', 'cards'].includes(view.type) ? 'cards' : null
        if (kind === null) return null
        const ctx = { resolve, decls: settings.columns, pageFolder, folderTitle: folderPages.title }
        if (kind === 'titles') return { kind, rows: windowLink.rows, groups: null, keys: [], ctx }
        return { kind, rows, groups, keys: propertyKeys(def, view, shown, pageColumnKeys(settings)), ctx }
      },
      collapsed,
      expand: (open) => writeCollapsed(collapsed.filter((k) => !open.includes(k))),
    },
    [result, needle, view.type],
    isPage,
  )

  /**
   * The board's optimistic write, shared with the calendar (YAZ-4540 D4): the move shows at once,
   * then ONE guarded write of the note; a failure drops the move (the card snaps back) and flags it.
   * A move that names where it went (`to`) says "Moved to <to>" once the write lands, with the app's
   * Undo (YAZ-4541 S6): Undo writes each `prevRaw` back the same way, and says nothing itself.
   */
  /**
   * Confirm changes (YAZ-3746 13AN): the page's ask, its card, and the toolbar's pause chip. A drop asks where the
   * pointer let go; a cell asks by itself (`TableView`); undo never asks.
   */
  const { confirm: confirmChange, card: changeAsk, pauseChip } = useConfirmChanges(folderPath, confirmChanges, onConfirmChangesOff)
  const lastPointer = useRef<{ x: number; y: number } | undefined>(undefined)
  useEffect(() => {
    const up = (e: PointerEvent) => void (lastPointer.current = { x: e.clientX, y: e.clientY })
    const drop = (e: DragEvent) => void (lastPointer.current = { x: e.clientX, y: e.clientY })
    window.addEventListener('pointerup', up, true)
    window.addEventListener('drop', drop, true)
    return () => {
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('drop', drop, true)
    }
  }, [])
  const titleOf = (path: string) => records.find((r) => r.path === path)?.title ?? path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '')
  /** A drop that names where it went asks first (13AN); undo's write back (no `to`) does not. */
  const moveValues = (path: string, writes: PendingMove, to?: string) => {
    if (confirmChange === undefined || to === undefined) return applyMove(path, writes, to)
    void confirmChange({ kind: 'Move', note: titleOf(path), to, action: 'Move', point: lastPointer.current }).then((ok) => ok && applyMove(path, writes, to))
  }
  /** A List or Cards cell's write (13AN): asked by the item; a cancel puts the old value back (`CHANGE_CANCELLED`). */
  const askedWriteValue = (path: string, key: string, value: unknown): Promise<unknown> => {
    if (confirmChange === undefined) return writeValue(path, key, value)
    const anchor = document.activeElement instanceof Element ? document.activeElement.closest('li, .view-card, td') : null
    const was = records.find((r) => r.path === path)?.properties[key]
    return confirmChange({ kind: propertyLabel(def, key), note: titleOf(path), from: was, to: value, anchor }).then((ok) => (ok ? writeValue(path, key, value) : Promise.reject(CHANGE_CANCELLED)))
  }
  /** A title edit renames the note (13AN): asked first. */
  const askedRetitle = (path: string, title: string): void => {
    if (confirmChange === undefined) return folder.retitle(path, title)
    const anchor = document.activeElement instanceof Element ? document.activeElement.closest('td') : null
    void confirmChange({ kind: 'Rename', from: titleOf(path), to: title, action: 'Rename', anchor }).then((ok) => ok && folder.retitle(path, title))
  }
  const applyMove = (path: string, writes: PendingMove, to?: string) => {
    setMoveError(null)
    // A second write to the note before the index echoed the first keeps the first's keys (YAZ-4906: Fill, then Bold in
    // one visit of "Card style ›"); a write to the same key replaces it.
    setMoves((m) => ({ ...m, [path]: [...(m[path] ?? []).filter((w) => !writes.some((n) => n.key === w.key)), ...writes] }))
    folder.writeValues(path, writes).then(
      () => {
        if (to === undefined) return
        const back: PendingMove = writes.map((w) => ({ key: w.key, value: w.prevRaw, prevRaw: w.value }))
        folder.onNotice?.(`Moved to ${to}`, 'info', 'undo', { label: 'Undo', run: () => applyMove(path, back), fades: true })
      },
      (err: unknown) => {
        setMoves((m) => Object.fromEntries(Object.entries(m).filter(([p]) => p !== path)))
        setMoveError({ path, message: err instanceof Error ? err.message : String(err) })
      },
    )
  }

  // A drop on a board column / table section (5C, GRO-2143): optimistic move now, then the host writes
  // every changed key in one guarded transformation (`FolderHost.writeValues`); a failure drops the move (the card snaps back)
  // and flags the card instead. `drop` names
  // the LEVEL the row landed on (YAZ-1101) and may carry each differing ancestor's write — the level's
  // own first, then the ancestors nearest first, all optimistic as ONE unit so any one failing snaps
  // the whole move back (🔒 YAZ-745, YAZ-4531).
  /** The view's filter seed for a new note (`deriveSeed`), less any Linked mentions column (YAZ-4738): no note holds one. */
  const viewSeed = (): NewNoteSeed => {
    const seed = deriveSeed(def, view)
    for (const key of Object.keys(seed.properties)) if (isMentionsColumn(folder.settings.columns, key)) delete seed.properties[key]
    return seed
  }

  const onMoveToGroup = (path: string, value: unknown, swap?: GroupSwap, drop?: GroupDrop) => {
    const key = groupByKey(view, drop?.level ?? 0, folder.settings.columns)
    // A read-only note never moves, not even optimistically: the move writes a property (YAZ-3076 S53).
    if (key === null || readOnly.has(path)) return
    const props = records.find((r) => r.path === path)?.properties
    const prevRaw = props?.[key]
    /**
     * Fan-out (D3): edit the list rather than replace it. Elements are matched with the engine's own `equals` over
     * `fromYaml` and NO resolver — the exact comparison that decided the grouping — so we can only ever remove the
     * element that put this row in that group. The row's own level and a fanned-out ancestor level (YAZ-4636 T2) alike.
     */
    const swapped = (raw: unknown, { remove, add }: GroupSwap): unknown[] => {
      const list = Array.isArray(raw) ? raw : raw == null ? [] : [raw]
      const next = remove === null ? [...list] : list.filter((v) => !equals(fromYaml(v), remove))
      // No resolver: what is written is the STORED link, `[[<id>]]`, not the title the column shows (YAZ-2293 D8).
      if (add !== null) next.push(render(add))
      return next
    }
    if (swap !== undefined) value = swapped(prevRaw, swap)
    const writes: PendingMove = [{ key, value, prevRaw }]
    for (const write of drop?.ancestors ?? []) {
      const was = props?.[write.key]
      writes.push({ key: write.key, value: write.swap === undefined ? write.value : swapped(was, write.swap), prevRaw: was })
    }
    // The toast names the group the card went to: a fanned-out drop, the element it added (YAZ-4541 S6).
    const to = swap === undefined ? (value === undefined ? null : fromYaml(value)) : swap.add
    moveValues(path, writes, to === null ? 'No value' : render(to, resolve))
  }

  // The calendar (YAZ-4540 D4): its "Show by" column, and a drop on a day — or on "No date" (`null`),
  // which clears the value. The new day keeps the time the value had (`movedDate`).
  const calendarColumns = useMemo(
    () => (view.type === 'calendar' ? dateColumns(def, view, records, properties, folder.settings) : []),
    [def, view, records, properties, folder.settings],
  )
  const dateKey = view.type === 'calendar' ? calendarDateKey(view, calendarColumns, folder.settings.columns) : null
  const onMoveToDay = (path: string, day: DayKey | null) => {
    if (dateKey === null || readOnly.has(path)) return
    const prevRaw = records.find((r) => r.path === path)?.properties[dateKey]
    moveValues(path, [{ key: dateKey, value: day === null ? undefined : movedDate(prevRaw, day), prevRaw }], day === null ? 'No date' : dayLabel(day))
  }
  // The End date (YAZ-4858): a card's start and end in ONE move (`PendingMove` is a list), each keeping its time; a date
  // left out stays, `null` clears it. The toast names the days the card is on after it.
  const endKey = view.type === 'calendar' ? calendarEndKey(view, dateKey, folder.settings.columns) : null
  const onMoveSpan = (path: string, next: { start?: DayKey | null; end?: DayKey | null }) => {
    if (dateKey === null || readOnly.has(path)) return
    const props = records.find((r) => r.path === path)?.properties
    const writes: PendingMove = []
    const add = (key: string | null, day: DayKey | null | undefined) => {
      if (key === null || day === undefined) return
      const prevRaw = props?.[key]
      writes.push({ key, value: day === null ? undefined : movedDate(prevRaw, day), prevRaw })
    }
    add(dateKey, next.start)
    add(endKey, next.end)
    if (writes.length === 0) return
    const start = next.start !== undefined ? next.start : dayOf(props?.[dateKey])
    const end = next.end !== undefined ? next.end : endKey === null ? null : dayOf(props?.[endKey])
    const on = start ?? end
    moveValues(path, writes, on === null ? 'No date' : spanLabel(on, end !== null && end > on ? end : on))
  }
  /**
   * A card's style (YAZ-4906): the note's `color`, `text_color` and `weight` (`CardStyleMenu.tsx`; an undefined value
   * removes the key), the move's optimistic guarded write with no toast, and ONE step of the page's ⌘Z history (S41)
   * per pick, whose undo writes the values the note SHOWS (`shown`, the pending moves laid on: a second pick before the
   * index echoes the first undoes to the first, YAZ-4834 P3). A deliberate menu pick, as the table's Fill: it does not
   * ask Confirm changes.
   */
  const onCardStyle = (path: string, picks: readonly CardStyleWrite[]) => {
    if (readOnly.has(path) || picks.length === 0) return
    const props = shown.find((r) => r.path === path)?.properties
    const writes: PendingMove = picks.map(({ key, value }) => ({ key, value, prevRaw: props?.[key] }))
    const back: PendingMove = writes.map((w) => ({ key: w.key, value: w.prevRaw, prevRaw: w.value }))
    const ref = noteRef(path)
    const put = (w: PendingMove) => void (ref.path !== null && applyMove(ref.path, w))
    history.push({ undo: () => put(back), redo: () => put(writes), notes: [ref] })
    applyMove(path, writes)
  }
  // "Add a date column" (YAZ-4858 item 4): a Date column named "End date" ("End date 2" when taken), chosen as this
  // view's End date, in ONE settings write. Nothing is written into a note.
  const addEndColumn = () => {
    const taken = new Set(allPropertyKeys(def, view, records, folder.settings.columns).map((k) => canonicalKey(k).toLowerCase()))
    let name = 'End date'
    for (let n = 2; taken.has(`note.${name}`.toLowerCase()); n++) name = `End date ${n}`
    folder.setColumns(
      { ...folder.settings.columns, [name]: declarationForKind(undefined, 'date') },
      def.views.map((v, i) => (i === index ? { ...v, endDateProperty: `note.${name}` } : v)),
    )
  }

  // The toolbar's "New" / a group header's "+" (5D, GRO-2144): a note pre-filled to satisfy this
  // view — filter-derived seed, plus the group's raw value when created inside a group. It is born
  // IN the folder, from its template and that seed alone (YAZ-2290 D4/E1): a group "+" seeds its
  // group — or, grouped by Folder, is born in it. The note opens once the create lands; a failure shows the alert.
  // A `name` means the board's inline add (YAZ-943) — it already named the card and the caller is
  // mid-typing in the column, so that create STAYS on the board and opens nothing. `values` seed
  // more: a calendar day's "+" seeds its date (YAZ-4540 S10) and opens the note in the mini window (`open`,
  // YAZ-3746 13G), so the calendar stays; every other "+" opens it in this tab.
  const onNewNote = (group: Group | null, name?: string, at?: GroupSpot, values?: Record<string, unknown>, open: (path: string) => void = onOpenFile) => {
    const seed = viewSeed()
    if (values !== undefined) Object.assign(seed.properties, values)
    if (group !== null) {
      // 🔒 YAZ-745: an INNER "+" seeds every ancestor too (YAZ-4531), so the note lands in the very
      // section clicked. The ancestors go FIRST, outer first (YAZ-2541): under Folder then Folder each
      // level sets `seed.folder`, and the folder clicked is where the note must be born — so it writes last.
      // Each ancestor by its view level (YAZ-4918): a nested Folder level's groups share one.
      if (at !== undefined) chainLevels(at.ancestors).forEach((level, i) => seedGroup(seed, at.ancestors[i], view, level, folder.settings.columns))
      seedGroup(seed, group, view, at?.level ?? 0, folder.settings.columns)
    }
    setCreateError(null)
    folder
      .create(seed, name)
      .then((path) => {
        if (name === undefined) open(path)
      })
      .catch((err: unknown) => setCreateError(err instanceof Error ? err.message : String(err)))
  }

  /**
   * "New row below" (YAZ-4611 D63): a note seeded from `row` — the view's filter seed, then the row's values of the
   * view's sort columns (so it sorts next to the row), then every group level of its branch, as that group's "+" seeds.
   * It does not open: the table puts its Name cell in title edit. The toast's Undo moves it to the Trash.
   */
  const newRowBelow = (row: Row, group: Group | null, at: GroupSpot | null, toast = 'Added a row'): Promise<string> => {
    const seed = viewSeed()
    for (const rule of view.sort ?? []) {
      const key = writableKey(rule.property, folder.settings.columns)
      const value = key === null ? undefined : row.record.properties[key]
      if (key !== null && value !== undefined) seed.properties[key] = value
    }
    if (group !== null && at !== null) {
      chainLevels(at.ancestors).forEach((level, i) => seedGroup(seed, at.ancestors[i], view, level, folder.settings.columns))
      seedGroup(seed, group, view, at.level, folder.settings.columns)
    }
    setCreateError(null)
    const bornAt = Date.now()
    return folder.create(seed).then(
      (path) => {
        const trash = folder.trash
        if (trash !== undefined) {
          // The note as a ref (YAZ-4637 T3): a retitle in a vault without ids renames the file, and the ref follows; a
          // delete retires it. The Undo trashes only the note it made: nothing once it is gone, and nothing when the
          // index shows a file at that path born well after this row (the create-time marker).
          const ref = noteRef(path)
          const undo = () => {
            const at = ref.path
            if (at === null) return
            const now = latest.current.folder.vaultRecords.find((r) => r.path === at)
            if (now !== undefined && now.ctime > bornAt + NEWER_FILE_MS) return folder.onNotice?.("Can't undo: another note stands where the new row was")
            void trash([at]).catch((err: unknown) => folder.onNotice?.(`Can't undo: ${err instanceof Error ? err.message : String(err)}`))
          }
          // One step of the page's history too (S41); its undo trashes the note, so it has no redo. The toast's Undo is that step (T9e).
          const step = { undo, notes: [ref] }
          history.push(step)
          folder.onNotice?.(toast, 'info', 'undo', { label: 'Undo', run: () => void history.undoStep(step), fades: true })
        }
        return path
      },
      (err: unknown) => {
        setCreateError(err instanceof Error ? err.message : String(err))
        throw err
      },
    )
  }

  /** The innermost group that shows `path`, with its spot: what a card's "New card below" seeds, as a table row's branch (YAZ-3746 13BO CM2). */
  const branchOf = (path: string): { row: Row; group: Group | null; at: GroupSpot | null } | null => {
    if (groups === null) {
      const row = rows.find((r) => r.record.path === path)
      return row === undefined ? null : { row, group: null, at: null }
    }
    const find = (list: readonly Group[], at: GroupSpot): { row: Row; group: Group; at: GroupSpot } | null => {
      for (const g of list) {
        const inner = g.children === undefined ? null : find(g.children, childSpot(g, at))
        if (inner !== null) return inner
        const row = (g.children === undefined ? g.rows : g.direct ?? []).find((r) => r.record.path === path)
        if (row !== undefined) return { row, group: g, at }
      }
      return null
    }
    return find(groups, TOP_SPOT)
  }
  /** A card view's note doors (13BO CM1), the table's: Open, the new note beside a card (it opens in the mini window), Duplicate, Delete. */
  const cardDoors = (toast?: string): CardNoteDoors => ({
    open: openRow,
    newBelow:
      toast === undefined
        ? undefined
        : (path) => {
            const branch = branchOf(path)
            // It opens in the mini window, over the view it came from, as a calendar day's new note does (13G).
            if (branch !== null) void newRowBelow(branch.row, branch.group, branch.at, toast).then(openWindow, () => undefined)
          },
    duplicate: folder.duplicate,
    remove: confirmDeleteNotes,
  })

  const writeValue = (path: string, key: string, value: unknown) => folder.writeValues(path, [{ key, value }])

  const keys = propertyKeys(def, view, records, pageColumnKeys(folder.settings))
  const nameKey = keys.find((k) => canonicalKey(k) === 'file.name')
  const rest = keys.filter((k) => k !== nameKey)

  /**
   * The report-don't-block channel (YAZ-861): `settings.problems` — the one-liners `folderSettings`
   * collects while it ignores an unusable part of the settings — and `result.errors`, the
   * `EngineError`s a hand-written `filters:` or a broken formula compiles into. ONE muted line at
   * the foot of the pane, `role` `note` (never `alert`: nothing here failed), rendered only when
   * there is something to say, and blocking nothing above it.
   */
  const notes = [...folder.settings.problems, ...result.errors.map((e) => `${e.where}: ${e.message}`)]

  /** The `filters` half of that channel ALSO surfaces inside the Filter menu, where it is edited (YAZ-1229). */
  const filterErrors = result.errors.filter((e) => e.where.includes('filters'))

  /**
   * "Export as CSV…" / "Copy as table" (YAZ-4594 S30): view `i` as its tab shows it — its records (the Subfolders
   * switch), filters, sort and groups, then the search box — Name first, then its shown columns, each cell as drawn.
   * Run once per click, for any tab; a pending move is not in it. Null for the Page tab, which has no rows.
   */
  const viewText = (i: number): string[][] | null => {
    const v = withDefaults(views[i], defaults)
    if (v.type === PAGE_VIEW_TYPE) return null
    const all = showsFolderRows(v) && folderRows.length > 0 ? [...noteRecords, ...folderRows] : noteRecords
    const input = hidesSubfolderNotes(v) ? all.filter((r) => directlyIn(r, pageFolder)) : all
    const declared = pageColumnKeys(settings)
    const out = runView(def, v, input, { resolve, declared, page, optionOrder, mentions, byFileName, weekStartsOn: defaults.weekStartsOn })
    const grouped = boardOptionGroups(out.groups, v, (key) => columnTyping(key, input, properties, settings))
    const list = shownRows(out.rows, grouped)
    const ctx = { resolve, decls: settings.columns, pageFolder, folderTitle: folderPages.title }
    return viewTable(def, propertyKeys(def, v, input, declared), needle ? list.filter(matches) : list, ctx)
  }

  // View CRUD lives here since YAZ-1471 (re-ruling 🔒 rule 4, YAZ-819): every gesture is ONE
  // `update` — the same door as sort and columns — and which view is ACTIVE stays session state.
  const taken = () => new Set(views.map((v) => v.name))
  const tabs: ViewTabsProps = {
    views,
    active: index,
    onSelect: setActive,
    onMove: (from, to) => {
      update((d) => d.views.splice(to, 0, ...d.views.splice(from, 1)))
      // The active view FOLLOWS its tab: replay the same move over the indices.
      const order = views.map((_, i) => i)
      order.splice(to, 0, ...order.splice(from, 1))
      setActive(order.indexOf(index))
    },
    onAdd: (type) => {
      update((d) => d.views.push({ type, name: freeName(viewTypeLabel(type), taken()) }))
      setActive(views.length)
    },
    onRename: (i, name) => {
      moveCollapsed(views[i].name, name)
      // The open mini window follows its view tab too (YAZ-4635 P5).
      renameNoteWindowView(folderPath, views[i].name, name)
      update((d) => {
        if (d.defaultView === d.views[i].name) d.defaultView = name // the saved START follows (D4)
        d.views[i].name = name
      })
    },
    onDuplicate: (i) => {
      update((d) => d.views.splice(i + 1, 0, { ...structuredClone(d.views[i]), name: freeName(`${d.views[i].name} copy`, taken()) }))
      setActive(i + 1)
    },
    // "Make default view" (YAZ-4585 D41, words 13S): the saved START, set or cleared from the tab's right-click.
    defaultView: def.defaultView,
    onSetDefault: (i) =>
      update((d) => {
        if (d.defaultView === d.views[i].name) delete d.defaultView
        else d.defaultView = d.views[i].name
      }),
    onDelete: (i) => {
      if (views.length <= 1) return
      moveCollapsed(views[i].name, null)
      // Undo (YAZ-4594 S29) brings the view back in its place, and the tab that was active then is active again.
      const was = index
      update(
        (d) => {
          const [gone] = d.views.splice(i, 1)
          if (d.defaultView === gone.name) delete d.defaultView // a deleted START clears itself (D4)
        },
        `Deleted view ${views[i].name}`,
        () => setActive(was),
      )
      // The active view stays put unless it WAS the deleted one — then its right neighbour takes over
      // (the left one when it was the last tab); a view before it in the list shifts one index down.
      setActive(index === i ? Math.min(i, views.length - 2) : index > i ? index - 1 : index)
    },
    onExport: (i, as) => {
      const table = viewText(i)
      if (table === null) return
      if (as === 'copy') copyText(toTsv(table), 'table', (message) => folder.onNotice?.(message))
      else downloadText(csvName(folderPages.title(pageFolder), views[i].name), toCsv(table), 'text/csv;charset=utf-8')
    },
  }

  const pane = (
    <div ref={paneRef} className="views-pane" data-find-host={isPage ? undefined : ''} onMouseOver={onPillOver} onMouseOut={onPillOut} onClickCapture={onPillClick} onDoubleClickCapture={onPillClick}>
      <Toolbar
        def={def}
        view={view}
        viewIndex={index}
        records={records}
        filterErrors={filterErrors}
        shown={rows.length}
        total={result.total}
        folders={withFolders ? { shown: rows.filter((r) => isFolderRow(r.record)).length, total: result.folders } : undefined}
        search={search}
        onSearch={setSearch}
        onUpdate={update}
        onNew={newButtons ? () => onNewNote(null) : undefined}
        allGroupKeys={allGroupKeys}
        collapsed={collapsed}
        onSetAllGroups={writeCollapsed}
        tabs={tabs}
        properties={properties}
        documentView={isPage}
        folder={folder}
        dateColumns={calendarColumns}
        tabId={tabId}
        notice={pauseChip}
        filterAsks={filterAsks}
      />
      {/* ⌘F (YAZ-4613): on the Page tab the note's own find answers. */}
      {!isPage && <FindBar channel={find.channel} scope="views" hostRef={paneRef} />}
      {createError !== null && (
        <p className="views-pane__error" role="alert">
          Could not create note: {createError}
        </p>
      )}
      {properties?.error !== undefined && (
        <p className="views-pane__error" role="alert">
          Could not load the vault's property declarations: {properties.error}
        </p>
      )}
      {/* A Number or Date cell's format (YAZ-4591): the views alone read the declarations, never the note window's own panel. */}
      <ColumnDecls.Provider value={folder.settings.columns}>
      {/* An Image column's pictures (YAZ-4802) load from this vault. */}
      <ImageVault.Provider value={root}>
      <ViewFind.Provider value={find.link}>
      {isPage ? (
        // The note editor replaces the view body (YAZ-4584 D38): it saves the `.folder.md` body itself, never a settings write.
        <div className="view-page">{folder.renderPage?.()}</div>
      ) : view.type === 'table' ? (
        <TableView
          onOpenFilter={openFilter}
          hover={viewHover}
          readOnly={readOnly}
          def={def}
          view={view}
          viewIndex={index}
          records={shown}
          rows={rows}
          groups={groups}
          collapsed={collapsed}
          onToggleGroup={onToggleGroup}
          onUpdate={update}
          onOpenFile={openRow}
          onOpenFileRight={openRowRight}
          onOpenFileBackground={openRowBackground}
          onOpenWindow={openWindow}
          windowLink={windowLink}
          onNotice={folder.onNotice}
          onMoveToGroup={onMoveToGroup}
          moveError={moveError}
          onNewInGroup={onNewNote}
          newRows={newButtons}
          root={root}
          properties={properties}
          settings={folder.settings}
          vaultRecords={vaultRecords}
          vaultFolders={vaultFolders}
          resolve={resolve}
          resolveLink={folder.resolveLink}
          setColumn={folder.setColumn}
          declareColumn={folder.setColumns}
          addColumn={folder.addColumn}
          deleteColumn={folder.deleteColumn}
          sources={folder.sources}
          valueCount={folder.valueCount}
          separate={folder.separate}
          relation={folder.relation}
          onWriteValue={writeValue}
          onWriteValues={folder.writeValues}
          onRetitle={askedRetitle}
          confirmChange={confirmChange}
          reservedKeys={columnReservedKeys(folder.wikilinks.ids)}
          onDuplicateNote={folder.duplicate}
          onDeleteNotes={confirmDeleteNotes}
          onNewRowBelow={newRowBelow}
          history={history}
          selectionChip={selectionChip}
        />
      ) : view.type === 'board' ? (
        <BoardView
          noteDoors={cardDoors('Added a card')}
          hover={viewHover}
          readOnly={readOnly}
          onStyle={onCardStyle}
          settings={folder.settings}
          def={def}
          view={view}
          viewIndex={index}
          records={shown}
          groups={groups}
          collapsed={collapsed}
          onToggleGroup={onToggleGroup}
          onUpdate={update}
          onOpenFile={openRow}
          onOpenFileRight={openRowRight}
          onOpenFileBackground={openRowBackground}
          onOpenWindow={openWindow}
          windowLink={windowLink}
          onNotice={folder.onNotice}
          onMoveToGroup={onMoveToGroup}
          moveError={moveError}
          onNewInGroup={onNewNote}
          newCards={newButtons}
          resolve={resolve}
        />
      ) : view.type === 'calendar' ? (
        <CalendarView
          noteDoors={cardDoors()}
          hover={viewHover}
          readOnly={readOnly}
          def={def}
          view={view}
          records={shown}
          settings={folder.settings}
          resolve={resolve}
          rows={rows}
          dateKey={dateKey}
          endKey={endKey}
          dateColumns={calendarColumns}
          onMoveSpan={onMoveSpan}
          onChooseEnd={(column) =>
            update((d) => {
              d.views[index].endDateProperty = column
            })
          }
          onAddEndColumn={addEndColumn}
          onOpenFile={openRow}
          onOpenFileRight={openRowRight}
          onOpenFileBackground={openRowBackground}
          onOpenWindow={openWindow}
          windowLink={windowLink}
          onNotice={folder.onNotice}
          onMoveToDay={onMoveToDay}
          onStyle={onCardStyle}
          history={history}
          onHeaderRow={(mutate) => update((d) => mutate(d.views[index]))}
          moveError={moveError}
          onNewOnDay={(day) => {
            // The new note opens in the mini window (YAZ-3746 13G); in this tab where the host has no editor for one.
            if (dateKey !== null) onNewNote(null, undefined, undefined, { [dateKey]: day }, openWindow)
          }}
          scale={view.calendarScale === 'week' ? 'week' : 'month'}
          onScale={(scale) =>
            update((d) => {
              // Settings' scale removes the key (YAZ-4558 D22, YAZ-4585): Month, unless Settings › Folder pages says Week.
              chooseOwn(d.views[index], 'calendarScale', scale, defaults)
            })
          }
          sundayFirst={defaults.weekStartsOn === 'sunday'}
          wrap={view.cardTitles === 'wrap'}
          hideWeekends={hidesWeekends(view, hideWeekendsDefault(defaults))}
        />
      ) : view.type === 'cards' ? (
        <CardsView
          noteDoors={cardDoors('Added a card')}
          hover={viewHover}
          readOnly={readOnly}
          def={def}
          view={view}
          root={root}
          records={records}
          rows={rows}
          groups={groups}
          collapsed={collapsed}
          onToggleGroup={onToggleGroup}
          onOpenFile={openRow}
          onOpenFileRight={openRowRight}
          onOpenFileBackground={openRowBackground}
          onOpenWindow={openWindow}
          windowLink={windowLink}
          onNotice={folder.onNotice}
          onNewInGroup={onNewNote}
          properties={properties}
          settings={folder.settings}
          vaultRecords={vaultRecords}
          vaultFolders={vaultFolders}
          resolve={resolve}
          resolveLink={folder.resolveLink}
          onWriteValue={askedWriteValue}
        />
      ) : view.type === 'list' ? (
        <ListView
          noteDoors={cardDoors('Added a row')}
          hover={viewHover}
          readOnly={readOnly}
          def={def}
          view={view}
          records={records}
          rows={rows}
          groups={groups}
          collapsed={collapsed}
          onToggleGroup={onToggleGroup}
          onOpenFile={openRow}
          onOpenFileRight={openRowRight}
          onOpenFileBackground={openRowBackground}
          onOpenWindow={openWindow}
          windowLink={windowLink}
          onNotice={folder.onNotice}
          onNewInGroup={onNewNote}
          root={root}
          properties={properties}
          settings={folder.settings}
          vaultRecords={vaultRecords}
          vaultFolders={vaultFolders}
          resolve={resolve}
          resolveLink={folder.resolveLink}
          onWriteValue={askedWriteValue}
        />
      ) : (
        <ul className="view-rows">
          {rows.map((row) => (
            <li key={row.record.path} className="view-row">
              <button type="button" className="view-row__link" onClick={() => openRow(row.record.path)}>
                {row.record.title}
              </button>
              {rest.length > 0 && <span className="view-row__values">{rest.map((k) => render(row.values[k], resolve)).join(' · ')}</span>}
            </li>
          ))}
        </ul>
      )}
      </ViewFind.Provider>
      </ImageVault.Provider>
      </ColumnDecls.Provider>
      {notes.length > 0 && (
        <p className="views-pane__notes" role="note">
          {notes.join(' · ')}
        </p>
      )}
      {/* After the views: the table has written this render's rows to the link when the card reads them. */}
      {noteWindow !== undefined && renderNoteEditor !== undefined && (
        <NoteWindow
          key={`${windowKey}:${opens}`}
          // A folder row's window shows its folder page (YAZ-4579 D32): the editor a folder tab has, on the directory.
          renderEditor={(path) => renderNoteEditor(rowPage(path))}
          link={windowLink}
          titleOf={(path) => records.find((r) => r.path === path)?.title ?? path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '')}
          memory={noteWindow}
          // ↗ opens a new tab (YAZ-3746 13I) and the window stays open on this tab (13AJ); a host without that door opens
          // in this tab, as before, and the window closes with the page it was on.
          onOpenInTab={
            openRowNewTab ??
            ((path) => {
              closeWindow()
              openRow(path)
            })
          }
          onClose={closeWindow}
          onPlaced={(memory) => saveNoteWindowBox(folderPath, memory)}
        />
      )}
      {deleteSheet}
      {changeAsk}
      {/* A pill's page (YAZ-4601 D47) may be outside the folder: its title is the vault's. */}
      <CardPreviewHost store={itemHover.store} cardOf={(_, path) => ({ root: null, name: (records.find((r) => r.path === path) ?? vaultRecords.find((r) => r.path === path))?.title ?? '' })} scopeOf={previewScope} diagramDarkColors={diagramDarkColors} />
      {/* The selection's Count / Sum / Average (YAZ-4612 S46), docked at the bottom right of the visible table, as Sheets
          shows its sum (YAZ-3746 13X): in the toolbar row it made that row wrap and the page jump at some widths. */}
      {view.type === 'table' && (
        <div className="views-pane__selection-dock">
          <span ref={selectionChip} className="view-toolbar__selection" aria-live="polite" hidden />
        </div>
      )}
    </div>
  )
  // The Folder column's chips and the Folder group headers' ↗ read the page's folders (YAZ-4564); the cells show links as pills (YAZ-4601).
  return (
    <ViewDefaults.Provider value={defaults}>
      <LinkFoldersContext.Provider value={linkFolders}>
      <FolderPages.Provider value={folderPages}>
        <LinkPills.Provider value={true}>
          <TextLinkPicker.Provider value={true}>
            <GroupLevelStepsContext.Provider value={levelActions}>
              <OtherFilesFolderMove.Provider value={viewFolderTray}>{pane}</OtherFilesFolderMove.Provider>
            </GroupLevelStepsContext.Provider>
          </TextLinkPicker.Provider>
        </LinkPills.Provider>
      </FolderPages.Provider>
      </LinkFoldersContext.Provider>
    </ViewDefaults.Provider>
  )
}
