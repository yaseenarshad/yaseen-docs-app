/**
 * ⌘A ON A BULLET (YAZ-4348 demo round 2, Yasin: "when i am on a bullet in a note, and then i hit CMD A, i want it to
 * only highlight the contents of that bullet first, then if i hit CMD A again, it will then highlight the entire
 * page"). The first ⌘A selects the text of the bullet's own line (a bullet, a numbered item or a task; its nested
 * bullets are not part of it). A second ⌘A, on just that, declines, and the page's own select all runs: the whole note.
 *
 * Priority 80: a table cell's and a cell note's ⌘A (`cellNoteCard.ts`, 90) win inside a table. An empty bullet has no
 * text to select, so ⌘A there is the page's at once.
 */
import { type Command, TextSelection } from '@milkdown/kit/prose/state'
import { $shortcut } from '@milkdown/kit/utils'

export const selectBulletText: Command = (state, dispatch) => {
  const { $from, $to, from, to } = state.selection
  // One line: the selection starts and ends in the same textblock, the first child of a list item.
  if (!$from.parent.isTextblock || !$from.sameParent($to) || $from.depth < 2) return false
  const item = $from.node($from.depth - 1)
  if (item.type.name !== 'list_item' || $from.index($from.depth - 1) !== 0) return false
  const start = $from.start()
  const end = $from.end()
  if (start === end || (from === start && to === end)) return false
  dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, start, end)))
  return true
}

export const bulletSelectAllKeymap = $shortcut(() => ({
  BulletSelectAll: { key: 'Mod-a', priority: 80, onRun: () => selectBulletText },
}))
