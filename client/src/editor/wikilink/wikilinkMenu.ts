/**
 * Right-click on a `[[link]]`: the one link menu (YAZ-3609 D23, YAZ-3740, `linkMenu.ts`). An id link
 * (YAZ-2293) shows a title and hides the id, so this menu is where the id can be SEEN and copied —
 * its top line "ID: <id>", "Copy name and ID", "Copy ID". No other link has a top line: it would repeat the pill (YAZ-3747 demo).
 * A name link and a view-only link get the same menu with no ID rows: "Copy name" copies the name the pill
 * shows (YAZ-3778 D2, D3). A link that is found has the place rows too: Show in sidebar, Copy path,
 * Focus, Favorites, "Open in ▸". An id no note has (YAZ-3905 S10) reads (Missing note) (its id), and an
 * ID of another vault of the window (S23) (its id) (ID from the … vault): both offer only Copy ID, Edit
 * and Remove. Any id before the index loads still shows its id and Copy ID.
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
import { splitLink } from '@shared/linkParts'
import { pathTitles } from '../../lib/pageLabel'
import { copyText, linkMenuRows, openMenuAt, placeRows, type LinkMenu } from '../linkMenu'
import { boardCheckOf } from '../drawing/boardEmbedScan'
import { boardEmbedTarget } from '../drawing/boardEmbedText'
import { inCellOrNote } from '../table/cellBlocks'
import { OPEN_ID_LINK } from './idLinkCaret'
import { fileKind } from '@shared/fileKind'
import { newEmbed } from '@shared/embedOptions'
import { linkPosAtDOM, wikilinkMatchAt, type LinkFollow, type WikilinkNav } from './wikilinkClick'
import { WIKILINK_CLASS, idLinkTitle, linkDisplayText, linkIsResolved, linkNoteId, linkPageName, linkPath, missingId, nameAndId, otherVaultId, type VaultsOfLetters, type WikilinkResolveSource } from './wikilinkPlugin'
import type { ViewOnlyLinkSource } from './viewOnlyLinkSource'
import { pillStyleRow } from './pillStyle'

const wikilinkMenuKey = new PluginKey('mdapp-wikilink-menu')

/** The collapsed `[[link]]` under `target` — `wikilinkClick`'s hit-test — with its range, or null. */
function linkAt(view: EditorView, target: EventTarget | null): { from: number; to: number; inner: string } | null {
  if (!(target instanceof Element)) return null
  const span = target.closest(`.${WIKILINK_CLASS}`)
  if (span === null || !view.dom.contains(span)) return null
  return wikilinkMatchAt(view.state.doc, linkPosAtDOM(view, span))
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
function menuOf(view: EditorView, from: number, to: number, inner: string, source: WikilinkResolveSource, nav: WikilinkNav, follow: LinkFollow, viewOnly: ViewOnlyLinkSource | undefined, vaultsOf: VaultsOfLetters | undefined, keep: (run: () => void) => () => void): LinkMenu {
  // The page side of the link, on either side of the `|` (`splitLink`, YAZ-4935).
  const { head: target, pipe, pageFirst } = splitLink(inner)
  // The caret inside the raw `[[…]]`, its target selected: the link shows as text to type over.
  const edit = view.editable
    ? () => {
        // The one way into an ID link (YAZ-3744 D1): the caret plugin lets this selection stay inside.
        const at = from + 2 + (pipe >= 0 && !pageFirst ? pipe + 1 : 0)
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at, at + target.length)).setMeta(OPEN_ID_LINK, true))
        view.focus()
      }
    : undefined
  // The text the link shows stays, as plain text: the same rule as the pill's (YAZ-3778 D2, D3, S12).
  const remove = view.editable ? (text: string) => view.dispatch(view.state.tr.insertText(text, from, to)) : undefined
  const menu = linkMenuOf(inner, source, nav, follow, viewOnly, vaultsOf, edit, remove)
  // This link's own style (YAZ-4924 round 5): the toolbar's marks around the whole `[[…]]`.
  menu.pillStyle = pillStyleRow(view, from, to, keep)
  // A drawing's or a diagram's link (YAZ-4829 D8): `!` before it, and an alias goes, as the embed shows the board's name.
  // Not in a table cell: embeds there are out of scope (the checker's round 1).
  // An id link to a board (YAZ-4920) is one too: the host's check says so.
  if (view.editable && boardEmbedTarget(target, boardCheckOf(view.state)) !== null && !inCellOrNote(view.state.doc.resolve(from))) menu.showAsEmbed = () => view.dispatch(view.state.tr.insertText(newEmbed(target), from, to))
  return menu
}

/**
 * The link menu of a raw `[[inner]]`, wherever it is drawn: a note, or a drawing's pill (YAZ-4039 D11). `edit` and
 * `remove` are the place's own; absent (a read-only page), their rows are left out. `remove` gets the text to leave.
 */
export function linkMenuOf(inner: string, source: WikilinkResolveSource, nav: WikilinkNav, follow: LinkFollow, viewOnly: ViewOnlyLinkSource | undefined, vaultsOf: VaultsOfLetters | undefined, edit: (() => void) | undefined, removeWith: ((text: string) => void) | undefined): LinkMenu {
  const page = linkPageName(inner)
  const titles = pathTitles(source.records, source.folders)
  const titleOf = (target: string) => idLinkTitle(target, source.resolve, titles)
  const named = () => linkIsResolved(inner, source, viewOnly)
  const remove = removeWith === undefined ? undefined : () => removeWith(linkDisplayText(inner, titleOf, named))
  const copyIdRow = (id: string) => () => copyText(id, 'ID', nav.onNotice, undefined, true)
  // A note that is gone (S10) and an ID of another vault (S23): what can be said, the ID to copy, and the link's own rows.
  const missing = missingId(inner, source)
  if (missing !== undefined) return { labels: ['Missing note', missing], copyId: copyIdRow(missing), edit, remove }
  const other = otherVaultId(inner, source, vaultsOf)
  if (other !== null) return { labels: [other.id, other.vault === null ? 'ID from another vault' : `ID from the ${other.vault} vault`], copyId: copyIdRow(other.id), edit, remove }
  const id = idOf(inner, source)
  const title = id === null ? page : titleOf(id)
  // The page's name as the pill shows it (D2, D3): its title for an ID link, else its name without folders or a hidden extension.
  const shown = page === '' ? '' : linkDisplayText(page, titleOf, named)
  const found = id === null || title !== undefined
  // The place rows (YAZ-3740): only for a file or a folder that is there.
  const path = page === '' ? null : linkPath(inner, source, viewOnly)
  return {
    // Only what the pill hides (YAZ-3747 demo): an ID link's ID. The pill already shows the name, a folder's icon, a vault.
    labels: id === null ? [] : [`ID: ${id}`],
    // `[[#heading]]` of this note: the heading jump is GRO-2239, so nothing to open.
    open: page === '' ? undefined : () => follow(inner, 'thisTab'),
    openNew: page === '' ? undefined : () => follow(inner, 'backgroundTab'),
    // "Open in Explore" (YAZ-4936): a note that is there, where the host has the door.
    openExplore: path !== null && fileKind(path) === 'markdown' && nav.openExplore !== undefined ? () => follow(inner, 'explore') : undefined,
    ...(id !== null && title !== undefined
      ? { copyNameAndId: () => copyText(nameAndId(title, id), 'name and ID', nav.onNotice, undefined, true) }
      : shown !== '' && found ? { copyName: () => copyText(shown, 'name', nav.onNotice, undefined, true) } : {}),
    copyId: id === null ? undefined : copyIdRow(id),
    ...(path === null ? {} : placeRows(path, nav, nav.onNotice)),
    edit,
    remove,
  }
}

export function createWikilinkMenu(source: WikilinkResolveSource, nav: WikilinkNav, follow: LinkFollow, viewOnly?: ViewOnlyLinkSource, vaultsOf?: VaultsOfLetters) {
  return $prose(() => {
    let close = () => {}
    // True while a "Pill style" pick runs: its own change to the note keeps the menu open (the flyout stays).
    let holding = false
    const keep = (run: () => void) => () => {
      holding = true
      try {
        run()
      } finally {
        holding = false
      }
    }
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
            const rows = () => linkMenuRows(menuOf(view, from, to, inner, source, nav, follow, viewOnly, vaultsOf, keep))
            close = openMenuAt(parent, event.clientX, event.clientY, rows(), rows)
            return true
          },
        },
      },
      view: () => ({
        update: (view, previousState) => {
          if (view.state.doc !== previousState.doc && !holding) close()
        },
        destroy: () => close(),
      }),
    })
  })
}
