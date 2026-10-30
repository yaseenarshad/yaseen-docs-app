/**
 * Test helpers for the table block on the real editor in jsdom (YAZ-3696: `tableBlock.test.ts`, `tableZoom.test.ts`).
 * jsdom has no layout, so the helpers give each cell a box: 100 × 30 layout px, times the document zoom on screen.
 */
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe } from './createCrepe'

export const TABLE = '| h1 | h2 |\n| --- | --- |\n| a | b |\n| c | d |\n'
const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

/** Mount a note; `zoom` is the document zoom on `.ProseMirror` (app.css `--document-zoom`). Undo with `unmountAll`. */
export async function mountTable(markdown = TABLE, zoom = 1): Promise<EditorView> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown })
  await crepe.create()
  mounted.push({ crepe, root })
  const view = crepe.editor.ctx.get(editorViewCtx)
  view.focus()
  Object.defineProperty(view.dom, 'currentCSSZoom', { value: zoom, configurable: true })
  view.posAtCoords = ({ left, top }) => {
    const pos = cellPos(view, Math.floor(top / (30 * zoom)), Math.floor(left / (100 * zoom)))
    return { pos: pos + 2, inside: pos + 1 }
  }
  for (const cell of view.dom.querySelectorAll('td, th')) {
    const row = (cell.parentElement as HTMLTableRowElement).rowIndex, col = (cell as HTMLTableCellElement).cellIndex
    Object.defineProperty(cell, 'offsetWidth', { value: 100, configurable: true })
    cell.getBoundingClientRect = () => new DOMRect(col * 100 * zoom, row * 30 * zoom, 100 * zoom, 30 * zoom)
  }
  return view
}

export async function unmountAll() {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
}

/** Position of the cell at (row, col) of the first table. */
export function cellPos(view: EditorView, row: number, col: number): number {
  const cells: number[][] = []
  view.state.doc.descendants((node, pos) => {
    if (node.type.name === 'table_header_row' || node.type.name === 'table_row') cells.push([])
    if (node.type.name === 'table_header' || node.type.name === 'table_cell') cells.at(-1)!.push(pos)
    return !node.isTextblock
  })
  return cells[row]![col]!
}

export const cellDOM = (view: EditorView, row: number, col: number) => view.nodeDOM(cellPos(view, row, col)) as HTMLElement

/** A mouse event at screen point (x, y); `which` is set because jsdom leaves it 0 and `columnResizing` reads it. */
export function mouseAt(type: string, target: EventTarget, x: number, y: number) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: x, clientY: y })
  Object.defineProperty(event, 'which', { value: 1 })
  target.dispatchEvent(event)
}

/** Drag the right edge of column `col` by `dx` screen px: hover the grip, press, move, release. */
export function dragColumnEdge(view: EditorView, col: number, dx: number, zoom = 1, over?: EventTarget) {
  const cell = cellDOM(view, 0, col).firstChild!
  const x = (col + 1) * 100 * zoom - 2, y = 15 * zoom
  mouseAt('mousemove', cell, x, y)
  mouseAt('mousedown', cell, x, y)
  mouseAt('mousemove', over ?? cell, x + dx, y)
  mouseAt('mouseup', over ?? cell, x + dx, y)
}
