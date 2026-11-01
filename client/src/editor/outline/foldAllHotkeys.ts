/**
 * Document-wide fold-all hotkeys. Bullet and heading folds keep independent plugin state, but
 * Cmd+Shift+U / Cmd+Shift+I are one user gesture: one metadata-only transaction updates both and
 * one Cmd+Z restores both exact prior sets. Individual chevrons and caret-local folds stay owned by
 * their existing keymaps. The note's fold-all button (YAZ-3938, `FoldAllButton.tsx`) runs the same
 * command, so one Cmd+Z undoes a click too, and `foldsChanged` tells the button when to read again.
 */
import { type Command, type EditorState, Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { $prose, $shortcut } from '@milkdown/kit/utils'
import type { FoldNext } from '../FoldAllButton'
import { rowShortcuts } from '../noteKeys'
import { addHeadingFoldAllMeta, addHeadingFoldUndoMeta, hasHeadingFoldMeta } from './headingFolding'
import { addOutlineFoldAllMeta, addOutlineFoldUndoMeta, hasOutlineFoldMeta } from './outlineFolding'
import { VIEW_ACTION_META, type ViewAction } from './viewActions'

const PRIORITY = 100

/** Every bullet and heading fold at once, one ⌘Z: the keys' command, the fold-all button's (YAZ-3938) and the fold chevron's Collapse all / Expand all (YAZ-3727 D23). `true` folds, `false` opens. */
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

/** The DOM event on the editor's `view.dom` after a transaction that changed a fold (YAZ-3938 D9): the fold-all button reads again. */
export const FOLDS_CHANGED_EVENT = 'yaseendocs:folds-changed'

const foldsChangedKey = new PluginKey<number>('yaseenFoldsChanged')

/**
 * Counts the transactions that change a fold, and sends `FOLDS_CHANGED_EVENT` when the count moves. Every fold change
 * carries the bullet or heading plugin's own meta: a chevron, a key, the button, and the silent ones too, which have
 * no view-action stamp (the caret guard that an edit runs, ⌘Z's fold history, Find's reveal; YAZ-4009). A keystroke
 * costs two meta lookups and one compare (D2).
 */
export const foldsChanged = $prose(
  () =>
    new Plugin<number>({
      key: foldsChangedKey,
      state: { init: () => 0, apply: (transaction, count) => (hasOutlineFoldMeta(transaction) || hasHeadingFoldMeta(transaction) ? count + 1 : count) },
      view: () => ({
        update: (view, before) => {
          if (foldsChangedKey.getState(view.state) !== foldsChangedKey.getState(before)) view.dom.dispatchEvent(new Event(FOLDS_CHANGED_EVENT))
        },
      }),
    }),
)

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
