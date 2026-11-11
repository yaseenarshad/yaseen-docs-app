/**
 * Subheader rows (YAZ-4899; CONTRACTS rule 41a): a body row made a section's title. It is sticky, it collapses, and
 * every subheader row of a table shares one look.
 *
 * THE MARK is on the row's cells, `subhead` (`tableStyle.ts`), as `fold` and `nodim` are: a sort, an insert or a
 * delete keeps it on its row, and a row is a subheader when one of its cells has it (`rowSubhead`, `cells.ts`). Row 0
 * (the header) never is. The save writes `subhead 5 12` (`tableComment.ts`). A SECTION is a subheader row and the body
 * rows under it, to the next subheader row or the table's end (`sectionEnd`); the rows above the first subheader row
 * are in no section.
 *
 * THE LOOK: one per table, the table's `subheader` attribute (the header row's parts, `HeaderRowOwn`) as
 * `data-table-subheader-*` on the block, else Settings › Tables › Subheader row on `.app`; each subheader cell carries
 * `data-subhead` (`table.css`). A cell's own Fill wins over it, as over the header shade.
 *
 * COLLAPSE: a collapsed section stores its rows in the SAME `fold` mark "Fold N rows" uses (`tableFold.ts`,
 * `sectionRun`): ⌘Z undoes it as a fold, and an older build hides the rows with its bar. The fold plugin draws no bar
 * for such a run; this plugin draws the chevron, a widget inside the subheader row's first cell before its text (the
 * demo decides its place: ONE CSS rule, `.table-subhead-chevron`, and `chevronWidget` below), pointing down when open
 * and right when collapsed, and then "· N rows" at the end of the cell's text (an inline widget). A mousedown on the
 * chevron toggles the section, ⌥-click every section of the table, each one transaction with the history closed (one
 * ⌘Z); it goes before `tableEditing`, so the click starts no cell selection. A read-only note: the chevron does nothing.
 *
 * DECORATIONS, as `tableFreeze.ts` / `tableFold.ts`: the table block gets `data-table-subheads`, each subheader row
 * `table-subhead-row` (and `table-subhead-collapsed`), and the stripes start again after each subheader row: the second,
 * fourth… row of each section gets `table-stripe-row` (`table.css` paints it in place of `nth-child` on such a table).
 * Typing only maps the set (`tableSpeed.test.ts`); any other transaction builds again only the tables it changed.
 *
 * STICKY (`SubheadPinner`), the frozen rows' method (`lib/pinnedHeader.ts`, `tableFreeze.ts`): on a scroll of the
 * note's vertical scroller (passive, one update per animation frame), on a resize, and after a transaction that is not
 * typing, the subheader row of the section at the top of the scroller moves down by a `translateY` held by a Web
 * Animation, under the frozen rows if any; the next subheader row pushes it up, and it stops at the table's end. It
 * writes no attribute. Only a table that has subheader rows and sticky on (`stickySubheaders`, else Settings › Tables ›
 * Sticky subheaders) has the listeners; all go on destroy. The row handles are placed again (`TABLE_HANDLE_PLACE`).
 *
 * KEYS (`$shortcut`, above the outline's, item 13): with the caret in a table that has subheader rows, ⌘↑ collapses the
 * caret's section (the caret goes to its subheader row) and ⌘↓ opens it; ⌘⇧U / ⌘⇧I collapse / open every section of
 * every table, then let the bullets and headings fold too.
 *
 * DRAG (item 17): the vendored row drag calls `MoveRow` (`@milkdown/components` table block, `onDrop`); this module
 * stands in for it on a table with subheader rows (`moveRowWithSection`): a collapsed subheader row moves with its
 * hidden rows, and a drop under a collapsed subheader row lands after its section, never inside it.
 */
import { CommandsReady, commandsCtx } from '@milkdown/kit/core'
import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import { closeHistory } from '@milkdown/kit/prose/history'
import { Fragment, type Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, TextSelection, type Command, type EditorState, type Transaction } from '@milkdown/kit/prose/state'
import { CellSelection, TableMap } from '@milkdown/kit/prose/tables'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { moveRowCommand } from '@milkdown/kit/preset/gfm'
import { $shortcut } from '@milkdown/kit/utils'
import { cssZoom } from '../../lib/cssZoom'
import { verticalScrollParent } from '../../lib/pinnedHeader'
import { rowShortcuts } from '../noteKeys'
import { beforeTableEditing } from './beforeTableEditing'
import { rowFolded, rowSubhead, sectionEnd, subheadOf, tableHasSubheads } from './cells'
import { keepingScroll } from './tableFold'
import { TABLE_HANDLE_PLACE } from './tableFreeze'
import { changedTables, typingOnly } from './tableStyle'
import { frozenRowCount } from './tableFreeze'
import { onStickySubheadersSetting, stickySubheadersSetting } from './timeFormatSetting'

/** A section: its subheader row, its last row (`end === row` for an empty section), and whether its rows are folded. */
export interface Section {
  row: number
  end: number
  collapsed: boolean
}

/** The table's sections, in order. */
export function sectionsOf(table: ProseNode): Section[] {
  const out: Section[] = []
  table.forEach((row, _, r) => {
    if (r === 0 || !rowSubhead(row)) return
    const end = sectionEnd(table, r)
    let collapsed = end > r
    for (let i = r + 1; i <= end && collapsed; i++) collapsed = rowFolded(table.child(i))
    out.push({ row: r, end, collapsed })
  })
  return out
}

/** The section of subheader row `s` is collapsed: every row under it is folded. */
export const sectionCollapsed = (table: ProseNode, s: number): boolean => sectionsOf(table).find((section) => section.row === s)?.collapsed === true

/** The start of row `r` of the table at `tablePos`. */
function rowStart(table: ProseNode, tablePos: number, r: number): number {
  let pos = tablePos + 1
  for (let i = 0; i < r; i++) pos += table.child(i).nodeSize
  return pos
}

/** The rows of the section of subheader row `s` of the table at `tablePos` folded (`true`) or open, in `tr`. */
export function setSectionFolded(tr: Transaction, tablePos: number, s: number, folded: boolean): Transaction {
  const table = tr.doc.nodeAt(tablePos)
  if (table === null || !rowSubhead(table.maybeChild(s))) return tr
  const end = sectionEnd(table, s)
  let pos = tablePos + 1
  table.forEach((row, _, r) => {
    if (r > s && r <= end) {
      row.forEach((cell, offset) => {
        if (cell.attrs.fold !== folded) tr.setNodeAttribute(pos + 1 + offset, 'fold', folded)
      })
    }
    pos += row.nodeSize
  })
  return tr
}

/** Every section of the table at `tablePos` (or of every table, with `null`) folded or open, in `tr`. */
export function setAllSections(tr: Transaction, tablePos: number | null, folded: boolean): Transaction {
  const tables: number[] = []
  if (tablePos !== null) tables.push(tablePos)
  else
    tr.doc.descendants((node, pos) => {
      if (node.type.name !== 'table') return !node.isTextblock
      if (tableHasSubheads(node)) tables.push(pos)
      return false
    })
  for (const pos of tables) for (const section of sectionsOf(tr.doc.nodeAt(pos)!)) setSectionFolded(tr, pos, section.row, folded)
  return tr
}

/**
 * Body rows `top`…`bottom` (exclusive; never row 0) of the table at `tablePos` made subheader rows, or normal rows again,
 * in `tr`. A row made a subheader row is never folded; a section turned back opens first, so its rows do not become a
 * plain fold run with a bar.
 */
export function setSubhead(tr: Transaction, tablePos: number, top: number, bottom: number, on: boolean): Transaction {
  const table = tr.doc.nodeAt(tablePos)
  if (table === null) return tr
  if (!on) for (let r = Math.max(top, 1); r < bottom; r++) if (rowSubhead(table.child(r))) setSectionFolded(tr, tablePos, r, false)
  let pos = tablePos + 1
  table.forEach((row, _, r) => {
    if (r >= Math.max(top, 1) && r < bottom) {
      row.forEach((cell, offset) => {
        if (cell.attrs.subhead !== on) tr.setNodeAttribute(pos + 1 + offset, 'subhead', on)
        if (on && cell.attrs.fold === true) tr.setNodeAttribute(pos + 1 + offset, 'fold', false)
      })
    }
    pos += row.nodeSize
  })
  return tr
}

/** The caret's (or the cell selection's head's) table and row, or `null` outside a table. */
function caretRow(state: EditorState): { table: ProseNode; tablePos: number; row: number } | null {
  const { selection } = state
  const $head = selection instanceof CellSelection ? selection.$headCell : selection.$head
  let depth = $head.depth
  while (depth > 0 && $head.node(depth).type.spec.tableRole !== 'row') depth--
  if (depth === 0) return null
  return { table: $head.node(depth - 1), tablePos: $head.before(depth - 1), row: $head.index(depth - 1) }
}

/**
 * Collapse or open the section of subheader row `s`: one transaction, the history closed (one ⌘Z). A collapse puts the
 * caret on the subheader row when it was in the section's rows (the fold plugin would move it past the run).
 */
function toggleSection(view: EditorView, tablePos: number, s: number, collapsed: boolean): void {
  const tr = setSectionFolded(closeHistory(view.state.tr), tablePos, s, collapsed)
  if (!tr.docChanged) return
  const at = caretRow(view.state)
  if (collapsed && at !== null && at.tablePos === tablePos && at.row > s && at.row <= sectionEnd(at.table, s)) {
    tr.setSelection(TextSelection.near(tr.doc.resolve(rowStart(at.table, tablePos, s) + 2)))
  }
  view.dispatch(tr)
}

const subheadKey = new PluginKey<SubheadState>('mdapp-table-subhead')

interface SubheadState {
  set: DecorationSet
  /** Counts each transaction that is not typing: the sticky view runs only when it moves. */
  generation: number
}

/** The chevron: a widget inside the subheader row's first cell, before its text. Its place on the page is `table.css`'s one rule. */
function chevronWidget(collapsed: boolean): HTMLElement {
  const el = document.createElement('span')
  el.className = 'table-subhead-chevron'
  el.contentEditable = 'false'
  el.setAttribute('role', 'button')
  el.setAttribute('aria-label', collapsed ? 'Expand section' : 'Collapse section')
  el.title = `${collapsed ? 'Expand' : 'Collapse'} section (⌥-click: every section)`
  if (collapsed) el.dataset.collapsed = ''
  el.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6l6 -6"/></svg>'
  return el
}

/** "· 12 rows" after the first cell's text of a collapsed subheader row. */
function countWidget(rows: number): HTMLElement {
  const el = document.createElement('span')
  el.className = 'table-subhead-count'
  el.contentEditable = 'false'
  el.textContent = ` · ${rows} row${rows === 1 ? '' : 's'}`
  return el
}

/** The end of the last textblock of `cell` (its position in the cell, from the cell's start), where the count goes. */
function textEnd(cell: ProseNode): number {
  let node = cell
  let pos = 0
  while (node.lastChild !== null && !node.isTextblock) {
    pos += node.content.size - node.lastChild.nodeSize + 1
    node = node.lastChild
  }
  return node.isTextblock ? pos + node.content.size : cell.content.size
}

/** The decorations of one table: none without a subheader row. */
function subheadDecorations(table: ProseNode, pos: number): Decoration[] {
  const sections = sectionsOf(table)
  if (sections.length === 0) return []
  const starts: number[] = []
  table.forEach((_, offset) => starts.push(pos + 1 + offset))
  const spec = { subhead: true }
  const out = [Decoration.node(pos, pos + table.nodeSize, { 'data-table-subheads': '' }, spec)]
  // The stripes of each section: the rows above the first subheader row are one too.
  const stripe = (from: number, to: number) => {
    for (let r = from + 1; r <= to; r += 2) out.push(Decoration.node(starts[r]!, starts[r]! + table.child(r).nodeSize, { class: 'table-stripe-row' }, spec))
  }
  stripe(1, sections[0]!.row - 1)
  for (const { row, end, collapsed } of sections) {
    stripe(row + 1, end)
    out.push(Decoration.node(starts[row]!, starts[row]! + table.child(row).nodeSize, { class: collapsed ? 'table-subhead-row table-subhead-collapsed' : 'table-subhead-row' }, spec))
    if (end === row) continue
    const cell = table.child(row).firstChild!
    const cellStart = starts[row]! + 1
    out.push(Decoration.widget(cellStart + 1, () => chevronWidget(collapsed), { ...spec, side: -1, key: collapsed ? 'subhead-chevron-closed' : 'subhead-chevron-open', ignoreSelection: true }))
    if (collapsed) out.push(Decoration.widget(cellStart + 1 + textEnd(cell), () => countWidget(end - row), { ...spec, side: 1, key: `subhead-count-${end - row}`, ignoreSelection: true }))
  }
  return out
}

/** A mousedown on a chevron: toggle its section, with ⌥ every section of the table; a read-only note does nothing. */
function onChevron(view: EditorView, event: MouseEvent): boolean {
  if (event.button !== 0 || !(event.target instanceof Element)) return false
  const chevron = event.target.closest('.table-subhead-chevron')
  if (chevron === null || !view.dom.contains(chevron)) return false
  event.preventDefault()
  if (!view.editable) return true
  const $at = view.state.doc.resolve(view.posAtDOM(chevron, 0))
  for (let depth = $at.depth; depth > 0; depth--) {
    if ($at.node(depth).type.spec.tableRole !== 'row') continue
    const table = $at.node(depth - 1)
    const tablePos = $at.before(depth - 1)
    const s = $at.index(depth - 1)
    const collapsed = sectionCollapsed(table, s)
    keepingScroll(view, () => {
      if (event.altKey) view.dispatch(setAllSections(closeHistory(view.state.tr), tablePos, !collapsed))
      else toggleSection(view, tablePos, s, !collapsed)
    })
    return true
  }
  return false
}

/** One sticky table's listeners, on its table block, and the pinned row's animation (the frozen rows' method). */
class SubheadPinner {
  node: ProseNode | null = null
  #frame = 0
  #scroller: HTMLElement | null = null
  #observer: ResizeObserver | null = null
  #pinned: { row: HTMLElement; animation: Animation | null; offset: number } | null = null

  constructor(readonly block: HTMLElement) {}

  #parts(): { body: HTMLTableSectionElement; table: HTMLElement } | null {
    const body = this.block.querySelector<HTMLTableSectionElement>('tbody[data-content-dom]')
    const table = body?.parentElement
    return body && table ? { body, table } : null
  }

  set(node: ProseNode): void {
    const changed = node !== this.node
    this.node = node
    if (this.#observer === null) {
      this.#observer = new ResizeObserver(this.#schedule)
      const table = this.#parts()?.table
      if (table) this.#observer.observe(table)
    }
    if (this.#scroller === null) {
      this.#scroller = verticalScrollParent(this.block)
      this.#scroller?.addEventListener('scroll', this.#schedule, { passive: true })
      if (this.#scroller !== null) this.#observer.observe(this.#scroller)
    }
    // The editor may have drawn the pinned row again: the new <tr> has no animation yet.
    if (changed) this.#schedule()
  }

  #schedule = (): void => {
    if (this.#frame === 0) this.#frame = requestAnimationFrame(this.#sync)
  }

  /** `row` moves down by `y` layout px; the row pinned before goes back. `null` pins nothing. */
  #move(row: HTMLElement | null, y: number): boolean {
    const before = this.#pinned
    if (before !== null && before.row !== row) {
      before.animation?.cancel()
      this.#pinned = null
    }
    if (row === null) return before !== null
    const keyframes = [{ transform: `translateY(${y}px)` }]
    if (this.#pinned === null) {
      // jsdom has no `animate`.
      const animation = typeof row.animate === 'function' ? row.animate(keyframes, { duration: 0, fill: 'forwards' }) : null
      this.#pinned = { row, animation, offset: y }
      return true
    }
    if (this.#pinned.offset === y) return false
    ;(this.#pinned.animation?.effect as KeyframeEffect | undefined)?.setKeyframes(keyframes)
    this.#pinned.offset = y
    return true
  }

  #sync = (): void => {
    this.#frame = 0
    const parts = this.#parts()
    const node = this.node
    const scroller = this.#scroller
    if (parts === null || node === null || scroller === null) return
    const rows = parts.body.rows
    if (rows.length < node.childCount) return
    const subheads: number[] = []
    node.forEach((row, _, r) => {
      if (r > 0 && rowSubhead(row) && rows[r]!.getBoundingClientRect().height > 0) subheads.push(r)
    })
    if (subheads.length === 0) return void this.#move(null, 0)
    const zoom = cssZoom(parts.table)
    const pinned = this.#pinned
    // A row's top as laid out: the pinned row's rect is moved by its offset.
    const naturalTop = (r: number): number => rows[r]!.getBoundingClientRect().top - (pinned !== null && pinned.row === rows[r] ? pinned.offset * zoom : 0)
    const scrollerTop = scroller.getBoundingClientRect().top + scroller.clientTop * zoom
    // Under the frozen rows (`tableFreeze.ts`): their height ends at the last frozen row shown.
    const frozen = Math.min(frozenRowCount(node), rows.length)
    let frozenHeight = 0
    if (frozen > 0) {
      let last = frozen - 1
      while (last > 0 && rows[last]!.classList.contains('table-fold-hidden')) last--
      frozenHeight = rows[last]!.getBoundingClientRect().bottom - rows[0]!.getBoundingClientRect().top
    }
    const pinTop = scrollerTop + frozenHeight
    // The section at the top: the last subheader row at or above the pin line.
    let pick = -1
    for (const r of subheads) {
      if (naturalTop(r) > pinTop) break
      pick = r
    }
    if (pick < 0) {
      if (this.#move(null, 0)) this.block.dispatchEvent(new Event(TABLE_HANDLE_PLACE))
      return
    }
    const top = naturalTop(pick)
    const height = rows[pick]!.getBoundingClientRect().height
    let offset = pinTop - top
    const next = subheads.find((r) => r > pick)
    if (next !== undefined) offset = Math.min(offset, naturalTop(next) - height - top)
    offset = Math.min(offset, parts.table.getBoundingClientRect().bottom - height - top)
    // Whole device pixels (YAZ-3788), in the table's layout px (the page zoom times its own, YAZ-4091).
    const ratio = window.devicePixelRatio || 1
    offset = Math.floor(Math.max(0, offset) * ratio) / ratio / zoom
    if (this.#move(rows[pick]!, offset)) this.block.dispatchEvent(new Event(TABLE_HANDLE_PLACE))
  }

  destroy(): void {
    this.#scroller?.removeEventListener('scroll', this.#schedule)
    this.#scroller = null
    this.#observer?.disconnect()
    this.#observer = null
    if (this.#frame !== 0) cancelAnimationFrame(this.#frame)
    this.#frame = 0
    this.#move(null, 0)
  }
}

/** Sticky on for the table: its own choice, else Settings › Tables › Sticky subheaders. */
export const stickyOn = (table: ProseNode): boolean => (table.attrs.stickySubheaders as boolean | null) ?? stickySubheadersSetting()

class SubheadView {
  #tables = new Map<HTMLElement, SubheadPinner>()
  #unsubscribe: () => void

  constructor(view: EditorView) {
    this.update(view)
    // Settings › Tables › Sticky subheaders changed: the tables that follow it pin or stop now, not at their next change.
    this.#unsubscribe = onStickySubheadersSetting(() => this.#sync(view))
  }

  update(view: EditorView, prev?: EditorState): void {
    if (prev !== undefined && subheadKey.getState(prev)!.generation === subheadKey.getState(view.state)!.generation) return
    this.#sync(view)
  }

  #sync(view: EditorView): void {
    const state = subheadKey.getState(view.state)!
    const live = new Map<HTMLElement, ProseNode>()
    for (const deco of state.set.find(undefined, undefined, (spec) => spec.subhead === true)) {
      const node = view.state.doc.nodeAt(deco.from)
      if (node?.type.name !== 'table' || deco.to !== deco.from + node.nodeSize || !stickyOn(node)) continue
      const dom = view.nodeDOM(deco.from)
      if (dom instanceof HTMLElement) live.set(dom, node)
    }
    for (const [dom, pinner] of this.#tables) {
      if (live.has(dom)) continue
      pinner.destroy()
      this.#tables.delete(dom)
    }
    for (const [dom, node] of live) {
      let pinner = this.#tables.get(dom)
      if (pinner === undefined) this.#tables.set(dom, (pinner = new SubheadPinner(dom)))
      pinner.set(node)
    }
  }

  destroy(): void {
    this.#unsubscribe()
    for (const pinner of this.#tables.values()) pinner.destroy()
    this.#tables.clear()
  }
}

const subheadPlugin = (): Plugin<SubheadState> =>
  new Plugin<SubheadState>({
    key: subheadKey,
    state: {
      init: (_, { doc }) => {
        const decorations: Decoration[] = []
        doc.descendants((node, pos) => {
          if (node.type.name !== 'table') return !node.isTextblock
          decorations.push(...subheadDecorations(node, pos))
          return false
        })
        return { set: DecorationSet.create(doc, decorations), generation: 0 }
      },
      apply: (tr, value) => {
        if (!tr.docChanged) return value
        let set = value.set.map(tr.mapping, tr.doc)
        // A key changes no row's mark: the mapped set holds.
        if (typingOnly(tr)) return { ...value, set }
        for (const [pos, node] of changedTables(tr)) {
          const end = pos + node.nodeSize
          const stale = set.find(pos, end, (spec) => spec.subhead === true).filter((deco) => deco.from >= pos && deco.to <= end)
          if (stale.length > 0) set = set.remove(stale)
          const fresh = subheadDecorations(node, pos)
          if (fresh.length > 0) set = set.add(tr.doc, fresh)
        }
        return { set, generation: value.generation + 1 }
      },
    },
    props: {
      decorations: (state) => subheadKey.getState(state)!.set,
      handleDOMEvents: { mousedown: onChevron },
    },
    view: (view) => new SubheadView(view),
  })

/** ⌘↑ / ⌘↓ in a table with subheader rows: the caret's section collapses or opens; elsewhere the bullets' keys run. */
const sectionHere =
  (collapsed: boolean): Command =>
  (state, dispatch, view) => {
    const at = caretRow(state)
    if (at === null || view?.editable === false || !tableHasSubheads(at.table)) return false
    const s = subheadOf(at.table, at.row)
    if (s === null) return false
    if (dispatch && view !== undefined && sectionCollapsed(at.table, s) !== collapsed) toggleSection(view, at.tablePos, s, collapsed)
    return true
  }

/** ⌘⇧U / ⌘⇧I: every section of every table, then (`false`) the bullets and headings too. */
const allSections =
  (collapsed: boolean): Command =>
  (state, dispatch, view) => {
    if (view?.editable === false) return false
    const tr = setAllSections(closeHistory(state.tr), null, collapsed)
    if (tr.docChanged) dispatch?.(tr)
    return false
  }

const PRIORITY = 110

const subheadKeys = $shortcut((ctx) => ({
  ...rowShortcuts(ctx, 'note.foldHere', 'CollapseSubheadSection', { priority: PRIORITY, onRun: () => sectionHere(true) }),
  ...rowShortcuts(ctx, 'note.unfoldHere', 'ExpandSubheadSection', { priority: PRIORITY, onRun: () => sectionHere(false) }),
  ...rowShortcuts(ctx, 'note.foldAll', 'CollapseAllSubheads', { priority: PRIORITY, onRun: () => allSections(true) }),
  ...rowShortcuts(ctx, 'note.unfoldAll', 'ExpandAllSubheads', { priority: PRIORITY, onRun: () => allSections(false) }),
}))

/** A body cell spans rows: the rows cannot move one by one (as `tableMenu.ts`'s Sort). */
function spansRows(table: ProseNode): boolean {
  let spans = false
  table.forEach((row, _, r) => {
    if (r > 0) row.forEach((cell) => (spans ||= (cell.attrs.rowspan as number) > 1))
  })
  return spans
}

/**
 * The vendored drag's `MoveRow` on a table with subheader rows: row `from` goes to row `to` (the row under the pointer),
 * a collapsed subheader row with its hidden rows, and a drop under a collapsed subheader row after its section. Other
 * tables keep prosemirror-tables' move (`original`).
 */
export const moveRowWithSection =
  (original: (payload: { from: number; to: number; pos: number }) => Command) =>
  (payload: { from?: number; to?: number; pos?: number } = {}): Command =>
  (state, dispatch, view) => {
    const { from = 0, to = 0, pos = state.selection.from } = payload
    const $pos = state.doc.resolve(pos)
    const table = $pos.parent
    if (table.type.name !== 'table' || !tableHasSubheads(table) || from === 0 || to === 0 || spansRows(table)) return original({ from, to, pos })(state, dispatch, view)
    const tablePos = $pos.before()
    const blockEnd = rowSubhead(table.child(from)) && sectionCollapsed(table, from) ? sectionEnd(table, from) : from
    if (to >= from && to <= blockEnd) return false
    const rows: ProseNode[] = []
    table.forEach((row) => rows.push(row))
    const block = rows.splice(from, blockEnd - from + 1)
    const targetEnd = rowSubhead(table.child(to)) && sectionCollapsed(table, to) ? sectionEnd(table, to) : to
    let at = to > from ? targetEnd + 1 : to
    if (at > from) at -= block.length
    rows.splice(at, 0, ...block)
    if (dispatch) {
      const next = table.copy(Fragment.from(rows))
      const tr = closeHistory(state.tr).replaceWith(tablePos, tablePos + table.nodeSize, next)
      const map = TableMap.get(next)
      const start = tablePos + 1
      tr.setSelection(CellSelection.create(tr.doc, start + map.positionAt(at, 0, next), start + map.positionAt(at, map.width - 1, next)))
      dispatch(tr)
    }
    return true
  }

/** `MoveRow` stands in for the vendored drag's: the gfm preset's command, wrapped, once the commands are ready. */
const subheadMoveRow: MilkdownPlugin = (ctx) => async () => {
  await ctx.wait(CommandsReady)
  const commands = ctx.get(commandsCtx)
  let base: (payload?: { from?: number; to?: number; pos?: number }) => Command
  try {
    base = commands.get(moveRowCommand.key)
  } catch {
    // No `MoveRow` (an editor without the gfm preset): nothing to stand in for.
    return () => {}
  }
  commands.create(moveRowCommand.key, moveRowWithSection((payload) => base(payload)))
  return () => {
    commands.create(moveRowCommand.key, base)
  }
}

/** Register with `editor.use(tableSubhead)`: the mousedown before `tableEditing` (as `tableFold`), the keys, the drag. */
export const tableSubhead = [beforeTableEditing(() => [subheadPlugin()]), subheadKeys, subheadMoveRow].flat()
