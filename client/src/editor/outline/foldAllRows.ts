/**
 * Collapse all and Expand all (YAZ-3727 D23): on a line that folds — a bullet with children, or a heading of a level
 * that starts a section, with something in its section — the line's menu carries the note's ⌘⇧U and ⌘⇧I, every bullet and heading at once, one ⌘Z
 * (`setAllDocumentFolds`). It is the one menu of the dot, the text and the fold chevron, so the rows sit with the
 * children rows, not in a menu of their own (demo feedback).
 */
import { keyRow, keysOf } from '@shared/keys'
import { toDisplay } from '@shared/hotkeyBindings'
import { storage } from '../../lib/storage'
import type { Node } from '@milkdown/kit/prose/model'
import type { RowProvider } from '../blockHandleMenu'
import { setAllDocumentFolds } from './foldAllHotkeys'
import { DEEPEST_FOLDABLE_LEVEL, headingLevel } from './headingFolding'
import { childListState } from './numberChildren'

/** A note key's first key as it is now, as a menu writes it ('⌘⇧U'); undefined with no key (the code tab's `hintOf`). */
const hintOf = (rowId: string): string | undefined => {
  const row = keyRow(rowId)
  const key = row === undefined ? undefined : keysOf(row, storage.getSettings()?.hotkeys)[0]
  return key === undefined ? undefined : key.split(' ').map(toDisplay).join(' ')
}

/** A heading at `pos` that starts a section (levels 1-3) and has a block in it: the next block is no heading of its level or above. */
function headingFolds(doc: Node, pos: number): boolean {
  const level = headingLevel(doc.nodeAt(pos) ?? doc)
  if (level === null || level > DEEPEST_FOLDABLE_LEVEL) return false
  const $pos = doc.resolve(pos)
  const next = $pos.parent.maybeChild($pos.index() + 1)
  const nextLevel = next === null ? null : headingLevel(next)
  return next !== null && (nextLevel === null || nextLevel > level)
}

export const foldAllRows: RowProvider = (view, target) => {
  if (target.inside < 0) return []
  const { doc } = view.state
  if (childListState(doc, target.inside) === null && !headingFolds(doc, target.inside)) return []
  const fold = (collapsed: boolean) => () => {
    setAllDocumentFolds(collapsed)(view.state, view.dispatch)
    view.focus()
  }
  return [
    { label: 'Collapse all', hint: hintOf('note.foldAll'), group: 'children', run: fold(true) },
    { label: 'Expand all', hint: hintOf('note.unfoldAll'), group: 'children', run: fold(false) },
  ]
}
