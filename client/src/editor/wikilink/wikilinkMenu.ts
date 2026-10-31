/**
 * Right-click on a `[[link]]`: the one link menu (YAZ-3609 D23, YAZ-3740, `linkMenu.ts`). An id link
 * (YAZ-2293) shows a title and hides the id, so this menu is where the id can be SEEN and copied —
 * the note's name, its id, "Copy name and ID", "Copy ID". A link to a folder names it `<name> (folder)`.
 * A name link and a view-only link get the same menu with no ID rows: "Copy name" copies the name the pill
 * shows (YAZ-3778 D2, D3). A link that is found has the place rows too: Show in sidebar, Copy path,
 * Focus, Favorites, "Open in ▸". An id no note has (YAZ-3905 S10) reads (Missing note) (its id), and an
 * ID of another vault of the window (S23) (its id) (ID from the … vault): both offer only Copy ID, Edit
 * and Remove. Any id before the index loads has no name row; its id and Copy ID are still offered.
 * Raw text keeps Electron's native menu.
 *
 * RIGHT-BUTTON MOUSEDOWN (and a Ctrl-click's) is swallowed on a collapsed link, for
 * `wikilinkClick.ts`'s reason: left to its default the browser puts the caret in the match, the
 * reveal rule drops the rendered span, and `contextmenu` would arrive on raw text.
 *
 * The popup is `linkMenu.ts`'s (`openMenuAt`). Only the doc-change close is the plugin's.
 */
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { copyNoteId } from '../../lib/copyNoteId'
import { pathTitles } from '../../lib/pageLabel'
import { folderLabel, folderRecord } from '../../links/shortcuts'
import { copyText, linkMenuRows, openMenuAt, placeRows, type LinkMenu } from '../linkMenu'
import { OPEN_ID_LINK } from './idLinkCaret'
import { wikilinkMatchAt, type WikilinkNav } from './wikilinkClick'
import { WIKILINK_CLASS, idLinkTitle, linkDisplayText, linkIsResolved, linkNoteId, linkPageName, linkPath, missingId, nameAndId, otherVaultId, type VaultsOfLetters, type WikilinkResolveSource } from './wikilinkPlugin'
import type { ViewOnlyLinkSource } from './viewOnlyLinkSource'

const wikilinkMenuKey = new PluginKey('mdapp-wikilink-menu')

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
function idOf(inner: string, source: WikilinkResolveSource): string | null {
  return linkNoteId(linkPageName(inner), source) ?? null
}

/** The one link menu of the `[[inner]]` at `from`..`to` (YAZ-3740, YAZ-3905). */
function menuOf(view: EditorView, from: number, to: number, inner: string, source: WikilinkResolveSource, nav: WikilinkNav, follow: (inner: string, background: boolean) => void, viewOnly: ViewOnlyLinkSource | undefined, vaultsOf: VaultsOfLetters | undefined): LinkMenu {
  const page = linkPageName(inner)
  const titles = pathTitles(source.records, source.folders)
  const titleOf = (target: string) => idLinkTitle(target, source.resolve, titles)
  const named = () => linkIsResolved(inner, source, viewOnly)
  // The caret inside the raw `[[…]]`, its target selected: the link shows as text to type over.
  const edit = view.editable
    ? () => {
        // The one way into an ID link (YAZ-3744 D1): the caret plugin lets this selection stay inside.
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from + 2, from + 2 + inner.split('|')[0].length)).setMeta(OPEN_ID_LINK, true))
        view.focus()
      }
    : undefined
  // The text the link shows stays, as plain text: the same rule as the pill's (YAZ-3778 D2, D3, S12).
  const remove = view.editable ? () => view.dispatch(view.state.tr.insertText(linkDisplayText(inner, titleOf, named), from, to)) : undefined
  const copyIdRow = (id: string) => ({ hint: id, run: () => copyNoteId(id, nav.onNotice) })
  // A note that is gone (S10) and an ID of another vault (S23): what can be said, the ID to copy, and the link's own rows.
  const missing = missingId(inner, source)
  if (missing !== undefined) return { labels: ['Missing note', missing], copyId: copyIdRow(missing), edit, remove }
  const other = otherVaultId(inner, source, vaultsOf)
  if (other !== null) return { labels: [other.id, other.vault === null ? 'ID from another vault' : `ID from the ${other.vault} vault`], copyId: copyIdRow(other.id), edit, remove }
  const id = idOf(inner, source)
  const title = id === null ? page : titleOf(id)
  // A folder's name row says so: an id is its settings file's, and resolves to its directory.
  const dir = page === '' ? null : source.resolve?.(page)
  const isFolder = dir != null && (id === null ? folderRecord(source.folders, dir) !== undefined : folderRecord(source.folders, dir)?.id === id)
  const name = title === undefined || title === '' ? undefined : isFolder ? folderLabel(title) : title
  // The page's name as the pill shows it (D2, D3): its title for an ID link, else its name without folders or a hidden extension.
  const shown = page === '' ? '' : linkDisplayText(page, titleOf, named)
  const found = id === null || title !== undefined
  // The place rows (YAZ-3740): only for a file or a folder that is there.
  const path = page === '' ? null : linkPath(inner, source, viewOnly)
  return {
    labels: [...(name === undefined ? [] : [name]), ...(id === null ? [] : [id])],
    // `[[#heading]]` of this note: the heading jump is GRO-2239, so nothing to open.
    open: page === '' ? undefined : () => follow(inner, false),
    openNew: page === '' ? undefined : () => follow(inner, true),
    ...(id !== null && title !== undefined
      ? { copyNameAndId: { hint: nameAndId(title, id), run: () => copyText(nameAndId(title, id), 'name and ID', nav.onNotice) } }
      : shown !== '' && found ? { copyName: { hint: shown, run: () => copyText(shown, 'name', nav.onNotice) } } : {}),
    copyId: id === null ? undefined : copyIdRow(id),
    ...(path === null ? {} : placeRows(path, nav, nav.onNotice)),
    edit,
    remove,
  }
}

export function createWikilinkMenu(source: WikilinkResolveSource, nav: WikilinkNav, follow: (inner: string, background: boolean) => void, viewOnly?: ViewOnlyLinkSource, vaultsOf?: VaultsOfLetters) {
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
            close = openMenuAt(parent, event.clientX, event.clientY, linkMenuRows(menuOf(view, from, to, inner, source, nav, follow, viewOnly, vaultsOf)))
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
