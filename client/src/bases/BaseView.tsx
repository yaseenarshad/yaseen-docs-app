import { useEffect, useMemo, useState } from 'react'
import type { IndexRecord } from '@shared/types'
import { storage } from '../lib/storage'
import { type BaseDefinition, type ParsedBase, parseBase, serializeBase, updateBase } from './baseFile'
import { type Group, type Row, propertyKeys, runView } from './engine'
import { render } from './expr'
import { createNewNote, deriveSeed, targetFolder, untitledName } from './newNote'
import { writeProperty } from './writeProperty'
import { BoardView } from './view/BoardView'
import { CardsView } from './view/CardsView'
import { canonicalKey } from './view/filterRows'
import { type PendingMove, applyMoves, dragKey } from './view/groupDrag'
import { ListView } from './view/ListView'
import { TableView } from './view/TableView'
import { Toolbar } from './view/Toolbar'

export interface BaseViewProps {
  parsed: ParsedBase
  /** Every config change arrives here as `updateBase(parsed, …)`; BaseHost turns it into autosave. */
  onChange: (next: ParsedBase) => void
  /** Vault root, keying view state persisted OUTSIDE the file (collapsed groups, GRO-2137); null = session-only. */
  root: string | null
  /** Absolute path of the open `.base`, for `this.file` in filters/formulas; null when unknown. */
  thisFile: string | null
  /** The vault index the views query; `[]` until `indexStatus` is ready (fed by `useIndex`, GRO-2129). */
  records: IndexRecord[]
  indexStatus: 'pending' | 'ready' | 'error'
  /** The fetch failure shown when `indexStatus` is 'error'. */
  indexError?: string
  /** Assigned property types from `.obsidian/types.json`, for cell editor inference (5B, GRO-2142). */
  types?: Record<string, string>
  onOpenFile: (path: string) => void
}

/**
 * One `.base` in the main pane (GRO-2135): the toolbar (view switcher, filter / sort /
 * properties menus, search, count) over the body — the real table for `type: table` (GRO-2136),
 * the board for `type: board` (4D, GRO-2138), the card grid for `type: cards` (4E, GRO-2139),
 * the list for `type: list` (4F, GRO-2140), a placeholder row list for unknown view types.
 * Only the active tab and the search text are component state — everything else is the file.
 */
export function BaseView({ parsed, onChange, root, thisFile, records, indexStatus, indexError, types, onOpenFile }: BaseViewProps) {
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
  const result = useMemo(() => (view ? runView(def, view, shown, { thisFile }) : null), [def, view, shown, thisFile])

  if (view === undefined || result === null) {
    return (
      <div className="base-view">
        <p className="base-view__pending">
          This base has no views.{' '}
          <button type="button" className="base-menu__action" onClick={() => update((d) => d.views.push({ type: 'table', name: 'Table 1' }))}>
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

  // Collapse state lives per `<basePath>::<viewName>` in the main-owned store — NEVER in the .base
  // file, so toggling can not touch autosave. Session-only (keyed by view index) when paths are unknown.
  const groupsKey = thisFile === null ? null : `${thisFile}::${view.name}`
  const collapseKey = groupsKey ?? `#${index}`
  const collapsed = collapsedByKey[collapseKey] ?? (root !== null && groupsKey !== null ? storage.getBaseGroups(root, groupsKey) : [])
  const onToggleGroup = (key: string) => {
    const next = collapsed.includes(key) ? collapsed.filter((k) => k !== key) : [...collapsed, key]
    setCollapsedByKey((m) => ({ ...m, [collapseKey]: next }))
    if (root !== null && groupsKey !== null) storage.setBaseGroups(root, groupsKey, next)
  }

  // A drop on a board column / table section (5C, GRO-2143): optimistic move now, one-key write
  // through 5A; a failed write drops the move (the card snaps back) and flags the card instead.
  const onMoveToGroup = (path: string, value: unknown) => {
    const key = dragKey(view)
    if (key === null) return
    const prevRaw = records.find((r) => r.path === path)?.properties[key]
    setMoveError(null)
    setMoves((m) => ({ ...m, [path]: { key, value, prevRaw } }))
    writeProperty(path, key, value).catch((err: unknown) => {
      setMoves((m) => Object.fromEntries(Object.entries(m).filter(([p]) => p !== path)))
      setMoveError({ path, message: err instanceof Error ? err.message : String(err) })
    })
  }

  // The toolbar's "New" / a group header's "+" (5D, GRO-2144): a note pre-filled to satisfy this
  // view — filter-derived seed, plus the group's raw value when created inside a group — created
  // over the bridge and opened only once the create lands; a failure shows the alert instead.
  const onNewNote = (group: Group | null) => {
    const seed = deriveSeed(def, view)
    const groupKey = dragKey(view)
    if (group !== null && groupKey !== null) {
      const raw = group.key === null ? undefined : group.rows[0]?.record.properties[groupKey]
      if (raw !== undefined) seed.properties[groupKey] = raw
    }
    const folder = targetFolder(seed.folder, root, thisFile)
    if (folder === null) {
      setCreateError('the vault root is not known yet')
      return
    }
    const taken = new Set(records.filter((r) => r.path.slice(0, r.path.lastIndexOf('/')) === folder).map((r) => r.basename))
    const path = `${folder}/${untitledName(taken)}.md`
    setCreateError(null)
    createNewNote(path, seed.properties)
      .then(() => onOpenFile(path))
      .catch((err: unknown) => setCreateError(err instanceof Error ? err.message : String(err)))
  }

  const keys = propertyKeys(def, view, records)
  const nameKey = keys.find((k) => canonicalKey(k) === 'file.name')
  const rest = keys.filter((k) => k !== nameKey)

  const tabs = {
    views,
    active: index,
    onSelect: setActive,
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
        tabs={tabs}
      />
      {createError !== null && (
        <p className="base-view__error" role="alert">
          Could not create note: {createError}
        </p>
      )}
      {indexStatus === 'pending' ? (
        <p className="base-view__pending">Loading the vault index…</p>
      ) : indexStatus === 'error' ? (
        <p className="base-view__error" role="alert">
          Could not load the vault index: {indexError}
        </p>
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
          types={types}
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
          types={types}
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
          types={types}
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
