/**
 * "All notes" of a calendar table (YAZ-4276, `cellNoteCard.ts`): the column's real notes in the page under the table, each
 * under its time heading (A, D1, D3, D4); an empty block makes its note (B); the head's columns, Now, Only filled, Copy
 * all and Back (C); where it opens, its keys and its hotkey row (D). A real editor; the clock is fixed at 7:10 am, so
 * the 7:00 am block is now's, and 6:00 and 6:30 are past.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { undo } from '@milkdown/kit/prose/history'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { getMarkdownForSave, setMarkdown } from '../createCrepe'
import { NOTE_KEYS } from '@shared/keys/note'
import { editorViewCtx } from '@milkdown/kit/core'
import { mount, pressKey, unmountAll } from '../marks/markTestKit'
import { calendarBuilds, CELL_NOTE_OPEN_CLASS, CELL_NOTE_SHOWN_CLASS, openCellNote, setAllCellNotes, setAllNotesOpensAt, setCellNotePinnedAtStart } from './cellNoteCard'
import { cellNoteCardKey, isCellNoteHidden, notePosOf, openCellNoteLabel } from './cellNotes'
import { cellPos } from './tableTestKit'

const DAY = [
  '| Time | Plan | Lookback |',
  '| --- | --- | --- |',
  '| 6:00 am | gym[^cell-1] |  |',
  '| 6:30 am | read | slept[^cell-2] |',
  '| 7:00 am | work[^cell-3] |  |',
  '| 7:30 am |  |  |',
  '',
  '<!-- table: calendar 30m -->',
  '',
  '[^cell-1]: warm up',
  '',
  '[^cell-2]: tired',
  '',
  '[^cell-3]: email',
  '',
  'after',
  '',
].join('\n')

const PLAIN = '| Day | Plan |\n| --- | --- |\n| Monday | Flights[^cell-1] |\n\n[^cell-1]: Book the window seat.\n'

beforeEach(() => {
  setCellNotePinnedAtStart(false)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 2, 7, 10, 0))
})

afterEach(async () => {
  setAllNotesOpensAt('cell')
  vi.useRealTimers()
  await unmountAll()
})

const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
const head = (root: HTMLElement) => root.querySelector<HTMLElement>('.cell-note-all-head')
const button = (root: HTMLElement, name: string) => [...head(root)!.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === name || b.title === name)!
/** The view from the top: each time heading, shown note and empty block, in the page's order. */
const view_ = (root: HTMLElement): string[] =>
  [...root.querySelectorAll<HTMLElement>(`.cell-note-time, .${CELL_NOTE_SHOWN_CLASS}, .cell-note-time-empty`)].map((el) =>
    el.classList.contains('cell-note-time') ? `@${el.textContent}${el.classList.contains('cell-note-time--past') ? ' (past)' : ''}` : el.classList.contains(CELL_NOTE_SHOWN_CLASS) ? el.textContent! : '(empty)',
  )
const saved = (crepe: Crepe) => getMarkdownForSave(crepe)
/** ⌘⌥ and a key, through the editor's keymaps. */
const altMod = (crepe: Crepe, key: string): boolean =>
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const event = new KeyboardEvent('keydown', { key, code: `Key${key.toUpperCase()}`, metaKey: true, altKey: true, bubbles: true, cancelable: true })
    return view.someProp('handleKeyDown', (handler) => handler(view, event)) ?? false
  })

/** ⌥ and an arrow, through the editor's keymaps. */
const alt = (crepe: Crepe, key: 'ArrowDown' | 'ArrowUp'): boolean =>
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const event = new KeyboardEvent('keydown', { key, altKey: true, bubbles: true, cancelable: true })
    return view.someProp('handleKeyDown', (handler) => handler(view, event)) ?? false
  })
const caretIn = (view: EditorView, text: string) => {
  let pos = -1
  view.state.doc.descendants((node, at) => {
    if (pos < 0 && node.isText && node.text === text) pos = at + text.length
    return pos < 0
  })
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)))
}
const caretText = (view: EditorView) => view.state.selection.$head.parent.textContent

/** The calendar of `DAY`, "All notes" opened from the Plan note of `row`. */
async function openAll(row = 1, markdown = DAY) {
  const mounted = await mount(markdown)
  expect(openCellNote(mounted.view, cellPos(mounted.view, row, 1))).toBe(true)
  click(mounted.root.querySelector('.cell-note-card__all-toggle')!)
  return mounted
}

describe('the view: the column\'s notes in the page, each under its time (A)', () => {
  it('opened from the 6:00 Plan note: every time block of Plan, in order; empty blocks say so; Now on 7:00; the past dims', async () => {
    const { root, view } = await openAll()
    expect(root.querySelector(`.${CELL_NOTE_OPEN_CLASS}`)).toBeNull()
    expect(head(root)!.querySelector('.cell-note-all-head__title')!.textContent).toBe('All notes: Plan')
    expect(view_(root)).toEqual(['@6:00 am (past)', 'warm up', '@6:30 am (past)', '(empty)', '@7:00 amNow', 'email', '@7:30 am', '(empty)'])
    // The Lookback note stays hidden; the shown ones are not.
    expect(isCellNoteHidden(view.state, notePosOf(view.state.doc, 'cell-2')!)).toBe(true)
    expect(isCellNoteHidden(view.state, notePosOf(view.state.doc, 'cell-3')!)).toBe(false)
    expect(caretText(view)).toBe('warm up')
  })

  it('typing in a shown note or a Plan cell only maps the view; typing a time builds it again (the heading follows)', async () => {
    const { crepe, root, view } = await openAll()
    const builds = calendarBuilds.count
    caretIn(view, 'email')
    view.dispatch(view.state.tr.insertText(' and calls'))
    caretIn(view, 'read')
    view.dispatch(view.state.tr.insertText('ing'))
    expect(calendarBuilds.count).toBe(builds)
    expect(saved(crepe)).toContain('[^cell-3]: email and calls')
    expect(view_(root)).toContain('email and calls')
    caretIn(view, '7:30 am')
    view.dispatch(view.state.tr.insertText(' (gym)'))
    expect(calendarBuilds.count).toBe(builds + 1)
    expect(view_(root)).toContain('@7:30 am (gym)')
  })

  it('A10: a whole-note rebuild (the file read again) closes the view cleanly', async () => {
    const { crepe, root, view } = await openAll()
    setMarkdown(crepe, DAY)
    expect(openCellNoteLabel(view.state)).toBeNull()
    expect(head(root)).toBeNull()
    expect(root.querySelectorAll('.cell-note-time')).toHaveLength(0)
  })

  it('a table that is no calendar table keeps the read-only list of every note (D4)', async () => {
    const { root, view } = await mount(PLAIN)
    openCellNote(view, cellPos(view, 1, 1))
    click(root.querySelector('.cell-note-card__all-toggle')!)
    expect(head(root)).toBeNull()
    expect(root.querySelector(`.${CELL_NOTE_OPEN_CLASS}.cell-note--all`)).not.toBeNull()
  })
})

describe('an empty block makes its note (B)', () => {
  it('a click: the note of that cell, the caret in it, the view still on; one ⌘Z removes the note and its mark (A8)', async () => {
    const { crepe, root, view } = await openAll()
    const before = saved(crepe)
    click(root.querySelectorAll('.cell-note-time-empty')[0]!)
    expect(cellNoteCardKey.getState(view.state)?.calendar).not.toBeNull()
    expect(view_(root)).toEqual(['@6:00 am (past)', 'warm up', '@6:30 am (past)', '', '@7:00 amNow', 'email', '@7:30 am', '(empty)'])
    expect(view.state.doc.nodeAt(cellPos(view, 2, 1))!.firstChild!.childCount).toBe(2)
    view.dispatch(view.state.tr.insertText('chapter 3'))
    expect(saved(crepe)).toContain('| 6:30 am | read[^cell-4] |')
    expect(saved(crepe)).toContain('[^cell-4]: chapter 3')
    undo(view.state, view.dispatch)
    undo(view.state, view.dispatch)
    expect(saved(crepe)).toBe(before)
  })

  it('leaving the view removes the notes it made that are still empty; a made note with text, and the rest, stay (A9)', async () => {
    const { crepe, root, view } = await openAll()
    const empties = () => [...root.querySelectorAll('.cell-note-time-empty')]
    click(empties()[1]!) // 7:30, left empty
    click(empties()[0]!) // 6:30, written in
    view.dispatch(view.state.tr.insertText('chapter 3'))
    setAllCellNotes(view, false)
    expect(openCellNoteLabel(view.state)).toBe('cell-1')
    expect(root.querySelector(`.${CELL_NOTE_OPEN_CLASS}`)?.textContent).toContain('warm up')
    const file = saved(crepe)
    expect(file).toContain('chapter 3')
    expect(file).not.toMatch(/\| 7:30 am \| [^|]*\[\^cell-/)
    expect(file).toContain('[^cell-1]: warm up')
  })
})

describe('a view that closes by any route removes the empty notes it made (A9)', () => {
  it('its table stops being a calendar table: the view closes, and the empty note it made goes with its mark', async () => {
    const { crepe, root, view } = await openAll()
    const before = saved(crepe)
    click(root.querySelectorAll('.cell-note-time-empty')[0]!)
    let table = -1
    view.state.doc.descendants((node, pos) => {
      if (table < 0 && node.type.name === 'table') table = pos
      return table < 0
    })
    view.dispatch(view.state.tr.setNodeMarkup(table, undefined, { ...view.state.doc.nodeAt(table)!.attrs, calendar: 0 }))
    expect(cellNoteCardKey.getState(view.state)?.calendar ?? null).toBeNull()
    expect(saved(crepe)).toBe(before.replace('<!-- table: calendar 30m -->', '').replace(/\n{3,}/g, '\n\n'))
  })
})

describe('the head (C)', () => {
  it('a column button shows that column; Only filled hides the empty blocks and shows them again', async () => {
    const { root } = await openAll()
    expect([...head(root)!.querySelectorAll('.cell-note-all-head__column')].map((b) => `${b.textContent}:${b.getAttribute('aria-pressed')}`)).toEqual(['Plan:true', 'Lookback:false'])
    click(button(root, 'Lookback'))
    expect(head(root)!.querySelector('.cell-note-all-head__title')!.textContent).toBe('All notes: Lookback')
    expect(view_(root)).toEqual(['@6:00 am (past)', '(empty)', '@6:30 am (past)', 'tired', '@7:00 amNow', '(empty)', '@7:30 am', '(empty)'])
    click(button(root, 'Only filled'))
    expect(view_(root)).toEqual(['@6:30 am (past)', 'tired'])
    click(button(root, 'Only filled'))
    expect(view_(root)).toHaveLength(8)
  })

  it('"Only filled" stays for the tab: back to the card and into "All notes" again, it is still on (A3)', async () => {
    const { root, view } = await openAll()
    click(button(root, 'Only filled'))
    setAllCellNotes(view, false)
    click(root.querySelector('.cell-note-card__all-toggle')!)
    expect(button(root, 'Only filled').getAttribute('aria-pressed')).toBe('true')
    expect(view_(root)).toEqual(['@6:00 am (past)', 'warm up', '@7:00 amNow', 'email'])
  })

  it('Copy all: each filled block, its time on a line, its note under it, as Markdown (A7)', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const { root } = await openAll()
    click(button(root, 'Copy all'))
    expect(writeText).toHaveBeenCalledWith('6:00 am\n\nwarm up\n\n7:00 am\n\nemail')
  })

  it('Now puts the caret in now\'s note; Back goes to the card of the note it came from; × closes it all', async () => {
    const { root, view } = await openAll()
    click(button(root, 'Now'))
    expect(caretText(view)).toBe('email')
    click(button(root, 'Back to this cell note'))
    expect(cellNoteCardKey.getState(view.state)?.calendar).toBeNull()
    expect(openCellNoteLabel(view.state)).toBe('cell-1')
    expect(caretText(view)).toBe('warm up')
    click(root.querySelector('.cell-note-card__all-toggle')!)
    click(button(root, 'Close all notes'))
    expect(openCellNoteLabel(view.state)).toBeNull()
    expect(head(root)).toBeNull()
  })
})

describe('where it opens, and its keys (D)', () => {
  it('A6: "All notes of a calendar table" has no key by default; given one, it opens the view from a cell with no note, and again goes back to the card', async () => {
    expect(NOTE_KEYS.find((row) => row.id === 'note.allCellNotes')?.keys).toEqual([])
    const { crepe, root, view } = await mount(DAY, { hotkeys: { 'note.allCellNotes': 'CmdOrCtrl+Alt+A' } })
    caretIn(view, 'read')
    expect(altMod(crepe, 'a')).toBe(true)
    expect(head(root)).not.toBeNull()
    expect(cellNoteCardKey.getState(view.state)?.calendar).not.toBeNull()
    expect(altMod(crepe, 'a')).toBe(true)
    expect(cellNoteCardKey.getState(view.state)?.calendar ?? null).toBeNull()
    expect(openCellNoteLabel(view.state)).not.toBeNull()
  })

  it('"All notes opens at": the cell you came from (the caret stays), or now (the caret in now\'s note)', async () => {
    const first = await openAll(1)
    expect(caretText(first.view)).toBe('warm up')
    setAllNotesOpensAt('now')
    const second = await openAll(1)
    expect(caretText(second.view)).toBe('email')
  })

  it('⌥↓ and ⌥↑ go from time block to time block, making an empty one\'s note; Esc leaves, the caret in that cell', async () => {
    const { crepe, view } = await openAll()
    const before = saved(crepe)
    expect(alt(crepe, 'ArrowDown')).toBe(true)
    expect(cellNoteCardKey.getState(view.state)?.calendar?.made).toEqual(['cell-4'])
    expect(alt(crepe, 'ArrowDown')).toBe(true)
    expect(caretText(view)).toBe('email')
    expect(alt(crepe, 'ArrowUp')).toBe(true)
    expect(caretText(view)).toBe('')
    expect(pressKey(crepe, 'Escape')).toBe(true)
    expect(openCellNoteLabel(view.state)).toBeNull()
    // The 6:30 note it made is gone, empty; the caret is in its cell.
    expect(saved(crepe)).toBe(before)
    expect(caretText(view)).toBe('read')
  })
})
