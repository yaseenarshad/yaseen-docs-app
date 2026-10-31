/**
 * Opening wiki links (Links C, GRO-2192; gestures since YAZ-3936) — the interaction layer over Links A's
 * decorations (`wikilinkPlugin.ts`), wired through `createCrepe({ wikilinkNav })`.
 *
 * GESTURES (YAZ-3936, demo round 1 C4 of YAZ-3879): a click opens a link only with a gesture bound in Settings ›
 * Hotkeys › "Links in a note" (`shared/keys/gestures.ts`, read at the click): by default ⌘-click opens it in this
 * tab (`nav.openCurrent`, an already-open path goes to its tab), ⌘⇧-click in a background tab (`nav.openBackground`:
 * appended, never activated, never focused), and "Open in a new tab" has no gesture (`nav.openNewTab`). A read-only
 * note keeps "a click opens" (point 6): a plain click there opens in this tab. Any other click is the editor's
 * (`linkClickAction`, `linkGesture.ts`).
 *
 * MOUSEDOWN, not click: acting on mousedown and calling `preventDefault()` keeps the caret and focus exactly where
 * they were, so a ⌘ background open leaves the document's focused/unfocused state untouched. A revealed (raw) match
 * has no `.wikilink` decoration span, so this handler ignores it (normal caret placement).
 *
 * A CLICK AS ON TEXT (YAZ-3935, C1 and C2 of YAZ-3879): in an editable note a plain click on a pill puts the caret at
 * its nearer edge (the pointer against the pill's middle), and a double-click selects exactly the link; both on
 * mousedown with the default prevented, so the link never flashes its raw text. The link is one unit (`idLinkCaret.ts`).
 *
 * An UNRESOLVED link is created first (`createFromLink` — bare targets under `nav.createFolder()`, the Files & Links
 * "default location for new notes" setting read at CLICK time; C2-, GRO-2240), then opened by the same gesture: a
 * dead link makes its page only through an open gesture (point 5). Failures surface via `nav.onNotice` (App's
 * passive link-notice), never a dialog. A click while its note is being made does nothing, and one after it was made,
 * before the index holds it, opens that note (YAZ-2478): two notes of one title are two files, so the disk refuses no
 * second one. Two more notices (F2, GRO-2197) keep otherwise invisible outcomes visible: a click during the pre-index
 * window (nothing resolvable yet) says the index is still loading, and a background open that CREATES a note names
 * it — the new page opened in a background tab, so nothing else on screen moves. An ID link (YAZ-2293) is the one
 * unresolved link that is NEVER created: an id names a note that existed, so a page called `<id>.md` would be a
 * different note wearing its name — the click says the note is gone and does nothing else. A resolving one opens
 * from its title widget, which carries `.wikilink` and sits inside the match, so the hit-test below finds it like any
 * segment. `[[#h]]` (same-file, empty target) is a no-op — the heading jump is GRO-2239.
 */
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { vaultNoteId } from '@shared/noteId'
import type { HotkeyOverrides } from '@shared/hotkeyBindings'
import type { GestureAction } from '@shared/keys'
import { createFromLink } from './createFromLink'
import { linkClickAction, trackLinkHand } from '../linkGesture'
import type { LinkActions } from '../linkMenu'
import { WIKILINK_CLASS, WIKILINK_RE, eachPlainRun, linkPageName, otherVaultId, type VaultsOfLetters, type WikilinkResolveSource } from './wikilinkPlugin'
import { viewOnlyLinkTarget, type ViewOnlyLinkSource } from './viewOnlyLinkSource'

/**
 * How clicks leave the editor: App threads this window's tabs API + notice setter (via Editor). The link menu's
 * place rows (YAZ-3740: `showInSidebar`, Focus and Favorites, "Open in ▸") are App's `LinkActions`: absent, no row.
 */
export interface WikilinkNav extends LinkActions {
  /** Vault root — every created path is built under it. */
  root: string
  /**
   * Root-relative folder where a BARE unresolved link creates its page ('' = the vault
   * root). A getter, read at CLICK time: the host resolves the Files & Links "default
   * location for new notes" setting against ITS OWN page path (`newNoteBase`, C2- GRO-2240),
   * so right-panel and folder editors create beside themselves, not beside the main
   * tab (YAZ-1643); settings changes land live without remounting any editor. Pathed
   * targets (`[[Sub/Page]]`) ignore it — see `planLinkCreation`.
   */
  createFolder: () => string
  /** "Open in this tab" (YAZ-3936): an already-open path goes to its tab. */
  openCurrent: (path: string) => void
  /** "Open in a new tab", in front. Absent → `openCurrent`. */
  openNewTab?: (path: string) => void
  /** "Open in a background tab": append a background tab (already-open → no-op; focus never moves). */
  openBackground: (path: string) => void
  /** The user's changes of Settings › Hotkeys (`settings.hotkeys`), read at each click: the gestures that open a link. Absent → the defaults. */
  hotkeys?: () => HotkeyOverrides | undefined
  /** Create failure: the passive in-window notice (App's link-notice style), never a dialog. */
  onNotice: (message: string) => void
}

const wikilinkClickKey = new PluginKey('mdapp-wikilink-click')

/**
 * The raw inner text of the wikilink match covering `pos`, or null. Re-runs the decoration
 * pass's own scan (plain runs of the block, embeds skipped) so a hit here is exactly a match
 * the plugin decorated — code and `![[…]]` embeds can never navigate.
 */
export function wikilinkInnerAt(doc: ProseNode, pos: number): string | null {
  return wikilinkMatchAt(doc, pos)?.inner ?? null
}

/**
 * The document position a link's rendered span stands for, for `wikilinkMatchAt`. A widget reads as its own position,
 * and an ID link's title is drawn at the link's END (YAZ-3916): one before it is inside the link, never in a next one.
 */
export function linkPosAtDOM(view: EditorView, span: Element): number {
  const pos = view.posAtDOM(span, 0)
  return span.classList.contains('ProseMirror-widget') ? pos - 1 : pos
}

/** The match at `pos` of `wikilinkInnerAt`, with its range: what the link menu edits and removes (YAZ-3609 D23). */
export function wikilinkMatchAt(doc: ProseNode, pos: number): { from: number; to: number; inner: string } | null {
  const $pos = doc.resolve(pos)
  const block = $pos.parent
  if (!block.isTextblock) return null
  let found: { from: number; to: number; inner: string } | null = null
  eachPlainRun(block, $pos.start(), (text, runPos) => {
    for (const m of text.matchAll(WIKILINK_RE)) {
      if (m[1] === '!') continue
      const from = runPos + m.index
      if (pos >= from && pos < from + m[0].length) found = { from, to: from + m[0].length, inner: m[2] }
    }
  })
  return found
}

/** How a link opens: in this tab, a new tab, or a background tab (YAZ-3936). */
export type LinkFollow = (inner: string, where: GestureAction) => void

/**
 * Follows the raw `[[inner]]` as an open gesture does: opens it `where` the gesture says; an unresolved link is
 * created first. One for an editor, so the click and the link menu's Open rows (YAZ-3609 D23) share the notes being made.
 */
export function wikilinkFollower(source: WikilinkResolveSource, nav: WikilinkNav, viewOnly?: ViewOnlyLinkSource, vaultsOf?: VaultsOfLetters): LinkFollow {
  /** The dead links whose note is being made (null), or was made at that path and is not in the index yet (YAZ-2478): a click on one makes nothing more. */
  const making = new Map<string, string | null>()
  return (inner, where) => {
    const page = linkPageName(inner)
    if (page === '') return // same-file [[#h]] — the heading jump is GRO-2239, not this unit
    const background = where === 'backgroundTab'
    const open = background ? nav.openBackground : where === 'newTab' ? (nav.openNewTab ?? nav.openCurrent) : nav.openCurrent
    const viewSource = viewOnly
    const viewTarget = viewSource === undefined ? null : viewOnlyLinkTarget(inner)
    if (viewTarget !== null && viewSource !== undefined) {
      if (viewTarget.hasSubtarget) {
        nav.onNotice(`Can't open "${viewTarget.raw}": headings and blocks aren't supported for read-only files`)
        return
      }
      if (viewSource.resolve === null) {
        nav.onNotice('File catalog is still loading — try that link again in a moment')
        return
      }
      const viewPath = viewSource.resolve(viewTarget.page)
      if (viewPath === null) nav.onNotice(`Can't open "${viewTarget.page}": file not found`)
      else open(viewPath)
      return
    }
    const resolve = source.resolve
    // Pre-index window: every link renders resolved but nothing can be resolved yet;
    // creating here could shadow an existing note, so the gesture is swallowed — but
    // SAID (GRO-2197): a silently dead click reads as breakage.
    if (resolve === null) {
      nav.onNotice('Vault index is still loading — try that link again in a moment')
      return
    }
    const path = resolve(page)
    const made = making.get(page)
    let other: ReturnType<typeof otherVaultId> = null
    if (path !== null) {
      making.delete(page)
      open(path)
    }
    // An ID of THIS vault that no note has is a deleted note's (YAZ-2677 S25): nothing is
    // created under an ID. Other `LETTERS-NUMBER` text is a name, created like any name
    // (R6, S21, S22); a vault that does not use IDs has no letters, so only an old ID is one there.
    else if (vaultNoteId(page, source.letters) !== undefined) nav.onNotice(source.ids ? 'That note no longer exists' : 'This vault does not use IDs, so this link cannot be opened')
    // An ID of another vault of the window (YAZ-3905 S23): no page of that name is made here; the notice says
    // whose it is. This narrows R6 for this one case: other `LETTERS-NUMBER` text is still a name.
    else if ((other = otherVaultId(inner, source, vaultsOf)) !== null) nav.onNotice(`This ID belongs to ${other.vault === null ? 'another vault' : `the ${other.vault} vault`}. Use a link to that vault.`)
    else if (made === undefined) {
      making.set(page, null)
      void createFromLink(nav.root, inner, source.ids, nav.createFolder(), undefined, source.folders).then((result) => {
        if (result.status === 'created') making.set(page, result.path)
        else making.delete(page)
        if (result.status === 'error') nav.onNotice(result.message)
        else if (result.status === 'created') {
          open(result.path)
          // A background open's freshly CREATED page landed in a background tab (locked I3
          // ruling — never activated), so name what just appeared (GRO-2197).
          if (background) nav.onNotice(`Created "${page}" in a background tab`)
        }
      })
    } else if (made !== null) open(made)
  }
}

/**
 * The edge of the link at `from`..`to` that a click at `x` is nearer, by the pill's middle (YAZ-3935 C1): the boxes of
 * the link's shown pieces on the clicked piece's line. Read on a click only.
 */
function nearerEdge(view: EditorView, span: Element, from: number, to: number, x: number): number {
  const line = span.getBoundingClientRect()
  let left = line.left
  let right = line.right
  const block = span.parentElement?.closest('p, h1, h2, h3, h4, h5, h6, li, td, th') ?? view.dom
  for (const piece of block.querySelectorAll(`.${WIKILINK_CLASS}`)) {
    const pos = linkPosAtDOM(view, piece)
    if (pos < from || pos >= to) continue
    const box = piece.getBoundingClientRect()
    if (Math.abs(box.top - line.top) > Math.max(1, line.height / 2)) continue
    left = Math.min(left, box.left)
    right = Math.max(right, box.right)
  }
  return x < (left + right) / 2 ? from : to
}

/**
 * The click: `follow` is the editor's one `wikilinkFollower`, shared with the link menu's Open rows; `hotkeys` the
 * user's changes, read at each click (`linkClickAction`).
 *
 * In an editable note a click no gesture has works as on text (YAZ-3935 C1, C2): a plain click puts the caret at the
 * pill's nearer edge, a double-click selects exactly the link. Both prevent the default, so the link never flashes
 * its raw text. Any other click (⇧, ⌥) is the editor's. The plugin also keeps the hand cursor in step with the held
 * modifiers (`trackLinkHand`).
 */
export function createWikilinkClick(follow: LinkFollow, hotkeys: () => HotkeyOverrides | undefined = () => undefined) {
  return $prose(
    () =>
      new Plugin({
        key: wikilinkClickKey,
        view: (view) => ({ destroy: trackLinkHand(view, hotkeys) }),
        props: {
          handleDOMEvents: {
            mousedown: (view, event) => {
              if (event.button !== 0 || !(event.target instanceof Element)) return false
              const span = event.target.closest(`.${WIKILINK_CLASS}`)
              // A `.wikilink` span exists ONLY while the match is collapsed (an open link has no
              // decorations) — raw text falls through to editing.
              if (span === null || !view.dom.contains(span)) return false
              const match = wikilinkMatchAt(view.state.doc, linkPosAtDOM(view, span))
              if (match === null) return false
              const where = linkClickAction(view, event, hotkeys())
              if (where !== null) {
                // From here the gesture is ours: no caret placement, no focus change, no reveal.
                event.preventDefault()
                follow(match.inner, where)
                return true
              }
              // A click as on text (C1, C2): a modified one, and a triple-click (the paragraph), stay the browser's.
              if (!view.editable || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.detail > 2) return false
              event.preventDefault()
              const selection = event.detail === 2 ? TextSelection.create(view.state.doc, match.from, match.to) : TextSelection.create(view.state.doc, nearerEdge(view, span, match.from, match.to, event.clientX))
              view.dispatch(view.state.tr.setSelection(selection))
              view.focus()
              return true
            },
          },
        },
      }),
  )
}
