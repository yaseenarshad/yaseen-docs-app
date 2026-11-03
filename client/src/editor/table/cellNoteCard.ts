/**
 * The cell note card (the YAZ-3818 demo, replaces the note page of D9): the open cell note is drawn as a small card just
 * under its cell, right-aligned to it, in the SAME editor. The card is the note's own `cell_note` block (a normal block
 * of the doc, right under the table), shown with `cell-note--open` and placed `position: absolute` (table.css). Nothing
 * else on the page hides or moves, and the page's zoom level stays. The card's head is a widget: "Note: <column> ·
 * <row>" and an × ("Close cell note").
 *
 * Open (`openCellNote`): a click on a cell's corner triangle, "Add cell note" (button and table menu), "Open cell note"
 * (table menu), ⌘. on a plain cell line (`zoom.ts`). A cell with no note gets one first. The caret goes to the end of
 * the note. Opening another note closes this one.
 * Close (`closeCellNote`): Esc with the caret in the card (priority 90: the `[[` picker's Esc at 100 wins, the Esc to
 * the sidebar at 10 loses), the ×, a mousedown outside the card (not on its own cell's corner) unless the card is
 * pinned (its pin, one for the editor, round 2 of the demo). The caret goes back after the mark in the cell, and
 * an empty note goes with its mark (D15), never in a read-only note.
 * Inside: ArrowUp on the card's first line and ArrowDown on its last line stay in the card, and a mouse selection that
 * starts in it does not leave it.
 *
 * The head also steps to the previous and the next note (‹ "2 of 5" ›, round 2 of the demo), in the order of their
 * marks in the tables (`cellNoteOrder`), with no wrap; and while a card is open its cell has a ring
 * (`CELL_NOTE_CELL_OPEN_CLASS`, a node decoration of this state).
 *
 * Moved by its head and resized by its edges and corners (round 2 of the demo): ONE card for the editor. Until the
 * reader moves or resizes it, it opens under the cell of the note it shows; then it is "placed", a floating panel that
 * keeps its spot in the visible editor area and its size for every note, until a double click on its head (`cardView`).
 * Its height only grows (round 3): a shorter note keeps the height; only a resize makes it smaller.
 * A placed card stays inside the visible editor area: clamped on every placement. A card under its cell is not clamped
 * (change AQ of the demo): it scrolls with the page and goes out of view with its cell.
 *
 * The state is meta-only (`cellNoteCardKey`, cellNotes.ts): a typed key only maps it. The card's place is set as two
 * custom properties on the editor's `.milkdown` box (outside the editable DOM, so ProseMirror's DOM observer never
 * sees it): on open, after a doc change, a scroll, a window resize, a drag and a resize, and only while a card is open.
 */
import { parserCtx, serializerCtx } from '@milkdown/kit/core'
import { Fragment, type Node as ProseNode } from '@milkdown/kit/prose/model'
import { type Command, type EditorState, Plugin, Selection, TextSelection, type Transaction } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { $prose, $shortcut } from '@milkdown/kit/utils'
import { rowShortcuts } from '../noteKeys'
import { cellPosAround } from '../outline/listNodes'
import { cellBlocksOf } from './cellBlocks'
import { cellNotePreviewLines } from './cellNotePreview'
import {
  addCellNote,
  cellNoteCardKey,
  type CellNoteCardState,
  cellNoteCornerAt,
  cellNoteNameParts,
  cellNoteOf,
  cellNoteTitle,
  insertCellNote,
  isCellNote,
  isCellNoteMark,
  isEmptyCellNote,
  markPosOf,
  notePosOf,
  removeCellNote,
  setCellNoteTemplateJson,
  tableAround,
  touchesNotes,
} from './cellNotes'

/** The class of the open cell note: table.css draws it as the card. */
export const CELL_NOTE_OPEN_CLASS = 'cell-note--open'

/** The class of the cell whose note is open: table.css rings it (round 2 of the demo). */
export const CELL_NOTE_CELL_OPEN_CLASS = 'cell-note-cell--open'

/**
 * The labels of the cell notes of `doc` that the previous and next buttons step through: each mark in a table cell
 * whose note is there, in document order (table by table, row by row, left to right), each label once.
 */
export function cellNoteOrder(doc: ProseNode): string[] {
  const marks: string[] = []
  const notes = new Set<string>()
  doc.descendants((node, pos) => {
    const label = node.attrs.label as string
    if (isCellNote(node)) notes.add(label)
    else if (isCellNoteMark(node) && !marks.includes(label) && cellPosAround(doc.resolve(pos)) !== null) marks.push(label)
    return true
  })
  return marks.filter((label) => notes.has(label))
}

const CLOSED: CellNoteCardState = { label: null, pos: null, cell: null, all: false, set: DecorationSet.empty }

/** The class of the open note's card in "All notes" (round 4 of the demo): table.css hides the note, shows the list. */
export const CELL_NOTE_ALL_CLASS = 'cell-note--all'

/** A link in the "All notes" list as the note shows it: `[[a|b]]` as "b", `[[a]]` as "a". */
const plainLinks = (text: string): string => text.replace(/\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_m, page: string, alias?: string) => alias ?? page)

/** Each editor's Markdown serializer (its own schema), for "Copy all". */
const serializers = new WeakMap<EditorView, (doc: ProseNode) => string>()

/** Every cell note of the page, in `cellNoteOrder`: its label, position and "<column> · <row>". */
const allNotes = (doc: ProseNode): Array<{ label: string; pos: number; name: string }> =>
  cellNoteOrder(doc).map((label) => {
    const { column, row } = cellNoteNameParts(doc, label)
    return { label, pos: notePosOf(doc, label)!, name: [column, row].map((text) => text.trim()).filter((text) => text !== '').join(' · ') || 'Note' }
  })

/** "Copy all": each note as `### <column> · <row>`, then its Markdown. */
function allNotesMarkdown(view: EditorView): string {
  const serialize = serializers.get(view)
  const { doc } = view.state
  return allNotes(doc)
    .map(({ pos, name }) => {
      const note = doc.nodeAt(pos)!
      const body = serialize === undefined ? note.textBetween(0, note.content.size, '\n') : serialize(doc.type.create(null, note.content)).trim()
      return `### ${name}\n\n${body}`
    })
    .join('\n\n')
}

/**
 * The "All notes" list (round 4 of the demo): every cell note of the page as one read-only document, each under its
 * "<column> · <row>" header, its lines as the preview draws them. A click on a header opens that note, editable.
 */
const allList = (view: EditorView) => {
  const list = document.createElement('div')
  list.className = 'cell-note-card__all'
  list.contentEditable = 'false'
  const { doc } = view.state
  for (const { label, pos, name } of allNotes(doc)) {
    const header = document.createElement('button')
    header.type = 'button'
    header.className = 'cell-note-card__all-header'
    header.textContent = name
    header.title = 'Open this cell note'
    header.addEventListener('mousedown', (event) => event.preventDefault())
    header.addEventListener('click', (event) => {
      event.preventDefault()
      openCellNoteByLabel(view, label)
    })
    list.appendChild(header)
    for (const text of cellNotePreviewLines(doc.nodeAt(pos)!, Number.POSITIVE_INFINITY)) {
      const line = document.createElement('div')
      line.className = 'cell-note-card__all-line'
      line.textContent = plainLinks(text)
      list.appendChild(line)
    }
  }
  return list
}

/** Turn "All notes" on or off (round 4 of the demo); off goes back to the last note. */
export function setAllCellNotes(view: EditorView, all: boolean): void {
  if (openLabel(view.state) !== null) view.dispatch(view.state.tr.setMeta(cellNoteCardKey, { all }))
}

/** How many "All notes" lists were built: each build draws a new one. */
let allBuilds = 0

/** Each editor's card controls (`cardView`): the head's drag, its double click and its pin call them. */
const controls = new WeakMap<EditorView, { drag: (event: MouseEvent) => void; reset: () => void; pinned: () => boolean; togglePin: () => boolean }>()

const ALL_ICON =
  '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M3 4h10M3 8h10M3 12h10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>'

const PIN_ICON =
  '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M6 2h4l-.6 4.2L12 9H4l2.6-2.8z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M8 9v5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>'

/** The pin's look and words for `pinned`. */
const showPin = (button: HTMLButtonElement, pinned: boolean) => {
  const name = pinned ? 'Unpin cell note' : 'Pin cell note'
  button.title = name
  button.setAttribute('aria-label', name)
  button.setAttribute('aria-pressed', String(pinned))
}

/** The longest Back list a card keeps. */
const HISTORY_MAX = 50

/**
 * Each editor's Back list of the notes its card showed (round 3 of the demo), as the app's Back and Forward: in the
 * order they were opened, by any route but Back and Forward themselves; an open after a Back drops what was ahead.
 */
const histories = new WeakMap<EditorView, { notes: string[]; at: number }>()

/** `label` opened in `view`'s card: a step in its Back list. */
function recordVisit(view: EditorView, label: string): void {
  const history = histories.get(view) ?? { notes: [], at: -1 }
  histories.set(view, history)
  if (history.notes[history.at] === label) return
  history.notes = [...history.notes.slice(0, history.at + 1), label].slice(-HISTORY_MAX)
  history.at = history.notes.length - 1
}

/** The nearest step of the Back list behind (`dir` -1) or ahead (1) whose note is still there, with its cell; or null. */
function historyStep(view: EditorView, dir: -1 | 1): { at: number; cell: number } | null {
  const history = histories.get(view)
  if (history === undefined) return null
  const { doc } = view.state
  const open = cellNoteCardKey.getState(view.state)?.label ?? null
  for (let at = history.at + dir; at >= 0 && at < history.notes.length; at += dir) {
    const label = history.notes[at]!
    if (label === open) continue
    const mark = notePosOf(doc, label) === null ? null : markPosOf(doc, label)
    const cell = mark === null ? null : cellPosAround(doc.resolve(mark))
    if (cell !== null) return { at, cell }
  }
  return null
}

/** Back (`dir` -1) or Forward (1) through the notes the card showed: no new step; the cell scrolls into view. */
export function goCellNoteHistory(view: EditorView, dir: -1 | 1): boolean {
  const step = historyStep(view, dir)
  const history = histories.get(view)
  if (step === null || history === undefined) return false
  if (!openCellNote(view, step.cell, true, () => (history.at = step.at))) return false
  return true
}

/** The app's Back and Forward arrows, drawn as the tab bar's buttons are (1.2 stroke, 14px). */
const arrowIcon = (d: string) =>
  `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`

/** A head button: it keeps the focus and the selection, and runs `run` on a click. */
const headButton = (className: string, text: string, name: string, run: () => void, disabled = false): HTMLButtonElement => {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = className
  button.textContent = text
  button.title = name
  button.setAttribute('aria-label', name)
  button.disabled = disabled
  button.addEventListener('mousedown', (event) => event.preventDefault())
  button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    run()
  })
  return button
}

/**
 * The card's head: its title, the previous and next buttons around "<index> of <total>" (`index` from 1; 0 when the
 * note is in no order), and the × that closes it. A drag of the head moves the card; a double click puts it back.
 */
const cardHead = (title: string, index: number, total: number, all: boolean) => (view: EditorView) => {
  const head = document.createElement('div')
  head.className = 'cell-note-card__head'
  head.contentEditable = 'false'
  const onClose = (event: Event) => event.target instanceof Element && event.target.closest('button') !== null
  head.addEventListener('mousedown', (event) => {
    if (event.button !== 0 || onClose(event)) return
    // The selection stays where it is: no caret moves, no text selects.
    event.preventDefault()
    controls.get(view)?.drag(event)
  })
  head.addEventListener('dblclick', (event) => {
    if (onClose(event)) return
    event.preventDefault()
    controls.get(view)?.reset()
  })
  // Back and Forward through the notes this card showed (round 3 of the demo), before the title.
  const back = headButton('cell-note-card__step cell-note-card__history', '', 'Back', () => goCellNoteHistory(view, -1), historyStep(view, -1) === null)
  back.innerHTML = arrowIcon('M13 8H3M7 4 3 8l4 4')
  const forward = headButton('cell-note-card__step cell-note-card__history', '', 'Forward', () => goCellNoteHistory(view, 1), historyStep(view, 1) === null)
  forward.innerHTML = arrowIcon('M3 8h10M9 4l4 4-4 4')
  const name = document.createElement('span')
  name.className = 'cell-note-card__title'
  name.textContent = title
  // The pin (round 2 of the demo): pinned, a click outside the card does not close it. One for the editor.
  const pin = headButton('cell-note-card__pin', '', 'Pin cell note', () => showPin(pin, controls.get(view)?.togglePin() ?? false))
  pin.innerHTML = PIN_ICON
  showPin(pin, controls.get(view)?.pinned() ?? false)
  const previous = headButton('cell-note-card__step', '‹', 'Previous cell note', () => stepCellNote(view, -1), index <= 1)
  const count = document.createElement('span')
  count.className = 'cell-note-card__count'
  count.textContent = index === 0 ? '' : `${index} of ${total}`
  const next = headButton('cell-note-card__step', '›', 'Next cell note', () => stepCellNote(view, 1), index === 0 || index >= total)
  const close = headButton('cell-note-card__close', '×', 'Close cell note', () => closeCellNote(view))
  // "All notes" (round 4 of the demo): every note of the page, read-only; and, there, "Copy all".
  const allButton = headButton('cell-note-card__all-toggle', '', all ? 'Back to this cell note' : 'All cell notes', () => setAllCellNotes(view, !all))
  allButton.innerHTML = ALL_ICON
  allButton.setAttribute('aria-pressed', String(all))
  const copy = headButton('cell-note-card__copy', 'Copy all', 'Copy all cell notes as Markdown', () => void navigator.clipboard?.writeText(allNotesMarkdown(view)))
  head.append(back, forward, name, ...(all ? [copy] : []), allButton, pin, previous, count, next, close)
  return head
}

/**
 * Open the previous (`dir` -1) or the next (1) cell note of `cellNoteOrder` as a card, after the open one (round 2
 * of the demo): the open card closes as always (an empty note goes), and the new note's cell scrolls into view. Declines
 * at the first or the last note.
 */
export function stepCellNote(view: EditorView, dir: -1 | 1): boolean {
  const label = cellNoteCardKey.getState(view.state)?.label ?? null
  if (label === null) return false
  const order = cellNoteOrder(view.state.doc)
  const target = order[order.indexOf(label) + dir]
  const mark = target === undefined ? null : markPosOf(view.state.doc, target)
  const cell = mark === null ? null : cellPosAround(view.state.doc.resolve(mark))
  if (cell === null || !openCellNote(view, cell)) return false
  return true
}

/** The card's state for the note labelled `label` in `doc`: closed when no such note is there. */
function cardState(doc: ProseNode, label: string | null, all = false): CellNoteCardState {
  const pos = label === null ? null : notePosOf(doc, label)
  if (label === null || pos === null) return CLOSED
  const mark = markPosOf(doc, label)
  const cell = mark === null ? null : cellPosAround(doc.resolve(mark))
  const note = doc.nodeAt(pos)!
  const order = cellNoteOrder(doc)
  const title = all ? `All cell notes (${order.length})` : cellNoteTitle(doc, label)
  const index = order.indexOf(label) + 1
  const set = DecorationSet.create(doc, [
    Decoration.node(pos, pos + note.nodeSize, { class: all ? `${CELL_NOTE_OPEN_CLASS} ${CELL_NOTE_ALL_CLASS}` : CELL_NOTE_OPEN_CLASS }),
    Decoration.widget(pos + 1, cardHead(title, index, order.length, all), { side: -2, key: `cell-note-card:${label}:${title}:${index}:${order.length}:${all}`, ignoreSelection: true, stopEvent: () => true }),
    ...(all ? [Decoration.widget(pos + 1, allList, { side: -1, key: `cell-note-all:${++allBuilds}`, ignoreSelection: true, stopEvent: () => true })] : []),
    ...(cell === null ? [] : [Decoration.node(cell, cell + doc.nodeAt(cell)!.nodeSize, { class: CELL_NOTE_CELL_OPEN_CLASS })]),
  ])
  return { label, pos, cell, all, set }
}

/**
 * Can `openCellNote` open the cell at `cellPos`? An editable note always can (it makes the note); a read-only one only
 * when the cell's mark has its cell note (5A-22).
 */
export function canOpenCellNote(view: EditorView, cellPos: number): boolean {
  const label = cellNoteOf(view.state.doc, cellPos)
  return view.editable || (label !== null && notePosOf(view.state.doc, label) !== null)
}

/**
 * Close the open card. The caret goes back after the mark (unless `moveCaret` is false: find's own close), and an
 * empty note goes with its mark in an editable note (D15). Returns the transaction it sent, or null when none was open.
 */
export function closeCellNote(view: EditorView, moveCaret = true): Transaction | null {
  const { state } = view
  const label = cellNoteCardKey.getState(state)?.label ?? null
  if (label === null) return null
  const tr = state.tr.setMeta(cellNoteCardKey, null)
  const pos = notePosOf(state.doc, label)
  const mark = markPosOf(state.doc, label)
  if (view.editable && pos !== null && isEmptyCellNote(state.doc.nodeAt(pos)!)) removeCellNote(tr, label)
  if (moveCaret && mark !== null) tr.setSelection(Selection.near(tr.doc.resolve(tr.mapping.map(mark + 1)), -1))
  view.dispatch(tr)
  return tr
}

/**
 * Open the cell note of the cell at `cellPos` as a card (D8): a cell with no mark gets a cell note first
 * (`addCellNote`); a mark with no cell note gets an empty one under its table. The note is found by its label, as
 * `notesFollowTables` may move it. A read-only note only opens a cell note that is there. With `moveCaret` (all but
 * find), the caret goes to the end of the note (of a new note's first line) and the editor takes the focus. `visit`
 * records the open in the card's Back list (Back and Forward move in it instead).
 */
export function openCellNote(view: EditorView, cellPos: number, moveCaret = true, visit: (label: string) => void = (label) => recordVisit(view, label)): boolean {
  if (!canOpenCellNote(view, cellPos)) return false
  const open = cellNoteCardKey.getState(view.state)?.label ?? null
  if (open !== null && open !== cellNoteOf(view.state.doc, cellPos)) {
    const closed = closeCellNote(view, false)
    if (closed !== null) cellPos = closed.mapping.map(cellPos)
  }
  let label = cellNoteOf(view.state.doc, cellPos)
  // A new note starts with the template (round 3 of the demo), the caret at the end of its first line.
  const made = label === null
  if (label === null) {
    if (!addCellNote(cellPos, templateBlocks(view))(view.state, view.dispatch)) return false
    label = cellNoteOf(view.state.doc, cellPos)!
  }
  if (notePosOf(view.state.doc, label) === null) {
    view.dispatch(view.state.tr.insert(tableAround(view.state.doc, cellPos).end, view.state.schema.nodes.cell_note.createAndFill({ label })!))
  }
  const pos = notePosOf(view.state.doc, label)
  if (pos === null) return false
  const tr = view.state.tr.setMeta(cellNoteCardKey, label)
  if (moveCaret) {
    const first = made ? Selection.findFrom(tr.doc.resolve(pos + 1), 1, true) : null
    const caret = first === null ? Selection.near(tr.doc.resolve(pos + tr.doc.nodeAt(pos)!.nodeSize - 1), -1) : TextSelection.create(tr.doc, first.$head.end())
    // No `scrollIntoView` (round 4 of the demo): ProseMirror would scroll the page to the caret's place in the note
    // under the table, a big jump. The page moves only to show the cell (`revealOpenCell`), the card only to the caret.
    tr.setSelection(caret)
  }
  // The Back list first: the card's head reads it as it is drawn.
  visit(label)
  view.dispatch(tr)
  if (moveCaret) {
    view.focus()
    revealOpenCell(view)
    const caret = view.coordsAtPos(view.state.selection.head)
    showInCard(view, { top: caret.top, bottom: caret.bottom })
  }
  return true
}

/**
 * The open note's cell in view (round 4 of the demo): no scroll when the cell shows whole, else the least scroll of the
 * page's scroller that shows it, at the nearest edge; never centred.
 */
export function revealOpenCell(view: EditorView): void {
  const card = cellNoteCardKey.getState(view.state)
  const cell = card?.cell == null ? null : (view.nodeDOM(card.cell) as HTMLElement | null)
  if (cell == null || typeof cell.getBoundingClientRect !== 'function') return
  const scroller = scrollerOf(view)
  const rect = cell.getBoundingClientRect()
  const area = scroller === null ? { top: 0, bottom: window.innerHeight } : scroller.getBoundingClientRect()
  const dy = rect.top < area.top ? rect.top - area.top : rect.bottom > area.bottom ? Math.min(rect.bottom - area.bottom, rect.top - area.top) : 0
  if (dy === 0) return
  if (scroller === null) window.scrollBy?.(0, dy)
  else scroller.scrollTop += dy
}

/** Scroll the open card itself, the least, so the window rows `box` show in it: never the page. */
export function showInCard(view: EditorView, box: { top: number; bottom: number }): void {
  const card = cellNoteCardKey.getState(view.state)
  const note = card?.pos == null ? null : (view.nodeDOM(card.pos) as HTMLElement | null)
  if (note == null || note.scrollHeight <= note.clientHeight) return
  const head = note.querySelector('.cell-note-card__head')?.getBoundingClientRect().height ?? 0
  const rect = note.getBoundingClientRect()
  const top = rect.top + head
  if (box.top < top) note.scrollTop -= top - box.top
  else if (box.bottom > rect.bottom) note.scrollTop += box.bottom - rect.bottom
}

/** Each editor's card memory: the placed spot, the width, the height only grows, and the pin (see `cardView`). */
interface CardMemory {
  /** The placed card's spot, from the visible area's top-left corner in window px; null while it opens under its cell. */
  placed: { x: number; y: number } | null
  /** The card's width from a resize, in layout px; null for the default. */
  width: number | null
  /**
   * The card's height, in layout px (round 3 of the demo): it only grows. More content grows it at once, less content
   * leaves it (the room stays empty), and only a resize makes it smaller. Null until the first placement fits it.
   */
  height: number | null
  /** The content's height at the last placement: growth after a resize that cut the content off is counted from it. */
  lastContent: number | null
  /** Pinned: a mousedown outside the card does not close it. One for the editor, across notes; starts as the setting says. */
  pinned: boolean
}
const memories = new WeakMap<EditorView, CardMemory>()

/** Settings › Editor › Cell notes › Keep cell notes open (round 3 of the demo): a new tab's card starts pinned. App sets it. */
let pinnedAtStart = true

/** Set whether a new tab's card starts pinned: App, when the setting changes. An open tab's card keeps its pin. */
export function setCellNotePinnedAtStart(on: boolean): void {
  pinnedAtStart = on
}

/** The new cell note template (Settings › Editor › Tables › New cell note starts with), as Markdown; App sets it. */
let template = ''

/** Set the new cell note template (round 3 of the demo): App, when the setting changes. */
export function setCellNoteTemplate(markdown: string): void {
  template = markdown
  setCellNoteTemplateJson(null)
}

/** Each editor's Markdown parser (its own schema), for the template. */
const parsers = new WeakMap<EditorView, (markdown: string) => ProseNode>()

/**
 * The template's blocks in `view`'s schema: lines and lists only, anything else as lines (`cellBlocksOf`, D1). None
 * for an empty template or one that makes no cell note. Keeps the template's shape (`setCellNoteTemplateJson`), so a
 * note left as the template counts as empty (D15).
 */
function templateBlocks(view: EditorView): ProseNode[] | undefined {
  const parse = parsers.get(view)
  if (template.trim() === '' || parse === undefined) return undefined
  const blocks = cellBlocksOf(parse(template).children, view.state.schema)
  const note = view.state.schema.nodes.cell_note.createAndFill({ label: '' }, blocks)
  if (note === null || note.content.size === 0) return undefined
  setCellNoteTemplateJson(JSON.stringify(note.content.toJSON()))
  return [...note.children]
}

/** `content` without its cell note marks: what moves out of a cell, whose mark stays in it. */
const withoutMarks = (content: Fragment): Fragment => {
  const kept: ProseNode[] = []
  content.forEach((node) => {
    if (!isCellNoteMark(node)) kept.push(node.isLeaf ? node : node.copy(withoutMarks(node.content)))
  })
  return Fragment.from(kept)
}

/** Can "Move to cell note" move the cell at `cellPos`? An editable note, and a cell with some text (the demo). */
export const canMoveToCellNote = (view: EditorView, cellPos: number): boolean => view.editable && (view.state.doc.nodeAt(cellPos)?.textContent.trim() ?? '') !== ''

/**
 * "Move to cell note" (round 4 of the demo; the whole cell since its next round): every line and bullet of the cell
 * goes to its cell note, at the end of the note it has, or as a new note (no template); the cell keeps one empty line
 * and its mark. A header cell is the same: its one line moves. One undo step; then the card opens on it.
 */
export function moveToCellNote(view: EditorView, cellPos: number): boolean {
  if (!canMoveToCellNote(view, cellPos)) return false
  const { schema } = view.state
  const cell = view.state.doc.nodeAt(cellPos)!
  const label = cellNoteOf(view.state.doc, cellPos)
  const move = [...withoutMarks(cell.content).content]
  const line = schema.nodes.paragraph.create(null, label === null ? null : schema.nodes.footnote_reference.create({ label }))
  const tr = view.state.tr.replaceWith(cellPos + 1, cellPos + cell.nodeSize - 1, line)
  const pos = label === null ? null : notePosOf(tr.doc, label)
  if (pos !== null) tr.insert(pos + tr.doc.nodeAt(pos)!.nodeSize - 1, move)
  else if (label !== null) tr.insert(tableAround(tr.doc, cellPos).end, schema.nodes.cell_note.create({ label }, move))
  else insertCellNote(tr, cellPos, move)
  view.dispatch(tr)
  return openCellNote(view, cellPos)
}

/** Open the card of the cell note `label` (a Linked mentions line, `cellNoteRequest.ts`), its cell in view. */
export function openCellNoteByLabel(view: EditorView, label: string): boolean {
  const mark = notePosOf(view.state.doc, label) === null ? null : markPosOf(view.state.doc, label)
  const cell = mark === null ? null : cellPosAround(view.state.doc.resolve(mark))
  if (cell === null || !openCellNote(view, cell)) return false
  return true
}

/** The first (`dir` -1) or last (1) caret place of the open note, or null. */
const cardEdge = (state: EditorState, dir: -1 | 1): Selection | null => {
  const card = cellNoteCardKey.getState(state)
  if (card?.pos == null) return null
  const end = card.pos + state.doc.nodeAt(card.pos)!.nodeSize - 1
  return Selection.findFrom(state.doc.resolve(dir < 0 ? card.pos + 1 : end), -dir, true)
}

/** "All notes" is on and the caret is in the open (hidden) note: a key must not write there. */
const readOnlyAll = (state: EditorState): boolean => cellNoteCardKey.getState(state)?.all === true && inCard(state, state.selection.head)

/** Is `pos` inside the open note? */
const inCard = (state: EditorState, pos: number): boolean => {
  const card = cellNoteCardKey.getState(state)
  return card?.pos != null && pos > card.pos && pos < card.pos + state.doc.nodeAt(card.pos)!.nodeSize
}

/** ArrowUp on the card's first line, ArrowDown on its last: to that line's start or end, not out of the card. */
const stayInCard =
  (dir: -1 | 1, extend: boolean): Command =>
  (state, dispatch, view) => {
    const { selection } = state
    if (view === undefined || !inCard(state, selection.head) || !view.endOfTextblock(dir < 0 ? 'up' : 'down')) return false
    const edge = cardEdge(state, dir)
    if (edge === null || edge.$head.start() !== selection.$head.start()) return false
    dispatch?.(state.tr.setSelection(extend ? TextSelection.create(state.doc, selection.anchor, edge.head) : edge))
    return true
  }

/**
 * ⌘A in the card selects the note's text, from the start of its first line to the end of its last (round 3 of the
 * demo): never the page. Again, the same. Elsewhere ⌘A keeps its own work.
 */
const selectCard: Command = (state, dispatch, view) => {
  const { from, to } = state.selection
  if (!inCard(state, from) || !inCard(state, to)) return false
  // "All notes" (round 4 of the demo): the list, as the page's own selection (ProseMirror leaves a widget's alone).
  if (cellNoteCardKey.getState(state)?.all === true) {
    const list = view?.dom.querySelector('.cell-note-card__all')
    if (list != null && dispatch !== undefined) window.getSelection()?.selectAllChildren(list)
    return list != null
  }
  const first = cardEdge(state, -1)
  const last = cardEdge(state, 1)
  if (first === null || last === null) return false
  dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, first.head, last.head)))
  return true
}

/**
 * ⌘A in a plain table cell selects that cell's text, all its lines and bullets, as Google Sheets does while a cell is
 * edited (round 3 of the demo); a second ⌘A, on just that, is the page's own select all. A TextSelection inside one
 * cell: prosemirror-tables keeps it one (no cell selection), so copy, cut, Delete and typing stay in the cell.
 */
const selectCell: Command = (state, dispatch) => {
  const { $from, $to, from, to } = state.selection
  const cell = cellPosAround($from)
  if (cell === null || cellPosAround($to) !== cell) return false
  const end = cell + state.doc.nodeAt(cell)!.nodeSize - 1
  const first = Selection.findFrom(state.doc.resolve(cell + 1), 1, true)
  const last = Selection.findFrom(state.doc.resolve(end), -1, true)
  if (first === null || last === null || (from === first.head && to === last.head)) return false
  dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, first.head, last.head)))
  return true
}

/** Esc closes the open card while the caret is in it; elsewhere Esc keeps its own work (round 2 of the demo). */
const closeCard: Command = (state, dispatch, view) => {
  if (openLabel(state) === null || view === undefined || !inCard(state, state.selection.head)) return false
  if (dispatch) closeCellNote(view)
  return true
}

const openLabel = (state: EditorState): string | null => cellNoteCardKey.getState(state)?.label ?? null

/** The nearest ancestor of the editor that scrolls, or null for the window. */
const scrollerOf = (view: EditorView): HTMLElement | null => {
  for (let el = view.dom.parentElement; el !== null; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el)
    if (overflowY === 'auto' || overflowY === 'scroll') return el
  }
  return null
}

/** The visible editor area in the window: the scroller's box, inside the window. */
const visibleBox = (scroller: HTMLElement | null): { left: number; top: number; right: number; bottom: number } => {
  if (scroller === null) return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
  const box = scroller.getBoundingClientRect()
  return { left: Math.max(0, box.left), top: Math.max(0, box.top), right: Math.min(window.innerWidth, box.right), bottom: Math.min(window.innerHeight, box.bottom) }
}

/** The smallest card a resize leaves, in px. */
const MIN_WIDTH = 240
const MIN_HEIGHT = 120

/** The eight resize grips: an edge or a corner, its sides (-1 left/top, 1 right/bottom) and its cursor. */
const GRIPS: ReadonlyArray<{ name: string; x: -1 | 0 | 1; y: -1 | 0 | 1; cursor: string }> = [
  { name: 'n', x: 0, y: -1, cursor: 'ns-resize' },
  { name: 's', x: 0, y: 1, cursor: 'ns-resize' },
  { name: 'e', x: 1, y: 0, cursor: 'ew-resize' },
  { name: 'w', x: -1, y: 0, cursor: 'ew-resize' },
  { name: 'nw', x: -1, y: -1, cursor: 'nwse-resize' },
  { name: 'se', x: 1, y: 1, cursor: 'nwse-resize' },
  { name: 'ne', x: 1, y: -1, cursor: 'nesw-resize' },
  { name: 'sw', x: -1, y: 1, cursor: 'nesw-resize' },
]

/**
 * One editor's card: its placement, its drag and resize, and its outside-mousedown close, live only while a card is
 * open. ONE card for the editor (round 2 of the demo): until the reader drags or resizes it, it opens under the cell
 * of the note it shows; once moved or resized it is "placed", and keeps that spot in the visible editor area (as a
 * floating panel: it stays put while the page scrolls) and that size for every note it shows, until a double click
 * on its head. In memory for this editor's life: never in the file or the settings.
 */
function cardView(view: EditorView) {
  const host = view.dom.parentElement!
  let frameId = 0
  let listening = false
  // The card's spot, size and pin, kept per editor (`memories`): a rebuilt state (a reload from disk) keeps them.
  const memory = memories.get(view) ?? { placed: null, width: null, height: null, lastContent: null, pinned: pinnedAtStart }
  memories.set(view, memory)
  let shownHeight = ''
  /** The cap on the card's height last set: the visible area below its top. */
  let cap = ''
  /** The scroller, found on open, and the visible area, read again after a scroll or a window resize. */
  let scroller: HTMLElement | null = null
  let area: ReturnType<typeof visibleBox> | null = null

  // The resize grips: one frame over the card, beside the editable DOM (as the "Add cell note" button), so
  // ProseMirror never sees it.
  const grips = document.createElement('div')
  grips.className = 'cell-note-card-grips'
  grips.dataset.show = 'false'
  for (const grip of GRIPS) {
    const handle = document.createElement('span')
    handle.dataset.grip = grip.name
    handle.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return
      event.preventDefault()
      resize(event, grip)
    })
    grips.appendChild(handle)
  }
  host.appendChild(grips)

  /** The open card's note, its parent box and scale, and its spot under the cell, in the parent's layout px. */
  const measure = () => {
    if (view.isDestroyed) return null
    const card = cellNoteCardKey.getState(view.state)
    if (card?.pos == null || card.cell === null || card.label === null) return null
    const note = view.nodeDOM(card.pos) as HTMLElement | null
    const cell = view.nodeDOM(card.cell) as HTMLElement | null
    const parent = note?.offsetParent as HTMLElement | null | undefined
    if (note == null || cell === null || parent == null) return null
    const box = cell.getBoundingClientRect()
    const base = parent.getBoundingClientRect()
    // Layout px under a CSS zoom: the parent's box over its layout width.
    const scale = parent.offsetWidth > 0 ? base.width / parent.offsetWidth : 1
    area ??= visibleBox(scroller)
    return { note, base, scale, area, spotLeft: (box.right - base.left) / scale - note.offsetWidth, spotTop: (box.bottom - base.top) / scale + 4 }
  }

  /** Places the card: under its cell (not clamped), or at the placed spot (clamped to the visible editor area). The grips follow it. */
  const place = (): { left: number; top: number } | null => {
    frameId = 0
    const m = measure()
    if (m === null) {
      grips.dataset.show = 'false'
      return null
    }
    const { note, base, scale, area: box } = m
    grow(note)
    const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max))
    const minTop = (box.top - base.top) / scale
    const maxBottom = (box.bottom - base.top) / scale
    let top: number
    let left: number
    if (memory.placed !== null) {
      // A placed card keeps its top; it grows down to the area's bottom, then scrolls inside.
      top = clamp((box.top + memory.placed.y - base.top) / scale, minTop, Math.max(minTop, maxBottom - MIN_HEIGHT))
      left = clamp((box.left + memory.placed.x - base.left) / scale, (box.left - base.left) / scale, (box.right - base.left) / scale - note.offsetWidth)
      setCap(maxBottom - top)
    } else {
      // Under its cell (change AQ of the demo): its spot in the page, so it scrolls with the page and leaves the view
      // with its cell. No clamp. As tall as the visible area at most.
      setCap(maxBottom - minTop)
      top = m.spotTop
      left = m.spotLeft
    }
    host.style.setProperty('--cell-note-card-left', `${left}px`)
    host.style.setProperty('--cell-note-card-top', `${top}px`)
    const hostBox = host.getBoundingClientRect()
    grips.dataset.show = 'true'
    grips.style.left = `${left + (base.left - hostBox.left) / scale}px`
    grips.style.top = `${top + (base.top - hostBox.top) / scale}px`
    grips.style.width = `${note.offsetWidth}px`
    grips.style.height = `${note.offsetHeight}px`
    return { left, top }
  }

  /**
   * The height only grows (round 3 of the demo): to fit content that grew past it; after a resize that cut content off,
   * by as much as the content grew. The content's height is the card's scroll height (its box when the content is
   * shorter). Written only when it changes.
   */
  const grow = (note: HTMLElement) => {
    const content = note.scrollHeight + note.offsetHeight - note.clientHeight
    if (memory.height === null) memory.height = content
    else if (memory.lastContent !== null && content > memory.lastContent && content > memory.height) memory.height = memory.lastContent <= memory.height ? content : memory.height + content - memory.lastContent
    memory.lastContent = content
    const value = `${Math.ceil(memory.height)}px`
    if (value === shownHeight) return
    shownHeight = value
    host.style.setProperty('--cell-note-card-height', value)
  }

  /** The cap on the card's height, in layout px: written only when it changes. */
  const setCap = (px: number) => {
    const value = `${Math.max(MIN_HEIGHT, Math.floor(px))}px`
    if (value === cap) return
    cap = value
    host.style.setProperty('--cell-note-card-max-height', value)
  }

  /** The card's spot as placed: its window position, from the visible area's corner. */
  const placeHere = (left: number, top: number) => {
    const m = measure()
    if (m !== null) memory.placed = { x: m.base.left + left * m.scale - m.area.left, y: m.base.top + top * m.scale - m.area.top }
  }

  /** The width from a resize on the card's style (a custom property on the editor's box), or the default. */
  const applyWidth = () => {
    if (memory.width === null) host.style.removeProperty('--cell-note-card-width')
    else host.style.setProperty('--cell-note-card-width', `${memory.width}px`)
  }

  /** A pointer drag with `move` on each move: the cursor shows on the whole editor until the drop, then `drop`. */
  const track = (cursor: string, move: (dx: number, dy: number) => void, start: MouseEvent) => {
    host.style.setProperty('--cell-note-card-cursor', cursor)
    host.classList.add('cell-note-card-tracking')
    const onMove = (event: MouseEvent) => move(event.clientX - start.clientX, event.clientY - start.clientY)
    const onUp = () => {
      window.removeEventListener('mousemove', onMove, true)
      window.removeEventListener('mouseup', onUp, true)
      host.classList.remove('cell-note-card-tracking')
      // What shows, after the clamp, is what is kept.
      const shown = place()
      if (shown !== null) placeHere(shown.left, shown.top)
    }
    window.addEventListener('mousemove', onMove, true)
    window.addEventListener('mouseup', onUp, true)
  }

  /** A drag of the head: the card follows the pointer, and is placed. */
  const drag = (start: MouseEvent) => {
    const from = place()
    const m = measure()
    if (from === null || m === null) return
    track('grabbing', (dx, dy) => {
      placeHere(from.left + dx / m.scale, from.top + dy / m.scale)
      place()
    }, start)
  }

  /** A drag of a grip: that edge or corner moves, within the minimum size and the visible area; the card is placed. */
  const resize = (start: MouseEvent, grip: (typeof GRIPS)[number]) => {
    const from = place()
    const m = measure()
    if (from === null || m === null) return
    const { scale, base, area: box } = m
    const w0 = m.note.offsetWidth
    const h0 = m.note.offsetHeight
    const right0 = from.left + w0
    const bottom0 = from.top + h0
    const areaLeft = (box.left - base.left) / scale
    const areaTop = (box.top - base.top) / scale
    const areaRight = (box.right - base.left) / scale
    const areaBottom = (box.bottom - base.top) / scale
    const span = (value: number, max: number, min: number) => Math.max(Math.min(min, max), Math.min(value, max))
    track(grip.cursor, (dx, dy) => {
      let { left, top } = from
      let w = memory.width
      let h = memory.height
      if (grip.x === 1) w = span(w0 + dx / scale, areaRight - from.left, MIN_WIDTH)
      if (grip.x === -1) {
        w = span(w0 - dx / scale, right0 - areaLeft, MIN_WIDTH)
        left = right0 - w
      }
      if (grip.y === 1) h = span(h0 + dy / scale, areaBottom - from.top, MIN_HEIGHT)
      if (grip.y === -1) {
        h = span(h0 - dy / scale, bottom0 - areaTop, MIN_HEIGHT)
        top = bottom0 - h
      }
      memory.width = w
      memory.height = h
      applyWidth()
      placeHere(left, top)
      place()
    }, start)
  }

  controls.set(view, {
    drag,
    // The double click on the head: back under each cell, at the default size.
    reset: () => {
      memory.placed = null
      memory.width = null
      memory.height = null
      memory.lastContent = null
      applyWidth()
      place()
    },
    pinned: () => memory.pinned,
    togglePin: () => (memory.pinned = !memory.pinned),
  })
  const schedule = () => {
    if (frameId === 0) frameId = requestAnimationFrame(() => place())
  }
  /** A scroll or a window resize: the visible area is read again, and the card placed at once (no lag behind the page). */
  const reread = () => {
    area = null
    place()
  }
  const onDown = (event: MouseEvent) => {
    const card = cellNoteCardKey.getState(view.state)
    if (card?.pos == null || memory.pinned) return
    const note = view.nodeDOM(card.pos) as HTMLElement | null
    if (event.target instanceof Node && (note?.contains(event.target) || grips.contains(event.target))) return
    const corner = cellNoteCornerAt(view, event)
    if (corner !== null && card.cell !== null && corner === view.nodeDOM(card.cell)) return
    closeCellNote(view)
  }
  const listen = (on: boolean) => {
    if (on === listening) return
    listening = on
    if (on) {
      document.addEventListener('mousedown', onDown, true)
      document.addEventListener('scroll', reread, true)
      window.addEventListener('resize', reread)
    } else {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('scroll', reread, true)
      window.removeEventListener('resize', reread)
      grips.dataset.show = 'false'
    }
  }

  return {
    update: (_view: EditorView, prev: EditorState) => {
      const card = cellNoteCardKey.getState(view.state)
      const before = cellNoteCardKey.getState(prev)
      listen(card?.label != null)
      if (card?.label == null) return
      // Placed at once on open, so the scroll to the caret reads the card where it stands.
      if (card.label !== before?.label) {
        if (before?.label == null) scroller = scrollerOf(view)
        area = null
        place()
      } else {
        // Any other update: a fold in the card changes its height with no doc change, and the grips follow it.
        schedule()
      }
    },
    destroy: () => {
      listen(false)
      cancelAnimationFrame(frameId)
      grips.remove()
      controls.delete(view)
    },
  }
}

export const cellNoteCard = $prose(
  (ctx) =>
    new Plugin<CellNoteCardState>({
      key: cellNoteCardKey,
      state: {
        init: () => CLOSED,
        apply: (tr, card) => {
          const meta: string | null | { all: boolean } | undefined = tr.getMeta(cellNoteCardKey)
          if (meta !== undefined && meta !== null && typeof meta === 'object') return cardState(tr.doc, card.label, meta.all)
          if (meta !== undefined) return cardState(tr.doc, meta)
          if (card.label === null || !tr.docChanged) return card
          if (touchesNotes(tr)) return cardState(tr.doc, card.label, card.all)
          return { ...card, pos: tr.mapping.map(card.pos!), cell: card.cell === null ? null : tr.mapping.map(card.cell), set: card.set.map(tr.mapping, tr.doc) }
        },
      },
      view: (view) => {
        parsers.set(view, (markdown) => ctx.get(parserCtx)(markdown))
        serializers.set(view, (doc) => ctx.get(serializerCtx)(doc))
        return cardView(view)
      },
      props: {
        decorations: (state) => cellNoteCardKey.getState(state)?.set,
        // "All notes" is read-only (round 4 of the demo): the caret stays in the hidden note, so no key may write there.
        handleTextInput: (view) => readOnlyAll(view.state),
        handlePaste: (view) => readOnlyAll(view.state),
        handleDrop: (view) => readOnlyAll(view.state),
        handleKeyDown: (view, event) =>
          readOnlyAll(view.state) && !event.metaKey && !event.ctrlKey && (event.key.length === 1 || ['Backspace', 'Delete', 'Enter', 'Tab'].includes(event.key)),
        // A mouse selection that starts in the card ends in it.
        createSelectionBetween: (view, $anchor, $head) => {
          if (!inCard(view.state, $anchor.pos) || inCard(view.state, $head.pos)) return null
          const edge = cardEdge(view.state, $head.pos < $anchor.pos ? -1 : 1)
          return edge === null ? null : TextSelection.create(view.state.doc, $anchor.pos, edge.head)
        },
        handleDOMEvents: {
          // A click on a cell's corner triangle opens its cell note (D8, 5A-18).
          click: (view, event) => {
            const corner = cellNoteCornerAt(view, event)
            const cell = corner === null ? null : cellPosAround(view.state.doc.resolve(view.posAtDOM(corner, 0)))
            if (cell === null) return false
            event.preventDefault()
            return openCellNote(view, cell)
          },
        },
      },
    }),
)

/** A command while a card is open: `run` on the view. */
const whileOpen =
  (run: (view: EditorView) => boolean): Command =>
  (state, dispatch, view) => {
    if (openLabel(state) === null || view === undefined) return false
    return dispatch === undefined ? true : run(view)
  }

/** Open the cell note of the caret's cell (round 4 of the demo, the "Open cell note" row): made when it has none. */
const openAtCaret: Command = (state, dispatch, view) => {
  const cell = cellPosAround(state.selection.$from)
  if (cell === null || view === undefined) return false
  return dispatch === undefined ? canOpenCellNote(view, cell) : openCellNote(view, cell)
}

/**
 * Esc, ⌘A (in the card, or in a cell), and ArrowUp and ArrowDown at the card's edges (priority 90: the `[[` picker at
 * 100 first); and the rows of Settings › Hotkeys for the cell notes (round 4 of the demo, `shared/keys/note.ts`).
 */
export const cellNoteCardKeymap = $shortcut((ctx) => ({
  ...rowShortcuts(ctx, 'note.openCellNote', 'OpenCellNote', { priority: 90, onRun: () => openAtCaret }),
  ...rowShortcuts(ctx, 'note.nextCellNote', 'NextCellNote', { priority: 90, onRun: () => whileOpen((view) => stepCellNote(view, 1)) }),
  ...rowShortcuts(ctx, 'note.previousCellNote', 'PreviousCellNote', { priority: 90, onRun: () => whileOpen((view) => stepCellNote(view, -1)) }),
  ...rowShortcuts(ctx, 'note.cellNoteBack', 'CellNoteBack', { priority: 90, onRun: () => whileOpen((view) => goCellNoteHistory(view, -1)) }),
  ...rowShortcuts(ctx, 'note.cellNoteForward', 'CellNoteForward', { priority: 90, onRun: () => whileOpen((view) => goCellNoteHistory(view, 1)) }),
  CloseCellNote: { key: 'Escape', priority: 90, onRun: () => closeCard },
  CellNoteSelectAll: { key: 'Mod-a', priority: 90, onRun: () => (state, dispatch, view) => selectCard(state, dispatch, view) || selectCell(state, dispatch, view) },
  CellNoteCardUp: { key: 'ArrowUp', priority: 90, onRun: () => stayInCard(-1, false) },
  CellNoteCardDown: { key: 'ArrowDown', priority: 90, onRun: () => stayInCard(1, false) },
  CellNoteCardShiftUp: { key: 'Shift-ArrowUp', priority: 90, onRun: () => stayInCard(-1, true) },
  CellNoteCardShiftDown: { key: 'Shift-ArrowDown', priority: 90, onRun: () => stayInCard(1, true) },
}))
