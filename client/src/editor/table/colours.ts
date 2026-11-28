/**
 * The cell colours' helpers (YAZ-3817), shared by the cell toolbar (`cellToolbar.ts`) and the table
 * menu (`tableMenu.ts`, YAZ-3820): the labels, the swatches, the custom fill's wash, and "Custom
 * colour…": the note's own colour box (`highlightColourBox.ts`, YAZ-4366), never Chromium's
 * `<input type="color">` popup, which Electron opened at the window's top left.
 *
 * The cell toolbar's palette holds its box under its "Custom colour…" item, and a pick goes to the
 * cells selected (the palette closes with the selection). The table menu closes on a click, so its
 * "Custom colour…" opens the box on the page, under the target cells (the clicked cell, or the
 * cells selected in its table), and the note keeps its own selection. So `customColourPick` keeps
 * the target's two corner cells in its plugin state, mapped through each transaction: a sync from
 * disk or an edit above moves them. A pick does nothing when a corner cell is gone or the note's
 * view is destroyed (⌘W).
 *
 * In both, one finished pick (a drag's release, Enter in an R G B field, the eyedropper's colour) is
 * one undo step and the box stays open for the next; Escape closes the box first.
 */
import { closeHistory } from '@milkdown/kit/prose/history'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@milkdown/kit/prose/state'
import { CellSelection, TableMap, type TableRect } from '@milkdown/kit/prose/tables'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { headerRowOwn, type HeaderRowOwn } from '@shared/types'
import type { Hex } from '../../lib/colour'
import { ColourBox } from '../highlightColourBox'
import { setCellsAttr } from './cells'
import type { TableColor } from './tableComment'

/** A menu label from a value: `blue` → `Blue`. */
export const capital = (word: string) => word[0].toUpperCase() + word.slice(1)

/** Each swatch's colour: a fill at full strength in light and dark (`table.css`; the cells keep their wash). */
export const fillSwatch = (c: TableColor) => `var(--table-fill-solid-${c})`
export const textSwatch = (c: TableColor) => `var(--table-text-${c})`
/** A header row colour's swatch (YAZ-4794): the fill swatches, Black/White, or a custom `#rrggbb(aa)`. */
export const headerSwatch = (c: string) => (c.startsWith('#') ? c : `var(--table-fill-solid-${c === 'gray' ? 'grey' : c})`)

/** Solid Black and White swatches added to table Fill and Text palettes (YAZ-6693 D7). */
export const TABLE_EXTRA_SWATCHES = [
  { id: 'black', label: 'Black', value: '#000000' as Hex },
  { id: 'white', label: 'White', value: '#ffffff' as Hex },
] as const

/** A custom fill's see-through wash (used by folder/view fills): 35%. */
export const FILL_WASH = 0.35

/** Where the box opens when the cells have no one custom colour, as the system picker did. */
const START: Hex = '#000000'

/** The cells' one custom colour of `attr` (`#rrggbb` or `#rrggbbaa`), else black: where the box opens. */
export function customStart(cells: CellSelection, attr: 'fill' | 'color'): Hex {
  const colours = new Set<unknown>()
  cells.forEachCell((cell) => void colours.add(cell.attrs[attr]))
  const [only] = colours
  return colours.size === 1 && typeof only === 'string' && only.startsWith('#') ? (only as Hex) : START
}

/** The rectangle of `cells`, as prosemirror-tables' `selectedRect` reads it from a selection. */
function rectOf(cells: CellSelection): TableRect {
  const { $anchorCell, $headCell } = cells
  const table = $anchorCell.node(-1)
  const tableStart = $anchorCell.start(-1)
  const map = TableMap.get(table)
  return { ...map.rectBetween($anchorCell.pos - tableStart, $headCell.pos - tableStart), tableStart, map, table }
}

/**
 * One finished pick: `attr` of `cells` is `color`, one undo step. A focus in the box (`holder`) goes back to the
 * note first, so the cell toolbar stays.
 */
export function setCustomColour(view: EditorView, holder: HTMLElement, cells: CellSelection, attr: 'fill' | 'color', color: Hex): void {
  if (view.isDestroyed) return
  if (holder.contains(view.dom.ownerDocument.activeElement)) view.focus()
  const tr = setCellsAttr(closeHistory(view.state.tr), rectOf(cells), attr, color)
  if (tr.docChanged) view.dispatch(tr)
}

/**
 * One finished pick on a header or subheader row: sets `part` (`color` or `text`) on `kind`, one undo step (YAZ-6693 #6).
 */
function setRowCustomColour(
  view: EditorView,
  holder: HTMLElement,
  tablePos: number,
  rowKind: 'header' | 'subheader',
  part: 'color' | 'text',
  color: Hex,
): void {
  if (view.isDestroyed) return
  if (holder.contains(view.dom.ownerDocument.activeElement)) view.focus()
  const node = view.state.doc.nodeAt(tablePos)
  if (node?.type.name !== 'table') return
  const current = headerRowOwn(node.attrs[rowKind])
  const next: HeaderRowOwn = { ...current, [part]: color }
  if (JSON.stringify(next) === JSON.stringify(current)) return
  view.dispatch(closeHistory(view.state.tr).setNodeAttribute(tablePos, rowKind, next))
}

/** The target's cells or table row while the menu's box is open, or null. */
type Target =
  | { kind: 'cells'; anchor: number; head: number; attr: 'fill' | 'color' }
  | { kind: 'row'; tablePos: number; rowKind: 'header' | 'subheader'; part: 'color' | 'text' }
  | null
const pickKey = new PluginKey<Target>('mdapp-custom-colour-pick')

/** A cell or table node still starts at `pos`, mapped through `tr`; `null` when it was deleted. */
const mapCell = (tr: Transaction, pos: number): number | null => {
  const mapped = tr.mapping.mapResult(pos)
  return mapped.deletedAfter ? null : mapped.pos
}

/** The target cells again as a CellSelection of `state`, or null when its cells are no longer one table's cells. */
function targetCellsOf(state: EditorState, target: Extract<NonNullable<Target>, { kind: 'cells' }>): CellSelection | null {
  const isCell = (pos: number) => ['cell', 'header_cell'].includes(state.doc.nodeAt(pos)?.type.spec.tableRole as string)
  if (!isCell(target.anchor) || !isCell(target.head)) return null
  const $anchor = state.doc.resolve(target.anchor)
  const $head = state.doc.resolve(target.head)
  return $anchor.start(-1) === $head.start(-1) ? new CellSelection($anchor, $head) : null
}

/** Whether the current plugin target still exists in `state`. */
function targetAlive(state: EditorState): boolean {
  const target = pickKey.getState(state)
  if (target == null) return false
  if (target.kind === 'cells') return targetCellsOf(state, target) !== null
  return state.doc.nodeAt(target.tablePos)?.type.name === 'table'
}

/** Each note's box for the table menu, so `pickCustomColour` reaches the one of its own editor. */
const menuBoxes = new WeakMap<EditorView, MenuColourBox>()

/**
 * The table menu's colour box: on the page's body, `position: fixed` under the target cells (over them when the
 * window has no room below). Escape and a mousedown outside close it; a scroll moves it with the cells.
 */
class MenuColourBox {
  #el: HTMLElement | null = null
  #box: ColourBox | null = null
  #boxes: Record<'alpha' | 'solid', ColourBox | null> = { alpha: null, solid: null }

  constructor(readonly view: EditorView) {
    menuBoxes.set(view, this)
  }

  get open(): boolean {
    return this.#el !== null && !this.#el.hidden
  }

  #open(target: NonNullable<Target>, showAlpha: boolean, start: Hex): void {
    const { view } = this
    const doc = view.dom.ownerDocument
    if (this.#el === null) {
      this.#el = doc.createElement('div')
      this.#el.className = 'table-colour-box'
      this.#el.setAttribute('role', 'dialog')
      this.#el.setAttribute('aria-label', 'Custom colour')
    }
    const slot = showAlpha ? 'alpha' : 'solid'
    let box = this.#boxes[slot]
    if (box === null) {
      box = new ColourBox(doc, {
        showAlpha,
        preview: () => {},
        pick: (color) => {
          const current = pickKey.getState(view.state)
          if (current == null) return
          if (current.kind === 'cells') {
            const cells = targetCellsOf(view.state, current)
            if (cells !== null) setCustomColour(view, this.#el!, cells, current.attr, color)
          } else {
            setRowCustomColour(view, this.#el!, current.tablePos, current.rowKind, current.part, color)
          }
        },
        close: this.close,
      })
      this.#boxes[slot] = box
    }
    if (this.#box !== box) {
      this.#box?.hide()
      this.#box = box
      this.#el.replaceChildren(box.el)
    }
    if (!this.#el.isConnected) doc.body.appendChild(this.#el)
    view.dispatch(view.state.tr.setMeta(pickKey, target))
    this.#el.hidden = false
    box.show(start)
    this.#place()
    doc.addEventListener('keydown', this.#key, true)
    doc.addEventListener('mousedown', this.#outside, true)
    doc.addEventListener('scroll', this.#place, true)
  }

  show(target: CellSelection, attr: 'fill' | 'color'): void {
    this.#open({ kind: 'cells', anchor: target.$anchorCell.pos, head: target.$headCell.pos, attr }, attr === 'fill', customStart(target, attr))
  }

  showRow(tablePos: number, rowKind: 'header' | 'subheader', part: 'color' | 'text', start: Hex): void {
    this.#open({ kind: 'row', tablePos, rowKind, part }, part === 'color', start)
  }

  /** Hide it; `forget` also drops the target (never inside the view's update, where a dispatch is not allowed). */
  #hide(forget: boolean): void {
    if (!this.open) return
    const { view } = this
    const doc = view.dom.ownerDocument
    const focused = this.#el!.contains(doc.activeElement)
    this.#el!.hidden = true
    this.#box?.hide()
    doc.removeEventListener('keydown', this.#key, true)
    doc.removeEventListener('mousedown', this.#outside, true)
    doc.removeEventListener('scroll', this.#place, true)
    if (view.isDestroyed) return
    if (focused) view.focus()
    if (forget && pickKey.getState(view.state) !== null) view.dispatch(view.state.tr.setMeta(pickKey, null))
  }

  close = (): void => this.#hide(true)

  /** Under the target cells (or table header), or over them; never past the window's sides. All reads, then the writes. */
  #place = (): void => {
    const el = this.#el
    const target = pickKey.getState(this.view.state)
    if (el === null || target == null) return
    const win = this.view.dom.ownerDocument.defaultView
    let top: number
    let bottom: number
    let left: number
    if (target.kind === 'cells') {
      const cells = targetCellsOf(this.view.state, target)
      if (cells === null) return
      const a = (this.view.nodeDOM(cells.$anchorCell.pos) as HTMLElement | null)?.getBoundingClientRect()
      const b = (this.view.nodeDOM(cells.$headCell.pos) as HTMLElement | null)?.getBoundingClientRect()
      if (a === undefined || b === undefined) return
      top = Math.min(a.top, b.top)
      bottom = Math.max(a.bottom, b.bottom)
      left = Math.min(a.left, b.left)
    } else {
      const dom = this.view.nodeDOM(target.tablePos) as HTMLElement | null
      const anchor = dom?.querySelector<HTMLElement>(target.rowKind === 'subheader' ? 'td[data-subhead], th' : 'th') ?? dom
      const rect = anchor?.getBoundingClientRect()
      if (rect === undefined) return
      top = rect.top
      bottom = rect.bottom
      left = rect.left
    }
    const width = el.offsetWidth
    const height = el.offsetHeight
    const roomBelow = win === null || bottom + 4 + height <= win.innerHeight - 8
    const y = `${Math.round(roomBelow ? bottom + 4 : Math.max(8, top - 4 - height))}px`
    const x = `${Math.round(win === null ? left : Math.max(8, Math.min(left, win.innerWidth - width - 8)))}px`
    if (el.style.top !== y) el.style.top = y
    if (el.style.left !== x) el.style.left = x
  }

  /** Escape closes the box and goes no further. */
  #key = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    this.close()
  }

  #outside = (e: Event) => {
    if (e.target instanceof Node && this.#el?.contains(e.target)) return
    this.close()
  }

  update(view: EditorView, prev: EditorState): void {
    if (!this.open || prev.doc === view.state.doc) return
    // Its cells/table are gone: the box goes too (the state already has no target).
    if (!targetAlive(view.state)) this.#hide(false)
    else this.#place()
  }

  destroy(): void {
    this.#hide(false)
    this.#el?.remove()
    menuBoxes.delete(this.view)
  }
}

/** Keeps the menu box's target cells or table through every transaction (one map per change, nothing else), and the box. */
export const customColourPick = $prose(
  () =>
    new Plugin<Target>({
      key: pickKey,
      state: {
        init: () => null,
        apply: (tr, target) => {
          const meta = tr.getMeta(pickKey) as Target | undefined
          if (meta !== undefined) return meta
          if (target === null || !tr.docChanged) return target
          if (target.kind === 'cells') {
            const anchor = mapCell(tr, target.anchor)
            const head = mapCell(tr, target.head)
            return anchor === null || head === null ? null : { ...target, anchor, head }
          }
          const tablePos = mapCell(tr, target.tablePos)
          return tablePos === null ? null : { ...target, tablePos }
        },
      },
      view: (view) => new MenuColourBox(view),
    }),
)

/**
 * The table menu's Custom colour… for `attr` of the cells of `target` (YAZ-3817): the colour box under them, on
 * their custom colour when they all share one, else on black.
 */
export function pickCustomColour(view: EditorView, target: CellSelection, attr: 'fill' | 'color'): void {
  menuBoxes.get(view)?.show(target, attr)
}

/**
 * Custom colour… for a table's Header row or Subheader row Fill (`color`, with opacity slider) or Text (`text`) (YAZ-6693 #6).
 */
export function pickHeaderCustomColour(
  view: EditorView,
  tablePos: number,
  rowKind: 'header' | 'subheader',
  part: 'color' | 'text',
  start: Hex = START,
): void {
  menuBoxes.get(view)?.showRow(tablePos, rowKind, part, start)
}
