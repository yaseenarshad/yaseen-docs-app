/**
 * A table in a Read only note keeps its caret (YAZ-4433, D30 of YAZ-4278). Yaseen: "even in read only tables the caret
 * needs to be there right so it's easy to navigate the table cells but still not edit right?"
 *
 * The note editor (`readOnlyKeys`) locked: ProseMirror's view is not editable, its body is `contenteditable="true"` with
 * `data-read-only`. These tests pin, in a table's cells: the caret a click puts in a cell, the moves from cell to cell
 * (the table's own arrow keys, Tab / ⇧Tab), and that no key, paste, cut, drop or table control changes the note.
 * jsdom moves no native caret and has no line boxes, so a key the browser moves is checked as "not cancelled", and
 * ↑ / ↓ get `endOfTextblock` = true (the caret on the cell's first / last line).
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import { CellSelection } from '@milkdown/kit/prose/tables'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe, getMarkdownForSave } from '../createCrepe'
import { tableMenuSections } from './tableMenu'
import { tableRows } from './tableRows'

/** Two body rows; the last cell holds a bullet list (YAZ-3818 D2), where an editable page's Tab / ⇧Tab move the bullet. */
const NOTE = `Intro

| h1 | h2 |
| --- | --- |
| a1 | b1 |
| a2 | <ul><li>x1</li><li>y1</li></ul> |
`

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
  document.getSelection()?.removeAllRanges()
})

const IS_MAC = /Mac/.test(navigator.platform)
const KEY_CODES: Record<string, number> = { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Enter: 13, Tab: 9, Backspace: 8, Delete: 46 }

/** The note editor, locked, with the focus in its body; `saves` counts the Markdown updates. */
async function locked() {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const saves: string[] = []
  const crepe = createCrepe({ root, defaultValue: NOTE, readOnlyKeys: true, onMarkdownUpdated: (md) => saves.push(md) })
  await crepe.create()
  mounted.push({ crepe, root })
  const saved = getMarkdownForSave(crepe)
  crepe.setReadonly(true)
  const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx))
  view.dom.focus()
  return { crepe, root, view, saves, saved }
}

/** The document position `offset` characters into the text `text`. */
function posOf(view: EditorView, text: string, offset = 0): number {
  let at = -1
  view.state.doc.descendants((node, pos) => {
    if (at < 0 && node.isText && node.text === text) at = pos + offset
  })
  if (at < 0) throw new Error(`no text ${text}`)
  return at
}

/** A click in the cell text `text`: the DOM caret there, as the browser puts it, and the editor's selection with it. */
function caretIn(view: EditorView, text: string, offset = 0): void {
  const at = posOf(view, text, offset)
  const { node, offset: domOffset } = view.domAtPos(at)
  document.getSelection()!.setBaseAndExtent(node, domOffset, node, domOffset)
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)))
}

/** The text of the cell that holds the selection's head, or null outside a table. */
function caretCell(view: EditorView): string | null {
  const $head = view.state.selection.$head
  for (let d = $head.depth; d > 0; d--) {
    const role = $head.node(d).type.spec.tableRole
    if (role === 'cell' || role === 'header_cell') return $head.node(d).textContent
  }
  return null
}

/** One key press in the focused body. */
function key(view: EditorView, k: string, mods: { mod?: boolean; shift?: boolean; alt?: boolean } = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: k,
    keyCode: KEY_CODES[k] ?? (k.length === 1 ? k.toUpperCase().charCodeAt(0) : 0),
    ...(mods.mod === true ? (IS_MAC ? { metaKey: true } : { ctrlKey: true }) : {}),
    shiftKey: mods.shift === true,
    altKey: mods.alt === true,
    bubbles: true,
    cancelable: true,
  } as KeyboardEventInit)
  view.dom.dispatchEvent(event)
  return event
}

/** A clipboard event with a DataTransfer the test can read back. */
function clipboard(type: 'copy' | 'cut' | 'paste', data: Record<string, string> = {}): { event: Event; data: Record<string, string> } {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: {
      get types() { return Object.keys(data) },
      getData: (t: string) => data[t] ?? '',
      setData: (t: string, v: string) => { data[t] = v },
      clearData: () => { for (const t of Object.keys(data)) delete data[t] },
      files: [],
      items: [],
    },
  })
  return { event, data }
}

describe('a table in a Read only note keeps its caret (YAZ-4433)', () => {
  it('a click puts the caret in a cell: the cell is part of the caret body (no `contenteditable="false"` on the way), and the editor reads the DOM caret', async () => {
    const { view } = await locked()
    expect(view.editable).toBe(false)
    const cells = [...view.dom.querySelectorAll('td, th')]
    expect(cells.length).toBe(6)
    for (const cell of cells) expect(cell.closest('[contenteditable]')).toBe(view.dom)
    const at = posOf(view, 'b1', 1)
    const { node, offset } = view.domAtPos(at)
    document.getSelection()!.setBaseAndExtent(node, offset, node, offset)
    ;(view as unknown as { domObserver: { flush(): void } }).domObserver.flush()
    expect(view.state.selection.head).toBe(at)
    expect(caretCell(view)).toBe('b1')
  })

  it('← / → at a cell’s edge go to the next cell, as in an editable page; inside the text they are the browser’s', async () => {
    const { crepe, view, saves, saved } = await locked()
    caretIn(view, 'a1', 1)
    expect(key(view, 'ArrowLeft').defaultPrevented).toBe(false)
    caretIn(view, 'a1', 2)
    expect(key(view, 'ArrowRight').defaultPrevented).toBe(true)
    expect(caretCell(view)).toBe('b1')
    expect(view.state.selection.head).toBe(posOf(view, 'b1'))
    expect(key(view, 'ArrowLeft').defaultPrevented).toBe(true)
    expect(caretCell(view)).toBe('a1')
    expect(getMarkdownForSave(crepe)).toBe(saved)
    expect(saves).toEqual([])
  })

  it('↑ / ↓ on a cell’s first / last line go to the cell above / below', async () => {
    const { crepe, view, saves, saved } = await locked()
    view.endOfTextblock = () => true
    caretIn(view, 'a1', 1)
    expect(key(view, 'ArrowDown').defaultPrevented).toBe(true)
    expect(caretCell(view)).toBe('a2')
    key(view, 'ArrowUp')
    expect(caretCell(view)).toBe('a1')
    key(view, 'ArrowUp')
    expect(caretCell(view)).toBe('h1')
    caretIn(view, 'b1', 1)
    key(view, 'ArrowDown')
    expect(caretCell(view)).toBe('x1y1')
    expect(getMarkdownForSave(crepe)).toBe(saved)
    expect(saves).toEqual([])
  })

  it('⇧ + arrows select across cells as in an editable page, and change nothing', async () => {
    const { crepe, view, saves, saved } = await locked()
    caretIn(view, 'a1', 2)
    key(view, 'ArrowRight', { shift: true })
    key(view, 'ArrowRight', { shift: true })
    expect(view.state.selection).toBeInstanceOf(CellSelection)
    expect(getMarkdownForSave(crepe)).toBe(saved)
    expect(saves).toEqual([])
  })

  it('Tab / ⇧Tab move to the next / previous cell: navigation only — no tab, no new row, a cell bullet never moves', async () => {
    const { crepe, view, saves, saved } = await locked()
    caretIn(view, 'a1', 1)
    expect(key(view, 'Tab').defaultPrevented).toBe(true)
    expect(caretCell(view)).toBe('b1')
    key(view, 'Tab')
    expect(caretCell(view)).toBe('a2')
    key(view, 'Tab', { shift: true })
    expect(caretCell(view)).toBe('b1')
    // A bullet in a cell: an editable page's Tab indents it and ⇧Tab outdents it; locked, they only move the caret.
    caretIn(view, 'y1', 1)
    expect(key(view, 'Tab').defaultPrevented).toBe(true)
    // The last cell: no next cell, and no new row.
    expect(caretCell(view)).toBe('x1y1')
    expect(key(view, 'Tab', { shift: true }).defaultPrevented).toBe(true)
    expect(caretCell(view)).toBe('a2')
    // ⇧Tab in the first cell: nothing before it.
    caretIn(view, 'h1', 1)
    key(view, 'Tab', { shift: true })
    expect(caretCell(view)).toBe('h1')
    expect(document.activeElement).toBe(view.dom)
    expect(view.dom.querySelectorAll('tr')).toHaveLength(3)
    expect(getMarkdownForSave(crepe)).toBe(saved)
    expect(saves).toEqual([])
  })

  it('Tab outside a table still does nothing and keeps the focus in the body', async () => {
    const { crepe, view, saves, saved } = await locked()
    caretIn(view, 'Intro', 2)
    const before = view.state.selection.head
    expect(key(view, 'Tab').defaultPrevented).toBe(true)
    expect(view.state.selection.head).toBe(before)
    expect(document.activeElement).toBe(view.dom)
    expect(getMarkdownForSave(crepe)).toBe(saved)
    expect(saves).toEqual([])
  })

  it('⌘A then ⌘C in a cell copies; ⌘↑ / ⌘↓ change nothing; ⌘X cuts nothing', async () => {
    const { crepe, view, saves, saved } = await locked()
    caretIn(view, 'b1', 1)
    key(view, 'ArrowUp', { mod: true })
    key(view, 'ArrowDown', { mod: true })
    expect(key(view, 'a', { mod: true }).defaultPrevented).toBe(true)
    expect(view.state.selection.empty).toBe(false)
    const copy = clipboard('copy')
    view.dom.dispatchEvent(copy.event)
    expect(copy.data['text/plain']).toContain('b1')
    const cut = clipboard('cut')
    view.dom.dispatchEvent(cut.event)
    expect(cut.event.defaultPrevented).toBe(true)
    expect(cut.data).toEqual({})
    expect(getMarkdownForSave(crepe)).toBe(saved)
    expect(saves).toEqual([])
  })

  it('nothing in a cell edits: the edit keys, every `beforeinput`, a paste of cells, a drop, a stray DOM change', async () => {
    const { crepe, view, saves, saved } = await locked()
    caretIn(view, 'b1', 1)
    const keys: Array<[string, { mod?: boolean; shift?: boolean; alt?: boolean }]> = [
      ['x', {}], ['Enter', {}], ['Enter', { mod: true }], ['Enter', { shift: true }], ['Backspace', {}], ['Delete', {}], ['Backspace', { mod: true }],
      [']', { mod: true }], ['[', { mod: true }], ['b', { mod: true }], [' ', { shift: true }], [' ', { mod: true }],
    ]
    for (const [k, mods] of keys) key(view, k, mods)
    for (const inputType of ['insertText', 'insertParagraph', 'insertLineBreak', 'insertFromPaste', 'insertFromDrop', 'deleteContentBackward', 'deleteContentForward', 'deleteByCut', 'historyUndo', 'formatBold']) {
      const event = new InputEvent('beforeinput', { inputType, data: inputType.startsWith('insert') ? 'X' : null, bubbles: true, cancelable: true })
      view.dom.dispatchEvent(event)
      expect(event.defaultPrevented, inputType).toBe(true)
    }
    // Tab-separated cells would fill from the caret cell and grow the table in an editable page (`tablePaste.ts`).
    const paste = clipboard('paste', { 'text/plain': 'P1\tP2\tP3\nP4\tP5\tP6' })
    view.dom.dispatchEvent(paste.event)
    expect(paste.event.defaultPrevented).toBe(true)
    const drop = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(drop, 'dataTransfer', { value: (clipboard('paste', { 'text/plain': 'DROPPED' }).event as unknown as { clipboardData: unknown }).clipboardData })
    Object.assign(drop, { clientX: 5, clientY: 5 })
    view.dom.dispatchEvent(drop)
    await new Promise((resolve) => setTimeout(resolve, 50))
    // An IME composition in a cell: drawn again from the note.
    const cellText = view.domAtPos(posOf(view, 'b1', 1)).node
    cellText.textContent = 'b1é'
    view.dom.dispatchEvent(new InputEvent('input', { inputType: 'insertCompositionText', data: 'é', bubbles: true }))
    expect(view.dom.textContent).not.toContain('b1é')
    expect(view.dom.textContent).not.toMatch(/P1|DROPPED/)
    expect(view.dom.querySelectorAll('tr')).toHaveLength(3)
    expect(getMarkdownForSave(crepe)).toBe(saved)
    expect(saves).toEqual([])
  })

  it('the table’s controls stay off: the add / drag handles, the row and column menus, the fill handle, the cell toolbar, the cell note button', async () => {
    const { root, view } = await locked()
    caretIn(view, 'b1', 1)
    const cell = view.domAtPos(posOf(view, 'b1', 1)).node.parentElement!
    for (const type of ['pointermove', 'pointerover', 'mouseover']) cell.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: 150, clientY: 45 }))
    await new Promise((resolve) => setTimeout(resolve, 60))
    for (const handle of root.querySelectorAll<HTMLElement>('.milkdown-table-block .handle')) expect(handle.dataset.show, handle.className).toBe('false')
    expect(tableMenuSections(view, posOf(view, 'b1', 1))).toEqual([])
    const table = view.state.doc.resolve(posOf(view, 'b1', 1)).before(1)
    expect(tableRows(view, { inside: table + 3 } as Parameters<typeof tableRows>[1], undefined as never)).toEqual([])
    // Two selected cells: an editable page shows the fill handle and the cell toolbar.
    const $a = view.state.doc.resolve(view.state.doc.resolve(posOf(view, 'a1')).before())
    const $b = view.state.doc.resolve(view.state.doc.resolve(posOf(view, 'b1')).before())
    view.dispatch(view.state.tr.setSelection(new CellSelection(view.state.doc.resolve($a.before()), view.state.doc.resolve($b.before()))))
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(root.querySelector('.table-fill-handle')).toBeNull()
    expect(root.querySelector('.cell-toolbar[data-show="true"]')).toBeNull()
    expect(root.querySelector('.cell-note-button[data-show="true"]')).toBeNull()
  })
})
