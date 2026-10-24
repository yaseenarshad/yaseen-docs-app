/**
 * Obsidian hotkeys (GRO-2027) on top of the outliner keymap (GRO-2012). Bindings come from the
 * vault's `.obsidian/hotkeys.json` + obsidian-toggle-list / obsidian-outliner settings:
 *
 *  - `Mod-Enter`   cycle the list item(s) under the selection: bullet → `[ ]` → `[x]` → bullet.
 *                  Each item cycles from its OWN state (Obsidian toggle-list); only items whose
 *                  first block touches the selection change, so a parent whose text sits above the
 *                  selection stays as it is. Hidden items (a folded item's kids) keep their state
 *                  (YAZ-3209). Outside list items the key falls through (Crepe's table
 *                  `Mod-Enter` = exit table, CodeMirror's = exit code block are untouched).
 *  - `Mod-Shift-u` / `Mod-Shift-i` are coordinated across bullets + headings by foldAllHotkeys.ts.
 *  - `Mod-ArrowUp` / `Mod-ArrowDown` (GRO-2092, Logseq's defaults) fold / unfold the caret's item;
 *                  consumed inside any list item (leaf = no-op), falls through outside lists so the
 *                  native ⌘↑/⌘↓ document jump still works in prose.
 *  - `Mod-Shift-x` toggle strikethrough (Obsidian); Crepe's own `Mod-Alt-x` keeps working.
 *  - `Mod-z`       fold panic-undo (GRO-2075): reverts the most recent fold iff it is the latest
 *                  VIEW action (a zoom after it takes over, GRO-2091 B); declines otherwise, so
 *                  zoom.ts's zoom undo and then history's own `Mod-z` get the key.
 *
 * Registered with priority 100 (above Crepe's 50), like `listCommands.ts`.
 */
import { commandsCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { listItemSchema } from '@milkdown/kit/preset/commonmark'
import { toggleStrikethroughCommand } from '@milkdown/kit/preset/gfm'
import type { NodeType } from '@milkdown/kit/prose/model'
import type { Command, EditorState } from '@milkdown/kit/prose/state'
import { $shortcut } from '@milkdown/kit/utils'
import { coveredLines, eachVisibleTextblock } from '../lineSelection'
import { setOutlineFoldAtSelection, undoLastFold } from './outlineFolding'

/** Priority above Crepe's list/table/base keymaps (default 50). */
const PRIORITY = 100

type Checked = boolean | null

/** bullet → unchecked task → checked task → bullet */
const nextChecked = (checked: Checked): Checked => (checked === null ? false : checked === false ? true : null)

/**
 * Positions of the list_items whose FIRST block overlaps the covered lines (document order;
 * YAZ-3003) and is VISIBLE: a folded item's hidden kids keep their state (YAZ-3209). The walk is
 * widened by one each side so a first block that only touches the range still counts.
 */
const selectedItemPositions = (itemType: NodeType, state: EditorState): number[] => {
  const { from, to } = coveredLines(state)
  const positions: number[] = []
  eachVisibleTextblock(state, Math.max(0, from - 1), Math.min(state.doc.content.size, to + 1), (block, pos, parent, index) => {
    if (parent.type !== itemType || index !== 0) return
    if (from <= pos + block.nodeSize && to >= pos) positions.push(pos - 1)
  })
  return positions
}

const cycleTaskCommand = (itemType: NodeType): Command => (state, dispatch) => {
  const positions = selectedItemPositions(itemType, state)
  if (positions.length === 0) return false
  if (dispatch) {
    const tr = state.tr
    for (const pos of positions) {
      const item = state.doc.nodeAt(pos)
      if (!item) continue
      const checked: Checked = typeof item.attrs.checked === 'boolean' ? item.attrs.checked : null
      tr.setNodeMarkup(pos, undefined, { ...item.attrs, checked: nextChecked(checked) })
    }
    dispatch(tr.scrollIntoView())
  }
  return true
}

/** Keymap plugin; register with `editor.use(obsidianHotkeys)`. */
export const obsidianHotkeys = $shortcut((ctx: Ctx) => {
  const itemType = listItemSchema.type(ctx)
  const strike: Command = () => ctx.get(commandsCtx).call(toggleStrikethroughCommand.key)
  return {
    CycleTask: { key: 'Mod-Enter', priority: PRIORITY, onRun: () => cycleTaskCommand(itemType) },
    FoldItem: { key: 'Mod-ArrowUp', priority: PRIORITY, onRun: () => setOutlineFoldAtSelection(true) },
    UnfoldItem: { key: 'Mod-ArrowDown', priority: PRIORITY, onRun: () => setOutlineFoldAtSelection(false) },
    UndoFold: { key: 'Mod-z', priority: PRIORITY, onRun: () => undoLastFold },
    Strikethrough: { key: 'Mod-Shift-x', priority: PRIORITY, onRun: () => strike },
  }
})
