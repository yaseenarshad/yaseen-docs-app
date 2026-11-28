/**
 * The cell toolbar (YAZ-3768, YAZ-3696 🔒 D8): our own floating strip over a CellSelection of two
 * or more cells. Crepe's selection toolbar hides on any selection that is not a TextSelection, by
 * design, so this is a second toolbar, not a patch of it. It is placed by the same
 * `TooltipProvider` (`@milkdown/plugin-tooltip`, 20 ms throttle, 10 px offset, above the cells) and
 * drawn in the same look (`table.css`, Crepe's surface, shadow, hover and outline variables, so
 * light and dark follow).
 *
 * Left to right, with dividers: Fill and Text; Bold, Italic, Strikethrough; Align left, center,
 * right; Merge cells (YAZ-4792); Clear cells. Each button acts on EVERY selected cell in one transaction with the
 * history closed, so each click is one undo step (R4), and the cells stay selected.
 * - Fill and Text set the cells' `fill` / `color` (`tableStyle.ts`; the save writes the comment).
 *   Each is a label, three fixed quick swatches (Fill: yellow, green, blue; Text: red, blue, green)
 *   and a ▾ that opens a palette (YAZ-3817, demo round 2): the labeled clear item ("No fill" /
 *   "Default colour") first, then the ten named colours in a 5 × 2 grid, then "Custom colour…",
 *   which opens the note's colour box (`highlightColourBox.ts`, YAZ-4366) in the palette, right under
 *   the item, on the cells' one custom colour (else black). A custom colour saves as `#rrggbb`; a drag
 *   previews in the box only, and one finished pick (the release, Enter in an R G B field, the
 *   eyedropper) is one undo step on the cells selected, which stay selected; the box stays open for
 *   the next. One palette is open at a time; it closes on a named pick, on Escape (the box's first,
 *   when it is open), on a second ▾ click, on a mousedown in the editor and when the toolbar hides.
 * - A mark turns ON in every cell when any selected cell with text lacks it on some of its text,
 *   and OFF in all of them when every one has it (as Sheets does).
 * - Align sets the selected cells' own `align` (YAZ-3819), saved in the table comment; it wins over
 *   the column's GFM alignment (the `:-` row), which stays. A pick equal to a cell's column alignment
 *   clears the cell's own, so the cell follows its column again.
 * - Merge cells is `mergeCells` (`tableMerge.ts`): the selected cells become one, with every cell's text, top-left
 *   first. The button is disabled while the selection cannot merge (`mergeRect`: it cuts through a merged cell, runs
 *   from the header row into the body, or holds a folded row); the merged cell stays selected, as one cell, so the
 *   toolbar hides; its right-click has "Unmerge cells".
 * - Clear cells is prosemirror-tables' `deleteCellSelection` (Delete's own): the text goes, the
 *   cells keep their attributes.
 *
 * Hidden on a single caret or one cell, in a read-only page (R3), when the editor has no focus,
 * and while a mouse drag is selecting: a mousedown in the editor hides it, the mouseup shows it.
 * Also while the table menu is open (a right-click, or a handle's `TABLE_HANDLE_MENU`), so the two
 * never overlap; the next click in the editor shows it again.
 */
import { TooltipProvider } from '@milkdown/kit/plugin/tooltip'
import { closeHistory } from '@milkdown/kit/prose/history'
import type { MarkType } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@milkdown/kit/prose/state'
import { CellSelection, selectedRect } from '@milkdown/kit/prose/tables'
import { clearCells as clearSelected, deleteText, deleteWithNotes } from './cellNoteGuard'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { setCellsAlign, setCellsAttr } from './cells'
import { ColourGrid } from '../colourGrid'
import { clampFontSize, DEFAULT_FONT_SIZE, FONT_SIZE_MAX, FONT_SIZE_MIN, FONT_SIZE_PRESETS, isFontSize } from '../marks/fontSize'
import { capital, customStart, fillSwatch, setCustomColour, textSwatch } from './colours'
import { TABLE_HANDLE_MENU } from './tableMenu'
import { mergeCells, mergeRect } from './tableMerge'
import { CELL_ALIGNS, type CellAlign, type TableColor } from './tableStyle'

const SVG = (body: string) => `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`
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
/** A grid of four cells whose top two are one (YAZ-4792). */
const MERGE = SVG('<path d="M4 6h16v12H4zM4 12h16M12 12v6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>')

/** One cell attribute on every selected cell, in one transaction. */
function setCells(view: EditorView, attr: 'fill' | 'color', value: string | null): void {
  if (!(view.state.selection instanceof CellSelection)) return
  const tr = setCellsAttr(closeHistory(view.state.tr), selectedRect(view.state), attr, value)
  if (tr.docChanged) view.dispatch(tr)
}

/** The selected cells' own alignment: `null` where it is the column's (`setCellsAlign`). */
function alignCells(view: EditorView, align: CellAlign): void {
  if (!(view.state.selection instanceof CellSelection)) return
  const tr = setCellsAlign(closeHistory(view.state.tr), selectedRect(view.state), align)
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

/** The font size across every selected cell's text: one px number, `null` when all default, or `undefined` when mixed. */
function cellsFontSize(state: EditorState): number | null | undefined {
  const { selection, schema } = state
  const type = schema.marks.font_size
  if (!(selection instanceof CellSelection) || type === undefined) return null
  let found: number | null | undefined
  let mixed = false
  selection.forEachCell((cell) => {
    if (mixed) return
    cell.descendants((node) => {
      if (mixed || !node.isText) return !mixed
      const raw = type.isInSet(node.marks)?.attrs.size
      const size = isFontSize(raw) ? raw : null
      if (found === undefined) found = size
      else if (found !== size) mixed = true
      return !mixed
    })
  })
  return mixed ? undefined : (found ?? null)
}

/** Set (or clear on `null` / `DEFAULT_FONT_SIZE`) `font_size` on every selected cell in one undo step (YAZ-6695 #1). */
function setCellsFontSize(view: EditorView, size: number | null): void {
  const { selection, schema } = view.state
  const type = schema.marks.font_size
  if (!(selection instanceof CellSelection) || type === undefined) return
  const tr = closeHistory(view.state.tr)
  const remove = size === null || size === DEFAULT_FONT_SIZE
  const mark = remove ? null : type.create({ size: clampFontSize(size) })
  selection.forEachCell((cell, pos) => {
    if (mark === null) tr.removeMark(pos + 1, pos + cell.nodeSize - 1, type)
    else tr.addMark(pos + 1, pos + cell.nodeSize - 1, mark)
  })
  if (tr.docChanged) view.dispatch(tr)
}

/** Clear cells, asking first when a cell note would go (YAZ-4206 D16). */
function clearCells(view: EditorView): void {
  const { selection } = view.state
  let count = 0
  if (selection instanceof CellSelection) selection.forEachCell(() => count++)
  deleteWithNotes(view, clearSelected, (gone) => deleteText('cells', count, gone))
}

/** Merge the selected cells (YAZ-4792, `tableMerge.ts`): one undo step; the merged cell stays selected. */
function merge(view: EditorView): void {
  mergeCells(view.state, view.dispatch)
}

/** A button's `enabled` says when it can run; the toolbar sets `disabled` on each update. One without it always can. */
type Part = { name: string; icon: string; run: (view: EditorView) => void; enabled?: (state: EditorState) => boolean } | 'divider' | 'colours' | 'size'

const PARTS: Part[] = [
  'colours',
  'divider',
  { name: 'Bold', icon: letter('B', 'font-weight="700"'), run: (v) => toggleMark(v, 'strong') },
  { name: 'Italic', icon: letter('I', 'font-style="italic"'), run: (v) => toggleMark(v, 'emphasis') },
  { name: 'Strikethrough', icon: letter('S', 'text-decoration="line-through"'), run: (v) => toggleMark(v, 'strike_through') },
  'size',
  'divider',
  ...CELL_ALIGNS.map((a) => ({ name: `Align ${a}`, icon: alignIcon(a), run: (v: EditorView) => alignCells(v, a) })),
  'divider',
  { name: 'Merge cells', icon: MERGE, run: merge, enabled: (state) => mergeRect(state.selection) !== null },
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
  toggle: (palette: HTMLElement, arrow: HTMLElement, grid?: ColourGrid) => void
  close: () => void
}

/** Close a `ColourGrid`'s custom drawer if open, returning focus to the note. */
function hideGridBox(view: EditorView, grid: ColourGrid | undefined): void {
  if (grid === undefined || !grid.boxOpen) return
  const focused = grid.el.contains(view.dom.ownerDocument.activeElement)
  grid.closeCustom()
  if (focused && !view.isDestroyed) view.focus()
}

/** Selected cells' distinct current hex/named values for `attr`, for marking the active dot in `ColourGrid`. */
function selectedCellValues(state: EditorState, attr: 'fill' | 'color'): string[] {
  const { selection } = state
  if (!(selection instanceof CellSelection)) return []
  const found = new Set<string>()
  selection.forEachCell((cell) => {
    const v = cell.attrs[attr]
    if (typeof v === 'string' && v !== '') found.add(v)
  })
  return [...found]
}

/** A colour group: the label, the quick swatches, and the ▾ with the shared Google Docs 10×8 `ColourGrid` (YAZ-6727). */
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
  palette.setAttribute('role', 'dialog')
  palette.setAttribute('aria-label', group.menu)
  palette.hidden = true
  arrow.setAttribute('aria-haspopup', 'dialog')
  arrow.setAttribute('aria-expanded', 'false')
  arrow.setAttribute('aria-controls', palette.id)

  const grid = new ColourGrid(document, {
    noneLabel: group.clear,
    allowAlpha: group.attr === 'fill',
    defaultBoxHex: () => '#000000',
    onPick: (value, isCustom) => {
      const cells = view.state.selection
      if (!(cells instanceof CellSelection)) return
      if (isCustom) {
        setCustomColour(view, grid.el, cells, group.attr, value as `#${string}`)
        grid.render(selectedCellValues(view.state, group.attr), customStart(cells, group.attr))
      } else {
        palettes.close()
        setCells(view, group.attr, value)
      }
    },
    onClear: () => {
      palettes.close()
      setCells(view, group.attr, null)
    },
    onBoxClose: () => {
      if (!view.isDestroyed) view.focus()
    },
  })
  palette.append(grid.el)

  arrow.addEventListener('click', () => {
    palettes.toggle(palette, arrow, grid)
    if (!palette.hidden) {
      const cells = view.state.selection
      grid.render(selectedCellValues(view.state, group.attr), cells instanceof CellSelection ? customStart(cells, group.attr) : '#000000')
    }
  })

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

/** Multi-cell `[16 ▾]` Text size control with stepper, typed input, Default, and presets (YAZ-6695 #1). */
function renderSize(view: EditorView, palettes: Palettes): { el: HTMLElement; sync: (state: EditorState) => void } {
  const wrap = document.createElement('span')
  wrap.className = 'cell-toolbar__colours cell-toolbar__size'
  const trigger = toolButton(
    'Text size',
    `<span class="toolbar-size"><span class="toolbar-size__value">${DEFAULT_FONT_SIZE}</span><span class="toolbar-caret">▾</span></span>`,
    'toolbar-item cell-toolbar__size-btn',
  )
  const label = trigger.querySelector<HTMLElement>('.toolbar-size__value')!

  const palette = document.createElement('div')
  palette.className = 'cell-toolbar__palette cell-toolbar__size-palette'
  palette.id = `cell-toolbar-palette-${++paletteIds}`
  palette.setAttribute('role', 'dialog')
  palette.setAttribute('aria-label', 'Text size')
  palette.hidden = true
  trigger.setAttribute('aria-haspopup', 'dialog')
  trigger.setAttribute('aria-expanded', 'false')
  trigger.setAttribute('aria-controls', palette.id)

  const btn = (className: string, text: string, ariaLabel: string, run: () => void) => {
    const b = toolButton(ariaLabel, '', className)
    b.textContent = text
    b.addEventListener('click', run)
    return b
  }

  const step = (delta: number) => {
    const current = cellsFontSize(view.state)
    const base = typeof current === 'number' ? current : DEFAULT_FONT_SIZE
    setCellsFontSize(view, clampFontSize(base + delta))
  }

  const stepper = document.createElement('div')
  stepper.className = 'font-size-panel__stepper'
  const dec = btn('font-size-panel__step', '−', 'Decrease text size', () => step(-1))
  const inc = btn('font-size-panel__step', '+', 'Increase text size', () => step(1))

  const input = document.createElement('input')
  input.type = 'text'
  input.inputMode = 'numeric'
  input.className = 'font-size-panel__input'
  input.maxLength = 3
  input.spellcheck = false
  input.tabIndex = -1
  input.setAttribute('aria-label', 'Font size in pixels')
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      palettes.close()
      if (!view.isDestroyed) view.focus()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      const raw = input.value.trim()
      if (!/^\d+$/.test(raw)) return
      const n = Number(raw)
      if (n < 1) return
      const size = clampFontSize(Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, n)))
      if (!view.isDestroyed) view.focus()
      setCellsFontSize(view, size)
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      e.stopPropagation()
      const delta = e.key === 'ArrowUp' ? 1 : -1
      const current = /^\d+$/.test(input.value.trim()) ? Number(input.value.trim()) : DEFAULT_FONT_SIZE
      const next = clampFontSize(current + delta)
      input.value = String(next)
      setCellsFontSize(view, next)
    }
  })
  stepper.append(dec, input, inc)

  const def = btn('font-size-panel__default', 'Default', 'Default text size', () => setCellsFontSize(view, null))
  const list = document.createElement('div')
  list.className = 'font-size-panel__presets'
  const presets = new Map<number, HTMLButtonElement>()
  for (const size of FONT_SIZE_PRESETS) {
    const item = btn('font-size-panel__preset', String(size), `${size}px`, () => setCellsFontSize(view, size))
    item.dataset.size = String(size)
    presets.set(size, item)
    list.append(item)
  }

  palette.append(stepper, def, list)
  wrap.append(trigger, palette)

  const sync = (state: EditorState) => {
    const size = cellsFontSize(state)
    const shownText = size === undefined ? '—' : String(size ?? DEFAULT_FONT_SIZE)
    if (label.textContent !== shownText) label.textContent = shownText
    if (palette.hidden) return
    if (view.dom.ownerDocument.activeElement !== input) {
      const nextVal = size === undefined ? '' : String(size ?? DEFAULT_FONT_SIZE)
      if (input.value !== nextVal) input.value = nextVal
    }
    const placeholder = size === undefined ? '—' : ''
    if (input.placeholder !== placeholder) input.placeholder = placeholder
    const isDefault = size === null
    def.classList.toggle('active', isDefault)
    def.setAttribute('aria-pressed', String(isDefault))
    for (const [preset, b] of presets) {
      const on = size === preset || (isDefault && preset === DEFAULT_FONT_SIZE)
      b.classList.toggle('active', on)
      b.setAttribute('aria-pressed', String(on))
    }
  }

  trigger.addEventListener('click', () => {
    palettes.toggle(palette, trigger)
    if (!palette.hidden) sync(view.state)
  })

  return { el: wrap, sync }
}

/** The strip's DOM: Crepe's toolbar shape (`.divider`, `.toolbar-item`) on our own class, and the buttons with an `enabled` test. */
function renderStrip(view: EditorView, palettes: Palettes): { strip: HTMLElement; gated: Array<{ button: HTMLButtonElement; enabled: (state: EditorState) => boolean }>; syncSize: (state: EditorState) => void } {
  const strip = document.createElement('div')
  strip.className = 'cell-toolbar'
  strip.setAttribute('role', 'toolbar')
  strip.setAttribute('aria-label', 'Cells')
  const gated: Array<{ button: HTMLButtonElement; enabled: (state: EditorState) => boolean }> = []
  let syncSize: (state: EditorState) => void = () => {}
  for (const part of PARTS) {
    if (part === 'divider') {
      const line = document.createElement('div')
      line.className = 'divider'
      strip.appendChild(line)
    } else if (part === 'colours') {
      strip.append(renderColours(view, FILL, palettes), renderColours(view, TEXT, palettes))
    } else if (part === 'size') {
      const size = renderSize(view, palettes)
      syncSize = size.sync
      strip.appendChild(size.el)
    } else {
      const button = toolButton(part.name, part.icon)
      button.addEventListener('click', () => part.run(view))
      if (part.enabled !== undefined) gated.push({ button, enabled: part.enabled })
      strip.appendChild(button)
    }
  }
  return { strip, gated, syncSize }
}

/** Two or more cells selected. */
const manyCells = (state: EditorState): boolean => state.selection instanceof CellSelection && state.selection.ranges.length > 1

class CellToolbarView {
  #provider: TooltipProvider
  #strip: HTMLElement
  /** The buttons that are disabled while their test fails (Merge cells, YAZ-4792). */
  #gated: Array<{ button: HTMLButtonElement; enabled: (state: EditorState) => boolean }>
  #syncSize: (state: EditorState) => void
  #dragging = false
  #menu = false

  constructor(readonly view: EditorView) {
    const { strip, gated, syncSize } = renderStrip(view, { toggle: this.#togglePalette, close: this.#closePalettes })
    this.#strip = strip
    this.#gated = gated
    this.#syncSize = syncSize
    this.#provider = new TooltipProvider({
      content: strip,
      debounce: 20,
      offset: 10,
      shouldShow: (v) => {
        const focused = v.hasFocus() || strip.contains(v.root.activeElement)
        return !this.#dragging && !this.#menu && v.editable && focused && manyCells(v.state)
      },
    })
    this.#provider.onHide = this.#closePalettes
    view.dom.addEventListener('mousedown', this.#down)
    view.dom.addEventListener('contextmenu', this.#menuOpens)
    view.dom.addEventListener(TABLE_HANDLE_MENU, this.#menuOpens)
    view.dom.ownerDocument.addEventListener('mouseup', this.#up)
    this.update(view)
  }

  /** The open palette, its ▾ and its colour grid, or null. Escape listens only while one is open. */
  #open: { palette: HTMLElement; arrow: HTMLElement; grid?: ColourGrid } | null = null

  #togglePalette = (palette: HTMLElement, arrow: HTMLElement, grid?: ColourGrid) => {
    const same = this.#open?.palette === palette
    this.#closePalettes()
    if (same) return
    palette.hidden = false
    arrow.setAttribute('aria-expanded', 'true')
    this.#open = { palette, arrow, grid }
    this.view.dom.ownerDocument.addEventListener('keydown', this.#escape, true)
  }

  #closePalettes = () => {
    if (this.#open === null) return
    hideGridBox(this.view, this.#open.grid)
    this.#open.palette.hidden = true
    this.#open.arrow.setAttribute('aria-expanded', 'false')
    this.#open = null
    this.view.dom.ownerDocument.removeEventListener('keydown', this.#escape, true)
  }

  /** Escape closes the open palette's colour box, else the palette, and goes no further: the cells stay selected. */
  #escape = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || this.#open === null) return
    e.preventDefault()
    e.stopPropagation()
    if (this.#open.grid?.boxOpen === true) hideGridBox(this.view, this.#open.grid)
    else this.#closePalettes()
  }

  #menuOpens = () => {
    this.#menu = true
    this.#closePalettes()
    this.#provider.hide()
  }

  #down = (e: MouseEvent) => {
    this.#closePalettes()
    this.#menu = false
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
    // Only while the strip can show: a key press elsewhere reads no table map.
    if (manyCells(view.state)) {
      for (const { button, enabled } of this.#gated) button.disabled = !enabled(view.state)
      this.#syncSize(view.state)
    }
    this.#provider.update(view, prevState)
  }

  destroy() {
    this.view.dom.removeEventListener('mousedown', this.#down)
    this.view.dom.removeEventListener('contextmenu', this.#menuOpens)
    this.view.dom.removeEventListener(TABLE_HANDLE_MENU, this.#menuOpens)
    this.view.dom.ownerDocument.removeEventListener('mouseup', this.#up)
    this.#provider.destroy()
    this.#strip.remove()
  }
}

export const cellToolbar = $prose(() => new Plugin({ key: new PluginKey('mdapp-cell-toolbar'), view: (view) => new CellToolbarView(view) }))
