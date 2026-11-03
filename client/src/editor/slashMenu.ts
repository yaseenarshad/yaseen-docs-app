/**
 * The app's own rows on Crepe's slash menu, and the menu in a list item (YAZ-3550).
 *
 * The menu opens in a bullet too (YAZ-3511 D21): the patched Crepe
 * (`client/vendor/milkdown-crepe-7.22.1-yaz3550.*`) drops `isInList` from the menu's
 * `shouldShow` and keeps the code-block check. The same rows, the same look, the same keys —
 * except the two stock rows that cannot work as a list item's block, hidden there:
 *  - Divider: the item becomes a bare line, and remark then writes EVERY item of that list with
 *    `-` (a `* ***` item would read back as a thematic break), so lines the user never touched
 *    change on disk.
 *  - Bullet List: it cannot make a list inside one — it only clears the `/` (and drops a task's
 *    checkbox).
 * Every other row does there what Crepe's command does (a heading, a quote, code or a table inside
 * the item; Task List makes the item a task) — except Text, which runs T's command (YAZ-3806 T4):
 * the item becomes a plain line, out of every list level, as T and ⌘⌥0 make it.
 *
 * In a table cell and a cell note (YAZ-3818 D1) the menu shows only the rows for lines and lists (`HIDDEN_IN_CELL`);
 * a header cell holds one line, so it hides the list rows too (D7). A block put there anyway becomes lines
 * (`table/cellBlocks.ts`).
 *
 * "Table" (YAZ-3696 D12) is the app's own row in Crepe's place (`advancedGroup: { table: null }` in
 * `createCrepe()`), with Crepe's label, icon and position (after Code). In a list item's label line it
 * removes only the `/query`. A line with text stays and a 3×3 table goes BELOW it, inside the item.
 * An empty line (the query was all of it) becomes the table, so the table sits on the marker line,
 * the item's first child, saved `* | … |` (YAZ-3805, demo round 1 decision 11) — except in a task
 * item, which cannot hold a table on its marker line (`* [ ] | a |` reads as text): there the empty
 * line stays and the table goes below. The caret goes in the first header cell — one transaction,
 * one undo step. Anywhere else the row runs Crepe's own three commands, as before.
 *
 * "Calendar table" (YAZ-4163, YAZ-4159 D7) comes right after "Table" and takes the Table row's own path,
 * in a bullet too: the table is `calendarTableNode` (`table/tableCalendar.ts`), "Time | Plan 1" with a row
 * each 30 minutes of Settings › Calendar tables › Calendar day (5:00 am to 10:00 pm by default) in the time format
 * setting, `calendar 30m`, compact rows, the header row and column A frozen, and column A in the middle.
 *
 * "Current time" (YAZ-3511 D22) inserts the time as plain text at the caret, read at the pick, in the
 * time format setting (YAZ-4163 D15; `9:05 am - ` by default), then " - ".
 * It opens the way every stock row does (`clearTextInCurrentBlockCommand` removes the `/query`),
 * then `tr.insertText` — no schema, no mark. Its `keywords` (the patch's second change: the filter
 * matches the label OR a keyword) let "now" and "clock" find it. "Calendar table" holds "time" too,
 * after it, so `/time` + Enter still picks it.
 *
 * 🔒 Crepe keeps the rows in a Vue `computed` that reads only the filter text, so "/" on a plain
 * line and then "/" in a bullet (the same filter, "") would reuse the plain line's rows. The
 * "in a list" flag (and the "in a cell" one) is therefore a Vue `shallowRef` (the copy Crepe itself runs on) that the
 * computed reads through `buildMenu`, and a plugin view sets on every update — before the menu's
 * own 20 ms debounced update shows it.
 */
import type { Ctx } from '@milkdown/kit/ctx'
import { commandsCtx, editorViewCtx } from '@milkdown/kit/core'
import {
  addBlockTypeCommand,
  clearTextInCurrentBlockCommand,
  selectTextNearPosCommand,
  turnIntoTextCommand,
} from '@milkdown/kit/preset/commonmark'
import { createTable } from '@milkdown/kit/preset/gfm'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, type Selection, TextSelection } from '@milkdown/kit/prose/state'
import { $prose } from '@milkdown/kit/utils'
import { formatTime } from '@shared/timeFormat'
import { shallowRef } from 'vue'
import { cellPosAround, isListItem } from './outline/listNodes'
import { inCellOrNote } from './table/cellBlocks'
import { calendarTableNode, minutesOf } from './table/tableCalendar'
import { timeFormatSetting } from './table/timeFormatSetting'

/** One slash row as Crepe's builder takes it (`keywords` is the YAZ-3550 patch's field). */
export interface SlashRow {
  label: string
  icon: string
  keywords?: string[]
  onRun?: (ctx: Ctx) => void
}

/**
 * The slice of Crepe's `GroupBuilder` these rows touch. Crepe exports neither the class nor its
 * config types from the package root, so the shape is structural (as `drawingMenu.ts`'s is);
 * the assignment in `createCrepe()` type-checks it against the real `buildMenu` signature.
 * `build()` hands back the builder's OWN groups (`utils/group-builder.ts`: `build = () => this.#groups`),
 * so replacing a group's `items` here is what the menu then filters and draws.
 */
export interface SlashMenuGroups {
  getGroup: (key: string) => { addItem: (key: string, item: SlashRow) => unknown }
  build: () => { key: string; items: { key: string; onRun?: (ctx: Ctx) => void }[] }[]
}

/** The stock rows hidden in a list item (keys from Crepe's `menu/config.ts`); see the header. */
export const HIDDEN_IN_LIST = ['divider', 'bullet-list'] as const

/**
 * The rows a cell and a cell note hide (YAZ-3818 D1): they hold lines and lists, so no heading, quote, rule, image,
 * code, table (the calendar table too), math or drawing. A header cell holds one line (D7): its list rows go too.
 */
export const HIDDEN_IN_CELL = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'quote', 'divider', 'image', 'code', 'table', 'calendar-table', 'math', 'drawing'] as const
export const HIDDEN_IN_HEADER = [...HIDDEN_IN_CELL, 'bullet-list', 'ordered-list', 'task-list'] as const

/** Where the caret is for the rows: a header cell, another cell or a cell note, or neither. */
export function cellKindAt(selection: Selection): 'header' | 'cell' | null {
  const { $from } = selection
  if (!inCellOrNote($from)) return null
  const cell = cellPosAround($from)
  return cell !== null && $from.doc.nodeAt(cell)!.type.spec.tableRole === 'header_cell' ? 'header' : 'cell'
}

/** The words the filter finds "Current time" by, besides its label (D22). */
export const CURRENT_TIME_KEYWORDS = ['current', 'now', 'clock', 'time']

/** The time in the time format setting, then " - " (D22; YAZ-4163 D15): `9:05 am - ` by default. */
export function formatCurrentTime(date: Date): string {
  return `${formatTime(timeFormatSetting(), minutesOf(date))} - `
}

/** Crepe's own `isInList` (`utils/checker.ts`), the check the patch took out of `shouldShow`. */
export function isInListItem(selection: Selection): boolean {
  return selection.$from.node(selection.$from.depth - 1)?.type.name === 'list_item'
}

/** A clock, drawn to match the stock 24px items (Crepe renders the string as-is). */
const clockIcon = `
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
  >
    <path
      d="M15.3 16.7L16.7 15.3L13 11.6V7H11V12.4L15.3 16.7ZM12 22C10.617 22 9.317 21.737 8.1 21.212C6.883 20.687 5.825 19.975 4.925 19.075C4.025 18.175 3.313 17.117 2.788 15.9C2.263 14.683 2 13.383 2 12C2 10.617 2.263 9.317 2.788 8.1C3.313 6.883 4.025 5.825 4.925 4.925C5.825 4.025 6.883 3.313 8.1 2.788C9.317 2.263 10.617 2 12 2C13.383 2 14.683 2.263 15.9 2.788C17.117 3.313 18.175 4.025 19.075 4.925C19.975 5.825 20.687 6.883 21.212 8.1C21.737 9.317 22 10.617 22 12C22 13.383 21.737 14.683 21.212 15.9C20.687 17.117 19.975 18.175 19.075 19.075C18.175 19.975 17.117 20.687 15.9 21.212C14.683 21.737 13.383 22 12 22ZM12 20C14.217 20 16.104 19.221 17.663 17.663C19.221 16.104 20 14.217 20 12C20 9.783 19.221 7.896 17.663 6.338C16.104 4.779 14.217 4 12 4C9.783 4 7.896 4.779 6.338 6.338C4.779 7.896 4 9.783 4 12C4 14.217 4.779 16.104 6.338 17.663C7.896 19.221 9.783 20 12 20Z"
    />
  </svg>
`

/** The "Current time" row: clear the `/query`, then the time as plain text at the caret. */
export const currentTimeRow: SlashRow = {
  label: 'Current time',
  icon: clockIcon,
  keywords: CURRENT_TIME_KEYWORDS,
  onRun: (ctx) => {
    ctx.get(commandsCtx).call(clearTextInCurrentBlockCommand.key)
    const view = ctx.get(editorViewCtx)
    view.dispatch(view.state.tr.insertText(formatCurrentTime(new Date())))
  },
}

/** The Text row (YAZ-3806 T4): the stock clear of the `/query`, then T's command — Crepe's own row sets a paragraph, which a bullet already is. */
const textRowRun = (ctx: Ctx): void => {
  const commands = ctx.get(commandsCtx)
  commands.call(clearTextInCurrentBlockCommand.key)
  commands.call(turnIntoTextCommand.key)
}

/** Crepe's own table icon (`src/icons/table.ts`; the package does not export it). */
const tableIcon = `
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
  >
    <g clip-path="url(#clip0_977_8078)">
      <path
        d="M20 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H20C21.1 21 22 20.1 22 19V5C22 3.9 21.1 3 20 3ZM20 5V8H5V5H20ZM15 19H10V10H15V19ZM5 10H8V19H5V10ZM17 19V10H20V19H17Z"
      />
    </g>
    <defs>
      <clipPath id="clip0_977_8078">
        <rect width="24" height="24" />
      </clipPath>
    </defs>
  </svg>
`

/** Insert `table` as the "Table" row does (D12, YAZ-3805): in a list item's label line, below the line or in an empty one; see the header. */
function insertTable(ctx: Ctx, table: ProseNode): void {
  const view = ctx.get(editorViewCtx)
  const { $from } = view.state.selection
  if (!isListItem($from.node($from.depth - 1)) || $from.index($from.depth - 1) !== 0) {
    // Crepe's own row (`menu/config.ts`), unchanged.
    const commands = ctx.get(commandsCtx)
    commands.call(clearTextInCurrentBlockCommand.key)
    const { from } = view.state.selection
    commands.call(addBlockTypeCommand.key, { nodeType: table })
    commands.call(selectTextNearPosCommand.key, { pos: from })
    return
  }
  // The query runs from its `/` to the caret; a leaf counts as one character, as in a position.
  const slash = $from.parent.textBetween(0, $from.parentOffset, undefined, '\uFFFC').lastIndexOf('/')
  const tr = view.state.tr
  if (slash >= 0) tr.delete($from.start() + slash, $from.pos)
  const line = tr.mapping.map($from.before())
  const lineSize = tr.doc.nodeAt(line)!.nodeSize
  // An empty line becomes the table (YAZ-3805); a task item keeps it, see the header.
  const onMarker = lineSize === 2 && typeof $from.node($from.depth - 1).attrs.checked !== 'boolean'
  const at = onMarker ? line : line + lineSize
  tr.replaceWith(at, onMarker ? line + lineSize : at, table)
  view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1))).scrollIntoView())
}

/** The "Table" row (D12, YAZ-3805): a 3×3 table; see the header. */
export const tableRow: SlashRow = {
  label: 'Table',
  icon: tableIcon,
  onRun: (ctx) => insertTable(ctx, createTable(ctx, 3, 3)),
}

/** A calendar page, drawn to match the stock 24px items. */
const calendarIcon = `
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
  >
    <path
      d="M5 22C4.45 22 3.979 21.804 3.588 21.413C3.196 21.021 3 20.55 3 20V6C3 5.45 3.196 4.979 3.588 4.588C3.979 4.196 4.45 4 5 4H6V2H8V4H16V2H18V4H19C19.55 4 20.021 4.196 20.413 4.588C20.804 4.979 21 5.45 21 6V20C21 20.55 20.804 21.021 20.413 21.413C20.021 21.804 19.55 22 19 22H5ZM5 20H19V10H5V20ZM5 8H19V6H5V8ZM7 14V12H17V14H7ZM7 18V16H14V18H7Z"
    />
  </svg>
`

/** The words the filter finds "Calendar table" by, besides its label (YAZ-4163 D7). */
export const CALENDAR_TABLE_KEYWORDS = ['calendar', 'schedule', 'plan', 'day', 'time']

/** The "Calendar table" row (YAZ-4163 D7): the Table row's path with a calendar table; see the header. */
export const calendarTableRow: SlashRow = {
  label: 'Calendar table',
  icon: calendarIcon,
  keywords: CALENDAR_TABLE_KEYWORDS,
  onRun: (ctx) => insertTable(ctx, calendarTableNode(ctx.get(editorViewCtx).state.schema)),
}

/**
 * One editor's slash extension: the `buildMenu` for `featureConfigs[CrepeFeature.BlockEdit]`
 * (Current time at the end of the Text group, Table after Code, then `extend` — the Drawing row
 * when the host gives a creator — then the list and cell rules) and the plugin that keeps the "in a list" and "in a
 * cell" flags current: one walk up the caret's depth.
 */
export function createSlashMenu(extend?: (builder: SlashMenuGroups) => void): {
  buildMenu: (builder: SlashMenuGroups) => void
  inListWatch: ReturnType<typeof $prose>
} {
  const inList = shallowRef(false)
  const inCell = shallowRef<'header' | 'cell' | null>(null)
  const buildMenu = (builder: SlashMenuGroups) => {
    builder.getGroup('text').addItem('current-time', currentTimeRow)
    const text = builder.build().find((group) => group.key === 'text')?.items.find((item) => item.key === 'text')
    if (text !== undefined) text.onRun = textRowRun
    builder.getGroup('advanced').addItem('table', tableRow)
    builder.getGroup('advanced').addItem('calendar-table', calendarTableRow)
    extend?.(builder)
    const hidden: readonly string[] = [...(inList.value ? HIDDEN_IN_LIST : []), ...(inCell.value === 'header' ? HIDDEN_IN_HEADER : inCell.value === 'cell' ? HIDDEN_IN_CELL : [])]
    if (hidden.length === 0) return
    for (const group of builder.build()) group.items = group.items.filter((item) => !hidden.includes(item.key))
  }
  const watch = (selection: Selection) => {
    inList.value = isInListItem(selection)
    inCell.value = cellKindAt(selection)
  }
  const inListWatch = $prose(
    () =>
      new Plugin({
        view: (view) => {
          watch(view.state.selection)
          return { update: (next) => watch(next.state.selection) }
        },
      }),
  )
  return { buildMenu, inListWatch }
}
