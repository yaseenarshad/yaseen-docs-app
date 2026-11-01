/**
 * Hover on wiki links (YAZ-3403): resting the pointer on a resolved `[[link]]` in a note says which page it opens,
 * so the editor's host can show the sidebar's hover panel beside it, with one line on how to open it (YAZ-3935:
 * "⌘-click to open", from the bound gesture; the host reads `editable` for a read-only note's "Click to open"). Wired through `createCrepe({ wikilinkHover })`,
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
import { linkPosAtDOM, wikilinkInnerAt } from './wikilinkClick'
import { WIKILINK_CLASS, WIKILINK_UNRESOLVED_CLASS, linkPageName, type WikilinkResolveSource } from './wikilinkPlugin'
import { viewOnlyLinkTarget, type ViewOnlyLinkSource } from './viewOnlyLinkSource'

/** Where a link hover goes: the editor's host. */
export interface WikilinkHover {
  /** The pointer came onto a resolved link: the page it opens, the link's box on screen, and whether the note is editable (the card's open line, YAZ-3935). */
  onHover: (path: string, rect: AnchorRect, editable: boolean) => void
  /** The pointer left the link. */
  onLeave: () => void
  /** A Markdown link pill's address as the page it opens (YAZ-3609 D20), as a click resolves it; null when it opens none. */
  markdownPath?: (href: string) => string | null
}

const wikilinkHoverKey = new PluginKey('mdapp-wikilink-hover')

/** The page a collapsed, resolved link span opens, or null. */
function linkPathOf(view: EditorView, target: EventTarget | null, source: WikilinkResolveSource, viewOnly: ViewOnlyLinkSource, hover: WikilinkHover): { span: Element; path: string } | null {
  if (!(target instanceof Element)) return null
  const span = target.closest(`.${WIKILINK_CLASS}`)
  if (span === null || span.classList.contains(WIKILINK_UNRESOLVED_CLASS) || !view.dom.contains(span)) return null
  // A Markdown link pill (D19) previews the page its address opens, as a `[[link]]` does (D20).
  if (span.classList.contains('link-pill')) {
    const href = span.closest('a')?.getAttribute('href') ?? null
    const path = href === null ? null : (hover.markdownPath?.(href) ?? null)
    return path === null ? null : { span, path }
  }
  const inner = wikilinkInnerAt(view.state.doc, linkPosAtDOM(view, span))
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

/** Marks the editor while the pointer is on a Markdown link pill, so its CSS hides Crepe's address bar there (D20). */
function pillHover(view: EditorView, on: boolean): void {
  view.dom.closest('.milkdown')?.toggleAttribute('data-pill-hover', on)
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
              const link = linkPathOf(view, event.target, source, viewOnly, hover)
              if (link === null || link.path === current) return false
              if (current !== null) hover.onLeave()
              current = link.path
              // On a pill the page preview stands in for the editor's own address bar (D20): it says where the link goes.
              pillHover(view, link.span.classList.contains('link-pill'))
              const box = link.span.getBoundingClientRect()
              hover.onHover(link.path, { left: box.left, top: box.top, right: box.right, bottom: box.bottom }, view.editable)
              return false
            },
            mouseout: (view, event) => {
              if (current === null) return false
              // Onto another segment of the same link (or a link to the same page): the hover stays.
              if (linkPathOf(view, event.relatedTarget, source, viewOnly, hover)?.path === current) return false
              current = null
              pillHover(view, false)
              hover.onLeave()
              return false
            },
          },
        },
      }),
  )
}
