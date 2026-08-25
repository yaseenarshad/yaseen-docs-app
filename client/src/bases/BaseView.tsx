import { useEffect, useMemo, useState } from 'react'
import { MAX_COLLAPSED_GROUP_KEYS, type IndexRecord, type PropertiesResponse } from '@shared/types'
import { storage } from '../lib/storage'
import { type BaseDefinition, type ParsedBase, parseBase, serializeBase, updateBase } from './baseFile'
import { type Group, type Row, propertyKeys, resolverFor, runView } from './engine'
import { equals, fromYaml, render } from './expr'
import type { FolderPageSettings } from './folderPageSettings'
import { type NewNoteSeed, createNewNote, deriveSeed, targetFolder, untitledName } from './newNote'
import { writeProperty } from './writeProperty'
import { BoardView } from './view/BoardView'
import { CardsView } from './view/CardsView'
import { canonicalKey } from './view/filterRows'
import { type GroupSwap, type PendingMove, applyMoves, groupByKey } from './view/groupDrag'
import { groupKeyOf } from './view/GroupHeader'
import { ListView } from './view/ListView'
import { OutlineView } from './view/OutlineView'
import { TableView } from './view/TableView'
import { Toolbar } from './view/Toolbar'
import { ViewTabs } from './view/ViewTabs'

/**
 * Folder-page contents mode (🔒 D3, YAZ-819). BaseView stays ONE component: the folder-page host
 * (`FolderPageContents`) hands it an in-memory def and this bundle, and everything below is
 * today's code. Absent → the plain, unscoped view: no declaration rung, no member gestures.
 */
export interface FolderPageMode {
  /** The folder page's own declaration: the typing ladder's TOP rung (🔒 Q8, YAZ-815). */
  settings: FolderPageSettings
  /** The WHOLE index snapshot — `records` here carries only the members (🔒 D2), and link resolution plus the link pickers must still see the vault. */
  vaultRecords: readonly IndexRecord[]
  /**
   * Birth from a folder page (🔒 Q5, YAZ-815): create a page from `seed` and resolve its path.
   * `name` is the outline add row's "+ Create 'X' here" (YAZ-820); absent → the `Untitled` scheme.
   */
  create: (seed: NewNoteSeed, name?: string) => Promise<string>
  /** ⌘-click on an outline row opens the page in a BACKGROUND tab (YAZ-820); absent → opens in place. */
  openBackground?: (path: string) => void
}

export interface BaseViewProps {
  parsed: ParsedBase
  /** Every config change arrives here as `updateBase(parsed, …)`; the host turns it into a write. */
  onChange: (next: ParsedBase) => void
  /** Vault root, keying view state persisted OUTSIDE the file (collapsed groups, GRO-2137); null = session-only. */
  root: string | null
  /** Absolute path of the page the views belong to, for `this.file` in filters/formulas; null when unknown. */
  thisFile: string | null
  /** The vault index the views query; `[]` until `indexStatus` is ready (fed by `useIndex`, GRO-2129). */
  records: IndexRecord[]
  indexStatus: 'pending' | 'ready' | 'error'
  /** The fetch failure shown when `indexStatus` is 'error'. */
  indexError?: string
  /** Assigned property types from `.obsidian/types.json`, for cell editor inference (5B, GRO-2142). */
  types?: Record<string, string>
  /** The vault-wide property declarations (5E, GRO-2217; `useProperties`); null/absent until fetched. Rank above `types` for editor inference. */
  properties?: PropertiesResponse | null
  onOpenFile: (path: string) => void
  /** Read-only chrome for embeds (6A, GRO-2145): view switcher only — no toolbar menus, New, cell editing or drag. */
  readOnly?: boolean
  /** Initial view by name (case-insensitive); unknown or absent → the first view. */
  initialView?: string
  /**
   * Present only for a FOLDER PAGE's contents block (🔒 D3, YAZ-819): its rows are the members,
   * its def is in memory, its views are switch-only (no view CRUD) and it offers no Filter menu —
   * a folder page's set IS the lookup and stores no filters (🔒 Q3, YAZ-815).
   */
  folderPage?: FolderPageMode
}

/**
 * One set of views (GRO-2135): the toolbar (view switcher, filter / sort /
 * properties menus, search, count) over the body — the real table for `type: table` (GRO-2136),
 * the board for `type: board` (4D, GRO-2138), the card grid for `type: cards` (4E, GRO-2139),
 * the list for `type: list` (4F, GRO-2140), a placeholder row list for unknown view types.
 * Only the active tab and the search text are component state — everything else is the file.
 */
export function BaseView({ parsed, onChange, root, thisFile, records, indexStatus, indexError, types, properties = null, onOpenFile, readOnly = false, initialView, folderPage }: BaseViewProps) {
  const [active, setActive] = useState(() =>
    initialView === undefined ? 0 : Math.max(0, parsed.def.views.findIndex((v) => v.name.toLowerCase() === initialView.toLowerCase())),
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
  const view = views[index]
  // Re-parse after every edit: `doc.setIn` stores plain JS values, so a second edit inside a
  // collection a previous edit created would throw ("Expected YAML collection"). The round trip
  // through text keeps comments and rebuilds proper nodes.
  const update = (mutate: (def: BaseDefinition) => void) => onChange(parseBase(serializeBase(updateBase(parsed, mutate))))

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
  // resolver would miss every link pointing outside them — inject the whole-vault one. A caller
  // that passes nothing keeps the default, which is the same resolver the engine always built.
  const vaultRecords = folderPage?.vaultRecords
  const resolve = useMemo(() => (vaultRecords === undefined ? undefined : resolverFor(vaultRecords)), [vaultRecords])
  /**
   * The folder page's OUTLINE (YAZ-820) — and the ONE place the engine has to be told about it:
   * an outline view's `order` is the [D5] MEMBER sequence (wikilinks), not a column list, so it
   * is dropped before the run. Left in, `propertyKeys` would hand those wikilinks to the value
   * pass, every row's `values` would come back empty, and the toolbar's search — which matches
   * over exactly those values — would hide the whole outline the moment anybody dragged a row.
   * Everything else the view says (sort, limit, groupBy) still runs.
   */
  const isFolderOutline = view?.type === 'outline' && folderPage !== undefined
  const result = useMemo(
    () => (view ? runView(def, isFolderOutline && view.order !== undefined ? { ...view, order: undefined } : view, shown, { thisFile, resolve }) : null),
    [def, view, shown, thisFile, resolve, isFolderOutline],
  )

  if (view === undefined || result === null) {
    return (
      <div className="base-view">
        <p className="base-view__pending">
          This base has no views.
          {!readOnly && (
            <>
              {' '}
              <button type="button" className="base-menu__action" onClick={() => update((d) => d.views.push({ type: 'table', name: 'Table 1' }))}>
                Add view
              </button>
            </>
          )}
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
  const collapsed = collapsedByKey[collapseKey] ?? (root !== null && groupsKey !== null ? storage.getBaseGroups(root, groupsKey) : [])
  const writeCollapsed = (next: readonly string[]) => {
    setCollapsedByKey((m) => ({ ...m, [collapseKey]: [...next] }))
    if (root !== null && groupsKey !== null) storage.setBaseGroups(root, groupsKey, next)
  }
  const onToggleGroup = (key: string) => {
    writeCollapsed(collapsed.includes(key) ? collapsed.filter((k) => k !== key) : [...collapsed, key])
  }
  // Collapse / expand all (YAZ-744): every group the VIEW has, not the search-narrowed `groups` —
  // a group hidden behind an active search must collapse with the rest. Above the store's cap the
  // toggle hides rather than writing a list `setBaseGroups` would silently truncate.
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

  /** The plain 5D create: the view's own filter-derived folder, the first free `Untitled`. */
  const createFromSeed = async (seed: NewNoteSeed): Promise<string> => {
    const folder = targetFolder(seed.folder, root, thisFile)
    if (folder === null) throw new Error('the vault root is not known yet')
    const taken = new Set(records.filter((r) => r.path.slice(0, r.path.lastIndexOf('/')) === folder).map((r) => r.basename))
    const path = `${folder}/${untitledName(taken)}.md`
    await createNewNote(path, seed.properties)
    return path
  }

  // The toolbar's "New" / a group header's "+" (5D, GRO-2144): a note pre-filled to satisfy this
  // view — filter-derived seed, plus the group's raw value when created inside a group — created
  // over the bridge and opened only once the create lands; a failure shows the alert instead.
  // The type-scaffold upgrade a type-pinned view used to trigger died with the type system
  // (YAZ-836): every New is the plain seeded create, wherever the view's own rules place it.
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
    // A folder page births its members from its OWN declaration and parks them per its settings
    // (🔒 Q5, YAZ-815) — the seed still rides along, so a group "+" seeds that group here too.
    const run = folderPage === undefined ? createFromSeed(seed) : folderPage.create(seed)
    run.then(onOpenFile).catch((err: unknown) => setCreateError(err instanceof Error ? err.message : String(err)))
  }

  const keys = propertyKeys(def, view, records)
  const nameKey = keys.find((k) => canonicalKey(k) === 'file.name')
  const rest = keys.filter((k) => k !== nameKey)

  /**
   * The folder page's OUTLINE (YAZ-820) — only ever inside the contents block: a `type: outline`
   * view with no folder page behind it keeps the placeholder rows, as it always did.
   * `thisFile` IS the folder page's path here (`FolderPageContents` passes it), and it roots the
   * ancestor guard, so a null one falls through too rather than guessing.
   */
  const outline = isFolderOutline && thisFile !== null
  /**
   * The outline view's `order` is the [D5] MEMBER sequence, not a column list — so the Properties
   * menu, whose every gesture rewrites `view.order`, is not offered while it is showing. An
   * outline has no columns to configure; leaving the menu up would let a click silently overwrite
   * the locked ordering with property keys.
   */
  const outlineIndex = views.findIndex((v) => v.type === 'outline')

  const tabs = {
    views,
    active: index,
    onSelect: setActive,
    // A folder page's views are switch-only (🔒 rule 4, YAZ-819): which view is active is session
    // state that never reaches the card, and view CRUD is not this block's gesture.
    readOnly: folderPage !== undefined,
    onAdd: () => {
      update((d) => d.views.push({ type: 'table', name: `Table ${d.views.length + 1}` }))
      setActive(views.length)
    },
    onRename: (i: number, name: string) =>
      update((d) => {
        d.views[i].name = name
      }),
    onDuplicate: (i: number) => {
      update((d) => d.views.splice(i + 1, 0, { ...structuredClone(d.views[i]), name: `${d.views[i].name} copy` }))
      setActive(i + 1)
    },
    onDelete: (i: number) => {
      if (views.length <= 1) return
      update((d) => d.views.splice(i, 1))
      setActive(Math.min(i, views.length - 2))
    },
    onMove: (i: number, dir: -1 | 1) => {
      const j = i + dir
      if (j < 0 || j >= views.length) return
      update((d) => {
        const [v] = d.views.splice(i, 1)
        d.views.splice(j, 0, v)
      })
      setActive(j)
    },
  }

  return (
    <div className="base-view">
      {readOnly ? (
        // Read-only chrome (6A, GRO-2145): the view switcher only — no menus, search or New.
        <div className="base-toolbar">
          <ViewTabs {...tabs} readOnly />
        </div>
      ) : (
        <Toolbar
          def={def}
          view={view}
          viewIndex={index}
          records={records}
          errors={result.errors}
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
          noFilters={folderPage !== undefined}
          noProperties={outline}
        />
      )}
      {createError !== null && (
        <p className="base-view__error" role="alert">
          Could not create note: {createError}
        </p>
      )}
      {properties?.error !== undefined && (
        <p className="base-view__error" role="alert">
          Could not load the vault's property declarations: {properties.error}
        </p>
      )}
      {indexStatus === 'pending' ? (
        <p className="base-view__pending">Loading the vault index…</p>
      ) : indexStatus === 'error' ? (
        <p className="base-view__error" role="alert">
          Could not load the vault index: {indexError}
        </p>
      ) : outline ? (
        <OutlineView
          folderPagePath={thisFile}
          settings={folderPage.settings}
          vaultRecords={folderPage.vaultRecords}
          records={records}
          rows={rows}
          onOpenFile={onOpenFile}
          openBackground={folderPage.openBackground}
          // ONE `folder_page_settings` write, through the same door every config edit uses. It
          // lands on the FIRST outline view because that is the one `orderedMembers` reads back
          // (🔒 Q3) — with the two default views they are the same view.
          onOrder={(order) =>
            update((d) => {
              d.views[outlineIndex].order = order
            })
          }
          onCreate={(name) => {
            setCreateError(null)
            // Birth, then STAY: the new member appears as a row on the next snapshot, and the
            // outline the user is reading does not jump out from under them.
            folderPage.create(deriveSeed(def, view), name).catch((err: unknown) => setCreateError(err instanceof Error ? err.message : String(err)))
          }}
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
          onNewInGroup={readOnly ? undefined : onNewNote}
          types={types}
          properties={properties}
          folderPage={folderPage?.settings ?? null}
          vaultRecords={vaultRecords}
          readOnly={readOnly}
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
          onNewInGroup={readOnly ? undefined : onNewNote}
          readOnly={readOnly}
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
          onNewInGroup={readOnly ? undefined : onNewNote}
          types={types}
          properties={properties}
          folderPage={folderPage?.settings ?? null}
          vaultRecords={vaultRecords}
          readOnly={readOnly}
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
          onNewInGroup={readOnly ? undefined : onNewNote}
          types={types}
          properties={properties}
          folderPage={folderPage?.settings ?? null}
          vaultRecords={vaultRecords}
          readOnly={readOnly}
        />
      ) : (
        <ul className="base-rows">
          {rows.map((row) => (
            <li key={row.record.path} className="base-row">
              <button type="button" className="base-row__link" onClick={() => onOpenFile(row.record.path)}>
                {nameKey === undefined ? row.record.name : render(row.values[nameKey])}
              </button>
              {rest.length > 0 && <span className="base-row__values">{rest.map((k) => render(row.values[k])).join(' · ')}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
