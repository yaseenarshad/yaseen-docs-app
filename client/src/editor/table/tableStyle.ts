/**
 * The table's settings in the file (YAZ-3758, YAZ-3696 🔒 D1 / D3 / D7 / S3; CONTRACTS rule 41a).
 * The `table` node gets seven attributes, each at its default on a plain table: `border` (`null` or
 * `{ px, darkness }`), `header` (`shaded` | `plain`), `stripes`, `height` (`compact` | `normal` |
 * `tall`), `wrap`, `freezeRows` and `freezeCols`. A column's alignment is the cells' own GFM
 * `alignment` (the `:-` row), not ours (YAZ-3767). Each
 * cell gets `fill`, `color` and its own `align` (`withCellStyle`, used by `inlineBreaks.ts`'s `cellSchemas`), and a
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
 * VIEW: the table block (`@milkdown/components` table-block) is a node view that builds its own
 * DOM, so the table's `toDOM` never reaches the page. `tableStylePlugin` puts the same data
 * attributes and custom properties that `toDOM` writes on the block's `div.milkdown-table-block`,
 * by a node decoration that depends on the attributes only. Cells render through their own
 * `toDOM`, so `data-fill` / `data-color` are on the page as they are. `table.css` draws them.
 * `changedTables` gives the tables a transaction changed, here and in `tableFreeze.ts`.
 */
import { tableSchema } from '@milkdown/kit/preset/gfm'
import type { Node as ProseNode, TagParseRule } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, type Transaction } from '@milkdown/kit/prose/state'
import { AttrStep, ReplaceStep } from '@milkdown/kit/prose/transform'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import type { NodeSchema } from '@milkdown/kit/transformer'
import { $prose, $remark } from '@milkdown/kit/utils'
import type { Nodes, Table } from 'mdast'
import { joinNextComment } from '../joinComment'
import { BORDER_PX_MAX, WIDTH_MAX, cellAddress, cellAlign, cellColor, formatTableComment, parseTableComment, plainTable, type TableStyle } from './tableComment'
import './table.css'

export * from './tableComment'

/** The table node's attributes, at their defaults. */
export const TABLE_DEFAULTS = {
  border: null as { px: number; darkness: number } | null,
  header: 'shaded' as 'shaded' | 'plain',
  stripes: false,
  height: 'normal' as 'compact' | 'normal' | 'tall',
  wrap: true,
  freezeRows: 0,
  freezeCols: 0,
}
export type TableAttrs = typeof TABLE_DEFAULTS

const isWhole = (n: unknown, min: number, max: number): n is number => Number.isInteger(n) && (n as number) >= min && (n as number) <= max

/** The table-level parts of the node's attributes, every value checked: an unknown value is the default. */
function tableLevel(attrs: Record<string, unknown>): Omit<TableStyle, 'widths' | 'fill' | 'color' | 'align'> {
  const out: Omit<TableStyle, 'widths' | 'fill' | 'color' | 'align'> = {}
  const border = attrs.border as { px?: unknown; darkness?: unknown } | null
  if (border && isWhole(border.px, 0, BORDER_PX_MAX) && isWhole(border.darkness, 0, 100)) out.border = { px: border.px, darkness: border.darkness }
  if (attrs.header === 'plain') out.header = 'plain'
  if (attrs.stripes === true) out.stripes = true
  if (attrs.height === 'compact' || attrs.height === 'tall') out.height = attrs.height
  if (attrs.wrap === false) out.nowrap = true
  const rows = isWhole(attrs.freezeRows, 1, 999) ? attrs.freezeRows : 0
  const cols = isWhole(attrs.freezeCols, 1, 999) ? attrs.freezeCols : 0
  if (rows > 0 || cols > 0) out.freeze = { rows, cols }
  return out
}

/** A column's width from a cell's `colwidth`: whole px (a drag can leave a fraction), or `null`. */
const widthOf = (cell: ProseNode): number | null => {
  const w = (cell.attrs.colwidth as number[] | null)?.[0]
  return typeof w === 'number' && w >= 1 ? Math.min(Math.round(w), WIDTH_MAX) : null
}

/** A table node's settings, every value checked. Rows and columns are the node's own, row 1 the header row. */
function tableStyleOf(table: ProseNode): TableStyle {
  const style: TableStyle = { ...plainTable(), ...tableLevel(table.attrs) }
  table.forEach((row, _, r) => {
    row.forEach((cell, __, c) => {
      if (r === 0) style.widths.push(widthOf(cell))
      const fill = cellColor(cell.attrs.fill)
      const color = cellColor(cell.attrs.color)
      const align = cellAlign(cell.attrs.align)
      if (fill !== null) style.fill.set(cellAddress(r, c), fill)
      if (color !== null) style.color.set(cellAddress(r, c), color)
      if (align !== null) style.align.set(cellAddress(r, c), align)
    })
  })
  return style
}

/** The DOM attributes of the table-level parts on the table block and on a copy's `<table>` (`toDOM` adds the freeze). `null` for none. */
function tableDomAttrs(attrs: Record<string, unknown>): Record<string, string> | null {
  const level = tableLevel(attrs)
  const out: Record<string, string> = {}
  if (level.border) out.style = `--table-border-width: ${level.border.px}px; --table-border-darkness: ${level.border.darkness}%`
  if (level.header) out['data-table-header'] = level.header
  if (level.stripes) out['data-table-stripes'] = ''
  if (level.height) out['data-table-height'] = level.height
  if (level.nowrap) out['data-table-nowrap'] = ''
  return Object.keys(out).length === 0 ? null : out
}

/** `tableDomAttrs` read back from a pasted `<table>`. */
function readTableDom(dom: HTMLElement): Partial<TableAttrs> {
  const style = dom.getAttribute('style') ?? ''
  const px = /--table-border-width:\s*(\d+)px/.exec(style)?.[1]
  const darkness = /--table-border-darkness:\s*(\d+)%/.exec(style)?.[1]
  const [rows, cols] = (dom.getAttribute('data-table-freeze') ?? '').split(' ').map(Number)
  const raw = {
    border: px !== undefined && darkness !== undefined ? { px: Number(px), darkness: Number(darkness) } : null,
    header: dom.getAttribute('data-table-header'),
    stripes: dom.hasAttribute('data-table-stripes'),
    height: dom.getAttribute('data-table-height'),
    wrap: !dom.hasAttribute('data-table-nowrap'),
    freezeRows: rows,
    freezeCols: cols,
  }
  return levelAttrs(tableLevel(raw))
}

/** The node attributes for table-level parts. */
const levelAttrs = (style: Omit<TableStyle, 'widths' | 'fill' | 'color' | 'align'>): TableAttrs => ({
  border: style.border ?? null,
  header: style.header ?? 'shaded',
  stripes: style.stripes === true,
  height: style.height ?? 'normal',
  wrap: style.nowrap !== true,
  freezeRows: style.freeze?.rows ?? 0,
  freezeCols: style.freeze?.cols ?? 0,
})

/**
 * The cell attributes of ours that a cell's DOM carries: `data-fill` / `data-color` hold the colour
 * itself, and a custom one (`#rrggbb`) also goes in `style` for `table.css` (YAZ-3817), after GFM's
 * own style. A cell's own alignment (`data-align`) is the `text-align` in GFM's style in place of its
 * column's, so it wins on the page and in a copy to Docs (YAZ-3819). Then the column's goes in
 * `data-column-align`, so a paste in this app gives the column its own alignment back, not the cell's.
 */
const cellDomAttrs = (node: ProseNode, base: Record<string, string>): Record<string, string> => {
  const out = { ...base }
  const fill = cellColor(node.attrs.fill)
  const color = cellColor(node.attrs.color)
  const align = cellAlign(node.attrs.align)
  // GFM's own style, less its `text-align` when the cell has its own.
  const style = (base.style ?? '').split(';').map((part) => part.trim()).filter((part) => part !== '' && (align === null || !part.startsWith('text-align')))
  if (fill !== null) out['data-fill'] = fill
  if (color !== null) out['data-color'] = color
  if (align !== null) {
    out['data-align'] = align
    out['data-column-align'] = (node.attrs.alignment as string | null) ?? 'left'
    style.unshift(`text-align: ${align}`)
  }
  if (fill?.startsWith('#')) style.push(`--table-fill-custom: ${fill}`)
  if (color?.startsWith('#')) style.push(`--table-text-custom: ${color}`)
  const joined = style.filter(Boolean).join('; ')
  if (joined !== '') out.style = joined
  return out
}

interface CellData {
  tableCell?: { fill: string | null; color: string | null; align: string | null; colwidth: number[] | null }
}

/**
 * A cell schema with `fill` and `color` (YAZ-3696 D3 / D8; a name or `#rrggbb`, YAZ-3817) and its
 * own `align` (YAZ-3819): `null` by default, carried by `data-fill` / `data-color` / `data-align` on
 * the DOM (the column's alignment in `data-column-align`), and read from the cell's `data.tableCell`
 * on load. The runner is GFM's (open the cell with its alignment, then its paragraph), with our attributes.
 */
export function withCellStyle(spec: NodeSchema): NodeSchema {
  const toDOM = spec.toDOM!
  return {
    ...spec,
    attrs: { ...spec.attrs, fill: { default: null }, color: { default: null }, align: { default: null } },
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
        state.openNode(type, attrs).openNode(state.schema.nodes.paragraph).next(node.children).closeNode().closeNode()
      },
    },
  }
}

interface TableData {
  tableAttrs?: TableAttrs
}

/**
 * Put the settings on the mdast table: its own on `data.tableAttrs`, each cell's on `data.tableCell`.
 * Cells out of the table are dropped, and the freeze counts are kept inside it (YAZ-3769).
 */
function applyStyle(table: Table, style: TableStyle): void {
  const attrs = levelAttrs(style)
  attrs.freezeRows = Math.min(attrs.freezeRows, table.children.length)
  attrs.freezeCols = Math.min(attrs.freezeCols, table.children[0]?.children.length ?? 0)
  table.data = { ...table.data, tableAttrs: attrs } as Table['data']
  table.children.forEach((row, r) => {
    row.children.forEach((cell, c) => {
      const width = style.widths[c] ?? null
      const fill = style.fill.get(cellAddress(r, c)) ?? null
      const color = style.color.get(cellAddress(r, c)) ?? null
      const align = style.align.get(cellAddress(r, c)) ?? null
      if (width === null && fill === null && color === null && align === null) return
      cell.data = { ...cell.data, tableCell: { fill, color, align, colwidth: width === null ? null : [width] } } as typeof cell.data
    })
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
      // The freeze goes with a copy only: `tableFreeze.ts` draws it on the page from the attributes.
      const { freeze } = tableLevel(node.attrs)
      return ['table', { ...tableDomAttrs(node.attrs), ...(freeze && { 'data-table-freeze': `${freeze.rows} ${freeze.cols}` }) }, ['tbody', 0]]
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
        base.toMarkdown.runner(state, node)
        const comment = formatTableComment(tableStyleOf(node))
        if (comment !== null) state.addNode('html', undefined, comment)
      },
    },
  }
})

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

/** The node decoration of a table with settings, or `null`. */
function tableDecoration(table: ProseNode, pos: number): Decoration | null {
  const attrs = tableDomAttrs(table.attrs)
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

/** Register with `editor.use(tableStyle)`, right after `lineStyle` in createCrepe. */
export const tableStyle = [tableStyleRemark, tableStyleSchema, tableStylePlugin].flat()
