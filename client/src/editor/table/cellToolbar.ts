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
 *   Each is a split button, as Sheets' (YAZ-3803, demo round 1 decisions 1 and 12): the icon, with
 *   a bar in the last colour used, applies that colour; the ▾ opens a palette, the labeled clear
 *   item ("No fill" / "Default colour") first, then solid swatches. A swatch becomes the last
 *   colour; the clear item does not. The last colours start as yellow and red, one pair per window,
 *   in memory. One palette is open at a time; it closes on a pick, on Escape, on a second ▾ click,
 *   on a mousedown in the editor and when the toolbar hides.
 * - A mark turns ON in every cell when any selected cell with text lacks it on some of its text,
 *   and OFF in all of them when every one has it (as Sheets does).
 * - Align sets the GFM alignment of each selected COLUMN, every row of it: the `:-` row has one
 *   alignment per column, so a column is the smallest thing it can hold.
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
import { FILL_COLORS, TEXT_COLORS, type FillColor, type TextColor } from './tableStyle'

/** A column's GFM alignments, as the toolbar and "Align all columns" (`tableRows.ts`) offer them. */
export const ALIGNS = ['left', 'center', 'right'] as const
export type TableAlign = (typeof ALIGNS)[number]
/** A menu label from a value: `blue` → `Blue`. */
export const capital = (word: string) => word[0].toUpperCase() + word.slice(1)

const SVG = (body: string) => `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`
/** Each palette swatch's colour: solid in light and dark (`table.css`; the cells keep their wash). */
const fillSwatch = (c: FillColor) => `var(--table-fill-solid-${c})`
const textSwatch = (c: TextColor) => `var(--table-text-${c})`
/** An icon over a bar that shows the last colour (Material's format_color_fill / format_color_text). */
const barIcon = (path: string) => SVG(`<path d="${path}" fill="currentColor"/><rect class="cell-toolbar__bar" x="2" y="19.5" width="20" height="3.5" rx="1"/>`)
const BUCKET = barIcon(
  'M16.56 8.94L7.62 0 6.21 1.41l2.38 2.38-5.15 5.15c-.59.59-.59 1.54 0 2.12l5.5 5.5c.29.29.68.44 1.06.44s.77-.15 1.06-.44l5.5-5.5c.59-.58.59-1.53 0-2.12zM5.21 10L10 5.21 14.79 10H5.21zM19 11.5s-2 2.17-2 3.5c0 1.1.9 2 2 2s2-.9 2-2c0-1.33-2-3.5-2-3.5z',
)
const LETTER_A = barIcon('M11 2L5.5 16h2.25l1.12-3h6.25l1.12 3h2.25L13 2h-2zm-1.38 9L12 4.67 14.38 11H9.62z')
const CARET = SVG('<path d="M8 10l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>')

/** The last colours used, for the window, in memory (YAZ-3803): each icon button applies its one. */
const last: { fill: FillColor; color: TextColor } = { fill: 'yellow', color: 'red' }

/** A letter drawn as text, as createCrepe's heading glyphs. */
const letter = (text: string, style: string) =>
  SVG(`<text x="12" y="17" text-anchor="middle" font-size="15" font-family="inherit" fill="currentColor" ${style}>${text}</text>`)
/** Three lines, the short ones placed to the side the text aligns to. */
const alignIcon = (align: TableAlign) => {
  const x = align === 'left' ? 5 : align === 'center' ? 8 : 11
  return SVG(`<path d="M5 7h14M${x} 12h8M5 17h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`)
}
const CLEAR = SVG('<path d="M8 8l8 8M16 8l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>')

/** One cell attribute on every selected cell, in one transaction. */
function setCells(view: EditorView, attr: 'fill' | 'color', value: string | null): void {
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

/** The alignment of each selected column, every row of it. */
function alignColumns(view: EditorView, align: TableAlign): void {
  if (!(view.state.selection instanceof CellSelection)) return
  const rect = selectedRect(view.state)
  const tr = setCellsAttr(closeHistory(view.state.tr), { ...rect, top: 0, bottom: rect.map.height }, 'alignment', align)
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
  ...ALIGNS.map((a) => ({ name: `Align ${a}`, icon: alignIcon(a), run: (v: EditorView) => alignColumns(v, a) })),
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

/** One split button's settings: the cell attribute, its colours, and the names and swatches. */
interface ColourSplit<C extends string> {
  attr: 'fill' | 'color'
  colors: readonly C[]
  get: () => C
  set: (c: C) => void
  icon: string
  /** The icon button's name for the colour it applies: `Fill yellow`, `Red text`. */
  name: (c: C) => string
  menu: string
  clear: string
  swatch: (c: C) => string
}

let paletteIds = 0

/**
 * The toolbar's one open palette: `toggle` opens a palette (closing the other) or closes it. Each
 * split button adds its `paint` to `paints`, which the toolbar runs when it shows: another editor in
 * this window may have picked a colour since.
 */
interface Palettes {
  toggle: (palette: HTMLElement, arrow: HTMLElement) => void
  close: () => void
  paints: Array<() => void>
}

/** A split button: the icon applies the last colour, the ▾ opens the palette. */
function renderSplit<C extends string>(view: EditorView, split: ColourSplit<C>, palettes: Palettes): HTMLElement {
  const box = document.createElement('span')
  box.className = 'cell-toolbar__split'
  const apply = toolButton(split.name(split.get()), split.icon)
  const bar = apply.querySelector<SVGElement>('.cell-toolbar__bar')!
  const paint = () => {
    const name = split.name(split.get())
    apply.title = name
    apply.setAttribute('aria-label', name)
    bar.style.fill = split.swatch(split.get())
  }
  paint()
  palettes.paints.push(paint)
  apply.addEventListener('click', () => setCells(view, split.attr, split.get()))
  const arrow = toolButton(split.menu, CARET, 'toolbar-item cell-toolbar__arrow')
  const palette = document.createElement('div')
  palette.className = 'cell-toolbar__palette'
  palette.id = `cell-toolbar-palette-${++paletteIds}`
  palette.setAttribute('role', 'menu')
  palette.setAttribute('aria-label', split.menu)
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
  const clear = item(split.clear, () => setCells(view, split.attr, null), 'cell-toolbar__clear')
  clear.textContent = split.clear
  const swatches = document.createElement('div')
  swatches.className = 'cell-toolbar__swatches'
  for (const c of split.colors) {
    const button = item(capital(c), () => {
      split.set(c)
      paint()
      setCells(view, split.attr, c)
    }, 'cell-toolbar__swatch-item')
    const swatch = document.createElement('span')
    swatch.className = 'cell-toolbar__swatch'
    swatch.style.background = split.swatch(c)
    button.appendChild(swatch)
    swatches.appendChild(button)
  }
  palette.append(clear, swatches)
  box.append(apply, arrow, palette)
  return box
}

const FILL: ColourSplit<FillColor> = {
  attr: 'fill', colors: FILL_COLORS, get: () => last.fill, set: (c) => { last.fill = c }, icon: BUCKET,
  name: (c) => `Fill ${c}`, menu: 'Fill colours', clear: 'No fill', swatch: fillSwatch,
}
const TEXT: ColourSplit<TextColor> = {
  attr: 'color', colors: TEXT_COLORS, get: () => last.color, set: (c) => { last.color = c }, icon: LETTER_A,
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
      strip.append(renderSplit(view, FILL, palettes), renderSplit(view, TEXT, palettes))
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
    const paints: Array<() => void> = []
    const strip = renderStrip(view, { toggle: this.#togglePalette, close: this.#closePalettes, paints })
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
    this.#provider.onShow = () => paints.forEach((paint) => paint())
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
