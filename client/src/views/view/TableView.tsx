import { type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { IndexRecord, PropertiesResponse } from '@shared/types'
import type { ViewSet, ViewDef, Mutate } from '../viewSchema'
import { belongsToBasenames } from '../../links/folderPages'
import { type Group, type Row, propertyKeys, propertyLabel, resolverFor } from '../engine'
import { type Value, render, typeOf } from '../expr'
import type { FolderPageSettings } from '../folderPageSettings'
import { BUILTIN_SUMMARIES, summarize } from '../summaries'
import { cellEditor, columnTyping } from '../editorType'
import { EditableCell } from './EditableCell'
import { canonicalKey } from './keys'
import { GroupHeader, cellContent, groupKeyOf, nestedGroupKeyOf, summaryKindOf } from './GroupHeader'
import { type GroupDrop, type GroupSpot, type GroupSwap, groupByKey, useGroupDrag } from './groupDrag'
import { Popover } from './Popover'
import { usePreview } from './PreviewCard'
import { frozenColumnCount } from './frozenColumns'
import { PageContextMenu } from './PageContextMenu'

export interface TableViewProps {
  def: ViewSet
  view: ViewDef
  viewIndex: number
  records: readonly IndexRecord[]
  /** Post-search rows from ViewsPane; the summary row recomputes over exactly these. */
  rows: readonly Row[]
  /** Post-search groups when `view.groupBy` is set (groups with no shown rows dropped), else null (4C, GRO-2137). */
  groups: readonly Group[] | null
  /** Collapsed group keys (`groupKeyOf`) for this page + view; owned by ViewsPane, persisted via storage. */
  collapsed: readonly string[]
  onToggleGroup: (key: string) => void
  onUpdate: Mutate
  onOpenFile: (path: string) => void
  /** A row page action opens without replacing the current tab. */
  onOpenFileBackground?: (path: string) => void
  /** Passive reporting for a stale or failed OS action. */
  onNotice?: (message: string) => void
  /** A drop on another section: `groupBy.property = value` (undefined deletes) via ViewsPane (5C, GRO-2143); `drop` says which LEVEL, and carries the outer's write on a cross-outer inner drop (YAZ-1101). */
  onMoveToGroup: (path: string, value: unknown, swap?: GroupSwap, drop?: GroupDrop) => void
  /** The last failed move, flagged inline on its row. */
  moveError: { path: string; message: string } | null
  /** Create a note seeded with a section's group value (5D, GRO-2144); absent → no "+" on headers. `at` places the section for the level-aware seed (YAZ-1101). */
  onNewInGroup?: (group: Group, name?: string, at?: GroupSpot) => void
  /** Vault root, so the picker's resolver is THE one the wikilink surfaces share (YAZ-846); null = name-and-relative-path resolution only. */
  root: string | null
  /** The vault's property declarations (5E, GRO-2217): vault-wide editor inference and relation targets. */
  properties?: PropertiesResponse | null
  /** The folder page whose contents these rows are (YAZ-819): the typing ladder's TOP rung (🔒 Q8). */
  folderPage?: FolderPageSettings | null
  /** The WHOLE index snapshot (🔒 D2, YAZ-819) — `records` is only the MEMBERS: link resolution and the link pickers read this, never the rows alone. */
  vaultRecords: readonly IndexRecord[]
  /** Preview mode (`view.preview`, YAZ-1244): resting on a data row pops its page read-only. */
  preview?: boolean
}

const DEFAULT_WIDTH = 150
const MIN_WIDTH = 60
/** `view.rowHeight` presets (Obsidian's names); the value feeds `--view-table-row-h` AND the windowing maths. */
const ROW_HEIGHTS: Record<string, number> = { short: 28, medium: 44, tall: 68 }
/** Above this many lines only a scroll-positioned slice is mounted, padded by spacer rows. */
const WINDOW_AT = 500
const OVERSCAN = 10
/** jsdom and the pre-measure first render have no viewport height; assume one screen. */
const FALLBACK_VIEWPORT = 600

/** One display line: a group header row (`nested` = an inner section, YAZ-745), or a data row with its `data-cell` row index (data rows only) and its group (null when ungrouped). `at` places that group for the level-aware drag / "+" (YAZ-1101). */
type Line = { header: Group; gk: string; nested?: true; at: GroupSpot } | { row: Row; r: number; g: Group | null; gk: string | null; at: GroupSpot | null }

/** Let a table property-cell double-click activate the shared editor exactly once. */
function activateEditorFromCell(event: ReactMouseEvent<HTMLTableCellElement>): void {
  if (event.target instanceof Element && event.target.closest('[data-edit]') !== null) return
  event.currentTarget.querySelector<HTMLElement>('[data-edit]')?.click()
}

/** A single click selects the cell without entering edit mode. */
function selectCell(event: ReactMouseEvent<HTMLTableCellElement>): void {
  if (event.target !== event.currentTarget) return
  event.currentTarget.focus()
}

/** The first ancestor above the horizontal Table wrapper that owns vertical scrolling. */
function verticalScrollParent(node: HTMLElement): HTMLElement | null {
  for (let parent = node.parentElement; parent !== null; parent = parent.parentElement) {
    const overflow = getComputedStyle(parent).overflowY
    if (overflow === 'auto' || overflow === 'scroll') return parent
  }
  return null
}

/** Native-sticky boundaries expressed as a counter-scroll offset for the existing `<thead>`. */
function pinnedHeaderOffset(scrollerTop: number, tableTop: number, tableHeight: number, headerHeight: number): number {
  return Math.max(0, Math.min(scrollerTop - tableTop, Math.max(0, tableHeight - headerHeight)))
}

/**
 * Table view (GRO-2136): sticky header with drag-to-resize columns (`view.columnSize`, written on
 * mouseup), typed cells, the `file.name` cell opening the note, a pinned summary row with a
 * click-to-pick kind per column (`view.summaries`), arrow-key cell navigation and windowing above
 * `WINDOW_AT` lines. Note-property cells edit inline (5B, GRO-2142): `EditableCell` per cell,
 * opened by a whole-cell double-click or Enter, typed by `cellEditor` over the view's rows. With `groupBy` (4C, GRO-2137) the groups render as sections in the same flat
 * tbody slice: one full-width `GroupHeader` row per group (its height = the data row height so the
 * spacer maths holds), collapsed sections keep the header and drop the rows, the total summary row
 * moves into the group headers, and `data-cell` indices count DATA rows only so arrow keys skip
 * headers seamlessly. Grouped rows drag between sections (5C, GRO-2143): dropping on another
 * section's header or rows writes the group property through `onMoveToGroup`, the hovered
 * section highlights, Esc cancels, and a failed move flags the row's name cell.
 */
export function TableView({ def, view, viewIndex, records, rows, groups, collapsed, onToggleGroup, onUpdate, onOpenFile, onOpenFileBackground, onNotice, onMoveToGroup, moveError, onNewInGroup, root, properties = null, folderPage = null, vaultRecords, preview = false }: TableViewProps) {
  const [drag, setDrag] = useState<{ key: string; width: number } | null>(null)
  const { rowProps, card, close } = usePreview(preview)
  // Row drag between sections (5C, GRO-2143); disabled without groups. One write key PER level
  // (YAZ-1101): a level that is not a note property takes no drops and shows no "+".
  const levelKeys = [groupByKey(view), groupByKey(view, 1)]
  const dnd = useGroupDrag(groups === null ? [] : levelKeys, onMoveToGroup)
  const [summaryFor, setSummaryFor] = useState<string | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [rowMenu, setRowMenu] = useState<{ x: number; y: number; path: string } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const wrap = wrapRef.current
    if (wrap === null) return
    const scroller = verticalScrollParent(wrap)
    const table = wrap.querySelector<HTMLElement>('.view-table')
    if (scroller === null || table === null) return
    const header = table.querySelector<HTMLElement>('thead')
    if (header === null) return

    let frame = 0
    const sync = () => {
      frame = 0
      const tableRect = table.getBoundingClientRect()
      const scrollerTop = scroller.getBoundingClientRect().top + scroller.clientTop
      const offset = pinnedHeaderOffset(scrollerTop, tableRect.top, tableRect.height, header.getBoundingClientRect().height)
      wrap.style.setProperty('--view-table-header-y', `${offset}px`)
    }
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(sync)
    }
    const observer = new ResizeObserver(schedule)

    scroller.addEventListener('scroll', schedule, { passive: true })
    observer.observe(scroller)
    for (const block of scroller.children) observer.observe(block)
    sync()

    return () => {
      scroller.removeEventListener('scroll', schedule)
      observer.disconnect()
      if (frame !== 0) cancelAnimationFrame(frame)
      wrap.style.removeProperty('--view-table-header-y')
    }
  }, [])

  const keys = useMemo(() => propertyKeys(def, view, records), [def, view, records])
  const nameCol = keys.findIndex((k) => canonicalKey(k) === 'file.name')
  // per-column halves of the editor inference (5B, GRO-2142), over the view's shown rows;
  // memoised so scroll/drag re-renders skip the per-column row walk (7B, GRO-2148)
  const rowRecords = useMemo(() => rows.map((r) => r.record), [rows])
  const bares = useMemo(() => keys.map((k) => (canonicalKey(k).startsWith('note.') ? canonicalKey(k).slice(5) : null)), [keys])
  const typings = useMemo(() => keys.map((k) => columnTyping(k, rowRecords, properties, folderPage)), [keys, rowRecords, properties, folderPage])
  /** What the pickers resolve and complete over: the WHOLE vault, never the members alone (🔒 D2). */
  const basenames = useMemo(() => vaultRecords.map((r) => r.basename), [vaultRecords])
  // Relation columns narrow the link picker to the pages of the folder page the target names
  // (YAZ-836: `belongsToBasenames` succeeded the type-keyed helper); a target naming no folder
  // page falls back to all basenames. The resolver is THE shared one, memoized per records
  // identity AND root (`resolverFor` — the root since YAZ-846, so this is the very instance the
  // wikilink surfaces hold), adapted to `ResolveLink` as WikilinkIndexBridge does.
  const resolve = useMemo(() => {
    const resolver = resolverFor(vaultRecords, root ?? undefined)
    return (target: string) => resolver(target)?.record.path ?? null
  }, [vaultRecords, root])
  const linkNames = useMemo(
    () => typings.map((t) => (t?.target !== undefined ? belongsToBasenames(vaultRecords, resolve, t.target) : null)),
    [typings, vaultRecords, resolve],
  )
  const rowH = ROW_HEIGHTS[view.rowHeight ?? ''] ?? ROW_HEIGHTS.short
  const widthOf = (key: string) => (drag?.key === key ? drag.width : view.columnSize?.[key] ?? DEFAULT_WIDTH)
  const frozen = frozenColumnCount(view.frozenColumns, keys.length)
  let left = 0
  const frozenLeft = keys.map((key, index) => {
    const offset = index < frozen ? left : undefined
    left += widthOf(key)
    return offset
  })
  const isFrozen = (index: number) => index < frozen
  const frozenStyle = (index: number): CSSProperties | undefined => (isFrozen(index) ? { left: frozenLeft[index] } : undefined)

  // one flat display list (headers + visible data rows) so windowing and keyboard nav share it
  const collapsedSet = new Set(collapsed)
  const lines: Line[] = []
  /** Visible data rows in display order; `data-cell` row indices index into this. */
  const flat: Row[] = []
  if (groups === null) {
    for (const row of rows) lines.push({ row, r: flat.push(row) - 1, g: null, gk: null, at: null })
  } else {
    for (const g of groups) {
      const gk = groupKeyOf(g.key)
      const at: GroupSpot = { level: 0, outer: g }
      lines.push({ header: g, gk, at })
      if (collapsedSet.has(gk)) continue
      if (g.children === undefined) {
        for (const row of g.rows) lines.push({ row, r: flat.push(row) - 1, g, gk, at })
        continue
      }
      // Two levels (YAZ-745): the merge rule's direct rows sit right under the outer, then one
      // indented section per child — still ONE flat list, so windowing and nav are untouched.
      for (const row of g.direct ?? []) lines.push({ row, r: flat.push(row) - 1, g, gk, at })
      for (const child of g.children) {
        const ck = nestedGroupKeyOf(g.key, child.key)
        const inner: GroupSpot = { level: 1, outer: g }
        lines.push({ header: child, gk: ck, nested: true, at: inner })
        if (!collapsedSet.has(ck)) for (const row of child.rows) lines.push({ row, r: flat.push(row) - 1, g: child, gk: ck, at: inner })
      }
    }
  }

  // windowing: mount only the slice around the scroll position, spacer rows keep the scrollbar honest
  const windowed = lines.length > WINDOW_AT
  const viewH = wrapRef.current?.clientHeight || FALLBACK_VIEWPORT
  const first = windowed ? Math.max(0, Math.min(lines.length - 1, Math.floor(scrollTop / rowH) - OVERSCAN)) : 0
  const count = windowed ? Math.min(lines.length - first, Math.ceil(viewH / rowH) + 2 * OVERSCAN) : lines.length
  const visible = lines.slice(first, first + count)
  /** The roving-tabindex entry: the first data row in the mounted slice. */
  const firstDataRow = visible.find((l): l is Extract<Line, { row: Row }> => 'row' in l)?.r

  const startResize = (key: string) => (e: ReactMouseEvent) => {
    e.preventDefault()
    const start = widthOf(key)
    const x0 = e.clientX
    let width = start
    const move = (ev: MouseEvent) => {
      width = Math.max(MIN_WIDTH, start + ev.clientX - x0)
      setDrag({ key, width })
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      setDrag(null)
      if (width !== start)
        onUpdate((d) => {
          d.views[viewIndex].columnSize = { ...d.views[viewIndex].columnSize, [key]: width }
        })
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const setSummary = (key: string, kind: string | null) =>
    onUpdate((d) => {
      const v = d.views[viewIndex]
      const s = { ...v.summaries }
      for (const k of Object.keys(s)) if (canonicalKey(k) === canonicalKey(key)) delete s[k]
      if (kind !== null) s[key] = kind
      if (Object.keys(s).length) v.summaries = s
      else delete v.summaries
    })

  /** Google-Sheets style: right-click selects the data cell, unless a typed editor owns it. */
  const openRowMenu = (path: string) => (event: ReactMouseEvent<HTMLTableRowElement>): void => {
    if (!(event.target instanceof Element)) return
    if (event.target.closest('[data-editing]') !== null) return
    const cell = event.target.closest<HTMLTableCellElement>('td[data-cell]')
    if (cell === null) return
    event.preventDefault()
    cell.focus()
    setRowMenu({ x: event.clientX, y: event.clientY, path })
  }

  /** Arrow keys move between body cells (`data-cell="row:col"`); Enter on the name column opens the note. */
  const onKeyDown = (e: ReactKeyboardEvent) => {
    const at = (e.target as HTMLElement).dataset.cell
    if (at === undefined) return
    const [r, c] = at.split(':').map(Number)
    if (e.key === 'Enter') {
      if (c === nameCol) {
        if (flat[r]) onOpenFile(flat[r].record.path)
      } else {
        // Start editing (or toggle the checkbox) through the same delegated control (5B, GRO-2142).
        ;(e.target as HTMLElement).querySelector<HTMLElement>('[data-edit]')?.click()
      }
      return
    }
    const move = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key]
    if (move === undefined) return
    e.preventDefault()
    const nr = Math.max(0, Math.min(flat.length - 1, r + move[0]))
    const nc = Math.max(0, Math.min(keys.length - 1, c + move[1]))
    wrapRef.current?.querySelector<HTMLElement>(`[data-cell="${nr}:${nc}"]`)?.focus()
  }

  const spacer = (at: string, h: number) => (
    <tr key={at} className="view-table__spacer" aria-hidden style={{ height: h }}>
      <td colSpan={keys.length} />
    </tr>
  )

  return (
    <>
      <div ref={wrapRef} className="view-table-wrap" onScroll={windowed ? (e) => setScrollTop(e.currentTarget.scrollTop) : undefined}>
        <table
          className="view-table"
          style={{ width: keys.reduce((w, k) => w + widthOf(k), 0), '--view-table-row-h': `${rowH}px` } as CSSProperties}
          onKeyDown={onKeyDown}
        >
          <thead>
            <tr>
              {keys.map((key, index) => (
                <th key={key} scope="col" className={isFrozen(index) ? 'view-table__frozen' : undefined} style={{ width: widthOf(key), ...frozenStyle(index) }}>
                  {propertyLabel(def, key)}
                  <span
                    className={`view-table__resize${drag?.key === key ? ' view-table__resize--active' : ''}`}
                    aria-hidden
                    onMouseDown={startResize(key)}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {first > 0 && spacer('top', first * rowH)}
            {visible.map((line) =>
              'header' in line ? (
                <tr
                  key={`group:${line.gk}`}
                  className={`view-table__group${dnd.over === line.gk ? ' view-table__group--drop' : ''}`}
                  {...dnd.target(line.header, line.at)}
                >
                  <td className={`view-table__group-cell${line.nested === true ? ' view-table__group-cell--nested' : ''}`} colSpan={keys.length}>
                    <GroupHeader
                      def={def}
                      view={view}
                      columns={keys}
                      groupKey={line.header.key}
                      rows={line.header.rows}
                      collapsed={collapsedSet.has(line.gk)}
                      onToggle={() => onToggleGroup(line.gk)}
                      onNew={onNewInGroup === undefined || levelKeys[line.at.level] === null ? undefined : () => onNewInGroup(line.header, undefined, line.at)}
                    />
                  </td>
                </tr>
              ) : (
                <tr
                  // Fan-out (YAZ-671): the same record can sit in several groups, and the tbody is ONE
                  // flat list (the windowing needs it), so the path alone is not a unique sibling key.
                  key={line.gk === null ? line.row.record.path : `${line.gk}:${line.row.record.path}`}
                  className={line.gk !== null && dnd.over === line.gk ? 'view-table__row--drop' : undefined}
                  {...(line.g === null || line.at === null ? {} : { ...dnd.source(line.row.record.path, line.g, line.at), ...dnd.target(line.g, line.at) })}
                  {...rowProps(line.row.record)}
                  // Capture phase so the preview closes ALONGSIDE the drag wiring's own onDragStart
                  // rather than replacing it (YAZ-1244): a card must never hang over a drag.
                  onDragStartCapture={close}
                  onContextMenu={openRowMenu(line.row.record.path)}
                >
                  {keys.map((key, c) => {
                    const v = line.row.values[key]
                    return (
                      <td
                        key={key}
                        className={[typeOf(v) === 'number' && 'view-table__cell--num', isFrozen(c) && 'view-table__frozen'].filter(Boolean).join(' ') || undefined}
                        style={frozenStyle(c)}
                        tabIndex={line.r === firstDataRow && c === 0 ? 0 : -1}
                        data-cell={`${line.r}:${c}`}
                        onClick={bares[c] === null ? undefined : selectCell}
                        onDoubleClick={bares[c] === null ? undefined : activateEditorFromCell}
                      >
                        {c === nameCol ? (
                          <>
                            <button type="button" className="view-table__link" onClick={() => onOpenFile(line.row.record.path)}>
                              {render(v)}
                            </button>
                            {moveError?.path === line.row.record.path && (
                              <span className="view-table__chip view-table__chip--error view-drag__error" role="alert" title={moveError.message}>
                                Move failed
                              </span>
                            )}
                          </>
                        ) : bares[c] !== null ? (
                          <EditableCell
                            path={line.row.record.path}
                            propKey={bares[c]}
                            raw={line.row.record.properties[bares[c]]}
                            value={v}
                            editor={cellEditor(line.row.record.properties[bares[c]], typings[c])}
                            basenames={linkNames[c] ?? basenames}
                          />
                        ) : (
                          cellContent(v)
                        )}
                      </td>
                    )
                  })}
                </tr>
              ),
            )}
            {windowed && lines.length - first - count > 0 && spacer('bottom', (lines.length - first - count) * rowH)}
          </tbody>
          {groups === null && (
            <tfoot>
              <tr>
                {keys.map((key, index) => {
                  const label = propertyLabel(def, key)
                  const kind = summaryKindOf(view, key)
                  return (
                    <td key={key} className={`view-table__summary${isFrozen(index) ? ' view-table__frozen' : ''}`} style={frozenStyle(index)}>
                      <button
                        type="button"
                        className="view-table__summary-btn"
                        aria-label={`Summarize ${label}`}
                        aria-haspopup="dialog"
                        aria-expanded={summaryFor === key}
                        onClick={() => setSummaryFor(summaryFor === key ? null : key)}
                      >
                        {kind !== undefined && (
                          <>
                            <span className="view-table__summary-kind">{kind}</span>
                            <span>{render(summarize(kind, rows.map((r) => r.values[key]), def.summaries))}</span>
                          </>
                        )}
                      </button>
                      {summaryFor === key && (
                        <Popover label={`${label} summary`} className="view-table__summary-pop" onClose={() => setSummaryFor(null)}>
                          {['None', ...BUILTIN_SUMMARIES, ...Object.keys(def.summaries ?? {})].map((k) => (
                            <button
                              key={k}
                              type="button"
                              className="view-popover__item"
                              aria-pressed={k === (kind ?? 'None')}
                              onClick={() => {
                                setSummary(key, k === 'None' ? null : k)
                                setSummaryFor(null)
                              }}
                            >
                              {k}
                            </button>
                          ))}
                        </Popover>
                      )}
                    </td>
                  )
                })}
              </tr>
            </tfoot>
          )}
        </table>
        {rowMenu !== null && (
          <PageContextMenu
            x={rowMenu.x}
            y={rowMenu.y}
            path={rowMenu.path}
            onOpenBackground={onOpenFileBackground}
            onNotice={onNotice}
            onClose={() => setRowMenu(null)}
          />
        )}
      </div>
      {/* Outside the scroller on purpose (YAZ-1244): the card is placed against the viewport. */}
      {card}
    </>
  )
}
