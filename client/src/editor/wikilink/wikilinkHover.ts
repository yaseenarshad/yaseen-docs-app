/**
 * Hover on wiki links (YAZ-3403): resting the pointer on a resolved `[[link]]` in a note says which page it opens,
 * so the editor's host can show the sidebar's hover panel beside it. Wired through `createCrepe({ wikilinkHover })`,
 * and only by the note editor: the read-only previews never pass it.
 *
 * On the view's own DOM events (`handleDOMEvents`), never a document listener: many editors are mounted at once.
 * The page is resolved as a click resolves it (`wikilinkClick.ts`): the collapsed `.wikilink` span, the match under
 * it, its page name, then the vault's resolver — or, for a link to a file that only views, the view-only catalog.
 * An unresolved link, a revealed (raw) one and `[[#heading]]` say nothing. Which pages preview is the host's to
 * decide (a note or a board).
 */
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import type { AnchorRect } from '../../sidebar/previewPlacement'
import { wikilinkInnerAt } from './wikilinkClick'
import { WIKILINK_CLASS, WIKILINK_UNRESOLVED_CLASS, linkPageName, type WikilinkResolveSource } from './wikilinkPlugin'
import { viewOnlyLinkTarget, type ViewOnlyLinkSource } from './viewOnlyLinkSource'

/** Where a link hover goes: the editor's host. */
export interface WikilinkHover {
  /** The pointer came onto a resolved link: the page it opens, and the link's box on screen. */
  onHover: (path: string, rect: AnchorRect) => void
  /** The pointer left the link. */
  onLeave: () => void
}

const wikilinkHoverKey = new PluginKey('mdapp-wikilink-hover')

/** The page a collapsed, resolved link span opens, or null. */
function linkPathOf(view: EditorView, target: EventTarget | null, source: WikilinkResolveSource, viewOnly: ViewOnlyLinkSource): { span: Element; path: string } | null {
  if (!(target instanceof Element)) return null
  const span = target.closest(`.${WIKILINK_CLASS}`)
  if (span === null || span.classList.contains(WIKILINK_UNRESOLVED_CLASS) || !view.dom.contains(span)) return null
  const inner = wikilinkInnerAt(view.state.doc, view.posAtDOM(span, 0))
  if (inner === null) return null
  const page = linkPageName(inner)
  if (page === '') return null
  const viewTarget = viewOnlyLinkTarget(inner)
  if (viewTarget !== null) {
    const path = viewTarget.hasSubtarget ? null : (viewOnly.resolve?.(viewTarget.page) ?? null)
    return path === null ? null : { span, path }
  }
  const path = source.resolve?.(page) ?? null
  return path === null ? null : { span, path }
}

export function createWikilinkHover(source: WikilinkResolveSource, hover: WikilinkHover, viewOnly: ViewOnlyLinkSource) {
  /** The page of the link the pointer is on, or null: a move between a link's own segments is no new hover. */
  let current: string | null = null
  return $prose(
    () =>
      new Plugin({
        key: wikilinkHoverKey,
        props: {
          handleDOMEvents: {
            mouseover: (view, event) => {
              const link = linkPathOf(view, event.target, source, viewOnly)
              if (link === null || link.path === current) return false
              if (current !== null) hover.onLeave()
              current = link.path
              const box = link.span.getBoundingClientRect()
              hover.onHover(link.path, { left: box.left, top: box.top, right: box.right, bottom: box.bottom })
              return false
            },
            mouseout: (view, event) => {
              if (current === null) return false
              // Onto another segment of the same link (or a link to the same page): the hover stays.
              if (linkPathOf(view, event.relatedTarget, source, viewOnly)?.path === current) return false
              current = null
              hover.onLeave()
              return false
            },
          },
        },
      }),
  )
}
