import { type CSSProperties, type DragEvent as ReactDragEvent, type FocusEvent as ReactFocusEvent, Fragment, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { headerRowAttrs, IMAGE_SIZE_DEFAULT, type IndexRecord, type PropertiesResponse } from '@shared/types'
import { type ViewSet, type ViewDef, type Mutate, shownGroupLevels, groupDepthOf, groupIndentOf, groupLineStyleOf, groupLinesOf, headerRowOfView, MAX_GROUP_INDENT_LEVELS, MAX_GROUP_LEVELS } from '../viewSchema'
import { type GroupSpan, groupLinesHover, groupSpans, groupThread, holdersOf, measureGroupGuides, stuckDistance, windowedGuide, windowedLine } from './groupGuides'
import { belongsToTitles, cellLinkCandidates } from '../../links/folderLinks'
import { type Group, type Row, propertyKeys, propertyLabel } from '../engine'
import { type Resolver, type Value, fromYaml, render, typeOf } from '../expr'
import { pageColumnKeys, type ColumnDecl, type FolderSettings } from '../folderSettings'
import { BUILTIN_SUMMARIES, summarize } from '../summaries'
import { cellEditor, columnTyping } from '../editorType'
import { fillSeries } from '../../editor/table/fillSeries'
import { CUT_CARD_DWELL_MS, cardShell, cellHoverCards, textPart } from '../../editor/table/cellHoverCard'
import { type HistoryStep, type ValueHistory, inBatches, noteRef } from './valueHistory'
import { isPairWritten, type PairWritten } from '../relationPair'
import { ConfirmSheet } from '../../components/ConfirmSheet'
import { edgeScroller } from '../../lib/edgeScroll'
import { flushSync } from 'react-dom'
import { EditableCell } from './EditableCell'
import { canonicalKey } from './keys'
import { GroupHeader, ViewFolder, rowCell, rowTitle, summaryKindOf } from './GroupHeader'
import { type GroupDrop, type GroupSpot, type GroupSwap, TOP_SPOT, chainLevels, childSpot, groupByKey, groupTakesNew, spotKey, useGroupDrag } from './groupDrag'
import { Popover } from './Popover'
import type { ResolveLink } from '../../editor/wikilink/wikilinkPlugin'
import { cssZoom } from '../../lib/cssZoom'
import { holdColResize } from '../../lib/colResize'
import { pinnedHeaderOffset, verticalScrollParent } from '../../lib/pinnedHeader'
import { openByGesture, openByKey } from '../../lib/openGesture'
import { newWindowClick } from '../../lib/newWindowClick'
import { isFolderRow, rowPage } from '../../links/shortcuts'
import { MAX_FROZEN_ROWS, UNFROZE_ROWS, frozenColumnCount, frozenGapCover, frozenGapShadow, type FrozenGapCover } from './frozenColumns'
import { PageContextMenu } from './PageContextMenu'
import { OtherFilesMove, trayRowDrag } from './otherFilesMove'
import { FillMenu, type FillTarget } from './FillMenu'
import { deleteNoteItem, duplicateNoteItem, FilterValueParent } from './rowMenuItems'
import { withFilter } from './filterRows'
import { cellFillOf, fillIndex, fillPaint, setViewFill, setViewFills } from './fills'
import { columnFillOf, setColumnFill } from './columnFill'
import { ClearFormattingItem, SelectionMenu } from './SelectionMenu'
import { ALL_CELLS, type Pick, type TableSelection, cellRange, farCorner, indicesOf, inSelection, parseTsv, pickLine, stepRange, toTsv, valueFromText } from './tableSelection'
import type { PropertyWrite } from '../writeProperty'
import { TableHeaderMenu, wrapKind, wrapsColumn } from './TableHeaderMenu'
import { alignClass, columnAlignOf } from './columnAlign'
import { textInCellsOf } from './TableLookSettings'
import { useViewDefaults } from '../viewDefaults'
import { orderOf } from './DirectionPicker'
import { TextField } from './TextField'
import { ConfirmDeleteColumn } from './ConfirmDeleteColumn'
import { ColumnMark, columnMark } from './ColumnMark'
import { HoverTip } from '../../components/HoverTip'
import { FileFieldIcon, FormulaIcon } from './icons'
import { PROPERTY_LABELS, PropertyTypeIcon } from './PropertyDefinitionEditor'
import { partTransform } from '../../lib/liveGap'
import { useLiveGapReorder } from '../../lib/useLiveGapReorder'
import { allPropertyKeys } from './properties'
import { setViewOrder } from './columnOrder'
import { NO_READ_ONLY, READ_ONLY_TIP, writableKey } from '../readOnlyRows'
import { ReadOnlyName } from './ReadOnlyMark'
import type { ViewHover } from './viewHover'
import type { FolderHost } from '../ViewsPane'
import type { NoteWindowLink } from './NoteWindow'
import { ViewFind } from './viewFind'
import { CHANGE_CANCELLED, type ChangeAsk, type ConfirmChange } from '../confirmChanges'
import { clipboardImage, imageValue, saveImageFile } from './imageCell'
import { imageFile } from '../../editor/image/insertImage'

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
  /** The row menu's "Open in mini window" (YAZ-4547, D57) and ⇧Enter on any cell (YAZ-4605 D56): the card over the folder page. Absent: neither. */
  onOpenWindow?: (path: string) => void
  /** The card's link (YAZ-4547 D16): the table hands it its rows in display order, and marks the card's row. */
  windowLink?: NoteWindowLink
  /** Passive reporting for a stale or failed OS action. */
  onNotice?: FolderHost['onNotice']
  /** A drop on another section: `groupBy.property = value` (undefined deletes) via ViewsPane (5C, GRO-2143); `drop` says which LEVEL, and carries the outer's write on a cross-outer inner drop (YAZ-1101). */
  onMoveToGroup: (path: string, value: unknown, swap?: GroupSwap, drop?: GroupDrop) => void
  /** The last failed move, flagged inline on its row. */
  moveError: { path: string; message: string } | null
  /** Create a note seeded with a section's group value (5D, GRO-2144); absent → no "+" on headers and no "+ New" row. `at` places the section for the level-aware seed (YAZ-1101). null: the ungrouped table's "+ New" row (YAZ-4539). */
  onNewInGroup?: (group: Group | null, name?: string, at?: GroupSpot) => void
  /** "Show New buttons" (YAZ-3746 13BL): false drops the "+ New" rows and the group headers' "+"; the row menu's New row below and the header menu's New note in this group stay. */
  newRows?: boolean
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
  declareColumn: (columns: Record<string, ColumnDecl>, views?: ViewDef[]) => void
  /** `FolderHost.deleteColumn` (YAZ-1513): the header menu's "Delete column…", confirm-first. Absent → the menu has no such item. */
  deleteColumn?: FolderHost['deleteColumn']
  /** `FolderHost.addColumn` (YAZ-4772): Edit column's "Add to <folder>" on a ◌ field. */
  addColumn?: FolderHost['addColumn']
  /** `FolderHost.sources` (YAZ-4713 C6, C7, C11): the header icons, Edit column's owner line, and which columns may be deleted here. */
  sources: FolderHost['sources']
  /** `FolderHost.valueCount`: the number that confirm states. */
  valueCount: (key: string) => number
  /** `FolderHost.separate` (YAZ-4713 C3): Edit column's "Separate value for <folder>". Absent where the vault does not use IDs. */
  separate?: FolderHost['separate']
  /** Both ways for a link column (YAZ-4781 R1): Edit column's door. */
  relation?: FolderHost['relation']
  /** A cell's commit: one value of one row, through the host's writer (`FolderHost.writeValues`). */
  onWriteValue: (path: string, key: string, value: unknown) => Promise<unknown>
  /** A bulk write on a selection (YAZ-4593): several values of one note in ONE guarded write, `FolderHost.writeValues`. */
  onWriteValues: FolderHost['writeValues']
  /** The read-only notes (YAZ-3076 D6): their cells open no editor and their cards do not move. Absent = none. */
  readOnly?: ReadonlySet<string>
  /** The Name cell's commit (YAZ-2420 🔒 D19): the row's new title, through `FolderHost.retitle`. */
  onRetitle: (path: string, title: string) => void
  /** Confirm changes (YAZ-3746 13AN): asked before a typed cell or a bulk write; absent where the page does not ask. */
  confirmChange?: ConfirmChange
  /** The app's own keys in this vault (`reservedKeys`): the header's "Add column" refuses them (YAZ-4544). */
  reservedKeys: ReadonlySet<string>
  /** The row menu's "Duplicate note" (YAZ-4592 S26): `FolderHost.duplicate`; the selection menu's "Duplicate notes" calls it once per note (YAZ-4593). Absent: no such item, and that one is off. */
  onDuplicateNote?: (path: string) => void
  /** "Delete note…" (YAZ-4592 S26): ViewsPane's `confirmDeleteNotes`, which asks first unless the setting is off; the selection menu's "Delete notes…" too (YAZ-4593). Absent: no such item, and that one is off. */
  onDeleteNotes?: (paths: readonly string[]) => void
  /** The folder page's ⌘Z / ⇧⌘Z history of value changes (YAZ-4612 S41, `valueHistory.ts`). Absent: no history. */
  history?: ValueHistory
  /** The toolbar's selection chip (S46): the table writes Count, Sum and Average into it on the DOM, so it renders nothing. */
  selectionChip?: { current: HTMLElement | null }
  /** "New row below" (YAZ-4611 D63): ViewsPane's seeded create; resolves the new note's path. Absent: no such item. */
  onNewRowBelow?: (row: Row, group: Group | null, at: GroupSpot | null) => Promise<string>
}

const DEFAULT_WIDTH = 150
/** The narrowest a text column goes (YAZ-4819: 40px, was 60px); a header name may clip there. */
const MIN_WIDTH = 40
/** Auto-fit's ceiling (YAZ-4590 S20): a long value does not make a column wider than this. */
const MAX_FIT_WIDTH = 600
/** The Name cell's room for the title that its group indent leaves (YAZ-4544): 60px of title and the cell's two 8px paddings. */
const NAME_TITLE_ROOM = 60 + 2 * 8
/**
 * The first column's room for its value beside the DEEPEST group indent (YAZ-3746 13AL): 120px and the two paddings.
 * A grouped table's first column STARTS at every level's indent plus this, so a deep row sits under its group and its
 * value still reads. A width the user set always wins (YAZ-4819); `nameIndent` shrinks the indent to fit it.
 */
const INDENT_VALUE_ROOM = 120 + 2 * 8
/** The Fill flyouts (YAZ-3746 13AQ): whole columns fill a cell or the column; one cell or a range, all three. */
const COLUMN_FILLS: readonly FillTarget[] = ['cell', 'column']
const ALL_FILLS: readonly FillTarget[] = ['cell', 'row', 'column']
/** A bulk write's ask (YAZ-3746 13AS): its header and its go button, by the gesture. */
const BULK_ASK: Readonly<Record<string, readonly [string, string]>> = { Clear: ['Clear cells', 'Clear'], 'Paste into': ['Paste', 'Paste'], Fill: ['Fill', 'Fill'], Set: ['Set value', 'Set'] }
/** `view.rowHeight` presets (Obsidian's names); the value feeds `--view-table-row-h` AND the windowing maths. */
const ROW_HEIGHTS: Record<string, number> = { short: 28, medium: 44, tall: 68 }
/** Above this many lines only a scroll-positioned slice is mounted, padded by spacer rows. */
const WINDOW_AT = 500
const OVERSCAN = 10
/** jsdom and the pre-measure first render have no viewport height; assume one screen. */
const FALLBACK_VIEWPORT = 600
/** The `#` gutter's fixed width (YAZ-1513): always the first, always-sticky column; frozen offsets start after it. */
const GUTTER_WIDTH = 44
/** With row numbers hidden, the `#` gutter stays as a slim strip with no numbers: the row's select and drag handle (YAZ-4610 D62). */
const SLIM_GUTTER_WIDTH = 12
/** The header drag's own payload (YAZ-1548) — `ViewTabs`' `VIEW_TAB_MIME` idiom; never `text/plain`, so a stray text drop is not a reorder. */
const COLUMN_MIME = 'application/x-yaseen-table-column'
/** The row of the note the note window shows (YAZ-4547). */
const CURRENT_ROW = 'view-table__row--current'
/**
 * ...and the frozen lines stop here (YAZ-4544): at most, each row brings a header for each level and its own
 * "+ New" row (YAZ-4539), so 10 rows always fit, at the deepest grouping (`MAX_GROUP_LEVELS`) with one row in each group.
 */
const MAX_FROZEN_LINES = MAX_FROZEN_ROWS * (MAX_GROUP_LEVELS + 2)
/** A selected cell, row number or header (YAZ-4593): an attribute React does not own, so a render never drops it. */
const SELECTED = 'data-selected'
/** A bulk write, planned (YAZ-4593): each note's writes, its values before them, and the number of cells that change. */
interface WritePlan {
  byPath: Map<string, PropertyWrite[]>
  before: Map<string, PropertyWrite[]>
  count: number
}
/** More notes than this in one bulk write show a progress note (YAZ-4612 S48). */
const PROGRESS_AT = 20
/** Clearing more cells than this asks first (S49). */
const CONFIRM_CLEAR_AT = 50
/** The most (note, key) pairs `lastWritten` keeps while the index catches up (YAZ-4637 T4). */
const LAST_WRITTEN_MAX = 500
/** The editors a typed letter opens with that letter in them (YAZ-4612 S42): a field. A box, a choice or a date picker opens by Enter. */
const TYPE_KINDS = new Set(['text', 'number', 'link', 'list', 'multi-link'])
/** The step of each arrow key for ⇧+arrow (YAZ-4603 D53): rows, then columns. */
const STEPS: Record<string, [number, number] | undefined> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
/**
 * The last ⌘C of any table (YAZ-4636 T9c): the readable text it put on the clipboard, and each cell's value as stored
 * (`sourceText`). A ⌘V whose clipboard text is that text pastes the stored values, so an id link stays `[[id]]`. One
 * copy at most; a copy from another app does not match, and parses as text.
 */
let lastCopy: { text: string; raw: string[][] } | null = null

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

/** A clipped cell's tooltip (YAZ-4582 D29): its whole value as text; none for a checkbox or an empty cell. */
const clipTitle = (v: Value, resolve: Resolver | undefined): string | undefined => (typeof v === 'boolean' ? undefined : render(v, resolve) || undefined)

/**
 * A cell's content width in CSS px (YAZ-4590 S20): its side borders and paddings (the cells are border-box, YAZ-4871)
 * plus each child's natural width and side margins
 * (YAZ-4871: a header's icons stand apart by margins, so without them the name shows "…"). A text node is measured by a Range;
 * an element by its scroll width, which a `max-width: 100%` box keeps past its clip, or by the widest element inside it,
 * which may clip on its own (a text cell's button, YAZ-4892). The resize edge is absolutely placed, so it does not count.
 * Once per double-click, over the mounted rows only.
 */
function contentWidth(cell: HTMLElement, zoom: number): number {
  const style = getComputedStyle(cell)
  let width = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0) + (parseFloat(style.borderLeftWidth) || 0) + (parseFloat(style.borderRightWidth) || 0)
  for (const node of cell.childNodes) {
    if (node instanceof HTMLElement) {
      if (node.classList.contains('view-table__resize')) continue
      const childStyle = getComputedStyle(node)
      let natural = Math.max(node.scrollWidth, node.getBoundingClientRect().width / zoom)
      for (const inner of node.querySelectorAll<HTMLElement>('*')) if (inner instanceof HTMLElement) natural = Math.max(natural, inner.scrollWidth)
      width += natural + (parseFloat(childStyle.marginLeft) || 0) + (parseFloat(childStyle.marginRight) || 0)
    } else if (node.nodeType === Node.TEXT_NODE) {
      const range = document.createRange()
      range.selectNodeContents(node)
      width += range.getBoundingClientRect().width / zoom
    }
  }
  return width
}

/** YAZ-4867: is this clipped cell's text really cut? The cell, its display span or its chip row is wider inside than out. */
function cellIsCut(cell: HTMLElement): boolean {
  const boxes = [cell, ...cell.querySelectorAll<HTMLElement>('.view-cell-edit__display, .property-choice-chips')]
  return boxes.some((box) => box.scrollWidth > box.clientWidth + 1)
}

/**
 * A clipped cell's full value shows on hover ONLY when its text is really cut (YAZ-4867, amends YAZ-4582 D29): the value
 * waits in `data-clip-title`, and one check on the hover says whether the cell gets a card. Nothing is measured at
 * render. The card is the note table's full-text card (YAZ-4901, `cellHoverCard.ts`: its look, place, 250 ms wait, warm
 * run and closes), not the macOS tooltip; a Wrap column's cell has no value waiting (YAZ-4895), so no card.
 */
function cutCellCard(cell: HTMLElement): { box: HTMLElement; dwell: number; under: boolean } | null {
  const full = cell.dataset.clipTitle
  if (full === undefined || !cellIsCut(cell)) return null
  const box = cardShell()
  // YAZ-4903: the card's text is the cell's own size (a folder page cell's text is smaller than the card's 12.5px).
  box.style.fontSize = getComputedStyle(cell.querySelector<HTMLElement>('.view-cell-edit__display') ?? cell).fontSize
  box.appendChild(textPart([full]))
  return { box, dwell: CUT_CARD_DWELL_MS, under: true }
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
export function TableView({ def, view, viewIndex, records, rows, groups, collapsed, onToggleGroup, onUpdate, onOpenFile, onOpenFileRight, onOpenFileBackground, onOpenWindow, windowLink, onNotice, onMoveToGroup, moveError, onNewInGroup, newRows = true, root, properties = null, settings, vaultRecords, vaultFolders, resolve, resolveLink, setColumn, declareColumn, deleteColumn, addColumn, sources, valueCount, separate, relation, onWriteValue, onWriteValues, onRetitle, onDeleteNotes, onDuplicateNote, onNewRowBelow, history, selectionChip, reservedKeys, readOnly = NO_READ_ONLY, hover, confirmChange }: TableViewProps) {
  /**
   * YAZ-4799: the deepest Folder group a row line is drawn in (its group and the groups above it), or null: a shortcut's
   * copy under its second folder wears ↗ there, its home copy none. The page folder otherwise (`ViewFolder`).
   */
  const viewFolder = useContext(ViewFolder)
  const folderLevels = shownGroupLevels(view)
  const folderGroupOf = (at: GroupSpot | null, g: Group | null): string | null => {
    if (at === null || g === null) return null
    let out: string | null = null
    const chain = [...at.ancestors, g]
    // By each group's view level (YAZ-4918): a nested Folder level's groups share one level.
    chainLevels(chain).forEach((i, n) => {
      const level = folderLevels[i]
      if (level !== undefined && canonicalKey(level.property) === 'file.folder' && typeof chain[n].key === 'string') out = chain[n].key as string
    })
    return out
  }
  /**
   * A line's indent step (YAZ-4918): its depth in the group tree, never past `MAX_GROUP_INDENT_LEVELS` (4), so a deep
   * folder tree does not push the table right. A header's depth is the groups above it; a row's one more.
   */
  const indentDepth = (depth: number): number => Math.min(depth, MAX_GROUP_INDENT_LEVELS)
  const [drag, setDrag] = useState<{ key: string; width: number } | null>(null)
  /**
   * The wrap's scroll width when a column resize starts, in px (YAZ-3746 13W), 0 when none is held. views.css draws a
   * zero-height runner that wide (`--view-table-slack`), so the scrollable width never SHRINKS while a column is dragged
   * narrower: with the table scrolled to its right end, a narrower table clamped `scrollLeft` and every column left of
   * the edge slid right under the mouse. The runner goes on release, so the scroll settles after the drag, not during.
   */
  const [slack, setSlack] = useState(0)
  /** A modified click on the Name cell and Enter on it share the one open rule (YAZ-1557): ⌘ background, ⌥ right, plain current. */
  const openHandlers = { onOpenFile, onOpenFileRight, onOpenFileBackground }
  /** The data row (`rowKey`) whose title is being edited in its Name cell (YAZ-2420 🔒 D26). */
  const [titleEdit, setTitleEdit] = useState<string | null>(null)
  // Row drag between sections (5C, GRO-2143); disabled without groups. One write key PER level
  // (YAZ-1101): a level that is not a note property takes no drops and shows no "+".
  const levelKeys = shownGroupLevels(view).map((_, level) => groupByKey(view, level, settings.columns))
  const dnd = useGroupDrag(groups === null ? [] : levelKeys, onMoveToGroup)
  /** The Other files tray's door (YAZ-4597): null unless the folder page's tray takes moves. */
  const moveToTray = useContext(OtherFilesMove)
  const [summaryFor, setSummaryFor] = useState<string | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  /**
   * The row right-click's menu: its record, the column key of the cell it was opened on (the fill target, YAZ-4536), its
   * data row index (the freeze target, YAZ-4537), and that cell's value (the filter's, YAZ-4592 S25).
   */
  /** The one-row menu (a cell's, or the row's `#` with `column` null: the whole row, YAZ-3746 13AI). */
  const [rowMenu, setRowMenu] = useState<{ x: number; y: number; record: IndexRecord; column: string | null; r: number; value: Value } | null>(null)
  /** The header's own menu (YAZ-1513): `key` null = the `#` gutter header. */
  const [headerMenu, setHeaderMenu] = useState<{ x: number; y: number; key: string | null } | null>(null)
  /** "Delete column…" awaiting its confirm (YAZ-1513). */
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  /**
   * The ancestor that scrolls the table vertically (YAZ-4636 T6): in a folder page the wrap takes the table's whole
   * height and the tab's scroller moves it (folderView.css), so the window is read off THAT scroller. Null when nothing
   * above the wrap scrolls: then the wrap is the scroller, as in any other host.
   */
  const scrollerRef = useRef<HTMLElement | null>(null)
  /** The scroller's listener hands each frame's scrolled distance here; set only while the table is windowed. */
  const windowScroll = useRef<((past: number) => void) | null>(null)

  useLayoutEffect(() => {
    const wrap = wrapRef.current
    if (wrap === null) return
    const scroller = verticalScrollParent(wrap)
    scrollerRef.current = scroller
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
      // Whole device pixels, as the table block does (YAZ-3788): a part of a pixel puts the frozen rows' edges off the
      // pixel grid, and a seam shows the rows under them (YAZ-4582). `floor`: the part goes under the scroller's top.
      const ratio = window.devicePixelRatio || 1
      const offset = Math.floor(pinnedHeaderOffset(scrollerTop, tableRect.top, tableRect.height, header.getBoundingClientRect().height) * ratio) / ratio / zoom
      wrap.style.setProperty('--view-table-header-y', `${offset}px`)
      // The same scroll moves the window (T6): how far the table is past the scroller's top, in the table's px.
      windowScroll.current?.(Math.max(0, (scrollerTop - tableRect.top) / zoom))
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

  const keys = useMemo(() => propertyKeys(def, view, records, pageColumnKeys(settings)), [def, view, records, settings])
  /** Each header's mark (YAZ-4713 C11): where the column comes from, or none; all none while the switch is off. */
  const marks = useMemo(
    () => keys.map((key) => {
      const c = canonicalKey(key)
      if (sources.marks === 'off' || !c.startsWith('note.')) return null
      const bare = c.slice('note.'.length)
      return columnMark(sources, bare, settings.columns[bare]?.separate === true)
    }),
    [keys, sources, settings],
  )
  const nameCol = keys.findIndex((k) => canonicalKey(k) === 'file.name')
  // per-column halves of the editor inference (5B, GRO-2142), over the view's shown rows;
  // memoised so scroll/drag re-renders skip the per-column row walk (7B, GRO-2148)
  const rowRecords = useMemo(() => rows.map((r) => r.record), [rows])
  const bares = useMemo(() => keys.map((key) => writableKey(key, settings.columns)), [keys, settings])
  const typings = useMemo(() => keys.map((k) => columnTyping(k, rowRecords, properties, settings)), [keys, rowRecords, properties, settings])
  /**
   * Each header's type icon and its words (YAZ-4779): the Columns list's icons — a file field, a formula, else the
   * column's kind. Once per keys and typings, never on a keystroke. Null while "Column type icons" is off.
   */
  const typeIcons = useMemo(
    () =>
      view.columnTypeIcons !== true
        ? null
        : keys.map((key, i): { icon: ReactNode; label: string } => {
            const c = canonicalKey(key)
            if (c.startsWith('file.')) return { icon: <FileFieldIcon />, label: 'File field' }
            if (c.startsWith('formula.')) return { icon: <FormulaIcon />, label: 'Formula' }
            const kind = settings.columns[c.slice('note.'.length)]?.kind ?? typings[i]?.assigned ?? typings[i]?.dominant ?? 'text'
            return { icon: <PropertyTypeIcon kind={kind} />, label: PROPERTY_LABELS[kind] }
          }),
    [view.columnTypeIcons, keys, typings, settings],
  )
  /** What the pickers resolve and complete over: the WHOLE vault, never the folder's rows alone (🔒 D2). */
  // The note editor's `[[` rows, notes and folders (YAZ-4601 D49).
  const titles = useMemo(() => cellLinkCandidates(vaultRecords, vaultFolders, resolveLink, root), [vaultRecords, vaultFolders, resolveLink, root])
  // Relation columns narrow the link picker to the notes in the FOLDER the target names
  // (YAZ-2290 D10: `belongsToTitles`); a target naming no folder falls back to all titles.
  const linkNames = useMemo(
    () => typings.map((t) => (t?.target !== undefined ? belongsToTitles(vaultRecords, vaultFolders, resolveLink, root, t.target) : null)),
    [typings, vaultRecords, vaultFolders, resolveLink, root],
  )
  const rowH = ROW_HEIGHTS[view.rowHeight ?? ''] ?? ROW_HEIGHTS.short
  // Text in cells (YAZ-4585, YAZ-4544 10A): a column with no Wrap or Clip of its own follows the view's, else Settings'. Row
  // height, row numbers and the view's Text in cells come in `view` already, with Settings filled in (`withDefaults`).
  const defaults = useViewDefaults()
  /** Each shown column's fill (YAZ-3746 13AQ), under the rows' and the cells' own. */
  const columnFills = keys.map((key) => columnFillOf(view, key))
  /** A grouped table's first column fits its deepest indent and a readable value (13AL); 0 when the view does not group. A nested Folder level counts its Depth (YAZ-4918). */
  const groupLevelCount = groupDepthOf(view)
  /**
   * The column that steps in under its groups (YAZ-3746 13AG): the FIRST shown column, Name or not, so a row sits under
   * its group's name even with Name hidden or moved (YAZ-4532 D10 indented only Name). An Image column is passed over
   * (YAZ-4802 demo: "i need to be able to go much smaller so i can just have the logo"): a picture column put first
   * keeps only its picture, aligned as set, and the next column takes the indent. All Image columns: the first one.
   */
  const firstText = typings.findIndex((t) => t?.assigned !== 'image')
  const indentCol = firstText < 0 ? 0 : firstText
  const indentFloor = groupLevelCount === 0 ? 0 : groupIndentOf(view) * groupLevelCount + INDENT_VALUE_ROOM
  /** The narrowest a column goes: an Image column down to its picture and the two paddings (YAZ-4802 demo), others 40px. */
  const minWidthOf = (c: number): number => {
    if (typings[c]?.assigned !== 'image') return MIN_WIDTH
    const bare = bares[c]
    return (bare === null ? IMAGE_SIZE_DEFAULT : (settings.columns[bare]?.size ?? IMAGE_SIZE_DEFAULT)) + 2 * 8
  }
  const widthOf = (key: string) => {
    const own = drag?.key === key ? drag.width : view.columnSize?.[key]
    if (own !== undefined) return own
    return key === keys[indentCol] ? Math.max(DEFAULT_WIDTH, indentFloor) : DEFAULT_WIDTH
  }
  const frozen = frozenColumnCount(view.frozenColumns, keys.length)
  const sorts = view.sort ?? []
  /** The `#` gutter shows its numbers unless the view says `rowNumbers: false` (YAZ-1513); then it is a slim strip (YAZ-4610 D62). */
  const numbered = view.rowNumbers !== false
  /** The gutter's bookkeeping, spelled once (YAZ-1549): its width, and the cells a full-width row spans. */
  const gutterWidth = numbered ? GUTTER_WIDTH : SLIM_GUTTER_WIDTH
  const span = keys.length + 1
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
  /**
   * That cell's indent in px (YAZ-4532 D10): one group indent per level above the row, but never more than the
   * column's width less the title's room (YAZ-4544), so a deep row in a narrow column still shows its value.
   */
  const nameIndent = (depth: number): number => Math.max(0, Math.min(groupIndentOf(view) * indentDepth(depth), widthOf(keys[indentCol]!) - NAME_TITLE_ROOM))
  /** A body cell's inline style: the frozen offset, a fill (YAZ-4536, painted by views.css) and the Name cell's group depth and indent (YAZ-4532 D10). */
  const cellStyle = (index: number, fill: string | undefined, depth: number | undefined): CSSProperties | undefined => {
    const base = frozenStyle(index)
    if (fill === undefined && depth === undefined) return base
    return { ...base, ...(fill !== undefined && { '--view-cell-fill': fillPaint(fill) }), ...(depth !== undefined && { '--depth': indentDepth(depth), '--view-name-indent': `${nameIndent(depth)}px` }) } as CSSProperties
  }
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
    if (onNewInGroup !== undefined && newRows) lines.push({ add: null, gk: '', at: undefined })
  } else {
    // Nested levels (YAZ-745, three since YAZ-4531): the merge rule's direct rows sit right under
    // their group, then one indented section per child — still ONE flat list, so windowing and nav are untouched.
    const walk = (list: readonly Group[], at: GroupSpot) => {
      for (const g of list) {
        const gk = spotKey(g, at)
        // A header's depth is its place in the tree (YAZ-4918), not its view level: a nested Folder group's child is one deeper on the same level.
        lines.push({ header: g, gk, depth: at.ancestors.length, at })
        n = 0
        if (collapsedSet.has(gk)) continue
        for (const row of g.children === undefined ? g.rows : g.direct ?? []) lines.push({ row, r: flat.push(row) - 1, n: ++n, g, gk, at })
        if (g.children !== undefined) walk(g.children, childSpot(g, at))
        // ...and ends each innermost section, where its header offers the "+" (YAZ-4539).
        else if (onNewInGroup !== undefined && newRows && groupTakesNew(view, at.level, settings.columns)) lines.push({ add: g, gk, at })
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
  /** The frozen lines by key: the measuring below runs again only when they change, never on a scroll's render. */
  const frozenKey = head.map((l) => ('add' in l ? `new:${l.gk}` : 'header' in l ? `group:${l.gk}` : rowKey(l))).join('\n')
  // The frozen rows stick under the header (YAZ-4537), each at the header's height plus the real heights of the
  // frozen lines above it: a wrapped row is taller than the row height (YAZ-4582 D29). Measured at mount and when the
  // header or a frozen line resizes, into `--view-table-head-h` and each line's `--view-frozen-top`; never on scroll.
  useLayoutEffect(() => {
    const wrap = wrapRef.current
    const header = wrap?.querySelector<HTMLElement>('.view-table thead')
    if (frozenKey === '' || wrap == null || header == null) return
    const frozenLines = [...wrap.querySelectorAll<HTMLElement>('.view-table tbody tr.view-table__row--frozen')]
    const measure = () => {
      const zoom = cssZoom(wrap)
      let top = header.getBoundingClientRect().height / zoom
      wrap.style.setProperty('--view-table-head-h', `${top}px`)
      for (const tr of frozenLines) {
        tr.style.setProperty('--view-frozen-top', `${top}px`)
        top += tr.getBoundingClientRect().height / zoom
      }
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(header)
    for (const tr of frozenLines) observer.observe(tr)
    return () => {
      observer.disconnect()
      wrap.style.removeProperty('--view-table-head-h')
      for (const tr of frozenLines) tr.style.removeProperty('--view-frozen-top')
    }
  }, [frozenKey])

  // windowing: mount only the slice around the scroll position, spacer rows keep the scrollbar honest.
  // The frozen lines always mount; the window starts below them (YAZ-4537).
  const windowed = lines.length > WINDOW_AT
  // Wrap or Clip per column (YAZ-4582 D29): a Wrap column's row grows, a Clip column is one line. With no choice, a
  // chip column wraps and the rest clip, as on `main`. A windowed table clips every cell, so each line is exactly the
  // row height its spacer maths counts.
  const clipped = keys.map((key, c) => windowed || !wrapsColumn(view, key, wrapKind(typings[c]), textInCellsOf(view, defaults)))
  // Left, Center or Right per column (YAZ-3746 13Y): the class its header, body cells and summary cell carry; none for Auto.
  const aligned = useMemo(() => keys.map((key) => alignClass(columnAlignOf(view, key))), [keys, view])
  /**
   * The height that shows the table (T6): the wrap's, or the scroller's where that is less — in a folder page the wrap
   * is as tall as the table, and the tab's scroller is the viewport. Zero (jsdom, the first render) falls back.
   */
  const viewportOf = (): number => {
    const wrap = wrapRef.current
    const scroller = scrollerRef.current
    const own = wrap?.clientHeight || Infinity
    const outer = wrap !== null && scroller !== null ? scroller.clientHeight / cssZoom(wrap) || Infinity : Infinity
    const h = Math.min(own, outer)
    return Number.isFinite(h) ? h : FALLBACK_VIEWPORT
  }
  /** A scroll's render (T6): the window steps by whole rows, so a scroll inside one row renders nothing. */
  const setPast = (past: number): void => setScrollTop(Math.floor(past / rowH) * rowH)
  windowScroll.current = windowed ? setPast : null
  /**
   * The wrap's own scroll (any other host): how far the table is past the top of the box that shows it. With a
   * scroller above, the table's place against it says so, the wrap's inner scroll included.
   */
  const scrolledPast = (wrap: HTMLElement): number => {
    const scroller = scrollerRef.current
    const table = wrap.querySelector('.view-table')
    if (scroller === null || table === null) return wrap.scrollTop
    const zoom = cssZoom(wrap)
    return Math.max(0, (scroller.getBoundingClientRect().top + scroller.clientTop * zoom - table.getBoundingClientRect().top) / zoom)
  }
  /** Scrolls the real scroller so the table is `past` px past its top (T5): the one way find, "New row below" and the note window move a windowed table. */
  const scrollPast = (past: number): void => {
    const wrap = wrapRef.current
    if (wrap === null) return
    const scroller = scrollerRef.current
    if (scroller === null) wrap.scrollTop = past
    else scroller.scrollTop += (past - scrolledPast(wrap)) * cssZoom(wrap)
    setPast(past)
  }
  /** The scroll that puts line `at` in the middle of the viewport. */
  const lineTop = (at: number): number => Math.max(0, at * rowH - (viewportOf() - rowH) / 2)
  const viewH = viewportOf()
  const first = windowed ? Math.max(pinned, Math.min(lines.length - 1, Math.floor(scrollTop / rowH) - OVERSCAN)) : pinned
  const count = windowed ? Math.min(lines.length - first, Math.ceil(viewH / rowH) + 2 * OVERSCAN) : lines.length - first
  const visible = lines.slice(first, first + count)
  /*
   * Where you are in a grouped table (YAZ-4798, `groupGuides.ts`): sticky group headers and group lines, each the
   * view's own choice or Settings › Folder pages'. An ungrouped table draws neither. Each header's span is worked out
   * here; a table that mounts every line measures the numbers views.css needs (below, never on a scroll), a windowed
   * one counts them, every line one row high.
   */
  const stickyGroups = groups !== null && view.stickyGroups === true
  const groupLines = groups === null ? 'off' : groupLinesOf(view)
  const threaded = groupLines !== 'off' && groupLineStyleOf(view) === 'thread'
  const guide = stickyGroups || groupLines !== 'off' ? groupSpans(lines.map((l) => ('header' in l ? l.depth : null)), pinned) : null
  const spanAt = new Map<number, GroupSpan>(guide?.spans.map((s) => [s.at, s]))
  const holderRef = useRef<Int32Array>(new Int32Array(0))
  holderRef.current = guide?.holder ?? new Int32Array(0)
  /** What the measuring reads: the lines, the frozen ones and the row height; a change measures again. */
  const guideKey = guide === null || windowed ? '' : `${pinned}:${rowH}:${stickyGroups}:${groupLines}\n${lines.map((l) => ('add' in l ? `new:${l.gk}` : 'header' in l ? `group:${l.gk}` : rowKey(l))).join('\n')}`
  /**
   * A windowed table mounts only the lines in view (T6): the headers of the groups the window starts in would go with
   * the lines above it, and their stuck copies with them. So they mount under the frozen rows, in place of as much of
   * the top spacer, and stick from there.
   */
  const lifted = windowed && stickyGroups && guide !== null ? holdersOf(guide.holder, first).filter((h) => h >= pinned && h < first).reverse() : []
  // YAZ-4798: the measuring, at mount and whenever the table resizes (a row wraps, a column widens); never on a scroll.
  useLayoutEffect(() => {
    const table = wrapRef.current?.querySelector<HTMLTableElement>('.view-table')
    if (guideKey === '' || guide === null || table == null) return
    const { spans } = guide
    const measure = () => void measureGroupGuides(table, spans, pinned, rowH)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(table)
    return () => observer.disconnect()
    // `guideKey` says everything the measuring reads, as `frozenKey` does above.
  }, [guideKey])
  // A windowed table's lines count from under the column header, which this measures (its height changes with a resize only).
  const windowedLines = windowed && groupLines !== 'off'
  useLayoutEffect(() => {
    const table = wrapRef.current?.querySelector<HTMLTableElement>('.view-table')
    const header = table?.tHead
    if (!windowedLines || table == null || header == null) return
    const measure = () => table.style.setProperty('--view-group-head', `${header.offsetHeight}px`)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(header)
    return () => {
      observer.disconnect()
      table.style.removeProperty('--view-group-head')
    }
  }, [windowedLines])
  // On hover: the lines show while the pointer is over the table (`groupLinesHover`); Thread: the path to the row under it.
  useEffect(() => {
    const table = wrapRef.current?.querySelector<HTMLElement>('.view-table')
    return groupLines === 'hover' && table != null ? groupLinesHover(table) : undefined
  }, [groupLines])
  useEffect(() => {
    const table = wrapRef.current?.querySelector<HTMLElement>('.view-table')
    return threaded && table != null ? groupThread(table, () => holderRef.current) : undefined
  }, [threaded])
  // The cut cells' cards (YAZ-4867, YAZ-4901): one controller, fed by one delegated `mouseover` (a `closest` per cell
  // change) and the wrap's `mouseleave`; nothing per cell, nothing on a key.
  useEffect(() => {
    const wrap = wrapRef.current
    if (wrap === null) return
    const cards = cellHoverCards(cutCellCard)
    const over = (e: MouseEvent) => cards.enter(e.target instanceof Element ? e.target.closest<HTMLElement>('td') : null)
    const leave = () => cards.enter(null)
    wrap.addEventListener('mouseover', over)
    wrap.addEventListener('mouseleave', leave)
    return () => {
      wrap.removeEventListener('mouseover', over)
      wrap.removeEventListener('mouseleave', leave)
      cards.destroy()
    }
  }, [])
  /** A click on a stuck group header (not on its toggle, its value or its "+"): back to the top of that group (YAZ-4798). */
  const backToGroupTop = (e: ReactMouseEvent<HTMLTableCellElement>): void => {
    const wrap = wrapRef.current
    const scroller = scrollerRef.current
    const tr = e.currentTarget.parentElement
    if (wrap === null || scroller === null || tr === null || !(e.target instanceof Element)) return
    if (e.target.closest('button, a, input, textarea, select, [contenteditable="true"]') !== null) return
    const distance = stuckDistance(wrap, tr)
    if (distance > 0.5) scroller.scrollTop -= distance * cssZoom(wrap)
  }
  /** The roving-tabindex entry: the first data row in the mounted lines. */
  const firstDataRow = [...head, ...visible].find((l): l is Extract<Line, { row: Row }> => 'row' in l)?.r
  // The note window (YAZ-4547 D16): the rows it steps through, read at its step, and the mark of its row. A step writes
  // the mark on the DOM, so the table does not render for it; a render of the table draws the same mark from `current`.
  const wroteRows = useRef<readonly Row[]>(flat)
  wroteRows.current = flat
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
        // Windowed out of the mounted slice: scroll to the row's line, which mounts it.
        const at = lines.findIndex((l) => 'row' in l && l.row.record.path === current)
        if (at !== -1) scrollPast(lineTop(at))
      }
    }
  }
  useEffect(
    () => () => {
      // Only the table's own rows (YAZ-4547 D24): on a switch of view tab the next view wrote the link in its render.
      if (windowLink === undefined || windowLink.rows !== wroteRows.current) return
      windowLink.rows = []
      windowLink.show = () => {}
    },
    [windowLink],
  )
  // ⌘F (YAZ-4613, D64): a match off a windowed table's mounted slice — scroll to its line, which mounts it. Written at
  // each render, as the note window's link is; find marks the cell once it mounts.
  const find = useContext(ViewFind)
  if (find !== null)
    find.scrollTo = (path) => {
      const at = lines.findIndex((l) => 'row' in l && l.row.record.path === path)
      if (!windowed || at === -1) return
      scrollPast(lineTop(at))
    }

  /**
   * "New row below" (YAZ-4611 D63): the new note's path until its row shows; then its Name cell goes into title edit
   * (Enter retitles, Esc keeps "Untitled") and, in a windowed table, the scroll moves to its line. One path at most.
   */
  const newRowRef = useRef<string | null>(null)
  const [, showNewRow] = useState(0)
  useEffect(() => {
    const path = newRowRef.current
    if (path === null) return
    const at = lines.findIndex((l) => 'row' in l && l.row.record.path === path)
    if (at === -1) return
    newRowRef.current = null
    setTitleEdit(rowKey(lines[at] as Extract<Line, { row: Row }>))
    if (windowed) scrollPast(lineTop(at))
  })
  /** The item's action on data row `r` (the right-clicked row, or a selection's last). */
  const newRowBelow =
    onNewRowBelow === undefined
      ? undefined
      : (r: number) => {
          const line = lines.find((l): l is Extract<Line, { row: Row }> => 'row' in l && l.r === r)
          if (line === undefined) return
          onNewRowBelow(line.row, line.g, line.at).then(
            (path) => {
              newRowRef.current = path
              showNewRow((n) => n + 1)
            },
            () => {},
          )
        }

  const startResize = (key: string) => (e: ReactMouseEvent) => {
    // The left button only (YAZ-3719 1B): a right press's release can go to the native menu and never come.
    if (e.button !== 0) return
    e.preventDefault()
    const start = widthOf(key)
    const x0 = e.clientX
    const zoom = cssZoom(e.currentTarget)
    let width = start
    // The scrollable width holds for the whole drag (13W): only the dragged column's edge moves.
    setSlack(wrapRef.current?.scrollWidth ?? 0)
    const move = (ev: MouseEvent) => {
      width = Math.max(minWidthOf(keys.indexOf(key)), start + (ev.clientX - x0) / zoom)
      setDrag({ key, width })
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      holdColResize(false)
      setDrag(null)
      setSlack(0)
      if (width !== start)
        onUpdate((d) => {
          d.views[viewIndex].columnSize = { ...d.views[viewIndex].columnSize, [key]: width }
        })
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    holdColResize(true)
  }

  /**
   * Auto-fit (YAZ-4590 S20): a double-click on the resize edge sets the column's width to its widest shown content,
   * the header and the MOUNTED rows' cells, measured once here (no observer), clamped to 40–600 (YAZ-4819). ONE write.
   */
  const autoFit = (key: string, c: number) => (e: ReactMouseEvent<HTMLElement>) => {
    const th = e.currentTarget.closest('th')
    const wrap = wrapRef.current
    if (th === null || wrap === null) return
    const zoom = cssZoom(th)
    const cells = [th, ...wrap.querySelectorAll<HTMLElement>(`tbody td[data-cell$=":${c}"]`)]
    const widest = Math.max(...cells.map((cell) => contentWidth(cell, zoom)))
    // Up, never down: a width a fraction under the content cuts it to "…" (YAZ-4871).
    const width = Math.ceil(Math.min(MAX_FIT_WIDTH, Math.max(minWidthOf(c), widest)))
    if (width !== widthOf(key))
      onUpdate((d) => {
        d.views[viewIndex].columnSize = { ...d.views[viewIndex].columnSize, [key]: width }
      })
  }

  /** The sort arrow's click (YAZ-4590 S19): that rule's direction flips; its `by` stays. */
  const flipSort = (at: number) =>
    onUpdate((d) => {
      const sort = d.views[viewIndex].sort!
      sort[at] = { ...sort[at], direction: sort[at].direction === 'DESC' ? 'ASC' : 'DESC' }
    })

  const setSummary = (key: string, kind: string | null) =>
    onUpdate((d) => {
      const v = d.views[viewIndex]
      const s = { ...v.summaries }
      for (const k of Object.keys(s)) if (canonicalKey(k) === canonicalKey(key)) delete s[k]
      if (kind !== null) s[key] = kind
      if (Object.keys(s).length) v.summaries = s
      else delete v.summaries
    })

  /**
   * The selection (YAZ-4593, S27 / S28): in a ref, and marked on the mounted cells by `paintSelection` as
   * `data-selected`, an attribute React does not own. A change of selection renders nothing, so a drag across 600
   * rows draws no cell again; a render (a scroll that mounts rows) marks the cells again in one pass.
   */
  const selRef = useRef<TableSelection | null>(null)
  /** Whether a mark may be on the DOM: with none and no selection, a render skips the pass. */
  const painted = useRef(false)
  /** The selection's right-click, with the selection it was opened on and the notes it held then (YAZ-4636 T7). */
  /** The selection's menu; `r` is the row the right-click was on, for its row freeze (YAZ-3746 13AI). */
  const [selMenu, setSelMenu] = useState<{ x: number; y: number; sel: TableSelection; paths: string[]; r?: number } | null>(null)
  const paintSelection = (): void => {
    const wrap = wrapRef.current
    const sel = selRef.current
    if (wrap === null || (sel === null && !painted.current)) return
    painted.current = sel !== null
    for (const td of wrap.querySelectorAll<HTMLElement>('tbody td[data-cell]')) {
      const [r, c] = td.dataset.cell!.split(':').map(Number)
      td.toggleAttribute(SELECTED, sel !== null && inSelection(sel, r, c))
    }
    for (const td of wrap.querySelectorAll<HTMLElement>('tbody td[data-row]')) td.toggleAttribute(SELECTED, sel?.kind === 'rows' && sel.rows!.has(Number(td.dataset.row)))
    for (const th of wrap.querySelectorAll<HTMLElement>('thead th[data-col]')) th.toggleAttribute(SELECTED, sel?.kind === 'cols' && sel.cols!.has(Number(th.dataset.col)))
  }
  /**
   * The rows the selection was made over (YAZ-4636 T7): a selection is by row index, so after a re-sort or an outside
   * change that moves rows it would mark other notes. It goes instead; a change that keeps the order (by path) keeps it.
   */
  const selRows = useRef<readonly Row[]>(flat)
  useLayoutEffect(() => {
    const prev = selRows.current
    selRows.current = flat
    if (selRef.current === null || prev === flat) return
    if (prev.length !== flat.length || prev.some((row, i) => row.record.path !== flat[i].record.path)) setSelection(null)
  })
  useLayoutEffect(paintSelection)
  /**
   * The toolbar chip (YAZ-4612 S46): with two or more cells selected, Count (the cells with a value), and Sum and
   * Average when some are numbers. Written on the DOM, so a change of selection still renders nothing.
   */
  const showStats = (): void => {
    const chip = selectionChip?.current
    if (chip == null) return
    const sel = selRef.current
    const area = sel === null ? null : areaOf(sel)
    if (area === null || area.rows.length * area.cols.length < 2) {
      chip.hidden = true
      return
    }
    let count = 0
    let sum = 0
    let numbers = 0
    for (const r of area.rows)
      for (const c of area.cols) {
        const v = flat[r].values[keys[c]]
        if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) continue
        count++
        if (typeof v === 'number') {
          sum += v
          numbers++
        }
      }
    const round = (n: number) => String(Math.round(n * 100) / 100)
    chip.textContent = numbers === 0 ? `Count ${count}` : `Count ${count} · Sum ${round(sum)} · Average ${round(sum / numbers)}`
    chip.hidden = false
  }
  /**
   * ⌘C, ⌘V and Esc while the focus fell to the page (a windowed scroll unmounted the focused cell). Set only while
   * there is a selection. Hidden app tabs stay mounted and two folder pages can both hold a selection (YAZ-4636 T1), so
   * the table acts only while it is shown AND it owns the keys: the last press or focus was inside it (`claim`).
   */
  const pageKeys = useRef<{ keys: (e: KeyboardEvent) => void; claim: (e: Event) => void } | null>(null)
  const ownsKeys = useRef(false)
  const selectionKeyRef = useRef<(e: KeyboardEvent) => boolean>(() => false)
  const setSelection = (next: TableSelection | null): void => {
    selRef.current = next
    paintSelection()
    placeHandle()
    showStats()
    // A selection is made by a gesture in this table, so it owns the keys now.
    if (next !== null) ownsKeys.current = true
    if (next !== null && pageKeys.current === null) {
      const shown = () => wrapRef.current?.checkVisibility?.() !== false
      pageKeys.current = {
        keys: (e) => {
          if (!e.defaultPrevented && e.target === document.body && ownsKeys.current && shown() && selectionKeyRef.current(e)) e.preventDefault()
        },
        claim: (e) => {
          ownsKeys.current = e.target instanceof Node && wrapRef.current?.contains(e.target) === true
        },
      }
      document.addEventListener('keydown', pageKeys.current.keys)
      document.addEventListener('mousedown', pageKeys.current.claim, true)
      document.addEventListener('focusin', pageKeys.current.claim, true)
    } else if (next === null && pageKeys.current !== null) {
      dropPageKeys()
    }
  }
  const dropPageKeys = (): void => {
    if (pageKeys.current === null) return
    document.removeEventListener('keydown', pageKeys.current.keys)
    document.removeEventListener('mousedown', pageKeys.current.claim, true)
    document.removeEventListener('focusin', pageKeys.current.claim, true)
    pageKeys.current = null
  }
  useEffect(() => dropPageKeys, [])

  /** The `data-cell` of the cell an event is in, inside this table; null elsewhere. */
  const cellAt = (target: EventTarget | null): { r: number; c: number } | null => {
    const td = target instanceof Element ? target.closest<HTMLElement>('td[data-cell]') : null
    if (td === null || wrapRef.current?.contains(td) !== true) return null
    const [r, c] = td.dataset.cell!.split(':').map(Number)
    return { r, c }
  }
  const pickOf = (e: ReactMouseEvent): Pick => (e.shiftKey ? 'shift' : e.metaKey ? 'meta' : 'plain')
  /** A selection's rows and columns, or the focused cell `at` when there is no selection. */
  const areaOf = (sel: TableSelection | null, at?: { r: number; c: number }): { rows: number[]; cols: number[] } | null =>
    sel !== null ? { rows: indicesOf(sel.rows, flat.length), cols: indicesOf(sel.cols, keys.length) } : at === undefined ? null : { rows: [at.r], cols: [at.c] }

  /**
   * A press in the body (YAZ-4593): a row's `#` picks rows (⇧ extends, ⌘ adds or removes one); ⇧ on a cell selects the
   * range from the focused cell; a plain press clears the selection, and a drag from it selects the range it crosses.
   * A drag across cells selects in a grouped table too (YAZ-4603 D53): only the `#` cell is a row's drag source.
   */
  /** A press on the `#` of the only selected row (13T): its row, until the click that clears it. */
  const rowToggle = useRef<number | null>(null)
  const onBodyClick = (e: ReactMouseEvent<HTMLTableSectionElement>): void => {
    const r = rowToggle.current
    rowToggle.current = null
    if (r === null || !(e.target instanceof Element)) return
    const gutterCell = e.target.closest<HTMLElement>('td[data-row]')
    if (gutterCell !== null && Number(gutterCell.dataset.row) === r) setSelection(null)
  }
  const onBodyMouseDown = (e: ReactMouseEvent<HTMLTableSectionElement>): void => {
    if (e.button !== 0 || !(e.target instanceof Element)) return
    const gutterCell = e.target.closest<HTMLElement>('td[data-row]')
    if (gutterCell !== null) {
      // A movable row's `#` lets the press through, or no drag starts (D53); its click puts the focus back on the row.
      if (!gutterCell.draggable) e.preventDefault()
      const r = Number(gutterCell.dataset.row)
      // The row that already IS the selection (YAZ-3746 13T): the press keeps it, so a row drag still starts from it;
      // the click that follows with no drag clears it (`onBodyClick`). A drag fires no click.
      const now = selRef.current
      const plain = !e.shiftKey && !e.metaKey
      rowToggle.current = plain && now !== null && now.kind === 'rows' && now.rows?.size === 1 && now.rows.has(r) ? r : null
      if (rowToggle.current === null) setSelection(pickLine(selRef.current, 'rows', r, pickOf(e)))
      wrapRef.current?.querySelector<HTMLElement>(`[data-cell="${r}:0"]`)?.focus({ preventScroll: true })
      return
    }
    const at = cellAt(e.target)
    if (at === null || e.target.closest('[data-editing]') !== null) return
    if (e.shiftKey) {
      e.preventDefault()
      const sel = selRef.current
      setSelection(cellRange(sel?.kind === 'cells' ? sel.anchor : cellAt(document.activeElement) ?? at, at))
      return
    }
    setSelection(null)
    let last = at
    let pointer = { x: e.clientX, y: e.clientY }
    const extend = (target: EventTarget | null) => {
      const over = cellAt(target)
      if (over === null || (over.r === last.r && over.c === last.c)) return
      last = over
      setSelection(cellRange(at, over))
      window.getSelection()?.removeAllRanges()
    }
    // Near an edge the table scrolls by itself (YAZ-4612 S47), and the range follows the cell now under the pointer.
    const follow = () => extend(document.elementFromPoint?.(pointer.x, pointer.y) ?? null)
    const across = edgeScroller(() => wrapRef.current, follow)
    const down = edgeScroller(() => (wrapRef.current === null ? null : verticalScrollParent(wrapRef.current)), follow, 'y')
    const move = (ev: MouseEvent) => {
      pointer = { x: ev.clientX, y: ev.clientY }
      across.at(ev.clientX)
      down.at(ev.clientY)
      extend(ev.target)
    }
    const up = () => {
      across.stop()
      down.stop()
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }
  /** ⌘A and the corner cell (YAZ-4603 D53, YAZ-4610 D62): every shown cell; the focus goes to the first cell. False with no rows. */
  const selectAll = (): boolean => {
    if (flat.length === 0) return false
    setSelection(ALL_CELLS)
    if (!wrapRef.current?.contains(document.activeElement)) wrapRef.current?.querySelector<HTMLElement>('tbody td[data-cell]')?.focus({ preventScroll: true })
    return true
  }
  /**
   * A plain click on a header selects the column (YAZ-4610 D62); on the column that is the selection, it clears it (13T). A click, not a press: the press stays free for the
   * header drag (YAZ-1548), and a drag fires no click, so the drag's own threshold keeps the two apart. ⇧ and ⌘ are
   * the press's (below); the sort arrow and the resize edge keep their own.
   */
  const onHeaderClick = (c: number) => (e: ReactMouseEvent<HTMLTableCellElement>): void => {
    if (e.button !== 0 || e.shiftKey || e.metaKey || e.altKey || e.ctrlKey || (e.target instanceof Element && e.target.closest('button, .view-table__resize') !== null)) return
    // The column that already IS the selection: a second click clears it (YAZ-3746 13T).
    const now = selRef.current
    if (now !== null && now.kind === 'cols' && now.cols?.size === 1 && now.cols.has(c)) {
      setSelection(null)
      return
    }
    setSelection(pickLine(selRef.current, 'cols', c, 'plain'))
    wrapRef.current?.querySelector<HTMLElement>(`tbody td[data-cell$=":${c}"]`)?.focus({ preventScroll: true })
  }
  /** ⇧ or ⌘ on a header picks columns (YAZ-4593); a plain press keeps its own behaviour, and so do the sort arrow and the resize edge. */
  const onHeaderMouseDown = (c: number) => (e: ReactMouseEvent<HTMLTableCellElement>): void => {
    if (e.button !== 0 || !(e.shiftKey || e.metaKey) || (e.target instanceof Element && e.target.closest('button, .view-table__resize') !== null)) return
    e.preventDefault()
    setSelection(pickLine(selRef.current, 'cols', c, pickOf(e)))
    wrapRef.current?.querySelector<HTMLElement>(`tbody td[data-cell$=":${c}"]`)?.focus({ preventScroll: true })
  }

  /** A cell as text (YAZ-4593 ⌘C): what it renders, the Name cell's title. */
  const cellText = (row: Row, c: number): string => (c === nameCol ? row.record.title : render(row.values[keys[c]] ?? null, resolve))
  const copyArea = (area: { rows: number[]; cols: number[] }): void => {
    const text = toTsv(area.rows.map((r) => area.cols.map((c) => cellText(flat[r], c))))
    // The values as stored, beside the readable text (YAZ-4636 T9c): a paste of this very copy keeps `[[id]]`.
    lastCopy = { text, raw: area.rows.map((r) => area.cols.map((c) => sourceText(r, c))) }
    navigator.clipboard.writeText(text).catch((error: unknown) => onNotice?.(`Can't copy: ${error instanceof Error ? error.message : String(error)}`))
  }
  /**
   * The bulk write (YAZ-4593): the cells' values grouped into ONE guarded write per note. A read-only note, the Name
   * column and a column no view writes are skipped, and so is a value the note already has.
   */
  /**
   * The last value this table wrote per note and key, until the index shows it (YAZ-4637 T4): two quick commits to one
   * cell before the index refreshes would otherwise both record the rendered value as their `before`, and ⌘Z would skip
   * a state. Read by `liveValue`; an entry goes once the record catches up (or the note leaves the rows), and the map
   * keeps at most `LAST_WRITTEN_MAX` entries, the oldest out. A ref: no render on a write.
   */
  const lastWritten = useRef(new Map<string, unknown>())
  const liveValue = (path: string, bare: string): unknown => {
    const at = `${path}\n${bare}`
    return lastWritten.current.has(at) ? lastWritten.current.get(at) : records.find((r) => r.path === path)?.properties[bare]
  }
  const noteWritten = (path: string, writes: readonly PropertyWrite[]): void => {
    const map = lastWritten.current
    for (const { key, value } of writes) {
      map.delete(`${path}\n${key}`)
      map.set(`${path}\n${key}`, value)
    }
    while (map.size > LAST_WRITTEN_MAX) map.delete(map.keys().next().value!)
  }
  useEffect(() => {
    const map = lastWritten.current
    if (map.size === 0) return
    const byPath = new Map(records.map((r) => [r.path, r]))
    for (const [at, value] of map) {
      const [path, bare] = at.split('\n') as [string, string]
      const record = byPath.get(path)
      if (record === undefined || JSON.stringify(record.properties[bare] ?? null) === JSON.stringify(value ?? null)) map.delete(at)
    }
  }, [records])
  /**
   * The cells an undo, a redo or a bulk write rewrote (YAZ-3746 13O; bulk writes since 13AK). Their display follows `lastWritten` from the moment ⌘Z lands,
   * not from the index's echo of the write (the watcher, the 300 ms refetch debounce and the fetch: about a second).
   * `undoGen` keys each such cell, so an undo remounts it and the typed value it still showed (`EditableCell`'s
   * `pending`, which otherwise stays until the index catches up) is forgotten; a key is stable after that, so the
   * entry's end remounts nothing. A state: an undo renders the table, a commit does not. An entry goes with its
   * `lastWritten` one; the keys keep at most `LAST_WRITTEN_MAX`, the oldest out — at undo time, when no cell edits.
   */
  const [undone, setUndone] = useState<ReadonlySet<string>>(() => new Set())
  const undoGen = useRef(new Map<string, number>())
  const showUndone = (writes: ReadonlyMap<string, readonly PropertyWrite[]>): void => {
    const ats = [...writes].flatMap(([path, w]) => w.map(({ key }) => `${path}\n${key}`))
    const gen = undoGen.current
    for (const at of ats) {
      const n = (gen.get(at) ?? 0) + 1
      gen.delete(at)
      gen.set(at, n)
    }
    while (gen.size > LAST_WRITTEN_MAX) gen.delete(gen.keys().next().value!)
    setUndone((s) => new Set([...s, ...ats]))
  }
  useEffect(() => {
    setUndone((s) => {
      if (s.size === 0) return s
      const kept = new Set([...s].filter((at) => lastWritten.current.has(at)))
      return kept.size === s.size ? s : kept
    })
  }, [records])
  const planWrites = (cells: Iterable<{ r: number; c: number; value: unknown }>): WritePlan => {
    const byPath = new Map<string, PropertyWrite[]>()
    /** Each note's values before the write, for Undo: one write per note back (undefined deletes the key). */
    const before = new Map<string, PropertyWrite[]>()
    let count = 0
    for (const { r, c, value } of cells) {
      const row = flat[r]
      const bare = bares[c]
      if (row === undefined || bare == null || readOnly.has(row.record.path)) continue
      const was = liveValue(row.record.path, bare)
      if (JSON.stringify(was ?? null) === JSON.stringify(value)) continue
      count++
      const writes = byPath.get(row.record.path)
      if (writes === undefined) byPath.set(row.record.path, [{ key: bare, value }])
      else writes.push({ key: bare, value })
      before.set(row.record.path, [...(before.get(row.record.path) ?? []), { key: bare, value: was }])
    }
    return { byPath, before, count }
  }
  const failed = (error: unknown) => onNotice?.(`Can't write: ${error instanceof Error ? error.message : String(error)}`)
  /** Each note's writes, one write per note, at most 8 at a time (YAZ-4612 S48); more than 20 notes say so first. */
  const writeNotes = (writes: ReadonlyMap<string, PropertyWrite[]>): Promise<void> => {
    if (writes.size > PROGRESS_AT) onNotice?.(`Writing ${writes.size} notes…`)
    for (const [path, w] of writes) noteWritten(path, w)
    return inBatches(
      [...writes].map(([path, w]) => () =>
        onWriteValues(path, w).catch((error: unknown) => {
          failed(error)
          throw error
        }),
      ),
    )
  }
  /**
   * A planned bulk write: ONE step of the page's ⌘Z history (S41), then the writes. With `undo`, one S29 toast for the
   * whole gesture once every write landed (YAZ-4609 D61); its Undo is the step's own (YAZ-4637 T9e), so ⌘Z and ⇧⌘Z
   * agree with it. The step holds its notes as refs (T3): a rename since moves the writes with the note.
   */
  const commitWrites = (plan: WritePlan, undo?: (count: number) => string, verb = 'Change', asked = false): void => {
    if (plan.count === 0) return
    // Confirm changes (13AN): one ask for the whole gesture, by the focused cell; nothing shows or is written before Change.
    if (confirmChange !== undefined && !asked) {
      const anchor = document.activeElement instanceof Element ? document.activeElement.closest('td') : null
      void confirmChange({ ...planAsk(plan, verb), anchor: anchor ?? wrapRef.current }).then((ok) => ok && commitWrites(plan, undo, verb, true))
      return
    }
    const notes = [...plan.byPath].map(([path, writes]) => ({ ref: noteRef(path), writes, before: plan.before.get(path)! }))
    const live = (pick: 'writes' | 'before') => new Map(notes.flatMap((note) => (note.ref.path === null ? [] : [[note.ref.path, note[pick]] as const])))
    const again = (pick: 'writes' | 'before') => () => {
      const writes = live(pick)
      showUndone(writes)
      void writeNotes(writes).catch(() => {})
    }
    const back = again('before')
    const step: HistoryStep = { undo: back, redo: again('writes'), notes: notes.map((note) => note.ref) }
    history?.push(step)
    // The cells show the written values at once (YAZ-3746 13AK), as an undo does (13O): Delete, Clear cells, Paste, Set
    // value and the fill handle waited for the index's echo of the write, about half a second.
    const writes = live('writes')
    showUndone(writes)
    writeNotes(writes).then(
      () => {
        if (undo !== undefined) onNotice?.(undo(plan.count), 'info', 'undo', { label: 'Undo', run: () => (history === undefined ? back() : void history.undoStep(step)), fades: true })
      },
      () => {},
    )
  }
  const writeCells = (cells: Iterable<{ r: number; c: number; value: unknown }>, undo?: (count: number) => string, verb?: string): void => commitWrites(planWrites(cells), undo, verb)
  /** A column's name for an ask, by its bare key. */
  const bareLabel = (bare: string): string => {
    const c = bares.indexOf(bare)
    return c === -1 ? bare : propertyLabel(def, keys[c])
  }
  const titleOfPath = (path: string): string => records.find((r) => r.path === path)?.title ?? path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '')
  /** What a bulk write changes, in one sentence (13AN): one cell by name, else a count. */
  const planAsk = (plan: WritePlan, verb: string): Omit<ChangeAsk, 'anchor' | 'point'> => {
    if (plan.count === 1) {
      const [path, [write]] = [...plan.byPath][0]
      return { kind: bareLabel(write.key), note: titleOfPath(path), from: plan.before.get(path)?.[0]?.value, to: write.value }
    }
    const notes = plan.byPath.size
    const [kind, action] = BULK_ASK[verb] ?? [verb, 'Change']
    return { kind, action, summary: `${plan.count} cells in ${notes} ${notes === 1 ? 'note' : 'notes'}` }
  }
  /** A clear awaiting its confirm (S49): more than 50 cells. */
  const [confirmClear, setConfirmClear] = useState<WritePlan | null>(null)
  /** Clear cells (YAZ-4593) and Delete / Backspace (S44): the empty value in each cell; more than 50 cells ask first. */
  const clearArea = (area: { rows: number[]; cols: number[] }): void => {
    const plan = planWrites(area.rows.flatMap((r) => area.cols.map((c) => ({ r, c, value: null }))))
    if (plan.count > CONFIRM_CLEAR_AT) setConfirmClear(plan)
    else commitWrites(plan, undefined, 'Clear')
  }
  /** One typed cell's commit, one step of the history (S41): undo writes the value it had — the last one this table wrote when the index is behind (T4). */
  const commitCell = async (path: string, bare: string, next: unknown): Promise<unknown> => {
    // Confirm changes (13AN): asked by the cell, before anything is written or put on the history.
    if (confirmChange !== undefined) {
      const r = flat.findIndex((row) => row.record.path === path)
      const cell = wrapRef.current?.querySelector(`[data-cell="${r}:${bares.indexOf(bare)}"]`) ?? null
      const ok = await confirmChange({ kind: bareLabel(bare), note: titleOfPath(path), from: liveValue(path, bare), to: next, anchor: cell })
      if (!ok) throw CHANGE_CANCELLED
    }
    const before = liveValue(path, bare)
    const ref = noteRef(path)
    /** A tied cell's write (YAZ-4781 R2) resolves with the Undo of the notes it wrote: the step's undo runs that, not a write of `before`. */
    let paired: PairWritten | null = null
    const keep = (result: unknown): unknown => {
      if (isPairWritten(result)) paired = result
      return result
    }
    const write = (value: unknown, undo = false) => {
      if (ref.path === null) return
      noteWritten(ref.path, [{ key: bare, value }])
      showUndone(new Map([[ref.path, [{ key: bare, value }]]]))
      void (undo && paired !== null ? paired.undoPair() : onWriteValues(ref.path, [{ key: bare, value }]).then(keep)).catch(failed)
    }
    history?.push({ undo: () => write(before, true), redo: () => write(next), notes: [ref] })
    noteWritten(path, [{ key: bare, value: next }])
    return onWriteValue(path, bare, next).then(keep)
  }
  /**
   * The fill handle (YAZ-4609 D61, the table block's `editor/table/tableFill.ts`): a square in the bottom-right corner
   * of the selection, or of the focused cell. One element, moved on the DOM like the selection marks, so placing it
   * renders nothing. A drag down or right marks the cells it would fill (`data-fill-target`, dashed in views.css); on
   * mouseup each column (down) or row (right) continues with `fillSeries`, ONE write per note with one Undo.
   */
  const handleRef = useRef<HTMLSpanElement | null>(null)
  const fillRef = useRef<{ rows: number[]; cols: number[]; axis: 'down' | 'right'; count: number } | null>(null)
  /** The handle's drag start, read when the handle is pressed: the newest render's closure. */
  const fillStartRef = useRef<(e: MouseEvent) => void>(() => {})
  const fillArea = (): { rows: number[]; cols: number[] } | null => areaOf(selRef.current, cellAt(document.activeElement) ?? undefined)
  const placeHandle = (): void => {
    const wrap = wrapRef.current
    if (wrap === null) return
    wrap.querySelector('td[data-fill-corner]')?.removeAttribute('data-fill-corner')
    const area = fillArea()
    const corner = area === null || area.rows.length === 0 || area.cols.length === 0 ? null : wrap.querySelector<HTMLElement>(`td[data-cell="${area.rows.at(-1)}:${area.cols.at(-1)}"]`)
    if (corner == null) {
      handleRef.current?.remove()
      return
    }
    if (handleRef.current === null) {
      const handle = document.createElement('span')
      handle.className = 'view-table__fill-handle'
      handle.setAttribute('aria-hidden', 'true')
      // A native listener: its stopPropagation keeps the press from the body's select drag (React listens at the root).
      handle.addEventListener('mousedown', (e) => fillStartRef.current(e))
      handleRef.current = handle
    }
    corner.setAttribute('data-fill-corner', '')
    if (handleRef.current.parentElement !== corner) corner.appendChild(handleRef.current)
  }
  /** The dashed outline of the cells a running fill drag covers, on the mounted cells: their outer edges. */
  const paintFillTarget = (): void => {
    const wrap = wrapRef.current
    if (wrap === null) return
    for (const td of wrap.querySelectorAll('td[data-fill-target]')) td.removeAttribute('data-fill-target')
    const fill = fillRef.current
    if (fill === null || fill.count === 0) return
    const [top, left, bottom, right] = [fill.rows[0], fill.cols[0], fill.rows.at(-1)!, fill.cols.at(-1)!]
    const last = fill.axis === 'down' ? Math.min(bottom + fill.count, flat.length - 1) : bottom
    const end = fill.axis === 'right' ? Math.min(right + fill.count, keys.length - 1) : right
    for (const td of wrap.querySelectorAll<HTMLElement>('tbody td[data-cell]')) {
      const [r, c] = td.dataset.cell!.split(':').map(Number)
      if (r < top || r > last || c < left || c > end) continue
      const edges = [r === top && 'top', r === last && 'bottom', c === left && 'left', c === end && 'right'].filter(Boolean).join(' ')
      td.setAttribute('data-fill-target', edges)
    }
  }
  useLayoutEffect(() => {
    placeHandle()
    if (fillRef.current !== null) paintFillTarget()
  })
  /** A cell's source text for `fillSeries`: a note value as written (an ISO date, a number), else what the cell shows. */
  const sourceText = (r: number, c: number): string => {
    const bare = bares[c]
    if (bare == null) return cellText(flat[r], c)
    const raw = flat[r].record.properties[bare]
    return raw == null ? '' : Array.isArray(raw) ? raw.join(', ') : String(raw)
  }
  /** A source cell's own value, for a fill that repeats it: the raw value keeps its type (a list, a boolean). */
  const sourceValue = (r: number, c: number): unknown => {
    const bare = bares[c]
    return bare == null ? cellText(flat[r], c) : flat[r].record.properties[bare] ?? null
  }
  /** The value a fill writes in cell `r`:`c`: a repeated source keeps its value, a new one is typed by the cell's kind. */
  const filledValue = (r: number, c: number, text: string, from: { r: number; c: number }, repeated: boolean): unknown => {
    if (repeated) return sourceValue(from.r, from.c)
    const bare = bares[c]
    return bare == null ? undefined : valueFromText(text, cellEditor(flat[r].record.properties[bare], typings[c]) ?? 'text')
  }
  /** The fill on mouseup (D61): it stops at the last shown row and column, and never makes a note. */
  const runFill = ({ rows: src, cols, axis, count }: NonNullable<typeof fillRef.current>): void => {
    const cells: { r: number; c: number; value: unknown }[] = []
    if (axis === 'down') {
      const n = Math.min(count, flat.length - 1 - src.at(-1)!)
      for (const c of cols) {
        const texts = src.map((r) => sourceText(r, c))
        const kind = typings[c]?.assigned ?? typings[c]?.dominant
        // A Select or Multi-select column repeats its values, as an option is no series; an Image column too (YAZ-4802): `photo1.png` is no series.
        const series = kind === 'select' || kind === 'multi-select' || kind === 'image' ? Array.from({ length: n }, (_, i) => texts[i % texts.length]) : fillSeries(texts, n)
        series.forEach((text, i) => {
          const r = src.at(-1)! + 1 + i
          const from = { r: src[i % src.length], c }
          const value = filledValue(r, c, text, from, text === texts[i % texts.length])
          if (value !== undefined) cells.push({ r, c, value })
        })
      }
    } else {
      const n = Math.min(count, keys.length - 1 - cols.at(-1)!)
      for (const r of src) {
        const texts = cols.map((c) => sourceText(r, c))
        fillSeries(texts, n).forEach((text, i) => {
          const c = cols.at(-1)! + 1 + i
          const from = { r, c: cols[i % cols.length] }
          const value = filledValue(r, c, text, from, text === texts[i % texts.length])
          if (value !== undefined) cells.push({ r, c, value })
        })
      }
    }
    writeCells(cells, (written) => `Filled ${written} ${written === 1 ? 'cell' : 'cells'}`, 'Fill')
  }
  fillStartRef.current = (e: MouseEvent): void => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const area = fillArea()
    if (area === null) return
    const [lastRow, lastCol] = [area.rows.at(-1)!, area.cols.at(-1)!]
    const move = (ev: MouseEvent) => {
      const over = cellAt(ev.target)
      if (over === null) return
      const down = over.r - lastRow
      const right = over.c - lastCol
      // Up or left of the source fills nothing, so it marks nothing (YAZ-4636 T9a).
      const next = down >= right ? { axis: 'down' as const, count: Math.max(down, 0) } : { axis: 'right' as const, count: Math.max(right, 0) }
      if (fillRef.current?.axis === next.axis && fillRef.current.count === next.count) return
      fillRef.current = { ...area, ...next }
      paintFillTarget()
    }
    const up = (ev: MouseEvent) => {
      move(ev)
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
      const fill = fillRef.current
      fillRef.current = null
      paintFillTarget()
      if (fill !== null && fill.count > 0) runFill(fill)
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }
  /** ⌘V (YAZ-4593): the clipboard's tab-separated text, from the area's top-left cell, each text as a value of its cell's kind. */
  const pasteInto = (area: { rows: number[]; cols: number[] }): void => {
    // A picture on the clipboard pasted on Image cells (YAZ-4802): saved once into assets/images, each cell linking it.
    if (area.cols.every((c) => typings[c]?.assigned === 'image')) {
      void clipboardImage().then((file) => {
        if (file === null) return pasteText(area)
        // A pasted picture has no name: it is named after the first note it lands on.
        saveImageFile(root, file, flat[area.rows[0]]?.record.basename).then(
          (path) => writeCells(area.rows.flatMap((r) => (flat[r] === undefined ? [] : area.cols.map((c) => ({ r, c, value: imageValue(path) })))), undefined, 'Paste into'),
          (error: unknown) => onNotice?.(`Can't paste the picture: ${error instanceof Error ? error.message : String(error)}`),
        )
      })
      return
    }
    pasteText(area)
  }
  /** A picture file dropped on an Image cell (YAZ-4802): saved into assets/images, the cell links it. Its value holds no pointer in a table, so the cell takes the drop. */
  const imageDrop = (r: number, c: number) => ({
    onDragOver: (e: ReactDragEvent) => {
      if (!e.dataTransfer.types.includes('Files')) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    },
    onDrop: (e: ReactDragEvent) => {
      const file = imageFile(e.dataTransfer)
      if (file === null) return
      e.preventDefault()
      e.stopPropagation()
      saveImageFile(root, file).then(
        (path) => writeCells([{ r, c, value: imageValue(path) }]),
        (error: unknown) => onNotice?.(`Can't save the picture: ${error instanceof Error ? error.message : String(error)}`),
      )
    },
  })
  const pasteText = (area: { rows: number[]; cols: number[] }): void => {
    navigator.clipboard.readText().then(
      (text) => {
        const cells: { r: number; c: number; value: unknown }[] = []
        let notOption = 0
        // The table's own last copy pastes its stored values (T9c): a link stays `[[id]]`, never the title it showed.
        const grid = lastCopy !== null && lastCopy.text === text ? lastCopy.raw : parseTsv(text)
        grid.forEach((line, i) =>
          line.forEach((t, j) => {
            // Only the shown columns, and of those the writable ones: never a hidden column or the Name (YAZ-4612 S51).
            const [r, c] = [area.rows[0] + i, area.cols[0] + j]
            const bare = bares[c]
            if (flat[r] === undefined || bare == null) return
            const kind = cellEditor(flat[r].record.properties[bare], typings[c]) ?? 'text'
            const value = valueFromText(t, kind)
            if (value === undefined) return
            // A Select or Multi-select value that is no option skips its cell; no option is made (S50).
            const options = typings[c]?.options
            if ((kind === 'select' || kind === 'multi-select') && options !== undefined && value !== null && !(Array.isArray(value) ? value : [value]).every((v) => options.includes(String(v)))) {
              notOption++
              return
            }
            cells.push({ r, c, value })
          }),
        )
        writeCells(cells, undefined, 'Paste into')
        if (notOption > 0) onNotice?.(`${notOption} ${notOption === 1 ? 'cell' : 'cells'} skipped: not an option`)
      },
      (error: unknown) => onNotice?.(`Can't paste: ${error instanceof Error ? error.message : String(error)}`),
    )
  }
  /**
   * ⌘\ "Clear formatting" (YAZ-4603 D54): the cell fills of the area, the row fills of whole rows and the Wrap / Clip
   * and alignment of whole columns (`columnWrap`, back to the default by kind; `columnAlign`, back to Auto, YAZ-3746 13Y). ONE view write with Undo (S29); none, and no toast,
   * when nothing changes. Values and the column setup (formats, widths, group header styles) stay.
   */
  const clearFormatting = (sel: TableSelection | null, area: { rows: number[]; cols: number[] }): void => {
    const notes = area.rows.map((r) => flat[r].record)
    const targets: { record: IndexRecord; column?: string }[] = notes.flatMap((record) => area.cols.map((c) => ({ record, column: keys[c] })))
    if (sel?.cols === null) targets.push(...notes.map((record) => ({ record })))
    const unwrap = sel?.rows === null ? new Set(area.cols.map((c) => canonicalKey(keys[c]))) : null
    const clear = (d: ViewSet) => {
      setViewFills(d, viewIndex, targets, null, resolveLink, true)
      const v = d.views[viewIndex]
      if (unwrap === null) return
      // The columns' Wrap / Clip and, since YAZ-3746 13Y, their alignment (`columnAlign`, back to Auto) and, since 13AQ,
      // their fill (`columnFill`) go the same way.
      for (const map of ['columnWrap', 'columnAlign', 'columnFill'] as const) {
        const entries = v[map]
        if (entries === undefined) continue
        const kept = Object.fromEntries(Object.entries(entries).filter(([k]) => !unwrap.has(canonicalKey(k))))
        if (Object.keys(kept).length > 0) (v as Record<string, unknown>)[map] = kept
        else delete v[map]
      }
    }
    // A dry run on a copy: a write that changes nothing is not made.
    const trial = structuredClone(def)
    clear(trial)
    if (JSON.stringify(trial) !== JSON.stringify(def)) onUpdate(clear, 'Cleared formatting', undefined, true)
  }
  /**
   * ⌘C, ⌘V and Esc (YAZ-4593), ⌘A, ⇧+arrows (YAZ-4603 D53) and ⌘\ (D54); with no selection, ⌘C, ⌘V and ⌘\ act on the
   * focused cell `at`, and ⇧+arrow starts a range there. True when the key was the table's.
   */
  const selectionKey = (e: KeyboardEvent | ReactKeyboardEvent, at?: { r: number; c: number }): boolean => {
    if (e.key === 'Escape') {
      if (selRef.current === null) return false
      setSelection(null)
      return true
    }
    const step = STEPS[e.key]
    if (step !== undefined) {
      if (!e.shiftKey || e.metaKey || e.altKey || e.ctrlKey || flat.length === 0) return false
      const next = stepRange(selRef.current, at, step[0], step[1], flat.length, keys.length)
      setSelection(next)
      // The far corner shows when it is mounted; the focus stays on the anchor.
      if (next?.kind === 'cells') {
        const far = farCorner(next, flat.length, keys.length)
        wrapRef.current?.querySelector<HTMLElement>(`[data-cell="${far.r}:${far.c}"]`)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
      }
      return true
    }
    const k = e.key.toLowerCase()
    // ⌘Z / ⇧⌘Z (YAZ-4612 S41): the page's value history. An open cell editor keeps its own: its keys never come here.
    if (k === 'z' && e.metaKey && !e.altKey && !e.ctrlKey) return (e.shiftKey ? history?.redo() : history?.undo()) ?? false
    // Delete or Backspace clears the values (S44), not the formatting (⌘\, D54).
    if ((e.key === 'Delete' || e.key === 'Backspace') && !e.metaKey && !e.altKey && !e.ctrlKey && !e.shiftKey) {
      const area = areaOf(selRef.current, at)
      if (area === null) return false
      clearArea(area)
      return true
    }
    if (!e.metaKey || e.shiftKey || e.altKey || e.ctrlKey || (k !== 'c' && k !== 'v' && k !== 'a' && k !== '\\')) return false
    if (k === 'a') return selectAll()
    const area = areaOf(selRef.current, at)
    if (area === null) return false
    if (k === 'c') copyArea(area)
    else if (k === 'v') pasteInto(area)
    else clearFormatting(selRef.current, area)
    return true
  }
  selectionKeyRef.current = selectionKey

  /**
   * The notes of a selection, for its Duplicate and Delete (YAZ-4592 S26): a folder row is no note, and a note shown
   * under two groups counts once (YAZ-4636 T7). Read when the menu opens, so a later change of rows cannot swap them.
   */
  const notePathsOf = (sel: TableSelection): string[] => [...new Set(indicesOf(sel.rows, flat.length).map((r) => flat[r].record).filter((record) => !isFolderRow(record)).map((record) => record.path))]
  /** Google-Sheets style: right-click selects the data cell, unless a typed editor owns it. Inside the selection it opens the selection's menu (YAZ-4593). */
  const openRowMenu = ({ record, values }: Row) => (event: ReactMouseEvent<HTMLTableRowElement>): void => {
    if (!(event.target instanceof Element)) return
    if (event.target.closest('[data-editing]') !== null) return
    // Never the page's text menu (Cut / Copy / Paste) on a row (YAZ-3746 13AH): every right-click on it is the table's.
    event.preventDefault()
    const sel = selRef.current
    const cell = event.target.closest<HTMLTableCellElement>('td[data-cell]')
    if (cell === null) {
      // The row's `#`, its ⋮⋮, or a gap between cells (YAZ-3746 13AC, 13AH): the whole row. Several selected rows keep
      // their menu; one row gets the same menu as its cells (13AI), for the whole row, and shows selected.
      const gutterCell = event.currentTarget.querySelector<HTMLElement>('td[data-row]')
      if (gutterCell === null) return
      const r = Number(gutterCell.dataset.row)
      if (sel?.kind === 'rows' && sel.rows!.has(r) && sel.rows!.size > 1) {
        setRowMenu(null)
        setSelMenu({ x: event.clientX, y: event.clientY, sel, paths: notePathsOf(sel), r })
        return
      }
      const rows = pickLine(null, 'rows', r, 'plain')
      if (rows !== null) setSelection(rows)
      setSelMenu(null)
      setRowMenu({ x: event.clientX, y: event.clientY, record, column: null, r, value: null })
      return
    }
    cell.focus()
    // `data-cell` is `row:column`: the column index names the key the fill is for (YAZ-4536), the row index the freeze (YAZ-4537).
    const [r, c] = (cell.dataset.cell ?? '').split(':').map(Number)
    if (sel !== null && inSelection(sel, r, c)) {
      setRowMenu(null)
      setSelMenu({ x: event.clientX, y: event.clientY, sel, paths: notePathsOf(sel), r })
      return
    }
    setSelection(null)
    setRowMenu({ x: event.clientX, y: event.clientY, record, column: keys[c], r, value: values[keys[c]] ?? null })
  }


  /**
   * Header reorder (YAZ-1548): the column at `from` lands at final index `to`. ONE write
   * through the SHARED `setViewOrder` — the Properties checklist's and "Hide column"'s writer — so
   * `frozenColumns` follows positionally here exactly as it does there: a column dropped into the frozen part freezes,
   * one dropped out of it thaws (YAZ-4606: the drag may cross the freeze line, as before). A view with no explicit
   * `order` writes the full current keys list in the new order, as the list does on its first drag.
   */
  const moveColumn = (from: number, to: number): void => {
    const next = [...keys]
    const [key] = next.splice(from, 1)
    next.splice(to, 0, key)
    onUpdate((d) => setViewOrder(d, viewIndex, next))
  }
  /**
   * The slot at a client x of the header (YAZ-4606), by each column's midpoint WHERE THE LAYOUT PUTS IT: the table's
   * widths are fixed, so the places are known without a read of any cell. A frozen column sticks at its offset, so
   * while the table is scrolled it is drawn that far on. One read of the header row's place, and of the scroll.
   */
  const columnSlot = (x: number): number => {
    const head = live.ref.current
    if (head === null) return keys.length
    const at = x - head.getBoundingClientRect().left
    const scrolled = frozen > 0 ? (wrapRef.current?.scrollLeft ?? 0) : 0
    let start = gutterWidth
    for (let c = 0; c < keys.length; c++) {
      const width = widthOf(keys[c])
      if (at < start + width / 2 + (c < frozen ? scrolled : 0)) return c
      start += width
    }
    return keys.length
  }
  /** The cells of each column that move with its header (YAZ-4606): the header, every mounted body cell and the summary cell. */
  const columnCells = (): HTMLElement[] => [...(wrapRef.current?.querySelectorAll<HTMLElement>('thead th[data-col], tbody td[data-cell], tfoot td.view-table__summary:not(.view-table__gutter)') ?? [])]
  const columnOfCell = (el: HTMLElement): string =>
    // The gutter cell is always first, numbers or not (YAZ-4610 D62, YAZ-4636 T8): a summary cell's column is one before its index.
    el.dataset.col !== undefined ? (keys[Number(el.dataset.col)] ?? '') : el.dataset.cell !== undefined ? (keys[Number(el.dataset.cell.split(':')[1])] ?? '') : (keys[(el as HTMLTableCellElement).cellIndex - 1] ?? '')
  // THE COLUMN DRAG (YAZ-4606 D58): the tab bar's live gap, across the table. The grabbed column leaves it, and the other
  // columns part, each moving as one: its header, its mounted body cells and its summary cell.
  const live = useLiveGapReorder<HTMLTableRowElement>({ axis: 'x', keys, onMove: moveColumn, slotAt: columnSlot, roomOf: (c) => widthOf(keys[c]), scroller: () => wrapRef.current, cells: columnCells, keyOfCell: columnOfCell })
  /**
   * The property headers' drag wiring (YAZ-1548): each header is a source; the `#` gutter is none. The drop is the whole
   * table's (`.view-table-wrap`, YAZ-4819), as the slot is read from the pointer's x alone.
   */
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
      live.start(e, index)
    },
    onDragEnd: live.end,
  })
  // Each column's slide and the grabbed column's lift, as ONE rule per moved column for this table (YAZ-4606): a slot
  // change re-renders no cell's style, and the cells a scroll mounts mid-drag take the rule too.
  const tableId = useId()
  const scope = `.view-table[data-table-id="${tableId}"]`
  /** The cells of column `c`, the `#` gutter's for -1: the header, every mounted body cell and the summary cell. */
  const cellsOf = (c: number): string =>
    c === -1
      ? `${scope} thead th.view-table__gutter,${scope} tbody td.view-table__gutter,${scope} tfoot td.view-table__gutter`
      : `${scope} thead th[data-col="${c}"],${scope} tbody td[data-cell$=":${c}"],${scope} tfoot td:nth-child(${c + 2})`
  // The empty place in the FROZEN part is covered (YAZ-4643 S2): the frozen cells are sticky over the scrolled columns,
  // so the frozen cell beside the place paints the grabbed column's room of background there, as a box-shadow (a cell's
  // `overflow: hidden` would clip a pseudo-element). Its header cell goes over the scrolled headers (z-index 3), as a
  // frozen header does (4): the gutter's header sits at 1.
  const cover = live.drag === null ? null : frozenGapCover(live.gap, live.drag.from, frozen, live.drag.room)
  const coverRule = (c: FrozenGapCover): string =>
    `${cellsOf(c.col)}{box-shadow:${frozenGapShadow(c, c.col === -1 ? gutterWidth : widthOf(keys[c.col]))};}${scope} thead th${c.col === -1 ? '.view-table__gutter' : `[data-col="${c.col}"]`}{z-index:4;}`
  const columnRules =
    live.drag === null
      ? ''
      : keys
          .map((_, c) => {
            const shift = live.shiftOf(c)
            if (shift === 0 && !live.lifted(c)) return ''
            return `${cellsOf(c)}{${shift === 0 ? '' : `transform:${partTransform(shift, 'x')};`}${live.lifted(c) ? 'opacity:0;' : ''}}`
          })
          .join('') + (cover === null ? '' : coverRule(cover))

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
    if (selectionKey(e, { r, c })) {
      e.preventDefault()
      return
    }
    // Tab and ⇧Tab move right and left (YAZ-4612 S43); at the table's edge Tab leaves it, as on a page.
    if (e.key === 'Tab' && !e.metaKey && !e.altKey && !e.ctrlKey) {
      const nc = c + (e.shiftKey ? -1 : 1)
      if (nc < 0 || nc >= keys.length) return
      e.preventDefault()
      setSelection(null)
      wrapRef.current?.querySelector<HTMLElement>(`[data-cell="${r}:${nc}"]`)?.focus()
      return
    }
    // A typed letter starts editing with it (S42), but not on the Name cell, whose title edit keeps double-click.
    if (e.key.length === 1 && !e.metaKey && !e.altKey && !e.ctrlKey && c !== nameCol) {
      const bare = bares[c]
      const kind = bare == null || flat[r] === undefined ? null : cellEditor(flat[r].record.properties[bare], typings[c])
      const open = (e.target as HTMLElement).querySelector<HTMLElement>('[data-edit]')
      if (open === null || kind === null || !TYPE_KINDS.has(kind)) return
      e.preventDefault()
      // The click mounts the field now, so the letter goes into it.
      flushSync(() => open.click())
      const input = (e.target as HTMLElement).querySelector<HTMLInputElement>('input')
      if (input !== null) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, e.key)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }
      return
    }
    if (e.key === 'Enter') {
      // A modifier always opens, from any cell (YAZ-4605 D56): ⌘ a background tab, ⌥ the right panel, ⇧ the mini
      // window. Plain Enter opens from the Name cell and edits any other; ⌃ opens nothing, as before.
      if (c === nameCol || ((e.metaKey || e.altKey || e.shiftKey) && !e.ctrlKey)) {
        if (flat[r]) openByKey(e, flat[r].record.path, { ...openHandlers, onOpenWindow })
      } else {
        // Start editing (or toggle the checkbox) through the same delegated control (5B, GRO-2142).
        ;(e.target as HTMLElement).querySelector<HTMLElement>('[data-edit]')?.click()
      }
      return
    }
    const move = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key]
    if (move === undefined) return
    e.preventDefault()
    setSelection(null)
    const nr = Math.max(0, Math.min(flat.length - 1, r + move[0]))
    const nc = Math.max(0, Math.min(keys.length - 1, c + move[1]))
    wrapRef.current?.querySelector<HTMLElement>(`[data-cell="${nr}:${nc}"]`)?.focus()
  }

  /**
   * Enter that commits a cell's edit moves the focus down one row (YAZ-4612 S43): the editor hands the focus back to
   * its cell, and that focus moves on. Any other key in the editor (Esc, a picked suggestion's next letter) forgets it.
   */
  const downAfter = useRef<string | null>(null)
  const onEditorKey = (e: ReactKeyboardEvent): void => {
    const cell = e.target instanceof Element ? e.target.closest<HTMLElement>('td[data-cell]') : null
    if (cell === null || cell === e.target) return
    downAfter.current = e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.altKey && !e.ctrlKey ? cell.dataset.cell! : null
  }
  const onTableFocus = (e: ReactFocusEvent): void => {
    placeHandle()
    const at = e.target instanceof HTMLElement ? e.target.dataset.cell : undefined
    // The editor's own field taking the focus keeps the memory; any OTHER cell's focus forgets it (YAZ-4636 T9d): a
    // list editor stays open on Enter, and a press elsewhere must not make the cell's next focus jump a row.
    if (at === undefined) return
    const down = downAfter.current
    downAfter.current = null
    if (at !== down) return
    const [r, c] = at.split(':').map(Number)
    wrapRef.current?.querySelector<HTMLElement>(`[data-cell="${r + 1}:${c}"]`)?.focus()
  }
  /** The focus leaving the table forgets the Enter too (T9d); between its own cells `onTableFocus` decides. */
  const onTableBlur = (e: ReactFocusEvent): void => {
    placeHandle()
    if (!(e.relatedTarget instanceof Node) || wrapRef.current?.contains(e.relatedTarget) !== true) downAfter.current = null
  }

  /**
   * The focus back on the row menu's cell after a fill or ⌘\ from it (YAZ-3746 13N): the menu's button took it at the
   * press, and the menu is about to unmount, which would leave the focus on the page, where ⌘Z finds no table.
   */
  const refocusMenuCell = (): void => {
    if (rowMenu === null) return
    wrapRef.current?.querySelector<HTMLElement>(`[data-cell="${rowMenu.r}:${rowMenu.column === null ? 0 : keys.indexOf(rowMenu.column)}"]`)?.focus({ preventScroll: true })
  }

  /** The one-row menu's cells (YAZ-3746 13AI): its cell, or every column of the row when it came from the row's `#`. */
  const menuArea = ({ r, column }: { r: number; column: string | null }) => ({ rows: [r], cols: column === null ? keys.map((_, c) => c) : [keys.indexOf(column)] })
  /** Row freeze (YAZ-4537): the count of rows that stay on top; 0 unfreezes. */
  const freezeRows = (count: number): void =>
    onUpdate((d) => {
      if (count === 0) delete d.views[viewIndex].frozenRows
      else d.views[viewIndex].frozenRows = count
    }, count === 0 ? UNFROZE_ROWS : undefined)

  /** The selection's right-click (YAZ-4593): every action works on the selection it was opened on; Duplicate and Delete on the notes it held then (`paths`). */
  const selectionMenu =({ x, y, sel, paths, r }: NonNullable<typeof selMenu>) => {
    const area = areaOf(sel)!
    const one = area.cols.length === 1 ? area.cols[0] : -1
    const typing = one === -1 || bares[one] === null ? undefined : typings[one]
    return (
      <SelectionMenu
        x={x}
        y={y}
        rows={sel.kind === 'rows'}
        setValue={typing === undefined ? null : { kind: typing?.assigned ?? typing?.dominant ?? 'text', options: typing?.options }}
        onCopy={() => copyArea(area)}
        onPaste={() => pasteInto(area)}
        onClear={() => clearArea(area)}
        // Whole columns fill as columns (YAZ-3746 13AQ), whole rows as rows; a range of cells offers all three.
        fillTargets={sel.kind === 'cols' ? COLUMN_FILLS : sel.kind === 'rows' ? undefined : ALL_FILLS}
        onFill={(target, fill) => {
          // No fill offers Undo, as the row menu's (YAZ-4594 S29); every fill is a ⌘Z step (YAZ-3746 13N).
          if (target === 'column') {
            onUpdate((d) => area.cols.forEach((c) => setColumnFill(d.views[viewIndex], keys[c], fill)), fill === null ? 'Cleared fill' : undefined, undefined, true)
            return
          }
          const targets = area.rows.flatMap((r) => (target === 'row' ? [{ record: flat[r].record }] : area.cols.map((c) => ({ record: flat[r].record, column: keys[c] }))))
          onUpdate((d) => setViewFills(d, viewIndex, targets, fill, resolveLink, true), fill === null ? 'Cleared fill' : undefined, undefined, true)
        }}
        onSetValue={(value) => writeCells(area.rows.map((r) => ({ r, c: one, value })), undefined, 'Set')}
        onClearFormatting={() => clearFormatting(sel, area)}
        onNewRowBelow={newRowBelow && area.rows.length > 0 ? () => newRowBelow(area.rows.at(-1)!) : undefined}
        onDuplicate={onDuplicateNote && paths.length > 0 ? () => paths.forEach(onDuplicateNote) : undefined}
        onDelete={onDeleteNotes && paths.length > 0 ? () => onDeleteNotes(paths) : undefined}
        // The row menu's freeze, on the row right-clicked (YAZ-3746 13AI: the two menus match where they can).
        extra={sel.kind === 'rows' && r !== undefined ? <FreezeRowItems row={r} frozen={frozenRows} onFreeze={(count) => { setSelMenu(null); freezeRows(count) }} /> : undefined}
        onClose={() => setSelMenu(null)}
      />
    )
  }

  const spacer = (at: string, h: number) => (
    <tr key={at} className="view-table__spacer" aria-hidden style={{ height: h }}>
      <td colSpan={span} />
    </tr>
  )

  /** A windowed table's sticky header numbers (YAZ-4798), counted: the header at `index`, mounted at body place `dom`. */
  const windowedStick = (index: number | undefined, dom: number | undefined): CSSProperties | undefined => {
    const at = index === undefined ? undefined : spanAt.get(index)
    if (!windowed || !stickyGroups || at === undefined || dom === undefined || index! < pinned) return undefined
    const { lift, room } = windowedGuide(at, dom, pinned, rowH)
    return { '--view-group-lift': `${lift}px`, '--view-group-room': `${room}px` } as CSSProperties
  }

  /**
   * One body line. `frozenAt` is a frozen line's place from the top (YAZ-4537): its sticky index (`--view-frozen-i`,
   * views.css), and the last one draws the 3px freeze line. `index` is its place in `lines` and `dom` its place in the
   * body when it differs (a header lifted above the window); a grouped table with sticky headers or lines marks each
   * line with its index (`data-line`, YAZ-4798), and a windowed one gives each header row its counted numbers.
   */
  const renderLine = (line: Line, frozenAt?: number, index?: number, dom = index) => {
    const frozenRow = frozenAt === undefined ? undefined : ['view-table__row--frozen', frozenAt === pinned - 1 && 'view-table__row--frozen-end']
    const frozenRowStyle = frozenAt === undefined ? undefined : ({ '--view-frozen-i': frozenAt } as CSSProperties)
    const lineMark = guide === null || index === undefined ? undefined : index
    if ('add' in line)
      // The "+ New" row (YAZ-4539): the group header "+"'s path, so the note gets the filter seed and every group value above it.
      return (
        <tr key={`new:${line.gk}`} className={['view-table__new', ...(frozenRow ?? [])].filter(Boolean).join(' ')} style={frozenRowStyle} data-line={lineMark}>
          <td className="view-table__new-cell" colSpan={span} style={{ '--depth': line.at === undefined ? 0 : indentDepth(line.at.ancestors.length + 1) } as CSSProperties}>
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
          style={frozenRowStyle ?? windowedStick(index, dom)}
          data-line={lineMark}
          {...dnd.target(line.header, line.at)}
        >
          <td
            className="view-table__group-cell"
            colSpan={span}
            style={{ '--depth': indentDepth(line.depth) } as CSSProperties}
            onClick={stickyGroups ? backToGroupTop : undefined}
            // The empty part of a group header row opens the header's own menu (YAZ-4604, 2F), never the system one: the
            // event goes on to the header, whose state holds the menu, so only that header re-renders.
            onContextMenu={(e) => {
              e.preventDefault()
              const header = e.currentTarget.querySelector('.view-group')
              if (header === null || header.contains(e.target as Node)) return
              header.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: e.clientX, clientY: e.clientY }))
            }}
          >
            <GroupHeader
              def={def}
              view={view}
              columns={keys}
              groupKey={line.header.key}
              label={line.header.label}
              rows={line.header.rows}
              collapsed={collapsedSet.has(line.gk)}
              onToggle={() => onToggleGroup(line.gk)}
              onNew={onNewInGroup === undefined || !groupTakesNew(view, line.at.level, settings.columns) ? undefined : () => onNewInGroup(line.header, undefined, line.at)}
              newButton={newRows}
              resolve={resolve}
              level={line.at.level}
            />
          </td>
        </tr>
      ) : (
        <tr
          key={rowKey(line)}
          className={[line.gk !== null && dnd.over === line.gk && 'view-table__row--drop', windowLink?.current === line.row.record.path && CURRENT_ROW, ...(frozenRow ?? [])].filter(Boolean).join(' ') || undefined}
          style={frozenRowStyle}
          data-line={lineMark}
          {...(line.g !== null && line.at !== null && dnd.target(line.g, line.at))}
          {...hover.itemProps(line.row.record.path)}
          onContextMenu={openRowMenu(line.row)}
        >
          {/* No `data-cell` and no tabIndex: the gutter is outside the arrow-key grid (YAZ-1513). Always there: slim with numbers off (D62). */}
          {
            <td
              className={numbered ? 'view-table__gutter' : 'view-table__gutter view-table__gutter--slim'}
              data-row={line.r}
              // The row's only drag source (YAZ-4603 D53), a ⋮⋮ on hover (views.css): onto another group, or the Other
              // files tray, the only target of an ungrouped row (YAZ-4597 D46). A drag across cells selects.
              {...(line.g === null || line.at === null ? trayRowDrag(moveToTray, line.row.record.path) : dnd.source(line.row.record.path, line.g, line.at, readOnly.has(line.row.record.path)))}
              onClick={(e) => (e.currentTarget.draggable ? wrapRef.current?.querySelector<HTMLElement>(`[data-cell="${line.r}:0"]`)?.focus({ preventScroll: true }) : undefined)}
            >
              {numbered && line.n}
            </td>
          }
          {keys.map((key, c) => {
            const v = line.row.values[key]
            const { path, title } = line.row.record
            const locked = readOnly.has(path)
            // A cell's own fill, else its row's, else its column's (YAZ-3746 13AQ).
            const fill = cellFillOf(fills, path, key) ?? columnFills[c]
            /** What an undo of this cell wrote, while the index is behind it (YAZ-3746 13O); null for every other cell. */
            const undoneAt = bares[c] === null ? null : `${path}\n${bares[c]}`
            const shown = undoneAt !== null && undone.has(undoneAt) && lastWritten.current.has(undoneAt) ? { raw: lastWritten.current.get(undoneAt) } : null
            return (
              <td
                key={key}
                // The tests and the end-to-end specs find the Name cell by `view-table__name`; its only style is the group indent (YAZ-4532).
                className={[typeOf(v) === 'number' && 'view-table__cell--num', c === nameCol && 'view-table__name', c === indentCol && 'view-table__indent', frozenClass(c), fill !== undefined && 'view-table__cell--fill', clipped[c] && 'view-table__cell--clip', aligned[c]].filter(Boolean).join(' ') || undefined}
                // A fill (YAZ-4536) is a custom property that views.css paints over the cell's base.
                // The Name cell steps in by one group indent per level above the row (YAZ-4532 D10).
                style={cellStyle(c, fill, c === indentCol && line.at !== null ? line.at.ancestors.length + 1 : undefined)}
                tabIndex={line.r === firstDataRow && c === 0 ? 0 : -1}
                data-cell={`${line.r}:${c}`}
                // The Name cell (YAZ-2420 🔒 D26): ⌘ and ⌥ open the note; a plain click only selects, as on any cell.
                // ⇧⌘ opens it in a new window (YAZ-4444 D32), asked first.
                onClick={c === nameCol ? (e) => (newWindowClick(e, rowPage(path)) ? undefined : e.metaKey || e.altKey ? void openByGesture(e, path, openHandlers) : selectCell(e)) : bares[c] === null ? undefined : selectCell}
                // A read-only note's Name cell opens no title field: a title edit renames the note (YAZ-3076 D6).
                // A clipped cell shows its full value on hover only when it is cut (YAZ-4582 D29, YAZ-4867): `cutCellCard`.
                title={c === nameCol && locked ? READ_ONLY_TIP : undefined}
                data-clip-title={c === nameCol && locked ? undefined : clipped[c] ? (c === nameCol ? title : clipTitle(v, resolve)) : undefined}
                onDoubleClick={c === nameCol ? (locked ? undefined : () => setTitleEdit(rowKey(line))) : bares[c] === null ? undefined : activateEditorFromCell}
                {...(c !== nameCol && !locked && typings[c]?.assigned === 'image' ? imageDrop(line.r, c) : {})}
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
                      // YAZ-4799: grouped by Folder, a row's ↗ is read against the folder group it is drawn in, so a
                      // shortcut's copy under its second folder wears it and its home copy does not.
                      <ViewFolder.Provider value={folderGroupOf(line.at, line.g) ?? viewFolder}>
                        {locked ? <ReadOnlyName>{rowTitle(line.row)}</ReadOnlyName> : rowTitle(line.row)}
                      </ViewFolder.Provider>
                    )}
                    {moveError?.path === line.row.record.path && (
                      <span className="view-table__chip view-table__chip--error view-drag__error" role="alert" title={moveError.message}>
                        Move failed
                      </span>
                    )}
                  </>
                ) : bares[c] !== null ? (
                  <EditableCell
                    // An undone cell shows what the undo wrote, at once (YAZ-3746 13O); its key remounts it on each undo.
                    key={undoneAt === null ? undefined : undoGen.current.get(undoneAt)}
                    propKey={bares[c]}
                    raw={shown !== null ? shown.raw : line.row.record.properties[bares[c]]}
                    value={shown !== null ? fromYaml(shown.raw) : v}
                    editor={cellEditor(line.row.record.properties[bares[c]], typings[c])}
                    options={typings[c]?.options}
                    titles={linkNames[c] ?? titles}
                    resolve={resolve}
                    readOnly={locked}
                    onCommit={(next) => commitCell(line.row.record.path, bares[c]!, next)}
                  />
                ) : (
                  rowCell(line.row, key, resolve)
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
      <div
        ref={wrapRef}
        className="view-table-wrap"
        // A held column edge (13W): the runner keeps the scroll width, and no easing while the edge is dragged.
        data-resizing={drag !== null ? '' : undefined}
        style={slack > 0 ? ({ '--view-table-slack': `${slack}px` } as CSSProperties) : undefined}
        onScroll={windowed ? (e) => setPast(scrolledPast(e.currentTarget)) : undefined}
        // The column drop (YAZ-4819): the whole table takes it. The parted columns leave a gap under the pointer with no
        // header in it, so a drop on the headers alone was lost. With no column drag these do nothing (`live.over` is false).
        onDragEnter={live.over}
        onDragOver={live.over}
        onDrop={live.drop}
        // No page text menu (Cut / Copy / Paste) anywhere in the table (YAZ-3746 13AH): a right-click no menu of the
        // table takes (a gap, the scroll room) opens nothing. A cell being edited keeps it, for its text.
        onContextMenu={(e) => {
          if (e.target instanceof Element && e.target.closest('[data-editing], input, textarea, [contenteditable="true"]') === null) e.preventDefault()
        }}
      >
        {columnRules !== '' && <style>{columnRules}</style>}
        <table
          className="view-table"
          // YAZ-4774: the view's own header row parts; the rest are Settings' (on `.app`).
          {...headerRowAttrs(headerRowOfView(view))}
          data-table-id={tableId}
          data-live-parting={live.parting ? '' : undefined}
          // YAZ-4798: sticky group headers, and the group lines' mode and look (views.css); none on an ungrouped table.
          data-sticky-groups={stickyGroups ? '' : undefined}
          data-group-lines={groupLines !== 'off' ? groupLines : undefined}
          data-group-line-style={threaded ? 'thread' : undefined}
          style={{ width: gutterWidth + keys.reduce((w, k) => w + widthOf(k), 0), '--view-table-row-h': `${rowH}px`, '--view-group-indent': `${groupIndentOf(view)}px` } as CSSProperties}
          onKeyDown={onKeyDown}
          // The fill handle follows the focused cell when there is no selection (D61): placed on the DOM, no render.
          onFocus={onTableFocus}
          onBlur={onTableBlur}
          onKeyDownCapture={onEditorKey}
        >
          {/* The group lines (YAZ-4798): one per open group, in a caption so their box spans the table and sticks at the
              left as the group headers do. A table that mounts every line measures them; a windowed one counts them. */}
          {groupLines !== 'off' && guide !== null && (
            <caption className="view-table__guides" aria-hidden="true">
              <div className="view-table__lines">
                {guide.spans.map((s) => {
                  if (s.last <= s.at) return null
                  const counted = windowed ? windowedLine(s, rowH) : null
                  const at = { '--depth': indentDepth(s.depth), ...(counted !== null && { '--view-line-top': `calc(var(--view-group-head, 0px) + ${counted.top}px)`, '--view-line-h': `${counted.height}px` }) } as CSSProperties
                  return <i key={s.at} data-seg={s.at} style={at} />
                })}
              </div>
            </caption>
          )}
          <thead>
            <tr ref={live.ref}>
              {/* The corner selects every cell, as ⌘A (YAZ-4610 D62). */}
              <th
                scope="col"
                className={numbered ? 'view-table__gutter' : 'view-table__gutter view-table__gutter--slim'}
                style={{ width: gutterWidth }}
                title="Select all"
                onClick={selectAll}
                onContextMenu={openHeaderMenu(null)}
              >
                {numbered && '#'}
              </th>
              {keys.map((key, index) => {
                const c = canonicalKey(key)
                // This column's sort rule (YAZ-4590 S19): ▲ or ▼ (views.css draws it), and its place when there are several.
                const at = sorts.findIndex((s) => canonicalKey(s.property) === c)
                const rule = sorts[at]
                const assigned = typings[index]?.assigned
                const order = rule === undefined ? '' : orderOf(rule, assigned === 'select' || assigned === 'multi-select').label
                return (
                  <th
                    key={key}
                    scope="col"
                    className={[frozenClass(index), aligned[index]].filter(Boolean).join(' ') || undefined}
                    style={{ width: widthOf(key), ...frozenStyle(index) }}
                    data-col={index}
                    data-live-item={key}
                    onMouseDown={onHeaderMouseDown(index)}
                    onClick={onHeaderClick(index)}
                    onContextMenu={openHeaderMenu(key)}
                    {...headerDrag(index)}
                  >
                    {/* YAZ-4779: the column's type, quiet, before its name; its words on hover. */}
                    {typeIcons !== null && (
                      <HoverTip className="view-table__type-icon" text={typeIcons[index].label}>
                        {typeIcons[index].icon}
                      </HoverTip>
                    )}
                    {/* The column's description on hover (YAZ-4590 S23), in the app's hover box (YAZ-4772). */}
                    {c.startsWith('note.') && settings.columns[c.slice('note.'.length)]?.description ? (
                      <HoverTip text={settings.columns[c.slice('note.'.length)]!.description}>{propertyLabel(def, key)}</HoverTip>
                    ) : (
                      propertyLabel(def, key)
                    )}
                    {marks[index] !== null && <ColumnMark mark={marks[index]!} withName={sources.marks === 'name'} />}
                    {rule !== undefined && (
                      <button
                        type="button"
                        className="view-table__sort"
                        data-dir={rule.direction === 'DESC' ? 'DESC' : 'ASC'}
                        data-pos={sorts.length > 1 ? at + 1 : undefined}
                        aria-label={`${sorts.length > 1 ? `Sort ${at + 1}: ` : 'Sorted '}${order}. Click to flip`}
                        title={`${sorts.length > 1 ? `Sort ${at + 1}: ` : 'Sorted '}${order}. Click to flip`}
                        onClick={() => flipSort(at)}
                      />
                    )}
                    <span
                      className={`view-table__resize${drag?.key === key ? ' view-table__resize--active' : ''}`}
                      aria-hidden
                      onMouseDown={startResize(key)}
                      onDoubleClick={autoFit(key, index)}
                    />
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody onMouseDown={onBodyMouseDown} onClick={onBodyClick}>
            {head.map((line, i) => renderLine(line, i, i))}
            {/* YAZ-4798: the headers of the groups a windowed table starts in, mounted in place of as much spacer. */}
            {lifted.map((h, k) => renderLine(lines[h], undefined, h, pinned + k))}
            {first - pinned - lifted.length > 0 && spacer('top', (first - pinned - lifted.length) * rowH)}
            {visible.map((line, k) => renderLine(line, undefined, first + k))}
            {windowed && lines.length - first - count > 0 && spacer('bottom', (lines.length - first - count) * rowH)}
          </tbody>
          {groups === null && (
            <tfoot>
              <tr>
                {/* Keeps the summary cells under their columns; the gutter has nothing to summarise. */}
                <td className="view-table__summary view-table__gutter" />
                {keys.map((key, index) => {
                  const label = propertyLabel(def, key)
                  const kind = summaryKindOf(view, key)
                  return (
                    <td key={key} className={['view-table__summary', frozenClass(index), aligned[index]].filter(Boolean).join(' ')} style={frozenStyle(index)}>
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
            // One order in every folder-page menu (YAZ-4608 C8): open, then edit, then view, then destructive last.
            extra={[
              // The selection menu's first group (YAZ-3746 13AI): on this cell, or on the whole row from its `#`.
              <Fragment key="clipboard">
                {(['Copy', 'Paste', 'Clear cells'] as const).map((label) => (
                  <button
                    key={label}
                    type="button"
                    className="ctx-menu__item"
                    role="menuitem"
                    // The keys the table answers (13AW, as the sidebar's menu shows its own).
                    data-hint={label === 'Copy' ? '⌘C' : label === 'Paste' ? '⌘V' : '⌫'}
                    onClick={() => {
                      setRowMenu(null)
                      const area = menuArea(rowMenu)
                      if (label === 'Copy') copyArea(area)
                      else if (label === 'Paste') pasteInto(area)
                      else clearArea(area)
                      refocusMenuCell()
                    }}
                  >
                    {label}
                  </button>
                ))}
              </Fragment>,
              <Fragment key="fill">
                <FillMenu
                  start={cellFillOf(fills, rowMenu.record.path, rowMenu.column ?? keys[0])}
                  // No fill offers Undo (YAZ-4594 S29); every fill is a ⌘Z step (YAZ-3746 13N). From the `#`, "Fill cell"
                  // fills each cell of the row, as the selection menu's does.
                  // A cell's menu fills its column too (YAZ-3746 13AQ); the row's `#` fills cells and the row. ONE "Fill ›"
                  // with a Cell · Row · Column switch (13AW), on the cell from a cell and on the row from the `#`.
                  targets={rowMenu.column === null ? undefined : ALL_FILLS}
                  combined={{
                    initial: rowMenu.column === null ? 'row' : 'cell',
                    startOf: (target) =>
                      target === 'column' ? (rowMenu.column === null ? undefined : columnFillOf(view, rowMenu.column)) : cellFillOf(fills, rowMenu.record.path, target === 'cell' ? rowMenu.column ?? keys[0] : '\u0000'),
                  }}
                  onFill={(target, fill) => {
                    const { record, column } = rowMenu
                    if (target === 'column') {
                      if (column !== null) onUpdate((d) => setColumnFill(d.views[viewIndex], column, fill), fill === null ? 'Cleared fill' : undefined, undefined, true)
                      refocusMenuCell()
                      return
                    }
                    onUpdate(
                      (d) =>
                        target === 'cell' && column === null
                          ? setViewFills(d, viewIndex, keys.map((key) => ({ record, column: key })), fill, resolveLink, true)
                          : setViewFill(d, viewIndex, record, target === 'cell' ? column ?? undefined : undefined, fill, resolveLink, true),
                      fill === null ? 'Cleared fill' : undefined,
                      undefined,
                      true,
                    )
                    refocusMenuCell()
                  }}
                  onClose={() => setRowMenu(null)}
                />
                {/* ⌘\ on this one cell, or the whole row (YAZ-4603 D54). */}
                <ClearFormattingItem
                  onClear={() => {
                    setRowMenu(null)
                    clearFormatting(null, menuArea(rowMenu))
                    refocusMenuCell()
                  }}
                />
              </Fragment>,
              // The row-making edits (YAZ-4611 D63, YAZ-4592 S26): every row offers New row below, a folder row too; a folder row is no note, so it has no Duplicate.
              (newRowBelow || (onDuplicateNote && !isFolderRow(rowMenu.record))) && (
                <Fragment key="rows">
                  {newRowBelow && (
                    <button
                      type="button"
                      className="ctx-menu__item"
                      role="menuitem"
                      onClick={() => {
                        setRowMenu(null)
                        newRowBelow(rowMenu.r)
                      }}
                    >
                      New row below
                    </button>
                  )}
                  {!isFolderRow(rowMenu.record) &&
                    duplicateNoteItem(
                      onDuplicateNote &&
                        (() => {
                          setRowMenu(null)
                          onDuplicateNote(rowMenu.record.path)
                        }),
                    )}
                </Fragment>
              ),
              // The view group (13AW): "Filter ›" (YAZ-4592 S25: one more rule in the view's filters, a cell's only), then
              // the row freeze (YAZ-4537), the column menu's pair.
              <Fragment key="view">
                {rowMenu.column !== null && (
                  <FilterValueParent
                    property={rowMenu.column}
                    value={rowMenu.value}
                    onFilter={(rule) => {
                      setRowMenu(null)
                      onUpdate((d) => {
                        d.views[viewIndex].filters = withFilter(d.views[viewIndex].filters, rule)
                      })
                    }}
                  />
                )}
                <FreezeRowItems
                  row={rowMenu.r}
                  frozen={frozenRows}
                  onFreeze={(count) => {
                    setRowMenu(null)
                    freezeRows(count)
                  }}
                />
              </Fragment>,
            ].filter((group) => group !== null && group !== undefined && group !== false)}
            // Destructive, last (C8): a folder row is no note (YAZ-4592 S26), so it has no Delete.
            danger={
              isFolderRow(rowMenu.record)
                ? null
                : deleteNoteItem(
                    onDeleteNotes &&
                      (() => {
                        setRowMenu(null)
                        onDeleteNotes([rowMenu.record.path])
                      }),
                  )
            }
          />
        )}
        {selMenu !== null && selectionMenu(selMenu)}
        {headerMenu !== null && (
          <TableHeaderMenu
            x={headerMenu.x}
            y={headerMenu.y}
            columnKey={headerMenu.key}
            def={def}
            viewIndex={viewIndex}
            keys={keys}
            takenKeys={() => allPropertyKeys(def, view, records, settings.columns)}
            reserved={reservedKeys}
            records={records}
            wrapKind={headerMenu.key === null ? null : wrapKind(typings[keys.indexOf(headerMenu.key)])}
            properties={properties}
            folder={{ settings, setColumn, setColumns: declareColumn, deleteColumn, addColumn, sources, valueCount, separate, relation, onNotice, vaultFolders, resolveLink }}
            rowNumbers={numbered}
            onUpdate={onUpdate}
            declareColumn={declareColumn}
            onDeleteColumn={deleteColumn && setConfirmDelete}
            onClose={() => setHeaderMenu(null)}
          />
        )}
        {confirmClear !== null && (
          <ConfirmSheet
            labelId="confirm-clear-cells-text"
            text={`Clear ${confirmClear.count} cells? ⌘Z puts them back.`}
            confirmLabel="Clear"
            danger
            keys="sheet"
            onConfirm={() => {
              const plan = confirmClear
              setConfirmClear(null)
              // The sheet was the ask (13AN): no second one.
              commitWrites(plan, undefined, 'Clear', true)
            }}
            onCancel={() => setConfirmClear(null)}
          />
        )}
        {confirmDelete !== null && deleteColumn && (
          <ConfirmDeleteColumn
            columnKey={confirmDelete}
            def={def}
            folderName={sources.folderName}
            count={valueCount}
            onCancel={() => setConfirmDelete(null)}
            onConfirm={(clear) => {
              const gone = confirmDelete
              setConfirmDelete(null)
              void deleteColumn(gone, clear)
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
      {/* Only while rows are frozen (13AW): a menu hides what does not apply, as the sidebar's does. */}
      {frozen > 0 && (
        <button type="button" className="ctx-menu__item" role="menuitem" onClick={() => onFreeze(0)}>
          Unfreeze rows
        </button>
      )}
    </>
  )
}
