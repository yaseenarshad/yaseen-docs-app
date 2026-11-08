import { boardOptionGroups } from './boardOptionGroups'
import { columnTyping } from './editorType'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MAX_COLLAPSED_GROUP_KEYS, type DiagramDarkColors, type IndexRecord, type PropertiesResponse } from '@shared/types'
import type { WikilinkNav } from '../editor/wikilink/wikilinkClick'
import type { Notice, NoticeKind, NoticeType } from '../lib/notice'
import type { WikilinkCandidateSource } from '../editor/wikilink/wikilinkPicker'
import type { ResolveLink, WikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { pageResolver } from '../links/folderLinks'
import { relTo } from '../lib/paths'
import { storage } from '../lib/storage'
import { type ViewSet, type ViewDef, type ParsedViews, parseViews, serializeViews, updateViews } from './viewSchema'
import { type Group, type Row, propertyKeys, runView } from './engine'
import { equals, fromYaml, render } from './expr'
import type { ColumnDecl, FolderSettings } from './folderSettings'
import { type NewNoteSeed, deriveSeed } from './newNote'
import type { PropertyWrite } from './writeProperty'
import { BoardView } from './view/BoardView'
import { CalendarView } from './view/CalendarView'
import { type DayKey, calendarDateKey, dateColumns, dayLabel, movedDate } from './calendar'
import { CardsView } from './view/CardsView'
import { canonicalKey } from './view/keys'
import { type GroupDrop, type GroupSpot, type GroupSwap, type PendingMove, TOP_SPOT, applyMoves, childSpot, groupByKey, groupsByFolder, spotKey } from './view/groupDrag'
import { ListView } from './view/ListView'
import { OutlineView } from './view/OutlineView'
import { TableView } from './view/TableView'
import { NoteWindow, type NoteWindowMemory, dropNoteWindow, keepNoteWindow, noteWindowKey, noteWindowLink, noteWindowMemory, openNoteWindow } from './view/NoteWindow'
import { Toolbar } from './view/Toolbar'
import { type ViewTabsProps, viewTypeLabel } from './view/ViewTabs'
import { NO_READ_ONLY } from './readOnlyRows'
import { reservedKeys } from '../links/reservedKeys'
import { CardPreviewHost, useCardPreview, type PreviewScope } from '../tabs/cardPreview'
import type { ViewHover } from './view/viewHover'

/**
 * The folder host's bundle (🔒 D3, YAZ-819). ViewsPane stays ONE component: the host (`FolderView`),
 * its only mount, hands it an in-memory def and this bundle.
 */
export interface FolderHost {
  /** The folder's own declaration: the typing ladder's TOP rung (🔒 Q8, YAZ-815). */
  settings: FolderSettings
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
  /** Save one definition against the captured base; reject concurrent changes to that property. */
  setColumn: (key: string, next: ColumnDecl, base: ColumnDecl | undefined) => Promise<unknown>
  /**
   * Write the declarations (YAZ-895): ONE settings write, fire-and-forget — a failure shows in the
   * host's banner. `views` lets a caller move the columns AND `view.order` in that same write;
   * without it the host writes its live views, so a column write never clobbers an edit still in
   * flight. `labels`, when given, replaces the column labels (`undefined` inside it means none).
   * `settings.columns` is the host's ahead copy (YAZ-1549): the ONE map to spread or hand back as `base`.
   */
  setColumns: (columns: Record<string, ColumnDecl>, views?: ViewDef[], labels?: { properties: ViewSet['properties'] }) => void
  /**
   * "Delete column…" (YAZ-1513): the declaration, every view reference, the label AND the folder's
   * value for it on every note holding one — `views/deleteColumn.ts`, ONE function behind both menus. Never rejects:
   * the host reports failures in its own banner. A host whose columns are the notes' own properties
   * has none (YAZ-2523 🔒 V11): the menus then offer no delete, and a column is hidden instead.
   */
  deleteColumn?: (key: string) => Promise<void>
  /** How many notes hold the folder's value for a column — the number that delete's confirm states. */
  valueCount: (key: string) => number
  /**
   * The ONE door a view writes a row's values through — a cell edit, a board or section drop — in
   * one guarded write of that note. `records` ARE the folder's values for each row, and only the
   * host knows where a note keeps them (D19: its block of `in`).
   */
  writeValues: (path: string, writes: readonly PropertyWrite[]) => Promise<unknown>
  /** A row's title edited in a table's Name cell (YAZ-2420 🔒 D19): the one title edit, through App's rename door. */
  retitle: (path: string, title: string) => void
  /** ⌘-click on a table row opens the page in a BACKGROUND tab (YAZ-820); absent → opens in place. */
  openBackground?: (path: string) => void
  /** Shared Table/Board action that opens the exact page in the window's right panel. */
  openRight?: (path: string) => void
  /**
   * A full editor on a note, for the table's note window (YAZ-4547 D14): App's, the same editor a tab has. Stable.
   * Absent: the row menu has no "Open in a window".
   */
  renderNoteEditor?: (path: string) => ReactNode
  /**
   * Passive notice surface for row actions that fail because a page moved or disappeared. App's
   * `notify`: a move's "Moved to … · Undo" (YAZ-4541 S6) rides its glyph, type and action too.
   */
  onNotice?: (message: string, icon?: NoticeKind, type?: NoticeType, action?: Notice['action']) => void
  /**
   * The outline editor's own wikilink surfaces (YAZ-903) — the window's ONE resolve source, its
   * `[[` picker feed and the click-navigation contract, assembled by the host exactly as
   * `Editor` assembles them for the note. `nav`'s identity must be STABLE: a new object remounts
   * the editor, and a remount costs the caret.
   */
  wikilinks: WikilinkResolveSource
  wikilinkCandidates?: WikilinkCandidateSource
  nav?: WikilinkNav
}

export interface ViewsPaneProps {
  parsed: ParsedViews
  /** Every config change arrives here as `updateViews(parsed, …)`; the host turns it into a write. */
  onChange: (next: ParsedViews) => void
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
  /** Settings › Preview on hover › Folder views (YAZ-3403): resting on an item shows the sidebar's panel beside it. */
  hoverPreview?: boolean
  /** What the hover panel needs of a page's vault: App's `boardPreviewScope`. No scope, no hover panel. */
  previewScope?: (path: string) => PreviewScope
  diagramDarkColors?: DiagramDarkColors
  /** Settings › "Folding default" (YAZ-4094 F1), for the outline skin, which has no page cog. */
  foldingOnByDefault?: boolean
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
function seedGroup(seed: NewNoteSeed, group: Group, view: ViewDef, level: number): void {
  if (!groupsByFolder(view, level)) seedGroupValue(seed.properties, group, groupByKey(view, level))
  else if (typeof group.key === 'string') seed.folder = group.key
}

/**
 * One set of views (GRO-2135): the toolbar (view switcher, sort / properties menus, search,
 * count) over the body — the real table for `type: table` (GRO-2136), the board for
 * `type: board` (4D, GRO-2138), the card grid for `type: cards` (4E, GRO-2139), the list for
 * `type: list` (4F, GRO-2140), the outline for `type: outline` (YAZ-820), the month grid for
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
function keepBackView(key: string, name: string): void {
  backViews.delete(key)
  backViews.set(key, name)
  if (backViews.size > MAX_BACK_VIEWS) backViews.delete(backViews.keys().next().value!)
}

export function ViewsPane({ parsed, onChange, root, folderPath, tabId, viewKey, records, readOnly = NO_READ_ONLY, properties = null, onOpenFile, folder, hoverPreview = false, previewScope, diagramDarkColors = 'adapt', foldingOnByDefault }: ViewsPaneProps) {
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
  // inline editor is open: the dwell's end finds no item then.
  const paneRef = useRef<HTMLDivElement>(null)
  const itemHover = useCardPreview(hoverPreview, (path) => {
    if (paneRef.current?.querySelector('[data-editing]') != null) return null
    const items = [...(paneRef.current?.querySelectorAll<HTMLElement>(`[data-hover-item="${CSS.escape(path)}"]`) ?? [])]
    return items.find((el) => el.matches(':hover')) ?? items[0] ?? null
  })
  const { hoverCard, leaveCard, close: closeItemHover } = itemHover
  // The note window (YAZ-4547): `opens` mounts a new card per open and renders each open and close; the link to the
  // table; the place, size and pin of the last card closed here, for the next open while this folder page is mounted.
  const [opens, setOpens] = useState(0)
  const windowLink = useMemo(noteWindowLink, [])
  const lastWindow = useRef<NoteWindowMemory | null>(null)
  const itemProps = useCallback((path: string) => ({ 'data-hover-item': path, onMouseEnter: () => hoverCard(path, path), onMouseLeave: () => leaveCard(path) }), [hoverCard, leaveCard])
  const viewHover = useMemo<ViewHover>(() => ({ itemProps }), [itemProps])
  // New records (a sync, another window's edit) can remove or move the item under the panel, and a removed item
  // fires no `mouseleave`: the panel goes.
  useEffect(() => closeItemHover(), [records, closeItemHover])
  const { def } = parsed
  const views = def.views
  const index = Math.max(0, Math.min(active, views.length - 1))
  /**
   * NEVER undefined (YAZ-861): `views` cannot be empty — `folderSettings` and the one mount's
   * `folderViewSet` both fall back to `DEFAULT_VIEWS` — and `index` is clamped into that list.
   */
  const view = views[index]!
  useEffect(() => {
    if (backKey !== undefined) keepBackView(backKey, view.name)
  }, [backKey, view.name])
  // The open card of this app tab, folder page and view tab is in a module map (`NoteWindow.tsx`, D17, YAZ-4544), so a
  // tab that sleeps and mounts again shows it again on the same note, and another tab on this folder has its own.
  const windowKey = noteWindowKey(tabId, folderPath, view.name)
  const noteWindow = openNoteWindow(windowKey)
  const openWindow =
    folder.renderNoteEditor === undefined
      ? undefined
      : (path: string) => {
          const { placed, width, height, pinned } = openNoteWindow(windowKey) ?? lastWindow.current ?? noteWindowMemory(path)
          keepNoteWindow(windowKey, { path, placed, width, height, pinned })
          setOpens((n) => n + 1)
        }
  const closeWindow = useCallback(() => {
    lastWindow.current = openNoteWindow(windowKey) ?? lastWindow.current
    dropNoteWindow(windowKey)
    setOpens((n) => n + 1)
  }, [windowKey])
  // Re-parse after every edit: `doc.setIn` stores plain JS values, so a second edit inside a
  // collection a previous edit created would throw ("Expected YAML collection"). The round trip
  // through text keeps comments and rebuilds proper nodes.
  const update = (mutate: (def: ViewSet) => void) => onChange(parseViews(serializeViews(updateViews(parsed, mutate))))

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

  const shown = useMemo(() => (Object.keys(moves).length === 0 ? records : applyMoves(records, moves)), [records, moves])
  // YAZ-2290 D4: a folder's rows are the notes IN it, so the engine's own rows-are-the-vault
  // resolver would miss every link pointing outside them — inject the whole-vault one, WITH the
  // root (YAZ-846), so an absolute-path link target resolves, and with the folders behind the
  // notes (D10), so a link to a folder reads, sorts and groups as that folder's name.
  const vaultRecords = folder.vaultRecords
  const vaultFolders = folder.vaultFolders
  const resolve = useMemo(() => pageResolver(vaultRecords, vaultFolders, root, folder.resolveLink), [vaultRecords, vaultFolders, root, folder.resolveLink])
  /**
   * The folder's OUTLINE (YAZ-820) is a free-form DOCUMENT, not rows. `propertyKeys` reads
   * `view.order` and nothing else, so `view.outline`, a string, can not reach the value pass
   * however long it grows. Everything else the view says (sort, limit, groupBy) still runs.
   */
  const isOutline = view.type === 'outline'
  // The page the views belong to, as the index names its folder (YAZ-2541): a Folder level groups by
  // the folders below it, each headed by its title off the vault's folder records.
  const page = useMemo(() => ({ folder: relTo(root, folderPath), folders: vaultFolders, vault: folder.vaultName }), [root, folderPath, vaultFolders, folder.vaultName])
  // A Select column's options in the column editor's order (YAZ-3940): its sorts and groups follow them.
  const settings = folder.settings
  const optionOrder = useCallback((key: string) => {
    const typing = columnTyping(key, shown, properties, settings)
    return typing?.assigned === 'select' || typing?.assigned === 'multi-select' ? typing.options : undefined
  }, [shown, properties, settings])
  const result = useMemo(
    () => runView(def, view, shown, { resolve, declared: Object.keys(folder.settings.columns), page, optionOrder }),
    [def, view, shown, resolve, page, optionOrder],
  )

  const configuredGroups = boardOptionGroups(result.groups, view, key => columnTyping(key, shown, properties, folder.settings))
  // "Show empty groups" (YAZ-3940 S11): a Table keeps its empty option groups through a search, as the board does.
  const keepEmpty = (view.type === 'board' || view.type === 'table') && view.showEmptyColumns === true
  const needle = (search ?? '').trim().toLowerCase()
  // Search reads what the eye reads (YAZ-2293 D8): a row is found by the TITLE of a note it links to by id.
  const matches = (r: Row) => Object.values(r.values).some((v) => render(v, resolve).toLowerCase().includes(needle))
  const rows = needle ? result.rows.filter(matches) : result.rows
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

  /**
   * The board's optimistic write, shared with the calendar (YAZ-4540 D4): the move shows at once,
   * then ONE guarded write of the note; a failure drops the move (the card snaps back) and flags it.
   * A move that names where it went (`to`) says "Moved to <to>" once the write lands, with the app's
   * Undo (YAZ-4541 S6): Undo writes each `prevRaw` back the same way, and says nothing itself.
   */
  const moveValues = (path: string, writes: PendingMove, to?: string) => {
    setMoveError(null)
    setMoves((m) => ({ ...m, [path]: writes }))
    folder.writeValues(path, writes).then(
      () => {
        if (to === undefined) return
        const back: PendingMove = writes.map((w) => ({ key: w.key, value: w.prevRaw, prevRaw: w.value }))
        folder.onNotice?.(`Moved to ${to}`, 'info', 'undo', { label: 'Undo', run: () => moveValues(path, back), fades: true })
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
  const onMoveToGroup = (path: string, value: unknown, swap?: GroupSwap, drop?: GroupDrop) => {
    const key = groupByKey(view, drop?.level ?? 0)
    // A read-only note never moves, not even optimistically: the move writes a property (YAZ-3076 S53).
    if (key === null || readOnly.has(path)) return
    const props = records.find((r) => r.path === path)?.properties
    const prevRaw = props?.[key]
    if (swap !== undefined) {
      // Fan-out (D3): edit the list rather than replace it. Elements are matched with the engine's
      // own `equals` over `fromYaml` and NO resolver — the exact comparison that decided the
      // grouping — so we can only ever remove the element that put this row in that group.
      const list = Array.isArray(prevRaw) ? prevRaw : prevRaw == null ? [] : [prevRaw]
      const next = swap.remove === null ? [...list] : list.filter((v) => !equals(fromYaml(v), swap.remove))
      // No resolver: what is written is the STORED link, `[[<id>]]`, not the title the column shows (YAZ-2293 D8).
      if (swap.add !== null) next.push(render(swap.add))
      value = next
    }
    const writes: PendingMove = [{ key, value, prevRaw }]
    for (const write of drop?.ancestors ?? []) writes.push({ ...write, prevRaw: props?.[write.key] })
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
  const dateKey = view.type === 'calendar' ? calendarDateKey(view, calendarColumns) : null
  const onMoveToDay = (path: string, day: DayKey | null) => {
    if (dateKey === null || readOnly.has(path)) return
    const prevRaw = records.find((r) => r.path === path)?.properties[dateKey]
    moveValues(path, [{ key: dateKey, value: day === null ? undefined : movedDate(prevRaw, day), prevRaw }], day === null ? 'No date' : dayLabel(day))
  }

  // The toolbar's "New" / a group header's "+" (5D, GRO-2144): a note pre-filled to satisfy this
  // view — filter-derived seed, plus the group's raw value when created inside a group. It is born
  // IN the folder, from its template and that seed alone (YAZ-2290 D4/E1): a group "+" seeds its
  // group — or, grouped by Folder, is born in it. The note opens once the create lands; a failure shows the alert.
  // A `name` means the board's inline add (YAZ-943) — it already named the card and the caller is
  // mid-typing in the column, so that create STAYS on the board and opens nothing. `values` seed
  // more: a calendar day's "+" seeds its date (YAZ-4540 S10).
  const onNewNote = (group: Group | null, name?: string, at?: GroupSpot, values?: Record<string, unknown>) => {
    const seed = deriveSeed(def, view)
    if (values !== undefined) Object.assign(seed.properties, values)
    if (group !== null) {
      // 🔒 YAZ-745: an INNER "+" seeds every ancestor too (YAZ-4531), so the note lands in the very
      // section clicked. The ancestors go FIRST, outer first (YAZ-2541): under Folder then Folder each
      // level sets `seed.folder`, and the folder clicked is where the note must be born — so it writes last.
      at?.ancestors.forEach((ancestor, level) => seedGroup(seed, ancestor, view, level))
      seedGroup(seed, group, view, at?.level ?? 0)
    }
    setCreateError(null)
    folder
      .create(seed, name)
      .then((path) => {
        if (name === undefined) onOpenFile(path)
      })
      .catch((err: unknown) => setCreateError(err instanceof Error ? err.message : String(err)))
  }

  const writeValue = (path: string, key: string, value: unknown) => folder.writeValues(path, [{ key, value }])

  const keys = propertyKeys(def, view, records, Object.keys(folder.settings.columns))
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

  /** The document every outline tab shows and edits: the FIRST outline view's (YAZ-903). */
  const outlineIndex = views.findIndex((v) => v.type === 'outline')

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
      update((d) => {
        if (d.defaultView === d.views[i].name) d.defaultView = name // the saved START follows (D4)
        d.views[i].name = name
      })
    },
    onDuplicate: (i) => {
      update((d) => d.views.splice(i + 1, 0, { ...structuredClone(d.views[i]), name: freeName(`${d.views[i].name} copy`, taken()) }))
      setActive(i + 1)
    },
    onDelete: (i) => {
      if (views.length <= 1) return
      moveCollapsed(views[i].name, null)
      update((d) => {
        const [gone] = d.views.splice(i, 1)
        if (d.defaultView === gone.name) delete d.defaultView // a deleted START clears itself (D4)
      })
      // The active view stays put unless it WAS the deleted one — then its right neighbour takes over
      // (the left one when it was the last tab); a view before it in the list shifts one index down.
      setActive(index === i ? Math.min(i, views.length - 2) : index > i ? index - 1 : index)
    },
  }

  return (
    <div ref={paneRef} className="views-pane">
      <Toolbar
        def={def}
        view={view}
        viewIndex={index}
        records={records}
        filterErrors={filterErrors}
        shown={rows.length}
        total={result.total}
        search={search}
        onSearch={setSearch}
        onUpdate={update}
        onNew={() => onNewNote(null)}
        allGroupKeys={allGroupKeys}
        collapsed={collapsed}
        onSetAllGroups={writeCollapsed}
        tabs={tabs}
        properties={properties}
        documentView={isOutline}
        folder={folder}
        dateColumns={calendarColumns}
      />
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
      {isOutline ? (
        <OutlineView
          outline={views[outlineIndex].outline}
          wikilinks={folder.wikilinks}
          wikilinkCandidates={folder.wikilinkCandidates}
          nav={folder.nav}
          foldingOn={foldingOnByDefault}
          // ONE `folder_settings` write, through the same door every config edit uses. It
          // lands on the FIRST outline view because that is the one the seed was read from.
          onDocument={(markdown) =>
            update((d) => {
              d.views[outlineIndex].outline = markdown
            })
          }
        />
      ) : view.type === 'table' ? (
        <TableView
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
          onOpenFile={onOpenFile}
          onOpenFileRight={folder.openRight}
          onOpenFileBackground={folder.openBackground}
          onOpenWindow={openWindow}
          windowLink={windowLink}
          onNotice={folder.onNotice}
          onMoveToGroup={onMoveToGroup}
          moveError={moveError}
          onNewInGroup={onNewNote}
          root={root}
          properties={properties}
          settings={folder.settings}
          vaultRecords={vaultRecords}
          vaultFolders={vaultFolders}
          resolve={resolve}
          resolveLink={folder.resolveLink}
          setColumn={folder.setColumn}
          declareColumn={folder.setColumns}
          deleteColumn={folder.deleteColumn}
          valueCount={folder.valueCount}
          onWriteValue={writeValue}
          onRetitle={folder.retitle}
          reservedKeys={reservedKeys(folder.wikilinks.ids)}
        />
      ) : view.type === 'board' ? (
        <BoardView
          hover={viewHover}
          readOnly={readOnly}
          settings={folder.settings}
          def={def}
          view={view}
          viewIndex={index}
          records={shown}
          groups={groups}
          collapsed={collapsed}
          onToggleGroup={onToggleGroup}
          onUpdate={update}
          onOpenFile={onOpenFile}
          onOpenFileRight={folder.openRight}
          onOpenFileBackground={folder.openBackground}
          onNotice={folder.onNotice}
          onMoveToGroup={onMoveToGroup}
          moveError={moveError}
          onNewInGroup={onNewNote}
          resolve={resolve}
        />
      ) : view.type === 'calendar' ? (
        <CalendarView
          hover={viewHover}
          readOnly={readOnly}
          rows={rows}
          dateKey={dateKey}
          onOpenFile={onOpenFile}
          onOpenFileRight={folder.openRight}
          onOpenFileBackground={folder.openBackground}
          onMoveToDay={onMoveToDay}
          moveError={moveError}
          onNewOnDay={(day) => {
            if (dateKey !== null) onNewNote(null, undefined, undefined, { [dateKey]: day })
          }}
        />
      ) : view.type === 'cards' ? (
        <CardsView
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
          onOpenFile={onOpenFile}
          onOpenFileRight={folder.openRight}
          onOpenFileBackground={folder.openBackground}
          onNotice={folder.onNotice}
          onNewInGroup={onNewNote}
          properties={properties}
          settings={folder.settings}
          vaultRecords={vaultRecords}
          vaultFolders={vaultFolders}
          resolve={resolve}
          resolveLink={folder.resolveLink}
          onWriteValue={writeValue}
        />
      ) : view.type === 'list' ? (
        <ListView
          hover={viewHover}
          readOnly={readOnly}
          def={def}
          view={view}
          records={records}
          rows={rows}
          groups={groups}
          collapsed={collapsed}
          onToggleGroup={onToggleGroup}
          onOpenFile={onOpenFile}
          onOpenFileRight={folder.openRight}
          onOpenFileBackground={folder.openBackground}
          onNotice={folder.onNotice}
          onNewInGroup={onNewNote}
          root={root}
          properties={properties}
          settings={folder.settings}
          vaultRecords={vaultRecords}
          vaultFolders={vaultFolders}
          resolve={resolve}
          resolveLink={folder.resolveLink}
          onWriteValue={writeValue}
        />
      ) : (
        <ul className="view-rows">
          {rows.map((row) => (
            <li key={row.record.path} className="view-row">
              <button type="button" className="view-row__link" onClick={() => onOpenFile(row.record.path)}>
                {row.record.title}
              </button>
              {rest.length > 0 && <span className="view-row__values">{rest.map((k) => render(row.values[k], resolve)).join(' · ')}</span>}
            </li>
          ))}
        </ul>
      )}
      {notes.length > 0 && (
        <p className="views-pane__notes" role="note">
          {notes.join(' · ')}
        </p>
      )}
      {/* After the views: the table has written this render's rows to the link when the card reads them. */}
      {noteWindow !== undefined && folder.renderNoteEditor !== undefined && (
        <NoteWindow
          key={`${windowKey}:${opens}`}
          renderEditor={folder.renderNoteEditor}
          link={windowLink}
          titleOf={(path) => records.find((r) => r.path === path)?.title ?? path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '')}
          memory={noteWindow}
          onOpenInTab={onOpenFile}
          onClose={closeWindow}
        />
      )}
      <CardPreviewHost store={itemHover.store} cardOf={(_, path) => ({ root: null, name: records.find((r) => r.path === path)?.title ?? '' })} scopeOf={previewScope} diagramDarkColors={diagramDarkColors} />
    </div>
  )
}
