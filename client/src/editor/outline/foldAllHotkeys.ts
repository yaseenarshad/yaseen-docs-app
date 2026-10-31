/**
 * Document-wide fold-all hotkeys. Bullet and heading folds keep independent plugin state, but
 * Cmd+Shift+U / Cmd+Shift+I are one user gesture: one metadata-only transaction updates both and
 * one Cmd+Z restores both exact prior sets. Individual chevrons and caret-local folds stay owned by
 * their existing keymaps. The note's fold-all button (YAZ-3938, `FoldAllButton.tsx`) runs the same
 * command, so one Cmd+Z undoes a click too.
 */
import type { Command, EditorState } from '@milkdown/kit/prose/state'
import { $shortcut } from '@milkdown/kit/utils'
import type { FoldNext } from '../FoldAllButton'
import { rowShortcuts } from '../noteKeys'
import { addHeadingFoldAllMeta, addHeadingFoldUndoMeta } from './headingFolding'
import { addOutlineFoldAllMeta, addOutlineFoldUndoMeta } from './outlineFolding'
import { VIEW_ACTION_META, type ViewAction } from './viewActions'

const PRIORITY = 100

/** The keys' command, and the fold-all button's (YAZ-3938): `true` folds every bullet and heading, `false` opens them. */
export const setAllDocumentFolds =
  (collapsed: boolean): Command =>
  (state, dispatch) => {
    const transaction = state.tr
    const outlineChanged = addOutlineFoldAllMeta(state, transaction, collapsed)
    const headingChanged = addHeadingFoldAllMeta(state, transaction, collapsed)
    if (!outlineChanged && !headingChanged) return false

    const action: ViewAction = outlineChanged && headingChanged ? 'document-fold' : outlineChanged ? 'fold' : 'heading-fold'
    dispatch?.(transaction.setMeta(VIEW_ACTION_META, action))
    return true
  }

/** What the fold-all button does now (YAZ-3938 D2): with no dispatch, each command only says if it would change a fold. */
export const nextDocumentFold = (state: EditorState): FoldNext =>
  setAllDocumentFolds(true)(state) ? 'collapse' : setAllDocumentFolds(false)(state) ? 'expand' : 'none'

/** Only consumes Cmd+Z when both plugins have a pending undo — the signature of one combined fold. */
const undoCombinedDocumentFold: Command = (state, dispatch) => {
  const transaction = state.tr
  const outlinePending = addOutlineFoldUndoMeta(state, transaction)
  const headingPending = addHeadingFoldUndoMeta(state, transaction)
  if (!outlinePending || !headingPending) return false
  dispatch?.(transaction.setMeta(VIEW_ACTION_META, 'document-fold' satisfies ViewAction))
  return true
}

/** The keys are the rows' (`shared/keys/note.ts`, YAZ-3564 K4). */
export const foldAllHotkeys = $shortcut((ctx) => ({
  ...rowShortcuts(ctx, 'note.foldAll', 'FoldAllDocument', { priority: PRIORITY, onRun: () => setAllDocumentFolds(true) }),
  ...rowShortcuts(ctx, 'note.unfoldAll', 'UnfoldAllDocument', { priority: PRIORITY, onRun: () => setAllDocumentFolds(false) }),
  ...rowShortcuts(ctx, 'note.undo', 'UndoCombinedDocumentFold', { priority: PRIORITY, onRun: () => undoCombinedDocumentFold }),
}))
