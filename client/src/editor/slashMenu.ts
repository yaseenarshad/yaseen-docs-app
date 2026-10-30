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
 * the item; Task List makes the item a task).
 *
 * "Table" (YAZ-3696 D12) is the app's own row in Crepe's place (`advancedGroup: { table: null }` in
 * `createCrepe()`), with Crepe's label, icon and position (after Code). In a list item's label line it
 * removes only the `/query`, keeps the line (empty when the query was all of it) and puts a 3×3
 * table BELOW it, inside the item, the caret in the first header cell — one transaction, one undo
 * step. Crepe's row replaced the line, so the table sat on the marker line. Anywhere else the row
 * runs Crepe's own three commands, as before.
 *
 * "Current time" (YAZ-3511 D22) inserts `h:mmam - ` as plain text at the caret, read at the pick.
 * It opens the way every stock row does (`clearTextInCurrentBlockCommand` removes the `/query`),
 * then `tr.insertText` — no schema, no mark. Its `keywords` (the patch's second change: the filter
 * matches the label OR a keyword) let "now" and "clock" find it; nothing else on the menu holds
 * "time", so `/time` + Enter picks it.
 *
 * 🔒 Crepe keeps the rows in a Vue `computed` that reads only the filter text, so "/" on a plain
 * line and then "/" in a bullet (the same filter, "") would reuse the plain line's rows. The
 * "in a list" flag is therefore a Vue `shallowRef` (the copy Crepe itself runs on) that the
 * computed reads through `buildMenu`, and a plugin view sets on every update — before the menu's
 * own 20 ms debounced update shows it.
 */
import type { Ctx } from '@milkdown/kit/ctx'
import { commandsCtx, editorViewCtx } from '@milkdown/kit/core'
import {
  addBlockTypeCommand,
  clearTextInCurrentBlockCommand,
  selectTextNearPosCommand,
} from '@milkdown/kit/preset/commonmark'
import { createTable } from '@milkdown/kit/preset/gfm'
import { Plugin, type Selection, TextSelection } from '@milkdown/kit/prose/state'
import { $prose } from '@milkdown/kit/utils'
import { shallowRef } from 'vue'
import { isListItem } from './outline/listNodes'

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
  build: () => { key: string; items: { key: string }[] }[]
}

/** The stock rows hidden in a list item (keys from Crepe's `menu/config.ts`); see the header. */
export const HIDDEN_IN_LIST = ['divider', 'bullet-list'] as const

/** The words the filter finds "Current time" by, besides its label (D22). */
export const CURRENT_TIME_KEYWORDS = ['current', 'now', 'clock', 'time']

/** `9:05am - `: the hour 1-12 without a leading zero, two-digit minutes, am/pm, then " - " (D22). */
export function formatCurrentTime(date: Date): string {
  const hours = date.getHours()
  const hour = hours % 12 === 0 ? 12 : hours % 12
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hour}:${minutes}${hours < 12 ? 'am' : 'pm'} - `
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

/** The "Table" row (D12): in a list item's label line, the table goes below the line; see the header. */
export const tableRow: SlashRow = {
  label: 'Table',
  icon: tableIcon,
  onRun: (ctx) => {
    const view = ctx.get(editorViewCtx)
    const { $from } = view.state.selection
    if (!isListItem($from.node($from.depth - 1)) || $from.index($from.depth - 1) !== 0) {
      // Crepe's own row (`menu/config.ts`), unchanged.
      const commands = ctx.get(commandsCtx)
      commands.call(clearTextInCurrentBlockCommand.key)
      const { from } = view.state.selection
      commands.call(addBlockTypeCommand.key, { nodeType: createTable(ctx, 3, 3) })
      commands.call(selectTextNearPosCommand.key, { pos: from })
      return
    }
    // The query runs from its `/` to the caret; a leaf counts as one character, as in a position.
    const slash = $from.parent.textBetween(0, $from.parentOffset, undefined, '\uFFFC').lastIndexOf('/')
    const tr = view.state.tr
    if (slash >= 0) tr.delete($from.start() + slash, $from.pos)
    const at = tr.mapping.map($from.after())
    tr.insert(at, createTable(ctx, 3, 3))
    view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1))).scrollIntoView())
  },
}

/**
 * One editor's slash extension: the `buildMenu` for `featureConfigs[CrepeFeature.BlockEdit]`
 * (Current time at the end of the Text group, Table after Code, then `extend` — the Drawing row
 * when the host gives a creator — then the list rule) and the plugin that keeps the "in a list" flag current.
 */
export function createSlashMenu(extend?: (builder: SlashMenuGroups) => void): {
  buildMenu: (builder: SlashMenuGroups) => void
  inListWatch: ReturnType<typeof $prose>
} {
  const inList = shallowRef(false)
  const buildMenu = (builder: SlashMenuGroups) => {
    builder.getGroup('text').addItem('current-time', currentTimeRow)
    builder.getGroup('advanced').addItem('table', tableRow)
    extend?.(builder)
    if (!inList.value) return
    for (const group of builder.build()) {
      group.items = group.items.filter((item) => !(HIDDEN_IN_LIST as readonly string[]).includes(item.key))
    }
  }
  const inListWatch = $prose(
    () =>
      new Plugin({
        view: (view) => {
          inList.value = isInListItem(view.state.selection)
          return { update: (next) => void (inList.value = isInListItem(next.state.selection)) }
        },
      }),
  )
  return { buildMenu, inListWatch }
}
