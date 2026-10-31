/**
 * Typing a list marker on a plain line (YAZ-3727 D8, D9). Replaces Milkdown's `wrapInOrderedListInputRule` and
 * `wrapInBulletListInputRule`, which fired inside a bullet (`1. ` at a bullet's start made it a number; `* ` there
 * vanished), fired again on Enter (Milkdown runs its input rules on Enter with `\n`), and undid badly (⌘Z took the typed
 * marker away too, or left `1.` that Enter turned back into a list).
 *
 *  - `listMarkerTyping` ($prose, a `handleTextInput` prop, never an input rule, so Enter never reaches it): a typed SPACE
 *    after `n.` or `*` / `-` / `+` that is the whole text from the line start to the caret, on a line that is in no list
 *    item and not code. The space goes in as plain typing (it joins the typing's undo step); THEN the line becomes a list
 *    line as its own undo step (`closeHistory`). A number starts its list at `n`; right after a numbered list it joins
 *    that list when it follows on (`childCount + order === n`), and a bullet joins a bullet list right above. Inside a
 *    list item the marker stays text (YAZ-1329: `* 6) text` is bullet text).
 *  - `undoListMarker` ($shortcut, Backspace at priority 200, above the outliner's 100): right after a conversion it runs
 *    history `undo`, the same as ⌘Z: the line is plain `1. ` again, caret after the space. A second ⌘Z takes the typed
 *    text away.
 *
 * The "just converted" flag lives in this plugin's state. A document change or a caret move clears it, except an
 * appended transaction (`listMarkers` relabels the new item right after the conversion) and a selection set to where it
 * already was (Crepe's list node view puts the caret back one frame after it mounts the new item).
 */
import { bulletListSchema, listItemSchema, orderedListSchema } from '@milkdown/kit/preset/commonmark'
import { closeHistory, undo } from '@milkdown/kit/prose/history'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { canJoin, findWrapping } from '@milkdown/kit/prose/transform'
import { $prose, $shortcut } from '@milkdown/kit/utils'

/** The whole text before the caret: `n.` (a number) or `*` / `-` / `+` (a bullet). */
const MARKER = /^(?:(\d+)\.|[-*+])$/

const typingKey = new PluginKey<boolean>('YAZ_LIST_MARKER_TYPING')

export const listMarkerTyping = $prose((ctx) => {
  const itemType = listItemSchema.type(ctx)
  const orderedType = orderedListSchema.type(ctx)
  const bulletType = bulletListSchema.type(ctx)
  return new Plugin<boolean>({
    key: typingKey,
    state: {
      init: () => false,
      apply: (tr, prev, oldState, newState) => {
        const meta = tr.getMeta(typingKey) as boolean | undefined
        if (meta !== undefined) return meta
        if (!prev || tr.getMeta('appendedTransaction') !== undefined) return prev
        return !tr.docChanged && newState.selection.eq(oldState.selection)
      },
    },
    props: {
      handleTextInput(view, from, to, text) {
        if (text !== ' ' || from !== to || view.composing) return false
        const $from = view.state.doc.resolve(from)
        if ($from.parent.type.spec.code) return false
        for (let depth = $from.depth - 1; depth > 0; depth--) if ($from.node(depth).type === itemType) return false
        const match = MARKER.exec($from.parent.textBetween(0, $from.parentOffset, undefined, '￼'))
        if (match === null) return false
        view.dispatch(view.state.tr.insertText(' ', from))
        const start = from - match[0].length
        const listType = match[1] === undefined ? bulletType : orderedType
        const order = Number(match[1] ?? 1)
        const tr = closeHistory(view.state.tr.delete(start, from + 1))
        const range = tr.doc.resolve(start).blockRange()
        const wrapping = range && findWrapping(range, listType, listType === orderedType ? { order } : null)
        // No list fits here (a table cell): the space stays as typed text.
        if (!range || !wrapping) return true
        tr.wrap(range, wrapping)
        const before = tr.doc.resolve(start - 1).nodeBefore
        if (before?.type === listType && canJoin(tr.doc, start - 1) && (listType === bulletType || before.childCount + (before.attrs.order as number) === order)) tr.join(start - 1)
        view.dispatch(tr.setMeta(typingKey, true))
        return true
      },
    },
  })
})

export const undoListMarker = $shortcut(() => ({
  UndoListMarker: {
    key: 'Backspace',
    priority: 200,
    onRun: () => (state, dispatch) => typingKey.getState(state) === true && undo(state, dispatch),
  },
}))
