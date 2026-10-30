/**
 * The cell toolbar (YAZ-3768, YAZ-3696 🔒 D8): our own floating strip over a CellSelection of two
 * or more cells. Crepe's selection toolbar hides on any selection that is not a TextSelection, by
 * design, so this is a second toolbar, not a patch of it. It is placed by the same
 * `TooltipProvider` (`@milkdown/plugin-tooltip`, 20 ms throttle, 10 px offset, above the cells) and
 * drawn in the same look (`table.css`, Crepe's surface, shadow, hover and outline variables, so
 * light and dark follow).
 *
 * Left to right, with dividers: "Fill" and the four fills (D3) + none; "Text" and the five text
 * colours + default; Bold, Italic, Strikethrough; Align left, center, right; Clear cells. Each
 * button acts on EVERY selected cell in one transaction with the history closed, so each click is
 * one undo step (R4), and the cells stay selected.
 * - Fill and Text set the cells' `fill` / `color` (`tableStyle.ts`; the save writes the comment).
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
import { FILL_COLORS, TEXT_COLORS } from './tableStyle'

/** A column's GFM alignments, as the toolbar and "Align all columns" (`tableRows.ts`) offer them. */
export const ALIGNS = ['left', 'center', 'right'] as const
export type TableAlign = (typeof ALIGNS)[number]
/** A menu label from a value: `blue` → `Blue`. */
export const capital = (word: string) => word[0].toUpperCase() + word.slice(1)

const SVG = (body: string) => `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`
/** A square swatch; `null` is "none": an empty square with a slash. */
const swatch = (fill: string | null) =>
  SVG(
    fill === null
      ? '<rect x="5" y="5" width="14" height="14" rx="2" fill="none" stroke="currentColor" stroke-opacity="0.5"/><path d="M6 18L18 6" stroke="currentColor" stroke-opacity="0.6" stroke-width="1.5"/>'
      : `<rect x="5" y="5" width="14" height="14" rx="2" fill="${fill}" stroke="currentColor" stroke-opacity="0.35"/>`,
  )
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

type Part = { label: string } | { name: string; icon: string; run: (view: EditorView) => void } | 'divider'

const PARTS: Part[] = [
  { label: 'Fill' },
  ...FILL_COLORS.map((c) => ({ name: `Fill ${c}`, icon: swatch(c === 'yellow' ? 'var(--mark-bg)' : `var(--mark-bg-${c})`), run: (v: EditorView) => setCells(v, 'fill', c) })),
  { name: 'No fill', icon: swatch(null), run: (v) => setCells(v, 'fill', null) },
  'divider',
  { label: 'Text' },
  ...TEXT_COLORS.map((c) => ({ name: `${capital(c)} text`, icon: swatch(`var(--table-text-${c})`), run: (v: EditorView) => setCells(v, 'color', c) })),
  { name: 'Default text colour', icon: swatch('var(--crepe-color-on-background)'), run: (v) => setCells(v, 'color', null) },
  'divider',
  { name: 'Bold', icon: letter('B', 'font-weight="700"'), run: (v) => toggleMark(v, 'strong') },
  { name: 'Italic', icon: letter('I', 'font-style="italic"'), run: (v) => toggleMark(v, 'emphasis') },
  { name: 'Strikethrough', icon: letter('S', 'text-decoration="line-through"'), run: (v) => toggleMark(v, 'strike_through') },
  'divider',
  ...ALIGNS.map((a) => ({ name: `Align ${a}`, icon: alignIcon(a), run: (v: EditorView) => alignColumns(v, a) })),
  'divider',
  { name: 'Clear cells', icon: CLEAR, run: clearCells },
]

/** The strip's DOM: Crepe's toolbar shape (`.divider`, `.toolbar-item`) on our own class. */
function renderStrip(view: EditorView): HTMLElement {
  const strip = document.createElement('div')
  strip.className = 'cell-toolbar'
  strip.setAttribute('role', 'toolbar')
  strip.setAttribute('aria-label', 'Cells')
  for (const part of PARTS) {
    if (part === 'divider') {
      const line = document.createElement('div')
      line.className = 'divider'
      strip.appendChild(line)
    } else if ('label' in part) {
      const label = document.createElement('span')
      label.className = 'cell-toolbar__label'
      label.textContent = part.label
      strip.appendChild(label)
    } else {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'toolbar-item'
      button.title = part.name
      button.setAttribute('aria-label', part.name)
      button.innerHTML = part.icon
      // The editor keeps the focus and the cells stay selected.
      button.addEventListener('mousedown', (e) => e.preventDefault())
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
    const strip = renderStrip(view)
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
    view.dom.addEventListener('mousedown', this.#down)
    view.dom.ownerDocument.addEventListener('mouseup', this.#up)
    this.update(view)
  }

  #down = (e: MouseEvent) => {
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
