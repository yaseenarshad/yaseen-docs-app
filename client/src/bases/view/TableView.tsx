import { type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, useRef, useState } from 'react'
import type { IndexRecord } from '@shared/types'
import type { BaseDefinition, BaseView } from '../baseFile'
import { type Group, type Row, propertyKeys, propertyLabel } from '../engine'
import { ErrorValue, FileValue, LinkValue, type Value, render, typeOf } from '../expr'
import { BUILTIN_SUMMARIES, summarize } from '../summaries'
import type { Mutate } from './FilterMenu'
import { canonicalKey } from './filterRows'
import { GroupHeader, chip, groupKeyOf, summaryKindOf } from './GroupHeader'
import { Popover } from './Popover'

export interface TableViewProps {
  def: BaseDefinition
  view: BaseView
  viewIndex: number
  records: readonly IndexRecord[]
  /** Post-search rows from BaseView; the summary row recomputes over exactly these. */
  rows: readonly Row[]
  /** Post-search groups when `view.groupBy` is set (groups with no shown rows dropped), else null (4C, GRO-2137). */
  groups: readonly Group[] | null
  /** Collapsed group keys (`groupKeyOf`) for this base file + view; owned by BaseView, persisted via storage. */
  collapsed: readonly string[]
  onToggleGroup: (key: string) => void
  onUpdate: Mutate
  onOpenFile: (path: string) => void
}

const DEFAULT_WIDTH = 150
const MIN_WIDTH = 60
/** `view.rowHeight` presets (Obsidian's names); the value feeds `--base-table-row-h` AND the windowing maths. */
const ROW_HEIGHTS: Record<string, number> = { short: 28, medium: 44, tall: 68 }
/** Above this many lines only a scroll-positioned slice is mounted, padded by spacer rows. */
const WINDOW_AT = 500
const OVERSCAN = 10
/** jsdom and the pre-measure first render have no viewport height; assume one screen. */
const FALLBACK_VIEWPORT = 600

/** One display line: a group header row, or a data row with its `data-cell` row index (data rows only). */
type Line = { header: Group; gk: string } | { row: Row; r: number }

/** Typed cell body: error chip, read-only checkbox (editing is 5B), chips for lists/links, `render()` for the rest. */
function cellContent(v: Value) {
  if (v instanceof ErrorValue)
    return (
      <span className="base-table__chip base-table__chip--error" title={v.message}>
        #ERROR
      </span>
    )
  if (typeof v === 'boolean') return <input type="checkbox" checked={v} disabled readOnly />
  if (Array.isArray(v)) return v.map((item, i) => chip(item, i))
  if (v instanceof LinkValue || v instanceof FileValue) return chip(v)
  return render(v)
}

/**
 * Table view (GRO-2136): sticky header with drag-to-resize columns (`view.columnSize`, written on
 * mouseup), typed cells, the `file.name` cell opening the note, a pinned summary row with a
 * click-to-pick kind per column (`view.summaries`), arrow-key cell navigation and windowing above
 * `WINDOW_AT` lines. With `groupBy` (4C, GRO-2137) the groups render as sections in the same flat
 * tbody slice: one full-width `GroupHeader` row per group (its height = the data row height so the
 * spacer maths holds), collapsed sections keep the header and drop the rows, the total summary row
 * moves into the group headers, and `data-cell` indices count DATA rows only so arrow keys skip
 * headers seamlessly.
 */
export function TableView({ def, view, viewIndex, records, rows, groups, collapsed, onToggleGroup, onUpdate, onOpenFile }: TableViewProps) {
  const [drag, setDrag] = useState<{ key: string; width: number } | null>(null)
  const [summaryFor, setSummaryFor] = useState<string | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)

  const keys = propertyKeys(def, view, records)
  const nameCol = keys.findIndex((k) => canonicalKey(k) === 'file.name')
  const rowH = ROW_HEIGHTS[view.rowHeight ?? ''] ?? ROW_HEIGHTS.short
  const widthOf = (key: string) => (drag?.key === key ? drag.width : view.columnSize?.[key] ?? DEFAULT_WIDTH)

  // one flat display list (headers + visible data rows) so windowing and keyboard nav share it
  const collapsedSet = new Set(collapsed)
  const lines: Line[] = []
  /** Visible data rows in display order; `data-cell` row indices index into this. */
  const flat: Row[] = []
  if (groups === null) {
    for (const row of rows) lines.push({ row, r: flat.push(row) - 1 })
  } else {
    for (const g of groups) {
      const gk = groupKeyOf(g.key)
      lines.push({ header: g, gk })
      if (!collapsedSet.has(gk)) for (const row of g.rows) lines.push({ row, r: flat.push(row) - 1 })
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

  /** Arrow keys move between body cells (`data-cell="row:col"`); Enter on the name column opens the note. */
  const onKeyDown = (e: ReactKeyboardEvent) => {
    const at = (e.target as HTMLElement).dataset.cell
    if (at === undefined) return
    const [r, c] = at.split(':').map(Number)
    if (e.key === 'Enter') {
      if (c === nameCol && flat[r]) onOpenFile(flat[r].record.path)
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
    <tr key={at} className="base-table__spacer" aria-hidden style={{ height: h }}>
      <td colSpan={keys.length} />
    </tr>
  )

  return (
    <div ref={wrapRef} className="base-table-wrap" onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
      <table
        className="base-table"
        style={{ width: keys.reduce((w, k) => w + widthOf(k), 0), '--base-table-row-h': `${rowH}px` } as CSSProperties}
        onKeyDown={onKeyDown}
      >
        <thead>
          <tr>
            {keys.map((key) => (
              <th key={key} scope="col" style={{ width: widthOf(key) }}>
                {propertyLabel(def, key)}
                <span className="base-table__resize" aria-hidden onMouseDown={startResize(key)} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {first > 0 && spacer('top', first * rowH)}
          {visible.map((line) =>
            'header' in line ? (
              <tr key={`group:${line.gk}`} className="base-table__group">
                <td colSpan={keys.length}>
                  <GroupHeader
                    def={def}
                    view={view}
                    columns={keys}
                    groupKey={line.header.key}
                    rows={line.header.rows}
                    collapsed={collapsedSet.has(line.gk)}
                    onToggle={() => onToggleGroup(line.gk)}
                  />
                </td>
              </tr>
            ) : (
              <tr key={line.row.record.path}>
                {keys.map((key, c) => {
                  const v = line.row.values[key]
                  return (
                    <td
                      key={key}
                      className={typeOf(v) === 'number' ? 'base-table__cell--num' : undefined}
                      tabIndex={line.r === firstDataRow && c === 0 ? 0 : -1}
                      data-cell={`${line.r}:${c}`}
                    >
                      {c === nameCol ? (
                        <button type="button" className="base-table__link" onClick={() => onOpenFile(line.row.record.path)}>
                          {render(v)}
                        </button>
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
              {keys.map((key) => {
                const label = propertyLabel(def, key)
                const kind = summaryKindOf(view, key)
                return (
                  <td key={key} className="base-table__summary">
                    <button
                      type="button"
                      className="base-table__summary-btn"
                      aria-label={`Summarize ${label}`}
                      aria-haspopup="dialog"
                      aria-expanded={summaryFor === key}
                      onClick={() => setSummaryFor(summaryFor === key ? null : key)}
                    >
                      {kind !== undefined && (
                        <>
                          <span className="base-table__summary-kind">{kind}</span>
                          <span>{render(summarize(kind, rows.map((r) => r.values[key]), def.summaries))}</span>
                        </>
                      )}
                    </button>
                    {summaryFor === key && (
                      <Popover label={`${label} summary`} className="base-table__summary-pop" onClose={() => setSummaryFor(null)}>
                        {['None', ...BUILTIN_SUMMARIES, ...Object.keys(def.summaries ?? {})].map((k) => (
                          <button
                            key={k}
                            type="button"
                            className="base-popover__item"
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
    </div>
  )
}
