/**
 * Formatting acts on the lines you SEE (YAZ-3209). A selection over folded bullets, a folded
 * heading, or out of the zoom spans hidden lines. Bold, Italic, Strikethrough, inline code and
 * H1 / H2 / H3 change only the visible ones, and Crepe's toolbar lights Bold, Italic,
 * Strikethrough and code only for a mark on a visible line. `⌘C` / `⌘X` still carry the hidden
 * lines (YAZ-1734 D6, D7). Underline (`marks/underline.ts`), the swatches (`marks/highlight.ts`),
 * `Mod-Enter` (`outline/hotkeys.ts`), and T and the list buttons (`listButtons.ts`) use the same
 * helpers from `lineSelection.ts`.
 *
 * Milkdown's own commands are re-registered under their SAME keys, so Crepe's toolbar buttons and
 * every keymap that calls them by key follow with no other change. `EditorViewReady` comes after
 * every `$command` has registered, so the originals exist when this runs.
 */
import { type CmdKey, type CommandManager, commandsCtx, EditorViewReady } from '@milkdown/kit/core'
import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import {
  inlineCodeSchema,
  isMarkSelectedCommand,
  linkSchema,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleStrongCommand,
  wrapInHeadingCommand,
} from '@milkdown/kit/preset/commonmark'
import { toggleStrikethroughCommand } from '@milkdown/kit/preset/gfm'
import type { MarkType } from '@milkdown/kit/prose/model'
import type { Command } from '@milkdown/kit/prose/state'
import { onVisibleLines, visibleRangeHasMark, visibleRanges } from './lineSelection'

/** Re-register a `toggleMark` / `setBlockType` command wrapped: those walk `selection.ranges`, so `onVisibleLines` is enough. */
const wrap = <T>(commands: CommandManager, key: CmdKey<T>): void => {
  const run = commands.get(key)
  commands.create(key, (payload?: T) => onVisibleLines(run(payload)))
}

/** Milkdown's inline code reads `from` / `to`. The same toggle, once per visible range: adding code drops the other marks, as Milkdown's does. */
const toggleInlineCode = (code: MarkType): Command => (state, dispatch) => {
  const ranges = visibleRanges(state)
  if (state.selection.empty || ranges.length === 0) return false
  const on = visibleRangeHasMark(state, code)
  const tr = state.tr
  for (const { from, to } of ranges) {
    if (on) {
      tr.removeMark(from, to, code)
      continue
    }
    for (const mark of Object.values(state.schema.marks)) if (mark !== code) tr.removeMark(from, to, mark)
    tr.addMark(from, to, code.create())
  }
  dispatch?.(tr)
  return true
}

/** Register with `editor.use(visibleFormatting)`, after the presets. */
export const visibleFormatting: MilkdownPlugin = (ctx) => async () => {
  await ctx.wait(EditorViewReady)
  const commands = ctx.get(commandsCtx)
  for (const { key } of [toggleStrongCommand, toggleEmphasisCommand, toggleStrikethroughCommand]) wrap(commands, key)
  wrap(commands, wrapInHeadingCommand.key)
  commands.create(toggleInlineCodeCommand.key, () => toggleInlineCode(inlineCodeSchema.type(ctx)))
  // The toolbar's lit state: a button lights for a mark on a VISIBLE line only. The Link button
  // keeps Milkdown's whole-range answer: links are out of this rule (S19).
  const isMarkSelected = commands.get(isMarkSelectedCommand.key)
  commands.create(isMarkSelectedCommand.key, (type?: MarkType) =>
    type === undefined || type === linkSchema.type(ctx) ? isMarkSelected(type) : (state) => visibleRangeHasMark(state, type),
  )
}
