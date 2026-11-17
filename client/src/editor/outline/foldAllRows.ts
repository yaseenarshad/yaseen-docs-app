/**
 * Collapse all and Expand all (YAZ-3727 D23): on a line that folds — a bullet with children, or a heading of a level
 * that starts a section, with something in its section — the line's menu carries the page's ⌘⇧U and ⌘⇧I, every bullet and heading at once, one ⌘Z
 * (`setAllDocumentFolds`). It is the one menu of the dot, the text and the fold chevron, so the rows sit with the
 * children rows, not in a menu of their own (demo feedback).
 */
import { hintOf } from '../../lib/keyHint'
import type { Node } from '@milkdown/kit/prose/model'
import type { RowProvider } from '../blockHandleMenu'
import { setAllDocumentFolds } from './foldAllHotkeys'
import { isFoldingOn } from './foldingSwitch'
import { isFoldLocked, toggleFoldLock } from './foldLock'
import { setOutlineFoldLevel } from './outlineFolding'
import { DEEPEST_FOLDABLE_LEVEL, headingLevel } from './headingFolding'
import { childListState } from './numberChildren'

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
  // Folding off (YAZ-4094 F1): nothing on the page folds, so the menu offers no fold rows.
  if (target.inside < 0 || !isFoldingOn(view.state)) return []
  const { doc } = view.state
  if (childListState(doc, target.inside) === null && !headingFolds(doc, target.inside)) return []
  const fold = (collapsed: boolean) => () => {
    setAllDocumentFolds(collapsed)(view.state, view.dispatch)
    view.focus()
  }
  // Lock this row open, or unlock it (YAZ-4094 4A, `foldLock.ts`).
  const lock = () => {
    toggleFoldLock(target.inside)(view.state, view.dispatch)
    view.focus()
  }
  // This bullet's level across the page (YAZ-4786): only when a bullet at that level folds.
  const level = (collapsed: boolean) => () => {
    setOutlineFoldLevel(target.inside, collapsed)(view.state, view.dispatch)
    view.focus()
  }
  const levelRows = setOutlineFoldLevel(target.inside, true)(view.state)
    ? [
        { label: 'Collapse this level', group: 'children', run: level(true) },
        { label: 'Expand this level', group: 'children', run: level(false) },
      ]
    : []
  return [
    { label: 'Collapse all', hint: hintOf('page.foldAll'), group: 'children', run: fold(true) },
    { label: 'Expand all', hint: hintOf('page.unfoldAll'), group: 'children', run: fold(false) },
    ...levelRows,
    { label: isFoldLocked(view.state, target.inside) ? 'Unlock' : 'Lock open', group: 'children', run: lock },
  ]
}
