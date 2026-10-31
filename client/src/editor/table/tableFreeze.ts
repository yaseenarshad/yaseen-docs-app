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
 * `table-frozen-row`; each cell of a frozen column gets `table-frozen-col` and `--table-frozen-left:
 * var(--table-frozen-x-<column>)` (the sticky rule's `left`; a plain `left` would move a cell that
 * is not sticky). A table-level decoration puts `data-table-frozen` on the table
 * block (its cells draw their own borders, `table.css`, YAZ-3788), marks each frozen table for the
 * view below, and holds the table's shape. Typing (each step changes the text of one textblock) only
 * maps the set: no table changes its shape, and each node decoration maps (YAZ-3790). Any other
 * transaction builds them again only for the tables it changed (`changedTables`), and only when the
 * table's shape (its counts, rows and columns) changed or a mapped decoration was lost.
 *
 * THE VIEW, one listener set per frozen table, on the table block's own DOM
 * (`div.milkdown-table-block`, the sideways scroll box; never ProseMirror's content DOM):
 * - Columns stick with CSS (`position: sticky` inside the sideways scroll), only while the block
 *   scrolls sideways: `data-table-scrolls`, checked when the columns are measured (YAZ-3790; each
 *   sticky cell costs layout work on every key). Their `left` offsets are
 *   the widths of the columns before them, measured when the table's shape or its first row (the
 *   row that holds the widths) changes, or the table resizes (a `ResizeObserver`), never on scroll or
 *   on a key, and set as `--table-frozen-x-<n>` on the block. The view runs only after a transaction
 *   that is not typing (YAZ-3790).
 * - Rows use the folder page's method (`lib/pinnedHeader.ts`): on a scroll of the note's vertical
 *   scroller (passive, one update per animation frame), on a resize, and after a transaction that
 *   is not typing (the editor may draw a frozen row again), the offset that keeps the frozen rows at
 *   the scroller's top, stopped at the table's end, moves each frozen row: a Web Animation holds its
 *   `translateY` (YAZ-3792). It writes no attribute, so ProseMirror sees no mutation, and it restyles
 *   only that row; a custom property on the block restyled every cell of the table on each scroll.
 *   Whole device pixels, rounded up the page (YAZ-3788). Layout px: divided by the document zoom, as
 *   the folder page does.
 * An unfrozen or removed table drops its listeners, its custom properties and its rows' animations.
 */
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { cssZoom } from '../../lib/cssZoom'
import { pinnedHeaderOffset, verticalScrollParent } from '../../lib/pinnedHeader'
import { changedTables, typingOnly } from './tableStyle'

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

/** What the decorations of a table depend on, besides its positions: the counts, rows and columns. */
const shapeOf = (table: ProseNode): string => {
  const { rows, cols } = counts(table)
  return `${rows} ${cols} ${table.childCount} ${table.firstChild?.childCount ?? 0}`
}

/** How many decorations `frozenDecorations` gives the table. */
function decorationCount(table: ProseNode): number {
  const { rows, cols } = counts(table)
  if (rows === 0 && cols === 0) return 0
  let n = 1 + rows
  table.forEach((row) => {
    n += Math.min(cols, row.childCount)
  })
  return n
}

/** The decorations of one table: none when nothing is frozen. */
function frozenDecorations(table: ProseNode, pos: number): Decoration[] {
  const { rows, cols } = counts(table)
  if (rows === 0 && cols === 0) return []
  const out = [Decoration.node(pos, pos + table.nodeSize, { 'data-table-frozen': '' }, { frozenTable: true, shape: shapeOf(table) })]
  table.forEach((row, rowOffset, r) => {
    const rowPos = pos + 1 + rowOffset
    if (r < rows) out.push(Decoration.node(rowPos, rowPos + row.nodeSize, { class: 'table-frozen-row' }))
    row.forEach((cell, cellOffset, c) => {
      if (c >= cols) return
      const cellPos = rowPos + 1 + cellOffset
      out.push(Decoration.node(cellPos, cellPos + cell.nodeSize, { class: 'table-frozen-col', style: `--table-frozen-left: var(--table-frozen-x-${c}, 0px)` }))
    })
  })
  return out
}

interface FreezeState {
  set: DecorationSet
  /** Tables whose counts are bigger than the table, by position: the appended transaction clamps them. */
  over: number[]
  /** Counts each transaction that is not typing: the view runs only when it moves. */
  generation: number
}

const freezeKey = new PluginKey<FreezeState>('mdapp-table-freeze')

/** One frozen table's listeners and custom properties, on its table block, and its rows' animations. */
class Freezer {
  node: ProseNode | null = null
  #rows = 0
  #cols = 0
  #frame = 0
  /** The next frame measures the columns too: the table changed or resized, not only scrolled. */
  #measure = false
  #scroller: HTMLElement | null = null
  #observer: ResizeObserver | null = null
  /** Each moved row's animation (YAZ-3792). */
  #moved = new Map<HTMLElement, Animation>()

  constructor(readonly block: HTMLElement) {}

  /** The table's `<tbody>` (the content DOM) and its `<table>`. */
  #parts(): { body: HTMLTableSectionElement; table: HTMLElement } | null {
    const body = this.block.querySelector<HTMLTableSectionElement>('tbody[data-content-dom]')
    const table = body?.parentElement
    return body && table ? { body, table } : null
  }

  set(node: ProseNode): void {
    if (node === this.node) return
    const old = this.node
    this.node = node
    const { rows, cols } = counts(node)
    for (let c = cols; c < this.#cols; c++) this.block.style.removeProperty(`--table-frozen-x-${c}`)
    if (this.#observer === null) {
      this.#observer = new ResizeObserver(this.#relayout)
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
    // The column widths are the first row's (`colwidth`); a row's new height resizes the table (the observer).
    if (old === null || shapeOf(old) !== shapeOf(node) || old.firstChild !== node.firstChild) this.#relayout()
    // The editor may have drawn a frozen row again (a sort, a paste): the new <tr> has no animation yet.
    else if (rows > 0) this.#schedule()
  }

  #unlistenRows(): void {
    if (this.#scroller !== null) {
      this.#scroller.removeEventListener('scroll', this.#schedule)
      this.#observer?.unobserve(this.#scroller)
    }
    this.#scroller = null
    this.#move([], 0)
  }

  /** `frozen` moves down by `y` layout px; any other row this freezer moved goes back (its animation ends). */
  #move(frozen: HTMLElement[], y: number): void {
    for (const [row, animation] of this.#moved) {
      if (frozen.includes(row)) continue
      animation.cancel()
      this.#moved.delete(row)
    }
    const keyframes = [{ transform: `translateY(${y}px)` }]
    for (const row of frozen) {
      // jsdom has no `animate`.
      if (typeof row.animate !== 'function') continue
      const animation = this.#moved.get(row)
      if (animation === undefined) this.#moved.set(row, row.animate(keyframes, { duration: 0, fill: 'forwards' }))
      else (animation.effect as KeyframeEffect).setKeyframes(keyframes)
    }
  }

  /** A scroll: the rows' offset only. */
  #schedule = (): void => {
    if (this.#frame === 0) this.#frame = requestAnimationFrame(this.#sync)
  }

  /** A table change or a resize: the columns' offsets and the rows'. */
  #relayout = (): void => {
    this.#measure = true
    this.#schedule()
  }

  #sync = (): void => {
    this.#frame = 0
    const parts = this.#parts()
    if (parts === null) return
    if (this.#measure) {
      this.#measure = false
      const first = parts.body.rows[0]
      let left = 0
      for (let c = 0; c < this.#cols; c++) {
        this.block.style.setProperty(`--table-frozen-x-${c}`, `${left}px`)
        left += (first?.cells[c] as HTMLElement | undefined)?.offsetWidth ?? 0
      }
      this.block.toggleAttribute('data-table-scrolls', this.#cols > 0 && this.block.scrollWidth > this.block.clientWidth)
    }
    const scroller = this.#scroller
    const rows = parts.body.rows
    if (this.#rows === 0 || scroller === null || rows.length < this.#rows) return
    const zoom = cssZoom(this.block)
    const frozenHeight = rows[this.#rows - 1].getBoundingClientRect().bottom - rows[0].getBoundingClientRect().top
    const tableRect = parts.table.getBoundingClientRect()
    const scrollerTop = scroller.getBoundingClientRect().top + scroller.clientTop * zoom
    // Whole device pixels (YAZ-3788): a part of a pixel moves the rows' paint off the sticky cells' pixel grid,
    // and a 1px seam shows the rows under them. `floor` puts the part under the note's top edge, never a gap.
    const ratio = window.devicePixelRatio || 1
    const screen = Math.floor(pinnedHeaderOffset(scrollerTop, tableRect.top, tableRect.height, frozenHeight) * ratio) / ratio
    this.#move(Array.from({ length: this.#rows }, (_, r) => rows[r] as HTMLElement), screen / zoom)
  }

  destroy(): void {
    this.#unlistenRows()
    this.#observer?.disconnect()
    this.#observer = null
    if (this.#frame !== 0) cancelAnimationFrame(this.#frame)
    this.#frame = 0
    for (let c = 0; c < this.#cols; c++) this.block.style.removeProperty(`--table-frozen-x-${c}`)
    this.block.removeAttribute('data-table-scrolls')
  }
}

class FreezeView {
  #tables = new Map<HTMLElement, Freezer>()

  constructor(view: EditorView) {
    this.update(view)
  }

  update(view: EditorView, prev?: EditorState): void {
    const state = freezeKey.getState(view.state)!
    if (prev !== undefined && freezeKey.getState(prev)!.generation === state.generation) return
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
          const decorations: Decoration[] = []
          doc.descendants((node, pos) => {
            if (node.type.name !== 'table') return !node.isTextblock
            decorations.push(...frozenDecorations(node, pos))
            return false
          })
          return { set: DecorationSet.create(doc, decorations), over: [], generation: 0 }
        },
        apply: (tr: Transaction, value) => {
          if (!tr.docChanged) return value
          let set = value.set.map(tr.mapping, tr.doc)
          if (value.over.length === 0 && typingOnly(tr)) return { ...value, set }
          const tables = changedTables(tr)
          for (const [pos, node] of tables) {
            // The table's own decorations: `find` also gives those of a table that only touches it.
            const end = pos + node.nodeSize
            const old = set.find(pos, end).filter((deco) => deco.from >= pos && deco.to <= end)
            const outer = old.find((deco) => deco.from === pos && deco.to === end)
            if (old.length === decorationCount(node) && (old.length === 0 || outer?.spec.shape === shapeOf(node))) continue
            if (old.length > 0) set = set.remove(old)
            const fresh = frozenDecorations(node, pos)
            if (fresh.length > 0) set = set.add(tr.doc, fresh)
          }
          const over = [...new Set([...value.over.map((pos) => tr.mapping.map(pos)), ...tables.keys()])].filter((pos) => {
            const node = tr.doc.nodeAt(pos)
            return node?.type.name === 'table' && overCounts(node)
          })
          return { set, over, generation: value.generation + 1 }
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
