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
import { getZoomedItemPos, getZoomKey, ZOOM_CLOSE_CLASS, ZOOM_CRUMB_CLASS, ZOOM_HIDDEN_CLASS, ZOOM_NOTE_CLASS, zoomDecorationBuilds } from '../outline/zoom'
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
const markEl = (root: HTMLElement, label = 'cell-1') => root.querySelector<HTMLElement>(`sup[data-type="footnote_reference"][data-label="${label}"]`)!
const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
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
    click(markEl(root))
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
    click(markEl(root))
    expect(crumbs(root)).toEqual(['Notes', 'outer', 'Note: Plan · Monday'])
    expect(mod(crepe, '>')).toBe(true)
    expect(getZoomedItemPos(view.state)).toBeNull()
    expect(view.state.selection.$from.parent.textContent).toBe('Flights')
    expect(view.state.selection.$from.nodeBefore?.type.name).toBe('footnote_reference')
  })

  it('a bullet zoomed inside the note keeps the note shown, with its crumb; ⌘⇧. goes back to the note', async () => {
    const { crepe, root, view } = await mount(NOTES, zoomOpts())
    click(markEl(root))
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
    click(markEl(root))
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
    click(markEl(root))
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
    expect(crumbs(root)).toEqual(['Notes', 'Note: Day · Day'])
  })
})

describe('the mark (D8)', () => {
  it('Backspace right after the mark and Delete right before it step over it; the mark stays', async () => {
    const { crepe, view } = await mount(NOTES, zoomOpts())
    caretAt(view, 'Flights')
    // After the mark: the end of the line.
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.selection.head + 1)))
    expect(view.state.selection.$from.nodeBefore?.type.name).toBe('footnote_reference')
    pressKey(crepe, 'Backspace')
    expect(view.state.selection.$from.nodeAfter?.type.name).toBe('footnote_reference')
    caretAt(view, 'Flights')
    pressKey(crepe, 'Delete')
    expect(view.state.selection.$from.nodeBefore?.type.name).toBe('footnote_reference')
    expect(getMarkdownForSave(crepe)).toBe(NOTES)
  })
})

describe('the "Add cell note" button (D8)', () => {
  const buttons = (root: HTMLElement) => [...root.querySelectorAll<HTMLButtonElement>('.cell-note-button')]
  const hover = (view: EditorView, row: number, col: number) => (view.nodeDOM(cellPos(view, row, col)) as HTMLElement).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))

  it('one instance; it moves to the hovered cell; none on a cell with a note; a click adds and opens the note', async () => {
    const { crepe, root, view } = await mount(NOTES, zoomOpts())
    hover(view, 3, 1)
    expect(buttons(root)).toHaveLength(1)
    expect(buttons(root)[0]!.closest('td')).toBe(view.nodeDOM(cellPos(view, 3, 1)))
    expect(buttons(root)[0]!.getAttribute('aria-label')).toBe('Add cell note')
    hover(view, 0, 1)
    expect(buttons(root)).toHaveLength(1)
    expect(buttons(root)[0]!.closest('th')).toBe(view.nodeDOM(cellPos(view, 0, 1)))
    hover(view, 1, 1)
    expect(buttons(root)).toHaveLength(0)
    // Off the table: the caret's cell, while the editor has focus.
    root.querySelector('p')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    caretAt(view, 'free')
    view.focus()
    expect(buttons(root)[0]!.closest('td')).toBe(view.nodeDOM(cellPos(view, 3, 1)))
    click(buttons(root)[0]!)
    expect(zoomedNode(view)?.attrs.label).toBe('cell-2')
    expect(getMarkdownForSave(crepe)).toContain('free[^cell-2]')
  })

  it('a typed key in the cell places nothing: the widget only rides the mapping', async () => {
    const { crepe, root, view } = await mount(NOTES, zoomOpts())
    caretAt(view, 'free')
    view.focus()
    expect(buttons(root)).toHaveLength(1)
    const before = cellNoteButtonPlacements.runs
    for (const ch of 'typing') {
      // As a browser's typing: the text, and the caret set after it.
      const tr = view.state.tr.insertText(ch)
      view.dispatch(tr.setSelection(TextSelection.create(tr.doc, tr.selection.head)))
    }
    type(crepe, view, '!')
    expect(cellNoteButtonPlacements.runs - before).toBe(0)
    expect(buttons(root)).toHaveLength(1)
    expect(view.state.doc.nodeAt(cellPos(view, 3, 1))!.textContent).toBe('freetyping!')
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

  it('a rest on the mark shows the box after the dwell, with the crumb; the pointer leaving or a key closes it', async () => {
    vi.useFakeTimers()
    const { root } = await mount(NOTES, zoomOpts())
    const mark = markEl(root)
    mark.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    expect(document.querySelector('.cell-note-preview')).toBeNull()
    vi.advanceTimersByTime(400)
    const box = document.querySelector<HTMLElement>('.cell-note-preview')!
    expect([...box.querySelectorAll('.cell-note-preview__line')].map((el) => el.textContent)).toEqual(['Book the window seat.', '• bullet a', '• bullet b'])
    expect(box.querySelector('.cell-note-preview__header')!.textContent).toBe('Note: Plan · Monday')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    expect(document.querySelector('.cell-note-preview')).toBeNull()
    mark.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    vi.advanceTimersByTime(400)
    expect(document.querySelector('.cell-note-preview')).not.toBeNull()
    mark.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: root }))
    expect(document.querySelector('.cell-note-preview')).toBeNull()
  })
})

describe('zoom speed', () => {
  it('a caret move on the page builds no decorations; a typed key builds them once', async () => {
    const { crepe, root, view } = await mount(NOTES, zoomOpts())
    click(markEl(root))
    const before = zoomDecorationBuilds.runs
    caretAt(view, 'bullet a')
    caretAt(view, 'bullet b')
    caretAt(view, 'window')
    expect(zoomDecorationBuilds.runs - before).toBe(0)
    type(crepe, view, 'x')
    expect(zoomDecorationBuilds.runs - before).toBe(1)
  })
})
