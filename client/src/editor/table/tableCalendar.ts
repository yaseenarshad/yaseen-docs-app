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
 * time in column A adds a "Time" column, from 7:00 am; on a table with times it is `slotTimes`, which keeps all text:
 * a row with text keeps its time, also off the new grid, an empty row off the grid goes, and the grid times that are
 * missing come back as empty rows. The grid is each multiple of the length from the table's first time to its last
 * (after midnight counting on). New times take the table's own format (`detectTimeFormat`), or the time format setting
 * when it has none. One transaction with the history closed: one ⌘Z.
 */
import { closeHistory } from '@milkdown/kit/prose/history'
import type { Node as ProseNode, NodeType, Schema } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { detectTimeFormat, formatTime, readTime } from '@shared/timeFormat'
import { changedTables, typingOnly } from './tableStyle'
import { timeFormatSetting } from './timeFormatSetting'

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

/** The decorations of one calendar table at `minutes`: its past rows and its now row. */
function calendarDecorations(table: ProseNode, pos: number, minutes: number): Decoration[] {
  const place = nowPlace(table, minutes)
  if (place === null) return []
  const out: Decoration[] = []
  table.forEach((row, offset, r) => {
    const from = pos + 1 + offset
    if (r > 0 && r < place.pastEnd) out.push(Decoration.node(from, from + row.nodeSize, { class: 'table-past-row' }, { calendar: true }))
    if (r === place.row) {
      const fraction = String(Math.round(place.fraction * 1000) / 1000)
      out.push(Decoration.node(from, from + row.nodeSize, { class: 'table-now-row', style: `--table-now: ${fraction}` }, { calendar: true }))
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

const build = (doc: ProseNode, tables: number[], now: number): DecorationSet =>
  DecorationSet.create(doc, tables.flatMap((pos) => calendarDecorations(doc.nodeAt(pos)!, pos, now)))

/** The tick (D2): the marks move to `minutes`, and the document does not change. */
export function calendarTick(view: EditorView, minutes = minutesOf(new Date())): void {
  view.dispatch(view.state.tr.setMeta(calendarKey, minutes).setMeta('addToHistory', false))
}

/** The calendar state of `state`, for the menus (`tableRows.ts`) and the go-to-now request. */
export const calendarStateOf = (state: EditorState): CalendarState | undefined => calendarKey.getState(state)

/** One editor's clock: a timer to the next whole minute while the note has a calendar table. */
class CalendarClock {
  #timer: ReturnType<typeof setTimeout> | null = null
  #onScreen = true
  #observer: IntersectionObserver | null = null

  constructor(readonly view: EditorView) {
    document.addEventListener('visibilitychange', this.#shown)
    if (typeof IntersectionObserver !== 'undefined') {
      this.#observer = new IntersectionObserver((entries) => {
        const was = this.#onScreen
        this.#onScreen = entries.some((entry) => entry.isIntersecting)
        if (this.#onScreen && !was) this.#tick()
      })
      this.#observer.observe(view.dom)
    }
    this.update()
  }

  update(): void {
    const want = (calendarKey.getState(this.view.state)?.tables.length ?? 0) > 0
    if (want && this.#timer === null) this.#schedule()
    else if (!want && this.#timer !== null) this.#stop()
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
            return { set: build(doc, tables, now), tables, now }
          },
          apply: (tr: Transaction, value) => {
            const tick = tr.getMeta(calendarKey) as number | undefined
            if (!tr.docChanged) return tick === undefined || tick === value.now ? value : { ...value, set: build(tr.doc, value.tables, tick), now: tick }
            let set = value.set.map(tr.mapping, tr.doc)
            const mapped = value.tables.map((pos) => tr.mapping.map(pos))
            // A key changes no table's shape, attributes or slots: the mapped set holds (YAZ-3790).
            if (typingOnly(tr)) return { ...value, set, tables: mapped }
            const changed = changedTables(tr)
            for (const [pos, node] of changed) {
              const end = pos + node.nodeSize
              const stale = set.find(pos, end, (spec) => spec.calendar === true)
              if (stale.length > 0) set = set.remove(stale)
              const fresh = calendarDecorations(node, pos, value.now)
              if (fresh.length > 0) set = set.add(tr.doc, fresh)
            }
            const tables = [...new Set([...mapped, ...changed.keys()])].filter((pos) => isCalendar(tr.doc.nodeAt(pos))).sort((a, b) => a - b)
            return { ...value, set, tables }
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
 * "/Calendar table"'s table (D7, D10): "Time | Plan 1", a row each 30 minutes from 7:00 am to 10:00 pm in `format`,
 * `calendar 30m`, compact rows, the header row and column A frozen.
 */
export function calendarTableNode(schema: Schema, format = timeFormatSetting()): ProseNode {
  const { table, table_header_row: headerRow, table_row: row, table_header: header, table_cell: cell } = schema.nodes
  const rows = [headerRow!.create(null, [cellNode(schema, header!, 'Time'), cellNode(schema, header!, 'Plan 1')])]
  for (let t = 7 * 60; t <= 22 * 60; t += 30) rows.push(row!.create(null, [cellNode(schema, cell!, formatTime(format, t)), cellNode(schema, cell!, '')]))
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
  const template = body[0]!.row
  const emptyRow = (time: number): ProseNode => {
    const cells: ProseNode[] = []
    template.forEach((c, _, i) => cells.push(cellNode(schema, c.type, i === 0 ? formatTime(format, time) : '', { alignment: c.attrs.alignment, colwidth: c.attrs.colwidth })))
    return template.type.create(null, cells)
  }
  const added = grid.filter((t) => !have.has(t)).map((time) => ({ time, row: emptyRow(time) }))
  // Stable: a new row goes after the kept rows of an earlier time, before those of a later one.
  const rows = [...kept, ...added].map((entry, i) => ({ ...entry, i })).sort((a, b) => a.time - b.time || a.i - b.i)
  return table.type.create(attrs, [table.firstChild!, ...rows.map(({ row }) => row)])
}

/** The table with a "Time" column before column A, a time in each body row from 7:00 am, `slot` apart (D7). */
function withTimeColumn(table: ProseNode, slot: number, schema: Schema, format: string): ProseNode {
  const rows: ProseNode[] = []
  table.forEach((row, _, r) => {
    const type = row.firstChild!.type
    const first = cellNode(schema, type, r === 0 ? 'Time' : formatTime(format, 7 * 60 + (r - 1) * slot))
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
