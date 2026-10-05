import { boardOptionGroups } from './boardOptionGroups'
import { columnTyping } from './editorType'
import { useEffect, useMemo, useState } from 'react'
import { MAX_COLLAPSED_GROUP_KEYS, type IndexRecord, type PropertiesResponse } from '@shared/types'
import type { WikilinkNav } from '../editor/wikilink/wikilinkClick'
import type { WikilinkCandidateSource } from '../editor/wikilink/wikilinkPicker'
import type { ResolveLink, WikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { pageResolver } from '../links/folderLinks'
import { storage } from '../lib/storage'
import { type ViewSet, type ViewDef, type ParsedViews, parseViews, serializeViews, updateViews } from './viewSchema'
import { type Group, type Row, propertyKeys, runView } from './engine'
import { equals, fromYaml, render } from './expr'
import type { ColumnDecl, FolderSettings } from './folderSettings'
import { type NewNoteSeed, deriveSeed, freeName } from './newNote'
import type { PropertyWrite } from './writeProperty'
import { BoardView } from './view/BoardView'
import { CardsView } from './view/CardsView'
import { canonicalKey } from './view/keys'
import { type GroupDrop, type GroupSpot, type GroupSwap, type PendingMove, applyMoves, groupByKey, groupsByFolder } from './view/groupDrag'
import { groupKeyOf, nestedGroupKeyOf } from './view/GroupHeader'
import { ListView } from './view/ListView'
import { OutlineView } from './view/OutlineView'
import { TableView } from './view/TableView'
import { Toolbar } from './view/Toolbar'
import { type ViewTabsProps, viewTypeLabel } from './view/ViewTabs'

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
  /** The window's link resolver (`linkResolver`): a note first, then a folder. A link cell reads a folder's name through it, and a link column finds the folder its target names. */
  resolveLink: ResolveLink
  /**
   * Birth in the folder (YAZ-2290 D4): create a note from `seed` and resolve its path.
   * The `Untitled` scheme is the DEFAULT name; the board's inline add (YAZ-943) already knows what
   * the card is called, and that typed name rides the optional argument.
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
   * the host reports failures in its own banner.
   */
  deleteColumn: (key: string) => Promise<void>
  /** How many notes hold the folder's value for a column — the number that delete's confirm states. */
  valueCount: (key: string) => number
  /**
   * The ONE door a view writes a row's values through — a cell edit, a board or section drop — in
   * one guarded write of that note. `records` ARE the folder's values for each row, and only the
   * host knows where a note keeps them (D19: its block of `in`).
   */
  writeValues: (path: string, writes: readonly PropertyWrite[]) => Promise<unknown>
  /** ⌘-click on a table row opens the page in a BACKGROUND tab (YAZ-820); absent → opens in place. */
  openBackground?: (path: string) => void
  /** Shared Table/Board action that opens the exact page in the window's right panel. */
  openRight?: (path: string) => void
  /** Passive notice surface for row actions that fail because a page moved or disappeared. */
  onNotice?: (message: string) => void
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
  /** The notes the views query (YAZ-2290 D4) — the folder's own rows, never the whole vault — each with the FOLDER's values for it as its `properties` (D19). */
  records: IndexRecord[]
  /**
   * The vault-wide property declarations (5E, GRO-2217; `useProperties`) — typing rung 2, fed
   * App → `Editor` → `FolderView` since YAZ-846. null/absent until the fetch resolves; a
   * `properties.error` renders its own passive line and never blocks a row.
   */
  properties?: PropertiesResponse | null
  onOpenFile: (path: string) => void
  /** The folder's bundle (🔒 D3, YAZ-819): every edit of its views is ONE `update` through this adapter's one door. */
  folder: FolderHost
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
 * `type: list` (4F, GRO-2140), the outline for `type: outline` (YAZ-820), a placeholder row list
 * for unknown view types. Only the active tab and the search text are component state —
 * everything else is the file.
 */
export function ViewsPane({ parsed, onChange, root, folderPath, records, properties = null, onOpenFile, folder }: ViewsPaneProps) {
  // The START may persist (YAZ-1104); which view is ACTIVE stays session state — switching still
  // writes nothing, and YAZ-1471 re-ruling 🔒 rule 4 (the tabs edit again) did not move that line:
  // only the def is written. A stale (or absent) saved name is -1 here, so it clamps to the first.
  const [active, setActive] = useState(() =>
    Math.max(0, parsed.def.views.findIndex((v) => v.name === parsed.def.defaultView)),
  )
  const [search, setSearch] = useState<string | null>(null)
  /** Collapsed group keys per view, seeded from the store; a toggle replaces the entry here AND writes through storage. */
  const [collapsedByKey, setCollapsedByKey] = useState<Record<string, string[]>>({})
  /** Optimistic group moves (5C, GRO-2143) keyed by path, patched into the records the engine sees. */
  const [moves, setMoves] = useState<Record<string, PendingMove>>({})
  const [moveError, setMoveError] = useState<{ path: string; message: string } | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const { def } = parsed
  const views = def.views
  const index = Math.max(0, Math.min(active, views.length - 1))
  /**
   * NEVER undefined (YAZ-861): `views` cannot be empty — `folderSettings` and the one mount's
   * `folderViewSet` both fall back to `DEFAULT_VIEWS` — and `index` is clamped into that list.
   */
  const view = views[index]!
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
  const resolve = useMemo(() => pageResolver(vaultRecords, root, folder.resolveLink), [vaultRecords, root, folder.resolveLink])
  /**
   * The folder's OUTLINE (YAZ-820) is a free-form DOCUMENT, not rows. `propertyKeys` reads
   * `view.order` and nothing else, so `view.outline`, a string, can not reach the value pass
   * however long it grows. Everything else the view says (sort, limit, groupBy) still runs.
   */
  const isOutline = view.type === 'outline'
  const result = useMemo(
    () => runView(def, view, shown, { resolve, declared: Object.keys(folder.settings.columns) }),
    [def, view, shown, resolve],
  )

  const configuredGroups = boardOptionGroups(result.groups, view, key => columnTyping(key, shown, properties, folder.settings))
  const keepEmpty = view.type === 'board' && view.showEmptyColumns === true
  const needle = (search ?? '').trim().toLowerCase()
  // Search reads what the eye reads (YAZ-2293 D8): a row is found by the TITLE of a note it links to by id.
  const matches = (r: Row) => Object.values(r.values).some((v) => render(v, resolve).toLowerCase().includes(needle))
  const rows = needle ? result.rows.filter(matches) : result.rows
  // Search filters WITHIN each group; a group with no matching rows disappears (4C, GRO-2137). A
  // two-level group (YAZ-745) narrows each branch the same way — emptied children go, and `rows`
  // stays the union of what is left beneath, so an outer whose whole branch missed drops too.
  const narrow = (g: Group): Group => {
    if (g.children === undefined) return { ...g, rows: g.rows.filter(matches) }
    const children = g.children.map((c) => ({ ...c, rows: c.rows.filter(matches) })).filter((c) => keepEmpty || c.rows.length > 0)
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
  // a group hidden behind an active search must collapse with the rest. Two levels (YAZ-745) go in
  // document order, each outer before its children, and it is the KEY count that meets the store's
  // cap: above it the toggle hides rather than writing a list `setViewGroups` would truncate.
  const groupKeys =
    configuredGroups === null ? [] : configuredGroups.flatMap((g) => [groupKeyOf(g.key), ...(g.children ?? []).map((c) => nestedGroupKeyOf(g.key, c.key))])
  const allGroupKeys = groupKeys.length > MAX_COLLAPSED_GROUP_KEYS ? [] : groupKeys

  // A drop on a board column / table section (5C, GRO-2143): optimistic move now, then the host writes
  // every changed key in one guarded transformation (`FolderHost.writeValues`); a failure drops the move (the card snaps back)
  // and flags the card instead. `drop` names
  // the LEVEL the row landed on (YAZ-1101) and may carry the outer's write — inner first, then the
  // outer, both optimistic as ONE unit so either failing snaps the whole move back (🔒 YAZ-745).
  const onMoveToGroup = (path: string, value: unknown, swap?: GroupSwap, drop?: GroupDrop) => {
    const key = groupByKey(view, drop?.level ?? 0)
    if (key === null) return
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
    if (drop?.outer !== undefined) writes.push({ ...drop.outer, prevRaw: props?.[drop.outer.key] })
    setMoveError(null)
    setMoves((m) => ({ ...m, [path]: writes }))
    folder.writeValues(path, writes).catch((err: unknown) => {
      setMoves((m) => Object.fromEntries(Object.entries(m).filter(([p]) => p !== path)))
      setMoveError({ path, message: err instanceof Error ? err.message : String(err) })
    })
  }

  // The toolbar's "New" / a group header's "+" (5D, GRO-2144): a note pre-filled to satisfy this
  // view — filter-derived seed, plus the group's raw value when created inside a group. It is born
  // IN the folder, from its template and that seed alone (YAZ-2290 D4/E1): a group "+" seeds its
  // group — or, grouped by Folder, is born in it. The note opens once the create lands; a failure shows the alert.
  // A `name` means the board's inline add (YAZ-943) — it already named the card and the caller is
  // mid-typing in the column, so that create STAYS on the board and opens nothing.
  const onNewNote = (group: Group | null, name?: string, at?: GroupSpot) => {
    const seed = deriveSeed(def, view)
    if (group !== null) {
      seedGroup(seed, group, view, at?.level ?? 0)
      // 🔒 YAZ-745: an INNER "+" seeds the outer too, so the note lands in the very section clicked.
      if (at !== undefined && at.level > 0) seedGroup(seed, at.outer, view, 0)
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
    <div className="views-pane">
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
          preview={view.preview === true}
          wikilinks={folder.wikilinks}
          declareColumn={folder.setColumns}
          deleteColumn={folder.deleteColumn}
          valueCount={folder.valueCount}
          onWriteValue={writeValue}
        />
      ) : view.type === 'board' ? (
        <BoardView
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
          preview={view.preview === true}
          wikilinks={folder.wikilinks}
          resolve={resolve}
        />
      ) : view.type === 'cards' ? (
        <CardsView
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
                {nameKey === undefined ? row.record.name : render(row.values[nameKey], resolve)}
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
    </div>
  )
}
