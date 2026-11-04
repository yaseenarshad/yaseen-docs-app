/**
 * "All notes" of a calendar table (YAZ-4276, in the card since YAZ-4389, `cellNoteCard.ts`): the card is the LIVE time
 * block's real note, and the column's other blocks stand above and below it as their lines (A); a click on a line makes
 * that block live, and an empty block makes its note (B); the head's columns, Only filled, Copy all, Now, Back and ×
 * (C); the keys, where it opens, its hotkey row, and every way it closes (D). A real editor; the clock is fixed at
 * 7:10 am, so the 7:00 am block is now's, and 6:00 and 6:30 are past.
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
import { calendarBuilds, CELL_NOTE_CALENDAR_CLASS, CELL_NOTE_OPEN_CLASS, openCellNote, setAllNotesOpensAt, setCellNotePinnedAtStart } from './cellNoteCard'
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
  '    calls',
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
const card = (root: HTMLElement) => root.querySelector<HTMLElement>(`.${CELL_NOTE_OPEN_CLASS}`)
const head = (root: HTMLElement) => root.querySelector<HTMLElement>('.cell-note-all-head')
const button = (root: HTMLElement, name: string) => [...head(root)!.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === name || b.title === name)!
const title = (root: HTMLElement) => head(root)!.querySelector('.cell-note-all-head__title')!.textContent
/** The empty blocks' "Empty. Click to write." */
const empties = (root: HTMLElement) => [...card(root)!.querySelectorAll<HTMLElement>('.cell-note-time-empty')]
/** The line of a block that is not live, by its text. */
const line = (root: HTMLElement, text: string) => [...card(root)!.querySelectorAll<HTMLElement>('.cell-note-block__line')].find((el) => el.textContent === text)!

/**
 * The card from the top: each time block as "<time> (now, past, live): <its lines>", the live block's lines read from
 * the note itself, "(empty)" for an empty block.
 */
const blocks = (root: HTMLElement): string[] => {
  const note = card(root)!
  const live = [...note.children].filter((el) => !el.matches('.cell-note-card__head, .cell-note-blocks')).map((el) => el.textContent)
  return [...note.querySelectorAll<HTMLElement>('.cell-note-block')].map((block) => {
    const time = block.querySelector('.cell-note-time')!
    const isLive = block.classList.contains('cell-note-block--live')
    const tags = [time.classList.contains('cell-note-time--now') && 'now', block.classList.contains('cell-note-block--past') && 'past', isLive && 'live'].filter(Boolean)
    const lines = isLive ? live : block.querySelector('.cell-note-time-empty') !== null ? ['(empty)'] : [...block.querySelectorAll('.cell-note-block__line')].map((el) => el.textContent)
    return `${time.firstChild!.textContent}${tags.length > 0 ? ` (${tags.join(', ')})` : ''}: ${lines.join(' / ')}`
  })
}
const saved = (crepe: Crepe) => getMarkdownForSave(crepe)
/** A key as the browser sends it, a `keydown` on the editor: every DOM handler and keymap sees it. True when one took it. */
const domKey = (view: EditorView, key: string): boolean => !view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
const made = (view: EditorView) => cellNoteCardKey.getState(view.state)?.calendar?.made
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

describe('the card: the live block\'s real note, the column\'s other blocks as its lines (A)', () => {
  it('opened from the 6:00 Plan note: a calendar card, "All notes: Plan", every block in order; empty blocks say so; Now on 7:00; the past dims', async () => {
    const { root, view } = await openAll()
    expect(card(root)!.classList).toContain(CELL_NOTE_CALENDAR_CLASS)
    expect(card(root)!.classList).toContain('cell-note--past')
    expect(card(root)!.textContent).toContain('warm up')
    expect(title(root)).toBe('All notes: Plan')
    expect(blocks(root)).toEqual(['6:00 am (past, live): warm up', '6:30 am (past): (empty)', '7:00 am (now): email / calls', '7:30 am: (empty)'])
    expect(empties(root).map((el) => el.textContent)).toEqual(['Empty. Click to write.', 'Empty. Click to write.'])
    // Only the live note is drawn; the others stay hidden under the table.
    expect(isCellNoteHidden(view.state, notePosOf(view.state.doc, 'cell-1')!)).toBe(false)
    expect(isCellNoteHidden(view.state, notePosOf(view.state.doc, 'cell-3')!)).toBe(true)
    expect(caretText(view)).toBe('warm up')
  })

  it('a click on another block\'s line makes that block live, the caret on that line; typing there only maps the card, a time builds it again', async () => {
    const { crepe, root, view } = await openAll()
    click(line(root, 'calls'))
    expect(openCellNoteLabel(view.state)).toBe('cell-3')
    expect(caretText(view)).toBe('calls')
    expect(view.state.selection.$head.parentOffset).toBe('calls'.length)
    expect(blocks(root)).toEqual(['6:00 am (past): warm up', '6:30 am (past): (empty)', '7:00 am (now, live): email / calls', '7:30 am: (empty)'])
    expect(card(root)!.classList).not.toContain('cell-note--past')
    const builds = calendarBuilds.count
    view.dispatch(view.state.tr.insertText(' mum'))
    caretIn(view, 'read')
    view.dispatch(view.state.tr.insertText('ing'))
    expect(calendarBuilds.count).toBe(builds)
    expect(saved(crepe)).toContain('    calls mum')
    caretIn(view, '7:30 am')
    view.dispatch(view.state.tr.insertText(' (gym)'))
    expect(calendarBuilds.count).toBe(builds + 1)
    expect(blocks(root)).toContain('7:30 am (gym): (empty)')
  })
})

describe('an empty block makes its note (B)', () => {
  it('a click on "Empty. Click to write.": the note of that cell, its mark, the caret in it; one ⌘Z removes the note and its mark (A8)', async () => {
    const { crepe, root, view } = await openAll()
    const before = saved(crepe)
    click(empties(root)[0]!)
    expect(made(view)).toEqual(['cell-4'])
    expect(openCellNoteLabel(view.state)).toBe('cell-4')
    expect(view.state.doc.nodeAt(cellPos(view, 2, 1))!.firstChild!.childCount).toBe(2)
    expect(blocks(root)).toEqual(['6:00 am (past): warm up', '6:30 am (past, live): ', '7:00 am (now): email / calls', '7:30 am: (empty)'])
    expect(caretText(view)).toBe('')
    expect(card(root)!.contains(view.domAtPos(view.state.selection.head).node)).toBe(true)
    undo(view.state, view.dispatch)
    expect(saved(crepe)).toBe(before)
  })

  it('a made note left empty goes when another block goes live; a made note with text stays (A9)', async () => {
    const { crepe, root, view } = await openAll()
    click(empties(root)[1]!) // 7:30, left empty
    expect(made(view)).toEqual(['cell-4'])
    click(empties(root)[0]!) // 6:30, written in
    expect(saved(crepe)).not.toMatch(/\| 7:30 am \| [^|]*\[\^cell-/)
    view.dispatch(view.state.tr.insertText('chapter 3'))
    click(line(root, 'warm up'))
    expect(openCellNoteLabel(view.state)).toBe('cell-1')
    expect(blocks(root)).toEqual(['6:00 am (past, live): warm up', '6:30 am (past): chapter 3', '7:00 am (now): email / calls', '7:30 am: (empty)'])
    const file = saved(crepe)
    expect(file).toMatch(/\| 6:30 am \| read\[\^cell-\d\] \|/)
    expect(file).toMatch(/\[\^cell-\d\]: chapter 3/)
    expect(file).not.toMatch(/\| 7:30 am \| [^|]*\[\^cell-/)
  })
})

describe('the head (C)', () => {
  it('a column button switches the column; Only filled hides the empty blocks, shows them again, and stays for the tab (A2, A3)', async () => {
    const { root } = await openAll()
    expect([...head(root)!.querySelectorAll('.cell-note-all-head__column')].map((b) => `${b.textContent}:${b.getAttribute('aria-pressed')}`)).toEqual(['Plan:true', 'Lookback:false'])
    click(button(root, 'Lookback'))
    expect(title(root)).toBe('All notes: Lookback')
    expect(blocks(root)).toEqual(['6:00 am (past): (empty)', '6:30 am (past, live): tired', '7:00 am (now): (empty)', '7:30 am: (empty)'])
    click(button(root, 'Only filled'))
    expect(blocks(root)).toEqual(['6:30 am (past, live): tired'])
    click(button(root, 'Only filled'))
    expect(blocks(root)).toHaveLength(4)
    click(button(root, 'Only filled'))
    click(button(root, 'Back to this cell note'))
    expect(head(root)).toBeNull()
    click(root.querySelector('.cell-note-card__all-toggle')!)
    expect(button(root, 'Only filled').getAttribute('aria-pressed')).toBe('true')
    expect(blocks(root)).toEqual(['6:30 am (past, live): tired'])
  })

  it('Copy all: each filled block, its time on a line, then its note, as Markdown (A7)', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const { root } = await openAll()
    click(button(root, 'Copy all'))
    expect(writeText).toHaveBeenCalledWith('6:00 am\n\nwarm up\n\n7:00 am\n\nemail\n\ncalls')
  })

  it('Now makes now\'s note live; Back goes to the card of that one cell note; × closes it all', async () => {
    const { root, view } = await openAll()
    click(button(root, 'Now'))
    expect(openCellNoteLabel(view.state)).toBe('cell-3')
    expect(caretText(view)).toBe('calls')
    click(button(root, 'Back to this cell note'))
    expect(cellNoteCardKey.getState(view.state)?.calendar).toBeNull()
    expect(cellNoteCardKey.getState(view.state)?.all).toBe(false)
    expect(openCellNoteLabel(view.state)).toBe('cell-3')
    expect(card(root)!.classList).not.toContain(CELL_NOTE_CALENDAR_CLASS)
    expect(caretText(view)).toBe('calls')
    click(root.querySelector('.cell-note-card__all-toggle')!)
    click(button(root, 'Close all notes'))
    expect(openCellNoteLabel(view.state)).toBeNull()
    expect(card(root)).toBeNull()
    expect(head(root)).toBeNull()
  })
})

describe('its keys (D, A5)', () => {
  it('↓ on the live note\'s last line and ↑ on its first go to the next and the previous block with a note; at the column\'s end the caret stays', async () => {
    const { view } = await openAll()
    // jsdom has no line boxes: every line is a textblock's edge. The key goes in as the browser sends it, so Crepe's gap
    // cursor sees it too: it put a gap cursor after the note before the card's own arrows ran (YAZ-4395).
    view.endOfTextblock = () => true
    expect(domKey(view, 'ArrowDown')).toBe(true)
    expect(openCellNoteLabel(view.state)).toBe('cell-3')
    expect(caretText(view)).toBe('email')
    expect(domKey(view, 'ArrowUp')).toBe(true)
    expect(openCellNoteLabel(view.state)).toBe('cell-1')
    expect(caretText(view)).toBe('warm up')
    expect(domKey(view, 'ArrowDown')).toBe(true)
    caretIn(view, 'calls')
    expect(domKey(view, 'ArrowDown')).toBe(true)
    expect(openCellNoteLabel(view.state)).toBe('cell-3')
    expect(caretText(view)).toBe('calls')
    expect(made(view)).toEqual([])
  })

  it('⌥↓ and ⌥↑ go one block at a time, making an empty block\'s note; Esc closes, the caret in that time\'s cell, the empty notes it made gone', async () => {
    const { crepe, view } = await openAll()
    const before = saved(crepe)
    expect(alt(crepe, 'ArrowDown')).toBe(true)
    expect(made(view)).toEqual(['cell-4'])
    expect(caretText(view)).toBe('')
    expect(alt(crepe, 'ArrowDown')).toBe(true)
    expect(openCellNoteLabel(view.state)).toBe('cell-3')
    expect(made(view)).toEqual([])
    expect(alt(crepe, 'ArrowUp')).toBe(true)
    expect(made(view)).toEqual(['cell-4'])
    expect(caretText(view)).toBe('')
    expect(pressKey(crepe, 'Escape')).toBe(true)
    expect(openCellNoteLabel(view.state)).toBeNull()
    expect(saved(crepe)).toBe(before)
    expect(caretText(view)).toBe('read')
  })
})

describe('where it opens, and how it closes (D, A9, A10)', () => {
  it('"All notes opens at": the cell you came from (the caret stays), or now (now\'s note live)', async () => {
    const first = await openAll(1)
    expect(caretText(first.view)).toBe('warm up')
    setAllNotesOpensAt('now')
    const second = await openAll(1)
    expect(openCellNoteLabel(second.view.state)).toBe('cell-3')
    expect(blocks(second.root)).toContain('7:00 am (now, live): email / calls')
  })

  it('A6: "All notes of a calendar table" has no key by default; given one, it opens from a cell with no note, and again goes back to the card', async () => {
    expect(NOTE_KEYS.find((row) => row.id === 'note.allCellNotes')?.keys).toEqual([])
    const { crepe, root, view } = await mount(DAY, { hotkeys: { 'note.allCellNotes': 'CmdOrCtrl+Alt+A' } })
    caretIn(view, 'read')
    expect(altMod(crepe, 'a')).toBe(true)
    expect(head(root)).not.toBeNull()
    expect(cellNoteCardKey.getState(view.state)?.calendar).not.toBeNull()
    expect(blocks(root)[1]).toBe('6:30 am (past, live): ')
    expect(altMod(crepe, 'a')).toBe(true)
    expect(cellNoteCardKey.getState(view.state)?.calendar ?? null).toBeNull()
    expect(openCellNoteLabel(view.state)).not.toBeNull()
    expect(head(root)).toBeNull()
  })

  it('A10: a whole-note rebuild (the file read again) closes the card cleanly', async () => {
    const { crepe, root, view } = await openAll()
    setMarkdown(crepe, DAY)
    expect(openCellNoteLabel(view.state)).toBeNull()
    expect(card(root)).toBeNull()
    expect(head(root)).toBeNull()
    expect(root.querySelectorAll('.cell-note-time')).toHaveLength(0)
  })

  it('its table stops being a calendar table: the card closes, and the empty note it made goes with its mark (A9)', async () => {
    const { crepe, root, view } = await openAll()
    const before = saved(crepe)
    click(empties(root)[0]!)
    let table = -1
    view.state.doc.descendants((node, pos) => {
      if (table < 0 && node.type.name === 'table') table = pos
      return table < 0
    })
    view.dispatch(view.state.tr.setNodeMarkup(table, undefined, { ...view.state.doc.nodeAt(table)!.attrs, calendar: 0 }))
    expect(cellNoteCardKey.getState(view.state)?.calendar ?? null).toBeNull()
    expect(head(root)).toBeNull()
    expect(saved(crepe)).toBe(before.replace('<!-- table: calendar 30m -->', '').replace(/\n{3,}/g, '\n\n'))
  })

  it('a table that is no calendar table keeps the read-only list of every note (D4)', async () => {
    const { root, view } = await mount(PLAIN)
    openCellNote(view, cellPos(view, 1, 1))
    click(root.querySelector('.cell-note-card__all-toggle')!)
    expect(head(root)).toBeNull()
    expect(root.querySelector(`.${CELL_NOTE_OPEN_CLASS}.cell-note--all`)).not.toBeNull()
    expect(root.querySelector(`.${CELL_NOTE_CALENDAR_CLASS}`)).toBeNull()
  })
})

describe('one ⌘Z after a click on an empty block (A8, YAZ-4409)', () => {
  it('the note and its mark go; All notes stays open on the block that was live before, the caret in it', async () => {
    const { root, view } = await openAll()
    expect(openCellNoteLabel(view.state)).toBe('cell-1')
    click(empties(root)[0]!)
    expect(openCellNoteLabel(view.state)).toBe('cell-4')
    undo(view.state, view.dispatch)
    expect(cellNoteCardKey.getState(view.state)?.calendar).not.toBeNull()
    expect(openCellNoteLabel(view.state)).toBe('cell-1')
    expect(card(root)!.contains(view.domAtPos(view.state.selection.head).node)).toBe(true)
  })
})

describe('the card\'s place and height (YAZ-4410, YAZ-4411)', () => {
  /**
   * jsdom has no layout: the visible area is 0 to the window's 768 px (the scroller's 800 px, cut by the window), the
   * editor's box from 0, the cell at `cellTop`. A note's
   * content is 60 px, or 780 px in All notes; like a real box, it measures at least the height the card is set to.
   */
  async function stubbed(cellTop: number) {
    const mounted = await mount(DAY)
    const { root, view } = mounted
    const host = view.dom.parentElement!
    root.style.overflowY = 'auto'
    root.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 800)
    host.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 800)
    Object.defineProperty(host, 'offsetWidth', { value: 1000 })
    const set = () => parseFloat(host.style.getPropertyValue('--cell-note-card-height')) || 0
    for (const note of view.dom.querySelectorAll<HTMLElement>('.cell-note')) {
      Object.defineProperty(note, 'offsetParent', { value: host })
      Object.defineProperty(note, 'offsetWidth', { value: 340 })
      Object.defineProperty(note, 'offsetHeight', { value: 50 })
      Object.defineProperty(note, 'clientHeight', { value: 50 })
      Object.defineProperty(note, 'scrollHeight', { get: () => Math.max(note.classList.contains(CELL_NOTE_CALENDAR_CLASS) ? 780 : 60, set()) })
    }
    for (const row of [1, 2, 3]) (view.nodeDOM(cellPos(view, row, 1)) as HTMLElement).getBoundingClientRect = () => new DOMRect(300, cellTop + (row - 1) * 30, 200, 30)
    const vars = () => ({ top: host.style.getPropertyValue('--cell-note-card-top'), cap: host.style.getPropertyValue('--cell-note-card-max-height'), height: host.style.getPropertyValue('--cell-note-card-height') })
    return { ...mounted, vars }
  }
  const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

  it('opened from a cell low in the window, the card moves up to keep its least height in view; from a high cell it stays under it, as tall as the area below', async () => {
    const low = await stubbed(700)
    openCellNote(low.view, cellPos(low.view, 1, 1))
    click(low.root.querySelector('.cell-note-card__all-toggle')!)
    await frame()
    expect(low.vars()).toMatchObject({ top: `${window.innerHeight - 360}px`, cap: '360px' })
    await unmountAll()
    const high = await stubbed(30)
    openCellNote(high.view, cellPos(high.view, 1, 1))
    click(high.root.querySelector('.cell-note-card__all-toggle')!)
    await frame()
    expect(high.vars()).toMatchObject({ top: '64px', cap: `${window.innerHeight - 64}px` })
  })

  it('All notes fits its own list; back in a plain card, and in the next note\'s, the height is the plain note\'s again', async () => {
    const { root, view, vars } = await stubbed(30)
    openCellNote(view, cellPos(view, 1, 1))
    expect(vars().height).toBe('60px')
    click(root.querySelector('.cell-note-card__all-toggle')!)
    await frame()
    expect(vars().height).toBe('780px')
    click(root.querySelector('.cell-note-card__all-toggle')!)
    await frame()
    await frame()
    expect(vars().height).toBe('60px')
    openCellNote(view, cellPos(view, 3, 1))
    await frame()
    expect(vars().height).toBe('60px')
  })
})

