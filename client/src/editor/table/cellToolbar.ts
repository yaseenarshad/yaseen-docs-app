/**
 * The cell toolbar (YAZ-3768, YAZ-3696 🔒 D8): our own floating strip over a CellSelection of two
 * or more cells. Crepe's selection toolbar hides on any selection that is not a TextSelection, by
 * design, so this is a second toolbar, not a patch of it. It is placed by the same
 * `TooltipProvider` (`@milkdown/plugin-tooltip`, 20 ms throttle, 10 px offset, above the cells) and
 * drawn in the same look (`table.css`, Crepe's surface, shadow, hover and outline variables, so
 * light and dark follow).
 *
 * Left to right, with dividers: Fill and Text; Bold, Italic, Strikethrough; Align left, center,
 * right; Clear cells. Each button acts on EVERY selected cell in one transaction with the history
 * closed, so each click is one undo step (R4), and the cells stay selected.
 * - Fill and Text set the cells' `fill` / `color` (`tableStyle.ts`; the save writes the comment).
 *   Each is a label, three fixed quick swatches (Fill: yellow, green, blue; Text: red, blue, green)
 *   and a ▾ that opens a palette (YAZ-3817, demo round 2): the labeled clear item ("No fill" /
 *   "Default colour") first, then the ten named colours in a 5 × 2 grid, then "Custom colour…",
 *   which opens the system colour picker (`<input type="color">`). A custom colour saves as
 *   `#rrggbb`, on the input's `change` only (its live `input` events do nothing), so one pick is one
 *   undo step. One palette is open at a time; it closes on a pick, on Escape, on a second ▾ click,
 *   on a mousedown in the editor and when the toolbar hides.
 * - A mark turns ON in every cell when any selected cell with text lacks it on some of its text,
 *   and OFF in all of them when every one has it (as Sheets does).
 * - Align sets the selected cells' own `align` (YAZ-3819), saved in the table comment; it wins over
 *   the column's GFM alignment (the `:-` row), which stays.
 * - Clear cells is prosemirror-tables' `deleteCellSelection` (Delete's own): the text goes, the
 *   cells keep their attributes.
 *
 * Hidden on a single caret or one cell, in a read-only note (R3), when the editor has no focus,
 * and while a mouse drag is selecting: a mousedown in the editor hides it, the mouseup shows it.
 */
import { TooltipProvider } from '@milkdown/kit/plugin/tooltip'
import { closeHistory } from '@milkdown/kit/prose/history'
import type { MarkType } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@milkdown/kit/prose/state'
import { CellSelection, deleteCellSelection, selectedRect } from '@milkdown/kit/prose/tables'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { setCellsAttr } from './cells'
import { CELL_ALIGNS, TABLE_COLORS, cellColor, type CellAlign, type TableColor } from './tableStyle'

/** A menu label from a value: `blue` → `Blue`. */
export const capital = (word: string) => word[0].toUpperCase() + word.slice(1)

const SVG = (body: string) => `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`
/** Each swatch's colour: a fill at full strength in light and dark (`table.css`; the cells keep their wash). */
export const fillSwatch = (c: TableColor) => `var(--table-fill-solid-${c})`
export const textSwatch = (c: TableColor) => `var(--table-text-${c})`
const CARET = SVG('<path d="M8 10l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>')

/** A letter drawn as text, as createCrepe's heading glyphs. */
const letter = (text: string, style: string) =>
  SVG(`<text x="12" y="17" text-anchor="middle" font-size="15" font-family="inherit" fill="currentColor" ${style}>${text}</text>`)
/** Three lines, the short ones placed to the side the text aligns to. */
const alignIcon = (align: CellAlign) => {
  const x = align === 'left' ? 5 : align === 'center' ? 8 : 11
  return SVG(`<path d="M5 7h14M${x} 12h8M5 17h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`)
}
const CLEAR = SVG('<path d="M8 8l8 8M16 8l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>')

/**
 * The system colour picker (YAZ-3817), for the toolbar and the table menu (YAZ-3820): one hidden
 * `<input type="color">` per document (not `display: none`, so its `click()` opens the picker). Its
 * `change` gives `onPick` the colour as `#rrggbb`; its live `input` events do nothing, so one pick
 * is one undo step.
 */
const pickers = new WeakMap<Document, { input: HTMLInputElement; onPick: (color: string) => void }>()
export function pickCustomColour(doc: Document, onPick: (color: string) => void): void {
  let picker = pickers.get(doc)
  if (picker === undefined) {
    const input = doc.createElement('input')
    input.type = 'color'
    input.className = 'table-colour-input'
    input.tabIndex = -1
    input.setAttribute('aria-hidden', 'true')
    doc.body.appendChild(input)
    const made = { input, onPick }
    input.addEventListener('change', () => {
      const color = cellColor(input.value)
      if (color !== null) made.onPick(color)
    })
    pickers.set(doc, made)
    picker = made
  }
  picker.onPick = onPick
  picker.input.click()
}

/** One cell attribute on every selected cell, in one transaction. */
function setCells(view: EditorView, attr: 'fill' | 'color' | 'align', value: string | null): void {
  if (!(view.state.selection instanceof CellSelection)) return
  const tr = setCellsAttr(closeHistory(view.state.tr), selectedRect(view.state), attr, value)
  if (tr.docChanged) view.dispatch(tr)
}

/** `true` when some selected cell with text has some text without the mark. */
function anyLacks(selection: CellSelection, type: MarkType): boolean {
  let lacks = false
  selection.forEachCell((cell) => {
    cell.descendants((node) => {
      if (node.isText && !type.isInSet(node.marks)) lacks = true
      return !lacks
    })
  })
  return lacks
}

/** The mark on in every selected cell when any lacks it, else off in all of them. */
function toggleMark(view: EditorView, name: string): void {
  const { selection, schema } = view.state
  const type = schema.marks[name]
  if (!(selection instanceof CellSelection) || type === undefined) return
  const on = anyLacks(selection, type)
  const tr = closeHistory(view.state.tr)
  selection.forEachCell((cell, pos) => {
    if (on) tr.addMark(pos + 1, pos + cell.nodeSize - 1, type.create())
    else tr.removeMark(pos + 1, pos + cell.nodeSize - 1, type)
  })
  if (tr.docChanged) view.dispatch(tr)
}

function clearCells(view: EditorView): void {
  deleteCellSelection(view.state, (tr: Transaction) => view.dispatch(closeHistory(tr)))
}

type Part = { name: string; icon: string; run: (view: EditorView) => void } | 'divider' | 'colours'

const PARTS: Part[] = [
  'colours',
  'divider',
  { name: 'Bold', icon: letter('B', 'font-weight="700"'), run: (v) => toggleMark(v, 'strong') },
  { name: 'Italic', icon: letter('I', 'font-style="italic"'), run: (v) => toggleMark(v, 'emphasis') },
  { name: 'Strikethrough', icon: letter('S', 'text-decoration="line-through"'), run: (v) => toggleMark(v, 'strike_through') },
  'divider',
  ...CELL_ALIGNS.map((a) => ({ name: `Align ${a}`, icon: alignIcon(a), run: (v: EditorView) => setCells(v, 'align', a) })),
  'divider',
  { name: 'Clear cells', icon: CLEAR, run: clearCells },
]

/** A toolbar button that keeps the editor's focus, so the cells stay selected. */
function toolButton(name: string, icon: string, className = 'toolbar-item'): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = className
  button.title = name
  button.setAttribute('aria-label', name)
  button.innerHTML = icon
  button.addEventListener('mousedown', (e) => e.preventDefault())
  return button
}

/** One colour group's settings: the cell attribute, its quick colours, and the names and swatches. */
interface ColourGroup {
  attr: 'fill' | 'color'
  label: string
  quick: readonly TableColor[]
  /** A quick swatch's content, in its colour. */
  quickIcon: (c: TableColor) => string
  /** A quick swatch's name: `Fill yellow`, `Red text`. */
  name: (c: TableColor) => string
  menu: string
  clear: string
  swatch: (c: TableColor) => string
}

let paletteIds = 0

/** The toolbar's one open palette: `toggle` opens a palette (closing the other) or closes it. */
interface Palettes {
  toggle: (palette: HTMLElement, arrow: HTMLElement) => void
  close: () => void
}

/** A colour group: the label, the quick swatches, and the ▾ with its palette. */
function renderColours(view: EditorView, group: ColourGroup, palettes: Palettes): HTMLElement {
  const box = document.createElement('span')
  box.className = 'cell-toolbar__colours'
  const label = document.createElement('span')
  label.className = 'cell-toolbar__label'
  label.textContent = group.label
  box.appendChild(label)
  for (const c of group.quick) {
    const button = toolButton(group.name(c), group.quickIcon(c), 'toolbar-item cell-toolbar__quick')
    button.addEventListener('click', () => setCells(view, group.attr, c))
    box.appendChild(button)
  }
  const arrow = toolButton(group.menu, CARET, 'toolbar-item cell-toolbar__arrow')
  const palette = document.createElement('div')
  palette.className = 'cell-toolbar__palette'
  palette.id = `cell-toolbar-palette-${++paletteIds}`
  palette.setAttribute('role', 'menu')
  palette.setAttribute('aria-label', group.menu)
  palette.hidden = true
  arrow.setAttribute('aria-haspopup', 'menu')
  arrow.setAttribute('aria-expanded', 'false')
  arrow.setAttribute('aria-controls', palette.id)
  arrow.addEventListener('click', () => palettes.toggle(palette, arrow))
  const item = (name: string, run: () => void, className: string) => {
    const button = toolButton(name, '', className)
    button.setAttribute('role', 'menuitem')
    button.addEventListener('click', () => {
      palettes.close()
      run()
    })
    return button
  }
  const clear = item(group.clear, () => setCells(view, group.attr, null), 'cell-toolbar__clear')
  clear.textContent = group.clear
  const swatches = document.createElement('div')
  swatches.className = 'cell-toolbar__swatches'
  for (const c of TABLE_COLORS) {
    const button = item(capital(c), () => setCells(view, group.attr, c), 'cell-toolbar__swatch-item')
    const swatch = document.createElement('span')
    swatch.className = 'cell-toolbar__swatch'
    swatch.style.background = group.swatch(c)
    button.appendChild(swatch)
    swatches.appendChild(button)
  }
  const custom = item('Custom colour…', () => pickCustomColour(view.dom.ownerDocument, (color) => setCells(view, group.attr, color)), 'cell-toolbar__clear')
  custom.textContent = 'Custom colour…'
  palette.append(clear, swatches, custom)
  box.append(arrow, palette)
  return box
}

const FILL: ColourGroup = {
  attr: 'fill', label: 'Fill', quick: ['yellow', 'green', 'blue'], quickIcon: (c) => `<span class="cell-toolbar__swatch" style="background: ${fillSwatch(c)}"></span>`,
  name: (c) => `Fill ${c}`, menu: 'Fill colours', clear: 'No fill', swatch: fillSwatch,
}
const TEXT: ColourGroup = {
  attr: 'color', label: 'Text', quick: ['red', 'blue', 'green'], quickIcon: (c) => SVG(`<text x="12" y="18" text-anchor="middle" font-size="17" font-weight="700" font-family="inherit" fill="${textSwatch(c)}">A</text>`),
  name: (c) => `${capital(c)} text`, menu: 'Text colours', clear: 'Default colour', swatch: textSwatch,
}

/** The strip's DOM: Crepe's toolbar shape (`.divider`, `.toolbar-item`) on our own class. */
function renderStrip(view: EditorView, palettes: Palettes): HTMLElement {
  const strip = document.createElement('div')
  strip.className = 'cell-toolbar'
  strip.setAttribute('role', 'toolbar')
  strip.setAttribute('aria-label', 'Cells')
  for (const part of PARTS) {
    if (part === 'divider') {
      const line = document.createElement('div')
      line.className = 'divider'
      strip.appendChild(line)
    } else if (part === 'colours') {
      strip.append(renderColours(view, FILL, palettes), renderColours(view, TEXT, palettes))
    } else {
      const button = toolButton(part.name, part.icon)
      button.addEventListener('click', () => part.run(view))
      strip.appendChild(button)
    }
  }
  return strip
}

/** Two or more cells selected. */
const manyCells = (state: EditorState): boolean => state.selection instanceof CellSelection && state.selection.ranges.length > 1

class CellToolbarView {
  #provider: TooltipProvider
  #strip: HTMLElement
  #dragging = false

  constructor(readonly view: EditorView) {
    const strip = renderStrip(view, { toggle: this.#togglePalette, close: this.#closePalettes })
    this.#strip = strip
    this.#provider = new TooltipProvider({
      content: strip,
      debounce: 20,
      offset: 10,
      shouldShow: (v) => {
        const focused = v.hasFocus() || strip.contains(v.root.activeElement)
        return !this.#dragging && v.editable && focused && manyCells(v.state)
      },
    })
    this.#provider.onHide = this.#closePalettes
    view.dom.addEventListener('mousedown', this.#down)
    view.dom.ownerDocument.addEventListener('mouseup', this.#up)
    this.update(view)
  }

  /** The open palette and its ▾, or null. Escape listens only while one is open. */
  #open: { palette: HTMLElement; arrow: HTMLElement } | null = null

  #togglePalette = (palette: HTMLElement, arrow: HTMLElement) => {
    const same = this.#open?.palette === palette
    this.#closePalettes()
    if (same) return
    palette.hidden = false
    arrow.setAttribute('aria-expanded', 'true')
    this.#open = { palette, arrow }
    this.view.dom.ownerDocument.addEventListener('keydown', this.#escape, true)
  }

  #closePalettes = () => {
    if (this.#open === null) return
    this.#open.palette.hidden = true
    this.#open.arrow.setAttribute('aria-expanded', 'false')
    this.#open = null
    this.view.dom.ownerDocument.removeEventListener('keydown', this.#escape, true)
  }

  /** Escape closes the open palette and goes no further: the cells stay selected. */
  #escape = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    this.#closePalettes()
  }

  #down = (e: MouseEvent) => {
    this.#closePalettes()
    if (e.button !== 0) return
    this.#dragging = true
    this.#provider.hide()
  }

  #up = () => {
    if (!this.#dragging) return
    this.#dragging = false
    // No previous state: the provider looks again, though the selection has not changed since the drag.
    this.#provider.update(this.view)
  }

  update(view: EditorView, prevState?: EditorState) {
    if (this.#open !== null && !manyCells(view.state)) this.#closePalettes()
    this.#provider.update(view, prevState)
  }

  destroy() {
    this.view.dom.removeEventListener('mousedown', this.#down)
    this.view.dom.ownerDocument.removeEventListener('mouseup', this.#up)
    this.#provider.destroy()
    this.#strip.remove()
  }
}

export const cellToolbar = $prose(() => new Plugin({ key: new PluginKey('mdapp-cell-toolbar'), view: (view) => new CellToolbarView(view) }))
