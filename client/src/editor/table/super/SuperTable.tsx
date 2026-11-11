/**
 * A Super table's bar and its active view (YAZ-4869 S2–S5; CONTRACTS rule 41a), drawn by the zoom pill's anchor
 * (`tableZoomPill.tsx`) in this lazy chunk. The bar is the folder page's view bar (its `view-toolbar`, `view-tab` and
 * `view-toolbar__btn` classes, `views.css`; the YAZ-4869 demo: "replicate the same line from folder pages … almost be
 * 1:1"): the tabs with the table icon and the accent line under the active one, "+", then Sort / Group / Filter as the
 * folder page's icon buttons with a count badge, and the zoom pill (`zoom`) at the right end, over the thin line. It
 * stands in the page's flow above the table, so it never covers the block above; a view shows under it in the anchor,
 * while a node decoration hides the table (`superTables.ts`).
 *
 * - THE VIEW is the engine's output (`superData.ts`), worked out again only for a new table node or another view (item
 *   20): the anchor draws again only when its table changed, debounced while you type in it. Cells show their first
 *   line, their fill and their text colour; a cell note shows its corner.
 * - GROUPS (S3): the folder pages' headers (`GroupHeader`: the highlight and Large looks, the count, the summaries),
 *   sticky under the column header; collapse per group, kept on this Mac (`remembered`); the group lines in a gutter,
 *   plain or a thread to the row under the pointer (`groupSpans`). A row dragged onto another group gets that group's
 *   values in its group cells: one transaction. Table folds act in "Table" only (item 19): a view shows every row.
 * - EDIT (S5 item 5): a double-click on a cell edits its first line in a small box; Enter or leaving the box writes it,
 *   one undo step. A merged cell, a cell note, a list or styled text (bold, a link…) is edited in "Table" (a tip says so).
 * - COPY (item 21): ⌘C on rows of a view copies them in the view's order, a Markdown table as text and a `<table>` as HTML.
 * - FIND (item 25): ⌘F's current match in this table's row shows that row here (`found`), marked, its groups open. A
 *   match in a row the view filters out gets a note and "Show in Table" (YAZ-4866).
 * - A MISSING COLUMN: a group, sort or filter on a column the table does not have gets a note (YAZ-4866).
 * - ABOVE 500 LINES only the lines on screen mount, padded by spacer rows (the windowing idea of the folder table).
 */
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type ClipboardEvent, type CSSProperties, type DragEvent, type ReactNode } from 'react'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { closeHistory } from '@milkdown/kit/prose/history'
import type { EditorView } from '@milkdown/kit/prose/view'
import { verticalScrollParent } from '../../../lib/pinnedHeader'
import { FIND_ACTIVE_CLASS } from '../../find/findInPage'
import { render } from '../../../views/expr'
import { GroupHeader } from '../../../views/view/GroupHeader'
import { groupSpans, holdersOf } from '../../../views/view/groupGuides'
import { FilterIcon, PropertiesIcon, SortIcon, ViewTypeIcon } from '../../../views/view/icons'
import { ContextMenuSurface } from '../../../components/ContextMenuSurface'
import '../../../views/views.css'
import { computeView, groupsHolding, linesOf, markdownTable, rowOf, viewSetOf, type Line } from './superData'
import { FilterPanel, GroupPanel, SortPanel } from './SuperMenus'
import { remember, remembered, setActiveTab, setViews, SUPER_NOW, superPlace, tableIndexAt } from './superTables'
import { SUMMARY_KINDS, type SummaryKind, type TableViewDef } from './viewGrammar'
import './superTable.css'

export interface SuperTableProps {
  editor: EditorView
  getPos: () => number | undefined
  table: ProseNode
  /** The view that shows, or `null` for "Table". */
  active: string | null
  /** ⌘F's current match: its row; `n` counts the finds, so the same row found again scrolls again. */
  found: { row: number; n: number } | null
  /** The table's zoom pill (`DocumentZoom`), drawn at the bar's right end. */
  zoom: ReactNode
}

/** Above this many lines, only those on screen mount (the folder table's `WINDOW_AT`). */
export const WINDOW_AT = 500
const ROW_H = 33
const OVERSCAN = 10
const FALLBACK_VIEWPORT = 600
const NO_KEYS: ReadonlySet<string> = new Set()

type Panel = 'sort' | 'group' | 'filter' | null

/** The bar's tools, each with the folder page's icon (the sort arrows, the sliders, the funnel; YAZ-4869 demo). */
const TOOLS = { sort: ['Sort', <SortIcon />], group: ['Group', <PropertiesIcon />], filter: ['Filter', <FilterIcon />] } as const

/** A name no view has yet: "View 1", "View 2"… */
const freshName = (views: readonly TableViewDef[], base = 'View'): string => {
  for (let n = 1; ; n++) if (!views.some((v) => v.name === `${base} ${n}`)) return `${base} ${n}`
}

/** Write cells' first lines, each `[place in the table, text]`, in ONE transaction (one undo step). `false` when none could change. */
export function writeCells(editor: EditorView, tablePos: number, cells: ReadonlyArray<readonly [number, string]>): boolean {
  const tr = closeHistory(editor.state.tr)
  // From the last cell back, so the earlier positions hold.
  for (const [at, text] of [...cells].sort((a, b) => b[0] - a[0])) {
    const pos = tablePos + 1 + at
    const block = tr.doc.nodeAt(pos)?.firstChild
    if (block?.type.name !== 'paragraph' || block.textContent === text) continue
    tr.insertText(text, pos + 2, pos + 2 + block.content.size)
  }
  if (!tr.docChanged) return false
  editor.dispatch(tr.setMeta(SUPER_NOW, true))
  return true
}

/** The small box that edits one cell (S5 item 5): Enter or a blur writes, Escape leaves it. */
function EditBox({ text, onDone }: { text: string; onDone: (text: string | null) => void }) {
  const done = useRef(false)
  const finish = (value: string | null) => {
    if (done.current) return
    done.current = true
    onDone(value)
  }
  return (
    <input
      className="super-view__edit"
      aria-label="Cell text"
      defaultValue={text}
      autoFocus
      onBlur={(e) => finish(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(e.currentTarget.value)
        if (e.key === 'Escape') finish(null)
      }}
    />
  )
}

const cellStyle = (fill: string | null, color: string | null): CSSProperties | undefined => {
  const style: Record<string, string> = {}
  if (fill?.startsWith('#')) style['--table-fill-custom'] = fill
  if (color?.startsWith('#')) style['--table-text-custom'] = color
  return Object.keys(style).length > 0 ? (style as CSSProperties) : undefined
}

export function SuperTable({ editor, getPos, table, active, found, zoom }: SuperTableProps) {
  const views = table.attrs.views as TableViewDef[]
  const def = active === null ? undefined : views.find((v) => v.name === active)
  const editable = editor.editable
  const pos = getPos() ?? 0
  const place = superPlace(editor.state)
  const index = tableIndexAt(editor.state.doc, pos)
  const [panel, setPanel] = useState<Panel>(null)
  // A view tab's right-click menu (YAZ-4869 demo: "as polished as folder pages"): the app's own context menu, at the pointer.
  const [menu, setMenu] = useState<{ x: number; y: number; name: string } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ row: number; col: number } | null>(null)
  const [tip, setTip] = useState<string | null>(null)
  const [hover, setHover] = useState(-1)
  const [past, setPast] = useState(0)
  const [, reread] = useReducer((n: number) => n + 1, 0)
  const barRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<HTMLDivElement>(null)
  const dragRow = useRef<number | null>(null)

  // Item 20: the engine runs again only for a new table node or another view.
  const computed = useMemo(() => (def === undefined ? null : computeView(table, def)), [table, def])

  // A panel closes on a click outside the bar.
  useEffect(() => {
    if (panel === null) return
    const away = (event: MouseEvent) => {
      if (!barRef.current?.contains(event.target as Node)) setPanel(null)
    }
    window.addEventListener('mousedown', away)
    return () => window.removeEventListener('mousedown', away)
  }, [panel])

  const collapsedKey = active === null ? null : `view:${active}`
  const collapsedList = collapsedKey === null ? [] : remembered(place, index, collapsedKey)
  const collapsedSig = collapsedList.join('\u0000')
  const collapsed = useMemo<ReadonlySet<string>>(() => (collapsedList.length === 0 ? NO_KEYS : new Set(collapsedList)), [collapsedSig])
  const findRow = found !== null && computed !== null && computed.result.rows.some((r) => rowOf(r) === found.row) ? found.row : null
  // The match is in a body row this view leaves out (YAZ-4866).
  const findHidden = found !== null && found.row > 0 && computed !== null && findRow === null
  const opened = useMemo(() => (findRow === null || computed === null ? NO_KEYS : groupsHolding(computed.result, findRow)), [findRow, computed])
  const lines = useMemo(() => (computed === null ? [] : linesOf(computed.result, collapsed, opened)), [computed, collapsed, opened])
  const windowed = lines.length > WINDOW_AT

  // The windowed view follows the scroll of the box that shows it; the window steps by whole rows.
  useEffect(() => {
    const root = viewRef.current
    if (!windowed || root === null) return
    const scroller = verticalScrollParent(root)
    if (scroller === null) return
    const onScroll = () => {
      const top = root.querySelector('table')?.getBoundingClientRect().top ?? 0
      const next = Math.floor(Math.max(0, scroller.getBoundingClientRect().top - top) / ROW_H) * ROW_H
      setPast((p) => (p === next ? p : next))
    }
    onScroll()
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [windowed])

  // Find (item 25): the found row comes into view, in the middle.
  useLayoutEffect(() => {
    if (findRow === null || viewRef.current === null) return
    const at = lines.findIndex((l) => l.kind === 'row' && l.row === findRow)
    if (at < 0) return
    if (!windowed) {
      viewRef.current.querySelector<HTMLElement>(`tr[data-row="${findRow}"]`)?.scrollIntoView?.({ block: 'center' })
      return
    }
    const scroller = verticalScrollParent(viewRef.current)
    const top = viewRef.current.querySelector('table')?.getBoundingClientRect().top
    if (scroller === null || top === undefined) return
    scroller.scrollTop += top + at * ROW_H - scroller.getBoundingClientRect().top - (scroller.clientHeight || FALLBACK_VIEWPORT) / 2
  }, [found?.n, findRow])

  const writeViews = (next: TableViewDef[]) => {
    const at = getPos()
    if (at !== undefined) setViews(editor, at, next)
  }
  const writeDef = (next: TableViewDef) => writeViews(views.map((v) => (v.name === active ? next : v)))
  const show = (name: string | null) => {
    const at = getPos()
    setPanel(null)
    setEditing(null)
    if (at !== undefined) setActiveTab(editor, at, name)
  }
  /** "Show in Table": the table shows, and the find's match comes into view. */
  const showMatch = () => {
    show(null)
    editor.dom.querySelector(`.${FIND_ACTIVE_CLASS}`)?.scrollIntoView?.({ block: 'center' })
  }
  const addView = () => {
    const name = freshName(views)
    writeViews([...views, { name }])
    show(name)
  }
  const renameView = (from: string, to: string) => {
    setRenaming(null)
    const name = to.trim()
    if (name === '' || name === from || views.some((v) => v.name === name)) return
    writeViews(views.map((v) => (v.name === from ? { ...v, name } : v)))
    remember(place, index, `view:${name}`, remembered(place, index, `view:${from}`))
    remember(place, index, `view:${from}`, [])
    if (active === from) show(name)
  }
  const deleteView = (name: string) => {
    writeViews(views.filter((v) => v.name !== name))
    remember(place, index, `view:${name}`, [])
    if (active === name) show(null)
  }
  const toggleGroup = (key: string) => {
    if (collapsedKey === null) return
    remember(place, index, collapsedKey, collapsed.has(key) ? [...collapsed].filter((k) => k !== key) : [...collapsed, key])
    reread()
  }

  const tabs = (
    <div ref={barRef} className="table-super-bar view-toolbar" role="toolbar" aria-label="Super table views">
      <div className="view-tabs-wrap">
        <div className="view-tabs scroll-strip table-super-bar__tabs" role="tablist">
          <div className={`view-tab${active === null ? ' view-tab--active' : ''}`}>
            <button type="button" role="tab" className="view-tab__btn table-super-bar__tab" aria-selected={active === null} onClick={() => show(null)}>
              <ViewTypeIcon type="table" />
              <span>Table</span>
            </button>
          </div>
          {views.map((v) => (
            <div key={v.name} className={`view-tab${active === v.name ? ' view-tab--active' : ''}`}>
              {renaming === v.name ? (
                <input
                  className="view-tab__rename table-super-bar__rename"
                  aria-label="View name"
                  defaultValue={v.name}
                  autoFocus
                  onBlur={(e) => renameView(v.name, e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') renameView(v.name, e.currentTarget.value)
                    if (e.key === 'Escape') setRenaming(null)
                  }}
                />
              ) : (
                <button
                  type="button"
                  role="tab"
                  className="view-tab__btn table-super-bar__tab"
                  aria-selected={active === v.name}
                  title={editable ? 'Double-click to rename · right-click for more' : v.name}
                  onClick={() => show(v.name)}
                  onDoubleClick={() => editable && setRenaming(v.name)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    if (!editable) return
                    setMenu({ x: e.clientX, y: e.clientY, name: v.name })
                  }}
                >
                  <ViewTypeIcon type="table" />
                  <span>{v.name}</span>
                </button>
              )}
            </div>
          ))}
        </div>
        {editable && (
          <button type="button" className="view-tab__add table-super-bar__tab table-super-bar__add" aria-label="Add a view" title="Add a view" onClick={addView}>
            +
          </button>
        )}
      </div>
      <div className="view-toolbar__actions">
        {def !== undefined && editable && (
          <div className="table-super-bar__tools">
            {(['sort', 'group', 'filter'] as const).map((which) => {
              const count = (which === 'sort' ? def.sort : which === 'group' ? def.group : def.filter)?.length ?? 0
              const [label, icon] = TOOLS[which]
              return (
                <button
                  key={which}
                  type="button"
                  className={`view-toolbar__btn table-super-bar__tool${count > 0 ? ' view-toolbar__btn--on' : ''}`}
                  aria-label={label}
                  title={label}
                  aria-haspopup="dialog"
                  aria-expanded={panel === which}
                  onClick={() => setPanel(panel === which ? null : which)}
                >
                  {icon}
                  {count > 0 && <span className="view-toolbar__badge">{count}</span>}
                </button>
              )
            })}
          </div>
        )}
        {zoom}
      </div>
      {panel !== null && def !== undefined && computed !== null && (
        <div className="table-super-bar__panel">
          {panel === 'sort' && <SortPanel def={def} keys={computed.data.keys} onChange={writeDef} />}
          {panel === 'group' && <GroupPanel def={def} keys={computed.data.keys} onChange={writeDef} />}
          {panel === 'filter' && <FilterPanel def={def} keys={computed.data.keys} records={computed.data.records} onChange={writeDef} />}
        </div>
      )}
      {menu !== null && (
        <ContextMenuSurface x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <div className="ctx-menu__group" role="group">
            <button type="button" role="menuitem" className="ctx-menu__item" onClick={() => (setMenu(null), setRenaming(menu.name))}>
              Rename view
            </button>
            <button
              type="button"
              role="menuitem"
              className="ctx-menu__item"
              onClick={() => {
                const from = views.find((v) => v.name === menu.name)
                setMenu(null)
                if (from !== undefined) writeViews([...views, { ...from, name: freshName(views, from.name) }])
              }}
            >
              Duplicate view
            </button>
          </div>
          <div className="ctx-menu__group" role="group">
            <button type="button" role="menuitem" className="ctx-menu__item ctx-menu__item--danger" onClick={() => (setMenu(null), deleteView(menu.name))}>
              Delete view
            </button>
          </div>
        </ContextMenuSurface>
      )}
    </div>
  )

  if (computed === null || def === undefined) return tabs
  const { data, view, result } = computed
  const width = data.keys.length
  const grouped = result.groups !== null
  const set = viewSetOf(view, data.keys)
  const summaryKeys = (def.summary ?? []).map((s) => `note.${s.column}`)
  // A column the table does not have (renamed outside the app): say so, not only "No value" (YAZ-4866).
  const missing = [...new Set([...(def.group ?? []), ...(def.sort ?? []), ...(def.filter ?? [])].map((rule) => rule.column))].filter((column) => !data.keys.includes(column))

  // The group lines (S3): each line's level and the header that holds it.
  const depths = lines.map((l) => (l.kind === 'group' ? l.depth : null))
  const { holder } = grouped ? groupSpans(depths, 0) : { holder: new Int32Array(0) }
  const onPath = hover >= 0 && def.thread === true ? new Set(holdersOf(holder, hover)) : NO_LINES
  const guides = (j: number, depth: number): ReactNode => {
    if (!grouped) return null
    const above = holdersOf(holder, j)
    return (
      <td className="super-view__gutter" aria-hidden>
        {Array.from({ length: depth }, (_, level) => {
          const header = above[above.length - 1 - level]
          return <i key={level} style={{ left: level * 12 + 6 }} data-on-path={header !== undefined && onPath.has(header) && j <= hover ? '' : undefined} />
        })}
      </td>
    )
  }

  /** S3 item 9: the dragged row gets the target group's values in its group cells, in one transaction. */
  const dropOn = (line: Line) => (event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    const row = dragRow.current
    dragRow.current = null
    const at = getPos()
    if (row === null || at === undefined || line.path.length === 0) return
    const writes: Array<[number, string]> = []
    for (const [level, group] of line.path.entries()) {
      const column = data.keys.indexOf(def.group![level]!.column)
      const cell = data.cells[row]?.[column]
      if (cell === undefined || column < 0) continue
      const source = group.rows[0] === undefined ? null : rowOf(group.rows[0])
      const text = group.key === null || source === null ? '' : (data.cells[source]?.[column]?.text ?? '')
      if (cell.text === text) continue
      if (!cell.plain || cell.merged || cell.note) {
        setTip('That row’s group cell is merged, styled, or holds a cell note or a list: move it in Table.')
        return
      }
      writes.push([cell.pos, text])
    }
    writeCells(editor, at, writes)
  }
  const dragOver = (event: DragEvent) => {
    event.stopPropagation()
    if (dragRow.current !== null) event.preventDefault()
  }

  const startEdit = (row: number, col: number) => {
    const cell = data.cells[row]?.[col]
    if (!editable || cell === undefined) return
    if (cell.merged || cell.note || !cell.plain) {
      setTip('Edit styled text, merged cells, cell notes and cell lists in Table.')
      return
    }
    setTip(null)
    setEditing({ row, col })
  }
  const finishEdit = (row: number, col: number, text: string | null) => {
    setEditing(null)
    const at = getPos()
    const cell = data.cells[row]?.[col]
    if (text !== null && at !== undefined && cell !== undefined) writeCells(editor, at, [[cell.pos, text]])
  }

  /** Item 21: the selected rows, in the view's order. */
  const onCopy = (event: ClipboardEvent) => {
    const selection = window.getSelection()
    if (selection === null || selection.isCollapsed || editing !== null) return
    const picked = [...(viewRef.current?.querySelectorAll<HTMLElement>('tr[data-row]') ?? [])].filter((tr) => selection.containsNode(tr, true)).map((tr) => Number(tr.dataset.row))
    if (picked.length === 0) return
    const rows = picked.map((r) => data.keys.map((_, c) => data.cells[r]?.[c]?.text ?? ''))
    event.clipboardData.setData('text/plain', markdownTable(data.keys, rows))
    event.clipboardData.setData('text/html', htmlTable(data.keys, rows))
    event.preventDefault()
  }

  const viewH = typeof window === 'undefined' ? FALLBACK_VIEWPORT : window.innerHeight || FALLBACK_VIEWPORT
  const first = windowed ? Math.max(0, Math.min(lines.length - 1, Math.floor(past / ROW_H) - OVERSCAN)) : 0
  const count = windowed ? Math.min(lines.length - first, Math.ceil(viewH / ROW_H) + 2 * OVERSCAN) : lines.length
  const visible = lines.slice(first, first + count)
  const summaryOf = (key: string): SummaryKind | undefined => def.summary?.find((s) => s.column === key)?.kind
  const setSummary = (column: string, kind: string) => {
    const rest = (def.summary ?? []).filter((s) => s.column !== column)
    const summary = kind === '' ? rest : [...rest, { column, kind: kind as SummaryKind }].sort((a, b) => data.keys.indexOf(a.column) - data.keys.indexOf(b.column))
    const { summary: _old, ...base } = def
    writeDef(summary.length === 0 ? base : { ...base, summary })
  }

  return (
    <>
      {tabs}
      <div
        ref={viewRef}
        className="table-super-view"
        onCopy={onCopy}
        onMouseLeave={() => setHover(-1)}
        onMouseDown={() => tip !== null && setTip(null)}
      >
        {tip !== null && (
          <p className="table-super-view__tip" role="status">
            {tip}
          </p>
        )}
        {missing.map((column) => (
          <p key={column} className="table-super-view__tip table-super-view__missing" role="note">
            Column "{column}" is not in this table.
          </p>
        ))}
        {findHidden && (
          <p className="table-super-view__tip table-super-view__find" role="status">
            The match is in a row this view hides.{' '}
            <button type="button" className="table-super-view__link" onClick={showMatch}>
              Show in Table
            </button>
          </p>
        )}
        <table
          className="super-view"
          data-grouped={grouped ? '' : undefined}
          data-group-lines={def.lines ?? 'hover'}
          data-thread={def.thread === true ? '' : undefined}
          data-windowed={windowed ? '' : undefined}
          style={{ '--super-gutter': `${Math.max(0, (def.group?.length ?? 0) * 12)}px` } as CSSProperties}
        >
          <thead>
            <tr>
              {grouped && <th className="super-view__gutter" aria-hidden />}
              {data.keys.map((key) => (
                <th key={key}>{key}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {first > 0 && <tr className="super-view__spacer" style={{ height: first * ROW_H }} aria-hidden />}
            {visible.map((line, i) => {
              const j = first + i
              if (line.kind === 'group') {
                return (
                  <tr key={line.key} className="super-view__group" data-depth={line.depth} style={{ '--super-depth': line.depth } as CSSProperties} onDragOver={dragOver} onDrop={dropOn(line)} onMouseEnter={def.thread === true ? () => setHover(j) : undefined}>
                    {guides(j, line.depth)}
                    <td colSpan={width}>
                      <GroupHeader
                        def={set}
                        view={view}
                        columns={summaryKeys}
                        groupKey={line.group.key}
                        label={line.group.label}
                        rows={line.group.rows}
                        collapsed={collapsed.has(line.key) && !opened.has(line.key)}
                        onToggle={() => toggleGroup(line.key)}
                        level={line.depth}
                      />
                    </td>
                  </tr>
                )
              }
              const cells = data.cells[line.row] ?? []
              return (
                <tr
                  key={`r${line.row}`}
                  className="super-view__row"
                  data-row={line.row}
                  data-found={line.row === findRow ? '' : undefined}
                  draggable={grouped && editable}
                  onDragStart={(e) => {
                    e.stopPropagation()
                    dragRow.current = line.row
                    e.dataTransfer?.setData('text/plain', String(line.row))
                  }}
                  onDragOver={dragOver}
                  onDrop={dropOn(line)}
                  onMouseEnter={def.thread === true ? () => setHover(j) : undefined}
                >
                  {guides(j, line.depth)}
                  {cells.map((cell, c) =>
                    cell.span === 0 ? null : (
                      <td
                        key={c}
                        colSpan={cell.span > 1 ? cell.span : undefined}
                        data-fill={cell.fill ?? undefined}
                        data-color={cell.color ?? undefined}
                        data-note={cell.note ? '' : undefined}
                        style={cellStyle(cell.fill, cell.color)}
                        onDoubleClick={() => startEdit(line.row, c)}
                      >
                        {editing?.row === line.row && editing.col === c ? <EditBox text={cell.text} onDone={(text) => finishEdit(line.row, c, text)} /> : cell.text}
                      </td>
                    ),
                  )}
                </tr>
              )
            })}
            {first + count < lines.length && <tr className="super-view__spacer" style={{ height: (lines.length - first - count) * ROW_H }} aria-hidden />}
          </tbody>
          <tfoot>
            <tr className="super-view__summary">
              {grouped && <td className="super-view__gutter" aria-hidden />}
              {data.keys.map((key) => {
                const kind = summaryOf(key)
                const value = kind === undefined ? undefined : result.summaries[`note.${key}`]
                return (
                  <td key={key}>
                    {editable && (
                      <select className="super-view__summary-kind" aria-label={`Summary of ${key}`} value={kind ?? ''} onChange={(e) => setSummary(key, e.target.value)}>
                        <option value="">{kind === undefined ? 'Summary' : 'None'}</option>
                        {SUMMARY_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {k.charAt(0).toUpperCase() + k.slice(1)}
                          </option>
                        ))}
                      </select>
                    )}
                    {value !== undefined && <span className="super-view__summary-value">{render(typeof value === 'number' ? Math.round(value * 100) / 100 : value)}</span>}
                  </td>
                )
              })}
            </tr>
          </tfoot>
        </table>
        {result.rows.length === 0 && <p className="table-super-view__empty">No row matches this view’s filters.</p>}
      </div>
    </>
  )
}

const NO_LINES: ReadonlySet<number> = new Set()

const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Item 21: the rows as an HTML table, the header row first. */
function htmlTable(keys: readonly string[], rows: readonly string[][]): string {
  const row = (cells: readonly string[], tag: 'th' | 'td') => `<tr>${cells.map((c) => `<${tag}>${escapeHtml(c)}</${tag}>`).join('')}</tr>`
  return `<table><thead>${row(keys, 'th')}</thead><tbody>${rows.map((r) => row(r, 'td')).join('')}</tbody></table>`
}
