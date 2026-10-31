/**
 * Every `[[link]]` is one unit (YAZ-3744 D1 for ID links; YAZ-3935, point 3 of YAZ-3879, for every link that shows as a
 * pill, `isLinkUnit`): it stays a pill wherever the caret is (`wikilinkPlugin.ts` `opens`). The raw `[[…]]` opens only
 * from the link menu's "Edit link", and closes when the caret leaves it.
 *  - A caret or a selection end that lands inside a closed link steps over it: from one edge (an arrow) to the other
 *    edge, from anywhere else (↑/↓, a drag) to the nearer edge. Shift moves the head the same way. A click on the pill
 *    itself is `wikilinkClick.ts`'s: it puts the caret at the edge the pointer is nearer, by the pill's middle.
 *  - While the mouse button is down (a drag), a head inside a link always goes to the nearer edge (YAZ-3747 demo): the
 *    arrow rule would flip it from edge to edge at each letter the pointer crosses, so the selection flickered.
 *  - Backspace right after it, and Delete right before it, remove the whole link, with ⌥ or as ⌃H / ⌃D too. ⌘Z puts it back.
 *  - A double-click on a word next to a link selects only that word (C2): the browser's word can run on into the pill's
 *    text, hidden or shown, so the selection is cut at the links on each side of the word clicked.
 * An open link (the selection was strictly inside it before this change) keeps the caret where it goes.
 *
 * The check per caret move is one scan of the caret's textblock for the match under it; no index lookup.
 */
import { Plugin, PluginKey, TextSelection, type EditorState } from '@milkdown/kit/prose/state'
import { $prose } from '@milkdown/kit/utils'
import { wikilinkMatchAt } from './wikilinkClick'
import { WIKILINK_CLASS, WIKILINK_RE, eachPlainRun, isLinkUnit } from './wikilinkPlugin'

/** Set on "Edit link"'s selection (`wikilinkMenu.ts`): the one way into a link. */
export const OPEN_ID_LINK = 'mdapp-open-id-link'

/** The link that is a unit and holds `pos` strictly inside it, or null. */
function linkAround(state: EditorState, pos: number): { from: number; to: number } | null {
  const match = wikilinkMatchAt(state.doc, pos)
  return match !== null && pos > match.from && isLinkUnit(match.inner) ? match : null
}

/** The span between the units of `pos`'s textblock that holds `pos`: the most a word clicked at `pos` may cover. */
function gapAround(state: EditorState, pos: number): { from: number; to: number } | null {
  const $pos = state.doc.resolve(pos)
  if (!$pos.parent.isTextblock) return null
  let from = $pos.start()
  let to = $pos.end()
  eachPlainRun($pos.parent, $pos.start(), (text, runPos) => {
    for (const m of text.matchAll(WIKILINK_RE)) {
      if (m[1] === '!' || !isLinkUnit(m[2])) continue
      const start = runPos + m.index
      const end = start + m[0].length
      if (end <= pos) from = Math.max(from, end)
      else if (start >= pos) to = Math.min(to, start)
      else {
        // The word is the link itself (no click plugin took the double-click): exactly the link.
        from = start
        to = end
      }
    }
  })
  return { from, to }
}

/** How long after a double-click its word selection may arrive (the browser makes it at once; ProseMirror reads it a moment later). */
const WORD_MS = 500

export const createIdLinkCaret = () => {
  /** Where the latest double-click on text (not on a pill) landed, and when, until its word selection arrives. */
  let word: { pos: number; at: number } | null = null
  /** Whether the main button is down: a drag's head inside a link goes to the nearer edge. */
  let pointer = false
  return $prose(
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
          if (!empty && word !== null) {
            // The double-click's word (C2), the first range after it: cut where a link starts or ends, on the word's side of it.
            const gap = Date.now() - word.at < WORD_MS ? gapAround(state, word.pos) : null
            word = null
            const from = Math.max(state.selection.from, gap?.from ?? 0)
            const to = Math.min(state.selection.to, gap?.to ?? state.doc.content.size)
            if (gap !== null && from < to && (from !== state.selection.from || to !== state.selection.to)) {
              return state.tr.setSelection(anchor <= head ? TextSelection.create(state.doc, from, to) : TextSelection.create(state.doc, to, from))
            }
          }
          const link = linkAround(state, head)
          const was = before.selection.head
          if (link === null || (was > link.from && was < link.to)) return null
          const nearer = head - link.from <= link.to - head ? link.from : link.to
          const edge = pointer ? nearer : was === link.from ? link.to : was === link.to ? link.from : nearer
          return state.tr.setSelection(TextSelection.create(state.doc, empty ? edge : anchor, edge))
        },
        props: {
          handleDOMEvents: {
            mousedown: (view, event) => {
              if (event.button === 0 && !pointer) {
                pointer = true
                view.dom.ownerDocument.addEventListener('mouseup', () => (pointer = false), { once: true, capture: true })
              }
              // Only a double-click on text is noted; the click itself stays the browser's.
              const onPill = event.target instanceof Element && event.target.closest(`.${WIKILINK_CLASS}`) !== null
              word = null
              if (event.detail !== 2 || event.button !== 0 || onPill) return false
              try {
                const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
                word = pos === undefined ? null : { pos, at: Date.now() }
              } catch {
                word = null // no layout (a test's DOM): the word is the browser's alone
              }
              return false
            },
          },
          handleKeyDown: (view, event) => {
            // ⌥⌫ and ⌃H delete back too, ⌥⌦ and ⌃D forward (macOS): left to the browser, they would cut the hidden text (YAZ-3747 checker).
            const back = event.key === 'Backspace' || (event.ctrlKey && event.key === 'h')
            const forward = event.key === 'Delete' || (event.ctrlKey && event.key === 'd')
            if ((!back && !forward) || event.metaKey || event.isComposing || !view.state.selection.empty) return false
            const pos = view.state.selection.head
            // The link that ends right at the caret (Backspace), or starts right at it (Delete).
            const link = linkAround(view.state, back ? pos - 1 : pos + 1)
            if (link === null || (back ? link.to : link.from) !== pos) return false
            view.dispatch(view.state.tr.delete(link.from, link.to).scrollIntoView())
            return true
          },
        },
      }),
  )
}
