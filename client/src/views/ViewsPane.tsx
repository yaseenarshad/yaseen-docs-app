import { useEffect, useMemo, useState } from 'react'
import { MAX_COLLAPSED_GROUP_KEYS, type IndexRecord, type PropertiesResponse } from '@shared/types'
import type { WikilinkNav } from '../editor/wikilink/wikilinkClick'
import type { WikilinkCandidateSource } from '../editor/wikilink/wikilinkPicker'
import type { WikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { storage } from '../lib/storage'
import { type ViewSet, type ViewDef, type ParsedViews, parseViews, serializeViews, updateViews } from './viewSchema'
import { type Group, type Row, propertyKeys, resolverFor, runView } from './engine'
import { equals, fromYaml, render } from './expr'
import type { ColumnDecl, FolderPageSettings } from './folderPageSettings'
import { type NewNoteSeed, deriveSeed } from './newNote'
import { writeProperty } from './writeProperty'
import { BoardView } from './view/BoardView'
import { CardsView } from './view/CardsView'
import { canonicalKey } from './view/keys'
import { type GroupSwap, type PendingMove, applyMoves, groupByKey } from './view/groupDrag'
import { groupKeyOf } from './view/GroupHeader'
import { ListView } from './view/ListView'
import { OutlineView } from './view/OutlineView'
import { TableView } from './view/TableView'
import { Toolbar } from './view/Toolbar'

/**
 * Folder-page contents mode (🔒 D3, YAZ-819). ViewsPane stays ONE component: the folder-page host
 * (`FolderPageContents`) hands it an in-memory def and this bundle, and everything below is
 * today's code. REQUIRED since YAZ-846 — the contents block is the only mount there is.
 */
export interface FolderPageMode {
  /** The folder page's own declaration: the typing ladder's TOP rung (🔒 Q8, YAZ-815). */
  settings: FolderPageSettings
  /** The WHOLE index snapshot — `records` here carries only the members (🔒 D2), and link resolution plus the link pickers must still see the vault. */
  vaultRecords: readonly IndexRecord[]
  /**
   * Birth from a folder page (🔒 Q5, YAZ-815): create a page from `seed` and resolve its path.
   * The name is always the `Untitled` scheme — the outline add row that once typed one died in
   * YAZ-903, and with it the `name` argument.
   */
  create: (seed: NewNoteSeed) => Promise<string>
  /**
   * The declarations, back through the one door (YAZ-895) — ONE `folder_page_settings` write
   * (🔒 D3), failures in the host's own banner. `views` rides along so a caller can move the
   * columns AND `view.order` in that same single write.
   */
  setColumns: (columns: Record<string, ColumnDecl>, views?: ViewDef[]) => void
  /** ⌘-click on an outline row opens the page in a BACKGROUND tab (YAZ-820); absent → opens in place. */
  openBackground?: (path: string) => void
  /**
   * The outline editor's own wikilink surfaces (YAZ-903) — the window's ONE resolve source, its
   * `[[` picker feed and the click-navigation contract, assembled by the host exactly as
   * `Editor` assembles them for the note. `nav`'s identity must be STABLE: a new object remounts
   * the editor, and a remount costs the caret.
   */
  wikilinks?: WikilinkResolveSource
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
   * surfaces. null = session-only collapse, name-and-relative-path resolution only.
   */
  root: string | null
  /** Absolute path of the page the views belong to, for `this.file` in filters/formulas; null when unknown. */
  thisFile: string | null
  /** The MEMBERS the views query (🔒 D2) — the folder page's own rows, never the whole vault. */
  records: IndexRecord[]
  /**
   * The vault-wide property declarations (5E, GRO-2217; `useProperties`) — typing rung 2, fed
   * App → `Editor` → `FolderPageContents` since YAZ-846. null/absent until the fetch resolves; a
   * `properties.error` renders its own passive line and never blocks a row.
   */
  properties?: PropertiesResponse | null
  onOpenFile: (path: string) => void
  /**
   * The FOLDER PAGE's contents (🔒 D3, YAZ-819) — REQUIRED since YAZ-846: its rows are the
   * members, its def is in memory, its views are switch-only (no view CRUD) and it offers no
   * Filter menu, a folder page's set being the lookup itself (🔒 Q3, YAZ-815).
   */
  folderPage: FolderPageMode
}

/**
 * One set of views (GRO-2135): the toolbar (view switcher, sort / properties menus, search,
 * count) over the body — the real table for `type: table` (GRO-2136), the board for
 * `type: board` (4D, GRO-2138), the card grid for `type: cards` (4E, GRO-2139), the list for
 * `type: list` (4F, GRO-2140), the outline for `type: outline` (YAZ-820), a placeholder row list
 * for unknown view types. Only the active tab and the search text are component state —
 * everything else is the file.
 *
 * TOMBSTONE (YAZ-846, the amputation): `readOnly` (the read-only embed chrome), `initialView`
 * (which picked the starting tab for `![[X.base#View]]`), `types` (`.obsidian/types.json`, the
 * ladder's rung 3 — see "Cell editing"), `indexStatus` / `indexError` and the plain 5D
 * `createFromSeed` path all died here. Every one of them lost its production caller when YAZ-844
 * retired `.base`: the contents block is the ONLY mount, it hands over a snapshot already in hand
 * and it births through the declaration.
 */
export function ViewsPane({ parsed, onChange, root, thisFile, records, properties = null, onOpenFile, folderPage }: ViewsPaneProps) {
  const [active, setActive] = useState(0)
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
  const view = views[index]
  // Re-parse after every edit: `doc.setIn` stores plain JS values, so a second edit inside a
  // collection a previous edit created would throw ("Expected YAML collection"). The round trip
  // through text keeps comments and rebuilds proper nodes.
  const update = (mutate: (def: ViewSet) => void) => onChange(parseViews(serializeViews(updateViews(parsed, mutate))))

  // 5B's clearing discipline: a pending move holds until the index refetch moves that key off the
  // raw it had at commit time (our write landing, or a concurrent writer winning) — never before.
  useEffect(() => {
    setMoves((m) => {
      const kept = Object.entries(m).filter(([path, mv]) => {
        const raw = records.find((r) => r.path === path)?.properties[mv.key]
        return JSON.stringify(raw ?? null) === JSON.stringify(mv.prevRaw ?? null)
      })
      return kept.length === Object.keys(m).length ? m : Object.fromEntries(kept)
    })
  }, [records])

  const shown = useMemo(() => (Object.keys(moves).length === 0 ? records : applyMoves(records, moves)), [records, moves])
  // 🔒 D2 (YAZ-819): a folder page's rows are its MEMBERS, so the engine's own rows-are-the-vault
  // resolver would miss every link pointing outside them — inject the whole-vault one. It is built
  // WITH the root (YAZ-846): keyed per records identity then per root, the memo hands the wikilink
  // feed and this one the SAME resolver, and an absolute-path link target resolves in both.
  const vaultRecords = folderPage.vaultRecords
  const resolve = useMemo(() => resolverFor(vaultRecords, root ?? undefined), [vaultRecords, root])
  /**
   * The folder page's OUTLINE (YAZ-820) — and the ONE place the engine has to be told about it:
   * an outline view's `order` is the [D5] MEMBER sequence (wikilinks), not a column list, so it
   * is dropped before the run. Left in, `propertyKeys` would hand those wikilinks to the value
   * pass, every row's `values` would come back empty, and the toolbar's search — which matches
   * over exactly those values — would hide the whole outline. The strip outlives the [D5] list
   * itself (YAZ-903 retires `order` on the first edit): an un-migrated card still carries one.
   * The DOCUMENT needs no strip of its own — `propertyKeys` reads `view.order` and nothing else,
   * so `view.outline`, a string, can not reach the value pass however long it grows.
   * Everything else the view says (sort, limit, groupBy) still runs.
   */
  const isOutline = view?.type === 'outline'
  const result = useMemo(
    () => (view ? runView(def, isOutline && view.order !== undefined ? { ...view, order: undefined } : view, shown, { thisFile, resolve }) : null),
    [def, view, shown, thisFile, resolve, isOutline],
  )

  if (view === undefined || result === null) {
    return (
      <div className="view-view">
        <p className="view-view__pending">
          This folder page has no views.{' '}
          <button type="button" className="view-menu__action" onClick={() => update((d) => d.views.push({ type: 'table', name: 'Table 1' }))}>
            Add view
          </button>
        </p>
      </div>
    )
  }

  const needle = (search ?? '').trim().toLowerCase()
  const matches = (r: Row) => Object.values(r.values).some((v) => render(v).toLowerCase().includes(needle))
  const rows = needle ? result.rows.filter(matches) : result.rows
  // Search filters WITHIN each group; a group with no matching rows disappears (4C, GRO-2137).
  const groups = result.groups === null ? null : needle ? result.groups.map((g) => ({ ...g, rows: g.rows.filter(matches) })).filter((g) => g.rows.length > 0) : result.groups

  // Collapse state lives per `<pagePath>::<viewName>` in the main-owned store — NEVER in the
  // page's own card, so toggling can not touch autosave. Session-only (keyed by view index)
  // when paths are unknown.
  const groupsKey = thisFile === null ? null : `${thisFile}::${view.name}`
  const collapseKey = groupsKey ?? `#${index}`
  const collapsed = collapsedByKey[collapseKey] ?? (root !== null && groupsKey !== null ? storage.getViewGroups(root, groupsKey) : [])
  const writeCollapsed = (next: readonly string[]) => {
    setCollapsedByKey((m) => ({ ...m, [collapseKey]: [...next] }))
    if (root !== null && groupsKey !== null) storage.setViewGroups(root, groupsKey, next)
  }
  const onToggleGroup = (key: string) => {
    writeCollapsed(collapsed.includes(key) ? collapsed.filter((k) => k !== key) : [...collapsed, key])
  }
  // Collapse / expand all (YAZ-744): every group the VIEW has, not the search-narrowed `groups` —
  // a group hidden behind an active search must collapse with the rest. Above the store's cap the
  // toggle hides rather than writing a list `setViewGroups` would silently truncate.
  const allGroupKeys =
    result.groups === null || result.groups.length > MAX_COLLAPSED_GROUP_KEYS ? [] : result.groups.map((g) => groupKeyOf(g.key))

  // A drop on a board column / table section (5C, GRO-2143): optimistic move now, one-key write
  // through 5A; a failed write drops the move (the card snaps back) and flags the card instead.
  const onMoveToGroup = (path: string, value: unknown, swap?: GroupSwap) => {
    const key = groupByKey(view)
    if (key === null) return
    const prevRaw = records.find((r) => r.path === path)?.properties[key]
    if (swap !== undefined) {
      // Fan-out (D3): edit the list rather than replace it. Elements are matched with the engine's
      // own `equals` over `fromYaml` and NO resolver — the exact comparison that decided the
      // grouping — so we can only ever remove the element that put this row in that group.
      const list = Array.isArray(prevRaw) ? prevRaw : prevRaw == null ? [] : [prevRaw]
      const next = swap.remove === null ? [...list] : list.filter((v) => !equals(fromYaml(v), swap.remove))
      if (swap.add !== null) next.push(render(swap.add))
      value = next
    }
    setMoveError(null)
    setMoves((m) => ({ ...m, [path]: { key, value, prevRaw } }))
    writeProperty(path, key, value).catch((err: unknown) => {
      setMoves((m) => Object.fromEntries(Object.entries(m).filter(([p]) => p !== path)))
      setMoveError({ path, message: err instanceof Error ? err.message : String(err) })
    })
  }

  // The toolbar's "New" / a group header's "+" (5D, GRO-2144): a note pre-filled to satisfy this
  // view — filter-derived seed, plus the group's raw value when created inside a group. A folder
  // page births its members from its OWN declaration and parks them per its settings (🔒 Q5,
  // YAZ-815), which since YAZ-846 is the ONLY create path here: the seed still rides along, so a
  // group "+" seeds its group. The note opens once the create lands; a failure shows the alert.
  const onNewNote = (group: Group | null) => {
    const seed = deriveSeed(def, view)
    const groupKey = groupByKey(view)
    if (group !== null && groupKey !== null) {
      // Fanned out (D4): seed THIS group's own element as a one-item list. The first row's raw
      // value is the neighbour's WHOLE list there, which would hand the new page someone else's
      // values; `render()` gives a link back its `[[…]]` form, the same one the picker writes.
      const raw =
        group.key === null
          ? undefined
          : group.fannedOut
            ? [render(group.key)]
            : group.rows[0]?.record.properties[groupKey]
      if (raw !== undefined) seed.properties[groupKey] = raw
    }
    setCreateError(null)
    folderPage
      .create(seed)
      .then(onOpenFile)
      .catch((err: unknown) => setCreateError(err instanceof Error ? err.message : String(err)))
  }

  const keys = propertyKeys(def, view, records)
  const nameKey = keys.find((k) => canonicalKey(k) === 'file.name')
  const rest = keys.filter((k) => k !== nameKey)

  /**
   * The folder page's OUTLINE (YAZ-820). `thisFile` IS the folder page's path here
   * (`FolderPageContents` passes it) and it roots the ancestor guard, so a null one falls through
   * to the placeholder rows rather than guessing.
   */
  const outline = isOutline && thisFile !== null
  /**
   * The outline view's `order` is the [D5] MEMBER sequence, not a column list — so the Properties
   * menu, whose every gesture rewrites `view.order`, is not offered while it is showing. An
   * outline has no columns to configure; leaving the menu up would let a click silently overwrite
   * the locked ordering with property keys.
   */
  const outlineIndex = views.findIndex((v) => v.type === 'outline')

  // A folder page's views are switch-only (🔒 rule 4, YAZ-819): which view is active is session
  // state that never reaches the card, and view CRUD is not this block's gesture. The editable
  // tab half was deleted with its last reachable surface (YAZ-846; parked on YAZ-824).
  const tabs = { views, active: index, onSelect: setActive }

  return (
    <div className="view-view">
      <Toolbar
        def={def}
        view={view}
        viewIndex={index}
        records={records}
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
        root={root}
        properties={properties}
        documentView={outline}
        folderPage={folderPage}
      />
      {createError !== null && (
        <p className="view-view__error" role="alert">
          Could not create note: {createError}
        </p>
      )}
      {properties?.error !== undefined && (
        <p className="view-view__error" role="alert">
          Could not load the vault's property declarations: {properties.error}
        </p>
      )}
      {outline ? (
        <OutlineView
          folderPagePath={thisFile}
          root={root}
          settings={folderPage.settings}
          outline={views[outlineIndex].outline}
          vaultRecords={vaultRecords}
          records={records}
          onOpenFile={onOpenFile}
          openBackground={folderPage.openBackground}
          wikilinks={folderPage.wikilinks}
          wikilinkCandidates={folderPage.wikilinkCandidates}
          nav={folderPage.nav}
          // ONE `folder_page_settings` write, through the same door every config edit uses — the
          // door the retired drag wrote `order` through (YAZ-903). It lands on the FIRST outline
          // view because that is the one the seed was read from, and `order` RETIRES in the same
          // write: the [D5] list has said its piece the moment the document exists.
          onDocument={(markdown) =>
            update((d) => {
              d.views[outlineIndex].outline = markdown
              delete d.views[outlineIndex].order
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
          onMoveToGroup={onMoveToGroup}
          moveError={moveError}
          onNewInGroup={onNewNote}
          root={root}
          properties={properties}
          folderPage={folderPage.settings}
          vaultRecords={vaultRecords}
        />
      ) : view.type === 'board' ? (
        <BoardView
          def={def}
          view={view}
          viewIndex={index}
          records={shown}
          groups={groups}
          collapsed={collapsed}
          onToggleGroup={onToggleGroup}
          onUpdate={update}
          onOpenFile={onOpenFile}
          onMoveToGroup={onMoveToGroup}
          moveError={moveError}
          onNewInGroup={onNewNote}
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
          onNewInGroup={onNewNote}
          properties={properties}
          folderPage={folderPage.settings}
          vaultRecords={vaultRecords}
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
          onNewInGroup={onNewNote}
          root={root}
          properties={properties}
          folderPage={folderPage.settings}
          vaultRecords={vaultRecords}
        />
      ) : (
        <ul className="view-rows">
          {rows.map((row) => (
            <li key={row.record.path} className="view-row">
              <button type="button" className="view-row__link" onClick={() => onOpenFile(row.record.path)}>
                {nameKey === undefined ? row.record.name : render(row.values[nameKey])}
              </button>
              {rest.length > 0 && <span className="view-row__values">{rest.map((k) => render(row.values[k])).join(' · ')}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
