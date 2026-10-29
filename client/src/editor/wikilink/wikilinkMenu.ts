/**
 * Right-click on a `[[link]]`: the one link menu (YAZ-3609 D23, `linkMenu.ts`). An id link
 * (YAZ-2293) shows a title and hides the id, so this menu is where the id can be SEEN and copied —
 * the note's name, its id, "Copy ID". A link to a folder names it `<name> (folder)`.
 * An id no note has (and any id before the index loads) has no name row; the id and the copy
 * are still offered. A name link and a view-only link get the same menu, with no ID rows; raw
 * text keeps Electron's native menu.
 *
 * RIGHT-BUTTON MOUSEDOWN (and a Ctrl-click's) is swallowed on a collapsed link, for
 * `wikilinkClick.ts`'s reason: left to its default the browser puts the caret in the match, the
 * reveal rule drops the rendered span, and `contextmenu` would arrive on raw text.
 *
 * The popup is `linkMenu.ts`'s (`openMenuAt`); `openIdMenu` knows nothing of the editor, so
 * another surface showing an id can open the id rows on its own element. Only the doc-change close is the plugin's.
 */
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { vaultNoteId } from '@shared/noteId'
import { copyNoteId } from '../../lib/copyNoteId'
import { pathTitles } from '../../lib/pageLabel'
import { folderLabel, folderRecord } from '../../links/shortcuts'
import type { MenuRow } from '../blockHandleMenu'
import { copyLink, linkMenuRows, openMenuAt } from '../linkMenu'
import { wikilinkMatchAt, type WikilinkNav } from './wikilinkClick'
import { WIKILINK_CLASS, idLinkTitle, linkDisplayText, linkPageName, type WikilinkResolveSource } from './wikilinkPlugin'

const wikilinkMenuKey = new PluginKey('mdapp-wikilink-menu')

/**
 * Opens the menu in `parent` at the pointer: `name` (omitted when the id names no note) and `id` as
 * disabled rows — labels, not actions — then "Copy ID", which copies exactly the id and says so
 * through `onNotice`. For a surface that shows an id and is not a link.
 */
export function openIdMenu(parent: HTMLElement, x: number, y: number, name: string | undefined, id: string, onNotice: (message: string) => void): () => void {
  const label = (text: string): MenuRow => ({ label: text, disabled: true, run: () => {} })
  return openMenuAt(parent, x, y, [...(name === undefined ? [] : [label(name)]), label(id), { label: 'Copy ID', run: () => copyNoteId(id, onNotice) }])
}

/** The collapsed `[[link]]` under `target` — `wikilinkClick`'s hit-test — with its range, or null. */
function linkAt(view: EditorView, target: EventTarget | null): { from: number; to: number; inner: string } | null {
  if (!(target instanceof Element)) return null
  const span = target.closest(`.${WIKILINK_CLASS}`)
  if (span === null || !view.dom.contains(span)) return null
  return wikilinkMatchAt(view.state.doc, view.posAtDOM(span, 0))
}

/**
 * The id a link names, or null. Where the vault does not use IDs (`ids`, YAZ-2523 🔒 V5) no link is
 * one; where it does, a link is one when its target is an ID of this vault (`letters`, YAZ-2677 R5):
 * `[[GPT-4]]` is a name there (R6). As the app writes it, whatever the link's case.
 */
function idOf(inner: string, { ids, letters }: Pick<WikilinkResolveSource, 'ids' | 'letters'>): string | null {
  return ids ? (vaultNoteId(linkPageName(inner), letters) ?? null) : null
}

export function createWikilinkMenu(source: WikilinkResolveSource, nav: WikilinkNav, follow: (inner: string, background: boolean) => void) {
  return $prose(() => {
    let close = () => {}
    return new Plugin({
      key: wikilinkMenuKey,
      props: {
        handleDOMEvents: {
          mousedown: (view, event) => {
            // A Ctrl-click is macOS's other right-click, and arrives as a LEFT-button mousedown.
            if (!(event.button === 2 || (event.button === 0 && event.ctrlKey)) || linkAt(view, event.target) === null) return false
            event.preventDefault()
            return true
          },
          contextmenu: (view, event) => {
            const hit = linkAt(view, event.target)
            const parent = view.dom.parentElement
            if (hit === null || parent === null) return false
            event.preventDefault()
            close()
            const { from, to, inner } = hit
            const page = linkPageName(inner)
            const id = idOf(inner, source)
            const titles = pathTitles(source.records, source.folders)
            const title = id === null ? page : idLinkTitle(id, source.resolve, titles)
            // A folder's name row says so: an id is its settings file's, and resolves to its directory.
            const dir = page === '' ? null : source.resolve?.(page)
            const isFolder = dir != null && (id === null ? folderRecord(source.folders, dir) !== undefined : folderRecord(source.folders, dir)?.id === id)
            const name = title === undefined || title === '' ? undefined : isFolder ? folderLabel(title) : title
            close = openMenuAt(
              parent,
              event.clientX,
              event.clientY,
              linkMenuRows({
                labels: [...(name === undefined ? [] : [name]), ...(id === null ? [] : [id])],
                // `[[#heading]]` of this note: the heading jump is GRO-2239, so nothing to open.
                open: page === '' ? undefined : () => follow(inner, false),
                openNew: page === '' ? undefined : () => follow(inner, true),
                copyLink: () => copyLink(`[[${inner}]]`, nav.onNotice),
                copyId: id === null ? undefined : () => copyNoteId(id, nav.onNotice),
                // The caret inside the raw `[[…]]`, its target selected: the link shows as text to type over.
                edit: view.editable
                  ? () => {
                      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from + 2, from + 2 + inner.split('|')[0].length)))
                      view.focus()
                    }
                  : undefined,
                // The text the link shows stays, as plain text.
                remove: view.editable ? () => view.dispatch(view.state.tr.insertText(linkDisplayText(inner, (target) => idLinkTitle(target, source.resolve, titles)), from, to)) : undefined,
              }),
            )
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
