/**
 * The table's settings in the file (YAZ-3758, YAZ-3696 🔒 D1 / D3 / D7 / S3; CONTRACTS rule 41a).
 * The `table` node gets these attributes, each at its default on a plain table: `border` (`null` or
 * `{ px, darkness }`), `header` (the header row's own parts, YAZ-4774: `{}` follows Settings; `data-table-header-*`), `stripes`, `height` (`compact` | `normal` |
 * `tall`), `wrap` (YAZ-4900: `false` Clip, saved as `nowrap`; `true` Wrap, saved as `wrap`; `null` follows Settings ›
 * Tables › Text in cells, `data-table-text` on `.app`), `freezeRows` and `freezeCols`; `calendar` (the slot length in minutes, `0` for none,
 * YAZ-4162); `valign` (`top` | `middle` | `bottom`, the cells' default, YAZ-4166); `zoom` (whole percent, 100 by
 * default, YAZ-4091: `--table-zoom` on the block, which `table.css` puts on its content); `nowButton` (a calendar
 * table's "Now" chip, `true` by default; `false` saves `nonow` and is `data-table-nonow`, the YAZ-4163 demo); and
 * `superTable` and `views` (YAZ-4869 S1: a Super table and its views, `super/viewGrammar.ts`; saved as `super` and the
 * `view …` parts, `data-table-super` on the block, the views in `data-table-views` on a copy's `<table>` only); and
 * `unknownParts`, the comment's parts this build does not know or cannot read, kept as their text (YAZ-4161, YAZ-4176). A column's alignment is the cells' own GFM
 * `alignment` (the `:-` row), not ours (YAZ-3767). Each
 * cell gets `fill`, `color`, its own `align` and its own `valign` (YAZ-4166), `fold` (YAZ-4165: the cells of a
 * folded row; the comment's `fold` names the rows) and `subhead` (YAZ-4899: the cells of a subheader row, the comment's
 * `subhead`; the table's `subheader` and `stickySubheaders` are its look and whether it sticks, `tableSubhead.ts`) and
 * `text` (YAZ-4900: the column's own Wrap or Clip on each of its cells, `data-cell-text`; the header cell's is the
 * column's, which the save writes as `text 2:clip` and `keepColumnAlign` gives each body cell, as the GFM `alignment`)
 * (`withCellStyle`, used by `inlineBreaks.ts`'s `cellSchemas`), and a
 * column's width is the cells' own `colwidth` (prosemirror-tables). Markdown has no syntax for any.
 *
 * ON DISK a plain table is the GFM table, exactly the bytes of before (R5). A table with settings
 * is the table, then an HTML comment as the NEXT block: `<!-- table: widths 140 auto, fill A1:B1
 * blue, stripes -->` (`tableComment.ts` reads and writes it). Obsidian and GitHub hide it and show
 * a plain table.
 *
 * LOAD: `tableStyleRemark` joins a `table` with its NEXT sibling when that sibling is our comment
 * (`joinComment.ts`, shared with `lineStyle.ts` for `***`). The table's
 * attributes go on `data.tableAttrs`, each cell's on `data.tableCell`, and the comment leaves the
 * tree. A widths list longer than the table loses its extra widths; a shorter one leaves `auto`.
 * Any other comment — not ours, not right after a table — stays an `html` node, bytes untouched.
 *
 * SAVE: `toMarkdown` writes the table, then an `html` node with the comment when any part is set.
 *
 * MERGED CELLS (YAZ-4792, `tableMerge.ts`): in the document a merged cell has prosemirror-tables' `colspan` /
 * `rowspan`, and the cells it covers are not there. In the file the GFM grid stays whole: the save writes the table
 * from `fullGrid` (each covered cell back, empty; the merged cell's text in its top-left cell) and the comment's
 * `merge A1:B1 A2:A3` part names the merges; the load (`applyStyle`) puts the spans on each top-left cell and takes
 * the covered cells out of the tree, so GitHub and Obsidian read a plain table and the editor shows one cell. Every
 * A1 address is a GRID position; a covered cell has no style of its own (the merged cell's is its top-left's), so a
 * style the file gives a covered address is dropped. A merge the table cannot take (`validMerges`) is dropped too. A
 * merged header cell's widths are its `colwidth` per column. `keepColumnAlign` replaces Milkdown's
 * `keepTableAlignPlugin` (`createCrepe.ts` removes it): a body cell follows the header cell of its grid column, found
 * through the table map, not the header row's child at its own index.
 *
 * VIEW: the table block (`@milkdown/components` table-block) is a node view that builds its own
 * DOM, so the table's `toDOM` never reaches the page. `tableStylePlugin` puts the same data
 * attributes and custom properties that `toDOM` writes on the block's `div.milkdown-table-block`,
 * by a node decoration that depends on the attributes only. Cells render through their own
 * `toDOM`, so `data-fill` / `data-color` are on the page as they are. `table.css` draws them.
 * `changedTables` gives the tables a transaction changed, here and in `tableFreeze.ts`.
 */
import { tableSchema } from '@milkdown/kit/preset/gfm'
import { Fragment, type Node as ProseNode, type TagParseRule } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, type Transaction } from '@milkdown/kit/prose/state'
import { TableMap } from '@milkdown/kit/prose/tables'
import { AttrStep, ReplaceStep } from '@milkdown/kit/prose/transform'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import type { MarkdownNode, NodeSchema } from '@milkdown/kit/transformer'
import { $prose, $remark } from '@milkdown/kit/utils'
import type { Nodes, Table } from 'mdast'
import { headerRowAttrs, headerRowOwn, HEADER_ROW_PARTS, subheaderRowAttrs, type HeaderRowOwn } from '@shared/types'
import { joinNextComment } from '../joinComment'
import { cellStartsAt, isMerged, rowFolded, rowNoDim, rowSubhead, tableHasMerge } from './cells'
import {
  BORDER_PX_MAX,
  WIDTH_MAX,
  ZOOM_MAX,
  ZOOM_MIN,
  calendarSlot,
  cellAddress,
  cellAlign,
  cellColor,
  cellText,
  cellValign,
  formatTableComment,
  parseTableComment,
  plainTable,
  unknownPart,
  validMerges,
  type CellText,
  type MergeRange,
  type TableStyle,
  type UnknownPart,
  type Valign,
} from './tableComment'
import { checkedView, type TableViewDef } from './super/viewGrammar'
import './table.css'

export * from './tableComment'

/** The table node's attributes, at their defaults. */
export const TABLE_DEFAULTS = {
  border: null as { px: number; darkness: number } | null,
  header: {} as HeaderRowOwn,
  /** The subheader rows' own look (YAZ-4899): `{}` follows Settings › Tables › Subheader row; `data-table-subheader-*`. */
  subheader: {} as HeaderRowOwn,
  /** Sticky subheaders (YAZ-4899): `true` saves `stickysubheads`, `false` `nostickysubheads`, `null` follows Settings. */
  stickySubheaders: null as boolean | null,
  /** Sticky header row (YAZ-4899 round 2): `true` saves `stickyheader`, `false` `nostickyheader`, `null` follows Settings; the frozen rows read it (`tableFreeze.ts`). */
  stickyHeader: null as boolean | null,
  stripes: false,
  height: 'normal' as 'compact' | 'normal' | 'tall',
  /** Text in cells (YAZ-4900): `false` is Clip (saves `nowrap`), `true` Wrap (saves `wrap`), `null` follows Settings › Tables › Text in cells. */
  wrap: null as boolean | null,
  freezeRows: 0,
  freezeCols: 0,
  calendar: 0 as 0 | 15 | 30 | 60,
  valign: 'top' as Valign,
  zoom: 100,
  /** A calendar table shows its "Now" chip (the YAZ-4163 demo); `false` saves `nonow`. */
  nowButton: true,
  /** The table's own cell note "+" button (YAZ-4790): `true` saves `notebutton`, `false` `nonotebutton`, `null` follows Settings. */
  noteButton: null as boolean | null,
  /** A Super table (YAZ-4869 S1): `true` saves `super`. */
  superTable: false,
  /** Its views (YAZ-4869 S1), each saved as a `view …` part. */
  views: [] as TableViewDef[],
  unknownParts: [] as UnknownPart[],
}
export type TableAttrs = typeof TABLE_DEFAULTS

/** The parts of the comment that are the cells' own, not the table's. */
type TableLevel = Omit<TableStyle, 'widths' | 'fill' | 'color' | 'align' | 'valign' | 'fold' | 'nodim' | 'subhead'>

const isWhole = (n: unknown, min: number, max: number): n is number => Number.isInteger(n) && (n as number) >= min && (n as number) <= max

/** The table-level parts of the node's attributes, every value checked: an unknown value is the default. */
function tableLevel(attrs: Record<string, unknown>): TableLevel {
  const out: TableLevel = {}
  const border = attrs.border as { px?: unknown; darkness?: unknown } | null
  if (border && isWhole(border.px, 0, BORDER_PX_MAX) && isWhole(border.darkness, 0, 100)) out.border = { px: border.px, darkness: border.darkness }
  const header = headerRowOwn(attrs.header)
  if (Object.keys(header).length > 0) out.header = header
  const subheader = headerRowOwn(attrs.subheader)
  if (Object.keys(subheader).length > 0) out.subheader = subheader
  if (typeof attrs.stickySubheaders === 'boolean') out.sticky = attrs.stickySubheaders
  if (typeof attrs.stickyHeader === 'boolean') out.stickyHeader = attrs.stickyHeader
  if (attrs.stripes === true) out.stripes = true
  if (attrs.height === 'compact' || attrs.height === 'tall') out.height = attrs.height
  if (attrs.wrap === false) out.nowrap = true
  if (attrs.wrap === true) out.wrap = true
  const rows = isWhole(attrs.freezeRows, 1, 999) ? attrs.freezeRows : 0
  const cols = isWhole(attrs.freezeCols, 1, 999) ? attrs.freezeCols : 0
  if (rows > 0 || cols > 0) out.freeze = { rows, cols }
  const calendar = calendarSlot(attrs.calendar)
  if (calendar !== null) out.calendar = calendar
  if (attrs.valign === 'middle' || attrs.valign === 'bottom') out.valignTable = attrs.valign
  if (isWhole(attrs.zoom, ZOOM_MIN, ZOOM_MAX) && attrs.zoom !== 100) out.zoom = attrs.zoom
  if (attrs.nowButton === false) out.nonow = true
  if (attrs.noteButton === true) out.notebutton = true
  if (attrs.noteButton === false) out.nonotebutton = true
  if (attrs.superTable === true) out.super = true
  const views = Array.isArray(attrs.views) ? attrs.views.map(checkedView).filter((view) => view !== null) : []
  if (views.length > 0) out.views = views
  const unknown = Array.isArray(attrs.unknownParts) ? attrs.unknownParts.map(unknownPart) : []
  if (unknown.length > 0 && unknown.every((part) => part !== null)) out.unknown = unknown as UnknownPart[]
  return out
}

/** A column's width from a cell's `colwidth` (`index` of the columns a merged cell spans): whole px (a drag can leave a fraction), or `null`. */
const widthOf = (cell: ProseNode, index = 0): number | null => {
  const w = (cell.attrs.colwidth as number[] | null)?.[index]
  return typeof w === 'number' && w >= 1 ? Math.min(Math.round(w), WIDTH_MAX) : null
}

const CELL_ROLES = new Set(['cell', 'header_cell'])

/**
 * A table node's settings, every value checked. Rows and columns are the GRID's (the table map), row 1 the header
 * row: a merged cell is at its top-left position and names a `merge` range (YAZ-4792).
 */
function tableStyleOf(table: ProseNode): TableStyle {
  const style: TableStyle = { ...plainTable(), ...tableLevel(table.attrs) }
  const map = TableMap.get(table)
  style.widths = Array.from({ length: map.width }, () => null)
  const fold: number[] = []
  const nodim: number[] = []
  const subhead: number[] = []
  table.forEach((row, _, r) => {
    if (r > 0 && rowFolded(row)) fold.push(r)
    if (r > 0 && rowNoDim(row)) nodim.push(r)
    if (r > 0 && rowSubhead(row)) subhead.push(r)
  })
  const merge: MergeRange[] = []
  const seen = new Set<number>()
  map.map.forEach((pos, i) => {
    if (seen.has(pos)) return
    seen.add(pos)
    const cell = table.nodeAt(pos)
    // A table mid-repair (a row short of cells) maps a hole to 0: no cell there.
    if (cell === null || !CELL_ROLES.has(cell.type.spec.tableRole as string)) return
    const r = Math.floor(i / map.width)
    const c = i % map.width
    const colspan = cell.attrs.colspan as number
    const rowspan = cell.attrs.rowspan as number
    if (r === 0) for (let j = 0; j < colspan && c + j < map.width; j++) style.widths[c + j] = widthOf(cell, j)
    // The column's own Wrap or Clip (YAZ-4900) is its header cell's; a merged header cell names it for each column it spans.
    const text = r === 0 ? cellText(cell.attrs.text) : null
    if (text !== null) for (let j = 0; j < colspan && c + j < map.width; j++) (style.text ??= new Map()).set(c + j, text)
    if (colspan > 1 || rowspan > 1) merge.push({ top: r, left: c, bottom: r + rowspan, right: c + colspan })
    const fill = cellColor(cell.attrs.fill)
    const color = cellColor(cell.attrs.color)
    const align = cellAlign(cell.attrs.align)
    const valign = cellValign(cell.attrs.valign)
    if (fill !== null) style.fill.set(cellAddress(r, c), fill)
    if (color !== null) style.color.set(cellAddress(r, c), color)
    if (align !== null) style.align.set(cellAddress(r, c), align)
    if (valign !== null) style.valign.set(cellAddress(r, c), valign)
  })
  if (fold.length > 0) style.fold = fold
  if (nodim.length > 0) style.nodim = nodim
  if (subhead.length > 0) style.subhead = subhead
  if (merge.length > 0) style.merge = merge
  return style
}

/**
 * The table with every cell of the grid, for the file (YAZ-4792): a merged cell spans nothing, and each cell it covered
 * is back, empty, with the merged cell's GFM alignment. The table itself when no cell is merged.
 */
function fullGrid(table: ProseNode): ProseNode {
  if (!tableHasMerge(table)) return table
  const map = TableMap.get(table)
  const { schema } = table.type
  const rows: ProseNode[] = []
  table.forEach((row, _, r) => {
    const type = r === 0 ? schema.nodes.table_header! : schema.nodes.table_cell!
    const cells: ProseNode[] = []
    for (let c = 0; c < map.width; c++) {
      const cell = table.nodeAt(map.map[r * map.width + c]!)!
      if (!cellStartsAt(map, r, c)) cells.push(type.createAndFill({ alignment: cell.attrs.alignment })!)
      else cells.push(isMerged(cell) ? cell.type.create({ ...cell.attrs, colspan: 1, rowspan: 1, colwidth: null }, cell.content) : cell)
    }
    rows.push(row.copy(Fragment.from(cells)))
  })
  return table.copy(Fragment.from(rows))
}

/** The DOM attributes of the table-level parts on the table block and on a copy's `<table>` (`toDOM` adds the freeze). `null` for none. */
function tableDomAttrs(attrs: Record<string, unknown>): Record<string, string> | null {
  const level = tableLevel(attrs)
  const out: Record<string, string> = {}
  const style: string[] = []
  if (level.border) style.push(`--table-border-width: ${level.border.px}px; --table-border-darkness: ${level.border.darkness}%`)
  if (level.zoom) {
    out['data-table-zoom'] = String(level.zoom)
    style.push(`--table-zoom: ${level.zoom / 100}`)
  }
  if (style.length > 0) out.style = style.join('; ')
  Object.assign(out, headerRowAttrs(level.header ?? {}), subheaderRowAttrs(level.subheader ?? {}))
  if (level.sticky !== undefined) out['data-table-sticky-subheaders'] = level.sticky ? 'on' : 'off'
  if (level.stickyHeader !== undefined) out['data-table-sticky-header'] = level.stickyHeader ? 'on' : 'off'
  if (level.stripes) out['data-table-stripes'] = ''
  if (level.height) out['data-table-height'] = level.height
  if (level.nowrap) out['data-table-nowrap'] = ''
  if (level.wrap) out['data-table-wrap'] = ''
  if (level.calendar) out['data-table-calendar'] = String(level.calendar)
  if (level.valignTable) out['data-table-valign'] = level.valignTable
  if (level.nonow) out['data-table-nonow'] = ''
  if (level.notebutton) out['data-table-notebutton'] = ''
  if (level.nonotebutton) out['data-table-nonotebutton'] = ''
  if (level.super) out['data-table-super'] = ''
  return Object.keys(out).length === 0 ? null : out
}

/** `tableDomAttrs` read back from a pasted `<table>`. */
function readTableDom(dom: HTMLElement): Partial<TableAttrs> {
  const style = dom.getAttribute('style') ?? ''
  const px = /--table-border-width:\s*(\d+)px/.exec(style)?.[1]
  const darkness = /--table-border-darkness:\s*(\d+)%/.exec(style)?.[1]
  const [rows, cols] = (dom.getAttribute('data-table-freeze') ?? '').split(' ').map(Number)
  let unknownParts: unknown = null
  let views: unknown = null
  try {
    unknownParts = JSON.parse(dom.getAttribute('data-table-parts') ?? 'null')
    views = JSON.parse(dom.getAttribute('data-table-views') ?? 'null')
  } catch {
    // Not ours: no parts.
  }
  const raw = {
    border: px !== undefined && darkness !== undefined ? { px: Number(px), darkness: Number(darkness) } : null,
    header: Object.fromEntries(HEADER_ROW_PARTS.map((part) => [part, dom.getAttribute(`data-table-header-${part}`)])),
    subheader: Object.fromEntries(HEADER_ROW_PARTS.map((part) => [part, dom.getAttribute(`data-table-subheader-${part}`)])),
    stickySubheaders: dom.getAttribute('data-table-sticky-subheaders') === 'on' ? true : dom.getAttribute('data-table-sticky-subheaders') === 'off' ? false : null,
    stickyHeader: dom.getAttribute('data-table-sticky-header') === 'on' ? true : dom.getAttribute('data-table-sticky-header') === 'off' ? false : null,
    stripes: dom.hasAttribute('data-table-stripes'),
    height: dom.getAttribute('data-table-height'),
    wrap: dom.hasAttribute('data-table-nowrap') ? false : dom.hasAttribute('data-table-wrap') ? true : null,
    freezeRows: rows,
    freezeCols: cols,
    calendar: Number(dom.getAttribute('data-table-calendar')),
    valign: dom.getAttribute('data-table-valign'),
    zoom: Number(dom.getAttribute('data-table-zoom')),
    nowButton: !dom.hasAttribute('data-table-nonow'),
    noteButton: dom.hasAttribute('data-table-nonotebutton') ? false : dom.hasAttribute('data-table-notebutton') ? true : null,
    superTable: dom.hasAttribute('data-table-super'),
    views,
    unknownParts,
  }
  return levelAttrs(tableLevel(raw))
}

/** The node attributes for table-level parts. */
const levelAttrs = (style: TableLevel): TableAttrs => ({
  border: style.border ?? null,
  header: style.header ?? {},
  subheader: style.subheader ?? {},
  stickySubheaders: style.sticky ?? null,
  stickyHeader: style.stickyHeader ?? null,
  stripes: style.stripes === true,
  height: style.height ?? 'normal',
  wrap: style.nowrap === true ? false : style.wrap === true ? true : null,
  freezeRows: style.freeze?.rows ?? 0,
  freezeCols: style.freeze?.cols ?? 0,
  calendar: style.calendar ?? 0,
  valign: style.valignTable ?? 'top',
  zoom: style.zoom ?? 100,
  nowButton: style.nonow !== true,
  noteButton: style.nonotebutton === true ? false : style.notebutton === true ? true : null,
  superTable: style.super === true,
  views: style.views ?? [],
  unknownParts: style.unknown ?? [],
})

/** A column narrower than this, in px, gets narrow cells (`data-narrow`, YAZ-4791). */
export const NARROW_COLUMN = 56

/**
 * The cell attributes of ours that a cell's DOM carries: `data-fill` / `data-color` hold the colour
 * itself, and a custom one (`#rrggbb`) also goes in `style` for `table.css` (YAZ-3817), after GFM's
 * own style. A cell's own alignment (`data-align`) is the `text-align` in GFM's style in place of its
 * column's, so it wins on the page and in a copy to Docs (YAZ-3819). Then the column's goes in
 * `data-column-align`, so a paste in this app gives the column its own alignment back, not the cell's. A cell's own
 * vertical alignment (YAZ-4166) is `data-valign` and a `vertical-align` in its style, so it wins over the table's on
 * the page and goes with a copy to Docs. A folded row's cells carry `data-fold`, for a copy inside the app (YAZ-4165).
 * A cell in a column narrower than `NARROW_COLUMN` carries `data-narrow`: its padding is 4px, not 16px, so a column of
 * numbers can be dragged close to them (YAZ-4791).
 */
const cellDomAttrs = (node: ProseNode, base: Record<string, string>): Record<string, string> => {
  const out = { ...base }
  const fill = cellColor(node.attrs.fill)
  const color = cellColor(node.attrs.color)
  const align = cellAlign(node.attrs.align)
  const valign = cellValign(node.attrs.valign)
  // GFM's own style, less its `text-align` when the cell has its own.
  const style = (base.style ?? '').split(';').map((part) => part.trim()).filter((part) => part !== '' && (align === null || !part.startsWith('text-align')))
  if (fill !== null) out['data-fill'] = fill
  if (color !== null) out['data-color'] = color
  if (align !== null) {
    out['data-align'] = align
    out['data-column-align'] = (node.attrs.alignment as string | null) ?? 'left'
    style.unshift(`text-align: ${align}`)
  }
  if (valign !== null) {
    out['data-valign'] = valign
    style.push(`vertical-align: ${valign}`)
  }
  if (node.attrs.fold === true) out['data-fold'] = ''
  // The column's own Wrap or Clip (YAZ-4900): `table.css` clips by it over the table's and Settings'.
  const text = cellText(node.attrs.text)
  if (text !== null) out['data-cell-text'] = text
  if (node.attrs.nodim === true) out['data-nodim'] = ''
  if (node.attrs.subhead === true) out['data-subhead'] = ''
  const width = Array.isArray(node.attrs.colwidth) ? (node.attrs.colwidth[0] as number | undefined) : undefined
  if (typeof width === 'number' && width < NARROW_COLUMN) out['data-narrow'] = ''
  if (fill?.startsWith('#')) style.push(`--table-fill-custom: ${fill}`)
  if (color?.startsWith('#')) style.push(`--table-text-custom: ${color}`)
  const joined = style.filter(Boolean).join('; ')
  if (joined !== '') out.style = joined
  return out
}

interface CellData {
  tableCell?: {
    fill: string | null
    color: string | null
    align: string | null
    valign: string | null
    fold: boolean
    /** YAZ-4796: the row is never dimmed as past. */
    nodim?: boolean
    /** YAZ-4899: the row is a subheader row. */
    subhead?: boolean
    /** YAZ-4900: the column's own Wrap or Clip. */
    text?: CellText
    colwidth: number[] | null
    /** A merged cell's spans (YAZ-4792). */
    colspan?: number
    rowspan?: number
    /** The column's GFM alignment, given when a covered cell left the row, so the cells after it keep their column's. */
    alignment?: string | null
  }
}

/**
 * A cell schema with `fill` and `color` (YAZ-3696 D3 / D8; a name or `#rrggbb`, YAZ-3817) and its
 * own `align` (YAZ-3819): `null` by default, carried by `data-fill` / `data-color` / `data-align` on
 * the DOM (the column's alignment in `data-column-align`), and read from the cell's `data.tableCell`
 * on load. The runner is the app's own: it opens the cell with its alignment and our attributes, then one
 * paragraph for each run of inline content, and each list (YAZ-3818 D1, `cellLists.ts`) to its own runner.
 */
export function withCellStyle(spec: NodeSchema): NodeSchema {
  const toDOM = spec.toDOM!
  return {
    ...spec,
    attrs: { ...spec.attrs, fill: { default: null }, color: { default: null }, align: { default: null }, valign: { default: null }, fold: { default: false }, nodim: { default: false }, subhead: { default: false }, text: { default: null } },
    parseDOM: spec.parseDOM?.map((rule) => {
      const { getAttrs } = rule as TagParseRule
      return {
        ...rule,
        getAttrs: (dom: HTMLElement) => {
          const base = getAttrs ? getAttrs(dom) : {}
          if (base === false || base === null) return base
          const align = cellAlign(dom.getAttribute('data-align'))
          return {
            ...base,
            // GFM read the cell's own `text-align`: the column's is in `data-column-align`.
            ...(align !== null && { alignment: cellAlign(dom.getAttribute('data-column-align')) ?? base.alignment }),
            fill: cellColor(dom.getAttribute('data-fill')),
            color: cellColor(dom.getAttribute('data-color')),
            align,
            valign: cellValign(dom.getAttribute('data-valign')),
            fold: dom.hasAttribute('data-fold'),
            nodim: dom.hasAttribute('data-nodim'),
            subhead: dom.hasAttribute('data-subhead'),
            text: cellText(dom.getAttribute('data-cell-text')),
          }
        },
      }
    }),
    toDOM: (node) => {
      const [tag, attrs, hole] = toDOM(node) as [string, Record<string, string>, 0]
      return [tag, cellDomAttrs(node, attrs), hole]
    },
    parseMarkdown: {
      match: spec.parseMarkdown.match,
      runner: (state, node, type) => {
        const attrs = { alignment: node.align, ...(node.data as CellData | undefined)?.tableCell }
        state.openNode(type, attrs)
        // One line for each run of inline content; a list (YAZ-3818 D1, body cells only) goes to its own runner.
        // An empty cell is one empty line.
        let run: MarkdownNode[] = []
        let blocks = 0
        const line = () => {
          state.openNode(state.schema.nodes.paragraph).next(run).closeNode()
          run = []
        }
        for (const child of node.children ?? []) {
          if (child.type !== 'list') {
            run.push(child)
            continue
          }
          if (run.length > 0) line()
          state.next(child)
          blocks++
        }
        if (run.length > 0 || blocks === 0) line()
        state.closeNode()
      },
    },
  }
}

interface TableData {
  tableAttrs?: TableAttrs
}

const gridKey = (row: number, col: number): string => `${row},${col}`

/**
 * Put the settings on the mdast table: its own on `data.tableAttrs`, each cell's on `data.tableCell`.
 * Cells out of the table are dropped, and the freeze counts are kept inside it (YAZ-3769). A folded row's
 * cells get `fold` (YAZ-4165); a row out of the table is dropped. A merge the table can take (`validMerges`, and
 * every cell of it is in the file) gives its top-left cell `colspan` / `rowspan` and the widths of its columns, and
 * the cells it covers leave their rows (YAZ-4792); the cells of such a row get their column's GFM alignment, which
 * Milkdown's row runner would otherwise give by the cell's new index. A covered cell that holds text (the save writes
 * none, so a hand or an agent put it there) gives it to the merged cell, after a line break: no words are lost.
 */
function applyStyle(table: Table, style: TableStyle): void {
  const attrs = levelAttrs(style)
  const width = table.children[0]?.children.length ?? 0
  attrs.freezeRows = Math.min(attrs.freezeRows, table.children.length)
  attrs.freezeCols = Math.min(attrs.freezeCols, width)
  table.data = { ...table.data, tableAttrs: attrs } as Table['data']
  const folded = new Set(style.fold)
  const undimmed = new Set(style.nodim)
  const subheads = new Set(style.subhead)
  const spans = new Map<string, MergeRange>()
  /** Each covered cell's grid key → its merged cell's. */
  const covered = new Map<string, string>()
  for (const range of validMerges(style.merge ?? [], width, table.children.length)) {
    const cells: string[] = []
    for (let r = range.top; r < range.bottom; r++) for (let c = range.left; c < range.right; c++) cells.push(gridKey(r, c))
    if (!cells.every((key) => table.children[Number(key.split(',')[0])]!.children.length > Number(key.split(',')[1]))) continue
    spans.set(cells[0]!, range)
    for (const key of cells.slice(1)) covered.set(key, cells[0]!)
  }
  /** The merged cells of the mdast, by grid key: a covered cell's text (a hand edit, an agent's) joins them, never lost. */
  const merged = new Map<string, Table['children'][number]['children'][number]>()
  table.children.forEach((row, r) => {
    const fold = folded.has(r)
    const nodim = undimmed.has(r)
    const subhead = subheads.has(r)
    const short = row.children.some((_, c) => covered.has(gridKey(r, c)))
    row.children.forEach((cell, c) => {
      const into = covered.get(gridKey(r, c))
      if (into !== undefined) {
        const target = merged.get(into)
        if (target !== undefined && cell.children.length > 0) {
          if (target.children.length > 0) target.children.push({ type: 'html', value: '<br>' })
          target.children.push(...cell.children)
        }
        return
      }
      const span = spans.get(gridKey(r, c))
      if (span !== undefined) merged.set(gridKey(r, c), cell)
      const columns = span === undefined ? [c] : Array.from({ length: span.right - span.left }, (_, i) => span.left + i)
      const widths = columns.map((col) => style.widths[col] ?? 0)
      const colwidth = widths.some((w) => w > 0) ? widths : null
      const fill = style.fill.get(cellAddress(r, c)) ?? null
      const color = style.color.get(cellAddress(r, c)) ?? null
      const align = style.align.get(cellAddress(r, c)) ?? null
      const valign = style.valign.get(cellAddress(r, c)) ?? null
      // The column's own Wrap or Clip (YAZ-4900) on each of its cells; a merged cell takes its top-left column's.
      const text = style.text?.get(c)
      if (colwidth === null && fill === null && color === null && align === null && valign === null && !fold && !nodim && !subhead && text === undefined && span === undefined && !short) return
      const tableCell: NonNullable<CellData['tableCell']> = { fill, color, align, valign, fold, colwidth, ...(nodim && { nodim }), ...(subhead && { subhead }), ...(text !== undefined && { text }) }
      if (span !== undefined) Object.assign(tableCell, { colspan: span.right - span.left, rowspan: span.bottom - span.top })
      if (short) tableCell.alignment = table.align?.[c] ?? null
      cell.data = { ...cell.data, tableCell } as typeof cell.data
    })
    if (short) row.children = row.children.filter((_, c) => !covered.has(gridKey(r, c)))
  })
}

export const tableStyleRemark = $remark('mdapp-table-style', () => () => (tree) => {
  joinNextComment(tree as Nodes, 'table', parseTableComment, (table, style) => applyStyle(table as Table, style))
})

const tableStyleSchema = tableSchema.extendSchema((prev) => (ctx) => {
  const base = prev(ctx)
  return {
    ...base,
    attrs: Object.fromEntries(Object.entries(TABLE_DEFAULTS).map(([name, value]) => [name, { default: value }])),
    parseDOM: [{ tag: 'table', getAttrs: (dom) => readTableDom(dom as HTMLElement) }],
    toDOM: (node) => {
      // The freeze, the views (YAZ-4869) and the unknown parts (YAZ-4161) go with a copy only: `tableFreeze.ts` draws the freeze on the page from the attributes.
      const { freeze, unknown, views } = tableLevel(node.attrs)
      return [
        'table',
        {
          ...tableDomAttrs(node.attrs),
          ...(freeze && { 'data-table-freeze': `${freeze.rows} ${freeze.cols}` }),
          ...(views && { 'data-table-views': JSON.stringify(views) }),
          ...(unknown && { 'data-table-parts': JSON.stringify(unknown) }),
        },
        ['tbody', 0],
      ]
    },
    parseMarkdown: {
      match: base.parseMarkdown.match,
      // GFM's runner (each row gets the alignment, the first is the header), with our attributes.
      runner: (state, node, type) => {
        const align = node.align
        const children = (node.children ?? []).map((row, i) => ({ ...row, align, isHeader: i === 0 }))
        state.openNode(type, (node.data as TableData | undefined)?.tableAttrs)
        state.next(children)
        state.closeNode()
      },
    },
    toMarkdown: {
      match: base.toMarkdown.match,
      runner: (state, node) => {
        // The whole grid in the file (YAZ-4792); the comment names the merges from the node itself.
        base.toMarkdown.runner(state, fullGrid(node))
        const comment = formatTableComment(tableStyleOf(node))
        if (comment !== null) state.addNode('html', undefined, comment)
      },
    },
  }
})

const keepColumnAlignKey = new PluginKey('mdapp-keep-column-align')

/**
 * A body cell's GFM `alignment` follows the header cell of its grid column (YAZ-4792; the job of Milkdown's
 * `keepTableAlignPlugin`, which took the header row's child at the cell's own index and so, under a merged header
 * cell, another column's): after a change, each table in the changed range is walked through its map once.
 */
const keepColumnAlign = $prose(
  () =>
    new Plugin({
      key: keepColumnAlignKey,
      appendTransaction: (_, oldState, state) => {
        if (oldState.doc === state.doc) return null
        const from = oldState.doc.content.findDiffStart(state.doc.content)
        const diff = oldState.doc.content.findDiffEnd(state.doc.content)
        if (from === null || diff === null) return null
        let tr: Transaction | null = null
        for (const [pos, table] of tablesBetween(state.doc, from, Math.max(diff.b, from), new Map())) {
          const map = TableMap.get(table)
          if (map.problems !== null) continue
          const seen = new Set<number>()
          map.map.forEach((cellPos, i) => {
            if (i < map.width || seen.has(cellPos)) return
            seen.add(cellPos)
            const cell = table.nodeAt(cellPos)
            if (cell?.type.name !== 'table_cell') return
            const header = table.nodeAt(map.map[i % map.width]!)
            // The column's own Wrap or Clip (YAZ-4900) is the header cell's too: a new row's cells take it the same way.
            if (header === null || (header.attrs.alignment === cell.attrs.alignment && header.attrs.text === cell.attrs.text)) return
            tr ??= state.tr
            tr.setNodeMarkup(pos + 1 + cellPos, undefined, { ...cell.attrs, alignment: header.attrs.alignment, text: header.attrs.text })
          })
        }
        return tr
      },
    }),
)

/** Each table between `from` and `to`, by position, into `out`; a table's cells are not walked. */
function tablesBetween(doc: ProseNode, from: number, to: number, out: Map<number, ProseNode>): Map<number, ProseNode> {
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name !== 'table') return !node.isTextblock
    out.set(pos, node)
    return false
  })
  return out
}

/**
 * The tables a transaction changed, by position in `tr.doc`: those in each step's changed range, and
 * the node of each attribute-only step (`setNodeAttribute`), whose step map is empty (YAZ-3696).
 */
export function changedTables(tr: Transaction): Map<number, ProseNode> {
  const out = new Map<number, ProseNode>()
  tr.steps.forEach((step, i) => {
    const rest = tr.mapping.slice(i + 1)
    if (step instanceof AttrStep) {
      const pos = rest.map(step.pos)
      tablesBetween(tr.doc, pos, pos + 1, out)
    } else tr.mapping.maps[i]!.forEach((_a, _b, start, end) => tablesBetween(tr.doc, rest.map(start, -1), rest.map(end, 1), out))
  })
  return out
}

/**
 * Typing: each step changes only the inline content of one textblock. Every node decoration maps,
 * and no table changes its attributes or its shape (YAZ-3790; here and in `tableFreeze.ts`).
 */
export const typingOnly = (tr: Transaction): boolean =>
  tr.steps.every((step, i) => {
    if (!(step instanceof ReplaceStep) || step.slice.openStart > 0 || step.slice.openEnd > 0) return false
    const $from = tr.docs[i]!.resolve(step.from)
    return $from.parent.isTextblock && step.to <= $from.end()
  })

/**
 * On the table block of a table whose EVERY column has a width (YAZ-4783): prosemirror-tables then gives the `<table>` a
 * fixed width, the sum of its columns, and the table keeps it whatever the note's or Settings' table width
 * (`--table-width`, app.css). A table with a column at `auto` takes that width, its sized columns keeping theirs.
 */
export const TABLE_SIZED_ATTR = 'data-table-sized'

/** Every column has a width: prosemirror-tables' own test (its first row's cells, each spanned column). */
function everyColumnSized(table: ProseNode): boolean {
  const row = table.firstChild
  if (row === null || row.childCount === 0) return false
  let sized = true
  row.forEach((cell) => {
    const widths: unknown = cell.attrs.colwidth
    for (let j = 0; j < ((cell.attrs.colspan as number | undefined) ?? 1); j++) if (!(Array.isArray(widths) && typeof widths[j] === 'number' && widths[j] > 0)) sized = false
  })
  return sized
}

/** The node decoration of a table with settings, or with a width on every column (YAZ-4783), or `null`. */
function tableDecoration(table: ProseNode, pos: number): Decoration | null {
  const own = tableDomAttrs(table.attrs)
  const attrs = everyColumnSized(table) ? { ...own, [TABLE_SIZED_ATTR]: '' } : own
  return attrs === null ? null : Decoration.node(pos, pos + table.nodeSize, attrs)
}

const tableStyleKey = new PluginKey<DecorationSet>('mdapp-table-style')

/**
 * The table block's data attributes: a transaction that changes no document does nothing; typing
 * only maps the set; any other maps it and builds again only the changed tables. A table's own
 * decoration starts at the table: `find` also gives the decoration of a table that only touches it,
 * which stays.
 */
const tableStylePlugin = $prose(
  () =>
    new Plugin<DecorationSet>({
      key: tableStyleKey,
      state: {
        init: (_, { doc }) => {
          const decorations = [...tablesBetween(doc, 0, doc.content.size, new Map())].map(([pos, node]) => tableDecoration(node, pos))
          return DecorationSet.create(doc, decorations.filter((deco) => deco !== null))
        },
        apply: (tr, set) => {
          if (!tr.docChanged) return set
          let next = set.map(tr.mapping, tr.doc)
          // A key changes no table's attributes: the mapped set holds (no new decoration per key, YAZ-3792).
          if (typingOnly(tr)) return next
          const tables = changedTables(tr)
          if (tables.size === 0) return next
          const stale = [...tables.keys()].flatMap((pos) => next.find(pos, pos).filter((deco) => deco.from === pos))
          const fresh = [...tables].map(([pos, node]) => tableDecoration(node, pos)).filter((deco) => deco !== null)
          if (stale.length > 0) next = next.remove(stale)
          return fresh.length > 0 ? next.add(tr.doc, fresh) : next
        },
      },
      props: { decorations: (state) => tableStyleKey.getState(state) },
    }),
)

/** Register with `editor.use(tableStyle)`, right after `lineStyle` in createCrepe, which removes Milkdown's `keepTableAlignPlugin` for `keepColumnAlign`. */
export const tableStyle = [tableStyleRemark, tableStyleSchema, tableStylePlugin, keepColumnAlign].flat()
