/**
 * Calendar tables (YAZ-4162, YAZ-4159 D1 / D2 / D6 / D9 / D14; CONTRACTS rule 41a): a table whose comment has
 * `calendar 15m | 30m | 60m` (the `table` node's `calendar`, `tableStyle.ts`) is a day of time slots. Column A
 * holds the times (`readTime`); the header row is never a slot.
 *
 * THE SLOTS: a body row whose column A reads as a time starts a slot; the slot runs to the next row with a time, and
 * the last one is one slot length long. A row with no time has no slot, and the rows around it still work. A time
 * earlier than the time above it is on the next day (midnight), so `11:30 pm`, `12:00 am` run on.
 *
 * THE NOW ROW (D2): the row whose slot holds the current minute (today's, or tomorrow's for a row after midnight)
 * gets `table-now-row` and `--table-now`, how far down the slot now is (0–1); `table.css` draws the line, the tint or
 * both, by `data-table-now` on the app root (D6). Each body row before it gets `table-past-row` (D14: grey text, by
 * `data-table-dim-past`). With no now row: before the first slot no row is past, after the last every row is.
 * A FOLDED RUN (YAZ-4165, `tableFold.ts`) that holds the now row gives the marks to its bar: the bar is the now row,
 * `--table-now` the place of now in the whole run, and it is not past; "Go to now" opens the run first.
 * Node decorations from the attributes and the text only, as `tableFreeze.ts`: typing only maps the set (a time
 * typed in column A moves the marker at the next tick); any other transaction builds again only the calendar tables
 * it changed (`changedTables`).
 *
 * THE CLOCK (`calendarClock`, the note editor only; never the hover preview card, D9): one `setTimeout` per editor
 * view, to the next whole minute, only while the note has a calendar table. The tick (`calendarTick`) is a
 * transaction with metadata only and `addToHistory: false`: no document change, no undo step, redo kept, never
 * `markdownUpdated` (no save). It skips a hidden window and an editor off the screen (an `IntersectionObserver`);
 * the window shown again, or the editor back on the screen, ticks at once. A Mac waking from sleep fires the late
 * timer, which reads the clock again. `destroy` clears it.
 *
 * STARTING ONE (YAZ-4163, D7 / D8 / D15): `calendarTableNode` is "/Calendar table"'s table. `setTimeSlots` is "Time
 * slots" in the six-dot menu (`tableRows.ts`): Off removes the part and keeps every row; a length on a table with no
 * time in column A adds a "Time" column, from the start of Settings › Calendar tables › Calendar day (5:00 am by
 * default, the YAZ-4163 demo); on a table with times it is `slotTimes`, which keeps all text:
 * a row with text keeps its time, also off the new grid, an empty row off the grid goes, and the grid times that are
 * missing come back as empty rows. The grid is each multiple of the length from the table's first time to its last
 * (after midnight counting on). New times take the table's own format (`detectTimeFormat`), or the time format setting
 * when it has none. One transaction with the history closed: one ⌘Z.
 *
 * FILL THE DAY (the YAZ-4163 demo): "Fill the calendar day" (`fillCalendarDay`) adds an empty row for each slot of the
 * Calendar day setting that the table does not have, before, between and after its rows; it removes and moves nothing.
 */
import { closeHistory } from '@milkdown/kit/prose/history'
import type { Node as ProseNode, NodeType, Schema } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, Selection, type EditorState, type Transaction } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { detectTimeFormat, formatTime, readTime } from '@shared/timeFormat'
import { foldRuns, runOf, unfoldRun } from './tableFold'
import { tablerIcon } from './tableIcons'
import { changedTables, typingOnly } from './tableStyle'
import { calendarDaySetting, timeFormatSetting } from './timeFormatSetting'
import './tableCalendar.css'

export { readTime }

/** Minutes from midnight of `date`, local time. */
export const minutesOf = (date: Date): number => date.getHours() * 60 + date.getMinutes()

/** Where now is in a calendar table: its now row (an index of `table`'s rows) and how far down its slot, and the first row that is not past. */
export interface NowPlace {
  row: number | null
  fraction: number
  /** Body rows before this index are past. */
  pastEnd: number
}

/** Now in `table` at `minutes` from midnight; `null` when it is no calendar table or holds no time. */
export function nowPlace(table: ProseNode, minutes: number): NowPlace | null {
  const slot = table.attrs.calendar as number
  if (!(slot > 0)) return null
  const starts = rowTimes(table).flatMap(({ time }, i) => (time === null ? [] : [{ row: i + 1, start: time }]))
  if (starts.length === 0) return null
  const slots = starts.map(({ row, start }, i) => ({ row, start, end: starts[i + 1]?.start ?? start + slot }))
  // Today's minute first, then the same minute tomorrow (a row after midnight).
  for (const at of [minutes, minutes + 1440]) {
    const now = slots.find(({ start, end }) => start <= at && at < end)
    if (now !== undefined) return { row: now.row, fraction: (at - now.start) / (now.end - now.start), pastEnd: now.row }
  }
  const next = slots.find(({ start }) => start > minutes)
  return { row: null, fraction: 0, pastEnd: next?.row ?? table.childCount }
}

/** Each body row of `table` with its time from the first day's midnight (a time earlier than the one above is a day on), or `null`. */
function rowTimes(table: ProseNode): Array<{ row: ProseNode; time: number | null }> {
  const out: Array<{ row: ProseNode; time: number | null }> = []
  let day = 0
  let last = -1
  table.forEach((row, _, r) => {
    if (r === 0) return
    const time = readTime(row.firstChild?.textContent ?? '')
    if (time !== null && time < last) day += 1440
    if (time !== null) last = time
    out.push({ row, time: time === null ? null : time + day })
  })
  return out
}

/**
 * The "Now" chip (YAZ-4164 D12; its look, the YAZ-4163 demo: a pill with a red dot, "Now" and an arrow that points at
 * the now row): a widget right after a calendar table, in the note editor only. A table with `nonow` has none, and
 * Settings › Calendar tables › Now button Off hides every one (`data-table-now-button`, `tableCalendar.css`).
 * Its anchor sticks to the bottom of the note while the table is in view (`table.css`), so no position is read on a
 * scroll; the clock's observer (`CalendarClock`) shows it only while the table is on the screen and its now row is
 * not. A click is "Go to now" on that table. One key for every chip: a rebuild keeps its DOM, and its state.
 */
function nowChip(view: EditorView, getPos: () => number | undefined): HTMLElement {
  const anchor = document.createElement('div')
  anchor.className = 'table-now-chip-anchor'
  const chip = document.createElement('button')
  chip.type = 'button'
  chip.className = 'table-now-chip'
  chip.hidden = true
  const dot = document.createElement('span')
  dot.className = 'table-now-chip__dot'
  const label = document.createElement('span')
  label.textContent = 'Now'
  chip.append(dot, label)
  drawChipArrow(chip, 'down')
  chip.addEventListener('mousedown', (event) => event.preventDefault())
  chip.addEventListener('click', () => {
    const end = getPos()
    const table = end === undefined ? null : view.state.doc.resolve(end).nodeBefore
    if (table?.type.name === 'table') goToNow(view, end! - table.nodeSize)
  })
  anchor.appendChild(chip)
  return anchor
}

/** The chip's arrow (`tableIcons.ts`) and name for the now row `dir` of it. */
function drawChipArrow(chip: HTMLElement, dir: 'up' | 'down'): void {
  if (chip.dataset.dir === dir) return
  chip.dataset.dir = dir
  chip.setAttribute('aria-label', `Go to now, ${dir === 'up' ? 'above' : 'below'}`)
  chip.title = 'Go to now'
  chip.querySelector('svg')?.remove()
  chip.appendChild(tablerIcon(dir === 'up' ? 'arrowUp' : 'arrowDown')())
}

/** The decorations of one calendar table at `minutes`: its past rows, its now row and, with `chip`, the chip (none with `nonow`). */
function calendarDecorations(table: ProseNode, pos: number, minutes: number, chip = false): Decoration[] {
  const place = nowPlace(table, minutes)
  if (place === null) return []
  // A folded run that holds the now row (or the first row that is not past) gives the marks to its bar (YAZ-4165).
  const runs = foldRuns(table)
  const nowRun = runOf(runs, place.row)
  const nowRow = nowRun?.from ?? place.row
  const fraction = nowRun === undefined ? place.fraction : (place.row! - nowRun.from + place.fraction) / (nowRun.to - nowRun.from + 1)
  const pastEnd = runOf(runs, place.pastEnd)?.from ?? place.pastEnd
  const out: Decoration[] = []
  if (chip && table.attrs.nowButton !== false) out.push(Decoration.widget(pos + table.nodeSize, nowChip, { calendar: true, nowChip: true, key: 'table-now-chip', side: -1, stopEvent: () => true, ignoreSelection: true }))
  table.forEach((row, offset, r) => {
    const from = pos + 1 + offset
    if (r > 0 && r < pastEnd) out.push(Decoration.node(from, from + row.nodeSize, { class: 'table-past-row' }, { calendar: true }))
    if (r === nowRow) {
      const now = String(Math.round(fraction * 1000) / 1000)
      out.push(Decoration.node(from, from + row.nodeSize, { class: 'table-now-row', style: `--table-now: ${now}` }, { calendar: true, nowRow: true }))
    }
  })
  return out
}

const isCalendar = (node: ProseNode | null | undefined): node is ProseNode => node?.type.name === 'table' && (node.attrs.calendar as number) > 0

interface CalendarState {
  set: DecorationSet
  /** The calendar tables, by position. */
  tables: number[]
  /** The minute the marks are for, from midnight. */
  now: number
  /** Counts each change of the marks that is not a mapping: the chip's watch runs only when it moves. */
  generation: number
}

export const calendarKey = new PluginKey<CalendarState>('mdapp-table-calendar')

/** Every calendar table of `doc`, by position. */
function calendarTables(doc: ProseNode): number[] {
  const out: number[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'table') return !node.isTextblock
    if (isCalendar(node)) out.push(pos)
    return false
  })
  return out
}

const build = (doc: ProseNode, tables: number[], now: number, chip: boolean): DecorationSet =>
  DecorationSet.create(doc, tables.flatMap((pos) => calendarDecorations(doc.nodeAt(pos)!, pos, now, chip)))

/** The tick (D2): the marks move to `minutes`, and the document does not change. */
export function calendarTick(view: EditorView, minutes = minutesOf(new Date())): void {
  view.dispatch(view.state.tr.setMeta(calendarKey, minutes).setMeta('addToHistory', false))
}

/** The calendar state of `state`, for the menus (`tableRows.ts`) and the go-to-now request. */
export const calendarStateOf = (state: EditorState): CalendarState | undefined => calendarKey.getState(state)

/** One chip and what its observer last said of its table block and its now row. */
interface ChipWatch {
  chip: HTMLButtonElement
  block: Element
  row: Element | null
  blockOn: boolean
  rowOn: boolean
  rowAbove: boolean
}

/**
 * One editor's clock: a timer to the next whole minute while the note has a calendar table. It also watches the
 * chips (D12): one `IntersectionObserver` on each calendar table's block and its now row, set again only when the
 * marks change (`generation`), never on a key.
 */
class CalendarClock {
  #timer: ReturnType<typeof setTimeout> | null = null
  #onScreen = true
  #observer: IntersectionObserver | null = null
  #chips: IntersectionObserver | null = null
  #watches: ChipWatch[] = []
  #generation = -1

  constructor(readonly view: EditorView) {
    document.addEventListener('visibilitychange', this.#shown)
    if (typeof IntersectionObserver !== 'undefined') {
      this.#observer = new IntersectionObserver((entries) => {
        const was = this.#onScreen
        this.#onScreen = entries.some((entry) => entry.isIntersecting)
        if (this.#onScreen && !was) this.#tick()
      })
      this.#observer.observe(view.dom)
      this.#chips = new IntersectionObserver(this.#seen)
    }
    this.update()
  }

  update(): void {
    const state = calendarKey.getState(this.view.state)
    const want = (state?.tables.length ?? 0) > 0
    if (want && this.#timer === null) this.#schedule()
    else if (!want && this.#timer !== null) this.#stop()
    if (state !== undefined && state.generation !== this.#generation) {
      this.#generation = state.generation
      this.#watchChips(state)
    }
  }

  /** Observe each calendar table's block and now row again, after the marks changed. */
  #watchChips(state: CalendarState): void {
    const observer = this.#chips
    if (observer === null) return
    observer.disconnect()
    const old = new Map(this.#watches.map((watch) => [watch.chip, watch]))
    this.#watches = []
    for (const pos of state.tables) {
      const block = this.view.nodeDOM(pos)
      const chip = block instanceof Element ? block.nextElementSibling?.querySelector<HTMLButtonElement>('.table-now-chip') : null
      if (!(block instanceof Element) || chip == null) continue
      const table = this.view.state.doc.nodeAt(pos)!
      const now = state.set.find(pos, pos + table.nodeSize, (spec) => spec.nowRow === true)[0]
      const row = now === undefined ? null : (this.view.nodeDOM(now.from) as Element | null)
      const before = old.get(chip)
      const watch: ChipWatch = { chip, block, row, blockOn: before?.block === block && before.blockOn, rowOn: before?.row === row && before.rowOn, rowAbove: before?.rowAbove ?? false }
      this.#watches.push(watch)
      observer.observe(block)
      if (row !== null) observer.observe(row)
      this.#draw(watch)
    }
  }

  #seen = (entries: IntersectionObserverEntry[]): void => {
    for (const entry of entries) {
      for (const watch of this.#watches) {
        if (entry.target === watch.block) watch.blockOn = entry.isIntersecting
        else if (entry.target === watch.row) {
          watch.rowOn = entry.isIntersecting
          // Above or below the middle of the window: a row scrolled out of the note can still be inside the window
          // (under the tab bar, or under the note's bottom), so its edge against the window's edge says nothing.
          const root = entry.rootBounds
          const middle = root === null ? window.innerHeight / 2 : (root.top + root.bottom) / 2
          watch.rowAbove = (entry.boundingClientRect.top + entry.boundingClientRect.bottom) / 2 < middle
        } else continue
        this.#draw(watch)
      }
    }
  }

  /** The chip shows while its table is on the screen and its now row is not; its arrow points at the row. */
  #draw(watch: ChipWatch): void {
    const hidden = !watch.blockOn || watch.row === null || watch.rowOn
    if (watch.chip.hidden !== hidden) watch.chip.hidden = hidden
    drawChipArrow(watch.chip, watch.rowAbove ? 'up' : 'down')
  }

  #schedule(): void {
    // A little after the minute turns, so the clock reads the new minute.
    this.#timer = setTimeout(this.#fire, 60_000 - (Date.now() % 60_000) + 20)
  }

  #stop(): void {
    if (this.#timer !== null) clearTimeout(this.#timer)
    this.#timer = null
  }

  #fire = (): void => {
    this.#timer = null
    this.#tick()
    this.update()
  }

  #shown = (): void => {
    if (!document.hidden) this.#tick()
  }

  /** Move the marks to the clock's minute: not while hidden or off the screen, and not when they show it already. */
  #tick(): void {
    if (document.hidden || !this.#onScreen) return
    const state = calendarKey.getState(this.view.state)
    const now = minutesOf(new Date())
    if (state === undefined || state.tables.length === 0 || state.now === now) return
    calendarTick(this.view, now)
  }

  destroy(): void {
    this.#stop()
    this.#observer?.disconnect()
    this.#chips?.disconnect()
    document.removeEventListener('visibilitychange', this.#shown)
  }
}

/** The calendar marks; with `clock`, the minute timer too (the note editor, not a preview). */
export function createTableCalendar(clock: boolean) {
  return $prose(
    () =>
      new Plugin<CalendarState>({
        key: calendarKey,
        state: {
          init: (_, { doc }) => {
            const tables = calendarTables(doc)
            const now = minutesOf(new Date())
            return { set: build(doc, tables, now, clock), tables, now, generation: 0 }
          },
          apply: (tr: Transaction, value) => {
            const tick = tr.getMeta(calendarKey) as number | undefined
            if (!tr.docChanged) {
              if (tick === undefined || tick === value.now) return value
              return { set: build(tr.doc, value.tables, tick, clock), tables: value.tables, now: tick, generation: value.generation + 1 }
            }
            let set = value.set.map(tr.mapping, tr.doc)
            const mapped = value.tables.map((pos) => tr.mapping.map(pos))
            // A key changes no table's shape, attributes or slots: the mapped set holds (YAZ-3790).
            if (typingOnly(tr)) return { ...value, set, tables: mapped }
            const changed = changedTables(tr)
            for (const [pos, node] of changed) {
              const end = pos + node.nodeSize
              // The table's own: a chip at `pos` is the table's before it.
              const stale = set.find(pos, end, (spec) => spec.calendar === true).filter((deco) => deco.from > pos)
              if (stale.length > 0) set = set.remove(stale)
              const fresh = calendarDecorations(node, pos, value.now, clock)
              if (fresh.length > 0) set = set.add(tr.doc, fresh)
            }
            const tables = [...new Set([...mapped, ...changed.keys()])].filter((pos) => isCalendar(tr.doc.nodeAt(pos))).sort((a, b) => a - b)
            // The chips are watched again only when a calendar table, or the list of them, changed (YAZ-4176): not on
            // an Enter or a paste elsewhere in the note.
            const moved = [...changed.values()].some(isCalendar) || tables.length !== mapped.length || tables.some((pos, i) => pos !== mapped[i])
            return { ...value, set, tables, generation: value.generation + (moved ? 1 : 0) }
          },
        },
        props: { decorations: (state) => calendarKey.getState(state)!.set },
        view: (view) => (clock ? new CalendarClock(view) : {}),
      }),
  )
}

/** A cell of `type` holding `text` (none when empty), with `attrs`. */
const cellNode = (schema: Schema, type: NodeType, text: string, attrs: Record<string, unknown> | null = null): ProseNode =>
  type.create(attrs, schema.nodes.paragraph!.create(null, text === '' ? null : schema.text(text)))

/** A cell holds something besides its empty paragraph. */
const filled = (cell: ProseNode): boolean => cell.childCount > 1 || (cell.firstChild?.content.size ?? 0) > 0

/**
 * "/Calendar table"'s table (D7, D10): "Time | Plan 1", a row each 30 minutes of the Calendar day setting (5:00 am to
 * 10:00 pm by default) in `format`,
 * `calendar 30m`, compact rows, the header row and column A frozen, and column A's body cells vertically in the
 * middle (YAZ-4166), so a time sits level with a two-line plan.
 */
export function calendarTableNode(schema: Schema, format = timeFormatSetting()): ProseNode {
  const { table, table_header_row: headerRow, table_row: row, table_header: header, table_cell: cell } = schema.nodes
  const rows = [headerRow!.create(null, [cellNode(schema, header!, 'Time'), cellNode(schema, header!, 'Plan 1')])]
  const { start, end } = calendarDaySetting()
  for (let t = start; t <= end; t += 30) rows.push(row!.create(null, [cellNode(schema, cell!, formatTime(format, t), { valign: 'middle' }), cellNode(schema, cell!, '')]))
  return table!.create({ calendar: 30, height: 'compact', freezeRows: 1, freezeCols: 1 }, rows)
}

/** The table at slot length `slot`, its text kept (D8); see the header. A table with no time only gets the part. */
export function slotTimes(table: ProseNode, slot: number, schema: Schema, fallback = timeFormatSetting()): ProseNode {
  const body = rowTimes(table)
  const timed = body.filter((entry): entry is { row: ProseNode; time: number } => entry.time !== null)
  const attrs = { ...table.attrs, calendar: slot }
  if (timed.length === 0) return table.type.create(attrs, table.content)
  const format = detectTimeFormat(body.map(({ row }) => row.firstChild?.textContent ?? '')) ?? fallback
  const first = timed[0]!.time
  const last = timed.at(-1)!.time
  const grid: number[] = []
  for (let t = Math.ceil(first / slot) * slot; t <= last; t += slot) grid.push(t)
  const onGrid = new Set(grid)
  // Each kept row, with the time it sorts by: a row with no time stays after the row above it.
  const kept: Array<{ time: number; row: ProseNode }> = []
  const have = new Set<number>()
  let at = -Infinity
  for (const { row, time } of body) {
    if (time !== null) at = time
    let text = false
    row.forEach((c, _, i) => {
      if (i > 0 && filled(c)) text = true
    })
    if (time !== null && !onGrid.has(time) && !text) continue
    kept.push({ time: at, row })
    if (time !== null) have.add(time)
  }
  const emptyRow = (time: number, above: ProseNode): ProseNode => emptyRowAt(schema, body[0]!.row, format, time, above)
  const added = grid.filter((t) => !have.has(t)).map((time) => ({ time, row: null as ProseNode | null }))
  // Stable: a new row goes after the kept rows of an earlier time, before those of a later one.
  const sorted = [...kept, ...added].map((entry, i) => ({ ...entry, i })).sort((a, b) => a.time - b.time || a.i - b.i)
  const rows: ProseNode[] = []
  // A new first row takes the first body row's vertical alignment, not the header's (YAZ-4176).
  for (const { time, row } of sorted) rows.push(row ?? emptyRow(time, rows.at(-1) ?? body[0]!.row))
  return table.type.create(attrs, [table.firstChild!, ...rows])
}

/** A new row at `time`: `template`'s alignment and width, and the vertical alignment of the row `above` it (YAZ-4166). */
function emptyRowAt(schema: Schema, template: ProseNode, format: string, time: number, above: ProseNode): ProseNode {
  const cells: ProseNode[] = []
  template.forEach((c, _, i) =>
    cells.push(cellNode(schema, c.type, i === 0 ? formatTime(format, time) : '', { alignment: c.attrs.alignment, colwidth: c.attrs.colwidth, valign: above.maybeChild(i)?.attrs.valign ?? null })),
  )
  return template.type.create(null, cells)
}

/** The slot times of the Calendar day setting that the calendar `table` has no row for; none for another table. */
export function missingDayTimes(table: ProseNode): number[] {
  const slot = table.attrs.calendar as number
  if (!(slot > 0) || table.childCount < 2) return []
  const body = rowTimes(table)
  const have = new Set(body.flatMap(({ time }) => (time === null ? [] : [time % 1440])))
  const { start, end } = calendarDaySetting()
  const out: number[] = []
  for (let t = Math.ceil(start / slot) * slot; t <= end; t += slot) if (!have.has(t)) out.push(t)
  return out
}

/** "Fill the calendar day": the missing rows of the day (`missingDayTimes`) in the table at `pos`, one undo step; `false` when none is missing. */
export function fillCalendarDay(view: EditorView, pos: number): boolean {
  const table = view.state.doc.nodeAt(pos)
  if (table?.type.name !== 'table') return false
  const missing = missingDayTimes(table)
  if (missing.length === 0) return false
  const body = rowTimes(table)
  const format = detectTimeFormat(body.map(({ row }) => row.firstChild?.textContent ?? '')) ?? timeFormatSetting()
  // Each row with the time it sorts by: a row with no time stays after the row above it (a stable sort).
  let at = -Infinity
  const kept = body.map(({ row, time }) => {
    if (time !== null) at = time
    return { time: at, row: row as ProseNode | null }
  })
  const sorted = [...kept, ...missing.map((time) => ({ time, row: null }))].map((entry, i) => ({ ...entry, i })).sort((a, b) => a.time - b.time || a.i - b.i)
  const rows: ProseNode[] = []
  // A new first row takes the first body row's vertical alignment, not the header's (YAZ-4176).
  for (const { time, row } of sorted) rows.push(row ?? emptyRowAt(view.state.schema, body[0]!.row, format, time, rows.at(-1) ?? body[0]!.row))
  view.dispatch(closeHistory(view.state.tr).replaceWith(pos, pos + table.nodeSize, table.type.create(table.attrs, [table.firstChild!, ...rows])))
  return true
}

/**
 * The table with a "Time" column before column A, a time in each body row from the Calendar day's start, `slot` apart
 * (D7); its body cells vertically in the middle, as "/Calendar table" makes them (YAZ-4166, YAZ-4176).
 */
function withTimeColumn(table: ProseNode, slot: number, schema: Schema, format: string): ProseNode {
  const { start } = calendarDaySetting()
  const rows: ProseNode[] = []
  table.forEach((row, _, r) => {
    const type = row.firstChild!.type
    const first = r === 0 ? cellNode(schema, type, 'Time') : cellNode(schema, type, formatTime(format, start + (r - 1) * slot), { valign: 'middle' })
    rows.push(row.type.create(row.attrs, [first, ...Array.from({ length: row.childCount }, (_, c) => row.child(c))]))
  })
  return table.type.create({ ...table.attrs, calendar: slot }, rows)
}

/** "Time slots" (D7, D8): `slot` minutes, or `0` for Off, on the table at `pos`, in one transaction (one undo step). */
export function setTimeSlots(view: EditorView, pos: number, slot: number): void {
  const table = view.state.doc.nodeAt(pos)
  if (table?.type.name !== 'table' || table.attrs.calendar === slot) return
  const tr = closeHistory(view.state.tr)
  if (slot === 0) tr.setNodeMarkup(pos, undefined, { ...table.attrs, calendar: 0 })
  else {
    const hasTimes = rowTimes(table).some(({ time }) => time !== null)
    const next = hasTimes ? slotTimes(table, slot, view.state.schema) : withTimeColumn(table, slot, view.state.schema, timeFormatSetting())
    tr.replaceWith(pos, pos + table.nodeSize, next)
  }
  view.dispatch(tr)
}

/**
 * Go to now (YAZ-4164 D11): the caret in the first empty cell of the now row of the table at `at` (the note's first
 * calendar table when absent); a row with no empty cell takes it at the end of its first cell after the time. The row
 * scrolls to the middle of the screen (the YAZ-4163 demo: "into view" left it at an edge, or under a pinned header). `false`, and no caret move, when there is no calendar table or no row holds the current minute.
 * A now row in a folded run opens the run in the same step (YAZ-4165), so the caret is never in a hidden row. A
 * read-only note never changes (YAZ-4176): its run stays folded, the caret does not move, and its bar scrolls to the middle.
 */
export function goToNow(view: EditorView, at?: number): boolean {
  const { doc } = view.state
  const pos = at ?? calendarTables(doc)[0]
  const table = pos === undefined ? null : doc.nodeAt(pos)
  if (!isCalendar(table)) return false
  const place = nowPlace(table, minutesOf(new Date()))
  if (place === null || place.row === null) return false
  let rowPos = pos! + 1
  for (let r = 0; r < place.row; r++) rowPos += table.child(r).nodeSize
  const row = table.child(place.row)
  let cell = -1
  row.forEach((node, offset, c) => {
    if (cell < 0 && c > 0 && !filled(node)) cell = rowPos + 1 + offset
  })
  const end = cell < 0
  if (end) cell = rowPos + 1 + (row.childCount > 1 ? row.child(0).nodeSize : 0)
  const target = end ? cell + doc.nodeAt(cell)!.nodeSize - 1 : cell + 1
  const run = runOf(foldRuns(table), place.row)
  if (run !== undefined && !view.editable) {
    for (let r = run.from; r < place.row; r++) rowPos -= table.child(r).nodeSize
  } else {
    const tr = view.state.tr
    if (run !== undefined) closeHistory(unfoldRun(tr, pos!, place.row))
    // The fold's steps change attributes only: `target` holds in `tr.doc`.
    view.dispatch(tr.setSelection(Selection.near(tr.doc.resolve(target), end ? -1 : 1)))
    view.focus()
  }
  const dom = view.nodeDOM(rowPos)
  // jsdom has no `scrollIntoView`.
  if (dom instanceof Element && typeof dom.scrollIntoView === 'function') dom.scrollIntoView({ block: 'center' })
  return true
}
