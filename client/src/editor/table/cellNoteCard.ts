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
 * from top to bottom (change AQ of the demo): it scrolls with the page and goes out of view with its cell. From left
 * to right every card stays inside the area: under its cell it is right-aligned to the cell when that fits, else
 * left-aligned to it, then clamped (YAZ-4261), so a narrow first column never puts it under the sidebar.
 *
 * The state is meta-only (`cellNoteCardKey`, cellNotes.ts): a typed key only maps it. The card's place is set as two
 * custom properties on the editor's `.milkdown` box (outside the editable DOM, so ProseMirror's DOM observer never
 * sees it): on open, after a doc change, a scroll, a window resize, a drag and a resize, and only while a card is open.
 *
 * "All notes" of a CALENDAR table (YAZ-4276) is no card: the column's real notes show in the page, under the table, each
 * under its time heading, and you type in them (one document, one undo, one save). An empty time block says "Empty.
 * Click to write."; a click makes its note. The view's head switches the column, jumps to now, hides the empty blocks,
 * copies the filled ones, and goes back to the card. Leaving the view removes the notes it made that are still empty.
 * Every other table keeps the read-only list of every note of the page.
 */
import { parserCtx, serializerCtx } from '@milkdown/kit/core'
import { Fragment, type Node as ProseNode } from '@milkdown/kit/prose/model'
import { type Command, type EditorState, Plugin, Selection, TextSelection, type Transaction } from '@milkdown/kit/prose/state'
import type { ReplaceStep } from '@milkdown/kit/prose/transform'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { $prose, $shortcut } from '@milkdown/kit/utils'
import type { AllNotesOpensAt } from '@shared/types'
import { rowShortcuts } from '../noteKeys'
import { cellPosAround } from '../outline/listNodes'
import { cellBlocksOf } from './cellBlocks'
import { cellNotePreviewLines } from './cellNotePreview'
import {
  addCellNote,
  type CalendarAll,
  cellNoteAround,
  cellNoteCardKey,
  type CellNoteCardState,
  cellNoteLabelsIn,
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
import { calendarKey, minutesOf, nowPlace } from './tableCalendar'
import { changedTables, typingOnly } from './tableStyle'

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

const CLOSED: CellNoteCardState = { label: null, pos: null, cell: null, all: false, calendar: null, set: DecorationSet.empty }

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

/**
 * Turn "All notes" on or off (round 4 of the demo); off goes back to the last note. A calendar's view (YAZ-4276) opens
 * where Settings says (A1); off, it removes the notes it made that are still empty, and the caret goes back to the card.
 */
export function setAllCellNotes(view: EditorView, all: boolean): void {
  const card = cellNoteCardKey.getState(view.state)
  if (card?.label == null) return
  const tr = view.state.tr.setMeta(cellNoteCardKey, { all, ...(all ? { onlyFilled: onlyFilledOf.get(view) ?? false } : {}) })
  if (!all && card.calendar !== null) {
    if (view.editable) removeMadeEmpty(tr, card)
    const note = notePosOf(tr.doc, card.label)
    if (note !== null) tr.setSelection(Selection.near(tr.doc.resolve(note + tr.doc.nodeAt(note)!.nodeSize - 1), -1))
  }
  view.dispatch(tr)
  if (all) revealOpening(view)
}

/* ---------- "All notes" of a calendar table (YAZ-4276) ---------- */

/** The class of a cell note that a calendar's "All notes" shows in the page: table.css draws it in the flow. */
export const CELL_NOTE_SHOWN_CLASS = 'cell-note--shown'

/** The class of a shown note whose time is past (A4): table.css dims it with Dim past rows. */
export const CELL_NOTE_PAST_CLASS = 'cell-note--past'

/** Settings › Editor › Cell notes › All notes opens at (A1): the cell you came from, or now. App sets it. */
let allOpensAt: AllNotesOpensAt = 'cell'

/** "Only filled" (A3), kept for each editor (a tab) while it lives: the view opens with it as it was left. */
const onlyFilledOf = new WeakMap<EditorView, boolean>()

/** How many times a calendar view was built: typing in a note must only map it. */
export const calendarBuilds = { count: 0 }

/** Set where a calendar's "All notes" opens: App, when the setting changes. */
export function setAllNotesOpensAt(at: AllNotesOpensAt): void {
  allOpensAt = at
}

/** One time block of the view: a body row of the calendar table, in the view's column. */
interface TimeBlock {
  /** The row's index in the table (the header row is 0). */
  row: number
  /** The row's time: the text of its first cell. */
  time: string
  /** The row's cell in the view's column. */
  cell: number
  /** The label of that cell's mark, or null. */
  label: string | null
  /** That cell's note, or null. */
  note: number | null
}

type TableAt = ReturnType<typeof tableAround>

/** The calendar table that holds the cell at `cell`, or null: a table that is no calendar table keeps the list (D4). */
function calendarAround(doc: ProseNode, cell: number): TableAt | null {
  const $cell = doc.resolve(cell)
  if ($cell.depth < 2 || $cell.node(-1).type.name !== 'table') return null
  const table = tableAround(doc, cell)
  return (table.node.attrs.calendar as number) > 0 ? table : null
}

/** The time blocks of `table` in `column`, and the end of the table's notes: they follow it (`notesFollowTables`). */
function timeBlocks(doc: ProseNode, table: TableAt, column: number): { blocks: TimeBlock[]; runEnd: number } {
  // One pass over the notes under the table, by label: no search of the page for each row.
  const notes = new Map<string, number>()
  const $end = doc.resolve(table.end)
  let runEnd = table.end
  for (let index = $end.index(); index < $end.parent.childCount && isCellNote($end.parent.child(index)); index++) {
    notes.set($end.parent.child(index).attrs.label as string, runEnd)
    runEnd += $end.parent.child(index).nodeSize
  }
  const blocks: TimeBlock[] = []
  let rowPos = table.pos + 1
  table.node.forEach((row, _offset, r) => {
    if (r > 0 && column < row.childCount) {
      let cell = rowPos + 1
      for (let c = 0; c < column; c++) cell += row.child(c).nodeSize
      const label = cellNoteLabelsIn(row.child(column))[0] ?? null
      blocks.push({ row: r, time: row.firstChild!.textContent.trim(), cell, label, note: label === null ? null : (notes.get(label) ?? null) })
    }
    rowPos += row.nodeSize
  })
  return { blocks, runEnd }
}

/** The columns a view can show (A2): each one but the first, which holds the times, with its header's words. */
function calendarColumns(table: ProseNode): Array<{ column: number; name: string }> {
  const columns: Array<{ column: number; name: string }> = []
  table.firstChild!.forEach((cell, _offset, c) => {
    if (c > 0) columns.push({ column: c, name: cell.textBetween(0, cell.content.size, ' ').trim() || `Column ${c + 1}` })
  })
  return columns
}

/**
 * Typing in a table's body cells that hold no time: the view reads only the times and the header row, so it maps.
 * Typing in a time or a column's name, or any other change of the table, builds it again.
 */
const typingInBodyCells = (tr: Transaction): boolean =>
  typingOnly(tr) &&
  tr.steps.every((step, i) => {
    const cell = cellPosAround(tr.docs[i]!.resolve((step as ReplaceStep).from))
    if (cell === null) return true
    const $cell = tr.docs[i]!.resolve(cell)
    return $cell.index(-1) > 0 && $cell.index() > 0
  })

/** The view as the document stands: its card, its table and its blocks; null when no calendar view is open. */
function openView(state: EditorState): { card: CellNoteCardState & { calendar: CalendarAll; cell: number }; table: TableAt; blocks: TimeBlock[] } | null {
  const card = cellNoteCardKey.getState(state)
  if (card?.calendar == null || card.cell === null) return null
  const table = calendarAround(state.doc, card.cell)
  if (table === null) return null
  return { card: card as CellNoteCardState & { calendar: CalendarAll; cell: number }, table, blocks: timeBlocks(state.doc, table, card.calendar.column).blocks }
}

/** The row of the cell the view was opened from. */
const originRow = (state: EditorState, cell: number): number => state.doc.resolve(cell).index(-1)

/** Each time heading: the time, a "Now" tag on now's block (A1), dimmed when past (A4). */
const timeHeading = (row: number, time: string, now: boolean, past: boolean) => () => {
  const heading = document.createElement('div')
  heading.className = `cell-note-time${now ? ' cell-note-time--now' : ''}${past ? ' cell-note-time--past' : ''}`
  heading.contentEditable = 'false'
  heading.dataset.row = String(row)
  heading.textContent = time === '' ? '—' : time
  if (now) {
    const tag = document.createElement('span')
    tag.className = 'cell-note-time__now'
    tag.textContent = 'Now'
    heading.appendChild(tag)
  }
  return heading
}

/** An empty time block (B): a click makes its note, and the caret goes in. */
const emptyBlock = (row: number) => (view: EditorView) => {
  // No `disabled`: a read-only switch rebuilds no widget. A read-only note's block is styled quiet (table.css), and
  // `writeTimeBlock` declines there.
  const empty = headButton('cell-note-time-empty', 'Empty. Click to write.', 'Write in this time block', () => void writeTimeBlock(view, row))
  empty.contentEditable = 'false'
  return empty
}

/** The view's head (C): its title, the column buttons, Now, Only filled, Copy all, Back to the card and Close. */
const calendarHead = (title: string, column: number, onlyFilled: boolean, options: ReadonlyArray<{ column: number; name: string }>) => (view: EditorView) => {
  const head = document.createElement('div')
  head.className = 'cell-note-all-head'
  head.contentEditable = 'false'
  const name = document.createElement('span')
  name.className = 'cell-note-all-head__title'
  name.textContent = `All notes: ${title}`
  const columns = document.createElement('span')
  columns.className = 'cell-note-all-head__columns'
  columns.setAttribute('role', 'group')
  columns.setAttribute('aria-label', 'Column')
  for (const option of options) {
    const button = headButton('cell-note-all-head__column', option.name, `Show the notes of ${option.name}`, () => setCalendarView(view, { column: option.column }))
    button.setAttribute('aria-pressed', String(option.column === column))
    columns.appendChild(button)
  }
  const now = headButton('cell-note-all-head__now', 'Now', 'Go to now', () => void revealRow(view, 'now', true))
  const filled = headButton('cell-note-all-head__filled', 'Only filled', 'Show only the time blocks with notes', () => setCalendarView(view, { onlyFilled: !onlyFilled }))
  filled.setAttribute('aria-pressed', String(onlyFilled))
  const copy = headButton('cell-note-card__copy', 'Copy all', 'Copy the filled time blocks as Markdown', () => void navigator.clipboard?.writeText(calendarMarkdown(view)))
  const back = headButton('cell-note-card__all-toggle', '', 'Back to this cell note', () => setAllCellNotes(view, false))
  back.innerHTML = ALL_ICON
  back.setAttribute('aria-pressed', 'true')
  const close = headButton('cell-note-card__close', '×', 'Close all notes', () => closeCellNote(view))
  head.append(name, columns, now, filled, copy, back, close)
  return head
}

/** A column button or "Only filled": the view, built again with that change. */
function setCalendarView(view: EditorView, change: { column?: number; onlyFilled?: boolean }): void {
  if (change.onlyFilled !== undefined) onlyFilledOf.set(view, change.onlyFilled)
  view.dispatch(view.state.tr.setMeta(cellNoteCardKey, { all: true, ...change }))
}

/** The calendar view of `cell`'s table for the note `label`, or null when that table is no calendar table (D4). */
function calendarState(doc: ProseNode, label: string, pos: number, cell: number, carry: Partial<CalendarAll>): CellNoteCardState | null {
  const table = calendarAround(doc, cell)
  if (table === null) return null
  const column = carry.column ?? doc.resolve(cell).index()
  const onlyFilled = carry.onlyFilled ?? false
  calendarBuilds.count++
  const { blocks, runEnd } = timeBlocks(doc, table, column)
  const place = nowPlace(table.node, minutesOf(new Date()))
  const options = calendarColumns(table.node)
  const title = options.find((option) => option.column === column)?.name ?? 'Notes'
  // Where each block's widgets stand: before its note, or (an empty block) before the next shown note, else at the end
  // of the table's notes. The notes in between are other columns', hidden. One pass from the end.
  const at: number[] = []
  for (let i = blocks.length - 1, next = runEnd; i >= 0; i--) {
    at[i] = blocks[i]!.note ?? next
    if (blocks[i]!.note !== null) next = blocks[i]!.note!
  }
  // Every widget sits between blocks under the table, before the note it stands for: the order of `side` is the page's.
  const decorations = [
    Decoration.widget(table.end, calendarHead(title, column, onlyFilled, options), {
      side: 1,
      key: `cell-note-all-head:${column}:${onlyFilled}:${table.node.firstChild!.textContent}`,
      ignoreSelection: true,
      stopEvent: () => true,
    }),
    Decoration.node(cell, cell + doc.nodeAt(cell)!.nodeSize, { class: CELL_NOTE_CELL_OPEN_CLASS }),
  ]
  blocks.forEach((block, i) => {
    if (onlyFilled && block.note === null) return
    const now = place?.row === block.row
    const past = place !== null && block.row < place.pastEnd
    decorations.push(Decoration.widget(at[i]!, timeHeading(block.row, block.time, now, past), { side: 10 + 2 * i, key: `cell-note-time:${block.row}:${block.time}:${now}:${past}`, ignoreSelection: true }))
    // A past block's note dims with its heading (A4), as the table's past rows do.
    if (block.note !== null) decorations.push(Decoration.node(block.note, block.note + doc.nodeAt(block.note)!.nodeSize, { class: past ? `${CELL_NOTE_SHOWN_CLASS} ${CELL_NOTE_PAST_CLASS}` : CELL_NOTE_SHOWN_CLASS }))
    else decorations.push(Decoration.widget(at[i]!, emptyBlock(block.row), { side: 11 + 2 * i, key: `cell-note-empty:${block.row}`, ignoreSelection: true, stopEvent: () => true }))
  })
  const shown = blocks.flatMap((block) => (block.note === null ? [] : [block.note]))
  return { label, pos, cell, all: true, calendar: { column, shown, made: carry.made ?? [], onlyFilled }, set: DecorationSet.create(doc, decorations) }
}

/** Removes, in `tr`, the notes the view made that are still empty (A9). A note left empty another way stays. */
function removeMadeEmpty(tr: Transaction, card: CellNoteCardState): void {
  for (const label of card.calendar?.made ?? []) {
    const note = notePosOf(tr.doc, label)
    if (note !== null && label !== card.label && isEmptyCellNote(tr.doc.nodeAt(note)!)) removeCellNote(tr, label)
  }
}

/** The caret at the end of the note at `note`, the editor focused. */
function caretInNote(view: EditorView, note: number): void {
  const end = note + view.state.doc.nodeAt(note)!.nodeSize - 1
  view.dispatch(view.state.tr.setSelection(Selection.near(view.state.doc.resolve(end), -1)))
  view.focus()
}

/**
 * The time heading of `row` (or of now's block) in view, at the top when `top`; with `caret`, the caret in its note when
 * it has one. False when there is no such block.
 */
function revealRow(view: EditorView, row: number | 'now', caret: boolean, top = true): boolean {
  const open = openView(view.state)
  if (open === null) return false
  const target = row === 'now' ? (nowPlace(open.table.node, minutesOf(new Date()))?.row ?? null) : row
  const block = target === null ? undefined : open.blocks.find((candidate) => candidate.row === target)
  if (block === undefined) return false
  if (caret && block.note !== null) caretInNote(view, block.note)
  view.dom.querySelector(`.cell-note-time[data-row="${block.row}"]`)?.scrollIntoView?.({ block: top ? 'start' : 'nearest' })
  return true
}

/** The view just opened (A1): at the block of the cell it came from, the caret there; or at now's, the caret in its note. */
function revealOpening(view: EditorView): void {
  const card = cellNoteCardKey.getState(view.state)
  if (card?.calendar == null || card.cell === null) return
  if (allOpensAt === 'now' && revealRow(view, 'now', true)) return
  revealRow(view, originRow(view.state, card.cell), false)
}

/**
 * The note of the time block `row` (B): the caret goes into it. A block with no note gets one first (with the new
 * note template, as `openCellNote` makes one), as one undo step; the view keeps it in `made`.
 */
function writeTimeBlock(view: EditorView, row: number): boolean {
  const open = openView(view.state)
  const block = open?.blocks.find((candidate) => candidate.row === row)
  if (open === null || block === undefined) return false
  if (block.note !== null) {
    caretInNote(view, block.note)
    revealRow(view, row, false, false)
    return true
  }
  if (!view.editable) return false
  const tr = view.state.tr
  let label = block.label
  if (label === null) {
    insertCellNote(tr, block.cell, templateBlocks(view))
    label = cellNoteOf(tr.doc, tr.mapping.map(block.cell))!
  } else {
    // A mark with no note: its note, under the table (`notesFollowTables` puts it in order).
    tr.insert(open.table.end, view.state.schema.nodes.cell_note.createAndFill({ label })!)
  }
  tr.setMeta(cellNoteCardKey, { all: true, made: [...open.card.calendar.made, label] })
  const note = notePosOf(tr.doc, label)!
  const first = Selection.findFrom(tr.doc.resolve(note + 1), 1, true)
  if (first !== null) tr.setSelection(TextSelection.create(tr.doc, first.$head.end()))
  view.dispatch(tr)
  view.focus()
  revealRow(view, row, false, false)
  return true
}

/** ⌥↓ / ⌥↑, and Next and Previous cell note, in the view (A5): the next or the previous time block, its note made when empty. */
function goTimeBlock(view: EditorView, dir: -1 | 1): boolean {
  const open = openView(view.state)
  if (open === null) return false
  const list = open.card.calendar.onlyFilled ? open.blocks.filter((block) => block.note !== null) : open.blocks
  const here = cellNoteAround(view.state.selection.$head)
  let at = here === null ? -1 : list.findIndex((block) => block.note === here)
  if (at < 0) at = list.findIndex((block) => block.row === originRow(view.state, open.card.cell))
  const target = list[at + dir]
  // At the first or the last block the key is still the view's: the caret stays.
  return target === undefined || writeTimeBlock(view, target.row)
}

/** "Copy all" in the view (A7): each filled block, its time on a line, then its note as Markdown. */
function calendarMarkdown(view: EditorView): string {
  const open = openView(view.state)
  if (open === null) return ''
  const serialize = serializers.get(view)
  const { doc } = view.state
  return open.blocks
    .flatMap(({ time, note }) => {
      if (note === null) return []
      const node = doc.nodeAt(note)!
      const body = serialize === undefined ? node.textBetween(0, node.content.size, '\n') : serialize(doc.type.create(null, node.content)).trim()
      return [`${time}\n\n${body}`]
    })
    .join('\n\n')
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
  // The full title on hover when the head cuts it (the checker's round 1).
  name.title = title
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
  // In a calendar's "All notes" (YAZ-4276 A5): the next or the previous time block.
  if (cellNoteCardKey.getState(view.state)?.calendar != null) return goTimeBlock(view, dir)
  const order = cellNoteOrder(view.state.doc)
  const target = order[order.indexOf(label) + dir]
  const mark = target === undefined ? null : markPosOf(view.state.doc, target)
  const cell = mark === null ? null : cellPosAround(view.state.doc.resolve(mark))
  if (cell === null || !openCellNote(view, cell)) return false
  return true
}

/** The card's state for the note labelled `label` in `doc`: closed when no such note is there. */
function cardState(doc: ProseNode, label: string | null, all = false, carry: Partial<CalendarAll> = {}): CellNoteCardState {
  const pos = label === null ? null : notePosOf(doc, label)
  if (label === null || pos === null) return CLOSED
  const mark = markPosOf(doc, label)
  const cell = mark === null ? null : cellPosAround(doc.resolve(mark))
  // A calendar table's "All notes" is its own view, in the page (YAZ-4276); every other table's is the list.
  const calendar = all && cell !== null ? calendarState(doc, label, pos, cell, carry) : null
  if (calendar !== null) return calendar
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
  return { label, pos, cell, all, calendar: null, set }
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
  const card = cellNoteCardKey.getState(state)!
  const tr = state.tr.setMeta(cellNoteCardKey, null)
  const pos = notePosOf(state.doc, label)
  // In a calendar's "All notes" (YAZ-4276 A5), the caret goes to the cell of the note it is in.
  const here = card.calendar === null ? null : cellNoteAround(state.selection.$head)
  const mark = markPosOf(state.doc, here === null ? label : (state.doc.nodeAt(here)!.attrs.label as string))
  if (view.editable) removeMadeEmpty(tr, card)
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

/** The first (`dir` -1) or last (1) caret place of the note at `note`, or null. */
const noteEdge = (state: EditorState, note: number, dir: -1 | 1): Selection | null => {
  const end = note + state.doc.nodeAt(note)!.nodeSize - 1
  return Selection.findFrom(state.doc.resolve(dir < 0 ? note + 1 : end), -dir, true)
}

/** "All notes" (the list) is on and the caret is in the open (hidden) note: a key must not write there. A calendar's view is editable. */
const readOnlyAll = (state: EditorState): boolean => {
  const card = cellNoteCardKey.getState(state)
  return card?.all === true && card.calendar === null && inCard(state, state.selection.head)
}

/** The note that holds `pos`: the open note, or in a calendar's "All notes" one of the notes it shows; else null. */
const cardNoteAt = (state: EditorState, pos: number): number | null => {
  const card = cellNoteCardKey.getState(state)
  if (card?.pos == null) return null
  const notes = card.calendar === null ? [card.pos] : card.calendar.shown
  return notes.find((note) => pos > note && pos < note + state.doc.nodeAt(note)!.nodeSize) ?? null
}

/** Is `pos` inside the open note (or a note the calendar view shows)? */
const inCard = (state: EditorState, pos: number): boolean => cardNoteAt(state, pos) !== null

/** ArrowUp on the card's first line, ArrowDown on its last: to that line's start or end, not out of the card. */
const stayInCard =
  (dir: -1 | 1, extend: boolean): Command =>
  (state, dispatch, view) => {
    const { selection } = state
    // A calendar's view is in the page: the caret moves on to the next note shown, as the browser moves it.
    const note = cellNoteCardKey.getState(state)?.calendar != null ? null : cardNoteAt(state, selection.head)
    if (view === undefined || note === null || !view.endOfTextblock(dir < 0 ? 'up' : 'down')) return false
    const edge = noteEdge(state, note, dir)
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
  const note = cardNoteAt(state, from)
  if (note === null || cardNoteAt(state, to) !== note) return false
  // "All notes" (round 4 of the demo): the list, as the page's own selection (ProseMirror leaves a widget's alone).
  if (cellNoteCardKey.getState(state)?.all === true && cellNoteCardKey.getState(state)?.calendar === null) {
    const list = view?.dom.querySelector('.cell-note-card__all')
    if (list != null && dispatch !== undefined) window.getSelection()?.selectAllChildren(list)
    return list != null
  }
  const first = noteEdge(state, note, -1)
  const last = noteEdge(state, note, 1)
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
    // A calendar's "All notes" is in the page: no card to place (YAZ-4276).
    if (card?.pos == null || card.cell === null || card.label === null || card.calendar !== null) return null
    const note = view.nodeDOM(card.pos) as HTMLElement | null
    const cell = view.nodeDOM(card.cell) as HTMLElement | null
    const parent = note?.offsetParent as HTMLElement | null | undefined
    if (note == null || cell === null || parent == null) return null
    const box = cell.getBoundingClientRect()
    const base = parent.getBoundingClientRect()
    // Layout px under a CSS zoom: the parent's box over its layout width.
    const scale = parent.offsetWidth > 0 ? base.width / parent.offsetWidth : 1
    area ??= visibleBox(scroller)
    // Right-aligned to the cell when that fits in the visible area, else left-aligned to it (YAZ-4261).
    const right = (box.right - base.left) / scale - note.offsetWidth
    const spotLeft = right >= (area.left - base.left) / scale ? right : (box.left - base.left) / scale
    return { note, base, scale, area, spotLeft, spotTop: (box.bottom - base.top) / scale + 4 }
  }

  /**
   * Places the card: under its cell, or at the placed spot. Both stay inside the visible editor area from left to
   * right (`inArea`, YAZ-4261); only a placed card is held inside it from top to bottom. The grips follow it.
   */
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
    // The left edge wins when the card is wider than the area.
    const inArea = (left: number) => Math.max((box.left - base.left) / scale, Math.min(left, (box.right - base.left) / scale - note.offsetWidth))
    let top: number
    let left: number
    if (memory.placed !== null) {
      // A placed card keeps its top; it grows down to the area's bottom, then scrolls inside.
      top = clamp((box.top + memory.placed.y - base.top) / scale, minTop, Math.max(minTop, maxBottom - MIN_HEIGHT))
      left = inArea((box.left + memory.placed.x - base.left) / scale)
      setCap(maxBottom - top)
    } else {
      // Under its cell (change AQ of the demo): its spot in the page, so it scrolls with the page and leaves the view
      // with its cell. No clamp from top to bottom. As tall as the visible area at most.
      setCap(maxBottom - minTop)
      top = m.spotTop
      left = inArea(m.spotLeft)
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
    // A calendar's "All notes" is part of the page: a click elsewhere does not close it (YAZ-4276).
    if (card?.pos == null || memory.pinned || card.calendar !== null) return
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
          const meta: string | null | ({ all: boolean } & Partial<CalendarAll>) | undefined = tr.getMeta(cellNoteCardKey)
          const carry: Partial<CalendarAll> = { column: card.calendar?.column, onlyFilled: card.calendar?.onlyFilled, made: card.calendar?.made }
          if (meta !== undefined && meta !== null && typeof meta === 'object')
            return cardState(tr.doc, card.label, meta.all, { column: meta.column ?? carry.column, onlyFilled: meta.onlyFilled ?? carry.onlyFilled, made: meta.made ?? carry.made })
          if (meta !== undefined) return cardState(tr.doc, meta)
          if (card.label === null) return card
          // A calendar's view moves its Now tag with the table's minute tick (YAZ-4276).
          if (!tr.docChanged) return card.calendar !== null && tr.getMeta(calendarKey) !== undefined ? cardState(tr.doc, card.label, card.all, carry) : card
          if (touchesNotes(tr)) return cardState(tr.doc, card.label, card.all, carry)
          const cell = card.cell === null ? null : tr.mapping.map(card.cell)
          // A calendar's view is built again when its table changes (a row, a time); typing in a note only maps it.
          if (card.calendar !== null && cell !== null) {
            const table = calendarAround(tr.doc, cell)
            if (table === null || (changedTables(tr).has(table.pos) && !typingInBodyCells(tr))) return cardState(tr.doc, card.label, card.all, carry)
          }
          const calendar = card.calendar === null ? null : { ...card.calendar, shown: card.calendar.shown.map((note) => tr.mapping.map(note)) }
          return { ...card, pos: tr.mapping.map(card.pos!), cell, calendar, set: card.set.map(tr.mapping, tr.doc) }
        },
      },
      // A calendar view that closed by any route (Back, ×, Esc, another note's card, its table no longer a calendar
      // table, its note gone): the notes it made that are still empty go, with their marks (A9). Back, × and Esc already
      // removed theirs, so this finds none there.
      appendTransaction: (_trs, before, state) => {
        const was = cellNoteCardKey.getState(before)?.calendar
        const now = cellNoteCardKey.getState(state)
        if (was == null || was.made.length === 0 || now?.calendar != null) return null
        const tr = state.tr
        removeMadeEmpty(tr, { ...now!, calendar: was })
        return tr.docChanged ? tr : null
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
          const note = cardNoteAt(view.state, $anchor.pos)
          if (note === null || cardNoteAt(view.state, $head.pos) === note) return null
          const edge = noteEdge(view.state, note, $head.pos < $anchor.pos ? -1 : 1)
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

/** A command while the caret is in a note that a calendar's "All notes" shows (YAZ-4276): `run` on the view. */
const inCalendar =
  (run: (view: EditorView) => boolean): Command =>
  (state, dispatch, view) => {
    if (cellNoteCardKey.getState(state)?.calendar == null || view === undefined || !inCard(state, state.selection.head)) return false
    return dispatch === undefined ? true : run(view)
  }

/**
 * The "All notes" row of Settings › Hotkeys (YAZ-4276 A6, no key by default): from a table cell, or from its open card,
 * "All notes" of that cell's note (made when the cell has none); in "All notes", back to the card.
 */
const toggleAllAtCaret: Command = (state, dispatch, view) => {
  if (view === undefined) return false
  const card = cellNoteCardKey.getState(state)
  if (card?.all === true) {
    if (dispatch) setAllCellNotes(view, false)
    return true
  }
  const cell = card?.label != null && inCard(state, state.selection.head) ? card.cell : cellPosAround(state.selection.$from)
  if (cell === null || !canOpenCellNote(view, cell)) return false
  if (dispatch === undefined) return true
  if (card?.cell !== cell && !openCellNote(view, cell)) return false
  setAllCellNotes(view, true)
  return true
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
  ...rowShortcuts(ctx, 'note.allCellNotes', 'AllCellNotes', { priority: 90, onRun: () => toggleAllAtCaret }),
  ...rowShortcuts(ctx, 'note.nextTimeBlock', 'NextTimeBlock', { priority: 90, onRun: () => inCalendar((view) => goTimeBlock(view, 1)) }),
  ...rowShortcuts(ctx, 'note.previousTimeBlock', 'PreviousTimeBlock', { priority: 90, onRun: () => inCalendar((view) => goTimeBlock(view, -1)) }),
  CloseCellNote: { key: 'Escape', priority: 90, onRun: () => closeCard },
  CellNoteSelectAll: { key: 'Mod-a', priority: 90, onRun: () => (state, dispatch, view) => selectCard(state, dispatch, view) || selectCell(state, dispatch, view) },
  CellNoteCardUp: { key: 'ArrowUp', priority: 90, onRun: () => stayInCard(-1, false) },
  CellNoteCardDown: { key: 'ArrowDown', priority: 90, onRun: () => stayInCard(1, false) },
  CellNoteCardShiftUp: { key: 'Shift-ArrowUp', priority: 90, onRun: () => stayInCard(-1, true) },
  CellNoteCardShiftDown: { key: 'Shift-ArrowDown', priority: 90, onRun: () => stayInCard(1, true) },
}))
