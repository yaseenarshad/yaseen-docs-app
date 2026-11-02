/**
 * The cell note in the page (YAZ-3818 4B: D8, D9, D14, D15): real editors (`createCrepe`). Pinned here: a click on the
 * mark opens the note's page (the note is the only block that shows, its crumb, the ×, Back and Forward through its
 * key); ⌘. on a plain cell line makes and opens a note, and leaving it empty removes it and its mark; ⌘. in a cell
 * bullet zooms the bullet; Tab indents in the page; the table menu's cell note rows; Backspace and Delete step over the
 * mark; the one "Add cell note" button; the preview's lines; and, by count, no decoration work on a caret move in the
 * page or on a typed key in a cell.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import { undo } from '@milkdown/kit/prose/history'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { Crepe } from '@milkdown/crepe'
import type { MenuAction, MenuItem } from '../../sidebar/menuSections'
import { getMarkdownForSave, zoomPageTo } from '../createCrepe'
import { mount, pressKey, typeText, unmountAll } from '../marks/markTestKit'
import { noteMenuSections } from '../noteMenu'
import { canOpenCellNote, getZoomedItemPos, getZoomKey, ZOOM_CLOSE_CLASS, ZOOM_CRUMB_CLASS, ZOOM_HIDDEN_CLASS, ZOOM_NOTE_CLASS, zoomDecorationBuilds } from '../outline/zoom'
import { cellNoteButtonPlacements } from './cellNoteButton'
import { cellNotePreviewLines } from './cellNotePreview'
import { isCellNoteHidden } from './cellNotes'
import { cellPos } from './tableTestKit'

afterEach(async () => {
  vi.useRealTimers()
  await unmountAll()
})

/** A table with a cell note on "Flights", a cell bullet, and a plain cell, padded as the save pads them. */
const row = (day: string, plan: string) => `| ${day.padEnd(7)} | ${plan.padEnd(37, plan.startsWith('-') ? '-' : ' ')} |`
const NOTES = [
  'Intro',
  '',
  row('Day', 'Plan'),
  row('-------', '-'),
  row('Monday', 'Flights[^cell-1]'),
  row('Tuesday', '<ul><li>Museum</li><li>Park</li></ul>'),
  row('Friday', 'free'),
  '',
  '[^cell-1]: Book the window seat.',
  '',
  '    * bullet a',
  '    * bullet b',
  '',
  'Outro',
  '',
].join('\n')

const zoomOpts = (onZoom = vi.fn()) => ({ zoom: { title: () => 'Notes', onZoom } })

const zoomedNode = (view: EditorView) => {
  const pos = getZoomedItemPos(view.state)
  return pos === null ? null : view.state.doc.nodeAt(pos)
}
const crumbs = (root: HTMLElement) => [...root.querySelectorAll<HTMLButtonElement>(`.${ZOOM_CRUMB_CLASS}`)].map((b) => b.textContent)
/** The top-level blocks that show: not hidden by the zoom, and not a hidden cell note. */
const shown = (view: EditorView): string[] => {
  const out: string[] = []
  view.state.doc.forEach((node, pos) => {
    const dom = view.nodeDOM(pos) as HTMLElement
    const hiddenNote = node.type.name === 'cell_note' && isCellNoteHidden(view.state, pos)
    if (!dom.classList.contains(ZOOM_HIDDEN_CLASS) && !hiddenNote && node.textContent !== '') out.push(node.type.name === 'cell_note' ? `note:${node.textContent}` : node.type.name === 'table' ? 'table' : node.textContent)
  })
  return out
}
const caretAt = (view: EditorView, text: string, offset = text.length) => {
  let pos = -1
  view.state.doc.descendants((node, at) => {
    if (pos < 0 && node.isText && node.text!.includes(text)) pos = at + node.text!.indexOf(text) + offset
    return pos < 0
  })
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)))
}
const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
/** A pointer event in the cell at (row, col), at its top-right corner (the mark's triangle, 5A-18) or at `x`, `y`. */
const inCell = (view: EditorView, type: string, row = 1, col = 1, x = 197, y = 33) => {
  const cell = view.nodeDOM(cellPos(view, row, col)) as HTMLElement
  cell.getBoundingClientRect = () => new DOMRect(100, 30, 100, 30)
  return cell.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }))
}
/** ⌘. and ⌘⇧.: a real keyboard shifts `.` into `>`, and prosemirror-keymap reads the keyCode then (`zoom.test.ts`). */
const mod = (crepe: Crepe, key: '.' | '>') =>
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const event = new KeyboardEvent('keydown', { key, keyCode: 190, metaKey: true, shiftKey: key === '>', bubbles: true, cancelable: true })
    return view.someProp('handleKeyDown', (handler) => handler(view, event)) ?? false
  })
/** Typed text as the DOM input path gives it: an input rule's, else the plain insert. */
const type = (crepe: Crepe, view: EditorView, text: string) => {
  if (!typeText(crepe, text)) view.dispatch(view.state.tr.insertText(text))
}

describe('the cell note page (D9)', () => {
  it('a click on the mark opens the note: the only block that shows, its crumb, the × closes, Back and Forward come back', async () => {
    const onZoom = vi.fn()
    const { crepe, root, view } = await mount(NOTES, zoomOpts(onZoom))
    expect(shown(view)).toEqual(['Intro', 'table', 'Outro'])
    inCell(view, 'click')
    expect(zoomedNode(view)?.type.name).toBe('cell_note')
    expect(shown(view)).toEqual(['note:Book the window seat.bullet abullet b'])
    expect(view.nodeDOM(getZoomedItemPos(view.state)!)).toHaveProperty('className', expect.stringContaining(ZOOM_NOTE_CLASS))
    expect(crumbs(root)).toEqual(['Notes', 'Note: Plan · Monday'])
    expect(getZoomKey(view.state)).toBe('note:cell-1')
    expect(onZoom).toHaveBeenLastCalledWith('note:cell-1', false, 'Note: Plan · Monday')
    // The caret is in the note.
    expect(view.state.selection.$from.node(1).type.name).toBe('cell_note')
    const close = root.querySelector<HTMLButtonElement>(`.${ZOOM_CLOSE_CLASS}`)!
    expect(close.getAttribute('aria-label')).toBe('Close cell note')
    click(close)
    expect(getZoomedItemPos(view.state)).toBeNull()
    expect(onZoom).toHaveBeenLastCalledWith(null, false, null)
    expect(shown(view)).toEqual(['Intro', 'table', 'Outro'])
    expect(root.querySelector(`.${ZOOM_CLOSE_CLASS}`)).toBeNull()
    // Back to the note, by its key, and Forward to the whole page again.
    expect(zoomPageTo(crepe, 'note:cell-1')).toBe(true)
    expect(zoomedNode(view)?.attrs.label).toBe('cell-1')
    expect(zoomPageTo(crepe, null)).toBe(true)
    expect(getZoomedItemPos(view.state)).toBeNull()
    // An unknown label zooms out.
    zoomPageTo(crepe, 'note:cell-1')
    expect(zoomPageTo(crepe, 'note:cell-9')).toBe(true)
    expect(getZoomedItemPos(view.state)).toBeNull()
    expect(getMarkdownForSave(crepe)).toBe(NOTES)
  })

  it('leaving the page puts the caret after the mark, in the cell; ⌘⇧. from the page zooms out fully', async () => {
    const { crepe, root, view } = await mount(`* outer\n\n${NOTES.split('\n').map((line) => (line === '' ? '' : `  ${line}`)).join('\n')}`, zoomOpts())
    inCell(view, 'click')
    expect(crumbs(root)).toEqual(['Notes', 'outer', 'Note: Plan · Monday'])
    expect(mod(crepe, '>')).toBe(true)
    expect(getZoomedItemPos(view.state)).toBeNull()
    expect(view.state.selection.$from.parent.textContent).toBe('Flights')
    expect(view.state.selection.$from.nodeBefore?.type.name).toBe('footnote_reference')
  })

  it('a bullet zoomed inside the note keeps the note shown, with its crumb; ⌘⇧. goes back to the note', async () => {
    const { crepe, root, view } = await mount(NOTES, zoomOpts())
    inCell(view, 'click')
    caretAt(view, 'bullet b')
    expect(mod(crepe, '.')).toBe(true)
    expect(zoomedNode(view)?.type.name).toBe('list_item')
    expect(crumbs(root)).toEqual(['Notes', 'Note: Plan · Monday', 'bullet b'])
    const note = view.state.doc.child(2)
    expect(note.type.name).toBe('cell_note')
    expect(isCellNoteHidden(view.state, view.state.doc.child(0).nodeSize + view.state.doc.child(1).nodeSize)).toBe(false)
    expect(mod(crepe, '>')).toBe(true)
    expect(zoomedNode(view)?.type.name).toBe('cell_note')
  })

  it('Tab in the page indents a bullet: the note is not inside the table', async () => {
    const { crepe, root, view } = await mount(NOTES, zoomOpts())
    inCell(view, 'click')
    caretAt(view, 'bullet b', 0)
    expect(pressKey(crepe, 'Tab')).toBe(true)
    expect(getMarkdownForSave(crepe)).toContain('    * bullet a\n      * bullet b')
  })
})

describe('⌘. on a cell (D9) and an empty note (D15)', () => {
  it('on a plain cell line with no note: makes one and opens it; leaving it empty removes the note and its mark', async () => {
    const { crepe, root, view } = await mount(NOTES, zoomOpts())
    caretAt(view, 'free')
    expect(mod(crepe, '.')).toBe(true)
    expect(zoomedNode(view)).toMatchObject({ type: { name: 'cell_note' }, attrs: { label: 'cell-2' } })
    expect(crumbs(root)).toEqual(['Notes', 'Note: Plan · Friday'])
    expect(view.state.doc.nodeAt(cellPos(view, 3, 1))!.textContent).toBe('free')
    expect(mod(crepe, '>')).toBe(true)
    expect(getZoomedItemPos(view.state)).toBeNull()
    expect(getMarkdownForSave(crepe)).toBe(NOTES)
    expect(view.state.selection.$from.parent.textContent).toBe('free')
  })

  it('typing a bullet, then leaving, keeps the note and its mark, hidden; a reload keeps them', async () => {
    const { crepe, root, view } = await mount(NOTES, zoomOpts())
    caretAt(view, 'free')
    mod(crepe, '.')
    type(crepe, view, '-')
    type(crepe, view, ' ')
    type(crepe, view, 'call')
    click(root.querySelector(`.${ZOOM_CRUMB_CLASS}`)!)
    expect(getZoomedItemPos(view.state)).toBeNull()
    const saved = getMarkdownForSave(crepe)
    expect(saved).toContain('free[^cell-2]')
    expect(saved).toContain('[^cell-2]: * call')
    expect(shown(view)).toEqual(['Intro', 'table', 'Outro'])
    const reloaded = await mount(saved, zoomOpts())
    expect(getMarkdownForSave(reloaded.crepe)).toBe(saved)
    expect(shown(reloaded.view)).toEqual(['Intro', 'table', 'Outro'])
  })

  it('in a cell bullet, ⌘. zooms that bullet', async () => {
    const { crepe, root, view } = await mount(NOTES, zoomOpts())
    caretAt(view, 'Museum')
    expect(mod(crepe, '.')).toBe(true)
    expect(zoomedNode(view)?.type.name).toBe('list_item')
    expect(crumbs(root)).toEqual(['Notes', 'Museum'])
    expect(getMarkdownForSave(crepe)).toBe(NOTES)
  })

  it('a mark with no cell note opens an empty page; leaving it removes the mark too', async () => {
    const { crepe, root, view } = await mount('| a | b |\n| - | - |\n| x | y |\n', zoomOpts())
    // A file cannot hold it (a mark with no footnote reads as text): a mark the app put in, as a paste may.
    caretAt(view, 'x')
    view.dispatch(view.state.tr.replaceSelectionWith(view.state.schema.nodes.footnote_reference.create({ label: 'cell-1' })))
    inCell(view, 'click', 1, 0)
    expect(zoomedNode(view)?.attrs.label).toBe('cell-1')
    mod(crepe, '>')
    expect(getMarkdownForSave(crepe)).not.toContain('cell-1')
  })
})

describe('the table menu (D8)', () => {
  const all = (view: EditorView, row: number, col: number): MenuAction[] =>
    noteMenuSections(view, null, vi.fn(), cellPos(view, row, col) + 2)
      .flat()
      .flatMap((item: MenuItem) => (item.children === undefined ? [item] : item.children.flat()))
  const ids = (view: EditorView, row: number, col: number) => all(view, row, col).map((item) => item.id).filter((id) => id.includes('note'))
  const run = (view: EditorView, row: number, col: number, id: string) => all(view, row, col).find((item) => item.id === id)!.onSelect()

  it('Add on a cell with none; Open and Delete on one with a note; a header cell too; Delete and ⌘Z', async () => {
    const { crepe, root, view } = await mount(NOTES, zoomOpts())
    expect(ids(view, 1, 1)).toEqual(['table-open-note', 'table-delete-note'])
    expect(ids(view, 3, 1)).toEqual(['table-add-note'])
    expect(ids(view, 0, 0)).toEqual(['table-add-note'])
    run(view, 1, 1, 'table-open-note')
    expect(zoomedNode(view)?.attrs.label).toBe('cell-1')
    zoomPageTo(crepe, null)
    run(view, 1, 1, 'table-delete-note')
    expect(getMarkdownForSave(crepe)).not.toContain('cell-1')
    undo(view.state, view.dispatch)
    expect(getMarkdownForSave(crepe)).toBe(NOTES)
    run(view, 0, 0, 'table-add-note')
    expect(zoomedNode(view)?.attrs.label).toBe('cell-2')
    // A header cell names its column only: the header row names no row (5A-16).
    expect(crumbs(root)).toEqual(['Notes', 'Note: Day'])
  })
})

describe('the mark (D8)', () => {
  it('Backspace right after the mark and Delete right before it step over it and leave the key to the browser; the mark stays', async () => {
    // jsdom has no native delete, so the bytes cannot show which character goes: the key must be left unhandled
    // (false) with the caret on the far side of the mark. "Backspace deletes the s" stays a demo check (5A-24).
    const { crepe, view } = await mount(NOTES, zoomOpts())
    caretAt(view, 'Flights')
    const markPos = view.state.selection.head
    // After the mark: the end of the line.
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, markPos + 1)))
    expect(view.state.selection.$from.nodeBefore?.type.name).toBe('footnote_reference')
    expect(pressKey(crepe, 'Backspace')).toBe(false)
    expect(view.state.selection.head).toBe(markPos)
    expect(view.state.selection.$from.nodeBefore?.isText).toBe(true)
    caretAt(view, 'Flights')
    expect(pressKey(crepe, 'Delete')).toBe(false)
    expect(view.state.selection.head).toBe(markPos + 1)
    expect(getMarkdownForSave(crepe)).toBe(NOTES)
  })
})

describe('the "Add cell note" button (D8, 5A-7)', () => {
  const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('.cell-note-button')]
  const shownButton = () => buttons().find((button) => button.dataset.show === 'true') ?? null
  const hover = (view: EditorView, row: number, col: number) => (view.nodeDOM(cellPos(view, row, col)) as HTMLElement).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  /** Each cell a box: 100 × 30 px at (col, row); the editor's box at (10, 20). */
  const boxes = (view: EditorView) => {
    for (const cell of view.dom.querySelectorAll<HTMLElement>('td, th')) {
      const row = (cell.parentElement as HTMLTableRowElement).rowIndex
      const col = (cell as HTMLTableCellElement).cellIndex
      cell.getBoundingClientRect = () => new DOMRect(col * 100, row * 30, 100, 30)
    }
    view.dom.parentElement!.getBoundingClientRect = () => new DOMRect(10, 20, 500, 500)
  }

  it('one element, outside the editable DOM, over the hovered cell\'s corner; none on a cell with a note; a click adds and opens the note', async () => {
    const { crepe, root, view } = await mount(NOTES, zoomOpts())
    boxes(view)
    hover(view, 3, 1)
    expect(buttons()).toHaveLength(1)
    const button = shownButton()!
    expect(view.dom.contains(button)).toBe(false)
    expect(root.contains(button)).toBe(true)
    expect(button.getAttribute('aria-label')).toBe('Add cell note')
    // The cell (1, 3) spans x 100–200, y 90–120: the button's 18 px box ends 2 px in from its right edge.
    expect([button.style.left, button.style.top]).toEqual([`${200 - 2 - 18 - 10}px`, `${90 + 2 - 20}px`])
    hover(view, 0, 1)
    expect(shownButton()!.style.top).toBe(`${2 - 20}px`)
    hover(view, 1, 1)
    expect(shownButton()).toBeNull()
    // Off the table: the caret's cell, while the editor has focus.
    root.querySelector('p')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    view.hasFocus = () => true
    caretAt(view, 'free')
    expect(shownButton()!.style.top).toBe(`${90 + 2 - 20}px`)
    click(shownButton()!)
    expect(zoomedNode(view)?.attrs.label).toBe('cell-2')
    expect(view.state.doc.nodeAt(cellPos(view, 3, 1))!.lastChild!.lastChild?.type.name).toBe('footnote_reference')
    // Empty, the note stays out of the file (5A-5).
    expect(getMarkdownForSave(crepe)).toBe(NOTES)
  })

  it('a hover, the focus and a blur send no transaction: a table that is the last block stays the last block', async () => {
    const { view } = await mount('| a | b |\n| - | - |\n| c | d |\n', zoomOpts())
    boxes(view)
    const before = view.state
    hover(view, 1, 0)
    hover(view, 1, 1)
    view.dom.dispatchEvent(new FocusEvent('focus'))
    view.dom.dispatchEvent(new FocusEvent('blur'))
    view.dom.dispatchEvent(new MouseEvent('mouseleave'))
    expect(view.state).toBe(before)
    expect(view.state.doc.childCount).toBe(1)
  })

  it('the pointer can go from the cell onto the button: it stays, and leaving it for the page hides it', async () => {
    const { view } = await mount(NOTES, zoomOpts())
    boxes(view)
    hover(view, 3, 1)
    const button = shownButton()!
    view.dom.dispatchEvent(new MouseEvent('mouseleave', { relatedTarget: button }))
    expect(shownButton()).toBe(button)
    button.dispatchEvent(new MouseEvent('mouseleave', { relatedTarget: document.body }))
    expect(shownButton()).toBeNull()
  })

  it('a typed key in the cell places nothing; a read-only note shows no button', async () => {
    const { crepe, view } = await mount(NOTES, zoomOpts())
    boxes(view)
    view.hasFocus = () => true
    caretAt(view, 'free')
    expect(shownButton()).not.toBeNull()
    const before = cellNoteButtonPlacements.runs
    for (const ch of 'typing') {
      // As a browser's typing: the text, and the caret set after it.
      const tr = view.state.tr.insertText(ch)
      view.dispatch(tr.setSelection(TextSelection.create(tr.doc, tr.selection.head)))
    }
    type(crepe, view, '!')
    expect(cellNoteButtonPlacements.runs - before).toBe(0)
    expect(view.state.doc.nodeAt(cellPos(view, 3, 1))!.textContent).toBe('freetyping!')
    crepe.setReadonly(true)
    hover(view, 3, 0)
    expect(shownButton()).toBeNull()
  })
})

describe('the preview (D14)', () => {
  it('the first 6 lines as plain text, a bullet as "• "', () => {
    const lines = (markdown: string) => mount(markdown).then(({ view }) => cellNotePreviewLines(view.state.doc.child(1)))
    return Promise.all([
      lines('| a |\n| - |\n| x[^cell-1] |\n\n[^cell-1]: * one\n    * two\n    * three\n').then((out) => expect(out).toEqual(['• one', '• two', '• three'])),
      lines('| a |\n| - |\n| x[^cell-1] |\n\n[^cell-1]: Top\n\n    1. first\n       * kid\n    2. second\n\n    * [ ] todo\n    * x\n    * y\n').then((out) =>
        expect(out).toEqual(['Top', '1. first', '  • kid', '2. second', '☐ todo', '• x']),
      ),
    ])
  })

  it('a rest on the corner shows the box after the dwell, with the crumb and the hint; the pointer leaving the corner or a key closes it', async () => {
    vi.useFakeTimers()
    // Crepe's block handle reads it on a `mousemove`; jsdom has none.
    document.elementsFromPoint = () => []
    const { view } = await mount(NOTES, zoomOpts())
    inCell(view, 'mousemove')
    expect(document.querySelector('.cell-note-preview')).toBeNull()
    vi.advanceTimersByTime(400)
    const box = document.querySelector<HTMLElement>('.cell-note-preview')!
    expect([...box.querySelectorAll('.cell-note-preview__line')].map((el) => el.textContent)).toEqual(['Book the window seat.', '• bullet a', '• bullet b'])
    expect(box.querySelector('.cell-note-preview__header')!.textContent).toBe('Note: Plan · Monday')
    // 5A-13: the box is read-only; the hint names the corner, which a click opens.
    expect(box.querySelector('.cell-note-preview__hint')!.textContent).toBe('Click the corner to open')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    expect(document.querySelector('.cell-note-preview')).toBeNull()
    inCell(view, 'mousemove')
    vi.advanceTimersByTime(400)
    expect(document.querySelector('.cell-note-preview')).not.toBeNull()
    // Still in the corner: the same box.
    inCell(view, 'mousemove', 1, 1, 198, 32)
    expect(document.querySelectorAll('.cell-note-preview')).toHaveLength(1)
    // Out of the corner, in the cell's words.
    inCell(view, 'mousemove', 1, 1, 150, 45)
    expect(document.querySelector('.cell-note-preview')).toBeNull()
    // A cell with no note shows none.
    inCell(view, 'mousemove', 3, 1)
    vi.advanceTimersByTime(400)
    expect(document.querySelector('.cell-note-preview')).toBeNull()
  })
})

describe('the corner opens the note (5A-18)', () => {
  it('a click in the corner of a cell with a note opens it; a click in its words, or in the corner of a cell with none, does not', async () => {
    const { view } = await mount(NOTES, zoomOpts())
    inCell(view, 'click', 1, 1, 150, 45)
    expect(getZoomedItemPos(view.state)).toBeNull()
    inCell(view, 'click', 3, 1)
    expect(getZoomedItemPos(view.state)).toBeNull()
    inCell(view, 'click')
    expect(zoomedNode(view)?.attrs.label).toBe('cell-1')
  })
})

describe('a read-only note (5A-6, 5A-22)', () => {
  const EMPTY = '| a          |\n| ---------- |\n| b[^cell-1] |\n\n[^cell-1]: <br />\n\nEnd\n'

  it('leaving an empty cell note\'s page by the crumb, the ×, ⌘⇧. or Back changes nothing', async () => {
    const { crepe, root, view } = await mount(EMPTY, zoomOpts())
    crepe.setReadonly(true)
    const doc = view.state.doc
    inCell(view, 'click', 1, 0)
    expect(zoomedNode(view)?.attrs.label).toBe('cell-1')
    click(root.querySelector(`.${ZOOM_CRUMB_CLASS}`)!)
    expect(getZoomedItemPos(view.state)).toBeNull()
    expect(zoomPageTo(crepe, 'note:cell-1')).toBe(true)
    click(root.querySelector(`.${ZOOM_CLOSE_CLASS}`)!)
    zoomPageTo(crepe, 'note:cell-1')
    mod(crepe, '>')
    zoomPageTo(crepe, 'note:cell-1')
    zoomPageTo(crepe, null)
    expect(getZoomedItemPos(view.state)).toBeNull()
    expect(view.state.doc.eq(doc)).toBe(true)
  })

  it('canOpenCellNote: a read-only note opens only a cell note that is there', async () => {
    const { crepe, view } = await mount(NOTES, zoomOpts())
    expect(canOpenCellNote(view, cellPos(view, 3, 1))).toBe(true)
    crepe.setReadonly(true)
    expect(canOpenCellNote(view, cellPos(view, 3, 1))).toBe(false)
    expect(canOpenCellNote(view, cellPos(view, 1, 1))).toBe(true)
  })
})

describe('an empty cell note never reaches the file (D15, 5A-5)', () => {
  it('while its page is open, a save and the change report leave it out, and its mark; a word in it saves it', async () => {
    const onMarkdownUpdated = vi.fn()
    const { crepe, view } = await mount(NOTES, { ...zoomOpts(), onMarkdownUpdated })
    caretAt(view, 'free')
    mod(crepe, '.')
    expect(zoomedNode(view)?.attrs.label).toBe('cell-2')
    // The page is open: the tab can close, another note can open, the app can quit. Each saves these bytes.
    expect(getMarkdownForSave(crepe)).toBe(NOTES)
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(onMarkdownUpdated.mock.calls.flat().some((md: string) => md.includes('cell-2'))).toBe(false)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, getZoomedItemPos(view.state)! + 2)))
    type(crepe, view, 'x')
    expect(getMarkdownForSave(crepe)).toContain('[^cell-2]: x')
    await vi.waitFor(() => expect(onMarkdownUpdated).toHaveBeenLastCalledWith(expect.stringContaining('[^cell-2]: x')))
  })
})

describe('zoom speed', () => {
  it('a caret move on the page builds no decorations; a typed key builds them once', async () => {
    const { crepe, root, view } = await mount(NOTES, zoomOpts())
    inCell(view, 'click')
    const before = zoomDecorationBuilds.runs
    caretAt(view, 'bullet a')
    caretAt(view, 'bullet b')
    caretAt(view, 'window')
    expect(zoomDecorationBuilds.runs - before).toBe(0)
    type(crepe, view, 'x')
    expect(zoomDecorationBuilds.runs - before).toBe(1)
  })
})
