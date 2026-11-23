/**
 * The cell note in the page (YAZ-3818 4B: D8, D14, D15; the card from the demo): real editors (`createCrepe`). Pinned
 * here: a click on the mark opens the note as a card (it shows, the rest of the page stays, its title, the × and Esc
 * close it, no zoom level); ⌘. on a plain cell line makes and opens a note, and closing it empty removes it and its
 * mark; ⌘. in a cell bullet zooms the bullet, and in a card is a no-op; Tab indents in the card; the table menu's cell
 * note rows; Backspace and Delete step over the mark; the one "Add cell note" button; the preview on the whole cell.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import { undo } from '@milkdown/kit/prose/history'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { Crepe } from '@milkdown/crepe'
import type { MenuAction, MenuItem } from '../../sidebar/menuSections'
import { getMarkdownForSave, setMarkdown, zoomPageTo } from '../createCrepe'
import { applyExternalMarkdown } from '../external/applyExternalMarkdown'
import { mount, pressKey, typeText, unmountAll } from '../marks/markTestKit'
import { pageMenuSections } from '../pageMenu'
import { canZoomInto, getZoomedItemPos, zoomKeyAt, ZOOM_CRUMB_CLASS, ZOOM_HIDDEN_CLASS } from '../outline/zoom'
import { cellNoteButtonPlacements } from './cellNoteButton'
import { setCellNoteButtonSetting } from './timeFormatSetting'
import { CELL_NOTE_CELL_OPEN_CLASS, CELL_NOTE_OPEN_CLASS, canOpenCellNote, openCellNote, setCellNotePinnedAtStart, setCellNoteTemplate } from './cellNoteCard'
import { cellHoverCardRuns, fitCard } from './cellHoverCard'
import { cellNotePreviewLines, CELL_NOTE_BOX_WIDTH, setCellNotePreviewLines } from './cellNotePreview'
import { isCellNoteHidden, openCellNoteLabel } from './cellNotes'
import { cellPos } from './tableTestKit'

// A card starts unpinned here; the pinned start (round 3 of the demo) has its own test.
beforeEach(() => setCellNotePinnedAtStart(false))

afterEach(async () => {
  vi.useRealTimers()
  setCellNoteTemplate('')
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
const card = (root: HTMLElement) => root.querySelector<HTMLElement>(`.${CELL_NOTE_OPEN_CLASS}`)
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
/** A key as the browser sends it, a `keydown` on the editor: every DOM handler and keymap sees it. True when one took it. */
const domKey = (view: EditorView, key: string, shiftKey = false): boolean => !view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }))
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


describe('the cell note card (the demo)', () => {
  it('a click on the mark opens the note as a card: the page stays, no zoom, its title; the × closes it', async () => {
    const onZoom = vi.fn()
    const { crepe, root, view } = await mount(NOTES, zoomOpts(onZoom))
    expect(shown(view)).toEqual(['Intro', 'table', 'Outro'])
    inCell(view, 'click')
    expect(openCellNoteLabel(view.state)).toBe('cell-1')
    expect(getZoomedItemPos(view.state)).toBeNull()
    expect(onZoom).not.toHaveBeenCalled()
    expect(shown(view)).toEqual(['Intro', 'table', 'note:Book the window seat.bullet abullet b', 'Outro'])
    expect(card(root)!.querySelector('.cell-note-card__title')!.textContent).toBe('Note: Plan · Monday')
    // The full title on hover, when the head cuts it.
    expect(card(root)!.querySelector<HTMLElement>('.cell-note-card__title')!.title).toBe('Note: Plan · Monday')
    // The caret is at the end of the note.
    expect(view.state.selection.$from.node(1).type.name).toBe('cell_note')
    expect(view.state.selection.$from.parent.textContent).toBe('bullet b')
    const close = card(root)!.querySelector<HTMLButtonElement>('.cell-note-card__close')!
    expect(close.getAttribute('aria-label')).toBe('Close cell note')
    click(close)
    expect(openCellNoteLabel(view.state)).toBeNull()
    expect(card(root)).toBeNull()
    expect(shown(view)).toEqual(['Intro', 'table', 'Outro'])
    // The caret is back after the mark, in the cell.
    expect(view.state.selection.$from.parent.textContent).toBe('Flights')
    expect(view.state.selection.$from.nodeBefore?.type.name).toBe('footnote_reference')
    expect(getMarkdownForSave(crepe)).toBe(NOTES)
  })

  it('Esc closes the card; a mousedown outside it closes it, one inside does not', async () => {
    const { crepe, root, view } = await mount(NOTES, zoomOpts())
    inCell(view, 'click')
    expect(pressKey(crepe, 'Escape')).toBe(true)
    expect(openCellNoteLabel(view.state)).toBeNull()
    inCell(view, 'click')
    card(root)!.querySelector('p')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(openCellNoteLabel(view.state)).toBe('cell-1')
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(openCellNoteLabel(view.state)).toBeNull()
  })

  it('pinned (round 2 of the demo): a mousedown outside keeps it open, the caret can leave, Esc outside it does not close it; the × does', async () => {
    const { crepe, root, view } = await mount(NOTES, zoomOpts())
    inCell(view, 'click')
    const pin = card(root)!.querySelector<HTMLButtonElement>('.cell-note-card__pin')!
    expect([pin.getAttribute('aria-label'), pin.getAttribute('aria-pressed')]).toEqual(['Pin cell note', 'false'])
    click(pin)
    expect([pin.getAttribute('aria-label'), pin.getAttribute('aria-pressed')]).toEqual(['Unpin cell note', 'true'])
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    caretAt(view, 'Outro')
    expect(pressKey(crepe, 'Escape')).toBe(false)
    expect(openCellNoteLabel(view.state)).toBe('cell-1')
    // Another note swaps in; the pin stays on.
    caretAt(view, 'free')
    mod(crepe, '.')
    expect(openCellNoteLabel(view.state)).toBe('cell-2')
    expect(card(root)!.querySelector('.cell-note-card__pin')!.getAttribute('aria-pressed')).toBe('true')
    click(card(root)!.querySelector('.cell-note-card__close')!)
    expect(openCellNoteLabel(view.state)).toBeNull()
    // The empty note went when the card closed.
    expect(getMarkdownForSave(crepe)).toBe(NOTES)
  })

  it('⌘. in a bullet of the card is a no-op; Tab indents a bullet there', async () => {
    const { crepe, view } = await mount(NOTES, zoomOpts())
    inCell(view, 'click')
    caretAt(view, 'bullet b', 0)
    mod(crepe, '.')
    expect(getZoomedItemPos(view.state)).toBeNull()
    expect(pressKey(crepe, 'Tab')).toBe(true)
    expect(getMarkdownForSave(crepe)).toContain('    * bullet a\n      * bullet b')
  })

  it('opening another note closes the first; only the open one shows', async () => {
    const { crepe, root, view } = await mount(NOTES, zoomOpts())
    inCell(view, 'click')
    const first = view.state.doc.child(0).nodeSize + view.state.doc.child(1).nodeSize
    expect(isCellNoteHidden(view.state, first)).toBe(false)
    caretAt(view, 'free')
    mod(crepe, '.')
    expect(openCellNoteLabel(view.state)).toBe('cell-2')
    expect(root.querySelectorAll(`.${CELL_NOTE_OPEN_CLASS}`)).toHaveLength(1)
    expect(isCellNoteHidden(view.state, first)).toBe(true)
  })
})

describe('previous and next note, and the open page\'s cell (round 2 of the demo)', () => {
  const TWO = '| a          | b          |\n| ---------- | ---------- |\n| x[^cell-2] | y          |\n| z          | w[^cell-1] |\n\n[^cell-2]: first\n\n[^cell-1]: second\n\nEnd\n'
  const head = (root: HTMLElement) => card(root)!.querySelector('.cell-note-card__head')!
  const steps = (root: HTMLElement) => [...head(root).querySelectorAll<HTMLButtonElement>('.cell-note-card__step:not(.cell-note-card__history)')]

  it('‹ "1 of 2" ›: the order of the marks, no wrap; a step opens the next note and rings its cell', async () => {
    const { root, view } = await mount(TWO, zoomOpts())
    inCell(view, 'click', 1, 0)
    expect(openCellNoteLabel(view.state)).toBe('cell-2')
    expect(head(root).querySelector('.cell-note-card__count')!.textContent).toBe('1 of 2')
    expect(steps(root).map((b) => [b.getAttribute('aria-label'), b.disabled])).toEqual([['Previous cell note', true], ['Next cell note', false]])
    expect((view.nodeDOM(cellPos(view, 1, 0)) as HTMLElement).classList.contains(CELL_NOTE_CELL_OPEN_CLASS)).toBe(true)
    click(steps(root)[1]!)
    expect(openCellNoteLabel(view.state)).toBe('cell-1')
    expect(head(root).querySelector('.cell-note-card__count')!.textContent).toBe('2 of 2')
    expect(steps(root).map((b) => b.disabled)).toEqual([false, true])
    expect((view.nodeDOM(cellPos(view, 1, 0)) as HTMLElement).classList.contains(CELL_NOTE_CELL_OPEN_CLASS)).toBe(false)
    expect((view.nodeDOM(cellPos(view, 2, 1)) as HTMLElement).classList.contains(CELL_NOTE_CELL_OPEN_CLASS)).toBe(true)
    click(steps(root)[0]!)
    expect(openCellNoteLabel(view.state)).toBe('cell-2')
    click(head(root).querySelector('.cell-note-card__close')!)
    expect(root.querySelector(`.${CELL_NOTE_CELL_OPEN_CLASS}`)).toBeNull()
  })
})

describe('the card stays in the visible editor area (YAZ-4261)', () => {
  const FIRST = '| Day             | Plan    |\n| --------------- | ------- |\n| Monday[^cell-1] | Flights |\n\n[^cell-1]: Book the window seat.\n\nEnd\n'
  /** The window px of a card opened on the Monday cell: the visible area 263 to 1024 (the sidebar to its left), the editor's box from 300, at `zoom`. */
  async function openAt(cell: [number, number], zoom = 1) {
    const { root, view } = await mount(FIRST)
    const host = view.dom.parentElement!
    root.style.overflowY = 'auto'
    root.getBoundingClientRect = () => new DOMRect(263, 0, 1024 - 263, 800)
    host.getBoundingClientRect = () => new DOMRect(300, 0, 700 * zoom, 800)
    Object.defineProperty(host, 'offsetWidth', { value: 700 })
    const note = view.dom.querySelector<HTMLElement>('.cell-note')!
    Object.defineProperty(note, 'offsetParent', { value: host })
    Object.defineProperty(note, 'offsetWidth', { value: 340 })
    ;(view.nodeDOM(cellPos(view, 1, 0)) as HTMLElement).getBoundingClientRect = () => new DOMRect(cell[0], 30, cell[1] - cell[0], 30)
    openCellNote(view, cellPos(view, 1, 0))
    const left = 300 + parseFloat(host.style.getPropertyValue('--cell-note-card-left')) * zoom
    return { left, right: left + 340 * zoom }
  }

  it('a narrow first column (110 px, and the demo\'s 280 px): the card is left-aligned to its cell, not under the sidebar', async () => {
    expect(await openAt([300, 410])).toEqual({ left: 300, right: 640 })
    expect(await openAt([300, 580])).toEqual({ left: 300, right: 640 })
  })

  it('a cell where it fits: right-aligned to its cell, as before', async () => {
    expect(await openAt([600, 800])).toEqual({ left: 460, right: 800 })
  })

  it('a cell partly under the sidebar, a last column past the window\'s edge, a 150% zoom: always inside the area', async () => {
    expect(await openAt([200, 310])).toEqual({ left: 263, right: 603 })
    expect(await openAt([800, 1100])).toEqual({ left: 684, right: 1024 })
    const zoomed = await openAt([300, 465], 1.5)
    expect(zoomed.left).toBeCloseTo(300)
    expect(zoomed.right).toBeLessThanOrEqual(1024)
  })
})

describe('round 3 of the demo', () => {
  const TWO = '| a          | b          |\n| ---------- | ---------- |\n| x[^cell-2] | y          |\n| z          | w[^cell-1] |\n\n[^cell-2]: first\n\n[^cell-1]: second\n\nEnd\n'
  const history = (root: HTMLElement) => [...card(root)!.querySelectorAll<HTMLButtonElement>('.cell-note-card__history')]

  it('Back and Forward walk the notes in the order they were opened; an open after a Back drops what was ahead', async () => {
    const { crepe, root, view } = await mount(TWO, zoomOpts())
    inCell(view, 'click', 2, 1)
    expect(history(root).map((b) => [b.getAttribute('aria-label'), b.disabled])).toEqual([['Back', true], ['Forward', true]])
    inCell(view, 'click', 1, 0)
    expect(openCellNoteLabel(view.state)).toBe('cell-2')
    expect(history(root).map((b) => b.disabled)).toEqual([false, true])
    click(history(root)[0]!)
    expect(openCellNoteLabel(view.state)).toBe('cell-1')
    expect(history(root).map((b) => b.disabled)).toEqual([true, false])
    click(history(root)[1]!)
    expect(openCellNoteLabel(view.state)).toBe('cell-2')
    // Back, then a new note: Forward is gone.
    click(history(root)[0]!)
    caretAt(view, 'y')
    mod(crepe, '.')
    expect(openCellNoteLabel(view.state)).toBe('cell-3')
    expect(history(root).map((b) => b.disabled)).toEqual([false, true])
  })

  it('a new note starts with the template, the caret on its first line; left as the template it goes like an empty one', async () => {
    setCellNoteTemplate('- ')
    const { crepe, view } = await mount(NOTES, zoomOpts())
    caretAt(view, 'free')
    mod(crepe, '.')
    const at = view.state.selection.$from
    expect(at.node(1).type.name).toBe('cell_note')
    expect(at.node(at.depth - 1).type.name).toBe('list_item')
    expect(getMarkdownForSave(crepe)).toBe(NOTES)
    pressKey(crepe, 'Escape')
    expect(getMarkdownForSave(crepe)).toBe(NOTES)
    caretAt(view, 'free')
    mod(crepe, '.')
    type(crepe, view, 'call')
    pressKey(crepe, 'Escape')
    expect(getMarkdownForSave(crepe)).toContain('[^cell-2]: * call')
  })

  it('⌘A in the card selects the note only; in a plain cell the cell first, then the page', async () => {
    const { crepe, root, view } = await mount(NOTES, zoomOpts())
    inCell(view, 'click')
    expect(pressKey(crepe, 'a', { mod: true })).toBe(true)
    expect(view.state.doc.textBetween(view.state.selection.from, view.state.selection.to, '|')).toBe('Book the window seat.|bullet a|bullet b')
    expect(pressKey(crepe, 'a', { mod: true })).toBe(true)
    expect(view.state.doc.textBetween(view.state.selection.from, view.state.selection.to, '|')).toBe('Book the window seat.|bullet a|bullet b')
    click(card(root)!.querySelector('.cell-note-card__close')!)
    caretAt(view, 'Park', 1)
    expect(pressKey(crepe, 'a', { mod: true })).toBe(true)
    expect(view.state.selection.constructor.name).toBe('TextSelection')
    expect(view.state.doc.textBetween(view.state.selection.from, view.state.selection.to, '|')).toBe('Museum|Park')
    // Again: the page's own select all.
    pressKey(crepe, 'a', { mod: true })
    expect(view.state.selection.from).toBeLessThan(5)
  })

  it('↓ on the card\'s last line and ⇧↑ on it stay in the card, with a hidden note right after it: no gap cursor (YAZ-4395)', async () => {
    const { view } = await mount(TWO, zoomOpts())
    inCell(view, 'click', 1, 0)
    expect(openCellNoteLabel(view.state)).toBe('cell-2')
    // jsdom has no line boxes: every line is a textblock's edge, where Crepe's gap cursor would take the key.
    view.endOfTextblock = () => true
    caretAt(view, 'first', 2)
    expect(domKey(view, 'ArrowDown')).toBe(true)
    expect(view.state.selection.constructor.name).toBe('TextSelection')
    expect([view.state.selection.$head.parent.textContent, view.state.selection.$head.parentOffset]).toEqual(['first', 5])
    expect(domKey(view, 'ArrowDown')).toBe(true)
    expect([view.state.selection.$head.parent.textContent, view.state.selection.$head.parentOffset]).toEqual(['first', 5])
    expect(domKey(view, 'ArrowUp', true)).toBe(true)
    expect(view.state.doc.textBetween(view.state.selection.from, view.state.selection.to)).toBe('first')
    expect(openCellNoteLabel(view.state)).toBe('cell-2')
  })

  it('a new tab\'s card starts pinned when the setting is on', async () => {
    setCellNotePinnedAtStart(true)
    const { root, view } = await mount(NOTES, zoomOpts())
    inCell(view, 'click')
    expect(card(root)!.querySelector('.cell-note-card__pin')!.getAttribute('aria-pressed')).toBe('true')
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(openCellNoteLabel(view.state)).toBe('cell-1')
  })
})

describe('round 4 of the demo', () => {
  const menu = (view: EditorView, row: number, col: number): MenuAction[] =>
    pageMenuSections(view, null, vi.fn(), cellPos(view, row, col) + 2)
      .flat()
      .flatMap((item: MenuItem) => (item.children === undefined ? [item] : item.children.flat()))

  it('"Move to cell note": the whole cell goes to a new note (no template), the cell keeps an empty line and its mark, the card opens; one undo', async () => {
    setCellNoteTemplate('- ')
    const { crepe, view } = await mount(NOTES, zoomOpts())
    expect(menu(view, 3, 1).some((item) => item.id === 'table-move-to-note')).toBe(true)
    menu(view, 2, 1).find((item) => item.id === 'table-move-to-note')!.onSelect()
    expect(openCellNoteLabel(view.state)).toBe('cell-2')
    const saved = getMarkdownForSave(crepe)
    expect(saved).toMatch(/\| Tuesday \| \[\^cell-2\] +\|/)
    expect(saved).toContain('[^cell-2]: * Museum\n    * Park')
    pressKey(crepe, 'Escape')
    undo(view.state, view.dispatch)
    expect(getMarkdownForSave(crepe)).toBe(NOTES)
  })

  it('"Move to cell note" on a cell with a note: its text goes to the end of that note, its mark stays in the cell; a header cell too', async () => {
    const { crepe, view } = await mount(NOTES, zoomOpts())
    menu(view, 1, 1).find((item) => item.id === 'table-move-to-note')!.onSelect()
    pressKey(crepe, 'Escape')
    const saved = getMarkdownForSave(crepe)
    expect(saved).toMatch(/\| Monday +\| \[\^cell-1\] +\|/)
    expect(saved).toContain('    * bullet b\n\n    Flights')
    menu(view, 0, 0).find((item) => item.id === 'table-move-to-note')!.onSelect()
    expect(getMarkdownForSave(crepe)).toContain('[^cell-2]: Day')
  })

  it('an outside change: the card stays on its note; with the note gone it closes; a rebuild closes it cleanly', async () => {
    const { crepe, root, view } = await mount(NOTES, zoomOpts())
    inCell(view, 'click')
    expect(applyExternalMarkdown(crepe, NOTES.replace('Outro', 'Outro changed'))).toBe('applied')
    expect(openCellNoteLabel(view.state)).toBe('cell-1')
    expect(card(root)!.textContent).toContain('Book the window seat.')
    applyExternalMarkdown(crepe, NOTES.replace('Book the window seat.', 'Book an aisle seat.'))
    expect(card(root)?.textContent ?? '').toContain('aisle')
    applyExternalMarkdown(crepe, 'Intro\n\n| Day | Plan |\n| --- | --- |\n| Monday | Flights |\n\nOutro\n')
    expect(openCellNoteLabel(view.state)).toBeNull()
    expect(card(root)).toBeNull()
    inCell(view, 'click')
    setMarkdown(crepe, NOTES)
    expect(openCellNoteLabel(view.state)).toBeNull()
  })

  it('"All notes": every note read-only under its header, the title counts them; a header opens that note', async () => {
    const { root, view } = await mount(NOTES, zoomOpts())
    inCell(view, 'click')
    click(card(root)!.querySelector('.cell-note-card__all-toggle')!)
    expect(card(root)!.classList.contains('cell-note--all')).toBe(true)
    expect(card(root)!.querySelector('.cell-note-card__title')!.textContent).toBe('All cell notes (1)')
    const list = card(root)!.querySelector('.cell-note-card__all')!
    expect([...list.children].map((el) => el.textContent)).toEqual(['Plan · Monday', 'Book the window seat.', '• bullet a', '• bullet b'])
    expect(card(root)!.querySelector('.cell-note-card__copy')).not.toBeNull()
    click(list.querySelector('.cell-note-card__all-header')!)
    expect(card(root)!.classList.contains('cell-note--all')).toBe(false)
    expect(openCellNoteLabel(view.state)).toBe('cell-1')
  })
})

describe('⌘. on a cell (D9) and an empty note (D15)', () => {
  it('on a plain cell line with no note: makes one and opens it; closing it empty removes the note and its mark', async () => {
    const { crepe, root, view } = await mount(NOTES, zoomOpts())
    caretAt(view, 'free')
    expect(mod(crepe, '.')).toBe(true)
    expect(openCellNoteLabel(view.state)).toBe('cell-2')
    expect(card(root)!.querySelector('.cell-note-card__title')!.textContent).toBe('Note: Plan · Friday')
    expect(view.state.doc.nodeAt(cellPos(view, 3, 1))!.textContent).toBe('free')
    expect(pressKey(crepe, 'Escape')).toBe(true)
    expect(openCellNoteLabel(view.state)).toBeNull()
    expect(getMarkdownForSave(crepe)).toBe(NOTES)
    expect(view.state.selection.$from.parent.textContent).toBe('free')
  })

  it('typing a bullet, then closing, keeps the note and its mark, hidden; a reload keeps them', async () => {
    const { crepe, view } = await mount(NOTES, zoomOpts())
    caretAt(view, 'free')
    mod(crepe, '.')
    type(crepe, view, '-')
    type(crepe, view, ' ')
    type(crepe, view, 'call')
    pressKey(crepe, 'Escape')
    const saved = getMarkdownForSave(crepe)
    expect(saved).toContain('free[^cell-2]')
    expect(saved).toContain('[^cell-2]: * call')
    expect(shown(view)).toEqual(['Intro', 'table', 'Outro'])
    const reloaded = await mount(saved, zoomOpts())
    expect(getMarkdownForSave(reloaded.crepe)).toBe(saved)
    expect(shown(reloaded.view)).toEqual(['Intro', 'table', 'Outro'])
  })

  it('in a cell bullet, ⌘. opens the cell\'s note, never a zoom; a dot click there zooms nothing; a key of such a bullet zooms out', async () => {
    const { crepe, root, view } = await mount(NOTES, zoomOpts())
    caretAt(view, 'Museum')
    expect(mod(crepe, '.')).toBe(true)
    expect(getZoomedItemPos(view.state)).toBeNull()
    expect(openCellNoteLabel(view.state)).toBe('cell-2')
    expect(crumbs(root)).toEqual([])
    pressKey(crepe, 'Escape')
    let item = -1
    view.state.doc.descendants((node, pos) => {
      if (item < 0 && node.type.name === 'list_item' && node.textContent === 'Museum') item = pos
      return item < 0
    })
    expect(canZoomInto(view.state.doc, item)).toBe(false)
    const dot = (view.nodeDOM(item) as HTMLElement).querySelector<HTMLElement>('.label-wrapper')
    if (dot !== null) click(dot)
    expect(getZoomedItemPos(view.state)).toBeNull()
    expect(zoomPageTo(crepe, zoomKeyAt(view.state.doc, item))).toBe(false)
    expect(getZoomedItemPos(view.state)).toBeNull()
  })

  it('a mark with no cell note opens an empty card; closing it removes the mark too', async () => {
    const { crepe, view } = await mount('| a | b |\n| - | - |\n| x | y |\n', zoomOpts())
    // A file cannot hold it (a mark with no footnote reads as text): a mark the app put in, as a paste may.
    caretAt(view, 'x')
    view.dispatch(view.state.tr.replaceSelectionWith(view.state.schema.nodes.footnote_reference.create({ label: 'cell-1' })))
    inCell(view, 'click', 1, 0)
    expect(openCellNoteLabel(view.state)).toBe('cell-1')
    pressKey(crepe, 'Escape')
    expect(getMarkdownForSave(crepe)).not.toContain('cell-1')
  })
})

describe('the table menu (D8)', () => {
  const all = (view: EditorView, row: number, col: number): MenuAction[] =>
    pageMenuSections(view, null, vi.fn(), cellPos(view, row, col) + 2)
      .flat()
      .flatMap((item: MenuItem) => (item.children === undefined ? [item] : item.children.flat()))
  const ids = (view: EditorView, row: number, col: number) => all(view, row, col).map((item) => item.id).filter((id) => id.includes('note'))
  const run = (view: EditorView, row: number, col: number, id: string) => all(view, row, col).find((item) => item.id === id)!.onSelect()

  it('Add on a cell with none; Open and Delete on one with a note; a header cell too; Delete and ⌘Z', async () => {
    const { crepe, root, view } = await mount(NOTES, zoomOpts())
    // "Move to cell note" (the demo) on every cell with some text.
    expect(ids(view, 1, 1)).toEqual(['table-open-note', 'table-move-to-note', 'table-delete-note'])
    expect(ids(view, 3, 1)).toEqual(['table-add-note', 'table-move-to-note'])
    expect(ids(view, 0, 0)).toEqual(['table-add-note', 'table-move-to-note'])
    run(view, 1, 1, 'table-open-note')
    expect(openCellNoteLabel(view.state)).toBe('cell-1')
    pressKey(crepe, 'Escape')
    run(view, 1, 1, 'table-delete-note')
    expect(getMarkdownForSave(crepe)).not.toContain('cell-1')
    undo(view.state, view.dispatch)
    expect(getMarkdownForSave(crepe)).toBe(NOTES)
    run(view, 0, 0, 'table-add-note')
    expect(openCellNoteLabel(view.state)).toBe('cell-2')
    // A header cell names its column only: the header row names no row (5A-16).
    expect(card(root)!.querySelector('.cell-note-card__title')!.textContent).toBe('Note: Day')
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
  // Settings › Tables › Cell notes › Add button is off by default (YAZ-4790 demo): these tests turn it on.
  beforeEach(() => setCellNoteButtonSetting(true))
  afterEach(() => setCellNoteButtonSetting(false))
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

  it('one element, outside the editable DOM, over the hovered cell\'s corner; "Edit cell note" on a cell with a note; a click adds and opens the note', async () => {
    const { crepe, root, view } = await mount(NOTES, zoomOpts())
    boxes(view)
    hover(view, 3, 1)
    expect(buttons()).toHaveLength(1)
    const button = shownButton()!
    expect(view.dom.contains(button)).toBe(false)
    expect(root.contains(button)).toBe(true)
    expect(button.getAttribute('aria-label')).toBe('Add cell note')
    // The cell (1, 3) spans x 100–200, y 90–120: the button's 22 px target ends at its right edge.
    expect([button.style.left, button.style.top]).toEqual([`${200 - 22 - 10}px`, `${90 - 20}px`])
    hover(view, 0, 1)
    expect(shownButton()!.style.top).toBe(`${-20}px`)
    // A cell with a note: "Edit cell note" under the pointer (round 2 of the demo).
    hover(view, 1, 1)
    expect(shownButton()!.getAttribute('aria-label')).toBe('Edit cell note')
    expect(shownButton()!.title).toBe('Edit cell note')
    // Off the table: the caret's cell, while the editor has focus; a caret cell with a note shows none.
    root.querySelector('p')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    view.hasFocus = () => true
    caretAt(view, 'Flights')
    expect(shownButton()).toBeNull()
    caretAt(view, 'free')
    expect(shownButton()!.style.top).toBe(`${90 - 20}px`)
    expect(shownButton()!.getAttribute('aria-label')).toBe('Add cell note')
    click(shownButton()!)
    expect(openCellNoteLabel(view.state)).toBe('cell-2')
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

  it('the pointer can go from the cell straight onto the button\'s icon: it stays', async () => {
    const { view } = await mount(NOTES, zoomOpts())
    boxes(view)
    hover(view, 3, 1)
    const button = shownButton()!
    view.dom.dispatchEvent(new MouseEvent('mouseleave', { relatedTarget: button.querySelector('svg') }))
    expect(shownButton()).toBe(button)
  })

  it('YAZ-4790: Settings › Add button off shows none; a table\'s own `notebutton` shows it; `nonotebutton` hides it while Settings is on', async () => {
    const TABLE = '| a | b |\n| - | - |\n| c | d |\n'
    setCellNoteButtonSetting(false)
    let { view } = await mount(TABLE, zoomOpts())
    boxes(view)
    hover(view, 1, 0)
    expect(shownButton()).toBeNull()
    await unmountAll()
    ;({ view } = await mount(`${TABLE}\n<!-- table: notebutton -->\n`, zoomOpts()))
    boxes(view)
    hover(view, 1, 0)
    expect(shownButton()?.getAttribute('aria-label')).toBe('Add cell note')
    await unmountAll()
    setCellNoteButtonSetting(true)
    ;({ view } = await mount(`${TABLE}\n<!-- table: nonotebutton -->\n`, zoomOpts()))
    boxes(view)
    hover(view, 1, 0)
    expect(shownButton()).toBeNull()
  })

  it('a typed key in the cell places nothing; a read-only page shows no button', async () => {
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
  afterEach(() => setCellNotePreviewLines(20))

  it('the first lines as plain text, a bullet as "• "', () => {
    const lines = (markdown: string) => mount(markdown).then(({ view }) => cellNotePreviewLines(view.state.doc.child(1), 6))
    return Promise.all([
      lines('| a |\n| - |\n| x[^cell-1] |\n\n[^cell-1]: * one\n    * two\n    * three\n').then((out) => expect(out).toEqual(['• one', '• two', '• three'])),
      lines('| a |\n| - |\n| x[^cell-1] |\n\n[^cell-1]: Top\n\n    1. first\n       * kid\n    2. second\n\n    * [ ] todo\n    * x\n    * y\n').then((out) =>
        expect(out).toEqual(['Top', '1. first', '  • kid', '2. second', '☐ todo', '• x']),
      ),
    ])
  })

  it('a rest anywhere on a cell with a note shows the box after the dwell; leaving the cell or a key closes it; none while its card is open', async () => {
    vi.useFakeTimers()
    // Crepe's block handle reads it on a `mousemove`; jsdom has none.
    document.elementsFromPoint = () => []
    const { view } = await mount(NOTES, zoomOpts())
    inCell(view, 'mousemove', 1, 1, 150, 45)
    expect(document.querySelector('.cell-note-preview')).toBeNull()
    vi.advanceTimersByTime(400)
    const box = document.querySelector<HTMLElement>('.cell-note-preview')!
    expect([...box.querySelectorAll('.cell-note-preview__line')].map((el) => el.textContent)).toEqual(['Book the window seat.', '• bullet a', '• bullet b'])
    expect(box.querySelector('.cell-note-preview__header')!.textContent).toBe('Note: Plan · Monday')
    expect(box.querySelector('.cell-note-preview__hint')!.textContent).toBe('Click the corner to open')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    expect(document.querySelector('.cell-note-preview')).toBeNull()
    inCell(view, 'mousemove')
    vi.advanceTimersByTime(400)
    expect(document.querySelector('.cell-note-preview')).not.toBeNull()
    // Still in the cell: the same box.
    inCell(view, 'mousemove', 1, 1, 150, 45)
    expect(document.querySelectorAll('.cell-note-preview')).toHaveLength(1)
    // A cell with no note shows none.
    inCell(view, 'mousemove', 3, 1)
    expect(document.querySelector('.cell-note-preview')).toBeNull()
    vi.advanceTimersByTime(400)
    expect(document.querySelector('.cell-note-preview')).toBeNull()
    // Its card open: no box.
    inCell(view, 'click')
    inCell(view, 'mousemove', 1, 1, 150, 45)
    vi.advanceTimersByTime(400)
    expect(document.querySelector('.cell-note-preview')).toBeNull()
  })

  /** A table whose "x" cell has a note of `count` bullets: "• 1" to "• count". */
  const longNote = (count: number) => `| a |\n| - |\n| x[^cell-1] |\n\n[^cell-1]: ${Array.from({ length: count }, (_, i) => `* ${i + 1}`).join('\n    ')}\n`
  const bullets = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `• ${from + i}`)
  /** The box's lines after a rest on the note's cell. */
  const boxLines = async (view: EditorView) => {
    inCell(view, 'mousemove', 1, 0, 150, 45)
    vi.advanceTimersByTime(400)
    const lines = [...document.querySelectorAll('.cell-note-preview .cell-note-preview__line')].map((el) => el.textContent)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    return lines
  }

  it('YAZ-5717: 20 lines then "…" when the note has more; the setting changes the count, clamped to 6–60', async () => {
    vi.useFakeTimers()
    document.elementsFromPoint = () => []
    const { view: thirty } = await mount(longNote(30))
    expect(await boxLines(thirty)).toEqual([...bullets(1, 20), '…'])
    const { view: twenty } = await mount(longNote(20))
    expect(await boxLines(twenty)).toEqual(bullets(1, 20))
    setCellNotePreviewLines(6)
    expect(await boxLines(thirty)).toEqual([...bullets(1, 6), '…'])
    setCellNotePreviewLines(100)
    const { view: seventy } = await mount(longNote(70))
    expect(await boxLines(seventy)).toEqual([...bullets(1, 60), '…'])
    setCellNotePreviewLines(2)
    expect(await boxLines(seventy)).toEqual([...bullets(1, 6), '…'])
  })

  it('YAZ-5717: the box stays inside the window: left of the cell at the right edge, moved up at the bottom', async () => {
    vi.useFakeTimers()
    document.elementsFromPoint = () => []
    const { view } = await mount(NOTES, zoomOpts())
    // jsdom lays out nothing: the box is as tall as 300px wherever it is put.
    const own = HTMLElement.prototype.getBoundingClientRect
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('cell-note-preview') ? new DOMRect(parseFloat(this.style.left), parseFloat(this.style.top), CELL_NOTE_BOX_WIDTH, 300) : own.call(this)
    })
    const cell = view.nodeDOM(cellPos(view, 1, 1)) as HTMLElement
    // The cell's right edge at 900 of jsdom's 1024 × 768 window, its top at 700.
    cell.getBoundingClientRect = () => new DOMRect(800, 700, 100, 30)
    cell.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 850, clientY: 710 }))
    vi.advanceTimersByTime(400)
    const box = document.querySelector<HTMLElement>('.cell-note-preview')!
    // 900 + 4 + 360 > 1024: left of the corner. 700 + 300 > 768 - 8: up, 8px from the bottom.
    expect([box.style.left, box.style.top]).toEqual([`${900 - 4 - CELL_NOTE_BOX_WIDTH}px`, `${768 - 8 - 300}px`])
    spy.mockRestore()
  })

  it('YAZ-5717: in a short window the lines past the box\'s bottom go, and the last one that shows reads "…"', () => {
    const box = document.createElement('div')
    const body = document.createElement('div')
    box.appendChild(body)
    for (let i = 1; i <= 10; i++) {
      const line = document.createElement('div')
      line.className = 'cell-note-preview__line'
      line.textContent = `Line ${i}`
      // Each line 20px tall from y = 40.
      line.getBoundingClientRect = () => new DOMRect(0, 20 + i * 20, 300, 20)
      body.appendChild(line)
    }
    // The box ends at 148: less its 8px padding, the lines must end by 140. Lines 1 to 5 fit (line 5 ends at 140); line 5 becomes "…".
    box.getBoundingClientRect = () => new DOMRect(0, 0, 360, 148)
    fitCard(box)
    expect(Array.from(box.querySelectorAll('.cell-note-preview__line'), (l) => l.textContent)).toEqual(['Line 1', 'Line 2', 'Line 3', 'Line 4', '…'])
    // A box with room keeps every line.
    const roomy = box.cloneNode(true) as HTMLElement
    roomy.getBoundingClientRect = () => new DOMRect(0, 0, 360, 1000)
    roomy.querySelectorAll<HTMLElement>('.cell-note-preview__line').forEach((l) => (l.getBoundingClientRect = () => new DOMRect(0, 40, 300, 20)))
    fitCard(roomy)
    expect(roomy.querySelectorAll('.cell-note-preview__line')).toHaveLength(5)
  })

  it('YAZ-5717: the CSS gives the note box 360px, at most the window less 16px, and lines that wrap', () => {
    const css = readFileSync(resolve(__dirname, 'cellHoverCard.css'), 'utf8')
    const rule = (selector: string) => css.match(new RegExp(`^${selector.replace(/\./g, '\\.')}\\s*\\{([^}]*)\\}`, 'm'))?.[1] ?? ''
    expect(CELL_NOTE_BOX_WIDTH).toBe(360)
    expect(rule('.cell-note-preview')).toContain(`width: ${CELL_NOTE_BOX_WIDTH}px;`)
    expect(rule('.cell-note-preview')).toContain('max-height: calc(100vh - 16px);')
    expect(rule('.cell-note-preview__line')).toContain('white-space: pre-wrap;')
    expect(rule('.cell-note-preview__line')).toContain('overflow-wrap: anywhere;')
    // The title stays on one row with "…".
    expect(rule('.cell-note-preview__header')).toContain('white-space: nowrap;')
    // The hanging indent: the lead (indent and marker) is its own column, so a wrapped row starts under the text.
    expect(rule('.cell-note-preview__line')).toContain('display: flex;')
    expect(rule('.cell-note-preview__lead')).toContain('flex: none;')
    expect(rule('.cell-note-preview__lead')).toContain('white-space: pre;')
  })

  it('YAZ-5780: the clamped full text has no bottom padding inside its clip, so no half row shows under its last row', () => {
    const css = readFileSync(resolve(__dirname, 'cellHoverCard.css'), 'utf8')
    const text = css.match(/^\.cell-note-preview__text\s*\{([^}]*)\}/m)?.[1] ?? ''
    expect(text).toContain('-webkit-line-clamp')
    expect(text).toContain('overflow: hidden;')
    // `overflow: hidden` clips at the padding box: the space under the text is a transparent border, outside the clip.
    expect(text).toMatch(/padding: 8px 12px 0;/)
    expect(text).toMatch(/border-bottom: 8px solid transparent;/)
  })

  it('YAZ-5717: a line\'s lead (its indent and marker) is apart from its text, so a wrapped row hangs under the text; nested ones keep their indent', async () => {
    vi.useFakeTimers()
    document.elementsFromPoint = () => []
    const { view } = await mount('| a |\n| - |\n| x[^cell-1] |\n\n[^cell-1]: Top\n\n    1. first\n       * kid\n    * [ ] todo\n')
    inCell(view, 'mousemove', 1, 0, 150, 45)
    vi.advanceTimersByTime(400)
    const lines = [...document.querySelectorAll<HTMLElement>('.cell-note-preview .cell-note-preview__line')]
    expect(lines.map((l) => l.textContent)).toEqual(['Top', '1. first', '  • kid', '☐ todo'])
    expect(lines.map((l) => l.querySelector('.cell-note-preview__lead')?.textContent ?? '')).toEqual(['', '1. ', '  • ', '☐ '])
    expect(lines.map((l) => l.querySelector('.cell-note-preview__line-text')?.textContent ?? l.textContent)).toEqual(['Top', 'first', 'kid', 'todo'])
  })
})

describe('the full-text card of a cut cell (YAZ-4901)', () => {
  /** A clipped table: "Flights" has a note, "Museum" a line then bullets, "free" is plain. jsdom cuts nothing by itself. */
  const CLIPPED = ['| Day | Plan |', '| - | - |', '| Monday | Flights[^cell-1] |', '| Tuesday | Museum<ul><li>Park</li><li>Zoo</li></ul> |', '| Friday | free |', '', '<!-- table: nowrap -->', '', '[^cell-1]: Book the window seat.', '', '    * bullet a', '    * bullet b', ''].join('\n')
  /** The cell's first line wider inside than out (cut), or not. */
  const cut = (view: EditorView, row: number, col: number, on = true) => {
    const line = (view.nodeDOM(cellPos(view, row, col)) as HTMLElement).querySelector('p')!
    Object.defineProperty(line, 'scrollWidth', { value: on ? 300 : 100, configurable: true })
    Object.defineProperty(line, 'clientWidth', { value: 100, configurable: true })
  }
  const card = () => document.querySelector<HTMLElement>('.cell-note-preview')
  const textLines = (box: HTMLElement) => [...box.querySelectorAll('.cell-note-preview__text-line')].map((el) => el.textContent)
  const open = async () => {
    vi.useFakeTimers()
    document.elementsFromPoint = () => []
    const { view } = await mount(CLIPPED, zoomOpts())
    return view
  }

  it('a cut cell with no note: its lines (a bullet as "• ") after 250 ms, under the cell at its left edge, as wide as its text up to 240; no title; a cell that is not cut shows nothing', async () => {
    const view = await open()
    cut(view, 2, 1)
    inCell(view, 'mousemove', 2, 1, 150, 45)
    vi.advanceTimersByTime(249)
    expect(card()).toBeNull()
    vi.advanceTimersByTime(1)
    const box = card()!
    expect(textLines(box)).toEqual(['Museum', '• Park', '• Zoo'])
    expect(box.querySelector('.cell-note-preview__header')).toBeNull()
    expect(view.dom.hasAttribute('title')).toBe(false)
    // `inCell` gives the cell a 100×30 box at (100, 30): under it, at its left; as wide as its text (YAZ-4903), up to
    // the cell's 100 clamped to 240.
    expect([box.style.left, box.style.top, box.style.width, box.style.maxWidth]).toEqual(['100px', '64px', 'max-content', '240px'])
    // "free" is not cut: nothing, at any wait.
    inCell(view, 'mousemove', 3, 1, 150, 45)
    expect(card()).toBeNull()
    vi.advanceTimersByTime(400)
    expect(card()).toBeNull()
  })

  it('a cut cell WITH a note: ONE card after 250 ms, the full text then the note part; a note cell that is not cut keeps the note box (400 ms, beside the corner)', async () => {
    const view = await open()
    cut(view, 1, 1)
    inCell(view, 'mousemove', 1, 1, 150, 45)
    vi.advanceTimersByTime(250)
    expect(document.querySelectorAll('.cell-note-preview')).toHaveLength(1)
    const box = card()!
    expect(textLines(box)).toEqual(['Flights'])
    expect(box.querySelector('.cell-note-preview__header')!.textContent).toBe('Note: Plan · Monday')
    expect(box.querySelector('.cell-note-preview__hint')!.textContent).toBe('Click the corner to open')
    expect([...box.querySelectorAll('.cell-note-preview__line')].map((el) => el.textContent)).toEqual(['Book the window seat.', '• bullet a', '• bullet b'])
    expect(box.style.top).toBe('64px')
    // Off every cell for the warm run, then the same cell wide again: the note box as before, to the right of the corner.
    inCell(view, 'mouseout', 3, 1, 0, 0)
    vi.advanceTimersByTime(500)
    cut(view, 1, 1, false)
    inCell(view, 'mousemove', 1, 1, 150, 45)
    vi.advanceTimersByTime(399)
    expect(card()).toBeNull()
    vi.advanceTimersByTime(1)
    const note = card()!
    expect(note.querySelector('.cell-note-preview__text')).toBeNull()
    expect(note.querySelector('.cell-note-preview__header')!.textContent).toBe('Note: Plan · Monday')
    expect([note.style.left, note.style.top]).toEqual(['204px', '30px'])
  })

  it('warm: after one card, the next cut cell\'s card shows at once; off every cell for 500 ms it waits again; a key closes the card and ends the run', async () => {
    const view = await open()
    cut(view, 2, 1)
    cut(view, 3, 1)
    inCell(view, 'mousemove', 2, 1, 150, 45)
    vi.advanceTimersByTime(250)
    expect(textLines(card()!)).toEqual(['Museum', '• Park', '• Zoo'])
    inCell(view, 'mousemove', 3, 1, 150, 45)
    expect(textLines(card()!)).toEqual(['free'])
    // Off the table (the paragraph after it) and back within 500 ms: still at once.
    view.dom.querySelector('p:last-of-type')!.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
    expect(card()).toBeNull()
    vi.advanceTimersByTime(499)
    inCell(view, 'mousemove', 2, 1, 150, 45)
    expect(textLines(card()!)).toEqual(['Museum', '• Park', '• Zoo'])
    // Off for 500 ms: the dwell again.
    inCell(view, 'mouseout', 2, 1, 0, 0)
    vi.advanceTimersByTime(500)
    inCell(view, 'mousemove', 3, 1, 150, 45)
    expect(card()).toBeNull()
    vi.advanceTimersByTime(250)
    expect(textLines(card()!)).toEqual(['free'])
    // A key: the card goes, and the next cell waits its 250 ms.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    expect(card()).toBeNull()
    inCell(view, 'mousemove', 2, 1, 150, 45)
    expect(card()).toBeNull()
    vi.advanceTimersByTime(250)
    expect(card()).not.toBeNull()
  })

  it('no card while the caret is in that cell; a key or a caret move builds nothing', async () => {
    const view = await open()
    cut(view, 3, 1)
    view.dom.focus()
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cellPos(view, 3, 1) + 2)))
    inCell(view, 'mousemove', 3, 1, 150, 45)
    vi.advanceTimersByTime(250)
    expect(card()).toBeNull()
    const builds = cellHoverCardRuns.builds
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cellPos(view, 2, 1) + 2)))
    vi.advanceTimersByTime(250)
    expect(cellHoverCardRuns.builds).toBe(builds)
    expect(card()).toBeNull()
  })

  describe('with a long note (YAZ-5717)', () => {
    /** "Flights" is cut and has a note of 30 bullets; "free" is plain. */
    const LONG = ['| Day | Plan |', '| - | - |', '| Monday | Flights[^cell-1] |', '| Friday | free |', '', '<!-- table: nowrap -->', '', `[^cell-1]: ${Array.from({ length: 30 }, (_, i) => `* line ${i + 1}`).join('\n    ')}`, ''].join('\n')
    const realHeight = window.innerHeight
    afterEach(() => {
      Object.defineProperty(window, 'innerHeight', { value: realHeight, configurable: true })
      vi.restoreAllMocks()
    })
    /**
     * jsdom lays out nothing. This lays out the card as a browser would: `natural` px tall, capped by its inline
     * `max-height` and by the CSS one (the window less 16px); the full-text part from the card's top, `textHeight` px
     * tall, in 12.5px text; then the note's title and hint, `headHeight` px; then each note line, 20px tall. `natural`
     * is a number, or `'content'`: as tall as what the card holds now, with 8px under the last note line.
     */
    const layout = (natural: number | 'content', windowHeight: number, textHeight = 40, headHeight = 20) => {
      Object.defineProperty(window, 'innerHeight', { value: windowHeight, configurable: true })
      const isCard = (el: HTMLElement) => el.classList.contains('cell-note-preview')
      const content = (card: HTMLElement) =>
        (card.querySelector('.cell-note-preview__text') ? textHeight : 0) + (card.querySelector('.cell-note-preview__header') ? headHeight + card.querySelectorAll('.cell-note-preview__line').length * 20 + 8 : 0)
      const height = (card: HTMLElement) => Math.min(natural === 'content' ? content(card) : natural, parseFloat(card.style.maxHeight) || Infinity, windowHeight - 16)
      const own = HTMLElement.prototype.getBoundingClientRect
      vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
        return isCard(this) ? height(this) : 0
      })
      vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
        return isCard(this) ? 320 : 0
      })
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        if (isCard(this)) return new DOMRect(parseFloat(this.style.left), parseFloat(this.style.top), 320, height(this))
        const card = this.closest<HTMLElement>('.cell-note-preview')
        if (card !== null && this.classList.contains('cell-note-preview__text')) return new DOMRect(parseFloat(card.style.left), parseFloat(card.style.top), 320, textHeight)
        if (card === null || !this.classList.contains('cell-note-preview__line')) return own.call(this)
        const index = [...card.querySelectorAll('.cell-note-preview__line')].indexOf(this)
        return new DOMRect(parseFloat(card.style.left), parseFloat(card.style.top) + textHeight + headHeight + index * 20, 300, 20)
      })
      const style = window.getComputedStyle
      vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) =>
        el instanceof HTMLElement && el.classList.contains('cell-note-preview__text') ? ({ fontSize: '12.5px' } as CSSStyleDeclaration) : style(el, pseudo),
      )
    }
    /** Rest on a cut cell at `rect` (row 1, "Flights" with the note, or row 2, "free" with none), and give its card. */
    const rest = async (rect: DOMRect, row = 1) => {
      vi.useFakeTimers()
      document.elementsFromPoint = () => []
      const { view } = await mount(LONG, zoomOpts())
      cut(view, row, 1)
      const cell = view.nodeDOM(cellPos(view, row, 1)) as HTMLElement
      cell.getBoundingClientRect = () => rect
      cell.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: rect.left + 10, clientY: rect.top + 10 }))
      vi.advanceTimersByTime(250)
      return card()!
    }
    /** The card's note lines: the last one reads "…", and each one ends above the card's bottom less its 8px padding. */
    const expectFitted = (box: HTMLElement) => {
      const lines = [...box.querySelectorAll<HTMLElement>('.cell-note-preview__line')]
      const bottom = box.getBoundingClientRect().bottom - 8
      expect(lines.length).toBeGreaterThan(1)
      expect(lines.length).toBeLessThan(21)
      expect(lines.map((l) => l.textContent)).toEqual([...Array.from({ length: lines.length - 1 }, (_, i) => `• line ${i + 1}`), '…'])
      for (const line of lines) expect(line.getBoundingClientRect().bottom).toBeLessThanOrEqual(bottom)
    }

    it('1A (YAZ-5746): in a short window the card drops the note lines that it cuts, and the last one that shows reads "…"', async () => {
      layout(600, 420)
      expectFitted(await rest(new DOMRect(100, 30, 100, 30)))
    })

    it('1B (YAZ-5747): a card taller than the room under and above never covers its cell: it takes the side with more room, as tall as that room, 8px from the window\'s edge', async () => {
      // A 718px window; the cell from 360 to 401: 305px under it, 348px above it. The card wants 600px.
      layout(600, 718)
      const above = await rest(new DOMRect(100, 360, 100, 41))
      const rect = above.getBoundingClientRect()
      expect([rect.top, rect.bottom]).toEqual([8, 360 - 4])
      expectFitted(above)
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      await unmountAll()
      // The cell higher up, from 300 to 341: now under it has more room (369px against 288px).
      layout(600, 718)
      const under = await rest(new DOMRect(100, 300, 100, 41))
      expect([under.getBoundingClientRect().top, under.getBoundingClientRect().bottom]).toEqual([341 + 4, 718 - 8])
      expectFitted(under)
    })

    it('1B follow-up (YAZ-5747): a cut card whose full text the cap cuts clamps that text to the rows that fit, so it ends with "…"; a note under it goes', async () => {
      // A 200px window, the cell from 60 to 90: 98px under it, 48px above. The text part wants 300px.
      // Rows that fit: the card's bottom 192, less 8px padding under and 8px over the text, in 17.5px rows: 4.
      layout(400, 200, 300)
      const plain = await rest(new DOMRect(100, 60, 100, 30), 2)
      expect(plain.getBoundingClientRect().bottom).toBe(200 - 8)
      expect(plain.querySelector<HTMLElement>('.cell-note-preview__text')!.style.getPropertyValue('--fit-lines')).toBe('4')
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      await unmountAll()
      // The same with a note: the text clamps the same way, and the note's part, all under the cut, goes.
      layout(400, 200, 300)
      const noted = await rest(new DOMRect(100, 60, 100, 30))
      expect(noted.querySelector<HTMLElement>('.cell-note-preview__text')!.style.getPropertyValue('--fit-lines')).toBe('4')
      expect(noted.querySelector('.cell-note-preview__header, .cell-note-preview__hint, .cell-note-preview__body')).toBeNull()
    })

    it('1E (YAZ-5758): the text fits but the note\'s title or first line does not: the note\'s part goes, and the text ends with a "…" row (clamped to the rows that fit)', async () => {
      // A 250px window, the cell from 200 to 230: above it 188px, the card at 8 to 196. The text part (150px) fits;
      // the first note line (178 to 198) does not end by 196 - 8.
      layout(600, 250, 150)
      const box = await rest(new DOMRect(100, 200, 100, 30))
      expect(box.querySelector('.cell-note-preview__header, .cell-note-preview__hint, .cell-note-preview__body')).toBeNull()
      expect(textLines(box)).toEqual(['Flights', '…'])
      // (196 - 8 - (8 + 8)) / 17.5: 9 rows fit.
      expect(box.querySelector<HTMLElement>('.cell-note-preview__text')!.style.getPropertyValue('--fit-lines')).toBe('9')
    })

    it('a card above its cell that the fit makes shorter moves down: its bottom is 4px above the cell again', async () => {
      // A 718px window, the cell from 360 to 401: the card goes above, capped to 348px (8 to 356). Its 21 note lines
      // start 65px under its top: 13 fit, and the card shrinks to 40 + 25 + 13 × 20 + 8 = 333px.
      layout('content', 718, 40, 25)
      const box = await rest(new DOMRect(100, 360, 100, 41))
      expect(box.querySelectorAll('.cell-note-preview__line')).toHaveLength(13)
      expect([box.getBoundingClientRect().top, box.getBoundingClientRect().bottom]).toEqual([360 - 4 - 333, 360 - 4])
    })
  })

  it('a read-only page shows the card too', async () => {
    const view = await open()
    cut(view, 3, 1)
    view.setProps({ editable: () => false })
    inCell(view, 'mousemove', 3, 1, 150, 45)
    vi.advanceTimersByTime(250)
    expect(textLines(card()!)).toEqual(['free'])
  })
})

describe('the corner opens the note (5A-18)', () => {
  it('a click in the corner of a cell with a note opens it; a click in its words, or in the corner of a cell with none, does not', async () => {
    const { view } = await mount(NOTES, zoomOpts())
    inCell(view, 'click', 1, 1, 150, 45)
    expect(openCellNoteLabel(view.state)).toBeNull()
    inCell(view, 'click', 3, 1)
    expect(openCellNoteLabel(view.state)).toBeNull()
    inCell(view, 'click')
    expect(openCellNoteLabel(view.state)).toBe('cell-1')
  })
})

describe('a read-only page (5A-6, 5A-22)', () => {
  const EMPTY = '| a          |\n| ---------- |\n| b[^cell-1] |\n\n[^cell-1]: <br />\n\nEnd\n'

  it('closing an empty cell note\'s card changes nothing', async () => {
    const { crepe, root, view } = await mount(EMPTY, zoomOpts())
    crepe.setReadonly(true)
    const doc = view.state.doc
    inCell(view, 'click', 1, 0)
    expect(openCellNoteLabel(view.state)).toBe('cell-1')
    click(card(root)!.querySelector('.cell-note-card__close')!)
    expect(openCellNoteLabel(view.state)).toBeNull()
    expect(view.state.doc.eq(doc)).toBe(true)
  })

  it('canOpenCellNote: a read-only page opens only a cell note that is there', async () => {
    const { crepe, view } = await mount(NOTES, zoomOpts())
    expect(canOpenCellNote(view, cellPos(view, 3, 1))).toBe(true)
    crepe.setReadonly(true)
    expect(canOpenCellNote(view, cellPos(view, 3, 1))).toBe(false)
    expect(canOpenCellNote(view, cellPos(view, 1, 1))).toBe(true)
  })
})

describe('an empty cell note never reaches the file (D15, 5A-5)', () => {
  it('while its card is open, a save and the change report leave it out, and its mark; a word in it saves it', async () => {
    const onMarkdownUpdated = vi.fn()
    const { crepe, view } = await mount(NOTES, { ...zoomOpts(), onMarkdownUpdated })
    caretAt(view, 'free')
    mod(crepe, '.')
    expect(openCellNoteLabel(view.state)).toBe('cell-2')
    expect(getMarkdownForSave(crepe)).toBe(NOTES)
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(onMarkdownUpdated.mock.calls.flat().some((md: string) => md.includes('cell-2'))).toBe(false)
    expect(openCellNoteLabel(view.state)).toBe('cell-2')
    const at = view.state.doc.child(0).nodeSize + view.state.doc.child(1).nodeSize + view.state.doc.child(2).nodeSize
    expect(view.state.doc.nodeAt(at)?.attrs.label).toBe('cell-2')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at + 2)))
    type(crepe, view, 'x')
    expect(getMarkdownForSave(crepe)).toContain('[^cell-2]: x')
    await vi.waitFor(() => expect(onMarkdownUpdated).toHaveBeenLastCalledWith(expect.stringContaining('[^cell-2]: x')))
  })
})
