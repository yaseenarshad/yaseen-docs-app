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
import type { Hex } from '../../lib/colour'
import { ColourBox } from '../highlightColourBox'
import { setCellsAttr } from './cells'
import type { TableColor } from './tableComment'

/** A menu label from a value: `blue` → `Blue`. */
export const capital = (word: string) => word[0].toUpperCase() + word.slice(1)

/** Each swatch's colour: a fill at full strength in light and dark (`table.css`; the cells keep their wash). */
export const fillSwatch = (c: TableColor) => `var(--table-fill-solid-${c})`
export const textSwatch = (c: TableColor) => `var(--table-text-${c})`
/** A header row colour's swatch (YAZ-4794): the fill swatches, plus the header's own Black and White (`table.css`). */
export const headerSwatch = (c: string) => `var(--table-fill-solid-${c === 'gray' ? 'grey' : c})`

/** A custom fill's see-through wash: `table.css` `--table-fill-wash` (35%), and a copy to Docs (`clipboardCopyOut.ts`). */
export const FILL_WASH = 0.35

/** Where the box opens when the cells have no one custom colour, as the system picker did. */
const START: Hex = '#000000'

/** The cells' one custom colour of `attr`, else black: where the box opens. */
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

/** The target's corner cells (their positions) while the table menu's box is open, or null. */
type Target = { anchor: number; head: number } | null
const pickKey = new PluginKey<Target>('mdapp-custom-colour-pick')

/** A cell node still starts at `pos`, mapped through `tr`; `null` when it was deleted. */
const mapCell = (tr: Transaction, pos: number): number | null => {
  const mapped = tr.mapping.mapResult(pos)
  return mapped.deletedAfter ? null : mapped.pos
}

/** The target again as a CellSelection of `state`, or null when its cells are no longer one table's cells. */
function targetOf(state: EditorState): CellSelection | null {
  const target = pickKey.getState(state)
  if (target == null) return null
  const isCell = (pos: number) => ['cell', 'header_cell'].includes(state.doc.nodeAt(pos)?.type.spec.tableRole as string)
  if (!isCell(target.anchor) || !isCell(target.head)) return null
  const $anchor = state.doc.resolve(target.anchor)
  const $head = state.doc.resolve(target.head)
  return $anchor.start(-1) === $head.start(-1) ? new CellSelection($anchor, $head) : null
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
  #attr: 'fill' | 'color' = 'fill'

  constructor(readonly view: EditorView) {
    menuBoxes.set(view, this)
  }

  get open(): boolean {
    return this.#el !== null && !this.#el.hidden
  }

  show(target: CellSelection, attr: 'fill' | 'color'): void {
    const { view } = this
    const doc = view.dom.ownerDocument
    if (this.#el === null) {
      this.#el = doc.createElement('div')
      this.#el.className = 'table-colour-box'
      this.#el.setAttribute('role', 'dialog')
      this.#el.setAttribute('aria-label', 'Custom colour')
      this.#box = new ColourBox(doc, {
        preview: () => {},
        pick: (color) => {
          const cells = targetOf(view.state)
          if (cells !== null) setCustomColour(view, this.#el!, cells, this.#attr, color)
        },
        close: this.close,
      })
      this.#el.append(this.#box.el)
    }
    if (!this.#el.isConnected) doc.body.appendChild(this.#el)
    this.#attr = attr
    view.dispatch(view.state.tr.setMeta(pickKey, { anchor: target.$anchorCell.pos, head: target.$headCell.pos }))
    this.#el.hidden = false
    this.#box!.show(customStart(target, attr))
    this.#place()
    doc.addEventListener('keydown', this.#key, true)
    doc.addEventListener('mousedown', this.#outside, true)
    doc.addEventListener('scroll', this.#place, true)
  }

  /** Hide it; `forget` also drops the target (never inside the view's update, where a dispatch is not allowed). */
  #hide(forget: boolean): void {
    if (!this.open) return
    const { view } = this
    const doc = view.dom.ownerDocument
    const focused = this.#el!.contains(doc.activeElement)
    this.#el!.hidden = true
    this.#box!.hide()
    doc.removeEventListener('keydown', this.#key, true)
    doc.removeEventListener('mousedown', this.#outside, true)
    doc.removeEventListener('scroll', this.#place, true)
    if (view.isDestroyed) return
    if (focused) view.focus()
    if (forget && pickKey.getState(view.state) !== null) view.dispatch(view.state.tr.setMeta(pickKey, null))
  }

  close = (): void => this.#hide(true)

  /** Under the target cells, or over them; never past the window's sides. All reads, then the writes. */
  #place = (): void => {
    const el = this.#el
    const cells = targetOf(this.view.state)
    if (el === null || cells === null) return
    const win = this.view.dom.ownerDocument.defaultView
    const a = (this.view.nodeDOM(cells.$anchorCell.pos) as HTMLElement | null)?.getBoundingClientRect()
    const b = (this.view.nodeDOM(cells.$headCell.pos) as HTMLElement | null)?.getBoundingClientRect()
    if (a === undefined || b === undefined) return
    const top = Math.min(a.top, b.top)
    const bottom = Math.max(a.bottom, b.bottom)
    const left = Math.min(a.left, b.left)
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
    // Its cells are gone: the box goes too (the state already has no target).
    if (targetOf(view.state) === null) this.#hide(false)
    else this.#place()
  }

  destroy(): void {
    this.#hide(false)
    this.#el?.remove()
    menuBoxes.delete(this.view)
  }
}

/** Keeps the menu box's target cells through every transaction (one map per change, nothing else), and the box. */
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
          const anchor = mapCell(tr, target.anchor)
          const head = mapCell(tr, target.head)
          return anchor === null || head === null ? null : { anchor, head }
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
