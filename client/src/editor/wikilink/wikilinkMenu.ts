/**
 * Right-click on an id link (YAZ-2293): a `[[<id>]]` link shows a title and hides the id, so
 * this menu is where the id can be SEEN and copied — the notecard's name, its id, "Copy ID".
 * An id no note has (and any id before the index loads) has no name row; the id and the copy
 * are still offered. A NAME link, a view-only link and plain text keep Electron's native menu:
 * nothing here prevents or draws for them.
 *
 * RIGHT-BUTTON MOUSEDOWN (and a Ctrl-click's) is swallowed on an id link, for
 * `wikilinkClick.ts`'s reason: left to its default the browser puts the caret in the match, the
 * reveal rule drops the rendered span, and `contextmenu` would arrive on raw text.
 *
 * The popup is `blockHandleMenu.ts`'s (`renderMenu`); `openIdMenu` adds the placement and the
 * dismissal and knows nothing of the editor, so another surface showing an id can open the same
 * menu on its own element. Only the doc-change close is the plugin's.
 */
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { isNoteId } from '@shared/noteId'
import { copyNoteId } from '../../lib/copyNoteId'
import { renderMenu, type MenuRow } from '../blockHandleMenu'
import { wikilinkInnerAt, type WikilinkNav } from './wikilinkClick'
import { WIKILINK_CLASS, idLinkTitle, linkPageName, type WikilinkResolveSource } from './wikilinkPlugin'

const wikilinkMenuKey = new PluginKey('mdapp-wikilink-menu')

/**
 * Opens the menu in `parent` at the pointer, clamped to the viewport: `name` (omitted when the
 * id names no note) and `id` as disabled rows — labels, not actions — then "Copy ID", which
 * copies exactly the id and says so through `onNotice`. Closes on a row click, an outside
 * mousedown, a scroll, Escape and window blur; returns the close for the caller's own reasons.
 * One at a time is the caller's to keep.
 */
export function openIdMenu(parent: HTMLElement, x: number, y: number, name: string | undefined, id: string, onNotice: (message: string) => void): () => void {
  const label = (text: string): MenuRow => ({ label: text, disabled: true, run: () => {} })
  const copy: MenuRow = { label: 'Copy ID', run: () => copyNoteId(id, onNotice) }
  const close = () => {
    document.removeEventListener('mousedown', onMouseDown, true)
    document.removeEventListener('scroll', close, true)
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('blur', close)
    popup.remove()
  }
  const onMouseDown = (event: MouseEvent) => {
    if (!(event.target instanceof Node && popup.contains(event.target))) close()
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') close()
  }
  const popup = renderMenu(parent, [...(name === undefined ? [] : [label(name)]), label(id), copy], close)
  const rect = popup.getBoundingClientRect()
  popup.style.left = `${Math.max(0, Math.min(x, window.innerWidth - rect.width))}px`
  popup.style.top = `${Math.max(0, Math.min(y, window.innerHeight - rect.height))}px`
  document.addEventListener('mousedown', onMouseDown, true)
  document.addEventListener('scroll', close, true)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('blur', close)
  return close
}

/** The id of the rendered (collapsed) id link under `target`, or null — `wikilinkClick`'s hit-test. */
function idLinkAt(view: EditorView, target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null
  const span = target.closest(`.${WIKILINK_CLASS}`)
  if (span === null || !view.dom.contains(span)) return null
  const page = linkPageName(wikilinkInnerAt(view.state.doc, view.posAtDOM(span, 0)) ?? '')
  return isNoteId(page) ? page : null
}

export function createWikilinkMenu(source: WikilinkResolveSource, nav: WikilinkNav) {
  return $prose(() => {
    let close = () => {}
    return new Plugin({
      key: wikilinkMenuKey,
      props: {
        handleDOMEvents: {
          mousedown: (view, event) => {
            // A Ctrl-click is macOS's other right-click, and arrives as a LEFT-button mousedown.
            if (!(event.button === 2 || (event.button === 0 && event.ctrlKey)) || idLinkAt(view, event.target) === null) return false
            event.preventDefault()
            return true
          },
          contextmenu: (view, event) => {
            const id = idLinkAt(view, event.target)
            const parent = view.dom.parentElement
            if (id === null || parent === null) return false
            event.preventDefault()
            close()
            close = openIdMenu(parent, event.clientX, event.clientY, idLinkTitle(id, source.resolve), id, nav.onNotice)
            return true
          },
        },
      },
      view: () => ({
        update: (view, previousState) => {
          if (view.state.doc !== previousState.doc) close()
        },
        destroy: () => close(),
      }),
    })
  })
}
