/**
 * Obsidian hotkeys (GRO-2027) on top of the outliner keymap (GRO-2012). Bindings come from the
 * vault's `.obsidian/hotkeys.json` + obsidian-toggle-list / obsidian-outliner settings:
 *
 *  - `Mod-Enter`   cycle the list item(s) under the selection: bullet → `[ ]` → `[x]` → bullet.
 *                  The selection moves as ONE group (YAZ-3799): every line goes to the step after
 *                  the line furthest behind, so a mixed selection never ends up out of step. Only
 *                  items whose first block touches the selection change, so a parent whose text
 *                  sits above the selection stays as it is. Hidden items (a folded item's kids)
 *                  keep their state (YAZ-3209). A paragraph or a heading outside a bullet has no
 *                  task state: it counts as a task, not done (plain) or done (struck through, `~~`
 *                  in the file), and never needs the task step (YAZ-3797). Empty lines, a bullet's later paragraphs and
 *                  table cells are left alone, so in a table the key falls through (Crepe's
 *                  `Mod-Enter` = exit table; CodeMirror's = exit code block is untouched).
 *  - `Mod-Shift-u` / `Mod-Shift-i` are coordinated across bullets + headings by foldAllHotkeys.ts.
 *  - `Mod-ArrowUp` / `Mod-ArrowDown` (GRO-2092, Logseq's defaults) fold / unfold the caret's item;
 *                  consumed inside any list item (leaf = no-op), falls through outside lists so the
 *                  native ⌘↑/⌘↓ document jump still works in prose.
 *  - `Mod-Shift-x` toggle strikethrough (Obsidian); Crepe's own `Mod-Alt-x` keeps working (one row,
 *                  `note.strikethrough`, holds both keys and gives them to both keymaps).
 *  - `Mod-z`       fold panic-undo (GRO-2075): reverts the most recent fold iff it is the latest
 *                  VIEW action (a zoom after it takes over, GRO-2091 B); declines otherwise, so
 *                  zoom.ts's zoom undo and then history's own `Mod-z` get the key.
 *
 * Registered with priority 100 (above Crepe's 50), like `listCommands.ts`. The keys above are the
 * defaults: each is a row of `shared/keys/note.ts`, and a user's change replaces it (YAZ-3564 K4).
 */
import { commandsCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { listItemSchema } from '@milkdown/kit/preset/commonmark'
import { strikethroughSchema, toggleStrikethroughCommand } from '@milkdown/kit/preset/gfm'
import type { MarkType, Node, NodeType } from '@milkdown/kit/prose/model'
import type { Command, EditorState } from '@milkdown/kit/prose/state'
import { $shortcut } from '@milkdown/kit/utils'
import { coveredLines, eachVisibleTextblock } from '../lineSelection'
import { rowShortcuts } from '../noteKeys'
import { setOutlineFoldAtSelection, undoLastFold } from './outlineFolding'

/** Priority above Crepe's list/table/base keymaps (default 50). */
const PRIORITY = 100

type Checked = boolean | null

/** The cycle's steps, in order: bullet (`null`) → unchecked task → checked task → bullet. */
const STEPS: Checked[] = [null, false, true]

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

/** A paragraph or heading with text, outside any list item and table cell (YAZ-3797). */
const isFreeLine = (state: EditorState, block: Node, pos: number): boolean => {
  // Text, not only content: an image-only line has nothing to strike (YAZ-3797, final check).
  if (!['paragraph', 'heading'].includes(block.type.name) || !/\S/.test(block.textContent)) return false
  const $pos = state.doc.resolve(pos)
  for (let depth = $pos.depth; depth > 0; depth--) {
    const role = $pos.node(depth).type.spec.tableRole
    if ($pos.node(depth).type.name === 'list_item' || role === 'cell' || role === 'header_cell') return false
  }
  return true
}

/**
 * Positions of the visible free lines the covered lines overlap (document order). Strict overlap: a selected rule or
 * code block only TOUCHES the lines next to it, and they must not change (YAZ-3797, final check).
 */
const selectedFreeLines = (state: EditorState): number[] => {
  const { from, to } = coveredLines(state)
  const positions: number[] = []
  eachVisibleTextblock(state, Math.max(0, from - 1), Math.min(state.doc.content.size, to + 1), (block, pos) => {
    if (from < pos + block.nodeSize && to > pos && isFreeLine(state, block, pos)) positions.push(pos)
  })
  return positions
}

/** True when every text node that can carry the strike has it. */
const allStruck = (block: Node, strike: MarkType): boolean => {
  let struck = true
  block.descendants((node) => {
    if (node.isText && !strike.isInSet(node.marks) && node.marks.every((mark) => !mark.type.excludes(strike))) struck = false
    return struck
  })
  return struck
}

const cycleTaskCommand = (itemType: NodeType, strike: MarkType): Command => (state, dispatch) => {
  const positions = selectedItemPositions(itemType, state)
  const lines = selectedFreeLines(state)
  if (positions.length === 0 && lines.length === 0) return false
  if (dispatch) {
    // Each line's step: an item's own; a free line is a task, done when struck (YAZ-3799).
    const stepOf = (item: Node): number => STEPS.indexOf(typeof item.attrs.checked === 'boolean' ? item.attrs.checked : null)
    const steps = [
      ...positions.map((pos) => stepOf(state.doc.nodeAt(pos)!)),
      ...lines.map((pos) => (allStruck(state.doc.nodeAt(pos)!, strike) ? 2 : 1)),
    ]
    const target = (Math.min(...steps) + 1) % STEPS.length
    const tr = state.tr
    for (const pos of lines) {
      const block = state.doc.nodeAt(pos)!
      if (target === 2) tr.addMark(pos + 1, pos + block.nodeSize - 1, strike.create())
      else tr.removeMark(pos + 1, pos + block.nodeSize - 1, strike)
    }
    for (const pos of positions) {
      const item = state.doc.nodeAt(pos)!
      tr.setNodeMarkup(pos, undefined, { ...item.attrs, checked: STEPS[target] })
    }
    dispatch(tr.scrollIntoView())
  }
  return true
}

/** Keymap plugin; register with `editor.use(obsidianHotkeys)`. */
export const obsidianHotkeys = $shortcut((ctx: Ctx) => {
  const itemType = listItemSchema.type(ctx)
  const strikeType = strikethroughSchema.type(ctx)
  const strike: Command = () => ctx.get(commandsCtx).call(toggleStrikethroughCommand.key)
  // The keys are the rows' (`shared/keys/note.ts`, YAZ-3564 K4).
  return {
    ...rowShortcuts(ctx, 'note.cycleTask', 'CycleTask', { priority: PRIORITY, onRun: () => cycleTaskCommand(itemType, strikeType) }),
    ...rowShortcuts(ctx, 'note.foldHere', 'FoldItem', { priority: PRIORITY, onRun: () => setOutlineFoldAtSelection(true) }),
    ...rowShortcuts(ctx, 'note.unfoldHere', 'UnfoldItem', { priority: PRIORITY, onRun: () => setOutlineFoldAtSelection(false) }),
    ...rowShortcuts(ctx, 'note.undo', 'UndoFold', { priority: PRIORITY, onRun: () => undoLastFold }),
    ...rowShortcuts(ctx, 'note.strikethrough', 'Strikethrough', { priority: PRIORITY, onRun: () => strike }),
  }
})
