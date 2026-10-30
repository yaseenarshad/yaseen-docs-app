/**
 * The caret never stays in a hidden line (YAZ-3695, suggestion 11). After a transaction that CHANGES the document, a caret
 * inside a folded bullet's children or a folded heading's section opens the folds that hide it, so the user never types
 * blind: Tab under a folded bullet, Enter at the end of a folded heading, a join that lands in a fold. The folds open
 * through each plugin's own silent unfold, appended to the edit (the same kind of fold change as CMD+F's reveal), so the
 * stored fold keys keep their format and ⌘Z panic-undo is untouched. A caret move alone (arrows, a click) opens nothing.
 * A folded ANCESTOR of the zoomed item hides nothing (the zoom shows it expanded), so only folds at or below it count.
 */
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { $prose } from '@milkdown/kit/utils'
import { addHeadingUnfoldMeta, collapsedHeadingsHiding } from './headingFolding'
import { addOutlineUnfoldMeta, collapsedItemsHiding } from './outlineFolding'
import { getZoomedItemPos } from './zoom'

/** Register with `editor.use(caretReveal)`. */
export const caretReveal = $prose(
  () =>
    new Plugin({
      key: new PluginKey('mdapp-caret-reveal'),
      appendTransaction(trs, _old, state) {
        if (!trs.some((tr) => tr.docChanged)) return null
        const { head } = state.selection
        const zoomed = getZoomedItemPos(state)
        const items = collapsedItemsHiding(state, head).filter((itemPos) => zoomed === null || itemPos >= zoomed)
        const headings = collapsedHeadingsHiding(state, head)
        if (items.length === 0 && headings.length === 0) return null
        const tr = state.tr
        addOutlineUnfoldMeta(tr, items)
        addHeadingUnfoldMeta(tr, headings)
        return tr
      },
    }),
)
