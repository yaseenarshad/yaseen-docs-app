/**
 * Frozen rows and columns of a note table (YAZ-3769, YAZ-3696 🔒 S3): `freezeRows` rows from the
 * top and `freezeCols` columns from the left (`tableStyle.ts`), set from the right-click menu
 * (`tableMenu.ts`).
 *
 * THE COUNTS stay inside the table: a transaction that leaves a table smaller than its counts gets
 * them clamped in an appended transaction (one undo step with the delete), and a file's counts are
 * clamped on load (`tableStyle.ts`).
 *
 * DECORATIONS, from the attributes only (so no table redraw, B4): each frozen row gets
 * `table-frozen-row`; each cell of a frozen column gets `table-frozen-col` and `left:
 * var(--table-frozen-x-<column>)`. A transaction that changes the document builds them again only
 * for the tables in its changed ranges. A table-level decoration with no attributes marks each
 * frozen table for the view below.
 *
 * THE VIEW, one listener set per frozen table, on the table block's own DOM
 * (`div.milkdown-table-block`, the sideways scroll box; never ProseMirror's content DOM):
 * - Columns stick with CSS (`position: sticky` inside the sideways scroll). Their `left` offsets are
 *   the widths of the columns before them, measured when the table changes or resizes (a
 *   `ResizeObserver`), never on scroll, and set as `--table-frozen-x-<n>` on the block.
 * - Rows use the folder page's method (`lib/pinnedHeader.ts`): on a scroll of the note's vertical
 *   scroller (passive, one update per animation frame) and on a resize, the offset that keeps the
 *   frozen rows at the scroller's top, stopped at the table's end, goes in `--table-frozen-y`;
 *   CSS translates the rows by it. Layout px: divided by the document zoom, as the folder page does.
 * An unfrozen or removed table drops its listeners and its custom properties.
 */
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { cssZoom } from '../../lib/cssZoom'
import { pinnedHeaderOffset, verticalScrollParent } from '../../lib/pinnedHeader'

/** A table's freeze counts, inside the table. */
function counts(table: ProseNode): { rows: number; cols: number } {
  const rows = Math.min(table.attrs.freezeRows as number, table.childCount)
  const cols = Math.min(table.attrs.freezeCols as number, table.firstChild?.childCount ?? 0)
  return { rows: Math.max(0, rows), cols: Math.max(0, cols) }
}

const overCounts = (table: ProseNode): boolean => {
  const { rows, cols } = counts(table)
  return rows !== table.attrs.freezeRows || cols !== table.attrs.freezeCols
}

/** The decorations of one table: none when nothing is frozen. */
function frozenDecorations(table: ProseNode, pos: number): Decoration[] {
  const { rows, cols } = counts(table)
  if (rows === 0 && cols === 0) return []
  const out = [Decoration.node(pos, pos + table.nodeSize, {}, { frozenTable: true })]
  table.forEach((row, rowOffset, r) => {
    const rowPos = pos + 1 + rowOffset
    if (r < rows) out.push(Decoration.node(rowPos, rowPos + row.nodeSize, { class: 'table-frozen-row' }))
    row.forEach((cell, cellOffset, c) => {
      if (c >= cols) return
      const cellPos = rowPos + 1 + cellOffset
      out.push(Decoration.node(cellPos, cellPos + cell.nodeSize, { class: 'table-frozen-col', style: `left: var(--table-frozen-x-${c}, 0px)` }))
    })
  })
  return out
}

/** Each table in `doc` between `from` and `to`, by position; a table's cells are not walked. */
function tablesBetween(doc: ProseNode, from: number, to: number, out: Map<number, ProseNode>): void {
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name !== 'table') return !node.isTextblock
    out.set(pos, node)
    return false
  })
}

interface FreezeState {
  set: DecorationSet
  /** Tables whose counts are bigger than the table, by position: the appended transaction clamps them. */
  over: number[]
}

const freezeKey = new PluginKey<FreezeState>('mdapp-table-freeze')

/** One frozen table's listeners and custom properties, on its table block. */
class Freezer {
  node: ProseNode | null = null
  #rows = 0
  #cols = 0
  #frame = 0
  #scroller: HTMLElement | null = null
  #observer: ResizeObserver | null = null

  constructor(readonly block: HTMLElement) {}

  /** The table's `<tbody>` (the content DOM) and its `<table>`. */
  #parts(): { body: HTMLTableSectionElement; table: HTMLElement } | null {
    const body = this.block.querySelector<HTMLTableSectionElement>('tbody[data-content-dom]')
    const table = body?.parentElement
    return body && table ? { body, table } : null
  }

  set(node: ProseNode): void {
    if (node === this.node) return
    this.node = node
    const { rows, cols } = counts(node)
    for (let c = cols; c < this.#cols; c++) this.block.style.removeProperty(`--table-frozen-x-${c}`)
    if (this.#observer === null) {
      this.#observer = new ResizeObserver(this.#schedule)
      const table = this.#parts()?.table
      if (table) this.#observer.observe(table)
    }
    if (rows === 0) this.#unlistenRows()
    else if (this.#scroller === null) {
      this.#scroller = verticalScrollParent(this.block)
      this.#scroller?.addEventListener('scroll', this.#schedule, { passive: true })
      if (this.#scroller !== null) this.#observer.observe(this.#scroller)
    }
    this.#rows = rows
    this.#cols = cols
    this.#schedule()
  }

  #unlistenRows(): void {
    if (this.#scroller !== null) {
      this.#scroller.removeEventListener('scroll', this.#schedule)
      this.#observer?.unobserve(this.#scroller)
    }
    this.#scroller = null
    this.block.style.removeProperty('--table-frozen-y')
  }

  #schedule = (): void => {
    if (this.#frame === 0) this.#frame = requestAnimationFrame(this.#sync)
  }

  #sync = (): void => {
    this.#frame = 0
    const parts = this.#parts()
    if (parts === null) return
    const first = parts.body.rows[0]
    let left = 0
    for (let c = 0; c < this.#cols; c++) {
      this.block.style.setProperty(`--table-frozen-x-${c}`, `${left}px`)
      left += (first?.cells[c] as HTMLElement | undefined)?.offsetWidth ?? 0
    }
    const scroller = this.#scroller
    const rows = parts.body.rows
    if (this.#rows === 0 || scroller === null || rows.length < this.#rows) return
    const zoom = cssZoom(this.block)
    const frozenHeight = rows[this.#rows - 1].getBoundingClientRect().bottom - rows[0].getBoundingClientRect().top
    const tableRect = parts.table.getBoundingClientRect()
    const scrollerTop = scroller.getBoundingClientRect().top + scroller.clientTop * zoom
    const offset = pinnedHeaderOffset(scrollerTop, tableRect.top, tableRect.height, frozenHeight) / zoom
    this.block.style.setProperty('--table-frozen-y', `${offset}px`)
  }

  destroy(): void {
    this.#unlistenRows()
    this.#observer?.disconnect()
    this.#observer = null
    if (this.#frame !== 0) cancelAnimationFrame(this.#frame)
    this.#frame = 0
    for (let c = 0; c < this.#cols; c++) this.block.style.removeProperty(`--table-frozen-x-${c}`)
  }
}

class FreezeView {
  #tables = new Map<HTMLElement, Freezer>()

  constructor(view: EditorView) {
    this.update(view)
  }

  update(view: EditorView, prev?: EditorState): void {
    const state = freezeKey.getState(view.state)!
    if (prev !== undefined && freezeKey.getState(prev) === state) return
    const live = new Map<HTMLElement, ProseNode>()
    for (const deco of state.set.find(undefined, undefined, (spec) => spec.frozenTable === true)) {
      const dom = view.nodeDOM(deco.from)
      const node = view.state.doc.nodeAt(deco.from)
      if (dom instanceof HTMLElement && node !== null) live.set(dom, node)
    }
    for (const [dom, freezer] of this.#tables) {
      if (live.has(dom)) continue
      freezer.destroy()
      this.#tables.delete(dom)
    }
    for (const [dom, node] of live) {
      let freezer = this.#tables.get(dom)
      if (freezer === undefined) this.#tables.set(dom, (freezer = new Freezer(dom)))
      freezer.set(node)
    }
  }

  destroy(): void {
    for (const freezer of this.#tables.values()) freezer.destroy()
    this.#tables.clear()
  }
}

export const tableFreeze = $prose(
  () =>
    new Plugin<FreezeState>({
      key: freezeKey,
      state: {
        init: (_, { doc }) => {
          const tables = new Map<number, ProseNode>()
          tablesBetween(doc, 0, doc.content.size, tables)
          return { set: DecorationSet.create(doc, [...tables].flatMap(([pos, node]) => frozenDecorations(node, pos))), over: [] }
        },
        apply: (tr: Transaction, value) => {
          if (!tr.docChanged) return value
          let set = value.set.map(tr.mapping, tr.doc)
          const tables = new Map<number, ProseNode>()
          tr.mapping.maps.forEach((map, i) => {
            const rest = tr.mapping.slice(i + 1)
            map.forEach((_a, _b, start, end) => tablesBetween(tr.doc, rest.map(start, -1), rest.map(end, 1), tables))
          })
          for (const [pos, node] of tables) {
            const old = set.find(pos, pos + node.nodeSize)
            if (old.length > 0) set = set.remove(old)
            const fresh = frozenDecorations(node, pos)
            if (fresh.length > 0) set = set.add(tr.doc, fresh)
          }
          const over = [...new Set([...value.over.map((pos) => tr.mapping.map(pos)), ...tables.keys()])].filter((pos) => {
            const node = tr.doc.nodeAt(pos)
            return node?.type.name === 'table' && overCounts(node)
          })
          return { set, over }
        },
      },
      appendTransaction: (_trs, _old, state) => {
        const { over } = freezeKey.getState(state)!
        if (over.length === 0) return null
        const tr = state.tr
        for (const pos of over) {
          const table = state.doc.nodeAt(pos)!
          const { rows, cols } = counts(table)
          tr.setNodeMarkup(pos, undefined, { ...table.attrs, freezeRows: rows, freezeCols: cols })
        }
        return tr
      },
      props: { decorations: (state) => freezeKey.getState(state)!.set },
      view: (view) => new FreezeView(view),
    }),
)
