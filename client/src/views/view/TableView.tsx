import { type CSSProperties, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { IndexRecord, PropertiesResponse } from '@shared/types'
import { type ViewSet, type ViewDef, type Mutate, shownGroupLevels } from '../viewSchema'
import { titleCandidates } from '../../links/completion'
import { belongsToTitles } from '../../links/folderLinks'
import { type Group, type Row, propertyKeys, propertyLabel } from '../engine'
import { type Resolver, type Value, render, typeOf } from '../expr'
import type { ColumnDecl, FolderSettings } from '../folderSettings'
import { BUILTIN_SUMMARIES, summarize } from '../summaries'
import { cellEditor, columnTyping } from '../editorType'
import { EditableCell } from './EditableCell'
import { canonicalKey } from './keys'
import { GroupHeader, cellContent, rowTitle, summaryKindOf } from './GroupHeader'
import { type GroupDrop, type GroupSpot, type GroupSwap, TOP_SPOT, childSpot, groupByKey, groupTakesNew, spotKey, useGroupDrag } from './groupDrag'
import { Popover } from './Popover'
import type { ResolveLink } from '../../editor/wikilink/wikilinkPlugin'
import { cssZoom } from '../../lib/cssZoom'
import { holdColResize } from '../../lib/colResize'
import { pinnedHeaderOffset, verticalScrollParent } from '../../lib/pinnedHeader'
import { openByGesture } from '../../lib/openGesture'
import { newWindowClick } from '../../lib/newWindowClick'
import { frozenColumnCount } from './frozenColumns'
import { PageContextMenu } from './PageContextMenu'
import { FillMenu } from './FillMenu'
import { cellFillOf, fillIndex, fillPaint, setViewFill } from './fills'
import { TableHeaderMenu } from './TableHeaderMenu'
import { TextField } from './TextField'
import { ConfirmDeleteColumn } from './ConfirmDeleteColumn'
import { dropIndex, insertionSlot } from '../../lib/dragSlot'
import { allPropertyKeys } from './properties'
import { setViewOrder } from './columnOrder'
import { NO_READ_ONLY, READ_ONLY_TIP, writableKey } from '../readOnlyRows'
import { ReadOnlyName } from './ReadOnlyMark'
import type { ViewHover } from './viewHover'
import type { FolderHost } from '../ViewsPane'
import type { NoteWindowLink } from './NoteWindow'

export interface TableViewProps {
  /** The folder's hover panel (YAZ-3403, `viewHover.ts`): `ViewsPane` always passes it; Settings › Preview on hover › Folder views starts or stops the dwell (YAZ-3743). */
  hover: ViewHover
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
  /** Open a row page in the window's right panel. */
  onOpenFileRight?: (path: string) => void
  /** A row page action opens without replacing the current tab. */
  onOpenFileBackground?: (path: string) => void
  /** The row menu's "Open in a window" (YAZ-4547): the card over the folder page. Absent: no such item. */
  onOpenWindow?: (path: string) => void
  /** The card's link (YAZ-4547 D16): the table hands it its rows in display order, and marks the card's row. */
  windowLink?: NoteWindowLink
  /** Passive reporting for a stale or failed OS action. */
  onNotice?: (message: string) => void
  /** A drop on another section: `groupBy.property = value` (undefined deletes) via ViewsPane (5C, GRO-2143); `drop` says which LEVEL, and carries the outer's write on a cross-outer inner drop (YAZ-1101). */
  onMoveToGroup: (path: string, value: unknown, swap?: GroupSwap, drop?: GroupDrop) => void
  /** The last failed move, flagged inline on its row. */
  moveError: { path: string; message: string } | null
  /** Create a note seeded with a section's group value (5D, GRO-2144); absent → no "+" on headers and no "+ New" row. `at` places the section for the level-aware seed (YAZ-1101). null: the ungrouped table's "+ New" row (YAZ-4539). */
  onNewInGroup?: (group: Group | null, name?: string, at?: GroupSpot) => void
  /** Vault root, so the picker's resolver is THE one the wikilink surfaces share (YAZ-846). */
  root: string
  /** The vault's property declarations (5E, GRO-2217): vault-wide editor inference and relation targets. */
  properties?: PropertiesResponse | null
  /** The settings of the folder whose rows these are (YAZ-819): the typing ladder's TOP rung (🔒 Q8). */
  settings: FolderSettings
  /** The WHOLE index snapshot (🔒 D2, YAZ-819) — `records` is only the folder's rows: link resolution and the link pickers read this, never the rows alone. */
  vaultRecords: readonly IndexRecord[]
  /** The snapshot's folder settings records, for a link column narrowed to a folder. */
  vaultFolders: readonly IndexRecord[]
  /** ViewsPane's resolver: a cell reads an id link as the title of the note, or folder, it names (YAZ-2293 D8). */
  resolve: Resolver
  /** The window's link resolver, by which a link column's target names its folder. */
  resolveLink: ResolveLink
  /** `FolderHost.setColumn`: the header menu's "Edit column…" writes one declaration through it (YAZ-4533). */
  setColumn: FolderHost['setColumn']
  /** `FolderHost.setColumns` (YAZ-1513): the header menu's "Add column to the right…" declares through it. */
  declareColumn: (columns: Record<string, ColumnDecl>, views: ViewDef[]) => void
  /** `FolderHost.deleteColumn` (YAZ-1513): the header menu's "Delete column…", confirm-first. Absent → the menu has no such item. */
  deleteColumn?: (key: string) => Promise<void>
  /** `FolderHost.valueCount`: the number that confirm states. */
  valueCount: (key: string) => number
  /** A cell's commit: one value of one row, through the host's writer (`FolderHost.writeValues`). */
  onWriteValue: (path: string, key: string, value: unknown) => Promise<unknown>
  /** The read-only notes (YAZ-3076 D6): their cells open no editor and their cards do not move. Absent = none. */
  readOnly?: ReadonlySet<string>
  /** The Name cell's commit (YAZ-2420 🔒 D19): the row's new title, through `FolderHost.retitle`. */
  onRetitle: (path: string, title: string) => void
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
/** The `#` gutter's fixed width (YAZ-1513): always the first, always-sticky column; frozen offsets start after it. */
const GUTTER_WIDTH = 44
/** The header drag's own payload (YAZ-1548) — `ViewTabs`' `VIEW_TAB_MIME` idiom; never `text/plain`, so a stray text drop is not a reorder. */
const COLUMN_MIME = 'application/x-yaseen-table-column'
/** The row of the note the note window shows (YAZ-4547). */
const CURRENT_ROW = 'view-table__row--current'
/** Frozen rows (YAZ-4537): at most this many data rows freeze. */
const MAX_FROZEN_ROWS = 10
/** ...and the frozen lines stop here, group headers included: 10 rows under up to three headers each. */
const MAX_FROZEN_LINES = 40

/**
 * One display line: a group header row (`depth` = its level, 0 at the top: YAZ-745, YAZ-4531), or a data row with its
 * `data-cell` row index (data rows only), its `#` gutter number `n` (YAZ-1513) and its group (null when ungrouped).
 * `at` places that group for the level-aware drag / "+" (YAZ-1101). Or a "+ New" row (YAZ-4539): one row high, but
 * not a data row; `add` is its group (null at the end of an ungrouped table), `gk` its key.
 */
type Line =
  | { header: Group; gk: string; depth: number; at: GroupSpot }
  | { row: Row; r: number; n: number; g: Group | null; gk: string | null; at: GroupSpot | null }
  | { add: Group | null; gk: string; at: GroupSpot | undefined }

/**
 * A data row's sibling key. Fan-out (YAZ-671): the same record can sit in several groups, and the
 * tbody is ONE flat list (the windowing needs it), so the path alone is not unique.
 */
const rowKey = (line: Extract<Line, { row: Row }>): string => (line.gk === null ? line.row.record.path : `${line.gk}:${line.row.record.path}`)

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

/**
 * Table view (GRO-2136): sticky header with drag-to-resize columns (`view.columnSize`, written on
 * mouseup), typed cells, the `file.name` cell showing the note's title as plain text (YAZ-2420
 * 🔒 D26: a click selects it, a double-click edits the title, ⌘/⌥-click and Enter open the
 * note), a pinned summary row with a
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
export function TableView({ def, view, viewIndex, records, rows, groups, collapsed, onToggleGroup, onUpdate, onOpenFile, onOpenFileRight, onOpenFileBackground, onOpenWindow, windowLink, onNotice, onMoveToGroup, moveError, onNewInGroup, root, properties = null, settings, vaultRecords, vaultFolders, resolve, resolveLink, setColumn, declareColumn, deleteColumn, valueCount, onWriteValue, onRetitle, readOnly = NO_READ_ONLY, hover }: TableViewProps) {
  const [drag, setDrag] = useState<{ key: string; width: number } | null>(null)
  /** A modified click on the Name cell and Enter on it share the one open rule (YAZ-1557): ⌘ background, ⌥ right, plain current. */
  const openHandlers = { onOpenFile, onOpenFileRight, onOpenFileBackground }
  /** The data row (`rowKey`) whose title is being edited in its Name cell (YAZ-2420 🔒 D26). */
  const [titleEdit, setTitleEdit] = useState<string | null>(null)
  // Row drag between sections (5C, GRO-2143); disabled without groups. One write key PER level
  // (YAZ-1101): a level that is not a note property takes no drops and shows no "+".
  const levelKeys = shownGroupLevels(view).map((_, level) => groupByKey(view, level))
  const dnd = useGroupDrag(groups === null ? [] : levelKeys, onMoveToGroup)
  const [summaryFor, setSummaryFor] = useState<string | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  /** The row right-click's menu: its record, the column key of the cell it was opened on (the fill target, YAZ-4536), and its data row index (the freeze target, YAZ-4537). */
  const [rowMenu, setRowMenu] = useState<{ x: number; y: number; record: IndexRecord; column: string; r: number } | null>(null)
  /** The header's own menu (YAZ-1513): `key` null = the `#` gutter header. */
  const [headerMenu, setHeaderMenu] = useState<{ x: number; y: number; key: string | null } | null>(null)
  /** "Delete column…" awaiting its confirm (YAZ-1513). */
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  /**
   * A header drag in flight (YAZ-1548): `from` is an index in `keys`, `to` the insertion slot it
   * would land in (0..keys.length). The Properties list's own reorder model, on the table itself.
   */
  const [colDrag, setColDrag] = useState<{ from: number; to: number } | null>(null)
  // Esc cancels: real drags fire `dragend`; jsdom (and any missed dragend) goes through this fallback —
  // `useGroupDrag`'s idiom. Subscribed once per DRAG, not once per slot the pointer crosses.
  const dragging = colDrag !== null
  useEffect(() => {
    if (!dragging) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setColDrag(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [dragging])
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
      const zoom = cssZoom(wrap)
      const tableRect = table.getBoundingClientRect()
      const scrollerTop = scroller.getBoundingClientRect().top + scroller.clientTop * zoom
      const offset = pinnedHeaderOffset(scrollerTop, tableRect.top, tableRect.height, header.getBoundingClientRect().height) / zoom
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

  // The frozen rows stick under the header (YAZ-4537), whose height can differ from a row's: measured at mount
  // and when the header resizes, into `--view-table-head-h`; never on scroll.
  const hasFrozenRows = (view.frozenRows ?? 0) !== 0
  useLayoutEffect(() => {
    const wrap = wrapRef.current
    const header = wrap?.querySelector<HTMLElement>('.view-table thead')
    if (!hasFrozenRows || wrap == null || header == null) return
    const measure = () => wrap.style.setProperty('--view-table-head-h', `${header.getBoundingClientRect().height / cssZoom(wrap)}px`)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(header)
    return () => {
      observer.disconnect()
      wrap.style.removeProperty('--view-table-head-h')
    }
  }, [hasFrozenRows])

  const keys = useMemo(() => propertyKeys(def, view, records, Object.keys(settings.columns)), [def, view, records, settings])
  const nameCol = keys.findIndex((k) => canonicalKey(k) === 'file.name')
  // per-column halves of the editor inference (5B, GRO-2142), over the view's shown rows;
  // memoised so scroll/drag re-renders skip the per-column row walk (7B, GRO-2148)
  const rowRecords = useMemo(() => rows.map((r) => r.record), [rows])
  const bares = useMemo(() => keys.map(writableKey), [keys])
  const typings = useMemo(() => keys.map((k) => columnTyping(k, rowRecords, properties, settings)), [keys, rowRecords, properties, settings])
  /** What the pickers resolve and complete over: the WHOLE vault, never the folder's rows alone (🔒 D2). */
  const titles = useMemo(() => titleCandidates(vaultRecords), [vaultRecords])
  // Relation columns narrow the link picker to the notes in the FOLDER the target names
  // (YAZ-2290 D10: `belongsToTitles`); a target naming no folder falls back to all titles.
  const linkNames = useMemo(
    () => typings.map((t) => (t?.target !== undefined ? belongsToTitles(vaultRecords, vaultFolders, resolveLink, root, t.target) : null)),
    [typings, vaultRecords, vaultFolders, resolveLink, root],
  )
  const rowH = ROW_HEIGHTS[view.rowHeight ?? ''] ?? ROW_HEIGHTS.short
  const widthOf = (key: string) => (drag?.key === key ? drag.width : view.columnSize?.[key] ?? DEFAULT_WIDTH)
  const frozen = frozenColumnCount(view.frozenColumns, keys.length)
  /** The `#` gutter is shown unless the view says `rowNumbers: false` (YAZ-1513). */
  const numbered = view.rowNumbers !== false
  /** The gutter's bookkeeping, spelled once (YAZ-1549): its width, and the cells a full-width row spans. */
  const gutterWidth = numbered ? GUTTER_WIDTH : 0
  const span = keys.length + (numbered ? 1 : 0)
  // Frozen offsets start AFTER the `#` gutter, which is itself always sticky at left 0 (YAZ-1513).
  let left = gutterWidth
  const frozenLeft = keys.map((key, index) => {
    const offset = index < frozen ? left : undefined
    left += widthOf(key)
    return offset
  })
  const isFrozen = (index: number) => index < frozen
  /** The freeze line (YAZ-4534): the table block's 3px edge on the last frozen column. */
  const frozenClass = (index: number): string | false => isFrozen(index) && (index === frozen - 1 ? 'view-table__frozen view-table__frozen-end' : 'view-table__frozen')
  const frozenStyle = (index: number): CSSProperties | undefined => (isFrozen(index) ? { left: frozenLeft[index] } : undefined)
  /** The view's cell and row fills by note path (YAZ-4536): built once per fills write, two map reads per cell. */
  const fills = useMemo(() => fillIndex(view.fills, resolveLink), [view.fills, resolveLink])

  // one flat display list (headers + visible data rows) so windowing and keyboard nav share it
  const collapsedSet = new Set(collapsed)
  const lines: Line[] = []
  /** Visible data rows in display order; `data-cell` row indices index into this. */
  const flat: Row[] = []
  /** The `#` gutter (YAZ-1513): 1-based, restarts at every group header (each innermost section). Display position, never an id. */
  let n = 0
  if (groups === null) {
    for (const row of rows) lines.push({ row, r: flat.push(row) - 1, n: ++n, g: null, gk: null, at: null })
    // The "+ New" row (YAZ-4539, S12) ends the table, wherever the toolbar's New is offered.
    if (onNewInGroup !== undefined) lines.push({ add: null, gk: '', at: undefined })
  } else {
    // Nested levels (YAZ-745, three since YAZ-4531): the merge rule's direct rows sit right under
    // their group, then one indented section per child — still ONE flat list, so windowing and nav are untouched.
    const walk = (list: readonly Group[], at: GroupSpot) => {
      for (const g of list) {
        const gk = spotKey(g, at)
        lines.push({ header: g, gk, depth: at.level, at })
        n = 0
        if (collapsedSet.has(gk)) continue
        for (const row of g.children === undefined ? g.rows : g.direct ?? []) lines.push({ row, r: flat.push(row) - 1, n: ++n, g, gk, at })
        if (g.children !== undefined) walk(g.children, childSpot(g, at))
        // ...and ends each innermost section, where its header offers the "+" (YAZ-4539).
        else if (onNewInGroup !== undefined && groupTakesNew(view, at.level)) lines.push({ add: g, gk, at })
      }
    }
    walk(groups, TOP_SPOT)
  }

  // Frozen rows (YAZ-4537, D9b / S4): `frozenRows` counts DATA rows; the frozen lines are every line from the top
  // through the Nth shown one, so the headers above it freeze too, and a collapsed group's count goes on below it.
  const frozenRows = frozenColumnCount(view.frozenRows, MAX_FROZEN_ROWS)
  let pinned = 0
  for (let i = 0, seen = 0; seen < frozenRows && i < Math.min(lines.length, MAX_FROZEN_LINES); i++) {
    if ('row' in lines[i]) {
      seen++
      pinned = i + 1
    }
  }
  const head = lines.slice(0, pinned)

  // windowing: mount only the slice around the scroll position, spacer rows keep the scrollbar honest.
  // The frozen lines always mount; the window starts below them (YAZ-4537).
  const windowed = lines.length > WINDOW_AT
  const viewH = wrapRef.current?.clientHeight || FALLBACK_VIEWPORT
  const first = windowed ? Math.max(pinned, Math.min(lines.length - 1, Math.floor(scrollTop / rowH) - OVERSCAN)) : pinned
  const count = windowed ? Math.min(lines.length - first, Math.ceil(viewH / rowH) + 2 * OVERSCAN) : lines.length - first
  const visible = lines.slice(first, first + count)
  /** The roving-tabindex entry: the first data row in the mounted lines. */
  const firstDataRow = [...head, ...visible].find((l): l is Extract<Line, { row: Row }> => 'row' in l)?.r
  // The note window (YAZ-4547 D16): the rows it steps through, read at its step, and the mark of its row. A step writes
  // the mark on the DOM, so the table does not render for it; a render of the table draws the same mark from `current`.
  if (windowLink !== undefined) {
    windowLink.rows = flat
    windowLink.show = () => {
      const wrap = wrapRef.current
      if (wrap === null) return
      const current = windowLink.current
      let shown: HTMLElement | null = null
      for (const tr of wrap.querySelectorAll<HTMLElement>('tbody > tr[data-hover-item]')) {
        const on = tr.dataset.hoverItem === current
        tr.classList.toggle(CURRENT_ROW, on)
        if (on) shown ??= tr
      }
      if (current === null) return
      if (shown !== null) shown.scrollIntoView?.({ block: 'nearest' })
      else if (windowed) {
        // Windowed out of the mounted slice: scroll the wrap to the row's line, which mounts it.
        const at = lines.findIndex((l) => 'row' in l && l.row.record.path === current)
        if (at !== -1) wrap.scrollTop = Math.max(0, at * rowH - (wrap.clientHeight - rowH) / 2)
      }
    }
  }
  useEffect(
    () => () => {
      if (windowLink === undefined) return
      windowLink.rows = []
      windowLink.show = () => {}
    },
    [windowLink],
  )

  const startResize = (key: string) => (e: ReactMouseEvent) => {
    // The left button only (YAZ-3719 1B): a right press's release can go to the native menu and never come.
    if (e.button !== 0) return
    e.preventDefault()
    const start = widthOf(key)
    const x0 = e.clientX
    const zoom = cssZoom(e.currentTarget)
    let width = start
    const move = (ev: MouseEvent) => {
      width = Math.max(MIN_WIDTH, start + (ev.clientX - x0) / zoom)
      setDrag({ key, width })
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      holdColResize(false)
      setDrag(null)
      if (width !== start)
        onUpdate((d) => {
          d.views[viewIndex].columnSize = { ...d.views[viewIndex].columnSize, [key]: width }
        })
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    holdColResize(true)
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
  const openRowMenu = (record: IndexRecord) => (event: ReactMouseEvent<HTMLTableRowElement>): void => {
    if (!(event.target instanceof Element)) return
    if (event.target.closest('[data-editing]') !== null) return
    const cell = event.target.closest<HTMLTableCellElement>('td[data-cell]')
    if (cell === null) return
    event.preventDefault()
    cell.focus()
    // `data-cell` is `row:column`: the column index names the key the fill is for (YAZ-4536), the row index the freeze (YAZ-4537).
    const [r, c] = (cell.dataset.cell ?? '').split(':').map(Number)
    setRowMenu({ x: event.clientX, y: event.clientY, record, column: keys[c], r })
  }

  /**
   * Header reorder (YAZ-1548), the tab strips' own slot arithmetic (`lib/dragSlot.ts`): the slot is
   * an index in the WITH-dragged-column list, so past the grab point it shifts one left. ONE write
   * through the SHARED `setViewOrder` — the Properties checklist's and "Hide column"'s writer — so
   * `frozenColumns` follows positionally here exactly as it does there. A view with no explicit
   * `order` writes the full current keys list in the new order, as the list does on its first drag.
   */
  const moveColumn = (from: number, slot: number): void => {
    const to = dropIndex(from, slot)
    if (to === from) return
    const next = [...keys]
    const [key] = next.splice(from, 1)
    next.splice(to, 0, key)
    onUpdate((d) => setViewOrder(d, viewIndex, next))
  }
  /** The property headers' drag wiring (YAZ-1548); the `#` gutter gets none — not a source, not a target. */
  const headerDrag = (index: number) => ({
    draggable: true,
    onDragStart: (e: ReactDragEvent<HTMLTableCellElement>) => {
      // The resize grip is a MOUSE gesture (its mousedown already prevents default); a drag that
      // somehow starts there is refused rather than reordering under a resize.
      if (e.target instanceof Element && e.target.closest('.view-table__resize') !== null) {
        e.preventDefault()
        return
      }
      // The groupDrag idiom: `dataTransfer` guarded — jsdom's synthetic drags have none.
      e.dataTransfer?.setData(COLUMN_MIME, keys[index])
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
      setColDrag({ from: index, to: index })
    },
    onDragOver: (e: ReactDragEvent<HTMLTableCellElement>) => {
      if (colDrag === null) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
      const to = insertionSlot(e, index)
      if (colDrag.to !== to) setColDrag({ ...colDrag, to })
    },
    onDrop: (e: ReactDragEvent<HTMLTableCellElement>) => {
      if (colDrag === null) return
      e.preventDefault()
      setColDrag(null)
      moveColumn(colDrag.from, insertionSlot(e, index))
    },
    onDragEnd: () => setColDrag(null),
  })
  /** The indicator classes (YAZ-1548): the source dims; an accent edge marks the slot before — or, for the end slot, after the last — header. */
  const headerDragClass = (index: number): string[] => {
    if (colDrag === null) return []
    const cls: string[] = []
    if (colDrag.from === index) cls.push('view-table__th--drag-source')
    if (colDrag.to === index) cls.push('view-table__th--insert-before')
    if (colDrag.to === keys.length && index === keys.length - 1) cls.push('view-table__th--insert-after')
    return cls
  }

  /** A header right-click (YAZ-1513): rename / hide / add-right on a column, hide on the `#` gutter. */
  const openHeaderMenu = (key: string | null) => (event: ReactMouseEvent<HTMLTableCellElement>): void => {
    event.preventDefault()
    setRowMenu(null)
    setHeaderMenu({ x: event.clientX, y: event.clientY, key })
  }

  /** Arrow keys move between body cells (`data-cell="row:col"`); Enter on the name column opens the note. */
  const onKeyDown = (e: ReactKeyboardEvent) => {
    const at = (e.target as HTMLElement).dataset.cell
    if (at === undefined) return
    const [r, c] = at.split(':').map(Number)
    if (e.key === 'Enter') {
      if (c === nameCol) {
        if (flat[r]) openByGesture(e, flat[r].record.path, openHandlers)
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
      <td colSpan={span} />
    </tr>
  )

  /**
   * One body line. `frozenAt` is a frozen line's place from the top (YAZ-4537): its sticky index (`--view-frozen-i`,
   * views.css), and the last one draws the 3px freeze line.
   */
  const renderLine = (line: Line, frozenAt?: number) => {
    const frozenRow = frozenAt === undefined ? undefined : ['view-table__row--frozen', frozenAt === pinned - 1 && 'view-table__row--frozen-end']
    const frozenRowStyle = frozenAt === undefined ? undefined : ({ '--view-frozen-i': frozenAt } as CSSProperties)
    if ('add' in line)
      // The "+ New" row (YAZ-4539): the group header "+"'s path, so the note gets the filter seed and every group value above it.
      return (
        <tr key={`new:${line.gk}`} className={['view-table__new', ...(frozenRow ?? [])].filter(Boolean).join(' ')} style={frozenRowStyle}>
          <td className="view-table__new-cell" colSpan={span}>
            <button type="button" className="view-table__new-btn" onClick={() => onNewInGroup?.(line.add, undefined, line.at)}>
              + New
            </button>
          </td>
        </tr>
      )
    return (
      'header' in line ? (
        <tr
          key={`group:${line.gk}`}
          className={['view-table__group', dnd.over === line.gk && 'view-table__group--drop', ...(frozenRow ?? [])].filter(Boolean).join(' ')}
          style={frozenRowStyle}
          {...dnd.target(line.header, line.at)}
        >
          <td className="view-table__group-cell" colSpan={span} style={{ '--depth': line.depth } as CSSProperties}>
            <GroupHeader
              def={def}
              view={view}
              columns={keys}
              groupKey={line.header.key}
              label={line.header.label}
              rows={line.header.rows}
              collapsed={collapsedSet.has(line.gk)}
              onToggle={() => onToggleGroup(line.gk)}
              onNew={onNewInGroup === undefined || !groupTakesNew(view, line.at.level) ? undefined : () => onNewInGroup(line.header, undefined, line.at)}
              resolve={resolve}
            />
          </td>
        </tr>
      ) : (
        <tr
          key={rowKey(line)}
          className={[line.gk !== null && dnd.over === line.gk && 'view-table__row--drop', windowLink?.current === line.row.record.path && CURRENT_ROW, ...(frozenRow ?? [])].filter(Boolean).join(' ') || undefined}
          style={frozenRowStyle}
          {...(line.g === null || line.at === null ? {} : { ...dnd.source(line.row.record.path, line.g, line.at, readOnly.has(line.row.record.path)), ...dnd.target(line.g, line.at) })}
          {...hover.itemProps(line.row.record.path)}
          onContextMenu={openRowMenu(line.row.record)}
        >
          {/* No `data-cell` and no tabIndex: the gutter is outside the arrow-key grid (YAZ-1513). */}
          {numbered && <td className="view-table__gutter">{line.n}</td>}
          {keys.map((key, c) => {
            const v = line.row.values[key]
            const { path, title } = line.row.record
            const locked = readOnly.has(path)
            const fill = cellFillOf(fills, path, key)
            return (
              <td
                key={key}
                // `view-table__name` has no style: the tests and the end-to-end specs find the Name cell by it.
                className={[typeOf(v) === 'number' && 'view-table__cell--num', c === nameCol && 'view-table__name', frozenClass(c), fill !== undefined && 'view-table__cell--fill'].filter(Boolean).join(' ') || undefined}
                // A fill (YAZ-4536) is a custom property that views.css paints over the cell's base.
                style={fill === undefined ? frozenStyle(c) : ({ ...frozenStyle(c), '--view-cell-fill': fillPaint(fill) } as CSSProperties)}
                tabIndex={line.r === firstDataRow && c === 0 ? 0 : -1}
                data-cell={`${line.r}:${c}`}
                // The Name cell (YAZ-2420 🔒 D26): ⌘ and ⌥ open the note; a plain click only selects, as on any cell.
                // ⇧⌘ opens it in a new window (YAZ-4444 D32), asked first.
                onClick={c === nameCol ? (e) => (newWindowClick(e, path) ? undefined : e.metaKey || e.altKey ? void openByGesture(e, path, openHandlers) : selectCell(e)) : bares[c] === null ? undefined : selectCell}
                // A read-only note's Name cell opens no title field: a title edit renames the note (YAZ-3076 D6).
                title={c === nameCol && locked ? READ_ONLY_TIP : undefined}
                onDoubleClick={c === nameCol ? (locked ? undefined : () => setTitleEdit(rowKey(line))) : bares[c] === null ? undefined : activateEditorFromCell}
              >
                {c === nameCol ? (
                  <>
                    {titleEdit === rowKey(line) ? (
                      <span className="view-cell-edit" data-editing="">
                        <TextField
                          className="view-input view-cell-edit__input"
                          autoFocus
                          aria-label="Edit title"
                          value={title}
                          normalize={(draft) => draft.trim() || null}
                          onCommit={(next) => onRetitle(path, next)}
                          onDone={() => {
                            setTitleEdit(null)
                            wrapRef.current?.querySelector<HTMLElement>(`[data-cell="${line.r}:${c}"]`)?.focus()
                          }}
                        />
                      </span>
                    ) : (
                      locked ? <ReadOnlyName>{rowTitle(line.row)}</ReadOnlyName> : rowTitle(line.row)
                    )}
                    {moveError?.path === line.row.record.path && (
                      <span className="view-table__chip view-table__chip--error view-drag__error" role="alert" title={moveError.message}>
                        Move failed
                      </span>
                    )}
                  </>
                ) : bares[c] !== null ? (
                  <EditableCell
                    propKey={bares[c]}
                    raw={line.row.record.properties[bares[c]]}
                    value={v}
                    editor={cellEditor(line.row.record.properties[bares[c]], typings[c])}
                    options={typings[c]?.options}
                    titles={linkNames[c] ?? titles}
                    resolve={resolve}
                    readOnly={locked}
                    onCommit={(next) => onWriteValue(line.row.record.path, bares[c]!, next)}
                  />
                ) : (
                  cellContent(v, resolve)
                )}
              </td>
            )
          })}
        </tr>
      )
    )
  }

  return (
    <>
      <div ref={wrapRef} className="view-table-wrap" onScroll={windowed ? (e) => setScrollTop(e.currentTarget.scrollTop) : undefined}>
        <table
          className="view-table"
          style={{ width: gutterWidth + keys.reduce((w, k) => w + widthOf(k), 0), '--view-table-row-h': `${rowH}px` } as CSSProperties}
          onKeyDown={onKeyDown}
        >
          <thead>
            <tr>
              {numbered && (
                <th scope="col" className="view-table__gutter" style={{ width: GUTTER_WIDTH }} onContextMenu={openHeaderMenu(null)}>
                  #
                </th>
              )}
              {keys.map((key, index) => (
                <th
                  key={key}
                  scope="col"
                  className={[frozenClass(index), ...headerDragClass(index)].filter(Boolean).join(' ') || undefined}
                  style={{ width: widthOf(key), ...frozenStyle(index) }}
                  onContextMenu={openHeaderMenu(key)}
                  {...headerDrag(index)}
                >
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
            {head.map((line, i) => renderLine(line, i))}
            {first > pinned && spacer('top', (first - pinned) * rowH)}
            {visible.map((line) => renderLine(line))}
            {windowed && lines.length - first - count > 0 && spacer('bottom', (lines.length - first - count) * rowH)}
          </tbody>
          {groups === null && (
            <tfoot>
              <tr>
                {/* Keeps the summary cells under their columns; the gutter has nothing to summarise. */}
                {numbered && <td className="view-table__summary view-table__gutter" />}
                {keys.map((key, index) => {
                  const label = propertyLabel(def, key)
                  const kind = summaryKindOf(view, key)
                  return (
                    <td key={key} className={['view-table__summary', frozenClass(index)].filter(Boolean).join(' ')} style={frozenStyle(index)}>
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
                            <span>{render(summarize(kind, rows.map((r) => r.values[key]), def.summaries), resolve)}</span>
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
            path={rowMenu.record.path}
            title={rowMenu.record.title}
            onOpen={onOpenFile}
            onOpenRight={onOpenFileRight}
            onOpenBackground={onOpenFileBackground}
            onOpenWindow={onOpenWindow}
            onNotice={onNotice}
            onClose={() => setRowMenu(null)}
            extra={[
              <FillMenu
                key="fill"
                start={cellFillOf(fills, rowMenu.record.path, rowMenu.column)}
                onFill={(target, fill) => onUpdate((d) => setViewFill(d, viewIndex, rowMenu.record, target === 'cell' ? rowMenu.column : undefined, fill, records, resolveLink))}
                onClose={() => setRowMenu(null)}
              />,
              // Row freeze (YAZ-4537), the column menu's pair: on the row where the freeze ends the item reads ✓ and a click unfreezes.
              <FreezeRowItems
                key="freeze"
                row={rowMenu.r}
                frozen={frozenRows}
                onFreeze={(count) => {
                  setRowMenu(null)
                  onUpdate((d) => {
                    if (count === 0) delete d.views[viewIndex].frozenRows
                    else d.views[viewIndex].frozenRows = count
                  })
                }}
              />,
            ]}
          />
        )}
        {headerMenu !== null && (
          <TableHeaderMenu
            x={headerMenu.x}
            y={headerMenu.y}
            columnKey={headerMenu.key}
            def={def}
            viewIndex={viewIndex}
            keys={keys}
            takenKeys={() => allPropertyKeys(def, view, records, settings.columns)}
            records={records}
            properties={properties}
            folder={{ settings, setColumn, deleteColumn, valueCount }}
            onUpdate={onUpdate}
            declareColumn={declareColumn}
            onDeleteColumn={deleteColumn && setConfirmDelete}
            onClose={() => setHeaderMenu(null)}
          />
        )}
        {confirmDelete !== null && deleteColumn && (
          <ConfirmDeleteColumn
            columnKey={confirmDelete}
            def={def}
            count={valueCount}
            onCancel={() => setConfirmDelete(null)}
            onConfirm={() => {
              const gone = confirmDelete
              setConfirmDelete(null)
              void deleteColumn(gone)
            }}
          />
        )}
      </div>
    </>
  )
}

/** "Freeze up to this row" / "✓ Frozen up to this row" and "Unfreeze rows" (YAZ-4537): `row` is the data row index, `frozen` the saved count. */
function FreezeRowItems({ row, frozen, onFreeze }: { row: number; frozen: number; onFreeze: (count: number) => void }) {
  const here = frozen === row + 1
  return (
    <>
      <button type="button" className="ctx-menu__item" role="menuitem" disabled={!here && row >= MAX_FROZEN_ROWS} title={!here && row >= MAX_FROZEN_ROWS ? `At most ${MAX_FROZEN_ROWS} rows freeze` : undefined} onClick={() => onFreeze(here ? 0 : row + 1)}>
        {here ? '✓ Frozen up to this row' : 'Freeze up to this row'}
      </button>
      <button type="button" className="ctx-menu__item" role="menuitem" disabled={frozen === 0} onClick={() => onFreeze(0)}>
        Unfreeze rows
      </button>
    </>
  )
}
