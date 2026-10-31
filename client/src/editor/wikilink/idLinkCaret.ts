/**
 * An ID link is one unit (YAZ-3744 D1): it shows its note's title wherever the caret is (`wikilinkPlugin.ts`
 * `showsTitle`). The raw `[[<id>]]` opens only from the link menu's "Edit link", and closes when the caret leaves it.
 *  - A caret or a selection end that lands inside a closed ID link steps over it: from one edge (an arrow) to the
 *    other edge, from anywhere else (a click, ↑/↓) to the nearer edge. Shift moves the head the same way.
 *  - Backspace right after it, and Delete right before it, remove the whole link. ⌘Z puts it back.
 * An open link (the selection was strictly inside it before this change) keeps the caret where it goes.
 */
import { Plugin, PluginKey, TextSelection, type EditorState } from '@milkdown/kit/prose/state'
import { $prose } from '@milkdown/kit/utils'
import { wikilinkMatchAt } from './wikilinkClick'
import { showsTitle, type WikilinkResolveSource } from './wikilinkPlugin'

/** Set on "Edit link"'s selection (`wikilinkMenu.ts`): the one way into an ID link. */
export const OPEN_ID_LINK = 'mdapp-open-id-link'

/** The ID link that shows a title and holds `pos` strictly inside it, or null. */
function idLinkAround(state: EditorState, pos: number, source: WikilinkResolveSource): { from: number; to: number } | null {
  const match = wikilinkMatchAt(state.doc, pos)
  return match !== null && pos > match.from && showsTitle(match.inner, source) ? match : null
}

export const createIdLinkCaret = (source: WikilinkResolveSource) =>
  $prose(
    () =>
      new Plugin({
        key: new PluginKey('mdapp-id-link-caret'),
        appendTransaction: (trs, before, state) => {
          // An edit maps the caret: inside an open link it moves as it types. Only a caret move is stepped: a redraw or an
          // index update sets no selection, and costs no scan. A composition (an accent, a Japanese word) is left alone
          // until it ends: it owns the caret meanwhile.
          let moved = false
          for (const tr of trs) {
            if (tr.docChanged || tr.getMeta(OPEN_ID_LINK) !== undefined || tr.getMeta('composition') !== undefined) return null
            moved ||= tr.selectionSet
          }
          if (!moved || !(state.selection instanceof TextSelection)) return null
          const { anchor, head, empty } = state.selection
          const link = idLinkAround(state, head, source)
          const was = before.selection.head
          if (link === null || (was > link.from && was < link.to)) return null
          const edge = was === link.from ? link.to : was === link.to ? link.from : head - link.from <= link.to - head ? link.from : link.to
          return state.tr.setSelection(TextSelection.create(state.doc, empty ? edge : anchor, edge))
        },
        props: {
          handleKeyDown: (view, event) => {
            const back = event.key === 'Backspace'
            if ((!back && event.key !== 'Delete') || event.metaKey || event.altKey || event.ctrlKey || event.isComposing || !view.state.selection.empty) return false
            const pos = view.state.selection.head
            // The link that ends right at the caret (Backspace), or starts right at it (Delete).
            const link = idLinkAround(view.state, back ? pos - 1 : pos + 1, source)
            if (link === null || (back ? link.to : link.from) !== pos) return false
            view.dispatch(view.state.tr.delete(link.from, link.to).scrollIntoView())
            return true
          },
        },
      }),
  )
