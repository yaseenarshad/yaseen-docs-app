/**
 * The table's settings in the file (YAZ-3758, YAZ-3696 🔒 D1 / D3 / D7 / S3; CONTRACTS rule 41a).
 * The `table` node gets eight attributes, each at its default on a plain table: `border` (`null` or
 * `{ px, darkness }`), `header` (`shaded` | `plain`), `align` (`null` or "Align all columns"),
 * `stripes`, `height` (`compact` | `normal` | `tall`), `wrap`, `freezeRows` and `freezeCols`. Each
 * cell gets `fill` and `color` (`withCellStyle`, used by `inlineBreaks.ts`'s `cellSchemas`), and a
 * column's width is the cells' own `colwidth` (prosemirror-tables). Markdown has no syntax for any.
 *
 * ON DISK a plain table is the GFM table, exactly the bytes of before (R5). A table with settings
 * is the table, then an HTML comment as the NEXT block: `<!-- table: widths 140 auto, fill A1:B1
 * blue, stripes -->` (`tableComment.ts` reads and writes it). Obsidian and GitHub hide it and show
 * a plain table.
 *
 * LOAD: `tableStyleRemark` walks every container and joins a `table` with its NEXT sibling when
 * that sibling is our comment — a bare `html` node, or the paragraph Milkdown's
 * `remarkHtmlTransformer` wraps a block `html` in — as `lineStyle.ts` does for `***`. The table's
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
 */
import { tableSchema } from '@milkdown/kit/preset/gfm'
import type { Node as ProseNode, TagParseRule } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import type { NodeSchema } from '@milkdown/kit/transformer'
import { $prose, $remark } from '@milkdown/kit/utils'
import type { Nodes, Parent, RootContent, Table } from 'mdast'
import {
  ALIGNS,
  BORDER_PX_MAX,
  FILL_COLORS,
  TEXT_COLORS,
  WIDTH_MAX,
  cellAddress,
  formatTableComment,
  parseTableComment,
  plainTable,
  type FillColor,
  type TableAlign,
  type TableStyle,
  type TextColor,
} from './tableComment'
import './table.css'

export * from './tableComment'

/** The table node's attributes, at their defaults. */
export const TABLE_DEFAULTS = {
  border: null as { px: number; darkness: number } | null,
  header: 'shaded' as 'shaded' | 'plain',
  align: null as TableAlign | null,
  stripes: false,
  height: 'normal' as 'compact' | 'normal' | 'tall',
  wrap: true,
  freezeRows: 0,
  freezeCols: 0,
}
export type TableAttrs = typeof TABLE_DEFAULTS

const isWhole = (n: unknown, min: number, max: number): n is number => Number.isInteger(n) && (n as number) >= min && (n as number) <= max

/** The table-level parts of the node's attributes, every value checked: an unknown value is the default. */
function tableLevel(attrs: Record<string, unknown>): Omit<TableStyle, 'widths' | 'fill' | 'color'> {
  const out: Omit<TableStyle, 'widths' | 'fill' | 'color'> = {}
  const border = attrs.border as { px?: unknown; darkness?: unknown } | null
  if (border && isWhole(border.px, 0, BORDER_PX_MAX) && isWhole(border.darkness, 0, 100)) out.border = { px: border.px, darkness: border.darkness }
  if (attrs.header === 'plain') out.header = 'plain'
  if (ALIGNS.includes(attrs.align as TableAlign)) out.align = attrs.align as TableAlign
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
export function tableStyleOf(table: ProseNode): TableStyle {
  const style: TableStyle = { ...plainTable(), ...tableLevel(table.attrs) }
  table.forEach((row, _, r) => {
    row.forEach((cell, __, c) => {
      if (r === 0) style.widths.push(widthOf(cell))
      const { fill, color } = cell.attrs
      if (FILL_COLORS.includes(fill)) style.fill.set(cellAddress(r, c), fill as FillColor)
      if (TEXT_COLORS.includes(color)) style.color.set(cellAddress(r, c), color as TextColor)
    })
  })
  return style
}

/** The DOM attributes of the table-level parts: on a copy's `<table>` and on the table block. `null` for none. */
export function tableDomAttrs(attrs: Record<string, unknown>): Record<string, string> | null {
  const level = tableLevel(attrs)
  const out: Record<string, string> = {}
  if (level.border) out.style = `--table-border-width: ${level.border.px}px; --table-border-darkness: ${level.border.darkness}%`
  if (level.header) out['data-table-header'] = level.header
  if (level.align) out['data-table-align'] = level.align
  if (level.stripes) out['data-table-stripes'] = ''
  if (level.height) out['data-table-height'] = level.height
  if (level.nowrap) out['data-table-nowrap'] = ''
  if (level.freeze) out['data-table-freeze'] = `${level.freeze.rows} ${level.freeze.cols}`
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
    align: dom.getAttribute('data-table-align'),
    stripes: dom.hasAttribute('data-table-stripes'),
    height: dom.getAttribute('data-table-height'),
    wrap: !dom.hasAttribute('data-table-nowrap'),
    freezeRows: rows,
    freezeCols: cols,
  }
  return levelAttrs(tableLevel(raw))
}

/** The node attributes for table-level parts. */
const levelAttrs = (style: Omit<TableStyle, 'widths' | 'fill' | 'color'>): TableAttrs => ({
  border: style.border ?? null,
  header: style.header ?? 'shaded',
  align: style.align ?? null,
  stripes: style.stripes === true,
  height: style.height ?? 'normal',
  wrap: style.nowrap !== true,
  freezeRows: style.freeze?.rows ?? 0,
  freezeCols: style.freeze?.cols ?? 0,
})

/** The cell attributes of ours that a cell's DOM carries. */
const cellDomAttrs = (node: ProseNode): Record<string, string> => {
  const out: Record<string, string> = {}
  if (FILL_COLORS.includes(node.attrs.fill)) out['data-fill'] = node.attrs.fill
  if (TEXT_COLORS.includes(node.attrs.color)) out['data-color'] = node.attrs.color
  return out
}

interface CellData {
  tableCell?: { fill: FillColor | null; color: TextColor | null; colwidth: number[] | null }
}

/**
 * A cell schema with `fill` and `color` (YAZ-3696 D3 / D8): `null` by default, carried by
 * `data-fill` / `data-color` on the DOM, and read from the cell's `data.tableCell` on load. The
 * runner is GFM's (open the cell with its alignment, then its paragraph), with our attributes.
 */
export function withCellStyle(spec: NodeSchema): NodeSchema {
  const toDOM = spec.toDOM!
  return {
    ...spec,
    attrs: { ...spec.attrs, fill: { default: null }, color: { default: null } },
    parseDOM: spec.parseDOM?.map((rule) => {
      const { getAttrs } = rule as TagParseRule
      return {
        ...rule,
        getAttrs: (dom: HTMLElement) => {
          const base = getAttrs ? getAttrs(dom) : {}
          if (base === false || base === null) return base
          const fill = dom.getAttribute('data-fill')
          const color = dom.getAttribute('data-color')
          return {
            ...base,
            fill: FILL_COLORS.includes(fill as FillColor) ? fill : null,
            color: TEXT_COLORS.includes(color as TextColor) ? color : null,
          }
        },
      }
    }),
    toDOM: (node) => {
      const [tag, attrs, hole] = toDOM(node) as [string, Record<string, string>, 0]
      return [tag, { ...attrs, ...cellDomAttrs(node) }, hole]
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

/** The comment a block holds, when the block is nothing but our comment: a bare `html`, or a paragraph wrapping only one. */
const commentStyle = (node: RootContent | undefined): TableStyle | null => {
  if (node === undefined) return null
  if (node.type === 'html') return parseTableComment(node.value)
  if (node.type !== 'paragraph' || node.children.length !== 1) return null
  const only = node.children[0]
  return only.type === 'html' ? parseTableComment(only.value) : null
}

interface TableData {
  tableAttrs?: TableAttrs
}

/** Put the settings on the mdast table: its own on `data.tableAttrs`, each cell's on `data.tableCell`. Cells out of the table are dropped. */
function applyStyle(table: Table, style: TableStyle): void {
  table.data = { ...table.data, tableAttrs: levelAttrs(style) } as Table['data']
  table.children.forEach((row, r) => {
    row.children.forEach((cell, c) => {
      const width = style.widths[c] ?? null
      const fill = style.fill.get(cellAddress(r, c)) ?? null
      const color = style.color.get(cellAddress(r, c)) ?? null
      if (width === null && fill === null && color === null) return
      cell.data = { ...cell.data, tableCell: { fill, color, colwidth: width === null ? null : [width] } } as typeof cell.data
    })
  })
}

/** Every container, depth first: join each `table` with the comment right after it. */
const joinComments = (node: Nodes): void => {
  if (!('children' in node)) return
  const parent = node as Parent
  for (let i = 0; i < parent.children.length; i++) {
    const child = parent.children[i]
    if (child.type === 'table') {
      const style = commentStyle(parent.children[i + 1])
      if (style !== null) {
        applyStyle(child, style)
        parent.children.splice(i + 1, 1)
      }
    } else joinComments(child)
  }
}

export const tableStyleRemark = $remark('mdapp-table-style', () => () => (tree) => {
  joinComments(tree as Nodes)
})

export const tableStyleSchema = tableSchema.extendSchema((prev) => (ctx) => {
  const base = prev(ctx)
  return {
    ...base,
    attrs: Object.fromEntries(Object.entries(TABLE_DEFAULTS).map(([name, value]) => [name, { default: value }])),
    parseDOM: [{ tag: 'table', getAttrs: (dom) => readTableDom(dom as HTMLElement) }],
    toDOM: (node) => ['table', tableDomAttrs(node.attrs) ?? {}, ['tbody', 0]],
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

/** The node decoration of each table with settings, from `from` to `to`; a table's cells are not walked. */
function tableDecorations(doc: ProseNode, from: number, to: number, out: Map<number, Decoration>): void {
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name !== 'table') return !node.isTextblock
    const attrs = tableDomAttrs(node.attrs)
    if (attrs !== null) out.set(pos, Decoration.node(pos, pos + node.nodeSize, attrs))
    return false
  })
}

const tableStyleKey = new PluginKey<DecorationSet>('mdapp-table-style')

/**
 * The table block's data attributes: a transaction that changes no document does nothing; one that
 * does maps the set and builds again only the tables in the changed ranges.
 */
export const tableStylePlugin = $prose(
  () =>
    new Plugin<DecorationSet>({
      key: tableStyleKey,
      state: {
        init: (_, { doc }) => {
          const out = new Map<number, Decoration>()
          tableDecorations(doc, 0, doc.content.size, out)
          return DecorationSet.create(doc, [...out.values()])
        },
        apply: (tr, set) => {
          if (!tr.docChanged) return set
          let next = set.map(tr.mapping, tr.doc)
          const stale = new Set<Decoration>()
          const fresh = new Map<number, Decoration>()
          tr.mapping.maps.forEach((map, i) => {
            const rest = tr.mapping.slice(i + 1)
            map.forEach((_a, _b, start, end) => {
              const from = rest.map(start, -1)
              const to = rest.map(end, 1)
              for (const deco of next.find(from, to)) stale.add(deco)
              tableDecorations(tr.doc, from, to, fresh)
            })
          })
          // A table that only touches a changed range (text typed right after it) is built again too.
          for (const deco of stale) tableDecorations(tr.doc, deco.from, deco.to, fresh)
          if (stale.size > 0) next = next.remove([...stale])
          return fresh.size > 0 ? next.add(tr.doc, [...fresh.values()]) : next
        },
      },
      props: { decorations: (state) => tableStyleKey.getState(state) },
    }),
)

/** Register with `editor.use(tableStyle)`, right after `lineStyle` in createCrepe. */
export const tableStyle = [tableStyleRemark, tableStyleSchema, tableStylePlugin].flat()
